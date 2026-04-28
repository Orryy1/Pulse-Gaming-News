"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Discord auto-post client uses Events.ClientReady, not deprecated ready event", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "discord", "auto_post.js"),
    "utf8",
  );

  assert.match(src, /Events\.ClientReady/);
  assert.doesNotMatch(src, /\.once\(["']ready["']/);
});
