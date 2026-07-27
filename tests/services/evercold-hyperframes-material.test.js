"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  validatePlatformSafeZoneAudit,
} = require("../../lib/services/platform-safe-zones");

const ROOT = path.resolve(__dirname, "..", "..");
const PROJECT = path.join(
  ROOT,
  "videos",
  "evercold-bastion-short",
);

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT, relativePath), "utf8");
}

function sha256(relativePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(PROJECT, relativePath)))
    .digest("hex");
}

test("Evercold HyperFrames material is deterministic, local and exactly 28 seconds", () => {
  const html = read("index.html");
  const styles = read("styles.css");
  const timeline = read("timeline.js");

  assert.match(html, /data-composition-id="main"/);
  assert.match(html, /data-duration="28"/);
  assert.match(html, /data-fps="30"/);
  assert.match(
    html,
    /src="node_modules\/gsap\/dist\/gsap\.min\.js"/,
  );
  assert.match(
    html,
    /id="evercold-owned-motion"[\s\S]*class="clip"[\s\S]*src="assets\/evercold-owned-motion\.mp4"/,
  );
  assert.match(html, /data-start="0"/);
  assert.match(html, /data-track-index="1"/);
  assert.match(html, /src="timeline\.js"/);
  assert.match(html, /window\.__timelines\.main = timeline/);
  assert.match(timeline, /gsap\.timeline\(\{ paused: true \}\)/);
  assert.match(
    html,
    /<link rel="stylesheet" href="styles\.css"\s*\/>/,
  );
  assert.match(
    styles,
    /\.media-legal\s*\{[\s\S]*right:\s*264px;[\s\S]*top:\s*318px;[\s\S]*width:\s*241px;[\s\S]*height:\s*40px;[\s\S]*font-size:\s*20px;/,
  );
  assert.match(
    html,
    /id="media-legal"[\s\S]*class="media-legal"[\s\S]*data-safe-zone-role="attribution"[\s\S]*© SQUARE ENIX[\s\S]*<\/div>/,
  );
  assert.doesNotMatch(
    `${html}\n${styles}\n${timeline}`,
    /https?:\/\/|Date\.now\(|Math\.random\(|\bfetch\(/,
  );
});

test("Evercold HyperFrames material pins its authoring stack and exposes no external publish script", () => {
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(packageJson.scripts.check, "hyperframes check");
  assert.equal(packageJson.scripts.render, "hyperframes render");
  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /\bnpx\b|--yes/);
  assert.equal(packageJson.dependencies.gsap, "3.15.0");
  assert.equal(packageJson.devDependencies.hyperframes, "0.7.76");
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(
    lock.packages[""].devDependencies.hyperframes,
    "0.7.76",
  );
  assert.equal(lock.packages["node_modules/hyperframes"].version, "0.7.76");
  assert.equal(packageJson.scripts.publish, undefined);
});

test("Evercold HyperFrames material binds the governed owned-motion backbone", () => {
  const asset = "assets/evercold-owned-motion.mp4";

  assert.equal(
    sha256(asset),
    "1b0cfb638b87377e45aef4f22bb8d2d88666aa8108eea18784dd8a48e338139e",
  );
  assert.match(read("BRIEF.md"), /No third-party game footage/i);
  assert.match(read("BRIEF.md"), /No render-time network access/i);
  assert.match(read("STORYBOARD.md"), /duration:\s*28s/i);
});

test("Evercold keeps every meaningful overlay and embedded card inside the strict cross-platform portrait safe zone", () => {
  const html = read("index.html");
  const styles = read("styles.css");
  const audit = JSON.parse(
    read("evidence/platform-safe-zone-audit.json"),
  );
  const result = validatePlatformSafeZoneAudit({ audit });

  assert.equal(result.verdict, "GREEN");
  assert.equal(
    result.profile_id,
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  );
  assert.match(
    html,
    /data-platform-safe-zone-profile="portrait-cross-platform-strict-v1"/,
  );
  assert.match(
    styles,
    /#evercold-owned-motion-viewport\s*\{[\s\S]*left:\s*125px;[\s\S]*top:\s*240px;[\s\S]*width:\s*662px;[\s\S]*height:\s*1176px;[\s\S]*overflow:\s*hidden;/,
  );
  assert.match(
    styles,
    /#evercold-owned-motion\s*\{[\s\S]*left:\s*-125px;[\s\S]*top:\s*-240px;[\s\S]*width:\s*1080px;[\s\S]*height:\s*1920px;/,
  );

  for (const element of audit.elements) {
    assert.match(
      element.selector,
      /^#[a-z0-9][a-z0-9_-]*$/i,
      `audit selector must be a stable id: ${element.selector}`,
    );
    const id = element.selector.slice(1);
    const escapedBox = [
      element.bbox.x,
      element.bbox.y,
      element.bbox.width,
      element.bbox.height,
    ].join(",");
    assert.match(
      html,
      new RegExp(
        `id="${id}"[^>]*data-safe-zone-box="${escapedBox}"`,
      ),
      `composition must bind the audited box for ${id}`,
    );
  }

  for (const exemption of audit.decorative_exemptions) {
    const id = exemption.selector.slice(1);
    assert.match(
      html,
      new RegExp(
        `id="${id}"[^>]*data-safe-zone-exempt="decorative-full-bleed"`,
      ),
      `composition must mark the decorative exemption for ${id}`,
    );
  }
});
