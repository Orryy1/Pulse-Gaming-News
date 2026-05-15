"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildStoryCardSpecs,
  applySpecToTemplate,
  clampQuoteText,
  outputNameForCard,
  pickStoryBackdrop,
  quoteLayoutClass,
} = require("../../tools/studio-v2-build-story-cards");
const { wrapQuoteLines } = require("../../lib/studio/v2/quote-fit");

test("story card specs are topical and do not reuse generic Metro copy", () => {
  const story = {
    storyId: "rss_ca673f22ddbbbdfc",
    title:
      "Mega Mewtwo's Pokemon Go debut finally announced and Go Fest Global is free for all players",
    subreddit: "Eurogamer",
    source_type: "rss",
    top_comment:
      "Mega Mewtwo X and Y will debut in Pok&eacute;mon Go during Go Fest 2026.",
    script: {
      tightened:
        "No premium ticket. No paywall. Every player gets access to the Special Research quest.",
    },
  };

  const specs = buildStoryCardSpecs(story);
  const serialised = JSON.stringify(specs);

  assert.equal(specs.source.label, "EUROGAMER");
  assert.equal(specs.source.sublabel, "POK\u00c9MON GO");
  assert.equal(specs.context.number, "FREE");
  assert.match(specs.context.micro, /Mega Mewtwo/i);
  assert.match(specs.timeline.heading, /MEGA MEWTWO/i);
  assert.equal(
    specs.quote.quoteText,
    "No premium ticket. No paywall. Every player gets access.",
  );
  assert.deepEqual(specs.takeaway.headlineWords, ["FREE", "MEGA", "MEWTWO"]);
  assert.deepEqual(specs.outro.headlineWords, ["FOLLOW", "FOR", "MORE"]);
  assert.equal(specs.outro.kicker, "DAILY GAMING NEWS");
  assert.equal(specs.outro.cta, "VERIFIED GAMING NEWS");
  assert.doesNotMatch(serialised, /METRO 2039/i);
});

test("story card builder uses story-specific output names", () => {
  assert.equal(
    outputNameForCard("source", "rss_ca673f22ddbbbdfc", "pulse-gaming"),
    "hf_source_card_rss_ca673f22ddbbbdfc.mp4",
  );
  assert.equal(
    outputNameForCard("source", "rss_ca673f22ddbbbdfc", "stacked"),
    "hf_source_card_rss_ca673f22ddbbbdfc__stacked.mp4",
  );
  assert.equal(
    outputNameForCard("outro", "rss_ca673f22ddbbbdfc", "pulse-gaming"),
    "hf_outro_card_rss_ca673f22ddbbbdfc.mp4",
  );
});

test("story card builder prefers smart-cropped story backdrops", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-backdrop-"));
  try {
    const imageDir = path.join(root, "images");
    await fs.ensureDir(imageDir);
    const raw = path.join(imageDir, "story_trailerframe_1.jpg");
    const smart = path.join(imageDir, "story_trailerframe_1_smartcrop_v2.jpg");
    await fs.writeFile(raw, "raw");
    await fs.writeFile(smart, "smart");

    const picked = pickStoryBackdrop({
      mediaInventory: {
        trailerFrames: [{ path: raw, source: "trailer-frame" }],
      },
    });

    assert.equal(picked, smart);
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("quote card specs clamp long comments before rendering", () => {
  const story = {
    title: "GTA 6 trailer evidence is stacking up",
    subreddit: "GamingLeaksAndRumours",
    source_type: "reddit",
    top_comment:
      "This is a very long community quote that would absolutely spill across the frame and get cut off if the card tried to render every single word at once.",
  };

  const specs = buildStoryCardSpecs(story);
  const words = specs.quote.quoteText.split(/\s+/).filter(Boolean);

  assert.ok(words.length <= 12, specs.quote.quoteText);
  assert.ok(specs.quote.quoteText.length <= 96, specs.quote.quoteText);
  assert.match(specs.quote.quoteText, /\.\.\.$/);
  assert.equal(
    wrapQuoteLines(specs.quote.quoteText, { maxCharsPerLine: 28, maxLines: 3 }).overflow,
    false,
  );
});

test("quote layout class switches to compact mode for long safe quotes", () => {
  const quote =
    "This sentence is still concise enough to use, but long enough that the card needs compact layout.";

  assert.equal(quoteLayoutClass("Short sharp quote."), "quote");
  assert.equal(quoteLayoutClass(quote), "quote quote--compact");
  assert.equal(clampQuoteText(`${quote} Extra words that should not fit.`).split(/\s+/).length <= 12, true);
});

test("quote card HTML applies compact layout and safe clamped text", () => {
  const template = `
    <style>
      .quote { font-size: 76px; }
    </style>
    <div id="kicker">OLD</div>
    <div id="quote" class="quote"><span class="word">OLD</span></div>
    <div id="attribution">OLD ATTR</div>
    <div id="attribution-sub">OLD SUB</div>
  `;
  const html = applySpecToTemplate(
    "quote",
    template,
    {
      kicker: "KEY LINE",
      quoteText:
        "This is a very long quote that needs to be clamped before it reaches the HyperFrames template and cuts off on screen.",
      attribution: "GAMESPOT",
      attributionSub: "reported detail",
    },
    "pulse-gaming",
  );

  assert.match(html, /class="quote quote--compact"/);
  assert.match(html, /font-size:\s*50px/);
  assert.doesNotMatch(html, /cuts off on screen/);
  assert.match(html, /GAMESPOT/);
});

test("quote card fitting shortens long tokens before they can be cut off", () => {
  const quote =
    "SupercalifragilisticexpialidociousEditionWithRidiculousSuffix is somehow the key quote that would normally break the frame.";
  const fitted = clampQuoteText(quote);
  const wrapped = wrapQuoteLines(fitted, { maxCharsPerLine: 28, maxLines: 3 });

  assert.equal(wrapped.overflow, false, fitted);
  assert.ok(
    fitted.split(/\s+/).every((word) => word.length <= 25),
    fitted,
  );
  assert.match(fitted, /\.\.\./);
});
