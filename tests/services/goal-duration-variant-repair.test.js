"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  NORMAL_PRODUCTION_REPAIR_STRATEGY,
  durationRepairThumbnailHeadline,
  extendScriptToTarget,
  materializeDurationVariantRepairs,
  renderDurationVariantRepairMarkdown,
  writeDurationVariantRepairReport,
} = require("../../lib/goal-duration-variant-repair");
const { evaluateGoalPublicCopy } = require("../../lib/goal-public-copy-qa");
const { buildCaptionSrt } = require("../../lib/goal-public-copy-repair");
const { runScriptCoherenceQa } = require("../../lib/script-coherence-qa");
const { buildViralScriptIntelligence } = require("../../lib/viral-script-intelligence");

function charAlignment(text) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * 0.045),
    character_end_times_seconds: characters.map((_, index) => index * 0.045 + 0.035),
  };
}

function simpleWordCount(value = "") {
  return String(value).trim().split(/\s+/).filter(Boolean).length;
}

async function makePackage(root, storyId = "story-duration", overrides = {}) {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Star Fox",
    canonical_game: "Star Fox",
    selected_title: "Star Fox Deal Has One Catch",
    thumbnail_headline: "STAR FOX DEAL",
    first_spoken_line: "Star Fox has a Switch 2 camera deal.",
    narration_script:
      "Star Fox has a Switch 2 camera deal. IGN reports the Nintendo Switch 2 Camera is discounted for Memorial Day. Check the price and platform details before you buy.",
    primary_source: "IGN",
    confirmed_claims: ["Nintendo Switch 2 Camera is discounted for Memorial Day"],
    platform_ctas: {
      youtube: "Sources and setup links are on the story page.",
    },
    ...overrides.canonical,
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_plan: [{ kind: "proof_card", label: "SOURCE LOCKED", detail: "Deal details" }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 18.25,
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    schema_version: 1,
    story_id: storyId,
    operating_mode: "DRY_RUN_PUBLISH",
    publish_status: "GREEN",
    outputs: {
      youtube_shorts: {},
      tiktok: {},
      instagram_reels: {},
      facebook_reels: {},
      x: {},
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    matched_assets: [
      {
        asset_id: `${storyId}-motion-1`,
        kind: "video",
        path: path.join(artifactDir, "clip-1.mp4"),
        licence_basis: "owned_generated_editorial_motion_graphic",
        risk_score: 0.03,
      },
      {
        asset_id: `${storyId}-motion-2`,
        kind: "video",
        path: path.join(artifactDir, "clip-2.mp4"),
        licence_basis: "owned_generated_editorial_motion_graphic",
        risk_score: 0.03,
      },
    ],
  });
  await fs.outputFile(path.join(artifactDir, "clip-1.mp4"), Buffer.alloc(4096, 1));
  await fs.outputFile(path.join(artifactDir, "clip-2.mp4"), Buffer.alloc(4096, 2));
  return artifactDir;
}

function workOrderJob(storyId, artifactDir) {
  return {
    story_id: storyId,
    title: "Star Fox Deal Has One Catch",
    artifact_dir: artifactDir,
    status: "needs_duration_variant_rerender",
    current_duration_s: 18.25,
    target_duration_seconds: { min: 22, max: 30 },
    minimum_extension_seconds: 3.75,
    actions: [
      "extend_canonical_script_source_safely",
      "regenerate_audio_and_word_timestamps",
      "rerender_visual_v4_platform_variants",
      "rerun_content_video_platform_governance_preflight",
    ],
  };
}

function assertDurationRepairPublicCopyPass(canonical, job = {}) {
  const repair = extendScriptToTarget(canonical, {
    current_duration_s: 16,
    target_duration_seconds: { min: 35, max: 59 },
    provider: "local",
    ...job,
  });
  const firstLine = repair.script.split(/(?<=[.!?])\s+/)[0];
  const report = evaluateGoalPublicCopy({
    ...canonical,
    narration_script: repair.script,
    full_script: repair.script,
    tts_script: repair.script,
    first_spoken_line: firstLine,
    description: `${canonical.confirmed_claims?.[0] || canonical.selected_title}. Source: ${canonical.primary_source}.`,
    thumbnail_headline: durationRepairThumbnailHeadline(
      canonical.selected_title,
      canonical.canonical_subject || canonical.canonical_game,
    ),
  });
  assert.equal(
    report.verdict,
    "pass",
    `${canonical.selected_title} failed public-copy QA after duration repair: ${JSON.stringify(report.failures)}`,
  );
  return repair;
}

test("duration variant repair extends script, regenerates local audio and rerenders without publish side effects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-variant-"));
  const artifactDir = await makePackage(root);
  const audioCalls = [];
  const renderCalls = [];

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-22T08:00:00.000Z",
    workOrder: { jobs: [workOrderJob("story-duration", artifactDir)] },
    alignmentMode: "off",
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 3));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      renderCalls.push({ storyJson, output, story });
      await fs.outputFile(output, Buffer.alloc(8192, 4));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 23.5,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.repaired_count, 1);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(audioCalls.length, 1);
  assert.equal(renderCalls.length, 1);
  assert.doesNotMatch(audioCalls[0].text, /premium access into the story|paid tier is starting to look like launch day/i);
  assert.doesNotMatch(
    audioCalls[0].text,
    /Before you spend|buy now,\s*wait or skip|recommendation moves|buy,\s*download,\s*wait|wishlist,\s*download or ignore|next choice is practical/i,
  );
  assert.equal(renderCalls[0].story.full_script, audioCalls[0].text);

  const canonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(canonical.duration_variant_repair_strategy, "retention_target_safe_script_extension");
  assert.equal(canonical.description, "Nintendo Switch 2 Camera is discounted for Memorial Day. Source: IGN.");
  assert.doesNotMatch(canonical.narration_script, /premium access into the story|paid tier is starting to look like launch day/i);
  assert.doesNotMatch(
    canonical.narration_script,
    /Before you spend|buy now,\s*wait or skip|recommendation moves|buy,\s*download,\s*wait|wishlist,\s*download or ignore|next choice is practical/i,
  );

  const renderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(renderManifest.rendered_duration_s, 23.5);
  assert.equal(renderManifest.final_publish_render, true);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-duration_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_alignment_normalised");

  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  assert.equal(platformManifest.duration_contract_strategy, "retention_repair_short_cut");
  assert.deepEqual(platformManifest.outputs.youtube_shorts.target_duration_seconds, { min: 22, max: 30 });

  const scriptScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(scriptScorecard.story_id, "story-duration");
  assert.equal(scriptScorecard.generated_at, "2026-05-22T08:00:00.000Z");
  assert.equal(scriptScorecard.repair_basis, "duration_variant_repair");
  assert.equal(scriptScorecard.fact_lock.source_name, "IGN");
  assert.equal(scriptScorecard.safety.no_publishing_side_effects, true);
});

test("duration variant repair restores canonical script when audio regeneration fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-atomic-audio-fail-"));
  const artifactDir = await makePackage(root, "story-duration-atomic");
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const before = await fs.readJson(canonicalPath);

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-27T01:50:00.000Z",
    workOrder: { jobs: [workOrderJob("story-duration-atomic", artifactDir)] },
    provider: "local",
    alignmentMode: "whisper",
    generateTtsForStory: async () => {
      throw new Error("simulated_tts_failure");
    },
  });

  const after = await fs.readJson(canonicalPath);
  assert.equal(report.summary.failed_count, 1);
  assert.match(report.jobs[0].error, /simulated_tts_failure/);
  assert.equal(after.narration_script, before.narration_script);
  assert.equal(after.duration_variant_repaired_at, before.duration_variant_repaired_at);
});

test("duration variant repair blocks missing canonical subjects rather than inventing public copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-variant-block-"));
  const artifactDir = await makePackage(root, "blocked-story", {
    canonical: {
      canonical_subject: "",
      canonical_game: "",
      selected_title: "Gaming Deal Has One Catch",
      first_spoken_line: "A deal has one catch.",
      narration_script: "A deal has one catch.",
    },
  });

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-22T08:03:00.000Z",
    workOrder: { jobs: [workOrderJob("blocked-story", artifactDir)] },
    generateTtsForStory: async () => {
      throw new Error("audio must not run for blocked jobs");
    },
    renderProof: async () => {
      throw new Error("render must not run for blocked jobs");
    },
  });

  assert.equal(report.summary.repaired_count, 0);
  assert.equal(report.summary.blocked_count, 1);
  assert.ok(report.jobs[0].blockers.includes("missing_canonical_subject"));
});

test("duration variant repair skips stale work-order rows that already have a target-duration repaired render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-variant-skip-"));
  const artifactDir = await makePackage(root, "already-repaired", {
    canonical: {
      duration_variant_repaired_at: "2026-05-22T08:06:00.000Z",
      duration_variant_repair_strategy: "retention_target_safe_script_extension",
      narration_script:
        "Star Fox has a Switch 2 camera deal. IGN reports the Nintendo Switch 2 Camera is discounted for Memorial Day. The discount matters because Switch 2 owners need to know whether the camera is actually part of the setup. Follow Pulse Gaming for the gaming stories behind the headline.",
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "already-repaired",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 23.25,
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    buildCaptionSrt(
      "Star Fox has a Switch 2 camera deal. IGN reports the Nintendo Switch 2 Camera is discounted for Memorial Day. The discount matters because Switch 2 owners need to know whether the camera is actually part of the setup. Follow Pulse Gaming for the gaming stories behind the headline.",
      23.25,
    ),
  );

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-22T08:07:00.000Z",
    workOrder: { jobs: [workOrderJob("already-repaired", artifactDir)] },
    generateTtsForStory: async () => {
      throw new Error("audio must not rerun for already repaired jobs");
    },
    renderProof: async () => {
      throw new Error("render must not rerun for already repaired jobs");
    },
  });

  assert.equal(report.summary.repaired_count, 0);
  assert.equal(report.summary.warning_held_count, 0);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.summary.skipped_existing_count + report.summary.caption_repaired_count, 1);
  assert.match(report.jobs[0].status, /^(skipped_existing_duration_repair|captions_repaired_existing_duration_repair)$/);
});

test("duration variant repair does not churn safe gameplay-source claims into short warning renders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-variant-gameplay-skip-"));
  const artifactDir = await makePackage(root, "expanse-already-safe", {
    canonical: {
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      thumbnail_headline: "THE EXPANSE GAMEPLAY",
      first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
      narration_script: [
        "The Expanse: Osiris Reborn finally has real gameplay on screen.",
        "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
        "The catch is why mission flow matters: a famous universe only helps if the gunfights, camera weight and scale hold up outside a trailer cut.",
        "The sharper question is whether this feels like The Expanse, not just another sci-fi shooter wearing the name.",
        "Short showcases can sell impact, but mission flow will decide whether players trust the reveal.",
        "If the full missions keep that pace, this could become more than another licensed announcement.",
        "Follow Pulse Gaming so you never miss a beat.",
      ].join(" "),
      primary_source: "Xbox",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
      public_copy_repaired_at: "2026-05-28T17:22:22.489Z",
      duration_variant_repaired_at: "2026-05-28T17:37:54.808Z",
      duration_variant_repair_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "expanse-already-safe",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 44.98,
  });

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-28T17:46:00.000Z",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("expanse-already-safe", artifactDir),
          repair_lane: "normal_production_duration_floor",
          current_duration_s: 32.333,
          target_duration_seconds: { min: 35, max: 59 },
          source_blockers: ["normal_production_duration_below_quality_floor:32"],
        },
      ],
    },
    generateTtsForStory: async () => {
      throw new Error("audio must not rerun for already safe gameplay-source claims");
    },
    renderProof: async () => {
      throw new Error("render must not rerun for already safe gameplay-source claims");
    },
  });

  assert.equal(report.summary.repaired_count, 0);
  assert.equal(report.summary.warning_held_count, 0);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.summary.skipped_existing_count + report.summary.caption_repaired_count, 1);
  assert.match(report.jobs[0].status, /^(skipped_existing_duration_repair|captions_repaired_existing_duration_repair)$/);
  const scorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(scorecard.fact_lock.source_name, "Xbox");
  assert.deepEqual(scorecard.blockers, []);
});

test("duration variant repair reruns existing repairs when public copy is newer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-public-copy-newer-"));
  const artifactDir = await makePackage(root, "hades-public-copy-newer", {
    canonical: {
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      thumbnail_headline: "HADES II CONSOLE DATE",
      first_spoken_line: "Hades II just put PlayStation and Xbox players on the same April countdown.",
      narration_script:
        "Hades II just put PlayStation and Xbox players on the same April countdown. Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. The feel is the pressure point: laggy dodges would blunt Hades II. Follow Pulse Gaming so you never miss a beat.",
      full_script:
        "Hades II just put PlayStation and Xbox players on the same April countdown. Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. The feel is the pressure point: laggy dodges would blunt Hades II. Follow Pulse Gaming so you never miss a beat.",
      tts_script:
        "Hades II just put PlayStation and Xbox players on the same April countdown. Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. The feel is the pressure point: laggy dodges would blunt Hades II. Follow Pulse Gaming so you never miss a beat.",
      primary_source: "Xbox",
      official_source: "Xbox",
      confirmed_claims: ["Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date."],
      public_copy_repaired_at: "2026-05-27T02:11:50.000Z",
      duration_variant_repaired_at: "2026-05-26T23:00:00.000Z",
      duration_variant_repair_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "hades-public-copy-newer",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 23.25,
  });

  const audioCalls = [];
  const renderCalls = [];
  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-27T02:13:00.000Z",
    workOrder: {
      jobs: [
        workOrderJob("hades-public-copy-newer", artifactDir),
      ],
    },
    alignmentMode: "off",
    provider: "local",
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push(text);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 5));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      renderCalls.push(story);
      await fs.outputFile(output, Buffer.alloc(8192, 6));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 23.5,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(audioCalls.length, 1);
  assert.equal(renderCalls.length, 1);
  assert.match(audioCalls[0], /PC early-access story|console footnote/i);
  assert.doesNotMatch(audioCalls[0], /instant inputs|real question is brutal/i);
});

test("normal duration repair trusts stale-duration blocker over old render manifest duration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-stale-metadata-"));
  const artifactDir = await makePackage(root, "stale-duration-story", {
    canonical: {
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      thumbnail_headline: "EXPANSE GAMEPLAY",
      first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
      narration_script: [
        "The Expanse: Osiris Reborn finally showed real gameplay.",
        "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
        "The catch is what this changes after the reveal.",
        "Players need to see whether this is an RPG with pressure or a licensed montage.",
        "Follow Pulse Gaming so you never miss a beat.",
      ].join(" "),
      full_script: "",
      tts_script: "",
      primary_source: "Xbox",
      official_source: "Xbox",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "stale-duration-story",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 47.7,
  });

  const audioCalls = [];
  const renderCalls = [];
  const job = {
    ...workOrderJob("stale-duration-story", artifactDir),
    current_duration_s: 19.68,
    target_duration_seconds: { min: 35, max: 59 },
    source_blockers: [
      "preflight_qa_blocked:video:duration_too_short (19.68s)",
      "preflight_qa_blocked:bridge_artifact_freshness:bridge_metadata_stale:duration_seconds",
    ],
  };

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-22T16:25:00.000Z",
    workOrder: { jobs: [job] },
    provider: "local",
    alignmentMode: "off",
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push(text);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 7));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      renderCalls.push(story);
      await fs.outputFile(output, Buffer.alloc(8192, 8));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: simpleWordCount(story.full_script) >= 116 ? 36.2 : 29.8,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(report.jobs[0].original_duration_s, 19.68);
  assert.ok(report.jobs[0].appended_word_count > 0);
  assert.ok(report.jobs[0].repaired_word_count >= 116, audioCalls[0]);
  assert.equal(audioCalls.length, 1);
  assert.equal(renderCalls.length, 1);
});

test("duration variant repair reruns existing repairs with noncanonical protected brand names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-protected-brand-"));
  const artifactDir = await makePackage(root, "pokemon-duration-brand", {
    canonical: {
      canonical_subject: "Pokemon Go",
      canonical_game: "Pokemon Go",
      selected_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
      thumbnail_headline: "POKEMON GO MEGA MEWTWO",
      first_spoken_line: "Mega Mewtwo is finally coming to Pokemon Go.",
      narration_script:
        "Mega Mewtwo is finally coming to Pokemon Go. Eurogamer reports Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players. Niantic now has to make the raid timing clear for players. Follow Pulse Gaming for the gaming stories behind the headline.",
      full_script:
        "Mega Mewtwo is finally coming to Pokemon Go. Eurogamer reports Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players. Niantic now has to make the raid timing clear for players. Follow Pulse Gaming for the gaming stories behind the headline.",
      tts_script:
        "Mega Mewtwo is finally coming to Pokemon Go. Eurogamer reports Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players. Niantic now has to make the raid timing clear for players. Follow Pulse Gaming for the gaming stories behind the headline.",
      duration_variant_repaired_at: "2026-05-25T04:00:00.000Z",
      duration_variant_repair_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
      primary_source: "Eurogamer",
      confirmed_claims: [
        "Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players.",
      ],
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "pokemon-duration-brand",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 41.2,
  });

  const audioCalls = [];
  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-25T05:55:00.000Z",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("pokemon-duration-brand", artifactDir),
          current_duration_s: 18.08,
          target_duration_seconds: { min: 35, max: 59 },
        },
      ],
    },
    provider: "local",
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push(text);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 5));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 6));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 42.5,
        size_bytes: 8192,
      };
    },
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(audioCalls.length, 1);
  assert.match(updated.narration_script, /Pokémon Go/);
  assert.doesNotMatch(updated.narration_script, /\bPokemon\b/);
  assert.match(updated.thumbnail_headline, /POKÉMON GO/i);
});

test("duration variant repair refreshes stale captions on otherwise valid existing repairs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-captions-refresh-"));
  const artifactDir = await makePackage(root, "captions-refresh", {
    canonical: {
      duration_variant_repaired_at: "2026-05-23T08:30:00.000Z",
      duration_variant_repair_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
      narration_script:
        "Forza Horizon 6 just turned its Steam launch into an Xbox signal. IGN reports Forza Horizon 6 is already being framed as a major Steam success for Xbox. Follow Pulse Gaming for the gaming stories behind the headline.",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
      thumbnail_headline: "FORZA HORIZON 6 STEAM",
      primary_source: "IGN",
      confirmed_claims: ["Forza Horizon 6 is already being framed as a major Steam success for Xbox."],
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "captions-refresh",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 49.551,
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    "1\n00:00:00,000 --> 00:00:07,000\nOld stale caption.\n",
  );

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-23T08:35:00.000Z",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("captions-refresh", artifactDir),
          current_duration_s: 21.366,
          target_duration_seconds: { min: 35, max: 59 },
        },
      ],
    },
    generateTtsForStory: async () => {
      throw new Error("audio must not rerun for caption-only refresh");
    },
    renderProof: async () => {
      throw new Error("render must not rerun for caption-only refresh");
    },
  });

  assert.equal(report.summary.caption_repaired_count, 1);
  assert.equal(report.jobs[0].status, "captions_repaired_existing_duration_repair");
  const captions = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  assert.match(captions, /Forza Horizon 6 just turned its Steam launch into an Xbox signal/);
  assert.match(captions, /00:00:49,551/);
});

test("duration variant repair refreshes normal publish duration windows on existing repairs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-existing-"));
  const artifactDir = await makePackage(root, "normal-contract-existing", {
    canonical: {
      duration_variant_repaired_at: "2026-05-23T08:30:00.000Z",
      duration_variant_repair_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
      narration_script:
        "Forza Horizon 6 just turned its Steam launch into an Xbox signal. IGN reports Forza Horizon 6 is already being framed as a major Steam success for Xbox. Follow Pulse Gaming for the gaming stories behind the headline.",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
      thumbnail_headline: "FORZA HORIZON 6 STEAM",
      primary_source: "IGN",
      confirmed_claims: ["Forza Horizon 6 is already being framed as a major Steam success for Xbox."],
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "normal-contract-existing",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 54.3,
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    [
      "1",
      "00:00:00,000 --> 00:00:18,100",
      "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
      "",
      "2",
      "00:00:18,100 --> 00:00:36,200",
      "IGN reports Forza Horizon 6 is already being framed as a major Steam success for Xbox.",
      "",
      "3",
      "00:00:36,200 --> 00:00:54,300",
      "Follow Pulse Gaming for the gaming stories behind the headline.",
      "",
    ].join("\n"),
  );

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-23T08:45:00.000Z",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("normal-contract-existing", artifactDir),
          current_duration_s: 54.3,
          target_duration_seconds: { min: 35, max: 59 },
        },
      ],
    },
    generateTtsForStory: async () => {
      throw new Error("audio must not rerun for contract-only refresh");
    },
    renderProof: async () => {
      throw new Error("render must not rerun for contract-only refresh");
    },
  });

  assert.equal(report.summary.skipped_existing_count, 1);

  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  assert.deepEqual(platformManifest.outputs.youtube_shorts.publish_duration_seconds, { min: 15, max: 60 });
  assert.deepEqual(platformManifest.outputs.tiktok.publish_duration_seconds, { min: 15, max: 90 });
  assert.equal(platformManifest.outputs.tiktok.creator_rewards_eligible, false);
  assert.ok(platformManifest.outputs.tiktok.duration_warnings.includes("below_creator_rewards_duration"));
  assert.deepEqual(platformManifest.outputs.tiktok.strategic_duration_seconds, { min: 35, max: 59 });
});

test("duration variant repair reruns existing normal repairs above scheduler-safe max", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-variant-rerun-long-"));
  const artifactDir = await makePackage(root, "too-long-existing", {
    canonical: {
      duration_variant_repaired_at: "2026-05-22T08:06:00.000Z",
      duration_variant_repair_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "too-long-existing",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 59.84,
  });
  const audioCalls = [];

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-22T08:08:00.000Z",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("too-long-existing", artifactDir),
          current_duration_s: 59.84,
          target_duration_seconds: { min: 35, max: 59 },
        },
      ],
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 7));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 8));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 57.5,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.skipped_existing_count, 0);
  assert.equal(report.summary.repaired_count, 1);
  assert.equal(audioCalls.length, 1);
  assert.equal(report.jobs[0].repaired_duration_s, 57.5);
});

test("duration variant repair reruns existing normal repairs with content signal blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-variant-content-"));
  const artifactDir = await makePackage(root, "content-existing", {
    canonical: {
      duration_variant_repaired_at: "2026-05-22T08:06:00.000Z",
      duration_variant_repair_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
      narration_script:
        "Warhammer 40,000: Boltgun Boom just turned the showcase into a watchlist story. GameSpot is the source for the confirmed claim.",
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "content-existing",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 47.68,
  });
  const audioCalls = [];

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-22T08:09:00.000Z",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("content-existing", artifactDir),
          repair_lane: "normal_production_content_signal_repair",
          current_duration_s: 47.68,
          target_duration_seconds: { min: 35, max: 59 },
          source_blockers: [
            "preflight_qa_blocked:content:pulse_gaming_no_gaming_topic_signal",
            "preflight_qa_blocked:content:approved_voice:spoken_outro_missing",
          ],
        },
      ],
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push(text);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 9));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 10));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 45.5,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.skipped_existing_count, 0);
  assert.equal(report.summary.repaired_count, 1);
  assert.match(audioCalls[0], /\bgaming\b|\bgame\b/i);
  assert.match(audioCalls[0], /Follow Pulse Gaming/);
});

test("duration variant repair reruns existing normal repairs when the script scorecard still blocks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-scorecard-blocker-"));
  const artifactDir = await makePackage(root, "scorecard-blocked-existing", {
    canonical: {
      canonical_subject: "Star Wars: Galactic Racer",
      canonical_game: "Star Wars: Galactic Racer",
      selected_title: "Star Wars Racer Date Leaked Early",
      first_spoken_line: "Star Wars: Galactic Racer may have leaked its own release date.",
      narration_script:
        "Star Wars: Galactic Racer may have leaked its own release date. Rock Paper Shotgun reports Chuba! Star Wars: Galactic Racer's release date has been accidentally revealed early. Star Wars: Galactic Racer now has a date leak attached to the nostalgia. A date leak is not the sell; the old arcade energy has to come back too. Follow Pulse Gaming so you never miss a beat.",
      primary_source: "Rock Paper Shotgun",
      source_card_label: "Rock Paper Shotgun",
      confirmed_claims: ["Star Wars: Galactic Racer's release date has been accidentally revealed early."],
      duration_variant_repaired_at: "2026-05-28T20:19:38.875Z",
      duration_variant_repair_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "scorecard-blocked-existing",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 43.523,
  });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "rewrite_required",
    blockers: ["repeated_phrase"],
    warnings: [],
  });
  const audioCalls = [];

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-28T20:30:00.000Z",
    provider: "local",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("scorecard-blocked-existing", artifactDir),
          current_duration_s: 43.523,
          target_duration_seconds: { min: 35, max: 59 },
        },
      ],
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push(text);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 11));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 12));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 43.5,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.skipped_existing_count, 0);
  assert.equal(report.summary.repaired_count, 1);
  assert.equal(audioCalls.length, 1);
  assert.doesNotMatch(audioCalls[0], /Star Wars: Galactic Racer now has a date leak attached|A date leak is not the sell/i);
  assert.ok(!report.jobs[0].script_scorecard.blockers.includes("repeated_phrase"), JSON.stringify(report.jobs[0].script_scorecard));
});

test("duration variant repair reruns existing normal repairs with stale filler even when duration is in range", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-stale-filler-"));
  const artifactDir = await makePackage(root, "stale-filler-existing", {
    canonical: {
      duration_variant_repaired_at: "2026-05-23T07:29:48.797Z",
      duration_variant_repair_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
      narration_script:
        "Forza Horizon 6 just turned its Steam launch into an Xbox signal. IGN reports Forza Horizon 6 is already being framed as a major Steam success for Xbox. The watch point is whether Steam attention changes how Xbox times the wider launch push. Follow Pulse Gaming for the gaming stories behind the headline. The detail to watch is timing: when Forza Horizon 6 appears and which platforms are actually included. That matters more than the headline if you are deciding what to wishlist, download or ignore next. A trailer is useful, but the release window and platform list decide whether this becomes day-one news. If the next official update adds pricing, access or a date, that is the version that deserves the bigger push. IGN leaves one player-facing detail to track: Forza Horizon 6 is already being framed as a major Steam success for Xbox..",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
      primary_source: "IGN",
      confirmed_claims: ["Forza Horizon 6 is already being framed as a major Steam success for Xbox."],
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "stale-filler-existing",
    renderer: "visual_v4_production",
    final_publish_render: true,
    rendered_duration_s: 57.957,
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    "1\n00:00:00,000 --> 00:00:07,000\nFollow Pulse Gaming for the gaming stories behind the headline.\n",
  );
  const audioCalls = [];

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-23T08:20:00.000Z",
    provider: "elevenlabs",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("stale-filler-existing", artifactDir),
          current_duration_s: 21.366,
          target_duration_seconds: { min: 35, max: 59 },
        },
      ],
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push(text);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 16));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 17));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 55.5,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(audioCalls.length, 1);
  assert.ok(audioCalls[0].split(/\s+/).length <= 155);
  assert.match(audioCalls[0], /Follow Pulse Gaming(?: so you never miss a beat| for the gaming stories behind the headline)\.$/);
  assert.doesNotMatch(
    audioCalls[0],
    /player-facing detail|source for the confirmed claim|stays a gaming story|Before you spend|\.\./i,
  );
  const captions = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  assert.match(captions, /Forza Horizon 6 just turned its Steam launch into an Xbox signal/);
  assert.match(captions, /Follow Pulse Gaming/);
  assert.match(captions, /00:00:55,500/);
  assert.doesNotMatch(captions, /player-facing detail|\.\./i);
});

test("duration variant repair can target the normal production duration floor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-normal-floor-"));
  const artifactDir = await makePackage(root, "normal-floor-story");
  const audioCalls = [];

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-22T09:00:00.000Z",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("normal-floor-story", artifactDir),
          current_duration_s: 18.25,
          target_duration_seconds: { min: 35, max: 59 },
          minimum_extension_seconds: 16.75,
        },
      ],
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      audioCalls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 5));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 6));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 36.25,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(report.summary.warning_held_count, 0);
  assert.equal(audioCalls.length, 1);
  assert.ok(audioCalls[0].text.split(/\s+/).length >= 85);
  assert.ok(audioCalls[0].text.split(/\s+/).length <= 132);
  const canonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(canonical.duration_variant_repair_strategy, NORMAL_PRODUCTION_REPAIR_STRATEGY);
  assert.deepEqual(canonical.duration_variant_target_duration_seconds, { min: 35, max: 59 });
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  assert.equal(platformManifest.duration_contract_strategy, NORMAL_PRODUCTION_REPAIR_STRATEGY);
  assert.equal(platformManifest.duration_lane, "normal_production");
  assert.equal(platformManifest.retention_short_approved, false);
  assert.deepEqual(platformManifest.outputs.youtube_shorts.target_duration_seconds, { min: 35, max: 59 });
});

test("duration variant repair outputs public-safe narration instead of instruction-like padding", () => {
  const dealRepair = assertDurationRepairPublicCopyPass({
    canonical_subject: "Star Fox",
    canonical_game: "Star Fox",
    selected_title: "Star Fox Deal Has One Catch",
    narration_script:
      "Star Fox has a Switch 2 camera deal. IGN reports the Nintendo Switch 2 Camera is discounted for Memorial Day. Check the price and platform details before you buy.",
    primary_source: "IGN",
    confirmed_claims: ["Nintendo Switch 2 Camera is discounted for Memorial Day"],
  });
  assert.match(dealRepair.script, /entry point|current listing/i);
  assert.doesNotMatch(dealRepair.script, /the headline is only useful|keep the edit|not pressure to buy|before you spend/i);

  const showcaseRepair = assertDurationRepairPublicCopyPass({
    canonical_subject: "The Expanse: Osiris Reborn",
    canonical_game: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    primary_source: "Xbox",
    official_source: "Xbox",
    confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
  });
  assert.match(showcaseRepair.script, /camera|gunfights|scale/i);
  assert.doesNotMatch(showcaseRepair.script, /the useful shift|next test|footage matters here|proof|pitch lives or dies/i);

  const jobsRepair = assertDurationRepairPublicCopyPass({
    canonical_subject: "Deus Ex",
    canonical_game: "Deus Ex",
    selected_title: "Deus Ex Composer Says The Jobs Vanished",
    narration_script:
      "Deus Ex composer says the jobs vanished. PC Gamer reports he submitted 50 resumes and got one interview in the last year.",
    primary_source: "PC Gamer",
    confirmed_claims: [
      "A Deus Ex and Unreal composer said he submitted 50 resumes and got one interview in the last year.",
    ],
  });
  assert.match(jobsRepair.script, /hiring market|credited specialists/i);
  assert.doesNotMatch(jobsRepair.script, /brutal jobs story|veteran credits are still fighting|which projects get staffed/i);
});

test("duration variant repair respects source scope for current production failure classes", () => {
  const vRisingRepair = assertDurationRepairPublicCopyPass({
    canonical_subject: "V Rising",
    canonical_game: "V Rising",
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    narration_script:
      "V Rising's developers are already building another vampire game. Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update.",
    primary_source: "Stunlock Studios",
    confirmed_claims: [
      "Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update.",
    ],
  });
  assert.doesNotMatch(vRisingRepair.script, /Frame-rate clips|matchmaking|If the fix misses|patch notes/i);

  const subnauticaRepair = assertDurationRepairPublicCopyPass({
    canonical_subject: "Subnautica 2",
    canonical_game: "Subnautica 2",
    selected_title: "Subnautica 2 Dev Calls Out Leakers",
    narration_script:
      "Subnautica 2's developer is already fighting leaked builds. Respawnfirst reports A Subnautica 2 developer responded after leaked builds started spreading before launch.",
    primary_source: "Respawnfirst",
    confirmed_claims: [
      "A Subnautica 2 developer responded after leaked builds started spreading before launch.",
    ],
  });
  assert.doesNotMatch(subnauticaRepair.script, /hiring market|credited specialists|audio teams|earnings call/i);

  const reviewRepair = assertDurationRepairPublicCopyPass({
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Tops Metacritic This Year",
    narration_script:
      "Forza Horizon 6 just landed a strong PC Gamer review. Metacritic reports Forza Horizon 6 is Metacritic's highest-rated game of the year.",
    primary_source: "Metacritic",
    confirmed_claims: ["Forza Horizon 6 is Metacritic's highest-rated game of the year."],
  });
  assert.doesNotMatch(reviewRepair.script, /handling|performance|progression|world still feels fresh|PC Gamer review/i);

  const racerRepair = assertDurationRepairPublicCopyPass({
    canonical_subject: "Star Wars: Galactic Racer",
    canonical_game: "Star Wars: Galactic Racer",
    selected_title: "Star Wars Racer Date Leaked Early",
    narration_script:
      "Star Wars: Galactic Racer may have leaked its own release date. Rock Paper Shotgun reports Chuba! Star Wars: Galactic Racer's release date has been accidentally revealed early.",
    primary_source: "Rock Paper Shotgun",
    confirmed_claims: ["Star Wars: Galactic Racer's release date has been accidentally revealed early."],
  });
  assert.doesNotMatch(racerRepair.script, /handling|tracks|sanding off|full mission/i);
  const racerScorecard = buildViralScriptIntelligence({
    story_id: "star-wars-racer-date-leak",
    selected_title: "Star Wars Racer Date Leaked Early",
    canonical_subject: "Star Wars: Galactic Racer",
    first_spoken_line: racerRepair.script.split(/(?<=[.!?])\s+/)[0],
    narration_script: racerRepair.script,
    full_script: racerRepair.script,
    primary_source: "Rock Paper Shotgun",
  });
  assert.ok(!racerScorecard.blockers.includes("repeated_phrase"), JSON.stringify(racerScorecard, null, 2));
  assert.ok((racerRepair.script.match(/\bdate leak\b/gi) || []).length <= 1, racerRepair.script);

  const crimsonCanonical = {
    canonical_subject: "Crimson Desert",
    canonical_game: "Crimson Desert",
    selected_title: "Crimson Desert Is Already Live",
    narration_script:
      "Crimson Desert is already live after years of glossy showcase footage. GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. Crimson Desert finally has a launch date after years of huge trailers.",
    primary_source: "GameSpot",
    confirmed_claims: ["Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing."],
  };
  const crimsonRepair = extendScriptToTarget(crimsonCanonical, {
    current_duration_s: 16,
    target_duration_seconds: { min: 35, max: 59 },
    provider: "local",
  });
  const crimsonReport = evaluateGoalPublicCopy({
    ...crimsonCanonical,
    narration_script: crimsonRepair.script,
    full_script: crimsonRepair.script,
    tts_script: crimsonRepair.script,
    first_spoken_line: crimsonRepair.script.split(/(?<=[.!?])\s+/)[0],
    thumbnail_headline: "CRIMSON DESERT IS LIVE",
    description: "Crimson Desert is out now after Pearl Abyss confirmed the launch timing. Source: GameSpot.",
  });
  assert.equal(crimsonReport.verdict, "pass", JSON.stringify(crimsonReport.failures));
  assert.match(crimsonRepair.script, /out now|shipped build/i);
  assert.doesNotMatch(crimsonRepair.script, /finally has a launch date|date attached to years|launch date after years/i);
});

test("duration variant repair expands game deals without studio-internal angle padding", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Super Mario RPG",
      canonical_game: "Super Mario RPG",
      selected_title: "Super Mario RPG Drops To $15",
      thumbnail_headline: "SUPER MARIO RPG $15 DEAL",
      first_spoken_line: "Super Mario RPG just dropped to $15 at GameStop.",
      narration_script:
        "Super Mario RPG just dropped to $15 at GameStop. GameStop lists Super Mario RPG at $15, 70% off its listed price. For anyone who skipped the physical Switch copy, that is a real pickup point while the listing holds. Follow Pulse Gaming so you never miss a beat.",
      description: "GameStop lists Super Mario RPG at $15, 70% off its listed price. Source: GameStop.",
      primary_source: "GameStop",
      confirmed_claims: ["GameStop lists Super Mario RPG at $15, 70% off its listed price."],
    },
    {
      current_duration_s: 18.567,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 120, repair.script);
  assert.ok(repair.repaired_word_count <= 132, repair.script);
  assert.match(repair.script, /Super Mario RPG/);
  assert.match(repair.script, /GameStop/);
  assert.match(repair.script, /physical Switch copy|listed price|used copy|Nintendo/i);
  assert.doesNotMatch(
    repair.script,
    /price story|clean angle|useful comparison|hard sell|accessory deals|audience watching this short|listing changes|source-backed|named source/i,
  );
  const qa = evaluateGoalPublicCopy({
    canonical_subject: "Super Mario RPG",
    canonical_game: "Super Mario RPG",
    selected_title: "Super Mario RPG Drops To $15",
    thumbnail_headline: "SUPER MARIO RPG $15 DEAL",
    first_spoken_line: "Super Mario RPG just dropped to $15 at GameStop.",
    narration_script: repair.script,
    full_script: repair.script,
    tts_script: repair.script,
    description: "GameStop lists Super Mario RPG at $15, 70% off its listed price. Source: GameStop.",
    primary_source: "GameStop",
    confirmed_claims: ["GameStop lists Super Mario RPG at $15, 70% off its listed price."],
  });
  assert.equal(qa.verdict, "pass", JSON.stringify(qa.failures));
});

test("duration variant repair strips stale formulaic filler before normal production expansion", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
      narration_script:
        "Forza Horizon 6 just turned its Steam launch into an Xbox signal. The practical question is whether this changes what people buy, wishlist, reinstall or wait on. IGN gives the story enough shape to act on without turning it into a bigger claim than it is. The confirmed bit is still the anchor: Forza Horizon 6 just broke Xbox's Steam ceiling.",
      primary_source: "IGN",
      confirmed_claims: [
        "Forza Horizon 6 is already being framed as a major Steam success for Xbox.",
      ],
    },
    {
      current_duration_s: 21.366,
      target_duration_seconds: { min: 35, max: 59 },
    },
  );

  assert.ok(repair.repaired_word_count >= 90);
  assert.ok(repair.repaired_word_count <= 125);
  assert.match(repair.script, /Forza Horizon 6/);
  assert.match(repair.script, /Steam/);
  assert.match(repair.script, /Xbox/);
  assert.match(repair.script, /Follow Pulse Gaming(?: so you never miss a beat| for the gaming stories behind the headline)\.$/);
  assert.doesNotMatch(repair.script, /\.\./);
  assert.doesNotMatch(
    repair.script,
    /the practical question is|confirmed bit is still the anchor|gives the story enough shape|what people buy, wishlist, reinstall or wait on|player-facing detail|next serious detail|launch stat becomes|source boundary|smart read|guaranteed demand/i,
  );
});

test("duration variant repair does not replace stale filler with abstract strategy filler", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Crushed Its Steam Record",
      narration_script:
        "Forza Horizon 6 just smashed its Steam launch signal. GamesRadar reports Forza Horizon 6 is already being framed as a major Steam success for Xbox.",
      primary_source: "GamesRadar",
      confirmed_claims: ["Forza Horizon 6 is already being framed as a major Steam success for Xbox."],
    },
    {
      current_duration_s: 22.4,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 116);
  assert.ok(repair.repaired_word_count <= 135);
  assert.match(repair.script, /Forza Horizon 6/);
  assert.match(repair.script, /Xbox/);
  assert.match(repair.script, /Steam/);
  assert.doesNotMatch(
    repair.script,
    /next serious detail|next meaningful signal|launch stat becomes a strategy story|smart read|source boundary|headline into guaranteed demand|story gets stronger|details hold up|past rumour talk|where a headline turns into a real player decision/i,
  );
});

test("duration variant repair removes mismatched access filler from gameplay showcase stories", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      narration_script:
        "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. The Expanse: Osiris Reborn turns premium access into the story, because the paid tier is starting to look like launch day. The tension is whether early access feels like a bonus or the real starting line. Follow Pulse Gaming for the gaming stories behind the headline.",
      primary_source: "Xbox",
      source_card_label: "Xbox",
      confirmed_claims: [
        "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
      ],
    },
    {
      current_duration_s: 44,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /The Expanse: Osiris Reborn/);
  assert.match(repair.script, /gameplay|combat|UI|footage/i);
  assert.doesNotMatch(
    repair.script,
    /premium access|paid tier|raw revenue number|bragging point|store page, official post or platform listing/i,
  );
});

test("duration variant repair expands games-industry job stories without gameplay buyer filler", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Deus Ex",
      canonical_game: "Deus Ex",
      selected_title: "Deus Ex Composer Says The Jobs Vanished",
      narration_script:
        "A Deus Ex composer says the games job market has gone brutally quiet. PC Gamer reports a Deus Ex and Unreal composer submitted 50 resumes and got one interview in the last year.",
      primary_source: "PC Gamer",
      confirmed_claims: [
        "A Deus Ex and Unreal composer submitted 50 resumes and got one interview in the last year.",
      ],
    },
    {
      current_duration_s: 22,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /job market|interviews|projects get staffed|industry/i);
  assert.doesNotMatch(
    repair.script,
    /footage,\s*price,\s*platform details|concrete gaming hook|people actually touch the game|named game and source give viewers/i,
  );
});

test("duration variant repair expands leak stories without meta filler", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Subnautica 2",
      canonical_game: "Subnautica 2",
      selected_title: "Subnautica 2 Dev Calls Out Leakers",
      narration_script:
        "Subnautica 2 is keeping one of its strangest survival rules. Respawnfirst reports Subnautica 2 Dev Responds to Pirates Leaking the Game. The hook has to stay tied to the named game, the source and the concrete detail viewers can repeat.",
      primary_source: "Respawnfirst",
      confirmed_claims: [
        'Subnautica 2 Dev Responds to Pirates Leaking the Game; "I hope you rethink your life choices"',
      ],
    },
    {
      current_duration_s: 24,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /Subnautica 2/);
  assert.match(repair.script, /leaks|unfinished footage|finished version/i);
  assert.doesNotMatch(
    repair.script,
    /short should|public output|concrete gaming hook|next beat should|hook has to stay|clearer consequence|worth tracking|buy|wishlist|download|strangest survival rule|peaceful|lawsuit, the rejection|named companies/i,
  );
});

test("duration variant repair expands community legal stories without gameplay filler", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Nintendo",
      canonical_game: "Pokemon",
      selected_title: "Nintendo Professor Lawsuit Just Got Weird",
      narration_script:
        "Nintendo Professor Lawsuit Just Got Weird. Dexerto reports An Iowa man filed a lawsuit against Nintendo of America and The Pokemon Company International after being denied Pokemon Professor status. The hook has to stay tied to the named game, the source and the concrete detail viewers can repeat.",
      primary_source: "Dexerto",
      confirmed_claims: [
        "An Iowa man filed a lawsuit against Nintendo of America and The Pokemon Company International after being denied Pokemon Professor status.",
      ],
    },
    {
      current_duration_s: 25,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /Nintendo/);
  assert.match(repair.script, /fan programme rejection|community-access dispute/i);
  assert.doesNotMatch(
    repair.script,
    /short should|public output|concrete gaming hook|next beat should|hook has to stay|clearer consequence|footage|platform detail|buy|wishlist|download/i,
  );
});

test("duration variant repair does not treat Xbox platform review wording as score coverage", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Xbox",
      canonical_game: "Xbox",
      selected_title: "Xbox Exclusives Are Back Under Review",
      narration_script:
        "Xbox exclusives are back under review at the top. Kotaku reports New Xbox CEO Is reevaluating exclusive games.",
      primary_source: "Kotaku",
      confirmed_claims: ["New Xbox CEO is reevaluating exclusive games."],
    },
    {
      current_duration_s: 24,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /exclusives|platform question|first-party/i);
  assert.doesNotMatch(repair.script, /reviews are the first real pressure test|review score|wait for player footage/i);
});

test("duration variant repair does not turn Xbox feedback stories into gameplay showcases", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Xbox",
      canonical_game: "Xbox",
      selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
      narration_script:
        "Xbox asked for feedback and immediately got the exclusives argument. IGN reports Microsoft Launches Xbox Player Voice to Gather Feedback, Fans Immediately Demand Exclusives.",
      primary_source: "IGN",
      confirmed_claims: [
        "Microsoft launched Xbox Player Voice to gather feedback and fans immediately demanded exclusives.",
      ],
    },
    {
      current_duration_s: 25,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /feedback channel|exclusives problem|trust story/i);
  assert.doesNotMatch(repair.script, /movement,\s*combat readability|logo sweep|next trailer|gameplay/i);
});

test("duration variant repair gives preview impressions a concrete angle", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Star Wars Zero Company",
      canonical_game: "Star Wars Zero Company",
      selected_title: "Star Wars Zero Company Is More Than XCOM",
      narration_script:
        "Star Wars Zero Company is trying to be more than Star Wars XCOM. PC Gamer reports Star Wars Zero Company is more than just Star Wars XCOM; it feels like Mass Effect but with turn-based tactics and permadeath.",
      primary_source: "PC Gamer",
      confirmed_claims: [
        "Star Wars Zero Company feels like Mass Effect but with turn-based tactics and permadeath.",
      ],
    },
    {
      current_duration_s: 24,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /squad pressure|Mass Effect comparison|Permadeath/i);
  assert.doesNotMatch(repair.script, /needs more than a headline|strongest version|vague sense that news happened/i);
});

test("duration variant repair does not reintroduce internal source-policy language after source attribution repair", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Reviews Are In",
      narration_script:
        "Forza Horizon 6 reviews are finally in. PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in. Strong reviews matter here because this is when fence-sitters decide whether another Horizon is enough. Follow Pulse Gaming for the gaming stories behind the headline.",
      primary_source: "PC Gamer",
      source_card_label: "PC Gamer",
      confirmed_claims: [
        "PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in.",
      ],
    },
    {
      current_duration_s: 16,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 120);
  assert.ok(repair.repaired_word_count <= 135);
  assert.match(repair.script, /Forza Horizon 6/);
  assert.match(repair.script, /PC Gamer/);
  assert.doesNotMatch(
    repair.script,
    /source line|confirmed claim is simple|source-backed|named source|source-confirmed|player decision is the reason|worth the extra seconds|interesting to urgent|the clean source line/i,
  );
});

test("duration variant repair expands ownership-pressure stories without generic repair filler", () => {
  const canonical = {
    canonical_subject: "Kadokawa",
    canonical_game: "Kadokawa",
    selected_title: "Kadokawa Stake Just Passed Sony",
    thumbnail_headline: "KADOKAWA STAKE FIGHT",
    first_spoken_line: "Kadokawa's activist investor now has a bigger stake than Sony.",
    narration_script:
      "Kadokawa's activist investor now has a bigger stake than Sony. Automaton West reported that Oasis Management raised its Kadokawa stake to 11.85%, exceeding Sony's stake. The player-facing part is control: ownership pressure can change which projects get funded, delayed or pushed wider. Follow Pulse Gaming so you never miss a beat.",
    description: "Oasis Management raised its Kadokawa stake to 11.85%, exceeding Sony's stake. Source: Automaton West.",
    primary_source: "Automaton West",
    confirmed_claims: [
      "Oasis Management raised its Kadokawa stake to 11.85%, exceeding Sony's stake.",
    ],
  };
  const repair = extendScriptToTarget(canonical, {
    repair_lane: "normal_production_duration_floor",
    current_duration_s: 21.44,
    target_duration_seconds: { min: 35, max: 59 },
    provider: "local",
  });
  const qa = evaluateGoalPublicCopy({
    ...canonical,
    narration_script: repair.script,
    full_script: repair.script,
    tts_script: repair.script,
    first_spoken_line: repair.script.split(/(?<=[.!?])\s+/)[0],
  });

  assert.ok(repair.repaired_word_count >= 118, repair.script);
  assert.ok(repair.repaired_word_count <= 135, repair.script);
  assert.equal(qa.verdict, "pass", JSON.stringify(qa.failures));
  assert.match(repair.script, /Oasis Management|Sony|Kadokawa/);
  assert.match(repair.script, /Anime|Elden Ring|FromSoftware|publishing/i);
  assert.doesNotMatch(
    repair.script,
    /one concrete change worth remembering|clean shape|source visible|extra lore|combat rhythm|camera weight|source-backed|named source/i,
  );
});

test("duration variant content-signal repair keeps normal production headroom while removing source-policy language", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Reviews Are In",
      narration_script:
        "Forza Horizon 6 reviews are finally in. PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in. PC Gamer is the source line, and the player decision is the reason this is worth the extra seconds. The confirmed claim is simple: PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in. Follow Pulse Gaming for the gaming stories behind the headline.",
      primary_source: "PC Gamer",
      source_card_label: "PC Gamer",
      confirmed_claims: [
        "PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in.",
      ],
    },
    {
      repair_lane: "normal_production_content_signal_repair",
      current_duration_s: 44.8,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 116);
  assert.ok(repair.repaired_word_count <= 135);
  assert.match(repair.script, /Forza Horizon 6/);
  assert.match(repair.script, /PC Gamer/);
  assert.doesNotMatch(
    repair.script,
    /source line|confirmed claim is simple|source-backed|named source|player decision is the reason|worth the extra seconds/i,
  );
});

test("duration variant repair can regenerate normal production narration with ElevenLabs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-elevenlabs-"));
  const artifactDir = await makePackage(root, "elevenlabs-normal-floor");
  const providers = [];

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-23T08:00:00.000Z",
    provider: "elevenlabs",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("elevenlabs-normal-floor", artifactDir),
          current_duration_s: 23.7,
          target_duration_seconds: { min: 35, max: 59 },
          minimum_extension_seconds: 11.3,
        },
      ],
    },
    generateTtsForStory: async ({ text, outputPath, provider }) => {
      providers.push(provider);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 11));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 12));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 38.5,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.repaired_count, 1);
  assert.deepEqual(providers, ["elevenlabs"]);
  assert.equal(report.safety.external_tts_provider_used, "elevenlabs");

  const audioManifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
  assert.equal(audioManifest.voice_provider, "elevenlabs");
  assert.equal(audioManifest.safety.external_tts_provider_used, "elevenlabs");
});

test("duration variant repair recognises rights-approved screenshot-derived motion clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-screenshot-motion-"));
  const artifactDir = await makePackage(root, "screenshot-motion-floor");
  const stillPath = path.join(artifactDir, "steam-screenshot.jpg");
  const clipPath = path.join(root, "output", "video_cache", "screenshot-motion-floor_v4_still_1.mp4");
  await fs.outputFile(stillPath, Buffer.alloc(4096, 18));
  await fs.outputFile(clipPath, Buffer.alloc(8192, 19));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    failures: [],
    records: [
      {
        asset_id: "steam-shot-1",
        kind: "visual",
        asset_type: "visual_still",
        type: "steam_screenshot",
        path: stillPath,
        source_url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145350/ss_test.jpg",
        source_type: "steam_screenshot",
        source_family: "steam_screenshot_1145350_gameplay_still_1",
        licence_basis: "steam_storefront_promotional_editorial_use",
        allowed_use: "screenshot_derived_editorial_motion",
        commercial_use_allowed: true,
        risk_score: 0.28,
        approval_status: "approved_for_transformative_editorial_use",
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    schema_version: 1,
    story_id: "screenshot-motion-floor",
    status: "ready",
    clips: [
      {
        id: "steam-shot-1",
        path: clipPath,
        local_materialized_path: clipPath,
        source_url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145350/ss_test.jpg",
        source_type: "steam_screenshot",
        source_family: "steam_screenshot_1145350_gameplay_still_1",
        media_kind: "visual_still",
        rights_basis: "steam_storefront_promotional_editorial_use",
        counts_towards_motion_readiness: true,
        materialized: true,
      },
    ],
    distinct_motion_families: ["steam_screenshot_1145350_gameplay_still_1"],
  });
  const renderedStories = [];

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-23T09:00:00.000Z",
    provider: "elevenlabs",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("screenshot-motion-floor", artifactDir),
          current_duration_s: 23.7,
          target_duration_seconds: { min: 35, max: 59 },
        },
      ],
    },
    generateTtsForStory: async ({ text, outputPath, provider }) => {
      assert.equal(provider, "elevenlabs");
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 20));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      renderedStories.push(story);
      await fs.outputFile(output, Buffer.alloc(8192, 21));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 38.5,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(report.summary.blocked_count, 0);
  assert.equal(renderedStories[0].video_clips[0], clipPath);
});

test("duration variant repair repairs stale fail rights ledgers when assets already carry evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-rights-repair-"));
  const artifactDir = await makePackage(root, "rights-repair-normal-floor");
  const clipPath = path.join(artifactDir, "clip-rights.mp4");
  await fs.outputFile(clipPath, Buffer.alloc(4096, 13));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "fail",
    failures: ["rights:no_rights_record"],
    assets: [
      {
        asset_id: "rights-repair-clip",
        kind: "video",
        type: "motion_clip",
        path: clipPath,
        source_url: "https://example.com/official-trailer.mp4",
        source_type: "official_direct_media",
        rights_risk_class: "official_reference_only",
        trusted_source_matched: true,
      },
    ],
  });

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-23T08:10:00.000Z",
    provider: "elevenlabs",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("rights-repair-normal-floor", artifactDir),
          current_duration_s: 23.7,
          target_duration_seconds: { min: 35, max: 59 },
        },
      ],
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 14));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 15));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 37.25,
        size_bytes: 8192,
      };
    },
  });

  assert.equal(report.summary.repaired_count, 1);
  const rightsLedger = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rightsLedger.verdict, "pass");
  assert.equal(rightsLedger.records.length, 2);
  assert.ok(rightsLedger.records.some((record) => record.licence_basis === "official_reference_only"));
  assert.ok(rightsLedger.records.some((record) => record.asset_type === "narration_audio"));
  assert.equal(await fs.pathExists(path.join(artifactDir, "rights_ledger.json.pre_duration_variant_repair.json")), true);
});

test("duration variant repair can add a second normal-production pass to already extended scripts", async () => {
  const base = [
    "Star Fox has a Switch 2 camera deal.",
    "IGN reports the Nintendo Switch 2 Camera is discounted for Memorial Day.",
    "Check the price and platform details before you buy.",
    "Before you spend, check the live price, the platform listing and whether the deal is still active.",
    "Star Fox is the hook, but the decision is simpler: buy now, wait or skip it until the next confirmed listing.",
    "If the listing moves again, the recommendation moves with it.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "Star Fox",
      canonical_game: "Star Fox",
      selected_title: "Star Fox Deal Has One Catch",
      narration_script: base,
      primary_source: "IGN",
      confirmed_claims: ["Nintendo Switch 2 Camera is discounted for Memorial Day"],
    },
    {
      current_duration_s: 31.6,
      target_duration_seconds: { min: 35, max: 60 },
    },
  );

  assert.ok(repair.repaired_word_count >= 90);
  assert.ok(repair.repaired_word_count <= 125);
  assert.ok(repair.appended_word_count > 0);
  assert.match(repair.script, /live price|platform listing/i);
  assert.doesNotMatch(
    repair.script,
    /the practical question is whether|the confirmed bit(?: from [^.]+)? is still the anchor|gives the story enough shape/i,
  );
});

test("duration variant repair gives short normal-production scripts enough local TTS headroom", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      narration_script:
        "Hades II just changed the PlayStation conversation. Sony says Hades II is coming to PlayStation 5. That is the first hard platform detail players have been waiting for.",
      primary_source: "PlayStation Blog",
      confirmed_claims: ["Hades II is coming to PlayStation 5."],
    },
    {
      current_duration_s: 14.4,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 120);
  assert.ok(repair.repaired_word_count <= 132);
  assert.match(repair.script, /Hades II/);
  assert.match(repair.script, /PlayStation Blog|PlayStation 5/);
  assert.doesNotMatch(repair.script, /port lands crisp|in public within hours|instant inputs|real question is brutal/i);
  assert.match(repair.script, /tight dodge timing|broken builds spreading fast/i);
  assert.match(repair.script, /console port lands sharp|same obsession at once/i);
  assert.doesNotMatch(repair.script, /both communities/i);
  assert.doesNotMatch(
    repair.script,
    /the watch point|the detail to watch|keeps the story bounded|without making it bigger than the evidence|the useful test|the only firm read|the narrow version of the story|the next useful signal/i,
  );
});

test("duration variant repair expands PS5 price hikes without discount filler", () => {
  const canonical = {
    story_id: "ps5-price-rise",
    canonical_subject: "PS5",
    canonical_game: "PS5",
    selected_title: "PS5 Prices Went Up In Europe",
    thumbnail_headline: "PS5 PRICE RISE",
    first_spoken_line: "PS5 prices went up across Europe and the UK.",
    narration_script:
      "PS5 prices went up across Europe and the UK. PlayStation Blog reports Sony announced updated PS5, PS5 Digital Edition, PS5 Pro and PlayStation Portal recommended retail prices effective April 2, 2026, including Europe and the UK. That lands hardest on new buyers in markets where the console was already a premium purchase. PS5 is a price story because the cost of jumping in has changed. If the listing changes, the story changes with it. Anyone already building that setup now has a lower entry point. The clean angle is the discount, the platform and whether it fits the audience watching this short. Right now the news is the offer itself, not a hard sell. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "PS5 prices went up across Europe and the UK. PlayStation Blog reports Sony announced updated PS5, PS5 Digital Edition, PS5 Pro and PlayStation Portal recommended retail prices effective April 2, 2026, including Europe and the UK. That lands hardest on new buyers in markets where the console was already a premium purchase. PS5 is a price story because the cost of jumping in has changed. If the listing changes, the story changes with it. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Sony announced updated PS5, PS5 Digital Edition, PS5 Pro and PlayStation Portal recommended retail prices effective April 2, 2026, including Europe and the UK. Source: PlayStation Blog.",
    primary_source: "PlayStation Blog",
    confirmed_claims: [
      "Sony announced updated PS5, PS5 Digital Edition, PS5 Pro and PlayStation Portal recommended retail prices effective April 2, 2026, including Europe and the UK.",
    ],
  };

  const repair = extendScriptToTarget(canonical, {
    current_duration_s: 25.6,
    target_duration_seconds: { min: 35, max: 59 },
  });

  assert.match(repair.script, /new buyers|premium purchase|price/i);
  assert.doesNotMatch(repair.script, /discount|lower entry point|offer itself|deal is live|savings?/i);
  assert.doesNotMatch(repair.script, /price story because|listing changes/i);
  assert.doesNotMatch(repair.script, /trade-in|trade in offers/i);
  assert.match(repair.script, /For new players, PS5 just became harder to buy\./);
  const qa = evaluateGoalPublicCopy({
    ...canonical,
    narration_script: repair.script,
    full_script: repair.script,
    tts_script: repair.script,
    description: canonical.description,
  });
  assert.equal(qa.verdict, "pass", JSON.stringify(qa.failures));
});

test("duration variant repair turns tactics-preview scripts into player stakes instead of hook instructions", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Star Wars Zero Company",
      canonical_game: "Star Wars Zero Company",
      selected_title: "Star Wars Zero Company Is More Than XCOM",
      narration_script: [
        "Star Wars Zero Company is trying to be more than Star Wars XCOM.",
        "PC Gamer reports Star Wars Zero Company is more than just 'Star Wars XCOM' - it feels like Mass Effect but with turn-based tactics and permadeath.",
        "The Mass Effect comparison is the hook: tactics with crew pressure, not just another grid battle.",
        "Follow Pulse Gaming so you never miss a beat.",
      ].join(" "),
      primary_source: "PC Gamer",
      confirmed_claims: [
        "Star Wars Zero Company is more than just 'Star Wars XCOM' - it feels like Mass Effect but with turn-based tactics and permadeath.",
      ],
    },
    {
      current_duration_s: 18.733,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 120, repair.script);
  assert.match(repair.script, /Star Wars Zero Company/);
  assert.match(repair.script, /PC Gamer/);
  assert.match(repair.script, /crew|permadeath|mission|Mass Effect/i);
  assert.doesNotMatch(
    repair.script,
    /is the hook|the angle to watch|the hook has to|grid battle|another familiar tactics board/i,
  );
});

test("duration variant repair does not extend raw official Hades trailer metadata", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      canonical_title: "Hades II - Xbox & PlayStation Trailer (Coming April 14th!)",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      narration_script:
        "Hades II Just Broke PlayStation's Silence. Xbox reports Hades II - Xbox & PlayStation Trailer (Coming April 14th!). For players, this only matters if it changes what to buy, download or ignore.",
      primary_source: "Xbox",
      official_source: "Xbox",
      confirmed_claims: ["Hades II - Xbox & PlayStation Trailer (Coming April 14th!)"],
    },
    {
      current_duration_s: 14.24,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 120);
  assert.match(repair.script, /Xbox's trailer lists Hades II for Xbox and PlayStation/i);
  assert.doesNotMatch(repair.script, /port lands crisp|in public within hours/i);
  assert.match(repair.script, /tight dodge timing|broken builds spreading fast/i);
  assert.match(repair.script, /console port lands sharp|same obsession at once/i);
  assert.doesNotMatch(repair.script, /both communities/i);
  assert.doesNotMatch(repair.script, /Xbox reports Hades II - Xbox/i);
  assert.doesNotMatch(repair.script, /For players, this only matters/i);
  assert.doesNotMatch(repair.script, /&|amp;|\(Coming April 14th!\)/i);
});

test("duration variant repair cleans stale Hades description metadata while regenerating", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-hades-copy-"));
  const artifactDir = await makePackage(root, "hades-duration-copy", {
    canonical: {
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      canonical_title: "Hades II - Xbox & PlayStation Trailer (Coming April 14th!)",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      first_spoken_line: "Hades II Just Broke PlayStation's Silence.",
      narration_script:
        "Hades II Just Broke PlayStation's Silence. Xbox reports Hades II - Xbox & PlayStation Trailer (Coming April 14th!). For players, this only matters if it changes what to buy, download or ignore.",
      description: "Hades II - Xbox & PlayStation Trailer (Coming April 14th!). Source: Xbox.",
      primary_source: "Xbox",
      official_source: "Xbox",
      confirmed_claims: ["Hades II - Xbox & PlayStation Trailer (Coming April 14th!)"],
    },
  });

  const report = await materializeDurationVariantRepairs({
    workspaceRoot: root,
    generatedAt: "2026-05-23T21:12:00.000Z",
    workOrder: {
      jobs: [
        {
          ...workOrderJob("hades-duration-copy", artifactDir),
          title: "Hades II Just Broke PlayStation's Silence",
          current_duration_s: 14.24,
          target_duration_seconds: { min: 35, max: 59 },
          provider: "local",
        },
      ],
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 12));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(8192, 13));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 42.5,
        size_bytes: 8192,
      };
    },
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.repaired_count, 1);
  assert.doesNotMatch(updated.narration_script, /For players, this only matters|Xbox reports Hades II - Xbox/i);
  assert.equal(
    updated.description,
    "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. Source: Xbox.",
  );
});

test("duration variant repair gives near-floor local renders enough lift to clear the gate", () => {
  const nearFloorScript = [
    "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
    "IGN reports Forza Horizon 6 is already being framed as a major Steam success for Xbox.",
    "The question is whether Steam attention changes the wider launch push.",
    "Follow Pulse Gaming for the gaming stories behind the headline.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Crushed Its Steam Record",
      narration_script: nearFloorScript,
      primary_source: "IGN",
      confirmed_claims: ["Forza Horizon 6 is already being framed as a major Steam success for Xbox."],
    },
    {
      current_duration_s: 34.88,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 116);
  assert.ok(repair.repaired_word_count <= 132);
  assert.match(repair.script, /Forza Horizon 6/);
  assert.doesNotMatch(repair.script, /the watch point|the detail to watch|the useful test|the only firm read/i);
});

test("duration variant repair thumbnail headline keeps the subject inside the mobile crop", () => {
  assert.equal(
    durationRepairThumbnailHeadline("Mega Mewtwo Is Finally Coming To Pokemon Go", "Pokemon Go"),
    "POKÉMON GO MEGA MEWTWO",
  );
});

test("duration variant repair thumbnail headline never leaves dangling or repeated tokens", () => {
  const cases = [
    {
      title: "Star Wars Zero Company Is More Than XCOM",
      subject: "Star Wars Zero Company",
      expected: "STAR WARS ZERO COMPANY XCOM",
    },
    {
      title: "Deus Ex Composer Says The Jobs Vanished",
      subject: "Deus Ex",
      expected: "DEUS EX COMPOSER JOBS VANISHED",
    },
    {
      title: "PS5 Prices Went Up In Europe",
      subject: "PS5",
      expected: "PS5 PRICES WENT UP EUROPE",
    },
    {
      title: "Forza Horizon 6 Reviews Are In",
      subject: "Forza Horizon 6",
      expected: "FORZA HORIZON 6 REVIEWS",
    },
    {
      title: "Subnautica 2 Bonus Fight Got Bigger",
      subject: "Subnautica 2",
      expected: "SUBNAUTICA 2 BONUS FIGHT BIGGER",
    },
    {
      title: "Forza Horizon 6 Crushed Its Steam Record",
      subject: "Forza Horizon 6",
      expected: "FORZA HORIZON 6 STEAM RECORD",
    },
    {
      title: "Xbox Fans Used Feedback To Demand Exclusives",
      subject: "Xbox",
      expected: "XBOX FANS DEMAND EXCLUSIVES",
    },
    {
      title: "Xbox Exclusives Are Back Under Review",
      subject: "Xbox",
      expected: "XBOX EXCLUSIVES UNDER REVIEW",
    },
    {
      title: "Steam Controller Date May Have Leaked",
      subject: "Steam Controller",
      expected: "STEAM CONTROLLER DATE LEAK",
    },
    {
      title: "Nintendo Professor Lawsuit Just Got Weird",
      subject: "Nintendo",
      expected: "NINTENDO PROFESSOR LAWSUIT",
    },
    {
      title: "The Expanse Shows Real Gameplay",
      subject: "The Expanse: Osiris Reborn",
      expected: "EXPANSE GAMEPLAY REVEAL",
    },
    {
      title: "The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026",
      subject: "The Expanse: Osiris Reborn",
      expected: "EXPANSE GAMEPLAY REVEAL",
    },
  ];

  for (const item of cases) {
    const headline = durationRepairThumbnailHeadline(item.title, item.subject);
    assert.equal(headline, item.expected, `${item.title} produced ${headline}`);
    const qa = evaluateGoalPublicCopy({
      canonical_subject: item.subject,
      selected_title: item.title,
      thumbnail_headline: headline,
      first_spoken_line: `${item.subject} has a confirmed update.`,
      narration_script: `${item.subject} has a confirmed update. IGN reports the confirmed detail. Follow Pulse Gaming for the gaming stories behind the headline.`,
      description: "Confirmed detail. Source: IGN.",
      primary_source: "IGN",
      confirmed_claims: ["Confirmed detail"],
    });
    assert.doesNotMatch(qa.failures.join(" "), /thumbnail_headline_dangles|thumbnail_headline_repeated_token/);
  }
});

test("duration variant repair treats Pokemon Go event unlocks as live events, not gameplay trailers", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Pokemon Go",
      canonical_game: "Pokemon Go",
      selected_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
      narration_script: [
        "Mega Mewtwo is finally coming to Pokemon Go.",
        "Eurogamer reports Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players.",
        "A better showing would make Pokemon Go readable fast: combat, UI, platform list and date.",
        "A full mission and proper launch details would do more than teaser energy.",
        "Follow Pulse Gaming for the gaming stories behind the headline.",
      ].join(" "),
      primary_source: "Eurogamer",
      confirmed_claims: [
        "Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players.",
      ],
    },
    {
      current_duration_s: 18.4,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 112, repair.script);
  assert.match(repair.script, /Mega Mewtwo|Pokémon Go|Go Fest Global|Niantic|raid/i);
  assert.doesNotMatch(repair.script, /\bPokemon\b/);
  assert.doesNotMatch(repair.script, /combat|UI|full mission|gameplay footage|trailer|teaser energy/i);
  assert.equal(
    evaluateGoalPublicCopy({
      canonical_subject: "Pokémon Go",
      selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
      thumbnail_headline: durationRepairThumbnailHeadline("Mega Mewtwo Is Finally Coming To Pokemon Go", "Pokemon Go"),
      first_spoken_line: "Mega Mewtwo is finally coming to Pokémon Go.",
      narration_script: repair.script,
      description: "Mega Mewtwo's Pokémon Go debut has been announced and Go Fest Global is free for players. Source: Eurogamer.",
      primary_source: "Eurogamer",
      confirmed_claims: [
        "Mega Mewtwo's Pokémon Go debut has been announced and Go Fest Global is free for players.",
      ],
    }).verdict,
    "pass",
  );
});

test("duration variant repair treats Pokemon and Pokémon spellings as duplicate sentences", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Pokémon Go",
      canonical_game: "Pokémon Go",
      selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
      narration_script: [
        "Mega Mewtwo is finally coming to Pokémon Go.",
        "Eurogamer reports Mega Mewtwo's Pokémon Go debut finally announced and Go Fest Global is free for all players.",
        "The free Go Fest detail matters because this is one of Pokémon Go's biggest locked-away debuts.",
        "Mega Mewtwo finally has a Pokémon Go path instead of another tease.",
        "That matters because Mega Mewtwo has been one of Pokémon Go's longest-running absences.",
        "Making Go Fest Global free gives casual players a reason to open the app even if they were not buying a ticket.",
        "Niantic now has to make the weekend feel worth returning for, not just worth checking once.",
        "The player detail is timing, raid access and whether free players actually get a fair shot.",
        "Mega Mewtwo finally has a Pokémon Go path instead of another tease.",
        "Follow Pulse Gaming so you never miss a beat.",
      ].join(" "),
      primary_source: "Eurogamer",
      confirmed_claims: [
        "Mega Mewtwo's Pokémon Go debut has been announced and Go Fest Global is free for players.",
      ],
    },
    {
      current_duration_s: 18.5,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  const report = evaluateGoalPublicCopy({
    canonical_subject: "Pokémon Go",
    selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
    thumbnail_headline: durationRepairThumbnailHeadline("Mega Mewtwo Is Finally Coming To Pokemon Go", "Pokemon Go"),
    first_spoken_line: "Mega Mewtwo is finally coming to Pokémon Go.",
    narration_script: repair.script,
    description: "Mega Mewtwo's Pokémon Go debut has been announced and Go Fest Global is free for all players. Source: Eurogamer.",
    primary_source: "Eurogamer",
    confirmed_claims: [
      "Mega Mewtwo's Pokémon Go debut has been announced and Go Fest Global is free for all players.",
    ],
  });

  assert.equal(report.verdict, "pass", JSON.stringify(report.failures));
  assert.equal(
    repair.script.match(/Mega Mewtwo finally has a Pokémon Go path instead of another tease/g)?.length || 0,
    1,
  );
});

test("duration variant repair tightens overlong normal-production scripts", () => {
  const longScript = [
    "Warhammer 40,000: Boltgun Boom just turned the Warhammer showcase into a player watchlist story.",
    "GameSpot reports the official reveal trailer is the confirmed source.",
    "The practical question is whether this changes what people buy, wishlist, reinstall or wait on.",
    "That means the story needs a clear source card, a clean player impact beat and no extra speculation.",
    "The first pass added too much explanatory padding, repeated the same point and drifted beyond the scheduler-safe window.",
    "A tighter version should keep the named game, the source, the player decision and the next watch point without turning the short into a lecture.",
    "Players do not need three different caveats when one clear boundary is enough.",
    "The useful follow-up is whether the next official post adds platforms, pricing or a release window.",
    "Until then, the clean read is to watch the trailer details and ignore anything that outruns the source.",
    "That is the difference between a quick gaming news hit and a bloated recap that loses the first swipe.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "Warhammer 40,000: Boltgun Boom",
      canonical_game: "Warhammer 40,000: Boltgun Boom",
      selected_title: "Boltgun Boom Just Hit The Watchlist",
      narration_script: longScript,
      primary_source: "GameSpot",
      confirmed_claims: ["Warhammer 40K: Boltgun Boom - Official Reveal Trailer"],
    },
    {
      repair_lane: "normal_production_duration_ceiling",
      current_duration_s: 69.77,
      duration_reduction_required_seconds: 10.77,
      target_duration_seconds: { min: 35, max: 59 },
    },
  );

  assert.ok(repair.repaired_word_count < repair.original_word_count);
  assert.ok(repair.repaired_word_count <= 155);
  assert.match(repair.script, /Warhammer 40,000: Boltgun Boom/);
  assert.match(repair.script, /GameSpot/);
  assert.match(repair.script, /\bgaming\b|\bgame\b/i);
  assert.match(repair.script, /Follow Pulse Gaming/);
  assert.doesNotMatch(repair.script, /source-backed update|source_locked_update|the player angle is simple/i);
});

test("duration variant repair tightens showcase stories without adding deal filler", () => {
  const overlongShowcaseScript = [
    "The Expanse: Osiris Reborn finally showed real gameplay.",
    "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    "The real test is whether the footage shows a game worth tracking.",
    "Before you spend, check the live price, the platform listing and whether the deal is still active.",
    "The Expanse: Osiris Reborn is the hook, but the decision is simpler: buy now, wait or skip it until the next confirmed listing.",
    "If the listing moves again, the recommendation moves with it.",
    "That is why the useful play is to treat the headline as a price check, not a victory lap.",
    "The only firm read for now is this: Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    "The next thing to watch is whether the store page, official post or platform listing changes the practical call.",
    "Follow Pulse Gaming for the gaming stories behind the headline.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      canonical_angle: "Xbox showed new gameplay during Xbox Partner Preview.",
      narration_script: overlongShowcaseScript,
      primary_source: "Xbox",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
    },
    {
      repair_lane: "normal_production_duration_ceiling",
      current_duration_s: 62.601,
      duration_reduction_required_seconds: 3.601,
      target_duration_seconds: { min: 35, max: 59 },
    },
  );

  assert.ok(repair.repaired_word_count < repair.original_word_count);
  assert.ok(repair.repaired_word_count >= 85);
  assert.ok(repair.repaired_word_count <= 135);
  assert.match(repair.script, /The Expanse: Osiris Reborn/);
  assert.match(repair.script, /Xbox/);
  assert.match(repair.script, /gameplay/i);
  assert.match(repair.script, /Follow Pulse Gaming/);
  assert.doesNotMatch(repair.script, /Xbox reports Xbox showed/i);
  assert.doesNotMatch(repair.script, /Before you spend|buy now|price check|deal is still active/i);
});

test("duration variant repair strips meta edit instructions from gameplay scripts", () => {
  const staleMetaScript = [
    "The Expanse: Osiris Reborn finally showed real gameplay.",
    "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    "Footage matters here because it shows whether there is a real game behind the announcement.",
    "The Expanse: Osiris Reborn is a price-and-access story, so the edit should stay close to the actual offer.",
    "The details that matter are the discount, the platform and whether the deal is live where players can use it.",
    "That keeps the commercial angle useful without turning the short into an advert.",
    "The Expanse: Osiris Reborn stays worth tracking because the next official detail could change the launch, access or value story.",
    "Follow Pulse Gaming for the gaming stories behind the headline.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      narration_script: staleMetaScript,
      primary_source: "Xbox",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
    },
    {
      current_duration_s: 28.4,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /The Expanse: Osiris Reborn/);
  assert.match(repair.script, /gameplay/i);
  assert.doesNotMatch(
    repair.script,
    /price-and-access|Premium Edition|early-access demand|edit should|details that matter|commercial angle|worth tracking because the next official detail|offer changes|stronger beat|paid path/i,
  );
});

test("duration variant repair rewrites Expanse meta-proof narration into a clean news script", () => {
  const currentBadTranscript = [
    "The Expanse: Osiris Reborn finally showed real gameplay.",
    "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    "Footage matters here because it shows whether there is a real game behind the announcement.",
    "The Expanse: Osiris Reborn is past the announcement stage now.",
    "For an Expanse RPG, the pitch lives or dies on ship pressure, dialogue choices and whether ground combat feels heavier than a licensed skin.",
    "That makes the first gameplay read sharper than another trailer quote.",
    "Players need to see a loop with real decisions before this feels like more than a familiar logo.",
    "A longer gameplay cut can prove whether the pitch survives beyond montage pace.",
    "Follow Pulse Gaming for the gaming stories behind the headline.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      narration_script: currentBadTranscript,
      primary_source: "Xbox",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
    },
    {
      repair_lane: "normal_production_content_signal_repair",
      current_duration_s: 41.933,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /The Expanse: Osiris Reborn/);
  assert.match(repair.script, /Xbox/);
  assert.match(repair.script, /gameplay/i);
  assert.ok(repair.repaired_word_count >= 90);
  assert.ok(repair.repaired_word_count <= 132);
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "expanse-content-signal",
      title: "The Expanse Shows Real Gameplay",
      source_name: "Xbox",
    },
    script: repair.script,
  });
  assert.ok(!scorecard.blockers.includes("repeated_phrase"), JSON.stringify(scorecard, null, 2));
  assert.ok(!scorecard.warnings.includes("no_curiosity_marker"), JSON.stringify(scorecard, null, 2));
  assert.doesNotMatch(
    repair.script,
    /Footage matters here|real game behind the announcement|pitch lives or dies|licensed skin|first gameplay read|trailer quote|loop with real decisions|familiar logo|montage pace/i,
  );
});

test("duration variant repair does not repeat gameplay reveal phrasing when extending Expanse", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      narration_script: [
        "The Expanse: Osiris Reborn finally showed real gameplay.",
        "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
        "The catch is what matters after the reveal cut: whether the full mission flow can match it.",
        "Now the camera, gunfights and scale are on screen instead of hidden behind a logo.",
        "Follow Pulse Gaming so you never miss a beat.",
      ].join(" "),
      primary_source: "Xbox",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
    },
    {
      current_duration_s: 19.8,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "expanse-duration-repeat",
      title: "The Expanse Shows Real Gameplay",
      source_name: "Xbox",
    },
    script: repair.script,
  });

  assert.doesNotMatch(repair.script, /finally has gameplay footage on screen/i);
  assert.doesNotMatch(repair.script, /The catch is what matters after the reveal cut/i);
  assert.ok(!scorecard.blockers.includes("repeated_phrase"), JSON.stringify(scorecard, null, 2));
  assert.ok(!scorecard.blockers.includes("generic_reveal_catch_template"), JSON.stringify(scorecard, null, 2));
});

test("duration variant repair does not add a second Expanse mission-flow catch", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      narration_script: [
        "The Expanse: Osiris Reborn finally has real gameplay on screen.",
        "Xbox showed The Expanse: Osiris Reborn gameplay during Partner Preview, which matters because this is no longer just a logo and a licence.",
        "The catch is why mission flow matters: a famous universe only helps if the gunfights, camera weight and scale hold up outside a trailer cut.",
        "The real player question is whether this feels like The Expanse, or just another sci-fi shooter wearing the name.",
        "The next long gameplay cut has to prove the rhythm.",
        "Follow Pulse Gaming so you never miss a beat.",
      ].join(" "),
      primary_source: "Xbox",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
    },
    {
      current_duration_s: 29.833,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.equal((repair.script.match(/\bthe catch is\b/gi) || []).length, 1);
  assert.doesNotMatch(repair.script, /The catch is whether the camera, gunfights and ship scale/i);
  assert.ok(repair.repaired_word_count >= 116);
  assert.ok(repair.repaired_word_count <= 132);
});

test("duration variant repair does not pad showcase scripts with generic footage instructions", () => {
  const staleShowcaseScript = [
    "Hades II just broke PlayStation's silence.",
    "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
    "Hades II finally has something players can judge on screen.",
    "The first test is movement, combat readability and whether the UI looks like a real game.",
    "A date or platform list helps, but footage is the part that decides whether the reveal has weight.",
    "Follow Pulse Gaming for the gaming stories behind the headline.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      narration_script: staleShowcaseScript,
      primary_source: "Xbox",
      confirmed_claims: ["Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date."],
    },
    {
      current_duration_s: 29.8,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /Hades II/);
  assert.match(repair.script, /Xbox and PlayStation|console players/i);
  assert.doesNotMatch(
    repair.script,
    /finally has something players can judge|movement, combat readability|UI looks like a real game|footage is the part that decides|logo sweep|next trailer shows/i,
  );
});

test("duration variant repair adds a real curiosity marker to Stranger Than Heaven showcase scripts", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "STRANGER THAN HEAVEN Five Eras",
      canonical_game: "STRANGER THAN HEAVEN Five Eras",
      selected_title: "Stranger Than Heaven Shows Five Eras",
      narration_script:
        "Stranger Than Heaven just made its pitch harder to fake. Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview. Follow Pulse Gaming so you never miss a beat.",
      primary_source: "Xbox",
      source_card_label: "Xbox",
      confirmed_claims: ["Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview."],
    },
    {
      repair_lane: "normal_production_content_signal_repair",
      current_duration_s: 39.867,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
      source_blockers: ["preflight_qa_blocked:script_scorecard:no_curiosity_marker"],
    },
  );

  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "stranger-curiosity-repair",
      title: "Stranger Than Heaven Shows Five Eras",
      source_name: "Xbox",
    },
    script: repair.script,
  });

  assert.match(repair.script, /awkward catch|real catch|the catch/i);
  assert.ok(!scorecard.warnings.includes("no_curiosity_marker"), JSON.stringify(scorecard, null, 2));
  assert.doesNotMatch(repair.script, /hook has to|next beat should|public output/i);
});

test("duration variant repair compacts Stranger showcase scripts without generic reveal-catch padding", () => {
  const staleLongScript = [
    "Stranger Than Heaven just made its pitch harder to fake.",
    "Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview.",
    "Stranger Than Heaven is swinging at more than one period piece.",
    "Five eras is a big promise: each one needs its own texture, pace and reason to exist, not just a costume change.",
    "That makes the reveal feel ambitious, but also easy to overpromise.",
    "The awkward catch is whether the time jumps change the missions or just the wardrobe.",
    "A longer cut needs to show one mission bending around the era shift instead of another stylish trailer sweep.",
    "Until then, the reveal is exciting because the risk is obvious: five eras can feel huge, or it can feel like five outfits.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "STRANGER THAN HEAVEN Five Eras",
      canonical_game: "STRANGER THAN HEAVEN Five Eras",
      selected_title: "Stranger Than Heaven Shows Five Eras",
      narration_script: staleLongScript,
      primary_source: "Xbox",
      source_card_label: "Xbox",
      confirmed_claims: ["Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview."],
    },
    {
      repair_lane: "normal_production_content_signal_repair",
      current_duration_s: 39.867,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
      source_blockers: ["preflight_qa_blocked:script_scorecard:no_curiosity_marker"],
    },
  );

  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "stranger-compact-content-signal",
      title: "Stranger Than Heaven Shows Five Eras",
      source_name: "Xbox",
    },
    script: repair.script,
  });

  assert.ok(repair.repaired_word_count >= 116, repair.script);
  assert.ok(repair.repaired_word_count <= 132, repair.script);
  assert.match(repair.script, /awkward catch|real catch|five eras can feel huge/i);
  assert.doesNotMatch(repair.script, /The catch is what matters after the reveal cut/i);
  assert.doesNotMatch(repair.script, /source-checked gaming update/i);
  assert.ok(scorecard.scores.curiosity_gap >= 70, JSON.stringify(scorecard, null, 2));
  assert.ok(!scorecard.blockers.includes("generic_reveal_catch_template"), JSON.stringify(scorecard, null, 2));
  assert.ok(!scorecard.warnings.includes("no_curiosity_marker"), JSON.stringify(scorecard, null, 2));
});

test("duration variant repair gives stale Stranger compact repairs enough local voice headroom", () => {
  const staleCompactScript = [
    "STRANGER THAN HEAVEN Five Eras is swinging at more than one period piece.",
    "Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview.",
    "The catch is what matters after the reveal cut: combat, UI, platform list and date need to read fast.",
    "That is enough for a watchlist, but not a day-one call yet.",
    "A store page or firm launch window would give players something real to plan around.",
    "A full mission and proper launch details would do more than teaser energy.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "STRANGER THAN HEAVEN Five Eras",
      canonical_game: "STRANGER THAN HEAVEN Five Eras",
      selected_title: "Stranger Than Heaven Shows Five Eras",
      narration_script: staleCompactScript,
      primary_source: "Xbox",
      source_card_label: "Xbox",
      confirmed_claims: ["Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview."],
    },
    {
      repair_lane: "normal_production_content_signal_repair",
      current_duration_s: 39.867,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
      source_blockers: ["preflight_qa_blocked:script_scorecard:no_curiosity_marker"],
    },
  );

  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "stranger-stale-compact-content-signal",
      title: "Stranger Than Heaven Shows Five Eras",
      source_name: "Xbox",
    },
    script: repair.script,
  });

  assert.ok(repair.repaired_word_count >= 122, repair.script);
  assert.ok(repair.repaired_word_count <= 132, repair.script);
  assert.doesNotMatch(repair.script, /The catch is what matters after the reveal cut/i);
  assert.doesNotMatch(repair.script, /watchlist|store page|teaser energy/i);
  assert.ok(scorecard.scores.curiosity_gap >= 70, JSON.stringify(scorecard, null, 2));
  assert.ok(!scorecard.blockers.includes("generic_reveal_catch_template"), JSON.stringify(scorecard, null, 2));
  assert.ok(!scorecard.warnings.includes("no_curiosity_marker"), JSON.stringify(scorecard, null, 2));
});

test("duration variant repair gives Hades a curiosity hook and complete mobile headline", () => {
  assert.equal(
    durationRepairThumbnailHeadline("Hades II Just Broke PlayStation's Silence", "Hades II"),
    "HADES II CONSOLE DATE",
  );

  const repair = extendScriptToTarget(
    {
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      canonical_title: "Hades II - Xbox & PlayStation Trailer (Coming April 14th!)",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      first_spoken_line: "Hades II just broke PlayStation's silence.",
      narration_script: [
        "Hades II just broke PlayStation's silence.",
        "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
        "Hades II finally has something players can judge on screen.",
        "The first test is movement, combat readability and whether the UI looks like a real game.",
        "A longer public showing would say more than another quick trailer.",
        "Follow Pulse Gaming for the gaming stories behind the headline.",
      ].join(" "),
      primary_source: "Xbox",
      official_source: "Xbox",
      confirmed_claims: ["Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date."],
    },
    {
      current_duration_s: 29.8,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.ok(repair.repaired_word_count >= 105, repair.script);
  assert.ok(repair.repaired_word_count <= 132, repair.script);
  assert.match(repair.script, /same April countdown|same obsession at once|feel is the pressure point/i);
  assert.match(repair.script, /Xbox's trailer lists Hades II for Xbox and PlayStation/i);
  assert.doesNotMatch(
    repair.script,
    /The platform list is the point|finally has something players can judge|A longer public showing|console version needs to feel as sharp|Controller feel will decide/i,
  );
});

test("duration variant repair turns controller-date leaks into hardware news instead of hook instructions", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Steam Controller",
      canonical_game: "Steam Controller",
      selected_title: "Steam Controller Date May Have Leaked",
      narration_script:
        "Steam Controller release timing may have leaked early. Eurogamer reports The Steam controller release date may have been leaked online. The hook has to stay tied to the named game, the source and the concrete detail viewers can repeat. Follow Pulse Gaming for the gaming stories behind the headline.",
      primary_source: "Eurogamer",
      confirmed_claims: ["The Steam controller release date may have been leaked online."],
    },
    {
      current_duration_s: 24.1,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /Steam Controller/);
  assert.match(repair.script, /Valve|hardware|SteamOS|PC players/i);
  assert.doesNotMatch(repair.script, /hook has to stay tied|concrete detail viewers can repeat|one more hard detail/i);
});

test("duration variant repair keeps handmade art-direction stories out of job-market filler", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Pragmata",
      canonical_game: "Pragmata",
      selected_title: "Pragmata's AI-Look Stage Was Handmade",
      narration_script:
        "Pragmata's AI-looking stage was actually handmade by developers. Automaton Media reports Pragmata's newly revealed New York stage was painstakingly made by human developers to look AI generated. Pragmata is not just nostalgia here; it is the familiar name attached to a rough games job market. When veteran credits are still fighting for interviews, the story stops being abstract. Follow Pulse Gaming for the gaming stories behind the headline.",
      primary_source: "Automaton Media",
      confirmed_claims: [
        "Pragmata's newly revealed New York stage was painstakingly made by human developers to look AI generated.",
      ],
    },
    {
      current_duration_s: 28.9,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /Pragmata/);
  assert.match(repair.script, /handmade|AI-looking|art direction|New York/i);
  assert.doesNotMatch(
    repair.script,
    /rough games job market|veteran credits|fighting for interviews|headline people scroll past|which projects get staffed|quieter story than a trailer/i,
  );
});

test("duration variant repair keeps publisher bonus disputes out of job-market filler", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Subnautica 2",
      canonical_game: "Subnautica 2",
      selected_title: "Subnautica 2 Bonus Fight Got Bigger",
      narration_script:
        "Subnautica 2 is keeping one of its strangest survival rules. Aftermath reports Sure Seems Like Subnautica 2's Developers Are Going To Get Their $250 Million Bonus. Subnautica 2 is not just nostalgia here; it is the familiar name attached to a rough games job market. Follow Pulse Gaming for the gaming stories behind the headline.",
      primary_source: "Aftermath",
      confirmed_claims: ["Sure Seems Like Subnautica 2's Developers Are Going To Get Their $250 Million Bonus."],
    },
    {
      current_duration_s: 27.4,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  assert.match(repair.script, /Subnautica 2/);
  assert.match(repair.script, /bonus|Krafton|publisher|launch performance|developers/i);
  assert.doesNotMatch(
    repair.script,
    /rough games job market|veteran credits|fighting for interviews|not just nostalgia|which projects get staffed|quieter story than a trailer|the tension is|the pressure is|case study/i,
  );
});

test("duration variant repair does not pad publisher bonus disputes with repeated reward beats", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Subnautica 2",
      canonical_game: "Subnautica 2",
      selected_title: "Subnautica 2 Bonus Fight Got Bigger",
      narration_script: [
        "Subnautica 2's bonus fight now looks bigger than the sequel hype.",
        "Aftermath reports Subnautica 2's developers appear to be in line for a $250 million bonus.",
        "Fans are watching the sequel and the payout fight at the same time, which makes every official update land heavier.",
        "Follow Pulse Gaming for the gaming stories behind the headline.",
      ].join(" "),
      primary_source: "Aftermath",
      confirmed_claims: ["Subnautica 2's developers appear to be in line for a $250 million bonus."],
    },
    {
      current_duration_s: 18.733,
      target_duration_seconds: { min: 35, max: 59 },
      provider: "local",
    },
  );

  const duplicatePayoutMotifs = (repair.script.match(/\b(?:payout|rewarded|bonus fight|fans are watching)\b/gi) || [])
    .length;

  assert.match(repair.script, /Subnautica 2/);
  assert.match(repair.script, /bonus|\$250 million|Krafton|publisher|developers/i);
  assert.ok(duplicatePayoutMotifs <= 4, repair.script);
  assert.ok((repair.script.match(/\$250 million/gi) || []).length <= 1, repair.script);
  assert.doesNotMatch(repair.script, /Fans are watching.+Fans are watching/i);
  assert.doesNotMatch(repair.script, /If the payout lands.+If the payout is confirmed/i);
});

test("duration variant repair gives near-floor ElevenLabs renders a small lift instead of bloating", () => {
  const nearFloorScript = [
    "The Expanse: Osiris Reborn finally showed real gameplay.",
    "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    "The next beat is simple: release timing, platforms and whether the next showing backs up the gameplay pitch.",
    "That is enough for a watchlist, but not enough for a day-one call yet.",
    "Follow Pulse Gaming for the gaming stories behind the headline.",
  ].join(" ");

  const repair = extendScriptToTarget(
    {
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      narration_script: nearFloorScript,
      primary_source: "Xbox",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
    },
    {
      current_duration_s: 34.567,
      target_duration_seconds: { min: 35, max: 59 },
    },
  );

  assert.ok(repair.repaired_word_count > repair.original_word_count);
  assert.ok(repair.repaired_word_count <= 105);
  assert.match(repair.script, /The Expanse: Osiris Reborn/);
  assert.doesNotMatch(repair.script, /Before you spend|buy now|price check|deal is still active/i);
});

test("duration variant repair does not reinsert advertiser-risk source wording", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Xbox",
      canonical_game: "Xbox",
      selected_title: "Xbox Just Made A Strategy Hire",
      narration_script:
        "Xbox just made a strategy hire that says a lot about where gaming is going. Eurogamer reports Xbox hired an analyst as chief strategy officer after another leadership revamp.",
      primary_source: "Eurogamer",
      confirmed_claims: [
        "Xbox hires analyst who said games were losing the attention battle with gambling, crypto and porn as chief strategy officer in another leadership revamp",
      ],
    },
    {
      current_duration_s: 31.6,
      target_duration_seconds: { min: 35, max: 60 },
    },
  );

  assert.doesNotMatch(repair.script, /gambling|crypto|porn/i);
  assert.match(repair.script, /Xbox hired an analyst as chief strategy officer/);
});

test("duration variant repair keeps Warhammer numeric claims below coherence limits", () => {
  const repair = extendScriptToTarget(
    {
      canonical_subject: "Warhammer 40,000: Space Marine 2",
      canonical_game: "Warhammer 40,000: Space Marine 2",
      selected_title: "Space Marine 2 Got Its Purgation Update",
      narration_script:
        "Warhammer 40,000: Space Marine 2 just got its Purgation update. IGN reports Space Marine 2 received the Purgation update, Patch 13 and a new PvE mission.",
      primary_source: "IGN",
      confirmed_claims: [
        "Warhammer 40,000: Space Marine 2 Shadowdrops Purgation Update, Patch 13 Adds New PvE Mission and a Lot More",
      ],
    },
    {
      current_duration_s: 31.6,
      target_duration_seconds: { min: 35, max: 60 },
    },
  );
  const coherence = runScriptCoherenceQa(
    { title: "Space Marine 2 Got Its Purgation Update", full_script: repair.script },
    { requireCtaField: false, requireFullScriptCta: false },
  );

  assert.doesNotMatch(coherence.failures.join("\n"), /repeated_numeric_claim/);
  assert.match(repair.script, /Space Marine 2/);
});

test("duration variant repair writes JSON and Markdown reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-variant-write-"));
  const report = {
    generated_at: "2026-05-22T08:05:00.000Z",
    summary: { candidate_count: 0, repaired_count: 0, failed_count: 0, blocked_count: 0 },
    jobs: [],
    safety: { no_publish_triggered: true },
  };
  const written = await writeDurationVariantRepairReport(report, { outputDir: path.join(root, "out") });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  const markdown = await fs.readFile(written.markdownPath, "utf8");
  assert.match(markdown, /Duration Variant Repair/);
  assert.equal(renderDurationVariantRepairMarkdown(report).includes("Candidates: 0"), true);
});
