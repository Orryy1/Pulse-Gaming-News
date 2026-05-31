"use strict";

const childProcess = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const FRAME_TIMESTAMPS_SECONDS = [0, 1, 2, 3];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fileUrl(filePath) {
  const value = clean(filePath);
  if (!value) return "";
  return pathToFileURL(path.resolve(value)).href;
}

function safePathSegment(value) {
  return clean(value)
    .replace(/[^a-z0-9_.-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "story";
}

function consoleSafetyIsIntact(consoleBundle = {}) {
  const safety = consoleBundle.safety || {};
  return (
    consoleBundle.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.approval_omitted_from_console === true
  );
}

function makeFrameTarget({ storyId, sequence, timestamp, stripDir }) {
  const fileName = `frame_${String(timestamp).padStart(2, "0")}s.jpg`;
  const outputPath = path.join(stripDir, safePathSegment(storyId || `card_${sequence}`), fileName);
  return {
    timestamp_seconds: timestamp,
    output_path: outputPath,
    output_uri: fileUrl(outputPath),
    exists: fs.existsSync(outputPath),
    status: fs.existsSync(outputPath) ? "already_exists" : "planned",
    error: null,
  };
}

function buildVisualStripCard(card = {}, { outputDir }) {
  const storyId = clean(card.story_id);
  const videoPath = clean(card.video_path || card.open_targets?.video_path?.path);
  const blockers = asArray(card.blockers).map(clean).filter(Boolean);
  if (!videoPath) blockers.push("video_path_missing");
  else if (!fs.existsSync(videoPath)) blockers.push("video_file_missing");

  const stripDir = path.join(path.resolve(outputDir), "human-review-visual-strips");
  const frameTargets = FRAME_TIMESTAMPS_SECONDS.map((timestamp) =>
    makeFrameTarget({
      storyId,
      sequence: card.review_sequence || 0,
      timestamp,
      stripDir,
    }),
  );
  const extractable = blockers.length === 0 && card.actionable !== false;

  return {
    review_sequence: card.review_sequence || 0,
    story_id: storyId,
    title: clean(card.title),
    review_status: clean(card.review_status),
    status: extractable ? "ready_for_frame_extraction" : "blocked",
    first_spoken_line: clean(card.first_spoken_line),
    thumbnail_headline: clean(card.thumbnail_headline),
    video_path: videoPath,
    video_uri: fileUrl(videoPath),
    frame_targets: frameTargets,
    frame_count: frameTargets.length,
    blockers,
    operator_focus: [
      "Is the subject clear in the first frame?",
      "Is any headline, source label or caption cut off?",
      "Do the first three seconds look better than the failed orange-card upload?",
      "Does the opening visual match the title, narration and thumbnail?",
    ],
  };
}

function summariseCards(cards = {}) {
  const rows = asArray(cards);
  const extractedFrameCount = rows
    .flatMap((card) => asArray(card.frame_targets))
    .filter((frame) => frame.exists === true).length;
  return {
    card_count: rows.length,
    extractable_card_count: rows.filter((card) => card.status === "ready_for_frame_extraction").length,
    extracted_card_count: rows.filter((card) => card.status === "frames_extracted").length,
    blocked_card_count: rows.filter((card) => card.status === "blocked").length,
    failed_card_count: rows.filter((card) => card.status === "frame_extraction_failed").length,
    frame_target_count: rows.reduce((sum, card) => sum + asArray(card.frame_targets).length, 0),
    extracted_frame_count: extractedFrameCount,
  };
}

function buildHumanReviewVisualStripPlan({
  consoleBundle = {},
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildHumanReviewVisualStripPlan requires outputDir");
  const blockers = [];
  const safetyOk = consoleSafetyIsIntact(consoleBundle);
  if (!safetyOk) blockers.push("human_review_console_safety_contract_failed");
  const cards = safetyOk
    ? asArray(consoleBundle.cards).map((card) => buildVisualStripCard(card, { outputDir }))
    : [];
  const summary = summariseCards(cards);
  const hardBlocked = blockers.length > 0;

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW_VISUAL_STRIP",
    source_console_generated_at: clean(consoleBundle.generated_at),
    verdict: hardBlocked ? "RED" : "AMBER",
    safe_to_publish_boolean: false,
    summary,
    cards,
    blockers,
    next_step: hardBlocked
      ? "repair_human_review_console_inputs"
      : summary.extractable_card_count > 0
        ? "extract_first_three_second_frames_then_watch_review_console"
        : "repair_missing_review_video_artefacts",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      approval_omitted_from_visual_strip: true,
    },
  };
}

function execFileAsync(execFileImpl, file, args, opts) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function buildFrameExtractionArgs({ videoPath, timestamp, outputPath }) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(timestamp),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=360:-2",
    outputPath,
  ];
}

async function extractHumanReviewVisualStrips(
  plan,
  {
    ffmpegPath = "ffmpeg",
    execFileImpl = childProcess.execFile,
    timeoutMs = 45000,
  } = {},
) {
  const report = {
    ...plan,
    generated_at: new Date().toISOString(),
    cards: asArray(plan.cards).map((card) => ({
      ...card,
      frame_targets: asArray(card.frame_targets).map((frame) => ({ ...frame })),
    })),
  };

  for (const card of report.cards) {
    if (card.status !== "ready_for_frame_extraction") continue;
    let failed = false;
    for (const frame of card.frame_targets) {
      await fs.ensureDir(path.dirname(frame.output_path));
      try {
        await execFileAsync(
          execFileImpl,
          ffmpegPath,
          buildFrameExtractionArgs({
            videoPath: card.video_path,
            timestamp: frame.timestamp_seconds,
            outputPath: frame.output_path,
          }),
          {
            cwd: process.cwd(),
            encoding: "utf8",
            timeout: timeoutMs,
            windowsHide: true,
          },
        );
        frame.exists = fs.existsSync(frame.output_path);
        frame.status = frame.exists ? "extracted" : "missing_after_extract";
      } catch (err) {
        failed = true;
        frame.exists = false;
        frame.status = "failed";
        frame.error = clean(err?.message || err);
      }
    }
    card.status = failed ? "frame_extraction_failed" : "frames_extracted";
    if (failed && !card.blockers.includes("frame_extraction_failed")) {
      card.blockers.push("frame_extraction_failed");
    }
  }

  report.summary = summariseCards(report.cards);
  if (report.summary.failed_card_count > 0) {
    report.verdict = "AMBER";
    report.next_step = "repair_or_watch_full_video_for_failed_visual_strip_cards";
  } else if (report.summary.extracted_card_count > 0) {
    report.verdict = "AMBER";
    report.next_step = "inspect_visual_strips_then_watch_full_console_cards";
  }
  return report;
}

function renderFrame(frame = {}) {
  const label = `${frame.timestamp_seconds}s`;
  return `
    <figure>
      <img loading="lazy" src="${escapeHtml(frame.output_uri)}" alt="${escapeHtml(label)} frame">
      <figcaption>${escapeHtml(label)} ${escapeHtml(frame.status || "")}</figcaption>
    </figure>`;
}

function renderHumanReviewVisualStripHtml(report = {}) {
  const cards = asArray(report.cards);
  const cardHtml = cards.map((card) => {
    const frames = asArray(card.frame_targets).map(renderFrame).join("\n");
    const blockers = asArray(card.blockers)
      .map((blocker) => `<span>${escapeHtml(blocker)}</span>`)
      .join("");
    const focus = asArray(card.operator_focus)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    return `
      <article class="card">
        <header>
          <div class="sequence">#${escapeHtml(card.review_sequence)}</div>
          <h2>${escapeHtml(card.title)}</h2>
          <div class="status">${escapeHtml(card.status)} ${blockers}</div>
        </header>
        <section class="frames">${frames}</section>
        <section class="copy">
          <p><strong>Opening:</strong> ${escapeHtml(card.first_spoken_line)}</p>
          <p><strong>Thumbnail:</strong> ${escapeHtml(card.thumbnail_headline)}</p>
          <p><strong>Video:</strong> <a href="${escapeHtml(card.video_uri)}">${escapeHtml(card.video_path)}</a></p>
        </section>
        <section class="focus"><strong>Look for</strong><ul>${focus}</ul></section>
      </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pulse Gaming Human Review Visual Strips</title>
  <style>
    body { margin: 0; background: #101010; color: #f4f4f4; font-family: Arial, sans-serif; }
    main { max-width: 1440px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .summary { color: #cfcfcf; margin-bottom: 18px; }
    .warning { background: #321704; border: 1px solid #ff7a1a; padding: 12px; margin: 16px 0; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 18px; }
    .card { background: #1d1d1d; border: 1px solid #393939; border-radius: 8px; padding: 16px; }
    .sequence { color: #ff8a2a; font-weight: 700; font-size: 13px; }
    h2 { font-size: 20px; margin: 4px 0 8px; }
    .status { color: #aaa; }
    .status span { display: inline-block; margin-left: 6px; padding: 2px 6px; background: #3a1a1a; color: #ffb0a0; border: 1px solid #673333; border-radius: 999px; font-size: 12px; }
    .frames { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    figure { margin: 0; background: #080808; border: 1px solid #333; }
    img { width: 100%; display: block; aspect-ratio: 9 / 16; object-fit: contain; background: #000; }
    figcaption { padding: 6px; color: #bbb; font-size: 12px; }
    .copy p { margin: 8px 0; }
    a { color: #ffb07a; }
    .focus ul { margin-top: 8px; }
    @media (max-width: 760px) { .frames { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
<main>
  <h1>First-three-second visual strips</h1>
  <div class="summary">Generated ${escapeHtml(report.generated_at || "unknown")} | Verdict ${escapeHtml(report.verdict || "UNKNOWN")} | ${escapeHtml(report.summary?.extracted_frame_count || 0)} extracted frames</div>
  <div class="warning">This page cannot approve or publish. It only helps review first-frame clarity, text cutoff and opening visual quality before separate operator decisions.</div>
  <section class="grid">
    ${cardHtml}
  </section>
</main>
</body>
</html>
`;
}

async function writeHumanReviewVisualStripReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeHumanReviewVisualStripReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "human_review_visual_strip_report.json");
  const htmlPath = path.join(outDir, "human_review_visual_strip_report.html");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(htmlPath, renderHumanReviewVisualStripHtml(report), "utf8");
  return { outputDir: outDir, jsonPath, htmlPath };
}

module.exports = {
  FRAME_TIMESTAMPS_SECONDS,
  buildFrameExtractionArgs,
  buildHumanReviewVisualStripPlan,
  extractHumanReviewVisualStrips,
  renderHumanReviewVisualStripHtml,
  writeHumanReviewVisualStripReport,
};
