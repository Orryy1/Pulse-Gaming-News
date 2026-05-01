#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true });
} catch {}

const {
  buildCreatorStudioControlRoom,
  buildDemoStories,
  renderCreatorStudioMarkdown,
  renderPacketMarkdown,
} = require("../lib/creator-studio-os");
const {
  buildAssetAcquisitionControlRoom,
} = require("../lib/asset-acquisition-pro");
const {
  renderStillImageEnrichmentMarkdown,
  runStillImageEnrichment,
} = require("../lib/still-image-enrichment");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const PACKET_OUT = path.join(OUT, "creator-studio");
const DEFAULT_TRAILER_REFERENCE_REPORT = path.join(OUT, "official_trailer_references_v1.json");

function parseArgs(argv) {
  const args = {
    fixture: false,
    json: false,
    help: false,
    storyId: null,
    allApproved: false,
    limit: 5,
    trailerReferences: null,
    noTrailerReferences: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--all-approved") args.allApproved = true;
    else if (arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 5);
    else if (arg === "--trailer-references") args.trailerReferences = argv[++i] || null;
    else if (arg === "--no-trailer-references") args.noTrailerReferences = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/creator-studio-control-room.js [options]",
      "",
      "Options:",
      "  --fixture             Use built-in demo stories",
      "  --story-id <id>       Build a packet for one story id",
      "  --all-approved        Include approved / auto-approved stories",
      "  --limit <n>           Limit local DB stories when not using --all-approved",
      "  --trailer-references <p>",
      "                        Read official trailer references for motion/frame readiness",
      "  --no-trailer-references",
      "                        Ignore test/output/official_trailer_references_v1.json",
      "  --json                Print JSON instead of Markdown",
    ].join("\n") + "\n",
  );
}

async function loadTrailerReferenceReport(args) {
  if (args.noTrailerReferences) return { report: null, source: null };
  const filePath = args.trailerReferences
    ? path.resolve(ROOT, args.trailerReferences)
    : DEFAULT_TRAILER_REFERENCE_REPORT;
  if (!(await fs.pathExists(filePath))) return { report: null, source: null };
  return { report: await fs.readJson(filePath), source: filePath };
}

function parseJsonField(value) {
  if (!value || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normaliseStory(row) {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    downloaded_images: Array.isArray(row.downloaded_images)
      ? row.downloaded_images
      : parseJsonField(row.downloaded_images) || [],
    video_clips: Array.isArray(row.video_clips)
      ? row.video_clips
      : parseJsonField(row.video_clips) || [],
    game_images: Array.isArray(row.game_images)
      ? row.game_images
      : parseJsonField(row.game_images) || [],
  };
}

function storyTime(story) {
  return Date.parse(story?.timestamp || story?.created_at || story?.updated_at || 0) || 0;
}

async function loadStories(args) {
  if (args.fixture) {
    return { stories: buildDemoStories(), mode: "fixture" };
  }

  try {
    const db = require("../lib/db");
    const rows = (await db.getStories()).map(normaliseStory);
    let selected = rows;
    if (args.storyId) {
      selected = rows.filter((story) => story.id === args.storyId);
    } else if (args.allApproved) {
      selected = rows.filter((story) => story.approved || story.auto_approved);
    } else {
      selected = rows
        .filter((story) => story.approved || story.auto_approved)
        .sort((a, b) => storyTime(b) - storyTime(a))
        .slice(0, args.limit);
      if (selected.length === 0) {
        selected = rows.sort((a, b) => storyTime(b) - storyTime(a)).slice(0, args.limit);
      }
    }
    if (selected.length > 0) {
      return { stories: selected, mode: args.storyId ? "story_id" : "local_db" };
    }
  } catch (err) {
    process.stderr.write(`[creator-studio] local DB read failed, using fixture: ${err.message}\n`);
  }

  return { stories: buildDemoStories(), mode: "fixture_fallback" };
}

function safeName(value) {
  return String(value || "story")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function sectionMarkdown(title, obj) {
  return `# ${title}\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
}

function renderAssetAcquisitionSummary(assetReport) {
  if (!assetReport) return "";
  const lines = [];
  lines.push("");
  lines.push("## Asset Acquisition Pro v1");
  lines.push("");
  lines.push(`- overall: ${assetReport.overall_status}`);
  lines.push(`- stories needing acquisition: ${assetReport.summary.acquire}`);
  lines.push(`- improved after estimate: ${assetReport.summary.improved_after_estimate}`);
  lines.push(`- total candidates: ${assetReport.summary.total_candidates}`);
  lines.push(`- deck items: ${assetReport.summary.deck_items}`);
  if (assetReport.exact_subject_summary) {
    lines.push(`- Studio V2 60s eligible after exact-subject gate: ${assetReport.exact_subject_summary.studio_v2_60s_eligible}`);
    lines.push(`- premium candidates after exact-subject gate: ${assetReport.exact_subject_summary.premium_candidates}`);
  }
  lines.push("");
  lines.push("| story | before | after | exact | runtime | v2 60s | deck | key tasks |");
  lines.push("| --- | --- | --- | ---: | --- | --- | ---: | --- |");
  for (const plan of assetReport.plans) {
    const exact = plan.exact_subject_readiness || {};
    lines.push(
      [
        plan.story_id,
        `${plan.creator_studio_before.colour}/${plan.creator_studio_before.media_verdict}`,
        `${plan.creator_studio_after.colour}/${plan.creator_studio_after.media_verdict}`,
        exact.exact_subject_asset_count || 0,
        exact.recommended_runtime_class || "unknown",
        exact.studio_v2_60s_eligible === true,
        plan.visual_deck.items.length,
        plan.tasks.slice(0, 4).map((task) => task.type).join(", ") || "none",
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  return lines.join("\n") + "\n";
}

function renderStillImageEnrichmentSummary(stillReport) {
  if (!stillReport) return "";
  return "\n## Asset Acquisition Pro v1.1\n\n" + renderStillImageEnrichmentMarkdown(stillReport);
}

async function writePacketFiles(packet) {
  const dir = path.join(PACKET_OUT, safeName(packet.story_id));
  await fs.ensureDir(dir);
  const writes = [
    ["story_dossier.json", packet.story_dossier],
    ["source_pack.json", packet.source_pack],
    ["media_inventory.json", packet.media_inventory],
    ["shot_list.json", packet.shot_list],
    ["render_manifest.json", packet.render_manifest],
    ["motion_acquisition.json", packet.motion_acquisition],
    ["controlled_frame_plan.json", packet.controlled_frame_plan],
    ["platform_route_plan.json", packet.platform_route_plan],
    ["publish_readiness.json", packet.publish_readiness],
    ["learning_hook.json", packet.learning_hook],
  ];
  for (const [file, data] of writes) {
    await fs.writeJson(path.join(dir, file), data, { spaces: 2 });
  }
  await fs.writeFile(
    path.join(dir, "story_dossier.md"),
    sectionMarkdown("Story Dossier", packet.story_dossier),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "fact_check_report.md"),
    sectionMarkdown("Fact Check Report", packet.fact_check_report),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "media_inventory.md"),
    sectionMarkdown("Media Inventory", packet.media_inventory),
    "utf8",
  );
  await fs.writeFile(path.join(dir, "visual_script.md"), packet.shot_list.visual_script + "\n", "utf8");
  await fs.writeFile(
    path.join(dir, "render_contract.md"),
    sectionMarkdown("Render Contract", packet.render_contract),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "publish_readiness.md"),
    sectionMarkdown("Publish Readiness", packet.publish_readiness),
    "utf8",
  );
  await fs.writeFile(path.join(dir, "production_packet.md"), renderPacketMarkdown(packet), "utf8");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const { stories, mode } = await loadStories(args);
  const trailerReferences = await loadTrailerReferenceReport(args);
  const report = buildCreatorStudioControlRoom(stories, {
    mode,
    officialTrailerReferenceReport: trailerReferences.report,
  });
  const assetReport = buildAssetAcquisitionControlRoom(stories, { mode });
  const stillReport = await runStillImageEnrichment(stories, { dryRun: true });
  report.official_trailer_reference_source = trailerReferences.source;
  report.asset_acquisition_v1 = assetReport;
  report.asset_acquisition_v11_still_enrichment = stillReport;
  const markdown =
    renderCreatorStudioMarkdown(report) +
    renderAssetAcquisitionSummary(assetReport) +
    renderStillImageEnrichmentSummary(stillReport);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "creator_studio_control_room.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "creator_studio_control_room.md"), markdown, "utf8");
  await fs.writeJson(path.join(OUT, "creator_studio_asset_acquisition_v1.json"), assetReport, {
    spaces: 2,
  });
  await fs.writeJson(path.join(OUT, "creator_studio_asset_acquisition_v11_stills.json"), stillReport, {
    spaces: 2,
  });
  await fs.writeJson(path.join(OUT, "creator_studio_asset_acquisition_v12_exact_subject.json"), assetReport, {
    spaces: 2,
  });
  await fs.writeJson(path.join(OUT, "creator_studio_asset_acquisition_v13_store_verification.json"), assetReport, {
    spaces: 2,
  });
  for (const packet of report.packets) {
    await writePacketFiles(packet);
  }

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write(
    `[creator-studio] wrote test/output/creator_studio_control_room.{json,md} and ${report.packets.length} packet(s)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[creator-studio] ${err.stack || err.message}\n`);
  process.exit(1);
});
