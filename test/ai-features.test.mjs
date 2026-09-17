import assert from "node:assert/strict";
import test from "node:test";
import { buildComposePrompt, buildQaPrompt, buildSmartSearchPrompt, buildSummaryPrompt, compactEmail, parseDraftJson, parseSmartSearchJson, selectSmartSearchCandidates } from "../js/ai-features.js";
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

test("smart search prompt and parser constrain matches to real candidates", () => {
  const emails = [
    { id: "one", conversation_id: "budget-thread", from_name: "Alex", subject: "Budget review", received: "2026-01-01", body_preview: "The budget is ready." },
    { id: "two", from_name: "Sam", subject: "Lunch", received: "2026-02-01", body_preview: "Want to grab lunch?" },
  ];
  assert.match(buildSmartSearchPrompt("the budget email", emails), /Return valid JSON only/);
  assert.deepEqual(parseSmartSearchJson('```json\n{"matches":[{"emailId":"one","confidence":0.93,"reason":"Discusses the budget"},{"emailId":"fake","confidence":1,"reason":"No"}]}\n```', emails), {
    matches: [{ emailId: "one", confidence: 0.93, reason: "Discusses the budget" }],
    summary: "",
  });
  assert.deepEqual(parseSmartSearchJson('Here are the results:\n{"results":[{"id":"one","score":0.8,"explanation":"Budget topic"}]}\n', emails), {
    matches: [{ emailId: "one", confidence: 0.8, reason: "Budget topic" }],
    summary: "",
  });
  assert.deepEqual(selectSmartSearchCandidates("budget", emails, 1).map((email) => email.id), ["one"]);
});

test("smart search candidates keep one message per conversation", () => {
  const emails = [
    { id: "reply", conversation_id: "thread", subject: "Re: Project", body_preview: "My reply" },
    { id: "original", conversation_id: "thread", subject: "Project update", body_preview: "Original update" },
    { id: "other", conversation_id: "other-thread", subject: "Project plan", body_preview: "Another project" },
  ];
  assert.deepEqual(selectSmartSearchCandidates("project", emails, 5).map((email) => email.id), ["reply", "other"]);
});
