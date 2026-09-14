import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

await import(`../build.mjs?test=${Date.now()}`);

const expectedFiles = [
  "dist/manifest.json",
  "dist/html/popup.html",
  "dist/html/options.html",
  "dist/js/background.js",
  "dist/js/popup.js",
  "dist/js/options.js",
  "dist/js/content.js",
];

test("build emits every extension entry point and static asset", async () => {
  for (const file of expectedFiles) {
    await assert.doesNotReject(access(file), `missing build output: ${file}`);
  }
});
