import { getUnreadInbox } from "./graph-api.js";
import { generateContent } from "./gemini-api.js";
import { SUMMARY_MAX_OUTPUT_TOKENS } from "./config.js";

const SUMMARY_EMAIL_CHAR_LIMIT = 4000;

export function compactEmail(email) {
  return [
    `From: ${email.from_name || email.from || "Unknown"}`,
    `Subject: ${email.subject || "(no subject)"}`,
    `Received: ${email.received || "Unknown"}`,
    `Preview:\n${(email.body || email.body_preview || "").slice(0, SUMMARY_EMAIL_CHAR_LIMIT)}`,
  ].join("\n");
}

export function buildSummaryPrompt(emailText, style = "brief and professional") {
  return [
    "You summarize emails.",
    `Summarize the emails below in this style: ${style}.`,
    "Return 5-10 complete bullet points. Finish every bullet and do not stop mid-sentence.",
    "Emails:",
    emailText,
  ].join("\n\n");
}

export function buildQaPrompt(emailText, question, history = []) {
  const recent = history.slice(-4).map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n");
  return [
    "You answer questions about an email.",
    "Only use the email content provided below. If the answer is not in the email, say so.",
    `Email:\n${emailText}`,
    recent ? `Previous conversation:\n${recent}` : "",
    `Current question:\n${question}`,
  ].filter(Boolean).join("\n\n");
}

export function buildRagQaPrompt(context, question, history = []) {
  const recent = history.slice(-4).map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n");
  return [
    "You are an email assistant. Answer using only the email excerpts below.",
    "If the answer is not in the excerpts, say so clearly. Cite the email subject when possible.",
    `Relevant email excerpts:\n${context}`,
    recent ? `Previous conversation:\n${recent}` : "",
    `Question:\n${question}`,
  ].filter(Boolean).join("\n\n");
}

export function buildComposePrompt(description, tone, recipient, senderName) {
  return [
    "You write professional emails.",
    "Based on the description below, draft a complete email.",
    `Use this tone: ${tone || "professional"}.`,
    `Recipient: ${recipient || "Not specified"}`,
    `Sender name: ${senderName || "Not specified"}`,
    'Return valid JSON only in this exact format: {"subject":"...","body":"..."}',
    "The subject should be concise and clear. The body should be practical and ready to send. Do not include markdown or extra keys.",
    `Description:\n${description}`,
  ].join("\n\n");
}

export function parseDraftJson(text) {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const data = JSON.parse(normalized);
    if (typeof data.subject !== "string" || !data.subject.trim() || typeof data.body !== "string" || !data.body.trim()) return null;
    return { subject: data.subject.trim(), body: data.body.trim() };
  } catch {
    return null;
  }
}

export async function summarizeInbox(style) {
  const emails = await getUnreadInbox();
  if (!emails.length) return { message: "No unread inbox emails found.", emailsUsed: 0 };
  const message = await generateContent(buildSummaryPrompt(emails.map(compactEmail).join("\n\n--- EMAIL ---\n\n"), style), {
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    temperature: 0.4,
  });
  return { message, emailsUsed: emails.length };
}

export async function answerEmail(emailContent, question, history) {
  return generateContent(buildQaPrompt(emailContent, question, history), { maxOutputTokens: 1000, temperature: 0.4 });
}

export async function composeEmail(description, tone, recipient, senderName) {
  const raw = await generateContent(buildComposePrompt(description, tone, recipient, senderName), {
    maxOutputTokens: 1000,
    temperature: 0.4,
  });
  const draft = parseDraftJson(raw);
  if (!draft) throw new Error("Gemini returned invalid JSON for the email draft.");
  return draft;
}
