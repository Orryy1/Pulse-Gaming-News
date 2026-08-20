"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  CONTRACT,
  DEFAULT_PATHS,
  main,
} = require("../../tools/system-trace-display-pipeline-youtube-final-audit");

test("display-pipeline final audit is a fixed read-only seven-episode contract", async () => {
  const calls = [];
  const run = async (argv, options) => {
    calls.push({ argv, options });
    return { report: { verdict: "GREEN" } };
  };
  assert.deepEqual(await main(["--help"], { run, log: () => {} }), { help: true });
  await assert.rejects(
    () => main(["--output", "caller.json"], { run, log: () => {} }),
    /unknown_argument/,
  );
  const result = await main([], {
    run,
    log: () => {},
    paths: { evidenceRoot: "C:\\caller-controlled" },
    contract: { channelId: "caller-controlled" },
    expectedManifestSha256: "0".repeat(64),
  });
  assert.equal(result.report.verdict, "GREEN");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, []);
  assert.equal(calls[0].options.paths, DEFAULT_PATHS);
  assert.equal(calls[0].options.contract, CONTRACT);
  assert.equal(calls[0].options.expectedManifestSha256, CONTRACT.manifestSha256);
  assert.deepEqual(calls[0].options.paths, {
    repoRoot: path.resolve(__dirname, "..", ".."),
    evidenceRoot: "D:\\pulse-evidence\\system-trace-display-pipeline-buffer-20260820",
    tokenPath: "C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\tokens\\youtube_token.json",
    manifestFile: "system-trace-display-pipeline-youtube-buffer.json",
    jsonFile: "final-youtube-buffer-audit.json",
    markdownFile: "final-youtube-buffer-audit.md",
  });
  assert.deepEqual(calls[0].options.contract, {
    manifestSha256: "eec3a11928909fae7d1696b0f0cf4d90eac8ade6e2bec161811dfc9859725818",
    channelId: "UCvgNDjtTezrpxL8oUe6mYwA",
    episodes: [
      ["system-trace-screen-tearing", "2026-08-22T17:00:00.000Z"],
      ["system-trace-vsync-latency", "2026-08-23T17:00:00.000Z"],
      ["system-trace-variable-refresh-rate", "2026-08-24T17:00:00.000Z"],
      ["system-trace-hdr-tone-mapping", "2026-08-25T17:00:00.000Z"],
      ["system-trace-anti-aliasing", "2026-08-26T17:00:00.000Z"],
      ["system-trace-motion-blur", "2026-08-27T17:00:00.000Z"],
      ["system-trace-frame-generation", "2026-08-28T17:00:00.000Z"],
    ],
  });
});
