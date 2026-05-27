"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyBridgeLiveRightsRepairPlan,
  buildBridgeLiveRightsRepairPlan,
  generatedVisualRightsRecord,
  repairBridgeLiveStoryRights,
} = require("../../lib/bridge-live-rights-repair");

async function makeGeneratedFiles(root, storyId) {
  const imagePath = path.join(root, "output", "images", `${storyId}.png`);
  const thumbnailPath = path.join(root, "output", "thumbnails", `${storyId}_thumbnail_candidate.png`);
  await fs.outputFile(imagePath, Buffer.alloc(2048, 1));
  await fs.outputFile(thumbnailPath, Buffer.alloc(2048, 2));
  return { imagePath, thumbnailPath };
}

function bridgeStory(storyId, files) {
  return {
    id: storyId,
    title: "Deathmaster Brings Stealth To Consoles",
    selected_title: "Deathmaster Brings Stealth To Consoles",
    canonical_subject: "Warhammer Age Of Sigmar: Deathmaster",
    first_spoken_line: "Warhammer Age Of Sigmar: Deathmaster is coming to PC and consoles.",
    full_script: "Warhammer Age Of Sigmar: Deathmaster is coming to PC and consoles. GameSpot has the source.",
    description: "Warhammer Age Of Sigmar: Deathmaster is coming to PC and consoles. Source: GameSpot.",
    primary_source: "GameSpot",
    source_card_label: "GameSpot",
    approved: true,
    auto_approved: true,
    exported_path: path.join(files.root, "output", "goal-proof", "batch", storyId, "visual_v4_render.mp4"),
    audio_path: `output/audio/${storyId}.mp3`,
    image_path: files.imagePath,
    thumbnail_candidate_path: files.thumbnailPath,
    downloaded_images: [
      {
        path: "output/image_cache/risky_pexels_0.jpg",
        source_type: "screenshot",
      },
    ],
    video_clips: [
      {
        id: `${storyId}-legacy-igdb`,
        path: `output/video_cache/${storyId}_igdb.mp4`,
        source_type: "video",
      },
    ],
    visual_v4_bridge_video_clips: [
      {
        id: `${storyId}-owned-motion-1`,
        path: `output/generated-motion/${storyId}/hook_slam.mp4`,
        source_url: `local://pulse-generated-motion/${storyId}/hook_slam`,
        source_type: "internally_generated_motion_graphic",
        rights_risk_class: "owned_generated_motion",
      },
    ],
    rights_ledger: [
      {
        asset_id: `${storyId}-owned-motion-1`,
        path: `output/generated-motion/${storyId}/hook_slam.mp4`,
        source_url: `local://pulse-generated-motion/${storyId}/hook_slam`,
        source_type: "internally_generated_motion_graphic",
        licence_basis: "owned_generated_editorial_motion_graphic",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.03,
      },
      {
        asset_id: `${storyId}_audio_path`,
        path: `output/audio/${storyId}.mp3`,
        source_url: `local://pulse-local-tts/${storyId}`,
        source_type: "local_tts_voice",
        licence_basis: "owned_local_voice_model",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.05,
      },
    ],
    manual_caption_path: path.join(files.root, "output", "goal-proof", "batch", storyId, "captions.srt"),
    clean_manual_captions: true,
    manual_caption_generated: true,
    visual_v4_render_bridge_status: "promoted_to_live_state",
    scheduler_bridge_artifact_dir: path.join(files.root, "output", "goal-proof", "batch", storyId),
    governance_publish_status: "GREEN",
  };
}

test("bridge live rights repair prunes unused legacy visuals and rights generated local cards", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-rights-"));
  const storyId = "rss_rights";
  const files = { root, ...(await makeGeneratedFiles(root, storyId)) };
  const repaired = repairBridgeLiveStoryRights(bridgeStory(storyId, files), {
    generatedAt: "2026-05-22T08:45:00.000Z",
  });

  assert.deepEqual(repaired.downloaded_images, []);
  assert.deepEqual(repaired.game_images, []);
  assert.deepEqual(repaired.video_clips, repaired.visual_v4_bridge_video_clips);
  assert.equal(repaired.legacy_visual_fields_cleared_reason, "final_v4_bridge_uses_owned_motion_package");
  assert.ok(
    repaired.rights_ledger.some((record) => record.asset_id === `${storyId}_thumbnail_candidate_path`),
  );
  assert.ok(
    repaired.rights_ledger.every((record) => record.allowed_platforms.includes("x")),
  );
});

test("bridge live rights repair plan only applies rows that pass governance after repair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-rights-plan-"));
  const storyId = "rss_rights";
  const files = { root, ...(await makeGeneratedFiles(root, storyId)) };
  await fs.outputFile(path.join(root, "output", "goal-proof", "batch", storyId, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nTest\n");
  const story = bridgeStory(storyId, files);

  const plan = buildBridgeLiveRightsRepairPlan({
    stories: [story],
    generatedAt: "2026-05-22T08:46:00.000Z",
  });

  assert.equal(plan.summary.candidates_seen, 1);
  assert.equal(plan.summary.eligible_count, 1);
  assert.equal(plan.eligible_repairs[0].story_id, storyId);
  assert.equal(plan.eligible_repairs[0].post_repair_governance_status, "GREEN");
});

test("bridge live rights repair includes bridge-ready director rows before live promotion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-rights-ready-"));
  const storyId = "bridge_ready_forza";
  const files = { root, ...(await makeGeneratedFiles(root, storyId)) };
  await fs.outputFile(path.join(root, "output", "goal-proof", "batch", storyId, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nTest\n");
  const story = {
    ...bridgeStory(storyId, files),
    visual_v4_render_bridge_status: "bridge_ready",
    render_lane: "studio_v4_director_bridge",
    scheduler_bridge_artifact_dir: "",
    video_clips: [
      {
        id: `${storyId}-legacy-igdb`,
        path: `output/video_cache/${storyId}_legacy_igdb.mp4`,
        source_type: "video",
      },
    ],
  };

  const plan = buildBridgeLiveRightsRepairPlan({
    stories: [story],
    generatedAt: "2026-05-22T09:05:00.000Z",
  });

  assert.equal(plan.summary.candidates_seen, 1);
  assert.equal(plan.summary.eligible_count, 1);
  assert.equal(plan.eligible_repairs[0].story_id, storyId);
  assert.deepEqual(
    plan.eligible_repairs[0].repaired_story.video_clips,
    story.visual_v4_bridge_video_clips,
  );
});

test("bridge live rights repair apply requires operator confirmation and writes through db adapter", async () => {
  const plan = {
    eligible_repairs: [
      {
        story_id: "story-a",
        repaired_story: { id: "story-a", title: "Story A" },
      },
    ],
  };
  await assert.rejects(
    () => applyBridgeLiveRightsRepairPlan(plan, { db: { upsertStory() {} } }),
    /requires_operator_confirmed/,
  );

  const calls = [];
  const result = await applyBridgeLiveRightsRepairPlan(plan, {
    operatorConfirmed: true,
    db: {
      upsertStory(story) {
        calls.push(story);
      },
    },
  });

  assert.equal(result.applied_count, 1);
  assert.equal(calls[0].id, "story-a");
  assert.equal(result.posting, false);
});

test("generated visual rights records are explicit about owned generated editorial graphics", () => {
  const record = generatedVisualRightsRecord({
    storyId: "story-a",
    field: "thumbnail_candidate_path",
    filePath: "output/thumbnails/story-a.png",
  });

  assert.equal(record.asset_id, "story-a_thumbnail_candidate_path");
  assert.equal(record.licence_basis, "owned_generated_editorial_graphic");
  assert.equal(record.commercial_use_allowed, true);
});
