"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LEGACY_OVERLAY_LAYOUT,
  wrapDrawtextLines,
} = require("../../assemble");

test("legacy overlay layout keeps comment cards clear of top-left badges", () => {
  assert.equal(LEGACY_OVERLAY_LAYOUT.flairY, 60);
  assert.equal(LEGACY_OVERLAY_LAYOUT.sourceY, 130);
  assert.ok(
    LEGACY_OVERLAY_LAYOUT.commentY >= LEGACY_OVERLAY_LAYOUT.sourceY + 150,
    "comment cards need enough vertical gap below flair/source badges",
  );
});

test("legacy comment wrapping clamps long quotes to a safe card height", () => {
  const lines = wrapDrawtextLines(
    "This quote is deliberately very long because viewer-facing comment cards must never spill off the frame, cover the lower captions or get visibly cut off during a short-form render.",
    {
      maxChars: LEGACY_OVERLAY_LAYOUT.commentLineChars,
      maxLines: LEGACY_OVERLAY_LAYOUT.maxCommentLines,
    },
  );

  assert.equal(lines.length, LEGACY_OVERLAY_LAYOUT.maxCommentLines);
  assert.ok(lines.every((line) => line.length <= LEGACY_OVERLAY_LAYOUT.commentLineChars));
  assert.match(lines.at(-1), /\.\.\.$/);
});

test("legacy comment wrapping chunks oversized tokens instead of expanding cards", () => {
  const lines = wrapDrawtextLines("SuperLongUnbrokenGameIdentifierThatWouldOtherwiseOverflow", {
    maxChars: 16,
    maxLines: 4,
  });

  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => line.length <= 16));
});
