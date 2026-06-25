"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairGoalControlTowerEvidence,
} = require("../../lib/goal-control-tower-evidence-repair");
const {
  buildGoal19AutonomyControlTower,
} = require("../../lib/goal19-autonomy-control-tower");

function passGate(extra = {}) {
  return { status: "pass", verdict: "pass", failures: [], blockers: [], ...extra };
}

async function makeControlTowerPackage(root, storyId = "story-ready") {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Hellraiser: Revival",
    selected_title: "Hellraiser: Revival's October Date Is A Risk",
    first_spoken_line: "Hellraiser: Revival picked October 8, and that is brave for all the wrong reasons.",
    narration_script:
      "Hellraiser: Revival picked October 8, and that is brave for all the wrong reasons. Source-backed copy stays clean.",
    primary_source: "Eurogamer",
    primary_source_url: "https://www.eurogamer.net/hellraiser-revival-release-date-trailer",
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 90,
    blockers: [],
    warnings: [],
  });
  await fs.writeJson(path.join(artifactDir, "footage_inventory.json"), {
    verdict: "pass",
    failures: [],
    blockers: [],
    motion_asset_count: 6,
    distinct_motion_family_count: 5,
    motion_inventory: {
      accepted_local_clips: [
        { id: "clip-1", source_family: "official_1" },
        { id: "clip-2", source_family: "official_2" },
        { id: "clip-3", source_family: "official_3" },
        { id: "clip-4", source_family: "official_4" },
        { id: "clip-5", source_family: "official_5" },
      ],
    },
  });
  await fs.writeJson(path.join(artifactDir, "rights_ledger.json"), passGate());
  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [{ id: "hook", kind: "motion_clip" }],
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    quality_gate_status: "pass",
    safety: { no_publish_triggered: true },
  });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), passGate());
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), passGate({ result: "pass" }));
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    verdict: "GREEN",
    status: "pass",
    hard_failures: [],
    scores: {
      overall_media_house_score: 95,
      competitor_parity_score: 97,
      competitor_surpass_score: 93,
      first_3_seconds_score: 100,
      source_lock_score: 100,
    },
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    can_auto_publish: true,
    outputs: {
      youtube_shorts: { title: "Hellraiser: Revival's October Date Is A Risk" },
      instagram_reels: { caption: "Hellraiser: Revival picked October 8. Source: Eurogamer." },
      facebook_reels: { page_caption: "Hellraiser: Revival picked October 8. Source: Eurogamer." },
    },
    platform_native_evidence: { verdict: "pass", platforms: [{ platform: "youtube_shorts", status: "pass" }] },
  });
  return { story_id: storyId, artifact_dir: artifactDir, title: "Hellraiser: Revival's October Date Is A Risk" };
}

function readyGoal18(storyId) {
  return { stories: [{ story_id: storyId, status: "ready", blockers: [] }] };
}

function goal16Pass(storyId) {
  return {
    stories: [{
      story_id: storyId,
      status: "blocked",
      direct_landing_status: "pass",
      blockers: ["upstream:goal15_affiliate_intelligence_missing"],
    }],
  };
}

function landingProof(storyId) {
  return {
    story: {
      story_id: storyId,
      status: "local_proof_prepared",
      landing_page_slug: "hellraiser-revival-october-risk",
      landing_page_route: "/p/hellraiser-revival-october-risk",
      link_pack: { primary_link: null, source_links: [] },
      disclosure_block: { required: false, status: "present" },
    },
  };
}

function goal17Pass(storyId) {
  return {
    stories: [{
      story_id: storyId,
      status: "blocked",
      direct_policy_status: "pass",
      direct_policy_blockers: [],
      disclosure_requirements: {
        affiliate: { required: false, present: true, action: "no_action" },
      },
      policy_checks: {
        spam_repetitive_content: passGate({ evidence: { blind_duplicate_pairs: [] } }),
        affiliate_disclosure: passGate({ evidence: { required: false, present: true } }),
      },
    }],
  };
}

function policyProof(storyId) {
  return {
    story: {
      story_id: storyId,
      status: "pass",
      blockers: [],
      checks: {
        spam_repetitive_content: passGate({ evidence: { blind_duplicate_pairs: [] } }),
        affiliate_disclosure: passGate({ evidence: { required: false, present: true } }),
      },
      disclosure_requirements: {
        affiliate: { required: false, present: true, action: "no_action" },
      },
    },
  };
}

test("control tower evidence repair promotes passed local proof into package-level Goal19 inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-evidence-"));
  const story = await makeControlTowerPackage(root, "story-hellraiser");

  const before = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-hellraiser"),
    workspaceRoot: root,
    outputDir: path.join(root, "out-before"),
    generatedAt: "2026-06-22T02:10:00.000Z",
  });
  assert.equal(before.direct_control_tower_verdict, "BLOCKED");
  assert.ok(before.stories[0].direct_control_tower_blockers.includes("control:policy_report_not_pass"));
  assert.ok(before.stories[0].direct_control_tower_blockers.includes("control:analytics_risk_missing"));

  const report = await repairGoalControlTowerEvidence({
    storyPackages: [story],
    goal16Report: goal16Pass("story-hellraiser"),
    landingManifestReport: landingProof("story-hellraiser"),
    goal17Report: goal17Pass("story-hellraiser"),
    platformPolicyReport: policyProof("story-hellraiser"),
    generatedAt: "2026-06-22T02:11:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.repairable_count, 1);
  assert.equal(report.summary.repaired_count, 1);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_gate_weakened, true);

  const analytics = await fs.readJson(path.join(story.artifact_dir, "analytics_ingest_plan.json"));
  const affiliate = await fs.readJson(path.join(story.artifact_dir, "affiliate_link_manifest.json"));
  const uniqueness = await fs.readJson(path.join(story.artifact_dir, "uniqueness_report.json"));
  assert.equal(analytics.dry_run_only, true);
  assert.equal(affiliate.no_affiliate_link, true);
  assert.equal(affiliate.disclosure_required, false);
  assert.equal(uniqueness.status, "pass");
  assert.equal(await fs.pathExists(path.join(story.artifact_dir, "publish_verdict.json")), true);

  const after = await buildGoal19AutonomyControlTower({
    storyPackages: [story],
    upstreamFirewallReport: readyGoal18("story-hellraiser"),
    workspaceRoot: root,
    outputDir: path.join(root, "out-after"),
    generatedAt: "2026-06-22T02:12:00.000Z",
  });
  assert.equal(after.verdict, "PASS");
  assert.equal(after.direct_control_tower_verdict, "PASS");
  assert.equal(after.stories[0].final_verdict, "GREEN");
  assert.deepEqual(after.stories[0].direct_control_tower_blockers, []);
});

test("control tower evidence repair refuses to promote missing policy proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-evidence-blocked-"));
  const story = await makeControlTowerPackage(root, "story-missing-policy");

  const report = await repairGoalControlTowerEvidence({
    storyPackages: [story],
    goal16Report: goal16Pass("story-missing-policy"),
    landingManifestReport: landingProof("story-missing-policy"),
    goal17Report: {},
    platformPolicyReport: {},
    generatedAt: "2026-06-22T02:20:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.blocked_count, 1);
  assert.equal(report.summary.repaired_count, 0);
  assert.ok(report.items[0].blockers.includes("platform_policy_proof_not_passed"));
  assert.equal(await fs.pathExists(path.join(story.artifact_dir, "platform_policy_report.json")), false);
});

test("control tower evidence repair promotes stale RED platform manifest when native proof passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-control-evidence-platform-manifest-"));
  const story = await makeControlTowerPackage(root, "story-stale-platform-manifest");
  const platformManifestPath = path.join(story.artifact_dir, "platform_publish_manifest.json");
  const platformManifest = await fs.readJson(platformManifestPath);
  await fs.writeJson(platformManifestPath, {
    ...platformManifest,
    publish_status: "RED",
    can_auto_publish: false,
  });

  const report = await repairGoalControlTowerEvidence({
    storyPackages: [story],
    goal16Report: goal16Pass("story-stale-platform-manifest"),
    landingManifestReport: landingProof("story-stale-platform-manifest"),
    goal17Report: goal17Pass("story-stale-platform-manifest"),
    platformPolicyReport: policyProof("story-stale-platform-manifest"),
    generatedAt: "2026-06-22T02:30:00.000Z",
    apply: true,
    backupRoot: path.join(root, "backups"),
  });

  assert.equal(report.summary.repairable_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.summary.repaired_count, 1);
  assert.deepEqual(report.items[0].blockers, []);
  assert.ok(report.items[0].stale_files.includes("platform_publish_manifest.json"));

  const repairedPlatformManifest = await fs.readJson(platformManifestPath);
  const publishVerdict = await fs.readJson(path.join(story.artifact_dir, "publish_verdict.json"));
  assert.equal(repairedPlatformManifest.publish_status, "GREEN");
  assert.equal(repairedPlatformManifest.can_auto_publish, true);
  assert.equal(publishVerdict.verdict, "GREEN");
  assert.equal(publishVerdict.can_auto_publish, true);
});
