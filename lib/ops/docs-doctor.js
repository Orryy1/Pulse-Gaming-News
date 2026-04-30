"use strict";

/**
 * lib/ops/docs-doctor.js — read-only docs freshness / drift checker.
 *
 * Per the 2026-04-29 forensic audit: stale docs cause unsafe
 * operational decisions. The audit named specific drift hazards:
 *   - "ready + complete" treated as Facebook Reel success
 *   - old commit IDs in operations docs
 *   - obsolete branch names
 *   - "live proof pending" after a definitive finding exists
 *   - "scope not present" when scope exists
 *
 * This module scans markdown files under the repo for those exact
 * stale phrases and produces a report. Pure read-only — never edits
 * docs, never posts. Operator decides what to fix.
 *
 * Returns:
 *   {
 *     scanned: number,
 *     drift_signals: [
 *       { file, line, phrase, severity, snippet }
 *     ],
 *     summary: { high, medium, low },
 *     generated_at: ISOString,
 *   }
 */

const fs = require("fs-extra");
const path = require("node:path");

// Phrases the audit flagged. Each carries a severity:
//   high   = will cause wrong operational decision (e.g. trust a
//            Facebook Reel that isn't actually published)
//   medium = stale reference (old commit / old branch)
//   low    = informational drift (terminology changes)
const DRIFT_PHRASES = [
  {
    re: /\bready\s*\+\s*complete\b/i,
    label: "fb_reel_ready_complete_success",
    severity: "high",
  },
  {
    re: /\bvideo_status\s*=\s*ready\b/i,
    label: "fb_reel_video_status_ready",
    severity: "high",
  },
  {
    re: /\blive proof pending\b/i,
    label: "live_proof_pending_stale",
    severity: "medium",
  },
  {
    re: /\bscope not present\b/i,
    label: "yt_analytics_scope_not_present_stale",
    severity: "medium",
  },
  {
    re: /\bscope is not present\b/i,
    label: "yt_analytics_scope_not_present_stale",
    severity: "medium",
  },
  {
    re: /\bcommit\s+[0-9a-f]{7,40}\b/i,
    label: "commit_reference_check_freshness",
    severity: "low",
  },
];

const DEFAULT_INCLUDE_GLOBS = [
  "*.md",
  "docs/**/*.md",
  "tools/**/*.md",
  "lib/**/*.md",
];

const DEFAULT_EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /\bdist\//,
  /\btest\/output\//,
  /\bdata\//,
  /CHANGELOG/i,
  /CLAUDE\.md$/,
];

async function listMarkdownFiles(rootDir) {
  // Lightweight recursion — we don't need the glob package for this.
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      // Normalise to forward slashes so exclude patterns work on Windows.
      const rel = path.relative(rootDir, full).split(path.sep).join("/");
      if (DEFAULT_EXCLUDE_PATTERNS.some((re) => re.test(rel))) continue;
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && full.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  await walk(rootDir);
  return out;
}

function scanFile(content, file) {
  const signals = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { re, label, severity } of DRIFT_PHRASES) {
      if (re.test(line)) {
        signals.push({
          file,
          line: i + 1,
          phrase: label,
          severity,
          snippet: line.trim().slice(0, 160),
        });
      }
    }
  }
  return signals;
}

async function buildDocsDoctorReport({
  rootDir = path.resolve(__dirname, "..", ".."),
  fsLib = fs,
} = {}) {
  const files = await listMarkdownFiles(rootDir);
  const drift = [];
  for (const file of files) {
    let content;
    try {
      content = await fsLib.readFile(file, "utf-8");
    } catch {
      continue;
    }
    const rel = path.relative(rootDir, file);
    drift.push(...scanFile(content, rel));
  }
  const summary = { high: 0, medium: 0, low: 0 };
  for (const d of drift) {
    summary[d.severity] = (summary[d.severity] || 0) + 1;
  }
  return {
    scanned: files.length,
    drift_signals: drift,
    summary,
    generated_at: new Date().toISOString(),
  };
}

function formatDocsDoctorMarkdown(report) {
  if (!report) return "";
  const lines = [];
  lines.push("**Pulse Gaming — Docs Doctor**");
  lines.push(
    `Scanned: ${report.scanned} markdown files | Signals: ${report.drift_signals.length}`,
  );
  lines.push(
    `High: ${report.summary.high || 0} | Medium: ${report.summary.medium || 0} | Low: ${report.summary.low || 0}`,
  );
  if (report.drift_signals.length === 0) {
    lines.push("");
    lines.push("Docs look clean against the audit's drift list.");
    return lines.join("\n");
  }
  lines.push("");
  lines.push("**Top signals** (severity high → low, capped at 30)");
  const sorted = [...report.drift_signals].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    const av = order[a.severity];
    const bv = order[b.severity];
    return (av === undefined ? 9 : av) - (bv === undefined ? 9 : bv);
  });
  for (const s of sorted.slice(0, 30)) {
    const glyph = { high: "🔴", medium: "🟡", low: "⚪" }[s.severity] || "⚪";
    lines.push(
      `${glyph} ${s.file}:${s.line} (${s.phrase})\n    > ${s.snippet}`,
    );
  }
  return lines.join("\n");
}

module.exports = {
  buildDocsDoctorReport,
  formatDocsDoctorMarkdown,
  scanFile,
  listMarkdownFiles,
  DRIFT_PHRASES,
};
