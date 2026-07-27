"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { canonicalHash } = require("../../lib/services/url-canonical");
const {
  scriptSha256,
  validateOwnedAssetManifest,
} = require("../../lib/services/governed-story-intake");
const {
  main,
  parseArgs,
} = require("../../tools/governed-owned-motion");

const SOURCE_URL =
  "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947";
const SCRIPT =
  "Delta Force just widened cheater compensation to cover thirty-day bans. Previously, victims qualified only after a ten-year ban. The official update says in-game mail should arrive within three business days of confirmation. But if a squadmate extracted and returned your gear, you cannot claim twice.";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-owned-cli-"));
  const claims = [
    "Thirty-day bans now qualify victims for compensation.",
    "Compensation mail should arrive within three business days.",
    "Gear returned by a squadmate cannot be claimed twice.",
  ];
  const sourceEvidencePath = path.join(root, "source-evidence.json");
  writeJson(sourceEvidencePath, {
    schema_version: "pulse-source-evidence-v1",
    source_url: SOURCE_URL,
    source_type: "official",
    published_at: "2026-07-27T09:15:34.000Z",
    claims,
  });
  const storyId = `official_${canonicalHash(SOURCE_URL)}`;
  const manifestPath = path.join(root, "story-intake.json");
  writeJson(manifestPath, {
    schema_version: "pulse-governed-story-intake-v1",
    source_url: SOURCE_URL,
    source_type: "official",
    source_evidence_path: "source-evidence.json",
    source_evidence_sha256: sha256(fs.readFileSync(sourceEvidencePath)),
    published_at: "2026-07-27T09:15:34.000Z",
    claims,
    story: {
      id: storyId,
      title: "Delta Force widens cheater compensation",
      hook: "Delta Force just widened cheater compensation.",
      full_script: SCRIPT,
      script_sha256: scriptSha256(SCRIPT),
    },
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
    },
  });
  return {
    root,
    storyId,
    manifestPath,
    manifestSha256: sha256(fs.readFileSync(manifestPath)),
    outputDir: path.join(root, "owned-output"),
  };
}

test("parseArgs keeps governed owned-motion materialisation dry-run by default", () => {
  const args = parseArgs([
    "--story-manifest",
    "story.json",
    "--out-dir",
    "proof",
  ]);
  assert.equal(args.applyRequested, false);
  assert.equal(args.storyManifest, "story.json");
  assert.equal(args.outputDir, "proof");
});

test("the CLI dry-run validates official intake and writes only plan evidence", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  let stdout = "";
  const result = await main(
    [
      "--story-manifest",
      values.manifestPath,
      "--out-dir",
      values.outputDir,
      "--generated-at",
      "2026-07-27T12:00:00.000Z",
    ],
    {
      stdout: { write: (value) => (stdout += value) },
      inspectFfmpeg: () => ({ available: true, executable: "ffmpeg" }),
    },
  );

  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.verdict, "READY");
  assert.equal(result.story_id, values.storyId);
  assert.equal(result.intake_manifest_sha256, values.manifestSha256);
  assert.ok(fs.existsSync(result.plan_path));
  assert.ok(fs.existsSync(result.markdown_path));
  assert.equal(
    fs.existsSync(path.join(values.outputDir, values.storyId, "assets")),
    false,
  );
  assert.equal(JSON.parse(stdout).mutated, false);
});

test("the CLI apply lane refuses missing exact story and manifest confirmations", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const result = await main(
    [
      "--story-manifest",
      values.manifestPath,
      "--out-dir",
      values.outputDir,
      "--apply",
    ],
    {
      stdout: { write() {} },
      env: {
        DEPLOYMENT_MODE: "local",
        PULSE_OPERATING_MODE: "HUMAN_REVIEW",
        AUTO_PUBLISH: "false",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
        PULSE_EMERGENCY_KILL_SWITCH: "true",
      },
      inspectFfmpeg: () => ({ available: true, executable: "ffmpeg" }),
    },
  );

  assert.equal(result.mode, "APPLY");
  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("story_id_confirmation_mismatch"));
  assert.ok(result.blockers.includes("manifest_sha256_confirmation_invalid"));
  assert.equal(
    fs.existsSync(path.join(values.outputDir, values.storyId, "assets")),
    false,
  );
});

test("the CLI apply lane emits an asset manifest accepted by governed story intake", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const result = await main(
    [
      "--story-manifest",
      values.manifestPath,
      "--out-dir",
      values.outputDir,
      "--generated-at",
      "2026-07-27T12:05:00.000Z",
      "--apply",
      "--confirm-story-id",
      values.storyId,
      "--confirm-manifest-sha256",
      values.manifestSha256,
    ],
    {
      stdout: { write() {} },
      env: {
        DEPLOYMENT_MODE: "local",
        PULSE_OPERATING_MODE: "HUMAN_REVIEW",
        AUTO_PUBLISH: "false",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
        PULSE_EMERGENCY_KILL_SWITCH: "true",
      },
      inspectFfmpeg: () => ({ available: true, executable: "ffmpeg" }),
      renderStill: async ({ outputPath, role }) => {
        fs.writeFileSync(outputPath, `owned:${role}`);
      },
      renderVideo: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, "owned:video");
      },
      inspectAsset: async ({ mediaType }) =>
        mediaType === "image"
          ? { width: 1080, height: 1920, duration_seconds: null }
          : { width: 1080, height: 1920, duration_seconds: 28 },
    },
  );

  assert.equal(result.verdict, "MATERIALIZED_HUMAN_REVIEW");
  assert.equal(result.asset_count, 5);
  const attached = validateOwnedAssetManifest({
    manifestPath: result.asset_manifest_path,
    expectedSha256: result.asset_manifest_sha256,
    expectedStoryId: values.storyId,
  });
  assert.equal(attached.assets.length, 5);
  assert.equal(attached.assets.filter((asset) => asset.media_type === "image").length, 4);
  assert.equal(attached.assets.filter((asset) => asset.media_type === "video").length, 1);
});

test("owned-motion implementation has no DB, OAuth, platform or network client boundary", () => {
  const source = [
    fs.readFileSync(
      path.join(__dirname, "..", "..", "lib", "services", "governed-owned-motion.js"),
      "utf8",
    ),
    fs.readFileSync(
      path.join(__dirname, "..", "..", "tools", "governed-owned-motion.js"),
      "utf8",
    ),
  ].join("\n");
  assert.doesNotMatch(source, /require\([^)]*(?:db|oauth|publisher|upload_)/i);
  assert.doesNotMatch(source, /\b(?:fetch|axios|https?\.request)\s*\(/i);
});

test("package.json exposes the governed owned-motion operator command", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ops:governed-owned-motion"],
    "node tools/governed-owned-motion.js",
  );
});
