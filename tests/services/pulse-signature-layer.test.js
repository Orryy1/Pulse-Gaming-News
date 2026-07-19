"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PULSE_SIGNATURE_VERSION,
  buildPulseSignatureContract,
} = require("../../lib/studio/v4/pulse-signature-layer");
const {
  buildOverlayChain,
  overlayCardWindowsForStory,
} = require("../../tools/studio-v4-proof-render");

test("Pulse signature contract makes platform stories recognisable without delaying the hook", () => {
  const contract = buildPulseSignatureContract({
    story: {
      canonical_subject: "Xbox Game Pass",
      title: "Game Pass Just Created An Install Fight",
      primary_source: "Xbox Wire",
    },
    durationS: 43.6,
  });

  assert.equal(contract.version, PULSE_SIGNATURE_VERSION);
  assert.equal(contract.segment.label, "PLATFORM PULSE");
  assert.equal(contract.opening.start_s, 0);
  assert.ok(contract.opening.duration_s <= 1.8);
  assert.equal(contract.persistent_mark.label, "PULSE // GAMING");
  assert.equal(contract.proof_label, "KEY SIGNAL");
  assert.equal(contract.impact_label, "WHY IT MATTERS");
  assert.equal(contract.outro.brand_line, "PULSE GAMING");
  assert.equal(contract.outro.catch_line, "NEVER MISS A BEAT");
  assert.ok(contract.outro.start_s >= 40);
  assert.ok(contract.outro.end_s <= 43.6);
});

test("Studio V4 output carries the Pulse signature from opening through outro", () => {
  const story = {
    canonical_subject: "Xbox Game Pass",
    title: "Game Pass Just Created An Install Fight",
    first_frame_text: "GAME PASS INSTALL FIGHT",
    thumbnail_headline: "GAME PASS INSTALL FIGHT",
    primary_source: "Xbox Wire",
    proof_card_primary: "TWO HUGE INSTALLS",
    proof_card_secondary: "PLAY NOW OR WAIT",
  };
  const durationS = 43.6;
  const chain = buildOverlayChain({
    story,
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS,
    fontOpt: "font='Bahnschrift'",
    metaFontOpt: "font='Consolas'",
  });
  const opening = overlayCardWindowsForStory(story, { durationS })
    .find((window) => window.id === "opening_source_lock");

  assert.ok(opening.duration_s <= 2.8);
  assert.match(chain, /PULSE \/\/ GAMING/);
  assert.match(chain, /PULSE \/\/ PLATFORM/);
  assert.match(chain, /KEY SIGNAL/);
  assert.match(chain, /WHY IT MATTERS/);
  assert.doesNotMatch(chain, /PULSE PROOF|PLAYER IMPACT/);
  assert.match(chain, /NEVER MISS A BEAT/);
  assert.match(chain, /0xFF6B1A@0\.95/);
  assert.match(chain, /0x38BDF8@0\.78/);
});

test("Pulse opening identity keeps the segment and source in separate safe zones", () => {
  const contract = buildPulseSignatureContract({
    story: {
      canonical_subject: "The Expanse: Osiris Reborn",
      title: "The Expanse Gameplay Reveal",
      primary_source: "PlayStation Blog",
    },
    durationS: 45,
  });

  assert.equal(contract.segment.display_label, "PULSE // TRAILER TRUTH");
  assert.ok(
    contract.opening.layout.source_x_px >=
      contract.opening.layout.chip_x_px + contract.opening.layout.chip_width_px + 20,
  );
  assert.ok(
    contract.opening.layout.source_x_px + contract.opening.layout.source_width_px <= 1010,
  );
});

test("Studio V4 does not repeat an identical opening hook as a second headline card", () => {
  const windows = overlayCardWindowsForStory({
    canonical_subject: "Xbox Game Pass",
    first_frame_text: "GAME PASS INSTALL FIGHT",
    thumbnail_headline: "GAME PASS INSTALL FIGHT",
    primary_source: "Xbox Wire",
    proof_card_primary: "TWO HUGE INSTALLS",
    proof_card_secondary: "PLAY NOW OR WAIT",
  }, { durationS: 43.6 });

  assert.equal(windows.some((window) => window.id === "headline_card"), false);
  assert.ok(windows.find((window) => window.id === "proof_primary").start_s <= 4.2);
});

test("Studio V4 suppresses ordinary overlays while a HyperFrames card is visible", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Xbox Game Pass",
      title: "Game Pass Just Created An Install Fight",
      first_frame_text: "GAME PASS INSTALL FIGHT",
      thumbnail_headline: "GAME PASS INSTALL FIGHT",
      primary_source: "Xbox Wire",
      proof_card_primary: "TWO HUGE INSTALLS",
      proof_card_secondary: "PLAY NOW OR WAIT",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 43.6,
    fontOpt: "font='Bahnschrift'",
    metaFontOpt: "font='Consolas'",
    cardVisibleWindows: [{ start_s: 10.2, end_s: 12.1 }],
  });

  assert.match(
    chain,
    /enable='between\(t,10\.0,12\.7\)\*not\(between\(t,10\.2,12\.1\)\)'/,
  );
  assert.match(
    chain,
    /drawtext=text='[^']+'.*enable='not\(between\(t,10\.2,12\.1\)\)'/,
  );
  assert.match(
    chain,
    /drawbox=x=96:y=1410:w=888:h=210:color=0x07090D@0\.66:t=fill:enable='between\(t,10\.2,12\.1\)'/,
  );
});
