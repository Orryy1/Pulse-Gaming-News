#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const axios = require("axios");

const {
  captureElevenLabsGenerationRightsWorkbench,
  finalizeElevenLabsGenerationRightsWorkbench,
} = require("../lib/elevenlabs-generation-rights-workbench");

const DEFAULT_TARGET_PLATFORMS = Object.freeze([
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
]);

const VALUE_FLAGS = Object.freeze({
  "--artifact-dir": "artifactDir",
  "--story-id": "storyId",
  "--asset-id": "assetId",
  "--voice-id": "voiceId",
  "--model-id": "modelId",
  "--text": "text",
  "--text-file": "textFile",
  "--output-format": "outputFormat",
  "--receipt": "receiptPath",
  "--narration": "narrationPath",
  "--narration-sha256": "narrationSha256",
  "--narration-size": "narrationSize",
  "--timestamps": "timestampsPath",
  "--timestamps-sha256": "timestampsSha256",
  "--timestamps-size": "timestampsSize",
  "--captions": "captionsPath",
  "--captions-sha256": "captionsSha256",
  "--captions-size": "captionsSize",
  "--final-mp4": "finalVideoPath",
  "--final-mp4-sha256": "finalVideoSha256",
  "--final-mp4-size": "finalVideoSize",
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseWorkbenchArgs(argv = []) {
  const parsed = {
    mode: "LOCAL_PROOF",
    phase: null,
    platforms: [],
    policyUrls: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--capture" || argument === "--finalize") {
      const phase = argument.slice(2);
      if (parsed.phase && parsed.phase !== phase) {
        throw new Error("capture_and_finalize_are_mutually_exclusive");
      }
      parsed.phase = phase;
      continue;
    }
    if (argument === "--platform" || argument === "--policy-url") {
      const value = clean(argv[index + 1]);
      if (!value) throw new Error(`argument_value_missing:${argument}`);
      index += 1;
      if (argument === "--platform") {
        parsed.platforms.push(
          ...value.split(",").map(clean).filter(Boolean),
        );
      } else {
        parsed.policyUrls.push(value);
      }
      continue;
    }
    const key = VALUE_FLAGS[argument];
    if (!key) throw new Error(`unknown_argument:${argument}`);
    const value = clean(argv[index + 1]);
    if (!value) throw new Error(`argument_value_missing:${argument}`);
    parsed[key] = value;
    index += 1;
  }
  if (!parsed.phase) throw new Error("explicit_capture_or_finalize_required");
  return parsed;
}

async function resolveRequestText(parsed) {
  if (clean(parsed.text) && clean(parsed.textFile)) {
    throw new Error("text_and_text_file_are_mutually_exclusive");
  }
  const value = clean(parsed.textFile)
    ? clean(await fs.readFile(parsed.textFile, "utf8"))
    : clean(parsed.text);
  if (!value) throw new Error("request_text_missing");
  return value;
}

function descriptor(pathValue, shaValue, sizeValue) {
  return {
    path: clean(pathValue),
    sha256: clean(shaValue).toLowerCase(),
    size_bytes: Number(sizeValue),
  };
}

function publicSummary(result, phase) {
  return {
    mode: "LOCAL_PROOF",
    phase,
    verdict: clean(result?.verdict).toUpperCase() || "AMBER",
    blockers:
      result?.blockers ||
      result?.evidence?.blockers ||
      result?.receipt?.blockers ||
      [],
    receipt_path: result?.receiptPath || result?.receipt_path || null,
    rights_path: result?.evidencePath || result?.evidence_path || null,
    raw_narration_path: result?.rawNarrationPath || null,
    alignment_path: result?.alignmentPath || null,
    safety: {
      publishing_triggered: false,
      database_mutated: false,
      oauth_mutated: false,
      token_mutated: false,
      billing_mutated: false,
      credentials_persisted: false,
    },
  };
}

async function runWorkbenchCli({
  argv = process.argv.slice(2),
  env = process.env,
  requestImpl = axios,
  capture = captureElevenLabsGenerationRightsWorkbench,
  finalize = finalizeElevenLabsGenerationRightsWorkbench,
  write = (value) => process.stdout.write(`${value}\n`),
} = {}) {
  const parsed = parseWorkbenchArgs(argv);
  const requestText = await resolveRequestText(parsed);
  const targetPlatforms = parsed.platforms.length
    ? parsed.platforms
    : [...DEFAULT_TARGET_PLATFORMS];
  let result;
  if (parsed.phase === "capture") {
    const apiKey = clean(env.ELEVENLABS_API_KEY);
    if (!apiKey) throw new Error("elevenlabs_api_key_unavailable");
    result = await capture({
      artifactDir: parsed.artifactDir,
      storyId: parsed.storyId,
      assetId: parsed.assetId,
      voiceId: parsed.voiceId,
      modelId: parsed.modelId,
      requestText,
      outputFormat: parsed.outputFormat,
      targetPlatforms,
      ...(parsed.policyUrls.length ? { policyUrls: parsed.policyUrls } : {}),
      requestImpl,
      apiKey,
    });
  } else {
    result = await finalize({
      artifactDir: parsed.artifactDir,
      receiptPath: parsed.receiptPath,
      requestText,
      targetPlatforms,
      files: {
        narration: descriptor(
          parsed.narrationPath,
          parsed.narrationSha256,
          parsed.narrationSize,
        ),
        wordTimestamps: descriptor(
          parsed.timestampsPath,
          parsed.timestampsSha256,
          parsed.timestampsSize,
        ),
        captions: descriptor(
          parsed.captionsPath,
          parsed.captionsSha256,
          parsed.captionsSize,
        ),
        finalVideo: descriptor(
          parsed.finalVideoPath,
          parsed.finalVideoSha256,
          parsed.finalVideoSize,
        ),
      },
    });
  }
  write(JSON.stringify(publicSummary(result, parsed.phase), null, 2));
  return result;
}

function safeErrorMessage(error, secret = "") {
  const message = clean(error?.code || error?.message || "workbench_failed");
  return clean(secret) ? message.split(secret).join("[REDACTED]") : message;
}

if (require.main === module) {
  runWorkbenchCli().catch((error) => {
    process.stderr.write(
      `${safeErrorMessage(error, process.env.ELEVENLABS_API_KEY)}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  parseWorkbenchArgs,
  runWorkbenchCli,
};
