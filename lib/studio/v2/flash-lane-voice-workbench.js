"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const brand = require("../../../brand");
const {
  buildFlashLaneProductionContract,
} = require("./flash-lane-production-contract");
const { buildFlashLaneNarrationPlan } = require("./flash-lane-preflight");
const {
  localVoiceHumanApproved,
  localVoiceReferenceStatus,
} = require("./approved-voice-path");
const { ffprobeDuration } = require("../media-acquisition");
const { resolveAcceptedLocalVoiceReference } = require("../sound-layer");

const ROOT = path.resolve(__dirname, "../../..");
const TEST_OUTPUT_ROOT = path.join(ROOT, "test", "output");

const DEFAULT_MIN_MEDIAN_PITCH_HZ = 85;
const DEFAULT_MAX_SILENCE_RATIO = 0.12;
const DEFAULT_MAX_CLIPPING_RATIO = 0.005;
const DEFAULT_TRUE_PEAK_CEILING_DB = -0.5;
const DEFAULT_MIN_LUFS = -30;
const DEFAULT_MAX_LUFS = -10;
const REQUIRED_SPOKEN_OUTRO = "Follow Pulse Gaming so you never miss a beat.";

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function numberOrNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function safeName(value, fallback = "item") {
  const out = String(value || fallback)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return out || fallback;
}

function isUnder(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertVoiceWorkbenchOutputRoot(outputRoot) {
  if (!isUnder(TEST_OUTPUT_ROOT, outputRoot)) {
    throw new Error("voice workbench output must stay under test/output");
  }
}

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function transcriptFromCandidate(candidate = {}) {
  if (typeof candidate.transcript === "string") return candidate.transcript;
  const alignment = candidate.alignment || candidate.timestamps?.alignment || candidate.timestamps;
  const chars = alignment?.characters || alignment?.alignment?.characters;
  if (Array.isArray(chars)) return chars.join("");
  return "";
}

function hasSpokenOutro(transcript) {
  const normalised = normaliseText(transcript);
  return normalised.includes("follow pulse gaming so you never miss a beat");
}

function scriptWithRequiredOutro(text, contract = {}) {
  const base = String(text || "").trim();
  if (contract?.script?.spoken_outro_required !== true || hasSpokenOutro(base)) return base;
  return `${base.replace(/[.\s]*$/, ".")} ${REQUIRED_SPOKEN_OUTRO}`.trim();
}

function isLocalVoiceCandidate(candidate = {}) {
  const provider = String(candidate.provider || "").toLowerCase();
  const source = String(candidate.source || "").toLowerCase();
  return (
    provider === "local" ||
    provider === "voxcpm" ||
    provider === "chatterbox" ||
    source.includes("local-production-voxcpm") ||
    source.includes("local-production-chatterbox")
  );
}

function localVoiceApproved(candidate = {}, env = process.env) {
  return localVoiceHumanApproved(candidate, env) && localVoiceReferenceStatus(candidate, env).approved;
}

function acousticValue(acoustic = {}, key, ...aliases) {
  return numberOrNull(acoustic[key], ...aliases.map((alias) => acoustic[alias]));
}

function evaluateAcousticProfile(acoustic, env = process.env) {
  const blockers = [];
  const warnings = [];
  if (!acoustic || typeof acoustic !== "object") {
    warnings.push("acoustic_profile_unverified");
    return { blockers, warnings, metrics: {} };
  }

  const minPitch = numberOrNull(env.STUDIO_FLASH_VOICE_MIN_MEDIAN_PITCH_HZ) || DEFAULT_MIN_MEDIAN_PITCH_HZ;
  const maxSilence = numberOrNull(env.STUDIO_FLASH_VOICE_MAX_SILENCE_RATIO) || DEFAULT_MAX_SILENCE_RATIO;
  const maxClipping = numberOrNull(env.STUDIO_FLASH_VOICE_MAX_CLIPPING_RATIO) || DEFAULT_MAX_CLIPPING_RATIO;
  const truePeakCeiling =
    numberOrNull(env.STUDIO_FLASH_VOICE_TRUE_PEAK_CEILING_DB) || DEFAULT_TRUE_PEAK_CEILING_DB;
  const minLufs = numberOrNull(env.STUDIO_FLASH_VOICE_MIN_LUFS) || DEFAULT_MIN_LUFS;
  const maxLufs = numberOrNull(env.STUDIO_FLASH_VOICE_MAX_LUFS) || DEFAULT_MAX_LUFS;

  const medianPitchHz = acousticValue(
    acoustic,
    "medianPitchHz",
    acoustic.meanPitchHz,
    acoustic.pitchHz,
    acoustic.f0MedianHz,
  );
  const integratedLufs = acousticValue(acoustic, "integratedLufs", acoustic.lufs);
  const truePeakDb = acousticValue(acoustic, "truePeakDb", acoustic.peakDb);
  const silenceRatio = acousticValue(acoustic, "silenceRatio");
  const clippingRatio = acousticValue(acoustic, "clippingRatio");

  if (medianPitchHz === null) {
    warnings.push("pitch_profile_unverified");
  } else if (medianPitchHz < minPitch) {
    blockers.push("demonic_low_voice_risk");
  }

  if (integratedLufs === null) {
    warnings.push("loudness_unverified");
  } else if (integratedLufs < minLufs) {
    blockers.push("voice_too_quiet");
  } else if (integratedLufs > maxLufs) {
    warnings.push("voice_loudness_hot");
  }

  if (truePeakDb !== null && truePeakDb > truePeakCeiling) {
    blockers.push("audio_clipping_risk");
  }
  if (clippingRatio !== null && clippingRatio > maxClipping) {
    blockers.push("audio_clipping_risk");
  }
  if (silenceRatio !== null && silenceRatio > maxSilence) {
    blockers.push("excessive_silence");
  }

  return {
    blockers: unique(blockers),
    warnings: unique(warnings),
    metrics: {
      medianPitchHz,
      integratedLufs,
      truePeakDb,
      silenceRatio,
      clippingRatio,
      thresholds: {
        minPitchHz: minPitch,
        maxSilenceRatio: maxSilence,
        maxClippingRatio: maxClipping,
        truePeakCeilingDb: truePeakCeiling,
        minLufs,
        maxLufs,
      },
    },
  };
}

function evaluateVoiceCandidate({
  story,
  candidate = {},
  contract = null,
  env = process.env,
} = {}) {
  const builtContract = contract || buildFlashLaneProductionContract({ story, env });
  const transcript = transcriptFromCandidate(candidate);
  const scriptWordCount = Number(
    (transcript ? wordCount(transcript) : null) ||
      builtContract?.script?.word_count ||
      wordCount(story?.full_script || story?.body || ""),
  );
  const durationS = numberOrNull(candidate.durationS, candidate.duration_seconds, candidate.duration);
  const narrationPlan = buildFlashLaneNarrationPlan({
    scriptWordCount,
    narrationDurationS: durationS,
  });
  const blockers = [...(narrationPlan.issues || [])];
  const warnings = [];

  if (durationS === null) blockers.push("audio_duration_unknown");
  if (!candidate.path && !candidate.audioPath) warnings.push("audio_path_missing_or_virtual");
  if (
    narrationPlan.spokenWpm !== null &&
    narrationPlan.spokenWpm < narrationPlan.idealWpmRange[0]
  ) {
    warnings.push("spoken_pace_below_flash_lane_ideal");
  }
  if (
    narrationPlan.spokenWpm !== null &&
    narrationPlan.spokenWpm > narrationPlan.idealWpmRange[1]
  ) {
    warnings.push("spoken_pace_above_flash_lane_ideal");
  }

  const acoustic = evaluateAcousticProfile(candidate.acoustic || candidate.acousticProfile, env);
  blockers.push(...acoustic.blockers);
  warnings.push(...acoustic.warnings);

  if (transcript) {
    if (!hasSpokenOutro(transcript)) blockers.push("spoken_outro_missing");
  } else {
    warnings.push("spoken_outro_unverified");
  }

  const localVoice = isLocalVoiceCandidate(candidate);
  const localReference = localVoice
    ? localVoiceReferenceStatus(candidate, env)
    : null;
  const humanApproved = localVoice
    ? localVoiceHumanApproved(candidate, env)
    : null;
  if (localVoice && !localVoiceApproved(candidate, env)) {
    if (!humanApproved) warnings.push("local_voice_requires_human_approval");
    if (humanApproved && !localReference.approved) warnings.push(localReference.blocker);
  }

  const cleanBlockers = unique(blockers);
  const cleanWarnings = unique(warnings);
  let verdict = "approved_for_flash_lane_preflight";
  if (cleanBlockers.length > 0) {
    verdict = "rejected";
  } else if (cleanWarnings.length > 0) {
    verdict = "needs_human_voice_review";
  }

  return {
    id: candidate.id || candidate.name || candidate.path || "candidate",
    provider: candidate.provider || "unknown",
    source: candidate.source || "unknown",
    path: candidate.path || candidate.audioPath || null,
    durationS,
    word_count: scriptWordCount,
    spoken_wpm: narrationPlan.spokenWpm,
    verdict,
    pilot_allowed: verdict === "approved_for_flash_lane_preflight",
    blockers: cleanBlockers,
    warnings: cleanWarnings,
    narration_plan: narrationPlan,
    acoustic: acoustic.metrics,
    transcript: {
      present: Boolean(transcript),
      spoken_outro_present: transcript ? hasSpokenOutro(transcript) : null,
    },
    approval: {
      local_voice: localVoice,
      local_voice_approved: localVoiceApproved(candidate, env),
      local_voice_human_approved: humanApproved,
      local_voice_reference_approved: localReference?.approved ?? null,
      acceptedLocalVoice: localReference?.reference ?? null,
    },
  };
}

function candidateRank(candidate) {
  if (candidate.verdict === "approved_for_flash_lane_preflight") return 300;
  if (candidate.verdict === "needs_human_voice_review") return 200 - candidate.warnings.length;
  return 100 - candidate.blockers.length * 10;
}

function buildGenerationPlan({ dryRun = true, story, contract } = {}) {
  const willCallLocalTts = dryRun === false;
  return {
    dry_run: !willCallLocalTts,
    calls_tts: willCallLocalTts,
    local_only: true,
    local_engines: ["voxcpm2", "chatterbox"],
    external_reference: {
      provider: "elevenlabs",
      calls_external_api: false,
      purpose: "baseline comparison only when existing/cached audio is supplied",
    },
    story_id: story?.id || null,
    required_script_words: contract?.narration_plan?.targetWordRange || null,
    target_runtime_seconds: contract?.runtime_target_seconds || { min: 61, max: 75 },
    candidate_outputs_under: "test/output/flash-lane-voice-workbench",
    next_step:
      contract?.next_action === "generate_approved_flash_lane_voice"
        ? "generate_or_supply_61_to_75_second_voice_candidates"
        : contract?.next_action || "fix_flash_lane_script_before_voice",
  };
}

function localEngineSource(engine) {
  const normalised = String(engine || "voxcpm2").toLowerCase();
  return normalised.includes("chatterbox")
    ? "local-production-chatterbox-path"
    : "local-production-voxcpm-path";
}

function transcriptFromAlignment(alignment) {
  const chars = alignment?.characters || alignment?.alignment?.characters;
  return Array.isArray(chars) ? chars.join("") : "";
}

async function generateLocalVoiceCandidate({
  story,
  outputRoot = path.join(TEST_OUTPUT_ROOT, "flash-lane-voice-workbench"),
  applyLocal = false,
  engine = "voxcpm2",
  rate = 1.0,
  baseUrl = process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765",
  voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "__default__",
  approvedLocalVoice = false,
  fetchImpl = fetch,
  durationProbe = ffprobeDuration,
  acousticProbe = () => null,
  postProcessAudio = null,
  env = process.env,
} = {}) {
  const resolvedOutputRoot = path.resolve(outputRoot);
  const contract = buildFlashLaneProductionContract({ story, env });
  const text = scriptWithRequiredOutro(
    contract?.script?.script_for_tts || story?.full_script || story?.body || "",
    contract,
  );
  const request = {
    engine,
    rate: Number(rate),
    voiceId,
    baseUrl,
    story_id: story?.id || null,
    text_words: wordCount(text),
    output_root: resolvedOutputRoot,
  };

  if (applyLocal !== true) {
    return {
      status: "would_generate",
      request,
      candidate: null,
      safety: {
        calls_tts: false,
        local_only: true,
        output_under_test_output: isUnder(TEST_OUTPUT_ROOT, resolvedOutputRoot),
      },
    };
  }

  assertVoiceWorkbenchOutputRoot(resolvedOutputRoot);
  await fs.ensureDir(resolvedOutputRoot);
  const stem = `${safeName(story?.id || "story")}_${safeName(engine)}_${String(rate).replace(/[^0-9]+/g, "_")}`;
  const audioPath = path.join(resolvedOutputRoot, `${stem}.mp3`);
  const rawAudioPath = postProcessAudio ? path.join(resolvedOutputRoot, `${stem}_raw.mp3`) : audioPath;
  const timestampsPath = path.join(resolvedOutputRoot, `${stem}_timestamps.json`);

  const response = await fetchImpl(
    `${String(baseUrl).replace(/\/+$/, "")}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        output_format: "mp3_44100_128",
        engine,
        voice_settings: {
          speaking_rate: Number(rate),
        },
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.detail || `local TTS returned HTTP ${response.status}`);
  }
  if (!body.audio_base64) {
    throw new Error("local TTS returned no audio_base64");
  }

  await fs.writeFile(rawAudioPath, Buffer.from(body.audio_base64, "base64"));
  let audioPostProcess = null;
  if (postProcessAudio) {
    audioPostProcess = await postProcessAudio({ inputPath: rawAudioPath, outputPath: audioPath });
  }
  await fs.writeJson(timestampsPath, body.alignment || {}, { spaces: 2 });

  const durationS = durationProbe ? durationProbe(audioPath) : null;
  const acoustic = acousticProbe ? acousticProbe(audioPath) : null;
  const source = localEngineSource(engine);
  const acceptedLocalVoice = resolveAcceptedLocalVoiceReference(env);
  return {
    status: "generated",
    request,
    candidate: {
      id: stem,
      provider: "local",
      source,
      path: audioPath,
      timestampsPath,
      durationS,
      transcript: transcriptFromAlignment(body.alignment || {}),
      acoustic,
      approvedLocalVoice:
        bool(approvedLocalVoice) || bool(env.STUDIO_V2_LOCAL_VOICE_APPROVED),
      acceptedLocalVoice,
      generation: {
        local_only: true,
        engine,
        rate: Number(rate),
        output_under_test_output: true,
        raw_path: rawAudioPath,
        audio_post_process: audioPostProcess,
      },
    },
  };
}

function buildFlashLaneVoiceWorkbench({
  story,
  candidates = [],
  dryRun = true,
  env = process.env,
  now = new Date().toISOString(),
} = {}) {
  const callsLocalTts = dryRun === false;
  const contract = buildFlashLaneProductionContract({ story, env });
  const evaluated = (Array.isArray(candidates) ? candidates : []).map((candidate) =>
    evaluateVoiceCandidate({ story, candidate, contract, env }),
  );
  const selected =
    evaluated
      .filter((candidate) => candidate.pilot_allowed)
      .sort((a, b) => candidateRank(b) - candidateRank(a))[0] || null;
  const bestReview =
    evaluated
      .filter((candidate) => candidate.verdict === "needs_human_voice_review")
      .sort((a, b) => candidateRank(b) - candidateRank(a))[0] || null;

  let verdict = "needs_voice_candidates";
  if (selected) verdict = "candidate_ready";
  else if (bestReview) verdict = "needs_human_voice_review";
  else if (evaluated.length > 0) verdict = "all_candidates_rejected";

  return {
    schema_version: 1,
    generated_at: now,
    story_id: story?.id || null,
    title: story?.title || null,
    verdict,
    selected_candidate: selected,
    review_candidate: selected ? null : bestReview,
    candidates: evaluated,
    flash_lane_contract: contract,
    generation_plan: buildGenerationPlan({ dryRun, story, contract }),
    safety: {
      local_only: true,
      report_only: !callsLocalTts,
      calls_tts: callsLocalTts,
      renders_video: false,
      posts_to_platforms: false,
      mutates_production_db: false,
      mutates_railway: false,
      triggers_oauth: false,
      switches_production_voice: false,
    },
  };
}

function renderFlashLaneVoiceWorkbenchMarkdown(report = {}) {
  const lines = [];
  lines.push("# Flash Lane Voice Workbench v1");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Story: ${report.story_id || "unknown"}`);
  lines.push(`Title: ${report.title || "Untitled"}`);
  lines.push(`Verdict: ${report.verdict || "unknown"}`);
  lines.push(
    `Selected: ${report.selected_candidate?.id || report.review_candidate?.id || "none"}`,
  );
  lines.push("");
  lines.push("## Candidates");
  lines.push("");
  lines.push("| id | provider | verdict | pilot | duration | wpm | blockers | warnings |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | --- | --- |");
  for (const candidate of report.candidates || []) {
    lines.push(
      [
        candidate.id,
        candidate.provider,
        candidate.verdict,
        candidate.pilot_allowed ? "yes" : "no",
        candidate.durationS ?? "",
        candidate.spoken_wpm ?? "",
        candidate.blockers.join(", ") || "none",
        candidate.warnings.join(", ") || "none",
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  if (!report.candidates?.length) lines.push("| none | n/a | needs_voice_candidates | no |  |  | none | none |");
  lines.push("");
  lines.push("## Generation Plan");
  lines.push("");
  lines.push(`- dry-run: ${report.generation_plan?.dry_run === true}`);
  lines.push(`- calls TTS: ${report.generation_plan?.calls_tts === true}`);
  lines.push(`- local engines: ${(report.generation_plan?.local_engines || []).join(", ") || "none"}`);
  lines.push(`- next step: ${report.generation_plan?.next_step || "unknown"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- No Railway, OAuth, production DB or posting actions are performed.");
  lines.push("- No production voice or renderer defaults are switched.");
  lines.push("- Local voice candidates still require explicit human approval before pilot proof use.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildFlashLaneVoiceWorkbench,
  buildGenerationPlan,
  evaluateVoiceCandidate,
  evaluateAcousticProfile,
  generateLocalVoiceCandidate,
  hasSpokenOutro,
  scriptWithRequiredOutro,
  renderFlashLaneVoiceWorkbenchMarkdown,
};
