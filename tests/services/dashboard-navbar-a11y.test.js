"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const NAVBAR = path.join(ROOT, "src", "components", "Navbar.tsx");

test("dashboard navbar keeps icon-first controls accessible on narrow screens", () => {
  const source = fs.readFileSync(NAVBAR, "utf8");
  for (const label of [
    "Stories",
    "Analytics",
    "Produce approved stories",
    "Refresh stories",
  ]) {
    assert.match(source, new RegExp(`aria-label="${label}"`));
  }
});
