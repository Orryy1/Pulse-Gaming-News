"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");

const {
  buildStoryCardSpecs,
  countTimelineAnimationSteps,
  applySpecToTemplate,
  hyperframesCardReadabilityContractForSpec,
  hyperframesCardReadabilityContractFromHtml,
  materialiseStoryBackdropFromClips,
  buildCardBackdropMap,
  scoreStoryBackdropCandidate,
} = require("../../tools/studio-v2-build-story-cards");

test("premium HyperFrames cards rotate distinct backdrops across selected editorial beats", () => {
  const map = buildCardBackdropMap([
    "source-gameplay.jpg",
    "context-gameplay.jpg",
    "takeaway-gameplay.jpg",
  ]);

  assert.equal(map.source, "source-gameplay.jpg");
  assert.equal(map.context, "context-gameplay.jpg");
  assert.equal(map.takeaway, "takeaway-gameplay.jpg");
  assert.equal(new Set([map.source, map.context, map.takeaway]).size, 3);
});

test("story-specific HyperFrames backdrop scoring rejects baked trailer text", () => {
  const report = scoreStoryBackdropCandidate({
    brightness: 105,
    entropy: 7.4,
    sharpness: 12,
    prescan: {
      text_overlay_likelihood: 0.39,
      trailer_frame_taste: { verdict: "pass", tags: ["detail_rich", "text_heavy"] },
    },
  });

  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("baked_trailer_text_risk"));
});

test("story-specific HyperFrames cards extract a relevant backdrop from approved motion", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-hf-motion-backdrop-"));
  const blackPath = path.join(root, "black.mp4");
  const motionPath = path.join(root, "motion.mp4");
  execFileSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "color=c=black:size=540x960:rate=30", "-t", "2", "-pix_fmt", "yuv420p", blackPath,
  ]);
  execFileSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc2=size=540x960:rate=30", "-t", "2", "-pix_fmt", "yuv420p", motionPath,
  ]);

  const backdropPath = await materialiseStoryBackdropFromClips({
    story: { video_clips: [blackPath, motionPath] },
    storyId: "motion-backdrop",
    outputDir: path.join(root, "backdrops"),
  });

  assert.ok(backdropPath);
  assert.equal(fs.existsSync(backdropPath), true);
  const stats = await sharp(backdropPath).stats();
  const brightness = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
  assert.equal(brightness > 20, true);
});

test("story-specific HyperFrames cards run the authoritative browser check before render", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-build-story-cards.js"),
    "utf8",
  );
  const match = source.match(
    /async function renderCard[\s\S]*?async function buildStoryCards/,
  );

  assert.ok(match, "renderCard block should exist");
  const body = match[0];
  const checkIndex = body.indexOf('runHyperframes(["check", "."], projectDir)');
  const renderIndex = body.indexOf('["render", ".", "-o", outPath');
  const shellIndex = body.indexOf("writeHyperframesPremiumShellEvidence");

  assert.ok(checkIndex >= 0, "HyperFrames check must run");
  assert.ok(renderIndex >= 0, "HyperFrames render must run");
  assert.ok(shellIndex >= 0, "premium shell evidence must be written");
  assert.ok(checkIndex < renderIndex, "check must run before render");
  assert.ok(renderIndex < shellIndex, "shell evidence must be written after render");
  assert.doesNotMatch(body, /runHyperframes\(\["validate"\]/);
  assert.doesNotMatch(body, /runHyperframes\(\["inspect"/);
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
  assert.equal(contract.evidence.minimum_visible_duration_s, 5.2);
  assert.match(html, /data-duration="5\.2"/);
});

test("story-specific HyperFrames cards carry the category-aware Pulse V5 kinetic identity", () => {
  const templateHtml = fs.readFileSync(
    path.join(__dirname, "..", "..", "experiments", "hf-context", "index.html"),
    "utf8",
  );
  const specs = buildStoryCardSpecs({
    id: "halo-update-identity",
    title: "Halo Update Adds Three New Campaign Missions",
    source_card_label: "Halo Waypoint",
    source_type: "rss",
  });

  assert.equal(specs.context.creative_identity.category, "update");
  assert.equal(specs.context.creative_identity.segment_name, "Patch Notes That Matter");

  const html = applySpecToTemplate("context", templateHtml, specs.context, "pulse-gaming");
  assert.match(html, /data-pulse-creative-system="pulse_visual_identity_v5"/);
  assert.match(html, /data-pulse-category="update"/);
  assert.match(html, /id="pulse-brand-bug"/);
  assert.match(html, /id="pulse-depth-a"/);
  assert.match(html, /id="pulse-depth-b"/);
  assert.match(html, /PATCH NOTES THAT MATTER/);
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
  assert.equal(contract.evidence.minimum_visible_duration_s, 1.9);
  assert.equal(contract.evidence.planned_visible_duration_s, 2.6);
  assert.equal(contract.evidence.maximum_visible_duration_s, 3.1);
  assert.equal(contract.evidence.min_readable_card_duration_s, 1.9);
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

test("story-specific HyperFrames cards turn narration into concrete editorial beats", () => {
  const specs = buildStoryCardSpecs({
    id: "paleo-pines-premium-copy",
    title: "Paleo Pines Just Ended Its Worst Dinosaur Grind",
    canonical_subject: "Paleo Pines",
    source_card_label: "Paleo Pines",
    source_type: "rss",
    full_script:
      "Paleo Pines just fixed one of its most exhausting hunts. " +
      "The free Players' Choice update adds a skin tracker. " +
      "When that rarity next spawns, the game guarantees the combination. " +
      "A blind grind now has a finish line. " +
      "Saddlebags let large dinosaurs carry up to four items. " +
      "For players who love rare dinos, that is a huge quality-of-life win. " +
      "If the tracker saves hours, it turns rare dinos into a goal instead of a lottery. " +
      "Follow Pulse Gaming so you never miss a beat.",
  });

  const timelineText = specs.timeline.bullets
    .map((bullet) => `${bullet.strong} ${bullet.copy}`)
    .join(" ");

  assert.equal(specs.context.sub, "A BLIND GRIND NOW HAS A FINISH LINE");
  assert.deepEqual(specs.takeaway.headlineWords, ["GOAL", "NOT", "LOTTERY"]);
  assert.doesNotMatch(timelineText, /source checked|main detail|next step|official follow-up/i);
  assert.match(timelineText, /skin tracker/i);
  assert.match(timelineText, /four items/i);
  assert.match(timelineText, /guarantees the combination/i);
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
  assert.equal(contract.evidence.planned_visible_duration_s, 4.8);
});
