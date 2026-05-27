#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join(ROOT, "test", "output", "retention-intelligence");

const {
  buildRetentionIntelligence,
  renderRetentionIntelligenceMarkdown,
} = require("../lib/intelligence/retention-intelligence");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    retention: null,
    traffic: null,
    timeline: null,
    story: null,
    channelBaseline: null,
    outDir: DEFAULT_OUT_DIR,
    durationS: 60,
    fixture: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--retention" && argv[i + 1]) args.retention = argv[++i];
    else if (arg.startsWith("--retention=")) args.retention = arg.slice(12);
    else if (arg === "--traffic" && argv[i + 1]) args.traffic = argv[++i];
    else if (arg.startsWith("--traffic=")) args.traffic = arg.slice(10);
    else if (arg === "--timeline" && argv[i + 1]) args.timeline = argv[++i];
    else if (arg.startsWith("--timeline=")) args.timeline = arg.slice(11);
    else if (arg === "--story" && argv[i + 1]) args.story = argv[++i];
    else if (arg.startsWith("--story=")) args.story = arg.slice(8);
    else if (arg === "--channel-baseline" && argv[i + 1]) args.channelBaseline = argv[++i];
    else if (arg.startsWith("--channel-baseline=")) args.channelBaseline = arg.slice(19);
    else if (arg === "--out-dir" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice(10);
    else if (arg === "--duration" && argv[i + 1]) args.durationS = Number(argv[++i]);
    else if (arg.startsWith("--duration=")) args.durationS = Number(arg.slice(11));
  }
  if (!Number.isFinite(args.durationS) || args.durationS <= 0) args.durationS = 60;
  args.outDir = path.isAbsolute(args.outDir)
    ? args.outDir
    : path.resolve(ROOT, args.outDir);
  return args;
}

async function readJsonMaybe(filePath, fallback) {
  if (!filePath) return fallback;
  const target = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  return fs.readJson(target);
}

function fixtureInput() {
  return {
    story: {
      id: "fixture-retention",
      title:
        "Forza Horizon 6 hits 130,000 concurrent players on Steam during early access",
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam during early access.",
    },
    retentionRows: [
      { elapsed_video_time_ratio: 0, audience_watch_ratio: 1 },
      { elapsed_video_time_ratio: 0.05, audience_watch_ratio: 0.82 },
      { elapsed_video_time_ratio: 0.1, audience_watch_ratio: 0.66 },
      { elapsed_video_time_ratio: 0.2, audience_watch_ratio: 0.61 },
      { elapsed_video_time_ratio: 0.35, audience_watch_ratio: 0.43 },
    ],
    trafficRows: [
      {
        traffic_source_type: "SHORTS",
        views: 2400,
        average_percentage_viewed: 58,
      },
    ],
    sceneTimeline: {
      scenes: [
        {
          type: "opener",
          startS: 0,
          durationS: 3.8,
          source: "forza-trailer.m3u8",
          mediaStartS: 28.5,
        },
        {
          type: "clip",
          startS: 3.8,
          durationS: 4,
          source: "forza-trailer.m3u8",
          mediaStartS: 28.5,
        },
        { type: "card.stat", startS: 7.8, durationS: 4, label: "steam_stat" },
      ],
    },
    channelBaseline: {
      views_28d: 19300,
      watch_hours_28d: 58,
      avg_watch_seconds_estimate: 10.8,
      stayed_to_watch: 39.3,
      swiped_away: 60.7,
      subscriber_conversion_estimate: 0.041,
      top_short_ceiling_current: 900,
      mobile_share: 71.4,
      audience_core: "male, 25-44, UK/US, mobile",
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const fixture = fixtureInput();
  const story = await readJsonMaybe(args.story, args.fixture ? fixture.story : {});
  const retentionRows = await readJsonMaybe(
    args.retention,
    args.fixture ? fixture.retentionRows : [],
  );
  const trafficRows = await readJsonMaybe(
    args.traffic,
    args.fixture ? fixture.trafficRows : [],
  );
  const sceneTimeline = await readJsonMaybe(
    args.timeline,
    args.fixture ? fixture.sceneTimeline : {},
  );
  const channelBaseline = await readJsonMaybe(
    args.channelBaseline,
    args.fixture ? fixture.channelBaseline : {},
  );

  const intelligence = buildRetentionIntelligence({
    story,
    durationS: args.durationS,
    retentionRows,
    trafficRows,
    sceneTimeline,
    channelBaseline,
  });

  await fs.ensureDir(args.outDir);
  const jsonPath = path.join(args.outDir, "retention_intelligence.json");
  const mdPath = path.join(args.outDir, "retention_intelligence.md");
  await fs.writeJson(jsonPath, intelligence, { spaces: 2 });
  await fs.writeFile(mdPath, renderRetentionIntelligenceMarkdown(intelligence), "utf8");

  console.log(`[retention-intelligence] verdict=${intelligence.verdict}`);
  console.log(`[retention-intelligence] hook_score=${intelligence.hook.score}`);
  console.log(`[retention-intelligence] visual_pacing_score=${intelligence.visual_pacing.score}`);
  console.log(`[retention-intelligence] recommendations=${intelligence.recommendations.length}`);
  console.log(`[retention-intelligence] md=${path.relative(ROOT, mdPath)}`);
  console.log(`[retention-intelligence] json=${path.relative(ROOT, jsonPath)}`);
  return { intelligence, artefacts: { md: mdPath, json: jsonPath } };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[retention-intelligence] FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, main };
