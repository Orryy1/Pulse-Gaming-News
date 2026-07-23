"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("fs-extra");

const {
  parseFfmpegLoudnessStats,
} = require("./audio-quality");
const {
  buildElevenLabsSfxGovernanceEngine,
  writeElevenLabsSfxGovernanceEngine,
} = require("./elevenlabs-sfx-governance-engine");

const execFileAsync = promisify(execFile);
const ELEVENLABS_SOUND_EFFECTS_ENDPOINT =
  "https://api.elevenlabs.io/v1/sound-generation";
const ELEVENLABS_SOUND_EFFECTS_MODEL = "eleven_text_to_sound_v2";
const ELEVENLABS_COMMERCIAL_TERMS_EVIDENCE =
  "https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform";

const CINEMATIC_SOUNDSCAPE_SLOTS = Object.freeze([
  Object.freeze({
    role: "ambience",
    duration_seconds: 12,
    loop: true,
    prompt_influence: 0.62,
    target_lufs: -25,
    target_true_peak_db: -3,
    prompt:
      "Seamless futuristic broadcast-news ambience for a premium gaming news short. Wide low synth air, subtle digital texture, calm confidence, narration-safe, no percussion and no vocals. No recognisable melody. No copyrighted melody. No recognisable game sound.",
  }),
  Object.freeze({
    role: "drone",
    duration_seconds: 10,
    loop: true,
    prompt_influence: 0.68,
    target_lufs: -26,
    target_true_peak_db: -3,
    prompt:
      "Seamless restrained digital mystery drone for careful gaming rumour analysis. Low sub texture, faint granular shimmer, sophisticated and neutral, not horror, narration-safe and no vocals. No recognisable melody. No copyrighted melody. No recognisable game sound.",
  }),
  Object.freeze({
    role: "tension_bed",
    duration_seconds: 10,
    loop: true,
    prompt_influence: 0.72,
    target_lufs: -24,
    target_true_peak_db: -3,
    prompt:
      "Seamless urgent but controlled breaking gaming-news soundscape. Subtle low pulse and modern broadcast technology texture, premium cinematic tension without trailer parody, narration-safe, no siren and no vocals. No recognisable melody. No copyrighted melody. No recognisable game sound.",
  }),
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  return sha256Buffer(await fs.readFile(filePath));
}

function buildCinematicSoundscapeGenerationPlan({
  generatedAt = new Date().toISOString(),
  slots = CINEMATIC_SOUNDSCAPE_SLOTS,
} = {}) {
  const planned = slots.map((slot) => ({
    ...slot,
    model: ELEVENLABS_SOUND_EFFECTS_MODEL,
    output_format: "mp3_44100_192",
    estimated_credit_cost: Number(slot.duration_seconds) * 40,
    secondary_layer_only: true,
    raw_redistribution_allowed: false,
  }));
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF_GENERATION_PLAN",
    provider_id: "elevenlabs_sfx",
    model: ELEVENLABS_SOUND_EFFECTS_MODEL,
    slots: planned,
    estimated_credit_cost: planned.reduce(
      (total, slot) => total + slot.estimated_credit_cost,
      0,
    ),
    creative_contract: {
      narration_priority: true,
      soundscapes_are_secondary_layers: true,
      no_recognisable_game_audio: true,
      no_recognisable_or_copyrighted_melody: true,
      raw_asset_redistribution_forbidden: true,
      generated_audio_requires_sidecar_and_hash: true,
    },
    safety: {
      no_external_generation_started: true,
      no_api_call: true,
      no_oauth_or_token_change: true,
      no_db_mutation: true,
      no_posting: true,
    },
  };
}

async function requestElevenLabsSoundEffect({
  apiKey,
  role,
  prompt,
  duration_seconds,
  loop,
  prompt_influence,
  model = ELEVENLABS_SOUND_EFFECTS_MODEL,
  output_format = "mp3_44100_192",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!cleanText(apiKey)) throw new Error("elevenlabs_soundscape_api_key_missing");
  if (typeof fetchImpl !== "function") {
    throw new Error("elevenlabs_soundscape_fetch_unavailable");
  }
  const query = new URLSearchParams({ output_format });
  const response = await fetchImpl(
    `${ELEVENLABS_SOUND_EFFECTS_ENDPOINT}?${query.toString()}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: prompt,
        duration_seconds,
        loop,
        prompt_influence,
        model_id: model,
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `elevenlabs_soundscape_generation_failed:${response.status}:${cleanText(
        body,
      ).slice(0, 240)}`,
    );
  }
  return {
    role,
    audio: Buffer.from(await response.arrayBuffer()),
    request_id:
      response.headers.get("request-id") ||
      response.headers.get("x-request-id") ||
      null,
    trace_id: response.headers.get("x-trace-id") || null,
    character_cost: Number(response.headers.get("character-cost")) || null,
  };
}

async function defaultMasterAudio({
  inputPath,
  outputPath,
  slot,
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
} = {}) {
  await fs.ensureDir(path.dirname(outputPath));
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-af",
      `loudnorm=I=${slot.target_lufs}:TP=${slot.target_true_peak_db}:LRA=7`,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "pcm_s24le",
      outputPath,
    ],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
}

async function defaultAnalyseAudio({
  inputPath,
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
} = {}) {
  const [probe, loudness] = await Promise.all([
    execFileAsync(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputPath,
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    ),
    execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-i",
        inputPath,
        "-af",
        "loudnorm=I=-24:TP=-3:LRA=7:print_format=json",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    ).catch((error) => ({
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    })),
  ]);
  const stats = parseFfmpegLoudnessStats(
    `${loudness.stdout || ""}\n${loudness.stderr || ""}`,
  );
  const durationS = Number(cleanText(probe.stdout));
  return {
    duration_ms: Number.isFinite(durationS)
      ? Math.round(durationS * 1000)
      : null,
    loudness_lufs: stats.integratedLufs,
    true_peak_db: stats.truePeakDb,
  };
}

function assetIdForSlot(slot = {}) {
  return `elevenlabs_cinematic_${slug(slot.role)}_${sha256Buffer(
    `${ELEVENLABS_SOUND_EFFECTS_MODEL}:${slot.prompt}:${slot.duration_seconds}:${slot.loop}`,
  ).slice(0, 12)}`;
}

async function materializeCinematicSoundscapePack({
  workspaceRoot = process.cwd(),
  audioOutputDir = path.join(
    workspaceRoot,
    "audio",
    "elevenlabs",
    "sfx",
    "cinematic-v1",
  ),
  governanceOutputDir = path.join(
    workspaceRoot,
    "output",
    "elevenlabs-cinematic-soundscapes",
  ),
  generatedAt = new Date().toISOString(),
  slots = CINEMATIC_SOUNDSCAPE_SLOTS,
  apiKey = process.env.ELEVENLABS_API_KEY,
  requestSoundEffect = requestElevenLabsSoundEffect,
  masterAudio = defaultMasterAudio,
  analyseAudio = defaultAnalyseAudio,
} = {}) {
  if (!cleanText(apiKey)) throw new Error("elevenlabs_soundscape_api_key_missing");
  const resolvedAudioOutputDir = path.resolve(audioOutputDir);
  const resolvedGovernanceOutputDir = path.resolve(governanceOutputDir);
  await Promise.all([
    fs.ensureDir(resolvedAudioOutputDir),
    fs.ensureDir(resolvedGovernanceOutputDir),
  ]);

  const assets = [];
  const requestReceipts = [];
  for (const slot of slots) {
    const stem = `elevenlabs_cinematic_${slug(slot.role)}_v1`;
    const rawPath = path.join(resolvedAudioOutputDir, `${stem}.raw.mp3`);
    const audioPath = path.join(resolvedAudioOutputDir, `${stem}.wav`);
    const sidecarPath = path.join(
      resolvedAudioOutputDir,
      `${stem}.elevenlabs-sfx.json`,
    );
    const response = await requestSoundEffect({
      apiKey,
      role: slot.role,
      prompt: slot.prompt,
      duration_seconds: slot.duration_seconds,
      loop: slot.loop,
      prompt_influence: slot.prompt_influence,
      model: ELEVENLABS_SOUND_EFFECTS_MODEL,
      output_format: "mp3_44100_192",
    });
    if (!Buffer.isBuffer(response.audio) || response.audio.length === 0) {
      throw new Error(`elevenlabs_soundscape_empty_audio:${slot.role}`);
    }
    await fs.writeFile(rawPath, response.audio);
    await masterAudio({
      inputPath: rawPath,
      outputPath: audioPath,
      slot,
    });
    if (!(await fs.pathExists(audioPath))) {
      throw new Error(`elevenlabs_soundscape_master_missing:${slot.role}`);
    }
    const analysis = await analyseAudio({ inputPath: audioPath, slot });
    if (
      !Number.isFinite(Number(analysis.loudness_lufs)) ||
      !Number.isFinite(Number(analysis.true_peak_db))
    ) {
      throw new Error(`elevenlabs_soundscape_loudness_evidence_missing:${slot.role}`);
    }
    const sha256 = await sha256File(audioPath);
    const assetId = assetIdForSlot(slot);
    const sidecar = {
      schema_version: 1,
      asset_id: assetId,
      role: slot.role,
      family: slot.role,
      provider_id: "elevenlabs_sfx",
      prompt: slot.prompt,
      model: ELEVENLABS_SOUND_EFFECTS_MODEL,
      generation_time: generatedAt,
      audio_path: audioPath,
      sha256,
      rights_note:
        "Generated for Pulse Gaming during a paid ElevenLabs subscription. Commercial use is limited to finished editorial output and the isolated sound must not be redistributed.",
      terms_evidence_url: ELEVENLABS_COMMERCIAL_TERMS_EVIDENCE,
      allowed_use: "finished_editorial_video_only",
      commercial_use_allowed: true,
      raw_redistribution_allowed: false,
      secondary_layer_only: true,
      duration_ms: Number(analysis.duration_ms),
      loudness_lufs: Number(analysis.loudness_lufs),
      true_peak_db: Number(analysis.true_peak_db),
      reuse_limit: 12,
      usage_count: 0,
      generation_parameters: {
        duration_seconds: slot.duration_seconds,
        loop: slot.loop,
        prompt_influence: slot.prompt_influence,
        output_format: "mp3_44100_192",
      },
      request_evidence: {
        request_id: cleanText(response.request_id) || null,
        trace_id: cleanText(response.trace_id) || null,
        character_cost: Number(response.character_cost) || null,
      },
    };
    await fs.writeJson(sidecarPath, sidecar, { spaces: 2 });
    await fs.remove(rawPath);
    assets.push({
      asset_id: assetId,
      role: slot.role,
      audio_path: audioPath,
      sidecar_path: sidecarPath,
      sha256,
    });
    requestReceipts.push({
      role: slot.role,
      request_id: cleanText(response.request_id) || null,
      character_cost: Number(response.character_cost) || null,
    });
  }

  const requiredRoles = slots.map((slot) => slot.role);
  const governance = await buildElevenLabsSfxGovernanceEngine({
    workspaceRoot: path.resolve(workspaceRoot),
    sidecarPaths: assets.map((asset) => asset.sidecar_path),
    requiredRoles,
    outputDir: resolvedGovernanceOutputDir,
    generatedAt,
  });
  const written = await writeElevenLabsSfxGovernanceEngine(governance, {
    outputDir: resolvedGovernanceOutputDir,
  });
  const creditsReported = requestReceipts.reduce(
    (total, receipt, index) =>
      total +
      (Number.isFinite(receipt.character_cost)
        ? receipt.character_cost
        : Number(slots[index].duration_seconds) * 40),
    0,
  );
  const generationReceipt = {
    schema_version: 1,
    generated_at: generatedAt,
    provider_id: "elevenlabs_sfx",
    model: ELEVENLABS_SOUND_EFFECTS_MODEL,
    external_api_calls: requestReceipts.length,
    credits_reported: creditsReported,
    assets,
    request_receipts: requestReceipts,
    safety: {
      no_secret_values_recorded: true,
      no_oauth_or_token_change: true,
      no_db_mutation: true,
      no_publishing: true,
      raw_asset_redistribution_forbidden: true,
    },
  };
  const generationReceiptPath = path.join(
    resolvedGovernanceOutputDir,
    "elevenlabs_cinematic_soundscape_generation_receipt.json",
  );
  await fs.writeJson(generationReceiptPath, generationReceipt, { spaces: 2 });
  return {
    plan: buildCinematicSoundscapeGenerationPlan({ generatedAt, slots }),
    assets,
    governance,
    runtime_manifest: governance.sfx_runtime_manifest,
    generation_receipt: generationReceipt,
    written: {
      ...written,
      generationReceipt: generationReceiptPath,
    },
  };
}

module.exports = {
  CINEMATIC_SOUNDSCAPE_SLOTS,
  ELEVENLABS_COMMERCIAL_TERMS_EVIDENCE,
  ELEVENLABS_SOUND_EFFECTS_ENDPOINT,
  ELEVENLABS_SOUND_EFFECTS_MODEL,
  buildCinematicSoundscapeGenerationPlan,
  defaultAnalyseAudio,
  defaultMasterAudio,
  materializeCinematicSoundscapePack,
  requestElevenLabsSoundEffect,
};
