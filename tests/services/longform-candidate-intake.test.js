"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildLongformCandidateIntake,
  hydrateCandidateFromProof,
} = require("../../lib/ops/longform-candidate-intake");
const {
  parseArgs,
  runLongformCandidateIntake,
} = require("../../tools/longform-candidate-intake");

function governedCandidate(id, overrides = {}) {
  return {
    id,
    title: `Why ${id} matters to players`,
    canonical_game: id,
    source_published_at: "2026-07-10T12:00:00.000Z",
    source_manifest: {
      primary_source: {
        name: "Official publisher news",
        url: `https://publisher.example.com/${id}`,
        type: "official_publisher_news",
        published_at: "2026-07-10T12:00:00.000Z",
      },
      blockers: [],
    },
    claim_inventory: {
      confirmed: [`${id} has a confirmed player-facing change.`],
      unconfirmed: [],
      prohibited: [],
    },
    materialised_motion_clips: {
      status: "ready",
      clips: [
        {
          source_url: `https://cdn.publisher.example.com/${id}.mp4`,
          source_type: "official_trailer",
          rights_basis: "official_direct_media",
          materialized: true,
        },
      ],
    },
    player_impact: `${id} changes what players can do at launch.`,
    curiosity_gap: `The open question is whether ${id} delivers on the trailer promise.`,
    payoff: `Players can decide whether to buy, wait or wishlist ${id}.`,
    debate_prompt: `Is ${id} worth prioritising?`,
    platforms: ["PC", "PlayStation 5"],
    ...overrides,
  };
}

test("long-form intake deduplicates governed stories and separates weekly from release-radar eligibility", () => {
  const report = buildLongformCandidateIntake({
    now: "2026-07-12T12:00:00.000Z",
    targetMonth: "2026-08",
    candidates: [
      governedCandidate("Game Alpha"),
      governedCandidate("Game Alpha duplicate", {
        canonical_game: "Game Alpha",
        source_published_at: "2026-07-09T12:00:00.000Z",
      }),
      governedCandidate("Game Beta", {
        release_date: "2026-08-18",
      }),
      governedCandidate("Game Stale", {
        source_published_at: "2026-06-01T12:00:00.000Z",
        source_manifest: {
          primary_source: {
            name: "Official publisher news",
            url: "https://publisher.example.com/game-stale",
            type: "official_publisher_news",
            published_at: "2026-06-01T12:00:00.000Z",
          },
          blockers: [],
        },
      }),
      governedCandidate("Game Motionless", {
        materialised_motion_clips: { status: "blocked", clips: [] },
      }),
    ],
  });

  assert.equal(report.totals.input, 5);
  assert.equal(report.totals.deduplicated, 4);
  assert.deepEqual(
    report.weekly.candidates.map((candidate) => candidate.canonical_game),
    ["Game Alpha", "Game Beta"],
  );
  assert.deepEqual(
    report.release_radar.candidates.map((candidate) => candidate.canonical_game),
    ["Game Beta"],
  );
  assert.ok(
    report.blocked.some(
      (candidate) =>
        candidate.canonical_game === "Game Stale" &&
        candidate.weekly_blockers.includes("source_older_than_7_days"),
    ),
  );
  assert.ok(
    report.blocked.some(
      (candidate) =>
        candidate.canonical_game === "Game Motionless" &&
        candidate.shared_blockers.includes("official_direct_motion_missing"),
    ),
  );
  assert.equal(report.safety.live_publish_attempted, false);
  assert.equal(report.safety.production_db_mutation, false);
});

test("long-form intake hydrates governed source, claims and motion from a Shorts proof package", async (t) => {
  const proofDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-longform-intake-"));
  t.after(() => fs.remove(proofDir));
  const exportedPath = path.join(proofDir, "visual_v4_render.mp4");
  await fs.writeFile(exportedPath, "render-stub");
  await fs.writeJson(path.join(proofDir, "canonical_story_manifest.json"), {
    story_id: "proof-story",
    canonical_game: "Proof Game",
    canonical_title: "Proof Game Changes Its Launch Plan",
    source_published_at: "2026-07-11T10:00:00.000Z",
    primary_source: "Proof Publisher",
    primary_source_url: "https://publisher.example.com/proof-game",
    confirmed_claims: ["Proof Game has a confirmed launch change."],
    description: "Players now have a clear reason to reassess launch day.",
  });
  await fs.writeJson(path.join(proofDir, "source_manifest.json"), {
    primary_source: {
      name: "Proof Publisher",
      url: "https://publisher.example.com/proof-game",
      type: "official_publisher_news",
      published_at: "2026-07-11T10:00:00.000Z",
    },
    blockers: [],
  });
  await fs.writeJson(path.join(proofDir, "claim_inventory.json"), {
    confirmed: ["Proof Game has a confirmed launch change."],
    unconfirmed: [],
    prohibited: [],
  });
  await fs.writeJson(path.join(proofDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: [
      {
        source_url: "https://cdn.publisher.example.com/proof-game.mp4",
        source_type: "official_trailer",
        rights_basis: "official_direct_media",
        materialized: true,
      },
    ],
  });

  const hydrated = await hydrateCandidateFromProof({
    id: "queue-row",
    source: { exported_path: exportedPath },
  });

  assert.equal(hydrated.id, "proof-story");
  assert.equal(hydrated.canonical_game, "Proof Game");
  assert.equal(hydrated.source_manifest.primary_source.type, "official_publisher_news");
  assert.equal(hydrated.claim_inventory.confirmed.length, 1);
  assert.equal(hydrated.materialised_motion_clips.clips.length, 1);
  assert.equal(
    hydrated.player_impact,
    "Players now have a clear reason to reassess launch day.",
  );
  assert.equal(hydrated.proof_dir, proofDir);
});

test("long-form intake accepts multiple governed source files for one programme", () => {
  const args = parseArgs([
    "--input",
    "data/release-radar/a.json",
    "--input",
    "data/release-radar/b.json",
  ]);

  assert.equal(args.inputs.length, 2);
  assert.match(args.inputs[0], /data[\\/]release-radar[\\/]a\.json$/);
  assert.match(args.inputs[1], /data[\\/]release-radar[\\/]b\.json$/);
});

test("long-form intake does not duplicate release candidates that are blocked only in the weekly lane", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-longform-lane-dedupe-"));
  t.after(() => fs.remove(root));
  const inputPath = path.join(root, "release-candidates.json");
  const outputDir = path.join(root, "out");
  const releaseCandidate = governedCandidate("Release Only", {
    release_date: "2026-08-20",
    source_published_at: null,
  });
  delete releaseCandidate.source_manifest.primary_source.published_at;
  await fs.writeJson(inputPath, [releaseCandidate]);

  const result = await runLongformCandidateIntake({
    inputs: [inputPath],
    outputDir,
    targetMonth: "2026-08",
    now: "2026-07-12T12:00:00.000Z",
  });

  assert.equal(result.report.release_radar.candidates.length, 1);
  assert.equal(result.releaseRadar.readiness.ready_candidate_count, 1);
  assert.deepEqual(
    result.releaseRadar.ready_candidates.map((candidate) => candidate.id),
    ["Release Only"],
  );
});
