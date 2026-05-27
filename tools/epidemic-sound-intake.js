#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildEpidemicSoundIntakeReport,
  enrichDownloadSlot,
} = require("../lib/epidemic-sound-intake");

function parseArgs(argv = process.argv) {
  const args = {
    root: "audio/epidemic",
    outputDir: path.join("output", "epidemic-sound-intake"),
    generatedAt: new Date().toISOString(),
    safelistEvidence: "",
    json: false,
    help: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = argv[++index] || args.root;
    else if (arg === "--out-dir") args.outputDir = argv[++index] || args.outputDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || args.generatedAt;
    else if (arg === "--safelist-evidence") args.safelistEvidence = argv[++index] || "";
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:epidemic-sound-intake -- [options]",
    "",
    "Local-only Epidemic Sound intake for Pulse audio beds, stings and SFX.",
    "",
    "Options:",
    "  --root <dir>                    Epidemic asset folder. Default: audio/epidemic",
    "  --out-dir <dir>                 Output directory. Default: output/epidemic-sound-intake",
    "  --generated-at <iso>            Timestamp for deterministic proof runs",
    "  --safelist-evidence <path|url>  Retained proof that target channels/videos are safelisted",
    "  --json                         Print report JSON",
    "",
    "Safety: no downloads, no posting, no DB mutation, no OAuth/token mutation and no secret reads.",
  ].join("\n");
}

async function writeReport(report, { outputDir } = {}) {
  const outDir = path.resolve(outputDir || path.join("output", "epidemic-sound-intake"));
  await fs.ensureDir(outDir);
  const outputs = {
    reportPath: path.join(outDir, "epidemic_sound_intake_report.json"),
    musicInventoryPath: path.join(outDir, "epidemic_music_inventory.json"),
    sfxInventoryPath: path.join(outDir, "epidemic_sfx_inventory.json"),
    rightsLedgerPath: path.join(outDir, "epidemic_rights_ledger.json"),
    audioPackCandidatesPath: path.join(outDir, "epidemic_audio_pack_candidates.json"),
    downloadPlanPath: path.join(outDir, "epidemic_download_plan.json"),
    browserQueuePath: path.join(outDir, "epidemic_browser_download_queue.json"),
    markdownPath: path.join(outDir, "epidemic_operator_report.md"),
    downloadCockpitPath: path.join(outDir, "epidemic_download_cockpit.html"),
  };
  await fs.writeJson(outputs.reportPath, report, { spaces: 2 });
  await fs.writeJson(outputs.musicInventoryPath, report.music_inventory, { spaces: 2 });
  await fs.writeJson(outputs.sfxInventoryPath, report.sfx_inventory, { spaces: 2 });
  await fs.writeJson(outputs.rightsLedgerPath, report.rights_ledger, { spaces: 2 });
  await fs.writeJson(outputs.audioPackCandidatesPath, report.audio_pack_candidates, { spaces: 2 });
  await fs.writeJson(outputs.downloadPlanPath, report.download_plan, { spaces: 2 });
  await fs.writeJson(outputs.browserQueuePath, buildBrowserDownloadQueue(report), { spaces: 2 });
  await fs.writeFile(outputs.markdownPath, renderMarkdown(report));
  await fs.writeFile(outputs.downloadCockpitPath, renderDownloadCockpit(report));
  return outputs;
}

function buildBrowserDownloadQueue(report = {}) {
  const slots = (report.download_plan?.required_slots || []).map((slot) => {
    const enriched = enrichDownloadSlot(slot);
    return {
      role: enriched.role,
      asset_category: enriched.asset_category,
      search_url: enriched.search_url,
      search_brief: enriched.search_brief,
      target_folder: enriched.folder,
      local_target_path: enriched.local_target_path,
      recommended_filename_prefix: enriched.recommended_filename_prefix,
      post_download_intake_command:
        'npm run ops:epidemic-download-intake -- --source "$env:USERPROFILE\\Downloads" --apply',
    };
  });

  return {
    schema_version: 1,
    generated_at: report.generated_at || new Date().toISOString(),
    mode: "epidemic_sound_browser_download_queue",
    provider: report.provider?.provider_name || report.download_plan?.provider || "Epidemic Sound",
    slots,
    safety: {
      local_only: true,
      opens_browser_links_only: true,
      no_downloads_started_by_tool: true,
      no_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_or_token_read: true,
    },
  };
}

function renderMarkdown(report = {}) {
  const lines = [];
  lines.push("# Epidemic Sound Intake Report");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "(unknown)"}`);
  lines.push(`Readiness: ${report.readiness?.status || "unknown"}`);
  lines.push("");
  if (report.readiness?.blockers?.length) {
    lines.push("## Blockers");
    for (const blocker of report.readiness.blockers) lines.push(`- ${blocker}`);
    lines.push("");
  }
  if (report.readiness?.warnings?.length) {
    lines.push("## Warnings");
    for (const warning of report.readiness.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  lines.push("## Coverage");
  lines.push(`- Music assets: ${Number(report.summary?.music_assets || 0)}`);
  lines.push(`- SFX assets: ${Number(report.summary?.sfx_assets || 0)}`);
  lines.push(`- Rights records: ${Number(report.summary?.rights_records || 0)}`);
  lines.push(`- Audio pack candidates: ${Number(report.summary?.audio_pack_candidates || 0)}`);
  lines.push("");
  if (report.audio_pack_candidates?.length) {
    lines.push("## Audio Pack Candidates");
    for (const pack of report.audio_pack_candidates) {
      const roles = (pack.assets || []).map((asset) => asset.role).join(", ") || "none";
      lines.push(`- ${pack.channel_id}: ${roles}`);
    }
    lines.push("");
  }
  lines.push("## Download Slots");
  for (const slot of report.download_plan?.required_slots || []) {
    lines.push(
      `- ${slot.role}: ${slot.folder} - ${slot.search_brief} - prefix ${slot.recommended_filename_prefix || ""}`,
    );
  }
  lines.push("");
  lines.push("## Safety");
  if (report.safety?.no_downloads_started) lines.push("- No downloads were started.");
  if (report.safety?.no_posting) lines.push("- No publishing APIs were called.");
  if (report.safety?.no_db_mutation) lines.push("- No database rows were mutated.");
  if (report.safety?.no_oauth_or_token_change) lines.push("- No OAuth or token settings were changed.");
  if (report.safety?.no_secret_or_token_read) lines.push("- No secrets or token files were read.");
  lines.push("");
  return `${lines.join("\n").trimEnd()}\n`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDownloadCockpit(report = {}) {
  const slots = report.download_plan?.required_slots || [];
  const policyLinks = report.download_plan?.policy_links || [];
  const slotRows = slots
    .map((slot) => {
      const enriched = enrichDownloadSlot(slot);
      const searchUrl = enriched.search_url;
      return [
        "<tr>",
        `<td>${escapeHtml(enriched.role)}</td>`,
        `<td>${escapeHtml(enriched.asset_category)}</td>`,
        `<td><code>${escapeHtml(enriched.local_target_path)}</code></td>`,
        `<td><code>${escapeHtml(enriched.recommended_filename_prefix)}</code></td>`,
        `<td>${escapeHtml(enriched.search_brief)}</td>`,
        `<td><a href="${searchUrl}">Open search</a></td>`,
        "</tr>",
      ].join("");
    })
    .join("\n");
  const policyItems = policyLinks
    .map((link) => `<li><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></li>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Epidemic Sound Download Cockpit</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; line-height: 1.45; color: #151515; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #d0d0d0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f2f2f2; }
    code { background: #f6f6f6; padding: 2px 4px; }
    .blocked { color: #8a3b00; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Epidemic Sound Download Cockpit</h1>
  <p>Readiness: <span class="blocked">${escapeHtml(report.readiness?.status || "unknown")}</span></p>
  <p>Use these links while signed in to Epidemic Sound. Download files, rename vague files with the listed prefix, then run the download intake.</p>
  <h2>Download Slots</h2>
  <table>
    <thead><tr><th>Role</th><th>Type</th><th>Target folder</th><th>Filename prefix</th><th>Search brief</th><th>Search</th></tr></thead>
    <tbody>${slotRows}</tbody>
  </table>
  <h2>After Downloads</h2>
  <p>Run <code>npm run ops:epidemic-download-intake -- --source "$env:USERPROFILE\\Downloads"</code> first. Add <code>--apply</code> only after the planned copies look right.</p>
  <h2>Policy Links</h2>
  <ul>${policyItems}</ul>
  <h2>Safety</h2>
  <p>This page does not download assets, publish content, mutate OAuth tokens or read secrets.</p>
</body>
</html>
`;
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { args };
  }
  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: process.cwd(),
    root: args.root,
    outputDir: args.outputDir,
    generatedAt: args.generatedAt,
    safelistEvidence: args.safelistEvidence,
  });
  const outputs = await writeReport(report, { outputDir: args.outputDir });
  if (args.json) {
    console.log(JSON.stringify({ report, outputs }, null, 2));
  } else {
    console.log(`Epidemic Sound intake: ${report.readiness.status}`);
    console.log(`Music assets: ${report.summary.music_assets}`);
    console.log(`SFX assets: ${report.summary.sfx_assets}`);
    console.log(`Rights records: ${report.summary.rights_records}`);
    console.log(`Report: ${outputs.reportPath}`);
    console.log("Safety: local-only, no downloads, no publish, no DB mutation, no OAuth changes.");
  }
  return { report, outputs };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[epidemic-sound-intake] ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildBrowserDownloadQueue,
  main,
  parseArgs,
  renderDownloadCockpit,
  renderMarkdown,
  usage,
  writeReport,
};
