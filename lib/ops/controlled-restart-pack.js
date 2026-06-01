"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");

const { runScriptCoherenceQa } = require("../script-coherence-qa");
const { buildViralScriptIntelligence } = require("../viral-script-intelligence");

const REQUIRED_ENABLED_PLATFORMS = [
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
];

const DEFERRED_PLATFORMS = ["tiktok", "x", "threads", "pinterest"];

const REQUIRED_OUTPUT_FILES = [
  "controlled_restart_pack.md",
  "controlled_restart_pack.json",
  "selected_restart_candidates.json",
  "operator_approval_checklist.md",
  "guarded_dispatch_plan.json",
  "platform_deferred_actions.json",
  "live_gate_change_plan.md",
  "post_restart_verification_checklist.md",
  "scheduled_task_cleanup_plan.md",
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || ""));
}

function rel(root, filePath) {
  const text = clean(filePath);
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.join(root, text);
}

function exists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  let text = buffer.toString("utf8");
  if (text.includes("\u0000")) {
    text = buffer.toString("utf16le");
  }
  text = text.replace(/^\uFEFF/, "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const likelyObjectStarts = [...text.matchAll(/\{\s*"([A-Za-z0-9_]+)"\s*:/g)]
      .map((match) => match.index)
      .filter((index) => Number.isInteger(index));
    for (const objectStart of likelyObjectStarts) {
      try {
        return JSON.parse(text.slice(objectStart).trim());
      } catch {
        // Keep scanning; stdout captures may contain earlier non-JSON braces.
      }
    }
    const arrayStart = text.indexOf("[");
    if (arrayStart >= 0) return JSON.parse(text.slice(arrayStart).trim());
    throw err;
  }
}

function writeJson(filePath, value) {
  return fs.writeJson(filePath, value, { spaces: 2 });
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && clean(value) !== "") return value;
  }
  return null;
}

function verdictIsGreen(value) {
  return ["green", "pass", "ready", "publish_ready"].includes(clean(value).toLowerCase());
}

function hasBlockers(value = {}) {
  return asArray(value.blockers).length > 0 ||
    asArray(value.failures).length > 0 ||
    asArray(value.reason_codes).some((code) => !/warning/i.test(String(code)));
}

function storyArtifactDir(root, storyId, storyPackages = []) {
  const fromPackage = storyPackages.find((item) => clean(item.story_id || item.id) === storyId);
  const dir = clean(fromPackage?.artifact_dir || fromPackage?.artifactDir);
  if (dir) return rel(root, dir);
  return path.join(root, "output", "goal-proof", "batch", storyId);
}

function readStoryArtefacts(root, storyId, storyPackages = []) {
  const dir = storyArtifactDir(root, storyId, storyPackages);
  const read = (name) => readJsonIfExists(path.join(dir, name)) || {};
  return {
    artifact_dir: dir,
    canonical: read("canonical_story_manifest.json"),
    source: read("source_manifest.json"),
    render: read("render_manifest.json"),
    narration: read("narration_manifest.json"),
    captions: read("caption_manifest.json"),
    rights: read("rights_ledger.json"),
    motion: read("materialised_motion_clips.json"),
    visualQuality: read("visual_quality_report.json"),
    benchmark: read("benchmark_report.json"),
    coherence: read("coherence_report.json"),
    policy: read("platform_policy_report.json"),
    publishVerdict: read("publish_verdict.json"),
    youtube: read("youtube_publish_pack.json"),
    instagram: read("instagram_publish_pack.json"),
    facebook: read("facebook_publish_pack.json"),
    platformManifest: read("platform_publish_manifest.json"),
  };
}

function actionsForStory(plan = {}, storyId) {
  return asArray(plan.actions || plan.platform_actions || plan.scheduled_actions)
    .filter((action) => clean(action.story_id || action.storyId || action.id) === storyId);
}

function actionPlatform(action = {}) {
  return clean(action.platform || action.platform_target || action.target);
}

function platformActionsByPlatform(actions = []) {
  const map = new Map();
  for (const action of actions) map.set(actionPlatform(action), action);
  return map;
}

function enabledActionIsReviewReady(action = {}) {
  return (
    action.platform_enabled === true &&
    clean(action.action) === "would_publish" &&
    action.requires_human_review_before_live_publish === true &&
    clean(action.live_execution_gate) === "operator_human_review_required" &&
    asArray(action.blockers).length === 0 &&
    asArray(action.warnings).length === 0
  );
}

function disabledActionIsDeferred(action = {}) {
  return (
    action.platform_enabled === false &&
    clean(action.action) === "would_queue_when_enabled" &&
    clean(action.live_execution_gate) === "platform_enablement_required" &&
    asArray(action.blockers).length === 0
  );
}

function genericTitleReason(title) {
  const text = clean(title).toLowerCase();
  if (!text) return "missing_title";
  if (text.includes("this gaming story")) return "placeholder_title_this_gaming_story";
  if (/^(gaming news|breaking gaming news|source-backed update|update)$/i.test(clean(title))) {
    return "generic_title";
  }
  if (clean(title).split(/\s+/).length < 4) return "title_too_short_for_restart";
  return null;
}

function internalPublicCopyReason(script = "", title = "") {
  const text = clean(script);
  if (!text) return "missing_narration_script";
  const qa = runScriptCoherenceQa(
    { title, full_script: text },
    { requireCtaField: false, requireFullScriptCta: false },
  );
  return qa.failures.some((failure) =>
    failure === "script_coherence:vague_filler:internal_audience_scaffold" ||
    failure === "script_coherence:vague_filler:internal_tracking_language" ||
    failure === "script_coherence:generic_uncertainty_boilerplate" ||
    failure === "script_coherence:internal_pulse_framing" ||
    failure === "script_coherence:abstract_signal_language"
  )
    ? "internal_audience_or_editorial_scaffold_language"
    : null;
}

function hasRomanNumeralRisk(text = "") {
  return /\b(?:II|III|IV|VI|VII|VIII|IX|XI|XII|XIII|XIV|XV)\b/.test(clean(text));
}

function hasPronunciationEvidence(artefacts = {}) {
  const narration = artefacts.narration || {};
  return Boolean(
    narration.pronunciation_evidence ||
      narration.pronunciation_verified === true ||
      narration.tts_pronunciation_verified === true ||
      asArray(narration.pronunciation_overrides).length ||
      asArray(narration.tts_pronunciation_overrides).length,
  );
}

function commercialDisclosureDecision(artefacts = {}) {
  const packs = [artefacts.youtube, artefacts.instagram, artefacts.facebook, artefacts.platformManifest];
  for (const pack of packs) {
    const status = pack?.disclosure_status || pack?.disclosureStatus;
    if (status && typeof status === "object") {
      return {
        required: status.required === true,
        type: clean(status.type || "none") || "none",
        caption: clean(status.caption),
        decision: status.required === true ? "required_and_declared" : "not_required",
      };
    }
  }
  return null;
}

function aiDisclosureDecision(artefacts = {}) {
  const ai = artefacts.policy?.ai_disclosure || artefacts.policy?.disclosure_requirements?.ai;
  if (ai) {
    return {
      required: ai.required === true,
      type: clean(ai.type || "ai"),
      caption: clean(ai.caption),
      decision: clean(ai.decision || (ai.required ? "required" : "not_required")),
    };
  }
  return {
    required: false,
    type: "ai_or_synthetic_media",
    caption: "",
    decision: "not_required",
    basis: "No platform policy artefact marks this as altered realistic footage, synthetic presenter impersonation or deceptive event reconstruction.",
  };
}

function timestampEvidence(candidate = {}, artefacts = {}) {
  const timestampCheck = candidate.preflight_qa?.checks?.timestamp_alignment || {};
  const evidence = timestampCheck.evidence || {};
  return {
    preflight_result: clean(timestampCheck.result || candidate.preflight_qa?.status),
    preflight_evidence: evidence,
    word_timestamp_source: clean(artefacts.narration?.word_timestamp_source),
    word_timestamp_count: Number(artefacts.narration?.word_timestamp_count || 0),
    caption_status: clean(artefacts.captions?.status || artefacts.captions?.verdict),
    caption_blockers: asArray(artefacts.captions?.blockers),
  };
}

function timestampEvidencePasses(evidence = {}) {
  const source = clean(evidence.word_timestamp_source || evidence.preflight_evidence?.source).toLowerCase();
  return (
    clean(evidence.preflight_result).toLowerCase() === "pass" &&
    /whisper|forced|word/.test(source) &&
    evidence.word_timestamp_count > 0 &&
    evidence.caption_blockers.length === 0
  );
}

function finalMp4Path(root, candidate = {}, artefacts = {}) {
  return firstDefined(
    artefacts.render?.output_path,
    artefacts.render?.final_render_path,
    candidate.source?.exported_path,
    path.join(artefacts.artifact_dir || "", "visual_v4_render.mp4"),
  );
}

function captionsPath(root, artefacts = {}) {
  return firstDefined(
    artefacts.captions?.resolved_caption_srt_path,
    artefacts.captions?.caption_srt_path,
    artefacts.captions?.captions_path,
    path.join(artefacts.artifact_dir || "", "captions.srt"),
  );
}

function finalRenderIsProduction(artefacts = {}) {
  const renderer = clean(artefacts.render?.renderer || artefacts.render?.render_lane || artefacts.render?.lane).toLowerCase();
  const cls = clean(artefacts.render?.render_class || artefacts.render?.quality_class).toLowerCase();
  return (
    !renderer.includes("legacy_multi_image") &&
    !renderer.includes("fallback") &&
    cls !== "fallback" &&
    (renderer.includes("visual_v4") || artefacts.render?.final_publish_render === true)
  );
}

function materialisedMotionPasses(artefacts = {}) {
  const clips = asArray(artefacts.motion?.clips);
  const materialised = clips.filter((clip) => clip.materialized === true || clip.materialised === true || exists(clip.path));
  const families = new Set(
    materialised.map((clip) => clean(clip.motion_family || clip.source_family || clip.id)).filter(Boolean),
  );
  const directMotionCount = Number(
    artefacts.visualQuality?.visual_evidence_profile?.direct_video_motion_asset_count ||
      artefacts.benchmark?.visual_evidence_profile?.direct_video_motion_asset_count ||
      0,
  );
  return {
    materialised_count: materialised.length,
    distinct_motion_family_count: families.size,
    direct_video_motion_asset_count: directMotionCount,
    generated_only_motion_deck:
      artefacts.visualQuality?.visual_evidence_profile?.generated_only_motion_deck === true ||
      artefacts.benchmark?.visual_evidence_profile?.generated_only_motion_deck === true,
    passes: materialised.length >= 8 && families.size >= 3 && directMotionCount > 0,
  };
}

function sourceList(artefacts = {}) {
  const sources = [];
  const add = (source) => {
    if (!source) return;
    if (typeof source === "string") {
      sources.push({ name: clean(source), url: "" });
      return;
    }
    sources.push({
      name: clean(source.name || source.source_name || source.label || source.title || source.url),
      url: clean(source.url || source.source_url),
    });
  };
  add(artefacts.source?.primary_source || artefacts.canonical?.primary_source);
  for (const source of asArray(artefacts.source?.sources)) add(source);
  for (const source of asArray(artefacts.canonical?.secondary_sources)) add(source);
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${source.name}|${source.url}`;
    if (!source.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function restartRiskScore(candidate = {}, artefacts = {}) {
  let score = Number(candidate.score || 0);
  const title = clean(candidate.title || artefacts.canonical?.selected_title);
  const titleLower = title.toLowerCase();
  if (/\b(leak|leaked|reportedly|rumour|rumor)\b/.test(titleLower)) score -= 30;
  if (/\b(deal|drops?|sale|discount|\$|%|price)\b/.test(titleLower)) score -= 20;
  if (clean(artefacts.canonical?.official_source)) score += 12;
  if (clean(artefacts.canonical?.primary_source) === clean(artefacts.canonical?.official_source)) score += 6;
  score += Math.min(12, asArray(artefacts.rights?.assets || artefacts.rights?.records).length);
  score += Math.min(10, Number(artefacts.visualQuality?.scores?.motion_density_score || 0) / 10);
  return Math.round(score * 100) / 100;
}

function validateCandidate({
  root,
  candidate,
  strictDryRunPlan,
  storyPackages = [],
} = {}) {
  const storyId = clean(candidate.id || candidate.story_id);
  const actions = actionsForStory(strictDryRunPlan, storyId);
  const byPlatform = platformActionsByPlatform(actions);
  const artefacts = readStoryArtefacts(root, storyId, storyPackages);
  const title = clean(candidate.title || artefacts.canonical?.selected_title || artefacts.youtube?.title);
  const script = clean(
    artefacts.canonical?.narration_script ||
      artefacts.narration?.final_transcript ||
      artefacts.narration?.transcript,
  );
  const blockers = [];

  if (!storyId) blockers.push("missing_story_id");
  if (clean(candidate.status) !== "publish_ready") blockers.push("candidate_not_publish_ready");
  if (clean(candidate.preflight_qa?.status) !== "pass") blockers.push("scheduler_preflight_not_pass");
  const generic = genericTitleReason(title);
  if (generic) blockers.push(generic);
  const internalCopy = internalPublicCopyReason(script, title);
  if (internalCopy) blockers.push(internalCopy);
  const sourceName = sourceList(artefacts)[0]?.name || "";
  const viralScript = buildViralScriptIntelligence({
    story: { id: storyId, title, source_name: sourceName },
    script,
  });
  if (viralScript.verdict !== "viral_ready") {
    blockers.push(
      `audience_transcript_not_viral_ready:${viralScript.blockers[0] || viralScript.verdict || "score_below_threshold"}`,
    );
  }
  if (
    hasRomanNumeralRisk(`${title} ${script} ${artefacts.canonical?.canonical_subject || ""}`) &&
    !hasPronunciationEvidence(artefacts)
  ) {
    blockers.push("tts_pronunciation_evidence_missing_for_roman_numeral_title");
  }

  for (const platform of REQUIRED_ENABLED_PLATFORMS) {
    const action = byPlatform.get(platform);
    if (!action) blockers.push(`missing_enabled_platform_action:${platform}`);
    else if (!enabledActionIsReviewReady(action)) blockers.push(`enabled_platform_action_not_review_ready:${platform}`);
    if (action?.duplicate_title_risk === true || action?.duplicateTitleRisk === true) {
      blockers.push("duplicate_title_risk");
    }
  }
  for (const platform of DEFERRED_PLATFORMS) {
    const action = byPlatform.get(platform);
    if (action && !disabledActionIsDeferred(action)) blockers.push(`disabled_platform_action_not_deferred:${platform}`);
  }

  const mp4 = finalMp4Path(root, candidate, artefacts);
  if (!exists(mp4)) blockers.push("missing_final_mp4");
  const captions = captionsPath(root, artefacts);
  if (!exists(captions)) blockers.push("missing_captions");
  if (!finalRenderIsProduction(artefacts)) blockers.push("thin_or_fallback_render");

  const rightsVerdict = clean(artefacts.rights?.verdict || artefacts.rights?.status);
  const rightsCount = asArray(artefacts.rights?.assets || artefacts.rights?.records || artefacts.rights?.entries).length;
  if (!verdictIsGreen(rightsVerdict) || rightsCount <= 0 || hasBlockers(artefacts.rights)) {
    blockers.push("rights_ledger_not_clean");
  }

  const aiDisclosure = aiDisclosureDecision(artefacts);
  if (!aiDisclosure || !clean(aiDisclosure.decision)) blockers.push("missing_ai_disclosure_decision");
  const commercialDisclosure = commercialDisclosureDecision(artefacts);
  if (!commercialDisclosure) blockers.push("missing_commercial_disclosure_decision");

  const timestamp = timestampEvidence(candidate, artefacts);
  if (!timestampEvidencePasses(timestamp)) blockers.push("asr_or_caption_timing_not_proven");

  const motion = materialisedMotionPasses(artefacts);
  if (!motion.passes) blockers.push("motion_materialisation_not_restart_safe");
  if (motion.generated_only_motion_deck) blockers.push("generated_only_motion_deck");

  const coherenceVerdict = clean(artefacts.coherence?.verdict || artefacts.coherence?.result);
  if (!verdictIsGreen(coherenceVerdict) || hasBlockers(artefacts.coherence)) {
    blockers.push("source_title_or_public_copy_mismatch");
  }

  const publishVerdict = clean(artefacts.publishVerdict?.verdict || artefacts.publishVerdict?.status);
  if (publishVerdict !== "GREEN" && publishVerdict !== "green") blockers.push("control_tower_not_green_or_safe_amber");

  const firstThreeSecondSummary = clean(artefacts.canonical?.first_spoken_line)
    ? `${artefacts.canonical.first_spoken_line} Visual proof and source lock appear in the opening sequence.`
    : "Opening line and source lock are present in the first three seconds.";

  return {
    story_id: storyId,
    title,
    valid: blockers.length === 0,
    blockers,
    restart_safety_score: restartRiskScore(candidate, artefacts),
    candidate_score: Number(candidate.score || 0),
    duration_seconds: Number(candidate.duration_seconds || artefacts.render?.rendered_duration_s || 0),
    final_mp4_path: mp4,
    captions_path: captions,
    artifact_dir: artefacts.artifact_dir,
    final_description: clean(artefacts.youtube?.description || artefacts.canonical?.description),
    final_script: script,
    transcript_audience_quality: {
      verdict: viralScript.verdict,
      viral_score: viralScript.viral_score,
      scores: viralScript.scores,
      blockers: viralScript.blockers,
      recommendations: viralScript.rewrite_recommendations,
    },
    thumbnail_or_cover: {
      headline: clean(
        artefacts.youtube?.cover_frame?.headline ||
          artefacts.instagram?.cover_frame?.headline ||
          artefacts.canonical?.thumbnail_headline,
      ),
      subject: clean(
        artefacts.youtube?.cover_frame?.subject ||
          artefacts.instagram?.cover_frame?.subject ||
          artefacts.canonical?.canonical_subject,
      ),
      file: clean(artefacts.youtube?.cover_frame?.file || artefacts.instagram?.cover_frame?.file),
    },
    first_3_second_summary: firstThreeSecondSummary,
    source_list: sourceList(artefacts),
    ai_disclosure_decision: aiDisclosure,
    commercial_disclosure_decision: commercialDisclosure,
    rights_status: {
      verdict: rightsVerdict,
      asset_count: rightsCount,
      ledger_path: path.join(artefacts.artifact_dir, "rights_ledger.json"),
    },
    caption_status: {
      status: clean(artefacts.captions?.status || artefacts.captions?.verdict),
      timing_source: clean(artefacts.captions?.timing_source),
      word_timestamp_source: timestamp.word_timestamp_source,
      word_timestamp_count: timestamp.word_timestamp_count,
      path: captions,
    },
    render_status: {
      renderer: clean(artefacts.render?.renderer),
      render_invocation_mode: clean(artefacts.render?.render_invocation_mode),
      visual_quality: clean(artefacts.visualQuality?.result || artefacts.benchmark?.result),
      motion,
    },
    control_tower_verdict: publishVerdict || "unknown",
    platform_packages: Object.fromEntries(
      REQUIRED_ENABLED_PLATFORMS.map((platform) => {
        const packName = platform === "youtube_shorts"
          ? "youtube"
          : platform === "instagram_reels"
            ? "instagram"
            : "facebook";
        const pack = artefacts[packName] || {};
        return [platform, {
          action: byPlatform.get(platform)?.action || "would_publish",
          live_execution_gate: byPlatform.get(platform)?.live_execution_gate || "operator_human_review_required",
          package_path: path.join(artefacts.artifact_dir, `${platform === "youtube_shorts" ? "youtube" : platform === "instagram_reels" ? "instagram" : "facebook"}_publish_pack.json`),
          title: clean(pack.title || title),
          description: clean(pack.description || pack.caption || pack.page_caption || artefacts.canonical?.description),
          disclosure_status: pack.disclosure_status || null,
        }];
      }),
    ),
    deferred_platforms: DEFERRED_PLATFORMS.filter((platform) => byPlatform.has(platform)),
    rollback_plan: [
      "Do not delete automatically. If a post is wrong, switch visibility to private or unlist on the platform first.",
      "Record the platform post ID, reason and operator in the correction log before any deletion.",
      "Update description or pinned comment with a correction when the claim can be repaired without removal.",
    ],
    correction_plan: [
      "Monitor the primary source after posting.",
      "If the source changes, queue a correction review before reposting or amplifying.",
      "Disable any related landing-page or affiliate route if the source claim becomes unsafe.",
    ],
    manual_approval_checkbox: `[ ] Approve ${storyId} for YouTube Shorts, Instagram Reels and Facebook Reels only after watching the final MP4 and checking title, source, captions and cover.`,
    operator_commands: operatorCommands(storyId),
  };
}

function operatorCommands(storyId) {
  const platforms = REQUIRED_ENABLED_PLATFORMS.join(",");
  const artefacts = [
    "video_path",
    "captions_path",
    "canonical_manifest_path",
    "platform_publish_manifest_path",
  ].join(",");
  const base = [
    "npm run ops:goal-record-operator-decision --",
    "--story", storyId,
    "--operator", "\"<operator>\"",
    "--decision approve_enabled_platforms",
    "--approved-platforms", platforms,
    "--reviewed-artefacts", artefacts,
    "--risk-notes", "\"Watched final MP4, checked source/title/captions/cover and approve enabled platforms only.\"",
    "--json",
  ].join(" ");
  return {
    dry_run: base,
    apply_after_review: `${base} --apply`,
  };
}

function platformEntries(matrix = {}) {
  const platforms = matrix.platforms || {};
  if (Array.isArray(platforms)) return platforms;
  return Object.values(platforms);
}

function platformState(matrix = {}) {
  const enabled = [];
  const disabled_or_deferred = [];
  for (const platform of platformEntries(matrix)) {
    const name = clean(platform.platform || platform.name);
    const status = clean(platform.status || platform.state);
    const operational = clean(platform.operational_state);
    const entry = {
      platform: name,
      status,
      operational_state: operational,
      reason: clean(platform.operational_reason || platform.enablement_next_action),
      gaps: asArray(platform.enablement_gaps),
    };
    if (status === "ready_now" || operational === "enabled") enabled.push(entry);
    else disabled_or_deferred.push(entry);
  }
  return { enabled_platforms: enabled, disabled_or_deferred_platforms: disabled_or_deferred };
}

function gitText(args, cwd) {
  try {
    return clean(execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }));
  } catch {
    return "";
  }
}

function gitRaw(args, cwd) {
  try {
    return String(execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }) || "").trimEnd();
  } catch {
    return "";
  }
}

function currentRepoStatus(root) {
  const branch = gitText(["rev-parse", "--abbrev-ref", "HEAD"], root);
  const latest = gitText(["log", "-1", "--oneline", "--decorate"], root);
  const porcelain = gitRaw(["status", "--porcelain=v1"], root);
  const upstream = gitText(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root);
  let ahead = null;
  let behind = null;
  if (upstream) {
    const counts = gitText(["rev-list", "--left-right", "--count", `HEAD...${upstream}`], root).split(/\s+/);
    ahead = Number(counts[0] || 0);
    behind = Number(counts[1] || 0);
  }
  return {
    branch,
    latest_commit: latest,
    clean: !porcelain,
    changed_files: porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [],
    upstream,
    ahead,
    behind,
    pushed: upstream ? ahead === 0 && behind === 0 : null,
  };
}

async function fetchHealth(url) {
  if (!url || typeof fetch !== "function") return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    return { ok: res.ok, status: res.status, url, ...json };
  } catch (err) {
    return { ok: false, url, error: err.message };
  }
}

function healthUrl(value) {
  const text = clean(value);
  if (!text) return "";
  if (/\/api\/health\/?$/i.test(text)) return text;
  return `${text.replace(/\/+$/g, "")}/api/health`;
}

function liveGateState({ localHealth = {}, publicHealth = {}, platformStatusMatrix = {}, publishReadinessReport = {}, guardedDispatchPreflight = {} } = {}) {
  const health = publicHealth?.status === "ok" || publicHealth?.ok ? publicHealth : localHealth;
  const platforms = platformState(platformStatusMatrix);
  const autoPublish = health?.runtime?.auto_publish === true;
  const safeObservation = health?.runtime?.safe_observation_mode === true;
  const primary = health?.deployment?.primary === true;
  const guardedSafe = guardedDispatchPreflight.safe_to_publish_boolean === true ||
    guardedDispatchPreflight.guarded_dispatch_plan?.ready_for_guarded_dispatch === true;
  return {
    pulse_primary_instance: primary,
    primary_status: primary ? "primary_true" : "primary_false",
    auto_publish: autoPublish,
    active_operating_mode: safeObservation
      ? "LOCAL_SAFE_OBSERVATION"
      : autoPublish && primary
        ? "PRIMARY_AUTO_PUBLISH_CAPABLE"
        : "CONTROLLED_QUEUE_OR_DRY_RUN",
    safe_observation_mode: safeObservation,
    scheduler_active: health?.schedulerActive === true,
    enabled_platforms: platforms.enabled_platforms,
    disabled_or_deferred_platforms: platforms.disabled_or_deferred_platforms,
    safe_to_publish_boolean: guardedSafe === true && autoPublish && primary,
    publish_readiness_verdict: clean(
      publishReadinessReport.overall_verdict ||
        publishReadinessReport.verdict ||
        publishReadinessReport.readiness?.overall_verdict ||
        "unknown",
    ),
    dispatch_ready_action_count:
      Number(guardedDispatchPreflight.dispatch_ready_action_count || guardedDispatchPreflight.summary?.dispatch_ready_action_count || 0),
  };
}

function buildGuardedDispatchPlan(selected = []) {
  const actions = selected.flatMap((candidate) =>
    REQUIRED_ENABLED_PLATFORMS.map((platform) => ({
      story_id: candidate.story_id,
      platform,
      title: candidate.title,
      action: "operator_approval_required_then_guarded_dispatch",
      live_dispatch_allowed: false,
      requires_operator_approval: true,
      current_gate: "operator_human_review_required",
      package_path: candidate.platform_packages?.[platform]?.package_path || "",
      final_mp4_path: candidate.final_mp4_path,
    })),
  );
  return {
    mode: "CONTROLLED_RESTART_GUARDED_DISPATCH_PLAN",
    live_dispatch_allowed: false,
    no_live_dispatch_from_this_plan: true,
    enabled_platforms_only: REQUIRED_ENABLED_PLATFORMS,
    actions,
    required_before_dispatch: [
      "Operator watches each final MP4.",
      "Operator records approval decisions.",
      "Human-review approval gate passes.",
      "Guarded dispatch preflight returns ready actions.",
      "Primary instance and AUTO_PUBLISH are deliberately enabled on one process only.",
    ],
  };
}

function buildDeferredActions(selected = [], strictDryRunPlan = {}) {
  const all = [];
  for (const candidate of selected) {
    for (const action of actionsForStory(strictDryRunPlan, candidate.story_id)) {
      const platform = actionPlatform(action);
      if (!DEFERRED_PLATFORMS.includes(platform)) continue;
      all.push({
        story_id: candidate.story_id,
        title: candidate.title,
        platform,
        action: clean(action.action || "would_queue_when_enabled"),
        counted_as_live_ready: false,
        reason: platform === "tiktok"
          ? "TikTok remains deferred until token sync is complete."
          : platform === "x"
            ? "X remains deferred until API billing and credentials are confirmed."
            : `${platform} is not configured for restart dispatch.`,
        live_execution_gate: clean(action.live_execution_gate || "platform_enablement_required"),
      });
    }
  }
  return {
    mode: "PLATFORM_DEFERRED_ACTIONS",
    actions: all,
    disabled_platform_actions_counted_as_publishable: false,
  };
}

function buildOperatorApprovalChecklist(selected = []) {
  const lines = [
    "# Operator Approval Checklist",
    "",
    "Manual approval is per story and enabled platforms only. Do not approve TikTok, X, Threads or Pinterest from this pack.",
    "",
  ];
  for (const candidate of selected) {
    lines.push(`## ${candidate.story_id} - ${candidate.title}`);
    lines.push(candidate.manual_approval_checkbox);
    lines.push(`[ ] I watched the MP4: ${candidate.final_mp4_path}`);
    lines.push("[ ] Title, thumbnail, opening line, description and source label describe the same story.");
    lines.push("[ ] Captions line up with narration and no drift is visible.");
    lines.push("[ ] Rights ledger and disclosure status are acceptable for YouTube, Instagram Reels and Facebook Reels.");
    lines.push("");
    lines.push(`Dry-run decision command: \`${candidate.operator_commands.dry_run}\``);
    lines.push(`Apply decision after review: \`${candidate.operator_commands.apply_after_review}\``);
    lines.push("");
  }
  return {
    markdown: lines.join("\n").trimEnd() + "\n",
  };
}

function buildLiveGateChangePlan(gate = {}) {
  const lines = [
    "# Live Gate Change Plan",
    "",
    "Current state is intentionally blocked for live dispatch.",
    "",
    `- PULSE_PRIMARY_INSTANCE / primary: ${gate.primary_status || "unknown"}`,
    `- AUTO_PUBLISH: ${gate.auto_publish === true ? "true" : "false"}`,
    `- Active mode: ${gate.active_operating_mode || "unknown"}`,
    `- Safe to publish boolean: ${gate.safe_to_publish_boolean === true ? "true" : "false"}`,
    `- Publish readiness verdict: ${gate.publish_readiness_verdict || "unknown"}`,
    "",
    "Move from RED to HUMAN_REVIEW restart in this order:",
    "",
    "1. Leave TikTok, X, Threads and Pinterest disabled.",
    "2. Watch each selected final MP4 and use the operator checklist.",
    "3. Record operator decisions with the generated approval commands. The dry-run command should pass before the apply command is used.",
    "4. Run `npm run ops:goal-human-review-approval -- --json`.",
    "5. Run `npm run ops:goal-guarded-dispatch-preflight -- --json` and confirm dispatch-ready actions match only the approved enabled platforms.",
    "6. Confirm one posting server process only with `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'server.js|run.js schedule' } | Select-Object ProcessId,CommandLine`.",
    "7. Only then restart the chosen primary process with `PULSE_SAFE_OBSERVATION_MODE=false`, `PULSE_PRIMARY_INSTANCE=true`, `USE_JOB_QUEUE=true` and the existing controlled `AUTO_PUBLISH` setting required by the guarded dispatcher.",
    "8. Re-check `/api/health` and stop if primary, queue state or commit does not match this pack.",
    "",
    "AUTO_PUBLISH must not be treated as a full-open switch. It is only acceptable with one primary process, human-review approvals, guarded dispatch preflight and kill-switch visibility.",
  ];
  return lines.join("\n") + "\n";
}

function buildPostRestartChecklist() {
  return [
    "# Post-Restart Verification Checklist",
    "",
    "[ ] YouTube Studio shows the expected Short title, description, visibility and no duplicate upload.",
    "[ ] Instagram Reel is visible on the correct account and the media container did not fail.",
    "[ ] Facebook Reel or card is visible on the correct page.",
    "[ ] Discord summary lists only enabled platforms that actually posted.",
    "[ ] Platform post IDs are persisted against the correct story IDs.",
    "[ ] No duplicate post exists for the same title or event.",
    "[ ] Analytics ingest sees the new post IDs.",
    "[ ] `npm run ops:render-health -- --json` still separates live DB and V4 bridge health.",
    "[ ] `npm run ops:goal-dry-run-publish -- --json` after posting does not re-plan already-posted stories.",
    "[ ] `npm run ops:publish-readiness -- --json` reports no false-green dispatch state.",
  ].join("\n") + "\n";
}

function buildScheduledTaskCleanupPlan(hygiene = {}) {
  const tasks = asArray(hygiene.tasks).filter((task) => {
    const name = clean(task.task_name || task.TaskName || task.name);
    return asArray(hygiene.risk_task_names).includes(name) ||
      /python\.exe|powershell|cmd\.exe|wt\.exe/i.test(`${task.execute || task.Execute || ""} ${task.arguments || task.Arguments || ""}`);
  });
  const names = tasks.length
    ? tasks.map((task) => clean(task.task_name || task.TaskName || task.name))
    : asArray(hygiene.risk_task_names);
  const lines = [
    "# Scheduled Task Cleanup Plan",
    "",
    "No tasks were changed or deleted by this pack.",
    "",
    "Tasks to inspect for visible terminal windows:",
    "",
    ...(names.length ? names.map((name) => `- ${name}`) : ["- No visible-console risk tasks were reported."]),
    "",
    "Recommended hidden/windowless configuration:",
    "",
    "1. Back up the scheduled task XML first.",
    "2. Prefer `pythonw.exe` for background Python jobs that do not need a console.",
    "3. For PowerShell launchers, use `Start-Process ... -WindowStyle Hidden` or a scheduled task action that does not open Windows Terminal.",
    "4. Keep task ownership and trigger cadence unchanged unless you deliberately decide otherwise.",
    "5. Do not delete tasks automatically. Disable first only if an operator confirms the replacement path is running.",
  ];
  return lines.join("\n") + "\n";
}

function renderControlledRestartPackMarkdown(report = {}) {
  const gate = report.live_gating_state || {};
  const running = report.running_deployment_evidence || {};
  const lines = [
    "# Controlled Restart Pack",
    "",
    `Generated: ${report.generated_at}`,
    `Verdict: ${report.verdict}`,
    `Safe to publish now: ${report.safe_to_publish_boolean ? "true" : "false"}`,
    "",
    "## Repo",
    "",
    `- Branch: ${report.repo_status?.branch || "unknown"}`,
    `- Latest commit: ${report.repo_status?.latest_commit || "unknown"}`,
    `- Clean: ${report.repo_status?.clean === true ? "true" : "false"}`,
    `- Upstream: ${report.repo_status?.upstream || "unknown"}`,
    `- Pushed: ${report.repo_status?.pushed === true ? "yes" : report.repo_status?.pushed === false ? "no" : "unknown"}`,
    `- Local health commit: ${running.local_health?.build?.commit_short || "unknown"}`,
    `- Public health commit: ${running.public_health?.build?.commit_short || "unknown"}`,
    `- Scheduler active: ${running.public_health?.schedulerActive === true || running.local_health?.schedulerActive === true ? "true" : "false"}`,
    "",
    "## Live Gates",
    "",
    `- Primary: ${gate.primary_status || "unknown"}`,
    `- AUTO_PUBLISH: ${gate.auto_publish === true ? "true" : "false"}`,
    `- Active mode: ${gate.active_operating_mode || "unknown"}`,
    `- Publish readiness: ${gate.publish_readiness_verdict || "unknown"}`,
    `- Safe to publish boolean: ${gate.safe_to_publish_boolean === true ? "true" : "false"}`,
    "",
    "Enabled platforms for this restart:",
    ...asArray(gate.enabled_platforms).map((platform) => `- ${platform.platform}: ${platform.status || platform.operational_state}`),
    "",
    "Deferred platforms:",
    ...asArray(gate.disabled_or_deferred_platforms).map((platform) => `- ${platform.platform}: ${platform.operational_state || platform.status} (${platform.reason || "deferred"})`),
    "",
    "## Selected Candidates",
    "",
  ];
  for (const candidate of asArray(report.selected_restart_candidates)) {
    lines.push(`### ${candidate.story_id} - ${candidate.title}`);
    lines.push(`- Control tower: ${candidate.control_tower_verdict}`);
    lines.push(`- Duration: ${candidate.duration_seconds}s`);
    lines.push(`- MP4: ${candidate.final_mp4_path}`);
    lines.push(`- Cover: ${candidate.thumbnail_or_cover?.headline || ""}`);
    lines.push(`- First 3 seconds: ${candidate.first_3_second_summary}`);
    lines.push(`- Sources: ${candidate.source_list.map((source) => source.name).join(", ")}`);
    lines.push(`- AI disclosure: ${candidate.ai_disclosure_decision?.decision || "unknown"}`);
    lines.push(`- Commercial disclosure: ${candidate.commercial_disclosure_decision?.decision || "unknown"}`);
    lines.push(`- Rights: ${candidate.rights_status?.verdict} (${candidate.rights_status?.asset_count} assets)`);
    lines.push(`- Captions: ${candidate.caption_status?.status}, ${candidate.caption_status?.word_timestamp_source}`);
    lines.push("");
  }
  lines.push("## Guarded Dispatch");
  lines.push("");
  lines.push("No live dispatch is authorised by this pack. Enabled-platform actions require operator decisions and guarded dispatch preflight.");
  lines.push("");
  lines.push("## Files");
  lines.push("");
  for (const fileName of REQUIRED_OUTPUT_FILES) lines.push(`- ${fileName}`);
  return lines.join("\n") + "\n";
}

function buildControlledRestartPack({
  root = process.cwd(),
  generatedAt = new Date().toISOString(),
  candidateLimit = 3,
  candidateReport = {},
  strictDryRunPlan = {},
  storyPackages = [],
  platformStatusMatrix = {},
  platformUploadPreflightReport = {},
  renderHealthReport = {},
  publishReadinessReport = {},
  guardedDispatchPreflight = {},
  localRestartReadinessReport = {},
  repoStatus = null,
  localHealth = null,
  publicHealth = null,
  schedulerTaskHygiene = null,
} = {}) {
  const cwd = path.resolve(root);
  const evaluated = asArray(candidateReport.candidates)
    .map((candidate) => validateCandidate({ root: cwd, candidate, strictDryRunPlan, storyPackages }));
  const valid = evaluated
    .filter((candidate) => candidate.valid)
    .sort((a, b) => {
      if (b.restart_safety_score !== a.restart_safety_score) return b.restart_safety_score - a.restart_safety_score;
      return b.candidate_score - a.candidate_score;
    });
  const selected = valid.slice(0, candidateLimit);
  const blockers = [];
  if (selected.length < candidateLimit) blockers.push(`insufficient_restart_candidates:${selected.length}/${candidateLimit}`);

  const liveState = liveGateState({
    localHealth,
    publicHealth,
    platformStatusMatrix,
    publishReadinessReport,
    guardedDispatchPreflight,
  });
  const status = repoStatus || currentRepoStatus(cwd);
  const repoCommitShort = clean(status.latest_commit).split(/\s+/)[0]?.slice(0, 8) || "";
  const localCommitShort = clean(localHealth?.build?.commit_short);
  const publicCommitShort = clean(publicHealth?.build?.commit_short);
  const runningCommitMismatch = Boolean(
    repoCommitShort &&
      ((localCommitShort && !repoCommitShort.startsWith(localCommitShort.slice(0, 7))) ||
        (publicCommitShort && !repoCommitShort.startsWith(publicCommitShort.slice(0, 7)))),
  );
  const guardedDispatchPlan = buildGuardedDispatchPlan(selected);
  const deferredActions = buildDeferredActions(selected, strictDryRunPlan);
  const approvalChecklist = buildOperatorApprovalChecklist(selected);
  const taskHygiene = schedulerTaskHygiene || localRestartReadinessReport.windows_scheduler_hygiene || {};
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "CONTROLLED_RESTART_RELEASE_MANAGEMENT",
    verdict: blockers.length ? "RED" : "AMBER",
    safe_to_publish_boolean: false,
    operator_can_manually_approve_now: blockers.length === 0 && selected.length === candidateLimit,
    blockers,
    warnings: [
      "live_dispatch_blocked_until_operator_decisions_exist",
      "primary_and_auto_publish_are_not_enabled_for_live_dispatch",
      ...(runningCommitMismatch ? ["running_health_commit_differs_from_repo_latest"] : []),
    ],
    safety: {
      no_live_publish_triggered: true,
      no_oauth_or_token_change: true,
      no_production_db_mutation: true,
      disabled_platform_actions_not_counted_as_publishable: true,
    },
    repo_status: status,
    running_deployment_evidence: {
      local_health: localHealth || null,
      public_health: publicHealth || null,
    },
    live_gating_state: liveState,
    publish_readiness: {
      verdict: liveState.publish_readiness_verdict,
      raw_blockers: asArray(publishReadinessReport.blockers || publishReadinessReport.readiness?.blockers),
      raw_warnings: asArray(publishReadinessReport.warnings || publishReadinessReport.readiness?.warnings),
    },
    scheduler_preflight: {
      generated_at: candidateReport.generated_at || null,
      candidate_count: asArray(candidateReport.candidates).length,
      clean_candidate_count: valid.length,
      selected_count: selected.length,
    },
    strict_dry_run: {
      generated_at: strictDryRunPlan.generated_at || null,
      verdict: clean(strictDryRunPlan.overall_verdict || strictDryRunPlan.verdict),
      summary: strictDryRunPlan.summary || {},
    },
    platform_upload_preflight: {
      generated_at: platformUploadPreflightReport.generated_at || null,
      verdict: clean(platformUploadPreflightReport.overall_verdict || platformUploadPreflightReport.verdict),
      summary: platformUploadPreflightReport.summary || {},
    },
    render_health: {
      generated_at: renderHealthReport.generated_at || null,
      summary: renderHealthReport.summary || null,
      bridge: renderHealthReport.bridge || renderHealthReport.bridge_health || null,
      live_db: renderHealthReport.live_db || renderHealthReport.live_db_health || null,
    },
    selected_restart_candidates: selected,
    rejected_restart_candidates: evaluated.filter((candidate) => !candidate.valid),
    operator_approval_checklist: approvalChecklist,
    guarded_dispatch_plan: guardedDispatchPlan,
    platform_deferred_actions: deferredActions,
    live_gate_change_plan_markdown: buildLiveGateChangePlan(liveState),
    post_restart_verification_checklist_markdown: buildPostRestartChecklist(),
    scheduled_task_cleanup_plan_markdown: buildScheduledTaskCleanupPlan(taskHygiene),
  };
  report.controlled_restart_pack_markdown = renderControlledRestartPackMarkdown(report);
  return report;
}

async function writeControlledRestartPack(report, { outputDir }) {
  await fs.ensureDir(outputDir);
  const artefacts = {};
  const write = async (name, value, isJson = true) => {
    const filePath = path.join(outputDir, name);
    if (isJson) await writeJson(filePath, value);
    else await fs.writeFile(filePath, value, "utf8");
    artefacts[name] = filePath;
  };
  await write("controlled_restart_pack.md", report.controlled_restart_pack_markdown, false);
  await write("controlled_restart_pack.json", report);
  await write("selected_restart_candidates.json", report.selected_restart_candidates || []);
  await write("operator_approval_checklist.md", report.operator_approval_checklist?.markdown || "", false);
  await write("guarded_dispatch_plan.json", report.guarded_dispatch_plan || {});
  await write("platform_deferred_actions.json", report.platform_deferred_actions || {});
  await write("live_gate_change_plan.md", report.live_gate_change_plan_markdown || "", false);
  await write("post_restart_verification_checklist.md", report.post_restart_verification_checklist_markdown || "", false);
  await write("scheduled_task_cleanup_plan.md", report.scheduled_task_cleanup_plan_markdown || "", false);
  return artefacts;
}

async function buildControlledRestartPackFromWorkspace({
  root = process.cwd(),
  outDir = path.join(process.cwd(), "output", "controlled-restart"),
  generatedAt = new Date().toISOString(),
  candidateLimit = 3,
} = {}) {
  const cwd = path.resolve(root);
  const output = path.join(cwd, "output", "goal-contract");
  const testOutput = path.join(cwd, "test", "output");
  const localUrl = `http://localhost:${process.env.PORT || "3001"}/api/health`;
  const publicUrl = healthUrl(process.env.LOCAL_PUBLIC_URL || process.env.PUBLIC_URL || "https://pulse.orryy.com");
  const report = buildControlledRestartPack({
    root: cwd,
    generatedAt,
    candidateLimit,
    candidateReport:
      readJsonIfExists(path.join(testOutput, "next_publish_candidates.json")) ||
      readJsonIfExists(path.join(output, "next_publish_candidates.json")) ||
      {},
    strictDryRunPlan: readJsonIfExists(path.join(output, "dry_run_publish_plan.json")) || {},
    storyPackages: readJsonIfExists(path.join(output, "production_cutover_story_packages.json")) || [],
    platformStatusMatrix: readJsonIfExists(path.join(output, "platform_status_matrix.json")) || {},
    platformUploadPreflightReport: readJsonIfExists(path.join(output, "platform_upload_preflight_report.json")) || {},
    renderHealthReport: readJsonIfExists(path.join(output, "render_health_report.json")) || {},
    publishReadinessReport:
      readJsonIfExists(path.join(testOutput, "publish_readiness.json")) ||
      readJsonIfExists(path.join(output, "publish_readiness_report.json")) ||
      {},
    guardedDispatchPreflight: readJsonIfExists(path.join(output, "guarded_dispatch_preflight_report.json")) || {},
    localRestartReadinessReport: readJsonIfExists(path.join(testOutput, "local_restart_readiness.json")) || {},
    repoStatus: currentRepoStatus(cwd),
    localHealth: await fetchHealth(localUrl),
    publicHealth: await fetchHealth(publicUrl),
  });
  const artefacts = await writeControlledRestartPack(report, { outputDir: path.resolve(cwd, outDir) });
  return { report, artefacts };
}

module.exports = {
  REQUIRED_ENABLED_PLATFORMS,
  DEFERRED_PLATFORMS,
  REQUIRED_OUTPUT_FILES,
  buildControlledRestartPack,
  buildControlledRestartPackFromWorkspace,
  renderControlledRestartPackMarkdown,
  validateCandidate,
  writeControlledRestartPack,
};
