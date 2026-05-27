"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  OWNABLE_FORMATS,
  REQUIRED_BRAND_CONTROLS,
  buildGoal26CreatorStudioBrandSystem,
  writeGoal26CreatorStudioBrandSystem,
} = require("../../lib/goal26-creator-studio-brand-system");

function readyGoal25(...storyIds) {
  return {
    verdict: "PASS",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "ready",
      blockers: [],
    })),
  };
}

function blockedGoal25(...storyIds) {
  return {
    verdict: "BLOCKED",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "blocked",
      blockers: ["sponsor:required_metrics_missing"],
    })),
  };
}

function completeBrandSnapshot(overrides = {}) {
  return {
    logo_usage: {
      primary_lockup: "PULSE GAMING wordmark in top or end-card use only",
      clear_space: "Keep one logo-height clear space around the mark.",
      misuse: ["do not stretch", "do not recolour outside the palette"],
    },
    motion_identity: {
      intro_sting: "cold-open first, logo never delays the story",
      transitions: ["source lock flash", "stat card snap", "proof card wipe"],
      lower_third_motion: "fast in, hold, clean out",
    },
    typography: {
      headline: "heavy condensed sans",
      body: "clean geometric sans",
      caption_case: "sentence case",
    },
    colour_system: {
      primary: "#FF6B1A",
      background: "#0D0D0F",
      text: "#F0F0F0",
      alert: "#FF2D2D",
      confirmed: "#22C55E",
    },
    source_card_style: {
      position: "first proof beat",
      fields: ["source name", "claim status", "timestamp when available"],
    },
    lower_thirds: {
      max_words: 8,
      source_locked: true,
      mobile_readable: true,
    },
    thumbnail_style: {
      words: "three to five",
      subject_first: true,
      no_generic_templates: true,
    },
    caption_rules: {
      max_line_chars: 34,
      no_tiny_text: true,
      no_internal_qa_language: true,
    },
    cta_rules: {
      allowed: ["Follow Pulse Gaming so you never miss a beat"],
      banned: ["smash that like", "let me know in the comments"],
    },
    recurring_segment_names: OWNABLE_FORMATS,
    banned_phrases: ["This changes everything", "Nobody saw this coming"],
    editorial_tone: {
      voice: "sharp gaming reporter",
      facts_first: true,
      british_english: true,
    },
    platform_specific_voice: {
      youtube_shorts: "clear sourced headline with one proof beat",
      tiktok: "faster hook, same sourcing",
      instagram_reels: "cleaner caption-led framing",
      x: "threaded proof, no hype",
    },
    ...overrides,
  };
}

test("Goal 26 preserves Goal 25 blockers while direct brand system passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal26-upstream-"));
  const report = await buildGoal26CreatorStudioBrandSystem({
    storyPackages: [{ story_id: "story-a", artifact_dir: path.join(root, "story-a") }],
    upstreamSponsorReport: blockedGoal25("story-a"),
    brandSnapshot: completeBrandSnapshot(),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T07:38:30.333Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_brand_verdict, "PASS");
  assert.equal(report.summary.brand_ready_story_count, 0);
  assert.equal(report.summary.direct_brand_pass_story_count, 1);
  assert.ok(report.stories[0].blockers.includes("upstream:goal25_sponsor_readiness_pack_blocked"));
  assert.ok(report.stories[0].blockers.includes("sponsor:required_metrics_missing"));
  assert.equal(report.brand_system_manifest.publish_allowed_by_goal26, false);
});

test("Goal 26 builds the full Creator Studio brand contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal26-complete-"));
  const report = await buildGoal26CreatorStudioBrandSystem({
    storyPackages: [{ story_id: "story-b", artifact_dir: path.join(root, "story-b") }],
    upstreamSponsorReport: readyGoal25("story-b"),
    brandSnapshot: completeBrandSnapshot(),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T07:38:30.333Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_brand_verdict, "PASS");
  assert.deepEqual(report.required_brand_controls, REQUIRED_BRAND_CONTROLS);
  for (const control of REQUIRED_BRAND_CONTROLS) {
    assert.equal(report.brand_system_manifest.controls[control].status, "defined", control);
  }
  assert.deepEqual(report.recurring_format_registry.required_formats, OWNABLE_FORMATS);
  assert.equal(report.recurring_format_registry.formats.length, OWNABLE_FORMATS.length);
  assert.equal(report.brand_system_manifest.editorial_tone.british_english, true);
  assert.ok(report.visual_style_guide_markdown.includes("## Colour System"));
  assert.ok(report.editorial_style_guide_markdown.includes("## Banned Phrases"));
  assert.equal(report.safety.no_external_posting, true);
});

test("Goal 26 blocks missing brand controls instead of inventing a style guide", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal26-missing-"));
  const incomplete = completeBrandSnapshot({
    logo_usage: null,
    lower_thirds: null,
    platform_specific_voice: { youtube_shorts: "clear sourced headline" },
    recurring_segment_names: ["Steam Spike Check"],
  });

  const report = await buildGoal26CreatorStudioBrandSystem({
    storyPackages: [{ story_id: "story-c", artifact_dir: path.join(root, "story-c") }],
    upstreamSponsorReport: readyGoal25("story-c"),
    brandSnapshot: incomplete,
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T07:38:30.333Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_brand_verdict, "BLOCKED");
  assert.ok(report.stories[0].direct_brand_blockers.includes("brand:logo_usage_missing"));
  assert.ok(report.stories[0].direct_brand_blockers.includes("brand:lower_thirds_missing"));
  assert.ok(report.stories[0].direct_brand_blockers.includes("brand:recurring_format_registry_incomplete"));
  assert.ok(report.stories[0].direct_brand_blockers.includes("brand:platform_specific_voice_incomplete"));
});

test("Goal 26 writes all required brand artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal26-write-"));
  const report = await buildGoal26CreatorStudioBrandSystem({
    storyPackages: [{ story_id: "story-write", artifact_dir: path.join(root, "story-write") }],
    upstreamSponsorReport: readyGoal25("story-write"),
    brandSnapshot: completeBrandSnapshot(),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T07:38:30.333Z",
  });
  const written = await writeGoal26CreatorStudioBrandSystem(report, { outputDir: path.join(root, "out") });

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.brandSystemManifest), true);
  assert.equal(await fs.pathExists(written.visualStyleGuide), true);
  assert.equal(await fs.pathExists(written.editorialStyleGuide), true);
  assert.equal(await fs.pathExists(written.recurringFormatRegistry), true);
});
