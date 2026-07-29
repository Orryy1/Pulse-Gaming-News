"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  buildSceneInput,
  dispatchSceneFilter,
} = require("../../lib/studio/ffmpeg-scene-renderer");
const { CTA_POLICY } = require("../../lib/services/pulse-editorial-contract");

const CONTEXTUAL_CTA = "Which version would you install first?";
const AUDIT_HASH = `sha256:${"a".repeat(64)}`;

test("visual scenes get compact entity popups instead of anonymous cover slides", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: { title: "Take-Two legacy franchise story" },
    scene: {
      type: SCENE_TYPES.CLIP_FRAME,
      duration: 4,
      source: "frame.jpg",
      entity: "BioShock",
      sourceType: "official_trailer_frame",
    },
  });

  assert.match(filter, /BIOSHOCK/);
  assert.match(filter, /OFFICIAL FRAME/);
  assert.match(filter, /box=1:boxcolor=black@0\.46/);
  assert.match(filter, /alpha='if\(lt\(t\\,0\.12\)/);
  assert.doesNotMatch(filter, /drawbox=x=52:y=108:w=420:h=74/);
});

test("opener hook overlay is compact and avoids the old full-width top slab", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: {
      hook: "Take-Two killed a legacy sequel. They will not say which one.",
    },
    scene: {
      type: SCENE_TYPES.OPENER,
      duration: 4,
      source: "gta-trailer.m3u8",
      isClipBacked: true,
      entity: "GTA",
      sourceType: "steam_movie",
    },
  });

  assert.doesNotMatch(filter, /h=172:color=black@0\.86/);
  assert.match(filter, /w=760:h=118:color=black@0\.58/);
  assert.match(filter, /GTA/);
});

test("official clip inputs seek to the selected trailer beat instead of trailer start", () => {
  const input = buildSceneInput({
    type: SCENE_TYPES.CLIP,
    duration: 4,
    source: "https://video.example/trailer.m3u8",
    mediaStartS: 31.2,
  });

  assert.match(
    input,
    /^-ss 31\.20 -t 5\.00 -i "https:\/\/video\.example\/trailer\.m3u8"$/,
  );
});

test("takeaway card renders only the governed selected CTA copy", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: {
      cta: CONTEXTUAL_CTA,
      full_script: `Achievements are now confirmed. ${CONTEXTUAL_CTA}`,
      cta_policy: {
        policy_version: CTA_POLICY.version,
        scope: "shorts",
        include_cta: true,
        copy_strategy: CTA_POLICY.copy_strategy,
        cohort_bucket: 0,
        cohort_numerator: 1,
        cohort_denominator: 3,
        audit_hash: AUDIT_HASH,
      },
    },
    scene: {
      type: SCENE_TYPES.CARD_TAKEAWAY,
      duration: 4,
      cta: "FOLLOW FOR MORE",
    },
  });

  assert.match(filter, new RegExp(CONTEXTUAL_CTA.replace("?", "\\?")));
  assert.doesNotMatch(filter, /FOLLOW FOR MORE/);
  assert.doesNotMatch(filter, /NEVER MISS A BEAT/);
});

test("takeaway card omits every CTA when the governed cohort is not selected", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: {
      cta_policy: {
        policy_version: CTA_POLICY.version,
        scope: "shorts",
        include_cta: false,
        copy_strategy: "none",
        cohort_bucket: 1,
        cohort_numerator: 1,
        cohort_denominator: 3,
        audit_hash: AUDIT_HASH,
      },
    },
    scene: {
      type: SCENE_TYPES.CARD_TAKEAWAY,
      duration: 4,
      cta: "FOLLOW FOR MORE",
    },
  });

  assert.doesNotMatch(filter, /FOLLOW/);
  assert.doesNotMatch(filter, /SUBSCRIBE/);
});
