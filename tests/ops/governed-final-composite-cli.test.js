"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
  usage,
} = require("../../tools/governed-final-composite");

const REQUIRED_ARGS = [
  "--story-intake",
  "story-intake.json",
  "--owned-motion-manifest",
  "owned-motion-manifest.json",
  "--video",
  "hyperframes.mp4",
  "--audio",
  "narration.mp3",
  "--narration-manifest",
  "governed-narration-manifest.json",
  "--narration-manifest-sha256",
  "b".repeat(64),
  "--timestamps",
  "timestamps.json",
  "--out-dir",
  "output/final-composite",
  "--hyperframes-project-file",
  "videos/evercold/index.html",
  "--hyperframes-project-file",
  "videos/evercold/hyperframes.json",
];
const SOURCE_MEDIA_ARGS = [
  "--source-media-manifest",
  "source-media-manifest.json",
  "--source-media-manifest-sha256",
  "c".repeat(64),
];

test("parseArgs accepts only explicit LOCAL_PROOF composite inputs", () => {
  const args = parseArgs([
    ...REQUIRED_ARGS,
    "--generated-at",
    "2026-07-27T17:00:00.000Z",
  ]);
  assert.equal(args.storyIntakePath, "story-intake.json");
  assert.equal(
    args.ownedMotionManifestPath,
    "owned-motion-manifest.json",
  );
  assert.equal(args.videoPath, "hyperframes.mp4");
  assert.equal(args.audioPath, "narration.mp3");
  assert.equal(
    args.narrationManifestPath,
    "governed-narration-manifest.json",
  );
  assert.equal(
    args.expectedNarrationManifestSha256,
    "b".repeat(64),
  );
  assert.equal(args.timestampsPath, "timestamps.json");
  assert.equal(args.outDir, "output/final-composite");
  assert.deepEqual(args.hyperframesProjectFiles, [
    "videos/evercold/index.html",
    "videos/evercold/hyperframes.json",
  ]);
  assert.equal(args.generatedAt, "2026-07-27T17:00:00.000Z");
});

test("parseArgs accepts an exact optional governed source-media manifest pair", () => {
  const args = parseArgs([
    ...REQUIRED_ARGS,
    ...SOURCE_MEDIA_ARGS,
  ]);
  assert.equal(
    args.sourceMediaManifestPath,
    "source-media-manifest.json",
  );
  assert.equal(
    args.expectedSourceMediaManifestSha256,
    "c".repeat(64),
  );
});

test("parseArgs rejects publish, apply, DB and unknown flags", () => {
  for (const flag of [
    "--publish",
    "--apply",
    "--database",
    "--oauth",
    "--live",
    "--auto-publish",
    "--unexpected",
  ]) {
    assert.throws(
      () => parseArgs([...REQUIRED_ARGS, flag]),
      new RegExp(`forbidden_argument:${flag}|unknown_argument:${flag}`),
    );
  }
});

test("main resolves all paths and delegates one LOCAL_PROOF render", async () => {
  let received = null;
  let stdout = "";
  const result = await main(REQUIRED_ARGS, {
    stdout: { write: (value) => (stdout += value) },
    async execute(options) {
      received = options;
      return {
        schema_version: "pulse-governed-final-composite-result-v1",
        mode: "LOCAL_PROOF",
        verdict: "MATERIALIZED_LOCAL_PROOF",
        story_id: "official_d86953ca92ca",
        publish_authorised: false,
      };
    },
  });
  assert.equal(path.isAbsolute(received.storyIntakePath), true);
  assert.equal(path.isAbsolute(received.ownedMotionManifestPath), true);
  assert.equal(path.isAbsolute(received.videoPath), true);
  assert.equal(path.isAbsolute(received.audioPath), true);
  assert.equal(
    path.isAbsolute(received.narrationManifestPath),
    true,
  );
  assert.equal(
    received.expectedNarrationManifestSha256,
    "b".repeat(64),
  );
  assert.equal(path.isAbsolute(received.timestampsPath), true);
  assert.equal(path.isAbsolute(received.outDir), true);
  assert.equal(
    received.hyperframesProjectFiles.every(path.isAbsolute),
    true,
  );
  assert.equal(result.verdict, "MATERIALIZED_LOCAL_PROOF");
  assert.equal(JSON.parse(stdout).publish_authorised, false);
});

test("main resolves and delegates the exact optional source-media manifest pair", async () => {
  let received = null;
  await main([...REQUIRED_ARGS, ...SOURCE_MEDIA_ARGS], {
    stdout: { write() {} },
    async execute(options) {
      received = options;
      return {
        schema_version:
          "pulse-governed-final-composite-result-v1",
        mode: "LOCAL_PROOF",
        verdict: "MATERIALIZED_LOCAL_PROOF",
        publish_authorised: false,
      };
    },
  });
  assert.equal(
    path.isAbsolute(received.sourceMediaManifestPath),
    true,
  );
  assert.equal(
    received.expectedSourceMediaManifestSha256,
    "c".repeat(64),
  );
});

test("main requires every governed input before invoking the service", async () => {
  let invoked = false;
  const withoutOutDir = [];
  for (let index = 0; index < REQUIRED_ARGS.length; index += 1) {
    if (REQUIRED_ARGS[index] === "--out-dir") {
      index += 1;
      continue;
    }
    withoutOutDir.push(REQUIRED_ARGS[index]);
  }
  await assert.rejects(
    main(withoutOutDir, {
      stdout: { write() {} },
      async execute() {
        invoked = true;
      },
    }),
    /out_dir_required/,
  );
  assert.equal(invoked, false);
});

test("main requires the governed narration manifest before invoking the service", async () => {
  let invoked = false;
  const withoutNarrationManifest = [];
  for (let index = 0; index < REQUIRED_ARGS.length; index += 1) {
    if (REQUIRED_ARGS[index] === "--narration-manifest") {
      index += 1;
      continue;
    }
    withoutNarrationManifest.push(REQUIRED_ARGS[index]);
  }
  await assert.rejects(
    main(withoutNarrationManifest, {
      stdout: { write() {} },
      async execute() {
        invoked = true;
      },
    }),
    /narration_manifest_required/,
  );
  assert.equal(invoked, false);
});

test("main requires an independent governed narration manifest SHA-256", async () => {
  let invoked = false;
  const withoutManifestSha = [];
  for (let index = 0; index < REQUIRED_ARGS.length; index += 1) {
    if (
      REQUIRED_ARGS[index] ===
      "--narration-manifest-sha256"
    ) {
      index += 1;
      continue;
    }
    withoutManifestSha.push(REQUIRED_ARGS[index]);
  }
  await assert.rejects(
    main(withoutManifestSha, {
      stdout: { write() {} },
      async execute() {
        invoked = true;
      },
    }),
    /narration_manifest_sha256_required/,
  );
  assert.equal(invoked, false);
});

test("main requires source-media manifest and independent SHA-256 together", async () => {
  for (const [extraArgs, expectedError] of [
    [
      ["--source-media-manifest", "source-media-manifest.json"],
      /source_media_manifest_sha256_required/,
    ],
    [
      [
        "--source-media-manifest-sha256",
        "c".repeat(64),
      ],
      /source_media_manifest_path_required/,
    ],
  ]) {
    let invoked = false;
    await assert.rejects(
      main([...REQUIRED_ARGS, ...extraArgs], {
        stdout: { write() {} },
        async execute() {
          invoked = true;
        },
      }),
      expectedError,
    );
    assert.equal(invoked, false);
  }
});

test("main rejects an invalid independent source-media manifest SHA-256", async () => {
  let invoked = false;
  await assert.rejects(
    main(
      [
        ...REQUIRED_ARGS,
        "--source-media-manifest",
        "source-media-manifest.json",
        "--source-media-manifest-sha256",
        "not-a-sha",
      ],
      {
        stdout: { write() {} },
        async execute() {
          invoked = true;
        },
      },
    ),
    /source_media_manifest_sha256_invalid/,
  );
  assert.equal(invoked, false);
});

test("usage makes the no-publish LOCAL_PROOF boundary explicit", () => {
  const text = usage();
  assert.match(text, /LOCAL_PROOF/);
  assert.match(text, /never.*database/i);
  assert.match(text, /never.*publish/i);
  assert.match(text, /HyperFrames/i);
  assert.match(text, /studio-v21/i);
});

test("CLI implementation has no DB, OAuth, publisher or network boundary", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "tools",
      "governed-final-composite.js",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /require\([^)]*(?:db|oauth|publisher|upload_)/i,
  );
  assert.doesNotMatch(source, /\b(?:fetch|axios|https?\.request)\s*\(/i);
});
