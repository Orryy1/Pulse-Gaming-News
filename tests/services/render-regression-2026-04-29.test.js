"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  sanitizeDrawtext,
  decodeHtmlEntities,
  asciiFallback,
} = require("../../assemble");

// 2026-04-29 production render regression: the live Pulse Gaming
// uploads were rendering `&pound;22.99` literally and labelling RSS
// feed descriptions as `u/Redditor` comments. These tests pin the
// three P0 patches against regression.

// ── P0.A: sanitizeDrawtext entity decode ──────────────────────────

test("entity-decode: &pound;22.99 renders as readable price", () => {
  // The previous sanitizer kept `&pound;22.99` literal. Now we
  // decode the entity, map £ to GBP for the ASCII drawtext font,
  // and the result reads as a real price.
  const out = sanitizeDrawtext("&pound;22.99", 60);
  assert.match(out, /22\.99/);
  assert.match(out, /GBP/);
  assert.doesNotMatch(out, /&pound;/);
  assert.doesNotMatch(out, /£/);
});

test("entity-decode: numeric &#163;34.99 also renders correctly", () => {
  const out = sanitizeDrawtext("&#163;34.99", 60);
  assert.match(out, /34\.99/);
  assert.match(out, /GBP/);
});

test("entity-decode: hex &#x00A3;69.99 also renders correctly", () => {
  const out = sanitizeDrawtext("&#x00A3;69.99", 60);
  assert.match(out, /69\.99/);
  assert.match(out, /GBP/);
});

test("entity-decode: already-decoded £22.99 ALSO renders correctly (no double-encode)", () => {
  // Regression guard: the old sanitizer would strip the `£` because
  // it falls outside `\x20-\x7E`, leaving `22.99`. We now map the
  // glyph to GBP first, so both `&pound;22.99` and `£22.99` collapse
  // to the same readable form.
  const out = sanitizeDrawtext("£22.99", 60);
  assert.match(out, /22\.99/);
  assert.match(out, /GBP/);
});

test("entity-decode: &amp; survives as a single ampersand", () => {
  const out = sanitizeDrawtext("Pulse &amp; Friends", 60);
  assert.match(out, /Pulse & Friends/);
  assert.doesNotMatch(out, /&amp;/);
});

test("entity-decode: &lt; / &gt; / &quot; round-trip", () => {
  const out = sanitizeDrawtext("&quot;Mind&lt;Eye&gt;&quot;", 60);
  assert.match(out, /"Mind<Eye>"/);
});

test("entity-decode: drawtext-hostile chars still removed AFTER entity decode", () => {
  // Single-quote strip must still apply (drawtext escaping).
  const out = sanitizeDrawtext("don&#x27;t panic", 60);
  // apostrophe is stripped by the sanitiser; entity decode happens
  // first, so we get the apostrophe and then drop it.
  assert.match(out, /dont panic/);
  assert.doesNotMatch(out, /'/);
});

test("entity-decode: colons replaced with spaces (drawtext escaping intact)", () => {
  const out = sanitizeDrawtext("Title: With Colons &amp; More", 60);
  assert.doesNotMatch(out, /:/);
  assert.match(out, /Title With Colons & More/);
});

test("entity-decode: helper exposed for direct testing", () => {
  assert.equal(decodeHtmlEntities("&amp;"), "&");
  assert.equal(decodeHtmlEntities("&pound;"), "GBP ");
  assert.equal(decodeHtmlEntities("&#163;"), "£");
  assert.equal(decodeHtmlEntities("&#x00A3;"), "£");
  assert.equal(decodeHtmlEntities(null), "");
  assert.equal(decodeHtmlEntities(""), "");
  assert.equal(
    decodeHtmlEntities("plain text"),
    "plain text",
    "entity-decoder should leave non-entity text untouched",
  );
});

test("entity-decode: asciiFallback maps the documented currency + symbol set", () => {
  assert.equal(asciiFallback("£10"), "GBP 10");
  assert.equal(asciiFallback("€20"), "EUR 20");
  assert.equal(asciiFallback("¥30"), "JPY 30");
  assert.equal(asciiFallback("Pulse — News"), "Pulse  -  News");
  assert.equal(asciiFallback("don’t"), "don't");
  assert.equal(asciiFallback("hello…"), "hello...");
});

test("entity-decode: long input still respects maxLen with ... truncation", () => {
  const out = sanitizeDrawtext("&pound;22.99 ".repeat(20), 30);
  assert.ok(out.length <= 30);
  assert.match(out, /\.\.\.$/);
});

test("entity-decode: empty/null/undefined inputs do not throw", () => {
  assert.equal(sanitizeDrawtext("", 50), "");
  assert.equal(sanitizeDrawtext(null, 50), "");
  assert.equal(sanitizeDrawtext(undefined, 50), "");
});

// ── P0.B: comment-honesty source guard (source-string structural) ─

test("comment-honesty: assemble.js renders Reddit overlay only when comment_source_type indicates Reddit", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "assemble.js"),
    "utf8",
  );
  // Both render paths (main + single-image fallback) must guard the
  // u/Redditor overlay behind the source-type check.
  const guards =
    src.match(/comment_source_type === "reddit_top_comment"/g) || [];
  assert.ok(
    guards.length >= 2,
    `expected the comment-source guard in BOTH the main and the fallback render paths, got ${guards.length}`,
  );
});

test("comment-honesty: hunter.js stamps comment_source_type on RSS posts as rss_description", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "hunter.js"),
    "utf8",
  );
  assert.match(
    src,
    /comment_source_type:\s*item\.description\s*\?\s*"rss_description"\s*:\s*"none"/,
    "RSS branch must stamp the source type so assemble.js skips the u/Redditor overlay",
  );
  // Reddit branch starts with "none" and is upgraded after a real
  // fetchTopComments succeeds.
  assert.match(
    src,
    /comment_source_type:\s*"none"[\s\S]{0,400}?source_type:\s*"reddit"/,
    "Reddit branch must initialise comment_source_type to 'none'",
  );
  assert.match(
    src,
    /story\.comment_source_type\s*=\s*"reddit_top_comment"/,
    "Hunter must promote to reddit_top_comment after real comments are fetched",
  );
});

// ── P0.C: visual-count metadata stamp (source-string structural) ──

test("visual-count: assemble.js stamps qa_visual_count + qa_visual_warning on the story", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "assemble.js"),
    "utf8",
  );
  assert.match(
    src,
    /story\.qa_visual_count\s*=\s*realImages\.length/,
    "qa_visual_count must be stamped on every render",
  );
  assert.match(
    src,
    /no_real_images_used_composite/,
    "qa_visual_warning must flag the zero-real-image case for the operator",
  );
  assert.match(
    src,
    /thin_visuals_below_three/,
    "qa_visual_warning must flag the under-three case so the operator can spot thin renders",
  );
});
