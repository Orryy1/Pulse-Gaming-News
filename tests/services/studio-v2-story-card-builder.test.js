"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildStoryCardSpecs,
  outputNameForCard,
  pickStoryBackdrop,
} = require("../../tools/studio-v2-build-story-cards");

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
