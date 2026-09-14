import { GEMINI_API_BASE, GEMINI_MODEL } from "./config.js";
import { clearGeminiApiKey, getGeminiApiKey, setGeminiApiKey } from "./storage.js";

export function buildGenerateContentRequest(prompt) {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 32, temperature: 0 },
  };
}

function extractError(data) {
  return data?.error?.message || "Gemini request failed.";
}

export async function generateContent(prompt, options = {}) {
  const apiKey = options.apiKey || await getGeminiApiKey();
  if (!apiKey) throw new Error("Gemini API key is not configured.");
  if (!prompt?.trim()) throw new Error("Gemini prompt cannot be empty.");

  const model = options.model || GEMINI_MODEL;
  const response = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGenerateContentRequest(prompt)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractError(data));

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

export async function testGeminiConnection(apiKey) {
  await generateContent("Reply with OK only.", { apiKey });
  return true;
}

export async function getGeminiStatus() {
  return { configured: Boolean(await getGeminiApiKey()) };
}

export async function saveGeminiKey(apiKey) {
  const normalized = apiKey.trim();
  if (!normalized) throw new Error("Enter a Gemini API key first.");
  await setGeminiApiKey(normalized);
}

export async function removeGeminiKey() {
  await clearGeminiApiKey();
}
