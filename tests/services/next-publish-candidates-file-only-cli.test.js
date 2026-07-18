"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const { parseArgs } = require("../../tools/next-publish-candidates");
const { canonicalHash } = require("../../lib/services/url-canonical");

const ROOT = path.resolve(__dirname, "../..");
const CORE_PLATFORMS = ["youtube_shorts", "instagram_reels", "facebook_reels"];

async function writeForbiddenSideEffectTripwire(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-file-only-tripwire-"));
  t.after(() => fs.remove(tempDir));
  const preloadPath = path.join(tempDir, "forbid-live-side-effects.cjs");
  await fs.writeFile(
    preloadPath,
    [
      'const Module = require("node:module");',
      'const fs = require("node:fs");',
      'const http = require("node:http");',
      'const https = require("node:https");',
      "const forbiddenPath = (value) => typeof value === \"string\" && /(?:^|[\\\\/])tokens[\\\\/]|(?:^|[\\\\/])\\.env(?:$|[.])/i.test(value);",
      "for (const method of [\"readFile\", \"readFileSync\", \"writeFile\", \"writeFileSync\", \"open\", \"openSync\"]) {",
      "  const original = fs[method];",
      "  fs[method] = function guardedFileAccess(filePath) {",
      "    if (forbiddenPath(filePath)) throw new Error(`forbidden_secret_file_access:${filePath}`);",
      "    return original.apply(this, arguments);",
      "  };",
      "}",
      "for (const method of [\"readFile\", \"writeFile\", \"open\"]) {",
      "  const original = fs.promises[method];",
      "  fs.promises[method] = function guardedPromiseFileAccess(filePath) {",
      "    if (forbiddenPath(filePath)) throw new Error(`forbidden_secret_file_access:${filePath}`);",
      "    return original.apply(this, arguments);",
      "  };",
      "}",
      "const guardRequest = (original) => function guardedRequest(input, options) {",
      "  const requestOptions = typeof input === \"object\" && input && !Array.isArray(input) ? input : options;",
      "  const method = String(requestOptions?.method || \"GET\").toUpperCase();",
      "  if (!['GET', 'HEAD'].includes(method)) throw new Error(`forbidden_network_write:${method}`);",
      "  return original.apply(this, arguments);",
      "};",
      "http.request = guardRequest(http.request);",
      "https.request = guardRequest(https.request);",
      "if (typeof globalThis.fetch === \"function\") {",
      "  const originalFetch = globalThis.fetch;",
      "  globalThis.fetch = function guardedFetch(input, options) {",
      "    const method = String(options?.method || input?.method || \"GET\").toUpperCase();",
      "    if (!['GET', 'HEAD'].includes(method)) throw new Error(`forbidden_network_write:${method}`);",
      "    return originalFetch.apply(this, arguments);",
      "  };",
      "}",
      "const originalLoad = Module._load;",
      "Module._load = function guardedLoad(request) {",
      "  const value = String(request || \"\");",
      "  if (value === \"dotenv\" || value === \"better-sqlite3\" || /(^|[\\\\/])lib[\\\\/]db$/.test(value) || /(^|[\\\\/])publisher(?:\\.js)?$/i.test(value) || /(^|[\\\\/])upload_[^\\\\/]+(?:\\.js)?$/i.test(value) || /(^|[\\\\/])oauth(?:[\\\\/]|$)/i.test(value)) {",
      "    throw new Error(`forbidden_live_module_loaded:${value}`);",
      "  }",
      "  return originalLoad.apply(this, arguments);",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  return preloadPath;
}

function spawnCli(args, preloadPath, envOverrides = {}) {
  const nodeOptions = [process.env.NODE_OPTIONS, `--require=${preloadPath}`]
    .filter(Boolean)
    .join(" ");
  return spawnSync(process.execPath, ["tools/next-publish-candidates.js", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...envOverrides, NODE_OPTIONS: nodeOptions },
    encoding: "utf8",
  });
}

function bridgeStory(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "file-only-story",
    title: "Nintendo Confirms A Switch 2 Gameplay Change",
    approved: true,
    auto_approved: false,
    exported_path: "output/final/file-only-story.mp4",
    duration_seconds: 66,
    breaking_score: 75,
    publish_status: null,
    canonical_subject: "Nintendo Switch 2",
    first_spoken_line: "Nintendo just confirmed a Switch 2 gameplay change.",
    description: "Nintendo confirmed the Switch 2 change. Source: Nintendo.",
    full_script:
      "Nintendo just confirmed a Switch 2 gameplay change. The update changes how players approach the new release and gives buyers a concrete reason to check the official announcement.",
    timestamp: now,
    created_at: now,
    ...overrides,
  };
}

function publicationSnapshot(story, overrides = {}) {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: "test_read_only_publication_snapshot",
    scope: {
      story_ids: [story.id],
      platforms: CORE_PLATFORMS,
    },
    by_story_id: {},
    by_source_url_hash: {},
    ...overrides,
  };
}

async function setupFixture(t, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-file-only-"));
  t.after(() => fs.remove(tempDir));
  const story = options.story || bridgeStory();
  const bridgePath = path.join(tempDir, "scheduler_bridge_candidates.json");
  const snapshotPath = path.join(tempDir, "publication-evidence.json");
  if (options.writeBridge !== false) {
    await fs.writeJson(
      bridgePath,
      options.bridgeValue === undefined ? { candidates: [story] } : options.bridgeValue,
    );
  }
  if (options.snapshotRaw != null) {
    await fs.writeFile(snapshotPath, options.snapshotRaw, "utf8");
  } else if (options.writeSnapshot !== false) {
    await fs.writeJson(
      snapshotPath,
      options.snapshot === undefined ? publicationSnapshot(story) : options.snapshot,
    );
  }
  return {
    story,
    bridgePath,
    snapshotPath,
    outDir: path.join(tempDir, "report"),
  };
}

function runFixture(fixture, preloadPath, { extraArgs = [], env = {} } = {}) {
  return spawnCli(
    [
      "--file-only",
      "--publication-evidence",
      fixture.snapshotPath,
      "--bridge",
      fixture.bridgePath,
      "--out-dir",
      fixture.outDir,
      "--no-direct-video-work-order",
      "--no-source-family-acquisition",
      "--no-goal10-report",
      "--no-goal20-report",
      ...extraArgs,
      "--json",
    ],
    preloadPath,
    env,
  );
}

function assertSafeFailure(result, errorPattern) {
  assert.equal(result.status, 1);
  assert.match(result.stderr, errorPattern);
  assert.doesNotMatch(
    result.stderr,
    /forbidden_(?:live_module_loaded|secret_file_access|network_write)/,
  );
  assert.equal(result.stdout, "");
}

test("next publish CLI parses the explicit file-only publication evidence contract", () => {
  const args = parseArgs([
    "node",
    "tools/next-publish-candidates.js",
    "--file-only",
    "--publication-evidence",
    "publication-evidence.json",
  ]);

  assert.equal(args.fileOnly, true);
  assert.equal(args.publicationEvidencePath, "publication-evidence.json");
  assert.equal(args.publicationEvidenceMaxAgeHours, 24);
});

test("file-only CLI fails for absent publication evidence before loading dotenv or SQLite", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  assertSafeFailure(
    spawnCli(["--file-only", "--json"], preloadPath),
    /file_only_publication_evidence_required/,
  );
});

test("file-only CLI fails closed when the publication evidence snapshot is missing", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const fixture = await setupFixture(t, { writeSnapshot: false });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_missing/,
  );
});

test("file-only CLI fails closed when the publication evidence snapshot is malformed JSON", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const fixture = await setupFixture(t, { snapshotRaw: "{not-json" });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_malformed/,
  );
});

test("file-only CLI fails closed when the publication evidence snapshot is stale", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    }),
  });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_stale/,
  );
});

test("file-only CLI rejects publication evidence without story and platform coverage identity", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  const fixture = await setupFixture(t, {
    story,
    snapshot: {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      by_story_id: {},
      by_source_url_hash: {},
    },
  });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_identity_missing/,
  );
});

test("file-only CLI rejects publication evidence without explicit duplicate indexes", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  const fixture = await setupFixture(t, {
    story,
    snapshot: {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      scope: { story_ids: [story.id], platforms: CORE_PLATFORMS },
    },
  });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_malformed:by_story_id_required/,
  );
});

test("file-only CLI uses publication evidence without SQLite and preserves partial-platform idempotency", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      by_story_id: {
        [story.id]: {
          already_published_platforms: ["youtube_shorts"],
          rows: [{
            story_id: story.id,
            title: story.title,
            platform: "youtube_shorts",
            external_id: "yt-file-only-123",
          }],
        },
      },
    }),
  });

  const result = runFixture(fixture, preloadPath, { extraArgs: ["--preflight-qa"] });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.candidates.map((candidate) => candidate.id), [story.id]);
  assert.deepEqual(report.candidates[0].source.already_published_platforms, ["youtube_shorts"]);
  assert.deepEqual(report.candidates[0].source.missing_enabled_platforms, [
    "instagram_reels",
    "facebook_reels",
  ]);
  assert.ok(report.candidates[0].preflight_qa);
  assert.deepEqual(
    {
      mode: report.safety.mode,
      dotenv_loaded: report.safety.dotenv_loaded,
      database_loaded: report.safety.database_loaded,
      sqlite_opened: report.safety.sqlite_opened,
      db_read: report.safety.db_read,
      db_mutation: report.safety.db_mutation,
      publish_attempted: report.safety.publish_attempted,
      posting: report.safety.posting,
      oauth_attempted: report.safety.oauth_attempted,
      token_read: report.safety.token_read,
      token_mutation: report.safety.token_mutation,
      network_write_attempted: report.safety.network_write_attempted,
    },
    {
      mode: "file_only",
      dotenv_loaded: false,
      database_loaded: false,
      sqlite_opened: false,
      db_read: false,
      db_mutation: false,
      publish_attempted: false,
      posting: false,
      oauth_attempted: false,
      token_read: false,
      token_mutation: false,
      network_write_attempted: false,
    },
  );
  assert.equal(report.publication_evidence.status, "validated");
  assert.equal(report.publication_evidence.authoritative, true);
  assert.deepEqual(report.publication_evidence.covered_story_ids, [story.id]);
  assert.deepEqual(report.publication_evidence.covered_platforms, CORE_PLATFORMS);
  assert.equal(report.publication_evidence.record_count, 1);
});

test("file-only CLI rejects publication evidence that does not cover the bridge story identity", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      scope: { story_ids: ["different-story"], platforms: CORE_PLATFORMS },
    }),
  });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_story_coverage_missing:file-only-story/,
  );
});

test("file-only CLI rejects publication evidence that omits enabled platform coverage", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      scope: { story_ids: [story.id], platforms: ["youtube_shorts"] },
    }),
  });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_platform_coverage_missing:instagram_reels,facebook_reels/,
  );
});

test("file-only CLI fails closed when the bridge candidate snapshot is missing", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const fixture = await setupFixture(t, { writeBridge: false });
  assertSafeFailure(runFixture(fixture, preloadPath), /file_only_bridge_snapshot_missing/);
});

test("file-only CLI fails closed when the bridge candidate snapshot shape is malformed", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const fixture = await setupFixture(t, { bridgeValue: { not_candidates: [] } });
  assertSafeFailure(runFixture(fixture, preloadPath), /file_only_bridge_snapshot_malformed/);
});

test("file-only CLI rejects bridge candidates without story identity", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  delete story.id;
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot({ id: "file-only-story" }),
  });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /file_only_bridge_story_identity_missing:index=0/,
  );
});

test("file-only CLI rejects publication records without platform identity", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      by_story_id: {
        [story.id]: { rows: [{ story_id: story.id, external_id: "yt-missing-platform" }] },
      },
    }),
  });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_record_identity_missing:platform:by_story_id:file-only-story:0/,
  );
});

test("file-only CLI rejects publication records with mismatched story identity", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      by_story_id: {
        [story.id]: {
          already_published_platforms: ["youtube_shorts"],
          rows: [{
            story_id: "different-story",
            platform: "youtube_shorts",
            external_id: "yt-wrong-story",
          }],
        },
      },
    }),
  });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_record_identity_mismatch:story:by_story_id:file-only-story:0/,
  );
});

test("file-only CLI preserves source-hash duplicate quarantine from publication evidence", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const sourceUrl = "https://news.xbox.com/2026/07/doom-chain-spear-update/?utm_source=test";
  const story = bridgeStory({
    id: "regenerated-doom-story",
    title: "DOOM The Dark Ages Chain Spear Changes The Fight",
    canonical_subject: "DOOM: The Dark Ages",
    url: sourceUrl,
  });
  const sourceHash = canonicalHash(sourceUrl);
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      by_source_url_hash: {
        [sourceHash]: {
          source_url_hash: sourceHash,
          already_published_platforms: CORE_PLATFORMS,
          rows: CORE_PLATFORMS.map((platform) => ({
            story_id: "original-doom-story",
            title: story.title,
            platform,
            external_id: `${platform}-source-hash-id`,
          })),
        },
      },
    }),
  });

  const result = runFixture(fixture, preloadPath);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.candidates, []);
  assert.equal(report.excluded[0].id, story.id);
  assert.match(report.excluded[0].reason, /^already_has_public_platform_id:/);
  assert.equal(report.repeat_quarantine.already_public_bridge_candidates, 1);
});

test("file-only CLI preserves near-repeat quarantine from publication evidence", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory({
    id: "fresh-doom-repeat",
    title: "DOOM The Dark Ages Chain Spear Has A Fight Risk",
    canonical_subject: "DOOM: The Dark Ages",
    first_spoken_line: "DOOM The Dark Ages has a Chain Spear fight risk.",
    full_script:
      "DOOM The Dark Ages has a Chain Spear fight risk. The Chain Spear change makes the same combat debate matter again.",
  });
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      by_story_id: {
        "older-doom-live": {
          story_id: "older-doom-live",
          already_published_platforms: CORE_PLATFORMS,
          rows: [{
            story_id: "older-doom-live",
            title: "Doom The Dark Ages Chain Spear Changes The Fight",
            canonical_subject: "DOOM: The Dark Ages",
            full_script:
              "DOOM The Dark Ages just changed the Chain Spear fight. The update changes how players approach the weapon.",
            platform: "youtube_shorts",
            external_id: "yt-older-doom",
          }],
        },
      },
    }),
  });

  const result = runFixture(fixture, preloadPath);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.candidates, []);
  assert.equal(report.excluded[0].id, story.id);
  assert.match(report.excluded[0].reason, /^near_repeat_story_cluster:/);
  assert.equal(report.repeat_quarantine.near_repeat_bridge_candidates, 1);
});

test("file-only CLI preserves terminal duplicate-blocked platform checks", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory({
    id: "terminal-duplicate-story",
    youtube_error: "duplicate_blocked: Similar to existing upload",
  });
  const publishedPlatforms = ["instagram_reels", "facebook_reels"];
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      by_story_id: {
        [story.id]: {
          story_id: story.id,
          already_published_platforms: publishedPlatforms,
          rows: publishedPlatforms.map((platform) => ({
            story_id: story.id,
            platform,
            external_id: `${platform}-terminal-dupe-id`,
          })),
        },
      },
    }),
  });

  const result = runFixture(fixture, preloadPath);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.candidates, []);
  assert.match(
    report.excluded[0].reason,
    /^enabled_platforms_already_public_or_terminal_duplicate:/,
  );
  assert.match(report.excluded[0].reason, /youtube_shorts:duplicate_blocked/);
});

test("file-only CLI rejects live fallback", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const fixture = await setupFixture(t);
  assertSafeFailure(
    runFixture(fixture, preloadPath, { extraArgs: ["--allow-live-fallback"] }),
    /file_only_live_fallback_forbidden/,
  );
});

test("file-only CLI rejects unsupported publication evidence schemas", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory();
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, { schema_version: 99 }),
  });
  assertSafeFailure(
    runFixture(fixture, preloadPath),
    /publication_evidence_snapshot_schema_unsupported:99/,
  );
});

test("file-only CLI preserves idempotency for an explicitly enabled TikTok lane", async (t) => {
  const preloadPath = await writeForbiddenSideEffectTripwire(t);
  const story = bridgeStory({ id: "file-only-tiktok-story" });
  const platforms = [
    "youtube_shorts",
    "tiktok",
    "instagram_reels",
    "facebook_reels",
  ];
  const fixture = await setupFixture(t, {
    story,
    snapshot: publicationSnapshot(story, {
      scope: { story_ids: [story.id], platforms },
      by_story_id: {
        [story.id]: {
          story_id: story.id,
          already_published_platforms: platforms,
          rows: platforms.map((platform) => ({
            story_id: story.id,
            platform,
            external_id: `${platform}-published-id`,
          })),
        },
      },
    }),
  });

  const result = runFixture(fixture, preloadPath, {
    env: {
      TIKTOK_ENABLED: "true",
      TIKTOK_AUTO_UPLOAD_ENABLED: "true",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.candidates, []);
  assert.match(report.excluded[0].reason, /tiktok_post_id/);
});
