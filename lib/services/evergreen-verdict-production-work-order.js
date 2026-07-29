"use strict";

const {
  FORMAT_ID,
  assessEvergreenVerdictCandidate,
} = require("../formats/evergreen-verdict-short");
const {
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  getAssCaptionSafeZoneContract,
  getPlatformSafeZoneProfile,
} = require("./platform-safe-zones");

const SCHEMA_VERSION = "pulse-evergreen-production-work-order-v1";
const MODE = "LOCAL_PROOF";
const SCRIPT_SECTIONS = Object.freeze([
  "hook",
  "body",
  "payoff",
  "loop",
]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, places = 1) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function countWords(value) {
  const cleaned = text(value)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .trim();
  return cleaned ? cleaned.split(/\s+/).length : 0;
}

function isHttps(value) {
  try {
    return new URL(text(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function storyBlockers(story, pitch) {
  const blockers = [];
  const storyId = text(story?.id);
  const boundStoryId = text(pitch?.story_id);
  if (!storyId) blockers.push("evergreen_story_id_required");
  if (!text(story?.title)) blockers.push("evergreen_story_title_required");
  if (!isHttps(story?.url || story?.source_url)) {
    blockers.push("evergreen_story_https_source_required");
  }
  if (
    !["verified", "confirmed"].includes(
      text(story?.source_confidence).toLowerCase(),
    )
  ) {
    blockers.push("evergreen_story_verified_confidence_required");
  }
  if (!boundStoryId || !storyId || boundStoryId !== storyId) {
    blockers.push("evergreen_story_binding_mismatch");
  }
  return blockers;
}

function materialiseScript(pitch) {
  const sections = clone(pitch.script_material || {});
  const fullScript = SCRIPT_SECTIONS.map((section) =>
    text(sections?.[section]?.text),
  )
    .filter(Boolean)
    .join(" ");
  const wordCount = countWords(fullScript);
  const wordsPerMinute = number(
    pitch?.script_contract?.target_words_per_minute,
  );
  return {
    schema_version: 1,
    materialisation: "verbatim_from_explicit_evergreen_pitch",
    target_duration_seconds: number(
      pitch?.script_contract?.target_duration_seconds,
    ),
    target_words_per_minute: wordsPerMinute,
    word_count: wordCount,
    estimated_duration_seconds:
      wordsPerMinute && wordsPerMinute > 0
        ? round((wordCount / wordsPerMinute) * 60, 1)
        : null,
    sections,
    full_script: fullScript,
    claim_bindings: Object.fromEntries(
      SCRIPT_SECTIONS.map((section) => [
        section,
        clone(array(sections?.[section]?.claim_refs)),
      ]),
    ),
    originality: clone(pitch?.script_contract?.originality),
  };
}

function scriptBlockers(pitch) {
  const sections = pitch?.script_material || {};
  const blockers = [];
  const claimIds = new Set(
    array(pitch?.claims)
      .map((claim) => text(claim?.id))
      .filter(Boolean),
  );
  for (const section of SCRIPT_SECTIONS) {
    if (!text(sections?.[section]?.text)) {
      blockers.push(`script_section_missing:${section}`);
      continue;
    }
    const references = array(sections?.[section]?.claim_refs).map(text);
    if (!references.length) {
      blockers.push(`script_claim_references_missing:${section}`);
      continue;
    }
    for (const reference of references) {
      if (!claimIds.has(reference)) {
        blockers.push(
          `script_claim_reference_unknown:${section}:${reference}`,
        );
      }
    }
  }
  const hookWordCount = countWords(sections?.hook?.text);
  if (hookWordCount > 15) {
    blockers.push("script_hook_exceeds_15_words");
  }
  if (
    number(pitch?.script_contract?.opening_premise_words) !==
    hookWordCount
  ) {
    blockers.push("opening_premise_word_count_mismatch");
  }
  return blockers;
}

function scriptRuntimeBlockers(script) {
  const duration = number(script?.estimated_duration_seconds);
  return duration !== null && duration >= 61 && duration <= 90
    ? []
    : ["script_estimated_duration_outside_61_to_90_seconds"];
}

function originalityBlockers(pitch) {
  const originality = pitch?.script_contract?.originality || {};
  const blockers = [];
  if (originality.script_original !== true) {
    blockers.push("script_originality_not_attested");
  }
  if (originality.copied_reference_script !== false) {
    blockers.push("copied_reference_script_not_allowed");
  }
  if (originality.copied_reference_sequence !== false) {
    blockers.push("copied_reference_sequence_not_allowed");
  }
  if (originality.competitor_assets_used !== false) {
    blockers.push("competitor_assets_not_allowed");
  }
  if (!text(originality.reviewed_by)) {
    blockers.push("script_originality_review_missing");
  }
  return blockers;
}

function visualPlanBlockers(pitch) {
  const blockers = [];
  const beats = array(pitch?.visual_beats);
  const targetDuration = number(
    pitch?.script_contract?.target_duration_seconds,
  );
  const rightsAssets = new Set(
    array(pitch?.media_plan?.rights_records)
      .map((record) => text(record?.asset_id))
      .filter(Boolean),
  );
  if (beats.length < 8) blockers.push("visual_beat_count_too_low");
  const ids = new Set();
  for (const beat of beats) {
    const id = text(beat?.id);
    const assetId = text(beat?.asset_id);
    const start = number(beat?.start_seconds);
    const end = number(beat?.end_seconds);
    if (!id) {
      blockers.push("visual_beat_id_missing");
    } else if (ids.has(id)) {
      blockers.push(`visual_beat_id_duplicate:${id}`);
    }
    ids.add(id);
    if (
      start === null ||
      end === null ||
      start < 0 ||
      end <= start
    ) {
      blockers.push(`visual_beat_time_invalid:${id || "unknown"}`);
    }
    if (!assetId || !rightsAssets.has(assetId)) {
      blockers.push(
        `visual_beat_rights_asset_unknown:${id || "unknown"}:${
          assetId || "missing"
        }`,
      );
    }
    if (!text(beat?.overlay_text)) {
      blockers.push(`visual_beat_overlay_missing:${id || "unknown"}`);
    }
  }
  const firstStart = number(beats[0]?.start_seconds);
  const lastEnd = number(beats[beats.length - 1]?.end_seconds);
  let continuous = firstStart === 0 && lastEnd === targetDuration;
  for (let index = 1; index < beats.length; index += 1) {
    if (
      number(beats[index - 1]?.end_seconds) !==
      number(beats[index]?.start_seconds)
    ) {
      continuous = false;
    }
  }
  if (!continuous) blockers.push("visual_beat_timeline_incomplete");
  for (const section of SCRIPT_SECTIONS) {
    if (!beats.some((beat) => text(beat?.section) === section)) {
      blockers.push(`visual_beat_section_missing:${section}`);
    }
  }
  return blockers;
}

function materialiseVisualPlan(pitch) {
  const profile = getPlatformSafeZoneProfile(
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  );
  const captionContract = getAssCaptionSafeZoneContract(
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  );
  const overlayBox = {
    x: profile.safe_rect.x + 24,
    y: profile.safe_rect.y + 24,
    width: profile.safe_rect.width - 48,
    height: profile.safe_rect.height - 48,
  };
  return {
    schema_version: 1,
    profile_id: profile.id,
    canvas: profile.canvas,
    full_bleed_region: {
      x: 0,
      y: 0,
      width: profile.canvas.width,
      height: profile.canvas.height,
    },
    safe_rect: profile.safe_rect,
    covered_surfaces: profile.covered_surfaces,
    caption_contract: captionContract,
    composition: {
      background_fit: "cover",
      background_full_bleed: true,
      cards_pills_text_inside_safe_rect: true,
      player_ui_reservation: true,
    },
    beats: array(pitch.visual_beats).map((beat) => ({
      ...clone(beat),
      background: {
        asset_id: text(beat?.asset_id),
        full_bleed: true,
        fit: "cover",
        bbox: {
          x: 0,
          y: 0,
          width: profile.canvas.width,
          height: profile.canvas.height,
        },
      },
      meaningful_overlay: {
        text: text(beat?.overlay_text),
        bbox: { ...overlayBox },
        constrained_to_safe_rect: true,
      },
    })),
  };
}

function buildEvergreenVerdictProductionWorkOrder({
  story = {},
  evergreen_pitch: pitch = {},
  history = [],
  policy,
  now = new Date().toISOString(),
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("evergreen_work_order_time_invalid");
  }
  const hasExplicitPitch = Boolean(
    pitch && typeof pitch === "object" && !Array.isArray(pitch),
  );
  const governedPitch = hasExplicitPitch ? pitch : {};
  const assessment = assessEvergreenVerdictCandidate(governedPitch, {
    history,
    policy,
    now: generatedAt.toISOString(),
  });
  const script = materialiseScript(governedPitch);
  const blockers = [
    ...(hasExplicitPitch ? [] : ["explicit_evergreen_pitch_required"]),
    ...assessment.blockers,
    ...storyBlockers(story, governedPitch),
    ...scriptBlockers(governedPitch),
    ...scriptRuntimeBlockers(script),
    ...originalityBlockers(governedPitch),
    ...visualPlanBlockers(governedPitch),
  ];
  const visualPlan = materialiseVisualPlan(governedPitch);
  const workOrder = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    mode: MODE,
    story_id: text(story.id),
    candidate_id: text(governedPitch.id),
    format_id: FORMAT_ID,
    duration_lane: "pulse_extended_short",
    story_snapshot: clone(story),
    pitch_snapshot: clone(governedPitch),
    assessment,
    script_contract: script,
    visual_beat_plan: visualPlan,
    evidence: {
      source_manifest: clone(array(governedPitch.source_manifest)),
      claims: clone(array(governedPitch.claims)),
      item_rationales: clone(array(governedPitch.item_rationales)),
      rights_records: clone(
        array(governedPitch?.media_plan?.rights_records),
      ),
      first_hand_evidence: clone(
        governedPitch.first_hand_evidence || null,
      ),
    },
    authority: {
      approval_created: false,
      scheduler_created: false,
      publish_created: false,
      external_calls_allowed: false,
    },
  };

  return {
    schema_version: "pulse-evergreen-work-order-result-v1",
    generated_at: generatedAt.toISOString(),
    mode: MODE,
    verdict: blockers.length
      ? "BLOCKED"
      : "READY_FOR_LOCAL_PRODUCTION",
    blockers: [...new Set(blockers)],
    work_order: blockers.length ? null : workOrder,
    safety: {
      planning_only: true,
      input_claims_retained_verbatim: true,
      input_rights_retained_verbatim: true,
      approval_authority_created: false,
      scheduler_authority_created: false,
      publish_authority_created: false,
      no_external_calls: true,
      no_publish_triggered: true,
    },
  };
}

function renderEvergreenVerdictProductionWorkOrderMarkdown(result = {}) {
  const workOrder = result.work_order;
  const lines = [
    "# Pulse Gaming Evergreen Production Work Order",
    "",
    `Generated: ${text(result.generated_at)}`,
    `Mode: ${text(result.mode)}`,
    `Verdict: ${text(result.verdict)}`,
    "",
  ];
  if (workOrder) {
    lines.push(
      `Story: ${text(workOrder.story_snapshot?.title)}`,
      `Candidate: ${text(workOrder.candidate_id)}`,
      `Script words: ${Number(
        workOrder.script_contract?.word_count || 0,
      )}`,
      `Estimated duration: ${Number(
        workOrder.script_contract?.estimated_duration_seconds || 0,
      )} seconds`,
      `Visual beats: ${array(
        workOrder.visual_beat_plan?.beats,
      ).length}`,
      `Sources: ${array(workOrder.evidence?.source_manifest).length}`,
      `Claims: ${array(workOrder.evidence?.claims).length}`,
      `Rights records: ${array(workOrder.evidence?.rights_records).length}`,
      "",
    );
  }
  lines.push("## Blockers", "");
  if (!array(result.blockers).length) lines.push("- None");
  for (const blocker of array(result.blockers)) {
    lines.push(`- ${text(blocker)}`);
  }
  lines.push(
    "",
    "This LOCAL_PROOF work order does not grant approval, scheduler or publish authority.",
    "",
  );
  return lines.join("\n");
}

module.exports = {
  MODE,
  SCHEMA_VERSION,
  SCRIPT_SECTIONS,
  buildEvergreenVerdictProductionWorkOrder,
  renderEvergreenVerdictProductionWorkOrderMarkdown,
};
