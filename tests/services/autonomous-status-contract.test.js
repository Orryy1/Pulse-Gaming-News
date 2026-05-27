"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVER_PATH = path.join(__dirname, "..", "..", "server.js");
const source = fs.readFileSync(SERVER_PATH, "utf8");

test("autonomous status schedule matches the dashboard render contract", () => {
  const routeStart = source.indexOf('app.get("/api/autonomous/status"');
  assert.notEqual(routeStart, -1, "missing /api/autonomous/status route");

  const routeEnd = source.indexOf("// --- Platform auth status ---", routeStart);
  assert.notEqual(routeEnd, -1, "could not isolate autonomous status route");

  const routeSource = source.slice(routeStart, routeEnd);
  assert.match(routeSource, /hunts:\s*\[/, "schedule.hunts must be an array");
  assert.match(routeSource, /produce:\s*["'`]/, "schedule.produce must be text");
  assert.match(routeSource, /publish:\s*["'`]/, "schedule.publish must be text");
});
