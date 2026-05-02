"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildQualityReportV2,
  gradeDurationIntegrity,
} = require("../../lib/studio/v2/quality-gate-v2");
const {
  buildSfxCueList,
  buildSoundLayerV2,
} = require("../../lib/studio/v2/sound-layer-v2");
const { resolveAudioPlan } = require("../../lib/studio/v2/audio-library");
const {
  applyLocalVoiceRateMultiplier,
  buildProductionVoiceSegments,
  evaluateLocalVoicePace,
  resolveLocalTtsEngine,
  resolveStudioOutroLine,
  splitLongVoiceSegments,
} = require("../../lib/studio/sound-layer");
const {
  summariseLocalTtsHealth,
} = require("../../lib/studio/local-tts-readiness");

function tempAss(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-"));
  const file = path.join(dir, "captions.ass");
  fs.writeFileSync(file, contents);
  return file;
}

function dialogue(start, end, text = "word") {
  return `Dialogue: 0,${start},${end},Caption,,0,0,0,,${text}`;
}

test("v2 duration integrity fails when rendered MP4 is shorter than voice/subtitles", () => {
  const assPath = tempAss(
    [
      dialogue("0:00:00.00", "0:00:01.00"),
      dialogue("0:00:54.52", "0:00:55.36", "survival."),
    ].join("\n"),
  );
  const result = gradeDurationIntegrity({
    renderedDurationS: 51.2,
    audioDurationS: 55.431837,
    assPath,
  });
  assert.equal(result.grade, "red");
  assert.deepEqual(result.failures, [
    "rendered MP4 is shorter than narration",
    "subtitle cues run past rendered MP4",
  ]);
});

test("v2 duration integrity passes when render covers voice and subtitle timeline", () => {
  const assPath = tempAss(dialogue("0:00:54.52", "0:00:55.36", "survival."));
  const result = gradeDurationIntegrity({
    renderedDurationS: 55.44,
    audioDurationS: 55.431837,
    assPath,
  });
  assert.equal(result.grade, "green");
});

test("v2 quality report surfaces Flash Lane preflight blockers as hard quality failures", () => {
  const assPath = tempAss(dialogue("0:00:01.00", "0:01:05.00", "story"));
  const scenes = Array.from({ length: 10 }, (_, i) => ({
    type: i < 7 ? "clip" : "card.stat",
    source: `clip-${i % 3}.mp4`,
    mediaStartS: 40 + i,
    duration: 4,
  }));

  const report = buildQualityReportV2({
    storyId: "flash-preflight-blocked",
    outputPath: "test/output/flash-preflight-blocked.mp4",
    pkg: {
      hook: { chosen: { text: "GTA fans just got a confirmed production twist" } },
      script: { tightened: Array.from({ length: 150 }, () => "word").join(" ") },
    },
    scenes,
    transitions: [],
    audioMeta: { provider: "elevenlabs", voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
    audioDurationS: 66,
    assPath,
    soundLayerPayload: { cueCount: 1, filterLines: ["sidechaincompress"] },
    realignedWords: Array.from({ length: 150 }, (_, i) => ({
      word: "word",
      start: i * 0.35,
      end: i * 0.35 + 0.2,
    })),
    renderedDurationS: 67,
    flashLanePreflight: {
      verdict: "block",
      blockers: ["flash_visual_unvalidated_official_clip_segment"],
      warnings: [],
    },
  });

  assert.equal(report.auto.flashLanePreflight.grade, "red");
  assert.equal(report.auto.flashLanePreflight.value, 1);
  assert.equal(report.verdict.lane, "reject");
  assert.ok(report.verdict.reasons.includes("Flash Lane preflight blocked"));
});

test("v2 source diversity treats different trailer offsets as distinct footage beats", () => {
  const assPath = tempAss(dialogue("0:00:01.00", "0:00:02.00", "story"));
  const scenes = [
    { type: "opener", isClipBacked: true, source: "gta.m3u8", mediaStartS: 22.4 },
    { type: "clip", source: "bioshock.m3u8", mediaStartS: 22 },
    { type: "clip", source: "red-dead.m3u8", mediaStartS: 42.8 },
    { type: "clip", source: "gta.m3u8", mediaStartS: 26.9 },
    { type: "card.source", sourceLabel: "GameSpot" },
    { type: "clip", source: "bioshock.m3u8", mediaStartS: 26.5 },
    { type: "clip", source: "red-dead.m3u8", mediaStartS: 47.3 },
    { type: "clip.frame", source: "gta-frame-18.jpg" },
    { type: "clip.frame", source: "bioshock-frame-18.jpg" },
    { type: "card.takeaway", label: "card_takeaway" },
  ];

  const report = buildQualityReportV2({
    storyId: "flash-footage-beats",
    outputPath: "test/output/flash-footage-beats.mp4",
    pkg: {
      hook: { chosen: { text: "Take-Two killed a legacy sequel" } },
      script: { tightened: "word ".repeat(145) },
    },
    scenes,
    transitions: [],
    audioMeta: { source: "provided-real-audio", path: "D:/pulse-data/audio.mp3" },
    audioDurationS: 66,
    assPath,
    soundLayerPayload: { cues: [], mix: { bedDuckingDb: 7 } },
    realignedWords: [],
    renderedDurationS: 67,
  });

  assert.equal(report.auto.sourceDiversity.grade, "green");
  assert.equal(report.auto.sourceDiversity.uniqueSources, 10);
});

test("v2 quality report rejects truncated exports even when creative scores pass", () => {
  const assPath = tempAss(dialogue("0:00:54.52", "0:00:55.36", "survival."));
  const words = Array.from({ length: 20 }, (_, i) => ({
    word: `w${i}`,
    start: i * 2.5,
    end: i * 2.5 + 0.1,
  }));
  const scenes = Array.from({ length: 16 }, (_, i) => ({
    type: i % 4 === 0 ? "clip" : i % 4 === 1 ? "clip.frame" : "punch",
    source: `source-${i}.mp4`,
    duration: 3.4,
  }));
  const transitions = Array.from({ length: 15 }, (_, i) => ({
    type: "cut",
    offset: words[i]?.end || i * 3.4,
  }));
  const report = buildQualityReportV2({
    storyId: "x",
    outputPath: "test/output/x.mp4",
    pkg: {
      hook: {
        chosen: {
          text: "Metro 2039 is real and the reveal is grim today",
        },
      },
      script: {
        tightened: Array.from({ length: 140 }, () => "word").join(" "),
      },
    },
    scenes,
    transitions,
    audioMeta: { provider: "elevenlabs", voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
    audioDurationS: 55.431837,
    assPath,
    soundLayerPayload: {
      cueCount: 1,
      filterLines: ["sidechaincompress=threshold=0.05:ratio=4"],
    },
    realignedWords: words,
    renderedDurationS: 51.2,
    branch: "test",
  });
  assert.equal(report.auto.durationIntegrity.grade, "red");
  assert.equal(report.verdict.lane, "reject");
  assert.ok(
    report.verdict.reasons.includes(
      "render duration does not cover narration/subtitles",
    ),
  );
});

test("v2 quality report rejects legacy local Liam VoxCPM voice renders", () => {
  const assPath = tempAss(dialogue("0:00:00.00", "0:00:59.00", "word"));
  const scenes = Array.from({ length: 12 }, (_, i) => ({
    type: i % 3 === 0 ? "clip" : i % 3 === 1 ? "clip.frame" : "card.source",
    source: `source-${i}.mp4`,
    duration: 5,
  }));
  const transitions = Array.from({ length: 11 }, (_, i) => ({
    type: "cut",
    offset: (i + 1) * 5,
  }));
  const words = Array.from({ length: 140 }, (_, i) => ({
    word: `w${i}`,
    start: i * 0.4,
    end: i * 0.4 + 0.18,
  }));
  const report = buildQualityReportV2({
    storyId: "x",
    outputPath: "test/output/x.mp4",
    pkg: {
      title: "Pokemon Go",
      hook: {
        chosen: {
          text: "Mega Mewtwo is finally real for Pokemon Go players",
        },
      },
      script: {
        raw: Array.from({ length: 140 }, () => "word").join(" "),
        tightened: Array.from({ length: 140 }, () => "word").join(" "),
      },
    },
    scenes,
    transitions,
    audioMeta: {
      provider: "local",
      source: "local-liam-voxcpm-fresh",
      voiceId: "TX3LPaxmHKxFdv7VOQHJ",
    },
    audioDurationS: 60,
    assPath,
    soundLayerPayload: {
      cueCount: 0,
      filterLines: ["sidechaincompress=threshold=0.05:ratio=4"],
    },
    realignedWords: words,
    renderedDurationS: 60,
    branch: "test",
  });

  assert.equal(report.auto.voicePathUsed.grade, "red");
  assert.equal(report.verdict.lane, "reject");
  assert.ok(
    report.verdict.reasons.includes("unapproved local TTS voice path"),
  );
});

test("v2 quality report rejects silent fixture proof audio", () => {
  const assPath = tempAss(dialogue("0:00:00.00", "0:00:59.00", "word"));
  const report = buildQualityReportV2({
    storyId: "silent-proof",
    outputPath: "test/output/silent-proof.mp4",
    pkg: {
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      hook: {
        chosen: {
          text: "Take-Two killed a sequel players still want",
        },
      },
      script: {
        raw: Array.from({ length: 125 }, () => "word").join(" "),
        tightened: Array.from({ length: 125 }, () => "word").join(" "),
      },
    },
    scenes: Array.from({ length: 12 }, (_, i) => ({
      type: i % 2 === 0 ? "clip.frame" : "still",
      source: `source-${i}.jpg`,
      duration: 5,
    })),
    transitions: Array.from({ length: 11 }, (_, i) => ({
      type: "cut",
      offset: (i + 1) * 5,
    })),
    audioMeta: {
      provider: "silent_fixture_with_local_sound_design",
      source: "silent_visual_proof_with_local_bed_and_sfx",
    },
    audioDurationS: 60,
    assPath,
    soundLayerPayload: {
      cueCount: 1,
      filterLines: ["sidechaincompress=threshold=0.05:ratio=4"],
    },
    realignedWords: Array.from({ length: 125 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.4,
      end: i * 0.4 + 0.18,
    })),
    renderedDurationS: 60,
    branch: "test",
  });

  assert.equal(report.auto.voicePathUsed.grade, "red");
  assert.equal(report.auto.voicePathUsed.value, "silent-fixture");
  assert.equal(report.verdict.lane, "reject");
  assert.ok(report.verdict.reasons.includes("silent fixture audio is not a valid pilot proof"));
});

test("v2 quality report rejects unapproved studio local VoxCPM voice renders", () => {
  const assPath = tempAss(dialogue("0:00:00.00", "0:00:59.00", "word"));
  const scenes = Array.from({ length: 12 }, (_, i) => ({
    type: i % 3 === 0 ? "clip" : i % 3 === 1 ? "clip.frame" : "card.source",
    source: `source-${i}.mp4`,
    duration: 5,
  }));
  const transitions = Array.from({ length: 11 }, (_, i) => ({
    type: "cut",
    offset: (i + 1) * 5,
  }));
  const words = Array.from({ length: 140 }, (_, i) => ({
    word: `w${i}`,
    start: i * 0.4,
    end: i * 0.4 + 0.18,
  }));
  const report = buildQualityReportV2({
    storyId: "x",
    outputPath: "test/output/x.mp4",
    pkg: {
      title: "Pokemon Go",
      hook: {
        chosen: {
          text: "Mega Mewtwo is finally real for Pokemon Go players",
        },
      },
      script: {
        raw: Array.from({ length: 140 }, () => "word").join(" "),
        tightened: Array.from({ length: 140 }, () => "word").join(" "),
      },
    },
    scenes,
    transitions,
    audioMeta: {
      provider: "local",
      source: "local-production-voxcpm-path",
      voiceId: "TX3LPaxmHKxFdv7VOQHJ",
      timestampSource: "local-tts-forced-alignment",
    },
    audioDurationS: 60,
    assPath,
    soundLayerPayload: {
      cueCount: 0,
      filterLines: ["sidechaincompress=threshold=0.05:ratio=4"],
    },
    realignedWords: words,
    renderedDurationS: 60,
    branch: "test",
  });

  assert.equal(report.auto.voicePathUsed.grade, "red");
  assert.equal(report.auto.voicePathUsed.value, "local-production-voxcpm");
  assert.equal(report.verdict.lane, "reject");
  assert.ok(
    report.verdict.reasons.includes("unapproved local TTS voice path"),
  );
});

test("v2 quality report allows explicitly approved studio local voice renders for review", () => {
  const assPath = tempAss(dialogue("0:00:00.00", "0:00:59.00", "word"));
  const scenes = Array.from({ length: 12 }, (_, i) => ({
    type: i % 3 === 0 ? "clip" : i % 3 === 1 ? "clip.frame" : "card.source",
    source: `source-${i}.mp4`,
    duration: 5,
  }));
  const transitions = Array.from({ length: 11 }, (_, i) => ({
    type: "cut",
    offset: (i + 1) * 5,
  }));
  const words = Array.from({ length: 140 }, (_, i) => ({
    word: `w${i}`,
    start: i * 0.4,
    end: i * 0.4 + 0.18,
  }));
  const report = buildQualityReportV2({
    storyId: "x",
    outputPath: "test/output/x.mp4",
    pkg: {
      title: "Pokemon Go",
      hook: {
        chosen: {
          text: "Mega Mewtwo is finally real for Pokemon Go players",
        },
      },
      script: {
        raw: Array.from({ length: 140 }, () => "word").join(" "),
        tightened: Array.from({ length: 140 }, () => "word").join(" "),
      },
    },
    scenes,
    transitions,
    audioMeta: {
      provider: "local",
      source: "local-production-chatterbox-path",
      voiceId: "TX3LPaxmHKxFdv7VOQHJ",
      timestampSource: "local-tts-even-alignment",
      approvedLocalVoice: true,
    },
    audioDurationS: 60,
    assPath,
    soundLayerPayload: {
      cueCount: 0,
      filterLines: ["sidechaincompress=threshold=0.05:ratio=4"],
    },
    realignedWords: words,
    renderedDurationS: 60,
    branch: "test",
  });

  assert.equal(report.auto.voicePathUsed.grade, "green");
  assert.equal(report.auto.voicePathUsed.value, "local-production-chatterbox");
  assert.notEqual(report.verdict.lane, "reject");
  assert.ok(
    !report.verdict.reasons.includes("unapproved local TTS voice path"),
  );
});

test("v2 quality report rejects demonic slow local voice pacing", () => {
  const assPath = tempAss(dialogue("0:00:00.00", "0:01:51.00", "word"));
  const scenes = Array.from({ length: 14 }, (_, i) => ({
    type: i % 3 === 0 ? "clip" : i % 3 === 1 ? "punch" : "card.source",
    source: `source-${i}.mp4`,
    duration: 8,
  }));
  const report = buildQualityReportV2({
    storyId: "x",
    outputPath: "test/output/x.mp4",
    pkg: {
      title: "Pokemon Go",
      hook: { chosen: { text: "Mega Mewtwo is real for Pokemon Go players" } },
      script: {
        raw: Array.from({ length: 138 }, () => "word").join(" "),
        tightened: Array.from({ length: 138 }, () => "word").join(" "),
      },
    },
    scenes,
    transitions: Array.from({ length: 13 }, (_, i) => ({
      type: "cut",
      offset: (i + 1) * 8,
    })),
    audioMeta: {
      provider: "local",
      source: "local-production-chatterbox-path",
      voiceId: "TX3LPaxmHKxFdv7VOQHJ",
      timestampSource: "local-tts-forced-alignment",
    },
    audioDurationS: 111.7,
    assPath,
    soundLayerPayload: {
      cueCount: 4,
      filterLines: ["sidechaincompress=threshold=0.05:ratio=4"],
    },
    realignedWords: Array.from({ length: 138 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.8,
      end: i * 0.8 + 0.2,
    })),
    renderedDurationS: 111.7,
    branch: "test",
  });

  assert.equal(report.auto.spokenWPM.grade, "red");
  assert.equal(report.verdict.lane, "reject");
  assert.ok(
    report.verdict.reasons.includes("spoken pacing is outside publishable range"),
  );
});

test("v2 spoken WPM uses aligned narration words when local editorial is shorter than package text", () => {
  const assPath = tempAss(dialogue("0:00:00.00", "0:01:00.00", "word"));
  const scenes = Array.from({ length: 12 }, (_, i) => ({
    type: i % 2 === 0 ? "clip" : "card.source",
    source: `source-${i}.mp4`,
    duration: 5,
  }));
  const report = buildQualityReportV2({
    storyId: "x",
    outputPath: "test/output/x.mp4",
    pkg: {
      title: "Pokemon Go",
      hook: { chosen: { text: "Mega Mewtwo is real for Pokemon Go players" } },
      script: {
        raw: Array.from({ length: 170 }, () => "package").join(" "),
        tightened: Array.from({ length: 170 }, () => "package").join(" "),
      },
    },
    scenes,
    transitions: Array.from({ length: 11 }, (_, i) => ({
      type: "cut",
      offset: (i + 1) * 5,
    })),
    audioMeta: { provider: "local", source: "local-production-voxcpm-path" },
    audioDurationS: 60,
    assPath,
    soundLayerPayload: {
      cueCount: 3,
      filterLines: ["sidechaincompress=threshold=0.05:ratio=4"],
    },
    realignedWords: Array.from({ length: 125 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.4,
      end: i * 0.4 + 0.18,
    })),
    renderedDurationS: 60,
    branch: "test",
  });

  assert.equal(report.auto.spokenWPM.wordCount, 125);
  assert.equal(report.auto.spokenWPM.source, "alignment");
  assert.equal(report.auto.spokenWPM.value, 125);
});

test("v2 sound layer defaults to no SFX unless explicitly enabled", () => {
  const oldMode = process.env.STUDIO_V2_SFX_MODE;
  delete process.env.STUDIO_V2_SFX_MODE;
  try {
    const cues = buildSfxCueList({
      scenes: [
        { type: "opener", duration: 4 },
        { type: "punch", duration: 1.6 },
        { type: "card.source", duration: 4 },
      ],
      transitions: [
        { type: "cut", offset: 4 },
        { type: "cut", offset: 5.6 },
      ],
      openerStingS: 0.6,
    });
    assert.deepEqual(cues, []);
  } finally {
    if (oldMode === undefined) delete process.env.STUDIO_V2_SFX_MODE;
    else process.env.STUDIO_V2_SFX_MODE = oldMode;
  }
});

test("v2 sound layer can pad the audio bed to a longer outro runtime", () => {
  const payload = buildSoundLayerV2({
    scenes: [{ type: "opener", duration: 55 }, { type: "outro", duration: 6 }],
    transitions: [{ type: "cut", offset: 55 }],
    voiceInputIdx: 2,
    musicInputIdx: 3,
    audioInputsBaseIdx: 4,
    audioPlan: { sfxCues: [] },
    targetDurationS: 61,
  });

  assert.ok(
    payload.filterLines.some((line) =>
      line.includes("atrim=duration=61.000"),
    ),
  );
});

test("studio production voice includes the branded spoken outro by default", () => {
  const segments = buildProductionVoiceSegments({
    hook: "Mega Mewtwo is real.",
    body: "The event is free for all players.",
    loop: "That is the real shift.",
  });

  const outro = segments.find((segment) => segment.label === "outro");
  assert.equal(
    outro.text,
    "Follow Pulse Gaming so you never miss a beat.",
  );
  assert.equal(
    resolveStudioOutroLine({}),
    "Follow Pulse Gaming so you never miss a beat.",
  );
});

test("studio production voice can disable the spoken outro for private tests", () => {
  const segments = buildProductionVoiceSegments(
    {
      hook: "Hook.",
      body: "Body.",
      loop: "Loop.",
    },
    { STUDIO_V2_DISABLE_SPOKEN_OUTRO: "true" },
  );

  assert.equal(segments.some((segment) => segment.label === "outro"), false);
});

test("v2 quality report does not penalise SFX when explicitly disabled", () => {
  const oldMode = process.env.STUDIO_V2_SFX_MODE;
  process.env.STUDIO_V2_SFX_MODE = "off";
  const assPath = tempAss(dialogue("0:00:00.00", "0:00:59.00", "word"));
  const scenes = Array.from({ length: 12 }, (_, i) => ({
    type: i % 3 === 0 ? "clip" : i % 3 === 1 ? "clip.frame" : "card.source",
    source: `source-${i}.mp4`,
    duration: 5,
  }));
  try {
    const report = buildQualityReportV2({
      storyId: "x",
      outputPath: "test/output/x.mp4",
      pkg: {
        title: "Pokemon Go",
        hook: { chosen: { text: "Mega Mewtwo is real for Pokemon Go players" } },
        script: {
          raw: Array.from({ length: 140 }, () => "word").join(" "),
          tightened: Array.from({ length: 140 }, () => "word").join(" "),
        },
      },
      scenes,
      transitions: Array.from({ length: 11 }, (_, i) => ({
        type: "cut",
        offset: (i + 1) * 5,
      })),
      audioMeta: { provider: "elevenlabs", voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
      audioDurationS: 60,
      assPath,
      soundLayerPayload: {
        cueCount: 0,
        filterLines: ["sidechaincompress=threshold=0.05:ratio=4"],
      },
      realignedWords: Array.from({ length: 140 }, (_, i) => ({
        word: `w${i}`,
        start: i * 0.4,
        end: i * 0.4 + 0.18,
      })),
      renderedDurationS: 60,
      branch: "test",
    });
    assert.equal(report.auto.sfxEventCount.grade, "green");
    assert.equal(report.auto.sfxEventCount.disabled, true);
  } finally {
    if (oldMode === undefined) delete process.env.STUDIO_V2_SFX_MODE;
    else process.env.STUDIO_V2_SFX_MODE = oldMode;
  }
});

test("v2 audio library builds a forensic-safe studio SFX plan by default", () => {
  const oldMode = process.env.STUDIO_V2_SFX_MODE;
  delete process.env.STUDIO_V2_SFX_MODE;
  try {
    const plan = resolveAudioPlan({
      story: {
        id: "story-1",
        flair: "Verified",
        breaking_score: 20,
      },
      scenes: [
        { type: "opener", duration: 3.2 },
        { type: "punch", duration: 1.6 },
        { type: "clip", duration: 4.2 },
        { type: "card.source", duration: 4 },
        { type: "clip.frame", duration: 3.5 },
        { type: "card.takeaway", duration: 4 },
        { type: "card.stat", duration: 4 },
      ],
      transitions: [
        { type: "cut", offset: 3.2 },
        { type: "cut", offset: 4.8 },
        { type: "cut", offset: 9.0 },
        { type: "cut", offset: 13.0 },
        { type: "cut", offset: 16.5 },
        { type: "cut", offset: 20.5 },
      ],
    });
    assert.equal(plan.decisions.vibe, "verified");
    assert.match(plan.musicBed.path, /Main Background Loop 2\.wav$/);
    assert.equal(plan.sfxCues.length, 2);
    assert.equal(new Set(plan.sfxCues.map((cue) => cue.path)).size, plan.sfxCues.length);
    assert.ok(plan.sfxCues.every((cue) => cue.vol > 0 && cue.vol <= 0.16));
    assert.ok(plan.sfxCues.every((cue) => fs.existsSync(cue.path)));
    assert.equal(plan.decisions.sfxMode, "studio");
    assert.equal(plan.decisions.sfxCueCount, plan.sfxCues.length);
    assert.equal(plan.decisions.forensicSafeCueCount, true);
    assert.ok(plan.decisions.sfxBreakdown.reveal >= 1);
    assert.ok(
      (plan.decisions.sfxBreakdown.boom || plan.decisions.sfxBreakdown.impact || 0) >= 1,
    );
  } finally {
    if (oldMode === undefined) delete process.env.STUDIO_V2_SFX_MODE;
    else process.env.STUDIO_V2_SFX_MODE = oldMode;
  }
});

test("v2 audio library still supports an explicit SFX off switch", () => {
  const oldMode = process.env.STUDIO_V2_SFX_MODE;
  process.env.STUDIO_V2_SFX_MODE = "off";
  try {
    const plan = resolveAudioPlan({
      story: {
        id: "story-1",
        flair: "Verified",
        breaking_score: 20,
      },
      scenes: [{ type: "opener", duration: 3 }],
      transitions: [],
    });
    assert.deepEqual(plan.sfxCues, []);
    assert.equal(plan.decisions.sfxMode, "off");
    assert.equal(plan.decisions.sfxCueCount, 0);
  } finally {
    if (oldMode === undefined) delete process.env.STUDIO_V2_SFX_MODE;
    else process.env.STUDIO_V2_SFX_MODE = oldMode;
  }
});

test("local TTS health summary recognises the loaded Pulse voice without leaking secrets", () => {
  const summary = summariseLocalTtsHealth(
    {
      status: "ok",
      ready: true,
      phase: "ready",
      voices: [
        {
          voice_id: "TX3LPaxmHKxFdv7VOQHJ",
          alias: "liam",
          loaded: true,
          ref_resolved: true,
        },
      ],
      engine_count: 1,
    },
    "TX3LPaxmHKxFdv7VOQHJ",
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.status, "ok");
  assert.equal(summary.voice.loaded, true);
  assert.deepEqual(summary.reasons, []);
  assert.equal(JSON.stringify(summary).includes("audio_base64"), false);
});

test("local TTS health summary fails closed when the Pulse voice is not loaded", () => {
  const summary = summariseLocalTtsHealth(
    {
      status: "ok",
      ready: false,
      phase: "warming",
      voices: [
        {
          voice_id: "TX3LPaxmHKxFdv7VOQHJ",
          alias: "liam",
          loaded: false,
          ref_resolved: true,
        },
      ],
      engine_count: 0,
    },
    "TX3LPaxmHKxFdv7VOQHJ",
  );

  assert.equal(summary.ok, false);
  assert.match(summary.reasons.join(" "), /not ready/);
  assert.match(summary.reasons.join(" "), /not loaded/);
});

test("v2 audio library can be held to tracked beds only with minimal mode", () => {
  const oldMode = process.env.STUDIO_V2_SFX_MODE;
  process.env.STUDIO_V2_SFX_MODE = "minimal";
  const plan = resolveAudioPlan({
    story: {
      id: "story-1",
      flair: "Verified",
      breaking_score: 20,
    },
  });
  try {
    assert.equal(plan.decisions.vibe, "verified");
    assert.match(plan.musicBed.path, /Main Background Loop 2\.wav$/);
    assert.deepEqual(plan.sfxCues, []);
    assert.deepEqual(plan.decisions.sfxBreakdown, {});
  } finally {
    if (oldMode === undefined) delete process.env.STUDIO_V2_SFX_MODE;
    else process.env.STUDIO_V2_SFX_MODE = oldMode;
  }
});

test("local voice pace guard rejects stale slow Chatterbox cache", () => {
  const text = Array.from({ length: 138 }, () => "word").join(" ");
  const result = evaluateLocalVoicePace({
    provider: "local",
    source: "local-production-chatterbox-path",
    durationS: 111.738,
    text,
    env: { STUDIO_V2_LOCAL_TTS_MIN_WPM: "105" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.wordCount, 138);
  assert.equal(result.wpm, 74.1);
  assert.match(result.reason, /below minimum/);
});

test("local voice pace guard accepts current Chatterbox pacing", () => {
  const text = Array.from({ length: 138 }, () => "word").join(" ");
  const result = evaluateLocalVoicePace({
    provider: "local",
    source: "local-production-chatterbox-path",
    durationS: 64.068,
    text,
    env: { STUDIO_V2_LOCAL_TTS_MIN_WPM: "105" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.wpm, 129.2);
});

test("studio local voice path applies a Shorts pacing multiplier", () => {
  const original = [
    { label: "hook", text: "Hook", rate: 1.05 },
    { label: "body", text: "Body", rate: 0.95 },
  ];

  const scaled = applyLocalVoiceRateMultiplier(original, {
    STUDIO_V2_LOCAL_TTS_RATE_MULTIPLIER: "1.7",
    STUDIO_V2_LOCAL_TTS_BASE_SPEED: "1",
    STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP: "3",
  });

  assert.deepEqual(scaled, [
    { label: "hook", text: "Hook", rate: 1.785 },
    { label: "body", text: "Body", rate: 1.615 },
  ]);
  assert.deepEqual(original, [
    { label: "hook", text: "Hook", rate: 1.05 },
    { label: "body", text: "Body", rate: 0.95 },
  ]);
});

test("studio local voice path caps effective VoxCPM stretch below the warble zone", () => {
  const scaled = applyLocalVoiceRateMultiplier(
    [
      { label: "hook", text: "Hook", rate: 1.155 },
      { label: "body", text: "Body", rate: 1.045 },
    ],
    {
      STUDIO_V2_LOCAL_TTS_RATE_MULTIPLIER: "1.75",
      STUDIO_V2_LOCAL_TTS_BASE_SPEED: "1.4",
      STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP: "1.9",
    },
  );

  assert.deepEqual(scaled, [
    { label: "hook", text: "Hook", rate: 1.357 },
    { label: "body", text: "Body", rate: 1.357 },
  ]);
});

test("studio local voice path keeps Chatterbox away from VoxCPM stretch settings", () => {
  const scaled = applyLocalVoiceRateMultiplier(
    [
      { label: "hook", text: "Hook", rate: 1.155 },
      { label: "body", text: "Body", rate: 1.045 },
    ],
    {
      LOCAL_TTS_ENGINE: "chatterbox",
      STUDIO_V2_LOCAL_TTS_RATE_MULTIPLIER: "1.75",
      STUDIO_V2_LOCAL_TTS_BASE_SPEED: "1.4",
      STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP: "1.9",
      STUDIO_V2_CHATTERBOX_RATE_MULTIPLIER: "1.4",
      STUDIO_V2_CHATTERBOX_EFFECTIVE_RATE_CAP: "1.7",
    },
  );

  assert.equal(resolveLocalTtsEngine({ LOCAL_TTS_ENGINE: "chatterbox" }), "chatterbox");
  assert.deepEqual(scaled, [
    { label: "hook", text: "Hook", rate: 1.617 },
    { label: "body", text: "Body", rate: 1.463 },
  ]);
});

test("studio local voice path chunks long body segments into timeout-safe calls", () => {
  const longBody = [
    "Mega Mewtwo is finally coming to Pokemon Go and that changes the event.",
    "Niantic is making the global event free which means every player can join the hunt.",
    "The important part is that this reverses years of premium ticket pressure.",
    "Players who left because the game felt too expensive suddenly have a reason to return.",
    "That makes this more than a monster reveal because it is a monetisation reset.",
  ].join(" ");

  const chunks = splitLongVoiceSegments(
    [{ label: "body", text: longBody, rate: 1.7 }],
    { maxWords: 24, maxChars: 180 },
  );

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.label.startsWith("body_")));
  assert.ok(chunks.every((chunk) => chunk.text.split(/\s+/).length <= 24));
  assert.equal(chunks.map((chunk) => chunk.text).join(" "), longBody);
});

test("studio production voice implementation sends segment text after local pacing", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "lib", "studio", "sound-layer.js"),
    "utf8",
  );
  assert.match(src, /productionAudio\.generateTTS\(\s*segment\.text,/);
  assert.doesNotMatch(src, /productionAudio\.generateTTS\(\s*segment\.cleanText,/);
});

test("studio-v2-render supports local VoxCPM through the production-shaped path", () => {
  const oldSkipDotenv = process.env.PULSE_SKIP_DOTENV;
  const oldVoice = process.env.STUDIO_V2_VOICE;
  const oldAllow = process.env.STUDIO_V2_ALLOW_UNAPPROVED_LOCAL_VOICE;
  process.env.PULSE_SKIP_DOTENV = "true";
  const { resolveStudioV2VoiceMode } = require("../../tools/studio-v2-render");

  try {
    process.env.STUDIO_V2_VOICE = "local";
    delete process.env.STUDIO_V2_ALLOW_UNAPPROVED_LOCAL_VOICE;
    assert.equal(resolveStudioV2VoiceMode(), "local");

    process.env.STUDIO_V2_VOICE = "voxcpm";
    assert.equal(resolveStudioV2VoiceMode(), "local");

    process.env.STUDIO_V2_VOICE = "local-liam";
    delete process.env.STUDIO_V2_ALLOW_UNAPPROVED_LOCAL_VOICE;
    assert.throws(
      () => resolveStudioV2VoiceMode(),
      /Refusing legacy local Liam VoxCPM voice/,
    );

    process.env.STUDIO_V2_ALLOW_UNAPPROVED_LOCAL_VOICE = "true";
    assert.equal(resolveStudioV2VoiceMode(), "local-liam");

    process.env.STUDIO_V2_VOICE = "not-a-real-voice-mode";
    assert.throws(
      () => resolveStudioV2VoiceMode(),
      /Unknown STUDIO_V2_VOICE/,
    );
  } finally {
    if (oldSkipDotenv === undefined) delete process.env.PULSE_SKIP_DOTENV;
    else process.env.PULSE_SKIP_DOTENV = oldSkipDotenv;
    if (oldVoice === undefined) delete process.env.STUDIO_V2_VOICE;
    else process.env.STUDIO_V2_VOICE = oldVoice;
    if (oldAllow === undefined)
      delete process.env.STUDIO_V2_ALLOW_UNAPPROVED_LOCAL_VOICE;
    else process.env.STUDIO_V2_ALLOW_UNAPPROVED_LOCAL_VOICE = oldAllow;
  }
});
