"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalVideoTimeline,
  renderLocalVideoTimelineMarkdown,
} = require("../../lib/local-video-timeline");
const { parseArgs } = require("../../tools/local-video-timeline");
const packageJson = require("../../package.json");

function alignmentFromText(text, duration) {
  const chars = Array.from(text);
  const spokenChars = chars.filter((ch) => !/\s/.test(ch)).length || 1;
  const step = duration / spokenChars;
  let cursor = 0;
  return {
    characters: chars,
    character_start_times_seconds: chars.map((ch) => {
      const start = cursor;
      if (!/\s/.test(ch)) cursor += step;
      return Number(start.toFixed(3));
    }),
    character_end_times_seconds: chars.map((ch, index) => {
      if (/\s/.test(ch)) return Number((index === 0 ? 0 : cursor).toFixed(3));
      const end = Math.min(duration, Number(((index + 1) * step).toFixed(3)));
      return end;
    }),
    meta: {
      provider: "local",
      source: "local-tts-server",
      transcript: text,
      timeline_source: "local_tts_alignment",
    },
  };
}

test("local video timeline builds video-use-style artefacts from local TTS alignment", () => {
  const story = {
    id: "forza-local-timeline",
    title: "Forza Horizon 6 just hit 130,000 players on Steam",
    full_script:
      "Forza Horizon 6 just hit 130,000 players on Steam. Xbox needed a win and this is the clearest signal yet. Follow Pulse Gaming so you never miss a beat.",
  };
  const timeline = buildLocalVideoTimeline({
    story,
    timestamps: alignmentFromText(story.full_script, 12),
    duration: 12,
    generatedAt: "2026-05-17T12:00:00.000Z",
  });

  assert.equal(timeline.execution_mode, "autonomous_local_timeline");
  assert.equal(timeline.local_only, true);
  assert.equal(timeline.safety.elevenlabs_required, false);
  assert.equal(timeline.safety.cloud_transcription_required, false);
  assert.equal(timeline.timeline_source, "local_tts_alignment");
  assert.equal(timeline.autonomy.requires_human_confirmation, false);
  assert.ok(timeline.words.some((word) => word.word === "130,000"));
  assert.ok(timeline.segments.length >= 2);
  assert.ok(timeline.beats.some((beat) => beat.type === "hook"));
  assert.ok(timeline.beats.some((beat) => beat.type === "metric" && beat.text.includes("130,000")));
  assert.deepEqual(timeline.required_artifacts, [
    "local_transcript_pack",
    "timeline_contact_sheet",
    "motion_edl",
    "cut_boundary_self_eval",
  ]);
});

test("local video timeline can fall back to synthetic local timings without cloud ASR", () => {
  const story = {
    id: "synthetic-local-timeline",
    full_script: "A verified Nintendo Direct story needs a local fallback timeline.",
  };

  const timeline = buildLocalVideoTimeline({
    story,
    timestamps: {},
    duration: 9,
    generatedAt: "2026-05-17T12:00:00.000Z",
  });

  assert.equal(timeline.timeline_source, "synthetic_local_script_timing");
  assert.equal(timeline.words.length, 10);
  assert.equal(timeline.inspection.usable, true);
  assert.equal(timeline.safety.cloud_transcription_required, false);
});

test("local video timeline Markdown and CLI expose local-only autonomous contract", () => {
  const timeline = buildLocalVideoTimeline({
    story: {
      id: "md-local-timeline",
      full_script: "Pulse Gaming keeps the local timeline autonomous.",
    },
    duration: 7,
    generatedAt: "2026-05-17T12:00:00.000Z",
  });
  const markdown = renderLocalVideoTimelineMarkdown(timeline);

  assert.match(markdown, /Local Video Timeline/);
  assert.match(markdown, /Autonomous: true/);
  assert.match(markdown, /Subtitles last: true/);
  assert.doesNotMatch(markdown, /ElevenLabs|Scribe/i);

  const args = parseArgs([
    "node",
    "tools/local-video-timeline.js",
    "--story-json",
    "test/fixtures/story.json",
    "--timestamps",
    "output/audio/story_timestamps.json",
    "--duration",
    "12.5",
    "--json",
  ]);

  assert.equal(args.storyJson, "test/fixtures/story.json");
  assert.equal(args.timestamps, "output/audio/story_timestamps.json");
  assert.equal(args.duration, 12.5);
  assert.equal(args.json, true);
  assert.match(packageJson.scripts["media:local-timeline"], /local-video-timeline\.js/);
});
