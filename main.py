import json
import os
from typing import Dict, List, Any

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from google import genai
from google.genai import types


load_dotenv()

app = Flask(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY is missing. Add it to your .env file.")

client = genai.Client(api_key=GEMINI_API_KEY)

# In-memory sessions
# Structure:
# sessions = {
#   "session_id": {
#       "email_text": "...",
#       "history": [
#           {"question": "...", "answer": "..."},
#           ...
#       ]
#   }
# }
sessions: Dict[str, Dict[str, Any]] = {}


def json_error(message: str, status_code: int):
    response = jsonify({"error": message})
    response.status_code = status_code
    return response


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
        formatted_turns = []
        for item in recent_history:
            formatted_turns.append(
                f"Q: {item['question']}\nA: {item['answer']}"
            )
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


def build_write_email_prompt(description: str, tone: str, recipient: str, sender_name: str) -> str:
    recipient_line = recipient if recipient else "Not specified"
    sender_line = sender_name if sender_name else "Not specified"

    return f"""
You write professional emails.

Based on the description below, draft a complete email.
Use this tone: {tone}.
Recipient: {recipient_line}
Sender name: {sender_line}

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
    body = data.get("body")

    if not isinstance(subject, str) or not subject.strip():
        return None

    if not isinstance(body, str) or not body.strip():
        return None

    return {
        "subject": subject.strip(),
        "body": body.strip(),
    }


@app.get("/")
def home():
    return jsonify(
        {
            "message": "Outlook project backend is running.",
            "endpoints": {
                "summarize": "POST /summarize",
                "qna": "POST /qna",
                "write_email": "POST /write-email"
            }
        }
    )


@app.post("/summarize")
def summarize():
    data = request.get_json(silent=True)
    if not data:
        return json_error("Request body must be valid JSON.", 400)

    email_text = data.get("content")
    style = data.get("style", "brief and professional")

    if not isinstance(email_text, str) or not email_text.strip():
        return json_error("'content' is required and must be a non-empty string.", 400)

    if not isinstance(style, str):
        return json_error("'style' must be a string.", 400)

    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=build_summary_prompt(email_text.strip(), style.strip() or "brief and professional"),
            config=types.GenerateContentConfig(temperature=0.4),
        )

        message = (response.text or "").strip()
        if not message:
            return json_error("Model returned an empty response.", 502)

        return jsonify({"message": message})

    except Exception as exc:
        return json_error(f"Gemini request failed: {str(exc)}", 500)


@app.post("/qna")
def qna():
    data = request.get_json(silent=True)
    if not data:
        return json_error("Request body must be valid JSON.", 400)

    question = data.get("question")
    new_session = data.get("new_session", True)
    session_id = data.get("session_id")
    email_text = data.get("content")

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

            sessions[session_id] = {
                "email_text": email_text.strip(),
                "history": []
            }

        if session_id not in sessions:
            return json_error(
                "Session not found. Start a new session with 'new_session': true and include 'content'.",
                404,
            )

        session = sessions[session_id]
        prompt = build_qa_prompt(
            email_text=session["email_text"],
            question=question.strip(),
            history=session["history"],
        )

        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.3),
        )

        answer = (response.text or "").strip()
        if not answer:
            return json_error("Model returned an empty response.", 502)

        session["history"].append(
            {
                "question": question.strip(),
                "answer": answer,
            }
        )

        return jsonify(
            {
                "session_id": session_id,
                "message": answer,
                "history_count": len(session["history"]),
            }
        )

    except Exception as exc:
        return json_error(f"Gemini request failed: {str(exc)}", 500)


@app.post("/write-email")
def write_email():
    data = request.get_json(silent=True)
    if not data:
        return json_error("Request body must be valid JSON.", 400)

    description = data.get("description")
    tone = data.get("tone", "professional")
    recipient = data.get("recipient", "")
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
        response = client.models.generate_content(
            model=MODEL,
            contents=build_write_email_prompt(
                description.strip(),
                tone.strip() or "professional",
                recipient.strip(),
                sender_name.strip(),
            ),
            config=types.GenerateContentConfig(
                temperature=0.7,
                response_mime_type="application/json",
            ),
        )

        raw_text = (response.text or "").strip()
        if not raw_text:
            return json_error("Model returned an empty response.", 502)

        parsed = parse_email_json(raw_text)
        if not parsed:
            return json_error("Model returned invalid JSON for email draft.", 502)

        return jsonify(parsed)

    except Exception as exc:
        return json_error(f"Gemini request failed: {str(exc)}", 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)