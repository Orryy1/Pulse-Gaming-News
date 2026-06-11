"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_SEGMENTS,
  buildPulseAvatarIdentitySystem,
  writePulseAvatarIdentitySystem,
} = require("../../lib/pulse-avatar-identity-system");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || "Xbox Shows A New Gameplay Trailer",
    classification: overrides.classification || "[CONFIRMED]",
    canonical_subject: overrides.subject || "Xbox",
    primary_source: { name: "Xbox Wire", url: "https://news.xbox.com/example" },
    narration_script: "Xbox showed a source-backed gameplay beat. Follow Pulse Gaming so you never miss a beat.",
  });
  return { story_id: storyId, artifact_dir: artifactDir, title: overrides.title };
}

test("Pulse Avatar Identity System builds a non-photorealistic brand identity and recurring segment registry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-avatar-ready-"));
  const stories = [
    await makeStoryPackage(root, "breaking-story", {
      classification: "[BREAKING]",
      title: "Nintendo Direct Just Dropped A Trailer",
      subject: "Nintendo Direct",
    }),
    await makeStoryPackage(root, "wishlist-story", {
      classification: "[CONFIRMED]",
      title: "Steam Demo Is Worth Your Wishlist",
      subject: "Steam Demo",
    }),
  ];

  const report = await buildPulseAvatarIdentitySystem({
    storyPackages: stories,
    workspaceRoot: root,
    generatedAt: "2026-06-11T09:00:00.000Z",
    outputDir: path.join(root, "out"),
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.avatar_identity.character_type, "stylised_signal_operator");
  assert.equal(report.avatar_identity.photorealistic, false);
  assert.equal(report.avatar_identity.human_likeness, false);
  assert.equal(report.avatar_identity.fake_presenter_risk, "none");
  assert.ok(report.brand_style_guide.logo_lockups.includes("pulse_orbit_mark"));
  assert.ok(report.motion_identity_kit.components.some((component) => component.id === "source_lock_wipe"));
  assert.deepEqual(
    REQUIRED_SEGMENTS.filter((segment) => !report.recurring_segment_registry.segments.some((item) => item.id === segment.id)),
    [],
  );
  assert.equal(report.story_identity_assignments.find((story) => story.story_id === "breaking-story").segment_id, "breaking_pulse");
  assert.equal(report.story_identity_assignments.find((story) => story.story_id === "wishlist-story").segment_id, "worth_your_wishlist");
  assert.equal(report.identity_quality_gate_report.status, "pass");
  assert.equal(report.safety.no_fake_presenter_or_deepfake, true);
});

test("Pulse Avatar Identity System blocks photorealistic presenter or human-likeness identity proposals", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-avatar-blocked-"));

  const report = await buildPulseAvatarIdentitySystem({
    workspaceRoot: root,
    identityOverrides: {
      photorealistic: true,
      human_likeness: true,
      presenter_claim: true,
    },
    generatedAt: "2026-06-11T09:00:00.000Z",
    outputDir: path.join(root, "out"),
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.blocker_counts["identity:photorealistic_avatar_forbidden"] >= 1);
  assert.ok(report.blocker_counts["identity:human_likeness_forbidden"] >= 1);
  assert.ok(report.blocker_counts["identity:fake_presenter_claim_forbidden"] >= 1);
  assert.equal(report.identity_quality_gate_report.status, "blocked");
});

test("Pulse Avatar Identity System writes all identity proof artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-avatar-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const outputDir = path.join(root, "out");
  const report = await buildPulseAvatarIdentitySystem({
    storyPackages: [story],
    workspaceRoot: root,
    generatedAt: "2026-06-11T09:00:00.000Z",
    outputDir,
  });

  const written = await writePulseAvatarIdentitySystem(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.avatarIdentity), true);
  assert.equal(await fs.pathExists(written.brandStyleGuide), true);
  assert.equal(await fs.pathExists(written.motionIdentityKit), true);
  assert.equal(await fs.pathExists(written.recurringSegmentRegistry), true);
  assert.equal(await fs.pathExists(written.identityQualityGateReport), true);
  assert.equal(await fs.pathExists(written.storyIdentityAssignments), true);
});
