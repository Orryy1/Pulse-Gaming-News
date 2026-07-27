#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  evaluateApprovedVoicePath,
  renderApprovedVoicePathMarkdown,
} = require("../lib/studio/v2/approved-voice-path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    fixture: false,
    audio: null,
    provider: "external",
    source: "provided-real-audio",
    transcript: "",
    medianPitchHz: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--fixture") args.fixture = true;
    else if (arg === "--audio") args.audio = argv[++i] || null;
    else if (arg === "--provider") args.provider = argv[++i] || "external";
    else if (arg === "--source") args.source = argv[++i] || "provided-real-audio";
    else if (arg === "--transcript") args.transcript = argv[++i] || "";
    else if (arg === "--median-pitch") args.medianPitchHz = Number(argv[++i]);
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/approved-voice-path.js [options]",
      "",
      "Options:",
      "  --fixture              Use a local fake fixture under test/output",
      "  --audio <path>         Audio path to verify",
      "  --provider <name>      Voice provider label",
      "  --source <name>        Voice source label",
      "  --transcript <text>    Transcript and governed CTA evidence",
      "  --median-pitch <hz>    Optional median pitch evidence",
      "  --json                 Print JSON instead of Markdown",
      "",
      "This command verifies the narration path only. It does not generate speech or render video.",
    ].join("\n") + "\n",
  );
}

function fixtureStory() {
  return {
    id: "fixture_approved_voice_story",
    title: "Xbox adds achievements to backwards-compatible games",
    hook: "Xbox has added achievement support to selected original Xbox games.",
    hook_type: "direct",
    editorial_lane_id: "what_changes_for_players",
    duration_band_id: "what_changes_standard_35_42",
    cta: "",
    cta_policy: {
      policy_version: "pulse-selective-cta-v2",
      scope: "shorts",
      include_cta: false,
      copy_strategy: "none",
      cohort_bucket: 1,
      cohort_numerator: 1,
      cohort_denominator: 3,
      audit_hash: `sha256:${"c".repeat(64)}`,
    },
    full_script: [
      "Xbox has added achievement support to selected original Xbox games in backwards compatibility.",
      "That changes old catalogue releases from simple nostalgia plays into trackable games with modern profile progress.",
      "Microsoft has not confirmed every title yet, so the affected list still matters.",
      "For players, the practical change is clear: returning classics can now contribute achievements alongside newer Game Pass releases.",
    ].join(" "),
  };
}

async function fixtureAudio() {
  await fs.ensureDir(OUT);
  const file = path.join(OUT, "approved_voice_path_fixture.mp3");
  await fs.writeFile(file, "fake approved voice path fixture");
  return file;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const audioPath = args.fixture ? await fixtureAudio() : args.audio;
  const story = args.fixture ? fixtureStory() : null;
  const result = evaluateApprovedVoicePath({
    story,
    narration: {
      provider: args.fixture ? "elevenlabs" : args.provider,
      source: args.fixture ? "elevenlabs-production-path" : args.source,
      audioPath,
      transcript:
        args.transcript ||
        (args.fixture ? story.full_script : ""),
      acoustic: {
        medianPitchHz: Number.isFinite(args.medianPitchHz)
          ? args.medianPitchHz
          : args.fixture
            ? 118
            : null,
      },
    },
  });
  const markdown = renderApprovedVoicePathMarkdown(result);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "approved_voice_path_v1.json"), result, { spaces: 2 });
  await fs.writeFile(path.join(OUT, "approved_voice_path_v1.md"), markdown, "utf8");
  process.stdout.write(args.json ? JSON.stringify(result, null, 2) + "\n" : markdown);
  process.stderr.write("[approved-voice-path] wrote test/output/approved_voice_path_v1.{json,md}\n");
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[approved-voice-path] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  fixtureStory,
  parseArgs,
};
