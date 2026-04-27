"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_OUT = path.join(ROOT, "test", "output");

function toPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function relativeToRoot(p) {
  return toPosix(path.relative(ROOT, p));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function median(values) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function assTimeToSeconds(value) {
  const parts = String(value || "").trim().split(":").map(Number.parseFloat);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function parseAssDialogues(assPath) {
  if (!assPath || !fs.existsSync(assPath)) return [];
  const txt = fs.readFileSync(assPath, "utf8");
  return txt
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Dialogue:"))
    .map((line) => {
      const match = line.match(/^Dialogue:\s*\d+,([^,]+),([^,]+),([^,]*),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$/);
      if (!match) return null;
      return {
        startS: assTimeToSeconds(match[1]),
        endS: assTimeToSeconds(match[2]),
        style: match[3],
        text: match[4].replace(/\\[Nn]/g, " "),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startS - b.startS);
}

function analyseSubtitleTimeline({ assPath, durationS }) {
  const dialogues = parseAssDialogues(assPath);
  const gaps = [];
  for (let i = 1; i < dialogues.length; i++) {
    const gapS = dialogues[i].startS - dialogues[i - 1].endS;
    if (gapS > 2) {
      gaps.push({
        fromS: round(dialogues[i - 1].endS, 2),
        toS: round(dialogues[i].startS, 2),
        gapS: round(gapS, 2),
      });
    }
  }
  const lastCueEndS = dialogues.reduce(
    (max, cue) => Math.max(max, cue.endS),
    0,
  );
  const overrunS = lastCueEndS - safeNumber(durationS, 0);
  return {
    cueCount: dialogues.length,
    firstCueStartS: dialogues[0] ? round(dialogues[0].startS, 2) : null,
    lastCueEndS: round(lastCueEndS, 2),
    overrunS: overrunS > 0.1 ? round(overrunS, 2) : 0,
    gapsOver2s: gaps,
    verdict: overrunS > 0.1 || gaps.length ? "warn" : "pass",
  };
}

function ffprobeJson(mp4Path) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      mp4Path,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

function extractAudioSamples(mp4Path, sampleRate = 16000) {
  const buffer = execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mp4Path,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  const count = Math.floor(buffer.byteLength / 4);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = buffer.readFloatLE(i * 4);
  }
  return { samples, sampleRate, durationS: count / sampleRate };
}

function makeAudioWindows(samples, sampleRate, windowMs = 100, hopMs = 50) {
  const windowSize = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const hopSize = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const windows = [];
  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    let sumSq = 0;
    let peak = 0;
    for (let i = start; i < start + windowSize; i++) {
      const abs = Math.abs(samples[i]);
      sumSq += samples[i] * samples[i];
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    windows.push({
      startS: start / sampleRate,
      endS: (start + windowSize) / sampleRate,
      rms,
      peak,
      crest: rms > 0 ? peak / rms : 0,
    });
  }
  return windows;
}

function audioSignature(samples, sampleRate, startS, durationS = 0.45, bins = 18) {
  const start = Math.max(0, Math.round(startS * sampleRate));
  const total = Math.max(1, Math.round(durationS * sampleRate));
  const binSize = Math.max(1, Math.floor(total / bins));
  const values = [];
  for (let b = 0; b < bins; b++) {
    const binStart = start + b * binSize;
    const binEnd = Math.min(samples.length, binStart + binSize);
    let sumSq = 0;
    let count = 0;
    for (let i = binStart; i < binEnd; i++) {
      sumSq += samples[i] * samples[i];
      count++;
    }
    values.push(count ? Math.sqrt(sumSq / count) : 0);
  }
  const max = Math.max(...values, 1e-8);
  return values.map((v) => v / max);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) return 0;
  return dot / Math.sqrt(aa * bb);
}

function pickTransientCandidates(windows, maxCandidates = 36) {
  const rmsValues = windows.map((w) => w.rms);
  const med = median(rmsValues);
  const deviations = rmsValues.map((v) => Math.abs(v - med));
  const mad = median(deviations) || 0.0001;
  const threshold = Math.max(med + mad * 7, med * 2.8, 0.012);
  const raw = windows
    .filter((w) => w.rms >= threshold && w.crest >= 2.4)
    .sort((a, b) => b.rms - a.rms);

  const selected = [];
  for (const candidate of raw) {
    if (selected.some((s) => Math.abs(s.startS - candidate.startS) < 0.35)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= maxCandidates) break;
  }
  return selected.sort((a, b) => a.startS - b.startS);
}

function findRecurringAudioClusters({
  samples,
  sampleRate,
  candidates,
  minSimilarity = 0.965,
}) {
  const items = candidates.map((c) => ({
    ...c,
    signature: audioSignature(samples, sampleRate, c.startS),
  }));
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const group = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(items[j].startS - items[i].startS) < 1.2) continue;
      const sim = cosineSimilarity(items[i].signature, items[j].signature);
      if (sim >= minSimilarity) {
        group.push({ ...items[j], similarityToFirst: sim });
        used.add(j);
      }
    }
    if (group.length >= 3) {
      clusters.push({
        count: group.length,
        timesS: group.map((g) => round(g.startS, 2)),
        peakRms: round(Math.max(...group.map((g) => g.rms)), 4),
        averageSimilarity: round(
          group
            .slice(1)
            .reduce((sum, g) => sum + (g.similarityToFirst || 1), 0) /
            Math.max(1, group.length - 1),
          3,
        ),
      });
    }
  }
  return clusters.sort((a, b) => b.count - a.count || b.peakRms - a.peakRms);
}

function findRecurringScheduledAudioClusters({
  samples,
  sampleRate,
  timesS = [],
  minSimilarity = 0.925,
}) {
  const items = timesS
    .filter((timeS) => Number.isFinite(Number(timeS)) && Number(timeS) >= 0)
    .map((timeS) => ({
      startS: Number(timeS),
      signature: audioSignature(samples, sampleRate, Math.max(0, Number(timeS))),
    }));
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const group = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(items[j].startS - items[i].startS) < 0.8) continue;
      const sim = cosineSimilarity(items[i].signature, items[j].signature);
      if (sim >= minSimilarity) {
        group.push({ ...items[j], similarityToFirst: sim });
        used.add(j);
      }
    }
    if (group.length >= 4) {
      clusters.push({
        count: group.length,
        timesS: group.map((g) => round(g.startS, 2)),
        averageSimilarity: round(
          group
            .slice(1)
            .reduce((sum, g) => sum + (g.similarityToFirst || 1), 0) /
            Math.max(1, group.length - 1),
          3,
        ),
      });
    }
  }
  return clusters.sort((a, b) => b.count - a.count);
}

function analyseAudioRecurrence({
  samples,
  sampleRate,
  declaredSfxCueCount = 0,
  scheduledTimesS = [],
}) {
  const windows = makeAudioWindows(samples, sampleRate);
  const candidates = pickTransientCandidates(windows);
  const clusters = findRecurringAudioClusters({ samples, sampleRate, candidates });
  const scheduledClusters = findRecurringScheduledAudioClusters({
    samples,
    sampleRate,
    timesS: scheduledTimesS,
  });
  const worstCluster = clusters[0] || null;
  const worstScheduledCluster = scheduledClusters[0] || null;
  const repeatedTransientCount = worstCluster ? worstCluster.count : 0;
  const scheduledRepeatCount = worstScheduledCluster
    ? worstScheduledCluster.count
    : 0;
  let verdict = "pass";
  const reasons = [];

  if (declaredSfxCueCount > 5) {
    verdict = "fail";
    reasons.push(`declared SFX cue count is ${declaredSfxCueCount}`);
  } else if (declaredSfxCueCount > 2) {
    verdict = "warn";
    reasons.push(`declared SFX cue count is ${declaredSfxCueCount}`);
  }

  if (repeatedTransientCount >= 5) {
    verdict = "fail";
    reasons.push(`detected ${repeatedTransientCount} matching transient hits`);
  } else if (repeatedTransientCount >= 3 && verdict !== "fail") {
    verdict = "warn";
    reasons.push(`detected ${repeatedTransientCount} matching transient hits`);
  }

  if (scheduledRepeatCount >= 8) {
    verdict = "fail";
    reasons.push(
      `detected ${scheduledRepeatCount} matching cut-synchronous audio signatures`,
    );
  } else if (scheduledRepeatCount >= 4 && verdict !== "fail") {
    verdict = "warn";
    reasons.push(
      `detected ${scheduledRepeatCount} matching cut-synchronous audio signatures`,
    );
  }

  return {
    verdict,
    declaredSfxCueCount,
    transientCandidateCount: candidates.length,
    repeatedTransientClusterCount: clusters.length,
    worstCluster,
    scheduledCutCount: scheduledTimesS.length,
    repeatedScheduledClusterCount: scheduledClusters.length,
    worstScheduledCluster,
    reasons,
    candidates: candidates.slice(0, 12).map((c) => ({
      startS: round(c.startS, 2),
      rms: round(c.rms, 4),
      peak: round(c.peak, 4),
      crest: round(c.crest, 2),
    })),
  };
}

async function generateWaveform({ mp4Path, outPath }) {
  await fs.ensureDir(path.dirname(outPath));
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mp4Path,
      "-filter_complex",
      "aformat=channel_layouts=mono,showwavespic=s=1600x260:colors=0xFF6B1A",
      "-frames:v",
      "1",
      outPath,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return outPath;
}

async function extractFrames({ mp4Path, frameDir, intervalS = 1.5 }) {
  await fs.ensureDir(frameDir);
  await fs.emptyDir(frameDir);
  const pattern = path.join(frameDir, "frame_%03d.jpg");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mp4Path,
      "-vf",
      `fps=1/${intervalS},scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2:0x0D0D0F`,
      "-q:v",
      "3",
      pattern,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return (await fs.readdir(frameDir))
    .filter((name) => /^frame_\d+\.jpg$/i.test(name))
    .sort()
    .map((name, idx) => ({
      path: path.join(frameDir, name),
      index: idx,
      timeS: round(idx * intervalS, 2),
    }));
}

async function frameHash(framePath) {
  const width = 9;
  const height = 8;
  const data = await sharp(framePath)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  let bits = "";
  let sum = 0;
  for (const value of data) sum += value;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width - 1; col++) {
      const left = data[row * width + col];
      const right = data[row * width + col + 1];
      bits += left > right ? "1" : "0";
    }
  }
  return {
    hash: bits,
    luminance: sum / data.length,
  };
}

function hammingDistance(a, b) {
  const len = Math.min(String(a).length, String(b).length);
  let dist = Math.abs(String(a).length - String(b).length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

async function analyseVisualRepetition({ frames, minGapS = 3, maxHamming = 6 }) {
  const hashed = [];
  for (const frame of frames) {
    const hash = await frameHash(frame.path);
    hashed.push({ ...frame, ...hash });
  }
  const repeatPairs = [];
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      if (hashed[j].timeS - hashed[i].timeS < minGapS) continue;
      const distance = hammingDistance(hashed[i].hash, hashed[j].hash);
      if (distance <= maxHamming) {
        repeatPairs.push({
          a: path.basename(hashed[i].path),
          b: path.basename(hashed[j].path),
          aTimeS: hashed[i].timeS,
          bTimeS: hashed[j].timeS,
          hamming: distance,
        });
      }
    }
  }
  const blackFrames = hashed
    .filter((f) => f.luminance < 8)
    .map((f) => ({ frame: path.basename(f.path), timeS: f.timeS }));
  let verdict = "pass";
  if (blackFrames.length || repeatPairs.length > 4) verdict = "warn";
  if (repeatPairs.length > 10) verdict = "fail";
  return {
    verdict,
    frameCount: hashed.length,
    sampledEveryS: frames.length > 1 ? round(frames[1].timeS - frames[0].timeS, 2) : null,
    repeatPairCount: repeatPairs.length,
    repeatPairs: repeatPairs.slice(0, 20),
    blackFrames,
    averageLuminance: round(
      hashed.reduce((sum, f) => sum + f.luminance, 0) /
        Math.max(1, hashed.length),
      2,
    ),
  };
}

function sceneBreakdown(report) {
  const scenes = report?.sceneList || [];
  const typeCounts = {};
  const sourceCounts = {};
  for (const scene of scenes) {
    const type = scene.type || "unknown";
    const source = scene.source || "unknown";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }
  const repeatedSources = Object.entries(sourceCounts)
    .filter(([, count]) => count > 1)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  return {
    sceneCount: scenes.length,
    typeCounts,
    uniqueSourceCount: Object.keys(sourceCounts).length,
    repeatedSources,
    declaredSourceDiversity: report?.auto?.sourceDiversity || null,
    declaredStillRepeat: report?.auto?.maxStillRepeat || null,
    declaredStockFiller: report?.auto?.stockFillerCount || null,
  };
}

function buildIssues({ runtime, subtitles, audio, visual, scene }) {
  const issues = [];
  if (runtime.durationDeltaS > 0.25) {
    issues.push({
      severity: "fail",
      code: "duration_mismatch",
      message: "Rendered MP4 duration does not match the report/audio duration.",
      evidence: runtime,
    });
  }
  if (subtitles.verdict !== "pass") {
    issues.push({
      severity: subtitles.overrunS ? "fail" : "warn",
      code: "subtitle_timeline",
      message: "Subtitle timeline has gaps or cues outside the render.",
      evidence: subtitles,
    });
  }
  if (audio.verdict !== "pass") {
    issues.push({
      severity: audio.verdict,
      code: "audio_recurrence",
      message: "Audio contains repeated transient patterns or too many declared SFX cues.",
      evidence: audio.reasons,
    });
  }
  if (visual.verdict !== "pass") {
    issues.push({
      severity: visual.verdict,
      code: "visual_repetition",
      message: "Frame sampling found possible repeated visuals or black frames.",
      evidence: {
        repeatPairCount: visual.repeatPairCount,
        blackFrames: visual.blackFrames,
      },
    });
  }
  const maxRepeatedSourceCount = Math.max(
    0,
    ...scene.repeatedSources.map((source) => source.count),
  );
  const sourceDiversityGrade = scene.declaredSourceDiversity?.grade || "unknown";
  if (
    maxRepeatedSourceCount >= 3 ||
    (scene.repeatedSources.length > 6 && sourceDiversityGrade !== "green")
  ) {
    issues.push({
      severity: "warn",
      code: "scene_source_reuse",
      message: "Scene report shows repeated source reuse.",
      evidence: scene.repeatedSources.slice(0, 8),
    });
  }
  return issues;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function badge(verdict) {
  const colors = {
    pass: "#1a8f3c",
    warn: "#d29c1a",
    fail: "#c8332b",
  };
  return `<span class="badge" style="background:${colors[verdict] || "#666"}">${htmlEscape(verdict).toUpperCase()}</span>`;
}

function buildHtmlReport(report) {
  const frameLinks = (report.visual?.sampleFrames || [])
    .slice(0, 12)
    .map(
      (frame) =>
        `<a href="${htmlEscape(frame.relPath)}"><img src="${htmlEscape(frame.relPath)}" alt="${htmlEscape(frame.name)}"></a>`,
    )
    .join("");
  const issues = report.issues.length
    ? report.issues
        .map(
          (issue) =>
            `<li><b>${htmlEscape(issue.severity.toUpperCase())}: ${htmlEscape(issue.code)}</b><br>${htmlEscape(issue.message)}</li>`,
        )
        .join("")
    : "<li>No automated hard defects found.</li>";
  const repeats = (report.visual.repeatPairs || [])
    .slice(0, 8)
    .map(
      (pair) =>
        `<tr><td>${htmlEscape(pair.a)} @ ${pair.aTimeS}s</td><td>${htmlEscape(pair.b)} @ ${pair.bTimeS}s</td><td>${pair.hamming}</td></tr>`,
    )
    .join("");
  const clusters = report.audio.worstCluster
    ? `<pre>${htmlEscape(JSON.stringify(report.audio.worstCluster, null, 2))}</pre>`
    : "<p>No repeated transient cluster above threshold.</p>";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Studio V2 Forensic QA - ${htmlEscape(report.storyId)}</title>
<style>
body{margin:0;background:#0d0d0f;color:#e8dcc8;font-family:Arial,system-ui,sans-serif;line-height:1.5}
.wrap{max-width:1200px;margin:0 auto;padding:34px 28px 80px}
h1{margin:0 0 8px;font-size:32px}h2{margin:34px 0 12px;border-left:4px solid #ff6b1a;padding-left:12px}
.meta{display:flex;gap:16px;flex-wrap:wrap;color:rgba(232,220,200,.65);font-size:13px}
.badge{display:inline-block;color:white;font-weight:800;font-size:11px;letter-spacing:.12em;padding:5px 9px;border-radius:3px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.stat{background:#16161a;padding:14px;border-left:3px solid #ff6b1a}.stat b{display:block;font-size:24px;margin-top:4px}
video{width:100%;max-height:72vh;background:#000}.wave{width:100%;background:#16161a;border-radius:4px}.frames{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.frames img{width:100%;border:1px solid rgba(255,255,255,.08)}
table{width:100%;border-collapse:collapse;background:#16161a}td,th{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.05);text-align:left}th{color:#ff6b1a}
pre{background:#16161a;padding:12px;overflow:auto}
</style>
</head>
<body><div class="wrap">
<h1>Studio V2 Forensic QA ${badge(report.summary.verdict)}</h1>
<div class="meta">
<span>Story: <b>${htmlEscape(report.storyId)}</b></span>
<span>Generated: ${htmlEscape(report.generatedAt)}</span>
<span>MP4: ${htmlEscape(report.inputs.mp4Path)}</span>
</div>
<div class="grid">
<div class="stat">Runtime <b>${report.runtime.mp4DurationS}s</b></div>
<div class="stat">SFX cues <b>${report.audio.declaredSfxCueCount}</b></div>
<div class="stat">Frames sampled <b>${report.visual.frameCount}</b></div>
<div class="stat">Issues <b>${report.issues.length}</b></div>
</div>
<h2>Render</h2>
<video controls preload="metadata" src="${htmlEscape(path.basename(report.inputs.mp4Path))}"></video>
<h2>Issues</h2><ul>${issues}</ul>
<h2>Waveform</h2>
<img class="wave" src="${htmlEscape(report.audio.waveformRelPath)}" alt="audio waveform">
<h2>Audio recurrence</h2>
${clusters}
<h2>Visual samples</h2>
<div class="frames">${frameLinks}</div>
<h2>Possible visual repeats</h2>
<table><thead><tr><th>A</th><th>B</th><th>Hamming</th></tr></thead><tbody>${repeats}</tbody></table>
<h2>Subtitle timeline</h2>
<pre>${htmlEscape(JSON.stringify(report.subtitles, null, 2))}</pre>
<h2>Scene breakdown</h2>
<pre>${htmlEscape(JSON.stringify(report.scene, null, 2))}</pre>
</div></body></html>`;
}

function buildMarkdownReport(report) {
  const lines = [
    `# Studio V2 Forensic QA - ${report.storyId}`,
    "",
    `Verdict: ${report.summary.verdict}`,
    `Generated: ${report.generatedAt}`,
    `MP4: ${report.inputs.mp4Path}`,
    "",
    "## Key Signals",
    "",
    `- Runtime: ${report.runtime.mp4DurationS}s`,
    `- Declared SFX cues: ${report.audio.declaredSfxCueCount}`,
    `- Audio recurrence verdict: ${report.audio.verdict}`,
    `- Subtitle verdict: ${report.subtitles.verdict}`,
    `- Visual repetition verdict: ${report.visual.verdict}`,
    `- Frame repeat pairs: ${report.visual.repeatPairCount}`,
    "",
    "## Issues",
    "",
  ];
  if (!report.issues.length) {
    lines.push("- No automated hard defects found.");
  } else {
    for (const issue of report.issues) {
      lines.push(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
    }
  }
  lines.push(
    "",
    "## Artefacts",
    "",
    `- JSON: ${report.outputs.jsonPath}`,
    `- HTML: ${report.outputs.htmlPath}`,
    `- Waveform: ${report.audio.waveformRelPath}`,
    `- Frame directory: ${report.visual.frameDir}`,
    "",
  );
  return lines.join("\n");
}

function summariseForComparison(report) {
  return {
    storyId: report.storyId,
    verdict: report.summary?.verdict || "unknown",
    issueCount: safeNumber(report.summary?.issueCount, 0),
    failCount: safeNumber(report.summary?.failCount, 0),
    warnCount: safeNumber(report.summary?.warnCount, 0),
    durationS: safeNumber(report.runtime?.mp4DurationS, 0),
    declaredSfxCueCount: safeNumber(report.audio?.declaredSfxCueCount, 0),
    audioRecurrence: report.audio?.verdict || "unknown",
    repeatedTransientClusterCount: safeNumber(
      report.audio?.repeatedTransientClusterCount,
      0,
    ),
    repeatedScheduledClusterCount: safeNumber(
      report.audio?.repeatedScheduledClusterCount,
      0,
    ),
    subtitleVerdict: report.subtitles?.verdict || "unknown",
    subtitleOverrunS: safeNumber(report.subtitles?.overrunS, 0),
    visualVerdict: report.visual?.verdict || "unknown",
    visualRepeatPairs: safeNumber(report.visual?.repeatPairCount, 0),
  };
}

function compareForensicReports(before, after) {
  const b = summariseForComparison(before);
  const a = summariseForComparison(after);
  const deltas = {
    issueCount: a.issueCount - b.issueCount,
    failCount: a.failCount - b.failCount,
    warnCount: a.warnCount - b.warnCount,
    durationS: round(a.durationS - b.durationS, 3),
    declaredSfxCueCount: a.declaredSfxCueCount - b.declaredSfxCueCount,
    repeatedTransientClusterCount:
      a.repeatedTransientClusterCount - b.repeatedTransientClusterCount,
    repeatedScheduledClusterCount:
      a.repeatedScheduledClusterCount - b.repeatedScheduledClusterCount,
    subtitleOverrunS: round(a.subtitleOverrunS - b.subtitleOverrunS, 3),
    visualRepeatPairs: a.visualRepeatPairs - b.visualRepeatPairs,
  };
  const materiallyImproved =
    deltas.failCount < 0 ||
    deltas.issueCount < 0 ||
    (b.audioRecurrence !== "pass" && a.audioRecurrence === "pass") ||
    (b.subtitleVerdict !== "pass" && a.subtitleVerdict === "pass");
  return {
    generatedAt: new Date().toISOString(),
    before: b,
    after: a,
    deltas,
    verdict: materiallyImproved ? "improved" : "no-material-improvement",
  };
}

function buildComparisonMarkdown(comparison) {
  const rows = [
    ["Verdict", comparison.before.verdict, comparison.after.verdict, ""],
    [
      "Issues",
      comparison.before.issueCount,
      comparison.after.issueCount,
      comparison.deltas.issueCount,
    ],
    [
      "Fails",
      comparison.before.failCount,
      comparison.after.failCount,
      comparison.deltas.failCount,
    ],
    [
      "Runtime",
      `${comparison.before.durationS}s`,
      `${comparison.after.durationS}s`,
      `${comparison.deltas.durationS}s`,
    ],
    [
      "SFX cues",
      comparison.before.declaredSfxCueCount,
      comparison.after.declaredSfxCueCount,
      comparison.deltas.declaredSfxCueCount,
    ],
    [
      "Audio recurrence",
      comparison.before.audioRecurrence,
      comparison.after.audioRecurrence,
      "",
    ],
    [
      "Cut-sync audio clusters",
      comparison.before.repeatedScheduledClusterCount,
      comparison.after.repeatedScheduledClusterCount,
      comparison.deltas.repeatedScheduledClusterCount,
    ],
    [
      "Subtitle verdict",
      comparison.before.subtitleVerdict,
      comparison.after.subtitleVerdict,
      "",
    ],
    [
      "Subtitle overrun",
      `${comparison.before.subtitleOverrunS}s`,
      `${comparison.after.subtitleOverrunS}s`,
      `${comparison.deltas.subtitleOverrunS}s`,
    ],
    [
      "Visual repeat pairs",
      comparison.before.visualRepeatPairs,
      comparison.after.visualRepeatPairs,
      comparison.deltas.visualRepeatPairs,
    ],
  ];
  return [
    "# Studio V2 Forensic QA Comparison",
    "",
    `Verdict: ${comparison.verdict}`,
    `Generated: ${comparison.generatedAt}`,
    "",
    "| Metric | Before | After | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...rows.map(
      ([metric, before, after, delta]) =>
        `| ${metric} | ${before} | ${after} | ${delta} |`,
    ),
    "",
  ].join("\n");
}

async function runForensicQa(options = {}) {
  const storyId = options.storyId || "1sn9xhe";
  const outputDir = options.outputDir || TEST_OUT;
  const mp4Path =
    options.mp4Path || path.join(outputDir, `studio_v2_${storyId}.mp4`);
  const reportPath =
    options.reportPath || path.join(outputDir, `${storyId}_studio_v2_report.json`);
  const assPath =
    options.assPath || path.join(outputDir, `${storyId}_studio_v2.ass`);
  if (!(await fs.pathExists(mp4Path))) {
    throw new Error(`MP4 not found: ${mp4Path}`);
  }
  if (!(await fs.pathExists(reportPath))) {
    throw new Error(`V2 report not found: ${reportPath}`);
  }

  const renderReport = await fs.readJson(reportPath);
  const probe = ffprobeJson(mp4Path);
  const mp4DurationS = safeNumber(probe.format?.duration, 0);
  const reportDurationS = safeNumber(renderReport.runtime?.durationS, 0);
  const runtime = {
    mp4DurationS: round(mp4DurationS, 3),
    reportDurationS: round(reportDurationS, 3),
    durationDeltaS: round(Math.abs(mp4DurationS - reportDurationS), 3),
    sizeBytes: safeNumber(probe.format?.size, 0),
    video: probe.streams?.find((s) => s.codec_type === "video") || null,
    audio: probe.streams?.find((s) => s.codec_type === "audio") || null,
  };

  const subtitles = analyseSubtitleTimeline({ assPath, durationS: mp4DurationS });
  const { samples, sampleRate } = extractAudioSamples(mp4Path);
  const audio = analyseAudioRecurrence({
    samples,
    sampleRate,
    declaredSfxCueCount: safeNumber(renderReport.auto?.sfxEventCount?.value, 0),
    scheduledTimesS: (renderReport.transitions || []).map((t) => Number(t.offset)),
  });

  const qaPrefix = `qa_forensic_${storyId}`;
  const waveformPath = path.join(outputDir, `${qaPrefix}_waveform.png`);
  await generateWaveform({ mp4Path, outPath: waveformPath });
  audio.waveformPath = relativeToRoot(waveformPath);
  audio.waveformRelPath = toPosix(path.relative(outputDir, waveformPath));

  const frameDir = path.join(outputDir, `${qaPrefix}_frames`);
  const frames = await extractFrames({ mp4Path, frameDir });
  const visual = await analyseVisualRepetition({ frames });
  visual.frameDir = relativeToRoot(frameDir);
  visual.sampleFrames = frames.slice(0, 24).map((frame) => ({
    name: path.basename(frame.path),
    timeS: frame.timeS,
    path: relativeToRoot(frame.path),
    relPath: toPosix(path.relative(outputDir, frame.path)),
  }));

  const scene = sceneBreakdown(renderReport);
  const issues = buildIssues({ runtime, subtitles, audio, visual, scene });
  const summary = {
    verdict: issues.some((i) => i.severity === "fail")
      ? "fail"
      : issues.length
        ? "warn"
        : "pass",
    issueCount: issues.length,
    failCount: issues.filter((i) => i.severity === "fail").length,
    warnCount: issues.filter((i) => i.severity === "warn").length,
  };

  const outJson = path.join(outputDir, `${qaPrefix}_report.json`);
  const outHtml = path.join(outputDir, `${qaPrefix}.html`);
  const outMd = path.join(outputDir, `${qaPrefix}.md`);
  const report = {
    schemaVersion: 1,
    storyId,
    generatedAt: new Date().toISOString(),
    inputs: {
      mp4Path: relativeToRoot(mp4Path),
      reportPath: relativeToRoot(reportPath),
      assPath: relativeToRoot(assPath),
    },
    outputs: {
      jsonPath: relativeToRoot(outJson),
      htmlPath: relativeToRoot(outHtml),
      markdownPath: relativeToRoot(outMd),
    },
    summary,
    runtime,
    subtitles,
    audio,
    visual,
    scene,
    issues,
  };

  await fs.writeJson(outJson, report, { spaces: 2 });
  await fs.writeFile(outHtml, buildHtmlReport(report));
  await fs.writeFile(outMd, buildMarkdownReport(report));
  return report;
}

module.exports = {
  TEST_OUT,
  assTimeToSeconds,
  parseAssDialogues,
  analyseSubtitleTimeline,
  makeAudioWindows,
  audioSignature,
  cosineSimilarity,
  pickTransientCandidates,
  findRecurringAudioClusters,
  findRecurringScheduledAudioClusters,
  analyseAudioRecurrence,
  hammingDistance,
  sceneBreakdown,
  buildIssues,
  buildHtmlReport,
  buildMarkdownReport,
  summariseForComparison,
  compareForensicReports,
  buildComparisonMarkdown,
  runForensicQa,
};
