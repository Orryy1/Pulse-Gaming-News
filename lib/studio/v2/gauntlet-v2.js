"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { spawnSync } = require("node:child_process");

const { runForensicQa } = require("./forensic-qa-v2");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_OUT = path.join(ROOT, "test", "output");

function toPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function rel(p) {
  return toPosix(path.relative(ROOT, p));
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function candidateKey(candidate) {
  return `${candidate.storyId}:${candidate.variant}`;
}

function parseReportFilename(name) {
  let match = name.match(/^qa_(.+)_studio_v2_([a-f0-9]{6,12})_report\.json$/i);
  if (match) {
    return {
      storyId: match[1],
      variant: `snapshot-${match[2]}`,
      commit: match[2],
      kind: "snapshot",
      mp4Name: `qa_studio_v2_${match[1]}_${match[2]}_snapshot.mp4`,
      assName: `qa_${match[1]}_studio_v2_${match[2]}.ass`,
    };
  }

  match = name.match(/^(.+)_studio_v2(.*?)_report\.json$/i);
  if (match) {
    const storyId = match[1];
    const suffix = match[2] || "";
    const channelMatch = suffix.match(/^__([A-Za-z0-9-]+)$/);
    const variant = channelMatch
      ? channelMatch[1]
      : suffix
        ? suffix.replace(/^_+/, "")
        : "canonical";
    return {
      storyId,
      variant,
      commit: null,
      kind: channelMatch
        ? "channel"
        : variant === "canonical"
          ? "canonical"
          : "variant",
      channelId: channelMatch
        ? channelMatch[1]
        : variant === "canonical"
          ? "pulse-gaming"
          : null,
      suffix,
      mp4Name: `studio_v2_${storyId}${suffix}.mp4`,
      assName: `${storyId}_studio_v2${suffix}.ass`,
      seoName: `${storyId}_studio_v2${suffix}_seo.json`,
    };
  }
  return null;
}

async function discoverGauntletCandidates(outputDir = TEST_OUT) {
  const files = await fs.readdir(outputDir);
  const candidates = [];
  const seen = new Set();
  for (const name of files) {
    if (!name.endsWith("_report.json")) continue;
    if (name.startsWith("qa_forensic_")) continue;
    const parsed = parseReportFilename(name);
    if (!parsed) continue;
    const reportPath = path.join(outputDir, name);
    const mp4Path = path.join(outputDir, parsed.mp4Name);
    const assPath = path.join(outputDir, parsed.assName);
    const seoPath = parsed.seoName ? path.join(outputDir, parsed.seoName) : null;
    if (!(await fs.pathExists(mp4Path))) continue;
    if (!(await fs.pathExists(assPath))) continue;
    const candidate = {
      ...parsed,
      reportPath,
      mp4Path,
      assPath,
      seoPath: seoPath && (await fs.pathExists(seoPath)) ? seoPath : null,
    };
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  for (const name of files) {
    const match = name.match(/^studio_v2_(.+)_loudnorm(\d+)\.mp4$/i);
    if (!match) continue;
    const storyId = match[1];
    const target = match[2];
    const reportPath = path.join(outputDir, `${storyId}_studio_v2_report.json`);
    const assPath = path.join(outputDir, `${storyId}_studio_v2.ass`);
    if (!(await fs.pathExists(reportPath))) continue;
    if (!(await fs.pathExists(assPath))) continue;
    const candidate = {
      storyId,
      variant: `loudnorm${target}`,
      commit: null,
      kind: "audio-master",
      targetLufs: -Number(target),
      channelId: "pulse-gaming",
      mp4Name: name,
      assName: path.basename(assPath),
      reportPath,
      mp4Path: path.join(outputDir, name),
      assPath,
      seoPath: path.join(outputDir, `${storyId}_studio_v2_seo.json`),
    };
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates.sort((a, b) => {
    const kindOrder = {
      canonical: 0,
      channel: 1,
      variant: 2,
      "audio-master": 3,
      snapshot: 4,
    };
    return (
      (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) ||
      a.storyId.localeCompare(b.storyId) ||
      a.variant.localeCompare(b.variant)
    );
  });
}

function parseLoudnormJson(text) {
  const match = String(text || "").match(/\{\s*"input_i"[\s\S]*?\}/m);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      integratedLufs: round(parsed.input_i, 1),
      truePeakDb: round(parsed.input_tp, 1),
      lraLu: round(parsed.input_lra, 1),
      thresholdLufs: round(parsed.input_thresh, 1),
      targetOffsetLu: round(parsed.target_offset, 1),
    };
  } catch {
    return null;
  }
}

function measureLoudness(mp4Path) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      mp4Path,
      "-af",
      "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
      "-f",
      "null",
      "-",
    ],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return parseLoudnormJson(`${result.stdout || ""}\n${result.stderr || ""}`);
}

function loadJsonSafe(file) {
  try {
    return fs.readJsonSync(file);
  } catch {
    return null;
  }
}

function summariseCandidate({ candidate, studioReport, forensicReport, loudness }) {
  const seo = candidate.seoPath ? loadJsonSafe(candidate.seoPath) : null;
  const seoValidation = Array.isArray(seo?.validation) ? seo.validation : null;
  const auto = studioReport?.auto || {};
  const verdict = studioReport?.verdict || {};
  const runtime = studioReport?.runtime || {};
  const forensic = forensicReport?.summary || {};
  const issueCodes = (forensicReport?.issues || []).map((issue) => issue.code);
  const grammarKinds = (studioReport?.grammarApplied || [])
    .map((entry) => entry.kind)
    .filter(Boolean);
  const premiumLane = studioReport?.premiumLane || {};
  const sceneTypes = (studioReport?.sceneList || [])
    .map((scene) => scene.type)
    .filter(Boolean);
  const redMetrics = Object.entries(auto)
    .filter(([, metric]) => metric?.grade === "red")
    .map(([name]) => name);
  const amberMetrics = Object.entries(auto)
    .filter(([, metric]) => metric?.grade === "amber")
    .map(([name]) => name);

  return {
    key: candidateKey(candidate),
    storyId: candidate.storyId,
    variant: candidate.variant,
    kind: candidate.kind,
    channelId: candidate.channelId || seo?.channelId || null,
    commit: candidate.commit,
    paths: {
      mp4: rel(candidate.mp4Path),
      studioReport: rel(candidate.reportPath),
      ass: rel(candidate.assPath),
      seo: candidate.seoPath ? rel(candidate.seoPath) : null,
      forensicReport: forensicReport?.outputs?.jsonPath || null,
      forensicHtml: forensicReport?.outputs?.htmlPath || null,
      forensicMarkdown: forensicReport?.outputs?.markdownPath || null,
      waveform: forensicReport?.audio?.waveformPath || null,
      frames: forensicReport?.visual?.frameDir || null,
    },
    studio: {
      lane: verdict.lane || "unknown",
      greenHits: verdict.greenHits ?? null,
      amberTrips: verdict.amberTrips ?? null,
      redTrips: verdict.redTrips ?? null,
      reasons: verdict.reasons || [],
      durationS: round(runtime.durationS, 3),
      sizeBytes: runtime.sizeBytes || null,
      sourceDiversity: auto.sourceDiversity?.value ?? null,
      clipDominance: auto.clipDominance?.value ?? null,
      sfxEventCount: auto.sfxEventCount?.value ?? null,
      durationIntegrity: auto.durationIntegrity?.grade || null,
      voicePath: auto.voicePathUsed?.value || null,
      motionDensityPerMin: auto.motionDensityPerMin?.value ?? null,
      beatAwarenessRatio: auto.beatAwarenessRatio?.value ?? null,
      grammarKinds,
      sceneTypes,
      hyperframesCardCount:
        premiumLane.hyperframesCardCount ??
        (premiumLane.decisions || []).filter((d) => d.renderer === "hyperframes")
          .length,
      redMetrics,
      amberMetrics,
    },
    forensic: {
      verdict: forensic.verdict || "unknown",
      issueCount: forensic.issueCount ?? null,
      failCount: forensic.failCount ?? null,
      warnCount: forensic.warnCount ?? null,
      issues: issueCodes,
      audioRecurrence: forensicReport?.audio?.verdict || "unknown",
      subtitleVerdict: forensicReport?.subtitles?.verdict || "unknown",
      visualVerdict: forensicReport?.visual?.verdict || "unknown",
      visualRepeatPairs: forensicReport?.visual?.repeatPairCount ?? null,
      subtitleOverrunS: forensicReport?.subtitles?.overrunS ?? null,
    },
    seo: {
      present: Boolean(seo),
      channelId: seo?.channelId || null,
      titleLength: seo?.title ? String(seo.title).length : null,
      hashtagCount: Array.isArray(seo?.hashtags) ? seo.hashtags.length : null,
      validationFlags: seoValidation,
      validationCount: seoValidation ? seoValidation.length : null,
      hasPinnedComment: Boolean(seo?.pinnedComment),
      hasThumbnailText: Boolean(seo?.thumbnailText),
    },
    loudness,
  };
}

function rankCandidate(summary) {
  let score = 100;
  if (summary.studio.lane === "reject") score -= 40;
  if (summary.studio.lane === "downgrade") score -= 20;
  score -= (summary.studio.redTrips || 0) * 10;
  score -= (summary.studio.amberTrips || 0) * 3;
  score -= (summary.forensic.failCount || 0) * 20;
  score -= (summary.forensic.warnCount || 0) * 6;
  if (summary.forensic.audioRecurrence !== "pass") score -= 15;
  if (summary.forensic.subtitleVerdict !== "pass") score -= 15;
  if (summary.forensic.visualVerdict !== "pass") score -= 8;
  const lufs = summary.loudness?.integratedLufs;
  if (Number.isFinite(lufs)) {
    if (lufs < -30) score -= 10;
    else if (lufs < -25) score -= 5;
    else if (lufs > -12) score -= 3;
  }
  const grammarKinds = summary.studio.grammarKinds || [];
  score += Math.min(4, new Set(grammarKinds).size);
  if (grammarKinds.includes("freeze-frame")) score += 3;
  if ((summary.studio.hyperframesCardCount || 0) >= 4) score += 2;
  if ((summary.studio.clipDominance || 0) >= 0.74) score += 1;
  if ((summary.studio.beatAwarenessRatio || 0) >= 0.8) score += 1;
  if (summary.seo?.present && summary.seo.validationCount === 0) score += 1;
  if ((summary.seo?.validationCount || 0) > 0) {
    score -= summary.seo.validationCount * 6;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildGauntletFindings(summaries) {
  const findings = [];
  const failing = summaries.filter(
    (s) =>
      s.studio.lane === "reject" ||
      s.forensic.verdict === "fail" ||
      (s.studio.redTrips || 0) > 0,
  );
  if (failing.length) {
    findings.push({
      severity: "fail",
      code: "failing_candidates",
      message: `${failing.length} rendered candidate(s) fail studio or forensic checks.`,
      candidates: failing.map((s) => s.key),
    });
  }

  const noisy = summaries.filter((s) => (s.studio.sfxEventCount || 0) > 2);
  if (noisy.length) {
    findings.push({
      severity: "warn",
      code: "repeated_sfx_history",
      message: `${noisy.length} candidate(s) still show repeated-SFX history.`,
      candidates: noisy.map((s) => `${s.key} (${s.studio.sfxEventCount})`),
    });
  }

  const short = summaries.filter(
    (s) =>
      s.studio.durationIntegrity === "red" ||
      (s.forensic.subtitleOverrunS || 0) > 0.1,
  );
  if (short.length) {
    findings.push({
      severity: "fail",
      code: "truncated_timeline_history",
      message: `${short.length} candidate(s) do not cover the narration/subtitle timeline.`,
      candidates: short.map((s) => s.key),
    });
  }

  const quiet = summaries.filter(
    (s) =>
      Number.isFinite(s.loudness?.integratedLufs) &&
      s.loudness.integratedLufs < -30,
  );
  if (quiet.length) {
    findings.push({
      severity: "warn",
      code: "quiet_mix_history",
      message: `${quiet.length} candidate(s) are very quiet (< -30 LUFS).`,
      candidates: quiet.map(
        (s) => `${s.key} (${s.loudness.integratedLufs} LUFS)`,
      ),
    });
  }

  const seoBad = summaries.filter(
    (s) =>
      ["canonical", "channel"].includes(s.kind) &&
      (!s.seo?.present || (s.seo.validationCount ?? 1) > 0),
  );
  if (seoBad.length) {
    findings.push({
      severity: "warn",
      code: "seo_package_issues",
      message: `${seoBad.length} primary/channel candidate(s) have missing or flagged SEO packages.`,
      candidates: seoBad.map((s) =>
        `${s.key} (${s.seo?.present ? `${s.seo.validationCount} flags` : "missing"})`,
      ),
    });
  }

  return findings;
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
    text === "pass" || text === "green"
      ? "#1a8f3c"
      : text === "fail" || text === "red" || text === "reject"
        ? "#c8332b"
        : text === "downgrade" || text === "warn" || text === "amber"
          ? "#d29c1a"
          : "#555";
  return `<span class="badge" style="background:${color}">${escapeHtml(text).toUpperCase()}</span>`;
}

function buildGauntletMarkdown(report) {
  const rows = report.candidates.map((s) =>
    [
      s.key,
      s.score,
      s.studio.lane,
      s.forensic.verdict,
      s.studio.durationS ?? "",
      s.studio.sfxEventCount ?? "",
      s.loudness?.integratedLufs ?? "",
      s.forensic.subtitleVerdict,
      s.forensic.visualVerdict,
      (s.studio.grammarKinds || []).join(","),
      s.studio.hyperframesCardCount ?? "",
      s.seo?.validationCount ?? "",
    ].join(" | "),
  );
  return [
    "# Studio V2 Gauntlet",
    "",
    `Generated: ${report.generatedAt}`,
    `Candidates: ${report.candidateCount}`,
    `Overall verdict: ${report.summary.verdict}`,
    `Best candidate: ${report.summary.bestCandidate || "none"}`,
    "",
    "## Findings",
    "",
    report.findings.length
      ? report.findings
          .map((f) => `- ${f.severity.toUpperCase()} ${f.code}: ${f.message}`)
          .join("\n")
      : "- No gauntlet-level findings.",
    "",
    "## Candidate Matrix",
    "",
    "candidate | score | studio | forensic | duration | sfx | LUFS | subtitles | visual | grammar | HF | SEO flags",
    "--- | ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | ---:",
    ...rows,
    "",
  ].join("\n");
}

function buildGauntletHtml(report) {
  const rows = report.candidates
    .map((s) => {
      const forensicLink = s.paths.forensicHtml
        ? `<a href="${escapeHtml(path.relative(TEST_OUT, path.join(ROOT, s.paths.forensicHtml)).replace(/\\/g, "/"))}">forensic</a>`
        : "";
      const mp4Rel = toPosix(path.relative(TEST_OUT, path.join(ROOT, s.paths.mp4)));
      return `<tr>
        <td><b>${escapeHtml(s.key)}</b><br><span>${escapeHtml(s.kind)}${s.channelId ? ` / ${escapeHtml(s.channelId)}` : ""}</span></td>
        <td class="score">${s.score}</td>
        <td>${badge(s.studio.lane)}</td>
        <td>${badge(s.forensic.verdict)}</td>
        <td>${escapeHtml(String(s.studio.durationS ?? ""))}</td>
        <td>${escapeHtml(String(s.studio.sfxEventCount ?? ""))}</td>
        <td>${escapeHtml(String(s.loudness?.integratedLufs ?? ""))}</td>
        <td>${badge(s.forensic.subtitleVerdict)}</td>
        <td>${badge(s.forensic.visualVerdict)}</td>
        <td>${escapeHtml((s.studio.grammarKinds || []).join(", "))}</td>
        <td>${escapeHtml(String(s.studio.hyperframesCardCount ?? ""))}</td>
        <td>${escapeHtml(String(s.seo?.validationCount ?? ""))}</td>
        <td><a href="${escapeHtml(mp4Rel)}">mp4</a> ${forensicLink}</td>
      </tr>`;
    })
    .join("\n");
  const findings = report.findings.length
    ? report.findings
        .map(
          (f) =>
            `<li><b>${escapeHtml(f.severity.toUpperCase())}: ${escapeHtml(f.code)}</b><br>${escapeHtml(f.message)}<br><span>${escapeHtml((f.candidates || []).join(", "))}</span></li>`,
        )
        .join("\n")
    : "<li>No gauntlet-level findings.</li>";
  const best = report.summary.bestCandidate
    ? report.candidates.find((c) => c.key === report.summary.bestCandidate)
    : null;
  const bestVideo = best
    ? `<video controls preload="metadata" src="${escapeHtml(toPosix(path.relative(TEST_OUT, path.join(ROOT, best.paths.mp4))))}"></video>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Studio V2 Gauntlet</title>
<style>
body{margin:0;background:#0d0d0f;color:#e8dcc8;font-family:Arial,system-ui,sans-serif;line-height:1.5}
.wrap{max-width:1380px;margin:0 auto;padding:34px 28px 80px}
h1{margin:0 0 8px;font-size:34px}h2{margin:34px 0 12px;border-left:4px solid #ff6b1a;padding-left:12px}
.meta{display:flex;gap:16px;flex-wrap:wrap;color:rgba(232,220,200,.68);font-size:13px}
.badge{display:inline-block;color:white;font-weight:800;font-size:10px;letter-spacing:.12em;padding:5px 8px;border-radius:3px}
table{width:100%;border-collapse:collapse;background:#16161a;font-size:13px}td,th{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;vertical-align:top}th{color:#ff6b1a;background:rgba(255,107,26,.08)}td span,li span{color:rgba(232,220,200,.58);font-size:12px}.score{font-size:22px;font-weight:800;color:#ff6b1a}a{color:#ffb07a}video{width:360px;max-width:100%;background:#000;border-radius:4px}
.hero{display:grid;grid-template-columns:380px 1fr;gap:24px;align-items:start;margin-top:20px}.panel{background:#16161a;padding:16px;border-radius:6px}
</style>
</head>
<body><div class="wrap">
<h1>Studio V2 Gauntlet ${badge(report.summary.verdict)}</h1>
<div class="meta">
<span>Generated: ${escapeHtml(report.generatedAt)}</span>
<span>Candidates: <b>${report.candidateCount}</b></span>
<span>Best: <b>${escapeHtml(report.summary.bestCandidate || "none")}</b></span>
</div>
<div class="hero">
<div>${bestVideo}</div>
<div class="panel">
<h2>Findings</h2>
<ul>${findings}</ul>
</div>
</div>
<h2>Candidate Matrix</h2>
<table>
<thead><tr><th>Candidate</th><th>Score</th><th>Studio</th><th>Forensic</th><th>Dur</th><th>SFX</th><th>LUFS</th><th>Subtitles</th><th>Visual</th><th>Grammar</th><th>HF</th><th>SEO</th><th>Links</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div></body></html>`;
}

async function runGauntlet(options = {}) {
  const outputDir = options.outputDir || TEST_OUT;
  const candidates = options.candidates || (await discoverGauntletCandidates(outputDir));
  const summaries = [];

  for (const candidate of candidates) {
    const qaStoryId =
      candidate.variant === "canonical"
        ? candidate.storyId
        : `${candidate.storyId}_${candidate.variant.replace(/[^a-z0-9]+/gi, "_")}`;
    const forensicReport = await runForensicQa({
      storyId: qaStoryId,
      mp4Path: candidate.mp4Path,
      reportPath: candidate.reportPath,
      assPath: candidate.assPath,
      outputDir,
    });
    const studioReport = loadJsonSafe(candidate.reportPath);
    const loudness = options.skipLoudness ? null : measureLoudness(candidate.mp4Path);
    const summary = summariseCandidate({
      candidate,
      studioReport,
      forensicReport,
      loudness,
    });
    summary.score = rankCandidate(summary);
    summaries.push(summary);
  }

  summaries.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const findings = buildGauntletFindings(summaries);
  const summary = {
    verdict: findings.some((f) => f.severity === "fail")
      ? "fail"
      : findings.length
        ? "warn"
        : "pass",
    bestCandidate: summaries[0]?.key || null,
    passCount: summaries.filter(
      (s) => s.studio.lane === "pass" && s.forensic.verdict === "pass",
    ).length,
    failCount: findings.filter((f) => f.severity === "fail").length,
    warnCount: findings.filter((f) => f.severity === "warn").length,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidateCount: summaries.length,
    summary,
    findings,
    candidates: summaries,
  };

  const jsonPath = path.join(outputDir, "studio_v2_gauntlet_report.json");
  const mdPath = path.join(outputDir, "studio_v2_gauntlet.md");
  const htmlPath = path.join(outputDir, "studio_v2_gauntlet.html");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, buildGauntletMarkdown(report));
  await fs.writeFile(htmlPath, buildGauntletHtml(report));
  report.outputs = {
    json: rel(jsonPath),
    markdown: rel(mdPath),
    html: rel(htmlPath),
  };
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  return report;
}

module.exports = {
  ROOT,
  TEST_OUT,
  parseReportFilename,
  discoverGauntletCandidates,
  parseLoudnormJson,
  measureLoudness,
  summariseCandidate,
  rankCandidate,
  buildGauntletFindings,
  buildGauntletMarkdown,
  buildGauntletHtml,
  runGauntlet,
};
