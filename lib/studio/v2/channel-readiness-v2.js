"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_OUT = path.join(ROOT, "test", "output");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function toPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function rel(root, p) {
  return toPosix(path.relative(root, p));
}

function absoluteFromRoot(root, maybeRelative) {
  if (!maybeRelative) return null;
  return path.isAbsolute(maybeRelative)
    ? maybeRelative
    : path.join(root, maybeRelative);
}

function hexToAssBgr(hex) {
  const clean = String(hex || "").replace(/^#/, "").trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  const rr = clean.slice(0, 2).toUpperCase();
  const gg = clean.slice(2, 4).toUpperCase();
  const bb = clean.slice(4, 6).toUpperCase();
  return `&H00${bb}${gg}${rr}`;
}

function extractAssEmphasisColour(assText) {
  const line = String(assText || "")
    .split(/\r?\n/)
    .find((entry) => /^Style:\s*PopEmphasis,/i.test(entry));
  if (!line) return null;
  const parts = line.split(",");
  return parts[3] ? parts[3].trim().toUpperCase() : null;
}

function getChannelConfig(channelId) {
  try {
    const channels = require(path.join(ROOT, "channels"));
    return channels.getChannel(channelId);
  } catch {
    return null;
  }
}

function evaluateThemeIntegrity({ root = ROOT, channelId, assPath }) {
  const channel = getChannelConfig(channelId);
  const expectedAssColour = channel
    ? hexToAssBgr(channel.colours?.PRIMARY)
    : null;
  const absoluteAss = absoluteFromRoot(root, assPath);
  const present = Boolean(absoluteAss && fs.existsSync(absoluteAss));
  const actualAssColour = present
    ? extractAssEmphasisColour(fs.readFileSync(absoluteAss, "utf8"))
    : null;
  return {
    channelId,
    expectedHex: channel?.colours?.PRIMARY || null,
    expectedAssColour,
    actualAssColour,
    assPath: assPath || null,
    present,
    matches:
      Boolean(expectedAssColour && actualAssColour) &&
      expectedAssColour.toUpperCase() === actualAssColour.toUpperCase(),
  };
}

function addIssue(list, code, message, evidence = null) {
  list.push({ code, message, evidence });
}

function evaluateChannelCandidate(summary, options = {}) {
  const root = options.root || ROOT;
  const thresholds = {
    sourceDiversity: options.sourceDiversityTarget ?? 0.85,
    clipDominance: options.clipDominanceTarget ?? 0.7,
    motionDensityPerMin: options.motionDensityTarget ?? 18,
    legacyShortRuntimeS: options.legacyShortRuntimeS ?? 60,
    hotTruePeakDb: options.hotTruePeakDb ?? -1,
  };
  const channelId = summary.channelId || summary.seo?.channelId || "pulse-gaming";
  const hardFailures = [];
  const warnings = [];
  const studio = summary.studio || {};
  const forensic = summary.forensic || {};
  const seo = summary.seo || {};
  const loudness = summary.loudness || {};
  const theme = evaluateThemeIntegrity({
    root,
    channelId,
    assPath: summary.paths?.ass,
  });

  if (studio.lane !== "pass") {
    addIssue(hardFailures, "studio_lane_not_pass", "Studio rubric did not pass.", {
      lane: studio.lane,
      redTrips: studio.redTrips,
    });
  }
  if ((studio.redTrips || 0) > 0) {
    addIssue(hardFailures, "studio_red_metrics", "Studio rubric has red metrics.", {
      redMetrics: studio.redMetrics || [],
    });
  }
  if ((forensic.failCount || 0) > 0) {
    addIssue(hardFailures, "forensic_failures", "Forensic QA has failing checks.", {
      issues: forensic.issues || [],
    });
  }
  if (forensic.subtitleVerdict && forensic.subtitleVerdict !== "pass") {
    addIssue(
      hardFailures,
      "subtitle_not_pass",
      "Subtitle QA is not a clean pass.",
      { subtitleVerdict: forensic.subtitleVerdict },
    );
  }
  if (!seo.present || (seo.validationCount ?? 1) > 0) {
    addIssue(hardFailures, "seo_not_clean", "SEO package is missing or flagged.", {
      present: seo.present,
      validationCount: seo.validationCount,
      validationFlags: seo.validationFlags || [],
    });
  }
  if (!theme.matches) {
    addIssue(
      hardFailures,
      "theme_colour_mismatch",
      "Subtitle emphasis colour does not match the channel primary colour.",
      theme,
    );
  }

  if ((studio.amberMetrics || []).length) {
    addIssue(warnings, "studio_amber_metrics", "Studio rubric still has amber metrics.", {
      amberMetrics: studio.amberMetrics,
    });
  }
  if ((forensic.warnCount || 0) > 0) {
    addIssue(warnings, "forensic_warnings", "Forensic QA raised warnings.", {
      issues: forensic.issues || [],
    });
  }
  if ((studio.sourceDiversity || 0) < thresholds.sourceDiversity) {
    addIssue(
      warnings,
      "source_diversity_below_target",
      "Source diversity is below the premium target.",
      {
        value: studio.sourceDiversity,
        target: thresholds.sourceDiversity,
      },
    );
  }
  if ((studio.clipDominance || 0) < thresholds.clipDominance) {
    addIssue(warnings, "clip_dominance_below_target", "Clip dominance is soft.", {
      value: studio.clipDominance,
      target: thresholds.clipDominance,
    });
  }
  if ((studio.motionDensityPerMin || 0) < thresholds.motionDensityPerMin) {
    addIssue(
      warnings,
      "motion_density_below_target",
      "Motion density is below the premium target.",
      {
        value: studio.motionDensityPerMin,
        target: thresholds.motionDensityPerMin,
      },
    );
  }
  if ((studio.sfxEventCount || 0) > 1) {
    addIssue(warnings, "sfx_count_above_minimal", "More than one SFX cue is declared.", {
      sfxEventCount: studio.sfxEventCount,
    });
  }
  if ((studio.durationS || 0) > thresholds.legacyShortRuntimeS) {
    addIssue(
      warnings,
      "runtime_over_legacy_short_target",
      "Runtime is over the legacy 60s short target.",
      {
        durationS: studio.durationS,
        targetS: thresholds.legacyShortRuntimeS,
      },
    );
  }
  if (Number.isFinite(loudness.truePeakDb) && loudness.truePeakDb > thresholds.hotTruePeakDb) {
    addIssue(warnings, "true_peak_hot", "True peak is hot for a social short export.", {
      truePeakDb: loudness.truePeakDb,
      targetMaxDb: thresholds.hotTruePeakDb,
    });
  }
  if ((forensic.visualRepeatPairs || 0) > 2) {
    addIssue(
      warnings,
      "visual_repeat_pairs_present",
      "Visual hash sampling found repeated frame pairs.",
      { visualRepeatPairs: forensic.visualRepeatPairs },
    );
  }

  const warningPenalty = warnings.length * 4;
  const failurePenalty = hardFailures.length * 25;
  const score = clamp(Math.round(100 - warningPenalty - failurePenalty), 0, 100);
  return {
    key: summary.key,
    storyId: summary.storyId,
    channelId,
    variant: summary.variant,
    kind: summary.kind,
    verdict: hardFailures.length ? "fail" : warnings.length ? "warn" : "pass",
    score,
    hardFailures,
    warnings,
    theme,
    metrics: {
      studioLane: studio.lane || null,
      forensicVerdict: forensic.verdict || null,
      seoValidationCount: seo.validationCount ?? null,
      durationS: studio.durationS ?? null,
      sourceDiversity: studio.sourceDiversity ?? null,
      clipDominance: studio.clipDominance ?? null,
      motionDensityPerMin: studio.motionDensityPerMin ?? null,
      sfxEventCount: studio.sfxEventCount ?? null,
      integratedLufs: loudness.integratedLufs ?? null,
      truePeakDb: loudness.truePeakDb ?? null,
      visualRepeatPairs: forensic.visualRepeatPairs ?? null,
    },
    paths: summary.paths || {},
  };
}

function buildChannelReadinessReport({ gauntletReport, root = ROOT }) {
  const current = (gauntletReport.candidates || []).filter((candidate) =>
    ["canonical", "channel"].includes(candidate.kind),
  );
  const channels = current
    .map((candidate) => evaluateChannelCandidate(candidate, { root }))
    .sort((a, b) => b.score - a.score || a.channelId.localeCompare(b.channelId));
  const verdict = channels.some((c) => c.verdict === "fail")
    ? "fail"
    : channels.some((c) => c.verdict === "warn")
      ? "warn"
      : "pass";
  const warningCodes = {};
  for (const channel of channels) {
    for (const warning of channel.warnings) {
      warningCodes[warning.code] = (warningCodes[warning.code] || 0) + 1;
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceGauntletGeneratedAt: gauntletReport.generatedAt || null,
    summary: {
      verdict,
      channelCount: channels.length,
      passCount: channels.filter((c) => c.verdict === "pass").length,
      warnCount: channels.filter((c) => c.verdict === "warn").length,
      failCount: channels.filter((c) => c.verdict === "fail").length,
      bestChannel: channels[0]?.channelId || null,
      releaseReadyCount: channels.filter((c) => c.verdict === "pass").length,
      recurringWarningCodes: Object.entries(warningCodes)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code, count]) => ({ code, count })),
    },
    channels,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function badge(value) {
  const text = String(value || "unknown");
  const color =
    text === "pass"
      ? "#1a8f3c"
      : text === "fail"
        ? "#c8332b"
        : text === "warn"
          ? "#d29c1a"
          : "#555";
  return `<span class="badge" style="background:${color}">${escapeHtml(text).toUpperCase()}</span>`;
}

function buildChannelReadinessMarkdown(report) {
  const rows = report.channels.map((channel) =>
    [
      channel.channelId,
      channel.verdict,
      channel.score,
      channel.metrics.durationS ?? "",
      channel.metrics.sourceDiversity ?? "",
      channel.metrics.clipDominance ?? "",
      channel.metrics.motionDensityPerMin ?? "",
      channel.metrics.sfxEventCount ?? "",
      channel.metrics.integratedLufs ?? "",
      channel.metrics.truePeakDb ?? "",
      channel.metrics.seoValidationCount ?? "",
      channel.theme.matches ? "pass" : "fail",
      channel.hardFailures.map((issue) => issue.code).join(","),
      channel.warnings.map((issue) => issue.code).join(","),
    ].join(" | "),
  );
  return [
    "# Studio V2 Channel Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    `Source gauntlet: ${report.sourceGauntletGeneratedAt || "unknown"}`,
    `Verdict: ${report.summary.verdict}`,
    `Channels: ${report.summary.channelCount}`,
    `Release-ready channels: ${report.summary.releaseReadyCount}`,
    "",
    "## Channel Matrix",
    "",
    "channel | verdict | score | duration | diversity | clip dom | motion/min | sfx | LUFS | true peak | SEO flags | theme | blockers | warnings",
    "--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---",
    ...rows,
    "",
    "## Recurring Warnings",
    "",
    report.summary.recurringWarningCodes.length
      ? report.summary.recurringWarningCodes
          .map((entry) => `- ${entry.code}: ${entry.count}`)
          .join("\n")
      : "- None.",
    "",
  ].join("\n");
}

function buildChannelReadinessHtml(report) {
  const rows = report.channels
    .map((channel) => {
      const mp4Rel = channel.paths.mp4 || "";
      const warnings = channel.warnings.map((issue) => issue.code).join(", ");
      const blockers = channel.hardFailures.map((issue) => issue.code).join(", ");
      return `<tr>
        <td><b>${escapeHtml(channel.channelId)}</b><br><span>${escapeHtml(channel.key)}</span></td>
        <td>${badge(channel.verdict)}</td>
        <td class="score">${channel.score}</td>
        <td>${escapeHtml(String(channel.metrics.durationS ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics.sourceDiversity ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics.clipDominance ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics.motionDensityPerMin ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics.sfxEventCount ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics.integratedLufs ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics.truePeakDb ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics.seoValidationCount ?? ""))}</td>
        <td>${badge(channel.theme.matches ? "pass" : "fail")}</td>
        <td>${escapeHtml(blockers)}</td>
        <td>${escapeHtml(warnings)}</td>
        <td><a href="${escapeHtml(toPosix(path.relative(TEST_OUT, path.join(ROOT, mp4Rel))))}">mp4</a></td>
      </tr>`;
    })
    .join("\n");
  const recurring = report.summary.recurringWarningCodes.length
    ? report.summary.recurringWarningCodes
        .map((entry) => `<li>${escapeHtml(entry.code)}: ${entry.count}</li>`)
        .join("\n")
    : "<li>None.</li>";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Studio V2 Channel Readiness</title>
<style>
body{margin:0;background:#0d0d0f;color:#e8dcc8;font-family:Arial,system-ui,sans-serif;line-height:1.5}
.wrap{max-width:1480px;margin:0 auto;padding:34px 28px 80px}
h1{margin:0 0 8px;font-size:34px}h2{margin:34px 0 12px;border-left:4px solid #ff6b1a;padding-left:12px}
.meta{display:flex;gap:16px;flex-wrap:wrap;color:rgba(232,220,200,.68);font-size:13px}
.badge{display:inline-block;color:white;font-weight:800;font-size:10px;letter-spacing:.12em;padding:5px 8px;border-radius:3px}
table{width:100%;border-collapse:collapse;background:#16161a;font-size:13px}td,th{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;vertical-align:top}th{color:#ff6b1a;background:rgba(255,107,26,.08)}td span{color:rgba(232,220,200,.58);font-size:12px}.score{font-size:22px;font-weight:800;color:#ff6b1a}a{color:#ffb07a}
</style>
</head>
<body><div class="wrap">
<h1>Studio V2 Channel Readiness ${badge(report.summary.verdict)}</h1>
<div class="meta">
<span>Generated: ${escapeHtml(report.generatedAt)}</span>
<span>Channels: <b>${report.summary.channelCount}</b></span>
<span>Release-ready: <b>${report.summary.releaseReadyCount}</b></span>
<span>Best: <b>${escapeHtml(report.summary.bestChannel || "none")}</b></span>
</div>
<h2>Channel Matrix</h2>
<table>
<thead><tr><th>Channel</th><th>Verdict</th><th>Score</th><th>Dur</th><th>Diversity</th><th>Clip</th><th>Motion</th><th>SFX</th><th>LUFS</th><th>TP</th><th>SEO</th><th>Theme</th><th>Blockers</th><th>Warnings</th><th>Links</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<h2>Recurring Warnings</h2>
<ul>${recurring}</ul>
</div></body></html>`;
}

async function runChannelReadiness(options = {}) {
  const outputDir = options.outputDir || TEST_OUT;
  const root = options.root || ROOT;
  const gauntletPath =
    options.gauntletPath ||
    path.join(outputDir, "studio_v2_gauntlet_report.json");
  const gauntletReport = await fs.readJson(gauntletPath);
  const report = buildChannelReadinessReport({ gauntletReport, root });
  const jsonPath = path.join(outputDir, "studio_v2_channel_readiness_report.json");
  const mdPath = path.join(outputDir, "studio_v2_channel_readiness.md");
  const htmlPath = path.join(outputDir, "studio_v2_channel_readiness.html");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, buildChannelReadinessMarkdown(report));
  await fs.writeFile(htmlPath, buildChannelReadinessHtml(report));
  report.outputs = {
    json: rel(root, jsonPath),
    markdown: rel(root, mdPath),
    html: rel(root, htmlPath),
  };
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  return report;
}

module.exports = {
  ROOT,
  TEST_OUT,
  hexToAssBgr,
  extractAssEmphasisColour,
  evaluateThemeIntegrity,
  evaluateChannelCandidate,
  buildChannelReadinessReport,
  buildChannelReadinessMarkdown,
  buildChannelReadinessHtml,
  runChannelReadiness,
};
