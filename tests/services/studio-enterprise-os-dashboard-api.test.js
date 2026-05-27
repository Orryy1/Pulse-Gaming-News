"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");

test("Studio Enterprise OS is exposed through an authenticated operator API and package script", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const packageJson = require("../../package.json");

  assert.match(server, /app\.get\("\/api\/studio\/enterprise-os", requireAuth/);
  assert.match(server, /buildStudioEnterpriseOSPack/);
  assert.equal(
    packageJson.scripts["ops:studio-enterprise-os"],
    "node tools/studio-enterprise-os.js",
  );
});

test("analytics dashboard shows the Studio Enterprise OS control panel", () => {
  const analytics = fs.readFileSync(path.join(ROOT, "src", "pages", "Analytics.tsx"), "utf8");

  assert.match(
    analytics,
    /apiGetAuthed<StudioEnterpriseOSResponse>\('\/api\/studio\/enterprise-os'\)/,
  );
  assert.match(analytics, /Studio Enterprise OS/);
  assert.match(analytics, /Autonomy Mode/);
  assert.match(analytics, /Next Actions/);
  assert.match(analytics, /Motion Readiness/);
  assert.match(analytics, /Security/);
});
