"use strict";

const { normaliseText } = require("../text-hygiene");
const { buildStandardShortCreatorOverlayPlan } = require("../studio/v2/standard-short-creator-overlay");

const MIN_EXACT_FOR_STANDARD = 4;
const MIN_CLIPS_FOR_STANDARD = 3;
const MIN_SOURCES_FOR_STANDARD = 3;
const MAX_STANDARD_RUNTIME_S = 75;
const MIN_TIKTOK_RUNTIME_S = 60;
const SAFE_STANDARD_RUNTIME_S = 66;
const STANDARD_CLIP_GAP_TOLERANCE_S = 15;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(array(values).map((value) => normaliseText(value).trim()).filter(Boolean))];
}

function mdCell(value) {
  return normaliseText(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function bool(value) {
  return value === true;
}

function safeId(value) {
  return String(value || "story")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "story";
}

function runtimePlan(row = {}) {
  const audioDuration = numberValue(row.audio?.duration_seconds, null);
  if (Number.isFinite(audioDuration) && audioDuration > 0) {
    const capped = Math.min(MAX_STANDARD_RUNTIME_S, Math.max(1, audioDuration));
    return {
      target_duration_s: Number(capped.toFixed(1)),
      runtime_class:
        capped >= 61 && capped <= 68
          ? "standard_short_61_68"
          : capped <= MAX_STANDARD_RUNTIME_S
            ? "standard_short_69_75"
            : "over_standard_limit",
      source: "approved_audio_duration",
      tiktok_60s_eligible: capped >= MIN_TIKTOK_RUNTIME_S,
    };
  }
  return {
    target_duration_s: SAFE_STANDARD_RUNTIME_S,
    runtime_class: "standard_short_61_68",
    source: "default_standard_short_target",
    tiktok_60s_eligible: true,
  };
}

function entityScenes(row = {}) {
  const storyEntities = unique(row.visuals?.story_entities);
  const validated = unique(row.visuals?.validated_entities);
  const entities = storyEntities.length ? storyEntities : unique(row.visuals?.exact_subject_groups);
  const scenes = [];
  for (const entity of entities.slice(0, 6)) {
    scenes.push({
      type: validated.some((item) => normaliseText(item) === normaliseText(entity)) ? "clip.motion" : "still",
      label: `${safeId(entity)}_${scenes.length + 1}`,
      entity,
      duration: 4,
    });
  }
  if (scenes.length > 0) {
    scenes.splice(Math.min(2, scenes.length), 0, {
      type: "card.source",
      label: "source_context",
      duration: 3,
    });
    scenes.push({
      type: "card.takeaway",
      label: "why_it_matters",
      duration: 3,
    });
  }
  return scenes;
}

function recommendationForRow(row = {}) {
  const runtime = runtimePlan(row);
  const stage = String(row.stage || "");
  const exactCount = numberValue(row.visuals?.exact_subject_count);
  const clipRefs = numberValue(row.visuals?.validated_clip_ref_count);
  const clipSources = numberValue(row.visuals?.validated_clip_source_count);
  const clipGap = numberValue(row.visuals?.clip_dominance_shortfall_seconds, null);
  const visualGateReady = row.visuals?.visual_evidence_gate_ready !== false;
  const audioReady = bool(row.audio?.ready);
  const missingMotionEntities = unique(row.visuals?.missing_motion_entities);
  const currentBlockers = unique(row.blocking_dimensions);
  const scenes = entityScenes(row);
  const overlayPlan = buildStandardShortCreatorOverlayPlan({
    story: {
      id: row.story_id,
      title: row.title,
      source_type: row.source_type || "unknown",
      subreddit: row.publisher || row.source_name || "Pulse",
      full_script: "",
    },
    scenes,
    durationS: runtime.target_duration_s,
  });

  const common = {
    current_stage: stage || "unknown",
    current_blockers: currentBlockers,
    target_runtime: runtime,
    exact_subject_count: exactCount,
    validated_clip_ref_count: clipRefs,
    validated_clip_source_count: clipSources,
    clip_dominance_shortfall_seconds: Number.isFinite(clipGap) ? Number(clipGap.toFixed(1)) : null,
    missing_motion_entities: missingMotionEntities,
    overlay_contract: {
      verdict: overlayPlan.verdict,
      blockers: overlayPlan.blockers,
      warnings: overlayPlan.warnings,
      caption_rules: overlayPlan.caption_rules,
      entity_popups: overlayPlan.entity_popups,
      scene_inventory: overlayPlan.scene_inventory,
    },
    overlay_story: {
      id: row.story_id,
      title: row.title,
      source_type: row.source_type || "unknown",
      subreddit: row.publisher || row.source_name || "Pulse",
      publisher: row.publisher || row.source_name || "Pulse",
      full_script: "",
    },
    overlay_scenes: scenes,
  };

  if (stage === "ready_for_local_flash_proof") {
    return {
      ...common,
      verdict: "keep_flash_lane",
      recommended_lane: "pulse_flash_lane",
      confidence: "high",
      reason: "All Flash Lane preflight blockers are clear.",
      next_actions: ["render_local_flash_proof"],
      publish_safety: "report_only_no_production_change",
    };
  }

  if (!audioReady) {
    return {
      ...common,
      verdict: "blocked_before_downgrade",
      recommended_lane: "hold_until_local_liam_audio_ready",
      confidence: "high",
      reason: "A standard short still needs approved narration before it is worth rendering.",
      next_actions: ["repair_or_generate_approved_local_liam_audio"],
      publish_safety: "report_only_no_production_change",
    };
  }

  if (!visualGateReady || exactCount < MIN_EXACT_FOR_STANDARD) {
    return {
      ...common,
      verdict: "not_safe_for_video_yet",
      recommended_lane: exactCount > 0 ? "short_only_or_card_only_review" : "blog_only_or_context_card",
      confidence: "medium",
      reason: "The story lacks enough safe exact-subject visual evidence for a good standard video.",
      next_actions: ["repair_exact_subject_visuals_before_render"],
      publish_safety: "report_only_no_production_change",
    };
  }

  if (clipRefs >= MIN_CLIPS_FOR_STANDARD && clipSources >= MIN_SOURCES_FOR_STANDARD && missingMotionEntities.length === 0) {
    const gapIsSmallEnough =
      !Number.isFinite(clipGap) || clipGap <= STANDARD_CLIP_GAP_TOLERANCE_S;
    return {
      ...common,
      verdict: gapIsSmallEnough ? "downgrade_to_standard_short_motion_lite" : "review_standard_short_motion_lite",
      recommended_lane: "pulse_standard_short_motion_lite",
      confidence: gapIsSmallEnough ? "high" : "medium",
      reason: gapIsSmallEnough
        ? "The story has enough exact material for a standard creator-style short, but not enough clip dominance for premium Flash Lane."
        : "The story has clips, but the motion gap is large enough that a human should review before rendering.",
      next_actions: [
        "use_creator_overlay_contract",
        "keep_flash_lane_blocked_until_more_official_motion_is_acquired",
      ],
      publish_safety: "report_only_no_production_change",
    };
  }

  if (clipRefs > 0) {
    return {
      ...common,
      verdict: "downgrade_to_short_only_or_standard_review",
      recommended_lane: missingMotionEntities.length
        ? "standard_short_context_bridge_review"
        : "short_only_motion_lite_review",
      confidence: "medium",
      reason: missingMotionEntities.length
        ? "Some discussed entities still lack validated motion, so a standard short can only work as a context bridge."
        : "There is some motion, but not enough source diversity for confident standard-short rendering.",
      next_actions: ["continue_motion_acquisition_or_route_to_shorter_review_lane"],
      publish_safety: "report_only_no_production_change",
    };
  }

  return {
    ...common,
    verdict: "downgrade_to_blog_or_card_only",
    recommended_lane: "blog_only_or_card_only",
    confidence: "high",
    reason: "No validated motion exists, so a video would regress into weak cards and stills.",
    next_actions: ["do_not_render_video_until_motion_or_visual_evidence_improves"],
    publish_safety: "report_only_no_production_change",
  };
}

function buildFlashLaneDowngradePlan({ currentStateReport = {}, storyId = null, limit = 20 } = {}) {
  const sourceRows = array(currentStateReport.rows)
    .filter((row) => !storyId || row.story_id === storyId)
    .slice(0, Math.max(1, Number(limit) || 20));
  const rows = sourceRows.map((row) => {
    const recommendation = recommendationForRow(row);
    return {
      story_id: row.story_id,
      title: row.title,
      current_stage: row.stage,
      distance_to_local_proof: row.distance_to_local_proof,
      recommendation,
    };
  });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_current_state_generated_at: currentStateReport.generated_at || null,
    summary: {
      rows_considered: rows.length,
      keep_flash_lane: rows.filter((row) => row.recommendation.verdict === "keep_flash_lane").length,
      downgrade_to_standard_short: rows.filter((row) =>
        String(row.recommendation.verdict || "").includes("standard_short"),
      ).length,
      not_safe_for_video_yet: rows.filter((row) => row.recommendation.verdict === "not_safe_for_video_yet").length,
      blocked_before_downgrade: rows.filter((row) => row.recommendation.verdict === "blocked_before_downgrade").length,
      blog_or_card_only: rows.filter((row) => row.recommendation.verdict === "downgrade_to_blog_or_card_only").length,
    },
    rows,
    safety: {
      local_only: true,
      report_only: true,
      renders_video: false,
      calls_tts: false,
      downloads_media: false,
      posts_to_platforms: false,
      mutates_db: false,
      touches_railway: false,
      triggers_oauth: false,
      switches_production_renderer: false,
    },
  };
}

function renderFlashLaneDowngradePlanMarkdown(plan = {}) {
  const lines = [
    "# Flash Lane Downgrade Plan",
    "",
    "Report-only planner for stories that are good enough for Pulse, but not good enough for premium Flash Lane yet.",
    "",
    "## Summary",
    "",
    `- Rows considered: ${plan.summary?.rows_considered || 0}`,
    `- Keep Flash Lane: ${plan.summary?.keep_flash_lane || 0}`,
    `- Downgrade to standard short: ${plan.summary?.downgrade_to_standard_short || 0}`,
    `- Not safe for video yet: ${plan.summary?.not_safe_for_video_yet || 0}`,
    `- Blocked before downgrade: ${plan.summary?.blocked_before_downgrade || 0}`,
    `- Blog/card only: ${plan.summary?.blog_or_card_only || 0}`,
    "",
    "## Decisions",
    "",
    "| Story | Current stage | Verdict | Lane | Runtime | Reason |",
    "| --- | --- | --- | --- | ---: | --- |",
  ];

  for (const row of array(plan.rows)) {
    const rec = row.recommendation || {};
    const runtime = rec.target_runtime?.target_duration_s
      ? `${Number(rec.target_runtime.target_duration_s).toFixed(1)}s`
      : "unknown";
    lines.push(
      `| ${mdCell(`${row.story_id}: ${row.title}`)} | ${mdCell(row.current_stage)} | ${mdCell(rec.verdict)} | ${mdCell(rec.recommended_lane)} | ${mdCell(runtime)} | ${mdCell(rec.reason)} |`,
    );
  }

  lines.push("", "## Standard Overlay Contracts", "");
  for (const row of array(plan.rows)) {
    const rec = row.recommendation || {};
    if (!String(rec.verdict || "").includes("standard")) continue;
    lines.push(`### ${mdCell(row.story_id)}`);
    lines.push(`- Overlay verdict: ${rec.overlay_contract?.verdict || "unknown"}`);
    lines.push(`- Caption style: ${rec.overlay_contract?.caption_rules?.style || "unknown"}`);
    lines.push(`- Max caption lines: ${rec.overlay_contract?.caption_rules?.max_lines ?? "unknown"}`);
    lines.push(`- Entity popups: ${array(rec.overlay_contract?.entity_popups).map((item) => item.entity).join(", ") || "none"}`);
    if (rec.overlay_command) lines.push(`- Overlay command: \`${rec.overlay_command}\``);
    lines.push(`- Next actions: ${array(rec.next_actions).join("; ") || "none"}`);
    lines.push("");
  }

  lines.push(
    "## Safety",
    "",
    "- Report-only and local-only.",
    "- Does not render, download media, call TTS, post, mutate the DB, touch Railway, trigger OAuth or switch production renderer.",
    "- Downgrade recommendations are planning signals only. Live production routing still needs a separate reviewed change.",
    "",
  );
  return lines.join("\n");
}

module.exports = {
  buildFlashLaneDowngradePlan,
  renderFlashLaneDowngradePlanMarkdown,
  recommendationForRow,
  entityScenes,
  safeId,
};
