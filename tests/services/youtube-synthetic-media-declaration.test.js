"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  channels,
  youtubeSyntheticMediaDeclaration,
} = require("../../channels");

test("every channel declares containsSyntheticMedia as an explicit boolean", () => {
  const ids = Object.keys(channels);
  assert.ok(ids.length > 0, "no channel configs discovered");
  for (const id of ids) {
    assert.equal(
      typeof channels[id].containsSyntheticMedia,
      "boolean",
      `${id} must set containsSyntheticMedia to true or false`,
    );
  }
});

test("AI-narrated channels declare synthetic media", () => {
  // All three live channels use an AI narrator, so the YouTube declaration
  // must be true. A new channel with a human voice can set false explicitly.
  for (const id of ["pulse-gaming", "stacked", "the-signal"]) {
    assert.equal(
      youtubeSyntheticMediaDeclaration(channels[id]),
      true,
      `${id} should declare synthetic media`,
    );
  }
});

test("a channel without the declaration cannot upload", () => {
  assert.throws(
    () => youtubeSyntheticMediaDeclaration({ id: "no-flag" }),
    /no-flag must set containsSyntheticMedia/,
  );
  assert.throws(
    () =>
      youtubeSyntheticMediaDeclaration({
        id: "stringy",
        containsSyntheticMedia: "true",
      }),
    /must set containsSyntheticMedia/,
  );
});

test("the active channel resolves when none is passed", () => {
  const prev = process.env.CHANNEL;
  process.env.CHANNEL = "pulse-gaming";
  try {
    assert.equal(youtubeSyntheticMediaDeclaration(), true);
  } finally {
    if (prev === undefined) delete process.env.CHANNEL;
    else process.env.CHANNEL = prev;
  }
});
