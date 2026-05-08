#!/usr/bin/env node
"use strict";

/**
 * Build a monetisation milestone snapshot.
 *
 * Read-only. No production data is written, no platform APIs are called and
 * no eligibility is assumed beyond the explicit fixture/file/local state.
 */

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUT_DIR = path.join(ROOT, "test", "output", "monetisation");

const { buildMonetisationSnapshot } = require(
  path.join(ROOT, "lib", "intelligence", "monetisation-tracker"),
);
const {
  buildMonetisationReadiness,
  renderMonetisationReadinessMarkdown,
} = require(path.join(ROOT, "lib", "intelligence", "monetisation-readiness"));
const {
  FIXTURE_MONETISATION_STATE,
  readMonetisationState,
} = require(path.join(ROOT, "lib", "intelligence", "monetisation-state"));
const { recommend: recommendTikTokRoute, rankRoutesForBreakingNews } = require(
  path.join(ROOT, "lib", "intelligence", "tiktok-strategy"),
);

const FIXTURE_STORIES = [
  {
    id: "affiliate_pokemon_go",
    title: "Mega Mewtwo's Pokémon Go debut gets a confirmed date",
    full_script:
      "Pokémon Go players now have a concrete event date and a natural accessory angle.",
  },
  {
    id: "affiliate_gta6",
    title: "GTA 6 trailer evidence remains unconfirmed",
    full_script:
      "The GTA 6 angle is still rumour-led, so monetisation must stay careful and disclosed.",
  },
  {
    id: "affiliate_xbox_policy",
    title: "Xbox platform policy update changes account rules",
    full_script:
      "This is a platform-policy story, so random product links should be avoided.",
  },
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    mode: "fixture",
    outDir: DEFAULT_OUT_DIR,
    statePath: null,
    updateRoot: true,
    generatedAt: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture") {
      options.mode = "fixture";
    } else if (arg === "--local") {
      options.mode = "local";
    } else if (arg === "--state" || arg === "--state-file") {
      options.mode = "file";
      options.statePath = argv[++i];
    } else if (arg === "--out-dir") {
      options.outDir = path.resolve(argv[++i]);
    } else if (arg === "--no-root") {
      options.updateRoot = false;
    } else if (arg === "--update-root") {
      options.updateRoot = true;
    } else if (arg === "--generated-at") {
      options.generatedAt = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.mode === "file" && !options.statePath) {
    throw new Error("--state requires a JSON path");
  }
  return options;
}

function usage() {
  return [
    "Usage: npm run intelligence:monetisation -- [options]",
    "",
    "Options:",
    "  --fixture              Use safe fixture state (default)",
    "  --local                Use env overrides plus local SQLite read-only signals",
    "  --state <file.json>    Use an explicit local JSON state file",
    "  --out-dir <path>       Write dated artefacts under this directory",
    "  --no-root              Do not update MONETISATION_OVERNIGHT_REPORT.md",
    "  --update-root          Update MONETISATION_OVERNIGHT_REPORT.md (default)",
  ].join("\n");
}

function renderStateSourceMarkdown(provenance) {
  const lines = [];
  lines.push("## State Source");
  lines.push("");
  lines.push(`- mode: ${provenance.mode}`);
  lines.push(`- source: ${provenance.source}`);
  lines.push(`- warnings: ${provenance.warnings.length ? provenance.warnings.join("; ") : "none"}`);
  lines.push("");
  lines.push("| field | source | present | value |");
  lines.push("| --- | --- | --- | --- |");
  for (const [key, field] of Object.entries(provenance.fields || {})) {
    lines.push(
      `| ${key} | ${field.source} | ${field.present ? "yes" : "no"} | ${field.public_value} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderMonetisationMarkdown(snapshot, tiktok, provenance = null) {
  const lines = [];
  lines.push("# Pulse Gaming - Monetisation Snapshot");
  lines.push("");
  lines.push(`Generated: ${snapshot.generated_at}`);
  lines.push(
    `Cleared milestones: ${snapshot.summary.cleared} / ${snapshot.summary.total_milestones}`,
  );
  lines.push(`YPP eligible: ${snapshot.summary.ypp_eligible}`);
  lines.push(`Expanded YPP eligible: ${!!snapshot.summary.ypp_early_access_eligible}`);
  if ((snapshot.summary.ypp_early_access_blockers || []).length > 0) {
    lines.push(
      `Expanded YPP blockers: ${snapshot.summary.ypp_early_access_blockers.join("; ")}`,
    );
  }
  if ((snapshot.summary.ypp_blockers || []).length > 0) {
    lines.push(`Full YPP blockers: ${snapshot.summary.ypp_blockers.join("; ")}`);
  }
  lines.push("");
  if (provenance) lines.push(renderStateSourceMarkdown(provenance));
  for (const [section, body] of Object.entries(snapshot.sections)) {
    lines.push(`## ${section}`);
    lines.push("");
    for (const item of body.items) {
      lines.push(
        `- **${item.milestone_label}** - ${item.current_value} / ${item.threshold_value} ` +
          `(${item.progress_percent}%) - cleared=${item.cleared} - path=${item.unlock_path}`,
      );
      for (const n of item.notes || []) lines.push(`  - ${n}`);
    }
    lines.push("");
  }
  lines.push("## TikTok automation strategy");
  lines.push("");
  lines.push(`- primary recommendation: ${tiktok.primaryRecommendation?.label}`);
  lines.push(`  rationale: ${tiktok.primaryRecommendation?.rationale}`);
  lines.push(`- fallback: ${tiktok.fallback?.label}`);
  lines.push(`  rationale: ${tiktok.fallback?.rationale}`);
  lines.push("- rejected:");
  for (const r of tiktok.rejected) lines.push(`  - ${r.id}: ${r.reason}`);
  lines.push("");
  lines.push(`Notes: ${tiktok.notes.join("; ")}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- no monetisation eligibility is assumed beyond the explicit state source");
  lines.push("- no platform API was called");
  lines.push("- no auto-promotion of formats based on this report");
  lines.push("- no scoring weight changes triggered");
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return { help: true };
  }

  const outDir = options.outDir;
  await fs.ensureDir(outDir);
  const { state, provenance } = await readMonetisationState({
    mode: options.mode,
    statePath: options.statePath,
    generatedAt: options.generatedAt,
  });
  const snapshot = buildMonetisationSnapshot(state);
  const tiktok = recommendTikTokRoute({
    canMigrateToBusiness: false,
    hasOperatorOnPhone: true,
  });
  const date = new Date(snapshot.generated_at).toISOString().slice(0, 10);
  const jsonPath = path.join(outDir, `monetisation-${date}.json`);
  const statePath = path.join(outDir, `monetisation-state-${date}.json`);
  const tiktokJsonPath = path.join(outDir, `tiktok-${date}.json`);
  const tiktokRoutesPath = path.join(outDir, `tiktok-routes-${date}.json`);
  const mdPath = path.join(outDir, `monetisation-${date}.md`);
  const readiness = buildMonetisationReadiness({
    snapshot: state,
    stories: FIXTURE_STORIES,
    stateProvenance: provenance,
  });
  const readinessMd = renderMonetisationReadinessMarkdown(readiness);
  const outputRoot = path.resolve(outDir, "..");
  const readinessJsonPath = path.join(outputRoot, "monetisation_readiness.json");
  const readinessMdPath = path.join(outputRoot, "monetisation_readiness.md");
  const overnightReportPath = path.join(ROOT, "MONETISATION_OVERNIGHT_REPORT.md");

  await fs.writeJson(jsonPath, snapshot, { spaces: 2 });
  await fs.writeJson(statePath, { state, provenance }, { spaces: 2 });
  await fs.writeJson(tiktokJsonPath, tiktok, { spaces: 2 });
  await fs.writeJson(tiktokRoutesPath, rankRoutesForBreakingNews(), { spaces: 2 });
  await fs.writeFile(mdPath, renderMonetisationMarkdown(snapshot, tiktok, provenance));
  await fs.writeJson(readinessJsonPath, readiness, { spaces: 2 });
  await fs.writeFile(readinessMdPath, readinessMd);
  if (options.updateRoot) {
    await fs.writeFile(overnightReportPath, readinessMd);
  }

  return {
    mode: options.mode,
    cleared: snapshot.summary.cleared,
    total: snapshot.summary.total_milestones,
    ypp: snapshot.summary.ypp_eligible,
    earlyYpp: snapshot.summary.ypp_early_access_eligible,
    artefacts: {
      monetisationJson: path.relative(ROOT, jsonPath),
      monetisationStateJson: path.relative(ROOT, statePath),
      tiktokJson: path.relative(ROOT, tiktokJsonPath),
      tiktokRoutesJson: path.relative(ROOT, tiktokRoutesPath),
      md: path.relative(ROOT, mdPath),
      readinessJson: path.relative(ROOT, readinessJsonPath),
      readinessMd: path.relative(ROOT, readinessMdPath),
      overnightReport: options.updateRoot ? path.relative(ROOT, overnightReportPath) : null,
    },
  };
}

if (require.main === module) {
  main()
    .then((r) => {
      if (r.help) return;
      console.log(
        `[monetisation] mode=${r.mode} cleared=${r.cleared}/${r.total} ypp=${r.ypp} early_ypp=${r.earlyYpp}`,
      );
      for (const [k, v] of Object.entries(r.artefacts)) {
        if (v) console.log(`  ${k}: ${v}`);
      }
    })
    .catch((err) => {
      console.error(`[monetisation] FAILED: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  main,
  parseArgs,
  FIXTURE_STATE: FIXTURE_MONETISATION_STATE,
  FIXTURE_STORIES,
  renderMonetisationMarkdown,
  renderStateSourceMarkdown,
};
