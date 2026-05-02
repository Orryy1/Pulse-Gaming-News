"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const { buildQualityReportV2 } = require("../../lib/studio/v2/quality-gate-v2");

test("buildQualityReportV2 rejects v2.1 candidates with damaged protected names in subtitles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-brand-ass-"));
  const assPath = path.join(dir, "captions.ass");
  await fs.writeFile(
    assPath,
    [
      "[Events]",
      "Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,Pokmon returns today",
    ].join("\n"),
    "utf8",
  );

  try {
    const report = buildQualityReportV2({
      storyId: "brand_gate_story",
      outputPath: "test/output/brand_gate_story.mp4",
      pkg: {
        title: "Pok\u00e9mon returns today",
        hook: { chosen: { text: "Pok\u00e9mon returns with a surprise reveal" } },
        script: {
          raw: "Pok\u00e9mon returns today after a surprise reveal.",
          tightened: "Pok\u00e9mon returns today after a surprise reveal.",
        },
      },
      scenes: [],
      transitions: [],
      audioMeta: { provider: "local", source: "fixture" },
      audioDurationS: 2,
      assPath,
      soundLayerPayload: { cueCount: 0, filterLines: [] },
      realignedWords: [],
      renderedDurationS: 2,
      branch: "test",
    });

    assert.equal(report.auto.brandNameIntegrity.grade, "red");
    assert.equal(report.verdict.lane, "reject");
    assert.ok(
      report.verdict.reasons.some((r) => r.includes("brand-name integrity")),
      `got reasons: ${report.verdict.reasons.join(", ")}`,
    );
  } finally {
    await fs.remove(dir);
  }
});
