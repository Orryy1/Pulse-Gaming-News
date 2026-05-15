"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildCommentSwoop } = require("../../lib/prl-overlays");
const { buildSourceCardFilter } = require("../../lib/scenes/source-card");
const { deriveCardContent } = require("../../lib/studio/v2/hf-card-builders");
const { wrapQuoteLines } = require("../../lib/studio/v2/quote-fit");

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
  const yBases = yValuesFor(/const yBase = (\d+);/g, src).filter((value) =>
    [220, 230, 240, 250, 260].includes(value),
  );

  assert.equal(yBases.length, 2, `expected main and fallback yBase, got ${yBases}`);
  assert.deepEqual(yBases, [260, 260]);
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
