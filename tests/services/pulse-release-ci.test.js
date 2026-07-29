"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "pulse-release.yml");
const DOCKERFILE = path.join(ROOT, "Dockerfile");
const DOCKERIGNORE = path.join(ROOT, ".dockerignore");
const PACKAGE_JSON = path.join(ROOT, "package.json");
const RAILWAY_CONFIG = path.join(ROOT, "railway.json");
const EVERCOLD_ROOT = path.join(
  ROOT,
  "videos",
  "evercold-bastion-short",
);
const EVERCOLD_SOURCE_MEDIA_MANIFEST = path.join(
  EVERCOLD_ROOT,
  "source-media-manifest.json",
);

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("Pulse release workflow enforces lockfile install, tests, build and redacted secret scan", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");

  assert.match(yaml, /permissions:\s*\n\s+contents:\s+read/);
  assert.match(yaml, /pull_request:/);
  assert.match(yaml, /push:/);
  assert.match(yaml, /release\/pulse-v1/);
  assert.match(
    yaml,
    /uses:\s+actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/,
  );
  assert.match(
    yaml,
    /uses:\s+actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e\s+# v6\.4\.0/,
  );
  assert.match(yaml, /node-version:\s+22/);
  assert.match(yaml, /run:\s+npm ci/);
  assert.match(
    yaml,
    /sudo apt-get update\s*\n\s+sudo apt-get install --yes ffmpeg/,
  );
  assert.ok(
    yaml.indexOf("sudo apt-get install --yes ffmpeg") <
      yaml.indexOf("Prove release configuration and evidence controls"),
    "ffmpeg must be installed before tests that generate and probe media fixtures",
  );
  assert.match(yaml, /node --test/);
  assert.match(yaml, /tests\/services\/report-governance\.test\.js/);
  assert.match(yaml, /tests\/services\/ci-secret-scan\.test\.js/);
  assert.match(yaml, /run:\s+node tools\/ci-secret-scan\.js/);
  assert.match(yaml, /run:\s+npm run ops:agent-rules/);
  assert.match(yaml, /run:\s+npm test/);
  assert.match(yaml, /run:\s+npm run build/);
  assert.doesNotMatch(yaml, /\$\{\{\s*secrets\./);

  const referencedTests = [
    ...yaml.matchAll(/tests\/(?:services|ops)\/[a-z0-9-]+\.test\.js/g),
  ].map((match) => match[0]);
  assert.ok(referencedTests.length > 0);
  for (const testPath of referencedTests) {
    assert.equal(
      fs.existsSync(path.join(ROOT, testPath)),
      true,
      `${testPath} must exist in a clean checkout`,
    );
  }
});

test("Pulse release workflow checks the nested HyperFrames material project", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");

  assert.match(
    yaml,
    /run:\s+npm --prefix videos\/evercold-bastion-short ci/,
  );
  assert.match(
    yaml,
    /run:\s+npm --prefix videos\/evercold-bastion-short run check -- --strict/,
  );
});

test("Pulse release workflow pins the exact internally consistent Evercold source-media evidence chain", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");
  const manifestBytes = fs.readFileSync(
    EVERCOLD_SOURCE_MEDIA_MANIFEST,
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const manifestSha256 = sha256Bytes(manifestBytes);
  const rightsReviewPath = path.resolve(
    EVERCOLD_ROOT,
    manifest.rights_review.path,
  );
  const rightsReviewSha256 = sha256Bytes(
    fs.readFileSync(rightsReviewPath),
  );

  assert.equal(
    manifest.rights_review.sha256,
    rightsReviewSha256,
    "the manifest must bind the exact tracked rights review bytes",
  );
  assert.equal(
    (
      yaml.match(
        new RegExp(`--manifest-sha256 ${manifestSha256}`, "g"),
      ) || []
    ).length,
    2,
    "both release acquisition and validation must pin the exact manifest bytes",
  );
});

test("production, CI and package metadata bind the same exact Node 22 runtime contract", () => {
  const dockerfile = fs.readFileSync(DOCKERFILE, "utf8");
  const manifest = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  const railway = JSON.parse(
    fs.readFileSync(RAILWAY_CONFIG, "utf8"),
  );

  assert.equal(manifest.engines.node, "22.x");
  assert.match(
    dockerfile,
    /^FROM node:22\.17\.1-slim@sha256:2fa754a9ba4d7adbd2a51d182eaabbe355c82b673624035a38c0d42b08724854/m,
  );
  assert.match(
    dockerfile,
    /COPY package\.json package-lock\.json \.\/\s*\nRUN npm ci/,
  );
  assert.doesNotMatch(dockerfile, /\bRUN npm install\b/);
  assert.match(
    dockerfile,
    /https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/download\/2026\.06\.09\/yt-dlp/,
  );
  assert.match(
    dockerfile,
    /echo "e5d57466682cfa9d61e9cf7c8a4f09b00f4a62af37d3bbdc4bcffdf63615feac  \/usr\/local\/bin\/yt-dlp" \| sha256sum --check --strict/,
  );
  assert.doesNotMatch(dockerfile, /releases\/latest/);
  assert.deepEqual(railway.build, {
    builder: "DOCKERFILE",
    dockerfilePath: "Dockerfile",
  });
  assert.equal(
    railway.deploy.startCommand,
    "npm start",
    "Railway and the production image must share package.json's canonical start contract",
  );
  assert.match(
    dockerfile,
    /CMD \["npm",\s*"start"\]/,
    "the production image must use package.json's canonical start contract",
  );
});

test("the production image context excludes secrets and mutable runtime state without dropping required media packs", () => {
  const dockerignore = fs.readFileSync(DOCKERIGNORE, "utf8");

  for (const requiredPattern of [
    ".git",
    ".env",
    ".env.*",
    "tokens",
    "node_modules",
    "output",
    "test/output",
    ".codex-remote-attachments",
    "*.db",
    "*.sqlite*",
  ]) {
    assert.match(
      dockerignore,
      new RegExp(
        `^${requiredPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "m",
      ),
      `${requiredPattern} must be excluded from the Docker context`,
    );
  }
  assert.doesNotMatch(
    dockerignore,
    /^(?:audio|branding|channels|videos)\/?$/m,
    "runtime media, channel and renderer packs must remain available",
  );
});

test("Pulse release workflow runs every governed service and ops test", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");
  const governedTests = [
    ...["services", "ops"].flatMap((area) => {
      const directory = path.join(ROOT, "tests", area);
      return fs
        .readdirSync(directory)
        .filter((name) => /^governed-.*\.test\.js$/.test(name))
        .map((name) => `tests/${area}/${name}`);
    }),
    "tests/services/guarded-youtube-window.test.js",
    "tests/ops/guarded-youtube-window-cli.test.js",
    "tests/services/platform-safe-zones.test.js",
    "tests/services/evercold-hyperframes-material.test.js",
    "tests/services/evercold-platform-safe-zone-runtime.test.js",
    "tests/ops/agent-operator-command-contract.test.js",
    "tests/services/agent-operating-rules.test.js",
  ];

  for (const testPath of governedTests) {
    assert.match(
      yaml,
      new RegExp(testPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${testPath} must run in the focused release gate`,
    );
  }
});

test("Pulse release workflow exercises every live-critical autonomous publication seam", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");
  const criticalTests = [
    "tests/db/publication-authority-audit-migration.test.js",
    "tests/db/publication-governance-repository.test.js",
    "tests/db/stabilisation-governance-upgrade.test.js",
    "tests/db/stabilisation-migration-approval.test.js",
    "tests/db/youtube-private-prestage-governance.test.js",
    "tests/ops/autonomous-official-source-evidence-apply-cli.test.js",
    "tests/services/autonomous-admission-control-proof.test.js",
    "tests/services/autonomous-green-admission.test.js",
    "tests/services/autonomous-official-candidate-staging.test.js",
    "tests/services/autonomous-official-jit-admission-packet.test.js",
    "tests/services/autonomous-official-publication-authority.test.js",
    "tests/services/autonomous-official-source-evidence-apply.test.js",
    "tests/services/bounded-verification-convergence.test.js",
    "tests/services/breaking-source-evidence.test.js",
    "tests/services/governed-autonomous-jit-admission-handler.test.js",
    "tests/services/governed-youtube-autonomous-eligibility-attestation.test.js",
    "tests/services/governed-youtube-scheduled-replay-verifier.test.js",
    "tests/services/multi-lane-job-routing.test.js",
    "tests/services/multi-lane-autonomous-jit-routing.test.js",
    "tests/services/official-source-revalidation.test.js",
    "tests/services/publication-admission.test.js",
    "tests/services/publication-lifecycle.test.js",
    "tests/services/publisher-lock.test.js",
    "tests/services/publisher-qa-persistence.test.js",
    "tests/services/pulse-editorial-contract.test.js",
    "tests/services/pulse-gaming-currency-policy.test.js",
    "tests/services/reddit-breaking-source.test.js",
    "tests/services/youtube-account-binding-verifier.test.js",
    "tests/services/youtube-private-object-verifier.test.js",
    "tests/services/youtube-public-object-verifier.test.js",
    "tests/services/youtube-scheduled-object-armer.test.js",
    "tests/services/youtube-scheduled-object-disarmer.test.js",
    "tests/services/youtube-upload-governance.test.js",
  ];

  for (const testPath of criticalTests) {
    assert.equal(
      fs.existsSync(path.join(ROOT, testPath)),
      true,
      `${testPath} must exist in a clean checkout`,
    );
    assert.match(
      yaml,
      new RegExp(testPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${testPath} must run in the focused release gate`,
    );
  }
});

test("new governed intake, media admission and autonomous evidence tools have explicit operator commands", () => {
  const manifest = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));

  assert.equal(
    manifest.scripts[
      "ops:autonomous-official-source-evidence-apply"
    ],
    "node tools/autonomous-official-source-evidence-apply.js",
  );
  assert.equal(
    manifest.scripts["ops:governed-game-media-admission"],
    "node tools/governed-game-media-admission.js",
  );
  assert.equal(
    manifest.scripts[
      "ops:governed-story-intake-inventory-bridge"
    ],
    "node tools/governed-story-intake-inventory-bridge.js",
  );
});
