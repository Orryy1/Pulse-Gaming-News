"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("fs-extra");

const mediaPaths = require("./media-paths");
const { wordsFromAlignment } = require("./studio/sound-layer");
const { normaliseText } = require("./text-hygiene");
const { summariseElevenLabsTts } = require("./goal-audio-timestamp-workbench");
const { anchorSubtitleWordsToAudioSilences } = require("./subtitle-timing");
const { alignWordsWithLocalWhisper } = require("./local-whisper-word-aligner");

const execFileAsync = promisify(execFile);
const MAX_SAFE_ASR_INSERTED_WORDS = 0;
const MAX_SAFE_LONG_SCRIPT_ASR_INSERTED_WORDS = 3;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isTruthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || ""));
}

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function shouldPromoteGeneratedMediaRoot(workspaceRoot, options = {}) {
  if (options.promoteGeneratedMediaRoot != null) return isTruthy(options.promoteGeneratedMediaRoot);
  return path.resolve(workspaceRoot || "") === repoRoot();
}

function whisperModelCandidates() {
  const configured = cleanText(process.env.LOCAL_WHISPER_MODELS || process.env.LOCAL_WHISPER_MODEL || "tiny.en");
  const models = configured
    .split(/[;,]/)
    .map((model) => cleanText(model))
    .filter(Boolean);
  return models.length ? Array.from(new Set(models)) : ["tiny.en"];
}

function requiresWhisperWordAlignment(mode) {
  return ["whisper", "auto", "local_whisper", "asr"].includes(cleanText(mode).toLowerCase());
}

function cleanPublicText(value) {
  return cleanText(normaliseText(value));
}

function cleanSpokenTextForTts(value) {
  const audio = require("../audio");
  return cleanText(audio.cleanForTTS(value));
}

function safeId(value) {
  return cleanText(value)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function relAudioPath(storyId) {
  return `output/audio/${safeId(storyId)}.mp3`;
}

function relTimestampPath(storyId) {
  return `output/audio/${safeId(storyId)}_timestamps.json`;
}

function resolvedPathOrNull(value) {
  const text = cleanText(value);
  return text ? path.resolve(text) : null;
}

function timestampInfoFromPayload(payload = {}, words = []) {
  const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
  return {
    word_count: Array.isArray(words) ? words.length : asArray(payload?.words).length,
    word_timestamp_source: cleanText(meta.wordTimestampSource || payload?.wordTimestampSource) || null,
    timestamp_whisper_alignment: meta.timestampWhisperAlignment || payload?.timestampWhisperAlignment || null,
  };
}

function narrationRightsRecord({ storyId = "", provider = "local", audioPath = "" } = {}) {
  const id = safeId(storyId) || "story";
  const selectedProvider = cleanText(provider).toLowerCase();
  const elevenLabs = selectedProvider.includes("elevenlabs");
  return {
    asset_id: `${id}_audio_path`,
    asset_type: "narration_audio",
    kind: "audio",
    path: audioPath || relAudioPath(id),
    source_url: elevenLabs ? `elevenlabs://pulse-gaming/${id}` : `local://pulse-local-tts/${id}`,
    source_type: elevenLabs ? "elevenlabs_tts_voice" : "local_tts_voice",
    licence_basis: elevenLabs ? "elevenlabs_commercial_tts_generation" : "owned_local_voice_model",
    allowed_use: "short_form_editorial_narration",
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
    commercial_use_allowed: true,
    transformation_notes: "Narration generated for the governed Pulse Gaming story package.",
    expiry: null,
    credit_required: false,
    evidence_reference: elevenLabs ? "rights/elevenlabs-commercial-tts.json" : "rights/local-tts-liam.json",
    risk_score: elevenLabs ? 0.08 : 0.05,
    approval_status: "approved",
  };
}

function upsertRecord(records = [], record = {}) {
  const next = asArray(records).filter((entry) => {
    const sameId = cleanText(entry.asset_id || entry.id) === cleanText(record.asset_id);
    const samePath = cleanText(entry.path || entry.local_path) === cleanText(record.path);
    return !sameId && !samePath;
  });
  next.push(record);
  return next;
}

async function updateNarrationRightsLedger({
  artifactDir,
  storyId,
  provider = "local",
  audioPath = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!artifactDir || !storyId) return null;
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  if (!(await fs.pathExists(rightsPath))) return null;
  const current = await readJsonIfPresent(rightsPath, null);
  if (!current) return null;
  const record = narrationRightsRecord({ storyId, provider, audioPath });
  if (Array.isArray(current)) {
    const updated = upsertRecord(current, record);
    await fs.writeJson(rightsPath, updated, { spaces: 2 });
    return { rightsPath, record };
  }
  if (current && typeof current === "object") {
    const records = upsertRecord(current.records || current.rights_ledger, record);
    const matchedAssets = upsertRecord(current.matched_assets || [], {
      asset_id: record.asset_id,
      kind: record.kind,
      path: record.path,
      source_url: record.source_url,
      rights_record_id: record.asset_id,
      licence_basis: record.licence_basis,
      risk_score: record.risk_score,
    });
    await fs.writeJson(
      rightsPath,
      {
        ...current,
        records,
        matched_assets: matchedAssets,
        narration_rights_updated_at: generatedAt,
      },
      { spaces: 2 },
    );
    return { rightsPath, record };
  }
  return null;
}

function timeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function absFromWorkspace(workspaceRoot, relPath) {
  return path.resolve(workspaceRoot, relPath.replace(/[\\/]/g, path.sep));
}

async function resolveGeneratedMediaPath(workspaceRoot, relPath) {
  const workspacePath = absFromWorkspace(workspaceRoot, relPath);
  const mediaPath = await mediaPaths.resolveExisting(relPath).catch(() => null);
  if (mediaPath && (await fs.pathExists(mediaPath))) return mediaPath;
  if (await fs.pathExists(workspacePath)) return workspacePath;
  return mediaPath || workspacePath;
}

async function mirrorGeneratedMediaPath(workspaceRoot, relPath) {
  const sourcePath = await resolveGeneratedMediaPath(workspaceRoot, relPath);
  const mediaPath = mediaPaths.writePath(relPath);
  if (
    cleanText(sourcePath) &&
    cleanText(mediaPath) &&
    path.resolve(sourcePath) !== path.resolve(mediaPath) &&
    (await fs.pathExists(sourcePath))
  ) {
    await fs.ensureDir(path.dirname(mediaPath));
    await fs.copy(sourcePath, mediaPath, { overwrite: true });
  }
  return (await fs.pathExists(mediaPath)) ? mediaPath : sourcePath;
}

async function statFileIfPresent(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  const stat = await fs.stat(filePath);
  return stat.isFile() ? stat : null;
}

async function promoteWorkspaceGeneratedMediaPath(workspaceRoot, relPath, options = {}) {
  const workspacePath = absFromWorkspace(workspaceRoot, relPath);
  const mediaPath = mediaPaths.writePath(relPath);
  if (await fs.pathExists(workspacePath)) {
    if (shouldPromoteGeneratedMediaRoot(workspaceRoot, options)) {
      const workspaceStat = await statFileIfPresent(workspacePath);
      const mediaStat = await statFileIfPresent(mediaPath);
      if (mediaStat && (!workspaceStat || mediaStat.mtimeMs >= workspaceStat.mtimeMs)) {
        return mediaPath;
      }
      if (path.resolve(workspacePath) !== path.resolve(mediaPath)) {
        await fs.ensureDir(path.dirname(mediaPath));
        await fs.copy(workspacePath, mediaPath, { overwrite: true });
      }
      return (await fs.pathExists(mediaPath)) ? mediaPath : workspacePath;
    }
    return workspacePath;
  }
  return resolveGeneratedMediaPath(workspaceRoot, relPath);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function usableWord(word = {}) {
  return (
    cleanText(word.word || word.text) !== "" &&
    Number.isFinite(Number(word.start)) &&
    Number.isFinite(Number(word.end)) &&
    Number(word.end) >= Number(word.start)
  );
}

function repairTinyWordSpans(words = [], { minDurationS = 0.08, durationS = null } = {}) {
  const minDuration = Number.isFinite(Number(minDurationS)) && Number(minDurationS) > 0
    ? Number(minDurationS)
    : 0.08;
  const duration = Number.isFinite(Number(durationS)) && Number(durationS) > 0
    ? Number(durationS)
    : null;
  let repairedCount = 0;
  const repaired = asArray(words).map((word) => {
    const start = Number(word.start);
    let end = Number(word.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return word;
    }
    if (end - start < minDuration) {
      end = start + minDuration;
      if (duration != null) end = Math.min(duration, end);
      end = Math.max(end, start);
      if (end !== Number(word.end)) repairedCount += 1;
    }
    return {
      ...word,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
    };
  });
  return {
    words: repaired,
    repaired: repairedCount > 0,
    repaired_count: repairedCount,
    min_duration_s: minDuration,
  };
}

function clampWordsToDuration(words = [], { durationS = null, minDurationS = 0.04 } = {}) {
  const duration = Number(durationS);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { words, repaired: false, repaired_count: 0, duration_s: null };
  }
  let repairedCount = 0;
  const minDuration = Number.isFinite(Number(minDurationS)) && Number(minDurationS) > 0
    ? Number(minDurationS)
    : 0.04;
  const clamped = asArray(words).map((word) => {
    const start = Number(word.start);
    const end = Number(word.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return word;
    let nextStart = Math.min(start, duration);
    let nextEnd = Math.min(Math.max(end, nextStart), duration);
    if (nextEnd < nextStart + minDuration && duration >= minDuration) {
      nextStart = Math.max(0, nextEnd - minDuration);
    }
    nextStart = Number(nextStart.toFixed(3));
    nextEnd = Number(nextEnd.toFixed(3));
    if (nextStart !== start || nextEnd !== end) repairedCount += 1;
    return {
      ...word,
      start: nextStart,
      end: nextEnd,
    };
  });
  return {
    words: clamped,
    repaired: repairedCount > 0,
    repaired_count: repairedCount,
    duration_s: Number(duration.toFixed(3)),
  };
}

function maxWordEndSeconds(words = []) {
  const values = asArray(words)
    .map((word) => Number(word?.end))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function usableTimestampDuration(durationS = null, words = []) {
  const duration = Number(durationS);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const lastWordEnd = maxWordEndSeconds(words);
  if (lastWordEnd == null) return duration;
  if (lastWordEnd > duration + 1 && lastWordEnd > duration * 1.2) return null;
  return duration;
}

function normaliseCoverageToken(value = "") {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function scriptCoverageTokens(text = "") {
  const tokens = cleanText(text)
    .match(/\S+/g)
    ?.map((word) => ({
      word,
      norm: normaliseCoverageToken(word),
    }))
    .filter((item) => item.norm) || [];
  const merged = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    if (
      current?.norm === "game" &&
      (next?.norm === "stop" || next?.norm === "spot")
    ) {
      merged.push({
        word: `${current.word}${next.word}`,
        norm: `game${next.norm}`,
      });
      index += 1;
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function timestampCoverageTokens(words = []) {
  return asArray(words)
    .map((word, index) => ({
      index,
      word: cleanText(word.word || word.text),
      norm: normaliseCoverageToken(word.word || word.text),
      timing: word,
    }))
    .filter((item) => item.norm && usableWord(item.timing));
}

function stripInflectionSuffix(value = "") {
  const token = cleanText(value).toLowerCase();
  if (token.length < 4) return token;
  const suffixes = ["ing", "ied", "ed", "es", "s"];
  for (const suffix of suffixes) {
    if (!token.endsWith(suffix) || token.length - suffix.length < 3) continue;
    if (suffix === "ied") return `${token.slice(0, -3)}y`;
    return token.slice(0, -suffix.length);
  }
  return token;
}

function levenshteinDistance(left = "", right = "") {
  const a = cleanText(left);
  const b = cleanText(right);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function safeMorphologicalMatch(expected = "", actual = "") {
  if (expected.length < 4 || actual.length < 4) return false;
  const expectedStem = stripInflectionSuffix(expected);
  const actualStem = stripInflectionSuffix(actual);
  return expectedStem.length >= 3 && expectedStem === actualStem;
}

function safeNearTokenMatch(expected = "", actual = "") {
  if (expected.length < 5 || actual.length < 5) return false;
  if (expected[0] !== actual[0] || expected.at(-1) !== actual.at(-1)) return false;
  return levenshteinDistance(expected, actual) === 1;
}

const DIGIT_WORDS = new Map([
  ["zero", "0"],
  ["one", "1"],
  ["two", "2"],
  ["three", "3"],
  ["four", "4"],
  ["five", "5"],
  ["six", "6"],
  ["seven", "7"],
  ["eight", "8"],
  ["nine", "9"],
]);

function digitWordAlias(expected = "", actual = "") {
  return DIGIT_WORDS.get(expected) === actual || DIGIT_WORDS.get(actual) === expected;
}

function tokenMatchKind(expected = "", actual = "") {
  if (!expected || !actual) return null;
  if (expected === actual) return "exact";
  if (expected === "pulse" && /^(?:paul|pauls|poll|polls)$/.test(actual)) {
    return "brand_alias";
  }
  if (expected === "gaming" && /^(?:gaming|skaming|skamgaming)$/.test(actual)) {
    return "brand_alias";
  }
  if (expected === "number" && actual === "part") return "sequel_alias";
  if (expected === "raid" && actual === "rate") return "gaming_asr_alias";
  if (expected === "two" && actual === "2") return "number_alias";
  if (expected === "2" && actual === "two") return "number_alias";
  if (digitWordAlias(expected, actual)) return "number_alias";
  if (safeMorphologicalMatch(expected, actual)) return "morph_alias";
  if (safeNearTokenMatch(expected, actual)) return "near_match";
  return null;
}

function scriptAsrMatches(expectedTokens = [], actualTokens = []) {
  const rows = expectedTokens.length + 1;
  const cols = actualTokens.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = expectedTokens.length - 1; i >= 0; i -= 1) {
    for (let j = actualTokens.length - 1; j >= 0; j -= 1) {
      const matchKind = tokenMatchKind(expectedTokens[i].norm, actualTokens[j].norm);
      const diagonal = matchKind ? dp[i + 1][j + 1] + 1 : -1;
      dp[i][j] = Math.max(diagonal, dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const matches = [];
  let i = 0;
  let j = 0;
  while (i < expectedTokens.length && j < actualTokens.length) {
    const matchKind = tokenMatchKind(expectedTokens[i].norm, actualTokens[j].norm);
    if (matchKind && dp[i][j] === dp[i + 1][j + 1] + 1) {
      matches.push({
        expected_index: i,
        actual_index: actualTokens[j].index,
        actual_token_index: j,
        kind: matchKind,
      });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return matches;
}

function analyseWhisperScriptCoverage({ words = [], scriptText = "" } = {}) {
  const expectedTokens = scriptCoverageTokens(scriptText);
  const actualTokens = timestampCoverageTokens(words);
  if (!expectedTokens.length || !actualTokens.length) {
    return {
      ok: false,
      reason: "missing_expected_or_actual_tokens",
      coverage_ratio: 0,
      opening_covered: false,
      expected_word_count: expectedTokens.length,
      actual_word_count: actualTokens.length,
      matched_word_count: 0,
      matches: [],
    };
  }

  const matches = scriptAsrMatches(expectedTokens, actualTokens);
  const matchedExpected = new Set(matches.map((match) => match.expected_index));
  const matchedActualTokenIndexes = matches.map((match) => match.actual_token_index);
  const matchedActualTokenIndexSet = new Set(matchedActualTokenIndexes);
  const insertedActualTokens = actualTokens
    .map((token, index) => ({ ...token, actual_token_index: index }))
    .filter((_, index) => !matchedActualTokenIndexSet.has(index));
  const firstMatchedActualTokenIndex = matchedActualTokenIndexes.length
    ? Math.min(...matchedActualTokenIndexes)
    : null;
  const lastMatchedActualTokenIndex = matchedActualTokenIndexes.length
    ? Math.max(...matchedActualTokenIndexes)
    : null;
  const lastMatchedActualToken =
    lastMatchedActualTokenIndex != null ? actualTokens[lastMatchedActualTokenIndex] : null;
  const lastActualToken = actualTokens.at(-1) || null;
  const openingCount = Math.min(5, expectedTokens.length);
  const openingMatches = matches.filter((match) => match.expected_index < openingCount);
  const openingCovered =
    openingMatches.length === openingCount &&
    Math.max(...openingMatches.map((match) => match.actual_token_index)) <= openingCount + 4;
  const coverageRatio = matches.length / expectedTokens.length;
  const insertedActualCount = Math.max(0, actualTokens.length - matches.length);
  const aliasReplacementCount = matches.filter((match) => match.kind === "brand_alias").length;
  const canonicalReplacementCount = matches.filter((match) =>
    ["brand_alias", "gaming_asr_alias", "morph_alias", "near_match"].includes(match.kind),
  ).length;
  return {
    ok: coverageRatio >= 0.88 && openingCovered,
    reason:
      coverageRatio < 0.88
        ? "script_coverage_below_threshold"
        : openingCovered
          ? "coverage_ok"
          : "opening_not_covered",
    coverage_ratio: Number(coverageRatio.toFixed(3)),
    opening_covered: openingCovered,
    expected_word_count: expectedTokens.length,
    actual_word_count: actualTokens.length,
    matched_word_count: matches.length,
    inserted_actual_word_count: insertedActualCount,
    inserted_actual_tokens: insertedActualTokens,
    leading_actual_word_count:
      firstMatchedActualTokenIndex == null ? actualTokens.length : Math.max(0, firstMatchedActualTokenIndex),
    trailing_actual_word_count:
      lastMatchedActualTokenIndex == null
        ? actualTokens.length
        : Math.max(0, actualTokens.length - lastMatchedActualTokenIndex - 1),
    last_matched_actual_end_s: Number.isFinite(Number(lastMatchedActualToken?.timing?.end))
      ? Number(Number(lastMatchedActualToken.timing.end).toFixed(3))
      : null,
    trailing_actual_duration_s:
      Number.isFinite(Number(lastActualToken?.timing?.end)) &&
      Number.isFinite(Number(lastMatchedActualToken?.timing?.end))
        ? Number(Math.max(0, Number(lastActualToken.timing.end) - Number(lastMatchedActualToken.timing.end)).toFixed(3))
        : null,
    unmatched_expected_word_count: expectedTokens.length - matchedExpected.size,
    alias_replacement_count: aliasReplacementCount,
    canonical_replacement_count: canonicalReplacementCount,
    expected_opening: expectedTokens.slice(0, openingCount).map((item) => item.norm).join(" "),
    actual_opening: actualTokens.slice(0, openingCount + 7).map((item) => item.norm).join(" "),
    matches,
    expectedTokens,
    actualTokens,
  };
}

function reconcileWhisperWordsToScript({ words = [], scriptText = "" } = {}) {
  const coverage = analyseWhisperScriptCoverage({ words, scriptText });
  if (!coverage.ok) {
    return {
      ok: false,
      reason: coverage.reason,
      coverage,
      words,
      reconciled: false,
    };
  }

  const shouldReconcile =
    coverage.inserted_actual_word_count > 0 ||
    coverage.alias_replacement_count > 0 ||
    coverage.canonical_replacement_count > 0 ||
    coverage.unmatched_expected_word_count > 0;
  if (!shouldReconcile) {
    return {
      ok: true,
      reason: "coverage_ok_without_reconciliation",
      coverage,
      words,
      reconciled: false,
    };
  }

  const actualByTokenIndex = new Map(coverage.actualTokens.map((item, index) => [index, item]));
  const reconciled = coverage.matches
    .map((match) => {
      const expected = coverage.expectedTokens[match.expected_index];
      const actual = actualByTokenIndex.get(match.actual_token_index);
      if (!expected || !actual) return null;
      return {
        ...actual.timing,
        word: expected.word,
        start: Number(Number(actual.timing.start).toFixed(3)),
        end: Number(Number(actual.timing.end).toFixed(3)),
      };
    })
    .filter(usableWord);
  if (reconciled.length !== coverage.expectedTokens.length) {
    const highCoverageReconciled = reconcileHighCoverageWhisperDrift(coverage);
    if (highCoverageReconciled?.length === coverage.expectedTokens.length) {
      return {
        ok: true,
        reason: "script_high_coverage_reconciled",
        coverage,
        words: highCoverageReconciled,
        reconciled: true,
      };
    }
    return {
      ok: false,
      reason: "reconciled_word_count_mismatch",
      coverage,
      words,
      reconciled: false,
    };
  }
  return {
    ok: true,
    reason: "script_reconciled",
    coverage,
    words: reconciled,
    reconciled: true,
  };
}

function hasUnsafeAsrInsertedToken(coverage = {}) {
  const actualTokens = coverage.actualTokens || [];
  const inserted = coverage.inserted_actual_tokens || [];
  return inserted.some((token = {}) => {
    const norm = cleanText(token.norm);
    if (!norm) return false;
    if (/^\d+$/.test(norm)) return true;
    const index = Number(token.actual_token_index);
    const prev = Number.isFinite(index) ? actualTokens[index - 1]?.norm : "";
    const next = Number.isFinite(index) ? actualTokens[index + 1]?.norm : "";
    return norm === prev || norm === next;
  });
}

function safeAsrInsertedWordLimit(coverage = {}) {
  const expected = Number(coverage.expected_word_count);
  const inserted = Number(coverage.inserted_actual_word_count || 0);
  const ratio = Number(coverage.coverage_ratio);
  const trailing = Number(coverage.trailing_actual_word_count || 0);
  if (
    Number.isFinite(expected) &&
    expected >= 80 &&
    Number.isFinite(ratio) &&
    ratio >= 0.95 &&
    coverage.opening_covered === true &&
    trailing === 0 &&
    inserted > 0 &&
    !hasUnsafeAsrInsertedToken(coverage)
  ) {
    return Math.max(
      MAX_SAFE_ASR_INSERTED_WORDS,
      Math.min(MAX_SAFE_LONG_SCRIPT_ASR_INSERTED_WORDS, Math.floor(expected * 0.03)),
    );
  }
  return MAX_SAFE_ASR_INSERTED_WORDS;
}

function timingFromToken(token = {}) {
  if (!token || typeof token !== "object") return null;
  const timing = token.timing || token;
  if (!timing || typeof timing !== "object") return null;
  const start = Number(timing.start);
  const end = Number(timing.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return {
    start,
    end,
  };
}

function wordFromTiming(expected = {}, timing = {}) {
  const start = Number(Number(timing.start).toFixed(3));
  const end = Number(Number(Math.max(timing.end, timing.start)).toFixed(3));
  return {
    ...(expected.timing || {}),
    word: expected.word,
    start,
    end,
  };
}

function interpolatedTiming({ previous = null, next = null, index = 0, total = 1 } = {}) {
  const minDuration = 0.08;
  if (previous && next && next.start > previous.end) {
    const span = next.start - previous.end;
    const step = span / (total + 1);
    const start = previous.end + step * index;
    const end = index === total ? next.start : previous.end + step * (index + 1);
    return {
      start,
      end: Math.max(end, start + Math.min(minDuration, Math.max(0, step * 0.8))),
    };
  }
  if (previous) {
    const start = previous.end + minDuration * Math.max(0, index - 1);
    return { start, end: start + minDuration };
  }
  if (next) {
    const end = Math.max(0, next.start - minDuration * Math.max(0, total - index));
    return { start: Math.max(0, end - minDuration), end };
  }
  const start = minDuration * Math.max(0, index - 1);
  return { start, end: start + minDuration };
}

function reconcileHighCoverageWhisperDrift(coverage = {}) {
  if (!coverage.opening_covered || Number(coverage.coverage_ratio) < 0.92) {
    return null;
  }

  const expectedTokens = coverage.expectedTokens || [];
  const actualTokens = coverage.actualTokens || [];
  const matches = [...(coverage.matches || [])].sort((a, b) => a.expected_index - b.expected_index);
  const matchedByExpected = new Map(matches.map((match) => [match.expected_index, match]));
  const actualByTokenIndex = new Map(actualTokens.map((token, index) => [index, token]));
  const result = Array(expectedTokens.length).fill(null);

  for (const match of matches) {
    const expected = expectedTokens[match.expected_index];
    const actual = actualByTokenIndex.get(match.actual_token_index);
    const timing = timingFromToken(actual);
    if (expected && timing) {
      result[match.expected_index] = wordFromTiming(expected, timing);
    }
  }

  const anchors = [
    { expected_index: -1, actual_token_index: -1 },
    ...matches,
    { expected_index: expectedTokens.length, actual_token_index: actualTokens.length },
  ];

  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const left = anchors[anchorIndex];
    const right = anchors[anchorIndex + 1];
    const expectedGap = [];
    for (let expectedIndex = left.expected_index + 1; expectedIndex < right.expected_index; expectedIndex += 1) {
      if (!matchedByExpected.has(expectedIndex)) expectedGap.push(expectedIndex);
    }
    if (!expectedGap.length) continue;

    const actualGap = actualTokens
      .slice(left.actual_token_index + 1, right.actual_token_index)
      .filter((_, index) => {
        const actualTokenIndex = left.actual_token_index + 1 + index;
        return !matches.some((match) => match.actual_token_index === actualTokenIndex);
      });
    const previousTiming =
      left.expected_index >= 0 ? timingFromToken(result[left.expected_index]) : null;
    const nextTiming =
      right.expected_index < expectedTokens.length
        ? timingFromToken(result[right.expected_index] || actualByTokenIndex.get(right.actual_token_index))
        : null;

    expectedGap.forEach((expectedIndex, gapIndex) => {
      const expected = expectedTokens[expectedIndex];
      const actual =
        actualGap.length > 0
          ? actualGap[Math.min(actualGap.length - 1, Math.floor((gapIndex * actualGap.length) / expectedGap.length))]
          : null;
      const actualTiming = timingFromToken(actual);
      const timing =
        actualTiming ||
        interpolatedTiming({
          previous: previousTiming,
          next: nextTiming,
          index: gapIndex + 1,
          total: expectedGap.length,
        });
      result[expectedIndex] = wordFromTiming(expected, timing);
    });
  }

  const usable = result.filter(usableWord);
  return usable.length === expectedTokens.length ? usable : null;
}

async function hasReadyPair({ workspaceRoot, storyId } = {}) {
  return (await inspectReadyPair({ workspaceRoot, storyId })).ready;
}

async function inspectReadyPair({ workspaceRoot, storyId } = {}) {
  const audioPath = await resolveGeneratedMediaPath(workspaceRoot, relAudioPath(storyId));
  const timestampPath = await resolveGeneratedMediaPath(workspaceRoot, relTimestampPath(storyId));
  if (!(await fs.pathExists(audioPath)) || !(await fs.pathExists(timestampPath))) {
    return { ready: false, audioPath, timestampPath, words: [] };
  }
  const audioStat = await fs.stat(audioPath);
  if (!audioStat.isFile() || audioStat.size < 1024) {
    return { ready: false, audioPath, timestampPath, audioStat, words: [] };
  }
  const timestampStat = await fs.stat(timestampPath);
  const timestamps = await readJsonIfPresent(timestampPath, null);
  const words = Array.isArray(timestamps?.words) ? timestamps.words : [];
  const usableWords = words.filter(usableWord);
  return {
    ready: usableWords.length > 0,
    audioPath,
    timestampPath,
    audioStat,
    timestampStat,
    timestamps,
    words: usableWords,
  };
}

function latestRepairEvent(canonical = {}) {
  const events = [];
  const publicCopyMs = timeMs(canonical.public_copy_repaired_at);
  if (publicCopyMs != null) {
    events.push({
      ms: publicCopyMs,
      suffix: "public_copy_repair",
      audio: "narration_audio_stale_after_public_copy_repair",
      timestamps: "word_timestamps_stale_after_public_copy_repair",
    });
  }
  const durationMs = timeMs(canonical.duration_variant_repaired_at);
  if (durationMs != null) {
    events.push({
      ms: durationMs,
      suffix: "duration_variant_repair",
      audio: "narration_audio_stale_after_duration_variant_repair",
      timestamps: "word_timestamps_stale_after_duration_variant_repair",
    });
  }
  return events.sort((a, b) => b.ms - a.ms)[0] || null;
}

function staleSpeechTextReasons(pair = {}, spokenText = "") {
  if (!pair.ready || !spokenText) return [];
  const meta = pair.timestamps?.meta && typeof pair.timestamps.meta === "object"
    ? pair.timestamps.meta
    : {};
  const existingSpoken = cleanText(meta.transcript || meta.spoken_text || "");
  if (!existingSpoken) return [];
  return existingSpoken === cleanText(spokenText)
    ? []
    : ["narration_audio_stale_after_pronunciation_repair"];
}

function strictAlignmentReasons(pair = {}, alignmentMode = "") {
  if (!pair.ready || !requiresWhisperWordAlignment(alignmentMode)) return [];
  const source = cleanText(pair.timestamps?.meta?.wordTimestampSource);
  return source === "local_whisper_word_alignment"
    ? []
    : ["word_timestamps_not_strict_whisper_aligned"];
}

function jobRequestsAudioRegeneration(job = {}) {
  const audioReason = cleanText(job.audio?.reason || job.audio_reason);
  const timestampReason = cleanText(job.timestamps?.reason || job.timestamp_reason);
  return (
    job.timestamps?.requires_audio_regeneration === true ||
    job.audio?.requires_audio_regeneration === true ||
    audioReason === "asr_inserted_words_regenerate_narration" ||
    timestampReason === "asr_inserted_words_above_threshold"
  );
}

function localGenerationAttemptLimit(options = {}, provider = "") {
  if (cleanText(provider).toLowerCase() !== "local") return 1;
  const configured = Number(options.localTtsAsrRetryAttempts ?? process.env.LOCAL_TTS_ASR_RETRY_ATTEMPTS);
  if (Number.isFinite(configured) && configured > 0) return Math.max(1, Math.min(4, Math.floor(configured)));
  return requiresWhisperWordAlignment(options.alignmentMode) ? 3 : 1;
}

function localTtsSegmentMaxWordsForAttempt(options = {}, provider = "", attempt = 1) {
  const selectedProvider = cleanText(provider).toLowerCase();
  if (
    selectedProvider !== "local" ||
    Number(attempt) <= 1 ||
    !requiresWhisperWordAlignment(options.alignmentMode)
  ) {
    return null;
  }
  const currentMax = positiveInteger(
    options.localTtsSegmentMaxWords ?? process.env.LOCAL_TTS_SEGMENT_MAX_WORDS,
    55,
    { min: 8, max: 140 },
  );
  const retryMax = positiveInteger(
    Number(attempt) >= 3
      ? options.localTtsFinalRetrySegmentMaxWords ?? process.env.LOCAL_TTS_FINAL_RETRY_SEGMENT_MAX_WORDS
      : options.localTtsRetrySegmentMaxWords ?? process.env.LOCAL_TTS_RETRY_SEGMENT_MAX_WORDS,
    Number(attempt) >= 3 ? 8 : 12,
    { min: 8, max: 80 },
  );
  return Math.min(currentMax, retryMax);
}

function staleReadyPairReasons(pair = {}, repairEvent = null) {
  if (repairEvent?.ms == null || !pair.ready) return [];
  const reasons = [];
  if (pair.audioStat?.mtimeMs != null && pair.audioStat.mtimeMs + 1000 < repairEvent.ms) {
    reasons.push(repairEvent.audio);
  }
  if (pair.timestampStat?.mtimeMs != null && pair.timestampStat.mtimeMs + 1000 < repairEvent.ms) {
    reasons.push(repairEvent.timestamps);
  }
  return reasons;
}

async function existingAudioAndTimestampPaths({ workspaceRoot, storyId } = {}) {
  const audioPath = await resolveGeneratedMediaPath(workspaceRoot, relAudioPath(storyId));
  const timestampPath = await resolveGeneratedMediaPath(workspaceRoot, relTimestampPath(storyId));
  const audioExists = await fs.pathExists(audioPath);
  const timestampExists = await fs.pathExists(timestampPath);
  return {
    audioPath,
    timestampPath,
    audioExists,
    timestampExists,
  };
}

async function snapshotGeneratedPair({ workspaceRoot, storyId } = {}) {
  const audioRelPath = relAudioPath(storyId);
  const timestampRelPath = relTimestampPath(storyId);
  const paths = await existingAudioAndTimestampPaths({ workspaceRoot, storyId });
  const audioPaths = Array.from(new Set([
    paths.audioPath,
    absFromWorkspace(workspaceRoot, audioRelPath),
    mediaPaths.writePath(audioRelPath),
  ].filter(Boolean).map((item) => path.resolve(item))));
  const timestampPaths = Array.from(new Set([
    paths.timestampPath,
    absFromWorkspace(workspaceRoot, timestampRelPath),
    mediaPaths.writePath(timestampRelPath),
  ].filter(Boolean).map((item) => path.resolve(item))));
  const audioFiles = [];
  for (const filePath of audioPaths) {
    audioFiles.push({
      path: filePath,
      existed: await fs.pathExists(filePath),
      buffer: await fs.pathExists(filePath) ? await fs.readFile(filePath) : null,
    });
  }
  const timestampFiles = [];
  for (const filePath of timestampPaths) {
    timestampFiles.push({
      path: filePath,
      existed: await fs.pathExists(filePath),
      buffer: await fs.pathExists(filePath) ? await fs.readFile(filePath) : null,
    });
  }
  return {
    ...paths,
    audioFiles,
    timestampFiles,
  };
}

async function restoreGeneratedPair(snapshot = {}) {
  for (const file of [...asArray(snapshot.audioFiles), ...asArray(snapshot.timestampFiles)]) {
    if (!file?.path) continue;
    if (file.existed && file.buffer) {
      await fs.ensureDir(path.dirname(file.path));
      await fs.writeFile(file.path, file.buffer);
    } else {
      await fs.remove(file.path);
    }
  }
}

function defaultGenerateTtsForStory(args) {
  const audio = require("../audio");
  const brand = require("../brand");
  const provider = cleanText(args.provider || process.env.TTS_PROVIDER || "local").toLowerCase();
  if (provider === "local") {
    const {
      createLocalTtsBatchRecovery,
    } = require("./ops/local-tts-batch-recovery");
    const voiceId = audio.resolveTtsVoiceIdForProvider("local", process.env, brand);
    return audio.generateTtsForStory({
      ...args,
      provider,
      recoverLocalTts: createLocalTtsBatchRecovery({
        root: path.resolve(__dirname, ".."),
        env: process.env,
        voiceId,
      }),
    });
  }
  return audio.generateTtsForStory({
    ...args,
    provider,
  });
}

function defaultConcatAudioFiles(files, outputPath, options = {}) {
  const audio = require("../audio");
  return audio.concatAudioFiles(files, outputPath, options);
}

function defaultGetAudioDuration(audioPath) {
  const audio = require("../audio");
  return audio.getAudioDuration(audioPath);
}

function positiveNumber(value, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function positiveInteger(value, fallback, { min = 1, max = 1000 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

async function measuredAudioDurationSeconds(audioPath, getAudioDuration) {
  if (!audioPath || typeof getAudioDuration !== "function") return null;
  try {
    const duration = Number(await getAudioDuration(audioPath));
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch (_error) {
    return null;
  }
}

function trailingAudioTailForWords(words = [], durationS = null) {
  const duration = Number(durationS);
  const lastEnd = Number(asArray(words).filter(usableWord).at(-1)?.end);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(lastEnd) || lastEnd <= 0) {
    return null;
  }
  const gap = Number((duration - lastEnd).toFixed(3));
  return gap > 0 ? { gap_s: gap, last_word_end_s: Number(lastEnd.toFixed(3)), duration_s: Number(duration.toFixed(3)) } : null;
}

function wordCount(text = "") {
  const cleaned = cleanText(text);
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

function splitLongTextByWordLimit(text = "", maxWords = 55) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let index = 0; index < words.length; index += maxWords) {
    chunks.push(words.slice(index, index + maxWords).join(" "));
  }
  return chunks.filter(Boolean);
}

function splitSentenceForLocalTts(sentence = "", maxWords = 55) {
  const cleaned = cleanText(sentence);
  if (!cleaned) return [];
  if (wordCount(cleaned) <= maxWords) return [cleaned];
  const commaUnits = cleaned.split(/(?<=,)\s+/).map(cleanText).filter(Boolean);
  if (commaUnits.length > 1 && commaUnits.every((unit) => wordCount(unit) <= maxWords)) {
    return commaUnits;
  }
  return splitLongTextByWordLimit(cleaned, maxWords);
}

function unsafeShortLocalTtsSegment(segment = "", { minWords = 3, minChars = 24 } = {}) {
  const cleaned = cleanText(segment);
  if (!cleaned) return false;
  return wordCount(cleaned) < minWords || cleaned.length < minChars;
}

function mergeUnsafeShortLocalTtsSegments(segments = [], { minWords = 3, minChars = 24 } = {}) {
  const cleanedSegments = segments.map(cleanText).filter(Boolean);
  if (cleanedSegments.length <= 1) return cleanedSegments;
  const merged = [];
  for (const segment of cleanedSegments) {
    if (!merged.length) {
      merged.push(segment);
      continue;
    }
    if (unsafeShortLocalTtsSegment(segment, { minWords, minChars })) {
      merged[merged.length - 1] = cleanText(`${merged[merged.length - 1]} ${segment}`);
      continue;
    }
    merged.push(segment);
  }
  if (merged.length > 1 && unsafeShortLocalTtsSegment(merged[0], { minWords, minChars })) {
    const first = merged.shift();
    merged[0] = cleanText(`${first} ${merged[0]}`);
  }
  return merged;
}

function unsafeDanglingCommaLocalTtsSegment(segment = "", { maxWords = 6 } = {}) {
  const cleaned = cleanText(segment);
  return cleaned.endsWith(",") && wordCount(cleaned) <= maxWords;
}

function mergeUnsafeDanglingCommaLocalTtsSegments(segments = []) {
  const cleanedSegments = segments.map(cleanText).filter(Boolean);
  if (cleanedSegments.length <= 1) return cleanedSegments;
  const merged = [];
  for (let index = 0; index < cleanedSegments.length; index += 1) {
    const segment = cleanedSegments[index];
    if (!unsafeDanglingCommaLocalTtsSegment(segment)) {
      merged.push(segment);
      continue;
    }
    const next = cleanedSegments[index + 1];
    if (next) {
      merged.push(cleanText(`${segment} ${next}`));
      index += 1;
      continue;
    }
    if (merged.length) {
      merged[merged.length - 1] = cleanText(`${merged[merged.length - 1]} ${segment}`);
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

function splitLocalTtsSegments(text = "", { maxWords = 55 } = {}) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  const safeMaxWords = positiveInteger(maxWords, 55, { min: 8, max: 140 });
  const sentences = cleaned.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [cleaned];
  const units = sentences.flatMap((sentence) => splitSentenceForLocalTts(sentence, safeMaxWords));
  const segments = [];
  let current = "";
  for (const unit of units) {
    if (!unit) continue;
    if (!current) {
      current = unit;
      continue;
    }
    if (wordCount(`${current} ${unit}`) <= safeMaxWords) {
      current = `${current} ${unit}`;
      continue;
    }
    segments.push(current);
    current = unit;
  }
  if (current) segments.push(current);
  const safeSegments = mergeUnsafeShortLocalTtsSegments(segments);
  const cadenceSafeSegments = mergeUnsafeDanglingCommaLocalTtsSegments(safeSegments);
  return cadenceSafeSegments.length ? cadenceSafeSegments : [cleaned];
}

function segmentedLocalTtsEnabled(options = {}) {
  const customGenerateTts =
    options.generateTtsForStory &&
    options.generateTtsForStory !== defaultGenerateTtsForStory;
  const customConcat =
    options.concatAudioFiles &&
    options.concatAudioFiles !== defaultConcatAudioFiles;
  if (
    customGenerateTts &&
    !customConcat &&
    options.localTtsSegmentedMaterializer == null
  ) {
    return false;
  }
  const configured = options.localTtsSegmentedMaterializer ?? process.env.LOCAL_TTS_SEGMENTED_MATERIALIZER;
  const value = cleanText(configured).toLowerCase();
  return !["0", "false", "off", "disabled", "no"].includes(value);
}

function shouldSegmentLocalTts({ provider = "", text = "", options = {} } = {}) {
  if (cleanText(provider).toLowerCase() !== "local") return false;
  if (!segmentedLocalTtsEnabled(options)) return false;
  const threshold = positiveInteger(
    options.localTtsSegmentedWordThreshold ?? process.env.LOCAL_TTS_SEGMENTED_WORD_THRESHOLD,
    105,
    { min: 20, max: 240 },
  );
  return wordCount(text) >= threshold;
}

function segmentAudioPath(storyId, index) {
  return `output/audio/${safeId(storyId)}_goal_segment_${String(index + 1).padStart(2, "0")}.mp3`;
}

function timestampPathForAudioPath(audioPath = "") {
  return String(audioPath || "").replace(/\.mp3$/i, "_timestamps.json");
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function timestampPayloadMeta(payload = {}) {
  const alignment = extractAlignment(payload);
  return objectOrNull(alignment.meta) || objectOrNull(payload.meta) || {};
}

function firstMetaObject(segmentMetas = [], ...keys) {
  for (const meta of segmentMetas) {
    for (const key of keys) {
      const value = objectOrNull(meta?.[key]);
      if (value) return value;
    }
  }
  return null;
}

function firstMetaValue(segmentMetas = [], ...keys) {
  for (const meta of segmentMetas) {
    for (const key of keys) {
      const value = meta?.[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return null;
}

function mergeSegmentVoiceMetadata(segmentMetas = []) {
  const metas = segmentMetas.filter((meta) => meta && typeof meta === "object");
  if (!metas.length) return {};
  const voiceMastering = firstMetaObject(metas, "voiceMastering", "voice_mastering", "mastering");
  const merged = {};
  for (const key of [
    "provider",
    "source",
    "approvedLocalVoice",
    "acceptedLocalVoice",
    "localTts",
    "local_tts",
    "elevenlabs",
    "voiceDiagnostics",
    "voice_diagnostics",
    "voiceSettings",
    "voice_settings",
    "rate",
  ]) {
    const value = firstMetaValue(metas, key);
    if (value !== null) merged[key] = value;
  }
  const acoustic =
    firstMetaObject(metas, "acoustic") ||
    firstMetaObject(metas, "voiceDiagnostics", "voice_diagnostics")?.acoustic ||
    firstMetaObject(metas, "voiceDiagnostics", "voice_diagnostics")?.metrics ||
    null;
  if (acoustic) merged.acoustic = acoustic;
  if (voiceMastering) {
    merged.voiceMastering = {
      ...voiceMastering,
      source: voiceMastering.source || "merged_segment_voice_mastering",
      segment_count: metas.length,
    };
  }
  return merged;
}

async function mergeSegmentTimestampFiles({
  workspaceRoot,
  outputPath,
  segments = [],
  generatedAt,
  getAudioDuration = defaultGetAudioDuration,
  interSegmentGapS = 0.08,
} = {}) {
  const outputTimestampPath = absFromWorkspace(workspaceRoot, timestampPathForAudioPath(outputPath));
  await fs.ensureDir(path.dirname(outputTimestampPath));
  const mergedWords = [];
  const segmentMetas = [];
  let offset = 0;
  for (const segment of segments) {
    const timestampPath =
      cleanText(segment.resolved_timestamp_path) ||
      await resolveGeneratedMediaPath(workspaceRoot, timestampPathForAudioPath(segment.outputPath));
    const payload = await readJsonIfPresent(timestampPath, null);
    if (!payload) throw new Error("segment_timestamp_json_missing");
    segmentMetas.push(timestampPayloadMeta(payload));
    const words = normaliseWords(payload);
    if (!words.length) throw new Error("segment_word_timestamps_missing");
    for (const word of words) {
      mergedWords.push({
        ...word,
        start: Number((Number(word.start) + offset).toFixed(3)),
        end: Number((Number(word.end) + offset).toFixed(3)),
      });
    }
    const audioPath =
      cleanText(segment.resolved_audio_path) ||
      await resolveGeneratedMediaPath(workspaceRoot, segment.outputPath);
    const duration = Number(await getAudioDuration(audioPath, { segment }));
    const fallbackDuration = Number(words.at(-1)?.end || 0);
    offset += (Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration) + interSegmentGapS;
  }
  await fs.writeJson(
    outputTimestampPath,
    {
      words: mergedWords,
      meta: {
        ...mergeSegmentVoiceMetadata(segmentMetas),
        segmentedLocalTtsMaterialized: true,
        segment_count: segments.length,
        segment_word_counts: segments.map((segment) => segment.word_count),
        segment_audio_paths: segments.map((segment) => segment.outputPath),
        segment_gap_s: interSegmentGapS,
        wordTimestampSource: "local_tts_segmented_alignment_normalised",
        wordTimestampMaterializedAt: generatedAt,
      },
    },
    { spaces: 2 },
  );
  return { timestampPath: outputTimestampPath, word_count: mergedWords.length };
}

async function repairMergedSegmentVoiceMetadata({
  workspaceRoot = process.cwd(),
  storyId = "",
  timestampPath = null,
  applyLocal = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  const safeStoryId = safeId(storyId);
  const finalTimestampPath =
    timestampPath ||
    (safeStoryId
      ? await resolveGeneratedMediaPath(workspaceRoot, relTimestampPath(safeStoryId))
      : null);
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: safeStoryId || null,
    mode: applyLocal ? "apply-local" : "dry-run",
    timestamp_path: finalTimestampPath,
    action: "blocked",
    blockers: [],
    merged_fields: [],
    segment_timestamp_paths: [],
    safety: {
      local_only: true,
      mutates_media: applyLocal === true,
      mutates_production_db: false,
      mutates_tokens: false,
      triggers_oauth: false,
      posts_to_platforms: false,
      weakens_gates: false,
    },
  };

  if (!finalTimestampPath || !(await fs.pathExists(finalTimestampPath))) {
    report.blockers.push("final_timestamp_sidecar_missing");
    return report;
  }
  const payload = await readJsonIfPresent(finalTimestampPath, null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    report.blockers.push("final_timestamp_sidecar_unreadable");
    return report;
  }
  const meta = objectOrNull(payload.meta) || objectOrNull(payload.alignment?.meta) || {};
  const segmentAudioPaths = asArray(meta.segment_audio_paths);
  if (!segmentAudioPaths.length) {
    report.blockers.push("segment_audio_paths_missing");
    return report;
  }

  const segmentMetas = [];
  for (const audioRelPath of segmentAudioPaths) {
    const timestampRelPath = timestampPathForAudioPath(audioRelPath);
    const segmentTimestampPath = await resolveGeneratedMediaPath(workspaceRoot, timestampRelPath);
    report.segment_timestamp_paths.push(segmentTimestampPath);
    const segmentPayload = await readJsonIfPresent(segmentTimestampPath, null);
    const segmentMeta = segmentPayload ? timestampPayloadMeta(segmentPayload) : null;
    if (segmentMeta) segmentMetas.push(segmentMeta);
  }

  const merged = mergeSegmentVoiceMetadata(segmentMetas);
  for (const required of ["provider", "source", "acceptedLocalVoice", "voiceMastering"]) {
    if (merged[required] == null) report.blockers.push(`segment_voice_${required}_missing`);
  }
  if (merged.acceptedLocalVoice && merged.acceptedLocalVoice.referencePresent !== true) {
    report.blockers.push("segment_voice_reference_unverified");
  }
  if (merged.voiceMastering && merged.voiceMastering.ok !== true) {
    report.blockers.push("segment_voice_mastering_not_ok");
  }
  report.merged_fields = Object.keys(merged).sort();
  if (report.blockers.length > 0) return report;

  report.action = applyLocal ? "applied_segment_voice_metadata" : "would_apply_segment_voice_metadata";
  if (!applyLocal) return report;

  payload.meta = {
    ...meta,
    ...merged,
    voiceMetadataRepair: {
      repaired: true,
      repairedAt: generatedAt,
      strategy: "merged_segment_local_voice_sidecar_evidence",
      segment_count: segmentMetas.length,
    },
  };
  await fs.writeJson(finalTimestampPath, payload, { spaces: 2 });
  return report;
}

async function generateNarrationForMaterializer({
  workspaceRoot,
  story,
  text,
  outputPath,
  provider,
  label = "goal-final",
  generatedAt,
  options = {},
} = {}) {
  const generateTtsForStory = options.generateTtsForStory || defaultGenerateTtsForStory;
  if (!shouldSegmentLocalTts({ provider, text, options })) {
    return generateTtsForStory({ story, text, outputPath, provider, label });
  }
  const maxWords = positiveInteger(
    options.localTtsSegmentMaxWords ?? process.env.LOCAL_TTS_SEGMENT_MAX_WORDS,
    55,
    { min: 8, max: 140 },
  );
  const segments = splitLocalTtsSegments(text, { maxWords });
  if (segments.length <= 1) {
    return generateTtsForStory({ story, text, outputPath, provider, label });
  }
  const generatedSegments = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segmentText = segments[index];
    const segmentOutputPath = segmentAudioPath(story?.id || "story", index);
    await generateTtsForStory({
      story: {
        ...story,
        id: `${story?.id || "story"}_segment_${index + 1}`,
        full_script: segmentText,
        tts_script: segmentText,
      },
      text: segmentText,
      outputPath: segmentOutputPath,
      provider,
      label: `${label}-segment-${String(index + 1).padStart(2, "0")}`,
    });
    const audioPath = await mirrorGeneratedMediaPath(workspaceRoot, segmentOutputPath);
    if (!(await fs.pathExists(audioPath))) throw new Error("segment_audio_missing");
    const timestampPath = await mirrorGeneratedMediaPath(workspaceRoot, timestampPathForAudioPath(segmentOutputPath));
    if (!(await fs.pathExists(timestampPath))) throw new Error("segment_timestamp_json_missing");
    const stat = await fs.stat(audioPath);
    if (!stat.isFile() || stat.size < 1024) throw new Error("segment_audio_too_small");
    generatedSegments.push({
      outputPath: segmentOutputPath,
      resolved_audio_path: audioPath,
      resolved_timestamp_path: timestampPath,
      text: segmentText,
      word_count: wordCount(segmentText),
    });
  }
  const interSegmentGapS = Number(options.localTtsSegmentGapS ?? process.env.LOCAL_TTS_SEGMENT_GAP_S ?? 0.08);
  const safeGapS = Number.isFinite(interSegmentGapS) && interSegmentGapS >= 0 ? Math.min(interSegmentGapS, 0.5) : 0.08;
  await (options.concatAudioFiles || defaultConcatAudioFiles)(
    generatedSegments.map((segment) => segment.resolved_audio_path || segment.outputPath),
    outputPath,
    { interSegmentGapS: safeGapS },
  );
  await mergeSegmentTimestampFiles({
    workspaceRoot,
    outputPath,
    segments: generatedSegments,
    generatedAt,
    getAudioDuration: options.getAudioDuration || defaultGetAudioDuration,
    interSegmentGapS: safeGapS,
  });
  return {
    ok: true,
    segmented: true,
    segment_count: generatedSegments.length,
    segment_word_counts: generatedSegments.map((segment) => segment.word_count),
  };
}

function extractAlignment(payload = {}) {
  return payload.alignment || payload;
}

function normaliseWords(payload = {}) {
  if (Array.isArray(payload.words) && payload.words.some(usableWord)) {
    return payload.words.filter(usableWord);
  }
  return wordsFromAlignment(extractAlignment(payload)).filter(usableWord);
}

function parseSilencedetectOutput(output = "") {
  const silences = [];
  let pendingStart = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (endMatch && Number.isFinite(pendingStart)) {
      silences.push({
        start: pendingStart,
        end: Number(endMatch[1]),
        duration: Number(endMatch[2]),
      });
      pendingStart = null;
    }
  }
  return silences.filter((silence) =>
    Number.isFinite(silence.start) &&
    Number.isFinite(silence.end) &&
    Number.isFinite(silence.duration),
  );
}

async function detectAudioSilences(audioPath, { noise = "-38dB", minDurationS = 0.05 } = {}) {
  if (!audioPath || !(await fs.pathExists(audioPath))) return [];
  try {
    const result = await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-i",
        audioPath,
        "-af",
        `silencedetect=noise=${noise}:d=${Number(minDurationS).toFixed(3)}`,
        "-f",
        "null",
        "-",
      ],
      { timeout: 120000, maxBuffer: 1024 * 1024 * 4 },
    );
    return parseSilencedetectOutput(`${result.stdout || ""}\n${result.stderr || ""}`);
  } catch (error) {
    return parseSilencedetectOutput(`${error.stdout || ""}\n${error.stderr || ""}`);
  }
}

async function trimGeneratedAudioToDuration(audioPath, durationS, { execFileImpl = execFileAsync } = {}) {
  const duration = Number(durationS);
  if (!audioPath || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("audio_tail_trim_duration_invalid");
  }
  const tmpPath = `${audioPath}.tail-trim-${Date.now()}.mp3`;
  try {
    await execFileImpl(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        audioPath,
        "-t",
        Number(duration).toFixed(3),
        "-c:a",
        "libmp3lame",
        "-q:a",
        "2",
        tmpPath,
      ],
      { timeout: 120000, maxBuffer: 1024 * 1024 * 4 },
    );
    await fs.move(tmpPath, audioPath, { overwrite: true });
    return {
      repaired: true,
      strategy: "trim_trailing_asr_tail",
      trim_end_s: Number(duration.toFixed(3)),
    };
  } catch (error) {
    await fs.remove(tmpPath).catch(() => {});
    throw error;
  }
}

async function normaliseTimestampFile(
  timestampPath,
  {
    generatedAt,
    text,
    spokenText = text,
    provider = "local",
    audioPath = null,
    detectSilencesForAudio = detectAudioSilences,
    alignmentMode = process.env.LOCAL_TTS_WORD_ALIGNMENT || "silence",
    alignWordsWithAudio = alignWordsWithLocalWhisper,
    trimAudioToDuration = trimGeneratedAudioToDuration,
    getAudioDuration = defaultGetAudioDuration,
    measureWhisperAudioTail = false,
    maxWhisperAudioTailS = process.env.LOCAL_TTS_MAX_WHISPER_AUDIO_TAIL_S,
  } = {},
) {
  const payload = await readJsonIfPresent(timestampPath, null);
  if (!payload) throw new Error("generated_timestamp_json_missing_or_invalid");
  const alignment = extractAlignment(payload);
  let words = normaliseWords(payload);
  if (!words.length) throw new Error("generated_word_timestamps_missing");
  let audioAnchor = null;
  let whisperAlignment = null;
  let whisperFailure = null;
  let whisperTailRepair = null;
  let whisperAudioTailRepair = null;
  let audioDurationLimitS = null;
  const mode = cleanText(alignmentMode).toLowerCase();
  const measuredAudioDurationS = measureWhisperAudioTail
    ? await measuredAudioDurationSeconds(audioPath, getAudioDuration)
    : null;
  const maxAudioTailS = positiveNumber(maxWhisperAudioTailS, 1.25, { min: 0.25, max: 5 });
  if (cleanText(provider).toLowerCase() === "local" && audioPath) {
    if (requiresWhisperWordAlignment(mode) && alignWordsWithAudio) {
      const attempts = [];
      for (const model of whisperModelCandidates()) {
        let aligned = await alignWordsWithAudio({
          audioPath,
          scriptText: spokenText || text,
          model,
        });
        if (aligned?.ok === true && Array.isArray(aligned.words) && aligned.words.length) {
          let usableAlignedWords = aligned.words.filter(usableWord);
          let reconciled = reconcileWhisperWordsToScript({
            words: usableAlignedWords,
            scriptText: spokenText || text,
          });
          if (
            reconciled.ok === true &&
            Number(reconciled.coverage?.trailing_actual_word_count || 0) > 0 &&
            trimAudioToDuration
          ) {
            const trimEndS = Number(reconciled.coverage?.last_matched_actual_end_s);
            if (Number.isFinite(trimEndS) && trimEndS > 0) {
              await trimAudioToDuration(audioPath, trimEndS, {
                reason: "whisper_trailing_asr_tail",
                trailing_actual_word_count: reconciled.coverage.trailing_actual_word_count,
                trailing_actual_duration_s: reconciled.coverage.trailing_actual_duration_s,
              });
              whisperTailRepair = {
                repaired: true,
                strategy: "trim_trailing_asr_tail",
                model: aligned.model || model || null,
                trim_end_s: Number(trimEndS.toFixed(3)),
                trailing_actual_word_count: reconciled.coverage.trailing_actual_word_count,
                trailing_actual_duration_s: reconciled.coverage.trailing_actual_duration_s,
                transcript_before_trim: cleanText(aligned.transcript),
              };
              audioDurationLimitS = trimEndS;
              aligned = await alignWordsWithAudio({
                audioPath,
                scriptText: spokenText || text,
                model,
              });
              if (aligned?.ok === true && Array.isArray(aligned.words) && aligned.words.length) {
                usableAlignedWords = aligned.words.filter(usableWord);
                reconciled = reconcileWhisperWordsToScript({
                  words: usableAlignedWords,
                  scriptText: spokenText || text,
                });
              } else {
                attempts.push({
                  model,
                  error: cleanText(aligned?.error || "whisper_tail_trim_realign_failed"),
                });
                continue;
              }
            }
          }
          if (reconciled.ok === true) {
            if (Number(reconciled.coverage?.trailing_actual_word_count || 0) > 0) {
              attempts.push({
                model: aligned.model || model || null,
                error: "whisper_trailing_asr_tail_detected",
                transcript: cleanText(aligned.transcript),
                script_coverage_ratio: reconciled.coverage?.coverage_ratio ?? null,
                script_opening_covered: reconciled.coverage?.opening_covered ?? null,
                script_expected_word_count: reconciled.coverage?.expected_word_count ?? null,
                script_actual_word_count: reconciled.coverage?.actual_word_count ?? null,
                script_matched_word_count: reconciled.coverage?.matched_word_count ?? null,
                script_trailing_actual_word_count: reconciled.coverage?.trailing_actual_word_count ?? null,
              });
              continue;
            }
            const insertedWordLimit = safeAsrInsertedWordLimit(reconciled.coverage);
            if (Number(reconciled.coverage?.inserted_actual_word_count || 0) > insertedWordLimit) {
              attempts.push({
                model: aligned.model || model || null,
                error: "whisper_inserted_asr_words_above_threshold",
                transcript: cleanText(aligned.transcript),
                script_coverage_ratio: reconciled.coverage?.coverage_ratio ?? null,
                script_opening_covered: reconciled.coverage?.opening_covered ?? null,
                script_expected_word_count: reconciled.coverage?.expected_word_count ?? null,
                script_actual_word_count: reconciled.coverage?.actual_word_count ?? null,
                script_matched_word_count: reconciled.coverage?.matched_word_count ?? null,
                script_inserted_actual_word_count: reconciled.coverage?.inserted_actual_word_count ?? null,
                script_inserted_actual_word_limit: insertedWordLimit,
              });
              continue;
            }
            const audioTail = trailingAudioTailForWords(
              reconciled.words,
              audioDurationLimitS || measuredAudioDurationS,
            );
            if (audioTail && audioTail.gap_s > maxAudioTailS) {
              const trimEndS = Number((audioTail.last_word_end_s + 0.25).toFixed(3));
              if (trimAudioToDuration && trimEndS > 0 && trimEndS < audioTail.duration_s) {
                await trimAudioToDuration(audioPath, trimEndS, {
                  reason: "whisper_trailing_unaligned_audio_tail",
                  trailing_audio_gap_s: audioTail.gap_s,
                  original_duration_s: audioTail.duration_s,
                  last_word_end_s: audioTail.last_word_end_s,
                });
                whisperAudioTailRepair = {
                  repaired: true,
                  strategy: "trim_trailing_unaligned_audio_tail",
                  model: aligned.model || model || null,
                  trim_end_s: trimEndS,
                  trailing_audio_gap_s: audioTail.gap_s,
                  original_duration_s: audioTail.duration_s,
                  last_word_end_s: audioTail.last_word_end_s,
                };
                audioDurationLimitS = trimEndS;
                aligned = await alignWordsWithAudio({
                  audioPath,
                  scriptText: spokenText || text,
                  model,
                });
                if (aligned?.ok === true && Array.isArray(aligned.words) && aligned.words.length) {
                  usableAlignedWords = aligned.words.filter(usableWord);
                  reconciled = reconcileWhisperWordsToScript({
                    words: usableAlignedWords,
                    scriptText: spokenText || text,
                  });
                  const postTrimTail = trailingAudioTailForWords(reconciled.words, audioDurationLimitS);
                  if (reconciled.ok !== true || (postTrimTail && postTrimTail.gap_s > maxAudioTailS)) {
                    attempts.push({
                      model: aligned.model || model || null,
                      error: "whisper_trailing_audio_tail_after_trim",
                      transcript: cleanText(aligned.transcript),
                      trailing_audio_gap_s: postTrimTail?.gap_s ?? null,
                    });
                    continue;
                  }
                } else {
                  attempts.push({
                    model,
                    error: cleanText(aligned?.error || "whisper_audio_tail_trim_realign_failed"),
                  });
                  continue;
                }
              } else {
                attempts.push({
                  model: aligned.model || model || null,
                  error: "whisper_trailing_audio_tail_above_threshold",
                  transcript: cleanText(aligned.transcript),
                  trailing_audio_gap_s: audioTail.gap_s,
                  last_word_end_s: audioTail.last_word_end_s,
                  audio_duration_s: audioTail.duration_s,
                });
                continue;
              }
            }
            words = reconciled.words.filter(usableWord);
            whisperAlignment = {
              repaired: true,
              strategy: aligned.source || "local_whisper_word_alignment",
              model: aligned.model || model || null,
              transcript: cleanText(aligned.transcript),
              word_count: words.length,
              language: aligned.language || null,
              segment_count: aligned.segments || null,
              script_reconciled: reconciled.reconciled === true,
              script_coverage_ratio: reconciled.coverage.coverage_ratio,
              script_coverage_reason: reconciled.reason,
              script_opening_covered: reconciled.coverage.opening_covered,
              script_expected_word_count: reconciled.coverage.expected_word_count,
              script_actual_word_count: reconciled.coverage.actual_word_count,
              script_matched_word_count: reconciled.coverage.matched_word_count,
              script_inserted_actual_word_count: reconciled.coverage.inserted_actual_word_count,
              script_inserted_actual_word_limit: insertedWordLimit,
              script_trailing_actual_word_count: reconciled.coverage.trailing_actual_word_count,
              trailing_actual_duration_s: reconciled.coverage.trailing_actual_duration_s,
              model_attempts: attempts.length + 1,
            };
            break;
          }
          attempts.push({
            model: aligned.model || model || null,
            error: cleanText(reconciled.reason || "whisper_script_coverage_failed"),
            transcript: cleanText(aligned.transcript),
            script_coverage_ratio: reconciled.coverage?.coverage_ratio ?? null,
            script_opening_covered: reconciled.coverage?.opening_covered ?? null,
            script_expected_word_count: reconciled.coverage?.expected_word_count ?? null,
            script_actual_word_count: reconciled.coverage?.actual_word_count ?? null,
            script_matched_word_count: reconciled.coverage?.matched_word_count ?? null,
          });
        } else {
          attempts.push({
            model,
            error: cleanText(aligned?.error || "whisper_alignment_failed"),
          });
        }
      }
      if (!whisperAlignment) {
        const last = attempts.at(-1) || {};
        whisperFailure = {
          repaired: false,
          strategy: "local_whisper_word_alignment",
          error: cleanText(last.error || "whisper_alignment_failed"),
          model: last.model || null,
          transcript: cleanText(last.transcript),
          script_coverage_ratio: last.script_coverage_ratio ?? null,
          script_opening_covered: last.script_opening_covered ?? null,
          script_expected_word_count: last.script_expected_word_count ?? null,
          script_actual_word_count: last.script_actual_word_count ?? null,
          script_matched_word_count: last.script_matched_word_count ?? null,
          script_inserted_actual_word_count: last.script_inserted_actual_word_count ?? null,
          script_trailing_actual_word_count: last.script_trailing_actual_word_count ?? null,
          model_attempts: attempts,
        };
      }
    }
  }
  if (
    cleanText(provider).toLowerCase() === "local" &&
    audioPath &&
    !whisperAlignment &&
    !["off", "none", "disabled"].includes(mode)
  ) {
    const duration = Number(payload.meta?.acoustic?.durationSeconds || alignment?.meta?.acoustic?.durationSeconds);
    const silences = await detectSilencesForAudio(audioPath);
    const anchored = anchorSubtitleWordsToAudioSilences({
      text: spokenText || text,
      words,
      duration: Number.isFinite(duration) && duration > 0 ? duration : words.at(-1)?.end,
      silences,
    });
    if (anchored.repaired === true) {
      words = anchored.words;
      audioAnchor = {
        repaired: true,
        strategy: anchored.strategy,
        silence_count: silences.length,
        segment_count: anchored.segment_count,
        speech_interval_count: anchored.speech_interval_count,
      };
    }
  }
  const rawRepairDuration = Number(payload.meta?.acoustic?.durationSeconds || alignment?.meta?.acoustic?.durationSeconds);
  const repairDuration = usableTimestampDuration(rawRepairDuration, words);
  const wordSpanRepair = repairTinyWordSpans(words, {
    durationS: Number.isFinite(repairDuration) && repairDuration > 0 ? repairDuration : words.at(-1)?.end,
  });
  words = wordSpanRepair.words;
  const durationClamp = clampWordsToDuration(words, {
    durationS: audioDurationLimitS ||
      (Number.isFinite(repairDuration) && repairDuration > 0 ? repairDuration : null),
  });
  words = durationClamp.words;
  const { words: _wordSpanRepairWords, ...wordSpanRepairSummary } = wordSpanRepair;
  const { words: _durationClampWords, ...durationClampSummary } = durationClamp;
  const meta = {
    ...(alignment?.meta || {}),
    ...(payload.meta || {}),
    text,
    transcript: spokenText || text,
    ...(spokenText && spokenText !== text ? { spoken_text: spokenText } : {}),
    wordTimestampMaterializedAt: generatedAt,
    wordTimestampSource: whisperAlignment
      ? "local_whisper_word_alignment"
      : audioAnchor
      ? `${provider}_audio_silence_anchored`
      : `${provider}_alignment_normalised`,
    ...(whisperAlignment ? { timestampWhisperAlignment: whisperAlignment } : {}),
    ...(whisperFailure ? { timestampWhisperAlignment: whisperFailure } : {}),
    ...(whisperTailRepair ? { timestampWhisperTailRepair: whisperTailRepair } : {}),
    ...(whisperAudioTailRepair ? { timestampWhisperAudioTailRepair: whisperAudioTailRepair } : {}),
    ...(audioAnchor ? { timestampAudioAnchor: audioAnchor } : {}),
    ...(Number.isFinite(rawRepairDuration) && rawRepairDuration > 0 && repairDuration == null
      ? {
          timestampDurationMetadataIgnored: {
            reason: "metadata_duration_shorter_than_word_timeline",
            metadata_duration_s: Number(rawRepairDuration.toFixed(3)),
            last_word_end_s: Number((maxWordEndSeconds(words) || 0).toFixed(3)),
          },
        }
      : {}),
    ...(wordSpanRepair.repaired ? { timestampWordSpanRepair: wordSpanRepairSummary } : {}),
    ...(durationClamp.repaired ? { timestampDurationClamp: durationClampSummary } : {}),
  };
  await fs.writeJson(
    timestampPath,
    {
      alignment,
      words,
      meta,
    },
    { spaces: 2 },
  );
  return {
    path: timestampPath,
    word_count: words.length,
    word_timestamp_source: meta.wordTimestampSource,
    timestamp_whisper_alignment: meta.timestampWhisperAlignment || null,
  };
}

async function updateAudioManifest({
  artifactDir,
  storyId,
  generatedAt,
  wordCount,
  provider = "local",
  audioPath = null,
  timestampPath = null,
  timestampInfo = {},
} = {}) {
  const manifestPath = path.join(artifactDir, "audio_manifest.json");
  const current = await readJsonIfPresent(manifestPath, {});
  const externalProvider = provider !== "local" && provider !== "existing" ? provider : null;
  const existingLocalProvider =
    provider === "existing" && cleanText(current.voice_provider).toLowerCase() === "local_tts";
  const wordTimestampSource =
    cleanText(timestampInfo.word_timestamp_source || timestampInfo.wordTimestampSource) || null;
  const timestampWhisperAlignment =
    timestampInfo.timestamp_whisper_alignment || timestampInfo.timestampWhisperAlignment || null;
  const resolvedAudioPath = resolvedPathOrNull(audioPath);
  const resolvedTimestampPath = resolvedPathOrNull(timestampPath);
  const updated = {
    ...current,
    schema_version: current.schema_version || 1,
    story_id: current.story_id || storyId,
    narration_audio_path: relAudioPath(storyId),
    word_timestamps_path: relTimestampPath(storyId),
    resolved_narration_audio_path: resolvedAudioPath,
    resolved_word_timestamps_path: resolvedTimestampPath,
    voice_provider: provider === "existing"
      ? current.voice_provider || "existing"
      : provider === "local"
        ? "local_tts"
        : provider,
    voice_status: "materialized",
    word_timestamp_count: wordCount,
    word_timestamp_source: wordTimestampSource,
    timestamp_whisper_alignment: timestampWhisperAlignment,
    word_timestamp_provenance: {
      word_timestamp_source: wordTimestampSource,
      resolved_word_timestamps_path: resolvedTimestampPath,
      strict_whisper_aligned: wordTimestampSource === "local_whisper_word_alignment",
      whisper_alignment_repaired: timestampWhisperAlignment?.repaired === true,
    },
    materialized_at: generatedAt,
    safety: {
      ...(current.safety || {}),
      local_only: externalProvider
        ? false
        : provider === "local" || existingLocalProvider
          ? true
          : current.safety?.local_only !== false,
      planner_only: false,
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
      external_tts_provider_used: externalProvider,
    },
  };
  await fs.writeJson(manifestPath, updated, { spaces: 2 });
  await updateNarrationRightsLedger({
    artifactDir,
    storyId,
    provider: updated.voice_provider,
    audioPath: relAudioPath(storyId),
    generatedAt,
  });
  await syncCanonicalAudioMetadata({
    artifactDir,
    storyId,
    generatedAt,
    timestampWordCount: wordCount,
    audioPath,
    timestampPath,
  });
  await syncAudioReviewManifests({
    artifactDir,
    storyId,
    generatedAt,
    provider: updated.voice_provider,
    audioPath,
    timestampPath,
    wordCount,
    wordTimestampSource,
    timestampWhisperAlignment,
  });
  return { manifestPath, manifest: updated };
}

async function syncAudioReviewManifests({
  artifactDir,
  storyId,
  generatedAt,
  provider = "local_tts",
  audioPath = "",
  timestampPath = "",
  wordCount = 0,
  wordTimestampSource = null,
  timestampWhisperAlignment = null,
} = {}) {
  if (!artifactDir || !storyId) return null;
  const timestampPayload = await readJsonIfPresent(timestampPath, {});
  const meta = timestampPayload?.meta || {};
  const transcript = cleanPublicText(
    meta.transcript ||
      meta.spoken_text ||
      meta.text ||
      timestampPayload.transcript ||
      timestampPayload.text,
  );
  const publicText = cleanPublicText(meta.text || timestampPayload.text || transcript);
  const source = cleanText(wordTimestampSource || meta.wordTimestampSource || meta.word_timestamp_source);
  const resolvedAudioPath = resolvedPathOrNull(audioPath);
  const resolvedTimestampPath = resolvedPathOrNull(timestampPath);
  const safety = {
    local_only: provider === "local_tts" || provider === "local" || provider === "existing",
    no_publishing_side_effects: true,
    oauth_triggered: false,
    production_db_mutated: false,
  };
  const shared = {
    schema_version: 1,
    story_id: storyId,
    generated_at: generatedAt,
    status: "ready",
    narration_audio_path: relAudioPath(storyId),
    word_timestamps_path: relTimestampPath(storyId),
    resolved_narration_audio_path: resolvedAudioPath,
    resolved_word_timestamps_path: resolvedTimestampPath,
    word_timestamp_count: Number(wordCount) || 0,
    word_timestamp_source: source || null,
    timestamp_whisper_alignment: timestampWhisperAlignment || meta.timestampWhisperAlignment || null,
    transcript,
    display_text: publicText,
    voice_provider: provider,
    safety,
  };

  const narrationPath = path.join(artifactDir, "narration_manifest.json");
  const currentNarration = await readJsonIfPresent(narrationPath, {});
  await fs.writeJson(narrationPath, {
    ...currentNarration,
    ...shared,
    final_transcript: transcript,
  }, { spaces: 2 });

  const captionPath = path.join(artifactDir, "caption_manifest.json");
  const currentCaption = await readJsonIfPresent(captionPath, {});
  await fs.writeJson(captionPath, {
    ...currentCaption,
    ...shared,
    captions_source: "word_timestamps",
  }, { spaces: 2 });

  return { narrationPath, captionPath };
}

async function syncCanonicalAudioMetadata({
  artifactDir,
  storyId,
  generatedAt,
  timestampWordCount = 0,
  audioPath = "",
  timestampPath = "",
} = {}) {
  if (!artifactDir || !storyId) return null;
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  if (!(await fs.pathExists(canonicalPath))) return null;
  const current = await readJsonIfPresent(canonicalPath, null);
  if (!current || typeof current !== "object" || Array.isArray(current)) return null;

  const narrationText = cleanPublicText(
    current.narration_script ||
      current.full_script ||
      current.first_spoken_line ||
      current.description,
  );
  const spokenText = cleanPublicText(current.tts_script || current.spoken_narration_script || narrationText);
  const scriptWordCount = wordCount(narrationText);
  const spokenWordCount = wordCount(spokenText);
  const updated = {
    ...current,
    story_id: current.story_id || storyId,
    word_count: scriptWordCount,
    tts_word_count: spokenWordCount,
    audio_word_timestamp_count: Number(timestampWordCount) || 0,
    narration_audio_path: relAudioPath(storyId),
    word_timestamps_path: relTimestampPath(storyId),
    resolved_narration_audio_path: resolvedPathOrNull(audioPath),
    resolved_word_timestamps_path: resolvedPathOrNull(timestampPath),
    audio_materialized_at: generatedAt,
  };

  const durationVariantMs = timeMs(current.duration_variant_repaired_at);
  const publicCopyRepairMs = timeMs(current.public_copy_repaired_at);
  const repairedWordCount = Number(current.duration_variant_extension?.repaired_word_count);
  const durationVariantStale =
    Boolean(durationVariantMs) &&
    (
      (Number.isFinite(repairedWordCount) && repairedWordCount !== scriptWordCount) ||
      (Boolean(publicCopyRepairMs) && publicCopyRepairMs > durationVariantMs)
    );
  if (durationVariantStale) {
    updated.duration_variant_status = "invalidated_requires_repair";
    updated.duration_variant_invalidated_at = generatedAt;
    updated.duration_variant_invalidated_reason = "narration_script_changed_after_duration_variant_repair";
  }

  await fs.writeJson(canonicalPath, updated, { spaces: 2 });
  return { canonicalPath, canonical: updated };
}

async function loadStoryForAudio(job = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const canonical = await readJsonIfPresent(
    artifactDir ? path.join(artifactDir, "canonical_story_manifest.json") : null,
    {},
  );
  const storyId = cleanText(job.story_id || canonical.story_id);
  const text = cleanPublicText(
    canonical.narration_script ||
      canonical.first_spoken_line ||
      canonical.narration_hook ||
      canonical.description,
  );
  const spokenText = cleanSpokenTextForTts(text);
  return {
    artifactDir,
    canonical,
    story: {
      id: storyId,
      title: cleanPublicText(canonical.selected_title || canonical.short_title || job.title),
      full_script: text,
      tts_script: spokenText,
    },
    text,
    spokenText,
  };
}

async function materializeJob(job = {}, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const generatedAt = options.generatedAt || new Date().toISOString();
  const storyId = cleanText(job.story_id);
  const asrAlignmentOnly = cleanText(job.status) === "requires_word_timestamp_asr_alignment";
  if (options.inspectOnly) {
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: asrAlignmentOnly ? "inspect_only_pending_asr_alignment" : "inspect_only_pending_generation",
      audio_path: relAudioPath(storyId),
      word_timestamps_path: relTimestampPath(storyId),
    };
  }
  const loaded = await loadStoryForAudio(job);
  const repairEvent = latestRepairEvent(loaded.canonical);
  const regenerationRequested = jobRequestsAudioRegeneration(job);
  let staleExistingPair = false;
  let staleExistingPairReason = null;
  if (!options.force && !asrAlignmentOnly) {
    const readyPair = await inspectReadyPair({ workspaceRoot, storyId });
    const alignmentReasons = strictAlignmentReasons(readyPair, options.alignmentMode);
    const staleReasons = [
      ...staleReadyPairReasons(readyPair, repairEvent),
      ...staleSpeechTextReasons(readyPair, loaded.spokenText),
      ...alignmentReasons,
    ];
    if (readyPair.ready && alignmentReasons.length > 0 && staleReasons.length === alignmentReasons.length) {
      const timestampInfo = await normaliseTimestampFile(readyPair.timestampPath, {
        generatedAt,
        text: loaded.text,
        spokenText: loaded.spokenText,
        provider: "local",
        audioPath: readyPair.audioPath,
        detectSilencesForAudio: options.detectSilencesForAudio,
        alignmentMode: "whisper",
        alignWordsWithAudio: options.alignWordsWithAudio,
        trimAudioToDuration: options.trimAudioToDuration,
        getAudioDuration: options.getAudioDuration,
        measureWhisperAudioTail: options.measureWhisperAudioTail ?? path.resolve(workspaceRoot) === repoRoot(),
        maxWhisperAudioTailS: options.maxWhisperAudioTailS,
      });
      const alignedPayload = await readJsonIfPresent(readyPair.timestampPath, {});
      if (alignedPayload?.meta?.wordTimestampSource !== "local_whisper_word_alignment") {
        if (regenerationRequested) {
          staleExistingPair = true;
          staleExistingPairReason = "existing_pair_failed_asr_alignment_regenerated";
        } else {
          throw new Error("local_whisper_word_alignment_failed");
        }
      } else {
        await updateAudioManifest({
          artifactDir: loaded.artifactDir,
          storyId,
          generatedAt,
          wordCount: timestampInfo.word_count,
          provider: "existing",
          audioPath: readyPair.audioPath,
          timestampPath: readyPair.timestampPath,
          timestampInfo,
        });
        return {
          story_id: storyId,
          title: cleanText(job.title),
          status: "materialized_existing_asr_alignment",
          provider: "existing_local_audio",
          reason: "existing_timestamps_not_strict_whisper_aligned",
          audio_path: relAudioPath(storyId),
          word_timestamps_path: relTimestampPath(storyId),
          word_count: timestampInfo.word_count,
          audio_size_bytes: readyPair.audioStat.size,
        };
      }
    }
    if (regenerationRequested) {
      staleExistingPair = true;
      staleExistingPairReason = "existing_pair_failed_asr_alignment_regenerated";
    }
    if (readyPair.ready && !staleExistingPair && !staleReasons.length) {
      await updateAudioManifest({
        artifactDir: loaded.artifactDir,
        storyId,
        generatedAt,
        wordCount: readyPair.words.length,
        provider: "existing",
        audioPath: readyPair.audioPath,
        timestampPath: readyPair.timestampPath,
        timestampInfo: timestampInfoFromPayload(readyPair.timestamps, readyPair.words),
      });
      return {
        story_id: storyId,
        title: cleanText(job.title),
        status: "skipped_existing_ready_pair",
        audio_path: relAudioPath(storyId),
        word_timestamps_path: relTimestampPath(storyId),
        word_count: readyPair.words.length,
        audio_size_bytes: readyPair.audioStat.size,
      };
    }
    staleExistingPair = staleExistingPair || staleReasons.length > 0;
    if (staleExistingPair && !staleExistingPairReason) {
      staleExistingPairReason =
        staleReasons.includes("narration_audio_stale_after_pronunciation_repair")
          ? "existing_pair_stale_after_pronunciation_repair"
          : `existing_pair_stale_after_${repairEvent?.suffix || "repair"}`;
    }
  }
  if (!options.force && !staleExistingPair && !asrAlignmentOnly) {
    const existing = await existingAudioAndTimestampPaths({ workspaceRoot, storyId });
    if (existing.audioExists && existing.timestampExists) {
      const stat = await fs.stat(existing.audioPath);
      if (stat.isFile() && stat.size >= 1024) {
        const timestampInfo = await normaliseTimestampFile(existing.timestampPath, {
          generatedAt,
          text: loaded.text,
          spokenText: loaded.spokenText,
          provider: options.provider || "existing",
          audioPath: existing.audioPath,
        detectSilencesForAudio: options.detectSilencesForAudio,
        alignmentMode: options.alignmentMode,
        alignWordsWithAudio: options.alignWordsWithAudio,
        trimAudioToDuration: options.trimAudioToDuration,
        getAudioDuration: options.getAudioDuration,
        measureWhisperAudioTail: options.measureWhisperAudioTail ?? path.resolve(workspaceRoot) === repoRoot(),
        maxWhisperAudioTailS: options.maxWhisperAudioTailS,
      });
        await updateAudioManifest({
          artifactDir: loaded.artifactDir,
          storyId,
          generatedAt,
          wordCount: timestampInfo.word_count,
          provider: options.provider || "existing",
          audioPath: existing.audioPath,
          timestampPath: existing.timestampPath,
          timestampInfo,
        });
        return {
          story_id: storyId,
          title: cleanText(job.title),
          status: "materialized_existing_pair",
          audio_path: relAudioPath(storyId),
          word_timestamps_path: relTimestampPath(storyId),
          word_count: timestampInfo.word_count,
          audio_size_bytes: stat.size,
        };
      }
    }
  }
  if (asrAlignmentOnly) {
    const existing = await existingAudioAndTimestampPaths({ workspaceRoot, storyId });
    if (!existing.audioExists || !existing.timestampExists) {
      throw new Error("existing_audio_timestamp_pair_missing_for_asr_alignment");
    }
    const stat = await fs.stat(existing.audioPath);
    if (!stat.isFile() || stat.size < 1024) {
      throw new Error("existing_audio_too_small_for_asr_alignment");
    }
    const timestampInfo = await normaliseTimestampFile(existing.timestampPath, {
      generatedAt,
      text: loaded.text,
      spokenText: loaded.spokenText,
      provider: "local",
      audioPath: existing.audioPath,
      detectSilencesForAudio: options.detectSilencesForAudio,
      alignmentMode: "whisper",
      alignWordsWithAudio: options.alignWordsWithAudio,
      trimAudioToDuration: options.trimAudioToDuration,
      getAudioDuration: options.getAudioDuration,
      measureWhisperAudioTail: options.measureWhisperAudioTail ?? path.resolve(workspaceRoot) === repoRoot(),
      maxWhisperAudioTailS: options.maxWhisperAudioTailS,
    });
    const alignedPayload = await readJsonIfPresent(existing.timestampPath, {});
    if (alignedPayload?.meta?.wordTimestampSource !== "local_whisper_word_alignment") {
      throw new Error("local_whisper_word_alignment_failed");
    }
    await updateAudioManifest({
      artifactDir: loaded.artifactDir,
      storyId,
      generatedAt,
      wordCount: timestampInfo.word_count,
      provider: "existing",
      audioPath: existing.audioPath,
      timestampPath: existing.timestampPath,
      timestampInfo,
    });
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "materialized_existing_asr_alignment",
      provider: "existing_local_audio",
      audio_path: relAudioPath(storyId),
      word_timestamps_path: relTimestampPath(storyId),
      word_count: timestampInfo.word_count,
      audio_size_bytes: stat.size,
    };
  }

  const { artifactDir, story, text, spokenText } = loaded;
  if (!text) throw new Error("narration_script_missing");
  await fs.ensureDir(absFromWorkspace(workspaceRoot, "output/audio"));
  const provider = cleanText(options.provider || job.tts_provider || "local").toLowerCase();
  const maxGenerationAttempts = localGenerationAttemptLimit(options, provider);
  let lastGenerationError = null;
  let timestampInfo = null;
  let audioPath = null;
  let timestampPath = null;
  let stat = null;
  let generationAttempts = 0;
  let generationResult = null;
  const preGenerationPair = await snapshotGeneratedPair({ workspaceRoot, storyId });
  try {
    for (let attempt = 1; attempt <= maxGenerationAttempts; attempt += 1) {
      generationAttempts = attempt;
      try {
        const retrySegmentMaxWords = localTtsSegmentMaxWordsForAttempt(options, provider, attempt);
        const generationOptions = retrySegmentMaxWords
          ? {
              ...options,
              localTtsSegmentMaxWords: retrySegmentMaxWords,
            }
          : options;
        generationResult = await generateNarrationForMaterializer({
          workspaceRoot,
          story,
          text: spokenText || text,
          outputPath: relAudioPath(storyId),
          provider,
          label: "goal-final",
          generatedAt,
          options: generationOptions,
        });
        audioPath = await promoteWorkspaceGeneratedMediaPath(workspaceRoot, relAudioPath(storyId), options);
        timestampPath = await promoteWorkspaceGeneratedMediaPath(workspaceRoot, relTimestampPath(storyId), options);
        if (!(await fs.pathExists(audioPath))) throw new Error("generated_audio_missing");
        stat = await fs.stat(audioPath);
        if (!stat.isFile() || stat.size < 1024) throw new Error("generated_audio_too_small");
        timestampInfo = await normaliseTimestampFile(timestampPath, {
          generatedAt,
          text,
          spokenText,
          provider,
          audioPath,
          detectSilencesForAudio: options.detectSilencesForAudio,
          alignmentMode: options.alignmentMode,
          alignWordsWithAudio: options.alignWordsWithAudio,
          trimAudioToDuration: options.trimAudioToDuration,
          getAudioDuration: options.getAudioDuration,
          measureWhisperAudioTail: options.measureWhisperAudioTail ?? path.resolve(workspaceRoot) === repoRoot(),
          maxWhisperAudioTailS: options.maxWhisperAudioTailS,
        });
        if (path.resolve(timestampPath) !== path.resolve(absFromWorkspace(workspaceRoot, relTimestampPath(storyId)))) {
          await fs.copy(timestampPath, absFromWorkspace(workspaceRoot, relTimestampPath(storyId)), { overwrite: true });
        }
        if (
          provider === "local" &&
          requiresWhisperWordAlignment(options.alignmentMode) &&
          timestampInfo.word_timestamp_source !== "local_whisper_word_alignment"
        ) {
          const alignmentError = new Error("local_whisper_word_alignment_failed");
          alignmentError.timestamp_whisper_alignment = timestampInfo.timestamp_whisper_alignment || null;
          alignmentError.word_timestamps_path = relTimestampPath(storyId);
          throw alignmentError;
        }
        lastGenerationError = null;
        break;
      } catch (error) {
        lastGenerationError = error;
        const retryableStrictAlignmentFailure =
          provider === "local" &&
          requiresWhisperWordAlignment(options.alignmentMode) &&
          /local_whisper_word_alignment_failed|tts_failed|Request failed with status code 500|local_tts_generation_failed:server_error|recoverable generation error|connection_reset|ECONNRESET|socket hang up|local TTS connection reset/i.test(String(error?.message || error));
        if (!retryableStrictAlignmentFailure || attempt >= maxGenerationAttempts) throw error;
      }
    }
  } catch (error) {
    await restoreGeneratedPair(preGenerationPair);
    throw error;
  }
  if (lastGenerationError) throw lastGenerationError;
  await updateAudioManifest({
    artifactDir,
    storyId,
    generatedAt,
    wordCount: timestampInfo.word_count,
    provider,
    audioPath,
    timestampPath,
    timestampInfo,
  });
  return {
    story_id: storyId,
    title: story.title,
    status: "materialized",
    provider,
    ...(
      generationAttempts > 1
        ? { generation_attempts: generationAttempts, reason: "local_tts_retry_after_strict_alignment_failure" }
        : staleExistingPair
          ? { reason: staleExistingPairReason || "existing_pair_stale_after_repair" }
          : {}
    ),
    ...(generationResult?.segmented
      ? {
          segmented_local_tts: true,
          segment_count: generationResult.segment_count,
          segment_word_counts: generationResult.segment_word_counts,
        }
      : {}),
    audio_path: relAudioPath(storyId),
    word_timestamps_path: relTimestampPath(storyId),
    word_count: timestampInfo.word_count,
    audio_size_bytes: stat.size,
  };
}

function jobsForMaterialization(workbenchReport = {}, { limit = 0, storyIds = [] } = {}) {
  const requestedStoryIds = new Set(asArray(storyIds).map(cleanText).filter(Boolean));
  let jobs = asArray(workbenchReport.jobs).filter(
    (job) =>
      cleanText(job.status) === "requires_audio_timestamp_generation" ||
      cleanText(job.status) === "requires_word_timestamp_asr_alignment",
  );
  if (requestedStoryIds.size > 0) {
    jobs = jobs.filter((job) => requestedStoryIds.has(cleanText(job.story_id)));
  }
  if (Number(limit) > 0) jobs = jobs.slice(0, Number(limit));
  return jobs;
}

async function materializeGoalAudioTimestamps({
  workbenchReport = {},
  workspaceRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  limit = 0,
  storyIds = [],
  force = false,
  inspectOnly = false,
  provider = "auto",
  ttsEnv = process.env,
  generateTtsForStory = defaultGenerateTtsForStory,
  concatAudioFiles = defaultConcatAudioFiles,
  getAudioDuration = defaultGetAudioDuration,
  detectSilencesForAudio = detectAudioSilences,
  alignmentMode = process.env.LOCAL_TTS_WORD_ALIGNMENT || "silence",
  alignWordsWithAudio = alignWordsWithLocalWhisper,
  trimAudioToDuration = trimGeneratedAudioToDuration,
  localTtsSegmentedMaterializer,
  localTtsSegmentedWordThreshold = process.env.LOCAL_TTS_SEGMENTED_WORD_THRESHOLD,
  localTtsSegmentMaxWords = process.env.LOCAL_TTS_SEGMENT_MAX_WORDS,
  localTtsRetrySegmentMaxWords = process.env.LOCAL_TTS_RETRY_SEGMENT_MAX_WORDS,
  localTtsFinalRetrySegmentMaxWords = process.env.LOCAL_TTS_FINAL_RETRY_SEGMENT_MAX_WORDS,
  localTtsSegmentGapS = process.env.LOCAL_TTS_SEGMENT_GAP_S,
  promoteGeneratedMediaRoot = null,
  measureWhisperAudioTail = null,
  maxWhisperAudioTailS = process.env.LOCAL_TTS_MAX_WHISPER_AUDIO_TAIL_S,
} = {}) {
  const localReady =
    workbenchReport.local_tts?.ready === true ||
    cleanText(workbenchReport.local_tts?.verdict).toLowerCase() === "green";
  const providerPreference = cleanText(provider || workbenchReport.provider_preference || "auto").toLowerCase();
  const elevenlabsTts = workbenchReport.elevenlabs_tts ||
    (providerPreference === "elevenlabs"
      ? summariseElevenLabsTts(ttsEnv, { providerPreference })
      : null);
  const elevenlabsReady = elevenlabsTts?.ready === true;
  const jobs = jobsForMaterialization(workbenchReport, { limit, storyIds });
  const results = [];
  for (const job of jobs) {
    try {
      const asrAlignmentOnly = cleanText(job.status) === "requires_word_timestamp_asr_alignment";
      const selectedProvider = asrAlignmentOnly
        ? "existing_local_audio"
        : providerPreference === "local"
          ? "local"
          : providerPreference === "elevenlabs"
          ? "elevenlabs"
          : cleanText(job.tts_provider) ||
            (localReady
              ? "local"
              : elevenlabsReady
                ? "elevenlabs"
                : "");
      if (!selectedProvider && !inspectOnly) throw new Error("tts_provider_not_ready");
      if (!asrAlignmentOnly && selectedProvider === "local" && !localReady && !inspectOnly) {
        throw new Error("local_tts_not_ready");
      }
      if (!asrAlignmentOnly && selectedProvider === "elevenlabs" && !elevenlabsReady && !inspectOnly) {
        throw new Error("elevenlabs_tts_not_ready");
      }
      results.push(
        await materializeJob(job, {
          workspaceRoot,
          generatedAt,
          force,
          inspectOnly,
          provider: selectedProvider || providerPreference,
          generateTtsForStory,
          concatAudioFiles,
          getAudioDuration,
          detectSilencesForAudio,
          alignmentMode,
          alignWordsWithAudio,
          trimAudioToDuration,
          localTtsSegmentedMaterializer,
          localTtsSegmentedWordThreshold,
          localTtsSegmentMaxWords,
          localTtsRetrySegmentMaxWords,
          localTtsFinalRetrySegmentMaxWords,
          localTtsSegmentGapS,
          promoteGeneratedMediaRoot,
          measureWhisperAudioTail,
          maxWhisperAudioTailS,
        }),
      );
    } catch (error) {
      const failed = {
        story_id: cleanText(job.story_id),
        title: cleanText(job.title),
        status: "failed",
        error: error.message,
      };
      if (error.timestamp_whisper_alignment) {
        failed.timestamp_whisper_alignment = error.timestamp_whisper_alignment;
      }
      if (error.word_timestamps_path) {
        failed.word_timestamps_path = error.word_timestamps_path;
      }
      results.push(failed);
    }
  }
  const externalProviderUsed = results.some((job) => job.provider === "elevenlabs") ? "elevenlabs" : null;
  const ttsGenerationTriggered = results.some((job) =>
    ["materialized"].includes(cleanText(job.status)) &&
    !["existing", "existing_local_audio"].includes(cleanText(job.provider)),
  );
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_AUDIO_TIMESTAMP_MATERIALIZER",
    source_workbench_generated_at: workbenchReport.generated_at || null,
    summary: {
      candidate_count: jobs.length,
      materialized_count: results.filter((job) => String(job.status || "").startsWith("materialized")).length,
      failed_count: results.filter((job) => job.status === "failed").length,
      skipped_existing_count: results.filter((job) => job.status === "skipped_existing_ready_pair").length,
      inspect_only_count: results.filter((job) => String(job.status || "").startsWith("inspect_only")).length,
    },
    local_tts: workbenchReport.local_tts || null,
    elevenlabs_tts: elevenlabsTts || null,
    provider_preference: providerPreference,
    jobs: results,
    safety: {
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_network_uploads: externalProviderUsed ? false : true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      no_tts_generation_triggered: inspectOnly === true || !ttsGenerationTriggered,
      local_tts_only: externalProviderUsed
        ? false
        : results.every((job) =>
          !job.provider ||
          ["local", "existing", "existing_local_audio"].includes(cleanText(job.provider)),
        ),
      external_tts_provider_used: externalProviderUsed,
    },
  };
}

function renderGoalAudioTimestampMaterializationMarkdown(report = {}) {
  const lines = [];
  lines.push("# Audio Timestamp Materialization");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Materialized: ${report.summary?.materialized_count || 0}`);
  lines.push(`Existing ready pairs: ${report.summary?.skipped_existing_count || 0}`);
  lines.push(`Inspect-only: ${report.summary?.inspect_only_count || 0}`);
  lines.push(`Failed: ${report.summary?.failed_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(report.jobs).slice(0, 40)) {
    const suffix = job.error ? `; error: ${job.error}` : "";
    lines.push(`- ${job.story_id}: ${job.status}${suffix}`);
  }
  if (!asArray(report.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: audio materialisation only. No publish, database, token or OAuth change was triggered.");
  return `${lines.join("\n")}\n`;
}

function renderGoalAudioVoiceMetadataRepairMarkdown(report = {}) {
  const lines = [];
  lines.push("# Audio Voice Metadata Repair");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Story: ${report.story_id || "unknown"}`);
  lines.push(`Mode: ${report.mode || "unknown"}`);
  lines.push(`Action: ${report.action || "unknown"}`);
  lines.push(`Blockers: ${asArray(report.blockers).join(", ") || "none"}`);
  lines.push(`Merged fields: ${asArray(report.merged_fields).join(", ") || "none"}`);
  lines.push("");
  lines.push("Safety: local timestamp sidecar repair only. No publish, database, token or OAuth change was triggered.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalAudioVoiceMetadataRepairReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalAudioVoiceMetadataRepairReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const suffix = safeId(report.story_id) || "story";
  const jsonPath = path.join(outDir, `${suffix}_audio_voice_metadata_repair_report.json`);
  const markdownPath = path.join(outDir, `${suffix}_audio_voice_metadata_repair_report.md`);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalAudioVoiceMetadataRepairMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

async function writeGoalAudioTimestampMaterializationReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalAudioTimestampMaterializationReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "audio_timestamp_materialization_report.json");
  const markdownPath = path.join(outDir, "audio_timestamp_materialization_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalAudioTimestampMaterializationMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  detectAudioSilences,
  materializeGoalAudioTimestamps,
  parseSilencedetectOutput,
  repairMergedSegmentVoiceMetadata,
  renderGoalAudioVoiceMetadataRepairMarkdown,
  renderGoalAudioTimestampMaterializationMarkdown,
  writeGoalAudioVoiceMetadataRepairReport,
  writeGoalAudioTimestampMaterializationReport,
  normaliseTimestampFile,
  _testables: {
    localTtsSegmentMaxWordsForAttempt,
    mergeSegmentVoiceMetadata,
    reconcileWhisperWordsToScript,
    splitLocalTtsSegments,
    timingFromToken,
  },
};
