"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMetadata } = require("../../upload_youtube");
const { buildInstagramReelCaption } = require("../../upload_instagram");
const { buildFacebookReelDescription } = require("../../upload_facebook");

test("YouTube Shorts metadata prefers platform-native description copy", () => {
  const meta = buildMetadata({
    id: "forza-platform-copy",
    title: "Forza Horizon 6 Puts Xbox's PC Bet Under Pressure",
    canonical_subject: "Forza Horizon 6",
    classification: "NEWS",
    flair: "News",
    youtube_description:
      "Forza Horizon 6 just turned Xbox's PC strategy into something players can judge before launch.",
    full_script:
      "Forza Horizon 6 just made Xbox's PC strategy impossible to ignore before launch. This older script excerpt should not become the first description block when a platform package supplies stronger YouTube copy.",
    source_type: "rss",
    subreddit: "Eurogamer",
    url: "https://www.eurogamer.net/example",
    content_pillar: "Source Breakdown",
  });

  assert.match(
    meta.description,
    /^Forza Horizon 6 just turned Xbox's PC strategy into something players can judge/,
  );
  assert.doesNotMatch(meta.description.split("\n\n")[0], /older script excerpt/i);
});

test("Instagram Reels caption prefers platform-native caption copy", () => {
  const caption = buildInstagramReelCaption(
    {
      title: "Forza Horizon 6 Puts Xbox's PC Bet Under Pressure",
      instagram_caption:
        "Forza Horizon 6 just turned Xbox's PC strategy into something players can judge before launch.",
      full_script:
        "This old narration excerpt should not lead the Instagram caption when native package copy exists.",
    },
    { hashtags: ["#Shorts", "#Gaming"] },
  );

  assert.match(caption, /^Forza Horizon 6 just turned Xbox's PC strategy/);
  assert.match(caption, /#reels/);
  assert.doesNotMatch(caption, /old narration excerpt/i);
});

test("Facebook Reels description prefers platform-native page caption", () => {
  const description = buildFacebookReelDescription({
    title: "Forza Horizon 6 Puts Xbox's PC Bet Under Pressure",
    facebook_page_caption:
      "Forza Horizon 6 just turned Xbox's PC strategy into something players can judge before launch. More context: /p/forza",
    full_script:
      "This old narration excerpt should not lead the Facebook Reel when native package copy exists.",
  });

  assert.match(description, /^Forza Horizon 6 just turned Xbox's PC strategy/);
  assert.match(description, /#gamingnews/);
  assert.doesNotMatch(description, /old narration excerpt/i);
});
