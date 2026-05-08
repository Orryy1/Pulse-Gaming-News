"use strict";

const path = require("node:path");
const { generateLocalVoiceCandidate } = require("./flash-lane-voice-workbench");

const EXPECTED_LOCAL_VOICE_REFERENCE_ID = "pulse-sleepy-liam-20260502";
const ROOT = path.resolve(__dirname, "../../..");
const TEST_OUTPUT_ROOT = path.join(ROOT, "test", "output");

const DEFAULT_TRANSCRIPTS = [
  {
    id: "prices",
    label: "Price shock",
    style: "urgent_news",
    text:
      "GTA 6 still has no confirmed price, but Take-Two says value has to feel reasonable. That matters because one bad price reveal can dominate the entire launch conversation.",
    pronunciation_watchlist: ["GTA 6", "Take-Two"],
  },
  {
    id: "game_titles",
    label: "Game title stress test",
    style: "flash_news",
    text:
      "Pokémon, BioShock, Red Dead Redemption, S.T.A.L.K.E.R. 2, Final Fantasy 14 and The Elder Scrolls all need clean pronunciation in one take.",
    pronunciation_watchlist: [
      "Pokémon",
      "BioShock",
      "Red Dead Redemption",
      "S.T.A.L.K.E.R. 2",
      "Final Fantasy 14",
      "The Elder Scrolls",
    ],
  },
  {
    id: "acronyms",
    label: "Gaming acronyms",
    style: "technical_news",
    text:
      "Triple A budgets, MMORPG updates, DLC roadmaps, FPS performance, RPG balance, GPU requirements and PSVR2 discounts should sound clear, not robotic.",
    pronunciation_watchlist: ["AAA", "MMORPG", "DLC", "FPS", "RPG", "GPU", "PSVR2"],
  },
  {
    id: "urgent_news",
    label: "Urgent short hook",
    style: "high_energy_short",
    text:
      "Wait, this is bigger than it looks. Nintendo just confirmed a Switch 2 detail players were not expecting, and it changes the launch conversation immediately.",
    pronunciation_watchlist: ["Nintendo", "Switch 2"],
  },
  {
    id: "calm_analysis",
    label: "Briefing analysis",
    style: "mini_documentary",
    text:
      "The bigger story is not one patch note. It is the pattern: publishers are testing higher prices, slower reveals and longer marketing cycles before players get firm answers.",
    pronunciation_watchlist: ["publishers"],
  },
  {
    id: "outro",
    label: "Pulse outro",
    style: "cta",
    text: "Follow Pulse Gaming so you never miss a beat.",
    pronunciation_watchlist: ["Pulse Gaming"],
  },
];

const MODEL_CATALOGUE = [
  {
    id: "elevenlabs_production_baseline",
    label: "ElevenLabs production baseline",
    provider: "elevenlabs",
    generationMode: "external_paid_disabled_by_default",
    external: true,
    paid: true,
  },
  {
    id: "local_liam_current",
    label: "Local Liam current path",
    provider: "local_liam",
    generationMode: "local_only_when_tts_ready",
    external: false,
    paid: false,
  },
  {
    id: "chatterbox_local",
    label: "Chatterbox local",
    provider: "chatterbox",
    generationMode: "local_optional_if_installed",
    external: false,
    paid: false,
  },
  {
    id: "indextts2_local",
    label: "IndexTTS2 local",
    provider: "indextts2",
    generationMode: "setup_required",
    external: false,
    paid: false,
  },
  {
    id: "fish_local_or_api",
    label: "Fish",
    provider: "fish",
    generationMode: "setup_required_external_disabled",
    external: true,
    paid: true,
  },
  {
    id: "kokoro_fast_baseline",
    label: "Kokoro fast baseline",
    provider: "kokoro",
    generationMode: "local_optional_if_installed",
    external: false,
    paid: false,
  },
];

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeName(value, fallback = "item") {
  const out = String(value || fallback)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return out || fallback;
}

function isUnder(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertVoiceShootoutOutputRoot(outputRoot) {
  if (!isUnder(TEST_OUTPUT_ROOT, outputRoot)) {
    throw new Error("voice shootout local generation output must stay under test/output");
  }
}

function valueLooksReady(value) {
  return (
    value === true ||
    /^(green|ok|ready|true|1|yes)$/i.test(String(value || "").trim())
  );
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function voiceReferenceId(source = {}) {
  const voice = source.voice || {};
  return firstPresent(
    voice.accepted_reference_id,
    voice.acceptedReferenceId,
    voice.reference?.id,
    voice.referenceId,
    source.expected_local_voice_id,
    source.expectedLocalVoiceId,
  );
}

function voiceLoaded(source = {}) {
  const voice = source.voice || {};
  return (
    voice.loaded === true ||
    voice.present === true ||
    voice.referencePresent === true ||
    voice.reference_present === true ||
    voice.reference?.referencePresent === true
  );
}

function voiceReferenceResolved(source = {}) {
  const voice = source.voice || {};
  return (
    voice.refResolved === true ||
    voice.ref_resolved === true ||
    voice.referencePresent === true ||
    voice.reference_present === true ||
    voice.reference?.referencePresent === true
  );
}

function sourceReady(source = {}) {
  return (
    valueLooksReady(source.verdict) ||
    valueLooksReady(source.status) ||
    valueLooksReady(source.phase) ||
    source.ok === true ||
    source.ready === true ||
    source.local_ready === true
  );
}

function localVoiceReadyStatus(localTtsDoctorReport = {}) {
  const sources = [
    localTtsDoctorReport,
    localTtsDoctorReport.before,
    localTtsDoctorReport.after,
    localTtsDoctorReport.summary,
    localTtsDoctorReport.queue?.local_tts,
    localTtsDoctorReport.doctor,
    localTtsDoctorReport.overnightReport,
    localTtsDoctorReport.overnightReport?.doctor,
    localTtsDoctorReport.overnightReport?.queue?.local_tts,
  ].filter(Boolean);

  for (const source of sources) {
    const refId = voiceReferenceId({
      ...source,
      expected_local_voice_id:
        source.expected_local_voice_id || localTtsDoctorReport.expected_local_voice_id,
    });
    const acceptedReference =
      refId === EXPECTED_LOCAL_VOICE_REFERENCE_ID ||
      refId === localTtsDoctorReport.expected_local_voice_id;
    if (
      sourceReady(source) &&
      voiceLoaded(source) &&
      voiceReferenceResolved(source) &&
      acceptedReference
    ) {
      return {
        ready: true,
        reason: "accepted_local_liam_reference_ready",
        referenceId: refId,
      };
    }
  }

  return {
    ready: false,
    reason: "accepted_local_liam_reference_not_verified",
    referenceId: firstPresent(...sources.map(voiceReferenceId)) || null,
  };
}

function localTtsReady(localTtsDoctorReport = {}) {
  return localVoiceReadyStatus(localTtsDoctorReport).ready;
}

function modelSetupStatus(model, { env = process.env, localTtsDoctorReport = {} } = {}) {
  if (model.id === "elevenlabs_production_baseline") {
    const configured = Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID);
    return configured
      ? "configured_external_paid_locked"
      : "missing_credentials_external_paid_locked";
  }
  if (model.id === "local_liam_current") {
    return localTtsReady(localTtsDoctorReport)
      ? "ready_for_local_proof"
      : "local_tts_voice_not_verified";
  }
  if (model.id === "chatterbox_local") {
    return /chatterbox/i.test(String(env.LOCAL_TTS_ENGINE || env.STUDIO_V2_LOCAL_TTS_ENGINE || ""))
      ? "configured_in_local_tts_engine"
      : "not_detected_optional_setup";
  }
  if (model.id === "kokoro_fast_baseline") {
    return truthy(env.KOKORO_TTS_ENABLED) ? "configured_optional" : "not_detected_optional_setup";
  }
  if (model.id === "indextts2_local") {
    return truthy(env.INDEXTTS2_ENABLED) ? "configured_optional" : "not_detected_setup_required";
  }
  if (model.id === "fish_local_or_api") {
    return truthy(env.FISH_TTS_ENABLED) ? "configured_external_locked" : "not_detected_external_locked";
  }
  return "unknown";
}

function buildBenchmarkManifest({
  generatedAt = new Date().toISOString(),
  transcripts = DEFAULT_TRANSCRIPTS,
  env = process.env,
  localTtsDoctorReport = {},
  samples = [],
} = {}) {
  const models = MODEL_CATALOGUE.map((model) => ({
    ...model,
    setupStatus: modelSetupStatus(model, { env, localTtsDoctorReport }),
    allowedTonight: false,
    approvalRequired:
      model.external === true || model.paid === true || model.id === "elevenlabs_production_baseline",
  })).map((model) => ({
    ...model,
    allowedTonight:
      model.external === false &&
      (model.setupStatus.startsWith("ready_") || model.setupStatus.startsWith("configured_")),
  }));
  return {
    schemaVersion: 1,
    generatedAt,
    mode: "voice_shootout_framework",
    transcripts,
    models,
    samples,
    audioQa: {
      duration_seconds: "measured_when_samples_exist",
      words_per_minute: "measured_when_samples_exist",
      silence_ratio: "planned_until_probe_supports_metric",
      clipping_ratio: "planned_until_probe_supports_metric",
      loudness_lufs: "measured_when_samples_exist",
      true_peak_db: "measured_when_samples_exist",
      median_pitch_hz: "measured_when_samples_exist",
      timestamp_viability: "requires_alignment_sidecar",
      pronunciation_watchlist: "manual_review_required",
    },
    rightsNotes: [
      "Use only Martin-owned or explicitly licensed reference voice material.",
      "Do not upload private voice samples to unknown services.",
      "Do not fine-tune, redistribute or publish model weights from this framework.",
      "ElevenLabs is baseline evidence only unless paid API use is explicitly approved.",
    ],
    safety: {
      callsExternalApis: false,
      spendsPaidCredits: false,
      switchesProductionVoice: false,
      writesProductionDb: false,
      postsToPlatforms: false,
    },
  };
}

function anonymousLabel(index) {
  return `voice_${String(index + 1).padStart(2, "0")}`;
}

function sampleKey(modelId, transcriptId) {
  return `${modelId}::${transcriptId}`;
}

function deterministicScore(value, seed = "pulse-voice") {
  const text = `${seed}:${value}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededSort(rows, seed) {
  return rows
    .map((row) => ({ row, score: deterministicScore(row.anonymousId, seed) }))
    .sort((a, b) => a.score - b.score)
    .map((item) => item.row);
}

function buildBlindReviewPack(manifest = {}, { seed = "pulse-voice-shootout" } = {}) {
  const samples = new Map(
    (manifest.samples || []).map((sample) => [
      sampleKey(sample.modelId, sample.transcriptId),
      sample,
    ]),
  );
  const rows = [];
  const privateMap = [];
  let index = 0;
  for (const model of manifest.models || []) {
    for (const transcript of manifest.transcripts || []) {
      const anonymousId = anonymousLabel(index++);
      const sample = samples.get(sampleKey(model.id, transcript.id));
      const sampleStatus = sample ? "generated" : model.allowedTonight ? "not_generated" : "blocked";
      const fileName = `${anonymousId}_${transcript.id}.mp3`;
      if (sampleStatus === "generated") {
        rows.push({
          anonymousId,
          transcriptId: transcript.id,
          fileName,
          style: transcript.style,
          sampleStatus,
          reviewFields: [
            "energy_1_to_5",
            "clarity_1_to_5",
            "pronunciation_1_to_5",
            "naturalness_1_to_5",
            "production_fit_1_to_5",
            "notes",
          ],
        });
      }
      privateMap.push({
        anonymousId,
        modelId: model.id,
        transcriptId: transcript.id,
        fileName,
        sourceFile: sample?.filePath || sample?.path || null,
        sampleStatus,
      });
    }
  }
  return {
    publicRows: seededSort(rows, seed),
    privateMap,
    note:
      "Share only generated publicRows for blind listening. Keep privateMap inside local reports until the review is complete.",
  };
}

function buildVoiceShootoutReport({
  generatedAt = new Date().toISOString(),
  env = process.env,
  localTtsDoctorReport = {},
  samples = [],
  localGeneration = null,
} = {}) {
  const manifest = buildBenchmarkManifest({
    generatedAt,
    env,
    localTtsDoctorReport,
    samples,
  });
  const blindReviewPack = buildBlindReviewPack(manifest);
  const readyModels = manifest.models.filter((model) => model.allowedTonight);
  const blockedModels = manifest.models.filter((model) => !model.allowedTonight);
  const verdict = readyModels.length ? "AMBER_READY_FOR_LOCAL_BENCHMARKS" : "RED_NO_LOCAL_MODEL_READY";
  return {
    schemaVersion: 1,
    generatedAt,
    verdict,
    benchmarkManifest: manifest,
    blindReviewPack,
    localVoiceReadyStatus: localVoiceReadyStatus(localTtsDoctorReport),
    localGeneration,
    modelSetupStatus: manifest.models.map((model) => ({
      id: model.id,
      label: model.label,
      setupStatus: model.setupStatus,
      allowedTonight: model.allowedTonight,
      approvalRequired: model.approvalRequired,
    })),
    readyModels: readyModels.map((model) => model.id),
    blockedModels: blockedModels.map((model) => ({
      id: model.id,
      setupStatus: model.setupStatus,
    })),
    nextActions: [
      "Run local Liam against the benchmark scripts when a proof batch is needed.",
      "Use the same transcript set for ElevenLabs, Chatterbox, IndexTTS2, Fish and Kokoro comparisons.",
      "Do not call paid or external providers until a small capped shootout is approved.",
      "Use the blind review sheet before changing any production voice default.",
    ],
  };
}

function transcriptStory(transcript = {}) {
  return {
    id: `voice_shootout_${safeName(transcript.id || "transcript")}`,
    title: transcript.label || transcript.id || "Voice shootout benchmark",
    full_script: transcript.text || "",
    hook: transcript.text || "",
    source_type: "fixture",
  };
}

function localLiamVoiceId({ env = process.env, voiceId = null, localTtsDoctorReport = {} } = {}) {
  const doctorVoice =
    localTtsDoctorReport.voice_id ||
    localTtsDoctorReport.before?.voice?.voiceId ||
    localTtsDoctorReport.before?.voice?.voice_id ||
    localTtsDoctorReport.after?.voice?.voiceId ||
    localTtsDoctorReport.after?.voice?.voice_id ||
    localTtsDoctorReport.overnightReport?.doctor?.voice?.voiceId ||
    localTtsDoctorReport.overnightReport?.queue?.local_tts?.voice?.voiceId ||
    localTtsDoctorReport.overnightReport?.queue?.local_tts?.voice?.voice_id;
  return (
    voiceId ||
    doctorVoice ||
    env.LOCAL_TTS_VOICE_ID ||
    env.STUDIO_V2_LOCAL_TTS_VOICE_ID ||
    env.PULSE_LOCAL_TTS_VOICE_ID ||
    "TX3LPaxmHKxFdv7VOQHJ"
  );
}

function buildLocalLiamSample({
  transcript,
  result,
  modelId = "local_liam_current",
  status = null,
  error = null,
} = {}) {
  const candidate = result?.candidate || {};
  const durationS = numberOrNull(candidate.durationS, candidate.duration_seconds);
  return {
    modelId,
    transcriptId: transcript.id,
    filePath: candidate.path || result?.request?.output_path || null,
    timestampsPath: candidate.timestampsPath || null,
    durationS,
    provider: "local",
    source: candidate.source || "local-production-voice-shootout",
    status: status || result?.status || "unknown",
    acoustic: candidate.acoustic || null,
  };
}

async function generateLocalLiamBenchmarkSamples({
  transcripts = DEFAULT_TRANSCRIPTS,
  localTtsDoctorReport = {},
  outputRoot = path.join(TEST_OUTPUT_ROOT, "voice-shootout", "audio"),
  applyLocal = false,
  engine = "voxcpm2",
  rate = 1.0,
  baseUrl = process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765",
  voiceId = null,
  approvedLocalVoice = true,
  limit = null,
  env = process.env,
  fetchImpl = fetch,
  durationProbe,
  acousticProbe,
  generator = generateLocalVoiceCandidate,
} = {}) {
  const resolvedOutputRoot = path.resolve(outputRoot);
  assertVoiceShootoutOutputRoot(resolvedOutputRoot);
  const selectedTranscripts = (transcripts || []).slice(
    0,
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : undefined,
  );
  const readiness = localVoiceReadyStatus(localTtsDoctorReport);
  const samples = [];
  const results = [];
  const shouldCallTts = applyLocal === true;
  const generation = {
    schemaVersion: 1,
    mode: shouldCallTts ? "apply_local" : "dry_run",
    modelId: "local_liam_current",
    generatedAt: new Date().toISOString(),
    outputRoot: resolvedOutputRoot,
    localOnly: true,
    outputUnderTestOutput: true,
    callsExternalApis: false,
    spendsPaidCredits: false,
    switchesProductionVoice: false,
    applyLocal: shouldCallTts,
    engine,
    rate: Number(rate),
    baseUrl,
    voiceId: localLiamVoiceId({ env, voiceId, localTtsDoctorReport }),
    localVoiceReadyStatus: readiness,
    results,
  };

  if (!readiness.ready) {
    generation.status = "blocked";
    generation.reason = "accepted_local_liam_reference_not_verified";
    for (const transcript of selectedTranscripts) {
      results.push({
        transcriptId: transcript.id,
        status: "blocked",
        reason: generation.reason,
      });
    }
    return { ...generation, samples };
  }

  generation.status = shouldCallTts ? "generating" : "would_generate";
  for (const transcript of selectedTranscripts) {
    try {
      const story = transcriptStory(transcript);
      const result = await generator({
        story,
        outputRoot: resolvedOutputRoot,
        applyLocal: shouldCallTts,
        engine,
        rate,
        baseUrl,
        voiceId: generation.voiceId,
        approvedLocalVoice,
        fetchImpl,
        durationProbe,
        acousticProbe,
        env,
      });
      const row = {
        transcriptId: transcript.id,
        status: shouldCallTts ? result.status : "would_generate",
        request: result.request,
        filePath: result.candidate?.path || null,
        timestampsPath: result.candidate?.timestampsPath || null,
        durationS: numberOrNull(result.candidate?.durationS),
      };
      results.push(row);
      if (shouldCallTts && result.status === "generated" && result.candidate?.path) {
        samples.push(buildLocalLiamSample({ transcript, result, status: "generated" }));
      }
    } catch (err) {
      results.push({
        transcriptId: transcript.id,
        status: "failed",
        reason: err.message || String(err),
      });
    }
  }
  generation.status = shouldCallTts
    ? samples.length > 0
      ? "generated"
      : "failed"
    : "would_generate";
  generation.generatedSamples = samples.length;
  generation.samples = samples;
  return generation;
}

function renderVoiceReviewSheet(pack = {}) {
  const lines = [];
  lines.push("# Voice Blind Review Sheet");
  lines.push("");
  lines.push("Score each item from 1 to 5. Do not reveal the model names until after scoring.");
  lines.push("");
  lines.push("| anonymous id | transcript | file | energy | clarity | pronunciation | naturalness | production fit | notes |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of pack.publicRows || []) {
    lines.push(
      `| ${row.anonymousId} | ${row.transcriptId} | ${row.fileName} |  |  |  |  |  |  |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderVoiceShootoutMarkdown(report = {}) {
  const lines = [];
  lines.push("# Voice Shootout Overnight Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt || "unknown"}`);
  lines.push(`Verdict: ${report.verdict || "unknown"}`);
  lines.push("");
  lines.push("## Model Setup Status");
  for (const model of report.modelSetupStatus || []) {
    lines.push(
      `- ${model.id}: ${model.setupStatus}; allowed tonight=${model.allowedTonight}; approval required=${model.approvalRequired}`,
    );
  }
  lines.push("");
  lines.push("## Benchmark Scripts");
  for (const script of report.benchmarkManifest?.transcripts || []) {
    lines.push(
      `- ${script.id}: ${script.label} (${script.style}) watch=${script.pronunciation_watchlist.join(", ")}`,
    );
  }
  lines.push("");
  lines.push("## Audio QA");
  for (const [key, enabled] of Object.entries(report.benchmarkManifest?.audioQa || {})) {
    lines.push(`- ${key}: ${enabled}`);
  }
  lines.push("");
  lines.push("## Blind Review");
  lines.push(`- public rows: ${report.blindReviewPack?.publicRows?.length || 0}`);
  const pendingRows = (report.blindReviewPack?.privateMap || []).filter(
    (row) => row.sampleStatus !== "generated",
  ).length;
  lines.push(`- pending or blocked rows: ${pendingRows}`);
  lines.push("- private model map is kept in JSON only and should not be shared before scoring.");
  if (report.localGeneration) {
    lines.push("");
    lines.push("## Local Liam Generation");
    lines.push(`- mode: ${report.localGeneration.mode || "unknown"}`);
    lines.push(`- status: ${report.localGeneration.status || "unknown"}`);
    lines.push(`- output: ${report.localGeneration.outputRoot || "unknown"}`);
    lines.push(`- generated samples: ${report.localGeneration.generatedSamples || 0}`);
    lines.push(`- calls external APIs: ${report.localGeneration.callsExternalApis === true}`);
    lines.push(`- switches production voice: ${report.localGeneration.switchesProductionVoice === true}`);
  }
  lines.push("");
  lines.push("## Safety");
  for (const [key, value] of Object.entries(report.benchmarkManifest?.safety || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Next Actions");
  for (const action of report.nextActions || []) lines.push(`- ${action}`);
  return `${lines.join("\n")}\n`;
}

module.exports = {
  DEFAULT_TRANSCRIPTS,
  EXPECTED_LOCAL_VOICE_REFERENCE_ID,
  MODEL_CATALOGUE,
  buildBenchmarkManifest,
  buildBlindReviewPack,
  buildVoiceShootoutReport,
  generateLocalLiamBenchmarkSamples,
  localVoiceReadyStatus,
  localTtsReady,
  renderVoiceReviewSheet,
  renderVoiceShootoutMarkdown,
};
