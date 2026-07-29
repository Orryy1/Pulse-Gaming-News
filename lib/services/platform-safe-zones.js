"use strict";

const PLATFORM_SAFE_ZONE_SCHEMA =
  "pulse-platform-safe-zone-contract-v1";
const AUDIT_SCHEMA = "pulse-platform-safe-zone-audit-v1";
const CROSS_PLATFORM_PORTRAIT_PROFILE_ID =
  "portrait-cross-platform-strict-v1";
const LONGFORM_PROFILE_ID = "longform-16x9-strict-v1";

const PORTRAIT_CANVAS = Object.freeze({
  width: 1080,
  height: 1920,
});
const LONGFORM_CANVAS = Object.freeze({
  width: 1920,
  height: 1080,
});

const OFFICIAL_GUIDANCE = Object.freeze([
  Object.freeze({
    platform: "youtube",
    url: "https://support.google.com/google-ads/answer/9128498",
    scope:
      "Google documents a 1080x1920 vertical-video safe area because controls and overlays can move between inventory surfaces.",
  }),
  Object.freeze({
    platform: "tiktok",
    url: "https://ads.tiktok.com/business/library/TikTok_CreativeCodes_May2023.pdf",
    scope:
      "TikTok requires 9:16 framing and asks creators to keep meaningful content clear of its player UI.",
  }),
  Object.freeze({
    platform: "meta",
    url: "https://www.facebook.com/business/ads/facebook-instagram-reels-ads",
    scope:
      "Meta recommends keeping key messages inside its Reels safe zone.",
  }),
  Object.freeze({
    platform: "x",
    url: "https://business.x.com/en/help/campaign-setup/creative-ad-specifications",
    scope:
      "X supports a 1080x1920 immersive vertical player and a 1920x1080 video surface.",
  }),
]);

function rectFromInsets(canvas, insets) {
  return {
    x: insets.left,
    y: insets.top,
    width: canvas.width - insets.left - insets.right,
    height: canvas.height - insets.top - insets.bottom,
  };
}

function createProfile({
  id,
  format,
  canvas,
  insets,
  coveredSurfaces,
  geometryMethod,
  editorialBuffer = null,
} = {}) {
  return Object.freeze({
    schema_version: PLATFORM_SAFE_ZONE_SCHEMA,
    id,
    format,
    canvas: Object.freeze({ ...canvas }),
    insets: Object.freeze({ ...insets }),
    safe_rect: Object.freeze(rectFromInsets(canvas, insets)),
    covered_surfaces: Object.freeze([...coveredSurfaces]),
    geometry_method: geometryMethod,
    editorial_buffer: editorialBuffer
      ? Object.freeze({ ...editorialBuffer })
      : null,
    guidance: OFFICIAL_GUIDANCE,
    guarantee:
      "Conservative production envelope, not a vendor guarantee. Player chrome can vary by device, locale, account state and product update.",
  });
}

const PLATFORM_PROFILES = Object.freeze({
  "youtube-shorts-portrait-v1": createProfile({
    id: "youtube-shorts-portrait-v1",
    format: "9:16",
    canvas: PORTRAIT_CANVAS,
    insets: { left: 72, top: 192, right: 192, bottom: 432 },
    coveredSurfaces: ["youtube_shorts"],
    geometryMethod:
      "Conservative internal envelope aligned to Google's movable-overlay guidance.",
  }),
  "tiktok-portrait-v1": createProfile({
    id: "tiktok-portrait-v1",
    format: "9:16",
    canvas: PORTRAIT_CANVAS,
    insets: { left: 72, top: 192, right: 216, bottom: 480 },
    coveredSurfaces: ["tiktok"],
    geometryMethod:
      "Conservative internal envelope reserving the right action rail and lower caption/player region.",
  }),
  "instagram-reels-portrait-v1": createProfile({
    id: "instagram-reels-portrait-v1",
    format: "9:16",
    canvas: PORTRAIT_CANVAS,
    insets: { left: 72, top: 192, right: 216, bottom: 456 },
    coveredSurfaces: ["instagram_reels"],
    geometryMethod:
      "Conservative internal envelope aligned to Meta's Reels safe-zone guidance.",
  }),
  "facebook-reels-portrait-v1": createProfile({
    id: "facebook-reels-portrait-v1",
    format: "9:16",
    canvas: PORTRAIT_CANVAS,
    insets: { left: 72, top: 192, right: 216, bottom: 480 },
    coveredSurfaces: ["facebook_reels"],
    geometryMethod:
      "Conservative internal envelope aligned to Meta's Reels safe-zone guidance.",
  }),
  "x-vertical-video-v1": createProfile({
    id: "x-vertical-video-v1",
    format: "9:16",
    canvas: PORTRAIT_CANVAS,
    insets: { left: 64, top: 180, right: 192, bottom: 432 },
    coveredSurfaces: ["x_vertical_video"],
    geometryMethod:
      "Conservative internal envelope for X's immersive 1080x1920 player.",
  }),
  [CROSS_PLATFORM_PORTRAIT_PROFILE_ID]: createProfile({
    id: CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
    format: "9:16",
    canvas: PORTRAIT_CANVAS,
    insets: { left: 96, top: 240, right: 264, bottom: 504 },
    coveredSurfaces: [
      "youtube_shorts",
      "tiktok",
      "instagram_reels",
      "facebook_reels",
      "x_vertical_video",
    ],
    geometryMethod:
      "Maximum platform-specific inset on each edge plus a 24px left, 48px top, 48px right and 24px bottom editorial uncertainty buffer.",
    editorialBuffer: {
      left: 24,
      top: 48,
      right: 48,
      bottom: 24,
    },
  }),
  [LONGFORM_PROFILE_ID]: createProfile({
    id: LONGFORM_PROFILE_ID,
    format: "16:9",
    canvas: LONGFORM_CANVAS,
    insets: { left: 144, top: 96, right: 144, bottom: 168 },
    coveredSurfaces: [
      "youtube_watch",
      "facebook_video",
      "x_video",
    ],
    geometryMethod:
      "Conservative 16:9 title/action envelope reserving watch-page controls, captions and edge cropping.",
  }),
});

class PlatformSafeZoneError extends Error {
  constructor(codes) {
    const unique = [
      ...new Set((Array.isArray(codes) ? codes : [codes]).filter(Boolean)),
    ];
    super(`platform_safe_zone_validation_failed: ${unique.join(", ")}`);
    this.name = "PlatformSafeZoneError";
    this.codes = unique;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPlatformSafeZoneProfile(profileId) {
  const profile = PLATFORM_PROFILES[String(profileId || "").trim()];
  if (!profile) {
    throw new PlatformSafeZoneError("platform_safe_zone_profile_unknown");
  }
  return clone(profile);
}

function sameObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finiteBox(box) {
  return (
    box &&
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0
  );
}

function boxWithin(box, rect) {
  return (
    box.x >= rect.x &&
    box.y >= rect.y &&
    box.x + box.width <= rect.x + rect.width &&
    box.y + box.height <= rect.y + rect.height
  );
}

function getAssCaptionSafeZoneContract(profileId) {
  const profile = getPlatformSafeZoneProfile(profileId);
  const portrait = profile.format === "9:16";
  const captionRect = portrait
    ? {
        x: profile.safe_rect.x,
        y:
          profile.id === CROSS_PLATFORM_PORTRAIT_PROFILE_ID
            ? 1040
            : Math.round(
                profile.safe_rect.y +
                  profile.safe_rect.height * 0.68,
              ),
        width: profile.safe_rect.width,
        height: 200,
      }
    : {
        x: profile.safe_rect.x,
        y: 650,
        width: profile.safe_rect.width,
        height: 180,
      };
  const anchor = portrait
    ? {
        x: Math.round(
          profile.safe_rect.x + profile.safe_rect.width / 2,
        ),
        y: captionRect.y + 160,
        alignment: 2,
      }
    : {
        x: Math.round(
          profile.safe_rect.x + profile.safe_rect.width / 2,
        ),
        y: captionRect.y + 150,
        alignment: 2,
      };
  if (!boxWithin(captionRect, profile.safe_rect)) {
    throw new PlatformSafeZoneError(
      "ass_caption_rect_outside_safe_rect",
    );
  }
  return {
    schema_version: PLATFORM_SAFE_ZONE_SCHEMA,
    profile_id: profile.id,
    canvas: profile.canvas,
    safe_rect: profile.safe_rect,
    caption_rect: captionRect,
    anchor,
    font_size: portrait ? 78 : 64,
    emphasis_font_size: portrait ? 88 : 72,
    outline: portrait ? 5 : 4,
    shadow: portrait ? 3 : 2,
    margin_left: profile.insets.left,
    margin_right: profile.insets.right,
    margin_vertical: profile.canvas.height - anchor.y,
    max_phrase_chars: portrait ? 12 : 32,
    max_words_per_phrase: portrait ? 2 : 6,
    peak_scale_percent: 115,
    width_estimation_ratio: 0.55,
  };
}

function parseAssStyle(line) {
  const values = String(line || "")
    .replace(/^Style:\s*/i, "")
    .split(",")
    .map((value) => value.trim());
  return {
    name: values[0],
    font_size: Number(values[2]),
    outline: Number(values[16]),
    shadow: Number(values[17]),
    alignment: Number(values[18]),
    margin_left: Number(values[19]),
    margin_right: Number(values[20]),
    margin_vertical: Number(values[21]),
  };
}

function visibleAssText(dialogueLine) {
  const fields = String(dialogueLine || "").split(",");
  const raw = fields.slice(9).join(",");
  return raw
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\[hH]/g, " ")
    .replace(/\\N/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateAssCaptionSafeZone({
  ass,
  profileId = CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
} = {}) {
  const contract = getAssCaptionSafeZoneContract(profileId);
  const source = String(ass || "");
  const errors = [];
  const playResX = Number(
    source.match(/^PlayResX:\s*(\d+)\s*$/im)?.[1],
  );
  const playResY = Number(
    source.match(/^PlayResY:\s*(\d+)\s*$/im)?.[1],
  );
  if (
    playResX !== contract.canvas.width ||
    playResY !== contract.canvas.height
  ) {
    errors.push("ass_caption_canvas_mismatch");
  }

  const styles = new Map(
    source
      .split(/\r?\n/)
      .filter((line) => /^Style:\s*/i.test(line))
      .map((line) => {
        const style = parseAssStyle(line);
        return [style.name, style];
      }),
  );
  for (const [name, fontSize] of [
    ["Pop", contract.font_size],
    ["PopEmphasis", contract.emphasis_font_size],
  ]) {
    const style = styles.get(name);
    if (!style) {
      errors.push(`ass_caption_style_missing:${name}`);
      continue;
    }
    if (
      style.font_size !== fontSize ||
      style.outline !== contract.outline ||
      style.shadow !== contract.shadow ||
      style.alignment !== contract.anchor.alignment ||
      style.margin_left !== contract.margin_left ||
      style.margin_right !== contract.margin_right ||
      style.margin_vertical !== contract.margin_vertical
    ) {
      errors.push(`ass_caption_style_contract_mismatch:${name}`);
    }
  }

  const dialogues = source
    .split(/\r?\n/)
    .filter((line) => /^Dialogue:\s*/i.test(line));
  if (!dialogues.length) errors.push("ass_caption_dialogue_required");
  const anchorPattern = new RegExp(
    `\\\\an${contract.anchor.alignment}(?:[^}]*)\\\\pos\\(${contract.anchor.x},${contract.anchor.y}\\)`,
  );
  for (const dialogue of dialogues) {
    const visible = visibleAssText(dialogue);
    if (!anchorPattern.test(dialogue) || /\\move\s*\(/i.test(dialogue)) {
      errors.push("ass_caption_anchor_mismatch");
    }
    if (visible.length > contract.max_phrase_chars) {
      errors.push("ass_caption_phrase_too_long");
    }
  }
  const estimatedPeakGlyphWidth =
    contract.emphasis_font_size *
    (contract.peak_scale_percent / 100) *
    contract.width_estimation_ratio;
  const estimatedPeakLineWidth = Math.ceil(
    estimatedPeakGlyphWidth * contract.max_phrase_chars +
      contract.outline * 2,
  );
  if (estimatedPeakLineWidth > contract.caption_rect.width) {
    errors.push("ass_caption_estimated_width_exceeds_safe_rect");
  }

  if (errors.length) throw new PlatformSafeZoneError(errors);
  return {
    verdict: "GREEN",
    profile_id: contract.profile_id,
    canvas: contract.canvas,
    safe_rect: contract.safe_rect,
    caption_rect: contract.caption_rect,
    anchor: contract.anchor,
    dialogue_count: dialogues.length,
    max_phrase_chars: contract.max_phrase_chars,
    estimated_peak_line_width: estimatedPeakLineWidth,
    external_publish_authorised: false,
  };
}

function validatePlatformSafeZoneAudit({ audit } = {}) {
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) {
    throw new PlatformSafeZoneError(
      "platform_safe_zone_audit_object_required",
    );
  }
  const errors = [];
  if (audit.schema_version !== AUDIT_SCHEMA) {
    errors.push("platform_safe_zone_audit_schema_invalid");
  }

  let profile = null;
  try {
    profile = getPlatformSafeZoneProfile(audit.profile_id);
  } catch {
    errors.push("platform_safe_zone_profile_unknown");
  }
  if (profile) {
    if (!sameObject(audit.canvas, profile.canvas)) {
      errors.push("platform_safe_zone_canvas_mismatch");
    }
    if (!sameObject(audit.safe_rect, profile.safe_rect)) {
      errors.push("platform_safe_zone_rect_mismatch");
    }
    if (!sameObject(audit.covered_surfaces, profile.covered_surfaces)) {
      errors.push("platform_safe_zone_surfaces_mismatch");
    }
  }

  if (!String(audit.story_id || "").trim()) {
    errors.push("platform_safe_zone_story_id_required");
  }
  if (!Array.isArray(audit.elements) || audit.elements.length === 0) {
    errors.push("platform_safe_zone_elements_required");
  }

  const ids = new Set();
  const selectors = new Set();
  for (const element of Array.isArray(audit.elements)
    ? audit.elements
    : []) {
    const id = String(element?.id || "").trim();
    const selector = String(element?.selector || "").trim();
    const role = String(element?.role || "").trim();
    if (!id) errors.push("platform_safe_zone_element_id_required");
    if (ids.has(id)) {
      errors.push(`platform_safe_zone_element_id_duplicate:${id}`);
    }
    ids.add(id);
    if (!selector) {
      errors.push(`platform_safe_zone_element_selector_required:${id}`);
    }
    if (selectors.has(selector)) {
      errors.push(
        `platform_safe_zone_element_selector_duplicate:${selector}`,
      );
    }
    selectors.add(selector);
    if (!role) {
      errors.push(`platform_safe_zone_element_role_required:${id}`);
    }
    if (!finiteBox(element?.bbox)) {
      errors.push(`platform_safe_zone_element_bbox_invalid:${id}`);
    } else if (profile && !boxWithin(element.bbox, profile.safe_rect)) {
      errors.push(
        `platform_safe_zone_element_outside_safe_rect:${id}`,
      );
    }
  }

  for (const exemption of Array.isArray(audit.decorative_exemptions)
    ? audit.decorative_exemptions
    : []) {
    const id = String(exemption?.id || "").trim();
    if (
      !id ||
      !String(exemption?.selector || "").trim() ||
      exemption?.carries_meaning !== false ||
      !String(exemption?.rationale || "").trim()
    ) {
      errors.push(
        `platform_safe_zone_decorative_exemption_invalid:${id}`,
      );
    }
  }

  if (errors.length) throw new PlatformSafeZoneError(errors);
  return {
    schema_version: AUDIT_SCHEMA,
    verdict: "GREEN",
    story_id: audit.story_id,
    profile_id: profile.id,
    canvas: profile.canvas,
    safe_rect: profile.safe_rect,
    covered_surfaces: profile.covered_surfaces,
    element_count: audit.elements.length,
    decorative_exemption_count: Array.isArray(
      audit.decorative_exemptions,
    )
      ? audit.decorative_exemptions.length
      : 0,
    external_publish_authorised: false,
  };
}

module.exports = {
  AUDIT_SCHEMA,
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  LONGFORM_PROFILE_ID,
  OFFICIAL_GUIDANCE,
  PLATFORM_PROFILES,
  PLATFORM_SAFE_ZONE_SCHEMA,
  PlatformSafeZoneError,
  getAssCaptionSafeZoneContract,
  getPlatformSafeZoneProfile,
  rectFromInsets,
  validateAssCaptionSafeZone,
  validatePlatformSafeZoneAudit,
};
