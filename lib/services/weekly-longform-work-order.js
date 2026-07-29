"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  assessRightsLedger,
} = require("./publication-evidence-gates");
const {
  countSpokenWords,
} = require("./short-runtime-planner");

const SCHEMA_VERSION = "pulse-weekly-longform-work-order-v1";
const GENERATOR_ID = "pulse-weekly-longform-work-order-v1";
const MODE = "LOCAL_PROOF";
const MINIMUM_STORY_COUNT = 4;
const MAXIMUM_STORY_COUNT = 6;
const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const SECONDS_PER_WORD = 0.4;
const MINIMUM_DURATION_SECONDS = 480;
const MAXIMUM_DURATION_SECONDS = 720;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MINIMUM_LANDSCAPE_EXACT_SUBJECT_ASSET_COUNT = 3;
const MINIMUM_LANDSCAPE_ASPECT_RATIO = 4 / 3;
const EXACT_SUBJECT_QUALITIES = new Set([
  "exact_game_match",
  "exact_franchise_match",
  "exact_platform_match",
]);
const TEMPLATE_VISUAL_ROLES = new Set([
  "before_after_change",
  "hook_slam",
  "owned_motion_backbone",
  "player_impact",
  "verified_timeline",
]);
const ACCEPTED_SOURCE_TYPES = new Set([
  "official",
  "first_party",
  "regulatory",
  "trusted_press",
]);

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function workOrderFingerprint(workOrder) {
  const value = { ...(workOrder || {}) };
  delete value.work_order_sha256;
  return sha256Buffer(
    Buffer.from(JSON.stringify(stableValue(value)), "utf8"),
  );
}

function normaliseSha256(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function validateRunId(value) {
  const runId = text(value);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(runId)) {
    throw new Error("weekly_longform_run_id_invalid");
  }
  return runId;
}

function validateGeneratedAt(value) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) {
    throw new Error("weekly_longform_generated_at_invalid");
  }
  return new Date(parsed).toISOString();
}

function readBoundJson(record, prefix) {
  return observedFile(record, prefix, { json: true });
}

function normaliseClaims(value, storyId) {
  if (!Array.isArray(value)) return [];
  return value
    .map((claim, index) => {
      if (typeof claim === "string") {
        return {
          claim_id: `${storyId}-claim-${index + 1}`,
          text: text(claim),
          source_locator: null,
        };
      }
      return {
        claim_id: text(claim?.claim_id || claim?.id),
        text: text(claim?.text || claim?.claim),
        source_locator: text(claim?.source_locator) || null,
      };
    })
    .filter((claim) => claim.claim_id && claim.text);
}

function exactSubjectAsset(asset) {
  return (
    asset?.counted_for_premium === true &&
    EXACT_SUBJECT_QUALITIES.has(
      text(asset?.subject_match_quality).toLowerCase(),
    )
  );
}

function templateVisualAsset(asset, item) {
  const roles = [
    asset?.role,
    asset?.usage,
    asset?.motion_family,
    item?.usage,
    item?.motion_family,
  ]
    .map((value) => text(value).toLowerCase())
    .filter(Boolean);
  return (
    roles.some((role) => TEMPLATE_VISUAL_ROLES.has(role)) ||
    (text(asset?.generator_identity).toLowerCase() ===
      "pulse-governed-owned-motion-v1" &&
      text(asset?.provenance?.source).toLowerCase() ===
        "repository_owned_generation" &&
      !exactSubjectAsset(asset))
  );
}

function assessWeeklyLongformVisualPack(rightsValue, storyId) {
  const manifestReference = rightsValue?.owned_motion_manifest || {};
  const manifest = readBoundJson(
    {
      path: manifestReference.path,
      sha256:
        manifestReference.sha256 ||
        manifestReference.file_sha256,
    },
    "weekly_longform_visual_inventory",
  );
  const blockers = [...manifest.blockers];
  const manifestValue = manifest.value || {};
  if (
    manifestValue.schema_version !==
    "pulse-owned-motion-manifest-v1"
  ) {
    blockers.push(
      "weekly_longform_visual_inventory_manifest_schema_invalid",
    );
  }
  if (text(manifestValue.story_id) !== storyId) {
    blockers.push(
      "weekly_longform_visual_inventory_manifest_story_id_mismatch",
    );
  }

  const manifestAssets = list(manifestValue.assets);
  if (!manifestAssets.length) {
    blockers.push(
      "weekly_longform_visual_inventory_manifest_assets_required",
    );
  }
  const manifestAssetsBySha = new Map();
  let duplicateManifestAssetSha = false;
  for (const asset of manifestAssets) {
    const assetSha256 = normaliseSha256(asset?.sha256);
    if (!assetSha256) continue;
    if (manifestAssetsBySha.has(assetSha256)) {
      duplicateManifestAssetSha = true;
      continue;
    }
    manifestAssetsBySha.set(assetSha256, asset);
  }
  if (duplicateManifestAssetSha) {
    blockers.push(
      "weekly_longform_visual_inventory_asset_hash_duplicate",
    );
  }

  const includedItems = list(rightsValue?.items)
    .filter(
      (item) =>
        item?.included_in_final === true &&
        text(item?.rights_decision).toUpperCase() === "CLEARED",
    )
    .sort((left, right) =>
      text(left?.item_id).localeCompare(text(right?.item_id)),
    );
  const manifestDir = manifest.path
    ? path.dirname(manifest.path)
    : null;
  const assets = [];
  let bindingInvalid = false;
  for (const item of includedItems) {
    const itemId = text(item?.item_id);
    const assetSha256 = normaliseSha256(item?.asset_sha256);
    const asset = assetSha256
      ? manifestAssetsBySha.get(assetSha256)
      : null;
    const evidencePath = text(item?.rights_evidence?.reference);
    const evidenceSha256 = normaliseSha256(
      item?.rights_evidence?.sha256,
    );
    const evidenceBound =
      Boolean(asset && manifest.path && manifest.sha256) &&
      Boolean(evidencePath) &&
      path.resolve(evidencePath) === manifest.path &&
      evidenceSha256 === manifest.sha256;
    const declaredAssetPath = text(asset?.path);
    const assetPath =
      manifestDir && declaredAssetPath
        ? path.resolve(manifestDir, declaredAssetPath)
        : null;
    const relativeAssetPath =
      manifestDir && assetPath
        ? path.relative(manifestDir, assetPath)
        : null;
    const containedAssetPath =
      Boolean(relativeAssetPath) &&
      relativeAssetPath !== ".." &&
      !relativeAssetPath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeAssetPath);
    let assetBytesBound = false;
    if (asset && assetPath && containedAssetPath && assetSha256) {
      try {
        const bytes = fs.readFileSync(assetPath);
        assetBytesBound = sha256Buffer(bytes) === assetSha256;
      } catch {
        assetBytesBound = false;
      }
    }
    const width = Number(asset?.width);
    const height = Number(asset?.height);
    const geometryValid =
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0;
    const landscape =
      geometryValid &&
      width / height >= MINIMUM_LANDSCAPE_ASPECT_RATIO;
    const mediaType = text(asset?.media_type).toLowerCase();
    const exactSubject = exactSubjectAsset(asset);
    const templateOnly = templateVisualAsset(asset, item);
    const admitted =
      evidenceBound &&
      assetBytesBound &&
      landscape &&
      exactSubject &&
      !templateOnly &&
      ["image", "video"].includes(mediaType);
    if (!asset || !evidenceBound || !assetBytesBound) {
      bindingInvalid = true;
    }
    assets.push({
      item_id: itemId || null,
      asset_sha256: assetSha256,
      role: text(asset?.role) || null,
      media_type: mediaType || null,
      width: geometryValid ? width : null,
      height: geometryValid ? height : null,
      subject_match_quality:
        text(asset?.subject_match_quality) || null,
      counted_for_premium:
        asset?.counted_for_premium === true,
      template_only: templateOnly,
      landscape,
      evidence_bound: evidenceBound,
      asset_bytes_bound: assetBytesBound,
      admitted,
    });
  }
  if (bindingInvalid) {
    blockers.push(
      "weekly_longform_visual_inventory_asset_binding_invalid",
    );
  }

  const templateOnlyPack =
    assets.length > 0 &&
    assets.every((asset) => asset.template_only);
  if (templateOnlyPack) {
    blockers.push("weekly_longform_visual_pack_template_only");
  }
  const admitted = assets.filter((asset) => asset.admitted);
  if (
    admitted.length <
    MINIMUM_LANDSCAPE_EXACT_SUBJECT_ASSET_COUNT
  ) {
    blockers.push(
      "weekly_longform_landscape_exact_subject_assets_below_3",
    );
  }
  if (
    !admitted.some((asset) => asset.media_type === "video")
  ) {
    blockers.push(
      "weekly_longform_landscape_exact_subject_motion_required",
    );
  }

  const admittedAssetIds = admitted
    .map((asset) => asset.item_id)
    .filter(Boolean)
    .sort();
  const admittedSet = new Set(admittedAssetIds);
  const exactBlockers = unique(blockers);
  return {
    schema_version: "pulse-weekly-longform-visual-admission-v1",
    status: exactBlockers.length ? "HOLD" : "READY",
    blockers: exactBlockers,
    required_landscape_exact_subject_asset_count:
      MINIMUM_LANDSCAPE_EXACT_SUBJECT_ASSET_COUNT,
    required_landscape_exact_subject_motion_count: 1,
    admitted_asset_ids: admittedAssetIds,
    excluded_asset_ids: includedItems
      .map((item) => text(item?.item_id))
      .filter((itemId) => itemId && !admittedSet.has(itemId))
      .sort(),
    template_asset_ids: assets
      .filter((asset) => asset.template_only)
      .map((asset) => asset.item_id)
      .filter(Boolean)
      .sort(),
    landscape_exact_subject_asset_count: admitted.length,
    landscape_exact_subject_motion_count: admitted.filter(
      (asset) => asset.media_type === "video",
    ).length,
    manifest: {
      path: manifest.path,
      sha256: manifest.sha256,
    },
    assets,
  };
}

function assessCandidate(candidate, { windowStart, windowEnd }) {
  const storyId = text(candidate?.id || candidate?.story_id);
  const blockers = [];
  if (!storyId) blockers.push("story_id_required");
  if (!text(candidate?.title)) blockers.push("story_title_required");
  if (text(candidate?.verification_status).toUpperCase() !== "CONFIRMED") {
    blockers.push("confirmed_verification_required");
  }
  const publishedAt = Date.parse(
    text(candidate?.published_at || candidate?.timestamp),
  );
  if (
    !Number.isFinite(publishedAt) ||
    publishedAt < windowStart ||
    publishedAt > windowEnd
  ) {
    blockers.push("story_outside_weekly_window");
  }
  const primarySourceUrl = text(candidate?.primary_source_url);
  if (!/^https?:\/\//i.test(primarySourceUrl)) {
    blockers.push("primary_source_url_required");
  }

  const source = readBoundJson(
    candidate?.source_evidence,
    "source_evidence",
  );
  blockers.push(...source.blockers);
  const sourceValue = source.value || {};
  if (sourceValue.schema_version !== "pulse-source-evidence-v1") {
    blockers.push("source_evidence_schema_invalid");
  }
  if (text(sourceValue.source_url) !== primarySourceUrl) {
    blockers.push("source_evidence_url_mismatch");
  }
  if (
    !ACCEPTED_SOURCE_TYPES.has(
      text(sourceValue.source_type).toLowerCase(),
    )
  ) {
    blockers.push("source_evidence_type_not_verified");
  }
  const claims = normaliseClaims(sourceValue.claims, storyId);
  if (!claims.length) blockers.push("source_evidence_claims_required");

  const rights = readBoundJson(
    candidate?.rights_ledger,
    "rights_ledger",
  );
  blockers.push(...rights.blockers);
  const rightsValue = rights.value || {};
  if (
    rightsValue.schema_version !==
    "pulse-weekly-longform-rights-ledger-v1"
  ) {
    blockers.push("rights_ledger_schema_invalid");
  }
  if (text(rightsValue.story_id) !== storyId) {
    blockers.push("rights_ledger_story_id_mismatch");
  }
  const rightsAssessment = assessRightsLedger(
    rightsValue,
    rightsValue.ledger_sha256,
  );
  blockers.push(...rightsAssessment.blockers);
  const visualAssetAdmission = assessWeeklyLongformVisualPack(
    rightsValue,
    storyId,
  );
  blockers.push(...visualAssetAdmission.blockers);
  const admittedAssetIds = new Set(
    visualAssetAdmission.admitted_asset_ids,
  );
  const admittedRightsDecision = {
    ...rightsAssessment.decision,
    items: list(rightsAssessment.decision?.items).filter((item) =>
      admittedAssetIds.has(item.item_id),
    ),
  };

  return {
    story_id: storyId,
    title: text(candidate?.title),
    published_at: Number.isFinite(publishedAt)
      ? new Date(publishedAt).toISOString()
      : null,
    priority_score: Number.isFinite(
      Number(candidate?.weekly_priority_score),
    )
      ? Number(candidate.weekly_priority_score)
      : 0,
    primary_source_url: primarySourceUrl || null,
    blockers: unique(blockers),
    source_evidence: {
      path: source.path,
      sha256: source.sha256,
      claims,
    },
    rights_ledger: {
      path: rights.path,
      sha256: rights.sha256,
      canonical_sha256: rightsAssessment.sha256,
      decision: admittedRightsDecision,
    },
    visual_asset_admission: visualAssetAdmission,
    pitch: candidate?.weekly_longform_pitch || null,
  };
}

function candidateOrder(left, right) {
  const scoreDelta = right.priority_score - left.priority_score;
  if (scoreDelta) return scoreDelta;
  const timeDelta =
    Date.parse(right.published_at || "") -
    Date.parse(left.published_at || "");
  if (Number.isFinite(timeDelta) && timeDelta) return timeDelta;
  return left.story_id.localeCompare(right.story_id);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function editorialStory(story) {
  const pitch =
    story.pitch &&
    typeof story.pitch === "object" &&
    !Array.isArray(story.pitch)
      ? story.pitch
      : {};
  const blockers = [];
  const claimIds = unique(list(pitch.claim_ids).map(text));
  const verifiedClaimIds = new Set(
    story.source_evidence.claims.map((claim) => claim.claim_id),
  );
  if (!text(pitch.section_title)) {
    blockers.push("weekly_pitch_section_title_required");
  }
  if (!text(pitch.angle)) blockers.push("weekly_pitch_angle_required");
  if (!text(pitch.why_it_matters)) {
    blockers.push("weekly_pitch_player_consequence_required");
  }
  if (!text(pitch.script_section)) {
    blockers.push("weekly_pitch_script_section_required");
  }
  if (
    !claimIds.length ||
    claimIds.some((claimId) => !verifiedClaimIds.has(claimId))
  ) {
    blockers.push("weekly_pitch_verified_claim_binding_invalid");
  }

  const clearedAssetIds = new Set(
    list(story.rights_ledger.decision?.items)
      .filter(
        (item) =>
          item.included_in_final === true &&
          item.rights_decision === "CLEARED",
      )
      .map((item) => item.item_id),
  );
  const rawBeats = list(pitch.visual_beats);
  if (rawBeats.length < 3) {
    blockers.push("weekly_pitch_minimum_three_visual_beats_required");
  }
  const seenBeatIds = new Set();
  const seenAssetItemIds = new Set();
  const beats = rawBeats.map((beat) => {
    const beatId = text(beat?.beat_id);
    const beatClaimIds = unique(list(beat?.claim_ids).map(text));
    const assetItemId = text(beat?.asset_item_id);
    if (!beatId || seenBeatIds.has(beatId)) {
      blockers.push(
        beatId
          ? "weekly_visual_beat_id_duplicate"
          : "weekly_visual_beat_id_required",
      );
    }
    if (beatId) seenBeatIds.add(beatId);
    if (!text(beat?.purpose) || !text(beat?.treatment)) {
      blockers.push("weekly_visual_beat_editorial_purpose_required");
    }
    if (!assetItemId || !clearedAssetIds.has(assetItemId)) {
      blockers.push("weekly_visual_beat_rights_binding_invalid");
    }
    if (
      assetItemId &&
      seenAssetItemIds.has(assetItemId)
    ) {
      blockers.push(
        "weekly_visual_beat_distinct_asset_required",
      );
    }
    if (assetItemId) seenAssetItemIds.add(assetItemId);
    if (
      !beatClaimIds.length ||
      beatClaimIds.some((claimId) => !verifiedClaimIds.has(claimId))
    ) {
      blockers.push("weekly_visual_beat_claim_binding_invalid");
    }
    return {
      beat_id: beatId,
      story_id: story.story_id,
      purpose: text(beat?.purpose),
      treatment: text(beat?.treatment),
      asset_item_id: assetItemId,
      claim_ids: beatClaimIds,
      rights_bound:
        Boolean(assetItemId) && clearedAssetIds.has(assetItemId),
      claims_bound:
        beatClaimIds.length > 0 &&
        beatClaimIds.every((claimId) =>
          verifiedClaimIds.has(claimId),
        ),
    };
  });

  const derivativeHooks =
    pitch.derivative_hooks &&
    typeof pitch.derivative_hooks === "object" &&
    !Array.isArray(pitch.derivative_hooks)
      ? pitch.derivative_hooks
      : {};
  if (
    !text(derivativeHooks.short) ||
    !text(derivativeHooks.social_thread)
  ) {
    blockers.push("weekly_derivative_hooks_required");
  }

  return {
    blockers: unique(blockers),
    dossier: {
      story_id: story.story_id,
      title: story.title,
      section_title: text(pitch.section_title),
      angle: text(pitch.angle),
      why_it_matters: text(pitch.why_it_matters),
      primary_source_url: story.primary_source_url,
      published_at: story.published_at,
      verified_claims: story.source_evidence.claims.filter((claim) =>
        claimIds.includes(claim.claim_id),
      ),
      source_evidence: {
        path: story.source_evidence.path,
        sha256: story.source_evidence.sha256,
      },
      rights_lineage: {
        path: story.rights_ledger.path,
        sha256: story.rights_ledger.sha256,
        canonical_sha256: story.rights_ledger.canonical_sha256,
      },
    },
    scriptSection: text(pitch.script_section),
    beats,
    derivativeHooks: {
      short: text(derivativeHooks.short),
      social_thread: text(derivativeHooks.social_thread),
    },
    claimIds,
  };
}

function buildEditorialOutputs({ selected, editorialFrame }) {
  const frame =
    editorialFrame &&
    typeof editorialFrame === "object" &&
    !Array.isArray(editorialFrame)
      ? editorialFrame
      : {};
  const blockers = [];
  for (const [field, code] of [
    ["episode_title", "weekly_episode_title_required"],
    ["editorial_thesis", "weekly_editorial_thesis_required"],
    ["opening_script", "weekly_opening_script_required"],
    ["closing_script", "weekly_closing_script_required"],
  ]) {
    if (!text(frame[field])) blockers.push(code);
  }
  const stories = selected.map(editorialStory);
  for (const story of stories) blockers.push(...story.blockers);
  if (blockers.length) {
    return {
      blockers: ["editorial_dossier_incomplete", ...unique(blockers)],
      dossier: null,
      script: null,
      visualBeatPlan: null,
      derivativePlan: null,
    };
  }

  const openingScript = text(frame.opening_script);
  const closingScript = text(frame.closing_script);
  const fullScript = [
    openingScript,
    ...stories.map((story) => story.scriptSection),
    closingScript,
  ].join("\n\n");
  const wordCount = countSpokenWords(fullScript);
  const estimatedDurationSeconds = Number(
    (wordCount * SECONDS_PER_WORD).toFixed(2),
  );
  if (
    estimatedDurationSeconds < MINIMUM_DURATION_SECONDS ||
    estimatedDurationSeconds > MAXIMUM_DURATION_SECONDS
  ) {
    blockers.push("weekly_script_outside_8_to_12_minute_contract");
  }

  let cursorSeconds = Number(
    (countSpokenWords(openingScript) * SECONDS_PER_WORD).toFixed(2),
  );
  const plannedBeats = [];
  for (const story of stories) {
    const sectionDuration = Number(
      (
        countSpokenWords(story.scriptSection) * SECONDS_PER_WORD
      ).toFixed(2),
    );
    const beatDuration = sectionDuration / story.beats.length;
    story.beats.forEach((beat, index) => {
      plannedBeats.push({
        ...beat,
        timing_basis: "script_runtime_estimate_only",
        estimated_start_seconds: Number(
          (cursorSeconds + index * beatDuration).toFixed(2),
        ),
        estimated_end_seconds: Number(
          (cursorSeconds + (index + 1) * beatDuration).toFixed(2),
        ),
      });
    });
    cursorSeconds = Number((cursorSeconds + sectionDuration).toFixed(2));
  }

  const derivativeItems = stories.flatMap((story) => [
    {
      derivative_id: `${story.dossier.story_id}-vertical-short`,
      story_id: story.dossier.story_id,
      format: "vertical_short",
      hook: story.derivativeHooks.short,
      claim_ids: story.claimIds,
      source_evidence_sha256: story.dossier.source_evidence.sha256,
      rights_lineage_sha256: story.dossier.rights_lineage.sha256,
      status: "PLANNED_LOCAL_PROOF",
    },
    {
      derivative_id: `${story.dossier.story_id}-social-thread`,
      story_id: story.dossier.story_id,
      format: "social_thread",
      hook: story.derivativeHooks.social_thread,
      claim_ids: story.claimIds,
      source_evidence_sha256: story.dossier.source_evidence.sha256,
      rights_lineage_sha256: story.dossier.rights_lineage.sha256,
      status: "PLANNED_LOCAL_PROOF",
    },
  ]);

  return {
    blockers: unique(blockers),
    dossier: {
      schema_version: "pulse-weekly-editorial-dossier-v1",
      episode_title: text(frame.episode_title),
      editorial_thesis: text(frame.editorial_thesis),
      story_count: stories.length,
      stories: stories.map((story) => story.dossier),
    },
    script: {
      schema_version: "pulse-weekly-longform-script-v1",
      episode_title: text(frame.episode_title),
      full_script: fullScript,
      sha256: sha256Buffer(Buffer.from(fullScript, "utf8")),
      word_count: wordCount,
      seconds_per_word: SECONDS_PER_WORD,
      estimated_duration_seconds: estimatedDurationSeconds,
      target_minimum_seconds: MINIMUM_DURATION_SECONDS,
      target_maximum_seconds: MAXIMUM_DURATION_SECONDS,
      copy_basis: "operator_supplied_verified_story_sections",
    },
    visualBeatPlan: {
      schema_version: "pulse-weekly-visual-beat-plan-v1",
      timing_basis: "script_runtime_estimate_only",
      beat_count: plannedBeats.length,
      beats: plannedBeats,
    },
    derivativePlan: {
      schema_version: "pulse-weekly-derivative-plan-v1",
      status: "PLANNED_LOCAL_PROOF",
      item_count: derivativeItems.length,
      items: derivativeItems,
    },
  };
}

function observedFile(record, prefix, { json = false } = {}) {
  const blockers = [];
  const filePath = text(record?.path);
  const expectedSha256 = normaliseSha256(record?.sha256);
  if (!filePath) blockers.push(`${prefix}_path_required`);
  if (!expectedSha256) blockers.push(`${prefix}_sha256_required`);
  const resolvedPath = filePath ? path.resolve(filePath) : null;
  if (
    resolvedPath &&
    (!fs.existsSync(resolvedPath) ||
      !fs.statSync(resolvedPath).isFile())
  ) {
    blockers.push(`${prefix}_file_missing`);
  }
  if (blockers.length) {
    return {
      blockers: unique(blockers),
      path: resolvedPath,
      sha256: null,
      value: null,
    };
  }
  const bytes = fs.readFileSync(resolvedPath);
  const observedSha256 = sha256Buffer(bytes);
  if (observedSha256 !== expectedSha256) {
    blockers.push(`${prefix}_sha256_mismatch`);
  }
  let value = null;
  if (json) {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      blockers.push(`${prefix}_json_invalid`);
    }
  }
  return {
    blockers: unique(blockers),
    path: resolvedPath,
    sha256: observedSha256,
    byte_length: bytes.length,
    value,
  };
}

function assessProductionEvidence({
  productionEvidence,
  runId,
  scriptSha256,
}) {
  if (
    !productionEvidence ||
    typeof productionEvidence !== "object" ||
    Array.isArray(productionEvidence)
  ) {
    return {
      status: "HOLD",
      blockers: [
        "final_narration_evidence_required",
        "real_word_alignment_evidence_required",
        "final_master_evidence_required",
      ],
      real_narration_verified: false,
      provider_alignment_verified: false,
      master_verified: false,
      script_sha256: scriptSha256 || null,
      evidence: null,
    };
  }

  const blockers = [];
  const manifest = observedFile(
    productionEvidence.manifest,
    "same_run_manifest",
    { json: true },
  );
  const report = observedFile(
    productionEvidence.report,
    "same_run_report",
    { json: true },
  );
  const captions = observedFile(
    productionEvidence.caption_manifest,
    "same_run_caption_manifest",
    { json: true },
  );
  const reviewPacket = observedFile(
    productionEvidence.human_review_packet,
    "same_run_human_review_packet",
    { json: true },
  );
  blockers.push(
    ...manifest.blockers,
    ...report.blockers,
    ...captions.blockers,
    ...reviewPacket.blockers,
  );

  const manifestValue = manifest.value || {};
  const reportValue = report.value || {};
  const captionValue = captions.value || {};
  const reviewValue = reviewPacket.value || {};
  if (
    manifestValue.schema_version !==
    "pulse-longform-same-run-manifest-v1"
  ) {
    blockers.push("same_run_manifest_schema_invalid");
  }
  if (text(manifestValue.run_id) !== runId) {
    blockers.push("same_run_manifest_run_id_mismatch");
  }
  if (manifestValue.package_bindings?.all_match !== true) {
    blockers.push("same_run_core_binding_required");
  }
  if (manifestValue.machine_evidence_complete !== true) {
    blockers.push("same_run_machine_evidence_incomplete");
  }
  if (
    normaliseSha256(manifestValue.sources?.script?.sha256) !==
    scriptSha256
  ) {
    blockers.push("same_run_script_sha256_mismatch");
  }

  if (
    reportValue.schema_version !==
    "pulse-longform-same-run-evidence-report-v1"
  ) {
    blockers.push("same_run_report_schema_invalid");
  }
  if (
    text(reportValue.run_id) !== runId ||
    reportValue.same_run_core_bound !== true ||
    reportValue.machine_evidence_complete !== true
  ) {
    blockers.push("same_run_report_not_machine_complete");
  }
  if (
    normaliseSha256(reportValue.evidence?.manifest_sha256) !==
    manifest.sha256
  ) {
    blockers.push("same_run_report_manifest_binding_mismatch");
  }

  if (
    captionValue.schema_version !==
      "pulse-longform-caption-manifest-v1" ||
    captionValue.ready !== true ||
    captionValue.timing_basis !== "provider_word_alignment"
  ) {
    blockers.push("real_word_alignment_evidence_required");
  }
  if (text(captionValue.run_id) !== runId) {
    blockers.push("caption_manifest_run_id_mismatch");
  }

  if (
    reviewValue.schema_version !==
      "pulse-longform-human-review-packet-v1" ||
    text(reviewValue.run_id) !== runId ||
    reviewValue.machine_evidence_complete !== true
  ) {
    blockers.push("same_run_human_review_packet_invalid");
  }

  const scriptSource = observedFile(
    manifestValue.sources?.script,
    "same_run_script_source",
  );
  const narrationSource = observedFile(
    manifestValue.sources?.narration_audio,
    "same_run_narration_source",
  );
  const masterSource = observedFile(
    manifestValue.sources?.master,
    "same_run_master_source",
  );
  const timestampSource = observedFile(
    captionValue.source,
    "same_run_word_alignment_source",
    { json: true },
  );
  blockers.push(
    ...scriptSource.blockers,
    ...narrationSource.blockers,
    ...masterSource.blockers,
    ...timestampSource.blockers,
  );
  if (scriptSource.sha256 !== scriptSha256) {
    blockers.push("same_run_script_source_mismatch");
  }
  const narrationSha256 = normaliseSha256(
    manifestValue.sources?.narration_audio?.sha256,
  );
  const masterSha256 = normaliseSha256(
    manifestValue.sources?.master?.sha256,
  );
  if (
    !narrationSha256 ||
    narrationSource.sha256 !== narrationSha256 ||
    narrationSource.byte_length <= 0
  ) {
    blockers.push("final_narration_evidence_required");
  }
  if (
    !masterSha256 ||
    masterSource.sha256 !== masterSha256 ||
    masterSource.byte_length <= 0
  ) {
    blockers.push("final_master_evidence_required");
  }

  const timestampValue = timestampSource.value || {};
  if (
    timestampSource.sha256 !==
      normaliseSha256(captionValue.source?.sha256) ||
    normaliseSha256(timestampValue.script_sha256) !== scriptSha256 ||
    normaliseSha256(timestampValue.audio_sha256) !== narrationSha256 ||
    !normaliseSha256(timestampValue.source_alignment_sha256) ||
    !Array.isArray(timestampValue.words) ||
    timestampValue.words.length === 0 ||
    ["estimated", "synthetic", "uniform"].some((word) =>
      text(timestampValue.provider).toLowerCase().includes(word),
    )
  ) {
    blockers.push("real_word_alignment_evidence_required");
  }
  if (
    normaliseSha256(captionValue.bindings?.script_sha256) !==
      scriptSha256 ||
    normaliseSha256(captionValue.bindings?.audio_sha256) !==
      narrationSha256 ||
    normaliseSha256(captionValue.bindings?.master_sha256) !==
      masterSha256
  ) {
    blockers.push("caption_same_run_binding_mismatch");
  }

  const governedOutputRecords = [
    ["rights_lineage", "same_run_rights_lineage"],
    ["platform_variants", "same_run_platform_variants"],
    ["decoded_qa", "same_run_decoded_qa"],
  ];
  const governedOutputs = {};
  for (const [key, prefix] of governedOutputRecords) {
    const record = manifestValue.evidence_outputs?.[key];
    const observed = observedFile(record, prefix, { json: true });
    blockers.push(...observed.blockers);
    if (record?.ready !== true || observed.value?.ready !== true) {
      blockers.push(`${prefix}_not_ready`);
    }
    governedOutputs[key] = {
      path: observed.path,
      sha256: observed.sha256,
    };
  }

  if (
    normaliseSha256(reviewValue.bindings?.script_sha256) !==
      scriptSha256 ||
    normaliseSha256(reviewValue.bindings?.audio_sha256) !==
      narrationSha256 ||
    normaliseSha256(reviewValue.bindings?.master_sha256) !==
      masterSha256 ||
    normaliseSha256(
      reviewValue.bindings?.longform_run_manifest_sha256,
    ) !== manifest.sha256 ||
    normaliseSha256(
      reviewValue.bindings?.caption_manifest_sha256,
    ) !== captions.sha256
  ) {
    blockers.push("human_review_packet_same_run_binding_mismatch");
  }

  const uniqueBlockers = unique(blockers);
  const machineReady = uniqueBlockers.length === 0;
  return {
    status: machineReady ? "READY_FOR_HUMAN_AV_REVIEW" : "HOLD",
    blockers: machineReady
      ? ["human_av_review_pending"]
      : uniqueBlockers,
    real_narration_verified:
      machineReady && narrationSource.sha256 === narrationSha256,
    provider_alignment_verified:
      machineReady && timestampSource.sha256 !== null,
    master_verified:
      machineReady && masterSource.sha256 === masterSha256,
    script_sha256: scriptSha256 || null,
    evidence: {
      manifest: {
        path: manifest.path,
        sha256: manifest.sha256,
      },
      report: {
        path: report.path,
        sha256: report.sha256,
      },
      caption_manifest: {
        path: captions.path,
        sha256: captions.sha256,
      },
      human_review_packet: {
        path: reviewPacket.path,
        sha256: reviewPacket.sha256,
        status: text(reviewValue.status) || null,
      },
      narration: {
        path: narrationSource.path,
        sha256: narrationSource.sha256,
      },
      word_alignment: {
        path: timestampSource.path,
        sha256: timestampSource.sha256,
      },
      master: {
        path: masterSource.path,
        sha256: masterSource.sha256,
      },
      governed_outputs: governedOutputs,
    },
  };
}

function buildWeeklyLongformWorkOrder({
  runId,
  generatedAt = new Date().toISOString(),
  candidates = [],
  editorialFrame = {},
  productionEvidence = null,
} = {}) {
  const exactRunId = validateRunId(runId);
  const exactGeneratedAt = validateGeneratedAt(generatedAt);
  const windowEnd = Date.parse(exactGeneratedAt);
  const windowStart = windowEnd - WEEK_MILLISECONDS;
  const assessed = (Array.isArray(candidates) ? candidates : []).map(
    (candidate) =>
      assessCandidate(candidate, { windowStart, windowEnd }),
  );
  const eligible = assessed
    .filter((candidate) => candidate.blockers.length === 0)
    .sort(candidateOrder);
  const selected = eligible.slice(0, MAXIMUM_STORY_COUNT);
  const deferred = eligible.slice(MAXIMUM_STORY_COUNT).map((candidate) => ({
    story_id: candidate.story_id,
    title: candidate.title,
    priority_score: candidate.priority_score,
    reason: "weekly_story_limit_reached",
  }));
  const rejected = assessed
    .filter((candidate) => candidate.blockers.length > 0)
    .map((candidate) => ({
      story_id: candidate.story_id,
      title: candidate.title,
      blockers: candidate.blockers,
      visual_asset_admission:
        candidate.visual_asset_admission,
    }));
  const blockers = [];
  if (selected.length < MINIMUM_STORY_COUNT) {
    blockers.push("minimum_verified_weekly_story_set_not_met");
  }
  const editorial = buildEditorialOutputs({
    selected,
    editorialFrame,
  });
  blockers.push(...editorial.blockers);
  const productionRunnerAdmissionBlockers = unique(blockers);
  const productionRunnerAdmission = {
    status: productionRunnerAdmissionBlockers.length ? "HOLD" : "READY",
    scope: "LOCAL_PROOF_PRODUCTION_RUNNER",
    blockers: productionRunnerAdmissionBlockers,
  };
  const productionReadiness = assessProductionEvidence({
    productionEvidence,
    runId: exactRunId,
    scriptSha256: editorial.script?.sha256 || null,
  });
  blockers.push(
    ...productionReadiness.blockers.filter(
      (blocker) => blocker !== "human_av_review_pending",
    ),
  );

  const workOrder = {
    schema_version: SCHEMA_VERSION,
    generated_at: exactGeneratedAt,
    generator_identity: GENERATOR_ID,
    run_id: exactRunId,
    mode: MODE,
    format: {
      lane_id: "weekly_longform",
      format_family: "youtube_flagship_longform",
      editorial_shape:
        "weekly list-led gaming news briefing with original analysis",
      target_duration_seconds: {
        minimum: 480,
        maximum: 720,
      },
    },
    window: {
      start_at: new Date(windowStart).toISOString(),
      end_at: exactGeneratedAt,
    },
    selection: {
      minimum_story_count: MINIMUM_STORY_COUNT,
      maximum_story_count: MAXIMUM_STORY_COUNT,
      input_count: assessed.length,
      eligible_count: eligible.length,
      selected,
      deferred,
      rejected,
    },
    editorial_frame: structuredClone(editorialFrame),
    dossier: editorial.dossier,
    script: editorial.script,
    visual_beat_plan: editorial.visualBeatPlan,
    derivative_plan: editorial.derivativePlan,
    status:
      unique(blockers).length === 0 &&
      productionReadiness.status === "READY_FOR_HUMAN_AV_REVIEW"
        ? "READY_FOR_HUMAN_AV_REVIEW"
        : "HOLD",
    blockers: unique(blockers),
    production_runner_admission: productionRunnerAdmission,
    production_readiness: productionReadiness,
    safety: {
      local_proof_only: true,
      claims_synthesised: false,
      rights_synthesised: false,
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    },
  };
  workOrder.work_order_sha256 = workOrderFingerprint(workOrder);
  return workOrder;
}

function renderWeeklyLongformWorkOrderMarkdown(workOrder) {
  const selected = list(workOrder?.selection?.selected);
  const blockers = list(workOrder?.blockers);
  const productionBlockers = list(
    workOrder?.production_readiness?.blockers,
  );
  const lines = [
    "# Pulse Gaming Weekly Flagship Work Order",
    "",
    `- Run: \`${text(workOrder?.run_id)}\``,
    `- Generated: ${text(workOrder?.generated_at)}`,
    `- Mode: **${text(workOrder?.mode)}**`,
    `- Status: **${text(workOrder?.status)}**`,
    "- Target runtime: 8–12 minutes",
    `- Selected verified stories: ${selected.length}`,
    `- Script words: ${Number(workOrder?.script?.word_count || 0)}`,
    `- Estimated runtime: ${Number(
      workOrder?.script?.estimated_duration_seconds || 0,
    ).toFixed(2)} seconds`,
    `- Work-order SHA-256: \`${text(
      workOrder?.work_order_sha256,
    )}\``,
    "",
    "## Selected story set",
    "",
  ];
  if (!selected.length) lines.push("- None");
  for (const story of selected) {
    lines.push(
      `- **${text(story.title)}** — score ${Number(
        story.priority_score || 0,
      )}, source \`${text(story.source_evidence?.sha256)}\`, rights \`${text(
        story.rights_ledger?.sha256,
      )}\``,
    );
  }
  lines.push("", "## Editorial package", "");
  lines.push(
    `- Dossier: **${workOrder?.dossier ? "Present" : "Missing"}**`,
    `- Script: **${workOrder?.script ? "Present" : "Missing"}**`,
    `- Visual beats: ${Number(
      workOrder?.visual_beat_plan?.beat_count || 0,
    )}`,
    `- Derivative items: ${Number(
      workOrder?.derivative_plan?.item_count || 0,
    )}`,
    "",
    "## Work-order blockers",
    "",
  );
  if (!blockers.length) lines.push("- None");
  for (const blocker of blockers) lines.push(`- \`${blocker}\``);
  lines.push("", "## Production evidence status", "");
  lines.push(
    `- Status: **${text(workOrder?.production_readiness?.status)}**`,
    `- Real narration verified: **${
      workOrder?.production_readiness?.real_narration_verified
        ? "Yes"
        : "No"
    }**`,
    `- Provider alignment verified: **${
      workOrder?.production_readiness?.provider_alignment_verified
        ? "Yes"
        : "No"
    }**`,
    `- Master verified: **${
      workOrder?.production_readiness?.master_verified ? "Yes" : "No"
    }**`,
  );
  for (const blocker of productionBlockers) {
    lines.push(`- \`${blocker}\``);
  }
  lines.push(
    "",
    "## Safety",
    "",
    "- External publication authorised: **No**",
    "- Database mutation authorised: **No**",
    "- OAuth mutation authorised: **No**",
    "- Network used: **No**",
    "",
    "This LOCAL_PROOF work order creates no scheduler, render, upload or publication authority.",
    "",
  );
  return lines.join("\n");
}

async function writeAtomic(filePath, bytes) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function materializeWeeklyLongformWorkOrder({
  outputDir,
  ...input
} = {}) {
  if (!text(outputDir)) {
    throw new Error("weekly_longform_output_dir_required");
  }
  const workOrder = buildWeeklyLongformWorkOrder(input);
  const outputRoot = path.resolve(outputDir);
  await fsp.mkdir(outputRoot, { recursive: true });
  const paths = {
    json: path.join(outputRoot, "weekly-longform-work-order.json"),
    markdown: path.join(outputRoot, "weekly-longform-work-order.md"),
  };
  const jsonBytes = Buffer.from(
    `${JSON.stringify(workOrder, null, 2)}\n`,
    "utf8",
  );
  const markdownBytes = Buffer.from(
    renderWeeklyLongformWorkOrderMarkdown(workOrder),
    "utf8",
  );
  await writeAtomic(paths.json, jsonBytes);
  await writeAtomic(paths.markdown, markdownBytes);
  return {
    workOrder,
    paths,
    json_sha256: sha256Buffer(jsonBytes),
    markdown_sha256: sha256Buffer(markdownBytes),
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    network_used: false,
  };
}

module.exports = {
  ACCEPTED_SOURCE_TYPES,
  GENERATOR_ID,
  MAXIMUM_STORY_COUNT,
  MINIMUM_STORY_COUNT,
  MODE,
  SCHEMA_VERSION,
  assessWeeklyLongformVisualPack,
  buildWeeklyLongformWorkOrder,
  materializeWeeklyLongformWorkOrder,
  renderWeeklyLongformWorkOrderMarkdown,
  sha256Buffer,
  workOrderFingerprint,
};
