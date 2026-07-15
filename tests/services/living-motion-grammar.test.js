"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CONTENT_IDENTITIES } = require("../../lib/content-identity-system");
const {
  LIVING_MOTION_VERSION,
  resolveLivingMotionGrammar,
} = require("../../lib/studio/v4/living-motion-grammar");

test("living motion grammar gives every content identity a deterministic editorial treatment", () => {
  const treatments = Object.values(CONTENT_IDENTITIES).map((identity) => {
    const story = { id: `proof-${identity.id}`, content_identity_id: identity.id };
    const first = resolveLivingMotionGrammar(story);
    const second = resolveLivingMotionGrammar(story);

    assert.deepEqual(first, second);
    assert.equal(first.version, LIVING_MOTION_VERSION);
    assert.equal(first.identity_id, identity.id);
    assert.equal(first.accent, identity.brand.accent);
    assert.match(first.ghost_word, /^[A-Z][A-Z ]{2,18}$/);
    return first;
  });

  assert.equal(new Set(treatments.map((treatment) => treatment.ghost_word)).size, treatments.length);
});

test("living motion stays restrained, readable and free of decorative orb language", () => {
  for (const identity of Object.values(CONTENT_IDENTITIES)) {
    const treatment = resolveLivingMotionGrammar({ content_identity_id: identity.id });

    assert.ok(treatment.depth.background_drift_ratio >= 0.18);
    assert.ok(treatment.depth.background_drift_ratio <= 0.42);
    assert.ok(treatment.depth.foreground_drift_x_px >= 8);
    assert.ok(treatment.depth.foreground_drift_x_px <= 24);
    assert.ok(treatment.depth.foreground_drift_y_px >= 6);
    assert.ok(treatment.depth.foreground_drift_y_px <= 18);
    assert.ok(treatment.editorial.ghost_opacity >= 0.04);
    assert.ok(treatment.editorial.ghost_opacity <= 0.10);
    assert.ok(treatment.editorial.ghost_font_size_px >= 150);
    assert.ok(treatment.editorial.ghost_font_size_px <= 220);
    assert.ok(
      treatment.editorial.ghost_y_px + treatment.editorial.ghost_font_size_px <= 1240,
      `${identity.id} ghost word enters the caption-safe band`,
    );
    assert.ok(treatment.sweeps.primary_opacity <= 0.065);
    assert.ok(treatment.sweeps.accent_opacity <= 0.06);
    assert.equal(treatment.motion_continuity.seek_safe, true);
    assert.equal(treatment.motion_continuity.caption_priority, true);
    assert.doesNotMatch(JSON.stringify(treatment), /orb|bokeh|blob/i);
  }
});
