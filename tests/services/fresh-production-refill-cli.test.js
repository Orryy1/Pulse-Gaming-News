"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");

test("fresh production refill CLI is registered and parses safe local-only options", () => {
  const { parseArgs } = require("../../tools/fresh-production-refill");

  assert.equal(
    packageJson.scripts["ops:fresh-production-refill"],
    "node tools/fresh-production-refill.js",
  );

  const args = parseArgs([
    "--json",
    "--limit",
    "14",
    "--rss-per-feed",
    "5",
    "--out-dir",
    "output/refill-proof",
    "--contract-out-dir",
    "output/refill-contract",
    "--stories-file",
    "output/manual-seeds/gta-vi.json",
    "--no-repair-evidence",
  ], { now: new Date("2026-06-24T13:40:00.000Z") });

  assert.equal(args.json, true);
  assert.equal(args.limit, 14);
  assert.equal(args.rssPerFeed, 5);
  assert.match(args.outDir, /output[\\/]refill-proof$/);
  assert.match(args.contractOutDir, /output[\\/]refill-contract$/);
  assert.match(args.storiesFile, /output[\\/]manual-seeds[\\/]gta-vi\.json$/);
  assert.equal(args.repairEvidence, false);
});

test("fresh production refill CLI delegates to the scheduler refill handler without publish side effects", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const toolPath = require.resolve("../../tools/fresh-production-refill");
  const originalJobHandlers = require.cache[jobHandlersPath];
  const originalTool = require.cache[toolPath];
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-cli-"));
  const outDir = path.join(tmp, "proof");
  const contractOutDir = path.join(tmp, "contract");
  const calls = [];
  const stdout = [];
  const stderr = [];

  try {
    require.cache[jobHandlersPath] = {
      id: jobHandlersPath,
      filename: jobHandlersPath,
      loaded: true,
      exports: {
        handlers: {
          async fresh_production_refill(job, ctx) {
            calls.push({ job, ctx });
            ctx.log("delegated");
            return {
              status: "completed",
              story_count: 12,
              green_count: 4,
              red_count: 8,
              outputs: {
                storyPackagesPath: path.join(contractOutDir, "story-packages.json"),
              },
              safety: {
                local_only: true,
                no_publish: true,
                no_db_mutation: true,
                no_oauth_or_token_mutation: true,
                disabled_platforms_unchanged: true,
              },
            };
          },
        },
      },
    };
    delete require.cache[toolPath];
    const { main } = require("../../tools/fresh-production-refill");
    const result = await main([
      "--json",
      "--limit",
      "12",
      "--rss-per-feed",
      "4",
      "--out-dir",
      outDir,
      "--contract-out-dir",
      contractOutDir,
      "--stories-file",
      path.join(tmp, "seed-stories.json"),
    ], {
      stdout: { write: (value) => stdout.push(String(value)) },
      stderr: { write: (value) => stderr.push(String(value)) },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].job.kind, "fresh_production_refill");
    assert.equal(calls[0].job.payload.limit, 12);
    assert.equal(calls[0].job.payload.rss_per_feed, 4);
    assert.equal(calls[0].job.payload.out_dir, outDir);
    assert.equal(calls[0].job.payload.contract_out_dir, contractOutDir);
    assert.equal(calls[0].job.payload.seed_stories_file, path.join(tmp, "seed-stories.json"));
    assert.equal(calls[0].job.payload.repair_evidence, true);
    assert.equal(calls[0].job.payload.reason, "operator_safe_fresh_production_refill");
    assert.equal(result.status, "completed");
    assert.equal(result.safety.no_publish, true);
    assert.match(stdout.join(""), /"green_count": 4/);
    assert.match(stderr.join(""), /delegated/);
  } finally {
    if (originalJobHandlers) require.cache[jobHandlersPath] = originalJobHandlers;
    else delete require.cache[jobHandlersPath];
    if (originalTool) require.cache[toolPath] = originalTool;
    else delete require.cache[toolPath];
    await fs.remove(tmp);
  }
});
