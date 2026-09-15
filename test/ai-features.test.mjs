import assert from "node:assert/strict";
import test from "node:test";
import { buildComposePrompt, buildQaPrompt, buildSummaryPrompt, compactEmail, parseDraftJson } from "../js/ai-features.js";
import { SUMMARY_MAX_OUTPUT_TOKENS } from "../js/config.js";

test("summary prompt requires complete bullets and uses a bounded email contribution", () => {
  const email = { from_name: "Sender", subject: "Subject", body: "x".repeat(5000) };
  const compact = compactEmail(email);
  assert.ok(compact.length < 4200);
  assert.match(buildSummaryPrompt(compact), /complete bullet points/);
  assert.equal(SUMMARY_MAX_OUTPUT_TOKENS, 2048);
});

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
