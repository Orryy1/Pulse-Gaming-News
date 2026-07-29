"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  summariseLocalTtsHealth,
} = require("../../lib/studio/local-tts-readiness");

const ROOT = path.resolve(__dirname, "..", "..");
const MODULE_DIR = path.join(ROOT, "tts_server");

function findPython() {
  for (const candidate of [
    process.env.PYTHON,
    "python",
    "python3",
  ].filter(Boolean)) {
    const probe = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (probe.status === 0) return candidate;
  }
  return null;
}

function writePcmWav(filePath, {
  durationSeconds = 1,
  sampleRate = 16_000,
  channels = 1,
} = {}) {
  const frames = Math.round(durationSeconds * sampleRate);
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  fs.writeFileSync(filePath, wav);
  return wav;
}

function validateWithPython(python, request) {
  const script = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(MODULE_DIR)})`,
    "from voice_reference import validate_voice_reference",
    "request = json.loads(sys.stdin.read())",
    "result = validate_voice_reference(**request)",
    "print(json.dumps(result))",
  ].join("\n");
  const proc = spawnSync(python, ["-c", script], {
    input: JSON.stringify(request),
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(
    proc.status,
    0,
    `voice reference validator failed: ${proc.stderr || proc.stdout}`,
  );
  return JSON.parse(proc.stdout);
}

test("external local voice reference is production-ready only after path, hash, probe and rights validation", (t) => {
  const python = findPython();
  if (!python) {
    t.skip("Python is unavailable");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-voice-ref-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const wav = writePcmWav(path.join(root, "pulse.wav"), {
    durationSeconds: 1,
    sampleRate: 16_000,
    channels: 1,
  });
  const sha256 = crypto.createHash("sha256").update(wav).digest("hex");

  const result = validateWithPython(python, {
    data_root: root,
    relative_path: "pulse.wav",
    expected_sha256: sha256,
    expected_probe: {
      duration_seconds: 1,
      duration_tolerance_seconds: 0.01,
      sample_rate_hz: 16_000,
      channels: 1,
    },
    rights_status: "CLEARED",
    rights_evidence_reference: "rights-ledger:pulse-voice-1",
  });

  assert.equal(result.technical_ready, true);
  assert.equal(result.production_ready, true);
  assert.equal(result.hash_matches, true);
  assert.equal(result.probe_matches, true);
  assert.equal(result.rights_status, "CLEARED");
  assert.equal(result.probe.duration_seconds, 1);
  assert.equal(result.probe.sample_rate_hz, 16_000);
  assert.equal(result.probe.channels, 1);
  assert.deepEqual(result.reasons, []);
  assert.equal(
    JSON.stringify(result).includes(path.resolve(root)),
    false,
    "public validation result must not leak the private data-root path",
  );
});

test("a technically valid clone stays blocked when cleared rights have no evidence reference", (t) => {
  const python = findPython();
  if (!python) {
    t.skip("Python is unavailable");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-voice-rights-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const wav = writePcmWav(path.join(root, "pulse.wav"));
  const sha256 = crypto.createHash("sha256").update(wav).digest("hex");
  const result = validateWithPython(python, {
    data_root: root,
    relative_path: "pulse.wav",
    expected_sha256: sha256,
    expected_probe: {
      duration_seconds: 1,
      sample_rate_hz: 16_000,
      channels: 1,
    },
    rights_status: "CLEARED",
  });

  assert.equal(result.technical_ready, true);
  assert.equal(result.production_ready, false);
  assert.equal(result.rights_evidence_present, false);
  assert.match(result.reasons.join(" "), /rights_evidence_missing/);
});

test("voice reference traversal is rejected without leaking the private root", (t) => {
  const python = findPython();
  if (!python) {
    t.skip("Python is unavailable");
    return;
  }

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-voice-root-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "private");
  fs.mkdirSync(root);
  const wav = writePcmWav(path.join(parent, "outside.wav"));
  const result = validateWithPython(python, {
    data_root: root,
    relative_path: "../outside.wav",
    expected_sha256: crypto.createHash("sha256").update(wav).digest("hex"),
    expected_probe: {
      duration_seconds: 1,
      sample_rate_hz: 16_000,
      channels: 1,
    },
    rights_status: "OWNED",
    rights_evidence_reference: "rights-ledger:pulse-owner-consent",
  });

  assert.equal(result.production_ready, false);
  assert.equal(result.path_valid, false);
  assert.deepEqual(result.reasons, ["path_invalid"]);
  assert.equal(JSON.stringify(result).includes(path.resolve(parent)), false);
});

test("local TTS readiness fails closed when the service cannot prove the loaded reference fingerprint and rights", () => {
  const summary = summariseLocalTtsHealth(
    {
      status: "ok",
      ready: true,
      phase: "ready",
      engine_count: 1,
      voices: [
        {
          voice_id: "pulse-voice",
          alias: "pulse",
          loaded: true,
          ref_resolved: true,
        },
      ],
    },
    "pulse-voice",
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.voice.referenceProductionReady, false);
  assert.match(summary.reasons.join(" "), /reference validation is missing/i);
});

test("local TTS readiness accepts a loaded voice only when the service proves a production-ready reference", () => {
  const summary = summariseLocalTtsHealth(
    {
      status: "ok",
      ready: true,
      phase: "ready",
      engine_count: 1,
      voices: [
        {
          voice_id: "pulse-voice",
          alias: "pulse",
          loaded: true,
          ref_resolved: true,
          reference_validation: {
            technical_ready: true,
            production_ready: true,
            hash_matches: true,
            rights_status: "CLEARED",
            actual_sha256: "a".repeat(64),
            probe: {
              duration_seconds: 25,
              sample_rate_hz: 16_000,
              channels: 1,
            },
          },
        },
      ],
    },
    "pulse-voice",
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.voice.referenceTechnicalReady, true);
  assert.equal(summary.voice.referenceProductionReady, true);
  assert.equal(summary.voice.referenceHashVerified, true);
  assert.equal(summary.voice.referenceRightsStatus, "CLEARED");
  assert.deepEqual(summary.reasons, []);
  assert.equal(JSON.stringify(summary).includes("actual_sha256"), false);
});

test("Pulse voice registry names an immutable external reference contract without committing the WAV", () => {
  const voices = JSON.parse(
    fs.readFileSync(path.join(ROOT, "tts_server", "voices.json"), "utf8"),
  );
  const pulse = voices.TX3LPaxmHKxFdv7VOQHJ;

  assert.equal(pulse.ref_voice_file, "pulse_liam_sleepy.wav");
  assert.match(pulse.ref_voice_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(pulse.ref_voice_probe, {
    duration_seconds: 48.761917,
    duration_tolerance_seconds: 0.05,
    sample_rate_hz: 24_000,
    channels: 1,
  });
  assert.equal(pulse.reference_rights_status, "CLEARED");
  assert.equal(
    pulse.reference_rights_evidence_reference,
    "docs/voice-reference-rights-attestation.md#pulse-liam",
  );
  assert.equal(pulse.accepted_reference_id, "pulse-sleepy-liam-20260502");
  assert.equal(path.isAbsolute(pulse.ref_voice_file), false);
  assert.equal(
    fs.existsSync(
      path.join(ROOT, "tts_server", "voices", "pulse_liam_sleepy.wav"),
    ),
    false,
    "the private cloned reference must never be copied into Git",
  );
});

test("VoxCPM service publishes and enforces the external reference validation contract", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "tts_server", "server.py"),
    "utf8",
  );

  assert.match(
    source,
    /from voice_reference import validate_voice_reference/,
  );
  assert.match(source, /VOICE_REFERENCE_DATA_ROOT/);
  assert.match(source, /ALLOW_UNCLEARED_VOICE_REFERENCE_FOR_LOCAL_QA/);
  assert.match(source, /"reference_validation": validation/);
  assert.match(source, /reference is not production-ready/);
});
