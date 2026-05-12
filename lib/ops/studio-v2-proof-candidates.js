"use strict";

const {
  officialTrailerFrameRejectReason,
} = require("../controlled-frame-extraction-worker");
const {
  classifyLocalTtsProofFailure,
} = require("../studio/local-tts-failures");
const {
  DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
} = require("../studio/v2/local-voice-reference");
const { buildSubjectGraph } = require("../exact-subject-matching");
const { summariseForensicWarnings } = require("../studio/v2/promotion-packet");
const {
  buildFlashLaneFootageBackboneReport,
} = require("../studio/v2/flash-lane-footage-backbone");
const {
  officialMediaReferenceRejectReason,
} = require("../official-media-reference-preflight");
const { normaliseText } = require("../text-hygiene");

const EXACT_PREMIUM_MATCHES = new Set([
  "exact_game_match",
  "exact_franchise_match",
  "exact_platform_match",
]);
const FLASH_MIN_EXACT_SUBJECT_ASSETS = 4;
const FLASH_MIN_MOTION_FRAMES = 2;
const FLASH_MIN_VALIDATED_CLIP_REFS = 3;
const FLASH_MIN_VALIDATED_CLIP_SOURCES = 3;
const FLASH_MIN_VALIDATED_ENTITY_COVERAGE = 2;
const FLASH_MIN_SECONDS = 61;
const FLASH_MAX_SECONDS = 75;
const LOCAL_PROOF_TARGET_MIN_SECONDS = 64;
const LOCAL_PROOF_TARGET_MAX_SECONDS = 70;
const FLASH_MAX_COVER_EXACT_ASSET_SHARE = 0.5;
const FLASH_MAX_WRONG_STORY_EXACT_ASSETS = 0;

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function storyIdOf(item = {}) {
  return item.story_id || item.storyId || item.id || null;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function uniqueStrings(items) {
  return [...new Set(array(items).map((item) => normaliseText(item).trim()).filter(Boolean))];
}

function normaliseLabel(value) {
  return normaliseText(value).trim().toLowerCase();
}

function sourceTypeOf(asset = {}) {
  return String(asset.source_type || asset.sourceType || asset.type || "").trim().toLowerCase();
}

function storyPriority(story = {}) {
  return Number(story.breaking_score || story.score || 0) || 0;
}

function storyApproved(story = {}) {
  return bool(story.approved) || bool(story.auto_approved);
}

function durationInFlashRange(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value >= FLASH_MIN_SECONDS && value <= FLASH_MAX_SECONDS;
}

function acceptedLocalVoiceReference(reference = {}) {
  return (
    reference &&
    String(reference.id || "") === DEFAULT_ACCEPTED_LOCAL_VOICE_ID &&
    reference.referencePresent === true
  );
}

function acousticFor(row = {}) {
  return row.acoustic || row.local_voice_evidence?.acoustic || null;
}

function transcriptFor(row = {}) {
  return String(row.transcript || row.local_voice_evidence?.transcript || "");
}

function wordsPerMinute(wordCount, durationSeconds) {
  const words = Number(wordCount);
  const duration = Number(durationSeconds);
  if (!Number.isFinite(words) || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.round((words / duration) * 60);
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function timestampMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportGeneratedAt(report = {}) {
  return report.generated_at || report.generatedAt || report.summary?.generated_at || report.summary?.generatedAt || null;
}

function normaliseProofStoryId(value) {
  return String(value || "").trim().replace(/_(baseline|enriched)$/i, "");
}

function forensicStoryId(report = {}) {
  return normaliseProofStoryId(report.story_id || report.storyId || report.summary?.storyId);
}

function collectAppliedAudio(localAudioReports = []) {
  const byStory = new Map();
  for (const report of array(localAudioReports)) {
    for (const item of array(report?.applied)) {
      const storyId = storyIdOf(item);
      if (!storyId) continue;
      const durationSeconds = Number(item.duration_seconds ?? item.durationSeconds);
      const outputAudioPath = item.output_audio_path || item.outputAudioPath || item.audio_path || null;
      const timestampsPath =
        item.timestamps_path ||
        item.timestampsPath ||
        (typeof outputAudioPath === "string"
          ? outputAudioPath.replace(/\.(mp3|wav|m4a)$/i, "_timestamps.json")
          : null);
      const durationVerdict = item.duration_verdict || item.durationVerdict || null;
      const acoustic = acousticFor(item);
      const transcript = transcriptFor(item);
      const wordCount = Number(item.text_word_count ?? item.word_count);
      const timestampWordCount = finiteNumber(
        item.timestamp_word_count ??
          item.timestamps_word_count ??
          item.caption_word_count ??
          item.local_voice_evidence?.timestamp_word_count ??
          item.local_voice_evidence?.caption_word_count,
      );
      const wpm = Number(item.wpm) || wordsPerMinute(wordCount, durationSeconds);
      const localVoiceReference = item.local_voice_reference || null;
      const acceptedReference = acceptedLocalVoiceReference(localVoiceReference);
      const proofFailure = acceptedReference
        ? classifyLocalTtsProofFailure({
            durationSeconds,
            timestampsStamped: item.local_voice_metadata !== "not_stamped",
            localVoiceReference,
            acoustic,
            transcript,
            wordCount,
            wpm,
          })
        : {
            code: "unaccepted_local_voice_reference",
            message: "local audio proof is missing the accepted Sleepy Liam reference",
          };
      const ready =
        durationVerdict === "pass" &&
        Boolean(outputAudioPath) &&
        durationInFlashRange(durationSeconds) &&
        acceptedReference &&
        !proofFailure.code;
      const normalised = {
        story_id: storyId,
        output_audio_path: outputAudioPath,
        timestamps_path: timestampsPath,
        duration_seconds: Number.isFinite(durationSeconds) ? Number(durationSeconds.toFixed(3)) : null,
        duration_verdict: durationVerdict,
        local_voice_reference: localVoiceReference,
        local_voice_reference_accepted: acceptedReference,
        acoustic_verified: Boolean(acoustic),
        spoken_outro_present: !proofFailure.code || proofFailure.code !== "missing_spoken_outro",
        caption_coverage_ratio: finiteNumber(
          item.caption_coverage_ratio ??
            item.captionCoverageRatio ??
            item.local_voice_evidence?.caption_coverage_ratio,
        ),
        caption_max_gap_s: finiteNumber(
          item.caption_max_gap_s ??
            item.captionMaxGapS ??
            item.local_voice_evidence?.caption_max_gap_s,
        ),
        timestamp_word_count: timestampWordCount,
        wpm: Number.isFinite(wpm) ? wpm : null,
        proof_failure_code: proofFailure.code || null,
        proof_failure_message: proofFailure.message || null,
        status: ready ? "approved_local_liam_audio_ready" : "local_liam_audio_not_flash_ready",
        ready,
      };
      const current = byStory.get(storyId);
      if (!current || Number(normalised.duration_seconds || 0) > Number(current.duration_seconds || 0)) {
        byStory.set(storyId, normalised);
      }
    }
  }
  return byStory;
}

function assetBucketsFromPlan(plan = {}) {
  return [
    ...array(plan.would_fetch),
    ...array(plan.applied_assets),
    ...array(plan.provenance),
    ...array(plan.media_provenance),
    ...array(plan.visual_deck),
    ...array(plan.visual_deck?.items),
  ];
}

function isExactPremiumCandidate(asset = {}) {
  const quality = String(asset.subject_match_quality || asset.match_quality || "");
  return bool(asset.counted_for_premium) && EXACT_PREMIUM_MATCHES.has(quality);
}

function exactStoreAssetRequiresVerification(asset = {}) {
  return /^(steam|igdb)(_|$)/i.test(sourceTypeOf(asset));
}

function exactStoreAssetVerified(asset = {}) {
  return !exactStoreAssetRequiresVerification(asset) || asset.store_match_verified === true;
}

function isPremiumExactAsset(asset = {}) {
  return isExactPremiumCandidate(asset) && exactStoreAssetVerified(asset);
}

function isCoverLikeExactAsset(asset = {}) {
  return /(^|_)(cover|capsule|box_art|library)(_|$)/i.test(sourceTypeOf(asset));
}

function exactAssetGroup(asset = {}) {
  return asset.exact_subject_group || asset.entity || asset.game || asset.game_title || "";
}

function storySearchText(story = {}) {
  return normaliseLabel(
    [
      story.title,
      story.full_script,
      story.hook,
      story.body,
      story.loop,
      story.description,
    ].filter(Boolean).join(" "),
  );
}

function exactAssetMatchesStory(asset = {}, story = {}, storyTargets = []) {
  const group = normaliseLabel(exactAssetGroup(asset));
  if (!group) return true;
  const targets = new Set(uniqueStrings(storyTargets).map(normaliseLabel));
  if (targets.has(group)) return true;
  return storySearchText(story).includes(group);
}

function buildVisualEvidenceGate({ story = {}, assets = {} } = {}) {
  const exactAssets = array(assets.exact_subject_assets);
  const unverifiedStoreExactAssets = array(assets.unverified_store_exact_assets);
  const storyTargets = uniqueStrings(assets.story_target_entities);
  const coverAssets = exactAssets.filter(isCoverLikeExactAsset);
  const coverShare = exactAssets.length
    ? Number((coverAssets.length / exactAssets.length).toFixed(3))
    : 0;
  const wrongStoryAssets = exactAssets.filter(
    (asset) => !exactAssetMatchesStory(asset, story, storyTargets),
  );
  const wrongStoryShare = exactAssets.length
    ? Number((wrongStoryAssets.length / exactAssets.length).toFixed(3))
    : 0;
  const blockers = [];
  const warnings = [];

  if (
    unverifiedStoreExactAssets.length > 0 &&
    exactAssets.length < FLASH_MIN_EXACT_SUBJECT_ASSETS
  ) {
    blockers.push("flash_proof_requires_verified_store_exact_assets");
  } else if (unverifiedStoreExactAssets.length > 0) {
    warnings.push("unverified_store_exact_assets_ignored");
  }

  if (
    exactAssets.length >= FLASH_MIN_EXACT_SUBJECT_ASSETS &&
    coverShare > FLASH_MAX_COVER_EXACT_ASSET_SHARE
  ) {
    blockers.push("flash_proof_blocks_cover_dominated_exact_assets");
  }

  if (
    storyTargets.length > 0 &&
    exactAssets.length > 0 &&
    wrongStoryAssets.length > 0
  ) {
    blockers.push("flash_proof_blocks_wrong_story_exact_assets");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    unverified_store_exact_asset_count: unverifiedStoreExactAssets.length,
    cover_dominated_exact_asset_count: coverAssets.length,
    cover_dominated_exact_asset_share: coverShare,
    wrong_story_exact_asset_count: wrongStoryAssets.length,
    wrong_story_exact_asset_share: wrongStoryShare,
    wrong_story_exact_asset_groups: uniqueStrings(wrongStoryAssets.map(exactAssetGroup)),
  };
}

function collectAssetStrength(assetReports = []) {
  const byStory = new Map();
  for (const report of array(assetReports)) {
    for (const plan of array(report?.plans)) {
      const storyId = storyIdOf(plan);
      if (!storyId) continue;
      const existing = byStory.get(storyId) || {
        exact_subject_assets: [],
        unverified_store_exact_assets: [],
        context_assets: [],
        rejected_assets: [],
      };
      for (const asset of assetBucketsFromPlan(plan)) {
        if (!asset || typeof asset !== "object") continue;
        if (isPremiumExactAsset(asset)) {
          existing.exact_subject_assets.push(asset);
        } else if (isExactPremiumCandidate(asset) && !exactStoreAssetVerified(asset)) {
          existing.unverified_store_exact_assets.push(asset);
        } else if (asset.status === "rejected" || asset.rejected === true) {
          existing.rejected_assets.push(asset);
        } else {
          existing.context_assets.push(asset);
        }
      }
      byStory.set(storyId, existing);
    }
  }
  for (const [storyId, value] of byStory.entries()) {
    const exact = uniqueBy(value.exact_subject_assets, (asset) =>
      [
        asset.local_path,
        asset.path,
        asset.source_url,
        asset.url,
        asset.id,
        asset.exact_subject_group,
        asset.entity,
      ]
        .filter(Boolean)
        .join("|"),
    );
    const exactGroups = uniqueStrings(
      exact.map((asset) => asset.exact_subject_group || asset.entity || asset.game || asset.game_title),
    );
    const unverifiedStoreExact = uniqueBy(value.unverified_store_exact_assets, (asset) =>
      [
        asset.local_path,
        asset.path,
        asset.source_url,
        asset.url,
        asset.id,
        exactAssetGroup(asset),
      ]
        .filter(Boolean)
        .join("|"),
    );
    byStory.set(storyId, {
      ...value,
      exact_subject_assets: exact,
      unverified_store_exact_assets: unverifiedStoreExact,
      exact_subject_count: exact.length,
      unverified_store_exact_count: unverifiedStoreExact.length,
      exact_subject_groups: exactGroups,
      exact_subject_ready: exact.length >= FLASH_MIN_EXACT_SUBJECT_ASSETS,
    });
  }
  return byStory;
}

function frameAccepted(frame = {}) {
  const status = String(frame.status || frame.verdict || "").toLowerCase();
  const qa = frame.qa || {};
  const qaVerdict = String(qa.verdict || "").toLowerCase();
  const failures = array(qa.failures);
  if (officialTrailerFrameRejectReason(frame, qa)) return false;
  return (
    status === "accepted" &&
    (qaVerdict === "" || qaVerdict === "pass") &&
    failures.length === 0 &&
    Boolean(frame.local_path || frame.localPath || qa.local_path)
  );
}

function collectFrameStrength(frameReports = []) {
  const byStory = new Map();
  for (const report of array(frameReports)) {
    for (const plan of array(report?.plans)) {
      const storyId = storyIdOf(plan);
      if (!storyId) continue;
      const accepted = array(plan.frames).filter(frameAccepted);
      const rejected = array(plan.frames).filter((frame) => !frameAccepted(frame));
      const existing = byStory.get(storyId) || { accepted: [], rejected: [] };
      existing.accepted.push(...accepted);
      existing.rejected.push(...rejected);
      byStory.set(storyId, existing);
    }
  }
  const out = new Map();
  for (const [storyId, frameSets] of byStory.entries()) {
    const frames = frameSets.accepted;
    const rejected = frameSets.rejected;
    const uniqueFrames = uniqueBy(frames, (frame) =>
      frame.qa?.content_hash || frame.local_path || frame.localPath || frame.source_url,
    );
    out.set(storyId, {
      accepted_frames: uniqueFrames,
      accepted_frame_count: uniqueFrames.length,
      rejected_frame_count: rejected.length,
      rejected_frame_reasons: uniqueStrings(
        rejected.flatMap((frame) => [
          frame.reason,
          frame.status,
          frame.qa?.visual_taste?.reason,
          ...array(frame.qa?.failures),
        ]),
      ),
      frame_groups: uniqueStrings(uniqueFrames.map((frame) => frame.entity || frame.exact_subject_group)),
      motion_backbone_ready: uniqueFrames.length >= FLASH_MIN_MOTION_FRAMES,
    });
  }
  return out;
}

function inferStoryIdFromSegment(segment = {}, report = {}) {
  if (segment.story_id || segment.storyId) return segment.story_id || segment.storyId;
  if (report.story_id || report.storyId) return report.story_id || report.storyId;
  for (const sample of array(segment.samples)) {
    if (sample.story_id || sample.storyId) return sample.story_id || sample.storyId;
    const localPath = String(sample.local_path || sample.localPath || "");
    const match = localPath.match(/[\\/]assets[\\/]([^\\/]+)[\\/]/i);
    if (match?.[1]) return match[1];
  }
  const localPath = String(segment.local_path || segment.localPath || "");
  const match = localPath.match(/[\\/]assets[\\/]([^\\/]+)[\\/]/i);
  return match?.[1] || null;
}

function segmentValidated(segment = {}) {
  if (officialMediaReferenceRejectReason(segment)) return false;
  return (
    segment.allowed_for_flash_lane === true ||
    (segment.segment_validated === true && String(segment.status || "").toLowerCase() === "validated")
  );
}

function collectSegmentStrength(segmentValidationReports = []) {
  const byStory = new Map();
  const rejectedByStory = new Map();
  for (const report of array(segmentValidationReports)) {
    for (const segment of array(report?.segments)) {
      const storyId = inferStoryIdFromSegment(segment, report);
      if (!storyId) continue;
      if (!segmentValidated(segment)) {
        const rejected = rejectedByStory.get(storyId) || [];
        rejected.push(segment);
        rejectedByStory.set(storyId, rejected);
        continue;
      }
      const existing = byStory.get(storyId) || [];
      existing.push(segment);
      byStory.set(storyId, existing);
    }
  }
  const out = new Map();
  const storyIds = new Set([...byStory.keys(), ...rejectedByStory.keys()]);
  for (const storyId of storyIds) {
    const segments = byStory.get(storyId) || [];
    const rejectedSegments = rejectedByStory.get(storyId) || [];
    const uniqueSegments = uniqueBy(segments, (segment) =>
      segment.clip_key ||
      [
        segment.source_url,
        segment.path,
        segment.entity,
        Number(segment.media_start_s ?? segment.mediaStartS ?? 0).toFixed(2),
      ]
        .filter(Boolean)
        .join("|"),
    );
    const uniqueSources = uniqueStrings(uniqueSegments.map((segment) => segment.source_url || segment.path));
    out.set(storyId, {
      validated_clip_refs: uniqueSegments,
      validated_clip_ref_count: uniqueSegments.length,
      validated_clip_source_count: uniqueSources.length,
      validated_clip_entities: uniqueStrings(uniqueSegments.map((segment) => segment.entity)),
      rejected_clip_ref_count: rejectedSegments.length,
      rejected_clip_ref_reasons: uniqueStrings(
        rejectedSegments.flatMap((segment) => [
          segment.validation_reason,
          segment.status,
          ...Object.keys(segment.rejected_reasons || {}).filter((key) => segment.rejected_reasons[key]),
          ...array(segment.failures),
        ]),
      ),
      validated_clip_ref_ready: uniqueSegments.length >= FLASH_MIN_VALIDATED_CLIP_REFS,
      validated_clip_source_ready: uniqueSources.length >= FLASH_MIN_VALIDATED_CLIP_SOURCES,
      validated_clip_ready:
        uniqueSegments.length >= FLASH_MIN_VALIDATED_CLIP_REFS &&
        uniqueSources.length >= FLASH_MIN_VALIDATED_CLIP_SOURCES,
    });
  }
  return out;
}

function combineFrameReports(frameReports = []) {
  return {
    plans: array(frameReports).flatMap((report) => array(report?.plans)),
  };
}

function combineSegmentValidationReports(segmentValidationReports = []) {
  return {
    segments: array(segmentValidationReports).flatMap((report) => array(report?.segments)),
  };
}

function collectFootageBackboneStrength({
  stories = [],
  frameReports = [],
  segmentValidationReports = [],
  audioByStory = new Map(),
} = {}) {
  const out = new Map();
  const combinedFrameReport = combineFrameReports(frameReports);
  const combinedSegmentValidationReport = combineSegmentValidationReports(segmentValidationReports);
  for (const story of array(stories)) {
    const storyId = story?.id;
    if (!storyId) continue;
    const audio = audioByStory.get(storyId);
    const report = buildFlashLaneFootageBackboneReport({
      storyId,
      frameReport: combinedFrameReport,
      segmentValidationReport: combinedSegmentValidationReport,
      targetRuntimeS: Number(audio?.duration_seconds) || 66,
    });
    out.set(storyId, {
      ready: report.verdict === "ready_for_flash_render_preflight",
      verdict: report.verdict,
      blockers: array(report.blockers),
      warnings: array(report.warnings),
      projected_clip_seconds: report.projected_clip_seconds,
      projected_clip_dominance: report.projected_clip_dominance,
      projected_motion_seconds: report.projected_motion_seconds,
      projected_motion_dominance: report.projected_motion_dominance,
      validated_clip_ref_count: array(report.validated_clip_refs).length,
      recommendations: array(report.recommendations),
    });
  }
  return out;
}

function collectStillDeckReadiness(stillDeckReports = []) {
  const byStory = new Map();
  for (const report of array(stillDeckReports)) {
    const storyId = storyIdOf(report);
    if (!storyId) continue;
    const gate = report?.render_package_gate || report?.renderPackageGate || null;
    const renderReadiness = report?.render_readiness || report?.renderReadiness || null;
    const flashLaneOverlays =
      report?.render_preflight?.flashLaneOverlays ||
      report?.flashLaneOverlays ||
      report?.flash_lane_overlays ||
      null;
    byStory.set(storyId, {
      blockers: gate?.verdict === "block" ? array(gate.blockers) : [],
      warnings: array(gate?.warnings),
      render_readiness: renderReadiness,
      flash_lane_overlays: flashLaneOverlays,
    });
  }
  return byStory;
}

function rememberFreshness(map, storyId, generatedAt) {
  if (!storyId) return;
  const generatedMs = timestampMs(generatedAt);
  if (!generatedMs) return;
  const existing = map.get(storyId) || { generated_at: null, generated_ms: 0 };
  if (generatedMs > existing.generated_ms) {
    map.set(storyId, {
      generated_at: new Date(generatedMs).toISOString(),
      generated_ms: generatedMs,
    });
  }
}

function collectVisualInputFreshness({
  assetReports = [],
  frameReports = [],
  segmentValidationReports = [],
} = {}) {
  const byStory = new Map();
  for (const report of array(assetReports)) {
    const generatedAt = reportGeneratedAt(report);
    for (const plan of array(report?.plans)) {
      rememberFreshness(byStory, storyIdOf(plan), plan.generated_at || plan.generatedAt || generatedAt);
    }
  }
  for (const report of array(frameReports)) {
    const generatedAt = reportGeneratedAt(report);
    for (const plan of array(report?.plans)) {
      rememberFreshness(byStory, storyIdOf(plan), plan.generated_at || plan.generatedAt || generatedAt);
    }
  }
  for (const report of array(segmentValidationReports)) {
    const generatedAt = reportGeneratedAt(report);
    for (const segment of array(report?.segments)) {
      rememberFreshness(byStory, inferStoryIdFromSegment(segment, report), segment.generated_at || segment.generatedAt || generatedAt);
    }
  }
  return byStory;
}

function latestRenderProofForStory(forensicReports = [], storyId, visualFreshness = null) {
  const matches = array(forensicReports)
    .filter((report) => forensicStoryId(report) === normaliseProofStoryId(storyId))
    .sort((a, b) => timestampMs(reportGeneratedAt(b)) - timestampMs(reportGeneratedAt(a)));
  const report = matches[0];
  if (!report) {
    return {
      status: "not_available",
      needs_human_visual_review: false,
      blocks_fresh_proof: false,
      visual_inputs_are_newer: false,
    };
  }
  const summary = report.summary || {};
  const details = summariseForensicWarnings(report);
  const verdict = summary.verdict || report.verdict || "unknown";
  const failCount = Number(summary.failCount || summary.fail_count || 0);
  const warnCount = Number(summary.warnCount || summary.warn_count || 0);
  const generatedAt = reportGeneratedAt(report);
  const generatedMs = timestampMs(generatedAt);
  const visualGeneratedMs = Number(visualFreshness?.generated_ms || 0);
  const visualInputsAreNewer = Boolean(visualGeneratedMs && generatedMs && visualGeneratedMs > generatedMs);
  const needsReview =
    verdict !== "pass" ||
    failCount > 0 ||
    warnCount > 0 ||
    details.repeat_pair_count > 0 ||
    details.weak_frame_count > 0 ||
    details.rating_or_title_frame_count > 0;
  return {
    status: "available",
    story_id: forensicStoryId(report),
    generated_at: generatedAt || null,
    visual_inputs_generated_at: visualFreshness?.generated_at || null,
    visual_inputs_are_newer: visualInputsAreNewer,
    verdict,
    fail_count: Number.isFinite(failCount) ? failCount : 0,
    warn_count: Number.isFinite(warnCount) ? warnCount : 0,
    needs_human_visual_review: needsReview,
    blocks_fresh_proof: needsReview && !visualInputsAreNewer,
    issue_codes: details.issue_codes,
    repeat_pair_count: details.repeat_pair_count,
    repeat_pair_times: details.repeat_pair_times,
    weak_frame_count: details.weak_frame_count,
    weak_frame_times: details.weak_frame_times,
    rating_or_title_frame_count: details.rating_or_title_frame_count,
  };
}

function buildRecommendedCommand(storyId, audio, segments = {}) {
  if (!storyId || !audio?.output_audio_path) return null;
  const parts = [
    "npm run studio:v2:still-deck --",
    `--story ${storyId}`,
    `--audio "${audio.output_audio_path}"`,
  ];
  if (audio.timestamps_path) parts.push(`--timestamps "${audio.timestamps_path}"`);
  parts.push('--frame-report "test/output/controlled_frame_extraction_worker_apply_local.json"');
  if (segments.validated_clip_ready && segments.footage_backbone_ready) {
    parts.push(
      '--segment-validation-report "test/output/official_trailer_segment_validation_apply_local.json"',
      "--use-official-trailer-clips",
      "--with-sound-design",
    );
  }
  return parts.join(" ");
}

function collectEntityCoverage(assets = {}, segments = {}) {
  const exactGroups = uniqueStrings(assets.exact_subject_groups);
  const storyTargets = uniqueStrings(assets.story_target_entities);
  const requiredGroups =
    storyTargets.length >= FLASH_MIN_VALIDATED_ENTITY_COVERAGE
      ? storyTargets
      : exactGroups;
  const validatedEntities = uniqueStrings(segments.validated_clip_entities);
  const validatedSet = new Set(validatedEntities.map(normaliseLabel));
  const coveredGroups = requiredGroups.filter((group) => validatedSet.has(normaliseLabel(group)));
  const missingGroups = requiredGroups.filter((group) => !validatedSet.has(normaliseLabel(group)));
  const requiredCoverage =
    requiredGroups.length >= FLASH_MIN_VALIDATED_ENTITY_COVERAGE
      ? FLASH_MIN_VALIDATED_ENTITY_COVERAGE
      : 0;
  return {
    exact_subject_groups: exactGroups,
    story_target_entities: storyTargets,
    validated_clip_entities: validatedEntities,
    validated_entity_coverage_count: coveredGroups.length,
    validated_entity_coverage_required: requiredCoverage,
    validated_entity_coverage_ready: requiredCoverage === 0 || coveredGroups.length >= requiredCoverage,
    missing_validated_clip_entities: missingGroups,
  };
}

function collectExactSubjectEntityCoverage(assets = {}, frames = {}, segments = {}) {
  const exactGroups = uniqueStrings(assets.exact_subject_groups);
  const storyTargets = uniqueStrings(assets.story_target_entities);
  const motionGroups = uniqueStrings([
    ...array(frames.frame_groups),
    ...array(segments.validated_clip_entities),
  ]);
  const exactSet = new Set([...exactGroups, ...motionGroups].map(normaliseLabel));
  const coveredGroups = storyTargets.filter((group) => exactSet.has(normaliseLabel(group)));
  const missingGroups = storyTargets.filter((group) => !exactSet.has(normaliseLabel(group)));
  const requiredCoverage = storyTargets.length >= 2 ? storyTargets.length : 0;
  return {
    exact_subject_motion_groups: motionGroups,
    exact_subject_entity_coverage_count: coveredGroups.length,
    exact_subject_entity_coverage_required: requiredCoverage,
    exact_subject_entity_coverage_ready: requiredCoverage === 0 || missingGroups.length === 0,
    missing_exact_subject_entities: missingGroups,
  };
}

function storyTargetEntities(story = {}) {
  return uniqueStrings(buildSubjectGraph(story).required_subject_groups);
}

function statusCheck(status, evidence = {}) {
  return { status, ...evidence };
}

function buildApprovedVoiceEvidence(audio = {}) {
  if (!audio?.ready) {
    return statusCheck("fail", {
      status_code: audio?.status || "approved_local_liam_audio_missing",
      proof_failure_code: audio?.proof_failure_code || null,
      reference_accepted: audio?.local_voice_reference_accepted === true,
      acoustic_verified: audio?.acoustic_verified === true,
      audio_path: audio?.output_audio_path || null,
    });
  }
  return statusCheck("pass", {
    status_code: audio.status,
    reference_accepted: audio.local_voice_reference_accepted === true,
    acoustic_verified: audio.acoustic_verified === true,
    audio_path: audio.output_audio_path || null,
    voice_reference_id: audio.local_voice_reference?.id || null,
  });
}

function buildRuntimeTarget(audio = {}) {
  const duration = finiteNumber(audio?.duration_seconds);
  let preferredStatus = "unknown";
  if (Number.isFinite(duration)) {
    if (duration < LOCAL_PROOF_TARGET_MIN_SECONDS) {
      preferredStatus = "below_preferred";
    } else if (duration > LOCAL_PROOF_TARGET_MAX_SECONDS) {
      preferredStatus = "above_preferred";
    } else {
      preferredStatus = "pass";
    }
  }
  const pass =
    Number.isFinite(duration) &&
    duration >= FLASH_MIN_SECONDS &&
    duration <= FLASH_MAX_SECONDS;
  return statusCheck(pass ? "pass" : "fail", {
    duration_seconds: duration,
    target_seconds: [FLASH_MIN_SECONDS, FLASH_MAX_SECONDS],
    preferred_target_seconds: [LOCAL_PROOF_TARGET_MIN_SECONDS, LOCAL_PROOF_TARGET_MAX_SECONDS],
    preferred_target_status: preferredStatus,
    accepted_flash_seconds: [FLASH_MIN_SECONDS, FLASH_MAX_SECONDS],
    duration_verdict: audio?.duration_verdict || null,
  });
}

function buildCaptionReadiness(audio = {}) {
  const timestampsPath = audio?.timestamps_path || null;
  const duration = finiteNumber(audio?.duration_seconds);
  const wpm = finiteNumber(audio?.wpm);
  const wordCount = finiteNumber(audio?.timestamp_word_count);
  const coverage = finiteNumber(audio?.caption_coverage_ratio);
  const maxGap = finiteNumber(audio?.caption_max_gap_s);
  const hasTimestamps = Boolean(timestampsPath);
  const densityOk = wpm === null || (wpm >= 110 && wpm <= 180);
  const coverageOk = coverage === null || coverage >= 0.9;
  const gapOk = maxGap === null || maxGap <= 2.2;
  const status =
    hasTimestamps && densityOk && coverageOk && gapOk
      ? "pass"
      : hasTimestamps
        ? "warn"
        : "fail";
  return statusCheck(status, {
    timestamps_path: timestampsPath,
    coverage_ratio: coverage,
    max_gap_s: maxGap,
    density_wpm: wpm,
    timestamp_word_count: wordCount,
    audio_duration_seconds: duration,
  });
}

function buildOverlaySafeArea(stillDeckReadiness = {}) {
  const readiness = stillDeckReadiness?.render_readiness || null;
  const overlays = stillDeckReadiness?.flash_lane_overlays || null;
  if (!readiness && !overlays) {
    return statusCheck("unavailable", {
      verdict: null,
      story_beat_overlay_count: null,
      required_story_beat_overlay_minimum: null,
    });
  }
  const blockers = [...array(readiness?.blockers), ...array(overlays?.blockers)];
  const warnings = [...array(readiness?.warnings), ...array(overlays?.warnings)];
  const verdict = readiness?.verdict || overlays?.verdict || "unknown";
  const status = blockers.length
    ? "fail"
    : verdict === "render_ready" || readiness?.readinessClass === "green" || overlays?.verdict === "ready"
      ? "pass"
      : warnings.length
        ? "warn"
        : "unavailable";
  return statusCheck(status, {
    verdict,
    story_beat_overlay_count: finiteNumber(
      readiness?.storyBeatOverlayCount ?? readiness?.story_beat_overlay_count,
    ),
    required_story_beat_overlay_minimum: finiteNumber(
      readiness?.requiredBeatOverlayMinimum ?? readiness?.required_story_beat_overlay_minimum,
    ),
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
  });
}

function buildStaleWrongStoryRisk(visuals = {}, latestRenderProof = {}) {
  if (Number(visuals.wrong_story_exact_asset_count || 0) > 0) {
    return statusCheck("fail", {
      wrong_story_exact_asset_count: visuals.wrong_story_exact_asset_count,
      wrong_story_exact_asset_groups: visuals.wrong_story_exact_asset_groups,
      latest_render_blocks_fresh_proof: latestRenderProof?.blocks_fresh_proof === true,
      visual_inputs_are_newer: latestRenderProof?.visual_inputs_are_newer === true,
    });
  }
  if (latestRenderProof?.blocks_fresh_proof) {
    return statusCheck("warn", {
      wrong_story_exact_asset_count: 0,
      wrong_story_exact_asset_groups: [],
      latest_render_blocks_fresh_proof: true,
      visual_inputs_are_newer: latestRenderProof.visual_inputs_are_newer === true,
      latest_render_verdict: latestRenderProof.verdict || null,
    });
  }
  return statusCheck("pass", {
    wrong_story_exact_asset_count: 0,
    wrong_story_exact_asset_groups: [],
    latest_render_blocks_fresh_proof: false,
    visual_inputs_are_newer: latestRenderProof?.visual_inputs_are_newer === true,
  });
}

function buildOutroExpected(audio = {}) {
  if (audio?.spoken_outro_present === true) return statusCheck("pass", { expected: true, present: true });
  if (audio?.spoken_outro_present === false) return statusCheck("fail", { expected: true, present: false });
  return statusCheck("warn", { expected: true, present: null });
}

function buildThumbnailCoverReadiness(story = {}, visuals = {}) {
  const thumbnailPath =
    story.hf_thumbnail_path ||
    story.thumbnail_candidate_path ||
    story.thumbnail_path ||
    story.thumbnail ||
    story.image_path ||
    null;
  const explicitUnsafe = /unsafe|fail|reject/i.test(
    String(story.thumbnail_safety_status || story.thumbnail_status || ""),
  );
  const coverDominated = Number(visuals.cover_dominated_exact_asset_share || 0) > FLASH_MAX_COVER_EXACT_ASSET_SHARE;
  const hasCoverCandidate = Boolean(thumbnailPath) || Number(visuals.exact_subject_count || 0) > 0;
  const status = explicitUnsafe || coverDominated ? "fail" : hasCoverCandidate ? "pass" : "warn";
  return statusCheck(status, {
    thumbnail_path: thumbnailPath,
    thumbnail_safety_status: story.thumbnail_safety_status || story.thumbnail_status || null,
    exact_subject_cover_dominated_share: visuals.cover_dominated_exact_asset_share ?? 0,
    exact_subject_count: visuals.exact_subject_count || 0,
  });
}

function buildProofReadiness({
  story = {},
  audio = {},
  visuals = {},
  stillDeckReadiness = null,
  latestRenderProof = null,
  candidateVerdict,
} = {}) {
  const approvedVoiceEvidence = buildApprovedVoiceEvidence(audio);
  const runtimeTarget = buildRuntimeTarget(audio);
  const caption = buildCaptionReadiness(audio);
  const overlaySafeArea = buildOverlaySafeArea(stillDeckReadiness);
  const staleWrongStoryRisk = buildStaleWrongStoryRisk(visuals, latestRenderProof);
  const outroExpected = buildOutroExpected(audio);
  const thumbnailCover = buildThumbnailCoverReadiness(story, visuals);
  const exactSubjectVisualCount = Number(visuals.exact_subject_count || 0);
  const validatedFrameCount = Number(visuals.accepted_frame_count || 0);
  const validatedClipCount = Number(visuals.validated_clip_ref_count || 0);
  const badFrameRejectionCount =
    Number(visuals.rejected_frame_count || 0) + Number(visuals.rejected_clip_ref_count || 0);

  let finalRecommendation = "repair_media_first";
  if (!storyApproved(story) || staleWrongStoryRisk.status === "fail") {
    finalRecommendation = "reject";
  } else if (
    approvedVoiceEvidence.status === "fail" ||
    runtimeTarget.status === "fail" ||
    outroExpected.status === "fail" ||
    caption.status === "fail"
  ) {
    finalRecommendation = "repair_voice_first";
  } else if (
    candidateVerdict === "ready_flash_proof" &&
    caption.status !== "warn" &&
    overlaySafeArea.status !== "fail" &&
    thumbnailCover.status !== "fail"
  ) {
    finalRecommendation = "render_local_proof";
  }

  return {
    schema_version: 1,
    final_recommendation: finalRecommendation,
    approved_voice_evidence: approvedVoiceEvidence,
    runtime_target: runtimeTarget,
    caption,
    overlay_safe_area: overlaySafeArea,
    exact_subject_visual_count: exactSubjectVisualCount,
    validated_frame_count: validatedFrameCount,
    validated_clip_count: validatedClipCount,
    bad_frame_rejection_count: badFrameRejectionCount,
    bad_frame_rejection_reasons: uniqueStrings([
      ...array(visuals.rejected_frame_reasons),
      ...array(visuals.rejected_clip_ref_reasons),
    ]),
    stale_wrong_story_risk: staleWrongStoryRisk,
    outro_expected: outroExpected,
    thumbnail_cover: thumbnailCover,
    safety: {
      local_only: true,
      report_only: true,
      render_requested: false,
      posts_to_platforms: false,
      mutates_production_db: false,
      mutates_railway: false,
      oauth_triggered: false,
      production_renderer_switch: false,
    },
  };
}

function classifyCandidate({ story, audio, assets, frames, segments, stillDeckReadiness, latestRenderProof }) {
  const blockers = [];
  const warnings = [];
  const assetsWithStoryTargets = {
    ...assets,
    story_target_entities: storyTargetEntities(story),
  };
  const entityCoverage = collectEntityCoverage(assetsWithStoryTargets, segments);
  const exactEntityCoverage = collectExactSubjectEntityCoverage(
    assetsWithStoryTargets,
    frames,
    segments,
  );
  const visualEvidenceGate = buildVisualEvidenceGate({
    story,
    assets: assetsWithStoryTargets,
  });
  const motionBackboneReady = frames.motion_backbone_ready || segments.footage_backbone_ready;
  if (!storyApproved(story)) blockers.push("story_not_approved");

  if (!audio?.ready) blockers.push("approved_liam_audio_missing");
  if (!motionBackboneReady) blockers.push("flash_proof_requires_motion_backbone");
  if (!segments.validated_clip_ref_ready) blockers.push("flash_proof_requires_three_validated_clip_refs");
  if (!segments.validated_clip_source_ready) blockers.push("flash_proof_requires_three_validated_clip_sources");
  if (!segments.footage_backbone_ready) {
    blockers.push(...array(segments.footage_backbone_blockers));
    if (segments.validated_clip_ready) blockers.push("flash_proof_requires_footage_backbone_dominance");
  }
  if (!entityCoverage.validated_entity_coverage_ready) {
    blockers.push("flash_proof_requires_validated_entity_coverage");
  }
  if (!exactEntityCoverage.exact_subject_entity_coverage_ready) {
    blockers.push("flash_proof_requires_exact_subject_entity_coverage");
  }
  if (!assets.exact_subject_ready) blockers.push("flash_proof_requires_four_exact_subject_assets");
  blockers.push(...visualEvidenceGate.blockers);
  warnings.push(...visualEvidenceGate.warnings);
  if (latestRenderProof?.blocks_fresh_proof) {
    blockers.push("latest_render_forensic_warnings");
  } else if (latestRenderProof?.needs_human_visual_review && latestRenderProof?.visual_inputs_are_newer) {
    warnings.push("latest_render_warned_but_visual_inputs_refreshed");
  }
  if (stillDeckReadiness && !motionBackboneReady) {
    blockers.push(...array(stillDeckReadiness.blockers));
    warnings.push(...array(stillDeckReadiness.warnings));
  } else if (stillDeckReadiness && array(stillDeckReadiness.blockers).length) {
    warnings.push("prior_still_deck_block_overridden_by_current_motion_backbone");
  }

  const visualReady =
    motionBackboneReady &&
    segments.validated_clip_ref_ready &&
    segments.validated_clip_source_ready &&
    segments.footage_backbone_ready &&
    entityCoverage.validated_entity_coverage_ready &&
    exactEntityCoverage.exact_subject_entity_coverage_ready &&
    assets.exact_subject_ready &&
    visualEvidenceGate.ready;
  let verdict = "needs_motion_or_exact_assets";
  let nextAction = "acquire_motion_frames_or_exact_subject_assets";
  if (!storyApproved(story)) {
    verdict = "skip_not_approved";
    nextAction = "approve_or_reject_story_first";
  } else if (latestRenderProof?.blocks_fresh_proof && visualReady && audio?.ready) {
    verdict = "needs_forensic_warning_repair";
    nextAction = "repair_motion_quality_before_next_proof";
  } else if (visualReady && audio?.ready) {
    verdict = "ready_flash_proof";
    nextAction = "run_local_studio_v2_proof";
  } else if (visualReady && !audio?.ready) {
    verdict = "needs_liam_audio_then_flash_proof";
    nextAction = "generate_sleepy_liam_audio";
  }

  const visuals = {
    exact_subject_count: assets.exact_subject_count,
    exact_subject_groups: assets.exact_subject_groups,
    unverified_store_exact_asset_count: visualEvidenceGate.unverified_store_exact_asset_count,
    cover_dominated_exact_asset_count: visualEvidenceGate.cover_dominated_exact_asset_count,
    cover_dominated_exact_asset_share: visualEvidenceGate.cover_dominated_exact_asset_share,
    wrong_story_exact_asset_count: visualEvidenceGate.wrong_story_exact_asset_count,
    wrong_story_exact_asset_share: visualEvidenceGate.wrong_story_exact_asset_share,
    wrong_story_exact_asset_groups: visualEvidenceGate.wrong_story_exact_asset_groups,
    visual_evidence_gate_ready: visualEvidenceGate.ready,
    story_target_entities: entityCoverage.story_target_entities,
    exact_subject_entity_coverage_count: exactEntityCoverage.exact_subject_entity_coverage_count,
    exact_subject_entity_coverage_required: exactEntityCoverage.exact_subject_entity_coverage_required,
    exact_subject_entity_coverage_ready: exactEntityCoverage.exact_subject_entity_coverage_ready,
    exact_subject_motion_groups: exactEntityCoverage.exact_subject_motion_groups,
    missing_exact_subject_entities: exactEntityCoverage.missing_exact_subject_entities,
    exact_subject_ready: assets.exact_subject_ready,
    accepted_frame_count: frames.accepted_frame_count,
    rejected_frame_count: frames.rejected_frame_count || 0,
    rejected_frame_reasons: frames.rejected_frame_reasons || [],
    frame_groups: frames.frame_groups,
    motion_backbone_ready: motionBackboneReady,
    frame_motion_backbone_ready: frames.motion_backbone_ready,
    footage_motion_backbone_ready: segments.footage_backbone_ready,
    validated_clip_ref_count: segments.validated_clip_ref_count,
    validated_clip_source_count: segments.validated_clip_source_count,
    rejected_clip_ref_count: segments.rejected_clip_ref_count || 0,
    rejected_clip_ref_reasons: segments.rejected_clip_ref_reasons || [],
    validated_clip_entities: segments.validated_clip_entities,
    validated_entity_coverage_count: entityCoverage.validated_entity_coverage_count,
    validated_entity_coverage_required: entityCoverage.validated_entity_coverage_required,
    validated_entity_coverage_ready: entityCoverage.validated_entity_coverage_ready,
    missing_validated_clip_entities: entityCoverage.missing_validated_clip_entities,
    validated_clip_ref_ready: segments.validated_clip_ref_ready,
    validated_clip_source_ready: segments.validated_clip_source_ready,
    validated_clip_ready: segments.validated_clip_ready,
    footage_backbone_ready: segments.footage_backbone_ready,
    footage_backbone_verdict: segments.footage_backbone_verdict,
    footage_backbone_blockers: segments.footage_backbone_blockers,
    projected_clip_seconds: segments.projected_clip_seconds,
    projected_clip_dominance: segments.projected_clip_dominance,
    projected_motion_seconds: segments.projected_motion_seconds,
    projected_motion_dominance: segments.projected_motion_dominance,
    context_asset_count: array(assets.context_assets).length,
  };
  const candidate = {
    story_id: story.id || null,
    title: normaliseText(story.title || ""),
    priority: storyPriority(story),
    verdict,
    next_action: nextAction,
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    audio: audio || {
      status: "approved_local_liam_audio_missing",
      ready: false,
      output_audio_path: null,
      timestamps_path: null,
      duration_seconds: null,
      duration_verdict: null,
    },
    visuals,
    latest_render_proof: latestRenderProof || {
      status: "not_available",
      needs_human_visual_review: false,
      blocks_fresh_proof: false,
      visual_inputs_are_newer: false,
    },
    recommended_command: verdict === "ready_flash_proof"
      ? buildRecommendedCommand(story.id, audio, segments)
      : null,
  };
  candidate.proof_readiness = buildProofReadiness({
    story,
    audio: candidate.audio,
    visuals,
    stillDeckReadiness,
    latestRenderProof: candidate.latest_render_proof,
    candidateVerdict: verdict,
  });
  return candidate;
}

function buildStudioV2ProofCandidateReport({
  stories = [],
  localAudioReports = [],
  assetReports = [],
  frameReports = [],
  segmentValidationReports = [],
  stillDeckReports = [],
  latestForensicReports = [],
  limit = 20,
} = {}) {
  const audioByStory = collectAppliedAudio(localAudioReports);
  const assetsByStory = collectAssetStrength(assetReports);
  const framesByStory = collectFrameStrength(frameReports);
  const segmentsByStory = collectSegmentStrength(segmentValidationReports);
  const footageBackboneByStory = collectFootageBackboneStrength({
    stories,
    frameReports,
    segmentValidationReports,
    audioByStory,
  });
  const stillReadinessByStory = collectStillDeckReadiness(stillDeckReports);
  const visualFreshnessByStory = collectVisualInputFreshness({
    assetReports,
    frameReports,
    segmentValidationReports,
  });
  const candidates = [];

  for (const story of array(stories)) {
    const storyId = story?.id;
    if (!storyId) continue;
    const assets =
      assetsByStory.get(storyId) ||
      {
        exact_subject_count: 0,
        exact_subject_groups: [],
        exact_subject_ready: false,
        exact_subject_assets: [],
        unverified_store_exact_assets: [],
        context_assets: [],
      };
    const frames =
      framesByStory.get(storyId) ||
      {
        accepted_frame_count: 0,
        rejected_frame_count: 0,
        rejected_frame_reasons: [],
        frame_groups: [],
        motion_backbone_ready: false,
      };
    const baseSegments =
      segmentsByStory.get(storyId) ||
      {
        validated_clip_ref_count: 0,
        validated_clip_source_count: 0,
        validated_clip_entities: [],
        validated_clip_ref_ready: false,
        validated_clip_source_ready: false,
        validated_clip_ready: false,
        rejected_clip_ref_count: 0,
        rejected_clip_ref_reasons: [],
      };
    const footageBackbone = footageBackboneByStory.get(storyId) || {
      ready: false,
      verdict: "not_available",
      blockers: ["footage_backbone_not_available"],
      warnings: [],
      projected_clip_seconds: 0,
      projected_clip_dominance: 0,
      projected_motion_seconds: 0,
      projected_motion_dominance: 0,
    };
    const segments = {
      ...baseSegments,
      footage_backbone_ready: footageBackbone.ready,
      footage_backbone_verdict: footageBackbone.verdict,
      footage_backbone_blockers: footageBackbone.blockers,
      footage_backbone_warnings: footageBackbone.warnings,
      projected_clip_seconds: footageBackbone.projected_clip_seconds,
      projected_clip_dominance: footageBackbone.projected_clip_dominance,
      projected_motion_seconds: footageBackbone.projected_motion_seconds,
      projected_motion_dominance: footageBackbone.projected_motion_dominance,
    };
    candidates.push(
      classifyCandidate({
        story,
        audio: audioByStory.get(storyId),
        assets,
        frames,
        segments,
        stillDeckReadiness: stillReadinessByStory.get(storyId),
        latestRenderProof: latestRenderProofForStory(
          latestForensicReports,
          storyId,
          visualFreshnessByStory.get(storyId),
        ),
      }),
    );
  }

  const rank = {
    ready_flash_proof: 4,
    needs_forensic_warning_repair: 3,
    needs_liam_audio_then_flash_proof: 3,
    needs_motion_or_exact_assets: 2,
    skip_not_approved: 1,
  };
  candidates.sort((a, b) => {
    const lane = (rank[b.verdict] || 0) - (rank[a.verdict] || 0);
    if (lane) return lane;
    return Number(b.priority || 0) - Number(a.priority || 0);
  });

  const limited = candidates.slice(0, Math.max(1, Number(limit) || 20));
  const summary = {
    total: limited.length,
    ready_flash_proof: limited.filter((item) => item.verdict === "ready_flash_proof").length,
    needs_forensic_warning_repair: limited.filter((item) => item.verdict === "needs_forensic_warning_repair").length,
    needs_liam_audio_then_flash_proof: limited.filter((item) => item.verdict === "needs_liam_audio_then_flash_proof").length,
    needs_motion_or_exact_assets: limited.filter((item) => item.verdict === "needs_motion_or_exact_assets").length,
    skipped: limited.filter((item) => item.verdict === "skip_not_approved").length,
    readiness_recommendations: {
      render_local_proof: limited.filter((item) => item.proof_readiness?.final_recommendation === "render_local_proof").length,
      repair_media_first: limited.filter((item) => item.proof_readiness?.final_recommendation === "repair_media_first").length,
      repair_voice_first: limited.filter((item) => item.proof_readiness?.final_recommendation === "repair_voice_first").length,
      reject: limited.filter((item) => item.proof_readiness?.final_recommendation === "reject").length,
    },
  };

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    summary,
    candidates: limited,
    thresholds: {
      flash_min_exact_subject_assets: FLASH_MIN_EXACT_SUBJECT_ASSETS,
      flash_min_motion_frames: FLASH_MIN_MOTION_FRAMES,
      flash_min_validated_clip_refs: FLASH_MIN_VALIDATED_CLIP_REFS,
      flash_min_validated_clip_sources: FLASH_MIN_VALIDATED_CLIP_SOURCES,
      flash_min_validated_entity_coverage: FLASH_MIN_VALIDATED_ENTITY_COVERAGE,
      flash_max_cover_exact_asset_share: FLASH_MAX_COVER_EXACT_ASSET_SHARE,
      flash_max_wrong_story_exact_assets: FLASH_MAX_WRONG_STORY_EXACT_ASSETS,
      flash_runtime_seconds: [FLASH_MIN_SECONDS, FLASH_MAX_SECONDS],
      local_proof_target_seconds: [
        LOCAL_PROOF_TARGET_MIN_SECONDS,
        LOCAL_PROOF_TARGET_MAX_SECONDS,
      ],
    },
    safety: {
      local_only: true,
      report_only: true,
      renders_video: false,
      calls_tts: false,
      posts_to_platforms: false,
      mutates_production_db: false,
      mutates_railway: false,
    },
  };
}

function renderStudioV2ProofCandidatesMarkdown(report = {}) {
  const ready = array(report.candidates).filter((item) => item.verdict === "ready_flash_proof");
  const lines = [
    "# Studio V2 Proof Candidate Selector",
    "",
    "This is local-only and report-only. It does not render, call TTS, post, mutate the DB or touch Railway.",
    "",
    "## Summary",
    "",
    `- Ready Flash proofs: ${report.summary?.ready_flash_proof || 0}`,
    `- Need forensic warning repair: ${report.summary?.needs_forensic_warning_repair || 0}`,
    `- Need Liam audio first: ${report.summary?.needs_liam_audio_then_flash_proof || 0}`,
    `- Need motion/exact assets: ${report.summary?.needs_motion_or_exact_assets || 0}`,
    `- Readiness render local proof: ${report.summary?.readiness_recommendations?.render_local_proof || 0}`,
    `- Readiness repair media first: ${report.summary?.readiness_recommendations?.repair_media_first || 0}`,
    `- Readiness repair voice first: ${report.summary?.readiness_recommendations?.repair_voice_first || 0}`,
    `- Readiness reject: ${report.summary?.readiness_recommendations?.reject || 0}`,
    "",
  ];
  if (!ready.length) {
    lines.push("## Verdict", "", "No Studio V2 proof render is safe yet.", "");
  }
  lines.push("## Candidates", "");
  for (const candidate of array(report.candidates)) {
    const readiness = candidate.proof_readiness || {};
    lines.push(
      `### ${candidate.story_id}`,
      "",
      `- Title: ${candidate.title || "Untitled"}`,
      `- Verdict: ${candidate.verdict}`,
      `- Next action: ${candidate.next_action}`,
      `- Final recommendation: ${readiness.final_recommendation || "unknown"}`,
      `- Liam audio: ${candidate.audio?.status || "unknown"} (${candidate.audio?.duration_seconds ?? "no duration"}s)`,
      `- Approved voice evidence: ${readiness.approved_voice_evidence?.status || "unknown"} (${readiness.approved_voice_evidence?.voice_reference_id || readiness.approved_voice_evidence?.status_code || "unknown"})`,
      `- Runtime accepted ${readiness.runtime_target?.target_seconds?.join("-") || "61-75"}s / preferred ${readiness.runtime_target?.preferred_target_seconds?.join("-") || "64-70"}s: ${readiness.runtime_target?.status || "unknown"} (${readiness.runtime_target?.duration_seconds ?? "unknown"}s, preferred=${readiness.runtime_target?.preferred_target_status || "unknown"})`,
      `- Caption coverage/density: ${readiness.caption?.status || "unknown"} (coverage ${readiness.caption?.coverage_ratio ?? "unknown"}, max gap ${readiness.caption?.max_gap_s ?? "unknown"}s, ${readiness.caption?.density_wpm ?? "unknown"} wpm)`,
      `- Overlay safe area: ${readiness.overlay_safe_area?.status || "unknown"} (${readiness.overlay_safe_area?.verdict || "not available"})`,
      `- Exact subject assets: ${candidate.visuals?.exact_subject_count || 0}`,
      `- Validated frames/clips: ${readiness.validated_frame_count ?? candidate.visuals?.accepted_frame_count ?? 0} / ${readiness.validated_clip_count ?? candidate.visuals?.validated_clip_ref_count ?? 0}`,
      `- Bad-frame rejections: ${readiness.bad_frame_rejection_count ?? 0}`,
      `- Visual evidence gate: ${candidate.visuals?.visual_evidence_gate_ready ? "pass" : "block"} (unverified store ${candidate.visuals?.unverified_store_exact_asset_count || 0}, cover share ${candidate.visuals?.cover_dominated_exact_asset_share ?? 0}, wrong-story share ${candidate.visuals?.wrong_story_exact_asset_share ?? 0})`,
      `- Accepted motion frames: ${candidate.visuals?.accepted_frame_count || 0}`,
      `- Validated clip refs: ${candidate.visuals?.validated_clip_ref_count || 0}`,
      `- Validated clip sources: ${candidate.visuals?.validated_clip_source_count || 0}`,
      `- Validated clip entities: ${array(candidate.visuals?.validated_clip_entities).join(", ") || "none"}`,
      `- Footage backbone: ${candidate.visuals?.footage_backbone_verdict || "unknown"} (clip dominance ${candidate.visuals?.projected_clip_dominance ?? "unknown"})`,
      `- Stale/wrong-story risk: ${readiness.stale_wrong_story_risk?.status || "unknown"}`,
      `- Outro expected: ${readiness.outro_expected?.status || "unknown"}`,
      `- Thumbnail/cover readiness: ${readiness.thumbnail_cover?.status || "unknown"}`,
      `- Latest render proof: ${
        candidate.latest_render_proof?.status === "available"
          ? `${candidate.latest_render_proof.verdict} (${candidate.latest_render_proof.fail_count || 0} fail / ${candidate.latest_render_proof.warn_count || 0} warn)`
          : "not available"
      }`,
      `- Blockers: ${array(candidate.blockers).length ? candidate.blockers.join(", ") : "none"}`,
    );
    if (candidate.recommended_command) {
      lines.push("", "Recommended command:", "", "```powershell", candidate.recommended_command, "```");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

module.exports = {
  buildStudioV2ProofCandidateReport,
  renderStudioV2ProofCandidatesMarkdown,
  collectAppliedAudio,
  collectAssetStrength,
  collectFrameStrength,
  collectSegmentStrength,
  collectFootageBackboneStrength,
  latestRenderProofForStory,
  buildProofReadiness,
};
