import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchPath } from "../js/graph-api.js";

test("subject search escapes OData quotes and preserves the filter", () => {
  const path = buildSearchPath("Bob's update", "subject");
  const params = new URL(`https://graph.test${path}`).searchParams;
  assert.equal(params.get("$filter"), "contains(subject, 'Bob''s update')");
  assert.equal(params.get("$orderby"), "receivedDateTime DESC");
});

test("date search creates an inclusive day range", () => {
  const path = buildSearchPath("2026-09-14", "date");
  const filter = new URL(`https://graph.test${path}`).searchParams.get("$filter");
  assert.equal(filter, "receivedDateTime ge 2026-09-14T00:00:00.000Z and receivedDateTime lt 2026-09-15T00:00:00.000Z");
});

test("from search filters the sender address", () => {
  const path = buildSearchPath("sender@example.com", "from");
  const params = new URL(`https://graph.test${path}`).searchParams;
  assert.equal(params.get("$filter"), "from/emailAddress/address eq 'sender@example.com'");
  assert.equal(params.get("$orderby"), "receivedDateTime DESC");
});

test("all search uses Graph search syntax", () => {
  const path = buildSearchPath("project update", "all");
  const params = new URL(`https://graph.test${path}`).searchParams;
  assert.equal(params.get("$search"), '"project update"');
});
