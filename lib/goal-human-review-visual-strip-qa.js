"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  classifyTrailerFrameTaste,
  prescanImage,
} = require("./visual-content-prescan");

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

function unique(values) {
  return [...new Set(asArray(values).map(clean).filter(Boolean))];
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function visualStripSafetyIsIntact(report = {}) {
  const safety = report.safety || {};
  return (
    report.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.approval_omitted_from_visual_strip === true
  );
}

function headlineReadabilityReasons(headline) {
  const words = clean(headline)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return ["thumbnail_headline_missing"];
  const longest = words.reduce((max, word) => Math.max(max, word.length), 0);
  if (words.length >= 7 || longest > 18) {
    return ["thumbnail_headline_mobile_readability_risk"];
  }
  return [];
}

async function analyseBorderRisk(filePath, { sharpLib = null } = {}) {
  let sharp = sharpLib;
  if (!sharp) sharp = require("sharp");

  const { data, info } = await sharp(filePath)
    .resize(120, 214, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width || 120;
  const height = info.height || 214;
  const channels = info.channels || 3;
  const margin = Math.max(3, Math.round(Math.min(width, height) * 0.055));
  let borderPixels = 0;
  let brightEdge = 0;
  let darkEdge = 0;
  let edgeTouch = 0;

  function lumAt(x, y) {
    const offset = (y * width + x) * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inBorder =
        x < margin ||
        x >= width - margin ||
        y < margin ||
        y >= height - margin;
      if (!inBorder) continue;
      borderPixels += 1;
      const lum = lumAt(x, y);
      if (lum > 205) brightEdge += 1;
      if (lum < 35) darkEdge += 1;

      const ix = Math.min(width - 1 - margin, Math.max(margin, x));
      const iy = Math.min(height - 1 - margin, Math.max(margin, y));
      if (Math.abs(lumAt(ix, iy) - lum) > 68) edgeTouch += 1;
    }
  }

  const edgeTouchRatio = borderPixels > 0 ? edgeTouch / borderPixels : 0;
  const brightEdgeRatio = borderPixels > 0 ? brightEdge / borderPixels : 0;
  const darkEdgeRatio = borderPixels > 0 ? darkEdge / borderPixels : 0;
  const score = Math.max(
    0,
    Math.min(1, edgeTouchRatio * 2.1 + brightEdgeRatio * 3 + darkEdgeRatio * 0.15),
  );

  return {
    margin_pixels: margin,
    edge_touch_ratio: Number(edgeTouchRatio.toFixed(4)),
    bright_edge_ratio: Number(brightEdgeRatio.toFixed(4)),
    dark_edge_ratio: Number(darkEdgeRatio.toFixed(4)),
    text_cutoff_risk_score: Number(score.toFixed(4)),
  };
}

async function analyseVisualStripFrame(filePath, frame = {}, _card = {}) {
  const prescan = await prescanImage(filePath);
  let border = null;
  let borderError = null;
  try {
    border = await analyseBorderRisk(filePath);
  } catch (err) {
    borderError = `border_scan:${clean(err?.message || err)}`;
  }
  const taste = prescan.trailer_frame_taste || classifyTrailerFrameTaste(prescan);
  return {
    width: prescan.width,
    height: prescan.height,
    prescan,
    border,
    border_error: borderError,
    visual_taste: taste,
    timestamp_seconds: Number(frame.timestamp_seconds || 0),
  };
}

function framePathExists(frame = {}) {
  const filePath = clean(frame.output_path);
  return filePath && frame.exists === true && fs.existsSync(filePath);
}

function evaluateFrameAnalysis(frame = {}, analysis = {}) {
  const reasons = [];
  const timestamp = Number(frame.timestamp_seconds || 0);
  const prescan = analysis.prescan || {};
  const border = analysis.border || {};
  const taste = analysis.visual_taste || prescan.trailer_frame_taste || classifyTrailerFrameTaste(prescan);
  const edgeDensity = numberOrZero(prescan.edge_density);
  const darkRatio = numberOrZero(prescan.dark_pixel_ratio);
  const saturation = numberOrZero(prescan.saturation_mean);
  const borderRisk = numberOrZero(border.text_cutoff_risk_score);
  const edgeTouch = numberOrZero(border.edge_touch_ratio);
  const brightEdge = numberOrZero(border.bright_edge_ratio);

  if (prescan.error) reasons.push(`frame_prescan_failed:${prescan.error}`);
  if (timestamp === 0 && edgeDensity <= 0.06 && (darkRatio >= 0.72 || saturation <= 0.08)) {
    reasons.push("weak_first_frame_low_detail_or_too_dark");
  }
  if (timestamp === 0 && taste.verdict === "fail") {
    reasons.push(`weak_first_frame_visual_taste:${taste.reason || "fail"}`);
  }
  if (borderRisk >= 0.55 || edgeTouch >= 0.22 || brightEdge >= 0.08) {
    reasons.push("possible_edge_text_cutoff");
  }
  if (taste.verdict === "fail" && asArray(taste.tags).some((tag) => /title|text|legal|rating|logo/.test(tag))) {
    reasons.push(`visual_slate_or_text_heavy_frame:${taste.reason || "taste_failed"}`);
  }

  return {
    timestamp_seconds: timestamp,
    output_path: frame.output_path || "",
    output_uri: frame.output_uri || fileUrl(frame.output_path),
    exists: true,
    verdict: reasons.length > 0 ? "AMBER" : "GREEN",
    risk_reasons: unique(reasons),
    metrics: {
      width: analysis.width ?? prescan.width ?? null,
      height: analysis.height ?? prescan.height ?? null,
      edge_density: prescan.edge_density ?? null,
      saturation_mean: prescan.saturation_mean ?? null,
      dark_pixel_ratio: prescan.dark_pixel_ratio ?? null,
      bright_pixel_ratio: prescan.bright_pixel_ratio ?? null,
      text_overlay_likelihood: prescan.text_overlay_likelihood ?? null,
      white_text_on_dark_likelihood: prescan.white_text_on_dark_likelihood ?? null,
      visual_taste: taste,
      border,
      border_error: analysis.border_error || null,
    },
  };
}

function repairRecommendationsForReasons(reasons = []) {
  const set = new Set();
  if (reasons.some((reason) => reason === "missing_visual_strip_frame")) {
    set.add("regenerate_human_review_visual_strip_frames");
  }
  if (reasons.some((reason) => reason === "weak_first_frame_low_detail_or_too_dark" || reason.startsWith("weak_first_frame_visual_taste"))) {
    set.add("rerender_with_stronger_first_frame");
  }
  if (reasons.some((reason) => reason === "possible_edge_text_cutoff")) {
    set.add("rerender_with_safe_text_margins");
  }
  if (reasons.some((reason) => reason === "thumbnail_headline_mobile_readability_risk")) {
    set.add("shorten_thumbnail_headline_for_mobile");
  }
  if (reasons.some((reason) => reason.startsWith("visual_slate_or_text_heavy_frame"))) {
    set.add("replace_static_slate_with_directed_motion_beat");
  }
  if (set.size > 0) set.add("open_full_video_before_any_approval");
  return [...set];
}

async function analyseCard(card = {}, { analyseFrame = analyseVisualStripFrame } = {}) {
  const frameRows = [];
  const riskReasons = [];
  const headlineReasons = headlineReadabilityReasons(card.thumbnail_headline);
  riskReasons.push(...headlineReasons);

  for (const frame of asArray(card.frame_targets)) {
    if (!framePathExists(frame)) {
      const row = {
        timestamp_seconds: Number(frame.timestamp_seconds || 0),
        output_path: frame.output_path || "",
        output_uri: frame.output_uri || fileUrl(frame.output_path),
        exists: false,
        verdict: "RED",
        risk_reasons: ["missing_visual_strip_frame"],
        metrics: {},
      };
      frameRows.push(row);
      riskReasons.push(...row.risk_reasons);
      continue;
    }

    let row;
    try {
      row = evaluateFrameAnalysis(frame, await analyseFrame(frame.output_path, frame, card));
    } catch (err) {
      row = {
        timestamp_seconds: Number(frame.timestamp_seconds || 0),
        output_path: frame.output_path || "",
        output_uri: frame.output_uri || fileUrl(frame.output_path),
        exists: true,
        verdict: "AMBER",
        risk_reasons: [`frame_analysis_failed:${clean(err?.message || err)}`],
        metrics: {},
      };
    }
    frameRows.push(row);
    riskReasons.push(...row.risk_reasons);
  }

  const dedupedReasons = unique(riskReasons);
  const hasRed = frameRows.some((frame) => frame.verdict === "RED");
  const verdict = hasRed ? "RED" : dedupedReasons.length > 0 ? "AMBER" : "GREEN";
  return {
    review_sequence: card.review_sequence || 0,
    story_id: clean(card.story_id),
    title: clean(card.title),
    thumbnail_headline: clean(card.thumbnail_headline),
    first_spoken_line: clean(card.first_spoken_line),
    visual_strip_status: clean(card.status),
    verdict,
    risk_reasons: dedupedReasons,
    frame_count: frameRows.length,
    warning_frame_count: frameRows.filter((frame) => frame.verdict === "AMBER").length,
    missing_frame_count: frameRows.filter((frame) => frame.exists !== true).length,
    frames: frameRows,
    repair_recommendations: repairRecommendationsForReasons(dedupedReasons),
  };
}

function summariseCards(cards = []) {
  const rows = asArray(cards);
  const frames = rows.flatMap((card) => asArray(card.frames));
  const frameWarningCount = frames.reduce(
    (sum, frame) => sum + asArray(frame.risk_reasons).length,
    0,
  );
  return {
    card_count: rows.length,
    frame_count: frames.length,
    analysed_frame_count: frames.filter((frame) => frame.exists === true).length,
    missing_frame_count: frames.filter((frame) => frame.exists !== true).length,
    green_card_count: rows.filter((card) => card.verdict === "GREEN").length,
    amber_card_count: rows.filter((card) => card.verdict === "AMBER").length,
    red_card_count: rows.filter((card) => card.verdict === "RED").length,
    risk_card_count: rows.filter((card) => asArray(card.risk_reasons).length > 0).length,
    blocked_card_count: rows.filter((card) => card.verdict === "RED").length,
    frame_warning_count: frameWarningCount,
  };
}

async function buildHumanReviewVisualStripQaReport({
  visualStripReport = {},
  generatedAt = new Date().toISOString(),
  analyseFrame = analyseVisualStripFrame,
} = {}) {
  const blockers = [];
  if (!visualStripSafetyIsIntact(visualStripReport)) {
    blockers.push("human_review_visual_strip_safety_contract_failed");
  }

  const cards = blockers.length > 0
    ? []
    : await Promise.all(asArray(visualStripReport.cards).map((card) => analyseCard(card, { analyseFrame })));
  const summary = summariseCards(cards);
  const verdict = blockers.length > 0 || summary.red_card_count > 0
    ? "RED"
    : summary.risk_card_count > 0
      ? "AMBER"
      : "GREEN";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "HUMAN_REVIEW_VISUAL_STRIP_QA",
    source_visual_strip_generated_at: visualStripReport.generated_at || null,
    verdict,
    safe_to_publish_boolean: false,
    summary,
    cards,
    blockers,
    repair_recommendations: unique(cards.flatMap((card) => card.repair_recommendations)),
    next_step: verdict === "RED"
      ? "repair_visual_strip_evidence_before_operator_decision"
      : verdict === "AMBER"
        ? "inspect_flagged_frames_then_watch_full_video_before_decision"
        : "watch_full_video_in_human_review_console_before_decision",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      approval_omitted_from_visual_strip_qa: true,
    },
  };
}

function renderFrameHtml(frame = {}) {
  const reasons = asArray(frame.risk_reasons)
    .map((reason) => `<span>${escapeHtml(reason)}</span>`)
    .join("");
  return `
    <figure class="${escapeHtml(String(frame.verdict || "").toLowerCase())}">
      <img loading="lazy" src="${escapeHtml(frame.output_uri || fileUrl(frame.output_path))}" alt="${escapeHtml(frame.timestamp_seconds)} second review frame">
      <figcaption><strong>${escapeHtml(frame.timestamp_seconds)}s</strong> ${escapeHtml(frame.verdict || "UNKNOWN")}</figcaption>
      <div class="reasons">${reasons}</div>
    </figure>`;
}

function renderCardHtml(card = {}) {
  const reasons = asArray(card.risk_reasons)
    .map((reason) => `<span>${escapeHtml(reason)}</span>`)
    .join("");
  const repairs = asArray(card.repair_recommendations)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const frames = asArray(card.frames).map(renderFrameHtml).join("\n");
  return `
    <article class="card ${escapeHtml(String(card.verdict || "").toLowerCase())}">
      <header>
        <div class="sequence">#${escapeHtml(card.review_sequence)}</div>
        <h2>${escapeHtml(card.title)}</h2>
        <div class="status">${escapeHtml(card.verdict)} ${reasons}</div>
      </header>
      <section class="frames">${frames}</section>
      <section class="copy">
        <p><strong>Opening:</strong> ${escapeHtml(card.first_spoken_line)}</p>
        <p><strong>Thumbnail:</strong> ${escapeHtml(card.thumbnail_headline)}</p>
      </section>
      <section class="repairs"><strong>Recommended operator action</strong><ul>${repairs}</ul></section>
    </article>`;
}

function renderHumanReviewVisualStripQaHtml(report = {}) {
  const cards = asArray(report.cards).map(renderCardHtml).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pulse Gaming Human Review Visual Strip QA</title>
  <style>
    body { margin: 0; background: #101010; color: #f5f5f5; font-family: Arial, sans-serif; }
    main { max-width: 1480px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .summary { color: #d6d6d6; margin-bottom: 16px; }
    .notice { background: #2b1908; border: 1px solid #ff7a1a; padding: 12px; margin: 16px 0; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 18px; }
    .card { background: #1d1d1d; border: 1px solid #3b3b3b; border-radius: 8px; padding: 16px; }
    .card.red { border-color: #d85b5b; }
    .card.amber { border-color: #ff9c42; }
    .card.green { border-color: #48b96a; }
    .sequence { color: #ff9c42; font-weight: 700; font-size: 13px; }
    h2 { font-size: 20px; margin: 4px 0 8px; }
    .status span, .reasons span { display: inline-block; margin: 2px 4px; padding: 2px 6px; background: #351b12; color: #ffc49a; border: 1px solid #70452a; border-radius: 999px; font-size: 12px; }
    .frames { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    figure { margin: 0; background: #080808; border: 1px solid #333; }
    figure.red { border-color: #d85b5b; }
    figure.amber { border-color: #ff9c42; }
    figure.green { border-color: #48b96a; }
    img { width: 100%; display: block; aspect-ratio: 9 / 16; object-fit: contain; background: #000; }
    figcaption { padding: 6px; color: #ddd; font-size: 12px; }
    .reasons { min-height: 28px; padding: 0 6px 6px; }
    .copy p { margin: 8px 0; }
    .repairs ul { margin-top: 8px; }
    @media (max-width: 760px) { .frames { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
<main>
  <h1>Visual strip QA</h1>
  <div class="summary">Generated ${escapeHtml(report.generated_at || "unknown")} | Verdict ${escapeHtml(report.verdict || "UNKNOWN")} | ${escapeHtml(report.summary?.risk_card_count || 0)} risky cards | ${escapeHtml(report.summary?.frame_warning_count || 0)} frame warnings</div>
  <div class="notice">This report cannot approve or publish. It flags first-frame, text-cutoff and mobile headline risks before a separate full-video human review.</div>
  <section class="grid">
    ${cards}
  </section>
</main>
</body>
</html>
`;
}

async function writeHumanReviewVisualStripQaReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeHumanReviewVisualStripQaReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "human_review_visual_strip_qa_report.json");
  const htmlPath = path.join(outDir, "human_review_visual_strip_qa_report.html");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(htmlPath, renderHumanReviewVisualStripQaHtml(report), "utf8");
  return { outputDir: outDir, jsonPath, htmlPath };
}

module.exports = {
  analyseBorderRisk,
  analyseCard,
  analyseVisualStripFrame,
  buildHumanReviewVisualStripQaReport,
  evaluateFrameAnalysis,
  renderHumanReviewVisualStripQaHtml,
  writeHumanReviewVisualStripQaReport,
  visualStripSafetyIsIntact,
};
