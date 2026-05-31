import asyncio
import configparser
import json
import os
from typing import Dict, List, Any

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from anthropic import Anthropic
from openai import OpenAI
from email_pipeline import EmailPipeline
print("Pipeline loaded:", EmailPipeline) 
pipeline = EmailPipeline()

from MicrosoftGraphTemplate.graph import Graph

load_dotenv()

app = Flask(__name__)
CORS(app)

# ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
# MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
# OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY")
# DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

# if not ANTHROPIC_API_KEY:
#     raise RuntimeError("ANTHROPIC_API_KEY is missing. Add it to your .env file.")
# if not OPENAI_API_KEY:
#     raise RuntimeError("OPENAI_API_KEY is missing. Add it to your .env file.")
if not CEREBRAS_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is missing. Add it to your .env file.")
# if not DEEPSEEK_API_KEY:
#     raise RuntimeError("DEEPSEEK_API_KEY is missing. Add it to your .env file.")

# client = Anthropic(api_key=ANTHROPIC_API_KEY)
# client = OpenAI(api_key=OPENAI_API_KEY)
client = OpenAI(api_key=CEREBRAS_API_KEY, base_url="https://api.cerebras.ai/v1")
# client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

def ask_model(prompt: str, temperature: float = 0.4, max_tokens: int = 1000) -> str:
    # return ask_anthropic(prompt, temperature, max_tokens)
    # return ask_chat(prompt, max_tokens)
    return ask_cerebras(prompt, temperature, max_tokens)
    # return ask_deep(prompt, max_tokens)

# def ask_anthropic(prompt: str, temperature: float = 0.4, max_tokens: int = 1000) -> str:
#     response = client.messages.create(
#         model="claude-sonnet-4-20250514",
#         max_tokens=max_tokens,
#         temperature=temperature,
#         messages=[
#             {"role": "user", "content": prompt}
#         ],
#     )

#     return response.content[0].text.strip() if response.content else ""

# def ask_chat(prompt: str, max_tokens: int = 1000) -> str:
#     response = client.responses.create(
#         model="gpt-5.5",
#         max_output_tokens=max_tokens,
#         input=[
#             {"role": "user", "content": prompt}
#         ],
#     )

#     return response.output_text.strip() if response.output_text else ""

def ask_cerebras(prompt: str, temperature: float = 0.4, max_tokens: int = 1000) -> str:
    response = client.chat.completions.create(
        model="gpt-oss-120b",
        temperature=temperature,
        max_tokens=max_tokens,
        messages=[
            {"role": "user", "content": prompt}
        ],
    )

    content = response.choices[0].message.content
    return content.strip() if content else ""

# def ask_deep(prompt: str, max_tokens: int = 1000) -> str:
#     response = client.chat.completions.create(
#         model="deepseek-v4-flash",
#         max_tokens=max_tokens,
#         messages=[
#             {"role": "user", "content": prompt}
#         ],
#     )

#     return response.choices[0].message.content.strip()

def compact_email_for_summary(email: dict) -> str:
    return (
        f"From: {email.get('from_name') or email.get('from') or 'Unknown'}\n"
        f"Subject: {email.get('subject') or '(no subject)'}\n"
        f"Received: {email.get('received') or 'Unknown'}\n"
        f"Preview:\n{email.get('body_preview') or ''}"
    )

# ── Microsoft Graph ───────────────────────────────────────────────────────────
# Loaded once at startup. The device code prompt appears in the terminal the
# first time a Graph-backed endpoint is hit and the credential has no cached
# token. Subsequent calls reuse the cached token automatically.

_config = configparser.ConfigParser()
_config.read([
    'MicrosoftGraphTemplate/config.cfg',
    'MicrosoftGraphTemplate/config.dev.cfg',
])
graph = Graph(_config['azure'])

# ── In-memory Q&A sessions ────────────────────────────────────────────────────

sessions: Dict[str, Dict[str, Any]] = {}

# ── Helpers ───────────────────────────────────────────────────────────────────

def json_error(message: str, status_code: int):
    response = jsonify({"error": message})
    response.status_code = status_code
    return response

def run_async(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)

def serialize_message(msg) -> Dict[str, Any]:
    """Convert a Graph Message object to a JSON-safe dict."""
    return {
        "id":           getattr(msg, "id", None),
        "subject":      getattr(msg, "subject", None) or "(no subject)",
        "from":         (
            msg.from_.email_address.address
            if msg.from_ and msg.from_.email_address else None
        ),
        "from_name":    (
            msg.from_.email_address.name
            if msg.from_ and msg.from_.email_address else None
        ),
        "received":     (
            msg.received_date_time.isoformat()
            if getattr(msg, "received_date_time", None) else None
        ),
        "is_read":      getattr(msg, "is_read", None),
        "importance":   str(getattr(msg, "importance", "") or ""),
        "body_preview": getattr(msg, "body_preview", None),
        "body":         (
            msg.body.content
            if getattr(msg, "body", None) and msg.body.content else None
        ),
        "web_link":     getattr(msg, "web_link", None),
    }

# ── Prompt builders ───────────────────────────────────────────────────────────

def build_summary_prompt(email_text: str, style: str) -> str:
    return f"""
You summarize emails.

Summarize the email below in this style: {style}.

Keep the result clear, practical, and concise.

Email:
{email_text}
""".strip()

def build_qa_prompt(email_text: str, question: str, history: List[Dict[str, str]]) -> str:
    recent_history = history[-4:] if history else []
    history_block = ""
    if recent_history:
        formatted_turns = [
            f"Q: {item['question']}\nA: {item['answer']}"
            for item in recent_history
        ]
        history_block = "\n\nPrevious conversation:\n" + "\n\n".join(formatted_turns)

    return f"""
You answer questions about an email.

Only use the email content provided below.

If the answer is not in the email, say so.

Email:
{email_text}
{history_block}

Current question:
{question}
""".strip()

def build_rag_qa_prompt(context: str, question: str, history: List[Dict[str, str]]) -> str:
    recent_history = history[-4:] if history else []
    history_block = ""
    if recent_history:
        formatted_turns = [
            f"Q: {item['question']}\nA: {item['answer']}"
            for item in recent_history
        ]
        history_block = "\n\nPrevious conversation:\n" + "\n\n".join(formatted_turns)
 
    return f"""
You are an email assistant. Answer the question using ONLY the email excerpts below.
If the answer is not in the excerpts, say so clearly.
Cite which email (From / Subject) your answer came from.
 
Relevant email excerpts:
{context}
{history_block}
 
Question: {question}
""".strip()

def build_write_email_prompt(description: str, tone: str, recipient: str, sender_name: str) -> str:
    return f"""
You write professional emails.

Based on the description below, draft a complete email.

Use this tone: {tone}.

Recipient: {recipient or 'Not specified'}
Sender name: {sender_name or 'Not specified'}

Return valid JSON only in this exact format:
{{
  "subject": "...",
  "body": "..."
}}

Requirements:
- The subject should be concise and clear.
- The body should be practical, natural, and ready to send.
- Do not include markdown.
- Do not include extra keys.
- Do not wrap the JSON in code fences.

Description:
{description}
""".strip()

def parse_email_json(text: str):
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    subject = data.get("subject")
    body    = data.get("body")
    if not isinstance(subject, str) or not subject.strip():
        return None
    if not isinstance(body, str) or not body.strip():
        return None
    return {"subject": subject.strip(), "body": body.strip()}

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return jsonify({
        "message": "InboxAssist backend is running.",
        "endpoints": {
            "summarize":   "POST /summarize",
            "qna":         "POST /qna",
            "rag_qna":      "POST /rag-qna",
            "write_email": "POST /write-email",
            "inbox":       "GET  /inbox",
            "index_inbox":  "POST /index-inbox",
            "search":      "POST /search",
            "send":        "POST /send",
        }
    })

# ── Gemini endpoints ──────────────────────────────────────────────────────────

@app.post("/summarize")
def summarize():
    data = request.get_json(silent=True) or {}
    style = data.get("style", "brief and professional")

    if not isinstance(style, str):
        return json_error("'style' must be a string.", 400)

    try:
        messages = run_async(graph.get_inbox())

        if not messages or not messages.value:
            return jsonify({"message": "No inbox emails found.", "emails_used": 0})

        emails = [serialize_message(m) for m in messages.value]

        inbox_text = "\n\n--- EMAIL ---\n\n".join(
            compact_email_for_summary(email)
            for email in emails
        )

        prompt = build_summary_prompt(
            inbox_text,
            style.strip() or "brief and professional summary of the latest 25 inbox emails"
        )

        message = ask_model(prompt)

        if not message:
            return json_error("Model returned an empty response.", 502)

        return jsonify({
            "message": message,
            "emails_used": len(emails),
        })

    except Exception as exc:
        return json_error(f"Graph/model request failed: {str(exc)}", 500)


@app.post("/qna")
def qna():
    data = request.get_json(silent=True)
    if not data:
        return json_error("Request body must be valid JSON.", 400)

    question    = data.get("question")
    new_session = data.get("new_session", True)
    session_id  = data.get("session_id")
    email_text  = data.get("content")

    if not isinstance(question, str) or not question.strip():
        return json_error("'question' is required and must be a non-empty string.", 400)
    if not isinstance(new_session, bool):
        return json_error("'new_session' must be true or false.", 400)
    if not isinstance(session_id, str) or not session_id.strip():
        return json_error("'session_id' is required and must be a non-empty string.", 400)

    session_id = session_id.strip()

    if email_text is not None and not isinstance(email_text, str):
        return json_error("'content' must be a string when provided.", 400)

    try:
        if new_session:
            if not isinstance(email_text, str) or not email_text.strip():
                return json_error(
                    "'content' is required and must be a non-empty string when starting a new session.",
                    400,
                )
            sessions[session_id] = {"email_text": email_text.strip(), "history": []}

        if session_id not in sessions:
            return json_error(
                "Session not found. Start a new session with 'new_session': true and include 'content'.",
                404,
            )

        session = sessions[session_id]
        prompt  = build_qa_prompt(
            email_text=session["email_text"],
            question=question.strip(),
            history=session["history"],
        )

        answer = ask_model(prompt)

        if not answer:
            return json_error("Model returned an empty response.", 502)

        session["history"].append({"question": question.strip(), "answer": answer})

        return jsonify({
            "session_id":    session_id,
            "message":       answer,
            "history_count": len(session["history"]),
        })
    except Exception as exc:
        return json_error(f"Gemini request failed: {str(exc)}", 500)

@app.post("/rag-qna")
def rag_qna():
    """
    RAG Q&A — retrieves relevant chunks from the indexed mailbox,
    then answers using only those chunks.
    Requires /index-inbox to have been called first.
    """
    data = request.get_json(silent=True)
    if not data:
        return json_error("Request body must be valid JSON.", 400)
 
    question   = data.get("question")
    session_id = data.get("session_id", "rag_default")
 
    if not isinstance(question, str) or not question.strip():
        return json_error("'question' is required.", 400)
 
    if pipeline.chunk_count == 0:
        return json_error("Inbox not indexed yet. Call POST /index-inbox first.", 400)
 
    try:
        context = pipeline.query_as_context(question.strip())
 
        if session_id not in sessions:
            sessions[session_id] = {"email_text": "", "history": []}
 
        history = sessions[session_id]["history"]
        prompt  = build_rag_qa_prompt(context, question.strip(), history)
 
        answer = ask_model(prompt)

        if not answer:
            return json_error("Model returned an empty response.", 502)
 
        sessions[session_id]["history"].append({"question": question.strip(), "answer": answer})
 
        return jsonify({
            "session_id":    session_id,
            "message":       answer,
            "history_count": len(sessions[session_id]["history"]),
            "chunks_used":   context.count("---") + 1,
        })
    except Exception as exc:
        return json_error(f"RAG Q&A failed: {str(exc)}", 500)
 
 
@app.post("/write-email")
def write_email():
    data = request.get_json(silent=True)
    if not data:
        return json_error("Request body must be valid JSON.", 400)

    description = data.get("description")
    tone        = data.get("tone", "professional")
    recipient   = data.get("recipient", "")
    sender_name = data.get("sender_name", "")

    if not isinstance(description, str) or not description.strip():
        return json_error("'description' is required and must be a non-empty string.", 400)
    if not isinstance(tone, str):
        return json_error("'tone' must be a string.", 400)
    if not isinstance(recipient, str):
        return json_error("'recipient' must be a string.", 400)
    if not isinstance(sender_name, str):
        return json_error("'sender_name' must be a string.", 400)

    try:
        raw_text = ask_model(
            build_write_email_prompt(
                description.strip(),
                tone.strip() or "professional",
                recipient.strip(),
                sender_name.strip(),
            ),
        )

        if not raw_text:
            return json_error("Model returned an empty response.", 502)

        parsed = parse_email_json(raw_text)
        if not parsed:
            return json_error("Model returned invalid JSON for email draft.", 502)

        return jsonify(parsed)
    except Exception as exc:
        return json_error(f"Model request failed: {str(exc)}", 500)

# ── Graph endpoints ───────────────────────────────────────────────────────────

@app.get("/inbox")
def inbox():
    """
    Returns the latest 25 inbox messages via Microsoft Graph.
    Triggers device code auth in the terminal on first call if no token is cached.
    """
    try:
        messages = run_async(graph.get_inbox())
        if not messages or not messages.value:
            return jsonify({"emails": []})
        return jsonify({"emails": [serialize_message(m) for m in messages.value]})
    except Exception as exc:
        return json_error(f"Graph request failed: {str(exc)}", 500)
    
@app.post("/index-inbox")
def index_inbox():
    """
    Fetch the latest inbox emails, chunk + embed them, and store in the
    in-memory vector index. Call this once when the extension loads,
    or whenever you want to refresh the index.
    """
    try:
        messages = run_async(graph.get_inbox())
        if not messages or not messages.value:
            return jsonify({"ok": True, "chunks_indexed": 0, "emails_processed": 0})
 
        emails = [serialize_message(m) for m in messages.value]
 
        # only index emails not already in the store
        existing_ids = {c.email_id for c in pipeline.store.chunks}
        new_emails   = [e for e in emails if e.get('id') not in existing_ids]

        if not new_emails:
            return jsonify({
                "ok": True,
                "emails_processed": 0,
                "chunks_indexed": 0,
                "message": "All emails already indexed."
            })
        chunks_indexed = pipeline.ingest(new_emails)
 
        return jsonify({
            "ok":             True,
            "emails_processed": len(emails),
            "chunks_indexed": chunks_indexed,
        })
    except Exception as exc:
        return json_error(f"Indexing failed: {str(exc)}", 500)


@app.post("/search")
def search():
    data = request.get_json(silent=True)
    if not data:
        return json_error("Request body must be valid JSON.", 400)


    query = data.get("query")

    # Accept multiple possible frontend field names
    search_filter = (
        data.get("filter")
        or data.get("type")
        or data.get("category")
        or data.get("mode")
        or "All"
    )

    if not isinstance(query, str) or not query.strip():
        return json_error("'query' is required and must be a non-empty string.", 400)

    if not isinstance(search_filter, str):
        return json_error("'filter' must be a string.", 400)

    query = query.strip()
    search_filter_original = search_filter.strip()
    search_filter_key = search_filter_original.lower()


    try:
        if search_filter_key == "all":
            messages = run_async(graph.search_messages(query))

        elif search_filter_key == "from":
            messages = run_async(graph.search_messages_by_person(query))

        elif search_filter_key == "subject":
            messages = run_async(graph.search_messages_by_subject(query))

        elif search_filter_key == "date":
            messages = run_async(graph.search_messages_by_date(query))

        else:
            return json_error(
                f"Invalid filter '{search_filter_original}'. Use one of: All, From, Subject, Date.",
                400
            )

        results = []
        if messages and messages.value:
            results = [serialize_message(m) for m in messages.value]

        return jsonify({
            "query": query,
            "filter": search_filter_original,
            "filter_key": search_filter_key,
            "count": len(results),
            "results": results
        })

    except Exception as exc:
        return json_error(f"Graph search failed: {str(exc)}", 500)


@app.post("/send")
def send():
    """
    Sends an email via Microsoft Graph.
    Body: { "subject": "...", "body": "...", "recipient": "..." }
    """
    data = request.get_json(silent=True)
    if not data:
        return json_error("Request body must be valid JSON.", 400)

    subject   = data.get("subject")
    body      = data.get("body")
    recipient = data.get("recipient")

    if not isinstance(subject, str) or not subject.strip():
        return json_error("'subject' is required and must be a non-empty string.", 400)
    if not isinstance(body, str) or not body.strip():
        return json_error("'body' is required and must be a non-empty string.", 400)
    if not isinstance(recipient, str) or not recipient.strip():
        return json_error("'recipient' is required and must be a non-empty string.", 400)

    try:
        run_async(graph.send_mail(subject.strip(), body.strip(), recipient.strip()))
        return jsonify({"ok": True, "message": "Email sent successfully."})
    except Exception as exc:
        return json_error(f"Graph send failed: {str(exc)}", 500)


if __name__ == "__main__":
    try:
        with app.app_context():
            messages = run_async(graph.get_inbox())
            if messages and messages.value:
                emails = [serialize_message(m) for m in messages.value]
                n = pipeline.ingest(emails)
                print(f"Indexed {n} chunks from {len(emails)} emails.")
    except Exception as e:
        print(f"Auto-index skipped: {e}")

    app.run(host="0.0.0.0", port=5000, debug=False)