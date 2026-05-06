"use strict";

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

function localTtsReady(localTtsDoctorReport = {}) {
  return (
    localTtsDoctorReport?.verdict === "green" ||
    localTtsDoctorReport?.after?.ready === true ||
    localTtsDoctorReport?.before?.ready === true ||
    localTtsDoctorReport?.summary?.ready === true
  );
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
      : "local_tts_not_ready";
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
    audioQa: {
      duration_seconds: true,
      words_per_minute: true,
      silence_ratio: true,
      clipping_ratio: true,
      loudness_lufs: true,
      true_peak_db: true,
      median_pitch_hz: true,
      timestamp_viability: true,
      pronunciation_watchlist: true,
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

function buildBlindReviewPack(manifest = {}) {
  const rows = [];
  const privateMap = [];
  let index = 0;
  for (const model of manifest.models || []) {
    for (const transcript of manifest.transcripts || []) {
      const anonymousId = anonymousLabel(index++);
      const fileName = `${anonymousId}_${transcript.id}.mp3`;
      rows.push({
        anonymousId,
        transcriptId: transcript.id,
        fileName,
        style: transcript.style,
        reviewFields: [
          "energy_1_to_5",
          "clarity_1_to_5",
          "pronunciation_1_to_5",
          "naturalness_1_to_5",
          "production_fit_1_to_5",
          "notes",
        ],
      });
      privateMap.push({
        anonymousId,
        modelId: model.id,
        transcriptId: transcript.id,
        fileName,
      });
    }
  }
  return {
    publicRows: rows,
    privateMap,
    note:
      "Share only publicRows for blind listening. Keep privateMap inside local reports until the review is complete.",
  };
}

function buildVoiceShootoutReport({
  generatedAt = new Date().toISOString(),
  env = process.env,
  localTtsDoctorReport = {},
} = {}) {
  const manifest = buildBenchmarkManifest({
    generatedAt,
    env,
    localTtsDoctorReport,
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
  lines.push("- private model map is kept in JSON only and should not be shared before scoring.");
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
  MODEL_CATALOGUE,
  buildBenchmarkManifest,
  buildBlindReviewPack,
  buildVoiceShootoutReport,
  localTtsReady,
  renderVoiceReviewSheet,
  renderVoiceShootoutMarkdown,
};
