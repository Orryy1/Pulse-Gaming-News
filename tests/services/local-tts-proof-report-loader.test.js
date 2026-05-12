"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  loadLocalTtsProofReports,
  proofHistoryFileName,
} = require("../../lib/studio/local-tts-proof-report-loader");

test("proof history file names are filesystem safe and include the story id", () => {
  const name = proofHistoryFileName({
    source: "local_script_extension",
    generatedAt: "2026-05-12T20:12:09.245Z",
    storyId: "rss/example:bad",
  });

  assert.match(name, /^20260512T201209245Z_local_script_extension_rss_example_bad\.json$/);
});

test("local TTS proof report loader merges latest files and history without duplicating the same proof", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-proof-loader-"));
  try {
    const latestPath = path.join(tmp, "local_script_extension_audio_apply.json");
    const historyDir = path.join(tmp, "local-script-extension", "audio-apply-history");
    await fs.ensureDir(historyDir);
    const proofA = {
      schema_version: 1,
      generated_at: "2026-05-12T20:00:00.000Z",
      applied: [
        {
          story_id: "story_a",
          output_audio_path: "test/output/local-script-extension/audio/story_a.mp3",
        },
      ],
      skipped: [],
    };
    const proofB = {
      schema_version: 1,
      generated_at: "2026-05-12T20:10:00.000Z",
      applied: [
        {
          story_id: "story_b",
          output_audio_path: "test/output/local-script-extension/audio/story_b.mp3",
        },
      ],
      skipped: [],
    };
    await fs.writeJson(latestPath, proofB);
    await fs.writeJson(path.join(historyDir, "story_a.json"), proofA);
    await fs.writeJson(path.join(historyDir, "story_b-duplicate.json"), proofB);

    const reports = await loadLocalTtsProofReports({
      outDir: tmp,
    });

    assert.deepEqual(
      reports
        .filter((entry) => entry.source === "local_script_extension")
        .flatMap((entry) => entry.report.applied.map((row) => row.story_id))
        .sort(),
      ["story_a", "story_b"],
    );
  } finally {
    await fs.remove(tmp);
  }
});
