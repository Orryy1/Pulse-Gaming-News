"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const { applyGamingPronunciation } = require("./tts-pronunciation");

const EXACT_CTA = "Follow Pulse Gaming so you never miss a beat.";
const MIN_SCRIPT_WORDS = 115;
const MAX_SCRIPT_WORDS = 155;
const STALE_DERIVED_PATHS = Object.freeze([
  "audio",
  "flagship",
  "platform_variants",
  "production-report",
  "qa/decoded-visual",
  "analytics_ingest_plan.json",
  "audio_manifest.json",
  "audio_segment_loudness_report.json",
  "benchmark_report.json",
  "caption_manifest.json",
  "captions.srt",
  "coherence_report.json",
  "decoded_forensic_report.json",
  "director_beat_map.json",
  "facebook_publish_pack.json",
  "final_av_contact_sheet.png",
  "final_av_review.json",
  "forensic_qa_report.json",
  "goal_package_summary.json",
  "instagram_publish_pack.json",
  "materialised_cutover_verification.json",
  "narration_manifest.json",
  "platform_publish_manifest.json",
  "platform_variant_scorecard.json",
  "publish_verdict.json",
  "pulse_media_house_score.json",
  "render_manifest.json",
  "script_scorecard.json",
  "sfx_manifest.json",
  "sfx_source_plan.json",
  "threads_publish_pack.json",
  "tiktok_publish_pack.json",
  "visual_quality_report.json",
  "visual_v4_render.mp4",
  "visual_v4_render_story.json",
  "voice_quality_report.json",
  "x_publish_pack.json",
  "youtube_publish_pack.json",
]);

function clean(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function wordCount(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function assertSafeStoryId(value) {
  const storyId = clean(value);
  if (!storyId) throw new Error("script_patch_story_id_missing");
  if (!/^[A-Za-z0-9._-]+$/.test(storyId)) throw new Error("script_patch_story_id_not_path_safe");
  return storyId;
}

function hasLethalHitOnlyEvidence(canonical = {}) {
  const claims = [
    ...asArray(canonical.confirmed_claims),
    ...asArray(canonical.claim_inventory?.confirmed),
  ].map(clean).filter(Boolean);
  return claims.some((claim) => /\blethal hit\b/i.test(claim)) &&
    !claims.some((claim) => /\bevery hit\b/i.test(claim));
}

function validateFlagshipScriptPatch(patch = {}, canonical = {}) {
  const storyId = assertSafeStoryId(patch.story_id);
  const canonicalStoryId = clean(canonical.story_id || canonical.id);
  if (canonicalStoryId && canonicalStoryId !== storyId) {
    throw new Error(`script_patch_story_id_mismatch:${storyId}/${canonicalStoryId}`);
  }
  const canonicalSubject = clean(patch.canonical_subject);
  const canonicalGame = clean(patch.canonical_game || canonicalSubject);
  const canonicalCompany = clean(patch.canonical_company || canonical.canonical_company);
  const confirmedClaims = asArray(patch.confirmed_claims).map(clean).filter(Boolean);
  const title = clean(patch.title);
  const firstFrameText = clean(patch.first_frame_text);
  const firstSpokenLine = clean(patch.first_spoken_line);
  const narrationScript = clean(patch.narration_script);
  if (!canonicalSubject) throw new Error("script_patch_canonical_subject_missing");
  if (!canonicalGame) throw new Error("script_patch_canonical_game_missing");
  if (!confirmedClaims.length) throw new Error("script_patch_confirmed_claims_missing");
  if (!title) throw new Error("script_patch_title_missing");
  if (!firstFrameText) throw new Error("script_patch_first_frame_text_missing");
  if (!firstSpokenLine) throw new Error("script_patch_first_spoken_line_missing");
  if (!narrationScript) throw new Error("script_patch_narration_script_missing");
  if (!narrationScript.startsWith(firstSpokenLine)) {
    throw new Error("script_patch_first_spoken_line_not_script_prefix");
  }
  const words = wordCount(narrationScript);
  if (words < MIN_SCRIPT_WORDS || words > MAX_SCRIPT_WORDS) {
    throw new Error(`script_patch_word_count_outside_contract:${words}/${MIN_SCRIPT_WORDS}-${MAX_SCRIPT_WORDS}`);
  }
  if (!narrationScript.endsWith(EXACT_CTA)) {
    throw new Error("script_patch_exact_cta_missing");
  }
  if (
    /\b(?:the hook here is|that is the real hook|the real hook is|the signal is|for fans to argue about|source-backed update|this story finally has something specific to judge|internal qa|quality gate|scorecard)\b/i
      .test(narrationScript)
  ) {
    throw new Error("script_patch_internal_or_scaffold_language");
  }
  if (
    hasLethalHitOnlyEvidence(canonical) &&
    /\bevery hit\b/i.test(`${title} ${firstFrameText} ${narrationScript}`)
  ) {
    throw new Error("unsupported_universal_hit_claim");
  }
  const mentionedCompany = narrationScript.match(/\b([A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*)*)\s+Games\b/)?.[0];
  if (
    canonicalCompany &&
    mentionedCompany &&
    clean(mentionedCompany).toLowerCase() !== canonicalCompany.toLowerCase()
  ) {
    throw new Error(`script_patch_company_mismatch:${clean(mentionedCompany)}/${canonicalCompany}`);
  }
  return {
    storyId,
    canonicalSubject,
    canonicalGame,
    canonicalCompany,
    confirmedClaims,
    title,
    firstFrameText,
    firstSpokenLine,
    narrationScript,
    ttsScript: clean(
      patch.tts_script ||
      applyGamingPronunciation(narrationScript, {
        protectedTitles: [canonicalSubject, canonicalGame],
      }),
    ),
    wordCount: words,
  };
}

function invalidateWorkOrderJob(job = {}, artifactDir, generatedAt) {
  const narrationPath = path.join(artifactDir, "audio", "narration.mp3");
  const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
  const renderExpectations = [
    "final_publish_render=true",
    "visual_tier=production_v4_motion",
  ];
  const actions = asArray(job.actions).map((action) => {
    if (clean(action?.action_id) !== "run_visual_v4_production_render") {
      return action;
    }
    return {
      ...action,
      status: "ready_after_inputs",
      output_expectations: [
        ...new Set([
          ...asArray(action.output_expectations).map(clean).filter(Boolean),
          ...renderExpectations,
        ]),
      ],
      target_render_manifest: {
        ...(action.target_render_manifest || {}),
        renderer: "visual_v4_production",
        visual_tier: "production_v4_motion",
        final_publish_render: true,
      },
    };
  });
  const evidence = {
    ...(job.evidence || {}),
    narration_ready: false,
    word_timestamps_ready: false,
    final_render_ready: false,
    render_manifest_ready: false,
    narration_audio_path: narrationPath,
    word_timestamps_path: timestampsPath,
    stale_after_script_rewrite: true,
    script_repaired_at: generatedAt,
  };
  for (const key of [
    "narration_audio_sha256",
    "narration_audio_size_bytes",
    "word_timestamps_sha256",
    "word_timestamps_size_bytes",
    "final_render_path",
    "final_render_size_bytes",
    "caption_file_path",
    "caption_file_size_bytes",
    "render_manifest_path",
  ]) {
    delete evidence[key];
  }
  return {
    ...job,
    status: "blocked_on_render_inputs",
    blockers: ["narration_audio_missing", "word_timestamps_missing"],
    evidence,
    target_render_manifest: {
      ...(job.target_render_manifest || {}),
      renderer: "visual_v4_production",
      visual_tier: "production_v4_motion",
      final_publish_render: true,
    },
    actions,
  };
}

function audioWorkbench(storyId, title, artifactDir, generatedAt) {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_FLAGSHIP_SCRIPT_REPAIR",
    summary: {
      story_count: 1,
      ready_audio_timestamp_pair_count: 0,
      blocked_local_tts_count: 0,
      requires_generation_count: 1,
      requires_asr_alignment_count: 0,
      elevenlabs_generation_count: 0,
    },
    local_tts: {
      verdict: "unknown_until_runtime_probe",
      ready: null,
      stale: null,
    },
    provider_preference: "local",
    jobs: [{
      story_id: storyId,
      title,
      artifact_dir: artifactDir,
      status: "requires_audio_timestamp_generation",
      missing: ["narration_audio", "word_timestamps"],
      audio: {
        path: path.join(artifactDir, "audio", "narration.mp3"),
        exists: false,
        usable: false,
        size_bytes: 0,
      },
      timestamps: {
        path: path.join(artifactDir, "audio", "word_timestamps.json"),
        exists: false,
        usable: false,
        word_count: 0,
        format: "missing",
        reason: "timestamp_file_missing",
      },
      tts_provider: "local",
      tts_provider_reason: "governed_flagship_script_repair_requires_fresh_local_narration",
    }],
    safety: {
      local_only: true,
      no_publish_triggered: true,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
    },
  };
}

async function repairFlagshipScriptWorkspace({
  artifactDir,
  workOrderPath,
  patch,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedArtifactDir = path.resolve(artifactDir || "");
  const resolvedWorkOrderPath = path.resolve(workOrderPath || "");
  if (!artifactDir || !(await fs.pathExists(resolvedArtifactDir))) {
    throw new Error("script_repair_artifact_dir_missing");
  }
  if (!workOrderPath || !(await fs.pathExists(resolvedWorkOrderPath))) {
    throw new Error("script_repair_work_order_missing");
  }
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("script_repair_generated_at_invalid");
  const canonicalPath = path.join(resolvedArtifactDir, "canonical_story_manifest.json");
  if (!(await fs.pathExists(canonicalPath))) throw new Error("script_repair_canonical_manifest_missing");
  const canonical = await fs.readJson(canonicalPath);
  const validated = validateFlagshipScriptPatch(patch, canonical);
  const workOrder = await fs.readJson(resolvedWorkOrderPath);
  const matchingJobs = asArray(workOrder.jobs).filter(
    (job) => clean(job?.story_id) === validated.storyId,
  );
  if (matchingJobs.length !== 1) {
    throw new Error(`script_repair_work_order_job_count:${matchingJobs.length}`);
  }
  const declaredArtifactDir = path.resolve(matchingJobs[0].artifact_dir || "");
  if (declaredArtifactDir !== resolvedArtifactDir) {
    throw new Error("script_repair_work_order_artifact_mismatch");
  }

  const updatedCanonical = {
    ...canonical,
    canonical_subject: validated.canonicalSubject,
    canonical_game: validated.canonicalGame,
    canonical_company: validated.canonicalCompany,
    confirmed_claims: validated.confirmedClaims,
    claim_inventory: {
      ...(canonical.claim_inventory || {}),
      confirmed: validated.confirmedClaims,
      unconfirmed: asArray(patch.unconfirmed_claims),
      prohibited: asArray(patch.prohibited_claims),
    },
    canonical_title: validated.title,
    selected_title: validated.title,
    short_title: validated.title,
    title: validated.title,
    public_title: validated.title,
    thumbnail_headline: validated.firstFrameText,
    thumbnail_text: validated.firstFrameText,
    suggested_thumbnail_text: validated.firstFrameText,
    first_frame_text: validated.firstFrameText,
    first_spoken_line: validated.firstSpokenLine,
    narration_hook: validated.firstSpokenLine,
    narration_script: validated.narrationScript,
    full_script: validated.narrationScript,
    display_script: validated.narrationScript,
    caption_display_text: validated.narrationScript,
    tts_script: validated.ttsScript,
    spoken_narration_script: validated.ttsScript,
    word_count: validated.wordCount,
    tts_word_count: wordCount(validated.ttsScript),
    audio_word_timestamp_count: 0,
    narration_audio_path: null,
    word_timestamps_path: null,
    resolved_narration_audio_path: null,
    resolved_word_timestamps_path: null,
    publish_status: "held_for_audio_render_and_av_regeneration",
    script_repaired_at: generatedAt,
    script_repair_invalidates_prior_media: true,
  };

  const invalidated = [];
  for (const relativePath of STALE_DERIVED_PATHS) {
    const candidate = path.join(resolvedArtifactDir, relativePath);
    if (await fs.pathExists(candidate)) invalidated.push(relativePath);
    await fs.remove(candidate);
  }
  await fs.writeJson(canonicalPath, updatedCanonical, { spaces: 2 });

  const claimInventoryPath = path.join(resolvedArtifactDir, "claim_inventory.json");
  if (await fs.pathExists(claimInventoryPath)) {
    const claimInventory = await fs.readJson(claimInventoryPath);
    await fs.writeJson(claimInventoryPath, {
      ...claimInventory,
      story_id: validated.storyId,
      confirmed: validated.confirmedClaims,
      unconfirmed: asArray(patch.unconfirmed_claims),
      prohibited: asArray(patch.prohibited_claims),
      script_repaired_at: generatedAt,
    }, { spaces: 2 });
  }

  const rightsPath = path.join(resolvedArtifactDir, "rights_ledger.json");
  if (await fs.pathExists(rightsPath)) {
    const rights = await fs.readJson(rightsPath);
    await fs.writeJson(rightsPath, {
      ...rights,
      status: "blocked",
      verdict: "RED",
      blockers: [
        ...new Set([
          ...asArray(rights.blockers).map(clean).filter(Boolean),
          "narration_and_render_regeneration_required_after_script_repair",
        ]),
      ],
      script_repair_invalidated_at: generatedAt,
    }, { spaces: 2 });
  }

  const updatedWorkOrder = {
    ...workOrder,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_FLAGSHIP_SCRIPT_REPAIR",
    summary: {
      ...(workOrder.summary || {}),
      ready_for_final_render_job_count: 0,
      blocked_on_render_inputs_count: 1,
    },
    jobs: asArray(workOrder.jobs).map((job) => (
      clean(job?.story_id) === validated.storyId
        ? invalidateWorkOrderJob(job, resolvedArtifactDir, generatedAt)
        : job
    )),
    publish_authorised: false,
  };
  await fs.writeJson(resolvedWorkOrderPath, updatedWorkOrder, { spaces: 2 });

  const outputDir = path.dirname(resolvedWorkOrderPath);
  const audioWorkbenchPath = path.join(outputDir, "audio_timestamp_workbench.json");
  const reportPath = path.join(outputDir, "flagship_script_repair_report.json");
  await fs.writeJson(
    audioWorkbenchPath,
    audioWorkbench(validated.storyId, validated.title, resolvedArtifactDir, generatedAt),
    { spaces: 2 },
  );
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    status: "READY_FOR_LOCAL_AUDIO_REGENERATION",
    story_id: validated.storyId,
    title: validated.title,
    script_word_count: validated.wordCount,
    tts_word_count: wordCount(validated.ttsScript),
    artifact_dir: resolvedArtifactDir,
    work_order_path: resolvedWorkOrderPath,
    audio_workbench_path: audioWorkbenchPath,
    invalidated_stale_derived_evidence: invalidated,
    preserved_evidence: [
      "canonical_story_manifest.json",
      "claim_inventory.json",
      "source_manifest.json",
      "materialised_motion_clips.json",
      "rights_ledger.json",
    ],
    publish_authorised: false,
    safety: {
      local_only: true,
      no_publish_triggered: true,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
      gates_weakened: false,
    },
  };
  await fs.writeJson(reportPath, report, { spaces: 2 });
  return {
    report,
    reportPath,
    audioWorkbenchPath,
    canonicalPath,
    workOrderPath: resolvedWorkOrderPath,
  };
}

function rebaseArtifactPaths(value, sourceArtifactDir, targetArtifactDir) {
  if (Array.isArray(value)) {
    return value.map((item) =>
      rebaseArtifactPaths(item, sourceArtifactDir, targetArtifactDir),
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rebaseArtifactPaths(item, sourceArtifactDir, targetArtifactDir),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  const replacements = [
    [sourceArtifactDir, targetArtifactDir],
    [sourceArtifactDir.replace(/\\/g, "/"), targetArtifactDir.replace(/\\/g, "/")],
  ];
  return replacements.reduce(
    (current, [source, target]) => current.split(source).join(target),
    value,
  );
}

function isStaleDerivedSourcePath(sourceArtifactDir, candidatePath) {
  const relative = path.relative(sourceArtifactDir, candidatePath).replace(/\\/g, "/");
  if (!relative) return false;
  return STALE_DERIVED_PATHS.some((stalePath) => {
    const normalised = stalePath.replace(/\\/g, "/");
    return relative === normalised || relative.startsWith(`${normalised}/`);
  });
}

async function cloneFlagshipScriptRepairWorkspace({
  sourceArtifactDir,
  sourceWorkOrderPath,
  workspaceDir,
  patch,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedSourceArtifactDir = path.resolve(sourceArtifactDir || "");
  const resolvedSourceWorkOrderPath = path.resolve(sourceWorkOrderPath || "");
  const resolvedWorkspaceDir = path.resolve(workspaceDir || "");
  if (!sourceArtifactDir || !(await fs.pathExists(resolvedSourceArtifactDir))) {
    throw new Error("script_repair_source_artifact_dir_missing");
  }
  if (!sourceWorkOrderPath || !(await fs.pathExists(resolvedSourceWorkOrderPath))) {
    throw new Error("script_repair_source_work_order_missing");
  }
  if (!workspaceDir) throw new Error("script_repair_isolated_workspace_missing");
  if (await fs.pathExists(resolvedWorkspaceDir)) {
    throw new Error("script_repair_isolated_workspace_already_exists");
  }
  if (
    resolvedWorkspaceDir === resolvedSourceArtifactDir ||
    resolvedWorkspaceDir.startsWith(`${resolvedSourceArtifactDir}${path.sep}`)
  ) {
    throw new Error("script_repair_isolated_workspace_inside_source_artifact");
  }

  const canonicalPath = path.join(
    resolvedSourceArtifactDir,
    "canonical_story_manifest.json",
  );
  if (!(await fs.pathExists(canonicalPath))) {
    throw new Error("script_repair_canonical_manifest_missing");
  }
  const [canonical, sourceWorkOrder] = await Promise.all([
    fs.readJson(canonicalPath),
    fs.readJson(resolvedSourceWorkOrderPath),
  ]);
  const validated = validateFlagshipScriptPatch(patch, canonical);
  const matchingJobs = asArray(sourceWorkOrder.jobs).filter(
    (job) => clean(job?.story_id) === validated.storyId,
  );
  if (matchingJobs.length !== 1) {
    throw new Error(`script_repair_work_order_job_count:${matchingJobs.length}`);
  }

  const targetArtifactDir = path.join(
    resolvedWorkspaceDir,
    "artifacts",
    validated.storyId,
  );
  const targetWorkOrderPath = path.join(
    resolvedWorkspaceDir,
    "render_input_work_order.json",
  );
  try {
    await fs.ensureDir(path.dirname(targetArtifactDir));
    await fs.copy(resolvedSourceArtifactDir, targetArtifactDir, {
      overwrite: false,
      errorOnExist: true,
      filter: (sourcePath) =>
        !isStaleDerivedSourcePath(resolvedSourceArtifactDir, sourcePath),
    });
    const clonedJob = rebaseArtifactPaths(
      matchingJobs[0],
      resolvedSourceArtifactDir,
      targetArtifactDir,
    );
    clonedJob.artifact_dir = targetArtifactDir;
    await fs.writeJson(targetWorkOrderPath, {
      ...sourceWorkOrder,
      generated_at: generatedAt,
      mode: "LOCAL_PROOF_ISOLATED_FLAGSHIP_SCRIPT_REPAIR",
      summary: {
        ...(sourceWorkOrder.summary || {}),
        story_count: 1,
      },
      jobs: [clonedJob],
      publish_authorised: false,
    }, { spaces: 2 });

    const result = await repairFlagshipScriptWorkspace({
      artifactDir: targetArtifactDir,
      workOrderPath: targetWorkOrderPath,
      patch,
      generatedAt,
    });
    result.report.source_artifact_dir = resolvedSourceArtifactDir;
    result.report.source_work_order_path = resolvedSourceWorkOrderPath;
    result.report.source_evidence_preserved = true;
    result.report.isolated_workspace = resolvedWorkspaceDir;
    await fs.writeJson(result.reportPath, result.report, { spaces: 2 });
    return result;
  } catch (error) {
    await fs.remove(resolvedWorkspaceDir);
    throw error;
  }
}

module.exports = {
  cloneFlagshipScriptRepairWorkspace,
  EXACT_CTA,
  MAX_SCRIPT_WORDS,
  MIN_SCRIPT_WORDS,
  repairFlagshipScriptWorkspace,
  validateFlagshipScriptPatch,
  wordCount,
};
