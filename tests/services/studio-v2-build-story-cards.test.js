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

test("quote-card attribution uses a full-opacity masked reveal so contrast never dips during animation", () => {
  const template = fs.readFileSync(
    path.join(__dirname, "..", "..", "experiments", "hf-quote", "index.html"),
    "utf8",
  );

  assert.match(template, /\.attribution\s*\{[\s\S]*?color:\s*#fff(?:fff)?;/i);
  assert.match(template, /\.attribution-sub\s*\{[\s\S]*?color:\s*#fff(?:fff)?;/i);
  assert.match(template, /\.attribution(?:-sub)?\s*\{[\s\S]*?opacity:\s*1;/i);
  assert.match(template, /\.attribution\s*\{[\s\S]*?background:\s*rgba\(7,\s*9,\s*13,\s*0\.9\d*\)/i);
  assert.match(template, /\.attribution-sub\s*\{[\s\S]*?background:\s*rgba\(7,\s*9,\s*13,\s*0\.9\d*\)/i);
  assert.match(template, /clip-path:\s*inset\(0\s+100%\s+0\s+0\)/i);
  assert.doesNotMatch(template, /\.to\("#attribution(?:-sub)?",\s*\{\s*opacity:/i);
  assert.match(template, /clipPath:\s*"inset\(0 0% 0 0\)"/i);
});

test("takeaway card keeps its story backdrop bright and moving instead of becoming a static dark slate", () => {
  const template = fs.readFileSync(
    path.join(__dirname, "..", "..", "experiments", "hf-takeaway", "index.html"),
    "utf8",
  );

  assert.match(template, /id="backdrop"\s+class="backdrop"/i);
  assert.match(
    template,
    /\.backdrop\s*\{[\s\S]*?filter:\s*blur\(\d+px\)\s+brightness\(0\.[6-9]\d*\)\s+saturate\((?:0\.[9]\d*|1(?:\.\d+)?)\)/i,
  );
  const shadeBlock = template.match(/\.shade\s*\{[\s\S]*?\}/i)?.[0] || "";
  assert.ok(shadeBlock);
  assert.doesNotMatch(shadeBlock, /rgba\(0,\s*0,\s*0,\s*0\.[6-9]\d*\)/i);
  assert.match(
    template,
    /\.fromTo\(\s*"#backdrop",[\s\S]*?scale:\s*1\.\d+[\s\S]*?xPercent:[\s\S]*?duration:\s*5\.2/i,
  );
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

test("story-specific HyperFrames cards reject copy that cannot be read inside the momentum ceiling", () => {
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

  assert.equal(contract.status, "fail");
  assert.ok(contract.blockers.includes("hyperframes_card_copy_exceeds_momentum_budget"));
  assert.ok(
    contract.evidence.required_visible_duration_s >
      contract.evidence.maximum_visible_duration_s,
  );
  assert.equal(contract.evidence.minimum_visible_duration_s, 5.2);
  assert.match(html, /data-duration="5\.2"/);
});

test("story-specific HyperFrames cards fit long flagship text inside vertical safe margins", () => {
  const contextTemplate = fs.readFileSync(
    path.join(__dirname, "..", "..", "experiments", "hf-context", "index.html"),
    "utf8",
  );
  const takeawayTemplate = fs.readFileSync(
    path.join(__dirname, "..", "..", "experiments", "hf-takeaway", "index.html"),
    "utf8",
  );
  const contextHtml = applySpecToTemplate("context", contextTemplate, {
    kicker: "WHY IT MATTERS",
    number: "DIGIMON STORY TIME STRANGER",
    sub: "SWITCH MODES INTO",
    micro: "PLAYER IMPACT",
  }, "pulse-gaming");
  const takeawayHtml = applySpecToTemplate("takeaway", takeawayTemplate, {
    step: "03 / TAKEAWAY",
    kicker: "THE BOTTOM LINE",
    headlineWords: ["PERFORMANCE", "IS", "THE", "TEST"],
    cta: "PERFORMANCE CHANGES THE DECISION",
  }, "pulse-gaming");

  assert.match(contextHtml, /\.stage\s*\{[\s\S]*?padding:\s*0 72px;/);
  assert.match(contextHtml, /\.number\s*\{[\s\S]*?font-size:\s*84px;/);
  assert.match(takeawayHtml, /\.headline\s*\{[\s\S]*?font-size:\s*100px;/);
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

test("story-specific HyperFrames cards reject empty readable copy", () => {
  const specContract = hyperframesCardReadabilityContractForSpec("timeline", {
    heading: "",
    bullets: [],
  });
  const htmlContract = hyperframesCardReadabilityContractFromHtml(
    "timeline",
    '<div id="heading"></div><ul id="bullets"></ul><div data-duration="3.4"></div>',
  );

  for (const contract of [specContract, htmlContract]) {
    assert.equal(contract.status, "fail");
    assert.ok(contract.blockers.includes("hyperframes_card_readable_text_missing"));
  }
});

test("story-specific HyperFrames source cards reject labels too dense for their ceiling", () => {
  const contract = hyperframesCardReadabilityContractForSpec("source", {
    label: "BANDAI NAMCO ENTERTAINMENT AMERICA OFFICIAL PUBLISHER",
    sublabel: "NEWS SOURCE",
  });

  assert.equal(contract.status, "fail");
  assert.ok(
    contract.blockers.includes("hyperframes_source_card_copy_exceeds_momentum_budget"),
  );
  assert.ok(
    contract.evidence.required_visible_duration_s >
      contract.evidence.maximum_visible_duration_s,
  );
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

test("story-specific HyperFrames context card preserves a concrete versus-mode balance risk", () => {
  const specs = buildStoryCardSpecs({
    id: "marvel-tokon-balance-risk",
    title: "Marvel Tokon's 4v4 Roster Has One Big Risk",
    canonical_subject: "MARVEL Tokon",
    source_card_label: "PlayStation Blog",
    source_type: "rss",
    full_script:
      "Marvel Tokon has 20 playable fighters, but the number that could make or break it is four. " +
      "PlayStation Blog confirms each match lets you bring a team of four, then call assists and swap fighters mid-fight. " +
      "That gives Arc System Works room for Marvel-style chaos, but it also creates a balance problem. " +
      "Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(specs.context.number, "MARVEL TOKON");
  assert.equal(specs.context.sub, "4V4 BALANCE RISK");
  assert.doesNotMatch(specs.context.sub, /ROSTER LOUDER|PLAYER IMPACT/i);
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
  assert.match(timelineText, /guaranteed combination/i);
});

test("story-specific HyperFrames takeaway turns controversy into an editorial payoff and reserves follow CTA for outro", () => {
  const specs = buildStoryCardSpecs({
    id: "black-flag-player-trust",
    title: "Why Black Flag's Remake Could Lose Player Trust",
    canonical_subject: "Black Flag",
    source_card_label: "Ubisoft News",
    source_type: "rss",
    confirmed_claims: [
      { claim: "The remake includes optional microtransactions." },
    ],
    full_script:
      "Black Flag's remake is leaning hard on nostalgia. " +
      "Ubisoft can modernise combat without changing the pitch. " +
      "But paid microtransactions would turn that nostalgia into a test of player trust. " +
      "Follow Pulse Gaming so you never miss a beat.",
  });

  const headline = specs.takeaway.headlineWords.join(" ");
  assert.match(headline, /NOSTALGIA/i);
  assert.match(headline, /TRUST/i);
  assert.match(specs.takeaway.cta, /MICROTRANSACTIONS/i);
  assert.match(specs.takeaway.cta, /PLAYER TRUST/i);
  assert.doesNotMatch(`${headline} ${specs.takeaway.cta}`, /WHY BLACK FLAG|FOLLOW|SUBSCRIBE|FOR MORE/i);
  assert.deepEqual(specs.outro.headlineWords, ["FOLLOW", "FOR", "MORE"]);
});

test("story-specific HyperFrames takeaway surfaces a blocked save transfer instead of generic player-impact copy", () => {
  const specs = buildStoryCardSpecs({
    id: "official_digimon_switch2_launch_20260710",
    title: "Digimon's Switch 2 Upgrade Has A Hidden Catch",
    canonical_subject: "Digimon Story Time Stranger",
    full_script:
      "Digimon just gave Switch 2 owners a choice that should be easy, but it really isn't. " +
      "A patched Switch copy gets improved graphics on Switch 2, but its save cannot transfer to the separate Switch 2 edition. " +
      "So the best mode may depend on which version you already own before visuals even enter the argument. " +
      "Follow Pulse Gaming so you never miss a beat.",
  });

  assert.deepEqual(specs.takeaway.headlineWords, ["SAVE", "DATA", "WON'T", "TRANSFER"]);
  assert.equal(specs.takeaway.cta, "SWITCH 2 EDITION MEANS STARTING OVER");
  assert.doesNotMatch(
    `${specs.takeaway.headlineWords.join(" ")} ${specs.takeaway.cta}`,
    /PLAYER IMPACT|WHAT CHANGES FOR PLAYERS|FOLLOW|FOR MORE/i,
  );
});

test("Black Flag pricing cards preserve decimal facts, source attribution and the story payoff", () => {
  const specs = buildStoryCardSpecs({
    id: "official-black-flag-pricing",
    title: "Black Flag Resynced's Day-One DLC Costs More Than the Game",
    canonical_subject: "Assassin's Creed Black Flag Resynced",
    card_context_number: "Black Flag Resynced",
    card_context_sub: "DLC costs more than the game",
    card_context_micro: "$84.91 vs $59.99",
    source_card_label: "Steam + Ubisoft",
    source_type: "rss",
    card_key_line: "Nine day-one DLC packs cost $84.91 combined.",
    quote_attribution: "Steam Store",
    quote_attribution_sub: "launch listing",
    full_script:
      "Black Flag Resynced has nine day-one DLC packs costing more than the game. " +
      "Steam lists them at $84.91 combined, while the base game costs $59.99. " +
      "Eight packs are $9.99 each, adding character outfits, ship cosmetics and sometimes weapons or trinkets with unique perks. " +
      "The ninth is a $4.99 map pack that instantly reveals rare collectibles. " +
      "Ubisoft says the standard edition is still the full experience, and that is the line players will test. " +
      "Do these feel like harmless extras, or content carved out before launch? " +
      "Bonus content, or too far? " +
      "If the base game feels complete, Ubisoft's defence holds. " +
      "If it does not, nine day-one packs turn nostalgia into a pricing fight. " +
      "Follow Pulse Gaming so you never miss a beat.",
  });

  const strongFacts = specs.timeline.bullets.map((bullet) => bullet.strong);
  const compactCopies = specs.timeline.bullets.map((bullet) => bullet.copy);
  assert.equal(specs.context.number, "BLACK FLAG RESYNCED");
  assert.equal(specs.context.sub, "DLC costs more than the game");
  assert.equal(specs.context.micro, "$84.91 VS $59.99");
  assert.ok(strongFacts.includes("NINE DLC PACKS"), JSON.stringify(specs.timeline));
  assert.ok(strongFacts.includes("$84.91 VS $59.99"), JSON.stringify(specs.timeline));
  assert.ok(strongFacts.includes("$4.99 MAP PACK"), JSON.stringify(specs.timeline));
  assert.ok(!strongFacts.includes("91 COMBINED"));
  assert.ok(!strongFacts.includes("99 MAP"));
  assert.deepEqual(compactCopies, ["", "", ""]);
  assert.equal(specs.quote.quoteText, "Nine day-one DLC packs cost $84.91 combined.");
  assert.equal(specs.quote.attribution, "STEAM STORE");
  assert.equal(specs.quote.attributionSub, "launch listing");
  assert.deepEqual(specs.takeaway.headlineWords, ["DLC", "COSTS", "MORE", "THAN", "GAME"]);
  assert.equal(specs.takeaway.cta, "DAY-ONE DLC STARTS A PRICING FIGHT");
  assert.doesNotMatch(
    `${specs.takeaway.headlineWords.join(" ")} ${specs.takeaway.cta}`,
    /PLAYER IMPACT|WHAT CHANGES FOR PLAYERS|FOLLOW|FOR MORE/i,
  );
  const timelineReadability = hyperframesCardReadabilityContractForSpec(
    "timeline",
    specs.timeline,
  );
  assert.equal(timelineReadability.status, "pass");
  assert.ok(timelineReadability.evidence.word_count <= 13);
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

test("timeline readability excludes decorative sequence numbers from its copy budget", () => {
  const html = `
    <div id="heading">BLACK FLAG RESYNCED</div>
    <ul id="bullets">
      <li><span class="num">01</span><strong>NINE DLC PACKS</strong></li>
      <li><span class="num">02</span><strong>$84.91 VS $59.99</strong></li>
      <li><span class="num">03</span><strong>$4.99 MAP PACK</strong></li>
    </ul>
    <div data-duration="5.0"></div>
  `;

  const contract = hyperframesCardReadabilityContractFromHtml("timeline", html);

  assert.equal(contract.status, "pass");
  assert.equal(contract.evidence.word_count, 12);
  assert.equal(contract.evidence.required_visible_duration_s, 5.0);
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
