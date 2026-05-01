"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildReleaseDateCardFilter,
} = require("../../lib/scenes/release-date-card");

test("known-unknown release card keeps the backdrop bright enough for forensic QA", () => {
  const filter = buildReleaseDateCardFilter({
    slot: 0,
    duration: 4,
    dateLabel: "NO DATE YET",
    kicker: "KNOWN UNKNOWN",
    sublabel: "PLATFORMS AND LAUNCH WINDOW STILL UNSAID",
    fontOpt: "font='Arial'",
  });

  assert.doesNotMatch(filter, /brightness=-0\.3/);
  assert.match(filter, /brightness=0\.02/);
  assert.match(filter, /black@0\.30/);
  assert.match(filter, /black@0\.18/);
});
