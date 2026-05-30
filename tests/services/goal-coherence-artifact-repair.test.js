"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCurrentCoherenceReport,
  repairCoherenceArtifacts,
} = require("../../lib/goal-coherence-artifact-repair");
const { auditPublicOutputCoherenceArtifact } = require("../../lib/public-output-coherence-artifact");

const ROOT = path.resolve(__dirname, "..", "..");

async function makeCoherenceArtifactFixture(root, storyId = "story-one") {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    thumbnail_headline: "FORZA STEAM BET",
    first_spoken_line: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
    narration_script:
      "Forza Horizon 6 just made Xbox's Steam plan harder to ignore. This is no longer just an Xbox Store story.",
    description: "Forza Horizon 6 has a platform story worth watching. Source: Eurogamer.",
    source_card_label: "Eurogamer",
    primary_source: { name: "Eurogamer", url: "https://www.eurogamer.net/forza-horizon-6" },
    discovery_source: { name: "RSS", url: "https://www.eurogamer.net/feed" },
  });
  await fs.outputJson(path.join(artifactDir, "coherence_report.json"), {
    result: "pass",
    failures: [],
    manifest: {
      selected_title: "Old title",
      thumbnail_headline: "OLD THUMB",
      first_spoken_line: "Old opening line.",
      narration_script: "Old script.",
      description: "Old description.",
      source_card_label: "Reddit",
    },
  });
  return artifactDir;
}

test("coherence artifact repair rewrites stale reports from the current canonical manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-coherence-artifact-repair-"));
  const artifactDir = await makeCoherenceArtifactFixture(root, "stale-story");
  const dryRunPlan = {
    blocked_stories: [
      {
        story_id: "stale-story",
        artifact_dir: artifactDir,
        blockers: [
          "stale_public_output_coherence_report",
          "stale_public_output_coherence_field:first_spoken_line",
        ],
      },
    ],
  };

  const report = await repairCoherenceArtifacts({
    dryRunPlan,
    generatedAt: "2026-05-30T23:45:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.target_count, 1);
  assert.equal(report.summary.written_count, 1);
  assert.equal(report.summary.freshness_pass_count, 1);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);

  const repaired = await fs.readJson(path.join(artifactDir, "coherence_report.json"));
  assert.equal(repaired.result, "pass");
  assert.equal(repaired.manifest.selected_title, "Forza Horizon 6 Exposes Xbox's Steam Bet");
  assert.equal(repaired.repair_source, "current_canonical_manifest_and_incident_guard");
  const canonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const audit = await auditPublicOutputCoherenceArtifact({
    artifactDir,
    canonical,
    coherenceReport: repaired,
  });
  assert.equal(audit.status, "fresh");
  assert.deepEqual(audit.blockers, []);
});

test("current coherence report stays failed when current public copy is unsafe", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-coherence-artifact-bad-copy-"));
  const artifactDir = await makeCoherenceArtifactFixture(root, "bad-copy");
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(canonicalPath, {
    ...canonical,
    selected_title: "This gaming story",
    thumbnail_headline: "BIG UPDATE",
    first_spoken_line: "This gaming story starts now.",
    narration_script: "This gaming story starts now. The safest public version is still being checked.",
  }, { spaces: 2 });

  const report = await buildCurrentCoherenceReport({
    artifactDir,
    generatedAt: "2026-05-30T23:46:00.000Z",
  });

  assert.equal(report.result, "fail");
  assert.ok(report.failures.some((failure) => /placeholder|internal_qa|title/i.test(failure)));
});

test("coherence artifact repair CLI is registered and dry-run first", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-coherence-artifact-cli-"));
  const artifactDir = await makeCoherenceArtifactFixture(root, "cli-story");
  const dryRunPath = path.join(root, "dry_run_publish_plan.json");
  await fs.outputJson(dryRunPath, {
    blocked_stories: [
      {
        story_id: "cli-story",
        artifact_dir: artifactDir,
        blockers: ["stale_public_output_coherence_report"],
      },
    ],
  });
  const outDir = path.join(root, "out");
  const result = spawnSync(
    process.execPath,
    ["tools/goal-coherence-artifact-repair.js", "--dry-run-plan", dryRunPath, "--out-dir", outDir, "--json"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, "dry_run_no_file_write");
  assert.equal(parsed.summary.target_count, 1);
  assert.equal(parsed.summary.written_count, 0);
  assert.equal(await fs.pathExists(path.join(outDir, "coherence_artifact_repair_report.json")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(
    pkg.scripts["ops:goal-coherence-artifact-repair"],
    "node tools/goal-coherence-artifact-repair.js",
  );
});
