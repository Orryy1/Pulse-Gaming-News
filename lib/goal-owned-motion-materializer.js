"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const { execFileSync: defaultExecFileSync } = require("node:child_process");
const { ffprobeDuration: defaultFfprobeDuration } = require("./studio/media-acquisition");
const {
  materializeOwnedMotionRightsEvidence,
} = require("./owned-motion-rights-evidence");
const {
  canonicaliseMotionSourceUrl,
} = require("./studio/motion-source-identity");

const FRAME_WIDTH_PX = 1080;
const FRAME_HEIGHT_PX = 1920;
const SAFE_RIGHT_PX = 42;
const SAFE_BOTTOM_PX = 92;
const MIN_OWNED_EXPLAINER_CARD_DURATION_S = 12;
const MAX_OWNED_EXPLAINER_CARD_DURATION_S = 14;
const PRIMARY_PROCEDURAL_CLIP_DURATION_S = 7;
const PRIMARY_PROCEDURAL_PROJECT_KEYS = [
  "kinetic_aperture",
  "signal_lattice",
  "data_ribbons",
  "spatial_orbits",
];

const GENERATOR_PROJECTS = Object.freeze({
  kinetic_aperture: Object.freeze({
    generator_project_id: "pulse.motion.kinetic-aperture.v1",
    generator_version: 5,
    generator_design_role: "primary_procedural_motion",
    generator_design_grammar: "asset-seeded high-information kinetic aperture variants with high-contrast micro-grids, distributed tile fields, counter-moving slabs, expanding nested gates and non-looping per-frame camera motion",
    motion_operators: ["asset_seeded_layout_variant", "high_contrast_micro_grid", "distributed_kinetic_tiles", "counter_moving_slabs", "expanding_nested_gates", "asymmetric_edge_streaks", "per_frame_overscan_camera_path"],
    colour_system: ["0x18263A", "0xFF6B1A", "0xF8FAFC", "0x38BDF8"],
    temporal_model: "absolute_time_expressions_only",
  }),
  signal_lattice: Object.freeze({
    generator_project_id: "pulse.motion.signal-lattice.v1",
    generator_version: 7,
    generator_design_role: "primary_procedural_motion",
    generator_design_grammar: "asset-seeded high-information technical lattice variants with high-contrast signal grids, distributed node matrices, constant lattice scroll, non-looping micro-rotation, oscilloscope traces and per-frame camera motion",
    motion_operators: ["asset_seeded_layout_variant", "high_contrast_signal_grid", "distributed_node_matrix", "constant_lattice_scroll", "non_looping_micro_rotation", "phase_offset_pulse_nodes", "distributed_oscilloscope_trace", "per_frame_overscan_camera_path"],
    colour_system: ["0x12333A", "0x1C1A38", "0x22D3A7", "0x38BDF8", "0xA78BFA", "0xE2E8F0"],
    temporal_model: "absolute_time_expressions_only",
  }),
  data_ribbons: Object.freeze({
    generator_project_id: "pulse.motion.data-ribbons.v1",
    generator_version: 5,
    generator_design_role: "primary_procedural_motion",
    generator_design_grammar: "asset-seeded edge-safe full-frame data variants spanning vertical races, horizontal comparisons, metric lanes, timeline cascades and non-looping per-frame camera motion",
    motion_operators: ["asset_seeded_layout_variant", "edge_safe_frame_energy", "comparative_bar_race", "phase_shifted_metrics", "horizontal_metric_ribbons", "timeline_cascade", "per_frame_overscan_camera_path"],
    colour_system: ["0x0B0710", "0x10172A", "0xF43F5E", "0xFFB15C", "0x38BDF8", "0xF8FAFC"],
    temporal_model: "absolute_time_expressions_only",
  }),
  spatial_orbits: Object.freeze({
    generator_project_id: "pulse.motion.spatial-orbits.v1",
    generator_version: 4,
    generator_design_role: "primary_procedural_motion",
    generator_design_grammar: "asset-seeded spatial orbit variants with elliptical trajectories, counter-rotating node clusters, phase sweeps, depth-separated orbital lanes, a distributed high-contrast information lattice, constant full-frame scroll, non-looping micro-rotation and per-frame camera motion",
    motion_operators: ["asset_seeded_layout_variant", "elliptical_node_trajectories", "counter_rotating_clusters", "phase_sweep_bands", "depth_separated_orbital_lanes", "asymmetric_trajectory_markers", "distributed_information_lattice", "constant_full_frame_scroll", "non_looping_micro_rotation", "per_frame_overscan_camera_path"],
    colour_system: ["0x071C2B", "0x0F3D46", "0x67E8F9", "0xFACC15", "0xFB7185", "0xF8FAFC"],
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

const OWNED_MOTION_ASSET_VARIANTS = Object.freeze({
  kinetic_aperture_surface: 0,
  parallax_stripe_field: 1,
  impact_tunnel_surface: 2,
  kinetic_broll_surface: 3,
  branded_wipe: 4,
  signal_scan_surface: 0,
  topology_node_field: 1,
  waveform_scope_surface: 2,
  radar_sweep_surface: 3,
  data_pulse_surface: 0,
  comparative_bar_race: 1,
  metric_ribbon_flow: 2,
  timeline_cascade_surface: 3,
  orbital_cluster_surface: 0,
  radial_phase_field: 1,
  constellation_drift_surface: 2,
  trajectory_arc_surface: 3,
});

function ownedMotionVariant(clip = {}) {
  const assetClass = cleanText(clip.asset_class).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(OWNED_MOTION_ASSET_VARIANTS, assetClass)) {
    return OWNED_MOTION_ASSET_VARIANTS[assetClass];
  }
  const seed = cleanText(clip.deterministic_seed || clip.id || assetClass);
  return Number.parseInt(sha256(seed).slice(0, 8), 16) % 5;
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
  if (/orbit|spatial|radial|constellation|trajectory/.test(text)) return "spatial_orbits";
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
  const generatorVariant = ownedMotionVariant(clip);
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
    generator_variant: generatorVariant,
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
    generator_variant: generatorVariant,
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
    isOwnedExplainer && isReadableCard
      ? MAX_OWNED_EXPLAINER_CARD_DURATION_S
      : PRIMARY_PROCEDURAL_CLIP_DURATION_S,
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
  const headline = cleanText(clip.headline || canonical.thumbnail_headline || canonical.selected_title || subject)
    .split(/\s+/)
    .slice(0, 7)
    .join(" ");
  const source = cleanText(canonical.primary_source || canonical.source_card_label || "Primary source");
  const sourceLabel = clip.source_safety_blocked === true
    ? "DISCOVERY SOURCE ONLY"
    : `SOURCE ${source}`;
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
      value: sourceLabel,
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

function ownedExplainerClipPlan({ storyId, canonical = {}, artifactDir = "" } = {}) {
  const source = cleanText(canonical.primary_source || canonical.source_card_label || "Primary source");
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_company || canonical.selected_title || storyId);
  const title = cleanText(canonical.selected_title || canonical.thumbnail_headline || subject);
  const confirmedClaims = asArray(canonical.confirmed_claims)
    .map((item) => cleanText(item))
    .filter(Boolean);
  const fallbackClaim = cleanText(canonical.first_spoken_line || title);
  const claimAt = (index, words = 9) => titleWords(
    confirmedClaims[index] || confirmedClaims[0] || fallbackClaim,
    words,
  );
  const claim = claimAt(0, 9);
  const claimTwo = claimAt(1, 9);
  const claimThree = claimAt(2, 9);
  const claimFour = claimAt(3, 9);
  const base = cleanText(artifactDir)
    ? path.join(artifactDir, "owned-motion", "generated")
    : `output/generated-motion/${safeStem(storyId)}`;
  const rows = [
    ["kinetic_aperture_surface", titleWords(title, 7), "THE HEADLINE", "kinetic_aperture"],
    ["parallax_stripe_field", claim, "WHAT CHANGED", "kinetic_aperture"],
    ["impact_tunnel_surface", claimTwo, "THE PATCH DETAIL", "kinetic_aperture"],
    ["kinetic_broll_surface", claimThree, "WHAT PLAYERS GET", "kinetic_aperture"],
    ["branded_wipe", "PULSE GAMING", "THE BREAKDOWN", "kinetic_aperture"],
    ["signal_scan_surface", claim, "THE SYSTEM CHANGE", "signal_lattice"],
    ["topology_node_field", claimTwo, "THE GAMEPLAY CHANGE", "signal_lattice"],
    ["waveform_scope_surface", claimThree, "THE PERFORMANCE FIX", "signal_lattice"],
    ["radar_sweep_surface", claimFour, "THE ONLINE FIX", "signal_lattice"],
    ["data_pulse_surface", claim, "THE NUMBERS", "data_ribbons"],
    ["comparative_bar_race", claimTwo, "BEFORE AND AFTER", "data_ribbons"],
    ["metric_ribbon_flow", claimThree, "THE PRACTICAL EFFECT", "data_ribbons"],
    ["timeline_cascade_surface", claimFour, "RELEASE TIMELINE", "data_ribbons"],
    ["orbital_cluster_surface", claim, "HOW IT CONNECTS", "spatial_orbits"],
    ["radial_phase_field", claimTwo, "THE BALANCE CHANGE", "spatial_orbits"],
    ["constellation_drift_surface", claimThree, "THE RULE CHANGE", "spatial_orbits"],
    ["trajectory_arc_surface", claimFour, "WHAT TO WATCH", "spatial_orbits"],
    ["animated_source_card", titleWords(source, 7), "OFFICIAL RELEASE NOTES", "editorial_support"],
    ["animated_quote_card", claim, "CONFIRMED CHANGE", "editorial_support"],
    ["stat_card", claimTwo, "PATCH DETAIL", "editorial_support"],
    ["platform_proof_card", claimThree, "SOURCE CHECKED", "editorial_support"],
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
      durationS: readableCardKind ? readableDuration : PRIMARY_PROCEDURAL_CLIP_DURATION_S,
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

function normaliseGeneratorVariant(value, variantCount) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || variantCount <= 0) return 0;
  return ((parsed % variantCount) + variantCount) % variantCount;
}

function kineticApertureFilter(generatorVariant = 0) {
  const variant = normaliseGeneratorVariant(generatorVariant, 5);
  if (variant !== 0) {
    const configs = {
      1: {
        background: "0x241A32",
        gridWidth: 54,
        gridHeight: 32,
        gridOpacity: "0.34",
        columns: 5,
        rows: 5,
        tileWidth: 112,
        tileHeight: 112,
        xOffset: 38,
        yOffset: 102,
        xStep: 216,
        yStep: 342,
        xAmplitude: 54,
        yAmplitude: 26,
        primary: "0xA78BFA",
        secondary: "0xFFB15C",
        tertiary: "0xF8FAFC",
        scanAxis: "horizontal",
      },
      2: {
        background: "0x103238",
        gridWidth: 40,
        gridHeight: 60,
        gridOpacity: "0.36",
        columns: 6,
        rows: 5,
        tileWidth: 96,
        tileHeight: 148,
        xOffset: 28,
        yOffset: 88,
        xStep: 180,
        yStep: 365,
        xAmplitude: 28,
        yAmplitude: 58,
        primary: "0x22D3A7",
        secondary: "0x38BDF8",
        tertiary: "0xF8FAFC",
        scanAxis: "vertical",
      },
      3: {
        background: "0x303322",
        gridWidth: 60,
        gridHeight: 40,
        gridOpacity: "0.37",
        columns: 6,
        rows: 5,
        tileWidth: 84,
        tileHeight: 160,
        xOffset: 42,
        yOffset: 66,
        xStep: 180,
        yStep: 370,
        xAmplitude: 62,
        yAmplitude: 22,
        primary: "0xD9F99D",
        secondary: "0xFF6B1A",
        tertiary: "0xF8FAFC",
        scanAxis: "horizontal",
      },
      4: {
        background: "0x263445",
        gridWidth: 32,
        gridHeight: 64,
        gridOpacity: "0.35",
        columns: 4,
        rows: 7,
        tileWidth: 130,
        tileHeight: 66,
        xOffset: 52,
        yOffset: 86,
        xStep: 270,
        yStep: 270,
        xAmplitude: 34,
        yAmplitude: 68,
        primary: "0xF8FAFC",
        secondary: "0xFF6B1A",
        tertiary: "0x38BDF8",
        scanAxis: "vertical",
      },
    };
    const config = configs[variant];
    const tiles = Array.from({ length: config.columns * config.rows }, (_, index) => {
      const column = index % config.columns;
      const row = Math.floor(index / config.columns);
      const x = config.xOffset + column * config.xStep;
      const y = config.yOffset + row * config.yStep;
      const phase = (index * (0.31 + variant * 0.07)).toFixed(2);
      const colours = [config.primary, config.secondary, config.tertiary];
      const colour = colours[index % colours.length];
      return `drawbox=x='${x}+sin(t*${(1.06 + column * 0.13 + variant * 0.05).toFixed(2)}+${phase})*${config.xAmplitude}':y='${y}+cos(t*${(0.92 + row * 0.08 + variant * 0.04).toFixed(2)}+${phase})*${config.yAmplitude}':w=${config.tileWidth}:h=${config.tileHeight}:color=${colour}@0.78:t=fill`;
    });
    const slats = Array.from({ length: 10 }, (_, index) => {
      const phase = (index * 0.43).toFixed(2);
      const colour = [config.primary, config.secondary, config.tertiary][index % 3];
      if (config.scanAxis === "horizontal") {
        const y = 46 + index * 192;
        return `drawbox=x='-420+mod(t*${330 + index * 17}+${phase}*140,2580)':y=${y}:w=420:h=48:color=${colour}@0.40:t=fill`;
      }
      const x = 24 + index * 114;
      return `drawbox=x=${x}:y='-420+mod(t*${320 + index * 21}+${phase}*130,2760)':w=46:h=420:color=${colour}@0.40:t=fill`;
    });
    const scanBands = config.scanAxis === "horizontal"
      ? [
          `drawbox=x=0:y='-260+mod(t*${520 + variant * 45},2440)':w=iw:h=210:color=${config.primary}@0.42:t=fill`,
          `drawbox=x=0:y='2060-mod(t*${410 + variant * 37},2360)':w=iw:h=150:color=${config.secondary}@0.36:t=fill`,
        ]
      : [
          `drawbox=x='-320+mod(t*${610 + variant * 41},2040)':y=0:w=260:h=ih:color=${config.primary}@0.42:t=fill`,
          `drawbox=x='1340-mod(t*${470 + variant * 29},1960)':y=0:w=190:h=ih:color=${config.secondary}@0.36:t=fill`,
        ];
    return [
      "format=yuv420p",
      `drawbox=x=0:y=0:w=iw:h=ih:color=${config.background}@1:t=fill`,
      `drawgrid=width=${config.gridWidth}:height=${config.gridHeight}:thickness=3:color=white@${config.gridOpacity}`,
      ...scanBands,
      ...tiles,
      ...slats,
      `drawbox=x='540-(220+mod(t*${180 + variant * 25},720))/2':y='960-(360+mod(t*${290 + variant * 31},1260))/2':w='220+mod(t*${180 + variant * 25},720)':h='360+mod(t*${290 + variant * 31},1260)':color=${config.tertiary}@0.34:t=8`,
      `drawbox=x='540-(110+mod(t*${270 + variant * 23},880))/2':y='960-(180+mod(t*${430 + variant * 37},1520))/2':w='110+mod(t*${270 + variant * 23},880)':h='180+mod(t*${430 + variant * 37},1520)':color=${config.secondary}@0.66:t=7`,
      config.scanAxis === "horizontal"
        ? `drawbox=x='-300+mod(t*${850 + variant * 35},1740)':y=222:w=300:h=24:color=${config.tertiary}@0.88:t=fill`
        : `drawbox=x=46:y='-460+mod(t*${650 + variant * 39},2480)':w=8:h=460:color=${config.secondary}@0.90:t=fill`,
    ].join(",");
  }
  const tiles = Array.from({ length: 24 }, (_, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = 42 + column * 270;
    const y = 92 + row * 300;
    const phase = (index * 0.41).toFixed(2);
    const colour = index % 3 === 0 ? "0xF8FAFC" : index % 3 === 1 ? "0xFFB15C" : "0x38BDF8";
    return `drawbox=x='${x}+sin(t*${(1.35 + column * 0.16).toFixed(2)}+${phase})*38':y='${y}+cos(t*${(1.08 + row * 0.09).toFixed(2)}+${phase})*46':w=160:h=84:color=${colour}@0.76:t=fill`;
  });
  const slats = Array.from({ length: 9 }, (_, index) => {
    const x = 34 + index * 126;
    const phase = (index * 0.47).toFixed(2);
    const colour = index % 3 === 0 ? "0xFFB15C" : index % 3 === 1 ? "0x38BDF8" : "0xF8FAFC";
    return `drawbox=x=${x}:y='-360+mod(t*${(310 + index * 19).toFixed(0)}+${phase}*120,2280)':w=58:h=360:color=${colour}@0.34:t=fill`;
  });
  return [
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x18263A@1:t=fill",
    "drawgrid=width=36:height=48:thickness=3:color=white@0.38",
    "drawbox=x='-420+mod(t*760,1920)':y=0:w=310:h=ih:color=0xFF6B1A@0.52:t=fill",
    "drawbox=x='1280-mod(t*540,1840)':y=0:w=210:h=ih:color=0x38BDF8@0.42:t=fill",
    "drawbox=x='-620+mod(t*880,2320)':y=180:w=620:h=280:color=white@0.20:t=fill",
    "drawbox=x='1120-mod(t*720,2040)':y=1280:w=520:h=340:color=0xFFB15C@0.30:t=fill",
    ...tiles,
    ...slats,
    "drawbox=x='540-(240+mod(t*210,620))/2':y='960-(420+mod(t*370,1120))/2':w='240+mod(t*210,620)':h='420+mod(t*370,1120)':color=white@0.32:t=8",
    "drawbox=x='540-(120+mod(t*310,820))/2':y='960-(220+mod(t*550,1480))/2':w='120+mod(t*310,820)':h='220+mod(t*550,1480)':color=0xFFB15C@0.62:t=7",
    "drawbox=x='-220+mod(t*920,1520)':y=260:w=220:h=26:color=white@0.84:t=fill",
    "drawbox=x='1080-mod(t*820,1480)':y=1510:w=300:h=22:color=0x38BDF8@0.86:t=fill",
    "drawbox=x=34:y='-420+mod(t*630,2340)':w=7:h=420:color=0xFF6B1A@0.88:t=fill",
  ].join(",");
}

function signalLatticeFilter(generatorVariant = 0) {
  const variant = normaliseGeneratorVariant(generatorVariant, 4);
  if (variant !== 0) {
    const configs = {
      1: {
        background: "0x1C1A38",
        gridWidth: 54,
        gridHeight: 36,
        gridOpacity: "0.35",
        columns: 6,
        rows: 6,
        nodeWidth: 108,
        nodeHeight: 44,
        xOffset: 28,
        yOffset: 88,
        xStep: 184,
        yStep: 308,
        primary: "0xA78BFA",
        secondary: "0x38BDF8",
        tertiary: "0xE2E8F0",
        beamAxis: "horizontal",
      },
      2: {
        background: "0x123729",
        gridWidth: 30,
        gridHeight: 64,
        gridOpacity: "0.36",
        columns: 9,
        rows: 5,
        nodeWidth: 48,
        nodeHeight: 92,
        xOffset: 24,
        yOffset: 72,
        xStep: 120,
        yStep: 382,
        primary: "0x22D3A7",
        secondary: "0xD9F99D",
        tertiary: "0xF8FAFC",
        beamAxis: "vertical",
      },
      3: {
        background: "0x27233B",
        gridWidth: 60,
        gridHeight: 30,
        gridOpacity: "0.37",
        columns: 5,
        rows: 8,
        nodeWidth: 84,
        nodeHeight: 54,
        xOffset: 54,
        yOffset: 48,
        xStep: 216,
        yStep: 238,
        primary: "0xF43F5E",
        secondary: "0x38BDF8",
        tertiary: "0xF8FAFC",
        beamAxis: "cross",
      },
    };
    const config = configs[variant];
    const matrix = Array.from({ length: config.columns * config.rows }, (_, index) => {
      const column = index % config.columns;
      const row = Math.floor(index / config.columns);
      const x = config.xOffset + column * config.xStep;
      const y = config.yOffset + row * config.yStep;
      const phase = (index * (0.23 + variant * 0.08)).toFixed(2);
      const colour = [config.tertiary, config.primary, config.secondary][index % 3];
      return `drawbox=x='${x}+sin(t*${(1.12 + column * 0.09 + variant * 0.06).toFixed(2)}+${phase})*${18 + variant * 7}':y='${y}+cos(t*${(0.94 + row * 0.06 + variant * 0.05).toFixed(2)}+${phase})*${24 + variant * 6}':w=${config.nodeWidth}:h=${config.nodeHeight}:color=${colour}@0.82:t=fill`;
    });
    const trace = Array.from({ length: 13 }, (_, index) => {
      const base = 90 + index * 74;
      const colour = index % 2 ? config.primary : config.secondary;
      if (config.beamAxis === "horizontal") {
        const y = 176 + (index % 5) * 352;
        return `drawbox=x='${base}+sin(t*${(4.2 + variant * 0.5).toFixed(1)}+${(index * 0.49).toFixed(2)})*86':y=${y}:w=72:h=24:color=${colour}@0.92:t=fill`;
      }
      return `drawbox=x=${base}:y='${220 + (index % 4) * 410}+sin(t*${(4.6 + variant * 0.4).toFixed(1)}+${(index * 0.53).toFixed(2)})*132':w=48:h=28:color=${colour}@0.92:t=fill`;
    });
    const beams = [];
    if (config.beamAxis !== "horizontal") {
      beams.push(
        `drawbox=x='-250+mod(t*${430 + variant * 40},1580)':y=0:w=220:h=ih:color=${config.primary}@0.34:t=fill`,
        `drawbox=x='1260-mod(t*${360 + variant * 35},1660)':y=0:w=160:h=ih:color=${config.secondary}@0.30:t=fill`,
      );
    }
    if (config.beamAxis !== "vertical") {
      beams.push(
        `drawbox=x=0:y='-260+mod(t*${470 + variant * 42},2440)':w=iw:h=220:color=${config.primary}@0.32:t=fill`,
        `drawbox=x=0:y='2140-mod(t*${390 + variant * 29},2500)':w=iw:h=150:color=${config.secondary}@0.28:t=fill`,
      );
    }
    return [
      "format=yuv420p",
      `drawbox=x=0:y=0:w=iw:h=ih:color=${config.background}@1:t=fill`,
      `drawgrid=width=${config.gridWidth}:height=${config.gridHeight}:thickness=3:color=white@${config.gridOpacity}`,
      ...beams,
      ...matrix,
      ...trace,
      `drawbox=x=58:y='620+sin(t*${(1.8 + variant * 0.3).toFixed(1)})*310':w=964:h=${4 + variant}:color=${config.tertiary}@0.68:t=fill`,
      `drawbox=x=58:y='1280+cos(t*${(1.5 + variant * 0.2).toFixed(1)})*290':w=964:h=${5 + variant}:color=${config.primary}@0.76:t=fill`,
    ].join(",");
  }
  const matrix = Array.from({ length: 48 }, (_, index) => {
    const column = index % 6;
    const row = Math.floor(index / 6);
    const x = 34 + column * 194;
    const y = 72 + row * 236;
    const phase = (index * 0.29).toFixed(2);
    const colour = index % 3 === 0 ? "0xE2E8F0" : index % 3 === 1 ? "0x22D3A7" : "0x38BDF8";
    return `drawbox=x='${x}+sin(t*${(1.28 + column * 0.11).toFixed(2)}+${phase})*24':y='${y}+cos(t*${(1.04 + row * 0.07).toFixed(2)}+${phase})*30':w=64:h=40:color=${colour}@0.82:t=fill`;
  });
  const trace = Array.from({ length: 11 }, (_, index) => {
    const x = 80 + index * 94;
    const baseY = 260 + (index % 4) * 390;
    return `drawbox=x=${x}:y='${baseY}+sin(t*5.4+${(index * 0.55).toFixed(2)})*120':w=62:h=24:color=0x22D3A7@0.92:t=fill`;
  });
  const nodes = Array.from({ length: 9 }, (_, index) => {
    const phase = (index * 0.83).toFixed(2);
    return `drawbox=x='500+sin(t*${(1.1 + index * 0.13).toFixed(2)}+${phase})*410':y='900+cos(t*${(0.9 + index * 0.11).toFixed(2)}+${phase})*720':w=42:h=42:color=0x38BDF8@0.88:t=fill`;
  });
  return [
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x12333A@1:t=fill",
    "drawgrid=width=45:height=48:thickness=3:color=white@0.34",
    "drawbox=x='mod(t*720,1380)-300':y=0:w=300:h=ih:color=0x22D3A7@0.30:t=fill",
    "drawbox=x=0:y='mod(t*620,2180)-260':w=iw:h=260:color=0x38BDF8@0.24:t=fill",
    "drawbox=x='mod(t*1560,1260)-180':y=0:w=180:h=ih:color=white@0.34:t=fill",
    "drawbox=x='1080-mod(t*1320,1260)':y=0:w=180:h=ih:color=0x38BDF8@0.38:t=fill",
    "drawbox=x='-220+mod(t*430,1520)':y=0:w=220:h=ih:color=0x22D3A7@0.34:t=fill",
    "drawbox=x='1180-mod(t*360,1580)':y=0:w=160:h=ih:color=0x38BDF8@0.30:t=fill",
    "drawbox=x='-460+mod(t*520,1980)':y=180:w=460:h=320:color=0xE2E8F0@0.20:t=fill",
    "drawbox=x='1140-mod(t*470,1860)':y=1260:w=420:h=380:color=0x22D3A7@0.28:t=fill",
    ...matrix,
    ...nodes,
    ...trace,
    "drawbox=x=72:y='720+sin(t*2.2)*260':w=936:h=5:color=white@0.62:t=fill",
    "drawbox=x=72:y='1160+cos(t*1.8)*240':w=936:h=5:color=0x22D3A7@0.72:t=fill",
    "scroll=horizontal=0.04:vertical=0.0015",
    "rotate='0.006*t':ow=iw:oh=ih:c=0x12333A",
  ].join(",");
}

function dataRibbonsFilter(generatorVariant = 0) {
  const variant = normaliseGeneratorVariant(generatorVariant, 4);
  if (variant === 1) {
    const rows = Array.from({ length: 9 }, (_, index) => {
      const y = 120 + index * 190;
      const phase = (index * 0.67).toFixed(2);
      const colour = index % 3 === 0 ? "0x38BDF8" : index % 3 === 1 ? "0xFFB15C" : "0xF43F5E";
      return [
        `drawbox=x=72:y=${y}:w=936:h=86:color=white@0.11:t=fill`,
        `drawbox=x=72:y=${y}:w='180+abs(sin(t*${(1.07 + index * 0.09).toFixed(2)}+${phase}))*756':h=86:color=${colour}@0.78:t=fill`,
        `drawbox=x='88+mod(t*${240 + index * 13}+${phase}*90,820)':y=${y + 18}:w=120:h=50:color=white@0.30:t=fill`,
      ];
    }).flat();
    return [
      "format=yuv420p",
      "drawbox=x=0:y=0:w=iw:h=ih:color=0x24364A@1:t=fill",
      "drawbox=x=0:y=0:w=iw:h=120:color=0x38BDF8@0.58:t=fill",
      "drawbox=x=0:y=1800:w=iw:h=120:color=0xF43F5E@0.58:t=fill",
      "drawgrid=width=48:height=72:thickness=2:color=white@0.24",
      ...rows,
      "drawbox=x=58:y=98:w=6:h=1720:color=white@0.62:t=fill",
      "drawbox=x='-420+mod(t*460,1920)':y=1780:w=420:h=28:color=0x38BDF8@0.84:t=fill",
    ].join(",");
  }
  if (variant === 2) {
    const laneSegments = Array.from({ length: 48 }, (_, index) => {
      const lane = Math.floor(index / 8);
      const segment = index % 8;
      const baseX = 42 + segment * 134;
      const baseY = 150 + lane * 300;
      const phase = (index * 0.37).toFixed(2);
      const colour = lane % 3 === 0 ? "0xF43F5E" : lane % 3 === 1 ? "0x38BDF8" : "0xFFB15C";
      return `drawbox=x='${baseX}+sin(t*${(1.18 + lane * 0.16).toFixed(2)}+${phase})*34':y='${baseY}+cos(t*${(0.88 + segment * 0.05).toFixed(2)}+${phase})*44':w=104:h=${44 + lane * 6}:color=${colour}@0.80:t=fill`;
    });
    return [
      "format=yuv420p",
      "drawbox=x=0:y=0:w=iw:h=ih:color=0x162433@1:t=fill",
      "drawgrid=width=36:height=96:thickness=2:color=white@0.27",
      "drawbox=x='-320+mod(t*390,1720)':y=0:w=260:h=ih:color=0x38BDF8@0.24:t=fill",
      ...laneSegments,
      "drawbox=x=42:y=112:w=996:h=5:color=white@0.58:t=fill",
      "drawbox=x=42:y=1810:w=996:h=5:color=0xFFB15C@0.72:t=fill",
    ].join(",");
  }
  if (variant === 3) {
    const cascade = Array.from({ length: 35 }, (_, index) => {
      const column = index % 5;
      const row = Math.floor(index / 5);
      const x = 48 + column * 208;
      const y = 80 + row * 262;
      const phase = (index * 0.51).toFixed(2);
      const colour = index % 3 === 0 ? "0xF8FAFC" : index % 3 === 1 ? "0xF43F5E" : "0x38BDF8";
      return `drawbox=x='${x}+sin(t*${(0.96 + column * 0.15).toFixed(2)}+${phase})*26':y='${y}+mod(t*${55 + row * 7}+${phase}*30,210)':w=${138 + (index % 2) * 24}:h=${72 + row * 5}:color=${colour}@0.78:t=fill`;
    });
    return [
      "format=yuv420p",
      "drawbox=x=0:y=0:w=iw:h=ih:color=0x281322@1:t=fill",
      "drawgrid=width=72:height=48:thickness=2:color=white@0.28",
      "drawbox=x=52:y=70:w=8:h=1770:color=0xF43F5E@0.82:t=fill",
      "drawbox=x='-520+mod(t*520,2220)':y=720:w=520:h=180:color=0xFFB15C@0.30:t=fill",
      ...cascade,
      "drawbox=x=72:y='-180+mod(t*330,2280)':w=936:h=8:color=white@0.72:t=fill",
    ].join(",");
  }
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

function spatialOrbitsFilter(generatorVariant = 0) {
  const variant = normaliseGeneratorVariant(generatorVariant, 4);
  const configs = [
    {
      background: "0x071C2B",
      primary: "0x67E8F9",
      secondary: "0xFACC15",
      tertiary: "0xF8FAFC",
      speed: 1.18,
      radiusScale: 1,
    },
    {
      background: "0x21152F",
      primary: "0xC084FC",
      secondary: "0xFB7185",
      tertiary: "0xF8FAFC",
      speed: 1.42,
      radiusScale: 0.86,
    },
    {
      background: "0x0D2D27",
      primary: "0x5EEAD4",
      secondary: "0xFDE047",
      tertiary: "0xCCFBF1",
      speed: 0.96,
      radiusScale: 1.12,
    },
    {
      background: "0x241B12",
      primary: "0xFB923C",
      secondary: "0x38BDF8",
      tertiary: "0xFFF7ED",
      speed: 1.31,
      radiusScale: 0.94,
    },
  ];
  const config = configs[variant];
  const orbitNodes = Array.from({ length: 32 }, (_, index) => {
    const ring = index % 4;
    const phase = (index * 0.79 + variant * 0.37).toFixed(2);
    const speed = (config.speed + ring * 0.13 + (index % 3) * 0.04).toFixed(2);
    const counterSpeed = (config.speed * 0.81 + ring * 0.09).toFixed(2);
    const radiusX = Math.round((150 + ring * 92) * config.radiusScale);
    const radiusY = Math.round((250 + ring * 148) * config.radiusScale);
    const size = 24 + (index % 4) * 8;
    const colour = [config.tertiary, config.primary, config.secondary][index % 3];
    return `drawbox=x='540+sin(t*${speed}+${phase})*${radiusX}-${Math.round(size / 2)}':y='960+cos(t*${counterSpeed}+${phase})*${radiusY}-${Math.round(size / 2)}':w=${size}:h=${size}:color=${colour}@0.88:t=fill`;
  });
  const trajectoryMarkers = Array.from({ length: 12 }, (_, index) => {
    const phase = (index * 0.53 + variant * 0.29).toFixed(2);
    const y = 160 + index * 142;
    const colour = index % 2 ? config.primary : config.secondary;
    return `drawbox=x='80+abs(sin(t*${(0.72 + index * 0.035).toFixed(3)}+${phase}))*860':y=${y}:w=${54 + (index % 3) * 18}:h=${8 + (index % 2) * 6}:color=${colour}@0.72:t=fill`;
  });
  return [
    "format=yuv420p",
    `drawbox=x=0:y=0:w=iw:h=ih:color=${config.background}@1:t=fill`,
    `drawgrid=width=${96 - variant * 8}:height=${112 + variant * 8}:thickness=10:color=${config.tertiary}@0.50`,
    `drawbox=x='540+sin(t*${(0.54 + variant * 0.07).toFixed(2)})*430-92':y=0:w=184:h=ih:color=${config.primary}@0.18:t=fill`,
    `drawbox=x=0:y='960+cos(t*${(0.47 + variant * 0.05).toFixed(2)})*720-70':w=iw:h=140:color=${config.secondary}@0.16:t=fill`,
    ...orbitNodes,
    ...trajectoryMarkers,
    `drawbox=x='540+sin(t*${(1.8 + variant * 0.18).toFixed(2)})*360-120':y='960+cos(t*${(1.42 + variant * 0.14).toFixed(2)})*610-18':w=240:h=36:color=${config.tertiary}@0.54:t=fill`,
    `drawbox=x=70:y='960+sin(t*${(0.84 + variant * 0.11).toFixed(2)})*650':w=940:h=5:color=${config.primary}@0.70:t=fill`,
    `drawbox=x='540+cos(t*${(0.66 + variant * 0.08).toFixed(2)})*420':y=120:w=6:h=1680:color=${config.secondary}@0.62:t=fill`,
    "scroll=horizontal=0.018:vertical=0.001",
    `rotate='0.004*t':ow=iw:oh=ih:c=${config.background}`,
  ].join(",");
}

function primaryTemporalCameraFilter(projectId = "", generatorVariant = 0) {
  const projectIds = PRIMARY_PROCEDURAL_PROJECT_KEYS.map(
    (key) => GENERATOR_PROJECTS[key].generator_project_id,
  );
  const projectIndex = Math.max(0, projectIds.indexOf(cleanText(projectId)));
  const variant = normaliseGeneratorVariant(generatorVariant, 5);
  const overscanWidths = [1320, 1360, 1280, 1340];
  const width = overscanWidths[projectIndex] || overscanWidths[0];
  const height = Math.round(width / (FRAME_WIDTH_PX / FRAME_HEIGHT_PX) / 2) * 2;
  const centreX = (width - FRAME_WIDTH_PX) / 2;
  const centreY = (height - FRAME_HEIGHT_PX) / 2;
  const phase = (projectIndex * 0.37 + variant * 0.29).toFixed(2);
  const xFrequency = (0.47 + projectIndex * 0.08 + variant * 0.017).toFixed(3);
  const yFrequency = (0.39 + projectIndex * 0.07 + variant * 0.013).toFixed(3);
  return [
    `scale=${width}:${height}:flags=lanczos`,
    `crop=${FRAME_WIDTH_PX}:${FRAME_HEIGHT_PX}:x='${centreX}+${centreX}*sin(t*${xFrequency}+${phase})':y='${centreY}+${centreY}*cos(t*${yFrequency}+${phase})'`,
    "setsar=1",
  ].join(",");
}

function buildOwnedMotionFfmpegArgs({ clip = {}, canonical = {}, output }) {
  const duration = clipDuration(clip);
  const font = fontOption();
  const layout = buildOwnedMotionFrameLayout({ clip, canonical });
  const blockById = Object.fromEntries(layout.text_blocks.map((block) => [block.id, block]));
  const projectId = cleanText(clip.generator_project_id);
  const generatorVariant = Number.isInteger(Number(clip.generator_variant))
    ? Number(clip.generator_variant)
    : ownedMotionVariant(clip);
  const proceduralFilter = projectId === GENERATOR_PROJECTS.kinetic_aperture.generator_project_id
    ? kineticApertureFilter(generatorVariant)
    : projectId === GENERATOR_PROJECTS.signal_lattice.generator_project_id
      ? signalLatticeFilter(generatorVariant)
      : projectId === GENERATOR_PROJECTS.data_ribbons.generator_project_id
        ? dataRibbonsFilter(generatorVariant)
        : projectId === GENERATOR_PROJECTS.spatial_orbits.generator_project_id
          ? spatialOrbitsFilter(generatorVariant)
          : "";
  const vf = proceduralFilter
    ? `${proceduralFilter},${primaryTemporalCameraFilter(projectId, generatorVariant)}`
    : [
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x080B12@1:t=fill",
    "drawbox=x='-260+mod(t*520,1540)':y=0:w=210:h=ih:color=white@0.045:t=fill",
    "drawbox=x='940-mod(t*380,1220)':y=0:w=86:h=ih:color=0xFF6B1A@0.050:t=fill",
    "drawbox=x=18:y='mod(t*240,1920)-420':w=3:h=420:color=0x38BDF8@0.34:t=fill",
    "drawbox=x=42:y=50:w=996:h=166:color=0x111827@0.54:t=fill",
    "drawbox=x=42:y=50:w=996:h=166:color=0xF8FAFC@0.14:t=2",
    "drawbox=x=42:y=50:w='if(lt(t,0.28),1,1+(996-1)*(t-0.28)/0.34)':h=4:color=0x38BDF8@0.92:t=fill",
    `drawtext=text='PULSE // BREAKDOWN':${font}:fontcolor=0x38BDF8:fontsize=18:x=74:y=82:shadowcolor=black@0.82:shadowx=3:shadowy=3`,
    `drawtext=text='SOURCED':${font}:fontcolor=white@0.72:fontsize=17:x=w-tw-68:y=82:shadowcolor=black@0.72:shadowx=2:shadowy=2`,
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
    generator_version: enrichedClip.generator_version,
    generator_master_sha256: enrichedClip.generator_master_sha256,
    generator_variant: enrichedClip.generator_variant,
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
    allowed_use: cleanText(
      enrichedClip.allowed_use ||
        enrichedClip.owned_generated_rights_grant?.allowed_use,
    ),
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
    clip.id,
    clip.path,
    clip.source_url,
    clip.media_kind,
    clip.source_type,
    clip.source_kind,
    clip.rights_basis,
    clip.licence_basis,
    clip.rights_risk_class,
    clip.provenance?.source,
    clip.provenance?.validation_reason,
  ].map(cleanText).join(" ").toLowerCase();
  if (
    text.includes("hyperframes") ||
    text.includes("owned_editorial_motion_graphic") ||
    text.includes("owned_explainer_motion")
  ) {
    return false;
  }
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

function normaliseBindingPath(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  return path.resolve(raw).replace(/\\/g, "/").toLowerCase();
}

function canonicalRightsSource(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  const canonicalMotionSource = canonicaliseMotionSourceUrl(raw);
  if (canonicalMotionSource) return canonicalMotionSource;
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
      .replace(/\/$/, "")
      .toLowerCase();
  } catch {
    return raw.replace(/\\/g, "/").replace(/[?#].*$/, "").toLowerCase();
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function directClipWindow(row = {}) {
  return {
    source: canonicalRightsSource(
      row.canonical_source_url || row.source_url || row.evidence_reference,
    ),
    start: finiteNumber(
      row.source_media_start_s ?? row.mediaStartS ?? row.media_start_s,
    ),
    duration: finiteNumber(
      row.source_window_duration_s ?? row.durationS ?? row.duration_s,
    ),
  };
}

function rightsEvidenceRows(rightsLedger = {}) {
  return [
    rightsLedger.assets,
    rightsLedger.rights_records,
    rightsLedger.rights_ledger,
    rightsLedger.records,
  ].reduce((rows, source) => mergeRecords(rows, asArray(source)), []);
}

function recordMatchesClipIdentity(record = {}, clip = {}) {
  const clipId = clipIdentity(clip);
  const recordIds = [
    record.asset_id,
    record.id,
    record.clip_id,
    record.rights_record_id,
  ].map(cleanText).filter(Boolean);
  if (clipId && recordIds.includes(clipId)) return true;
  const clipPath = normaliseBindingPath(
    clip.path || clip.local_materialized_path || clip.file_path,
  );
  const recordPaths = [record.path, record.local_path, record.file_path]
    .map(normaliseBindingPath)
    .filter(Boolean);
  return Boolean(clipPath && recordPaths.includes(clipPath));
}

async function directClipRightsBlockers(clip = {}, record = {}) {
  const blockers = [];
  const clipId = clipIdentity(clip);
  const recordIds = [
    record.asset_id,
    record.id,
    record.clip_id,
    record.rights_record_id,
  ].map(cleanText).filter(Boolean);
  if (!clipId || !recordIds.includes(clipId)) blockers.push("rights_record_asset_id_mismatch");

  const clipPath = cleanText(clip.path || clip.local_materialized_path || clip.file_path);
  const recordPath = cleanText(record.path || record.local_path || record.file_path);
  if (!clipPath || !recordPath || normaliseBindingPath(clipPath) !== normaliseBindingPath(recordPath)) {
    blockers.push("rights_record_path_mismatch");
  }

  let assetStat = null;
  let actualAssetSha256 = "";
  try {
    assetStat = await fs.stat(clipPath);
    if (!assetStat.isFile()) blockers.push("materialised_asset_not_file");
    else actualAssetSha256 = await sha256File(clipPath);
  } catch {
    blockers.push("materialised_asset_missing");
  }
  const clipSha256 = cleanText(
    clip.asset_sha256 ||
      clip.materialised_output_sha256 ||
      clip.materialized_file_evidence?.sha256,
  ).toLowerCase();
  const recordSha256 = cleanText(
    record.asset_sha256 ||
      record.materialised_output_sha256 ||
      record.materialized_file_evidence?.sha256,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(clipSha256)) blockers.push("materialised_asset_sha256_missing");
  if (!/^[a-f0-9]{64}$/.test(recordSha256)) blockers.push("rights_record_asset_sha256_missing");
  if (actualAssetSha256 && clipSha256 && actualAssetSha256 !== clipSha256) {
    blockers.push("materialised_asset_sha256_mismatch");
  }
  if (actualAssetSha256 && recordSha256 && actualAssetSha256 !== recordSha256) {
    blockers.push("rights_record_asset_sha256_mismatch");
  }

  const clipSize = finiteNumber(
    clip.asset_size_bytes ||
      clip.materialised_output_size_bytes ||
      clip.materialized_file_evidence?.size_bytes,
  );
  const recordSize = finiteNumber(
    record.asset_size_bytes ||
      record.materialised_output_size_bytes ||
      record.materialized_file_evidence?.size_bytes,
  );
  if (!clipSize || !recordSize) blockers.push("asset_size_binding_missing");
  if (assetStat && clipSize && clipSize !== assetStat.size) blockers.push("materialised_asset_size_mismatch");
  if (assetStat && recordSize && recordSize !== assetStat.size) blockers.push("rights_record_asset_size_mismatch");

  const clipWindow = directClipWindow(clip);
  const recordWindow = directClipWindow(record);
  if (!clipWindow.source || !recordWindow.source || clipWindow.source !== recordWindow.source) {
    blockers.push("rights_record_source_mismatch");
  }
  if (clipWindow.start == null || recordWindow.start == null) {
    blockers.push("rights_record_source_start_missing");
  } else if (Math.abs(clipWindow.start - recordWindow.start) >= 0.01) {
    blockers.push("rights_record_source_start_mismatch");
  }
  if (clipWindow.duration == null || recordWindow.duration == null) {
    blockers.push("rights_record_source_duration_missing");
  } else if (Math.abs(clipWindow.duration - recordWindow.duration) >= 0.01) {
    blockers.push("rights_record_source_duration_mismatch");
  }

  const licenceBasis = cleanText(record.licence_basis || record.license_basis || record.rights_basis);
  const allowedUse = cleanText(record.allowed_use || record.allowed_render_use).toLowerCase();
  if (!licenceBasis) blockers.push("rights_record_licence_basis_missing");
  if (!allowedUse || /reference[_ -]?only|not[_ -]?cleared|prohibited/.test(allowedUse)) {
    blockers.push("rights_record_allowed_use_not_affirmative");
  }
  if (record.commercial_use_allowed !== true) blockers.push("commercial_use_not_affirmative");
  if (record.rights_grant !== true) blockers.push("rights_grant_not_affirmative");
  if (!asArray(record.allowed_platforms).length) blockers.push("rights_record_platform_scope_missing");
  const riskScore = finiteNumber(record.risk_score);
  if (riskScore == null || riskScore >= 0.6) blockers.push("rights_record_risk_not_acceptable");

  const evidencePath = cleanText(
    record.evidence_file || record.rights_evidence_file || record.permission_evidence,
  );
  const evidenceSha256 = cleanText(
    record.evidence_sha256 || record.rights_evidence_sha256,
  ).toLowerCase();
  const evidenceSize = finiteNumber(
    record.evidence_size_bytes || record.rights_evidence_size_bytes,
  );
  if (!evidencePath) blockers.push("rights_evidence_file_missing");
  if (!/^[a-f0-9]{64}$/.test(evidenceSha256)) blockers.push("rights_evidence_sha256_missing");
  if (!evidenceSize) blockers.push("rights_evidence_size_missing");
  if (evidencePath) {
    try {
      const evidenceStat = await fs.stat(evidencePath);
      if (!evidenceStat.isFile()) blockers.push("rights_evidence_not_file");
      else {
        const actualEvidenceSha256 = await sha256File(evidencePath);
        if (evidenceSha256 && actualEvidenceSha256 !== evidenceSha256) {
          blockers.push("rights_evidence_sha256_mismatch");
        }
        if (evidenceSize && evidenceStat.size !== evidenceSize) {
          blockers.push("rights_evidence_size_mismatch");
        }
      }
    } catch {
      blockers.push("rights_evidence_file_missing");
    }
  }
  return unique(blockers);
}

async function partitionRightsClearedDirectClips(clips = [], rightsLedger = {}) {
  const records = rightsEvidenceRows(rightsLedger);
  const preserved = [];
  const quarantined = [];
  for (const clip of asArray(clips)) {
    const candidates = records.filter((record) => recordMatchesClipIdentity(record, clip));
    if (!candidates.length) {
      quarantined.push({
        clip_id: clipIdentity(clip) || null,
        path: cleanText(clip.path || clip.local_materialized_path || clip.file_path) || null,
        source_url: cleanText(clip.source_url) || null,
        source_media_start_s: directClipWindow(clip).start,
        source_window_duration_s: directClipWindow(clip).duration,
        reason: "non_owned_direct_video_rights_unverified",
        blockers: ["matching_rights_record_missing"],
      });
      continue;
    }
    let accepted = false;
    const candidateBlockers = [];
    for (const record of candidates) {
      const blockers = await directClipRightsBlockers(clip, record);
      if (!blockers.length) {
        accepted = true;
        break;
      }
      candidateBlockers.push(...blockers);
    }
    if (accepted) preserved.push(normaliseReadyDirectVideoClip(clip));
    else {
      quarantined.push({
        clip_id: clipIdentity(clip) || null,
        path: cleanText(clip.path || clip.local_materialized_path || clip.file_path) || null,
        source_url: cleanText(clip.source_url) || null,
        source_media_start_s: directClipWindow(clip).start,
        source_window_duration_s: directClipWindow(clip).duration,
        reason: "non_owned_direct_video_rights_unverified",
        blockers: unique(candidateBlockers),
      });
    }
  }
  return { preserved, quarantined };
}

function directMotionPublishRightsState(clips = [], rightsLedger = {}) {
  const records = rightsEvidenceRows(rightsLedger);
  let livePublishHeld = false;
  let humanLegalReviewRequired = false;
  for (const clip of asArray(clips)) {
    const rows = [
      clip,
      ...records.filter((record) => recordMatchesClipIdentity(record, clip)),
    ];
    for (const row of rows) {
      const approvalStatus = cleanText(row.approval_status).toLowerCase();
      const usageStatus = cleanText(row.usage_status || row.usage_scope).toLowerCase();
      if (
        row.live_publish_allowed === false ||
        /local[_ -]?materiali[sz]ation[_ -]?only/.test(approvalStatus) ||
        /human[_ -]?legal[_ -]?review[_ -]?required[_ -]?before[_ -]?publish/.test(usageStatus)
      ) {
        livePublishHeld = true;
      }
      if (
        row.requires_human_legal_review_before_publish === true ||
        row.human_legal_review_required_before_publish === true ||
        /human[_ -]?legal[_ -]?review[_ -]?required[_ -]?before[_ -]?publish/.test(usageStatus)
      ) {
        humanLegalReviewRequired = true;
        livePublishHeld = true;
      }
    }
  }
  const publishBlockers = [];
  if (livePublishHeld) publishBlockers.push("rights:direct_motion_live_publish_hold");
  if (humanLegalReviewRequired) {
    publishBlockers.push("rights:human_legal_review_required_before_publish");
  }
  return {
    livePublishHeld,
    humanLegalReviewRequired,
    publishBlockers,
  };
}

function hasHardRightsBlock(rightsLedger = {}, failures = []) {
  const hardStates = new Set(["blocked", "fail", "failed", "red"]);
  return Boolean(
    asArray(failures).length ||
      hardStates.has(cleanText(rightsLedger.verdict).toLowerCase()) ||
      hardStates.has(cleanText(rightsLedger.status).toLowerCase()),
  );
}

function mergeDirectClipQuarantineRows(...sources) {
  const rows = [];
  const byKey = new Map();
  for (const source of sources) {
    for (const row of asArray(source)) {
      const normalised = {
        clip_id: cleanText(row.clip_id || row.asset_id || row.id) || null,
        path: cleanText(row.path || row.local_path) || null,
        source_url: cleanText(row.source_url) || null,
        source_media_start_s: finiteNumber(
          row.source_media_start_s ?? row.mediaStartS ?? row.media_start_s,
        ),
        source_window_duration_s: finiteNumber(
          row.source_window_duration_s ?? row.durationS ?? row.duration_s,
        ),
        reason: cleanText(row.reason) || "non_owned_direct_video_rights_unverified",
        blockers: unique(asArray(row.blockers).map(cleanText)),
      };
      const key = cleanText(normalised.clip_id || normaliseBindingPath(normalised.path));
      if (!key) continue;
      if (byKey.has(key)) {
        const index = byKey.get(key);
        rows[index] = {
          ...rows[index],
          ...normalised,
          blockers: unique([...rows[index].blockers, ...normalised.blockers]),
        };
      } else {
        byKey.set(key, rows.length);
        rows.push(normalised);
      }
    }
  }
  return rows;
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
      generator_version: Number(clip.generator_version || 1),
      generator_master_sha256: cleanText(clip.generator_master_sha256),
      generator_variant: Number(clip.generator_variant || 0),
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
    generator_version: Number(clip.generator_version || 1),
    generator_master_sha256: cleanText(clip.generator_master_sha256),
    generator_variant: Number(clip.generator_variant || 0),
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
    generator_variant: Number(clip.generator_variant || 0),
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
      minimum_required_materially_distinct_generator_projects:
        PRIMARY_PROCEDURAL_PROJECT_KEYS.length,
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
  const directVideoCandidates = sourceSafetyBlocked
    ? []
    : mergeClipRows([
        ...asArray(existingMaterialisedMotion.clips),
        ...asArray(existingMaterialisedMotion.materialised_clips),
        ...clipsFromFootageInventory(footageInventory),
      ], []).filter(isReadyDirectVideoClip);
  const directVideoRights = sourceSafetyBlocked
    ? { preserved: [], quarantined: [] }
    : await partitionRightsClearedDirectClips(directVideoCandidates, rightsLedger);
  const preservedDirectVideoClips = directVideoRights.preserved;
  const quarantinedDirectVideoClips = directVideoRights.quarantined;
  const quarantinedDirectVideoAudit = mergeDirectClipQuarantineRows(
    existingMaterialisedMotion.quarantined_direct_video_clips,
    footageInventory.motion_inventory?.quarantined_direct_video_clips,
    rightsLedger.quarantined_assets,
    quarantinedDirectVideoClips,
  );
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
  const existingRecords = [
    rightsLedger.assets,
    rightsLedger.rights_records,
    rightsLedger.rights_ledger,
    rightsLedger.records,
  ].reduce(
    (merged, rows) => mergeRecords(merged, asArray(rows)),
    [],
  );
  const quarantinedCandidateClips = directVideoCandidates.filter((clip) =>
    quarantinedDirectVideoClips.some((quarantined) => quarantined.clip_id === clipIdentity(clip)),
  );
  const isQuarantinedRightsRow = (record) => quarantinedCandidateClips.some((clip) =>
    recordMatchesClipIdentity(record, clip),
  );
  const retainedExistingRecords = existingRecords.filter((record) => !isQuarantinedRightsRow(record));
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
        quarantined_direct_video_clip_count: quarantinedDirectVideoAudit.length,
        quarantined_direct_video_clips: quarantinedDirectVideoAudit,
        owned_motion_materialized_at: generatedAt,
      };
  const directPublishRights = directMotionPublishRightsState(
    preservedDirectVideoClips,
    rightsLedger,
  );
  const footagePublishBlockers = unique([
    ...asArray(footageInventory.publish_blockers),
    ...asArray(footageInventory.readiness?.publish_blockers),
    ...directPublishRights.publishBlockers,
  ]);
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
    ...(directPublishRights.livePublishHeld
      ? {
          live_publish_allowed: false,
          requires_human_legal_review_before_publish:
            directPublishRights.humanLegalReviewRequired,
          publish_blockers: footagePublishBlockers,
          readiness: {
            ...(footageInventory.readiness || {}),
            can_publish: false,
            publish_blockers: footagePublishBlockers,
          },
        }
      : {}),
  };
  const mergedRecords = mergeRecords(retainedExistingRecords, records);
  const retainedRightsAssets = asArray(rightsLedger.assets).filter((record) => !isQuarantinedRightsRow(record));
  const retainedMatchedAssets = asArray(rightsLedger.matched_assets).filter((record) => !isQuarantinedRightsRow(record));
  const quarantineWarnings = quarantinedDirectVideoClips.map(
    (clip) => `owned_motion_quarantine:${clip.clip_id || "unknown"}:${clip.blockers.join(",")}`,
  );
  const remainingRightsFailures = asArray(rightsLedger.failures).filter(
    (failure) => cleanText(failure) !== "rights:no_rights_record",
  );
  const hardRightsBlocked = sourceSafetyBlocked || hasHardRightsBlock(
    rightsLedger,
    remainingRightsFailures,
  );
  const rightsVerdict = hardRightsBlocked
    ? "blocked"
    : directPublishRights.livePublishHeld
      ? "amber"
      : "pass";
  const rightsPublishBlockers = unique([
    ...asArray(rightsLedger.publish_blockers),
    ...directPublishRights.publishBlockers,
  ]);
  const updatedRights = {
    ...rightsLedger,
    status: hardRightsBlocked
      ? "blocked"
      : directPublishRights.livePublishHeld
        ? "local_materialization_only"
        : cleanText(rightsLedger.status || "ready"),
    verdict: rightsVerdict,
    motion_rights_verdict: rightsVerdict,
    failures: remainingRightsFailures,
    warnings: unique([...asArray(rightsLedger.warnings).map(cleanText), ...quarantineWarnings]),
    publish_blockers: rightsPublishBlockers,
    ...(hardRightsBlocked || directPublishRights.livePublishHeld
      ? {
          live_publish_allowed: false,
          requires_human_legal_review_before_publish:
            directPublishRights.humanLegalReviewRequired ||
            rightsLedger.requires_human_legal_review_before_publish === true,
        }
      : {}),
    assets: mergeRecords(retainedRightsAssets, records),
    records: mergedRecords,
    rights_ledger: mergedRecords,
    ...(Array.isArray(rightsLedger.rights_records)
      ? { rights_records: mergedRecords }
      : {}),
    matched_assets: mergeRecords(retainedMatchedAssets, records.map((record) => ({
      asset_id: record.asset_id,
      kind: "owned_generated_motion_graphic",
      path: record.path,
      source_url: record.source_url,
      rights_record_id: record.asset_id,
      licence_basis: record.licence_basis,
      risk_score: record.risk_score,
    }))),
    quarantined_assets: mergeRecords(
      rightsLedger.quarantined_assets,
      quarantinedDirectVideoClips.map((clip) => ({
        asset_id: clip.clip_id,
        kind: "direct_video",
        path: clip.path,
        source_url: clip.source_url,
        source_media_start_s: clip.source_media_start_s,
        source_window_duration_s: clip.source_window_duration_s,
        reason: clip.reason,
        blockers: clip.blockers,
        excluded_from_motion_readiness: true,
      })),
    ),
    quarantined_non_owned_direct_video_count: quarantinedDirectVideoAudit.length,
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
    quarantined_direct_video_clip_count: quarantinedDirectVideoAudit.length,
    quarantined_direct_video_clips: quarantinedDirectVideoAudit,
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
      minimum_required_materially_distinct_generator_projects:
        PRIMARY_PROCEDURAL_PROJECT_KEYS.length,
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
  return {
    preserved_direct_video_clips: preservedDirectVideoClips,
    quarantined_direct_video_clips: quarantinedDirectVideoClips,
  };
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
    const explainerClipPlan = ownedExplainerClipPlan({
      storyId: cleanText(job.story_id),
      canonical,
      artifactDir,
    });
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
      const evidenceUpdate = await updateOwnedMotionEvidence({
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
      const quarantinedDirectClips = asArray(evidenceUpdate?.quarantined_direct_video_clips);
      const quarantinedClipIds = new Set(quarantinedDirectClips.map((clip) => cleanText(clip.clip_id)));
      for (let index = skipped.length - 1; index >= 0; index -= 1) {
        if (
          skipped[index].reason === "not_owned_generated_motion" &&
          quarantinedClipIds.has(cleanText(skipped[index].clip_id))
        ) {
          skipped.splice(index, 1);
        }
      }
      skipped.push(...quarantinedDirectClips.map((clip) => ({
        clip_id: clip.clip_id,
        path: clip.path,
        source_url: clip.source_url,
        reason: clip.reason,
        blockers: clip.blockers,
      })));
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
    (sum, story) => sum + story.skipped.filter((item) =>
      item.reason === "not_owned_generated_motion" ||
      item.reason === "non_owned_direct_video_rights_unverified",
    ).length,
    0,
  );
  const quarantinedDirectVideoCount = stories.reduce(
    (sum, story) => sum + story.skipped.filter(
      (item) => item.reason === "non_owned_direct_video_rights_unverified",
    ).length,
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
      quarantined_direct_video_clip_count: quarantinedDirectVideoCount,
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
  canonicalRightsSource,
  isOwnedGeneratedMotion,
  materializeGoalOwnedMotionClips,
  renderGoalOwnedMotionMaterializationMarkdown,
  writeGoalOwnedMotionMaterializationReport,
  workOrderHasNonOwnedMotionJobs,
  workOrderHasOwnedMotionJobs,
};
