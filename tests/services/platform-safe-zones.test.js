"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  AUDIT_SCHEMA,
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  LONGFORM_PROFILE_ID,
  PLATFORM_SAFE_ZONE_SCHEMA,
  getAssCaptionSafeZoneContract,
  getPlatformSafeZoneProfile,
  validateAssCaptionSafeZone,
  validatePlatformSafeZoneAudit,
} = require("../../lib/services/platform-safe-zones");

const ROOT = path.resolve(__dirname, "..", "..");

test("publishes platform-specific portrait profiles plus strict portrait and 16:9 contracts", () => {
  for (const profileId of [
    "youtube-shorts-portrait-v1",
    "tiktok-portrait-v1",
    "instagram-reels-portrait-v1",
    "facebook-reels-portrait-v1",
    "x-vertical-video-v1",
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
    LONGFORM_PROFILE_ID,
  ]) {
    const profile = getPlatformSafeZoneProfile(profileId);
    assert.equal(profile.schema_version, PLATFORM_SAFE_ZONE_SCHEMA);
    assert.ok(profile.safe_rect.width > 0);
    assert.ok(profile.safe_rect.height > 0);
  }

  const portrait = getPlatformSafeZoneProfile(
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  );
  assert.deepEqual(portrait.canvas, { width: 1080, height: 1920 });
  assert.deepEqual(portrait.insets, {
    left: 96,
    top: 240,
    right: 264,
    bottom: 504,
  });
  assert.deepEqual(portrait.safe_rect, {
    x: 96,
    y: 240,
    width: 720,
    height: 1176,
  });
  assert.deepEqual(portrait.covered_surfaces, [
    "youtube_shorts",
    "tiktok",
    "instagram_reels",
    "facebook_reels",
    "x_vertical_video",
  ]);

  const longform = getPlatformSafeZoneProfile(LONGFORM_PROFILE_ID);
  assert.deepEqual(longform.canvas, { width: 1920, height: 1080 });
  assert.deepEqual(longform.safe_rect, {
    x: 144,
    y: 96,
    width: 1632,
    height: 816,
  });
  assert.deepEqual(longform.covered_surfaces, [
    "youtube_watch",
    "facebook_video",
    "x_video",
  ]);
});

test("validates every meaningful element inside the selected safe rectangle and rejects overflow", () => {
  const audit = {
    schema_version: AUDIT_SCHEMA,
    story_id: "official_d86953ca92ca",
    profile_id: CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
    canvas: { width: 1080, height: 1920 },
    safe_rect: { x: 96, y: 240, width: 720, height: 1176 },
    covered_surfaces: [
      "youtube_shorts",
      "tiktok",
      "instagram_reels",
      "facebook_reels",
      "x_vertical_video",
    ],
    elements: [
      {
        id: "headline",
        selector: "#headline",
        role: "text",
        bbox: { x: 120, y: 300, width: 600, height: 120 },
      },
    ],
    decorative_exemptions: [
      {
        id: "background",
        selector: "#background",
        carries_meaning: false,
        rationale: "Full-bleed atmospheric background only.",
      },
    ],
  };

  const result = validatePlatformSafeZoneAudit({ audit });
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.element_count, 1);

  const outside = structuredClone(audit);
  outside.elements[0].bbox.x = 817;
  assert.throws(
    () => validatePlatformSafeZoneAudit({ audit: outside }),
    /platform_safe_zone_element_outside_safe_rect:headline/,
  );
});

test("validates the exact Evercold machine-readable safe-zone audit", () => {
  const auditPath = path.join(
    ROOT,
    "videos",
    "evercold-bastion-short",
    "evidence",
    "platform-safe-zone-audit.json",
  );
  const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
  const result = validatePlatformSafeZoneAudit({ audit });

  assert.equal(result.verdict, "GREEN");
  assert.equal(result.profile_id, CROSS_PLATFORM_PORTRAIT_PROFILE_ID);
  assert.ok(result.element_count >= 20);
  assert.ok(
    audit.elements.some(
      (element) =>
        element.id === "evercold-owned-motion-viewport" &&
        element.role === "embedded_viewer_content",
    ),
  );
  assert.ok(
    audit.elements.some(
      (element) =>
        element.id === "media-legal" &&
        element.role === "attribution",
    ),
  );
});

test("defines and validates a strict ASS caption anchor and bounded phrase envelope", () => {
  const contract = getAssCaptionSafeZoneContract(
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  );
  assert.deepEqual(contract.caption_rect, {
    x: 96,
    y: 1040,
    width: 720,
    height: 200,
  });
  assert.deepEqual(contract.anchor, {
    x: 456,
    y: 1200,
    alignment: 2,
  });
  assert.equal(contract.max_phrase_chars, 12);
  assert.equal(contract.font_size, 78);
  assert.equal(contract.emphasis_font_size, 88);

  const ass = `[Script Info]
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Pop,Impact,78,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC8000000,-1,0,0,0,100,100,2,0,1,5,3,2,96,264,720,1
Style: PopEmphasis,Impact,88,&H001A6BFF,&H001A6BFF,&H00000000,&HC8000000,-1,0,0,0,100,100,2,0,1,5,3,2,96,264,720,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Pop,,0,0,0,,{\\an2\\pos(456,1200)}TWO\\hSHIELDS
`;
  const result = validateAssCaptionSafeZone({
    ass,
    profileId: CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  });
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.dialogue_count, 1);

  assert.throws(
    () =>
      validateAssCaptionSafeZone({
        ass: ass.replace("\\pos(456,1200)", "\\pos(540,1440)"),
        profileId: CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
      }),
    /ass_caption_anchor_mismatch/,
  );
  assert.throws(
    () =>
      validateAssCaptionSafeZone({
        ass: ass.replace("TWO\\hSHIELDS", "THIRTEENCHARS"),
        profileId: CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
      }),
    /ass_caption_phrase_too_long/,
  );
});
