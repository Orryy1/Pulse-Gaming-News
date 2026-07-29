"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(
  ROOT,
  "tools",
  "weekly-longform-runtime-capabilities.js",
);

const {
  parseArgs,
  run,
} = require("../../tools/weekly-longform-runtime-capabilities");

test("CLI loads local env once and emits only the capability document", () => {
  const env = {
    ELEVENLABS_API_KEY: "must-never-appear",
    ELEVENLABS_VOICE_ID: "must-never-appear",
  };
  const document = {
    schema_version:
      "pulse-weekly-longform-runtime-capabilities-v1",
    generated_at: "2026-07-28T12:00:00.000Z",
    ready: true,
    blockers: [],
    dependencies: {
      produceNarration: { available: true },
      materializeAlignment: { available: true },
      renderLongform: { available: true },
      materializeVariants: { available: true },
      runDecodedQa: { available: true },
      materializeDerivatives: { available: true },
    },
    safety: {
      implicit_network_enabled: false,
      implicit_process_spawn_enabled: false,
      upload_authority: false,
      oauth_mutation_authority: false,
      database_mutation_authority: false,
    },
  };
  let loaded = 0;
  let probed = null;
  let persisted = null;
  const result = run(
    [
      "node",
      TOOL,
      "--output-dir",
      "runtime-proof",
      "--now",
      document.generated_at,
      "--json",
    ],
    {
      env,
      dotenv: { config() {} },
      loadDotenvOnce(options) {
        loaded += 1;
        assert.equal(options.env, env);
        return {
          loaded: true,
          parsed_keys: [
            "ELEVENLABS_API_KEY",
            "ELEVENLABS_VOICE_ID",
          ],
        };
      },
      probe(options) {
        probed = options;
        return document;
      },
      persist(options) {
        persisted = options;
        return {
          json_path: "runtime-proof/runtime.json",
          markdown_path: "runtime-proof/runtime.md",
        };
      },
    },
  );

  assert.equal(loaded, 1);
  assert.equal(probed.env, env);
  assert.equal(probed.generatedAt, document.generated_at);
  assert.equal(persisted.document, document);
  assert.equal(persisted.outputDirectory, "runtime-proof");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.output), document);
  assert.doesNotMatch(
    result.output,
    /must-never-appear|parsed_keys|json_path|markdown_path/,
  );
});

test("CLI requires an explicit output directory and valid timestamp", () => {
  assert.throws(
    () => parseArgs(["node", TOOL]),
    /weekly_longform_runtime_capability_output_directory_required/,
  );
  assert.throws(
    () =>
      parseArgs([
        "node",
        TOOL,
        "--output-dir",
        "runtime-proof",
        "--now",
        "invalid",
      ]),
    /weekly_longform_runtime_capability_time_invalid/,
  );
});

test("CLI surface imports no database, OAuth or publishing implementation", () => {
  const source = fs.readFileSync(TOOL, "utf8");
  assert.doesNotMatch(source, /require\(["']\.\.\/lib\/db["']\)/);
  assert.doesNotMatch(source, /require\(["']\.\.\/publisher["']\)/);
  assert.doesNotMatch(source, /require\(["']\.\.\/upload_/);
  assert.doesNotMatch(source, /require\(["']\.\.\/lib\/oauth/);
  assert.doesNotMatch(source, /console\.log\s*\(\s*process\.env/);
});

test("real CLI fails closed without narration credentials and writes collector-ready artefacts", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-longform-capability-cli-"),
  );
  const outputDirectory = path.join(root, "proof");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.ELEVENLABS_API_KEY;
  delete env.ELEVENLABS_VOICE_ID;

  const result = spawnSync(
    process.execPath,
    [
      TOOL,
      "--output-dir",
      outputDirectory,
      "--now",
      "2026-07-28T12:00:00.000Z",
      "--json",
    ],
    {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    },
  );

  assert.equal(result.status, 2, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.ready, false);
  assert.equal(
    document.dependencies.produceNarration.available,
    false,
  );
  assert.ok(
    document.blockers.includes("elevenlabs_api_key_unavailable"),
  );
  assert.ok(
    document.blockers.includes("elevenlabs_voice_id_unavailable"),
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(
          outputDirectory,
          "weekly-longform-runtime-capabilities.json",
        ),
        "utf8",
      ),
    ),
    document,
  );
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /ELEVENLABS_API_KEY\s*[:=]\s*[^\s"]/,
  );
});

test("real CLI becomes READY from local binaries, packages, fonts and credential presence without contacting a provider", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-longform-capability-ready-"),
  );
  const outputDirectory = path.join(root, "proof");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const secret = "presence-only-never-export";
  const env = {
    ...process.env,
    ELEVENLABS_API_KEY: secret,
    ELEVENLABS_VOICE_ID: secret,
    PULSE_STATE_ROOT: path.join(root, "state"),
  };

  const result = spawnSync(
    process.execPath,
    [
      TOOL,
      "--output-dir",
      outputDirectory,
      "--now",
      "2026-07-28T12:00:00.000Z",
      "--json",
    ],
    {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.ready, true);
  assert.deepEqual(document.blockers, []);
  for (const dependency of Object.values(document.dependencies)) {
    assert.equal(dependency.available, true);
  }
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secret),
  );
});

test("package exposes the local weekly-longform runtime capability probe", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts[
      "ops:weekly-longform-runtime-capabilities"
    ],
    "node tools/weekly-longform-runtime-capabilities.js",
  );
});
