"""
Handles:
  1. Fetching emails from Microsoft Graph
  2. Cleaning and chunking email text
  3. Embedding chunks via Gemini text-embedding
  4. Storing vectors in an in-memory FAISS index
  5. Retrieving the top-k most relevant chunks for a query

"""

from __future__ import annotations

import os
import re
import textwrap
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
from dotenv import load_dotenv
import asyncio
import concurrent.futures

try:
    import faiss  
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False
    print("[pipeline] faiss-cpu not installed — falling back to numpy cosine search.")

from google import genai
from google.genai import types as gentypes

# ── Config ────────────────────────────────────────────────────────────────────

EMBEDDING_MODEL   = "gemini-embedding-001"  
CHUNK_SIZE        = 800    
CHUNK_OVERLAP     = 100     
TOP_K             = 3     

# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class EmailChunk:
    email_id:    str
    chunk_index: int
    text:        str
    metadata:    dict = field(default_factory=dict)
    embedding:   Optional[np.ndarray] = field(default=None, repr=False)


@dataclass
class RetrievalResult:
    chunk:  EmailChunk
    score:  float        


# ── Text cleaning ─────────────────────────────────────────────────────────────

_QUOTED_REPLY   = re.compile(r'(-{3,}|_{3,}|On .+wrote:).*', re.DOTALL)
_EXCESS_SPACE   = re.compile(r'\n{3,}')
_HTML_TAG       = re.compile(r'<[^>]+>')
_DISCLAIMER     = re.compile(
    r'(CONFIDENTIALITY NOTICE|This email and any attachments).+',
    re.IGNORECASE | re.DOTALL,
)

def clean_email_text(raw: str) -> str:
    """Strip HTML, quoted replies, disclaimers, and excess whitespace."""
    text = _HTML_TAG.sub(' ', raw)
    text = _DISCLAIMER.sub('', text)
    text = _QUOTED_REPLY.sub('', text)
    text = _EXCESS_SPACE.sub('\n\n', text)
    return text.strip()


# ── Chunking ──────────────────────────────────────────────────────────────────

def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    #Tries to break at sentence/paragraph boundaries within ±50 chars of the target size to avoid cutting mid-sentence
    
    if len(text) <= size:
        return [text]

    chunks = []
    start  = 0

    while start < len(text):
        end = start + size

        if end >= len(text):
            chunks.append(text[start:].strip())
            break

        # try to snap to a sentence end near the target boundary
        window = text[max(end - 50, start): end + 50]
        snap   = -1
        for punct in ('. ', '.\n', '! ', '? ', '\n\n'):
            idx = window.rfind(punct)
            if idx != -1:
                snap = max(end - 50, start) + idx + len(punct)
                break

        end = snap if snap > start else end
        chunks.append(text[start:end].strip())
        start = end - overlap  # slide back by overlap

    return [c for c in chunks if len(c) > 20]  # drop tiny fragments


def email_to_chunks(email: dict) -> List[EmailChunk]:
    """
    Convert a serialized Graph email dict into a list of EmailChunk objects
    Uses both subject and body
    """
    subject = email.get('subject', '') or ''
    body    = email.get('body', '') or email.get('body_preview', '') or ''
    raw     = f"Subject: {subject}\n\n{body}"
    cleaned = clean_email_text(raw)

    texts = chunk_text(cleaned)
    meta  = {
        'subject':  subject,
        'from':     email.get('from') or email.get('from_name', ''),
        'received': email.get('received', ''),
        'is_read':  email.get('is_read', True),
    }

    return [
        EmailChunk(
            email_id=email.get('id', f"unknown_{i}"),
            chunk_index=i,
            text=t,
            metadata=meta,
        )
        for i, t in enumerate(texts)
    ]


# ── Embedding ─────────────────────────────────────────────────────────────────

class EmbeddingService:
    #text embedding via Gemini API

    def __init__(self):
        load_dotenv()
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY not set")
        self._client = genai.Client(api_key=api_key)

    def embed_texts(self, texts: List[str], task: str = "RETRIEVAL_DOCUMENT") -> np.ndarray:
  
        def embed_one(text):
            response = self._client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=text,
                config=gentypes.EmbedContentConfig(task_type=task),
            )
            return response.embeddings[0].values

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(embed_one, texts))

        return np.array(results, dtype=np.float32)


    def embed_query(self, query: str) -> np.ndarray:
        return self.embed_texts([query], task="RETRIEVAL_QUERY")[0]


# ── Vector store ──────────────────────────────────────────────────────────────

class VectorStore:
    """
    In-memory vector store backed by FAISS (or numpy fallback).

    Layout:
        self.chunks  : List[EmailChunk]   — the stored chunks
        self.index   : faiss index        — inner product over L2-normalised vecs
                       OR np.ndarray      — raw matrix for cosine fallback
    """

    def __init__(self):
        self.chunks: List[EmailChunk] = []
        self.index = None
        self._dim: Optional[int] = None

    def _l2_normalise(self, vecs: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)
        return vecs / norms

    def add(self, chunks: List[EmailChunk]) -> None:
        """Add pre-embedded chunks to the store."""
        if not chunks:
            return

        vecs = np.stack([c.embedding for c in chunks]).astype(np.float32)
        vecs = self._l2_normalise(vecs)

        if FAISS_AVAILABLE:
            if self.index is None:
                self._dim  = vecs.shape[1]
                self.index = faiss.IndexFlatIP(self._dim)
            self.index.add(vecs)
        else:
            # numpy fallback: stack into a matrix
            if self.index is None:
                self.index = vecs
            else:
                self.index = np.vstack([self.index, vecs])

        self.chunks.extend(chunks)

    def search(self, query_vec: np.ndarray, top_k: int = TOP_K) -> List[RetrievalResult]:
        """Return the top_k most similar chunks to query_vec."""
        if not self.chunks:
            return []

        q = self._l2_normalise(query_vec.reshape(1, -1).astype(np.float32))

        if FAISS_AVAILABLE:
            scores, indices = self.index.search(q, min(top_k, len(self.chunks)))
            return [
                RetrievalResult(chunk=self.chunks[idx], score=float(score))
                for score, idx in zip(scores[0], indices[0])
                if idx >= 0
            ]
        else:
            # cosine similarity via matrix multiply
            sims   = (self.index @ q.T).flatten()
            top_i  = np.argsort(sims)[::-1][:top_k]
            return [
                RetrievalResult(chunk=self.chunks[i], score=float(sims[i]))
                for i in top_i
            ]

    def clear(self) -> None:
        self.chunks = []
        self.index  = None
        self._dim   = None

    def __len__(self) -> int:
        return len(self.chunks)



class EmailPipeline:
    #the full fetch → chunk → embed → index → retrieve flow

    def __init__(self):
        self.embedder = EmbeddingService()
        self.store    = VectorStore()

    def ingest(self, emails: List[dict]) -> int:
        """
        Chunk, embed, and index a list of email dicts.
        Returns total number of chunks indexed.
        """
        all_chunks: List[EmailChunk] = []

        for email in emails:
            all_chunks.extend(email_to_chunks(email))

        if not all_chunks:
            return 0

        # Embed in one batch call per chunk (Gemini SDK is per-item)
        texts = [c.text for c in all_chunks]
        vecs  = self.embedder.embed_texts(texts, task="RETRIEVAL_DOCUMENT")

        for chunk, vec in zip(all_chunks, vecs):
            chunk.embedding = vec

        self.store.add(all_chunks)
        return len(all_chunks)

    def query(self, question: str, top_k: int = TOP_K) -> List[RetrievalResult]:
        """
        Embed the question and return the top_k most relevant email chunks.
        """
        q_vec = self.embedder.embed_query(question)
        return self.store.search(q_vec, top_k=top_k)

    def query_as_context(self, question: str, top_k: int = TOP_K) -> str:
        """
        Convenience method: returns retrieved chunks formatted as a
        single context block ready to paste into a Gemini prompt.
        """
        results = self.query(question, top_k)
        if not results:
            return "No relevant emails found."

        lines = []
        for i, r in enumerate(results, 1):
            m = r.chunk.metadata
            lines.append(
                f"[{i}] From: {m.get('from','')}  |  Subject: {m.get('subject','')}  "
                f"|  Score: {r.score:.2f}\n{r.chunk.text}"
            )
        return "\n\n---\n\n".join(lines)

    def clear(self) -> None:
        self.store.clear()

    @property
    def chunk_count(self) -> int:
        return len(self.store)