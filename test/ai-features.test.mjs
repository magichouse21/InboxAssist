import assert from "node:assert/strict";
import test from "node:test";
import { buildComposePrompt, buildQaPrompt, parseDraftJson } from "../js/ai-features.js";

test("compose prompt requests strict draft JSON", () => {
  const prompt = buildComposePrompt("Confirm the meeting", "friendly", "a@example.com", "Alex");
  assert.match(prompt, /Return valid JSON only/);
  assert.match(prompt, /Confirm the meeting/);
});

test("Q&A prompt includes only bounded conversation history", () => {
  const history = Array.from({ length: 6 }, (_, index) => ({ question: `q${index}`, answer: `a${index}` }));
  const prompt = buildQaPrompt("Email text", "What is due?", history);
  assert.doesNotMatch(prompt, /q0/);
  assert.match(prompt, /q5/);
});

test("draft parser accepts fenced JSON and rejects incomplete drafts", () => {
  assert.deepEqual(parseDraftJson('```json\n{"subject":"Hi","body":"Hello"}\n```'), { subject: "Hi", body: "Hello" });
  assert.equal(parseDraftJson('{"subject":"","body":"Hello"}'), null);
});
