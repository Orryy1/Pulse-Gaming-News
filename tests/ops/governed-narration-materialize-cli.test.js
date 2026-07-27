"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { cleanScriptForAlignment } = require("../../lib/script-clean");
const {
  main,
  parseArgs,
} = require("../../tools/governed-narration-materialize");

const STORY_ID = "official_d86953ca92ca";
const SCRIPT = [
  "Final Fantasy XIV just revealed a tank that fights with two giant shields.",
  "Bastion arrives in Evercold and only works in Evolved Mode.",
  "The expansion makes its story less linear, auto-scales content and adds a Final Fantasy VII raid.",
  "The MMO hits Switch 2 on August fourth.",
].join(" ");
const AUDIO_DURATION_SECONDS = 23.684354;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-narration-cli-"));
  const audioPath = path.join(root, "narration.mp3");
  const alignmentPath = path.join(root, "alignment.json");
  const scriptPath = path.join(root, "script.txt");
  const characters = Array.from(SCRIPT);
  const step = 23.684 / characters.length;
  fs.writeFileSync(audioPath, "fixture-audio");
  fs.writeFileSync(scriptPath, SCRIPT, "utf8");
  fs.writeFileSync(
    alignmentPath,
    `${JSON.stringify(
      {
        characters,
        character_start_times_seconds: characters.map((_, index) =>
          Number((index * step).toFixed(6)),
        ),
        character_end_times_seconds: characters.map((_, index) =>
          Number(((index + 1) * step).toFixed(6)),
        ),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    root,
    audioPath,
    alignmentPath,
    scriptPath,
    outputDir: path.join(root, "proof"),
    scriptSha256: sha256(cleanScriptForAlignment(SCRIPT)),
    audioSha256: sha256(fs.readFileSync(audioPath)),
    alignmentSha256: sha256(fs.readFileSync(alignmentPath)),
  };
}

function baseArgs(values) {
  return [
    "--story-id",
    STORY_ID,
    "--script-file",
    values.scriptPath,
    "--script-sha256",
    values.scriptSha256,
    "--audio",
    values.audioPath,
    "--audio-sha256",
    values.audioSha256,
    "--alignment",
    values.alignmentPath,
    "--alignment-sha256",
    values.alignmentSha256,
    "--out-dir",
    values.outputDir,
    "--final-target-seconds",
    "28",
    "--visual-breath-seconds",
    "4.4",
    "--provider",
    "elevenlabs",
    "--voice-id",
    "TX3LPaxmHKxFdv7VOQHJ",
    "--model-id",
    "eleven_multilingual_v2",
    "--speed",
    "1.1",
    "--licence-evidence-ref",
    "operator-evidence://elevenlabs/subscription/pulse-gaming-2026-07",
    "--licence-attested-by",
    "pulse-operator",
    "--licence-attested-at",
    "2026-07-27T12:55:00.000Z",
    "--generated-at",
    "2026-07-27T13:00:00.000Z",
  ];
}

function safeEnv() {
  return {
    DEPLOYMENT_MODE: "local",
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    AUTO_PUBLISH: "false",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
    PULSE_EMERGENCY_KILL_SWITCH: "true",
  };
}

function probeAudio() {
  return Promise.resolve({
    duration_seconds: AUDIO_DURATION_SECONDS,
    codec_name: "mp3",
    has_audio: true,
  });
}

test("parseArgs is dry-run by default, accepts a script file and rejects unknown flags", () => {
  const args = parseArgs([
    "--story-id",
    STORY_ID,
    "--script-file",
    "script.txt",
    "--out-dir",
    "proof",
  ]);
  assert.equal(args.applyRequested, false);
  assert.equal(args.storyId, STORY_ID);
  assert.equal(args.scriptFile, "script.txt");
  assert.throws(
    () => parseArgs(["--unknown"]),
    /unknown_argument:--unknown/,
  );
});

test("CLI dry-run validates the exact local inputs and writes JSON plus Markdown only", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  let stdout = "";

  const result = await main(baseArgs(values), {
    stdout: { write: (value) => (stdout += value) },
    probeAudio,
  });

  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.verdict, "READY");
  assert.equal(result.mutated, false);
  assert.equal(result.story_id, STORY_ID);
  assert.equal(result.word_count, 47);
  assert.ok(fs.existsSync(result.plan_path));
  assert.ok(fs.existsSync(result.markdown_path));
  assert.equal(
    fs.existsSync(
      path.join(values.outputDir, STORY_ID, "materialized"),
    ),
    false,
  );
  assert.equal(JSON.parse(stdout).network_used, false);
});

test("CLI apply stays on HOLD without exact confirmations", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));

  const result = await main([...baseArgs(values), "--apply"], {
    stdout: { write() {} },
    env: safeEnv(),
    probeAudio,
  });

  assert.equal(result.mode, "APPLY");
  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("story_id_confirmation_mismatch"));
  assert.ok(result.blockers.includes("script_sha256_confirmation_invalid"));
  assert.ok(result.blockers.includes("audio_sha256_confirmation_invalid"));
  assert.ok(result.blockers.includes("alignment_sha256_confirmation_invalid"));
  assert.ok(result.blockers.includes("plan_sha256_confirmation_invalid"));
  assert.equal(
    fs.existsSync(
      path.join(values.outputDir, STORY_ID, "materialized"),
    ),
    false,
  );
});

test("CLI apply materialises 47 governed timestamps only under exact local HUMAN_REVIEW authority", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const dryRun = await main(baseArgs(values), {
    stdout: { write() {} },
    probeAudio,
  });

  const result = await main(
    [
      ...baseArgs(values),
      "--apply",
      "--confirm-story-id",
      STORY_ID,
      "--confirm-script-sha256",
      values.scriptSha256,
      "--confirm-audio-sha256",
      values.audioSha256,
      "--confirm-alignment-sha256",
      values.alignmentSha256,
      "--confirm-plan-sha256",
      dryRun.plan_sha256,
    ],
    {
      stdout: { write() {} },
      env: safeEnv(),
      probeAudio,
    },
  );

  assert.equal(result.verdict, "MATERIALIZED_HUMAN_REVIEW");
  assert.equal(result.mutated, true);
  assert.equal(result.word_count, 47);
  assert.ok(fs.existsSync(result.timestamps_path));
  assert.ok(fs.existsSync(result.manifest_path));
  assert.ok(fs.existsSync(result.manifest_markdown_path));
  const timestamps = JSON.parse(
    fs.readFileSync(result.timestamps_path, "utf8"),
  );
  assert.equal(timestamps.schema_version, "pulse-word-timestamps-v1");
  assert.equal(timestamps.words.length, 47);
  assert.equal(result.external_publish_authorised, false);
  assert.equal(result.database_mutation_authorised, false);
  assert.equal(result.oauth_mutation_authorised, false);
  assert.equal(result.network_used, false);
});

test("governed narration implementation has no TTS, DB, OAuth, platform or network boundary", () => {
  const source = [
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "lib",
        "services",
        "governed-narration-materialize.js",
      ),
      "utf8",
    ),
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "tools",
        "governed-narration-materialize.js",
      ),
      "utf8",
    ),
  ].join("\n");

  assert.doesNotMatch(
    source,
    /require\([^)]*(?:audio|tts|db|oauth|publisher|upload_|platforms)/i,
  );
  assert.doesNotMatch(
    source,
    /\b(?:fetch|axios|https?\.request)\s*\(/i,
  );
  assert.doesNotMatch(source, /ELEVENLABS_API_KEY|access[_-]?token|client_secret/i);
});
