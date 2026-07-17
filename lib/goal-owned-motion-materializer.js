"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const { execFileSync: defaultExecFileSync } = require("node:child_process");
const { ffprobeDuration: defaultFfprobeDuration } = require("./studio/media-acquisition");
const {
  materializeOwnedMotionRightsEvidence,
} = require("./owned-motion-rights-evidence");

const FRAME_WIDTH_PX = 1080;
const FRAME_HEIGHT_PX = 1920;
const SAFE_RIGHT_PX = 42;
const SAFE_BOTTOM_PX = 92;
const MIN_OWNED_EXPLAINER_CARD_DURATION_S = 12;
const MAX_OWNED_EXPLAINER_CARD_DURATION_S = 14;
const PRIMARY_PROCEDURAL_PROJECT_KEYS = [
  "kinetic_aperture",
  "signal_lattice",
  "data_ribbons",
];

const GENERATOR_PROJECTS = Object.freeze({
  kinetic_aperture: Object.freeze({
    generator_project_id: "pulse.motion.kinetic-aperture.v1",
    generator_version: 1,
    generator_design_role: "primary_procedural_motion",
    generator_design_grammar: "full-frame kinetic aperture with counter-moving slabs and expanding nested gates",
    motion_operators: ["counter_moving_slabs", "expanding_nested_gates", "asymmetric_edge_streaks"],
    colour_system: ["0x070A0F", "0xFF6B1A", "0xF8FAFC", "0x38BDF8"],
    temporal_model: "absolute_time_expressions_only",
  }),
  signal_lattice: Object.freeze({
    generator_project_id: "pulse.motion.signal-lattice.v1",
    generator_version: 1,
    generator_design_role: "primary_procedural_motion",
    generator_design_grammar: "full-frame technical lattice with travelling scan beams, pulse nodes and oscilloscope traces",
    motion_operators: ["travelling_scan_beams", "phase_offset_pulse_nodes", "oscilloscope_trace"],
    colour_system: ["0x040B0C", "0x22D3A7", "0x38BDF8", "0xE2E8F0"],
    temporal_model: "absolute_time_expressions_only",
  }),
  data_ribbons: Object.freeze({
    generator_project_id: "pulse.motion.data-ribbons.v1",
    generator_version: 1,
    generator_design_role: "primary_procedural_motion",
    generator_design_grammar: "full-frame comparative data race with independently oscillating bars and horizontal metric ribbons",
    motion_operators: ["comparative_bar_race", "phase_shifted_metrics", "horizontal_metric_ribbons"],
    colour_system: ["0x0B0710", "0xF43F5E", "0xFFB15C", "0xF8FAFC"],
    temporal_model: "absolute_time_expressions_only",
  }),
  editorial_support: Object.freeze({
    generator_project_id: "pulse.motion.editorial-support.v1",
    generator_version: 1,
    generator_design_role: "support_card",
    generator_design_grammar: "source-locked editorial support card with readable dwell",
    motion_operators: ["source_lock_reveal", "editorial_text_dwell", "verification_sweep"],
    colour_system: ["0x080B12", "0xFF6B1A", "0x38BDF8", "0xF8FAFC"],
    temporal_model: "absolute_time_expressions_only",
  }),
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function generatorProjectMaster(projectKey) {
  const project = GENERATOR_PROJECTS[projectKey] || GENERATOR_PROJECTS.editorial_support;
  return sha256(canonicalJson({
    schema_version: 1,
    generator: "goal_owned_motion_materializer",
    frame: { width: FRAME_WIDTH_PX, height: FRAME_HEIGHT_PX, frame_rate: 30 },
    project,
  }));
}

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

function projectKeyForClip(clip = {}) {
  const explicitId = cleanText(clip.generator_project_id);
  const explicit = Object.entries(GENERATOR_PROJECTS).find(
    ([, project]) => project.generator_project_id === explicitId,
  );
  if (explicit) return explicit[0];
  const text = [
    clip.asset_class,
    clip.source_family,
    clip.motion_family,
    clip.visual_purpose,
    clip.id,
  ].map(cleanText).join(" ").toLowerCase();
  if (/signal|scan|topology|waveform|radar|lattice/.test(text)) return "signal_lattice";
  if (/data|bar[_ -]?race|metric|timeline|chart|stat|ribbon/.test(text)) return "data_ribbons";
  if (/source|quote|proof[_ -]?card|support[_ -]?card/.test(text)) return "editorial_support";
  return "kinetic_aperture";
}

function ownedGeneratedRightsGrant(project) {
  return {
    schema_version: 1,
    grant_id: `${project.generator_project_id}:owned-generated-v1`,
    grant_type: "owned_generated",
    rights_holder: "Pulse Gaming",
    granted_by: "Pulse Gaming",
    generation_basis: "Original procedural motion generated locally from a Pulse Gaming-owned project master.",
    allowed_use: "commercial_editorial_and_platform_native_derivatives",
    allowed_platforms: [...DEFAULT_PLATFORM_SUITABILITY],
    commercial_use_allowed: true,
    derivative_use_allowed: true,
    credit_required: false,
  };
}

function withGeneratorIdentity(clip = {}, canonical = {}) {
  const projectKey = projectKeyForClip(clip);
  const project = GENERATOR_PROJECTS[projectKey];
  const generatorMasterSha256 = generatorProjectMaster(projectKey);
  const deterministicSeed = sha256(canonicalJson({
    story_id: cleanText(canonical.story_id || clip.id),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game),
    selected_title: cleanText(canonical.selected_title),
    asset_class: cleanText(clip.asset_class || clip.id),
    generator_project_id: project.generator_project_id,
  })).slice(0, 16);
  const sampledVisualFingerprint = `sha256:${sha256(canonicalJson({
    algorithm: "deterministic_generator_frame_plan_sha256",
    generator_master_sha256: generatorMasterSha256,
    deterministic_seed: deterministicSeed,
    sample_times_ratio: [0, 0.25, 0.5, 0.75, 1],
    duration_s: clipDuration(clip),
  }))}`;
  const rightsGrant = ownedGeneratedRightsGrant(project);
  return {
    ...clip,
    generator_project_id: project.generator_project_id,
    generator_version: project.generator_version,
    generator_master_sha256: generatorMasterSha256,
    generator_design_role: project.generator_design_role,
    generator_design_grammar: project.generator_design_grammar,
    generator_motion_operators: [...project.motion_operators],
    deterministic_seed: deterministicSeed,
    reproducible: true,
    seek_safe: true,
    temporal_model: project.temporal_model,
    sampled_visual_fingerprint: sampledVisualFingerprint,
    sampled_visual_fingerprint_basis: "deterministic_generator_frame_plan_sha256",
    source_master_sha256: generatorMasterSha256,
    source_master_identity: {
      schema_version: 1,
      identity_kind: "owned_generator_project_master",
      generator_project_id: project.generator_project_id,
      source_master_asset_id: `${project.generator_project_id}:master`,
      source_master_sha256: generatorMasterSha256,
      canonical_source_url: `local://pulse-owned-generator-project/${project.generator_project_id}`,
    },
    allowed_platforms: [...DEFAULT_PLATFORM_SUITABILITY],
    rights_grant: rightsGrant,
    owned_generated_rights_grant: rightsGrant,
  };
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
  const ownedExplainerText = [
    clip.source_kind,
    clip.media_kind,
    clip.source_url,
    clip.rights_risk_class,
    clip.asset_class,
  ].map(cleanText).join(" ").toLowerCase();
  const isOwnedExplainer = ownedExplainerText.includes("owned") &&
    ownedExplainerText.includes("explainer");
  const isReadableCard = clip.hyperframes_card === true ||
    Boolean(cleanText(clip.readable_card_kind || clip.card_kind)) ||
    /source[_ -]?card|quote[_ -]?card|proof[_ -]?card/.test(ownedExplainerText);
  const readableFloor = isOwnedExplainer && isReadableCard
    ? ownedExplainerReadableDurationS(clip)
    : MIN_OWNED_EXPLAINER_CARD_DURATION_S;
  const fallback = isOwnedExplainer && isReadableCard ? readableFloor : 4.8;
  if (!Number.isFinite(duration) || duration <= 0.5) return fallback;
  const capped = Math.min(
    duration,
    isOwnedExplainer && isReadableCard ? MAX_OWNED_EXPLAINER_CARD_DURATION_S : 6,
  );
  return isOwnedExplainer && isReadableCard ? Math.max(capped, readableFloor) : capped;
}

function ownedExplainerReadableDurationS(clip = {}) {
  const text = [
    clip.asset_class,
    clip.visual_purpose,
    clip.id,
    clip.source_family,
    clip.headline,
  ].map(cleanText).join(" ").toLowerCase();
  if (/source_proof|platform_proof|proof card|quote|article screenshot|confirmed claim/.test(text)) {
    return MIN_OWNED_EXPLAINER_CARD_DURATION_S;
  }
  if (/stat|chart|carousel|image-card|x_image|breaking-news|fast card|claim card/.test(text)) {
    return MIN_OWNED_EXPLAINER_CARD_DURATION_S;
  }
  return MIN_OWNED_EXPLAINER_CARD_DURATION_S;
}

function isDiscoveryOnlySource(value = "") {
  return /\b(?:reddit|r\/|forum|discussion)\b/i.test(cleanText(value));
}

function ownedExplainerAction(job = {}) {
  return asArray(job.actions).find(
    (action) => cleanText(action.action_id) === "materialise_owned_generated_motion_clips",
  ) || null;
}

function ownedExplainerSourceSafetyBlockers(canonical = {}) {
  const primary = cleanText(canonical.primary_source || canonical.source_card_label);
  const sourceUrl = cleanText(canonical.primary_source_url || canonical.official_source_url || canonical.source_url);
  const safetyText = [
    canonical.source_safety_status,
    canonical.source_verification_status,
    canonical.primary_source_status,
    canonical.source_confidence,
  ].map(cleanText).join(" ").toLowerCase();
  const blockers = [];
  if (
    !primary ||
    isDiscoveryOnlySource(primary) ||
    (sourceUrl && /reddit\.com|old\.reddit\.com|redd\.it/i.test(sourceUrl))
  ) {
    blockers.push("owned_explainer_requires_non_discovery_primary_source");
  }
  if (
    canonical.source_verified === false ||
    canonical.primary_source_verified === false ||
    /\b(?:unsafe|rejected|blocked|unverified|anonymous|unknown)\b/.test(safetyText)
  ) {
    blockers.push("owned_explainer_source_unsafe");
  }
  return [...new Set(blockers)];
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
      value: `SOURCE LOCK ${source}`,
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
  const cardBoundsById = {
    subject: { x: 42, y: 50, w: 996, h: 166, pad: 18 },
    source: { x: 42, y: 50, w: 996, h: 166, pad: 18 },
    headline: { x: 58, y: 482, w: 964, h: 302, pad: 22 },
    purpose: { x: 94, y: 814, w: 892, h: 166, pad: 22 },
  };
  return {
    frame: {
      width_px: FRAME_WIDTH_PX,
      height_px: FRAME_HEIGHT_PX,
      safe_right_px: FRAME_WIDTH_PX - SAFE_RIGHT_PX,
      safe_bottom_px: FRAME_HEIGHT_PX - SAFE_BOTTOM_PX,
    },
    text_blocks: blocks.map((block) => ({
      ...block,
      card_bounds: cardBoundsById[block.id] || null,
      within_safe_bounds:
        block.estimated_right_px <= FRAME_WIDTH_PX - SAFE_RIGHT_PX &&
        block.estimated_bottom_px <= FRAME_HEIGHT_PX - SAFE_BOTTOM_PX,
      within_card_bounds: cardBoundsById[block.id]
        ? block.x >= cardBoundsById[block.id].x + cardBoundsById[block.id].pad &&
          block.y >= cardBoundsById[block.id].y + cardBoundsById[block.id].pad &&
          block.estimated_right_px <= cardBoundsById[block.id].x + cardBoundsById[block.id].w - cardBoundsById[block.id].pad &&
          block.estimated_bottom_px <= cardBoundsById[block.id].y + cardBoundsById[block.id].h - cardBoundsById[block.id].pad
        : true,
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

function ownedReadableCardKind(assetClass = "") {
  const text = cleanText(assetClass).toLowerCase();
  if (!text || /branded[_-]?wipe|motion[_-]?background|lower[_-]?third/.test(text)) return "";
  if (/source/.test(text)) return "source";
  if (/quote/.test(text)) return "quote";
  if (/platform|proof/.test(text)) return "proof";
  if (/stat/.test(text)) return "stat";
  if (/chart/.test(text)) return "chart";
  if (/screenshot/.test(text)) return "screenshot";
  if (/carousel/.test(text)) return "carousel";
  if (/breaking/.test(text)) return "breaking";
  if (/title/.test(text)) return "title";
  if (/card/.test(text)) return "card";
  return "";
}

function ownedExplainerClipPlan({ storyId, canonical = {} } = {}) {
  const source = cleanText(canonical.primary_source || canonical.source_card_label || "Source locked");
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_company || canonical.selected_title || storyId);
  const title = cleanText(canonical.selected_title || canonical.thumbnail_headline || subject);
  const claim = titleWords(asArray(canonical.confirmed_claims)[0] || canonical.first_spoken_line || title, 9);
  const base = `output/generated-motion/${safeStem(storyId)}`;
  const rows = [
    ["kinetic_aperture_surface", titleWords(title, 7), "opening aperture impact", "kinetic_aperture"],
    ["parallax_stripe_field", titleWords(subject, 5), "counter-moving subject energy", "kinetic_aperture"],
    ["impact_tunnel_surface", titleWords(claim, 6), "nested gate acceleration", "kinetic_aperture"],
    ["kinetic_broll_surface", titleWords(subject, 5), "full-frame kinetic editorial surface", "kinetic_aperture"],
    ["branded_wipe", "PULSE GAMING", "full-frame transition wipe", "kinetic_aperture"],
    ["signal_scan_surface", titleWords(subject, 5), "travelling signal scan", "signal_lattice"],
    ["topology_node_field", titleWords(claim, 6), "phase-offset topology pulse", "signal_lattice"],
    ["waveform_scope_surface", titleWords(subject, 5), "oscilloscope motion field", "signal_lattice"],
    ["radar_sweep_surface", titleWords(canonical.canonical_angle || title, 6), "technical verification sweep", "signal_lattice"],
    ["data_pulse_surface", titleWords(canonical.canonical_angle || title, 5), "comparative data pulse", "data_ribbons"],
    ["comparative_bar_race", titleWords(claim, 6), "independent comparative bar motion", "data_ribbons"],
    ["metric_ribbon_flow", titleWords(subject, 5), "horizontal metric ribbon flow", "data_ribbons"],
    ["timeline_cascade_surface", titleWords(title, 6), "timeline cascade motion", "data_ribbons"],
    ["animated_source_card", source, "source lock support", "editorial_support"],
    ["animated_quote_card", claim, "source-backed quote support", "editorial_support"],
    ["stat_card", titleWords(claim, 6), "source-backed stat support", "editorial_support"],
    ["platform_proof_card", titleWords(source, 5), "platform/source proof support", "editorial_support"],
  ];
  return rows.map(([assetClass, headline, purpose, projectKey], index) => {
    const readableCardKind = ownedReadableCardKind(assetClass);
    const readableDuration = ownedExplainerReadableDurationS({
      asset_class: assetClass,
      visual_purpose: purpose,
      id: assetClass,
      headline,
    });
    return withGeneratorIdentity({
      id: `${storyId}-owned-motion-${index + 1}`,
      asset_class: assetClass,
      source_family: `${storyId}_${GENERATOR_PROJECTS[projectKey].generator_project_id}`,
      motion_family: `${storyId}_${GENERATOR_PROJECTS[projectKey].generator_project_id}`,
      visual_family: `${storyId}_${GENERATOR_PROJECTS[projectKey].generator_project_id}`,
      path: `${base}/${String(index + 1).padStart(2, "0")}_${assetClass}.mp4`,
      source_url: `local://pulse-generated-motion/${storyId}/${assetClass}`,
      source_type: "internally_generated_motion_graphic",
      source_kind: readableCardKind
        ? "owned_source_card_explainer_motion"
        : "owned_explainer_motion_surface",
      media_kind: "owned_explainer_motion",
      rights_risk_class: "owned_generated_motion",
      licence_basis: "owned_generated_editorial_motion_graphic",
      allowed_use: "finished_editorial_video_only",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      durationS: readableCardKind ? readableDuration : 4.8 + (index % 3) * 0.4,
      ...(readableCardKind ? {
        hyperframes_card: true,
        readable_card_kind: readableCardKind,
        card_kind: readableCardKind,
        readable_text: headline,
        minimum_readable_duration_s: Math.max(MIN_OWNED_EXPLAINER_CARD_DURATION_S, readableDuration),
      } : {}),
      validated: true,
      counts_towards_motion_readiness: true,
      owned_explainer_visual_plan: true,
      headline,
      visual_purpose: purpose,
      source_relationship: source,
      dimensions: { width: 1080, height: 1920 },
      frame_rate: 30,
      platform_suitability: DEFAULT_PLATFORM_SUITABILITY,
      generator_project_id: GENERATOR_PROJECTS[projectKey].generator_project_id,
    }, canonical);
  });
}

function kineticApertureFilter() {
  return [
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x070A0F@1:t=fill",
    "drawbox=x='-420+mod(t*760,1920)':y=0:w=310:h=ih:color=0xFF6B1A@0.34:t=fill",
    "drawbox=x='1280-mod(t*540,1840)':y=0:w=170:h=ih:color=0x38BDF8@0.20:t=fill",
    "drawbox=x='540-(180+mod(t*210,620))/2':y='960-(320+mod(t*370,1120))/2':w='180+mod(t*210,620)':h='320+mod(t*370,1120)':color=white@0.26:t=5",
    "drawbox=x='540-(90+mod(t*310,820))/2':y='960-(160+mod(t*550,1480))/2':w='90+mod(t*310,820)':h='160+mod(t*550,1480)':color=0xFFB15C@0.48:t=4",
    "drawbox=x='-180+mod(t*920,1440)':y=260:w=180:h=18:color=white@0.72:t=fill",
    "drawbox=x='1080-mod(t*820,1380)':y=1510:w=260:h=12:color=0x38BDF8@0.74:t=fill",
    "drawbox=x=34:y='-420+mod(t*630,2340)':w=7:h=420:color=0xFF6B1A@0.88:t=fill",
  ].join(",");
}

function signalLatticeFilter() {
  const trace = Array.from({ length: 11 }, (_, index) => {
    const x = 80 + index * 94;
    return `drawbox=x=${x}:y='900+sin(t*5.4+${(index * 0.55).toFixed(2)})*190':w=54:h=12:color=0x22D3A7@0.88:t=fill`;
  });
  const nodes = Array.from({ length: 6 }, (_, index) => {
    const phase = (index * 0.83).toFixed(2);
    return `drawbox=x='510+sin(t*${(1.1 + index * 0.13).toFixed(2)}+${phase})*390':y='920+cos(t*${(0.9 + index * 0.11).toFixed(2)}+${phase})*650':w=24:h=24:color=0x38BDF8@0.78:t=fill`;
  });
  return [
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x040B0C@1:t=fill",
    "drawgrid=width=90:height=90:thickness=2:color=0x22D3A7@0.16",
    "drawbox=x=0:y='-70+mod(t*430,2060)':w=iw:h=70:color=0x22D3A7@0.24:t=fill",
    "drawbox=x='-44+mod(t*260,1168)':y=0:w=44:h=ih:color=0x38BDF8@0.18:t=fill",
    ...nodes,
    ...trace,
    "drawbox=x=72:y=900:w=936:h=2:color=white@0.38:t=fill",
  ].join(",");
}

function dataRibbonsFilter() {
  const bars = Array.from({ length: 7 }, (_, index) => {
    const x = 78 + index * 142;
    const phase = (index * 0.72).toFixed(2);
    const height = `260+abs(sin(t*${(1.25 + index * 0.08).toFixed(2)}+${phase}))*920`;
    const colour = index % 2 ? "0xFFB15C" : "0xF43F5E";
    return `drawbox=x=${x}:y='1640-(${height})':w=88:h='${height}':color=${colour}@0.72:t=fill`;
  });
  return [
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x0B0710@1:t=fill",
    "drawgrid=width=180:height=160:thickness=1:color=white@0.10",
    ...bars,
    "drawbox=x=58:y=1640:w=964:h=5:color=white@0.58:t=fill",
    "drawbox=x='-520+mod(t*430,2120)':y=250:w=520:h=64:color=0xF43F5E@0.64:t=fill",
    "drawbox=x='1080-mod(t*360,1780)':y=390:w=700:h=36:color=0xFFB15C@0.70:t=fill",
    "drawbox=x='-280+mod(t*280,1640)':y=1760:w=280:h=18:color=white@0.76:t=fill",
  ].join(",");
}

function buildOwnedMotionFfmpegArgs({ clip = {}, canonical = {}, output }) {
  const duration = clipDuration(clip);
  const font = fontOption();
  const layout = buildOwnedMotionFrameLayout({ clip, canonical });
  const blockById = Object.fromEntries(layout.text_blocks.map((block) => [block.id, block]));
  const projectId = cleanText(clip.generator_project_id);
  const proceduralFilter = projectId === GENERATOR_PROJECTS.kinetic_aperture.generator_project_id
    ? kineticApertureFilter()
    : projectId === GENERATOR_PROJECTS.signal_lattice.generator_project_id
      ? signalLatticeFilter()
      : projectId === GENERATOR_PROJECTS.data_ribbons.generator_project_id
        ? dataRibbonsFilter()
        : "";
  const vf = proceduralFilter || [
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x080B12@1:t=fill",
    "drawbox=x='-260+mod(t*520,1540)':y=0:w=210:h=ih:color=white@0.045:t=fill",
    "drawbox=x='940-mod(t*380,1220)':y=0:w=86:h=ih:color=0xFF6B1A@0.050:t=fill",
    "drawbox=x=18:y='mod(t*240,1920)-420':w=3:h=420:color=0x38BDF8@0.34:t=fill",
    "drawbox=x=42:y=50:w=996:h=166:color=0x111827@0.54:t=fill",
    "drawbox=x=42:y=50:w=996:h=166:color=0xF8FAFC@0.14:t=2",
    "drawbox=x=42:y=50:w='if(lt(t,0.28),1,1+(996-1)*(t-0.28)/0.34)':h=4:color=0x38BDF8@0.92:t=fill",
    `drawtext=text='PULSE // MOTION PROOF':${font}:fontcolor=0x38BDF8:fontsize=18:x=74:y=82:shadowcolor=black@0.82:shadowx=3:shadowy=3`,
    `drawtext=text='VERIFY':${font}:fontcolor=white@0.72:fontsize=17:x=w-tw-68:y=82:shadowcolor=black@0.72:shadowx=2:shadowy=2`,
    ...drawMotionTextBlock(blockById.subject, { font, color: "0xFFB15C" }),
    ...drawMotionTextBlock(blockById.source, { font, color: "white@0.88", shadow: false }),
    "drawbox=x=58:y=482:w=964:h=302:color=0x111827@0.50:t=fill",
    "drawbox=x=58:y=482:w=964:h=302:color=0x0B0F19@0.30:t=fill",
    "drawbox=x=58:y=482:w=964:h=302:color=0xF8FAFC@0.15:t=2",
    "drawbox=x=58:y=482:w='if(lt(t,0.20),1,1+(964-1)*(t-0.20)/0.36)':h=6:color=0x38BDF8@0.92:t=fill",
    "drawbox=x='82+mod(t*420,760)':y=492:w=124:h=282:color=white@0.045:t=fill",
    "drawbox=x=74:y=760:w=620:h=6:color=0xFF6B1A@0.74:t=fill",
    ...drawMotionTextBlock(blockById.headline, { font, color: "white" }),
    "drawbox=x=94:y=814:w=892:h=166:color=0x111827@0.45:t=fill",
    "drawbox=x=94:y=814:w=892:h=166:color=0xF8FAFC@0.13:t=2",
    "drawbox=x=94:y=814:w='if(lt(t,0.42),1,1+(892-1)*(t-0.42)/0.34)':h=5:color=0x38BDF8@0.92:t=fill",
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
    "-threads",
    "1",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-sc_threshold",
    "0",
    "-map_metadata",
    "-1",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
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

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function attachMaterializationEvidence({ clip, output, generatedAt }) {
  const outputStat = await fs.stat(output);
  const outputSha256 = await sha256File(output);
  const evidencePath = `${output}.json`;
  const enrichedClip = {
    ...clip,
    path: output,
    local_materialized_path: output,
    materialised_output_sha256: outputSha256,
    materialised_output_size_bytes: outputStat.size,
  };
  await fs.writeJson(evidencePath, {
    schema_version: 2,
    evidence_kind: "owned_generated_motion_materialization",
    generator: "goal_owned_motion_materializer",
    asset_id: enrichedClip.id || null,
    generator_project_id: enrichedClip.generator_project_id,
    generator_master_sha256: enrichedClip.generator_master_sha256,
    sampled_visual_fingerprint: enrichedClip.sampled_visual_fingerprint,
    sampled_visual_fingerprint_basis: enrichedClip.sampled_visual_fingerprint_basis,
    source_master_identity: enrichedClip.source_master_identity,
    deterministic_seed: enrichedClip.deterministic_seed,
    reproducible: enrichedClip.reproducible,
    seek_safe: enrichedClip.seek_safe,
    source_url: enrichedClip.source_url || null,
    source_family: enrichedClip.source_family || null,
    card_kind: enrichedClip.readable_card_kind ||
      enrichedClip.card_kind ||
      ownedReadableCardKind(enrichedClip.asset_class) ||
      null,
    readable_text: enrichedClip.readable_text || enrichedClip.headline || null,
    minimum_readable_duration_s: enrichedClip.minimum_readable_duration_s || null,
    materialised_output: {
      path: output,
      sha256: outputSha256,
      size_bytes: outputStat.size,
    },
    rights_grant: enrichedClip.rights_grant,
    allowed_platforms: enrichedClip.allowed_platforms,
  }, { spaces: 2 });
  const evidenceStat = await fs.stat(evidencePath);
  const evidenceSha256 = await sha256File(evidencePath);
  const rightsEvidencePath = `${output}.rights.json`;
  const strictRights = await materializeOwnedMotionRightsEvidence({
    asset_id: cleanText(enrichedClip.id),
    asset_kind: "procedural_clip",
    asset_path: output,
    evidence_path: rightsEvidencePath,
    ownership_basis: "wholly_owned_generated_asset",
    licence_basis: "owned_generated_editorial_motion_graphic",
    rights_grant: true,
    commercial_use_allowed: true,
    allowed_platforms: [...DEFAULT_PLATFORM_SUITABILITY],
    source_owner: "Pulse Gaming",
    source_type: "internally_generated_procedural_motion",
    source_url: `local://pulse-owned/${safeStem(enrichedClip.id)}`,
    provenance: {
      origin: "pulse_gaming_internal_generation",
      generator_name: "goal_owned_motion_materializer",
      generator_version: String(enrichedClip.generator_version || 1),
      generated_at: new Date(generatedAt || Date.now()).toISOString(),
      creation_method: "procedural_generation",
      third_party_inputs: false,
      third_party_sources: [],
    },
  });
  return {
    ...enrichedClip,
    evidence_file: {
      path: evidencePath,
      sha256: evidenceSha256,
      size_bytes: evidenceStat.size,
    },
    evidence_file_path: evidencePath,
    evidence_file_sha256: evidenceSha256,
    evidence_file_size_bytes: evidenceStat.size,
    owned_rights_record: strictRights.record,
    owned_rights_evaluation: strictRights.evaluation,
    rights_evidence_file_path: strictRights.record.evidence_file,
    rights_evidence_file_sha256: strictRights.record.evidence_sha256,
    rights_evidence_file_size_bytes: strictRights.record.evidence_size_bytes,
  };
}

async function materializeClip({
  root,
  clip,
  canonical,
  execFileSync,
  ffprobeDuration,
  generatedAt,
  refreshExisting = false,
}) {
  const output = outputPathForClip({ root, clip });
  if (!output) return { status: "skipped", reason: "clip_path_missing", clip };
  const identifiedClip = withGeneratorIdentity(clip, canonical);
  await fs.ensureDir(path.dirname(output));
  if (!refreshExisting && await fileLooksUsable(output, ffprobeDuration)) {
    const evidencedClip = await attachMaterializationEvidence({
      clip: identifiedClip,
      output,
      generatedAt,
    });
    return {
      status: "existing",
      path: output,
      clip_id: identifiedClip.id || null,
      clip: evidencedClip,
    };
  }
  const args = buildOwnedMotionFfmpegArgs({ clip: identifiedClip, canonical, output });
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
      clip_id: identifiedClip.id || null,
    };
  }
  if (!(await fileLooksUsable(output, ffprobeDuration))) {
    return {
      status: "failed",
      reason: "generated_clip_invalid",
      path: output,
      clip_id: identifiedClip.id || null,
    };
  }
  const evidencedClip = await attachMaterializationEvidence({
    clip: identifiedClip,
    output,
    generatedAt,
  });
  return {
    status: "materialized",
    path: output,
    clip_id: identifiedClip.id || null,
    clip: evidencedClip,
  };
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

function clipIdentity(clip = {}) {
  return cleanText(
    clip.asset_id ||
      clip.id ||
      clip.local_materialized_path ||
      clip.file_path ||
      clip.path ||
      [clip.source_url, clip.motion_family || clip.source_family].filter(Boolean).join("#"),
  );
}

function isReadyDirectVideoClip(clip = {}) {
  if (!clip || typeof clip !== "object") return false;
  if (isOwnedGeneratedMotion(clip)) return false;
  if (clip.source_safety_blocked === true) return false;
  const text = [
    clip.media_kind,
    clip.source_type,
    clip.source_kind,
    clip.rights_basis,
    clip.licence_basis,
    clip.rights_risk_class,
    clip.provenance?.source,
    clip.provenance?.validation_reason,
  ].map(cleanText).join(" ").toLowerCase();
  const hasLocalVideoPath = Boolean(cleanText(clip.path || clip.local_materialized_path || clip.file_path));
  const hasValidatedOfficialDirectVideo =
    hasLocalVideoPath &&
    /direct_video/.test(text) &&
    /official(?:_game_website_media_page|_direct_media|_trailer_segment_validation|.*storefront.*motion)/.test(text) &&
    (
      clip.materialized === true ||
      clip.provenance?.segment_validated === true ||
      /samples_passed|segment_validation|trimmed_segment_samples_passed/.test(text)
    );
  if (clip.counts_towards_motion_readiness === false && !hasValidatedOfficialDirectVideo) return false;
  if (text.includes("official_reference_only") && !hasValidatedOfficialDirectVideo) return false;
  const hasDirectVideoEvidence =
    text.includes("direct_video") ||
    text.includes("official_direct_media") ||
    text.includes("licensed_direct_media_url") ||
    text.includes("official_game_website_media_page");
  return hasDirectVideoEvidence && hasLocalVideoPath;
}

function mergeClipRows(existing = [], incoming = []) {
  const rows = [];
  const byKey = new Map();
  for (const clip of [...asArray(existing), ...asArray(incoming)]) {
    const key = clipIdentity(clip);
    if (!key) continue;
    if (byKey.has(key)) rows[byKey.get(key)] = { ...rows[byKey.get(key)], ...clip };
    else {
      byKey.set(key, rows.length);
      rows.push(clip);
    }
  }
  return rows;
}

function directVideoStats(clips = []) {
  const directClips = asArray(clips).filter(isReadyDirectVideoClip);
  return {
    directVideoClipCount: directClips.length,
    directVideoFamilyCount: unique(directClips.map((clip) => clip.motion_family || clip.source_family)).length,
  };
}

function normaliseReadyDirectVideoClip(clip = {}) {
  return isReadyDirectVideoClip(clip)
    ? {
        ...clip,
        counts_towards_motion_readiness: true,
      }
    : clip;
}

function rightsRecordForOwnedClip(clip = {}, canonical = {}) {
  if (clip.owned_rights_record && typeof clip.owned_rights_record === "object") {
    return {
      ...clip.owned_rights_record,
      asset_type: "owned_generated_motion_graphic",
      source_family: cleanText(clip.source_family),
      media_kind: "owned_explainer_motion",
      allowed_use: "finished_editorial_video_only",
      owned_generated_rights_grant: clip.owned_generated_rights_grant,
      generator_project_id: cleanText(clip.generator_project_id),
      generator_master_sha256: cleanText(clip.generator_master_sha256),
      sampled_visual_fingerprint: cleanText(clip.sampled_visual_fingerprint),
      source_master_identity: clip.source_master_identity,
      materialised_output_sha256: cleanText(clip.materialised_output_sha256),
      materialised_output_size_bytes: Number(clip.materialised_output_size_bytes || 0),
      materialization_evidence_file: clip.evidence_file,
      transformation_notes:
        "Original procedural motion generated from the locked canonical story manifest and owned project master.",
      credit_required: false,
      evidence_reference: cleanText(
        canonical.primary_source || canonical.source_card_label || "canonical_story_manifest",
      ),
      risk_score: 0.01,
    };
  }
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
    allowed_platforms: asArray(clip.allowed_platforms).length
      ? asArray(clip.allowed_platforms)
      : [...DEFAULT_PLATFORM_SUITABILITY],
    commercial_use_allowed: true,
    rights_grant: clip.rights_grant,
    owned_generated_rights_grant: clip.owned_generated_rights_grant || clip.rights_grant,
    generator_project_id: cleanText(clip.generator_project_id),
    generator_master_sha256: cleanText(clip.generator_master_sha256),
    sampled_visual_fingerprint: cleanText(clip.sampled_visual_fingerprint),
    source_master_identity: clip.source_master_identity,
    materialised_output_sha256: cleanText(clip.materialised_output_sha256),
    materialised_output_size_bytes: Number(clip.materialised_output_size_bytes || 0),
    evidence_file: clip.evidence_file,
    evidence_file_path: cleanText(clip.evidence_file_path || clip.evidence_file?.path),
    evidence_file_sha256: cleanText(clip.evidence_file_sha256 || clip.evidence_file?.sha256),
    evidence_file_size_bytes: Number(
      clip.evidence_file_size_bytes || clip.evidence_file?.size_bytes || 0,
    ),
    transformation_notes:
      "Original procedural motion or support graphic generated from the locked canonical story manifest and owned project master.",
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
  const assetClass = cleanText(clip.asset_class || clip.visual_asset_class || "owned_motion_card");
  const readableCardKind = cleanText(clip.readable_card_kind || clip.card_kind || ownedReadableCardKind(assetClass));
  const readableText = cleanText(clip.readable_text || clip.headline || clip.visual_purpose || assetClass);
  const readableDuration = ownedExplainerReadableDurationS({
    asset_class: assetClass,
    visual_purpose: clip.visual_purpose,
    id: clip.id || assetClass,
    headline: readableText,
  });
  return {
    asset_id: cleanText(clip.id || result.clip_id || `${story.story_id || "story"}-owned-motion-${index + 1}`),
    asset_class: assetClass,
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
    source_kind: cleanText(
      clip.source_kind ||
        (readableCardKind ? "owned_source_card_explainer_motion" : "owned_explainer_motion_surface"),
    ),
    generator_project_id: cleanText(clip.generator_project_id),
    generator_version: Number(clip.generator_version || 1),
    generator_master_sha256: cleanText(clip.generator_master_sha256),
    generator_design_role: cleanText(clip.generator_design_role),
    generator_design_grammar: cleanText(clip.generator_design_grammar),
    generator_motion_operators: asArray(clip.generator_motion_operators).map(cleanText).filter(Boolean),
    deterministic_seed: cleanText(clip.deterministic_seed),
    reproducible: clip.reproducible === true,
    seek_safe: clip.seek_safe === true,
    temporal_model: cleanText(clip.temporal_model),
    sampled_visual_fingerprint: cleanText(clip.sampled_visual_fingerprint),
    sampled_visual_fingerprint_basis: cleanText(clip.sampled_visual_fingerprint_basis),
    source_master_sha256: cleanText(clip.source_master_sha256),
    source_master_identity: clip.source_master_identity,
    materialised_output_sha256: cleanText(clip.materialised_output_sha256),
    materialised_output_size_bytes: Number(clip.materialised_output_size_bytes || 0),
    evidence_file: clip.evidence_file,
    evidence_file_path: cleanText(clip.evidence_file_path || clip.evidence_file?.path),
    evidence_file_sha256: cleanText(clip.evidence_file_sha256 || clip.evidence_file?.sha256),
    evidence_file_size_bytes: Number(
      clip.evidence_file_size_bytes || clip.evidence_file?.size_bytes || 0,
    ),
    owned_rights_record:
      clip.owned_rights_record && typeof clip.owned_rights_record === "object"
        ? clip.owned_rights_record
        : null,
    owned_rights_evaluation:
      clip.owned_rights_evaluation && typeof clip.owned_rights_evaluation === "object"
        ? clip.owned_rights_evaluation
        : null,
    rights_evidence_file_path: cleanText(clip.rights_evidence_file_path),
    rights_evidence_file_sha256: cleanText(clip.rights_evidence_file_sha256),
    rights_evidence_file_size_bytes: Number(clip.rights_evidence_file_size_bytes || 0),
    allowed_platforms: asArray(clip.allowed_platforms).length
      ? asArray(clip.allowed_platforms).map(cleanText).filter(Boolean)
      : [...DEFAULT_PLATFORM_SUITABILITY],
    rights_grant: clip.rights_grant,
    owned_generated_rights_grant: clip.owned_generated_rights_grant || clip.rights_grant,
    ...(readableCardKind ? {
      hyperframes_card: true,
      readable_card_kind: readableCardKind,
      card_kind: readableCardKind,
      readable_text: readableText,
      minimum_readable_duration_s: Math.max(MIN_OWNED_EXPLAINER_CARD_DURATION_S, readableDuration),
    } : {}),
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
    const family = cleanText(asset.generator_master_sha256 || asset.motion_family);
    if (!family) continue;
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }
  return assets.map((asset) => {
    const count = familyCounts.get(cleanText(asset.generator_master_sha256 || asset.motion_family)) || 1;
    return {
      ...asset,
      distinctness_score: Number((1 / count).toFixed(3)),
    };
  });
}

function distinctFamilyStatus({ assets = [], minFamilies = 4 } = {}) {
  const families = unique(assets.map((asset) => asset.motion_family));
  const primaryProceduralAssets = assets.filter(
    (asset) => asset.generator_design_role === "primary_procedural_motion",
  );
  const generatorProjects = unique(primaryProceduralAssets.map((asset) => asset.generator_project_id));
  const generatorMasters = unique(primaryProceduralAssets.map((asset) => asset.generator_master_sha256));
  const rejectionReasons = [];
  if (!assets.length) rejectionReasons.push("materialised_motion_clips_missing");
  if (families.length < minFamilies) rejectionReasons.push("distinct_motion_families_missing");
  if (assets.length > 1 && families.length <= 1) rejectionReasons.push("all_assets_share_one_visual_family");
  if (
    generatorProjects.length < PRIMARY_PROCEDURAL_PROJECT_KEYS.length ||
    generatorMasters.length < PRIMARY_PROCEDURAL_PROJECT_KEYS.length
  ) {
    rejectionReasons.push("materially_distinct_generator_projects_missing");
  }
  return {
    status: rejectionReasons.length ? "blocked" : "ready",
    families,
    generatorProjects,
    generatorMasters,
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
      materially_distinct_generator_project_count: familyStatus.generatorProjects.length,
      distinct_generator_master_count: familyStatus.generatorMasters.length,
      failed_clip_count: report.summary?.failed_clip_count || 0,
      skipped_non_owned_clip_count: report.summary?.skipped_non_owned_clip_count || 0,
    },
    assets,
    generator_projects: familyStatus.generatorProjects,
    generator_master_sha256s: familyStatus.generatorMasters,
    rejection_reasons: unique([...familyStatus.rejectionReasons, ...failureReasons]),
    strict_green_claimed: false,
    control_tower_verdict: null,
    publish_readiness_claim: "not_assessed_by_owned_motion_materializer",
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
      materially_distinct_generator_project_count:
        ownedMotionManifest.summary.materially_distinct_generator_project_count,
    },
    clips: ownedMotionManifest.assets,
    materialised_clips: ownedMotionManifest.assets,
    rejection_reasons: ownedMotionManifest.rejection_reasons,
    strict_green_claimed: false,
    control_tower_verdict: null,
    publish_readiness_claim: "not_assessed_by_owned_motion_materializer",
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
      materially_distinct_generator_project_count:
        ownedMotionManifest.summary.materially_distinct_generator_project_count,
      minimum_required_materially_distinct_generator_projects: 3,
    },
    families,
    family_counts: families.map((family) => ({
      motion_family: family,
      asset_count: ownedMotionManifest.assets.filter((asset) => asset.motion_family === family).length,
    })),
    rejection_reasons: ownedMotionManifest.rejection_reasons,
    strict_green_claimed: false,
    control_tower_verdict: null,
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

function workOrderHasOwnedMotionJobs(workOrder = {}) {
  return asArray(workOrder.jobs).some((job) =>
    asArray(job.actions).some(
      (action) => cleanText(action.action_id) === "materialise_owned_generated_motion_clips",
    ),
  );
}

function workOrderHasNonOwnedMotionJobs(workOrder = {}) {
  return asArray(workOrder.jobs).some((job) =>
    asArray(job.actions).some(
      (action) => cleanText(action.action_id) && cleanText(action.action_id) !== "materialise_owned_generated_motion_clips",
    ),
  );
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
  sourceSafetyBlockers = [],
} = {}) {
  const sourceSafetyRejectionReasons = sourceSafetyBlocked
    ? unique(
        sourceSafetyBlockers.length
          ? sourceSafetyBlockers
          : ["owned_explainer_requires_non_discovery_primary_source"],
      )
    : [];
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
    source_kind: sourceSafetyBlocked
      ? "owned_source_deficit_motion"
      : cleanText(asset.source_kind || "owned_explainer_motion_surface"),
    media_kind: sourceSafetyBlocked ? "owned_source_deficit_motion" : "owned_explainer_motion",
    counts_towards_motion_readiness: countsTowardMotionReadiness,
    source_safety_blocked: sourceSafetyBlocked,
    owned_explainer_visual_plan: !sourceSafetyBlocked,
  }));
  const existingMaterialisedMotion = await readJsonIfPresent(
    path.join(artifactDir, "materialised_motion_clips.json"),
    {},
  );
  const preservedDirectVideoClips = sourceSafetyBlocked
    ? []
    : mergeClipRows([
        ...asArray(existingMaterialisedMotion.clips),
        ...asArray(existingMaterialisedMotion.materialised_clips),
        ...clipsFromFootageInventory(footageInventory),
      ], []).filter(isReadyDirectVideoClip).map(normaliseReadyDirectVideoClip);
  const finalMotionRows = sourceSafetyBlocked
    ? clipRows
    : mergeClipRows(preservedDirectVideoClips, clipRows);
  const families = unique(finalMotionRows.map((clip) => clip.motion_family || clip.source_family));
  const ownedFamilies = unique(clipRows.map((clip) => clip.motion_family));
  const primaryGeneratorProjects = unique(
    clipRows
      .filter((clip) => clip.generator_design_role === "primary_procedural_motion")
      .map((clip) => clip.generator_project_id),
  );
  const primaryGeneratorMasters = unique(
    clipRows
      .filter((clip) => clip.generator_design_role === "primary_procedural_motion")
      .map((clip) => clip.generator_master_sha256),
  );
  const { directVideoClipCount, directVideoFamilyCount } = directVideoStats(finalMotionRows);
  const records = clipRows.map((clip) => rightsRecordForOwnedClip(clip, canonical));
  const existingRecords = rightsLedger.records || rightsLedger.rights_ledger || rightsLedger.assets || [];
  const motionInventory = footageInventory.motion_inventory || {};
  const updatedMotionInventory = sourceSafetyBlocked
    ? {
        ...motionInventory,
        source_safety_blocked_owned_motion_count: clipRows.length,
        source_safety_blocked_owned_motion_generated_at: generatedAt,
        source_safety_blockers: sourceSafetyRejectionReasons,
        source_safety_rejected_before_generation: true,
      }
    : {
        ...motionInventory,
        owned_explainer_visual_plan: true,
        accepted_local_clips: finalMotionRows,
        production_motion_clips: finalMotionRows,
        distinct_source_families: families,
        trusted_local_source_families: families,
        direct_video_motion_asset_count: directVideoClipCount,
        direct_video_motion_family_count: directVideoFamilyCount,
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
            required_motion_scenes: Math.max(5, finalMotionRows.length),
            required_distinct_families: Math.max(4, families.length),
          }),
    },
    motion_inventory: updatedMotionInventory,
  };
  const mergedRecords = mergeRecords(existingRecords, records);
  const updatedRights = {
    ...rightsLedger,
    verdict: sourceSafetyBlocked ? "blocked" : "pass",
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
    clips: finalMotionRows,
    materialised_clips: finalMotionRows,
    distinct_motion_families: families,
    clip_count: finalMotionRows.length,
    distinct_motion_family_count: families.length,
    direct_video_motion_asset_count: directVideoClipCount,
    direct_video_motion_family_count: directVideoFamilyCount,
    materially_distinct_generator_project_count: primaryGeneratorProjects.length,
    distinct_generator_master_count: primaryGeneratorMasters.length,
    generator_projects: primaryGeneratorProjects,
    generator_master_sha256s: primaryGeneratorMasters,
    rejection_reasons: sourceSafetyRejectionReasons,
    strict_green_claimed: false,
    control_tower_verdict: null,
    publish_readiness_claim: "not_assessed_by_owned_motion_materializer",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "distinct_motion_family_report.json"), {
    schema_version: 1,
    story_id: storyId,
    status: sourceSafetyBlocked ? "blocked" : "ready",
    generated_at: generatedAt,
    summary: {
      clip_count: finalMotionRows.length,
      distinct_motion_family_count: families.length,
      minimum_required_distinct_motion_families: 4,
      materially_distinct_generator_project_count: primaryGeneratorProjects.length,
      minimum_required_materially_distinct_generator_projects: 3,
    },
    families,
    generator_projects: primaryGeneratorProjects,
    generator_master_sha256s: primaryGeneratorMasters,
    rejection_reasons: sourceSafetyRejectionReasons,
    strict_green_claimed: false,
    control_tower_verdict: null,
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
      distinct_motion_family_count: ownedFamilies.length,
      materially_distinct_generator_project_count: primaryGeneratorProjects.length,
      distinct_generator_master_count: primaryGeneratorMasters.length,
    },
    assets: clipRows,
    materialised_clips: clipRows,
    distinct_motion_families: ownedFamilies,
    generator_projects: primaryGeneratorProjects,
    generator_master_sha256s: primaryGeneratorMasters,
    source: "owned_generated_explainer_motion_materializer",
    note: sourceSafetyBlocked
      ? "Owned generated source-deficit graphics. These are not render-ready until a non-discovery primary source is available."
      : "Owned animated source-card explainer graphics for non-game stories. This is not gameplay footage.",
    rejection_reasons: sourceSafetyRejectionReasons,
    strict_green_claimed: false,
    control_tower_verdict: null,
    publish_readiness_claim: "not_assessed_by_owned_motion_materializer",
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
    const repairLane = cleanText(action?.repair_lane);
    const readableHyperframesRepairLane =
      repairLane === "readable_hyperframes_card_motion_rematerialisation";
    const explainerRepairLane =
      repairLane === "owned_generated_explainer_motion_materialisation" ||
      readableHyperframesRepairLane;
    const shouldSynthesiseExplainer =
      explainerRepairLane &&
      (
        readableHyperframesRepairLane ||
        ownedInventoryClips.length < 5 ||
        (
          refreshExisting &&
          ownedInventoryClips.length > 0 &&
          ownedInventoryClips.length < explainerClipPlan.length
        )
      );
    const sourceSafetyBlockers = ownedExplainerSourceSafetyBlockers(canonical);
    const sourceSafetyBlocked = sourceSafetyBlockers.length > 0;
    const clips = sourceSafetyBlocked
      ? []
      : shouldSynthesiseExplainer
        ? explainerClipPlan
        : inventoryClips;
    const materialized = [];
    const existing = [];
    const skipped = [];
    const failed = [];
    if (sourceSafetyBlocked) {
      failed.push(...sourceSafetyBlockers.map((reason) => ({
        status: "failed",
        reason,
        clip_id: null,
      })));
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
        generatedAt,
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
    const primaryGeneratorProjectCount = new Set(
      readyClips
        .filter((clip) => clip.generator_design_role === "primary_procedural_motion")
        .map((clip) => cleanText(clip.generator_master_sha256))
        .filter(Boolean),
    ).size;
    if (sourceSafetyBlocked || (readyClips.length >= 5 && primaryGeneratorProjectCount >= 3)) {
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
        sourceSafetyBlockers,
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
    strict_green_claimed: false,
    control_tower_verdict: null,
    publish_readiness_claim: "not_assessed_by_owned_motion_materializer",
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
  const verdict = report.dry_run === true ? "DRY_RUN" : failedStories.length ? "PARTIAL" : "PASS";
  lines.push("# Owned Motion Materialization");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Materialization result: ${verdict}`);
  lines.push(`Stories: ${report.summary?.story_count || 0}`);
  if (report.summary?.source_story_package_count) {
    lines.push(`Source story package count: ${report.summary.source_story_package_count}`);
  }
  lines.push(`Materialized clips: ${report.summary?.materialized_clip_count || 0}`);
  if (report.dry_run === true) {
    lines.push(`Planned clips: ${report.summary?.planned_clip_count || 0}`);
  }
  lines.push(`Existing clips: ${report.summary?.existing_clip_count || 0}`);
  lines.push(`Failed clips: ${report.summary?.failed_clip_count || 0}`);
  lines.push("");
  lines.push("## Stories");
  for (const story of asArray(report.stories).slice(0, 30)) {
    const reasons = asArray(story.failed).map((item) => cleanText(item.reason)).filter(Boolean);
    const reasonText = reasons.length ? `; blockers: ${reasons.join(", ")}` : "";
    lines.push(
      report.dry_run === true
        ? `- ${story.story_id}: planned ${story.planned_clip_count || 0}, materialized 0, existing 0, failed 0${reasonText}`
        : `- ${story.story_id}: materialized ${story.materialized.length}, existing ${story.existing.length}, failed ${story.failed.length}${reasonText}`,
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
  lines.push(report.dry_run === true
    ? "Safety: dry-run only; no FFmpeg, publishing, OAuth, database mutation, story package mutation or external media download."
    : "Safety: owned generated graphics only; no publishing, OAuth, database mutation or external media download.");
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
  const ownedMotionWorkOrderPath = path.join(outDir, "owned_motion_render_input_work_order.json");
  const ownedMotionSourceSafetyWorkOrderPath = path.join(outDir, "owned_motion_source_safety_work_order.json");
  const ownedMotionManifest = buildOwnedMotionManifest(report);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  let renderInputWorkOrderPreserved = false;
  if (workOrder) {
    const existingWorkOrder = await readJsonIfPresent(renderInputWorkOrderPath, null);
    const shouldPreserveExisting =
      existingWorkOrder &&
      workOrderHasOwnedMotionJobs(workOrder) &&
      workOrderHasNonOwnedMotionJobs(existingWorkOrder);
    if (shouldPreserveExisting) {
      await fs.writeJson(ownedMotionWorkOrderPath, workOrder, { spaces: 2 });
      renderInputWorkOrderPreserved = true;
    } else {
      await fs.writeJson(renderInputWorkOrderPath, workOrder, { spaces: 2 });
      if (workOrderHasOwnedMotionJobs(workOrder)) {
        await fs.writeJson(ownedMotionWorkOrderPath, workOrder, { spaces: 2 });
      }
    }
  }
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
    ownedMotionWorkOrderPath,
    renderInputWorkOrderPreserved,
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
  workOrderHasNonOwnedMotionJobs,
  workOrderHasOwnedMotionJobs,
};
