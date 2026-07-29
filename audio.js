"use strict";

const dotenv = require("dotenv");
const {
  assertValidRuntimeConfig,
  loadDotenvOnce,
} = require("./lib/stabilisation/runtime-config");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  loadDotenvOnce({ dotenv, env: process.env });
}
assertValidRuntimeConfig(process.env);

const axios = require("axios");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const path = require("path");
const { exec, execFile } = require("child_process");
const util = require("util");
const db = require("./lib/db");
const mediaPaths = require("./lib/media-paths");
const {
  createElevenLabsCreditGovernor,
} = require("./lib/services/elevenlabs-credit-governor");
const {
  safeRedirectConfig,
} = require("./lib/safe-url");

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

const brand = require("./brand");

let defaultElevenLabsCreditGovernor = null;
let defaultElevenLabsCreditGovernorSignature = null;

// --- Phonetic replacements for words TTS mispronounces ---
const PHONETIC_MAP = {
  abyss: "uh-biss",
  cache: "cash",
  segue: "seg-way",
  genre: "zhon-ruh",
  niche: "neesh",
  epitome: "eh-pit-oh-mee",
  albeit: "all-bee-it",
  dequeue: "dee-queue",
};

const { applyGamingPronunciation } = require("./lib/tts-pronunciation");
const { normaliseText } = require("./lib/text-hygiene");
const { runBrandNameQa } = require("./lib/brand-name-qa");
const { applyProduceSelection } = require("./lib/produce-selection");
const {
  classifyShortScriptRuntime,
} = require("./lib/services/short-runtime-planner");
const {
  resolvePulseScriptContract,
  validatePulseScriptRuntime,
} = require("./lib/services/pulse-editorial-contract");

function resolveAudioRuntimePlan({ story = {}, channelId, scriptText } = {}) {
  const resolvedChannelId =
    String(channelId || story.channel_id || process.env.CHANNEL || "")
      .trim()
      .toLowerCase() || "pulse-gaming";
  const cleanedScript = cleanForTTS(
    scriptText ||
      story.tts_script ||
      story.full_script ||
      story.body ||
      "",
  );
  if (resolvedChannelId !== "pulse-gaming") {
    return classifyShortScriptRuntime({
      text: cleanedScript,
      story,
    });
  }

  const contract = resolvePulseScriptContract({ story });
  const runtime = validatePulseScriptRuntime({
    text: cleanedScript,
    contract,
  });
  const shouldGenerateShortAudio =
    contract.format_family === "short" && runtime.result === "pass";
  return {
    result:
      contract.format_family === "short" ? runtime.result : "route_longform",
    route:
      contract.format_family === "short"
        ? shouldGenerateShortAudio
          ? "contracted_short"
          : "blocked"
        : "briefing_or_longform",
    shouldGenerateShortAudio,
    failures:
      contract.format_family === "short"
        ? runtime.failures
        : ["pulse_recap_requires_longform_audio_path"],
    warnings: runtime.warnings,
    wordCount: runtime.word_count,
    estimatedSeconds: runtime.estimated_seconds,
    minSeconds: contract.min_seconds,
    maxSeconds: contract.max_seconds,
    minWords: contract.min_words,
    maxWords: contract.max_words,
    durationBandId: contract.duration_band_id,
    format: contract.format_family,
    contract,
  };
}

function evaluateAudioDurationAgainstPlan(durationSeconds, runtimePlan) {
  const duration = Number(durationSeconds);
  const minSeconds = Number(runtimePlan?.minSeconds);
  const maxSeconds = Number(runtimePlan?.maxSeconds);
  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(minSeconds) ||
    !Number.isFinite(maxSeconds)
  ) {
    throw new Error("valid_audio_duration_plan_required");
  }
  const failures = [];
  if (duration < minSeconds) {
    failures.push("audio_duration_below_selected_band");
  } else if (duration > maxSeconds) {
    failures.push("audio_duration_above_selected_band");
  }
  return {
    result: failures.length ? "fail" : "pass",
    failures,
    durationSeconds: duration,
    minSeconds,
    maxSeconds,
    durationBandId: runtimePlan.durationBandId || null,
  };
}

// --- Clean text for TTS - shared logic ---
function cleanForTTS(raw) {
  // 2026-04-30 fix (Discord report): narrator pronounced "AAA" as
  // letters "A. A. A." rather than industry-standard "Triple A".
  // Apply gaming-specific pronunciation rewrites BEFORE the other
  // transforms so subsequent regex passes see the already-rewritten
  // text (e.g. so the abbreviation-stripper doesn't trip on "Triple A").
  const normalised = normaliseText(raw || "");
  const pre = applyGamingPronunciation(normalised);
  return (
    pre
      // 2026-04-19 fix (precedes the other transforms): paragraph /
      // line separators (U+2028, U+2029) must become real spaces BEFORE
      // the invisible-unicode stripper runs, otherwise the stripper
      // consumes them with no replacement and later "rollout.Journalists"
      // runs together. Same class of bug that shipped the Black Flag
      // subtitles with ROLLOUT.JOURNALISTS joined.
      .replace(/[\u2028\u2029]/g, " ")
      .replace(/\[PAUSE\]/gi, ", ")
      .replace(/\[VISUAL:[^\]]*\]/gi, "")
      .replace(/\.{2,}/g, ".")
      // Ensure space after sentence-ending periods (LLM sometimes omits: "2026.The")
      .replace(/\.([A-Z])/g, ". $1")
      // Strip Reddit subreddit paths - TTS mangles "r/PS5"
      .replace(/\br\/(\w+)/g, (_, sub) => `the ${sub} subreddit`)
      .replace(/[*_~`#|]/g, "")
      // Zero-width / invisible unicode: strip silently. U+2028/U+2029 are
      // handled above with a replacement space, so they stay out of the
      // range here now.
      .replace(/[\u200B-\u200F\u202A-\u202F\uFEFF]/g, "")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
      .replace(/[\u2013\u2014]/g, " - ") // only en/em dashes get spaced out
      // Version numbers: "1.03.00" -> "1 point 0 3 point 0 0"
      .replace(/(\d+)\.(\d+)\.(\d+)/g, (_, a, b, c) => {
        const spellDigits = (s) => s.split("").join(" ");
        return `${a} point ${spellDigits(b)} point ${spellDigits(c)}`;
      })
      // Patch versions: "v1.2" or "V2.0"
      .replace(/[vV](\d+)\.(\d+)/g, (_, a, b) => `version ${a} point ${b}`)
      // Game titles and acronyms - spell out for clear TTS pronunciation
      .replace(/\bGTA\s*VI\b/gi, "G T A six")
      .replace(/\bGTA\s*6\b/gi, "G T A six")
      .replace(/\bGTA\b/g, "G T A")
      // Compound hyphenated words: join with space, no dash (prevents TTS pauses)
      .replace(/(\w)-(\w)/g, "$1 $2")
      // Currency
      .replace(
        /\$(\d+(?:\.\d{1,2})?)\s*(billion|million|trillion)/gi,
        (_, n, unit) => `${n} ${unit.toLowerCase()} dollars`,
      )
      .replace(
        /\$(\d+)\.(\d{2})/g,
        (_, whole, cents) => `${whole} dollars ${parseInt(cents)}`,
      )
      .replace(
        /\$(\d+)\.(\d)/g,
        (_, whole, cents) => `${whole} dollars ${parseInt(cents)}0`,
      )
      .replace(
        /\$(\d+)/g,
        (_, n) => `${n} dollar${parseInt(n) === 1 ? "" : "s"}`,
      )
      .replace(
        /£(\d+)\.(\d{1,2})/g,
        (_, whole, pence) => `${whole} pounds ${parseInt(pence)}`,
      )
      .replace(/£(\d+)/g, (_, n) => `${n} pounds`)
      .replace(
        /€(\d+)\.(\d{1,2})/g,
        (_, whole, cents) => `${whole} euros ${parseInt(cents)}`,
      )
      .replace(/€(\d+)/g, (_, n) => `${n} euros`)
      // Years
      .replace(/(\d{4})/g, (match) => {
        const y = parseInt(match);
        if (y >= 2000 && y <= 2009) {
          const ones = [
            "",
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
          ];
          return y === 2000
            ? "two thousand"
            : `two thousand and ${ones[y - 2000]}`;
        }
        if (y >= 2010 && y <= 2099)
          return `twenty ${match.slice(2, 4).replace(/^0/, "")}`;
        return match;
      })
      // Phonetic replacements for mispronounced words
      .replace(
        new RegExp(`\\b(${Object.keys(PHONETIC_MAP).join("|")})\\b`, "gi"),
        (match) => PHONETIC_MAP[match.toLowerCase()] || match,
      )
      // Preserve legitimate Unicode letters in brand/game names while
      // still dropping emoji, symbols and control bytes that TTS may
      // speak literally or leak into timestamp subtitles.
      .replace(/[^\p{L}\p{M}\p{N}\p{P}\p{Sc}\p{Zs}\p{Sm}\t\r\n]/gu, "")
      .replace(/\s+/g, " ")
      .replace(/\.\s*\./g, ".")
      .replace(/\.\s*,/g, ",")
      .replace(/,\s*,/g, ",")
      .trim()
  );
}

function assertBrandNameQaForTts(story, fields) {
  const qa = runBrandNameQa({
    title: story?.title,
    ...fields,
  });
  if (qa.warnings.length > 0) {
    console.log(
      `[audio] Brand-name QA warnings for ${story?.id || "story"}: ${qa.warnings.join(", ")}`,
    );
  }
  if (qa.failures.length > 0) {
    throw new Error(`brand_name_qa_failed:${qa.failures.join(",")}`);
  }
  return qa;
}

function selectRawTtsScript(story) {
  const preferred =
    typeof story?.tts_script === "string" ? story.tts_script.trim() : "";
  const fallback =
    typeof story?.full_script === "string" ? story.full_script.trim() : "";
  if (!preferred) return fallback;

  const preferredQa = runBrandNameQa({ tts_script: preferred });
  if (preferredQa.failures.length === 0 && preferredQa.warnings.length === 0) {
    return preferred;
  }

  if (fallback && fallback !== preferred) {
    const fallbackQa = runBrandNameQa({ full_script: fallback });
    if (fallbackQa.failures.length === 0 && fallbackQa.warnings.length === 0) {
      console.log(
        `[audio] ${story?.id || "story"}: cached tts_script failed brand-name QA; using clean full_script`,
      );
      return fallback;
    }

    if (
      preferredQa.failures.length > 0 &&
      fallbackQa.failures.length === 0
    ) {
      console.log(
        `[audio] ${story?.id || "story"}: cached tts_script has protected-name damage; using safer full_script`,
      );
      return fallback;
    }
  }

  return preferred;
}

// --- Get audio duration via ffprobe ---
async function getAudioDuration(audioPath) {
  try {
    const resolvedPath =
      (await mediaPaths.resolveExisting(audioPath)) || mediaPaths.writePath(audioPath);
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", resolvedPath],
      { timeout: 10000 },
    );
    return parseFloat(stdout.trim()) || 50;
  } catch (err) {
    return 50;
  }
}

function resolveTtsTimeoutMs(provider, env = process.env) {
  if (String(provider || "").toLowerCase() === "local") {
    const value = Number(
      env.LOCAL_TTS_TIMEOUT_MS || env.STUDIO_V2_LOCAL_TTS_TIMEOUT_MS || 600000,
    );
    return Number.isFinite(value) && value > 0 ? value : 600000;
  }
  const remoteValue = Number(env.ELEVENLABS_TTS_TIMEOUT_MS || 60000);
  return Number.isFinite(remoteValue) && remoteValue > 0 ? remoteValue : 60000;
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveLocalTtsSpeakingRate(rate, env = process.env) {
  const requested = finiteNumber(rate, 1.0);
  const baseSpeed = finiteNumber(
    env.LOCAL_TTS_BASE_SPEED ||
      env.STUDIO_V2_LOCAL_TTS_BASE_SPEED ||
      env.BASE_SPEED,
    1.4,
  );
  const effectiveCap = finiteNumber(
    env.LOCAL_TTS_EFFECTIVE_RATE_CAP ||
      env.STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP,
    1.65,
  );
  const serverBase = baseSpeed > 0 ? baseSpeed : 1.4;
  const maxRequestRate = clamp(effectiveCap / serverBase, 0.85, 1.25);
  return clamp(requested, 0.85, maxRequestRate);
}

function resolveVoiceSettingsForProvider(
  provider,
  baseSettings,
  rateOverride,
  env = process.env,
) {
  const settings = Object.assign({}, baseSettings || {});
  const normalisedProvider = String(provider || "").toLowerCase();
  const requestedRate = finiteNumber(
    rateOverride,
    finiteNumber(settings.speed, finiteNumber(settings.speaking_rate, 1)),
  );
  if (normalisedProvider === "local") {
    settings.speaking_rate = requestedRate;
    settings.speaking_rate = resolveLocalTtsSpeakingRate(
      settings.speaking_rate,
      env,
    );
    delete settings.speed;
  } else {
    settings.speed = clamp(requestedRate, 0.7, 1.2);
    delete settings.speaking_rate;
  }
  return settings;
}

function buildTtsRequest({
  provider,
  baseUrl,
  voiceId,
  text,
  voiceSettings,
  modelId,
} = {}) {
  const normalisedProvider = String(provider || "").toLowerCase();
  const local = normalisedProvider === "local";
  const canonicalVoiceSettings = resolveVoiceSettingsForProvider(
    normalisedProvider,
    voiceSettings,
  );
  const endpoint =
    `${String(baseUrl || "").replace(/\/+$/, "")}` +
    `/v1/text-to-speech/${encodeURIComponent(String(voiceId || ""))}` +
    "/with-timestamps";
  const data = {
    text,
    voice_settings: canonicalVoiceSettings,
  };
  if (local) {
    data.output_format = "mp3_44100_128";
  } else {
    data.model_id = modelId || "eleven_multilingual_v2";
  }
  return {
    url: local
      ? endpoint
      : `${endpoint}?output_format=mp3_44100_128`,
    data,
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function buildElevenLabsCreditIdempotencyKey({
  outputPath,
  voiceId,
  modelId,
  text,
  voiceSettings,
} = {}) {
  return [
    "pulse-elevenlabs-tts-v1",
    sha256(
      JSON.stringify({
        output_path: String(outputPath || "").replace(/\\/g, "/"),
        voice_id: String(voiceId || ""),
        model_id: String(modelId || ""),
        text_sha256: sha256(text),
        voice_settings: voiceSettings || {},
      }),
    ),
  ].join(":");
}

function resolveDefaultElevenLabsCreditGovernor() {
  const signature = sha256(
    JSON.stringify({
      api_key: process.env.ELEVENLABS_API_KEY || "",
      base_url: process.env.ELEVENLABS_BASE_URL || "",
      reserve: process.env.ELEVENLABS_CREDIT_RESERVE || "",
      reserve_percent:
        process.env.ELEVENLABS_CREDIT_RESERVE_PERCENT || "",
      warning_percent:
        process.env.ELEVENLABS_CREDIT_WARNING_PERCENT || "",
      estimate_multiplier:
        process.env.ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER || "",
      snapshot_ttl:
        process.env.ELEVENLABS_CREDIT_SNAPSHOT_TTL_MS || "",
      allow_overage: process.env.ELEVENLABS_ALLOW_OVERAGE || "",
      state_root: process.env.PULSE_STATE_ROOT || "",
    }),
  );
  if (
    defaultElevenLabsCreditGovernor &&
    defaultElevenLabsCreditGovernorSignature === signature
  ) {
    return defaultElevenLabsCreditGovernor;
  }
  defaultElevenLabsCreditGovernor = createElevenLabsCreditGovernor({
    env: process.env,
    request: (input) =>
      axios({
        ...input,
        validateStatus: () => true,
        ...safeRedirectConfig(0),
        maxBodyLength: 256 * 1024,
        maxContentLength: 2 * 1024 * 1024,
      }),
  });
  defaultElevenLabsCreditGovernorSignature = signature;
  return defaultElevenLabsCreditGovernor;
}

// --- Concatenate multiple MP3 files via ffmpeg ---
async function concatAudioFiles(files, outputPath) {
  // Resolve through media-paths so the list file + output land
  // next to the segment mp3s the caller wrote via generateTTS
  // (which now lives under MEDIA_ROOT in production).
  const outputAbs = mediaPaths.writePath(outputPath);
  const listAbs = outputAbs.replace(/\.mp3$/, "_concat.txt");
  const listContent = files.map((f) => `file '${path.basename(f)}'`).join("\n");
  await fs.writeFile(listAbs, listContent);
  try {
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${listAbs.replace(/\\/g, "/")}" -c copy "${outputAbs.replace(/\\/g, "/")}"`,
      { timeout: 30000 },
    );
  } finally {
    await fs.remove(listAbs).catch(() => {});
  }
}

// --- Generate TTS audio - dispatches between ElevenLabs and local VoxCPM server ---
//
// Set TTS_PROVIDER=local in .env to route to the self-hosted server.
// LOCAL_TTS_URL defaults to http://127.0.0.1:8765
//
// Both providers must return identical JSON:
//   { audio_base64, alignment: { characters, character_start_times_seconds, character_end_times_seconds } }
async function generateTTS(text, outputPath, rateOverride, options = {}) {
  const provider = (process.env.TTS_PROVIDER || "elevenlabs").toLowerCase();
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default";
  const voiceSettings = Object.assign(
    {},
    brand.voiceSettings || {
      stability: 0.2,
      similarity_boost: 0.8,
      style: 0.75,
      speaking_rate: 1.1,
    },
  );
  const resolvedVoiceSettings = resolveVoiceSettingsForProvider(
    provider,
    voiceSettings,
    rateOverride,
  );

  const baseUrl =
    provider === "local"
      ? process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765"
      : "https://api.elevenlabs.io";

  const headers =
    provider === "local"
      ? { "Content-Type": "application/json" }
      : {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        };

  const request = buildTtsRequest({
    provider,
    baseUrl,
    voiceId,
    text,
    voiceSettings: resolvedVoiceSettings,
    modelId: brand.voiceModel || "eleven_multilingual_v2",
  });

  let creditLease = null;
  if (provider !== "local") {
    const creditGovernor =
      options.creditGovernor ||
      resolveDefaultElevenLabsCreditGovernor();
    creditLease = await creditGovernor.preflight({
      text,
      purpose: options.purpose || "pulse_narration",
      idempotencyKey: buildElevenLabsCreditIdempotencyKey({
        outputPath,
        voiceId,
        modelId: request.data.model_id,
        text,
        voiceSettings: request.data.voice_settings,
      }),
    });
    if (creditLease.report.warnings.length) {
      console.warn(
        `[elevenlabs-credit] remaining=${creditLease.report.remaining_percent}% ` +
          `reserve=${creditLease.report.hard_reserve_credits} ` +
          `estimate=${creditLease.report.estimated_request_credits} ` +
          `warnings=${creditLease.report.warnings.join(",")}`,
      );
    }
  }

  const httpClient = options.httpClient || axios;
  let response;
  let providerCallStarted = false;
  if (creditLease?.replayAvailable === true) {
    response = {
      status: 200,
      data: await creditLease.readRecordedProviderResult(),
    };
  } else {
    try {
      if (creditLease) {
        await creditLease.markProviderCallStarted();
        providerCallStarted = true;
      }
      response = await httpClient({
        method: "POST",
        url: request.url,
        headers,
        data: request.data,
        timeout: resolveTtsTimeoutMs(provider),
        ...(provider === "local"
          ? {}
          : {
              ...safeRedirectConfig(0),
              validateStatus: () => true,
            }),
      });
    } catch (error) {
      if (creditLease && providerCallStarted) {
        await creditLease
          .markProviderCallAmbiguous(
            "provider_request_outcome_unknown",
          )
          .catch(() => {});
      }
      throw error;
    }
  }

  // outputPath is the repo-relative path the caller passes in
  // (e.g. `output/audio/abc.mp3`). writeTarget is where it
  // actually lands on disk — under MEDIA_ROOT in production,
  // under the repo root in local dev.
  const writeTarget = mediaPaths.writePath(outputPath);

  const responseStatus = Number(response?.status);
  if (
    Number.isFinite(responseStatus) &&
    (responseStatus < 200 || responseStatus >= 300)
  ) {
    if (creditLease && creditLease.replayAvailable !== true) {
      await creditLease
        .markProviderCallAmbiguous(
          "provider_http_response_not_success",
        )
        .catch(() => {});
    }
    throw new Error(
      `[audio] ${provider} returned HTTP ${responseStatus}`,
    );
  }
  const audioBase64 = response.data.audio_base64;
  if (!audioBase64) {
    if (creditLease && creditLease.replayAvailable !== true) {
      await creditLease
        .markProviderCallAmbiguous(
          "provider_response_missing_audio",
        )
        .catch(() => {});
    }
    throw new Error(
      `[audio] ${provider} returned no audio_base64 - check ${baseUrl} health`,
    );
  }
  if (creditLease && creditLease.replayAvailable !== true) {
    try {
      await creditLease.recordProviderSuccess(response.data);
    } catch (error) {
      await creditLease
        .markProviderCallAmbiguous(
          "provider_result_journal_failed",
        )
        .catch(() => {});
      throw error;
    }
  }
  const audioBytes = Buffer.from(audioBase64, "base64");
  await fs.ensureDir(path.dirname(writeTarget));
  await fs.writeFile(writeTarget, audioBytes);

  const timestampsPath = outputPath.replace(/\.mp3$/, "_timestamps.json");
  const timestampsWriteTarget = mediaPaths.writePath(timestampsPath);
  const alignment = response.data.alignment || {};
  await fs.writeJson(timestampsWriteTarget, alignment, { spaces: 2 });
  if (creditLease) {
    const creditPath = outputPath.replace(/\.mp3$/, "_credit.json");
    await fs.writeJson(
      mediaPaths.writePath(creditPath),
      {
        ...creditLease.report,
        committed: true,
        committed_at: new Date().toISOString(),
      },
      { spaces: 2 },
    );
    await creditLease.complete({
      outputSha256: crypto
        .createHash("sha256")
        .update(audioBytes)
        .digest("hex"),
    });
  }

  // Return the repo-relative path so callers and the DB continue
  // to treat the story.audio_path field as location-independent.
  return outputPath;
}

async function generateAudio(options = {}) {
  console.log("[audio] Loading stories from canonical store...");
  const { getChannel } = require("./channels");
  const channel = getChannel();

  // Phase 3C JSON-shrink: the old `fs.pathExists("daily_news.json")`
  // precondition was a JSON-era assumption that wrongly fired in
  // USE_SQLITE=true prod (where daily_news.json may be absent but
  // SQLite has stories). Check the canonical source instead.
  const stories = await db.getStories();
  if (!Array.isArray(stories) || stories.length === 0) {
    console.log(
      "[audio] ERROR: no stories in canonical store. Run processor first.",
    );
    return;
  }

  const scopedStories = Array.isArray(options.storyIds)
    ? require("./lib/services/exact-story-production-scope").filterStoriesToExactScope(
        stories,
        options,
      )
    : stories;
  const toProcess = applyProduceSelection(
    scopedStories.filter((s) => s.approved === true && !s.audio_path),
    { stage: "audio", log: console.log },
  );

  console.log(`[audio] ${toProcess.length} stories need audio generation`);

  for (const story of toProcess) {
    console.log(`[audio] Generating audio for: ${story.title}`);

    try {
      // Clean TTS script using shared cleaning function
      const rawTTS = selectRawTtsScript(story);
      const ttsText = cleanForTTS(rawTTS);
      let finalTtsScript = ttsText;
      assertBrandNameQaForTts(story, {
        full_script: story.full_script,
        tts_script: ttsText,
      });

      const runtimePlan = resolveAudioRuntimePlan({
        story,
        channelId: channel.id,
        scriptText: ttsText,
      });
      story.short_runtime_plan = runtimePlan;
      if (runtimePlan.shouldGenerateShortAudio === false) {
        const reason =
          runtimePlan.failures[0] ||
          runtimePlan.warnings[0] ||
          "short_runtime_not_flash_lane";
        console.log(
          `[audio] ${story.id}: skipping TTS before generation: ${reason} ` +
            `(words=${runtimePlan.wordCount}, est=${runtimePlan.estimatedSeconds || "?"}s, target=${runtimePlan.minSeconds}-${runtimePlan.maxSeconds}s)`,
        );
        story.qa_failed = true;
        story.qa_failures = [reason];
        story.qa_warnings = runtimePlan.warnings || [];
        story.qa_failed_at = new Date().toISOString();
        story.publish_status = "failed";
        story.publish_error = `qa_blocked: ${reason}`;
        story.render_fallback_reason = `duration_contract_pre_tts:${reason}`;
        story.runtime_route = runtimePlan.route;
        story.recommended_word_count_min = runtimePlan.minWords;
        story.recommended_word_count_max = runtimePlan.maxWords;
        continue;
      }

      const outputPath = path.join("output", "audio", `${story.id}.mp3`);

      // Dynamic pacing: if story has separate hook/body/cta, generate each
      // segment at a different speaking rate then concatenate
      const baseRate = (brand.voiceSettings || {}).speaking_rate || 1.1;
      if (story.hook && story.body && story.cta) {
        const segments = [
          {
            text: cleanForTTS(story.hook),
            rate: baseRate * 1.05,
            label: "hook",
          },
          {
            text: cleanForTTS(story.body),
            rate: baseRate * 0.95,
            label: "body",
          },
          { text: cleanForTTS(story.cta), rate: baseRate * 1.0, label: "cta" },
        ].filter((s) => s.text.length > 0);
        assertBrandNameQaForTts(story, {
          hook: segments.find((s) => s.label === "hook")?.text || "",
          body: segments.find((s) => s.label === "body")?.text || "",
          cta: segments.find((s) => s.label === "cta")?.text || "",
        });

        if (segments.length > 1) {
          console.log(
            `[audio] Dynamic pacing: ${segments.length} segments at rates [${segments.map((s) => s.rate.toFixed(2)).join(", ")}]`,
          );
          const segmentPaths = [];
          for (const seg of segments) {
            const segPath = path.join(
              "output",
              "audio",
              `${story.id}_${seg.label}.mp3`,
            );
            await generateTTS(seg.text, segPath, seg.rate);
            segmentPaths.push(segPath);
          }
          await concatAudioFiles(segmentPaths, outputPath);

          // Merge segment timestamps into a single combined file
          // Each segment's timestamps start from 0, so offset by cumulative duration
          const mergedChars = [];
          const mergedStarts = [];
          const mergedEnds = [];
          let cumulativeOffset = 0;
          for (const sp of segmentPaths) {
            const tsPath = sp.replace(/\.mp3$/, "_timestamps.json");
            const tsAbs = (await mediaPaths.resolveExisting(tsPath)) || tsPath;
            if (await fs.pathExists(tsAbs)) {
              try {
                const ts = await fs.readJson(tsAbs);
                if (
                  ts.characters &&
                  ts.character_start_times_seconds &&
                  ts.character_end_times_seconds
                ) {
                  // Add a space separator between segments (except first)
                  if (mergedChars.length > 0) {
                    mergedChars.push(" ");
                    mergedStarts.push(cumulativeOffset);
                    mergedEnds.push(cumulativeOffset);
                  }
                  for (let i = 0; i < ts.characters.length; i++) {
                    mergedChars.push(ts.characters[i]);
                    mergedStarts.push(
                      ts.character_start_times_seconds[i] + cumulativeOffset,
                    );
                    mergedEnds.push(
                      ts.character_end_times_seconds[i] + cumulativeOffset,
                    );
                  }
                }
              } catch (e) {
                /* skip broken timestamp file */
              }
            }
            // Get segment duration for offset calculation
            const segDuration = await getAudioDuration(sp);
            cumulativeOffset += segDuration;
          }
          if (mergedChars.length > 0) {
            const combinedTsPath = outputPath.replace(
              /\.mp3$/,
              "_timestamps.json",
            );
            await fs.writeJson(
              mediaPaths.writePath(combinedTsPath),
              {
                characters: mergedChars,
                character_start_times_seconds: mergedStarts,
                character_end_times_seconds: mergedEnds,
              },
              { spaces: 2 },
            );
          }

          // Clean up segment files
          for (const sp of segmentPaths) {
            await fs.remove(mediaPaths.writePath(sp)).catch(() => {});
            await fs
              .remove(mediaPaths.writePath(sp.replace(/\.mp3$/, "_timestamps.json")))
              .catch(() => {});
          }
        } else {
          // Only one non-empty segment, use single call
          await generateTTS(ttsText, outputPath);
        }
      } else {
        await generateTTS(ttsText, outputPath);
      }

      // The generated narration must remain inside the story's selected
      // editorial duration band. Audio never rewrites editorial copy: a miss
      // fails closed for processor repair or human review.
      const audioDuration = await getAudioDuration(outputPath);
      story.audio_duration = audioDuration;
      const durationGate = evaluateAudioDurationAgainstPlan(
        audioDuration,
        runtimePlan,
      );
      story.audio_duration_gate = durationGate;
      if (durationGate.result === "fail") {
        const reason = `${durationGate.failures[0]} (${audioDuration.toFixed(
          2,
        )}s, selected ${durationGate.minSeconds.toFixed(
          2,
        )}-${durationGate.maxSeconds.toFixed(2)}s band ${
          durationGate.durationBandId || "unknown"
        })`;
        console.log(
          `[audio] ${story.id}: generated audio missed its selected editorial band, blocking before render: ${reason}`,
        );
        story.qa_failed = true;
        story.qa_failures = [reason];
        story.qa_warnings = [];
        story.qa_failed_at = new Date().toISOString();
        story.publish_status = "failed";
        story.publish_error = `qa_blocked: ${reason}`;
        story.render_fallback_reason = `duration_contract_post_tts:${reason}`;
        story.audio_path = outputPath;
        story.tts_script = finalTtsScript;
        continue;
      }
      console.log(
        `[audio] Duration OK: ${audioDuration.toFixed(1)}s inside ${
          durationGate.durationBandId
        }`,
      );

      story.audio_path = outputPath;
      story.tts_script = finalTtsScript;
      console.log(`[audio] Saved: ${outputPath}`);
    } catch (err) {
      console.log(`[audio] ERROR for ${story.id}: ${err.message}`);
    }
  }

  await db.saveStories(stories);
  console.log("[audio] Stories updated");
  return {
    processed: toProcess.length,
    story_ids: toProcess.map((story) => story.id),
    exact_scope: Array.isArray(options.storyIds),
  };
}

module.exports = generateAudio;
module.exports.getAudioDuration = getAudioDuration;
module.exports.cleanForTTS = cleanForTTS;
module.exports.generateTTS = generateTTS;
module.exports.concatAudioFiles = concatAudioFiles;
module.exports.resolveTtsTimeoutMs = resolveTtsTimeoutMs;
module.exports.resolveLocalTtsSpeakingRate = resolveLocalTtsSpeakingRate;
module.exports.resolveVoiceSettingsForProvider = resolveVoiceSettingsForProvider;
module.exports.buildTtsRequest = buildTtsRequest;
module.exports.buildElevenLabsCreditIdempotencyKey =
  buildElevenLabsCreditIdempotencyKey;
module.exports.assertBrandNameQaForTts = assertBrandNameQaForTts;
module.exports.selectRawTtsScript = selectRawTtsScript;
module.exports.resolveAudioRuntimePlan = resolveAudioRuntimePlan;
module.exports.evaluateAudioDurationAgainstPlan =
  evaluateAudioDurationAgainstPlan;

if (require.main === module) {
  generateAudio().catch((err) => {
    console.log(`[audio] ERROR: ${err.message}`);
    process.exit(1);
  });
}
