import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerateContentRequest } from "../js/gemini-api.js";

test("Gemini requests contain a text prompt and bounded test output", () => {
  const request = buildGenerateContentRequest("Reply with OK only.");
  assert.equal(request.contents[0].parts[0].text, "Reply with OK only.");
  assert.equal(request.generationConfig.maxOutputTokens, 1000);
  assert.equal(request.generationConfig.temperature, 0.4);
});

test("Gemini requests can enforce JSON output", () => {
  const request = buildGenerateContentRequest("Return JSON.", {
    responseMimeType: "application/json",
    responseSchema: { type: "OBJECT" },
  });
  assert.equal(request.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(request.generationConfig.responseSchema, { type: "OBJECT" });
});

test("Gemini requests keep the default config unchanged without structured output options", () => {
  const request = buildGenerateContentRequest("Reply with OK only.");
  assert.deepEqual(request.generationConfig, { maxOutputTokens: 1000, temperature: 0.4 });
});
