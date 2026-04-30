"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { classifyProvenanceSourceType } = require("../../images_download");

// 2026-04-30 audit P1 #2: provenance source-type classifier maps the
// internal (source, type) pair onto the enum used by
// media_provenance.source_type. Pin the mapping so future renamings
// in images_download.js don't silently drift.

test("classifyProvenanceSourceType: article hero → article_hero", () => {
  assert.equal(
    classifyProvenanceSourceType({ source: "article", type: "article_hero" }),
    "article_hero",
  );
});

test("classifyProvenanceSourceType: article inline → article_inline", () => {
  assert.equal(
    classifyProvenanceSourceType({ source: "article", type: "article_inline" }),
    "article_inline",
  );
});

test("classifyProvenanceSourceType: steam variants split correctly", () => {
  const cases = [
    [{ source: "steam", type: "capsule" }, "steam_capsule"],
    [{ source: "steam", type: "hero" }, "steam_hero"],
    [{ source: "steam", type: "key_art" }, "steam_key_art"],
    [{ source: "steam", type: "screenshot" }, "steam_screenshot"],
    [{ source: "steam", type: "trailer" }, "steam_trailer"],
  ];
  for (const [inp, expected] of cases) {
    assert.equal(classifyProvenanceSourceType(inp), expected);
  }
});

test("classifyProvenanceSourceType: igdb cover vs screenshot", () => {
  assert.equal(
    classifyProvenanceSourceType({ source: "igdb", type: "key_art" }),
    "igdb_cover",
  );
  assert.equal(
    classifyProvenanceSourceType({ source: "igdb", type: "screenshot" }),
    "igdb_screenshot",
  );
});

test("classifyProvenanceSourceType: company logo via either source or type", () => {
  assert.equal(
    classifyProvenanceSourceType({ source: "logo", type: "anything" }),
    "company_logo",
  );
  assert.equal(
    classifyProvenanceSourceType({ source: "other", type: "company_logo" }),
    "company_logo",
  );
});

test("classifyProvenanceSourceType: stock sources stay distinct", () => {
  assert.equal(
    classifyProvenanceSourceType({ source: "pexels", type: "screenshot" }),
    "pexels",
  );
  assert.equal(
    classifyProvenanceSourceType({ source: "unsplash", type: "screenshot" }),
    "unsplash",
  );
  assert.equal(
    classifyProvenanceSourceType({ source: "bing", type: "screenshot" }),
    "bing",
  );
});

test("classifyProvenanceSourceType: unknown combo falls through to 'other'", () => {
  assert.equal(
    classifyProvenanceSourceType({ source: "weird_new_source", type: "x" }),
    "other",
  );
  assert.equal(classifyProvenanceSourceType(null), "other");
  assert.equal(classifyProvenanceSourceType({}), "other");
});

test("classifyProvenanceSourceType: case-insensitive on source/type", () => {
  assert.equal(
    classifyProvenanceSourceType({ source: "STEAM", type: "CAPSULE" }),
    "steam_capsule",
  );
  assert.equal(
    classifyProvenanceSourceType({ source: "Pexels", type: "Screenshot" }),
    "pexels",
  );
});

// ── lib/media-provenance API: graceful degradation when SQLite off ──

test("media-provenance.recordDownload: missing required fields → ok=false, error tag", async () => {
  const provenance = require("../../lib/media-provenance");
  const r = await provenance.recordDownload({});
  assert.equal(r.ok, false);
  assert.match(r.error, /story_id_or_source_url/);
});

test("media-provenance.recordDownload: skipPrescan returns without prescan or hash", async () => {
  const provenance = require("../../lib/media-provenance");
  // Without SQLite this returns ok=true with error="repos_unavailable"
  // but we don't depend on that — we only assert the prescan path
  // didn't throw and the return contract is intact.
  const r = await provenance.recordDownload({
    story_id: "test-1",
    source_url: "https://example.com/a.jpg",
    source_type: "article_hero",
    skipPrescan: true,
  });
  // No content_hash because we skipped prescan/hash
  assert.equal(r.content_hash, null);
  assert.equal(r.signals, null);
});

test("media-provenance.summary: returns unavailable shape when SQLite off", () => {
  // The test runner doesn't enable SQLite, so this exercises the
  // graceful-degradation branch.
  const provenance = require("../../lib/media-provenance");
  const s = provenance.summary({ window: "-7 days" });
  assert.equal(typeof s, "object");
  // Either it returned the unavailable shape or it returned a real
  // summary — the contract guarantees either way the keys exist.
  assert.ok("by_source" in s);
  assert.ok("by_acceptance" in s);
  assert.ok("by_licence" in s);
  assert.ok("face_photos" in s);
});

test("media-provenance.listForStory: returns empty array when SQLite off", () => {
  const provenance = require("../../lib/media-provenance");
  const rows = provenance.listForStory("nonexistent");
  assert.ok(Array.isArray(rows));
});
