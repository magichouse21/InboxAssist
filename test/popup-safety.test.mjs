import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI and Q&A output use text-safe DOM rendering", async () => {
  const source = await readFile("js/popup.js", "utf8");
  assert.match(source, /message\.textContent = ok \? result : error/);
  assert.match(source, /content\.textContent = text/);
  assert.doesNotMatch(source, /output\.innerHTML\s*=.*result/);
  assert.doesNotMatch(source, /bubble\.innerHTML\s*=.*text/);
});
