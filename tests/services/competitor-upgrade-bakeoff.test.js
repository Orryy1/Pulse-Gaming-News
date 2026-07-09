"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCompetitorUpgradeBakeoff,
  writeCompetitorUpgradeBakeoff,
} = require("../../lib/competitor-upgrade-bakeoff");

function fixtureCandidates(count = 30) {
  return Array.from({ length: count }, (_, index) => ({
    story_id: `candidate_${String(index + 1).padStart(2, "0")}`,
    canonical_subject: [
      "Forza Horizon 6",
      "Nintendo Switch 2",
      "PlayStation Store",
      "Steam Next Fest",
      "Xbox Game Pass",
    ][index % 5],
    source_name: ["Steam", "Nintendo", "PlayStation Blog", "Xbox Wire", "Eurogamer"][index % 5],
    source_url: `https://example.test/source-${index + 1}`,
    baseline_title: "Gaming news update",
    baseline_hook: "Here is what happened in gaming news today.",
    topic_category: "gaming_news",
    commercial_relevance: index % 4 === 0 ? "story_relevant_game_page" : "no_safe_direct_offer",
  }));
}

test("competitor upgrade bakeoff compares 30 stories and keeps stronger Pulse-original variants", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bakeoff-"));
  const report = await buildCompetitorUpgradeBakeoff({
    candidates: fixtureCandidates(),
    outputDir: path.join(root, "out"),
    generatedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.candidate_count, 30);
  assert.ok(report.summary.upgraded_beats_baseline_count >= 10);
  assert.equal(report.safety.no_copied_assets, true);
  assert.equal(report.upgraded_green_candidates.candidates.every((candidate) => candidate.original_pulse_branded === true), true);
  assert.equal(report.upgraded_green_candidates.candidates.every((candidate) => candidate.source_manifest), true);
  assert.equal(report.upgraded_green_candidates.candidates.every((candidate) => candidate.rights_ledger), true);
  assert.equal(report.upgraded_green_candidates.candidates.every((candidate) => candidate.ai_disclosure), true);
  assert.equal(report.upgraded_green_candidates.candidates.every((candidate) => candidate.caption_manifest), true);
  assert.equal(report.upgraded_green_candidates.candidates.every((candidate) => candidate.platform_packs), true);
  assert.equal(
    report.upgraded_green_candidates.candidates.every((candidate) =>
      candidate.director_beat_map.shot_plan
        .filter((shot) => /source_lock/i.test(`${shot.id || ""} ${shot.kind || ""}`))
        .every((shot) => Number(shot.durationS || 0) <= 3.5),
    ),
    true,
  );
  assert.ok(report.rejected_variants.variants.some((variant) => variant.reason === "baseline_lost_to_upgraded_variant"));
});

test("competitor upgrade bakeoff writes required artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bakeoff-write-"));
  const report = await buildCompetitorUpgradeBakeoff({
    candidates: fixtureCandidates(),
    outputDir: path.join(root, "out"),
    generatedAt: "2026-06-07T12:00:00.000Z",
  });
  const written = await writeCompetitorUpgradeBakeoff(report, { outputDir: path.join(root, "out") });

  for (const file of Object.values(written)) {
    assert.equal(await fs.pathExists(file), true, file);
  }
});
