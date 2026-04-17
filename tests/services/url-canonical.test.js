/**
 * tests/services/url-canonical.test.js — identity tests for
 * lib/services/url-canonical.
 *
 * Run with: node --test tests/services/url-canonical.test.js
 * Or a full sweep: node --test tests/
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canonicalUrl,
  canonicalHash,
} = require("../../lib/services/url-canonical");

test("canonicalUrl: lowercases host + strips www + strips trailing slash", () => {
  assert.equal(
    canonicalUrl("https://WWW.Example.com/Path/To/Article/"),
    "example.com/Path/To/Article",
  );
});

test("canonicalUrl: treats http/https as equivalent for identity", () => {
  assert.equal(
    canonicalUrl("http://example.com/a"),
    canonicalUrl("https://example.com/a"),
  );
});

test("canonicalUrl: strips utm_* tracking params", () => {
  assert.equal(
    canonicalUrl("https://example.com/a?utm_source=rss&utm_medium=email"),
    "example.com/a",
  );
});

test("canonicalUrl: strips fbclid / gclid / igshid / ref", () => {
  assert.equal(
    canonicalUrl(
      "https://example.com/a?fbclid=abc&gclid=def&igshid=ghi&ref=homepage",
    ),
    "example.com/a",
  );
});

test("canonicalUrl: keeps real query params + sorts them", () => {
  assert.equal(
    canonicalUrl("https://example.com/article?b=2&a=1"),
    "example.com/article?a=1&b=2",
  );
});

test("canonicalUrl: drops fragment", () => {
  assert.equal(
    canonicalUrl("https://example.com/a#section-2"),
    "example.com/a",
  );
});

test("canonicalUrl: collapses double slashes in path", () => {
  assert.equal(canonicalUrl("https://example.com//a///b/"), "example.com/a/b");
});

test("canonicalUrl: root path stays as /", () => {
  assert.equal(canonicalUrl("https://example.com/"), "example.com/");
});

test("canonicalUrl: returns null for invalid input", () => {
  assert.equal(canonicalUrl(""), null);
  assert.equal(canonicalUrl(null), null);
  assert.equal(canonicalUrl(undefined), null);
  assert.equal(canonicalUrl("not-a-url"), null);
  assert.equal(canonicalUrl("javascript:alert(1)"), null);
  assert.equal(canonicalUrl("mailto:a@b.co"), null);
});

test("canonicalHash: same input yields same 12-char hex", () => {
  const h1 = canonicalHash("https://example.com/a");
  const h2 = canonicalHash("https://example.com/a");
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{12}$/);
});

test("canonicalHash: two URLs that canonicalise to the same thing hash equal", () => {
  // The Pragmata regression shape: utm params stripped, host case normalised
  const clean = canonicalHash("https://www.GameSpot.com/article/pragmata");
  const tagged = canonicalHash(
    "https://gamespot.com/article/pragmata?utm_source=newsletter&utm_medium=email&fbclid=xyz",
  );
  const slashed = canonicalHash("https://www.gamespot.com/article/pragmata/");
  assert.equal(clean, tagged);
  assert.equal(clean, slashed);
});

test("canonicalHash: distinct articles produce distinct hashes", () => {
  const a = canonicalHash("https://gamespot.com/article/pragmata");
  const b = canonicalHash("https://gamespot.com/article/metroid");
  assert.notEqual(a, b);
});

test("canonicalHash: invalid input returns sentinel 'invalid-url'", () => {
  assert.equal(canonicalHash(""), "invalid-url");
  assert.equal(canonicalHash(null), "invalid-url");
  assert.equal(canonicalHash("not-a-url"), "invalid-url");
});
