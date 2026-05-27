"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildLocalTtsProofMasteringReport,
  isAllowedProofAudioPath,
} = require("../../lib/studio/local-tts-proof-mastering");

const ACCEPTED_REF = {
  id: "pulse-sleepy-liam-20260502",
  referencePresent: true,
  referenceHash: "a".repeat(40),
};

function proofRow(audioPath, overrides = {}) {
  return {
    story_id: "rss_ready",
    proof_source: "local_script_extension",
    resolved_audio_path: audioPath,
    duration_verdict: "pass",
    failure_code: null,
    local_voice_reference: ACCEPTED_REF,
    ...overrides,
  };
}

function timestampPayload() {
  return {
    characters: ["P", "u", "l", "s", "e"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4],
    character_end_times_seconds: [0.08, 0.18, 0.28, 0.38, 0.48],
    meta: {
      provider: "local",
      acceptedLocalVoice: ACCEPTED_REF,
      transcript: "Pulse test. Follow Pulse Gaming so you never miss a beat.",
    },
  };
}

async function makeProofFiles(stem = "rss_ready_liam_extended") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-proof-master-"));
  const audioDir = path.join(root, "test", "output", "local-script-extension", "audio");
  await fs.ensureDir(audioDir);
  const audioPath = path.join(audioDir, `${stem}.mp3`);
  const timestampsPath = path.join(audioDir, `${stem}_timestamps.json`);
  await fs.writeFile(audioPath, "original mp3");
  await fs.writeJson(timestampsPath, timestampPayload(), { spaces: 2 });
  return { root, audioPath, timestampsPath };
}

test("local TTS proof mastering recognises only proof-output audio paths", async () => {
  const { root, audioPath } = await makeProofFiles();
  try {
    assert.equal(isAllowedProofAudioPath(audioPath), true);
    assert.equal(isAllowedProofAudioPath(path.join(root, "output", "audio", "prod.mp3")), false);
  } finally {
    await fs.remove(root);
  }
});

test("local TTS proof mastering dry-run plans missing mastering evidence without writing", async () => {
  const { root, audioPath, timestampsPath } = await makeProofFiles();
  try {
    const before = await fs.readJson(timestampsPath);
    const report = await buildLocalTtsProofMasteringReport({
      proofReports: [
        {
          source: "local_script_extension",
          report: { applied: [proofRow(audioPath)], skipped: [] },
        },
      ],
      applyLocal: false,
    });

    assert.equal(report.mode, "dry-run");
    assert.equal(report.rows[0].action, "would_master");
    assert.deepEqual(await fs.readJson(timestampsPath), before);
  } finally {
    await fs.remove(root);
  }
});

test("local TTS proof mastering apply-local repairs proof MP3 and stamps loudness sidecar", async () => {
  const { root, audioPath, timestampsPath } = await makeProofFiles();
  const calls = [];
  const execFileAsync = async (_cmd, args) => {
    calls.push(args);
    if (args.includes("-b:a")) {
      await fs.writeFile(args[args.length - 1], "mastered mp3");
      return { stdout: "", stderr: "" };
    }
    return {
      stdout: "",
      stderr: `{
        "input_i" : "-15.70",
        "input_tp" : "-2.35",
        "input_lra" : "3.10"
      }`,
    };
  };

  try {
    const report = await buildLocalTtsProofMasteringReport({
      proofReports: [
        {
          source: "local_script_extension",
          report: { applied: [proofRow(audioPath)], skipped: [] },
        },
      ],
      applyLocal: true,
      deps: {
        execFileAsync,
        now: new Date("2026-05-16T08:00:00Z"),
      },
    });

    assert.equal(report.rows[0].action, "applied_local_mastering");
    assert.equal(report.rows[0].applied, true);
    assert.equal(await fs.readFile(audioPath, "utf8"), "mastered mp3");
    assert.equal(await fs.pathExists(report.rows[0].repair.backupPath), true);
    const stamped = await fs.readJson(timestampsPath);
    assert.equal(stamped.meta.voiceMastering.code, "voice_mastered");
    assert.equal(stamped.meta.voiceMastering.source, "local_tts_proof_mastering");
    assert.equal(stamped.meta.acoustic.integratedLufs, -15.7);
    assert.equal(calls.length, 3);
  } finally {
    await fs.remove(root);
  }
});

test("local TTS proof mastering blocks non-proof audio even if the row is voice-ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-proof-master-outside-"));
  try {
    const audioPath = path.join(root, "output", "audio", "story.mp3");
    await fs.ensureDir(path.dirname(audioPath));
    await fs.writeFile(audioPath, "mp3");
    const report = await buildLocalTtsProofMasteringReport({
      proofReports: [
        {
          source: "local_script_extension",
          report: { applied: [proofRow(audioPath)], skipped: [] },
        },
      ],
    });
    assert.deepEqual(report.rows[0].blockers, ["proof_audio_outside_allowed_local_output"]);
  } finally {
    await fs.remove(root);
  }
});

test("local TTS proof mastering command is registered", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
  assert.equal(pkg.scripts["tts:proof-mastering"], "node tools/local-tts-proof-mastering.js");
});
