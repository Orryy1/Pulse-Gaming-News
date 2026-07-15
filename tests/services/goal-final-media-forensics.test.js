"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  validateFinalMediaForensics,
} = require("../../lib/goal-final-media-forensics");

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-forensics-"));
  const finalMp4Path = path.join(root, "final.mp4");
  const bytes = Buffer.from("decoded final media fixture");
  await fs.writeFile(finalMp4Path, bytes);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  return {
    finalMp4Path,
    report: {
      schema_version: 1,
      verdict: "pass",
      final_media: {
        sha256,
        size_bytes: bytes.length,
      },
      checks: {
        audio: { checked: true, verdict: "pass" },
        video: { checked: true, verdict: "pass" },
        captions: { checked: true, verdict: "pass" },
        av_sync: { checked: true, verdict: "pass" },
        freeze: { checked: true, verdict: "pass" },
        black: { checked: true, verdict: "pass" },
        blur: { checked: true, verdict: "pass" },
        repetition: { checked: true, verdict: "pass" },
      },
      sampled_frames: [
        { time_seconds: 0, hash: sha256Hex("frame-0") },
        { time_seconds: 15, hash: sha256Hex("frame-15") },
        { time_seconds: 30, hash: sha256Hex("frame-30") },
        { time_seconds: 45, hash: sha256Hex("frame-45") },
        { time_seconds: 60, hash: sha256Hex("frame-60") },
      ],
      critical_defects: [],
    },
  };
}

test("accepts current final media with complete decoded forensic evidence", async () => {
  const { finalMp4Path, report } = await fixture();
  const calls = [];

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async (filePath) => {
      calls.push(["probe", filePath]);
      return {
        duration_seconds: 60,
        streams: [{ codec_type: "video" }, { codec_type: "audio" }],
      };
    },
    decodeMedia: async (filePath) => {
      calls.push(["decode", filePath]);
      return {
        fully_decoded: true,
        decoded_duration_seconds: 60,
        audio_checked: true,
        video_checked: true,
        errors: [],
      };
    },
  });

  assert.equal(result.verdict, "pass");
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.final_media.sha256, report.final_media.sha256);
  assert.equal(result.final_media.size_bytes, report.final_media.size_bytes);
  assert.equal(result.timeline_coverage.covered, true);
  assert.deepEqual(calls, [
    ["probe", finalMp4Path],
    ["decode", finalMp4Path],
  ]);
});

test("fails closed when the final MP4 does not exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-forensics-missing-"));
  let externalCalls = 0;

  const result = await validateFinalMediaForensics({
    finalMp4Path: path.join(root, "missing.mp4"),
    forensicReport: { verdict: "pass" },
    probeMedia: async () => {
      externalCalls += 1;
      return {};
    },
    decodeMedia: async () => {
      externalCalls += 1;
      return {};
    },
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes("final_mp4_missing"));
  assert.equal(result.final_media.exists, false);
  assert.equal(externalCalls, 0);
});

test("fails closed when no final MP4 path is supplied", async () => {
  let externalCalls = 0;

  const result = await validateFinalMediaForensics({
    forensicReport: { verdict: "pass" },
    probeMedia: async () => {
      externalCalls += 1;
      return {};
    },
    decodeMedia: async () => {
      externalCalls += 1;
      return {};
    },
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("final_mp4_path_missing"));
  assert.equal(result.final_media.path, null);
  assert.equal(externalCalls, 0);
});

test("rejects a decoder result that does not prove a full decode", async () => {
  const { finalMp4Path, report } = await fixture();

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: false,
      decoded_duration_seconds: 12,
      audio_checked: true,
      video_checked: true,
      errors: ["invalid data at byte 200"],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes("final_mp4_full_decode_failed"));
});

test("rejects a nominal full decode that stops before the probed duration", async () => {
  const { finalMp4Path, report } = await fixture();

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 58.5,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("final_mp4_decode_duration_incomplete"));
});

test("rejects a forensic report bound to stale MP4 hash and size", async () => {
  const { finalMp4Path, report } = await fixture();
  report.final_media.sha256 = "0".repeat(64);
  report.final_media.size_bytes += 1;

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("forensic_report_mp4_hash_mismatch"));
  assert.ok(result.blockers.includes("forensic_report_mp4_size_mismatch"));
});

test("requires runtime and report evidence that audio and video were checked", async () => {
  const { finalMp4Path, report } = await fixture();
  report.checks.video.checked = false;

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: false,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("decoded_audio_not_checked"));
  assert.ok(result.blockers.includes("forensic_video_not_checked"));
});

test("requires every production forensic check to be an explicit pass", async () => {
  const requiredChecks = [
    "audio",
    "video",
    "captions",
    "av_sync",
    "freeze",
    "black",
    "blur",
    "repetition",
  ];

  for (const checkName of requiredChecks) {
    const { finalMp4Path, report } = await fixture();
    report.checks[checkName].verdict = "warn";

    const result = await validateFinalMediaForensics({
      finalMp4Path,
      forensicReport: report,
      probeMedia: async () => ({
        duration_seconds: 60,
        streams: [{ codec_type: "video" }, { codec_type: "audio" }],
      }),
      decodeMedia: async () => ({
        fully_decoded: true,
        decoded_duration_seconds: 60,
        audio_checked: true,
        video_checked: true,
        errors: [],
      }),
    });

    assert.equal(result.verdict, "fail", checkName);
    assert.ok(
      result.blockers.includes(`forensic_${checkName}_not_pass`),
      `${checkName} should have a dedicated blocker`,
    );
  }
});

test("requires every production forensic check to be explicitly checked", async () => {
  const requiredChecks = [
    "audio",
    "video",
    "captions",
    "av_sync",
    "freeze",
    "black",
    "blur",
    "repetition",
  ];

  for (const checkName of requiredChecks) {
    const { finalMp4Path, report } = await fixture();
    report.checks[checkName].checked = false;

    const result = await validateFinalMediaForensics({
      finalMp4Path,
      forensicReport: report,
      probeMedia: async () => ({
        duration_seconds: 60,
        streams: [{ codec_type: "video" }, { codec_type: "audio" }],
      }),
      decodeMedia: async () => ({
        fully_decoded: true,
        decoded_duration_seconds: 60,
        audio_checked: true,
        video_checked: true,
        errors: [],
      }),
    });

    assert.equal(result.verdict, "fail", checkName);
    assert.ok(
      result.blockers.includes(`forensic_${checkName}_not_checked`),
      `${checkName} should require explicit checked evidence`,
    );
  }
});

test("rejects sampled frames with null forensic hashes", async () => {
  const { finalMp4Path, report } = await fixture();
  report.sampled_frames[2].hash = null;

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("sampled_frame_hash_missing"));
});

test("rejects sampled frame hashes that are not strict SHA-256", async () => {
  const { finalMp4Path, report } = await fixture();
  report.sampled_frames[2].hash = "x";

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("sampled_frame_hash_invalid"));
});

test("rejects sampled frame hashes that independent extraction does not reproduce", async () => {
  const { finalMp4Path, report } = await fixture();

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
    verifySampledFrameHashes: async ({ sampledFrames }) => ({
      checked: true,
      sampled_frames: sampledFrames.map((frame, index) => ({
        time_seconds: frame.time_seconds,
        sha256: index === 2 ? "0".repeat(64) : frame.hash,
      })),
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("sampled_frame_hash_verification_failed"));
  assert.equal(result.frame_hash_verification.performed, true);
  assert.equal(result.frame_hash_verification.verified, false);
  assert.deepEqual(result.frame_hash_verification.mismatch_indices, [2]);
});

test("accepts independently reproduced sampled frame hashes", async () => {
  const { finalMp4Path, report } = await fixture();

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
    verifySampledFrameHashes: async ({ finalMp4Path: inspectedPath, sampledFrames }) => {
      assert.equal(inspectedPath, finalMp4Path);
      return {
        checked: true,
        sampled_frames: sampledFrames.map((frame) => ({
          time_seconds: frame.time_seconds,
          sha256: frame.hash,
        })),
      };
    },
  });

  assert.equal(result.verdict, "pass");
  assert.equal(result.valid, true);
  assert.equal(result.frame_hash_verification.performed, true);
  assert.equal(result.frame_hash_verification.verified, true);
  assert.deepEqual(result.frame_hash_verification.mismatch_indices, []);
});

test("does not let a frame verifier rewrite the expected forensic hashes", async () => {
  const { finalMp4Path, report } = await fixture();
  const originalHashes = report.sampled_frames.map((frame) => frame.hash);

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
    verifySampledFrameHashes: async ({ sampledFrames }) => {
      for (const frame of sampledFrames) frame.hash = "0".repeat(64);
      return {
        checked: true,
        sampled_frames: sampledFrames.map((frame) => ({
          time_seconds: frame.time_seconds,
          sha256: frame.hash,
        })),
      };
    },
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("sampled_frame_hash_verification_failed"));
  assert.deepEqual(report.sampled_frames.map((frame) => frame.hash), originalHashes);
});

test("rejects frame hashes clustered away from most of the timeline", async () => {
  const { finalMp4Path, report } = await fixture();
  report.sampled_frames = [
    { time_seconds: 0, hash: sha256Hex("frame-0") },
    { time_seconds: 1, hash: sha256Hex("frame-1") },
    { time_seconds: 2, hash: sha256Hex("frame-2") },
    { time_seconds: 60, hash: sha256Hex("frame-60") },
  ];

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.timeline_coverage.covered, false);
  assert.ok(result.blockers.includes("sampled_frames_timeline_not_covered"));
});

test("rejects any reported critical final-media defect", async () => {
  const { finalMp4Path, report } = await fixture();
  report.critical_defects = [{ code: "caption_audio_drift", at_seconds: 42 }];

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("critical_defects_present"));
  assert.deepEqual(result.critical_defects, report.critical_defects);
});

test("rejects a bare top-level pass as non-evidence", async () => {
  const { finalMp4Path } = await fixture();

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: { verdict: "pass" },
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("forensic_report_bare_pass"));
});

test("rejects production evidence left as not_checked anywhere in the report", async () => {
  const { finalMp4Path, report } = await fixture();
  report.production_evidence = {
    loudness: { verdict: "not_checked" },
  };

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("production_not_checked_fields_present"));
  assert.deepEqual(result.not_checked_fields, ["production_evidence.loudness.verdict"]);
});

test("requires the injected probe to find both audio and video streams", async () => {
  const { finalMp4Path, report } = await fixture();

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({ duration_seconds: 60, streams: [] }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("probe_audio_stream_missing"));
  assert.ok(result.blockers.includes("probe_video_stream_missing"));
});

test("rejects decoder errors even when the decoder claims completion", async () => {
  const { finalMp4Path, report } = await fixture();

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: ["concealing corrupt frame"],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("final_mp4_decode_errors_present"));
});

test("turns an injected probe failure into a fail-closed result", async () => {
  const { finalMp4Path, report } = await fixture();
  let decodeCalled = false;

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => {
      throw new Error("ffprobe timed out");
    },
    decodeMedia: async () => {
      decodeCalled = true;
      return {};
    },
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("final_mp4_probe_failed"));
  assert.equal(result.decode_evidence.probe, null);
  assert.equal(decodeCalled, false);
});

test("turns an injected decoder failure into a fail-closed result", async () => {
  const { finalMp4Path, report } = await fixture();

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => {
      throw new Error("ffmpeg exited 1");
    },
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("final_mp4_decode_failed"));
  assert.equal(result.decode_evidence.decode, null);
});

test("rejects final media changed during probe or decode", async () => {
  for (const mutationStage of ["probe", "decode"]) {
    const { finalMp4Path, report } = await fixture();

    const result = await validateFinalMediaForensics({
      finalMp4Path,
      forensicReport: report,
      probeMedia: async () => {
        if (mutationStage === "probe") {
          await fs.appendFile(finalMp4Path, Buffer.from("probe mutation"));
        }
        return {
          duration_seconds: 60,
          streams: [{ codec_type: "video" }, { codec_type: "audio" }],
        };
      },
      decodeMedia: async () => {
        if (mutationStage === "decode") {
          await fs.appendFile(finalMp4Path, Buffer.from("decode mutation"));
        }
        return {
          fully_decoded: true,
          decoded_duration_seconds: 60,
          audio_checked: true,
          video_checked: true,
          errors: [],
        };
      },
    });

    assert.equal(result.verdict, "fail", mutationStage);
    assert.ok(
      result.blockers.includes("final_mp4_changed_during_validation"),
      `${mutationStage} mutation should be detected`,
    );
    assert.equal(result.fingerprint_stability.stable, false);
    assert.notEqual(
      result.fingerprint_stability.before.sha256,
      result.fingerprint_stability.after.sha256,
    );
    assert.equal(result.report_binding.bound_to_current_mp4, false);
  }
});

test("requires the complete forensic report verdict itself to pass", async () => {
  const { finalMp4Path, report } = await fixture();
  report.verdict = "warn";

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("forensic_report_verdict_not_pass"));
});

test("rejects a contradictory authoritative report status", async () => {
  const { finalMp4Path, report } = await fixture();
  report.status = "RED";

  const result = await validateFinalMediaForensics({
    finalMp4Path,
    forensicReport: report,
    probeMedia: async () => ({
      duration_seconds: 60,
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }),
    decodeMedia: async () => ({
      fully_decoded: true,
      decoded_duration_seconds: 60,
      audio_checked: true,
      video_checked: true,
      errors: [],
    }),
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.blockers.includes("forensic_report_status_not_pass"));
});

test("rejects declared authoritative blockers, failures and errors", async () => {
  for (const field of ["blockers", "failures", "errors"]) {
    const { finalMp4Path, report } = await fixture();
    report[field] = [{ code: `${field}_declared` }];

    const result = await validateFinalMediaForensics({
      finalMp4Path,
      forensicReport: report,
      probeMedia: async () => ({
        duration_seconds: 60,
        streams: [{ codec_type: "video" }, { codec_type: "audio" }],
      }),
      decodeMedia: async () => ({
        fully_decoded: true,
        decoded_duration_seconds: 60,
        audio_checked: true,
        video_checked: true,
        errors: [],
      }),
    });

    assert.equal(result.verdict, "fail", field);
    assert.ok(
      result.blockers.includes(`forensic_report_${field}_present`),
      `${field} should have a dedicated blocker`,
    );
  }
});
