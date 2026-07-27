"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

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
  assert.match(html, /window\.__timelines\.main = timeline/);
  assert.match(html, /gsap\.timeline\(\{ paused: true \}\)/);
  assert.doesNotMatch(
    html,
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
    "a978664174cb319a63898d716aae5b26219966fe18f58cd046a70e255310f5bf",
  );
  assert.match(read("BRIEF.md"), /No third-party game footage/i);
  assert.match(read("BRIEF.md"), /No render-time network access/i);
  assert.match(read("STORYBOARD.md"), /duration:\s*28s/i);
});
