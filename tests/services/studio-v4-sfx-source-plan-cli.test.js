"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");

const {
  parseArgs,
  renderMarkdown,
} = require("../../tools/studio-v4-sfx-source-plan");

test("SFX source-plan CLI writes a safe operator sourcing manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v4-sfx-source-plan-"));
  const result = spawnSync(
    process.execPath,
    [
      "tools/studio-v4-sfx-source-plan.js",
      "--out-dir",
      root,
      "--generated-at",
      "2026-05-23T18:45:00.000Z",
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.plan.readiness.status, "blocked");
  assert.ok(parsed.plan.readiness.blockers.includes("sfx_source:no_creator_studio_sfx_assets"));
  assert.ok(parsed.plan.recommended_sources.some((source) => source.provider_id === "boom_library"));
  assert.ok(parsed.plan.recommended_sources.some((source) => source.provider_id === "soundly"));
  assert.equal(parsed.plan.safety.no_downloads_started, true);
  assert.equal(parsed.plan.safety.no_db_mutation, true);
  assert.equal(await fs.pathExists(path.join(root, "sfx_source_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "sfx_source_plan.md")), true);
});

test("SFX source-plan CLI parses manifest and output arguments", () => {
  const args = parseArgs([
    "--sfx-manifest",
    "sfx_manifest.json",
    "--ingest-report",
    "sfx_library_ingest_report.json",
    "--out-dir",
    "out",
    "--generated-at",
    "2026-05-23T18:46:00.000Z",
    "--json",
  ]);

  assert.equal(args.sfxManifestPath, "sfx_manifest.json");
  assert.equal(args.ingestReportPath, "sfx_library_ingest_report.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.generatedAt, "2026-05-23T18:46:00.000Z");
  assert.equal(args.json, true);
});

test("SFX source-plan CLI can certify installed licensed assets from ingest report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v4-sfx-source-plan-ingest-"));
  const ingestReportPath = path.join(root, "sfx_library_ingest_report.json");
  const roles = ["impact", "transition", "ui_tick", "sub_hit", "glitch"];
  const assetInventory = roles.map((role, index) => ({
    asset_id: `licensed_${role}`,
    role,
    family: role,
    provider_id: index % 2 === 0 ? "sonniss" : "boom_library",
    source_url: `file:///licensed/${role}.wav`,
    licence_basis: index % 2 === 0
      ? "sonniss_game_audio_gdc_bundle_license"
      : "boom_library_media_license",
    approval_status: "approved_for_commercial_editorial_use",
    commercial_use_allowed: true,
  }));
  await fs.writeJson(ingestReportPath, {
    asset_inventory: assetInventory,
    rights_ledger: {
      records: assetInventory.map((asset) => ({
        asset_id: asset.asset_id,
        licence_basis: asset.licence_basis,
        allowed_use: "finished_editorial_video_only",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      })),
    },
  });

  const result = spawnSync(
    process.execPath,
    [
      "tools/studio-v4-sfx-source-plan.js",
      "--ingest-report",
      ingestReportPath,
      "--out-dir",
      root,
      "--generated-at",
      "2026-05-23T18:48:00.000Z",
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.plan.readiness.status, "pass");
  assert.deepEqual(parsed.plan.readiness.blockers, []);
  assert.deepEqual(parsed.plan.covered_roles, roles.sort());
  assert.equal(parsed.plan.selected_assets.length, roles.length);

  const persisted = await fs.readJson(path.join(root, "sfx_source_plan.json"));
  assert.equal(persisted.readiness.status, "pass");
});

test("SFX source-plan markdown names sources without pretending assets were installed", () => {
  const markdown = renderMarkdown({
    generated_at: "2026-05-23T18:47:00.000Z",
    readiness: {
      status: "blocked",
      blockers: ["sfx_source:no_creator_studio_sfx_assets"],
    },
    required_roles: ["impact", "transition"],
    recommended_sources: [
      {
        name: "BOOM Library",
        matching_roles: ["impact", "transition"],
        licence_evidence_url: "https://www.boomlibrary.com/support/faq/what-am-i-allowed-to-do-with-your-sounds/",
      },
    ],
  });

  assert.match(markdown, /Readiness: blocked/);
  assert.match(markdown, /BOOM Library/);
  assert.match(markdown, /No downloads were started/);
});
