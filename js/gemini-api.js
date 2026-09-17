import { GEMINI_API_BASE, GEMINI_FALLBACK_MODEL, GEMINI_MODEL } from "./config.js";
import { clearGeminiApiKey, getGeminiApiKey, setGeminiApiKey } from "./storage.js";

export function buildGenerateContentRequest(prompt, options = {}) {
  const generationConfig = {
    maxOutputTokens: options.maxOutputTokens || 1000,
    temperature: options.temperature ?? 0.4,
  };
  if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType;
  if (options.responseSchema) generationConfig.responseSchema = options.responseSchema;

  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  };
}

function extractError(data) {
  return data?.error?.message || "Gemini request failed.";
}

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS_PER_MODEL = 2;

function isTransientError(response, data) {
  return TRANSIENT_STATUS_CODES.has(response?.status) || ["UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED"].includes(data?.error?.status);
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.("Retry-After");
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) return Math.min(retryAfterSeconds * 1000, 8000);
  return Math.min(8000, 750 * (2 ** attempt) + Math.floor(Math.random() * 250));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function generateContentWithModel(model, apiKey, prompt, options) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
    let response;
    let data;
    try {
      response = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGenerateContentRequest(prompt, options)),
      });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      lastError = error;
      lastError.transient = true;
      if (attempt + 1 < MAX_ATTEMPTS_PER_MODEL) await wait(retryDelay(null, attempt));
      continue;
    }

    if (response.ok) {
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
      if (!text) throw new Error("Gemini returned an empty response.");
      return text;
    }

    if (!isTransientError(response, data)) throw new Error(extractError(data));
    lastError = new Error(extractError(data));
    lastError.transient = true;
    if (attempt + 1 < MAX_ATTEMPTS_PER_MODEL) await wait(retryDelay(response, attempt));
  }

  throw lastError || new Error("Gemini request failed.");
}

export async function generateContent(prompt, options = {}) {
  const apiKey = options.apiKey || await getGeminiApiKey();
  if (!apiKey) throw new Error("Gemini API key is not configured.");
  if (!prompt?.trim()) throw new Error("Gemini prompt cannot be empty.");

  const model = options.model || GEMINI_MODEL;
  const models = [model, options.fallbackModel || GEMINI_FALLBACK_MODEL].filter((value, index, list) => value && list.indexOf(value) === index);
  let lastError;
  for (const candidateModel of models) {
    try {
      return await generateContentWithModel(candidateModel, apiKey, prompt, options);
    } catch (error) {
      lastError = error;
      if (!error.transient) throw error;
      if (candidateModel === models.at(-1)) break;
    }
  }
  throw new Error(`Gemini is temporarily busy. Please try again in a moment. (${lastError?.message || "request failed"})`);
}

export async function embedTexts(texts, taskType = "RETRIEVAL_DOCUMENT") {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error("Gemini API key is not configured.");
  if (!texts.length) return [];

  const response = await fetch(`${GEMINI_API_BASE}/models/gemini-embedding-001:batchEmbedContents?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
        taskType,
      })),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractError(data));
  return (data.embeddings || []).map((embedding) => embedding.values || []);
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
