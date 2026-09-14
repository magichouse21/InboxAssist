import assert from "node:assert/strict";
import test from "node:test";
import { createCodeVerifier } from "../js/microsoft-auth.js";

test("PKCE code verifiers are URL-safe and unpredictable in shape", () => {
  const verifier = createCodeVerifier();
  assert.equal(verifier.length, 86);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(verifier, createCodeVerifier());
});
