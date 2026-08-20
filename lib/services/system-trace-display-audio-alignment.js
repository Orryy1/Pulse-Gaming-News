"use strict";

function spokenTokens(value) {
  return String(value || "").match(/\S+/g) || [];
}

function compactSpeech(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function reconcileWhisperWordsToScript({ words = [], scriptText = "" } = {}) {
  const expected = spokenTokens(scriptText);
  const actual = words.filter((word) =>
    String(word?.word || word?.text || "").trim() &&
    Number.isFinite(Number(word?.start)) &&
    Number.isFinite(Number(word?.end)),
  );
  if (!expected.length || !actual.length) return { ok: false, reason: "words_missing" };
  const expectedCompact = compactSpeech(expected.join(" "));
  let actualForCoverage = actual.filter((word, index) => {
    if (index === 0) return true;
    return compactSpeech(word.word || word.text) !==
      compactSpeech(actual[index - 1].word || actual[index - 1].text);
  });
  let actualCompact = compactSpeech(
    actualForCoverage.map((word) => word.word || word.text).join(" "),
  );
  while (
    actualForCoverage.length > 1 &&
    actualCompact.startsWith(expectedCompact) &&
    actualCompact.length > expectedCompact.length
  ) {
    actualForCoverage = actualForCoverage.slice(0, -1);
    actualCompact = compactSpeech(
      actualForCoverage.map((word) => word.word || word.text).join(" "),
    );
  }
  const longest = Math.max(expectedCompact.length, actualCompact.length, 1);
  const similarity = 1 - editDistance(expectedCompact, actualCompact) / longest;
  if (similarity < 0.92) {
    return { ok: false, reason: "script_coverage_below_threshold", similarity };
  }
  const exactTokenShape =
    expected.length === actualForCoverage.length &&
    expected.every((token, index) =>
      compactSpeech(token) ===
        compactSpeech(actualForCoverage[index].word || actualForCoverage[index].text),
    );
  if (exactTokenShape) {
    return {
      ok: true,
      reason: "coverage_ok_without_retiming",
      words: expected.map((word, index) => ({
        word,
        start: Number(actualForCoverage[index].start),
        end: Number(actualForCoverage[index].end),
      })),
    };
  }
  const start = Number(actualForCoverage[0].start);
  const end = Number(actualForCoverage.at(-1).end);
  const weights = expected.map((token) => Math.max(1, compactSpeech(token).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let consumed = 0;
  return {
    ok: true,
    reason: "script_high_coverage_retimed",
    similarity,
    words: expected.map((word, index) => {
      const wordStart = start + ((end - start) * consumed) / totalWeight;
      consumed += weights[index];
      const wordEnd = start + ((end - start) * consumed) / totalWeight;
      return { word, start: wordStart, end: wordEnd };
    }),
  };
}

async function alignFrameWithBoundedRepair({ aligner, audioPath, scriptText } = {}) {
  if (typeof aligner !== "function" || !audioPath || !scriptText) {
    throw new Error("display_audio_alignment_input_invalid");
  }
  const run = (model) => aligner({
    audioPath,
    scriptText,
    promptText: scriptText,
    model,
    device: "cuda",
    useScriptPrompt: true,
  });
  const primary = await run("faster-whisper:base.en");
  const primaryCoverage = primary?.ok === true
    ? reconcileWhisperWordsToScript({ words: primary.words, scriptText })
    : { ok: false };
  if (primaryCoverage.ok === true) {
    return { ...primary, repair_attempted: false };
  }
  const repair = await run("faster-whisper:small.en");
  return {
    ...repair,
    repair_attempted: true,
    primary_model: "faster-whisper:base.en",
    primary_failure: primaryCoverage.reason || primary?.error || "alignment_failed",
  };
}

function parseNarrationFrames(markdown = "") {
  const frames = [];
  let current = null;
  const flush = () => {
    if (current?.text.trim()) {
      frames.push({ frame: current.frame, text: current.text.trim() });
    }
    current = null;
  };
  for (const line of String(markdown).split(/\r?\n/)) {
    const heading = line.match(/^#{2,3}\s+.*?\(frame\s+(\d+)\)/i);
    if (heading) {
      flush();
      current = { frame: Number(heading[1]), text: "" };
      continue;
    }
    if (!current || /^\s*\*\*/.test(line)) continue;
    const spoken = line.match(/^(?: {4,}|\t)(.+)$/);
    if (spoken) current.text += `${current.text ? " " : ""}${spoken[1].trim()}`;
  }
  flush();
  return frames;
}

function reconcileAlignedAudioMetadata({
  storyId,
  audioMeta,
  scriptFrames,
  alignments,
} = {}) {
  const voices = Array.isArray(audioMeta?.voices) ? audioMeta.voices : [];
  if (!storyId || !Array.isArray(scriptFrames) || !(alignments instanceof Map)) {
    throw new Error("display_audio_alignment_input_invalid");
  }
  if (voices.length !== scriptFrames.length || voices.length === 0) {
    throw new Error(`display_audio_frame_count_mismatch:${storyId}`);
  }
  const scriptByFrame = new Map(scriptFrames.map((entry) => [entry.frame, entry]));
  const evidenceFrames = [];
  const alignedVoices = voices.map((voice) => {
    const frame = Number(voice.frame);
    const script = scriptByFrame.get(frame);
    const aligned = alignments.get(frame);
    if (!script || aligned?.ok !== true || !Array.isArray(aligned.words)) {
      throw new Error(`strict_local_whisper_alignment_required:${storyId}:${frame}`);
    }
    const reconciled = reconcileWhisperWordsToScript({
      words: aligned.words,
      scriptText: script.text,
    });
    if (reconciled.ok !== true || !reconciled.words.length) {
      throw new Error(`strict_local_whisper_alignment_required:${storyId}:${frame}`);
    }
    const words = reconciled.words.map((word, index) => ({
      id: `${String(frame).padStart(2, "0")}-${String(index + 1).padStart(3, "0")}`,
      text: String(word.word || "").trim(),
      start: Number(Number(word.start).toFixed(3)),
      end: Number(Number(word.end).toFixed(3)),
    }));
    if (words.some((word) => !word.text || word.end < word.start)) {
      throw new Error(`strict_local_whisper_alignment_required:${storyId}:${frame}`);
    }
    evidenceFrames.push({
      frame,
      source: aligned.source,
      backend: aligned.backend || null,
      model: aligned.model || null,
      transcript: aligned.transcript || null,
      reconciliation: reconciled.reason,
      word_count: words.length,
      first_word_start: words[0].start,
      last_word_end: words.at(-1).end,
    });
    return { ...voice, words };
  });
  return {
    audioMeta: { ...audioMeta, voices: alignedVoices },
    evidence: {
      schema_version: 1,
      schema: "pulse_system_trace_display_audio_alignment_v1",
      story_id: storyId,
      verdict: "GREEN",
      source: "local_whisper_word_alignment",
      frame_count: evidenceFrames.length,
      frames: evidenceFrames,
      blockers: [],
    },
  };
}

module.exports = {
  alignFrameWithBoundedRepair,
  parseNarrationFrames,
  reconcileAlignedAudioMetadata,
};
