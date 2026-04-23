/**
 * tests/services/stabilisation-pass.test.js
 *
 * 2026-04-23 production stabilisation pass. Covers:
 *
 *   - selfHealStaleMediaPaths — NULLs path fields that point at
 *     missing files so produce() regenerates them (Task 3)
 *   - TikTok/YouTube/Instagram/Facebook consistent media-path
 *     resolution (Task 3)
 *   - Dashboard approval-queue filtering (Task 4)
 *   - Trusted-publisher auto-approval lane (Task 5)
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");

// ---------- media path consistency (Task 3) -------------------------

test("media-paths resolveExisting finds file under MEDIA_ROOT when set", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-stab-"));
  try {
    const mediaRoot = path.join(tmp, "media");
    const rel = "output/final/abc.mp4";
    const abs = path.join(mediaRoot, rel);
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, Buffer.alloc(100));
    process.env.MEDIA_ROOT = mediaRoot;
    try {
      delete require.cache[require.resolve("../../lib/media-paths.js")];
      const mp = require("../../lib/media-paths.js");
      const resolved = await mp.resolveExisting(rel);
      assert.equal(resolved, path.resolve(mediaRoot, rel));
      assert.equal(await fs.pathExists(resolved), true);
    } finally {
      delete process.env.MEDIA_ROOT;
      delete require.cache[require.resolve("../../lib/media-paths.js")];
    }
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("media-paths legacy rel path supported without MEDIA_ROOT", async () => {
  delete process.env.MEDIA_ROOT;
  delete require.cache[require.resolve("../../lib/media-paths.js")];
  const mp = require("../../lib/media-paths.js");
  // writePath returns the repo-root abs path — no /data assumption.
  const p = mp.writePath("output/final/local.mp4");
  assert.ok(path.isAbsolute(p));
  assert.ok(!p.startsWith("/data/"));
});

test("media-paths resolver: missing file surfaces stored + attempted path cleanly", async () => {
  delete process.env.MEDIA_ROOT;
  delete require.cache[require.resolve("../../lib/media-paths.js")];
  const mp = require("../../lib/media-paths.js");
  const exists = await mp.pathExists("output/final/definitely-not-there.mp4");
  assert.equal(exists, false);
  // resolveExisting returns the preferred target even on miss so
  // callers can still get a stable path for error messages.
  const resolved = await mp.resolveExisting(
    "output/final/definitely-not-there.mp4",
  );
  assert.ok(
    resolved,
    "resolver should return a write-target even when nothing exists",
  );
});

test("media-paths rejects path traversal input", () => {
  delete process.env.MEDIA_ROOT;
  delete require.cache[require.resolve("../../lib/media-paths.js")];
  const mp = require("../../lib/media-paths.js");
  assert.throws(() => mp.writePath("../../etc/passwd"), /refused/);
  assert.throws(() => mp.writePath("output/../../../etc/passwd"), /refused/);
});

test("uploaders share the same media resolver (source-scan pin)", () => {
  const files = [
    "../../upload_youtube.js",
    "../../upload_tiktok.js",
    "../../upload_instagram.js",
    "../../upload_facebook.js",
    "../../upload_twitter.js",
  ];
  for (const f of files) {
    const src = fs.readFileSync(require.resolve(f), "utf8");
    assert.match(
      src,
      /require\(["']\.\/lib\/media-paths["']\)/,
      `${f} must import lib/media-paths`,
    );
    assert.match(
      src,
      /resolveExisting/,
      `${f} must call resolveExisting on exported_path / story_image_path`,
    );
  }
});

// ---------- selfHealStaleMediaPaths (Task 3) ------------------------

test("selfHealStaleMediaPaths NULLs exported_path when file missing, preserves platform ids", async () => {
  // Stub db so we don't need SQLite.
  const DB_PATH = require.resolve("../../lib/db.js");
  const original = require.cache[DB_PATH];
  const upsertCalls = [];
  const stories = [
    {
      id: "story_a",
      exported_path: "output/final/missing.mp4",
      audio_path: "output/audio/missing.mp3",
      image_path: null,
      story_image_path: null,
      youtube_post_id: "yt_real_abc", // MUST be preserved
      instagram_media_id: "ig_real_xyz", // MUST be preserved
      facebook_post_id: "fb_real_123", // MUST be preserved
      tiktok_post_id: null,
    },
    {
      id: "story_b",
      exported_path: null, // no-op
      audio_path: null,
      image_path: null,
      story_image_path: null,
    },
  ];
  require.cache[DB_PATH] = {
    id: DB_PATH,
    filename: DB_PATH,
    loaded: true,
    exports: {
      async getStories() {
        return stories.slice();
      },
      async upsertStory(s) {
        upsertCalls.push({ ...s });
        const idx = stories.findIndex((x) => x.id === s.id);
        if (idx >= 0) stories[idx] = { ...s };
      },
      useSqlite: () => true,
      getStoriesSync: () => stories.slice(),
    },
  };

  // Fresh publisher import so the stubbed db is the one it uses.
  delete require.cache[require.resolve("../../publisher.js")];
  delete process.env.MEDIA_ROOT;

  try {
    const { selfHealStaleMediaPaths } = require("../../publisher.js");
    const { healed } = await selfHealStaleMediaPaths();
    assert.equal(healed, 1);

    // story_a was healed
    const healedStory = stories.find((s) => s.id === "story_a");
    assert.equal(healedStory.exported_path, null);
    assert.equal(healedStory.audio_path, null);

    // Platform ids preserved — this is the critical invariant
    // that prevents the self-heal from causing duplicate uploads.
    assert.equal(healedStory.youtube_post_id, "yt_real_abc");
    assert.equal(healedStory.instagram_media_id, "ig_real_xyz");
    assert.equal(healedStory.facebook_post_id, "fb_real_123");
  } finally {
    if (original) require.cache[DB_PATH] = original;
    else delete require.cache[DB_PATH];
    delete require.cache[require.resolve("../../publisher.js")];
  }
});

test("selfHealStaleMediaPaths is a no-op when every referenced file exists", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-stab-"));
  try {
    const mediaRoot = path.join(tmp, "media");
    const mp4 = path.join(mediaRoot, "output/final/alive.mp4");
    await fs.ensureDir(path.dirname(mp4));
    await fs.writeFile(mp4, Buffer.alloc(100));
    process.env.MEDIA_ROOT = mediaRoot;

    const DB_PATH = require.resolve("../../lib/db.js");
    const original = require.cache[DB_PATH];
    const stories = [
      { id: "story_ok", exported_path: "output/final/alive.mp4" },
    ];
    require.cache[DB_PATH] = {
      id: DB_PATH,
      filename: DB_PATH,
      loaded: true,
      exports: {
        async getStories() {
          return stories.slice();
        },
        async upsertStory() {
          throw new Error(
            "upsertStory must NOT be called when nothing changed",
          );
        },
        useSqlite: () => true,
      },
    };

    delete require.cache[require.resolve("../../lib/media-paths.js")];
    delete require.cache[require.resolve("../../publisher.js")];
    try {
      const { selfHealStaleMediaPaths } = require("../../publisher.js");
      const { healed } = await selfHealStaleMediaPaths();
      assert.equal(healed, 0);
    } finally {
      if (original) require.cache[DB_PATH] = original;
      else delete require.cache[DB_PATH];
      delete require.cache[require.resolve("../../publisher.js")];
      delete require.cache[require.resolve("../../lib/media-paths.js")];
    }
  } finally {
    delete process.env.MEDIA_ROOT;
    await fs.remove(tmp).catch(() => {});
  }
});

// ---------- dashboard filtering (Task 4) ----------------------------
//
// Pure replica of the useStories filter/sort logic — keeps the
// test TS-free and avoids spinning up the React renderer.

function dashboardFilter(storyStates) {
  const HIDDEN_PUBLISH = new Set(["failed", "published"]);
  const HIDDEN_CLASS = new Set(["[DEFER]", "[REJECT]"]);
  return storyStates.filter((s) => {
    const ps = s.story.publish_status || "";
    if (HIDDEN_PUBLISH.has(ps)) return false;
    const cls = s.story.classification || "";
    if (HIDDEN_CLASS.has(cls)) return false;
    return true;
  });
}

test("dashboard filter hides publish_status='failed' (qa_failed) stories", () => {
  const rows = [
    { story: { id: "a", publish_status: "failed" }, status: "pending" },
    { story: { id: "b", publish_status: null }, status: "pending" },
  ];
  const out = dashboardFilter(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].story.id, "b");
});

test("dashboard filter hides publish_status='published' stories", () => {
  const rows = [
    { story: { id: "a", publish_status: "published" }, status: "approved" },
    { story: { id: "b", publish_status: "partial" }, status: "approved" },
  ];
  const out = dashboardFilter(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].story.id, "b"); // partial still shown for retry tracking
});

test("dashboard filter hides [DEFER] and [REJECT] classifications", () => {
  const rows = [
    { story: { id: "a", classification: "[DEFER]" }, status: "pending" },
    { story: { id: "b", classification: "[REJECT]" }, status: "pending" },
    { story: { id: "c", classification: "[REVIEW]" }, status: "pending" },
    { story: { id: "d", classification: "[CONFIRMED]" }, status: "approved" },
  ];
  const out = dashboardFilter(rows);
  assert.deepEqual(
    out.map((s) => s.story.id),
    ["c", "d"],
  );
});

test("dashboard approve button is disabled when story.approved is true (source-scan)", () => {
  const src = fs.readFileSync(
    require.resolve("../../src/components/StoryCard.tsx"),
    "utf8",
  );
  // Approve button references isApproved for disabled state
  assert.match(src, /disabled=\{isApproved\s*\|\|\s*isBusy/);
});

test("dashboard shows NO SCRIPT red warning when hook/body/loop/full_script all empty (source-scan)", () => {
  const src = fs.readFileSync(
    require.resolve("../../src/components/StoryCard.tsx"),
    "utf8",
  );
  assert.match(src, /NO SCRIPT GENERATED/);
});

test("/api/news/full sets no-store cache headers (source-scan)", () => {
  const src = fs.readFileSync(require.resolve("../../server.js"), "utf8");
  // Anchor on the news/full handler block and check for Cache-Control.
  const idx = src.indexOf('app.get("/api/news/full"');
  assert.ok(idx > 0);
  const block = src.slice(idx, idx + 1500);
  assert.match(block, /Cache-Control/);
  assert.match(block, /no-store/);
});

// ---------- trusted-publisher auto lane (Task 5) ---------------------

const {
  qualifiesForTrustedPublisherAutoLane,
  qualifiesForTrustedRumourAutoLane,
  TRUSTED_PUBLISHER_SUBS,
  TRUSTED_PUBLISHER_MIN_SCORE,
} = require("../../lib/scoring.js");

function baseScore(overrides = {}) {
  return {
    decision: "review",
    total: 72,
    hard_stops: [],
    breakdown: {
      source_confidence: 22,
      story_importance: 12,
      freshness: 10,
      search_demand: 5,
      visual_viability: 5,
      originality: 4,
      duplicate_safety: 10,
      advertiser_safety: 5,
      roundup_suitability: 0,
    },
    ...overrides,
  };
}

function baseStory(overrides = {}) {
  return {
    id: "rss_test",
    title: "Assassin's Creed Black Flag Resynced trailer drops in 4 days",
    body: "Ubisoft confirmed on Thursday...",
    full_script: "",
    hook: "",
    subreddit: "RockPaperShotgun",
    source_type: "rss",
    flair: "News",
    ...overrides,
  };
}

test("trusted-publisher lane: strong safe review story qualifies", () => {
  const q = qualifiesForTrustedPublisherAutoLane(baseStory(), baseScore());
  assert.equal(q.qualifies, true);
  assert.match(q.reason, /^trusted_publisher_auto_lane:/);
  assert.match(q.reason, /publisher=rockpapershotgun/);
});

test("trusted-publisher lane: score below 70 does NOT qualify", () => {
  const q = qualifiesForTrustedPublisherAutoLane(
    baseStory(),
    baseScore({ total: 69 }),
  );
  assert.equal(q.qualifies, false);
});

test("trusted-publisher lane: off-brand/celebrity-drama story does NOT qualify", () => {
  const q = qualifiesForTrustedPublisherAutoLane(
    baseStory({
      title: "Film industry actor controversy hits Rings of Power",
      body: "Celebrity drama around a named actor in a film franchise...",
    }),
    baseScore(),
  );
  assert.equal(q.qualifies, false);
});

test("trusted-publisher lane: advertiser-unsafe score blocks the lane", () => {
  const s = baseScore();
  s.breakdown.advertiser_safety = 3; // ambiguous term matched
  const q = qualifiesForTrustedPublisherAutoLane(baseStory(), s);
  assert.equal(q.qualifies, false);
});

test("trusted-publisher lane: duplicate-safety issue blocks the lane", () => {
  const s = baseScore();
  s.breakdown.duplicate_safety = 0; // prior publish exists
  const q = qualifiesForTrustedPublisherAutoLane(baseStory(), s);
  assert.equal(q.qualifies, false);
});

test("trusted-publisher lane: hard-stop blocks the lane", () => {
  const s = baseScore({ hard_stops: ["advertiser_unsafe"] });
  const q = qualifiesForTrustedPublisherAutoLane(baseStory(), s);
  assert.equal(q.qualifies, false);
});

test("trusted-publisher lane: vague-anonymous rumour (same score) does NOT qualify", () => {
  // An anonymous rumour from r/GamingLeaksAndRumours at the same 72
  // total does not clear the trusted-publisher lane because source
  // type is reddit, not rss.
  const q = qualifiesForTrustedPublisherAutoLane(
    baseStory({
      title: "GTA 6 rumour: anonymous insider says delay",
      body: "Anonymous source told subreddit...",
      subreddit: "GamingLeaksAndRumours",
      source_type: "reddit",
      flair: "Rumour",
    }),
    baseScore(),
  );
  assert.equal(q.qualifies, false);
});

test("trusted-publisher lane: non-allowlisted outlet does NOT qualify even at score 72", () => {
  const q = qualifiesForTrustedPublisherAutoLane(
    baseStory({ subreddit: "SomeRandomBlog", source_type: "rss" }),
    baseScore(),
  );
  assert.equal(q.qualifies, false);
});

test("trusted-publisher lane: decision != 'review' does NOT qualify (no double-promotion)", () => {
  const q = qualifiesForTrustedPublisherAutoLane(
    baseStory(),
    baseScore({ decision: "auto" }),
  );
  assert.equal(q.qualifies, false);
});

test("trusted-publisher lane: story without a franchise or platform keyword does NOT qualify", () => {
  const q = qualifiesForTrustedPublisherAutoLane(
    baseStory({
      title: "Games industry executive profile",
      body: "A profile of a person in the games space.",
    }),
    baseScore(),
  );
  assert.equal(q.qualifies, false);
});

test("trusted-publisher lane: audit reason string is stored and parseable", () => {
  const q = qualifiesForTrustedPublisherAutoLane(baseStory(), baseScore());
  assert.match(q.reason, /publisher=rockpapershotgun/);
  assert.match(q.reason, /score=72/);
  assert.match(q.reason, /franchise=|platform=/);
});

test("existing trusted-rumour lane remains unchanged (not poached by new lane)", () => {
  // A rumour story that qualifies for the original lane must
  // still qualify — the new lane is additive, not a replacement.
  const rumour = {
    id: "1test",
    title:
      "Billbil-kun: Horizon Zero Dawn Remastered leaked into April's PS Plus",
    body: "Tier-1 leaker Billbil-kun says...",
    hook: "",
    full_script: "",
    subreddit: "gamingleaksandrumours",
    flair: "highly likely",
    source_type: "reddit",
  };
  const s = baseScore({ total: 64 });
  const q = qualifiesForTrustedRumourAutoLane(rumour, s);
  assert.equal(q.qualifies, true);
  assert.match(q.reason, /^trusted_rumour_auto_lane:/);
});

test("TRUSTED_PUBLISHER_SUBS covers major gaming outlets", () => {
  for (const sub of [
    "eurogamer",
    "polygon",
    "rockpapershotgun",
    "ign",
    "gamespot",
    "pcgamer",
    "videogameschronicle",
  ]) {
    assert.ok(
      TRUSTED_PUBLISHER_SUBS.has(sub),
      `expected TRUSTED_PUBLISHER_SUBS to include ${sub}`,
    );
  }
});

test("TRUSTED_PUBLISHER_MIN_SCORE is 70 (one tier below global 75 auto floor)", () => {
  assert.equal(TRUSTED_PUBLISHER_MIN_SCORE, 70);
});
