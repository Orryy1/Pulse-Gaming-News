"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildCommentSwoop } = require("../../lib/prl-overlays");
const { buildSourceCardFilter } = require("../../lib/scenes/source-card");
const { buildQuoteBodyLayout } = require("../../lib/scenes/quote-card");
const { deriveCardContent } = require("../../lib/studio/v2/hf-card-builders");
const { wrapQuoteLines } = require("../../lib/studio/v2/quote-fit");
const { LEGACY_OVERLAY_LAYOUT } = require("../../assemble");

const ROOT = path.resolve(__dirname, "..", "..");
const FONT_OPT = "font='Arial'";

function yValuesFor(pattern, text) {
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
}

test("PRL comment card starts below top-left label safe area", () => {
  const out = buildCommentSwoop({
    story: {
      top_comment: "This quote should sit clear of the source bug and flair badge.",
      reddit_comments: [{ author: "Reader", body: "Real comment", score: 42 }],
    },
    fontOpt: FONT_OPT,
  }).join("\n");

  const cardY = yValuesFor(/drawbox=x=\(w-880\)\/2:y=(\d+):w=880/g, out);
  assert.deepEqual(cardY, [260], out);
});

test("legacy assemble render paths keep comment cards below top-left labels", () => {
  const src = fs.readFileSync(path.join(ROOT, "assemble.js"), "utf8");

  assert.equal(LEGACY_OVERLAY_LAYOUT.commentY, 300);
  assert.ok(
    LEGACY_OVERLAY_LAYOUT.commentY >= LEGACY_OVERLAY_LAYOUT.sourceY + 150,
    `comment cards should clear source label, got ${JSON.stringify(LEGACY_OVERLAY_LAYOUT)}`,
  );

  const yBaseReferences = [
    ...src.matchAll(/const yBase = LEGACY_OVERLAY_LAYOUT\.commentY;/g),
  ];
  assert.equal(
    yBaseReferences.length,
    2,
    "main and fallback paths should both use the shared safe overlay layout",
  );
});

test("standard source cards scale long source labels instead of clipping them", () => {
  const filter = buildSourceCardFilter({
    slot: 0,
    duration: 4,
    sourceLabel: "GamingLeaksAndRumoursInternationalNewswire",
    sublabel: "Verified",
    fontOpt: FONT_OPT,
  });

  assert.doesNotMatch(filter, /fontsize=96/);
  assert.match(filter, /GAMINGLEAKSANDRUMOURS/);
  assert.match(filter, /fontsize=5[246]/);
});

test("Studio v2 quote derivation clamps long source comments before card render", () => {
  const content = deriveCardContent({
    story: {
      id: "story_1",
      subreddit: "GamingLeaksAndRumours",
      source_type: "reddit",
      top_comment:
        "This is a very long community quote that would spill past the quote card safe frame because it keeps adding detail without giving the renderer a clean sentence break.",
    },
    pkg: {},
  });

  const words = content.quote.quoteText.split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 12, content.quote.quoteText);
  assert.ok(content.quote.quoteText.length <= 96, content.quote.quoteText);
  assert.match(content.quote.quoteText, /\.\.\.$/);
  assert.equal(
    wrapQuoteLines(content.quote.quoteText, { maxCharsPerLine: 28, maxLines: 3 }).overflow,
    false,
  );
});

test("Studio v2 quote derivation shortens long unbroken quote tokens", () => {
  const content = deriveCardContent({
    story: {
      id: "story_2",
      subreddit: "GamingLeaksAndRumours",
      source_type: "reddit",
      top_comment:
        "SupercalifragilisticexpialidociousEditionWithRidiculousSuffix should never become a one-line frame breaker.",
    },
    pkg: {},
  });

  assert.equal(
    wrapQuoteLines(content.quote.quoteText, { maxCharsPerLine: 28, maxLines: 3 }).overflow,
    false,
  );
  assert.ok(
    content.quote.quoteText.split(/\s+/).every((word) => word.length <= 25),
    content.quote.quoteText,
  );
});

test("full-screen quote cards cap body copy to a compact safe block", () => {
  const layout = buildQuoteBodyLayout(
    "This is a long community quote that keeps adding detail and context until it would otherwise become a boring wall of text inside a fast gaming short.",
  );

  assert.ok(layout.lines.length <= 4, layout.lines.join(" / "));
  assert.ok(layout.blockTop >= layout.safeBounds.top);
  assert.ok(layout.blockBottom <= layout.safeBounds.bottom);
  assert.ok(layout.truncated, "long quote should be truncated instead of overflowing");
});

test("Studio v2 entity badges keep kicker and label vertical bands separated", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "lib", "studio", "ffmpeg-scene-renderer.js"),
    "utf8",
  );

  assert.match(src, /layout\.kickerY\)\) \? Number\(layout\.kickerY\) : 250/);
  assert.match(src, /layout\.labelY\)\) \? Number\(layout\.labelY\) : 306/);
  assert.match(src, /kickerY: 250, labelY: 306/);
});
