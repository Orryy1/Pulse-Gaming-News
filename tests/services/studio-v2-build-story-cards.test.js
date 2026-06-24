"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  countTimelineAnimationSteps,
  applySpecToTemplate,
  hyperframesCardReadabilityContractForSpec,
} = require("../../tools/studio-v2-build-story-cards");

test("story-specific HyperFrames cards validate before render", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-build-story-cards.js"),
    "utf8",
  );
  const match = source.match(
    /async function renderCard[\s\S]*?async function buildStoryCards/,
  );

  assert.ok(match, "renderCard block should exist");
  const body = match[0];
  const lintIndex = body.indexOf('runHyperframes(["lint"], projectDir)');
  const validateIndex = body.indexOf('runHyperframes(["validate"], projectDir)');
  const inspectIndex = body.indexOf('["inspect", ".", "--samples", "3"');
  const renderIndex = body.indexOf('["render", ".", "-o", outPath');
  const shellIndex = body.indexOf("writeHyperframesPremiumShellEvidence");

  assert.ok(lintIndex >= 0, "HyperFrames lint must run");
  assert.ok(validateIndex >= 0, "HyperFrames validate must run");
  assert.ok(inspectIndex >= 0, "HyperFrames inspect must run");
  assert.ok(renderIndex >= 0, "HyperFrames render must run");
  assert.ok(shellIndex >= 0, "premium shell evidence must be written");
  assert.ok(lintIndex < validateIndex, "validate must run after lint");
  assert.ok(validateIndex < inspectIndex, "inspect must run after validate");
  assert.ok(inspectIndex < renderIndex, "inspect must run before render");
  assert.ok(renderIndex < shellIndex, "shell evidence must be written after render");
});

test("story-specific HyperFrames shell evidence counts chained GSAP timeline steps", () => {
  const html = `
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.to("#rule", { width: 720 }, 0)
        .to("#kicker", { opacity: 1 }, 0.2)
        .fromTo("#headline", { y: 24 }, { y: 0 }, 0.5);
      gsap.from("#badge", { opacity: 0 });
    </script>
  `;

  assert.equal(countTimelineAnimationSteps(html), 4);
});

test("story-specific HyperFrames cards stretch long copy to readable dwell", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "..", "experiments", "hf-timeline", "index.html"),
    "utf8",
  );
  const spec = {
    kicker: "WHAT WE KNOW",
    heading: "GTA VI COVER ART",
    bullets: [
      { strong: "Art live", copy: "Rockstar showed the key image but not the price" },
      { strong: "Buying gap", copy: "editions and upgrade details are still missing" },
      { strong: "Player question", copy: "preorder now or wait for the next reveal" },
    ],
  };

  const contract = hyperframesCardReadabilityContractForSpec("timeline", spec);
  const html = applySpecToTemplate("timeline", templateHtml, spec, "pulse-gaming");

  assert.equal(contract.status, "pass");
  assert.equal(contract.evidence.minimum_visible_duration_s >= 8, true);
  assert.match(html, /data-duration="8\.[0-9]"/);
});
