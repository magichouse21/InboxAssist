import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerateContentRequest } from "../js/gemini-api.js";

test("Gemini requests contain a text prompt and bounded test output", () => {
  const request = buildGenerateContentRequest("Reply with OK only.");
  assert.equal(request.contents[0].parts[0].text, "Reply with OK only.");
  assert.equal(request.generationConfig.maxOutputTokens, 32);
  assert.equal(request.generationConfig.temperature, 0);
});
