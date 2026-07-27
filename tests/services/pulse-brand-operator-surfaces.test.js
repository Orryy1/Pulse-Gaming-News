"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..", "..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const navbar = fs.readFileSync(
  path.join(ROOT, "src", "components", "Navbar.tsx"),
  "utf8",
);
const legacyDashboard = fs.readFileSync(
  path.join(ROOT, "public", "index.html"),
  "utf8",
);
const runner = fs.readFileSync(path.join(ROOT, "run.js"), "utf8");

test("operator surfaces use the Pulse Gaming News display identity", () => {
  assert.match(navbar, /PULSE GAMING NEWS/);
  assert.match(legacyDashboard, /Pulse Gaming News \/\/ Command Centre/);
  assert.doesNotMatch(navbar, /PULSE GAMING <span/);
  assert.doesNotMatch(
    legacyDashboard,
    /PULSE GAMING \/\/ COMMAND CENTRE/,
  );
});

test("operator messages describe frozen platforms accurately", () => {
  assert.doesNotMatch(
    server,
    /Access token saved\. Pulse Gaming can now publish to TikTok\./,
  );
  assert.match(server, /TikTok remains manual-only during Pulse v1/);
  assert.doesNotMatch(
    server,
    /TT: \$\{result\.tiktok[\s\S]*IG: \$\{result\.instagram[\s\S]*FB:/,
  );
});

test("the dashboard shows the governed mode and has no autonomous-cycle control", () => {
  assert.match(server, /operatingMode:\s*operatingContract\.mode/);
  assert.match(
    server,
    /autonomousMode:\s*operatingContract\.live_mutation_allowed/,
  );
  assert.match(navbar, /autoStatus\.operatingMode/);
  assert.match(navbar, /HUMAN REVIEW REQUIRED/);
  assert.doesNotMatch(navbar, /triggerAutonomousCycle/);
  assert.doesNotMatch(navbar, /AUTO CYCLE/);
});

test("the command-line operator surface describes the controlled release", () => {
  assert.match(runner, /Pulse Gaming News/);
  assert.match(runner, /governed preparation/i);
  assert.match(runner, /human-review queue/i);
  assert.doesNotMatch(runner, /Upload to YouTube, TikTok, Instagram/);
  assert.doesNotMatch(runner, /complete autonomous cycle/i);
  assert.doesNotMatch(runner, /enable autonomous posting/i);
});
