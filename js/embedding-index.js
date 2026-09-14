import { getInboxForIndex } from "./graph-api.js";
import { embedTexts, generateContent } from "./gemini-api.js";
import { buildRagQaPrompt } from "./ai-features.js";
import {
  clearChunks,
  deleteChunksForEmail,
  listChunks,
  listChunksForEmail,
  putChunks,
} from "./indexed-db.js";

export const INDEX_VERSION = 1;

export function cleanEmailText(raw = "") {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/(CONFIDENTIALITY NOTICE|This email and any attachments).+/is, "")
    .replace(/(-{3,}|_{3,}|On .+wrote:).*/is, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkText(text, size = 800, overlap = 100) {
  if (text.length <= size) return text ? [text] : [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const boundaryStart = Math.max(start, end - 50);
      const boundary = text.slice(boundaryStart, end);
      const match = [...boundary.matchAll(/[.!?]\s|\n\n/g)].at(-1);
      if (match) end = Math.max(start + 1, boundaryStart + match.index + match[0].length);
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 20) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export function normalizedCosineSimilarity(left, right) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export function validateEmbeddings(embeddings, expectedCount) {
  if (embeddings.length !== expectedCount || embeddings.some((embedding) => !embedding.length)) {
    throw new Error("Gemini returned an incomplete embedding batch.");
  }
  const dimension = embeddings[0].length;
  if (embeddings.some((embedding) => embedding.length !== dimension)) {
    throw new Error("Gemini returned embeddings with inconsistent dimensions.");
  }
  return embeddings;
}

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function emailChunks(email) {
  const source = cleanEmailText(`Subject: ${email.subject || ""}\n\n${email.body || email.body_preview || ""}`);
  return chunkText(source).map((text, chunkIndex) => ({
    id: `${email.id}:${chunkIndex}`,
    emailId: email.id,
    chunkIndex,
    text,
    contentHash: stableHash(text),
    indexVersion: INDEX_VERSION,
    metadata: {
      subject: email.subject || "(no subject)",
      from: email.from_name || email.from || "Unknown",
      received: email.received || null,
    },
  }));
}

export async function indexInbox(limit = 50) {
  const emails = await getInboxForIndex(limit);
  const currentEmailIds = new Set(emails.map((email) => email.id));
  const storedChunks = await listChunks();
  const staleEmailIds = new Set(storedChunks
    .map((chunk) => chunk.emailId)
    .filter((emailId) => !currentEmailIds.has(emailId)));
  for (const emailId of staleEmailIds) await deleteChunksForEmail(emailId);

  const pending = [];
  for (const email of emails) {
    const desired = emailChunks(email);
    const existing = await listChunksForEmail(email.id);
    const unchanged = existing.length === desired.length && existing.every((chunk) => {
      const match = desired.find((item) => item.id === chunk.id);
      return match && match.contentHash === chunk.contentHash && match.indexVersion === chunk.indexVersion && Array.isArray(chunk.embedding);
    });
    if (unchanged) continue;
    await deleteChunksForEmail(email.id);
    pending.push(...desired);
  }

  if (pending.length) {
    const embeddings = validateEmbeddings(
      await embedTexts(pending.map((chunk) => chunk.text), "RETRIEVAL_DOCUMENT"),
      pending.length,
    );
    await putChunks(pending.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] })));
  }
  return { emailsProcessed: emails.length, chunksIndexed: pending.length };
}

export async function getIndexStatus() {
  return { chunks: (await listChunks()).length };
}

export async function queryIndex(question, topK = 3) {
  const [queryEmbedding, chunks] = await Promise.all([
    embedTexts([question], "RETRIEVAL_QUERY").then(([embedding]) => embedding),
    listChunks(),
  ]);
  validateEmbeddings([queryEmbedding], 1);
  return chunks
    .map((chunk) => ({ chunk, score: normalizedCosineSimilarity(queryEmbedding, chunk.embedding || []) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

export async function answerIndexedQuestion(question, history = []) {
  const results = await queryIndex(question);
  if (!results.length) throw new Error("Index the inbox before asking mailbox-wide questions.");
  const context = results.map(({ chunk, score }) =>
    `From: ${chunk.metadata.from}\nSubject: ${chunk.metadata.subject}\nReceived: ${chunk.metadata.received}\nRelevance: ${score.toFixed(3)}\n${chunk.text}`
  ).join("\n\n--- EMAIL EXCERPT ---\n\n");
  return generateContent(buildRagQaPrompt(context, question, history), { maxOutputTokens: 1000, temperature: 0.4 });
}

export { clearChunks };
