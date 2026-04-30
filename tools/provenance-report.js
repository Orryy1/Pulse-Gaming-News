#!/usr/bin/env node
"use strict";

/**
 * tools/provenance-report.js — operator audit of the asset provenance
 * ledger.
 *
 * Read-only. Surfaces:
 *   - source-type distribution over the window
 *   - acceptance / reject reason distribution
 *   - licence-class distribution
 *   - face-detected assets (visual_content_signals.likely_has_face=1)
 *
 * Usage:
 *   node tools/provenance-report.js              # last 7 days, markdown
 *   node tools/provenance-report.js --window "-1 day"
 *   node tools/provenance-report.js --json
 *   node tools/provenance-report.js --discord
 */

const fs = require("fs-extra");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = { json: false, discord: false, window: "-7 days", help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--discord") args.discord = true;
    else if (a === "--help" || a === "-?") args.help = true;
    else if (a === "--window") args.window = argv[++i] || args.window;
    else if (a.startsWith("--window=")) {
      args.window = a.slice("--window=".length);
    }
  }
  return args;
}

function formatMarkdown(summary, window) {
  if (!summary || summary.unavailable) {
    return (
      "**Pulse Gaming — Asset Provenance**\n" +
      "Provenance ledger unavailable (USE_SQLITE=true required, " +
      "and migration 019 must be applied).\n"
    );
  }
  const lines = [];
  lines.push(`**Pulse Gaming — Asset Provenance** (window: ${window})`);
  lines.push("");
  lines.push("**By source type**");
  for (const r of summary.by_source.slice(0, 12)) {
    lines.push(`  • ${r.source_type || "(none)"}: ${r.n}`);
  }
  if (summary.by_source.length === 0) lines.push("  (no rows in window)");

  lines.push("");
  lines.push("**By acceptance**");
  for (const r of summary.by_acceptance.slice(0, 12)) {
    const accepted = r.accepted ? "✅ accepted" : "❌ rejected";
    const reason = r.reject_reason ? ` (${r.reject_reason})` : "";
    lines.push(`  • ${accepted}${reason}: ${r.n}`);
  }
  if (summary.by_acceptance.length === 0) lines.push("  (no rows in window)");

  lines.push("");
  lines.push("**By licence class**");
  for (const r of summary.by_licence.slice(0, 12)) {
    lines.push(`  • ${r.licence_class || "(unknown)"}: ${r.n}`);
  }

  if (summary.face_photos.length > 0) {
    lines.push("");
    lines.push(
      `**Face-detected assets in window** (heuristic, no identity): ${summary.face_photos.length}`,
    );
    for (const p of summary.face_photos.slice(0, 10)) {
      const stockBit = p.likely_is_stock_person ? " ⚠ stock" : "";
      lines.push(
        `  🟡 ${p.story_id} · ${p.source_type}${stockBit}\n      ${(p.source_url || "").slice(0, 90)}`,
      );
    }
  }

  // Operator hint
  if (summary.face_photos.length > 0) {
    const stockCount = summary.face_photos.filter(
      (p) => p.likely_is_stock_person,
    ).length;
    if (stockCount > 0) {
      lines.push("");
      lines.push(
        `⚠ ${stockCount} face-detected stock-source photo(s) in the window. ` +
          `Per the audit, stock people should not fill weak stories — ` +
          `inspect the rows above and quarantine if appropriate.`,
      );
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node tools/provenance-report.js [--window WIN] [--json] [--discord]\n",
    );
    return;
  }

  const provenance = require("../lib/media-provenance");
  const summary = provenance.summary({ window: args.window });
  const markdown = formatMarkdown(summary, args.window);

  try {
    await fs.ensureDir(OUT);
    await fs.writeJson(path.join(OUT, "provenance_report.json"), summary, {
      spaces: 2,
    });
    await fs.writeFile(
      path.join(OUT, "provenance_report.md"),
      markdown,
      "utf-8",
    );
  } catch (err) {
    process.stderr.write(`[provenance] persist failed: ${err.message}\n`);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    process.stdout.write(markdown + "\n");
  }

  if (args.discord) {
    try {
      const sendDiscord = require("../notify");
      await sendDiscord(markdown);
    } catch (err) {
      process.stderr.write(
        `[provenance] discord post failed: ${err.message}\n`,
      );
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[provenance] ${err.stack || err.message}\n`);
  process.exit(1);
});
