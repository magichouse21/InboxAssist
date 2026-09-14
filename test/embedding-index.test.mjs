import assert from "node:assert/strict";
import test from "node:test";
import { chunkText, cleanEmailText, normalizedCosineSimilarity, validateEmbeddings } from "../js/embedding-index.js";

test("email cleaning removes markup and quoted replies", () => {
  assert.equal(cleanEmailText("<p>Hello</p>\n--- quoted reply\nOld text"), "Hello");
});

test("chunking creates overlapping bounded chunks", () => {
  const text = `${"A".repeat(60)}. ${"B".repeat(60)}. ${"C".repeat(60)}.`;
  const chunks = chunkText(text, 80, 10);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
});

test("cosine similarity ranks identical vectors highest", () => {
  assert.equal(normalizedCosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(normalizedCosineSimilarity([1, 0], [0, 1]), 0);
});

test("embedding batches must be complete and dimensionally consistent", () => {
  assert.equal(validateEmbeddings([[1, 2], [3, 4]], 2).length, 2);
  assert.throws(() => validateEmbeddings([[1, 2]], 2), /incomplete/);
  assert.throws(() => validateEmbeddings([[1, 2], [3]], 2), /inconsistent/);
});
