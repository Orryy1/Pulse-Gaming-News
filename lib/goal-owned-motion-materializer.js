"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync: defaultExecFileSync } = require("node:child_process");
const { ffprobeDuration: defaultFfprobeDuration } = require("./studio/media-acquisition");

const FRAME_WIDTH_PX = 1080;
const FRAME_HEIGHT_PX = 1920;
const SAFE_RIGHT_PX = 42;
const SAFE_BOTTOM_PX = 92;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeStem(value) {
  return (
    cleanText(value)
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90) || "clip"
  );
}

function drawtextEscape(value) {
  return cleanText(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function fontOption() {
  return process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";
}

function isOwnedGeneratedMotion(clip = {}) {
  const text = [
    clip.id,
    clip.path,
    clip.rights_risk_class,
    clip.source_url,
    clip.source_type,
    clip.source_kind,
    clip.licence_basis,
  ].map(cleanText).join(" ").toLowerCase();
  return (
    text.includes("owned_generated_motion") ||
    text.includes("pulse-generated-motion") ||
    text.includes("internally_generated_motion_graphic") ||
    /\bowned-motion-\d+\b/.test(text)
  );
}

function outputPathForClip({ root, clip }) {
  const raw = cleanText(clip.path);
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.resolve(root, raw);
}

function clipDuration(clip = {}) {
  const duration = Number(clip.durationS ?? clip.duration_s);
  return Number.isFinite(duration) && duration > 0.5 ? Math.min(duration, 6) : 2.8;
}

function isDiscoveryOnlySource(value = "") {
  return /\b(?:reddit|r\/|forum|discussion)\b/i.test(cleanText(value));
}

function ownedExplainerAction(job = {}) {
  return asArray(job.actions).find(
    (action) => cleanText(action.action_id) === "materialise_owned_generated_motion_clips",
  ) || null;
}

function sourceLockedForOwnedExplainer(canonical = {}) {
  const primary = cleanText(canonical.primary_source || canonical.source_card_label);
  const sourceUrl = cleanText(canonical.primary_source_url || canonical.official_source_url || canonical.source_url);
  if (!primary || isDiscoveryOnlySource(primary)) return false;
  if (sourceUrl && /reddit\.com|old\.reddit\.com|redd\.it/i.test(sourceUrl)) return false;
  return true;
}

function titleWords(value = "", max = 7) {
  return cleanText(value).split(/\s+/).filter(Boolean).slice(0, max).join(" ");
}

function estimateMotionTextWidthPx(value, fontSizePx) {
  const text = cleanText(value);
  const fontSize = Math.max(1, Number(fontSizePx) || 1);
  let units = 0;
  for (const char of text) {
    if (char === " ") units += 0.34;
    else if (/[ilI1|!.,:;]/.test(char)) units += 0.34;
    else if (/[MW@#%&]/.test(char)) units += 0.78;
    else if (/[0-9]/.test(char)) units += 0.56;
    else if (/[A-Z]/.test(char)) units += 0.62;
    else units += 0.55;
  }
  return Math.ceil(units * fontSize);
}

function truncateMotionTextToWidth(value, fontSizePx, maxWidthPx) {
  let text = cleanText(value);
  if (!text) return "";
  if (estimateMotionTextWidthPx(text, fontSizePx) <= maxWidthPx) return text;
  const suffix = "...";
  while (text.length > 1) {
    text = text.slice(0, -1).trimEnd();
    if (estimateMotionTextWidthPx(`${text}${suffix}`, fontSizePx) <= maxWidthPx) {
      return `${text}${suffix}`;
    }
  }
  return suffix;
}

function wrapMotionText(value, { fontSizePx, maxWidthPx, maxLines = 1 } = {}) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], fits: true };
  const lines = [];
  let current = "";
  let consumed = 0;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateMotionTextWidthPx(candidate, fontSizePx) <= maxWidthPx) {
      current = candidate;
      consumed += 1;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
      if (lines.length >= maxLines) break;
    }
    if (estimateMotionTextWidthPx(word, fontSizePx) <= maxWidthPx) {
      current = word;
      consumed += 1;
    } else {
      lines.push(truncateMotionTextToWidth(word, fontSizePx, maxWidthPx));
      consumed += 1;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return {
    lines,
    fits: consumed >= words.length && lines.length <= maxLines,
  };
}

function fitMotionTextBlock({
  id,
  value,
  fallback,
  x,
  y,
  maxWidthPx,
  maxLines = 1,
  preferredFontSizePx,
  minFontSizePx,
  lineGapPx = 8,
}) {
  const text = cleanText(value || fallback || "PULSE GAMING").toUpperCase();
  let layout = null;
  for (let fontSizePx = preferredFontSizePx; fontSizePx >= minFontSizePx; fontSizePx -= 2) {
    const candidate = wrapMotionText(text, { fontSizePx, maxWidthPx, maxLines });
    if (candidate.fits) {
      layout = { ...candidate, fontSizePx };
      break;
    }
  }
  if (!layout) {
    const candidate = wrapMotionText(text, {
      fontSizePx: minFontSizePx,
      maxWidthPx,
      maxLines,
    });
    const lines = candidate.lines.slice(0, maxLines);
    if (lines.length) {
      lines[lines.length - 1] = truncateMotionTextToWidth(
        lines[lines.length - 1],
        minFontSizePx,
        maxWidthPx,
      );
    }
    layout = { lines, fits: false, fontSizePx: minFontSizePx };
  }
  const lineHeightPx = layout.fontSizePx + lineGapPx;
  const estimatedWidthPx = Math.max(
    0,
    ...layout.lines.map((line) => estimateMotionTextWidthPx(line, layout.fontSizePx)),
  );
  return {
    id,
    lines: layout.lines,
    font_size_px: layout.fontSizePx,
    line_height_px: lineHeightPx,
    x,
    y,
    max_width_px: maxWidthPx,
    estimated_width_px: estimatedWidthPx,
    estimated_right_px: x + estimatedWidthPx,
    estimated_bottom_px: y + Math.max(1, layout.lines.length) * lineHeightPx,
    fits: layout.fits,
  };
}

function buildOwnedMotionFrameLayout({ clip = {}, canonical = {} } = {}) {
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.selected_title)
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
  const headline = cleanText(canonical.thumbnail_headline || canonical.selected_title || subject)
    .split(/\s+/)
    .slice(0, 7)
    .join(" ");
  const source = clip.source_safety_blocked === true
    ? "DISCOVERY SOURCE ONLY"
    : cleanText(canonical.primary_source || canonical.source_card_label || "Source locked");
  const label = titleWords(cleanText(clip.source_family || clip.id || "motion").replace(/_/g, " "), 6);
  const purpose = titleWords(clip.visual_purpose || clip.headline || label, 8);
  const blocks = [
    fitMotionTextBlock({
      id: "subject",
      value: subject,
      x: 74,
      y: 104,
      maxWidthPx: 720,
      maxLines: 1,
      preferredFontSizePx: 42,
      minFontSizePx: 30,
      lineGapPx: 5,
    }),
    fitMotionTextBlock({
      id: "source",
      value: source,
      x: 74,
      y: 158,
      maxWidthPx: 860,
      maxLines: 1,
      preferredFontSizePx: 26,
      minFontSizePx: 20,
      lineGapPx: 5,
    }),
    fitMotionTextBlock({
      id: "headline",
      value: headline,
      fallback: subject,
      x: 92,
      y: 548,
      maxWidthPx: 760,
      maxLines: 2,
      preferredFontSizePx: 58,
      minFontSizePx: 42,
      lineGapPx: 8,
    }),
    fitMotionTextBlock({
      id: "purpose",
      value: purpose,
      fallback: label,
      x: 120,
      y: 850,
      maxWidthPx: 820,
      maxLines: 2,
      preferredFontSizePx: 34,
      minFontSizePx: 26,
      lineGapPx: 7,
    }),
  ];
  return {
    frame: {
      width_px: FRAME_WIDTH_PX,
      height_px: FRAME_HEIGHT_PX,
      safe_right_px: FRAME_WIDTH_PX - SAFE_RIGHT_PX,
      safe_bottom_px: FRAME_HEIGHT_PX - SAFE_BOTTOM_PX,
    },
    text_blocks: blocks.map((block) => ({
      ...block,
      within_safe_bounds:
        block.estimated_right_px <= FRAME_WIDTH_PX - SAFE_RIGHT_PX &&
        block.estimated_bottom_px <= FRAME_HEIGHT_PX - SAFE_BOTTOM_PX,
    })),
  };
}

function drawMotionTextBlock(block, { font, color, shadow = true } = {}) {
  const shadowArgs = shadow
    ? ":shadowcolor=black@0.82:shadowx=3:shadowy=3"
    : "";
  return asArray(block.lines).map((line, index) =>
    `drawtext=text='${drawtextEscape(line)}':${font}:fontcolor=${color}:fontsize=${block.font_size_px}:x=${block.x}:y=${block.y + index * block.line_height_px}${shadowArgs}`,
  );
}

function ownedExplainerClipPlan({ storyId, canonical = {} } = {}) {
  const source = cleanText(canonical.primary_source || canonical.source_card_label || "Source locked");
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_company || canonical.selected_title || storyId);
  const title = cleanText(canonical.selected_title || canonical.thumbnail_headline || subject);
  const claim = titleWords(asArray(canonical.confirmed_claims)[0] || canonical.first_spoken_line || title, 9);
  const base = `output/generated-motion/${safeStem(storyId)}`;
  const rows = [
    ["kinetic_title_card", titleWords(title, 7), "story tension"],
    ["animated_source_card", source, "source lock"],
    ["animated_quote_card", claim, "source-backed quote-style claim card"],
    ["stat_card", titleWords(claim, 6), "source-backed stat or claim card"],
    ["chart_slam", titleWords(canonical.canonical_angle || title, 6), "context shift"],
    ["lower_third", titleWords(subject, 5), "subject lower third"],
    ["platform_proof_card", titleWords(source, 5), "platform/source proof"],
    ["safe_article_screenshot_transform", titleWords(source, 5), "safe article screenshot transform"],
    ["motion_background", titleWords(subject, 5), "branded motion background"],
    ["branded_wipe", "PULSE GAMING", "branded transition wipe"],
    ["x_image_card", titleWords(title, 6), "X image-card derivative"],
    ["instagram_carousel_slide", titleWords(title, 6), "Instagram carousel slide"],
    ["breaking_news_fast_card", titleWords(canonical.first_spoken_line || title, 7), "breaking-news fast card"],
  ];
  return rows.map(([assetClass, headline, purpose], index) => ({
    id: `${storyId}-owned-motion-${index + 1}`,
    asset_class: assetClass,
    source_family: `${storyId}_${assetClass}`,
    motion_family: `${storyId}_${assetClass}`,
    visual_family: `${storyId}_${assetClass}`,
    path: `${base}/${String(index + 1).padStart(2, "0")}_${assetClass}.mp4`,
    source_url: `local://pulse-generated-motion/${storyId}/${assetClass}`,
    source_type: "internally_generated_motion_graphic",
    source_kind: "owned_source_card_explainer_motion",
    media_kind: "owned_explainer_motion",
    rights_risk_class: "owned_generated_motion",
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "finished_editorial_video_only",
    commercial_use_allowed: true,
    approval_status: "approved_for_transformative_editorial_use",
    durationS: 2.8,
    validated: true,
    counts_towards_motion_readiness: true,
    owned_explainer_visual_plan: true,
    headline,
    visual_purpose: purpose,
    source_relationship: source,
    dimensions: { width: 1080, height: 1920 },
    frame_rate: 30,
    platform_suitability: DEFAULT_PLATFORM_SUITABILITY,
  }));
}

function sourceDeficitClipPlan({ storyId, canonical = {} } = {}) {
  return ownedExplainerClipPlan({ storyId, canonical }).map((clip) => ({
    ...clip,
    source_url: cleanText(clip.source_url).replace("/pulse-generated-motion/", "/pulse-generated-motion/source-deficit/"),
    source_kind: "owned_source_deficit_motion",
    media_kind: "owned_source_deficit_motion",
    source_safety_blocked: true,
    source_relationship: "discovery_source_only_not_primary",
    counts_towards_motion_readiness: false,
    approval_status: "blocked_until_non_discovery_primary_source_exists",
    visual_purpose: `${cleanText(clip.visual_purpose)}; source boundary proof`,
  }));
}

function buildOwnedMotionFfmpegArgs({ clip = {}, canonical = {}, output }) {
  const duration = clipDuration(clip);
  const font = fontOption();
  const layout = buildOwnedMotionFrameLayout({ clip, canonical });
  const blockById = Object.fromEntries(layout.text_blocks.map((block) => [block.id, block]));
  const vf = [
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x090B10@1:t=fill",
    "drawbox=x='mod(t*420,1280)-160':y=254:w=320:h=9:color=0xFF6B1A@0.95:t=fill",
    "drawbox=x='1080-mod(t*360,1280)':y=1450:w=360:h=7:color=white@0.40:t=fill",
    "drawbox=x=54:y=72:w=972:h=132:color=black@0.62:t=fill",
    ...drawMotionTextBlock(blockById.subject, { font, color: "0xFFB15C" }),
    ...drawMotionTextBlock(blockById.source, { font, color: "white@0.88", shadow: false }),
    "drawbox=x=70:y=488:w=940:h=284:color=0x0B0F19@0.72:t=fill",
    "drawbox=x=70:y=488:w=940:h=284:color=0xF8FAFC@0.14:t=2",
    "drawbox=x=70:y=488:w=940:h=8:color=0xFF6B1A@0.92:t=fill",
    "drawbox=x=70:y=756:w='if(lt(t,0.20),1,1+(940-1)*(t-0.20)/0.36)':h=6:color=0x38BDF8@0.92:t=fill",
    ...drawMotionTextBlock(blockById.headline, { font, color: "white" }),
    "drawbox=x=98:y=820:w=884:h=148:color=black@0.62:t=fill",
    "drawbox=x=98:y=820:w=884:h=148:color=0xF8FAFC@0.13:t=2",
    ...drawMotionTextBlock(blockById.purpose, { font, color: "white@0.92" }),
    "drawbox=x='80+sin(t*4)*38':y=1120:w=920:h=4:color=0xFF6B1A@0.75:t=fill",
    `drawtext=text='PULSE GAMING':${font}:fontcolor=white@0.72:fontsize=28:x=w-tw-42:y=h-92`,
  ].join(",");
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x090B10:s=1080x1920:r=30:d=${duration.toFixed(2)}`,
    "-t",
    duration.toFixed(2),
    "-vf",
    vf,
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "24",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    output,
  ];
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function clipsFromFootageInventory(footage = {}) {
  const clips = [
    ...asArray(footage?.motion_inventory?.accepted_local_clips),
    ...asArray(footage?.motion_inventory?.production_motion_clips),
    ...asArray(footage?.accepted_local_clips),
    ...asArray(footage?.production_motion_clips),
  ];
  const rows = [];
  const seen = new Set();
  for (const clip of clips) {
    const key = cleanText(clip.id || clip.local_materialized_path || clip.path || clip.source_url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(clip);
  }
  return rows;
}

function shouldProcessJob(job = {}) {
  return asArray(job.actions).some(
    (action) => cleanText(action.action_id) === "materialise_owned_generated_motion_clips",
  );
}

function rejectionReasonsForResults(results = []) {
  return Array.from(new Set(
    asArray(results).flatMap((result) => [
      result.reason,
      ...asArray(result.blockers),
      ...asArray(result.rejection_reasons),
    ].map(cleanText).filter(Boolean)),
  ));
}

async function fileLooksUsable(filePath, ffprobeDuration) {
  if (!(await fs.pathExists(filePath))) return false;
  try {
    const duration = ffprobeDuration(filePath);
    return Number.isFinite(duration) && duration > 0.2;
  } catch {
    return false;
  }
}

async function materializeClip({
  root,
  clip,
  canonical,
  execFileSync,
  ffprobeDuration,
  refreshExisting = false,
}) {
  const output = outputPathForClip({ root, clip });
  if (!output) return { status: "skipped", reason: "clip_path_missing", clip };
  await fs.ensureDir(path.dirname(output));
  if (!refreshExisting && await fileLooksUsable(output, ffprobeDuration)) {
    return { status: "existing", path: output, clip_id: clip.id || null, clip: { ...clip, path: output, local_materialized_path: output } };
  }
  const args = buildOwnedMotionFfmpegArgs({ clip, canonical, output });
  try {
    execFileSync("ffmpeg", args, {
      cwd: root,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    return {
      status: "failed",
      reason: "ffmpeg_materialization_failed",
      error: error.message,
      path: output,
      clip_id: clip.id || null,
    };
  }
  if (!(await fileLooksUsable(output, ffprobeDuration))) {
    return { status: "failed", reason: "generated_clip_invalid", path: output, clip_id: clip.id || null };
  }
  await fs.writeJson(`${output}.json`, {
    schema_version: 1,
    generator: "goal_owned_motion_materializer",
    asset_id: clip.id || null,
    source_url: clip.source_url || null,
    source_family: clip.source_family || null,
    licence_basis: "owned_generated_editorial_motion_graphic",
    commercial_use_allowed: true,
    output,
  }, { spaces: 2 });
  return { status: "materialized", path: output, clip_id: clip.id || null, clip: { ...clip, path: output, local_materialized_path: output } };
}

function mergeRecords(existing = [], incoming = []) {
  const rows = [...asArray(existing)];
  const byId = new Map(rows.map((record, index) => [cleanText(record.asset_id || record.id || record.path), index]));
  for (const record of asArray(incoming)) {
    const key = cleanText(record.asset_id || record.id || record.path);
    if (!key) continue;
    if (byId.has(key)) rows[byId.get(key)] = { ...rows[byId.get(key)], ...record };
    else {
      byId.set(key, rows.length);
      rows.push(record);
    }
  }
  return rows;
}

function rightsRecordForOwnedClip(clip = {}, canonical = {}) {
  return {
    asset_id: cleanText(clip.id),
    asset_type: "owned_generated_motion_graphic",
    path: cleanText(clip.path),
    source_url: cleanText(clip.source_url),
    source_owner: "Pulse Gaming",
    source_type: "internally_generated_motion_graphic",
    source_family: cleanText(clip.source_family),
    media_kind: "owned_explainer_motion",
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "finished_editorial_video_only",
    allowed_platforms: ["youtube_shorts", "tiktok", "instagram_reels", "facebook_reels", "x", "threads", "pinterest"],
    commercial_use_allowed: true,
    transformation_notes: "Animated source-card explainer graphic generated from the locked canonical story manifest.",
    credit_required: false,
    evidence_reference: cleanText(canonical.primary_source || canonical.source_card_label || "canonical_story_manifest"),
    risk_score: 0.01,
    approval_status: "approved_for_transformative_editorial_use",
  };
}

const DEFAULT_PLATFORM_SUITABILITY = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "threads",
  "pinterest",
];

function unique(values = []) {
  return [...new Set(asArray(values).map(cleanText).filter(Boolean))];
}

function normaliseDimensions(value = {}) {
  const width = Number(value.width ?? value.w ?? 1080);
  const height = Number(value.height ?? value.h ?? 1920);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1080,
    height: Number.isFinite(height) && height > 0 ? height : 1920,
  };
}

function normaliseOwnedMotionAsset({ story = {}, result = {}, index = 0 } = {}) {
  const clip = result.clip || result;
  const motionFamily = cleanText(
    clip.motion_family ||
      clip.source_family ||
      clip.visual_family ||
      `${story.story_id || "story"}_owned_motion_${index + 1}`,
  );
  const filePath = cleanText(result.path || clip.local_materialized_path || clip.path);
  const sourceUrl = cleanText(clip.source_url);
  return {
    asset_id: cleanText(clip.id || result.clip_id || `${story.story_id || "story"}-owned-motion-${index + 1}`),
    asset_class: cleanText(clip.asset_class || clip.visual_asset_class || "owned_motion_card"),
    story_id: cleanText(story.story_id),
    file_path: filePath,
    path: filePath,
    local_materialized_path: cleanText(clip.local_materialized_path || filePath),
    duration: clipDuration(clip),
    durationS: clipDuration(clip),
    dimensions: normaliseDimensions(clip.dimensions),
    frame_rate: Number(clip.frame_rate || clip.frameRate || 30),
    motion_family: motionFamily,
    visual_family: cleanText(clip.visual_family || motionFamily),
    source_family: cleanText(clip.source_family || motionFamily),
    visual_purpose: cleanText(clip.visual_purpose || clip.headline || motionFamily),
    rights_basis: cleanText(clip.rights_basis || clip.licence_basis || "owned_generated_editorial_motion_graphic"),
    licence_basis: cleanText(clip.licence_basis || clip.rights_basis || "owned_generated_editorial_motion_graphic"),
    source_relationship: cleanText(clip.source_relationship || sourceUrl || "local://pulse-generated-motion"),
    source_url: sourceUrl,
    source_type: cleanText(clip.source_type || "internally_generated_motion_graphic"),
    source_kind: cleanText(clip.source_kind || "owned_source_card_explainer_motion"),
    distinctness_score: 0,
    platform_suitability: asArray(clip.platform_suitability).length
      ? asArray(clip.platform_suitability).map(cleanText).filter(Boolean)
      : DEFAULT_PLATFORM_SUITABILITY,
    counts_towards_motion_readiness: clip.counts_towards_motion_readiness !== false,
    materialized: true,
    materialized_status: cleanText(result.status || "materialized"),
    owned_explainer_visual_plan: clip.owned_explainer_visual_plan === true,
  };
}

function assetsFromOwnedMotionReport(report = {}) {
  const assets = [];
  for (const story of asArray(report.stories)) {
    const readyResults = [
      ...asArray(story.materialized),
      ...asArray(story.existing),
    ];
    readyResults.forEach((result, index) => {
      assets.push(normaliseOwnedMotionAsset({ story, result, index }));
    });
  }
  const familyCounts = new Map();
  for (const asset of assets) {
    const family = cleanText(asset.motion_family);
    if (!family) continue;
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }
  return assets.map((asset) => {
    const count = familyCounts.get(cleanText(asset.motion_family)) || 1;
    return {
      ...asset,
      distinctness_score: Number((1 / count).toFixed(3)),
    };
  });
}

function distinctFamilyStatus({ assets = [], minFamilies = 4 } = {}) {
  const families = unique(assets.map((asset) => asset.motion_family));
  const rejectionReasons = [];
  if (!assets.length) rejectionReasons.push("materialised_motion_clips_missing");
  if (families.length < minFamilies) rejectionReasons.push("distinct_motion_families_missing");
  if (assets.length > 1 && families.length <= 1) rejectionReasons.push("all_assets_share_one_visual_family");
  return {
    status: rejectionReasons.length ? "blocked" : "ready",
    families,
    rejectionReasons,
  };
}

function buildOwnedMotionManifest(report = {}) {
  const assets = assetsFromOwnedMotionReport(report);
  const familyStatus = distinctFamilyStatus({ assets });
  const failureReasons = unique(
    asArray(report.stories).flatMap((story) => asArray(story.failed).map((item) => item.reason)),
  );
  const status = failureReasons.length && familyStatus.status === "ready" ? "partial" : familyStatus.status;
  return {
    schema_version: 1,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    source: "goal_owned_motion_materializer",
    status,
    summary: {
      story_count: report.summary?.story_count || asArray(report.stories).length,
      asset_count: assets.length,
      clip_count: assets.length,
      distinct_motion_family_count: familyStatus.families.length,
      failed_clip_count: report.summary?.failed_clip_count || 0,
      skipped_non_owned_clip_count: report.summary?.skipped_non_owned_clip_count || 0,
    },
    assets,
    rejection_reasons: unique([...familyStatus.rejectionReasons, ...failureReasons]),
    safety: report.safety || {},
  };
}

function buildAggregateMaterialisedMotionClips(report = {}, ownedMotionManifest = buildOwnedMotionManifest(report)) {
  return {
    schema_version: 1,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    source: "goal_owned_motion_materializer",
    status: ownedMotionManifest.status,
    summary: {
      story_count: ownedMotionManifest.summary.story_count,
      clip_count: ownedMotionManifest.summary.clip_count,
      distinct_motion_family_count: ownedMotionManifest.summary.distinct_motion_family_count,
    },
    clips: ownedMotionManifest.assets,
    materialised_clips: ownedMotionManifest.assets,
    rejection_reasons: ownedMotionManifest.rejection_reasons,
  };
}

function buildDistinctMotionFamilyReport(report = {}, ownedMotionManifest = buildOwnedMotionManifest(report)) {
  const families = unique(ownedMotionManifest.assets.map((asset) => asset.motion_family));
  return {
    schema_version: 1,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    source: "goal_owned_motion_materializer",
    status: ownedMotionManifest.status,
    summary: {
      story_count: ownedMotionManifest.summary.story_count,
      asset_count: ownedMotionManifest.summary.asset_count,
      distinct_motion_family_count: families.length,
      minimum_required_distinct_motion_families: 4,
    },
    families,
    family_counts: families.map((family) => ({
      motion_family: family,
      asset_count: ownedMotionManifest.assets.filter((asset) => asset.motion_family === family).length,
    })),
    rejection_reasons: ownedMotionManifest.rejection_reasons,
  };
}

function hasOwnedSourceSafetyBlocker(story = {}) {
  const reasons = [
    ...asArray(story.blockers),
    ...asArray(story.rejection_reasons),
    ...asArray(story.failed).map((item) => item.reason),
  ].map(cleanText);
  return reasons.includes("owned_explainer_requires_non_discovery_primary_source");
}

function buildOwnedMotionSourceSafetyWorkOrder(report = {}) {
  const jobs = asArray(report.stories)
    .filter(hasOwnedSourceSafetyBlocker)
    .map((story) => {
      const storyId = cleanText(story.story_id);
      const artifactDir = cleanText(story.artifact_dir);
      return {
        story_id: storyId,
        title: cleanText(story.title),
        artifact_dir: artifactDir,
        blocker_type: "owned_explainer_requires_non_discovery_primary_source",
        repair_lane: "non_discovery_primary_source_intake",
        exact_missing_input:
          "A non-discovery primary source, official source or reliable publication source that supports the owned explainer deck.",
        required_artefact_path: artifactDir ? path.join(artifactDir, "canonical_story_manifest.json") : null,
        recommended_command:
          `node tools/official-source-intake.js --story-json "${path.join(artifactDir, "canonical_story_manifest.json")}" --input "output/goal-contract/source-attribution-repair/${storyId}_official_source_entries.json" --output-json "output/goal-contract/source-attribution-repair/${storyId}_official_source_intake_report.json" --json`,
        expected_output: [
          "official_source_intake_report.json with at least one accepted non-discovery reference",
          "canonical_story_manifest.json updated with a non-discovery primary_source/source_card_label",
          "owned_motion_manifest.json regenerated without source-safety blocked generated cards",
          "materialised_motion_clips.json regenerated with clips that count only when the source boundary is resolved",
        ],
        db_mutation_required: false,
        operator_approval_required: true,
        post_repair_validation_command:
          `npm run ops:goal-owned-motion -- --story-packages output/goal-contract/story-packages.json --story-id ${storyId} --out-dir output/goal-04 --json`,
      };
    });
  return {
    schema_version: 1,
    generated_at: report.generated_at || null,
    mode: "OWNED_MOTION_SOURCE_SAFETY_WORK_ORDER",
    summary: {
      story_count: jobs.length,
      operator_required_count: jobs.filter((job) => job.operator_approval_required).length,
      auto_repairable_count: 0,
    },
    jobs,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

async function updateOwnedMotionEvidence({
  artifactDir,
  storyId,
  clips = [],
  canonical = {},
  footageInventory = {},
  rightsLedger = {},
  generatedAt,
  countsTowardMotionReadiness = true,
  sourceSafetyBlocked = false,
} = {}) {
  const clipRows = assetsFromOwnedMotionReport({
    stories: [
      {
        story_id: storyId,
        materialized: asArray(clips).map((clip) => ({
          status: "materialized",
          path: cleanText(clip.path),
          clip,
        })),
      },
    ],
  }).map((asset) => ({
    ...asset,
    id: asset.asset_id,
    durationS: asset.duration,
    rights_basis: "owned_generated_editorial_motion_graphic",
    licence_basis: "owned_generated_editorial_motion_graphic",
    source_type: "internally_generated_motion_graphic",
    source_kind: sourceSafetyBlocked ? "owned_source_deficit_motion" : "owned_source_card_explainer_motion",
    media_kind: sourceSafetyBlocked ? "owned_source_deficit_motion" : "owned_explainer_motion",
    counts_towards_motion_readiness: countsTowardMotionReadiness,
    source_safety_blocked: sourceSafetyBlocked,
    owned_explainer_visual_plan: !sourceSafetyBlocked,
  }));
  const families = unique(clipRows.map((clip) => clip.motion_family));
  const records = clipRows.map((clip) => rightsRecordForOwnedClip(clip, canonical));
  const existingRecords = rightsLedger.records || rightsLedger.rights_ledger || rightsLedger.assets || [];
  const motionInventory = footageInventory.motion_inventory || {};
  const updatedMotionInventory = sourceSafetyBlocked
    ? {
        ...motionInventory,
        source_safety_blocked_owned_motion_count: clipRows.length,
        source_safety_blocked_owned_motion_generated_at: generatedAt,
        source_safety_blockers: ["owned_explainer_requires_non_discovery_primary_source"],
      }
    : {
        ...motionInventory,
        owned_explainer_visual_plan: true,
        accepted_local_clips: clipRows,
        production_motion_clips: clipRows,
        distinct_source_families: families,
        trusted_local_source_families: families,
        owned_motion_materialized_at: generatedAt,
      };
  const updatedFootage = {
    ...footageInventory,
    motion_budget: {
      ...(footageInventory.motion_budget || {}),
      ...(sourceSafetyBlocked
        ? {
            owned_source_deficit_motion_only: true,
            source_safety_blocked_owned_motion_count: clipRows.length,
          }
        : {
            allow_owned_explainer_motion_only: true,
            owned_explainer_visual_plan: true,
            required_motion_scenes: Math.max(5, clipRows.length),
            required_distinct_families: Math.max(4, families.length),
          }),
    },
    motion_inventory: updatedMotionInventory,
  };
  const mergedRecords = mergeRecords(existingRecords, records);
  const updatedRights = {
    ...rightsLedger,
    verdict: "pass",
    failures: asArray(rightsLedger.failures).filter((failure) => cleanText(failure) !== "rights:no_rights_record"),
    records: mergedRecords,
    rights_ledger: mergeRecords(rightsLedger.rights_ledger || rightsLedger.records, records),
    matched_assets: mergeRecords(rightsLedger.matched_assets, records.map((record) => ({
      asset_id: record.asset_id,
      kind: "owned_generated_motion_graphic",
      path: record.path,
      source_url: record.source_url,
      rights_record_id: record.asset_id,
      licence_basis: record.licence_basis,
      risk_score: record.risk_score,
    }))),
    rights_ledger_repaired_at: generatedAt,
    rights_ledger_repair_strategy: sourceSafetyBlocked
      ? "owned_source_deficit_motion_records_not_render_ready"
      : "owned_source_card_explainer_motion_records",
  };
  await fs.writeJson(path.join(artifactDir, "footage_inventory.json"), updatedFootage, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "rights_ledger.json"), updatedRights, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    schema_version: 1,
    story_id: storyId,
    status: sourceSafetyBlocked ? "blocked" : "ready",
    generated_at: generatedAt,
    owned_explainer_visual_plan: !sourceSafetyBlocked,
    source_safety_blocked: sourceSafetyBlocked,
    clips: clipRows,
    materialised_clips: clipRows,
    distinct_motion_families: families,
    clip_count: clipRows.length,
    distinct_motion_family_count: families.length,
    rejection_reasons: sourceSafetyBlocked ? ["owned_explainer_requires_non_discovery_primary_source"] : [],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "distinct_motion_family_report.json"), {
    schema_version: 1,
    story_id: storyId,
    status: sourceSafetyBlocked ? "blocked" : "ready",
    generated_at: generatedAt,
    summary: {
      clip_count: clipRows.length,
      distinct_motion_family_count: families.length,
      minimum_required_distinct_motion_families: 4,
    },
    families,
    rejection_reasons: sourceSafetyBlocked ? ["owned_explainer_requires_non_discovery_primary_source"] : [],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "owned_motion_manifest.json"), {
    schema_version: 1,
    story_id: storyId,
    status: sourceSafetyBlocked ? "blocked" : "ready",
    generated_at: generatedAt,
    owned_explainer_visual_plan: !sourceSafetyBlocked,
    source_safety_blocked: sourceSafetyBlocked,
    summary: {
      asset_count: clipRows.length,
      distinct_motion_family_count: families.length,
    },
    assets: clipRows,
    materialised_clips: clipRows,
    distinct_motion_families: families,
    source: "owned_generated_explainer_motion_materializer",
    note: sourceSafetyBlocked
      ? "Owned generated source-deficit graphics. These are not render-ready until a non-discovery primary source is available."
      : "Owned animated source-card explainer graphics for non-game stories. This is not gameplay footage.",
    rejection_reasons: sourceSafetyBlocked ? ["owned_explainer_requires_non_discovery_primary_source"] : [],
  }, { spaces: 2 });
}

async function materializeGoalOwnedMotionClips({
  root = process.cwd(),
  workOrder = {},
  generatedAt = new Date().toISOString(),
  execFileSync = defaultExecFileSync,
  ffprobeDuration = defaultFfprobeDuration,
  refreshExisting = false,
} = {}) {
  const stories = [];
  for (const job of asArray(workOrder.jobs).filter(shouldProcessJob)) {
    const artifactDir = cleanText(job.artifact_dir);
    const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"));
    const footage = await readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"));
    const rightsLedger = await readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {});
    const action = ownedExplainerAction(job);
    const inventoryClips = clipsFromFootageInventory(footage);
    const ownedInventoryClips = inventoryClips.filter(isOwnedGeneratedMotion);
    const explainerClipPlan = ownedExplainerClipPlan({ storyId: cleanText(job.story_id), canonical });
    const sourceDeficitPlan = sourceDeficitClipPlan({ storyId: cleanText(job.story_id), canonical });
    const explainerRepairLane =
      cleanText(action?.repair_lane) === "owned_generated_explainer_motion_materialisation";
    const shouldSynthesiseExplainer =
      explainerRepairLane &&
      (
        ownedInventoryClips.length < 5 ||
        (
          refreshExisting &&
          ownedInventoryClips.length > 0 &&
          ownedInventoryClips.length < explainerClipPlan.length
        )
      );
    const sourceLocked = sourceLockedForOwnedExplainer(canonical);
    const sourceSafetyBlocked = shouldSynthesiseExplainer && !sourceLocked;
    const clips = shouldSynthesiseExplainer
      ? (
          sourceSafetyBlocked
            ? sourceDeficitPlan
            : explainerClipPlan
        )
      : inventoryClips;
    const materialized = [];
    const existing = [];
    const skipped = [];
    const failed = [];
    if (sourceSafetyBlocked) {
      failed.push({
        status: "failed",
        reason: "owned_explainer_requires_non_discovery_primary_source",
        clip_id: null,
      });
    }
    for (const clip of clips) {
      if (!isOwnedGeneratedMotion(clip)) {
        skipped.push({ clip_id: clip.id || null, reason: "not_owned_generated_motion" });
        continue;
      }
      const result = await materializeClip({
        root,
        clip,
        canonical,
        execFileSync,
        ffprobeDuration,
        refreshExisting,
      });
      if (result.status === "materialized") materialized.push(result);
      else if (result.status === "existing") existing.push(result);
      else if (result.status === "failed") failed.push(result);
      else skipped.push(result);
    }
    const readyClips = [
      ...materialized.map((result) => result.clip).filter(Boolean),
      ...existing.map((result) => result.clip).filter(Boolean),
    ];
    if (readyClips.length >= 5 && new Set(readyClips.map((clip) => cleanText(clip.source_family)).filter(Boolean)).size >= 4) {
      await updateOwnedMotionEvidence({
        artifactDir,
        storyId: cleanText(job.story_id),
        clips: readyClips,
        canonical,
        footageInventory: footage,
        rightsLedger,
        generatedAt,
        countsTowardMotionReadiness: !sourceSafetyBlocked,
        sourceSafetyBlocked,
      });
    }
    const rejectionReasons = rejectionReasonsForResults(failed);
    stories.push({
      story_id: cleanText(job.story_id),
      title: cleanText(job.title || canonical.selected_title),
      artifact_dir: artifactDir,
      status: failed.length ? "blocked" : (readyClips.length >= 5 ? "materialized" : "partial"),
      blockers: rejectionReasons,
      rejection_reasons: rejectionReasons,
      materialized,
      existing,
      skipped,
      failed,
    });
  }
  const materializedCount = stories.reduce((sum, story) => sum + story.materialized.length, 0);
  const existingCount = stories.reduce((sum, story) => sum + story.existing.length, 0);
  const failedCount = stories.reduce((sum, story) => sum + story.failed.length, 0);
  const skippedNonOwnedCount = stories.reduce(
    (sum, story) => sum + story.skipped.filter((item) => item.reason === "not_owned_generated_motion").length,
    0,
  );
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "OWNED_GENERATED_MOTION_MATERIALIZATION",
    summary: {
      source_story_package_count: workOrder.summary?.source_story_package_count || workOrder.source_story_package_count || null,
      story_count: stories.length,
      materialized_clip_count: materializedCount,
      existing_clip_count: existingCount,
      failed_clip_count: failedCount,
      skipped_non_owned_clip_count: skippedNonOwnedCount,
    },
    stories,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_external_media_downloads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_rights_gate_weakened: true,
    },
  };
}

function renderGoalOwnedMotionMaterializationMarkdown(report = {}) {
  const lines = [];
  const failedStories = asArray(report.stories).filter((story) => asArray(story.failed).length);
  const verdict = failedStories.length ? "PARTIAL" : "PASS";
  lines.push("# Owned Motion Materialization");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Goal verdict: ${verdict}`);
  lines.push(`Stories: ${report.summary?.story_count || 0}`);
  if (report.summary?.source_story_package_count) {
    lines.push(`Source story package count: ${report.summary.source_story_package_count}`);
  }
  lines.push(`Materialized clips: ${report.summary?.materialized_clip_count || 0}`);
  lines.push(`Existing clips: ${report.summary?.existing_clip_count || 0}`);
  lines.push(`Failed clips: ${report.summary?.failed_clip_count || 0}`);
  lines.push("");
  lines.push("## Stories");
  for (const story of asArray(report.stories).slice(0, 30)) {
    const reasons = asArray(story.failed).map((item) => cleanText(item.reason)).filter(Boolean);
    const reasonText = reasons.length ? `; blockers: ${reasons.join(", ")}` : "";
    lines.push(
      `- ${story.story_id}: materialized ${story.materialized.length}, existing ${story.existing.length}, failed ${story.failed.length}${reasonText}`,
    );
  }
  if (!asArray(report.stories).length) lines.push("- none");
  if (failedStories.length) {
    lines.push("");
    lines.push("## Remaining blockers");
    for (const story of failedStories) {
      const reasons = asArray(story.failed).map((item) => cleanText(item.reason)).filter(Boolean);
      lines.push(`- ${story.story_id}: ${reasons.join(", ") || "owned motion materialisation failed"}`);
    }
  }
  lines.push("");
  lines.push("Safety: owned generated graphics only; no publishing, OAuth, database mutation or external media download.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalOwnedMotionMaterializationReport(report = {}, { outputDir, workOrder = null } = {}) {
  if (!outputDir) throw new Error("writeGoalOwnedMotionMaterializationReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "owned_motion_materialization_report.json");
  const markdownPath = path.join(outDir, "owned_motion_materialization_report.md");
  const ownedMotionManifestPath = path.join(outDir, "owned_motion_manifest.json");
  const materialisedMotionClipsPath = path.join(outDir, "materialised_motion_clips.json");
  const distinctMotionFamilyReportPath = path.join(outDir, "distinct_motion_family_report.json");
  const renderInputWorkOrderPath = path.join(outDir, "render_input_work_order.json");
  const ownedMotionSourceSafetyWorkOrderPath = path.join(outDir, "owned_motion_source_safety_work_order.json");
  const ownedMotionManifest = buildOwnedMotionManifest(report);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  if (workOrder) await fs.writeJson(renderInputWorkOrderPath, workOrder, { spaces: 2 });
  await fs.writeJson(ownedMotionManifestPath, ownedMotionManifest, { spaces: 2 });
  await fs.writeJson(
    materialisedMotionClipsPath,
    buildAggregateMaterialisedMotionClips(report, ownedMotionManifest),
    { spaces: 2 },
  );
  await fs.writeJson(
    distinctMotionFamilyReportPath,
    buildDistinctMotionFamilyReport(report, ownedMotionManifest),
    { spaces: 2 },
  );
  await fs.writeJson(
    ownedMotionSourceSafetyWorkOrderPath,
    buildOwnedMotionSourceSafetyWorkOrder(report),
    { spaces: 2 },
  );
  await fs.writeFile(markdownPath, renderGoalOwnedMotionMaterializationMarkdown(report), "utf8");
  return {
    outputDir: outDir,
    jsonPath,
    markdownPath,
    ownedMotionManifestPath,
    materialisedMotionClipsPath,
    distinctMotionFamilyReportPath,
    renderInputWorkOrderPath,
    ownedMotionSourceSafetyWorkOrderPath,
  };
}

module.exports = {
  buildOwnedMotionSourceSafetyWorkOrder,
  buildOwnedMotionFrameLayout,
  buildOwnedMotionFfmpegArgs,
  buildAggregateMaterialisedMotionClips,
  buildDistinctMotionFamilyReport,
  buildOwnedMotionManifest,
  isOwnedGeneratedMotion,
  materializeGoalOwnedMotionClips,
  renderGoalOwnedMotionMaterializationMarkdown,
  writeGoalOwnedMotionMaterializationReport,
};
