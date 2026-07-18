const { test } = require("node:test");
const assert = require("node:assert");

const {
  runVideoQa,
  classifyVideoQa,
  parseFfprobeDuration,
  parseBlackdetectOutput,
  parseFreezedetectOutput,
  parseFramehashOutput,
  repeatedFrameHashPairs,
  parseTemporalFrameBuffer,
  analyzeTemporalFrames,
  validateTemporalVideoQaReport,
  DEFAULT_MIN_DURATION_SECONDS,
  DEFAULT_MIN_RETENTION_SHORT_SECONDS,
  DEFAULT_MIN_NORMAL_PRODUCTION_SECONDS,
  DEFAULT_MAX_NORMAL_PRODUCTION_SECONDS,
  DEFAULT_MAX_DURATION_SECONDS,
  DEFAULT_MAX_BLACK_SEGMENT_SECONDS,
  DEFAULT_MAX_FREEZE_SEGMENT_SECONDS,
  DEFAULT_MAX_CUMULATIVE_FREEZE_SECONDS,
  buildVideoQaOptionsForStory,
} = require("../../lib/services/video-qa");

// ---------- ffprobe output parsing ----------

test("parseFfprobeDuration: extracts the duration from normal output", () => {
  const out = "duration=50.437100\n";
  assert.strictEqual(parseFfprobeDuration(out), 50.4371);
});

test("parseFfprobeDuration: case-insensitive + tolerates whitespace", () => {
  assert.strictEqual(parseFfprobeDuration("DURATION=12.5\n"), 12.5);
});

test("parseFfprobeDuration: returns null on empty / malformed / non-string", () => {
  assert.strictEqual(parseFfprobeDuration(""), null);
  assert.strictEqual(parseFfprobeDuration("garbage"), null);
  assert.strictEqual(parseFfprobeDuration(null), null);
  assert.strictEqual(parseFfprobeDuration(undefined), null);
  assert.strictEqual(parseFfprobeDuration("duration=NaN"), null);
});

// ---------- blackdetect output parsing ----------

test("parseBlackdetectOutput: parses a single black segment", () => {
  const stderr = `
    [blackdetect @ 0x123] black_start:0 black_end:1.234 black_duration:1.234
  `;
  assert.deepStrictEqual(parseBlackdetectOutput(stderr), [
    { start: 0, end: 1.234, duration: 1.234 },
  ]);
});

test("parseBlackdetectOutput: parses multiple segments", () => {
  const stderr = `
    [blackdetect @ 0x123] black_start:0.5 black_end:1.1 black_duration:0.6
    [blackdetect @ 0x456] black_start:8.0 black_end:12.0 black_duration:4.0
  `;
  const segs = parseBlackdetectOutput(stderr);
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0].duration, 0.6);
  assert.strictEqual(segs[1].duration, 4);
});

test("parseBlackdetectOutput: returns empty array on empty/no-match input", () => {
  assert.deepStrictEqual(parseBlackdetectOutput(""), []);
  assert.deepStrictEqual(parseBlackdetectOutput("some unrelated log"), []);
  assert.deepStrictEqual(parseBlackdetectOutput(null), []);
});

test("parseFreezedetectOutput: parses freeze start, duration and end triples", () => {
  const stderr = `
    [freezedetect @ 0x123] lavfi.freezedetect.freeze_start: 21.9
    [freezedetect @ 0x123] lavfi.freezedetect.freeze_duration: 0.766667
    [freezedetect @ 0x123] lavfi.freezedetect.freeze_end: 22.666667
    [freezedetect @ 0x123] lavfi.freezedetect.freeze_start: 32.666667
    [freezedetect @ 0x123] lavfi.freezedetect.freeze_duration: 0.8
    [freezedetect @ 0x123] lavfi.freezedetect.freeze_end: 33.466667
  `;

  assert.deepStrictEqual(parseFreezedetectOutput(stderr), [
    { start: 21.9, end: 22.666667, duration: 0.766667 },
    { start: 32.666667, end: 33.466667, duration: 0.8 },
  ]);
});

test("parseFramehashOutput extracts sampled frame hashes from framemd5 output", () => {
  const stdout = `
    #format: frame checksums
    #stream#, dts,        pts, duration,     size, hash
    0,          0,          0,        1,     4096, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    0,          1,          1,        1,     4096, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    0,          4,          4,        1,     4096, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  `;

  assert.deepStrictEqual(parseFramehashOutput(stdout), [
    { index: 0, hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { index: 1, hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    { index: 2, hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  ]);
});

test("repeatedFrameHashPairs ignores adjacent repeats but catches later visual loops", () => {
  const pairs = repeatedFrameHashPairs([
    { index: 0, hash: "same" },
    { index: 1, hash: "same" },
    { index: 3, hash: "same" },
  ]);

  assert.deepStrictEqual(pairs, [
    { hash: "same", first_index: 0, repeat_index: 3, gap: 3 },
  ]);
});

function temporalFrame(index, hash) {
  return {
    index,
    time_seconds: index / 6,
    hash,
  };
}

function passingTemporalAnalysis(durationSeconds = 50) {
  return {
    analysis_scope: "full_frame",
    scan_complete: true,
    sample_fps: 6,
    sampled_frame_count: durationSeconds * 6,
    coverage_ratio: 1,
    repeated_motion_sequences: [],
    repeated_motion_seconds: 0,
    cadence: {
      choppy: false,
      overall_near_static_ratio: 0,
      max_window_near_static_ratio: 0,
    },
    supplemental_center_crop: {
      analysis_scope: "center_crop",
      scan_complete: true,
      sample_fps: 6,
      sampled_frame_count: durationSeconds * 6,
      coverage_ratio: 1,
      repeated_motion_sequences: [],
      repeated_motion_seconds: 0,
      cadence: {
        choppy: false,
        overall_near_static_ratio: 0,
        max_window_near_static_ratio: 0,
      },
    },
  };
}

function grayFrameFromHash(hashValue) {
  const frame = Buffer.alloc(9 * 8);
  const hash = BigInt.asUintN(64, BigInt(hashValue));
  for (let row = 0; row < 8; row += 1) {
    let value = 128;
    frame[row * 9] = value;
    for (let column = 0; column < 8; column += 1) {
      const bitIndex = 63 - (row * 8 + column);
      const bit = (hash >> BigInt(bitIndex)) & 1n;
      value += bit === 1n ? -2 : 2;
      frame[row * 9 + column + 1] = value;
    }
  }
  return frame;
}

function healthyTemporalBuffer(frameCount) {
  return Buffer.concat(
    Array.from({ length: frameCount }, (_, index) =>
      grayFrameFromHash(
        BigInt.asUintN(
          64,
          BigInt(index + 1) * 0x9e3779b97f4a7c15n ^
            BigInt(index + 11) * 0xbf58476d1ce4e5b9n,
        ),
      ),
    ),
  );
}

test("parseTemporalFrameBuffer decodes every fixed-size greyscale sample into a perceptual hash", () => {
  const frameA = Buffer.from([
    9, 8, 7, 6, 5, 4, 3, 2, 1,
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    9, 8, 7, 6, 5, 4, 3, 2, 1,
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    9, 8, 7, 6, 5, 4, 3, 2, 1,
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    9, 8, 7, 6, 5, 4, 3, 2, 1,
    1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]);
  const frameB = Buffer.from(frameA.map((value) => 255 - value));
  const frames = parseTemporalFrameBuffer(Buffer.concat([frameA, frameB]), {
    sampleFps: 6,
  });

  assert.strictEqual(frames.length, 2);
  assert.strictEqual(frames[0].time_seconds, 0);
  assert.strictEqual(frames[1].time_seconds, 1 / 6);
  assert.match(frames[0].hash, /^[0-9a-f]{16}$/);
  assert.notStrictEqual(frames[0].hash, frames[1].hash);
});

test("analyzeTemporalFrames detects a repeated dynamic clip sequence across the full timeline", () => {
  const first = Array.from({ length: 12 }, (_, index) =>
    temporalFrame(index, (0x1000000000000000n + BigInt(index * 0x10101)).toString(16)),
  );
  const middle = Array.from({ length: 24 }, (_, offset) =>
    temporalFrame(12 + offset, (0x2000000000000000n + BigInt(offset * 0x30103)).toString(16)),
  );
  const repeat = first.map((frame, offset) =>
    temporalFrame(36 + offset, frame.hash),
  );

  const report = analyzeTemporalFrames([...first, ...middle, ...repeat], {
    sampleFps: 6,
    minRepeatedSequenceSeconds: 1.5,
    minRepeatedSequenceGapSeconds: 3,
  });

  assert.strictEqual(report.scan_complete, true);
  assert.ok(report.repeated_motion_sequences.length >= 1);
  assert.ok(report.repeated_motion_seconds >= 1.5);
  assert.ok(
    report.repeated_motion_sequences.some(
      (row) => row.first_start_seconds === 0 && row.repeat_start_seconds === 6,
    ),
  );
});

test("analyzeTemporalFrames does not misclassify one brief static editorial card as global choppiness", () => {
  const frames = Array.from({ length: 180 }, (_, index) => {
    const hash =
      index >= 72 && index < 80
        ? "aaaaaaaaaaaaaaaa"
        : (0x1000000000000000n + BigInt(index * 0x100001)).toString(16);
    return temporalFrame(index, hash);
  });

  const report = analyzeTemporalFrames(frames, {
    sampleFps: 6,
    expectedDurationSeconds: 30,
  });

  assert.strictEqual(report.cadence.choppy, false);
  assert.ok(report.cadence.overall_near_static_ratio < 0.1);
});

test("analyzeTemporalFrames marks sustained repeated-frame cadence as choppy", () => {
  const frames = Array.from({ length: 180 }, (_, index) => {
    const sourceIndex = Math.floor(index / 4);
    return temporalFrame(
      index,
      (0x3000000000000000n + BigInt(sourceIndex * 0x100001)).toString(16),
    );
  });

  const report = analyzeTemporalFrames(frames, {
    sampleFps: 6,
    expectedDurationSeconds: 30,
  });

  assert.strictEqual(report.cadence.choppy, true);
  assert.ok(report.cadence.overall_near_static_ratio >= 0.7);
  assert.ok(report.cadence.max_window_near_static_ratio >= 0.7);
});

test("analyzeTemporalFrames measures static cadence even when the video is shorter than one cadence window", () => {
  const frames = Array.from({ length: 14 }, (_, index) =>
    temporalFrame(index, "aaaaaaaaaaaaaaaa"),
  );

  const report = analyzeTemporalFrames(frames, {
    sampleFps: 6,
    expectedDurationSeconds: 2.4,
  });

  assert.strictEqual(report.scan_complete, true);
  assert.strictEqual(report.cadence.max_window_near_static_ratio, 1);
  assert.strictEqual(report.cadence.choppy, true);
});

test("validateTemporalVideoQaReport requires exact GREEN evidence bound to the current render", () => {
  const validation = validateTemporalVideoQaReport(
    {
      story_id: "arknights",
      verdict: "GREEN",
      can_publish: true,
      blockers: [],
      warnings: [],
      final_media: {
        sha256: "a".repeat(64),
        size_bytes: 1024,
      },
      evidence: {
        decode: {
          complete: true,
          video_stream: true,
          audio_stream: true,
        },
        temporal: {
          analysis_scope: "full_frame",
          scan_complete: true,
          coverage_ratio: 1,
          sampled_frame_count: 300,
          repeated_motion_sequences: [],
          repeated_motion_seconds: 0,
          cadence: { choppy: false },
          supplemental_center_crop: {
            analysis_scope: "center_crop",
            scan_complete: true,
            coverage_ratio: 1,
            sampled_frame_count: 300,
            repeated_motion_sequences: [],
            repeated_motion_seconds: 0,
            cadence: { choppy: false },
          },
        },
      },
      source_result: {
        result: "pass",
        failures: [],
        warnings: [],
      },
    },
    {
      storyId: "arknights",
      renderSha256: "a".repeat(64),
      renderSizeBytes: 1024,
    },
  );

  assert.strictEqual(validation.verdict, "GREEN");
  assert.strictEqual(validation.valid, true);
  assert.deepStrictEqual(validation.blockers, []);
});

test("validateTemporalVideoQaReport rejects stale hashes and repeated or choppy media", () => {
  const validation = validateTemporalVideoQaReport(
    {
      story_id: "arknights",
      verdict: "GREEN",
      can_publish: true,
      blockers: [],
      warnings: [],
      final_media: {
        sha256: "b".repeat(64),
        size_bytes: 2048,
      },
      evidence: {
        decode: {
          complete: true,
          video_stream: true,
          audio_stream: true,
        },
        temporal: {
          analysis_scope: "full_frame",
          scan_complete: true,
          coverage_ratio: 1,
          sampled_frame_count: 300,
          repeated_motion_sequences: [
            {
              first_start_seconds: 3,
              repeat_start_seconds: 20,
              duration_seconds: 2,
            },
          ],
          repeated_motion_seconds: 2,
          cadence: { choppy: true },
          supplemental_center_crop: {
            analysis_scope: "center_crop",
            scan_complete: true,
            coverage_ratio: 1,
            sampled_frame_count: 300,
            repeated_motion_sequences: [],
            repeated_motion_seconds: 0,
            cadence: { choppy: false },
          },
        },
      },
      source_result: {
        result: "pass",
        failures: [],
        warnings: [],
      },
    },
    {
      storyId: "arknights",
      renderSha256: "a".repeat(64),
      renderSizeBytes: 1024,
    },
  );

  assert.strictEqual(validation.verdict, "RED");
  assert.strictEqual(validation.valid, false);
  assert.ok(validation.blockers.includes("temporal_video_qa_render_hash_mismatch"));
  assert.ok(validation.blockers.includes("temporal_video_qa_render_size_mismatch"));
  assert.ok(validation.blockers.includes("temporal_video_qa_repeated_motion_detected"));
  assert.ok(validation.blockers.includes("temporal_video_qa_choppy_cadence"));
});

test("validateTemporalVideoQaReport rejects a crop-only GREEN report", () => {
  const validation = validateTemporalVideoQaReport(
    {
      story_id: "arknights",
      verdict: "GREEN",
      can_publish: true,
      blockers: [],
      warnings: [],
      final_media: {
        sha256: "a".repeat(64),
        size_bytes: 1024,
      },
      evidence: {
        decode: {
          complete: true,
          video_stream: true,
          audio_stream: true,
        },
        temporal: {
          analysis_scope: "center_crop",
          scan_complete: true,
          coverage_ratio: 1,
          sampled_frame_count: 300,
          repeated_motion_sequences: [],
          repeated_motion_seconds: 0,
          cadence: { choppy: false },
        },
      },
      source_result: {
        result: "pass",
        failures: [],
        warnings: [],
      },
    },
    {
      storyId: "arknights",
      renderSha256: "a".repeat(64),
      renderSizeBytes: 1024,
    },
  );

  assert.strictEqual(validation.verdict, "RED");
  assert.ok(validation.blockers.includes("temporal_video_qa_full_frame_scope_missing"));
  assert.ok(validation.blockers.includes("temporal_video_qa_center_crop_scope_missing"));
});

test("buildVideoQaOptionsForStory only permits short retention edits when metadata says so", () => {
  const blocked = classifyVideoQa({ durationSeconds: 35.2, blackSegments: [] });
  assert.strictEqual(blocked.result, "fail");
  assert.ok(blocked.failures.some((f) => f.startsWith("duration_too_short")));

  const options = buildVideoQaOptionsForStory({
    duration_lane: "pulse_retention_short",
    allow_retention_short_video: true,
  });
  const allowed = classifyVideoQa({
    durationSeconds: 35.2,
    blackSegments: [],
    decodeEvidence: { complete: true, video_stream: true, audio_stream: true },
    temporalAnalysis: passingTemporalAnalysis(35.2),
    ...options,
  });

  assert.strictEqual(options.minDuration, DEFAULT_MIN_RETENTION_SHORT_SECONDS);
  assert.strictEqual(allowed.result, "pass");
});

test("buildVideoQaOptionsForStory permits governed normal-production V4 shorts from 35 to 60 seconds", () => {
  const blockedByLegacyFloor = classifyVideoQa({ durationSeconds: 37.28, blackSegments: [] });
  assert.strictEqual(blockedByLegacyFloor.result, "fail");
  assert.ok(blockedByLegacyFloor.failures.some((f) => f.startsWith("duration_too_short")));

  const options = buildVideoQaOptionsForStory({
    duration_lane: "normal_production",
    render_lane: "visual_v4_production",
    render_quality_class: "premium",
  });
  const allowed = classifyVideoQa({
    durationSeconds: 37.28,
    blackSegments: [],
    decodeEvidence: { complete: true, video_stream: true, audio_stream: true },
    temporalAnalysis: passingTemporalAnalysis(37.28),
    ...options,
  });
  const overlong = classifyVideoQa({
    durationSeconds: 64,
    blackSegments: [],
    decodeEvidence: { complete: true, video_stream: true, audio_stream: true },
    temporalAnalysis: passingTemporalAnalysis(64),
    ...options,
  });

  assert.strictEqual(options.minDuration, DEFAULT_MIN_NORMAL_PRODUCTION_SECONDS);
  assert.strictEqual(options.maxDuration, DEFAULT_MAX_NORMAL_PRODUCTION_SECONDS);
  assert.strictEqual(allowed.result, "pass");
  assert.strictEqual(overlong.result, "fail");
  assert.ok(overlong.failures.some((f) => f.startsWith("duration_too_long")));
});

// ---------- classifyVideoQa: duration branch ----------

test("classifyVideoQa: a 50s video with no black segments → pass", () => {
  const r = classifyVideoQa({ durationSeconds: 50.5, blackSegments: [] });
  assert.strictEqual(r.result, "pass");
  assert.deepStrictEqual(r.failures, []);
  assert.deepStrictEqual(r.warnings, []);
});

test("classifyVideoQa: duration below min → fail:duration_too_short", () => {
  const r = classifyVideoQa({ durationSeconds: 12.0, blackSegments: [] });
  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((f) => f.startsWith("duration_too_short")),
    `got: ${r.failures.join(", ")}`,
  );
});

test("classifyVideoQa: duration above max → fail:duration_too_long", () => {
  const r = classifyVideoQa({ durationSeconds: 120, blackSegments: [] });
  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((f) => f.startsWith("duration_too_long")),
    `got: ${r.failures.join(", ")}`,
  );
});

test("classifyVideoQa: unknown duration → fail:duration_unknown", () => {
  const r = classifyVideoQa({ durationSeconds: null, blackSegments: [] });
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("duration_unknown"));
});

// ---------- classifyVideoQa: blackdetect branch ----------

test("classifyVideoQa: 4s mid-video black segment → fail", () => {
  const r = classifyVideoQa({
    durationSeconds: 50,
    blackSegments: [{ start: 10, end: 14, duration: 4 }],
  });
  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((f) => f.startsWith("black_segment_too_long")),
    `got: ${r.failures.join(", ")}`,
  );
});

test("classifyVideoQa: 1s opening black → warn:opening_black", () => {
  // Opening-only black between the 0.5s xfade floor and the hard
  // 2s bound: a soft warning, not a fail.
  const r = classifyVideoQa({
    durationSeconds: 50,
    blackSegments: [{ start: 0, end: 1.0, duration: 1.0 }],
  });
  assert.strictEqual(r.result, "warn");
  assert.ok(
    r.warnings.some((w) => w.startsWith("opening_black")),
    `got: ${r.warnings.join(", ")}`,
  );
});

test("classifyVideoQa: 0.5s opening dip → pass (that's the expected xfade)", () => {
  const r = classifyVideoQa({
    durationSeconds: 50,
    blackSegments: [{ start: 0, end: 0.5, duration: 0.5 }],
  });
  assert.strictEqual(r.result, "pass");
});

test("classifyVideoQa: multiple short mid-segments under 2s each → pass", () => {
  const r = classifyVideoQa({
    durationSeconds: 50,
    blackSegments: [
      { start: 8, end: 8.5, duration: 0.5 },
      { start: 16, end: 16.5, duration: 0.5 },
      { start: 24, end: 24.5, duration: 0.5 },
    ],
  });
  assert.strictEqual(r.result, "pass");
});

test("classifyVideoQa blocks choppy renders with mid black and freeze debt", () => {
  const r = classifyVideoQa({
    durationSeconds: 40.91,
    minDuration: 35,
    maxDuration: 60,
    blackSegments: [{ start: 21.9, end: 23.6, duration: 1.7 }],
    freezeSegments: [
      { start: 21.9, end: 22.433333, duration: 0.533333 },
      { start: 22.633333, end: 23.4, duration: 0.766667 },
      { start: 32.666667, end: 33.466667, duration: 0.8 },
    ],
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((f) => f.startsWith("black_segment_too_long")),
    `got: ${r.failures.join(", ")}`,
  );
  assert.ok(
    r.failures.some((f) => f.startsWith("freeze_segment_too_long")),
    `got: ${r.failures.join(", ")}`,
  );
  assert.ok(
    r.failures.some((f) => f.startsWith("cumulative_freeze_too_high")),
    `got: ${r.failures.join(", ")}`,
  );
});

test("classifyVideoQa does not add isolated editorial micro-holds into cumulative freeze debt", () => {
  const r = classifyVideoQa({
    durationSeconds: 48.2,
    minDuration: 35,
    maxDuration: 60,
    blackSegments: [],
    freezeSegments: Array.from({ length: 9 }, (_, index) => ({
      start: 4 + index * 4.5,
      end: 4.3 + index * 4.5,
      duration: 0.3,
    })),
  });

  assert.strictEqual(r.result, "pass");
  assert.ok(!r.failures.some((failure) => failure.startsWith("cumulative_freeze_too_high")));
});

test("classifyVideoQa: short duration AND long black → both failures captured", () => {
  const r = classifyVideoQa({
    durationSeconds: 15,
    blackSegments: [{ start: 5, end: 9, duration: 4 }],
  });
  assert.strictEqual(r.result, "fail");
  assert.strictEqual(r.failures.length, 2);
});

test("classifyVideoQa blocks non-adjacent repeated frame hashes", () => {
  const r = classifyVideoQa({
    durationSeconds: 44,
    minDuration: 35,
    maxDuration: 60,
    blackSegments: [],
    freezeSegments: [],
    repeatedFramePairs: [
      { hash: "loop", first_index: 2, repeat_index: 11, gap: 9 },
    ],
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((f) => f.startsWith("repeated_frame_hashes")),
    `got: ${r.failures.join(", ")}`,
  );
});

test("classifyVideoQa fails closed when the full-duration temporal scan is missing", () => {
  const r = classifyVideoQa({
    durationSeconds: 44,
    minDuration: 35,
    maxDuration: 60,
    blackSegments: [],
    freezeSegments: [],
    requireTemporalScan: true,
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("temporal_scan_missing"));
});

test("classifyVideoQa fails closed when the final audio and video streams were not fully decoded", () => {
  const r = classifyVideoQa({
    durationSeconds: 44,
    minDuration: 35,
    maxDuration: 60,
    blackSegments: [],
    freezeSegments: [],
    requireDecodeScan: true,
    decodeEvidence: {
      complete: false,
      video_stream: true,
      audio_stream: false,
      error: "audio_stream_missing",
    },
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("media_decode_failed:audio_stream_missing"));
});

test("classifyVideoQa blocks perceptually repeated motion sequences", () => {
  const r = classifyVideoQa({
    durationSeconds: 44,
    minDuration: 35,
    maxDuration: 60,
    blackSegments: [],
    freezeSegments: [],
    temporalAnalysis: {
      scan_complete: true,
      repeated_motion_seconds: 2,
      repeated_motion_sequences: [
        {
          first_start_seconds: 2,
          repeat_start_seconds: 18,
          duration_seconds: 2,
        },
      ],
      cadence: { choppy: false },
    },
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.some((f) => f.startsWith("repeated_motion_sequence")));
});

test("classifyVideoQa blocks sustained choppy temporal cadence", () => {
  const r = classifyVideoQa({
    durationSeconds: 44,
    minDuration: 35,
    maxDuration: 60,
    blackSegments: [],
    freezeSegments: [],
    temporalAnalysis: {
      scan_complete: true,
      repeated_motion_seconds: 0,
      repeated_motion_sequences: [],
      cadence: {
        choppy: true,
        overall_near_static_ratio: 0.74,
        max_window_near_static_ratio: 0.89,
      },
    },
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.some((f) => f.startsWith("choppy_temporal_cadence")));
});

test("classifyVideoQa blocks repetition detected only by the centre-crop temporal scan", () => {
  const r = classifyVideoQa({
    durationSeconds: 44,
    minDuration: 35,
    maxDuration: 60,
    blackSegments: [],
    freezeSegments: [],
    requireTemporalScan: true,
    temporalAnalysis: {
      analysis_scope: "full_frame",
      scan_complete: true,
      coverage_ratio: 1,
      sampled_frame_count: 264,
      repeated_motion_seconds: 0,
      repeated_motion_sequences: [],
      cadence: { choppy: false },
      supplemental_center_crop: {
        analysis_scope: "center_crop",
        scan_complete: true,
        coverage_ratio: 1,
        sampled_frame_count: 264,
        repeated_motion_seconds: 2,
        repeated_motion_sequences: [
          {
            first_start_seconds: 2,
            repeat_start_seconds: 18,
            duration_seconds: 2,
          },
        ],
        cadence: { choppy: false },
      },
    },
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((failure) =>
      failure.startsWith("repeated_motion_sequence_center_crop"),
    ),
  );
});

// ---------- runVideoQa: mocked exec ----------

function stubExec(handlers) {
  // handlers: function(cmd) → returns { stdout, stderr } OR throws
  return async (cmd, _opts) => handlers(cmd);
}

function fakeFs(existsMap) {
  return {
    async pathExists(p) {
      return !!existsMap[p];
    },
  };
}

test("runVideoQa: missing mp4_path → fail", async () => {
  const r = await runVideoQa("", { fs: fakeFs({}) });
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("mp4_path_missing"));
});

test("runVideoQa: file not on disk → fail", async () => {
  const r = await runVideoQa("/tmp/nope.mp4", { fs: fakeFs({}) });
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("mp4_not_on_disk"));
});

test("runVideoQa: ffprobe missing fails closed by default", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    exec: stubExec(() => {
      const e = new Error("spawn ffprobe ENOENT");
      e.code = "ENOENT";
      throw e;
    }),
  });
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("ffprobe_missing"));
});

test("runVideoQa: explicit developer-only tool-missing override remains a soft skip", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    allowToolMissingSkip: true,
    exec: stubExec(() => {
      const e = new Error("spawn ffprobe ENOENT");
      e.code = "ENOENT";
      throw e;
    }),
  });
  assert.strictEqual(r.result, "skip");
  assert.strictEqual(r.reason, "ffprobe_missing");
});

test("runVideoQa: healthy video (50s, no black) → pass", async () => {
  let callCount = 0;
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    disableDecodeScan: true,
    disableTemporalScan: true,
    exec: stubExec((cmd) => {
      callCount++;
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=50.00\n", stderr: "" };
      }
      // ffmpeg blackdetect: no black segments in output
      return { stdout: "", stderr: "" };
    }),
  });
  assert.strictEqual(r.result, "pass");
  assert.strictEqual(callCount, 3);
});

test("runVideoQa: short video (15s) + mid black → fail with both reasons", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    disableDecodeScan: true,
    disableTemporalScan: true,
    exec: stubExec((cmd) => {
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=15.00\n", stderr: "" };
      }
      return {
        stdout: "",
        stderr:
          "[blackdetect @ 0x0] black_start:5.0 black_end:9.0 black_duration:4.0\n",
      };
    }),
  });
  assert.strictEqual(r.result, "fail");
  assert.strictEqual(r.failures.length, 2);
});

test("runVideoQa parses full-render freeze and black evidence from ffmpeg output", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    disableDecodeScan: true,
    disableTemporalScan: true,
    minDuration: 35,
    maxDuration: 60,
    exec: stubExec((cmd) => {
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=40.91\n", stderr: "" };
      }
      return {
        stdout: `
          [blackdetect @ 0x0] black_start:21.9 black_end:23.6 black_duration:1.7
          [freezedetect @ 0x0] lavfi.freezedetect.freeze_start: 21.9
          [freezedetect @ 0x0] lavfi.freezedetect.freeze_duration: 0.766667
          [freezedetect @ 0x0] lavfi.freezedetect.freeze_end: 22.666667
          [freezedetect @ 0x0] lavfi.freezedetect.freeze_start: 32.666667
          [freezedetect @ 0x0] lavfi.freezedetect.freeze_duration: 0.8
          [freezedetect @ 0x0] lavfi.freezedetect.freeze_end: 33.466667
        `,
        stderr: "",
      };
    }),
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.some((f) => f.startsWith("black_segment_too_long")));
  assert.ok(r.failures.some((f) => f.startsWith("freeze_segment_too_long")));
});

test("runVideoQa: opening-only black (1s) → warn", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    disableDecodeScan: true,
    disableTemporalScan: true,
    exec: stubExec((cmd) => {
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=50.0\n", stderr: "" };
      }
      return {
        stdout: "",
        stderr:
          "[blackdetect @ 0x0] black_start:0 black_end:1.0 black_duration:1.0\n",
      };
    }),
  });
  assert.strictEqual(r.result, "warn");
  assert.ok(r.warnings.some((w) => w.startsWith("opening_black")));
});

test("runVideoQa: ffmpeg blackdetect exit code non-zero but output parseable → still works", async () => {
  // ffmpeg in some builds exits 1 even though it produced valid
  // blackdetect output. The helper must read err.stderr / err.stdout.
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    disableDecodeScan: true,
    disableTemporalScan: true,
    exec: stubExec((cmd) => {
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=50.0\n", stderr: "" };
      }
      const e = new Error("Command failed");
      e.code = 1;
      e.stdout = "";
      e.stderr =
        "[blackdetect @ 0x0] black_start:2.0 black_end:6.0 black_duration:4.0\n";
      throw e;
    }),
  });
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.some((f) => f.startsWith("black_segment_too_long")));
});

test("runVideoQa blocks repeated non-adjacent frame hashes from the repeat scan", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    disableDecodeScan: true,
    disableTemporalScan: true,
    minDuration: 35,
    maxDuration: 60,
    exec: stubExec((cmd) => {
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=44.00\n", stderr: "" };
      }
      if (cmd.includes("framemd5")) {
        return {
          stdout: `
            0,          0,          0,        1,     4096, 11111111111111111111111111111111
            0,          1,          1,        1,     4096, 22222222222222222222222222222222
            0,          2,          2,        1,     4096, 33333333333333333333333333333333
            0,          9,          9,        1,     4096, 11111111111111111111111111111111
          `,
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    }),
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.some((f) => f.startsWith("repeated_frame_hashes")));
});

test("runVideoQa decodes a complete temporal signature stream by default", async () => {
  let callCount = 0;
  const temporalCommands = [];
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    minDuration: 35,
    maxDuration: 60,
    exec: stubExec((cmd) => {
      callCount += 1;
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=50.00\n", stderr: "" };
      }
      if (cmd.includes("rawvideo")) {
        temporalCommands.push(cmd);
        return {
          stdout: healthyTemporalBuffer(300),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: "", stderr: "" };
    }),
  });

  assert.strictEqual(r.result, "pass", r.failures?.join(", "));
  assert.strictEqual(callCount, 6);
  assert.strictEqual(temporalCommands.length, 2);
  assert.ok(
    temporalCommands.some(
      (command) =>
        command.includes("force_original_aspect_ratio=decrease") &&
        !command.includes("crop="),
    ),
    temporalCommands.join("\n"),
  );
  assert.ok(
    temporalCommands.some((command) => command.includes("crop=")),
    temporalCommands.join("\n"),
  );
  assert.strictEqual(r.evidence.decode.complete, true);
  assert.strictEqual(r.evidence.decode.video_stream, true);
  assert.strictEqual(r.evidence.decode.audio_stream, true);
  assert.strictEqual(r.evidence.temporal.scan_complete, true);
  assert.strictEqual(r.evidence.temporal.sampled_frame_count, 300);
  assert.strictEqual(r.evidence.temporal.coverage_ratio, 1);
  assert.strictEqual(r.evidence.temporal.cadence.choppy, false);
  assert.strictEqual(r.evidence.temporal.analysis_scope, "full_frame");
  assert.strictEqual(
    r.evidence.temporal.supplemental_center_crop.analysis_scope,
    "center_crop",
  );
  assert.strictEqual(
    r.evidence.temporal.supplemental_center_crop.scan_complete,
    true,
  );
});

test("runVideoQa blocks a final MP4 when full audio-video decode fails", async () => {
  const r = await runVideoQa("/tmp/x.mp4", {
    fs: fakeFs({ "/tmp/x.mp4": true }),
    disableRepeatedFrameScan: true,
    disableTemporalScan: true,
    exec: stubExec((cmd) => {
      if (cmd.includes("ffprobe")) {
        return { stdout: "duration=50.00\n", stderr: "" };
      }
      if (cmd.includes("-map 0:v:0") && cmd.includes("-map 0:a:0")) {
        const error = new Error("audio stream decode failed");
        error.code = 1;
        error.stderr = "Error while decoding stream #0:1";
        throw error;
      }
      return { stdout: "", stderr: "" };
    }),
  });

  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.some((failure) => failure.startsWith("media_decode_failed")));
  assert.strictEqual(r.evidence.decode.complete, false);
});

// ---------- defaults ----------

test("Thresholds are conservative defaults", () => {
  assert.strictEqual(DEFAULT_MIN_DURATION_SECONDS, 40);
  assert.strictEqual(DEFAULT_MAX_DURATION_SECONDS, 75);
  assert.strictEqual(DEFAULT_MAX_BLACK_SEGMENT_SECONDS, 1.2);
  assert.strictEqual(DEFAULT_MAX_FREEZE_SEGMENT_SECONDS, 0.65);
  assert.strictEqual(DEFAULT_MAX_CUMULATIVE_FREEZE_SECONDS, 1.4);
});
