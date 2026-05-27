"use strict";

const {
  buildSyntheticCharacterAlignment,
  characterAlignmentToSubtitleWords,
  inspectSubtitleTimingWords,
  selectSubtitleScriptText,
} = require("./subtitle-timing");

const REQUIRED_ARTIFACTS = [
  "local_transcript_pack",
  "timeline_contact_sheet",
  "motion_edl",
  "cut_boundary_self_eval",
];

function normaliseWord(word) {
  const text = String(word?.word || word?.text || "").trim();
  const start = Number(word?.start ?? word?.start_s ?? word?.startS);
  const end = Number(word?.end ?? word?.end_s ?? word?.endS);
  if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return {
    word: text,
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
  };
}

function wordsFromTimestamps(timestamps) {
  const payload = timestamps?.alignment || timestamps || {};
  const explicitWords = Array.isArray(payload.words)
    ? payload.words
    : Array.isArray(timestamps?.words)
      ? timestamps.words
      : [];
  const fromExplicit = explicitWords.map(normaliseWord).filter(Boolean);
  if (fromExplicit.length > 0) return fromExplicit;

  return characterAlignmentToSubtitleWords(payload)
    .map(normaliseWord)
    .filter(Boolean);
}

function transcriptFromWords(words) {
  return (Array.isArray(words) ? words : []).map((word) => word.word).join(" ").replace(/\s+/g, " ").trim();
}

function inferTimelineSource(timestamps, fallbackUsed) {
  if (fallbackUsed) return "synthetic_local_script_timing";
  const meta = timestamps?.meta || timestamps?.alignment?.meta || {};
  const sourceText = [meta.timeline_source, meta.source, meta.provider, timestamps?.source]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/local_tts|local-tts|voxcpm|whisperx/.test(sourceText)) return "local_tts_alignment";
  if (/faster-whisper|local_asr|transcribe/.test(sourceText)) return "local_asr_transcript";
  return "provided_local_alignment";
}

function buildSegments(words) {
  const out = [];
  let buffer = [];
  let previousEnd = null;
  const flush = () => {
    if (!buffer.length) return;
    out.push({
      id: `segment_${String(out.length + 1).padStart(2, "0")}`,
      start: Number(buffer[0].start.toFixed(3)),
      end: Number(buffer[buffer.length - 1].end.toFixed(3)),
      text: transcriptFromWords(buffer),
      word_count: buffer.length,
    });
    buffer = [];
  };

  for (const word of Array.isArray(words) ? words : []) {
    const gap = previousEnd === null ? 0 : word.start - previousEnd;
    if (buffer.length > 0 && (gap >= 0.5 || buffer.length >= 14)) flush();
    buffer.push(word);
    previousEnd = word.end;
    if (/[.!?]$/.test(word.word)) flush();
  }
  flush();
  return out;
}

function metricWords(words) {
  return (Array.isArray(words) ? words : []).filter((word) => /(?:\d|%|£|\$|€)/.test(word.word));
}

function wordsInWindow(words, start, end) {
  return (Array.isArray(words) ? words : []).filter((word) => word.end >= start && word.start <= end);
}

function buildBeats({ words, segments, duration }) {
  const beats = [];
  const safeDuration = Number(duration) || 0;
  const hookEnd = Math.min(safeDuration || 3.2, 3.2);
  const hookWords = wordsInWindow(words, 0, hookEnd);
  if (hookWords.length) {
    beats.push({
      id: "beat_hook",
      type: "hook",
      start: Number(hookWords[0].start.toFixed(3)),
      end: Number(hookWords[hookWords.length - 1].end.toFixed(3)),
      text: transcriptFromWords(hookWords),
    });
  }

  for (const word of metricWords(words).slice(0, 8)) {
    const segment =
      segments.find((item) => word.start >= item.start && word.end <= item.end) ||
      { start: word.start, end: word.end, text: word.word };
    beats.push({
      id: `beat_metric_${String(beats.filter((beat) => beat.type === "metric").length + 1).padStart(2, "0")}`,
      type: "metric",
      start: segment.start,
      end: segment.end,
      text: segment.text,
      metric: word.word,
    });
  }

  const last = segments[segments.length - 1];
  if (last) {
    beats.push({
      id: "beat_loop_or_cta",
      type: /follow pulse|never miss/i.test(last.text) ? "cta" : "loop",
      start: last.start,
      end: last.end,
      text: last.text,
    });
  }

  return beats;
}

function buildLocalVideoTimeline({
  story = {},
  timestamps = {},
  duration,
  generatedAt = new Date().toISOString(),
} = {}) {
  const durationS = Number(duration || timestamps?.duration || timestamps?.meta?.duration_s || 0);
  const scriptText = selectSubtitleScriptText(story, timestamps);
  let words = wordsFromTimestamps(timestamps);
  let fallbackUsed = false;

  if (words.length === 0 && scriptText && durationS > 0) {
    words = characterAlignmentToSubtitleWords(buildSyntheticCharacterAlignment(scriptText, durationS))
      .map(normaliseWord)
      .filter(Boolean);
    fallbackUsed = true;
  }

  const transcript = transcriptFromWords(words) || scriptText;
  const segments = buildSegments(words);
  const inspection = inspectSubtitleTimingWords(words, durationS, {
    maxGapLimitSeconds: 3,
    maxTrailingGapSeconds: 2,
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "autonomous_local_timeline",
    local_only: true,
    story_id: story?.id || null,
    title: story?.title || null,
    duration_s: Number.isFinite(durationS) ? Number(durationS.toFixed(3)) : null,
    timeline_source: inferTimelineSource(timestamps, fallbackUsed),
    transcript,
    words,
    segments,
    beats: buildBeats({ words, segments, duration: durationS }),
    inspection,
    required_artifacts: REQUIRED_ARTIFACTS,
    autonomy: {
      enabled: true,
      requires_human_confirmation: false,
      can_queue_contact_sheet: true,
      can_queue_edl: true,
      can_queue_self_eval: true,
      can_publish: false,
    },
    render_rules: {
      audio_primary_cutting: true,
      cut_boundaries_snap_to_words: true,
      subtitles_last: true,
      self_eval_before_preview: true,
      boundary_fade_ms: 30,
    },
    safety: {
      local_only: true,
      elevenlabs_required: false,
      cloud_transcription_required: false,
      video_downloads: false,
      yt_dlp: false,
      browser_scraping: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
    },
  };
}

function renderLocalVideoTimelineMarkdown(timeline) {
  const lines = [];
  lines.push("# Local Video Timeline");
  lines.push("");
  lines.push(`Generated: ${timeline.generated_at}`);
  lines.push(`Story: ${timeline.story_id || "unknown"}`);
  lines.push(`Execution mode: ${timeline.execution_mode}`);
  lines.push(`Timeline source: ${timeline.timeline_source}`);
  lines.push(`Autonomous: ${timeline.autonomy?.enabled === true}`);
  lines.push(`Subtitles last: ${timeline.render_rules?.subtitles_last === true}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- duration_s: ${timeline.duration_s ?? "unknown"}`);
  lines.push(`- words: ${timeline.words?.length || 0}`);
  lines.push(`- segments: ${timeline.segments?.length || 0}`);
  lines.push(`- beats: ${timeline.beats?.length || 0}`);
  lines.push(`- timing: ${timeline.inspection?.reason || "unknown"}`);
  lines.push("");
  lines.push("## Beats");
  lines.push("");
  lines.push("| type | start | end | text |");
  lines.push("| --- | ---: | ---: | --- |");
  for (const beat of timeline.beats || []) {
    lines.push(`| ${beat.type} | ${beat.start} | ${beat.end} | ${String(beat.text || "").replace(/\|/g, "/")} |`);
  }
  if (!timeline.beats?.length) lines.push("| none | 0 | 0 | none |");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Local-only sidecar.");
  lines.push("- No cloud transcription, downloads, yt-dlp, browser scraping, DB mutation, OAuth or posting.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildLocalVideoTimeline,
  renderLocalVideoTimelineMarkdown,
};
