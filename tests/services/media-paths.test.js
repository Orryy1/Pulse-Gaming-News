/**
 * tests/services/media-paths.test.js
 *
 * Pins the MEDIA_ROOT resolver contract (2026-04-22).
 *
 * Context: SQLite lives on /data/pulse.db (persistent on Railway),
 * but generated media has always lived under `output/...` which
 * is `/app/output/...` in the container — ephemeral. Every
 * redeploy wiped the MP4s while the story row survived, which is
 * how today's 09:00 and 14:00 publish windows both hit
 * `exported_mp4_not_on_disk`.
 *
 * Fix: a thin resolver in lib/media-paths.js. DB keeps storing the
 * same repo-relative paths it always has; writers and readers
 * route those through the resolver, which respects `MEDIA_ROOT`
 * when set and falls back to the repo root otherwise. No schema
 * change. No migration.
 *
 * Non-goals of these tests:
 *   - Exercising the real filesystem heavily (we stub fs where it
 *     matters so we don't fight CWD / Windows-vs-POSIX quirks in
 *     CI).
 *   - Exercising actual ffmpeg/Sharp/Railway. Those would make
 *     this suite flaky.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Clean import per test — MEDIA_ROOT is read on every call so we
// don't need to re-require, but we still reset it between tests.
const mediaPaths = require("../../lib/media-paths");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ---------- helpers: a sync stub fs for tests that don't touch disk ----

function stubFs(existingAbsPaths) {
  const set = new Set(existingAbsPaths.map((p) => path.resolve(p)));
  return {
    async pathExists(p) {
      return set.has(path.resolve(p));
    },
    existsSync(p) {
      return set.has(path.resolve(p));
    },
  };
}

// Reset MEDIA_ROOT before each test so nothing leaks. Tests that
// need it set do so inline.
test.beforeEach(() => {
  delete process.env.MEDIA_ROOT;
});

// --------------------------------------------------------------------
// Task 6 coverage — 10 cases the brief calls out, plus a handful
// of safety checks (path traversal, NUL, absolute-path passthrough).
// --------------------------------------------------------------------

test("1. writePath defaults to REPO_ROOT when MEDIA_ROOT is unset (local dev unchanged)", () => {
  delete process.env.MEDIA_ROOT;
  const out = mediaPaths.writePath("output/final/abc.mp4");
  assert.equal(out, path.resolve(REPO_ROOT, "output/final/abc.mp4"));
});

test("2. writePath lands under MEDIA_ROOT when set", () => {
  process.env.MEDIA_ROOT = "/data/media";
  const out = mediaPaths.writePath("output/final/abc.mp4");
  assert.equal(out, path.resolve("/data/media", "output/final/abc.mp4"));
});

test("3. story card path uses MEDIA_ROOT when set", () => {
  process.env.MEDIA_ROOT = "/data/media";
  const out = mediaPaths.writePath("output/stories/abc_story.png");
  assert.equal(
    out,
    path.resolve("/data/media", "output/stories/abc_story.png"),
  );
});

test("4. old stored 'output/final/foo.mp4' resolves under MEDIA_ROOT when the file exists there", async () => {
  process.env.MEDIA_ROOT = "/data/media";
  const fs = stubFs([path.resolve("/data/media", "output/final/foo.mp4")]);
  const out = await mediaPaths.resolveExisting("output/final/foo.mp4", { fs });
  assert.equal(out, path.resolve("/data/media", "output/final/foo.mp4"));
});

test("4b. old stored path falls back to REPO_ROOT when file is only on legacy location", async () => {
  process.env.MEDIA_ROOT = "/data/media";
  // File only exists on the legacy repo-root tree — resolver must
  // still find it (backwards-compat guarantee).
  const fs = stubFs([path.resolve(REPO_ROOT, "output/final/legacy.mp4")]);
  const out = await mediaPaths.resolveExisting("output/final/legacy.mp4", {
    fs,
  });
  assert.equal(out, path.resolve(REPO_ROOT, "output/final/legacy.mp4"));
});

test("5. path traversal is rejected (writePath throws, resolution returns empty set)", () => {
  process.env.MEDIA_ROOT = "/data/media";
  assert.throws(() => mediaPaths.writePath("../etc/passwd"), /refused/);
  assert.throws(
    () => mediaPaths.writePath("output/../../../etc/passwd"),
    /refused/,
  );

  // Candidates list stays empty so resolveExisting returns null.
  const candidates = mediaPaths._resolutionCandidates("../etc/passwd");
  assert.equal(candidates.length, 0);
});

test("5b. NUL byte inputs are rejected", () => {
  assert.throws(
    () => mediaPaths.writePath("output/final/abc\u0000.mp4"),
    /refused/,
  );
  assert.equal(
    mediaPaths._resolutionCandidates("output/final/abc\u0000.mp4").length,
    0,
  );
});

test("5c. empty string / non-string inputs are rejected", () => {
  assert.throws(() => mediaPaths.writePath(""), /refused/);
  assert.throws(() => mediaPaths.writePath(null), /refused/);
  assert.throws(() => mediaPaths.writePath(undefined), /refused/);
});

test("6. pathExists returns true when the file lives under MEDIA_ROOT", async () => {
  process.env.MEDIA_ROOT = "/data/media";
  const fs = stubFs([path.resolve("/data/media", "output/final/ok.mp4")]);
  const exists = await mediaPaths.pathExists("output/final/ok.mp4", { fs });
  assert.equal(exists, true);
});

test("7. pathExists returns false when neither root has the file", async () => {
  process.env.MEDIA_ROOT = "/data/media";
  const fs = stubFs([]); // nothing on disk in either location
  const exists = await mediaPaths.pathExists("output/final/missing.mp4", {
    fs,
  });
  assert.equal(exists, false);
});

test("7b. resolveExisting returns the preferred write path when nothing exists (so caller gets a clean 404 via pathExists)", async () => {
  process.env.MEDIA_ROOT = "/data/media";
  const fs = stubFs([]);
  const out = await mediaPaths.resolveExisting("output/final/ghost.mp4", {
    fs,
  });
  // First candidate is MEDIA_ROOT-resolved when MEDIA_ROOT is set.
  assert.equal(out, path.resolve("/data/media", "output/final/ghost.mp4"));
});

test("8. /api/download:id shape — resolveExisting + pathExists handles absent file cleanly", async () => {
  // Unit-level pin on the path the server route now takes. Full
  // HTTP coverage lives in server tests; here we just prove the
  // combined call returns a stable absolute path that the route
  // can then existsSync on.
  process.env.MEDIA_ROOT = "/data/media";
  const fs = stubFs([path.resolve("/data/media", "output/final/x.mp4")]);
  const resolved = await mediaPaths.resolveExisting("output/final/x.mp4", {
    fs,
  });
  assert.equal(path.isAbsolute(resolved), true);
  assert.ok(
    resolved.includes("/data/media") || resolved.includes("\\data\\media"),
  );
});

test("9. /api/story-image/:id shape — story card under MEDIA_ROOT resolves and exists", async () => {
  process.env.MEDIA_ROOT = "/data/media";
  const fs = stubFs([
    path.resolve("/data/media", "output/stories/abc_story.png"),
  ]);
  const resolved = await mediaPaths.resolveExisting(
    "output/stories/abc_story.png",
    { fs },
  );
  assert.equal(
    resolved,
    path.resolve("/data/media", "output/stories/abc_story.png"),
  );
  assert.equal(await fs.pathExists(resolved), true);
});

test("10. local dev behaviour unchanged when MEDIA_ROOT is unset", async () => {
  delete process.env.MEDIA_ROOT;
  const fs = stubFs([path.resolve(REPO_ROOT, "output/final/local.mp4")]);
  const out = await mediaPaths.resolveExisting("output/final/local.mp4", {
    fs,
  });
  assert.equal(out, path.resolve(REPO_ROOT, "output/final/local.mp4"));
  // And writePath uses the repo root for new writes.
  assert.equal(
    mediaPaths.writePath("output/final/new.mp4"),
    path.resolve(REPO_ROOT, "output/final/new.mp4"),
  );
});

// ---------- absolute-path passthrough (legacy DB rows) ----------

test("absolute paths pass through unchanged (legacy DB rows with absolute strings still work)", async () => {
  process.env.MEDIA_ROOT = "/data/media";
  const abs = path.resolve("/data/media", "output/final/already_abs.mp4");
  const fs = stubFs([abs]);
  const out = await mediaPaths.resolveExisting(abs, { fs });
  assert.equal(out, abs);
});

// ---------- getMediaRoot edge cases ----------

test("getMediaRoot returns null when MEDIA_ROOT is unset, blank, or whitespace", () => {
  delete process.env.MEDIA_ROOT;
  assert.equal(mediaPaths.getMediaRoot(), null);

  process.env.MEDIA_ROOT = "";
  assert.equal(mediaPaths.getMediaRoot(), null);

  process.env.MEDIA_ROOT = "   ";
  assert.equal(mediaPaths.getMediaRoot(), null);
});

test("getMediaRoot returns an absolute resolved path when set", () => {
  process.env.MEDIA_ROOT = "/data/media";
  assert.equal(mediaPaths.getMediaRoot(), path.resolve("/data/media"));
});

// ---------- content-qa integration: QA sees persistent MP4 as valid --

test("content-qa: existing persistent MP4 under MEDIA_ROOT passes the on-disk check", async () => {
  process.env.MEDIA_ROOT = "/data/media";
  const { runContentQa } = require("../../lib/services/content-qa");
  const mp4 = "output/final/fresh.mp4";
  const absMp4 = path.resolve("/data/media", mp4);

  // Stub fs so the file "exists" at the MEDIA_ROOT location with
  // a healthy size. content-qa resolves the MP4 path via media-
  // paths internally, so the check should pass.
  const fakeFs = {
    async pathExists(p) {
      return path.resolve(p) === absMp4;
    },
    async stat(p) {
      if (path.resolve(p) !== absMp4) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return { size: 5 * 1024 * 1024 };
    },
  };

  const qa = await runContentQa(
    {
      id: "test_persist",
      title: "Persistent MP4 story",
      exported_path: mp4,
      full_script:
        "A fully-formed Pulse Gaming script that easily clears the " +
        "80-word minimum. Lorem ipsum dolor sit amet, consectetur " +
        "adipiscing elit. The reveal landed at midday across every " +
        "territory. Sources have verified the timeline through two " +
        "separate trade outlets and an internal calendar invite that " +
        "leaked last week. Players are already speculating about what " +
        "this means for the series going forward and the marketing " +
        "team is quietly scrubbing old posts in preparation. Follow " +
        "Pulse Gaming so you never miss a drop, because this one " +
        "moves fast and the window is closing quickly now.",
      downloaded_images: [
        { path: "output/image_cache/hero.jpg", type: "article_hero" },
      ],
    },
    { fs: fakeFs },
  );

  assert.equal(qa.result, "pass", `expected pass, got: ${JSON.stringify(qa)}`);
});

test("content-qa: missing MP4 in BOTH locations still fails cleanly (no regression)", async () => {
  process.env.MEDIA_ROOT = "/data/media";
  const { runContentQa } = require("../../lib/services/content-qa");

  const fakeFs = {
    async pathExists() {
      return false;
    },
    async stat() {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  };

  const qa = await runContentQa(
    {
      id: "test_ghost",
      title: "Ghost MP4",
      exported_path: "output/final/ghost.mp4",
      full_script: "x".repeat(500) + " words words words",
    },
    { fs: fakeFs },
  );

  assert.equal(qa.result, "fail");
  assert.ok(qa.failures.includes("exported_mp4_not_on_disk"));
});
