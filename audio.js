const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");
const { exec, execFile } = require("child_process");
const util = require("util");
const db = require("./lib/db");
const mediaPaths = require("./lib/media-paths");

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  dotenv.config({ override: true });
}

const brand = require("./brand");

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
  secondsPerWordForTtsProvider,
} = require("./lib/services/short-runtime-planner");
const {
  classifyLocalTtsFailure,
} = require("./lib/studio/local-tts-failures");
const {
  createLocalTtsBatchRecovery,
  generateLocalTtsWithOptionalRecovery,
} = require("./lib/ops/local-tts-batch-recovery");
const {
  resolveAcceptedLocalVoiceReference,
} = require("./lib/studio/v2/local-voice-reference");
const {
  assertLocalTtsGpuReady,
} = require("./lib/studio/local-gpu-pressure");
const {
  ACCEPTED_LOCAL_LIAM_VOICE_ID,
  canonicalLocalTtsVoiceId,
} = require("./lib/studio/local-tts-voice-id");
const {
  repairTimestampAlignment,
} = require("./lib/subtitle-timing");
const {
  masterTtsAudioFile,
  shouldMasterTtsAudio,
} = require("./lib/audio-quality");

function isTruthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || ""));
}

function isLocalTtsProvider(provider = process.env.TTS_PROVIDER || "elevenlabs") {
  return String(provider || "").toLowerCase() === "local";
}

function shouldUseDynamicPacingForProvider(provider = process.env.TTS_PROVIDER || "elevenlabs") {
  if (isLocalTtsProvider(provider)) return false;
  return !/^(false|0|no|off)$/i.test(String(process.env.TTS_DYNAMIC_PACING || "true"));
}

function isValidTtsOutputFormat(value) {
  return /^mp3_(?:22050|24000|44100|48000)_(?:64|96|128|192|256|320)$/.test(
    String(value || ""),
  );
}

function ttsOutputBitrate(format) {
  const parts = String(format || "").split("_");
  const bitrate = Number(parts[2]);
  return Number.isFinite(bitrate) ? bitrate : null;
}

function resolveTtsOutputFormat(provider, env = process.env) {
  const local = isLocalTtsProvider(provider);
  const candidate = firstNonBlank(
    local ? env.LOCAL_TTS_OUTPUT_FORMAT : null,
    env.TTS_OUTPUT_FORMAT,
  );
  if (candidate && isValidTtsOutputFormat(candidate)) {
    if (!local || Number(ttsOutputBitrate(candidate)) >= 192) {
      return candidate;
    }
  }

  return local ? "mp3_44100_192" : "mp3_44100_128";
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

function hasSpokenOutro(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .includes("follow pulse gaming so you never miss a beat");
}

function buildTtsAlignmentMeta({
  existingMeta = {},
  provider,
  voiceId,
  baseUrl,
  text,
  resolvedVoiceSettings = {},
  voiceDiagnostics = null,
} = {}) {
  const normalisedProvider = String(provider || "").toLowerCase();
  const isLocal = normalisedProvider === "local";
  const source = isLocal ? "local-tts-server" : "elevenlabs-production-path";
  const requestedText = typeof text === "string" && text.trim() ? text : null;
  const existingTranscript =
    typeof existingMeta.transcript === "string" && existingMeta.transcript.trim()
      ? existingMeta.transcript
      : null;
  const transcript =
    existingTranscript &&
    (!requestedText || existingTranscript.length >= requestedText.length * 0.65)
      ? existingTranscript
      : requestedText || existingMeta.text || existingTranscript || null;
  return {
    ...existingMeta,
    provider: normalisedProvider || existingMeta.provider || "unknown",
    source,
    text: typeof text === "string" ? text : existingMeta.text || null,
    transcript,
    spokenOutroPresent: hasSpokenOutro(transcript),
    voiceDiagnostics: voiceDiagnostics || existingMeta.voiceDiagnostics || null,
    acoustic:
      voiceDiagnostics?.acoustic ||
      voiceDiagnostics?.metrics ||
      existingMeta.acoustic ||
      null,
    localTts: isLocal
      ? {
          voiceId,
          baseUrl,
          speakingRate: resolvedVoiceSettings.speaking_rate,
        }
      : null,
    approvedLocalVoice: isLocal
      ? isTruthy(process.env.STUDIO_V2_LOCAL_VOICE_APPROVED)
      : existingMeta.approvedLocalVoice,
    acceptedLocalVoice: isLocal
      ? resolveAcceptedLocalVoiceReference(process.env)
      : existingMeta.acceptedLocalVoice || null,
    elevenlabs: !isLocal
      ? {
          voiceId,
          modelId: brand.voiceModel || "eleven_multilingual_v2",
          speakingRate: resolvedVoiceSettings.speaking_rate,
        }
      : null,
    ttsMetadataVersion: 2,
    stampedAt: new Date().toISOString(),
  };
}

function resolveTtsVoiceIdForProvider(provider, env = process.env, brandConfig = brand) {
  const normalisedProvider = String(provider || "").toLowerCase();
  if (normalisedProvider === "local") {
    const rawVoiceId = firstNonBlank(
      env.LOCAL_TTS_VOICE_ID,
      env.STUDIO_V2_LOCAL_TTS_VOICE_ID,
      env.PULSE_LOCAL_TTS_VOICE_ID,
      brandConfig?.voiceId,
      env.ELEVENLABS_VOICE_ID,
    );
    const voiceId = rawVoiceId ? canonicalLocalTtsVoiceId(rawVoiceId) : rawVoiceId;
    if (!voiceId || voiceId === "default" || voiceId === "__default__") {
      throw new Error("unsafe_local_tts_voice:missing_mapped_liam_voice_id");
    }
    if (
      voiceId !== ACCEPTED_LOCAL_LIAM_VOICE_ID &&
      !isTruthy(env.ALLOW_NON_LIAM_LOCAL_TTS)
    ) {
      throw new Error(
        `unsafe_local_tts_voice:${voiceId}:expected_${ACCEPTED_LOCAL_LIAM_VOICE_ID}`,
      );
    }
    return voiceId;
  }
  return firstNonBlank(brandConfig?.voiceId, env.ELEVENLABS_VOICE_ID) || "default";
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
  if (!preferred) return ensureSpokenOutro(fallback);

  const preferredQa = runBrandNameQa({ tts_script: preferred });
  if (preferredQa.failures.length === 0 && preferredQa.warnings.length === 0) {
    return ensureSpokenOutro(preferred);
  }

  if (fallback && fallback !== preferred) {
    const fallbackQa = runBrandNameQa({ full_script: fallback });
    if (fallbackQa.failures.length === 0 && fallbackQa.warnings.length === 0) {
      console.log(
        `[audio] ${story?.id || "story"}: cached tts_script failed brand-name QA; using clean full_script`,
      );
      return ensureSpokenOutro(fallback);
    }

    if (
      preferredQa.failures.length > 0 &&
      fallbackQa.failures.length === 0
    ) {
      console.log(
        `[audio] ${story?.id || "story"}: cached tts_script has protected-name damage; using safer full_script`,
      );
      return ensureSpokenOutro(fallback);
    }
  }

  return ensureSpokenOutro(preferred);
}

const SPOKEN_OUTRO = "Follow Pulse Gaming so you never miss a beat.";

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function insertBeforeSpokenOutro(script, insertion) {
  const cleanScript = String(script || "").trim();
  const cleanInsertion = String(insertion || "").trim();
  if (!cleanScript) return cleanInsertion ? ensureSpokenOutro(cleanInsertion) : SPOKEN_OUTRO;
  if (!cleanInsertion) return ensureSpokenOutro(cleanScript);

  const outroRe = /\s*Follow Pulse Gaming so you never miss a beat\.?\s*$/i;
  if (outroRe.test(cleanScript)) {
    const withoutOutro = cleanScript.replace(outroRe, "").trim();
    return `${withoutOutro} ${cleanInsertion} ${SPOKEN_OUTRO}`.replace(/\s+/g, " ").trim();
  }

  return `${cleanScript} ${cleanInsertion} ${SPOKEN_OUTRO}`
    .replace(/\s+/g, " ")
    .trim();
}

function ensureSpokenOutro(script) {
  const cleanScript = String(script || "").trim();
  if (!cleanScript) return SPOKEN_OUTRO;
  const outroRe = /Follow Pulse Gaming so you never miss a beat\.?\s*$/i;
  if (outroRe.test(cleanScript)) return cleanScript;
  return `${cleanScript} ${SPOKEN_OUTRO}`.replace(/\s+/g, " ").trim();
}

function buildDeterministicDurationPadding(story, { attempt = 1 } = {}) {
  const haystack = `${story?.title || ""} ${story?.full_script || ""}`.toLowerCase();
  const lines = [];

  if (/\bnot (?:confirmed|a confirmed|a promise)|\bno (?:date|timeline|release date)|\bhypothetical\b/.test(haystack)) {
    lines.push(
      "That caveat matters, because an interview idea is not the same thing as a dated feature announcement.",
    );
  } else if (/\breportedly|\brumou?r|\bsources?\b/.test(haystack)) {
    lines.push(
      "That means the claim still needs official confirmation before players treat it as locked in.",
    );
  } else {
    lines.push(
      "The important point is the direction of travel, not just the headline itself.",
    );
  }

  if (/\bdeveloper|\bcreator|\bdirector|\bproducer|\bexecutive|\bceo\b/.test(haystack)) {
    lines.push(
      "Because this came from a named person close to the project, it carries more weight than anonymous speculation.",
    );
  } else {
    lines.push(
      "The next thing to watch is whether an official post, platform listing or patch note backs it up.",
    );
  }

  if (attempt > 1) {
    lines.push(
      "For Pulse, that means tracking the official follow-up before calling it a guaranteed change.",
    );
  } else {
    lines.push(
      "For players, the safest read is signal first, certainty later.",
    );
  }

  return lines.join(" ");
}

function buildDeterministicDurationRewrite(story, { attempt = 1 } = {}) {
  const base = firstNonBlank(story?.full_script, story?.tts_script, story?.body, story?.hook);
  const padding = buildDeterministicDurationPadding(story, { attempt });
  const fullScript = insertBeforeSpokenOutro(base || "", padding);
  return {
    full_script: fullScript,
    word_count: wordCount(fullScript),
  };
}

const BUMPER_DURATION = 0; // bumpers removed - audio must hit 61s on its own
const MIN_TOTAL_DURATION = 61; // TikTok Creator Rewards minimum
const MAX_FLASH_TOTAL_DURATION = 75;
const MAX_EXTENDED_TOTAL_DURATION = 90;

function storyIsApprovedForExtendedShort(story = {}) {
  if (story.approved !== true && story.auto_approved !== true) return false;
  const type = String(story.story_type || story.content_type || "").toLowerCase();
  if (type.includes("off_brand")) return false;
  return true;
}

function markStoryAsExtendedShort(story, runtimePlan = {}, reason = "local_tts_extended_short") {
  story.duration_lane = "pulse_extended_short";
  story.runtime_lane = "pulse_extended_short";
  story.runtime_route = "extended_short";
  story.short_runtime_plan = {
    ...runtimePlan,
    result: runtimePlan.result === "fail" ? "review" : runtimePlan.result || "review",
    route: "extended_short",
    shouldGenerateShortAudio: true,
    maxSeconds: MAX_EXTENDED_TOTAL_DURATION,
    reviewMaxSeconds: MAX_EXTENDED_TOTAL_DURATION,
    extended_short_auto_promoted: true,
    extended_short_reason: reason,
  };
  story.qa_warnings = Array.from(
    new Set([...(story.qa_warnings || []), `extended_short_auto_promoted:${reason}`]),
  );
  return story.short_runtime_plan;
}

function shouldAutoPromoteRuntimePlanToExtendedShort({
  provider = process.env.TTS_PROVIDER || "elevenlabs",
  story,
  runtimePlan = {},
} = {}) {
  if (!isLocalTtsProvider(provider)) return false;
  if (!storyIsApprovedForExtendedShort(story)) return false;
  const estimated = Number(runtimePlan.estimatedSeconds);
  if (!Number.isFinite(estimated)) return false;
  if (estimated <= MAX_FLASH_TOTAL_DURATION || estimated > MAX_EXTENDED_TOTAL_DURATION) {
    return false;
  }
  return runtimePlan.route === "extended_or_briefing";
}

function shouldAutoPromoteGeneratedAudioToExtendedShort({
  provider = process.env.TTS_PROVIDER || "elevenlabs",
  story,
  runtimePlan = {},
  totalDuration,
} = {}) {
  if (!isLocalTtsProvider(provider)) return false;
  if (!storyIsApprovedForExtendedShort(story)) return false;
  if (runtimePlan.shouldGenerateShortAudio === false) return false;
  const total = Number(totalDuration);
  if (!Number.isFinite(total)) return false;
  return total > MAX_FLASH_TOTAL_DURATION && total <= MAX_EXTENDED_TOTAL_DURATION;
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
      env.LOCAL_TTS_TIMEOUT_MS || env.STUDIO_V2_LOCAL_TTS_TIMEOUT_MS || 300000,
    );
    return Number.isFinite(value) && value > 0 ? value : 300000;
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
      env.STUDIO_V2_LOCAL_TTS_BASE_SPEED,
    1.0,
  );
  const minRequestRate = clamp(
    finiteNumber(
      env.LOCAL_TTS_MIN_SPEAKING_RATE ||
        env.STUDIO_V2_LOCAL_TTS_MIN_SPEAKING_RATE,
      0.7,
    ),
    0.5,
    1.0,
  );
  const effectiveCap = finiteNumber(
    env.LOCAL_TTS_EFFECTIVE_RATE_CAP ||
      env.STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP,
    1.0,
  );
  const serverBase = baseSpeed > 0 ? baseSpeed : 1.0;
  const maxRequestRate = clamp(effectiveCap / serverBase, minRequestRate, 1.25);
  return clamp(requested, minRequestRate, maxRequestRate);
}

function resolveVoiceSettingsForProvider(
  provider,
  baseSettings,
  rateOverride,
  env = process.env,
) {
  const settings = Object.assign({}, baseSettings || {});
  if (rateOverride !== undefined) {
    settings.speaking_rate = rateOverride;
  }
  if (String(provider || "").toLowerCase() === "local") {
    settings.speaking_rate = resolveLocalTtsSpeakingRate(
      settings.speaking_rate,
      env,
    );
  }
  return settings;
}

function isRetryableLocalTtsError(err) {
  const code = String(err?.code || "").toUpperCase();
  const message = String(err?.message || "");
  return (
    code === "ECONNRESET" ||
    /ECONNRESET|socket hang up/i.test(message)
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseLocalVoiceDiagnostics(diagnostics = null) {
  if (!diagnostics || typeof diagnostics !== "object") return null;
  const metrics = diagnostics.metrics || diagnostics.acoustic || diagnostics;
  const acoustic = {
    medianPitchHz: numberOrNull(
      metrics.medianPitchHz ??
        metrics.meanPitchHz ??
        metrics.pitchHz ??
        metrics.f0MedianHz ??
        metrics.median_f0_hz,
    ),
    p10PitchHz: numberOrNull(metrics.p10PitchHz ?? metrics.p10_f0_hz),
    p90PitchHz: numberOrNull(metrics.p90PitchHz ?? metrics.p90_f0_hz),
    centroidHz: numberOrNull(metrics.centroidHz ?? metrics.centroid_hz),
    durationSeconds: numberOrNull(metrics.durationSeconds ?? metrics.duration_s),
  };
  return {
    ...diagnostics,
    metrics,
    acoustic,
  };
}

async function requestTtsWithRetry({
  provider,
  requestConfig,
  request = axios,
  attempts,
  retryDelayMs = Number(process.env.LOCAL_TTS_RETRY_DELAY_MS || 1500),
  log = console.log,
} = {}) {
  const isLocal = String(provider || "").toLowerCase() === "local";
  const maxAttempts = isLocal
    ? Math.max(
        1,
        Math.trunc(
          Number(attempts || process.env.LOCAL_TTS_REQUEST_ATTEMPTS || 2),
        ),
      )
    : 1;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await request(requestConfig);
    } catch (err) {
      lastError = err;
      const retryable = isLocal && isRetryableLocalTtsError(err);
      if (!retryable || attempt >= maxAttempts) throw err;
      if (typeof log === "function") {
        log(
          `[audio] local TTS request dropped (${err.message}); retrying ${attempt + 1}/${maxAttempts}`,
        );
      }
      await delay(retryDelayMs);
    }
  }
  throw lastError;
}

function safeAudioErrorMessage(err) {
  return String(err?.message || err || "audio generation failed")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function markAudioGenerationFailure(
  story,
  err,
  {
    provider = process.env.TTS_PROVIDER || "elevenlabs",
    now = () => new Date(),
  } = {},
) {
  const normalisedProvider = String(provider || "").toLowerCase();
  const failure =
    normalisedProvider === "local"
      ? classifyLocalTtsFailure(err)
      : {
          code: "audio_generation_failed",
          message: safeAudioErrorMessage(err),
          requires_server_reset: false,
        };
  const code = failure.code || "audio_generation_failed";
  const message = failure.message || safeAudioErrorMessage(err);
  const failedAt = now().toISOString();

  if (story && typeof story === "object") {
    story.qa_failed = true;
    story.qa_failures = [`audio_generation_failed:${code}`];
    story.qa_warnings = story.qa_warnings || [];
    story.qa_failed_at = failedAt;
    story.publish_status = "failed";
    story.publish_error = `audio_generation_failed: ${code}: ${message}`.slice(0, 280);
    story.audio_generation_failure = {
      provider: normalisedProvider,
      code,
      message,
      at: failedAt,
    };
    if (normalisedProvider === "local") {
      story.local_tts_failure = {
        code,
        message,
        requires_server_reset: failure.requires_server_reset === true,
        at: failedAt,
      };
    }
  }

  return failure;
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
function prepareTtsAlignmentForWrite({
  provider,
  alignment,
  text,
  durationSeconds,
} = {}) {
  const normalisedProvider = String(provider || "").toLowerCase();
  const originalAlignment =
    alignment && typeof alignment === "object" ? alignment : {};
  const existingMeta =
    originalAlignment.meta && typeof originalAlignment.meta === "object"
      ? originalAlignment.meta
      : {};

  if (normalisedProvider !== "local") {
    return {
      alignment: originalAlignment,
      repair: { repaired: false, reason: null },
    };
  }

  const repaired = repairTimestampAlignment({
    alignment: originalAlignment,
    text,
    duration: durationSeconds,
  });

  if (!repaired.repaired || repaired.inspection?.usable !== true) {
    return {
      alignment: {
        ...originalAlignment,
        meta: existingMeta,
      },
      repair: {
        repaired: false,
        reason: null,
        inspection: repaired.inspection,
        originalInspection: repaired.originalInspection,
      },
    };
  }

  return {
    alignment: {
      ...repaired.alignment,
      meta: {
        ...existingMeta,
        timestampRepair: {
          repaired: true,
          reason: repaired.repairReason,
          strategy: repaired.repairStrategy,
          originalInspection: repaired.originalInspection,
          repairedInspection: repaired.inspection,
        },
      },
    },
    repair: {
      repaired: true,
      reason: repaired.repairReason,
      strategy: repaired.repairStrategy,
      inspection: repaired.inspection,
      originalInspection: repaired.originalInspection,
    },
  };
}

async function generateTTS(text, outputPath, rateOverride) {
  const provider = (process.env.TTS_PROVIDER || "elevenlabs").toLowerCase();
  const voiceId = resolveTtsVoiceIdForProvider(provider, process.env, brand);
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

  const data = {
    text,
    voice_settings: resolvedVoiceSettings,
    output_format: resolveTtsOutputFormat(provider, process.env),
  };
  if (provider !== "local") {
    data.model_id = brand.voiceModel || "eleven_multilingual_v2";
  }

  if (provider === "local") {
    await assertLocalTtsGpuReady({
      env: process.env,
      execFileImpl: execFile,
    });
  }

  const response = await requestTtsWithRetry({
    provider,
    requestConfig: {
      method: "POST",
      url: `${baseUrl}/v1/text-to-speech/${voiceId}/with-timestamps`,
      headers,
      data,
      timeout: resolveTtsTimeoutMs(provider),
    },
  });

  // outputPath is the repo-relative path the caller passes in
  // (e.g. `output/audio/abc.mp3`). writeTarget is where it
  // actually lands on disk — under MEDIA_ROOT in production,
  // under the repo root in local dev.
  const writeTarget = mediaPaths.writePath(outputPath);
  await fs.ensureDir(path.dirname(writeTarget));

  const audioBase64 = response.data.audio_base64;
  if (!audioBase64) {
    throw new Error(
      `[audio] ${provider} returned no audio_base64 - check ${baseUrl} health`,
    );
  }
  await fs.writeFile(writeTarget, Buffer.from(audioBase64, "base64"));
  const voiceMastering = shouldMasterTtsAudio({ provider, env: process.env })
    ? await masterTtsAudioFile({
        inputPath: writeTarget,
        execFileAsync,
        env: process.env,
        log: console.log,
      })
    : { ok: false, code: "voice_mastering_disabled" };
  if (voiceMastering.ok) {
    console.log(
      `[audio] Voice mastered for crisp social playback: ${outputPath} (${voiceMastering.targetLufs} LUFS target)`,
    );
  }

  const voiceDiagnostics = normaliseLocalVoiceDiagnostics(
    response.data.voice_diagnostics || response.data.voiceDiagnostics,
  );
  const audioDurationForAlignment = await getAudioDuration(outputPath);
  const preparedAlignment = prepareTtsAlignmentForWrite({
    provider,
    alignment: response.data.alignment || {},
    text,
    durationSeconds: audioDurationForAlignment,
  });
  const timestampsPath = outputPath.replace(/\.mp3$/, "_timestamps.json");
  const timestampsWriteTarget = mediaPaths.writePath(timestampsPath);
  const alignment = preparedAlignment.alignment || {};
  alignment.meta = buildTtsAlignmentMeta({
    existingMeta: alignment.meta || {},
    provider,
    voiceId,
    baseUrl,
    text,
    resolvedVoiceSettings,
    voiceDiagnostics,
  });
  if (preparedAlignment.repair?.repaired) {
    alignment.meta.timestampRepair = {
      ...(alignment.meta.timestampRepair || {}),
      provider,
      repairedAt: new Date().toISOString(),
    };
  }
  alignment.meta.voiceMastering = voiceMastering;
  if (voiceMastering.acoustic) {
    alignment.meta.acoustic = {
      ...(alignment.meta.acoustic || {}),
      ...voiceMastering.acoustic,
    };
  }
  await fs.writeJson(timestampsWriteTarget, alignment, { spaces: 2 });

  // Return the repo-relative path so callers and the DB continue
  // to treat the story.audio_path field as location-independent.
  return outputPath;
}

function recordLocalTtsAttempt(story, label, attempt = {}) {
  if (!story || typeof story !== "object" || !attempt) return;
  story.local_tts_attempts = Array.isArray(story.local_tts_attempts)
    ? story.local_tts_attempts
    : [];
  story.local_tts_attempts.push({
    label: label || null,
    ok: attempt.ok === true,
    attempts: attempt.attempts || 1,
    failure_code: attempt.failure?.code || null,
    recovery: attempt.recovery || null,
    at: new Date().toISOString(),
  });
}

async function generateTtsForStory({
  story,
  text,
  outputPath,
  rate,
  label = "full",
  provider = process.env.TTS_PROVIDER || "elevenlabs",
  recoverLocalTts = null,
  generateTts = generateTTS,
} = {}) {
  if (!isLocalTtsProvider(provider)) {
    await generateTts(text, outputPath, rate);
    return { ok: true, attempts: 1, recovery: null };
  }

  const attempt = await generateLocalTtsWithOptionalRecovery({
    storyId: story?.id,
    text,
    outputRel: outputPath,
    rate,
    generateTts,
    recoverLocalTts,
  });
  recordLocalTtsAttempt(story, label, attempt);
  if (attempt.ok) return attempt;

  const failure = attempt.failure || {};
  const message = [
    "local_tts_generation_failed",
    failure.code || "tts_failed",
    failure.message || attempt.error || "local TTS generation failed",
  ].join(":");
  const err = new Error(message);
  err.code = failure.code || "tts_failed";
  err.localTtsAttempt = attempt;
  throw err;
}

async function generateAudio() {
  console.log("[audio] Loading stories from canonical store...");

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

  const toProcess = applyProduceSelection(
    stories.filter((s) => s.approved === true && !s.audio_path),
    { stage: "audio", log: console.log },
  );

  console.log(`[audio] ${toProcess.length} stories need audio generation`);
  const provider = process.env.TTS_PROVIDER || "elevenlabs";
  const localVoiceId = isLocalTtsProvider(provider)
    ? resolveTtsVoiceIdForProvider(provider, process.env, brand)
    : null;
  const recoverLocalTts = localVoiceId
    ? createLocalTtsBatchRecovery({
        root: __dirname,
        env: process.env,
        voiceId: localVoiceId,
      })
    : null;

  for (const story of toProcess) {
    console.log(`[audio] Generating audio for: ${story.title}`);
    let regenAttempts = 0;
    const MAX_REGEN = 2;

    try {
      // Clean TTS script using shared cleaning function
      const rawTTS = selectRawTtsScript(story);
      const ttsText = cleanForTTS(rawTTS);
      let finalTtsScript = ttsText;
      assertBrandNameQaForTts(story, {
        full_script: story.full_script,
        tts_script: ttsText,
      });

      let runtimePlan = classifyShortScriptRuntime({
        text: ttsText,
        story,
        secondsPerWord: secondsPerWordForTtsProvider(
          process.env.TTS_PROVIDER || "elevenlabs",
          process.env,
        ),
      });
      const runtimeSecondsPerWord = runtimePlan.estimatedSeconds
        ? runtimePlan.estimatedSeconds / Math.max(1, runtimePlan.wordCount)
        : secondsPerWordForTtsProvider(process.env.TTS_PROVIDER || "elevenlabs", process.env);
      story.short_runtime_plan = runtimePlan;
      if (
        runtimePlan.shouldGenerateShortAudio === false &&
        shouldAutoPromoteRuntimePlanToExtendedShort({ provider, story, runtimePlan })
      ) {
        runtimePlan = markStoryAsExtendedShort(
          story,
          runtimePlan,
          "local_tts_estimated_76_to_90s",
        );
        console.log(
          `[audio] ${story.id}: promoting approved local Liam script to Extended Short ` +
            `(est=${runtimePlan.estimatedSeconds || "?"}s, max=${MAX_EXTENDED_TOTAL_DURATION}s)`,
        );
      }
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
      if (shouldUseDynamicPacingForProvider(provider) && story.hook && story.body && story.cta) {
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
            await generateTtsForStory({
              story,
              text: seg.text,
              outputPath: segPath,
              rate: seg.rate,
              label: seg.label,
              provider,
              recoverLocalTts,
            });
            segmentPaths.push(segPath);
          }
          await concatAudioFiles(segmentPaths, outputPath);

          // Merge segment timestamps into a single combined file
          // Each segment's timestamps start from 0, so offset by cumulative duration
          const mergedChars = [];
          const mergedStarts = [];
          const mergedEnds = [];
          const segmentMetas = [];
          let cumulativeOffset = 0;
          for (const sp of segmentPaths) {
            const tsPath = sp.replace(/\.mp3$/, "_timestamps.json");
            const tsAbs = (await mediaPaths.resolveExisting(tsPath)) || tsPath;
            if (await fs.pathExists(tsAbs)) {
              try {
                const ts = await fs.readJson(tsAbs);
                if (ts.meta && typeof ts.meta === "object") {
                  segmentMetas.push(ts.meta);
                }
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
            const firstMeta = segmentMetas.find(Boolean) || {};
            await fs.writeJson(
              mediaPaths.writePath(combinedTsPath),
              {
                characters: mergedChars,
                character_start_times_seconds: mergedStarts,
                character_end_times_seconds: mergedEnds,
                meta: buildTtsAlignmentMeta({
                  existingMeta: firstMeta,
                  provider: process.env.TTS_PROVIDER || "elevenlabs",
                  voiceId: resolveTtsVoiceIdForProvider(
                    process.env.TTS_PROVIDER || "elevenlabs",
                    process.env,
                    brand,
                  ),
                  baseUrl:
                    (process.env.TTS_PROVIDER || "elevenlabs").toLowerCase() ===
                    "local"
                      ? process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765"
                      : "https://api.elevenlabs.io",
                  text: segments.map((segment) => segment.text).join(" "),
                  resolvedVoiceSettings: {
                    speaking_rate: baseRate,
                  },
                  voiceDiagnostics:
                    firstMeta.voiceDiagnostics || firstMeta.voice_diagnostics || null,
                }),
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
          await generateTtsForStory({
            story,
            text: ttsText,
            outputPath,
            label: "single",
            provider,
            recoverLocalTts,
          });
        }
      } else {
        await generateTtsForStory({
          story,
          text: ttsText,
          outputPath,
          label: "full",
          provider,
          recoverLocalTts,
        });
      }

      // Duration enforcement - check if video will clear 61s
      let audioDuration = await getAudioDuration(outputPath);
      let totalDuration = audioDuration + BUMPER_DURATION;
      story.audio_duration = audioDuration;

      while (totalDuration < MIN_TOTAL_DURATION && regenAttempts < MAX_REGEN) {
        regenAttempts++;
        console.log(
          `[audio] WARNING: ${story.id} is ${totalDuration.toFixed(1)}s (need ${MIN_TOTAL_DURATION}s). Regenerating longer script (attempt ${regenAttempts}/${MAX_REGEN})...`,
        );

        let newScript;
        if (!isTruthy(process.env.ALLOW_LLM_DURATION_REWRITE)) {
          newScript = buildDeterministicDurationRewrite(story, {
            attempt: regenAttempts,
          });
          console.log(
            `[audio] ${story.id}: using deterministic duration padding (set ALLOW_LLM_DURATION_REWRITE=true to permit model rewrites)`,
          );
        } else {
          // Regenerate with a longer target. This is opt-in because a
          // model rewrite can strengthen claims while trying to add
          // words. Default to deterministic padding so public facts stay
          // anchored to the already-approved script.
          const { createLlmClient } = require("./lib/llm-client");
          const { getChannel } = require("./channels");
          const channel = getChannel();
          const client = createLlmClient();
          const basePrompt =
            channel.systemPrompt ||
            (await fs.readFile("system_prompt.txt", "utf-8"));

          const response = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1200,
            system: basePrompt,
            messages: [
              {
                role: "user",
                content: `Rewrite this script to be ${runtimePlan.minWords}-${runtimePlan.maxWords} spoken words for a 61-75 second gaming Short. It was too short at ${story.word_count} words.\n\n${story.full_script}\n\nStory: ${story.title}\nKeep the same classification: ${story.classification}. Keep the CTA exactly: Follow Pulse Gaming so you never miss a beat.`,
              },
            ],
          });

          let text = response.content[0].text.trim();
          if (text.startsWith("```")) {
            text = text
              .replace(/^```(?:json)?\s*\n?/, "")
              .replace(/\n?```\s*$/, "");
          }
          newScript = JSON.parse(text);
        }

        try {
          const newTTS = cleanForTTS(newScript.full_script);
          assertBrandNameQaForTts(story, {
            full_script: newScript.full_script,
            tts_script: newTTS,
          });
          const newRuntimePlan = classifyShortScriptRuntime({
            text: newTTS,
            story,
            secondsPerWord: runtimeSecondsPerWord,
          });
          if (newRuntimePlan.shouldGenerateShortAudio === false) {
            throw new Error(
              `regenerated_script_runtime_invalid:${newRuntimePlan.failures[0] || newRuntimePlan.warnings[0] || "unknown"}`,
            );
          }

          await generateTtsForStory({
            story,
            text: newTTS,
            outputPath,
            label: "regen",
            provider,
            recoverLocalTts,
          });
          const newDuration = await getAudioDuration(outputPath);
          audioDuration = newDuration;
          totalDuration = newDuration + BUMPER_DURATION;
          story.audio_duration = newDuration;
          story.full_script = newScript.full_script;
          story.tts_script = newTTS;
          finalTtsScript = newTTS;
          story.word_count = newScript.word_count || story.word_count;
          console.log(
            `[audio] Regenerated: now ${(newDuration + BUMPER_DURATION).toFixed(1)}s`,
          );
        } catch (parseErr) {
          console.log(
            `[audio] Regen parse failed, keeping original: ${parseErr.message}`,
          );
          story.duration_warning = true;
          break;
        }
      }

      if (totalDuration < MIN_TOTAL_DURATION) {
        console.log(
          `[audio] WARNING: ${story.id} is ${totalDuration.toFixed(1)}s (need ${MIN_TOTAL_DURATION}s) but max regen attempts (${MAX_REGEN}) reached - accepting as-is`,
        );
        story.duration_warning = true;
      } else {
        console.log(`[audio] Duration OK: ${totalDuration.toFixed(1)}s`);
      }

      let maxTotalDuration =
        Number.isFinite(Number(runtimePlan.maxSeconds)) && runtimePlan.maxSeconds > 0
          ? Number(runtimePlan.maxSeconds)
          : runtimePlan.route === "extended_short"
            ? MAX_EXTENDED_TOTAL_DURATION
            : MAX_FLASH_TOTAL_DURATION;
      let durationLaneLabel =
        runtimePlan.route === "extended_short" ? "Extended Short" : "Flash Lane";
      if (
        totalDuration > maxTotalDuration &&
        shouldAutoPromoteGeneratedAudioToExtendedShort({
          provider,
          story,
          runtimePlan,
          totalDuration,
        })
      ) {
        runtimePlan = markStoryAsExtendedShort(
          story,
          runtimePlan,
          "local_tts_actual_76_to_90s",
        );
        maxTotalDuration = MAX_EXTENDED_TOTAL_DURATION;
        durationLaneLabel = "Extended Short";
        console.log(
          `[audio] ${story.id}: generated local Liam audio landed at ${totalDuration.toFixed(1)}s; ` +
            `promoting to deliberate Extended Short instead of failing Flash Lane`,
        );
      }
      if (totalDuration > maxTotalDuration) {
        const reason = `audio_duration_too_long (${totalDuration.toFixed(2)}s, max ${maxTotalDuration.toFixed(2)}s)`;
        console.log(
          `[audio] ${story.id}: generated audio exceeds ${durationLaneLabel} contract, blocking before render: ${reason}`,
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

      story.audio_path = outputPath;
      story.tts_script = finalTtsScript;
      console.log(`[audio] Saved: ${outputPath}`);
    } catch (err) {
      console.log(`[audio] ERROR for ${story.id}: ${err.message}`);
      markAudioGenerationFailure(story, err, {
        provider: process.env.TTS_PROVIDER || "elevenlabs",
      });
    }
  }

  await db.saveStories(stories);
  console.log("[audio] Stories updated");
}

module.exports = generateAudio;
module.exports.getAudioDuration = getAudioDuration;
module.exports.cleanForTTS = cleanForTTS;
module.exports.generateTTS = generateTTS;
module.exports.buildTtsAlignmentMeta = buildTtsAlignmentMeta;
module.exports.concatAudioFiles = concatAudioFiles;
module.exports.resolveTtsTimeoutMs = resolveTtsTimeoutMs;
module.exports.resolveLocalTtsSpeakingRate = resolveLocalTtsSpeakingRate;
module.exports.resolveVoiceSettingsForProvider = resolveVoiceSettingsForProvider;
module.exports.isRetryableLocalTtsError = isRetryableLocalTtsError;
module.exports.requestTtsWithRetry = requestTtsWithRetry;
module.exports.normaliseLocalVoiceDiagnostics = normaliseLocalVoiceDiagnostics;
module.exports.resolveTtsVoiceIdForProvider = resolveTtsVoiceIdForProvider;
module.exports.markAudioGenerationFailure = markAudioGenerationFailure;
module.exports.generateTtsForStory = generateTtsForStory;
module.exports.isLocalTtsProvider = isLocalTtsProvider;
module.exports.shouldUseDynamicPacingForProvider = shouldUseDynamicPacingForProvider;
module.exports.shouldAutoPromoteRuntimePlanToExtendedShort =
  shouldAutoPromoteRuntimePlanToExtendedShort;
module.exports.shouldAutoPromoteGeneratedAudioToExtendedShort =
  shouldAutoPromoteGeneratedAudioToExtendedShort;
module.exports.markStoryAsExtendedShort = markStoryAsExtendedShort;
module.exports.resolveTtsOutputFormat = resolveTtsOutputFormat;
module.exports.prepareTtsAlignmentForWrite = prepareTtsAlignmentForWrite;
module.exports.assertBrandNameQaForTts = assertBrandNameQaForTts;
module.exports.selectRawTtsScript = selectRawTtsScript;
module.exports.buildDeterministicDurationPadding = buildDeterministicDurationPadding;
module.exports.buildDeterministicDurationRewrite = buildDeterministicDurationRewrite;
module.exports.insertBeforeSpokenOutro = insertBeforeSpokenOutro;
module.exports.ensureSpokenOutro = ensureSpokenOutro;

if (require.main === module) {
  generateAudio().catch((err) => {
    console.log(`[audio] ERROR: ${err.message}`);
    process.exit(1);
  });
}
