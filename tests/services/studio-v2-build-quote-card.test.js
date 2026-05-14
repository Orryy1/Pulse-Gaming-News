"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQuoteWordSpans,
  clampQuoteText,
  pickFontSize,
} = require("../../tools/studio-v2-build-quote-card");

test("standalone Studio v2 quote-card builder clamps long quotes before HyperFrames render", () => {
  const rawQuote =
    "This is a very long community quote that would spill past the safe frame because it keeps adding extra context, another clause and a final thought the card cannot display.";
  const quote = clampQuoteText(rawQuote);
  const words = quote.split(/\s+/).filter(Boolean);
  const markup = buildQuoteWordSpans(quote);

  assert.ok(words.length <= 12, quote);
  assert.ok(quote.length <= 96, quote);
  assert.match(quote, /\.\.\.$/);
  assert.doesNotMatch(markup, /final/);
  assert.equal(pickFontSize(quote), 54);
});
