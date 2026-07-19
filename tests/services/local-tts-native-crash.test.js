"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  inspectLocalTtsNativeCrash,
} = require("../../lib/studio/local-tts-native-crash");

test("local TTS native crash inspection recognises a current VoxCPM Windows access violation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tts-native-crash-"));
  try {
    const diagDir = path.join(root, "tts_server", "diag");
    const evidencePath = path.join(diagDir, "faulthandler.current.log");
    await fs.ensureDir(diagDir);
    await fs.writeFile(
      evidencePath,
      [
        "Windows fatal exception: access violation",
        "File \"voxcpm/modules/minicpm4/model.py\", line 157 in forward",
        "File \"voxcpm_engine.py\", line 287 in _generate_candidate",
      ].join("\n"),
      "utf8",
    );
    await fs.writeJson(path.join(diagDir, "boot_state.json"), {
      faulthandler_log: evidencePath,
    });

    const result = await inspectLocalTtsNativeCrash({
      cwd: root,
      startedAtMs: Date.now() - 5000,
    });

    assert.equal(result.detected, true);
    assert.equal(result.failure_code, "native_inference_access_violation");
    assert.equal(result.stage, "voxcpm_cuda_inference");
    assert.equal(result.evidence_path, evidencePath);
    assert.equal(
      result.upstream_issue_url,
      "https://github.com/OpenBMB/VoxCPM/issues/300",
    );
  } finally {
    await fs.remove(root);
  }
});
