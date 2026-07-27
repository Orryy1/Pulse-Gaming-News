"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  FORBIDDEN_FLAGS,
  main,
  parseArgs,
  usage,
} = require("../../tools/governed-source-media-ephemeral");

const HASH = "8d153578ab14efd5a6872e59a7273deb1c32223d87c6e36f5ef69cc936d09dd8";
const STORY_ID = "official_d86953ca92ca";
const ROOT = path.resolve(__dirname, "..", "..");

function argv(action = "acquire") {
  return [
    action,
    "--mode",
    "LOCAL_PROOF",
    "--manifest",
    "videos/evercold-bastion-short/source-media-manifest.json",
    "--manifest-sha256",
    HASH,
    "--story-id",
    STORY_ID,
  ];
}

test("CLI exposes explicit acquire and validate LOCAL_PROOF actions", () => {
  const acquire = parseArgs(argv("acquire"));
  const validate = parseArgs(argv("validate"));

  assert.equal(acquire.action, "acquire");
  assert.equal(validate.action, "validate");
  assert.equal(acquire.mode, "LOCAL_PROOF");
  assert.equal(acquire.expectedManifestSha256, HASH);
  assert.match(usage(), /EPHEMERAL_UNTRACKED/);
  assert.match(usage(), /never opens a database/i);
});

test("CLI refuses publishing, platform, database and credential flags", () => {
  for (const forbidden of FORBIDDEN_FLAGS) {
    assert.throws(
      () => parseArgs([...argv(), forbidden]),
      new RegExp(`forbidden_argument:${forbidden}`),
    );
  }
});

test("acquire action emits READY only after full governed validation", async () => {
  const calls = [];
  let output = "";
  const result = await main(argv("acquire"), {
    acquire: async (options) => {
      calls.push(options);
      return {
        schema_version:
          "pulse-governed-source-media-ephemeral-v1",
        operation: "ACQUIRE_EPHEMERAL_SOURCE_MEDIA",
        verdict: "READY",
        mode: "LOCAL_PROOF",
        persistence: "EPHEMERAL_UNTRACKED",
        assets: Array(7).fill({ status: "MATERIALISED" }),
      };
    },
    validateGoverned: (options) => {
      calls.push(["governed", options]);
      return {
        story_id: STORY_ID,
        manifest_sha256: HASH,
        rights_review: { sha256: "f".repeat(64) },
        components: Array(7).fill({}),
      };
    },
    stdout: {
      write(value) {
        output += value;
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].manifestPath,
    path.resolve(
      "videos/evercold-bastion-short/source-media-manifest.json",
    ),
  );
  assert.equal(calls[0].expectedManifestSha256, HASH);
  assert.equal(result.verdict, "READY");
  assert.equal(result.governed.component_count, 7);
  assert.equal(JSON.parse(output).ephemeral.assets.length, 7);
});

test("validate action runs ephemeral and governed validation without acquire", async () => {
  const calls = [];
  let output = "";
  const result = await main(argv("validate"), {
    acquire: async () => {
      throw new Error("acquire must not run");
    },
    validateEphemeral: (options) => {
      calls.push(["ephemeral", options]);
      return {
        operation: "VALIDATE_EPHEMERAL_SOURCE_MEDIA",
        verdict: "READY",
        assets: Array(7).fill({ status: "EXACT" }),
      };
    },
    validateGoverned: (options) => {
      calls.push(["governed", options]);
      return {
        story_id: STORY_ID,
        manifest_sha256: HASH,
        rights_review: { sha256: "f".repeat(64) },
        components: Array(7).fill({}),
      };
    },
    stdout: {
      write(value) {
        output += value;
      },
    },
  });

  assert.deepEqual(
    calls.map(([name]) => name),
    ["ephemeral", "governed"],
  );
  assert.equal(result.verdict, "READY");
  assert.equal(result.governed.component_count, 7);
  assert.equal(JSON.parse(output).governed.story_id, STORY_ID);
});

test("release gate acquires then validates before HyperFrames check", () => {
  const workflow = fs.readFileSync(
    path.join(
      ROOT,
      ".github",
      "workflows",
      "pulse-release.yml",
    ),
    "utf8",
  );
  const acquire = workflow.indexOf(
    "Acquire exact ephemeral Evercold source media",
  );
  const validate = workflow.indexOf(
    "Validate ephemeral bytes and governed rights evidence",
  );
  const hyperframes = workflow.indexOf(
    "Strictly check the Evercold HyperFrames material project",
  );

  assert.ok(acquire > -1);
  assert.ok(validate > acquire);
  assert.ok(hyperframes > validate);
  assert.equal(workflow.match(new RegExp(HASH, "g"))?.length, 2);
  assert.match(
    fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"),
    /videos\/evercold-bastion-short\/assets\/official\//,
  );
});
