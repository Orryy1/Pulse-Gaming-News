/**
 * tests/services/stabilisation-pass-2.test.js
 *
 * 2026-04-24 — incremental additions on top of the 2026-04-23
 * stabilisation pass:
 *
 *   - requireExistingMedia: structured error helper that throws
 *     a message containing BOTH the stored relative path AND the
 *     full list of candidate paths we actually tried, so Discord
 *     summaries pinpoint exactly which filesystem tree is missing
 *     the asset. Covers Task 6 item #13.
 *
 *   - public_verified outcome: strict-superset of new_upload for
 *     platforms that independently confirm a post is LIVE after
 *     upload (Facebook does this today via verifyReelPublished —
 *     polls /video_reels status until video_status=ready AND
 *     publishing_phase.status=published). Render shows "✅ verified"
 *     and status derivation counts it as fresh.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");

// ---------- requireExistingMedia ------------------------------------

function loadMediaPaths({ mediaRoot } = {}) {
  delete require.cache[require.resolve("../../lib/media-paths.js")];
  if (mediaRoot) process.env.MEDIA_ROOT = mediaRoot;
  else delete process.env.MEDIA_ROOT;
  return require("../../lib/media-paths.js");
}

test("requireExistingMedia: returns the absolute path when file exists under MEDIA_ROOT", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-stab2-"));
  try {
    const mediaRoot = path.join(tmp, "media");
    const rel = "output/final/present.mp4";
    const abs = path.join(mediaRoot, rel);
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, Buffer.alloc(100));
    const mp = loadMediaPaths({ mediaRoot });
    const resolved = await mp.requireExistingMedia(rel);
    assert.equal(resolved, path.resolve(mediaRoot, rel));
  } finally {
    delete process.env.MEDIA_ROOT;
    await fs.remove(tmp).catch(() => {});
  }
});

test("requireExistingMedia: throws structured error with stored + attempted paths when file is missing everywhere", async () => {
  // Task 6 item #13: missing-file error must include stored +
  // resolved path safely.
  const mp = loadMediaPaths({ mediaRoot: "/data/media" });
  try {
    await mp.requireExistingMedia("output/final/does-not-exist.mp4");
    assert.fail("expected requireExistingMedia to throw");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.match(err.message, /Media file not found/);
    // Stored path must appear verbatim so operators can match the
    // Discord line to the exact DB row.
    assert.match(err.message, /output\/final\/does-not-exist\.mp4/);
    // Attempted list must include BOTH candidate roots so operators
    // know which trees were checked.
    assert.match(err.message, /attempted=\[/);
    assert.match(err.message, /data[\\/]media/);
    // Structured fields on the error object for re-raise safety.
    assert.equal(err.storedPath, "output/final/does-not-exist.mp4");
    assert.ok(Array.isArray(err.attempted));
    assert.ok(err.attempted.length >= 1);
  } finally {
    delete process.env.MEDIA_ROOT;
  }
});

test("requireExistingMedia: rejects path traversal + NUL with structured error (no candidates emitted)", async () => {
  const mp = loadMediaPaths({ mediaRoot: "/data/media" });
  try {
    await mp.requireExistingMedia("../../etc/passwd");
    assert.fail("expected throw on traversal");
  } catch (err) {
    assert.match(err.message, /refused/);
    assert.equal(err.attempted.length, 0);
  }
  try {
    await mp.requireExistingMedia("output/final/x\u0000.mp4");
    assert.fail("expected throw on NUL byte");
  } catch (err) {
    assert.match(err.message, /refused/);
  } finally {
    delete process.env.MEDIA_ROOT;
  }
});

test("requireExistingMedia: error message contains no token-shaped substrings", async () => {
  // Belt and braces: even though we only emit filesystem paths,
  // assert the error message contains no Bearer or access_token
  // pattern that could leak if a caller inadvertently passed one.
  const mp = loadMediaPaths({ mediaRoot: "/data/media" });
  try {
    await mp.requireExistingMedia("output/final/ghost.mp4");
    assert.fail();
  } catch (err) {
    assert.doesNotMatch(err.message, /Bearer\s+[A-Za-z0-9._-]{10,}/);
    assert.doesNotMatch(err.message, /access_token=[^\s&]+/);
  } finally {
    delete process.env.MEDIA_ROOT;
  }
});

// ---------- public_verified outcome --------------------------------

const { renderPublishSummary } = require("../../lib/job-handlers");

function baseResult(outcomes, overrides = {}) {
  return {
    title: "Test story",
    youtube: false,
    tiktok: false,
    instagram: false,
    facebook: false,
    twitter: false,
    errors: {},
    skipped: {},
    fallbacks: {},
    platform_outcomes: Object.assign(
      {
        youtube: "not_attempted",
        tiktok: "not_attempted",
        instagram: "not_attempted",
        facebook: "not_attempted",
        twitter: "not_attempted",
        facebook_card: "not_attempted",
        instagram_story: "not_attempted",
        twitter_image: "not_attempted",
      },
      outcomes,
    ),
    ...overrides,
  };
}

test("public_verified renders '✅ verified' (distinct from plain new_upload ✅)", () => {
  const r = baseResult(
    {
      youtube: "new_upload",
      tiktok: "new_upload",
      instagram: "new_upload",
      facebook: "public_verified",
      twitter: "skipped",
    },
    { skipped: { twitter: "twitter_disabled" } },
  );
  const s = renderPublishSummary(r);
  assert.match(s.message, /FB Reel ✅ verified/);
  assert.match(s.message, /YT ✅/);
  // Plain "YT ✅" must not accidentally match "YT ✅ verified" token.
  assert.doesNotMatch(s.message, /YT ✅ verified/);
});

test("public_verified contributes to Status: ok (treated as fresh new upload)", () => {
  const r = baseResult(
    {
      youtube: "public_verified",
      tiktok: "public_verified",
      instagram: "public_verified",
      facebook: "public_verified",
      twitter: "skipped",
    },
    { skipped: { twitter: "twitter_disabled" } },
  );
  const s = renderPublishSummary(r);
  assert.equal(s.status, "ok");
});

test("mix of public_verified + new_upload + already_published → degraded (not no_new_post)", () => {
  const r = baseResult(
    {
      youtube: "new_upload",
      tiktok: "public_verified",
      instagram: "already_published",
      facebook: "already_published",
      twitter: "skipped",
    },
    { skipped: { twitter: "twitter_disabled" } },
  );
  const s = renderPublishSummary(r);
  // 2 fresh (1 new_upload + 1 public_verified) + 2 already → degraded
  assert.equal(s.status, "degraded");
});

test("Facebook publisher code path sets public_verified after uploadReel returns (source-scan pin)", () => {
  // upload_facebook.js::uploadReel awaits verifyReelPublished
  // before returning — so a returned videoId means the Reel is
  // actually live, not merely accepted. publisher.js should
  // reflect that with public_verified, not new_upload. Pin the
  // invariant via source-scan so a future refactor that drops
  // the verify step forces a corresponding outcome downgrade.
  const fsSrc = require("node:fs");
  const pubSrc = fsSrc.readFileSync(
    require.resolve("../../publisher.js"),
    "utf8",
  );
  // Facebook-success branch should write public_verified.
  const idx = pubSrc.indexOf("story.facebook_post_id = fbResult.videoId");
  assert.ok(idx > 0, "FB success branch must exist");
  const block = pubSrc.slice(idx, idx + 800);
  assert.match(
    block,
    /platform_outcomes\.facebook\s*=\s*["']public_verified["']/,
    "FB success branch must set platform_outcomes.facebook = 'public_verified'",
  );

  // And upload_facebook.js itself still calls verifyReelPublished
  // — if this assertion fails, the 'public_verified' label above is
  // a lie and must be demoted.
  const fbSrc = fsSrc.readFileSync(
    require.resolve("../../upload_facebook.js"),
    "utf8",
  );
  assert.match(fbSrc, /verifyReelPublished\(/);
});
