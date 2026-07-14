"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildStoryCardSpecs,
  countTimelineAnimationSteps,
  applySpecToTemplate,
  hyperframesCardReadabilityContractForSpec,
  hyperframesCardReadabilityContractFromHtml,
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

test("story-specific HyperFrames cards cap dense copy at a momentum-friendly readable dwell", () => {
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
  assert.equal(contract.evidence.minimum_visible_duration_s, 6.4);
  assert.match(html, /data-duration="6\.4"/);
});

test("story-specific HyperFrames cards keep short source cards momentum-friendly", () => {
  const spec = {
    kicker: "SOURCE",
    label: "ROCKSTAR",
    sublabel: "TRAILER",
  };

  const contract = hyperframesCardReadabilityContractForSpec("source", spec);

  assert.equal(contract.status, "pass");
  assert.equal(contract.evidence.readable_text, "ROCKSTAR TRAILER");
  assert.equal(contract.evidence.minimum_visible_duration_s, 1.6);
  assert.equal(contract.evidence.planned_visible_duration_s, 2.2);
  assert.equal(contract.evidence.maximum_visible_duration_s, 2.8);
  assert.equal(contract.evidence.min_readable_card_duration_s, 1.6);
});

test("story-specific HyperFrames source card preserves PlayStation source labels", () => {
  const specs = buildStoryCardSpecs({
    id: "playstation-source",
    title: "GTA VI Just Made PS5 The Version To Watch",
    source: "PlayStationBlog",
    source_card_label: "PlayStation Blog",
    source_type: "rss",
  });

  assert.equal(specs.source.label, "PLAYSTATION BLOG");
  assert.equal(
    hyperframesCardReadabilityContractForSpec("source", specs.source).evidence.readable_text,
    "PLAYSTATION BLOG NEWS SOURCE",
  );
});

test("story-specific HyperFrames source card fits long publisher names without clipping", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "..", "experiments", "hf-source", "index.html"),
    "utf8",
  );
  const spec = {
    kicker: "SOURCE",
    label: "BANDAI NAMCO ENTERTAINMENT AMERICA",
    sublabel: "NEWS SOURCE",
  };

  const html = applySpecToTemplate("source", templateHtml, spec, "pulse-gaming");

  assert.match(html, /\.label\s*\{[^}]*max-width:\s*920px;/s);
  assert.match(html, /\.label\s*\{[^}]*font-size:\s*72px;/s);
  assert.match(html, /id="label"[\s\S]*BANDAI NAMCO ENTERTAINMENT AMERICA/);
});

test("story-specific HyperFrames context card uses short audience-facing copy", () => {
  const specs = buildStoryCardSpecs({
    id: "forza-context",
    title: "Forza's Xbox Moment",
    source_card_label: "PC Gamer",
    source_type: "rss",
  });
  const readable = hyperframesCardReadabilityContractForSpec("context", specs.context).evidence;

  assert.equal(specs.context.number, "FORZA");
  assert.equal(specs.context.sub, "XBOX MOMENT");
  assert.doesNotMatch(readable.readable_text, /\bverified source\b/i);
  assert.doesNotMatch(readable.readable_text, /\bchecked before publish\b/i);
  assert.doesNotMatch(readable.readable_text, /\bFORZA FORZA\b/i);
  assert.ok(
    readable.minimum_visible_duration_s <= 8,
    `context card should stay momentum-friendly, got ${readable.minimum_visible_duration_s}s`,
  );
});

test("story-specific HyperFrames cards use canonical subjects and honest editorial key lines", () => {
  const specs = buildStoryCardSpecs({
    id: "denshattack-cards",
    title: "Why Denshattack's Train Kickflips Could Actually Work",
    canonical_subject: "Denshattack",
    source_card_label: "Xbox Wire",
    source_type: "rss",
    full_script:
      "Denshattack asks one ridiculous question: can a train do a kickflip? " +
      "The trailer sells the joke instantly. " +
      "The controls have to sell the next ten hours. " +
      "Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(specs.context.number, "DENSHATTACK");
  assert.equal(specs.context.sub, "TRAIN KICKFLIPS");
  assert.equal(specs.quote.quoteText, "The controls have to sell the next ten hours.");
  assert.equal(specs.quote.attribution, "PULSE GAMING");
  assert.equal(specs.quote.attributionSub, "editorial take");
  assert.doesNotMatch(specs.quote.quoteText, /Why Denshattack/i);
});

test("story-specific HyperFrames readability evidence keeps every animated quote word", () => {
  const html = `
    <div id="quote" class="quote">
      <span class="word">The</span>
      <span class="word">controls</span>
      <span class="word">have</span>
      <span class="word">to</span>
      <span class="word">sell</span>
      <span class="word">it.</span>
    </div>
    <div id="attribution">PULSE GAMING</div>
    <div data-duration="4.1"></div>
  `;

  const contract = hyperframesCardReadabilityContractFromHtml("quote", html);

  assert.equal(contract.evidence.readable_text, "The controls have to sell it. PULSE GAMING");
  assert.equal(contract.evidence.word_count, 8);
});

test("story-specific HyperFrames quote timing includes the visible attribution", () => {
  const contract = hyperframesCardReadabilityContractForSpec("quote", {
    quoteText: "The controls have to sell the next ten hours.",
    attribution: "PULSE GAMING",
  });

  assert.equal(contract.evidence.readable_text, "The controls have to sell the next ten hours. PULSE GAMING");
  assert.equal(contract.evidence.word_count, 11);
  assert.equal(contract.evidence.planned_visible_duration_s, 5.2);
});
