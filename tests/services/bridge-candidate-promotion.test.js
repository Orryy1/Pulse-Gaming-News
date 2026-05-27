"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyBridgeCandidatePromotionPlan,
  buildBridgeCandidatePromotionPlan,
} = require("../../lib/bridge-candidate-promotion");

function bridgeCandidate(overrides = {}) {
  return {
    id: "story-green",
    title: "Forza Finally Has A Date",
    suggested_title: "Forza Finally Has A Date",
    canonical_subject: "Forza",
    exported_path: "render.mp4",
    audio_path: "audio.mp3",
    manual_caption_path: "captions.srt",
    caption_path: "captions.srt",
    full_script: "Forza finally has a date. Players now know what to watch next.",
    tts_script: "Forza finally has a date. Players now know what to watch next.",
    first_spoken_line: "Forza finally has a date.",
    description: "Forza finally has a date. Source: Xbox Wire.",
    approved: true,
    auto_approved: true,
    governance_publish_status: "GREEN",
    publish_verdict: { verdict: "GREEN" },
    rights_ledger: [
      { asset_id: "render", asset_type: "video", source_url: "owned://render" },
      { asset_id: "audio", asset_type: "audio", source_url: "owned://audio" },
    ],
    manual_caption_generated: true,
    clean_manual_captions: true,
    video_clips: [{ source_family: "official-a" }, { source_family: "official-b" }],
    ...overrides,
  };
}

function candidateReport(candidates = []) {
  return {
    candidates,
  };
}

function passCandidate(overrides = {}) {
  return {
    id: "story-green",
    title: "Forza Finally Has A Date",
    status: "publish_ready",
    preflight_qa: {
      status: "pass",
      blockers: [],
      warnings: [],
    },
    ...overrides,
  };
}

test("bridge promotion selects only scheduler candidates with publish-ready pass preflight", () => {
  const plan = buildBridgeCandidatePromotionPlan({
    generatedAt: "2026-05-22T08:00:00.000Z",
    bridgeCandidates: [
      bridgeCandidate({ id: "story-green" }),
      bridgeCandidate({ id: "story-warn", title: "Warn Story" }),
      bridgeCandidate({ id: "story-review", title: "Review Story" }),
      bridgeCandidate({ id: "story-missing-report", title: "Missing Report Story" }),
    ],
    candidateReport: candidateReport([
      passCandidate({ id: "story-green" }),
      passCandidate({
        id: "story-warn",
        preflight_qa: { status: "warn", blockers: [], warnings: ["video_duration_below_tiktok_target"] },
      }),
      passCandidate({ id: "story-review", status: "review" }),
    ]),
    liveStories: [],
    fileExists: () => true,
  });

  assert.equal(plan.status, "ready_for_operator_confirmed_apply");
  assert.equal(plan.summary.eligible_count, 1);
  assert.equal(plan.summary.blocked_count, 3);
  assert.deepEqual(plan.eligible_promotions.map((item) => item.story_id), ["story-green"]);
  assert.ok(
    plan.blocked_candidates.some(
      (item) => item.story_id === "story-warn" && item.reasons.includes("preflight_not_pass:warn"),
    ),
  );
  assert.ok(
    plan.blocked_candidates.some(
      (item) => item.story_id === "story-review" && item.reasons.includes("candidate_not_publish_ready:review"),
    ),
  );
  assert.ok(
    plan.blocked_candidates.some(
      (item) => item.story_id === "story-missing-report" && item.reasons.includes("candidate_report_missing"),
    ),
  );
  assert.equal(plan.safety.posting, false);
  assert.equal(plan.safety.oauth, false);
  assert.equal(plan.safety.safety_gates_weakened, false);
});

test("bridge promotion update preserves existing platform ids and clears stale local blockers", () => {
  const plan = buildBridgeCandidatePromotionPlan({
    bridgeCandidates: [bridgeCandidate({ id: "story-green", youtube_post_id: "" })],
    candidateReport: candidateReport([passCandidate({ id: "story-green" })]),
    liveStories: [
      {
        id: "story-green",
        title: "Old Title",
        youtube_post_id: "yt_123",
        instagram_media_id: "ig_456",
        publish_status: "failed",
        publish_error: "content_qa:old_failure",
        qa_failed: true,
        downloaded_images: [{ path: "output/image_cache/article-context.jpg" }],
        game_images: ["https://example.invalid/old-card.jpg"],
        image_path: "output/images/old-card.png",
      },
    ],
    fileExists: () => true,
  });

  const update = plan.eligible_promotions[0].update_story;
  assert.equal(update.title, "Forza Finally Has A Date");
  assert.equal(update.youtube_post_id, "yt_123");
  assert.equal(update.instagram_media_id, "ig_456");
  assert.equal(update.publish_status, null);
  assert.equal(update.publish_error, null);
  assert.equal(update.qa_failed, false);
  assert.deepEqual(update.downloaded_images, []);
  assert.deepEqual(update.game_images, []);
  assert.equal(update.image_path, null);
  assert.equal(update.visual_v4_render_bridge_status, "promoted_to_live_state");
  assert.ok(update.scheduler_bridge_promoted_at);
});

test("bridge promotion blocks missing media, missing captions and incomplete rights", () => {
  const plan = buildBridgeCandidatePromotionPlan({
    bridgeCandidates: [
      bridgeCandidate({ id: "missing-render", exported_path: "missing.mp4" }),
      bridgeCandidate({ id: "missing-captions", manual_caption_path: "", caption_path: "" }),
      bridgeCandidate({ id: "missing-rights", rights_ledger: [] }),
    ],
    candidateReport: candidateReport([
      passCandidate({ id: "missing-render" }),
      passCandidate({ id: "missing-captions" }),
      passCandidate({ id: "missing-rights" }),
    ]),
    liveStories: [],
    fileExists: (file) => file !== "missing.mp4",
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.summary.eligible_count, 0);
  assert.ok(
    plan.blocked_candidates.some(
      (item) => item.story_id === "missing-render" && item.reasons.includes("exported_path_missing_on_disk"),
    ),
  );
  assert.ok(
    plan.blocked_candidates.some(
      (item) => item.story_id === "missing-captions" && item.reasons.includes("clean_manual_captions_missing"),
    ),
  );
  assert.ok(
    plan.blocked_candidates.some(
      (item) => item.story_id === "missing-rights" && item.reasons.includes("rights_ledger_missing"),
    ),
  );
});

test("bridge promotion blocks stale preflight when current public copy is malformed", () => {
  const plan = buildBridgeCandidatePromotionPlan({
    bridgeCandidates: [
      bridgeCandidate({
        id: "bad-copy",
        title: "Kickstarter Just Walked Back Its Rules",
        suggested_title: "Kickstarter Just Walked Back Its Rules",
        canonical_subject: "Kickstarter",
        first_spoken_line: "Kickstarter just walked back one of its most controversial rule changes.",
        full_script:
          "Kickstarter just walked back one of its most controversial rule changes. Eurogamer reports the company apologised after backlash from game creators.",
        tts_script:
          "Kickstarter just walked back one of its most controversial rule changes. Eurogamer reports the company apologised after backlash from game creators.",
        description: '"Honestly?. Source: Eurogamer.',
      }),
    ],
    candidateReport: candidateReport([passCandidate({ id: "bad-copy" })]),
    liveStories: [],
    fileExists: () => true,
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.summary.eligible_count, 0);
  assert.ok(
    plan.blocked_candidates[0].reasons.includes("public_copy:malformed_quote_description"),
  );
});

test("bridge promotion blocks stale alternate public script fields before live promotion", () => {
  const plan = buildBridgeCandidatePromotionPlan({
    bridgeCandidates: [
      bridgeCandidate({
        id: "stale-alt-script",
        title: "Hades II Just Broke PlayStation's Silence",
        suggested_title: "Hades II Just Broke PlayStation's Silence",
        canonical_subject: "Hades II",
        narration_script:
          "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. Follow Pulse Gaming for the gaming stories behind the headline.",
        full_script:
          "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation.",
        tts_script:
          "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. Before you spend, check the live price, the platform listing and Game Pass details.",
        first_spoken_line: "Hades II just broke PlayStation's silence.",
        description: "Xbox showed the latest Hades II trailer. Source: Xbox.",
      }),
    ],
    candidateReport: candidateReport([passCandidate({ id: "stale-alt-script" })]),
    liveStories: [],
    fileExists: () => true,
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.summary.eligible_count, 0);
  assert.ok(
    plan.blocked_candidates[0].reasons.includes("public_copy:full_script_diverges_from_narration"),
  );
  assert.ok(
    plan.blocked_candidates[0].reasons.includes("public_copy:tts_script_diverges_from_narration"),
  );
});

test("bridge promotion apply requires operator confirmation and uses backup plus upsert only", async () => {
  const calls = [];
  const plan = buildBridgeCandidatePromotionPlan({
    generatedAt: "2026-05-22T08:00:00.000Z",
    bridgeCandidates: [bridgeCandidate({ id: "story-green" })],
    candidateReport: candidateReport([passCandidate({ id: "story-green" })]),
    liveStories: [],
    fileExists: () => true,
  });
  const db = {
    DB_PATH: "D:\\pulse-data\\pulse.db",
    getDb() {
      return {
        async backup(filePath) {
          calls.push(["backup", filePath]);
        },
      };
    },
    async upsertStory(story) {
      calls.push(["upsertStory", story.id, story.title]);
    },
  };

  await assert.rejects(
    () => applyBridgeCandidatePromotionPlan(plan, { db, operatorConfirmed: false }),
    /bridge_candidate_promotion_requires_operator_confirmed/,
  );

  const result = await applyBridgeCandidatePromotionPlan(plan, {
    db,
    operatorConfirmed: true,
    ensureDir: async () => {},
  });

  assert.equal(result.status, "applied");
  assert.equal(result.applied_count, 1);
  assert.equal(result.posting, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "backup");
  assert.match(calls[0][1], /pulse-pre-bridge-candidate-promotion/);
  assert.deepEqual(calls[1], ["upsertStory", "story-green", "Forza Finally Has A Date"]);
});
