"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_OUT = path.join(ROOT, "test", "output");

function toPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function rel(root, p) {
  return toPosix(path.relative(root, p));
}

function outputExists(outputDir, name) {
  const file = path.join(outputDir, name);
  return fs.existsSync(file) ? toPosix(path.relative(outputDir, file)) : null;
}

function recommendationForWarning(code) {
  const map = {
    motion_density_below_target:
      "Add one more meaningful motion grammar beat, not a decorative speed ramp.",
    studio_amber_metrics:
      "Inspect amber rubric metrics and decide whether the target or the edit should move.",
    clip_dominance_below_target:
      "Rebalance channel renders toward more trailer footage and fewer still/card seconds.",
    source_diversity_below_target:
      "Acquire or select additional distinct clip sources before adding more card polish.",
    forensic_warnings:
      "Open the forensic page and inspect the specific warning evidence before re-rendering.",
    true_peak_hot:
      "Add a per-channel final limiter or lower post-voice gain before AAC export.",
    visual_repeat_pairs_present:
      "Review the sampled frames and swap repeated-looking source moments.",
    runtime_over_legacy_short_target:
      "Give slower channel voices their own runtime budget or tighten the shared script.",
  };
  return map[code] || "Inspect this warning code and either fix it or document why it is acceptable.";
}

function buildQaDossier({ gauntletReport, readinessReport, outputDir = TEST_OUT }) {
  const historicalFailures = (gauntletReport.candidates || []).filter(
    (candidate) =>
      !["canonical", "channel"].includes(candidate.kind) &&
      (candidate.studio?.lane === "reject" ||
        candidate.forensic?.verdict === "fail" ||
        (candidate.studio?.redTrips || 0) > 0),
  );
  const channelRows = (readinessReport.channels || []).map((channel) => ({
    channelId: channel.channelId,
    verdict: channel.verdict,
    score: channel.score,
    blockerCodes: channel.hardFailures.map((issue) => issue.code),
    warningCodes: channel.warnings.map((issue) => issue.code),
    mp4: channel.paths?.mp4 || null,
    forensicHtml: channel.paths?.forensicHtml || null,
    seo: channel.paths?.seo || null,
    themeMatches: Boolean(channel.theme?.matches),
    metrics: channel.metrics,
  }));
  const recurringWarnings = readinessReport.summary?.recurringWarningCodes || [];
  const recommendations = recurringWarnings.map((entry) => ({
    code: entry.code,
    count: entry.count,
    recommendation: recommendationForWarning(entry.code),
  }));
  const artefacts = {
    gauntletJson: outputExists(outputDir, "studio_v2_gauntlet_report.json"),
    gauntletMarkdown: outputExists(outputDir, "studio_v2_gauntlet.md"),
    gauntletHtml: outputExists(outputDir, "studio_v2_gauntlet.html"),
    readinessJson: outputExists(outputDir, "studio_v2_channel_readiness_report.json"),
    readinessMarkdown: outputExists(outputDir, "studio_v2_channel_readiness.md"),
    readinessHtml: outputExists(outputDir, "studio_v2_channel_readiness.html"),
    multichannelMp4: outputExists(outputDir, "studio_v2_1sn9xhe_multichannel.mp4"),
    multichannelContact: outputExists(
      outputDir,
      "studio_v2_1sn9xhe_multichannel_contact.jpg",
    ),
    v1v2ComparisonMp4: outputExists(outputDir, "studio_v1_vs_v2_1sn9xhe.mp4"),
  };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      gauntletVerdict: gauntletReport.summary?.verdict || "unknown",
      currentChannelVerdict: readinessReport.summary?.verdict || "unknown",
      bestGauntletCandidate: gauntletReport.summary?.bestCandidate || null,
      bestCurrentChannel: readinessReport.summary?.bestChannel || null,
      currentChannelCount: readinessReport.summary?.channelCount || 0,
      currentReleaseReadyCount: readinessReport.summary?.releaseReadyCount || 0,
      historicalFailureCount: historicalFailures.length,
    },
    channelRows,
    historicalFailures: historicalFailures.map((candidate) => ({
      key: candidate.key,
      kind: candidate.kind,
      studioLane: candidate.studio?.lane || null,
      forensicVerdict: candidate.forensic?.verdict || null,
      redMetrics: candidate.studio?.redMetrics || [],
      issues: candidate.forensic?.issues || [],
      mp4: candidate.paths?.mp4 || null,
    })),
    recommendations,
    artefacts,
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

function buildQaDossierMarkdown(report) {
  const channelRows = report.channelRows.map((channel) =>
    [
      channel.channelId,
      channel.verdict,
      channel.score,
      channel.metrics?.durationS ?? "",
      channel.metrics?.sourceDiversity ?? "",
      channel.metrics?.clipDominance ?? "",
      channel.metrics?.motionDensityPerMin ?? "",
      channel.metrics?.integratedLufs ?? "",
      channel.metrics?.truePeakDb ?? "",
      channel.themeMatches ? "pass" : "fail",
      channel.blockerCodes.join(","),
      channel.warningCodes.join(","),
    ].join(" | "),
  );
  const historyRows = report.historicalFailures.map((candidate) =>
    [
      candidate.key,
      candidate.kind,
      candidate.studioLane,
      candidate.forensicVerdict,
      candidate.redMetrics.join(","),
      candidate.issues.join(","),
    ].join(" | "),
  );
  return [
    "# Studio V2 QA Dossier",
    "",
    `Generated: ${report.generatedAt}`,
    `Gauntlet verdict: ${report.summary.gauntletVerdict}`,
    `Current channel verdict: ${report.summary.currentChannelVerdict}`,
    `Best current channel: ${report.summary.bestCurrentChannel || "none"}`,
    `Release-ready channels: ${report.summary.currentReleaseReadyCount}/${report.summary.currentChannelCount}`,
    `Historical failures retained: ${report.summary.historicalFailureCount}`,
    "",
    "## Current Channels",
    "",
    "channel | verdict | score | duration | diversity | clip dom | motion/min | LUFS | true peak | theme | blockers | warnings",
    "--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---",
    ...channelRows,
    "",
    "## Fix Queue",
    "",
    report.recommendations.length
      ? report.recommendations
          .map(
            (entry) =>
              `- ${entry.code} (${entry.count}): ${entry.recommendation}`,
          )
          .join("\n")
      : "- No automated fix recommendations.",
    "",
    "## Historical Regression Evidence",
    "",
    report.historicalFailures.length
      ? [
          "candidate | kind | studio | forensic | red metrics | forensic issues",
          "--- | --- | --- | --- | --- | ---",
          ...historyRows,
        ].join("\n")
      : "- No historical failures in the gauntlet.",
    "",
    "## Artefacts",
    "",
    ...Object.entries(report.artefacts).map(
      ([key, value]) => `- ${key}: ${value || "missing"}`,
    ),
    "",
  ].join("\n");
}

function buildQaDossierHtml(report) {
  const channelRows = report.channelRows
    .map(
      (channel) => `<tr>
        <td><b>${escapeHtml(channel.channelId)}</b></td>
        <td>${badge(channel.verdict)}</td>
        <td class="score">${channel.score}</td>
        <td>${escapeHtml(String(channel.metrics?.durationS ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics?.sourceDiversity ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics?.clipDominance ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics?.motionDensityPerMin ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics?.integratedLufs ?? ""))}</td>
        <td>${escapeHtml(String(channel.metrics?.truePeakDb ?? ""))}</td>
        <td>${badge(channel.themeMatches ? "pass" : "fail")}</td>
        <td>${escapeHtml(channel.blockerCodes.join(", "))}</td>
        <td>${escapeHtml(channel.warningCodes.join(", "))}</td>
        <td><a href="${escapeHtml(toPosix(path.relative(TEST_OUT, path.join(ROOT, channel.mp4 || ""))))}">mp4</a></td>
      </tr>`,
    )
    .join("\n");
  const recommendations = report.recommendations.length
    ? report.recommendations
        .map(
          (entry) =>
            `<li><b>${escapeHtml(entry.code)} (${entry.count})</b><br>${escapeHtml(entry.recommendation)}</li>`,
        )
        .join("\n")
    : "<li>No automated fix recommendations.</li>";
  const history = report.historicalFailures.length
    ? report.historicalFailures
        .map(
          (candidate) =>
            `<li><b>${escapeHtml(candidate.key)}</b> ${badge(candidate.forensicVerdict || candidate.studioLane)}<br>${escapeHtml((candidate.issues || []).join(", "))}</li>`,
        )
        .join("\n")
    : "<li>No historical failures in the gauntlet.</li>";
  const artefacts = Object.entries(report.artefacts)
    .map(
      ([key, value]) =>
        `<li>${escapeHtml(key)}: ${
          value
            ? `<a href="${escapeHtml(value)}">${escapeHtml(value)}</a>`
            : "missing"
        }</li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Studio V2 QA Dossier</title>
<style>
body{margin:0;background:#0d0d0f;color:#e8dcc8;font-family:Arial,system-ui,sans-serif;line-height:1.5}
.wrap{max-width:1480px;margin:0 auto;padding:34px 28px 80px}
h1{margin:0 0 8px;font-size:34px}h2{margin:34px 0 12px;border-left:4px solid #ff6b1a;padding-left:12px}
.meta{display:flex;gap:16px;flex-wrap:wrap;color:rgba(232,220,200,.68);font-size:13px}
.badge{display:inline-block;color:white;font-weight:800;font-size:10px;letter-spacing:.12em;padding:5px 8px;border-radius:3px}
table{width:100%;border-collapse:collapse;background:#16161a;font-size:13px}td,th{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;vertical-align:top}th{color:#ff6b1a;background:rgba(255,107,26,.08)}.score{font-size:22px;font-weight:800;color:#ff6b1a}a{color:#ffb07a}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.panel{background:#16161a;padding:16px;border-radius:6px}
</style>
</head>
<body><div class="wrap">
<h1>Studio V2 QA Dossier ${badge(report.summary.currentChannelVerdict)}</h1>
<div class="meta">
<span>Generated: ${escapeHtml(report.generatedAt)}</span>
<span>Gauntlet: <b>${escapeHtml(report.summary.gauntletVerdict)}</b></span>
<span>Current channels: <b>${escapeHtml(report.summary.currentChannelVerdict)}</b></span>
<span>Ready: <b>${report.summary.currentReleaseReadyCount}/${report.summary.currentChannelCount}</b></span>
</div>
<h2>Current Channels</h2>
<table>
<thead><tr><th>Channel</th><th>Verdict</th><th>Score</th><th>Dur</th><th>Diversity</th><th>Clip</th><th>Motion</th><th>LUFS</th><th>TP</th><th>Theme</th><th>Blockers</th><th>Warnings</th><th>Links</th></tr></thead>
<tbody>${channelRows}</tbody>
</table>
<div class="grid">
<div class="panel"><h2>Fix Queue</h2><ul>${recommendations}</ul></div>
<div class="panel"><h2>Historical Regression Evidence</h2><ul>${history}</ul></div>
</div>
<h2>Artefacts</h2>
<ul>${artefacts}</ul>
</div></body></html>`;
}

async function runQaDossier(options = {}) {
  const outputDir = options.outputDir || TEST_OUT;
  const gauntletPath =
    options.gauntletPath ||
    path.join(outputDir, "studio_v2_gauntlet_report.json");
  const readinessPath =
    options.readinessPath ||
    path.join(outputDir, "studio_v2_channel_readiness_report.json");
  const gauntletReport = await fs.readJson(gauntletPath);
  const readinessReport = await fs.readJson(readinessPath);
  const report = buildQaDossier({ gauntletReport, readinessReport, outputDir });
  const jsonPath = path.join(outputDir, "studio_v2_qa_dossier_report.json");
  const mdPath = path.join(outputDir, "studio_v2_qa_dossier.md");
  const htmlPath = path.join(outputDir, "studio_v2_qa_dossier.html");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, buildQaDossierMarkdown(report));
  await fs.writeFile(htmlPath, buildQaDossierHtml(report));
  report.outputs = {
    json: rel(ROOT, jsonPath),
    markdown: rel(ROOT, mdPath),
    html: rel(ROOT, htmlPath),
  };
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  return report;
}

module.exports = {
  ROOT,
  TEST_OUT,
  recommendationForWarning,
  buildQaDossier,
  buildQaDossierMarkdown,
  buildQaDossierHtml,
  runQaDossier,
};
