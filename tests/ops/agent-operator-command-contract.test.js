"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const REPAIRED_COMMANDS = [
  "bridge-live-rights-repair",
  "bridge-preflight-stamp-repair",
  "goal-audio-materialize",
  "goal-audio-timestamps",
  "goal-owned-motion",
  "goal-platform-duration-contract",
  "goal-platform-native-repair",
  "goal-platform-variants",
  "goal-production-render",
  "goal-render-inputs",
  "pipeline-backlog",
  "v4-motion-pack",
  "v4-source-family-acquisition",
];
const GOVERNED_COMMANDS = new Map([
  ["ops:story-intake", "tools/governed-story-intake.js"],
  ["ops:governed-owned-motion", "tools/governed-owned-motion.js"],
  [
    "ops:governed-narration-materialize",
    "tools/governed-narration-materialize.js",
  ],
  ["ops:governed-final-composite", "tools/governed-final-composite.js"],
  [
    "ops:governed-publication-review",
    "tools/governed-publication-review.js",
  ],
  [
    "ops:governed-publication-evidence-package",
    "tools/governed-publication-evidence-package.js",
  ],
  [
    "ops:window-candidate-authority",
    "tools/governed-youtube-window-candidate-authority.js",
  ],
  ["ops:guarded-youtube-window", "tools/guarded-youtube-window.js"],
]);

function documentedNpmCommands() {
  const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  return [
    ...new Set(
      [...agents.matchAll(/`npm run ([^`\s]+)/g)].map((match) => match[1]),
    ),
  ].sort();
}

function documentedFocusedTests() {
  const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  return [
    ...new Set(
      [...agents.matchAll(/node --test\s+([^\s`]+\.test\.js)/g)].map(
        (match) => match[1],
      ),
    ),
  ].filter((testPath) => !/[<>]/.test(testPath)).sort();
}

test("every npm command documented in AGENTS.md resolves to a local entry point", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );

  for (const commandName of documentedNpmCommands()) {
    const command = packageJson.scripts?.[commandName];
    assert.equal(
      typeof command,
      "string",
      `${commandName} is documented but absent from package.json`,
    );

    const nodeMatch = command.match(/^node\s+([^\s]+\.js)(?:\s|$)/);
    if (!nodeMatch) continue;
    assert.equal(
      fs.existsSync(path.join(ROOT, nodeMatch[1])),
      true,
      `${commandName} points at missing entry point ${nodeMatch[1]}`,
    );
  }
});

test("governed cutover commands resolve to their exact reviewed entry points", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );

  for (const [commandName, entrypoint] of GOVERNED_COMMANDS) {
    assert.equal(
      packageJson.scripts?.[commandName],
      `node ${entrypoint}`,
      `${commandName} must resolve only to ${entrypoint}`,
    );
    assert.equal(
      fs.existsSync(path.join(ROOT, entrypoint)),
      true,
      `${entrypoint} must exist in a clean checkout`,
    );
  }
});

test("AGENTS.md documents every governed cutover command explicitly", () => {
  const documented = new Set(documentedNpmCommands());

  for (const commandName of GOVERNED_COMMANDS.keys()) {
    assert.equal(
      documented.has(commandName),
      true,
      `${commandName} must be named in the operator command map`,
    );
  }
});

test("every focused test path documented in AGENTS.md exists", () => {
  const documented = documentedFocusedTests();
  assert.ok(documented.length > 0);
  assert.ok(documented.some((testPath) => testPath.startsWith("tests/ops/")));
  assert.ok(
    documented.some((testPath) => testPath.startsWith("tests/services/")),
  );

  for (const testPath of documented) {
    assert.equal(
      fs.existsSync(path.join(ROOT, testPath)),
      true,
      `${testPath} must exist in a clean checkout`,
    );
  }
});

test("operator docs preserve standard cadence and name every one-shot confirmation", () => {
  const documents = [
    fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8"),
    fs.readFileSync(path.join(ROOT, "DEPLOYMENT_RUNBOOK.md"), "utf8"),
  ];
  const flags = [
    "--outside-cadence-authorisation-id",
    "--confirm-outside-cadence-authorisation-id",
    "--confirm-outside-cadence-one-shot",
  ];

  for (const document of documents) {
    assert.match(document, /standard cadence remains the default/i);
    assert.match(document, /does not bypass/i);
    for (const flag of flags) assert.match(document, new RegExp(flag));
  }
});

test("production render command defaults to a truthful local-proof HOLD", () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-operator-command-"),
  );
  const outDir = path.join(workspace, "proof");

  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "tools", "operator-command-contract.js"),
        "goal-production-render",
        "--state-root",
        workspace,
        "--out-dir",
        outDir,
        "--generated-at",
        "2026-07-27T12:00:00.000Z",
        "--json",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          AUTO_PUBLISH: "true",
          GUARDED_PUBLISH_DISPATCH: "true",
          PULSE_SKIP_DOTENV: "true",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "goal-production-render.json"),
        "utf8",
      ),
    );
    assert.equal(report.schema_version, "pulse-operator-command-contract-v1");
    assert.equal(report.execution_mode, "LOCAL_PROOF");
    assert.equal(report.command, "goal-production-render");
    assert.equal(report.execution_status, "COMPLETE");
    assert.equal(report.readiness, "HOLD");
    assert.equal(report.publish_authorised, false);
    assert.equal(report.capability.materialisation_performed, false);
    assert.equal(report.capability.production_implementation_available, false);
    assert.deepEqual(report.safety.external_calls, []);
    assert.equal(report.safety.production_database_mutated, false);
    assert.equal(report.safety.oauth_or_tokens_mutated, false);
    assert.equal(report.safety.platform_objects_created, false);
    assert.equal(report.safety.live_publish_attempted, false);
    assert.match(
      report.blockers.join(" "),
      /production materialiser was not ported/i,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("every repaired operator command completes without external or mutable effects", () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-operator-command-suite-"),
  );

  try {
    for (const command of REPAIRED_COMMANDS) {
      const outDir = path.join(workspace, "proof", command);
      const result = spawnSync(
        process.execPath,
        [
          path.join(ROOT, "tools", "operator-command-contract.js"),
          command,
          "--state-root",
          workspace,
          "--out-dir",
          outDir,
          "--generated-at",
          "2026-07-27T12:30:00.000Z",
          "--json",
        ],
        {
          cwd: ROOT,
          encoding: "utf8",
          env: {
            ...process.env,
            AUTO_PUBLISH: "true",
            GUARDED_PUBLISH_DISPATCH: "true",
            PULSE_SKIP_DOTENV: "true",
          },
        },
      );

      assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      const report = JSON.parse(
        fs.readFileSync(path.join(outDir, `${command}.json`), "utf8"),
      );
      assert.equal(report.command, command);
      assert.equal(report.execution_status, "COMPLETE");
      assert.equal(report.readiness, "HOLD");
      assert.equal(report.publish_authorised, false);
      assert.deepEqual(report.safety.external_calls, []);
      assert.equal(report.safety.production_database_mutated, false);
      assert.equal(report.safety.oauth_or_tokens_mutated, false);
      assert.equal(report.safety.platform_objects_created, false);
      assert.equal(report.safety.live_publish_attempted, false);
      assert.equal(
        fs.existsSync(path.join(outDir, `${command}.md`)),
        true,
      );
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("local JSON inputs are summarised without leaking their contents", () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-operator-command-input-"),
  );
  const inputDir = path.join(workspace, "output", "goal-contract");
  const outDir = path.join(workspace, "proof");
  const secret = "never-echo-this-local-value";
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(
    path.join(inputDir, "render_input_work_order.json"),
    JSON.stringify({
      status: "ready",
      jobs: [{ story_id: "story-1", local_secret: secret }],
    }),
    "utf8",
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "tools", "operator-command-contract.js"),
        "goal-production-render",
        "--state-root",
        workspace,
        "--out-dir",
        outDir,
        "--json",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const jsonText = fs.readFileSync(
      path.join(outDir, "goal-production-render.json"),
      "utf8",
    );
    const report = JSON.parse(jsonText);
    assert.equal(report.inputs[0].json.valid, true);
    assert.equal(report.inputs[0].json.top_level_type, "object");
    assert.equal(report.inputs[0].json.record_count, 1);
    assert.deepEqual(report.inputs[0].json.top_level_keys, [
      "jobs",
      "status",
    ]);
    assert.doesNotMatch(jsonText, new RegExp(secret));
    assert.doesNotMatch(result.stdout, new RegExp(secret));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("mutation and publication flags are refused explicitly", () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-operator-command-refusal-"),
  );

  try {
    for (const flag of ["--apply", "--publish", "--live", "--oauth"]) {
      const outDir = path.join(workspace, flag.slice(2));
      const result = spawnSync(
        process.execPath,
        [
          path.join(ROOT, "tools", "operator-command-contract.js"),
          "bridge-live-rights-repair",
          "--state-root",
          workspace,
          "--out-dir",
          outDir,
          flag,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /forbidden in LOCAL_PROOF/i);
      assert.equal(fs.existsSync(outDir), false);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
