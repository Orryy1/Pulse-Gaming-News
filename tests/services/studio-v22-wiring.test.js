const { test } = require("node:test");
const assert = require("node:assert");

// Lock the v2.2 wiring shipped in commit f1a9e6b in place. Three
// pieces of the produce/publish flow that broke independently
// before and we don't want to discover regressed via "the JPEG
// didn't show up on YouTube":
//   1. studio_analytics_loop schedule + handler are registered
//   2. HF thumbnail batch helper is exported with the expected
//      signature
//   3. Self-heal recognises hf_thumbnail_path as a managed media
//      field

const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");
const { handlers } = require("../../lib/job-handlers");
const hf = require("../../lib/studio/v2/hf-thumbnail-builder");

function byName(name) {
  return DEFAULT_SCHEDULES.find((s) => s.name === name);
}

// ── studio_analytics_loop schedule ────────────────────────────────
test("studio_analytics_loop schedule is registered", () => {
  const s = byName("studio_analytics_loop");
  assert.ok(s, "missing schedule entry studio_analytics_loop");
  assert.strictEqual(s.kind, "studio_analytics_loop");
  assert.strictEqual(s.cron_expr, "0 21 * * *");
  assert.match(s.idempotencyTemplate, /^studio_analytics_loop:\{date\}/);
});

test("studio_analytics_loop fires after analytics_evening so stats are fresh", () => {
  const evening = byName("analytics_evening");
  const studio = byName("studio_analytics_loop");
  // Both daily M H * * *
  const [, eveHour] = evening.cron_expr.split(/\s+/);
  const [, studioHour] = studio.cron_expr.split(/\s+/);
  assert.ok(
    Number(studioHour) > Number(eveHour),
    `studio loop ${studio.cron_expr} must run after evening ${evening.cron_expr}`,
  );
});

// ── studio_analytics_loop handler ─────────────────────────────────
test("studio_analytics_loop handler is wired", () => {
  assert.strictEqual(typeof handlers.studio_analytics_loop, "function");
});

// ── HF thumbnail batch helper ─────────────────────────────────────
test("buildThumbnailsForApprovedStories is exported", () => {
  assert.strictEqual(typeof hf.buildThumbnailsForApprovedStories, "function");
});

test("HF thumbnail builder still exposes the legacy single-story API", () => {
  // Don't break the operator-side `buildStoryThumbnail` entry point —
  // it's used by tools and ad-hoc scripts.
  assert.strictEqual(typeof hf.buildStoryThumbnail, "function");
});

// ── Self-heal recognises hf_thumbnail_path ────────────────────────
test("self-heal sweeps hf_thumbnail_path so a missing JPEG triggers rebuild", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "..", "publisher.js"),
    "utf8",
  );
  // Cheap structural assertion: the field-list literal contains
  // hf_thumbnail_path. We don't run the function (needs a populated
  // DB + filesystem); we just lock in that the new field is in the
  // sweep list so a future refactor doesn't drop it.
  assert.match(
    src,
    /selfHealStaleMediaPaths[\s\S]*?fields\s*=\s*\[[\s\S]*?"hf_thumbnail_path"[\s\S]*?\]/,
    "selfHealStaleMediaPaths should include hf_thumbnail_path in its sweep list",
  );
});

// ── upload_youtube prefers hf_thumbnail_path ──────────────────────
test("upload_youtube thumbnail candidate chain prefers hf_thumbnail_path", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "..", "upload_youtube.js"),
    "utf8",
  );
  // Locate the array literal that builds the thumbCandidates list and
  // verify hf_thumbnail_path appears before story_image_path.
  const m = src.match(
    /thumbCandidates\s*=\s*\[\s*([\s\S]*?)\]\s*\.filter\(Boolean\)/,
  );
  assert.ok(m, "could not locate thumbCandidates array literal");
  const fields = m[1];
  const hfIdx = fields.indexOf("hf_thumbnail_path");
  const storyIdx = fields.indexOf("story_image_path");
  const imageIdx = fields.indexOf("image_path");
  assert.ok(hfIdx >= 0, "hf_thumbnail_path must appear in thumbCandidates");
  assert.ok(
    hfIdx < storyIdx,
    "hf_thumbnail_path must come before story_image_path in the candidate chain",
  );
  // image_path is checked last (story_image_path also contains the
  // substring "image_path", so we look for the final occurrence).
  const lastImageIdx = fields.lastIndexOf("image_path");
  assert.ok(
    lastImageIdx > storyIdx,
    "image_path must come after story_image_path",
  );
});

// ── Buffer scaffold gate ──────────────────────────────────────────
test("Buffer scaffold gate stays off when env is unset", async () => {
  const {
    isEnabled,
    publishToTiktokViaBuffer,
  } = require("../../lib/platforms/buffer-tiktok");
  delete process.env.USE_BUFFER_TIKTOK;
  delete process.env.BUFFER_ACCESS_TOKEN;
  assert.strictEqual(isEnabled(), false);
  const r = await publishToTiktokViaBuffer({
    videoPath: "/tmp/x.mp4",
    caption: "hi",
    hashtags: [],
  });
  assert.deepStrictEqual(r, {
    ok: false,
    reason: "not-enabled",
    note: "Set USE_BUFFER_TIKTOK=true and BUFFER_ACCESS_TOKEN to activate",
  });
});
