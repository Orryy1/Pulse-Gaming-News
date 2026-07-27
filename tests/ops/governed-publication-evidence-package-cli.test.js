"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  parseArgs,
  runCli,
} = require("../../tools/governed-publication-evidence-package");

const CLI_PATH = path.resolve(
  __dirname,
  "../../tools/governed-publication-evidence-package.js",
);

function completeArgs(extra = []) {
  return [
    "--story-intake",
    "story-intake.json",
    "--source-evidence",
    "source-evidence.json",
    "--owned-motion-manifest",
    "combined-owned-motion-manifest.json",
    "--governed-narration-manifest",
    "governed-narration-manifest.json",
    "--final-composite-manifest",
    "final-composite-manifest.json",
    "--renderer-manifest",
    "renderer-manifest.json",
    "--qa-report",
    "final-render-qa.json",
    "--final-mp4",
    "final.mp4",
    "--out-dir",
    ".",
    "--generated-at",
    "2026-07-27T17:00:00.000Z",
    ...extra,
  ];
}

test("CLI defaults to dry-run and maps every explicit evidence input", () => {
  const options = parseArgs(completeArgs());
  assert.equal(options.apply, false);
  assert.equal(options.storyIntakePath, "story-intake.json");
  assert.equal(
    options.governedNarrationManifestPath,
    "governed-narration-manifest.json",
  );
  assert.equal(
    options.finalCompositeManifestPath,
    "final-composite-manifest.json",
  );
  assert.equal(options.humanApproval, undefined);
});

test("CLI forwards apply only with explicit human confirmation values", async () => {
  let received;
  let stdout = "";
  const mediaSha = "a".repeat(64);
  const scriptSha = "b".repeat(64);
  const rendererSha = "c".repeat(64);
  const exitCode = await runCli(
    completeArgs([
      "--apply",
      "--approval-actor",
      "channel-owner",
      "--approval-timestamp",
      "2026-07-27T17:05:00.000Z",
      "--confirm-story-id",
      "official_d86953ca92ca",
      "--confirm-media-sha256",
      mediaSha,
      "--confirm-script-sha256",
      scriptSha,
      "--confirm-renderer-canonical-sha256",
      rendererSha,
      "--confirm-disclosure",
      "DISCLOSE_AND_SET_YOUTUBE_TRUE",
    ]),
    {
      execute: async (options) => {
        received = options;
        return { verdict: "PACKAGE_WRITTEN_HUMAN_APPROVED" };
      },
      stdout: {
        write(value) {
          stdout += value;
        },
      },
      stderr: { write() {} },
    },
  );
  assert.equal(exitCode, 0);
  assert.equal(received.apply, true);
  assert.deepEqual(received.humanApproval, {
    actor: "channel-owner",
    approvedAt: "2026-07-27T17:05:00.000Z",
    confirmStoryId: "official_d86953ca92ca",
    confirmMediaSha256: mediaSha,
    confirmScriptSha256: scriptSha,
    confirmRendererCanonicalSha256: rendererSha,
    disclosureConfirmation: "DISCLOSE_AND_SET_YOUTUBE_TRUE",
  });
  assert.match(stdout, /PACKAGE_WRITTEN_HUMAN_APPROVED/);
});

test("CLI rejects unknown or valueless arguments and has no mutation integrations", () => {
  assert.throws(() => parseArgs(["--unknown"]), /unknown_argument/);
  assert.throws(() => parseArgs(["--story-intake"]), /argument_value_required/);
  const source = fs.readFileSync(CLI_PATH, "utf8");
  for (const forbidden of [
    "better-sqlite3",
    "upload_youtube",
    "upload_tiktok",
    "upload_instagram",
    "oauth",
    "fetch(",
    "axios",
  ]) {
    assert.equal(
      source.toLowerCase().includes(forbidden),
      false,
      `forbidden CLI integration: ${forbidden}`,
    );
  }
});
