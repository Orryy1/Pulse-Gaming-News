#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const { CONTENT_IDENTITIES } = require("../lib/content-identity-system");
const {
  LIVING_MOTION_VERSION,
  resolveLivingMotionGrammar,
} = require("../lib/studio/v4/living-motion-grammar");

const ROOT = path.resolve(__dirname, "..");

function buildLivingMotionCatalog() {
  const treatments = Object.values(CONTENT_IDENTITIES).map((identity) => ({
    label: identity.label,
    ...resolveLivingMotionGrammar({ id: `catalog-${identity.id}`, content_identity_id: identity.id }),
  }));
  const blockers = [];
  for (const treatment of treatments) {
    if (!treatment.ghost_word) blockers.push(`${treatment.identity_id}:ghost_word_missing`);
    if (treatment.editorial.ghost_opacity > 0.10) blockers.push(`${treatment.identity_id}:ghost_too_strong`);
    if (treatment.depth.foreground_drift_x_px > 24) blockers.push(`${treatment.identity_id}:foreground_drift_too_large`);
    if (/orb|bokeh|blob/i.test(JSON.stringify(treatment))) blockers.push(`${treatment.identity_id}:prohibited_decoration`);
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    version: LIVING_MOTION_VERSION,
    verdict: blockers.length ? "RED" : "GREEN",
    summary: { treatment_count: treatments.length, blocker_count: blockers.length },
    treatments,
    blockers,
    safety: { local_only: true, no_external_publish: true, no_db_mutation: true },
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Pulse Living Motion Grammar",
    "",
    `Verdict: **${report.verdict}**`,
    `Version: \`${report.version}\``,
    "",
    "| Identity | Editorial motif | Accent | Background drift | Foreground drift |",
    "| --- | --- | --- | ---: | --- |",
  ];
  for (const treatment of report.treatments) {
    lines.push(`| ${treatment.label} | ${treatment.ghost_word} | ${treatment.accent} | ${treatment.depth.background_drift_ratio} | ${treatment.depth.foreground_drift_x_px} x ${treatment.depth.foreground_drift_y_px}px |`);
  }
  lines.push("", "All treatments are seek-safe, caption-priority and local proof only.", "");
  return lines.join("\n");
}

async function main() {
  const outputDir = path.join(ROOT, "output", "living-motion-grammar");
  const report = buildLivingMotionCatalog();
  await fs.ensureDir(outputDir);
  await fs.writeJson(path.join(outputDir, "living_motion_grammar_catalog.json"), report, { spaces: 2 });
  await fs.writeFile(path.join(outputDir, "living_motion_grammar_catalog.md"), renderMarkdown(report), "utf8");
  console.log(`[living-motion] ${report.verdict} treatments=${report.summary.treatment_count}`);
  if (report.verdict !== "GREEN") process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[living-motion] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildLivingMotionCatalog, renderMarkdown };
