"use strict";

// Reddit usernames are personal data. Videos credit a quoted Reddit
// comment as "Reddit comment" unless REDDIT_USERNAMES_ON_VIDEO=true.
// These tests pin the default (off) for every renderer that used to
// draw `u/<username>`: assemble.js (both render paths), the PRL comment
// swoop and the Studio quote card.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  GENERIC_REDDIT_LABEL,
  redditUsernamesOnVideo,
  redditCommentHandle,
} = require("../../lib/reddit-attribution");
const prl = require("../../lib/prl-overlays");
const { buildQuoteCardFilter } = require("../../lib/scenes/quote-card");

function withFlag(value, fn) {
  const before = process.env.REDDIT_USERNAMES_ON_VIDEO;
  if (value === undefined) delete process.env.REDDIT_USERNAMES_ON_VIDEO;
  else process.env.REDDIT_USERNAMES_ON_VIDEO = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.REDDIT_USERNAMES_ON_VIDEO;
    else process.env.REDDIT_USERNAMES_ON_VIDEO = before;
  }
}

const story = {
  top_comment: "This is going to flop hard, mark my words on this one",
  reddit_comments: [
    { author: "GamerXX", body: "This is going to flop hard", score: 547 },
  ],
};

test("reddit-attribution: the flag is off unless set to true", () => {
  assert.equal(redditUsernamesOnVideo({}), false);
  assert.equal(
    redditUsernamesOnVideo({ REDDIT_USERNAMES_ON_VIDEO: "" }),
    false,
  );
  assert.equal(
    redditUsernamesOnVideo({ REDDIT_USERNAMES_ON_VIDEO: "false" }),
    false,
  );
  assert.equal(
    redditUsernamesOnVideo({ REDDIT_USERNAMES_ON_VIDEO: "1" }),
    false,
  );
  assert.equal(
    redditUsernamesOnVideo({ REDDIT_USERNAMES_ON_VIDEO: "true" }),
    true,
  );
  assert.equal(
    redditUsernamesOnVideo({ REDDIT_USERNAMES_ON_VIDEO: " TRUE " }),
    true,
  );
});

test("reddit-attribution: default handle never contains the username", () => {
  assert.equal(redditCommentHandle("GamerXX", {}), GENERIC_REDDIT_LABEL);
  assert.equal(GENERIC_REDDIT_LABEL, "Reddit comment");
  assert.equal(
    redditCommentHandle("GamerXX", { REDDIT_USERNAMES_ON_VIDEO: "true" }),
    "u/GamerXX",
  );
  assert.equal(
    redditCommentHandle("", { REDDIT_USERNAMES_ON_VIDEO: "true" }),
    "u/Redditor",
  );
});

test("reddit-attribution: PRL comment swoop hides the username by default", () => {
  const off = withFlag(undefined, () =>
    prl.buildCommentSwoop({ story, fontOpt: "font='Arial'" }),
  );
  assert.ok(off.some((l) => l.includes("Reddit comment")));
  assert.ok(!off.some((l) => l.includes("GamerXX")));
  assert.ok(!off.some((l) => l.includes("u/")));
  // The score and the comment itself are still shown.
  assert.ok(off.some((l) => l.includes("↑547")));

  const on = withFlag("true", () =>
    prl.buildCommentSwoop({ story, fontOpt: "font='Arial'" }),
  );
  assert.ok(on.some((l) => l.includes("u/GamerXX")));
});

test("reddit-attribution: Studio quote card hides the username by default", () => {
  const args = {
    slot: 0,
    duration: 4,
    body: "This is going to flop hard",
    author: "GamerXX",
    score: 547,
    fontOpt: "font='Arial'",
  };
  const off = withFlag(undefined, () => buildQuoteCardFilter(args));
  assert.doesNotMatch(off, /GamerXX/);
  assert.match(off, /Reddit comment/);
  const on = withFlag("true", () => buildQuoteCardFilter(args));
  assert.match(on, /u\/GamerXX/);
});

test("reddit-attribution: assemble.js draws no raw u/<author> handle in either render path", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "assemble.js"),
    "utf8",
  );
  assert.doesNotMatch(src, /text='\s*u\/\$\{author\}/);
  const calls = src.match(/\$\{redditCommentHandle\(author\)\}/g) || [];
  assert.equal(
    calls.length,
    2,
    "both the main and the single-image fallback overlay must go through redditCommentHandle",
  );
});
