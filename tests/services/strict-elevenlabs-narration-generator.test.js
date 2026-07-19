"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  generateStrictElevenLabsNarration,
} = require("../../lib/strict-elevenlabs-narration-generator");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clock(...timestamps) {
  let index = 0;
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]);
}

test("strict ElevenLabs narration binds staged audio and timestamps to the same provider receipt", async () => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-strict-elevenlabs-narration-"),
  );
  const artifactDir = path.join(workspaceRoot, "artifact");
  const outputPath = path.join(workspaceRoot, "output", "audio", "story.mp3");
  const rawAudio = Buffer.from("same provider response audio bytes");
  const requestText = "Black Flag crossed three million sales.";
  const calls = [];
  let billingPolicyAttempts = 0;

  const result = await generateStrictElevenLabsNarration({
    workspaceRoot,
    artifactDir,
    storyId: "black-flag-story",
    assetId: "black-flag-story_audio_path",
    text: requestText,
    outputPath,
    voiceId: "private-voice",
    modelId: "eleven_multilingual_v2",
    apiKey: "never-persist",
    requestSettings: {
      stability: 0.52,
      speaking_rate: 1.04,
      api_key: "never-persist",
    },
    targetPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    policyRetryDelayMs: 0,
    now: clock(
      "2026-07-19T23:00:00.000Z",
      "2026-07-19T23:00:01.000Z",
      "2026-07-19T23:00:02.000Z",
      "2026-07-19T23:00:03.000Z",
      "2026-07-19T23:00:04.000Z",
      "2026-07-19T23:00:05.000Z",
      "2026-07-19T23:00:06.000Z",
    ),
    requestImpl: async (config) => {
      calls.push({
        method: config.method || "GET",
        url: config.url,
        params: config.params || null,
      });
      if (config.url.endsWith("/v1/user/subscription")) {
        return {
          status: 200,
          data: {
            tier: "pro",
            status: "active",
            billing_period: "annual_period",
            user_id: "must-not-persist",
          },
        };
      }
      if (config.url.endsWith("/v1/models")) {
        return {
          status: 200,
          data: [{
            model_id: "eleven_multilingual_v2",
            name: "Eleven Multilingual v2",
            can_do_text_to_speech: true,
            requires_alpha_access: false,
            requires_beta_access: false,
          }],
        };
      }
      if (config.url.includes("/v1/text-to-speech/")) {
        assert.equal(config.params.enable_logging, true);
        assert.equal(config.data.text, requestText);
        assert.deepEqual(config.data.voice_settings, {
          stability: 0.52,
          similarity_boost: 0.85,
          style: 0.35,
          speed: 1.04,
        });
        return {
          status: 200,
          headers: { "request-id": "request-same-response" },
          data: {
            audio_base64: rawAudio.toString("base64"),
            alignment: {
              characters: ["B"],
              character_start_times_seconds: [0],
              character_end_times_seconds: [0.2],
            },
          },
        };
      }
      if (config.url.endsWith("/v1/history")) {
        return {
          status: 200,
          data: {
            history: [{
              history_item_id: "history-same-response",
              request_id: "request-same-response",
              date_unix: 1784502003,
              model_id: "eleven_multilingual_v2",
              voice_id: "private-voice",
              text: requestText,
              source: "TTS",
            }],
          },
        };
      }
      if (config.url.endsWith("/v1/history/history-same-response/audio")) {
        assert.equal(config.method, "GET");
        assert.equal(
          config.headers.accept,
          "audio/mpeg,application/octet-stream",
        );
        assert.equal(config.data, undefined);
        return { status: 200, data: rawAudio };
      }
      if (config.url.startsWith("https://help.elevenlabs.io/")) {
        throw new Error("unstable help-centre policy endpoint must not be required");
      }
      if (config.url.startsWith("https://elevenlabs.io/")) {
        if (config.url.includes("/docs/overview/administration/billing")) {
          billingPolicyAttempts += 1;
          if (billingPolicyAttempts === 1) {
            throw new Error("temporary official policy endpoint reset");
          }
        }
        assert.equal(config.responseType, "arraybuffer");
        assert.equal(
          config.headers.accept,
          "text/html,application/xhtml+xml,text/markdown;q=0.9",
        );
        assert.match(config.headers["user-agent"], /^PulseGamingRightsEvidence\//);
        return {
          status: 200,
          data: Buffer.from(`official policy ${config.url}`),
        };
      }
      throw new Error(`unexpected request: ${config.url}`);
    },
    masterAudioFile: async ({ execFileAsync, ffmpegPath }) => {
      assert.equal(typeof execFileAsync, "function");
      assert.equal(ffmpegPath, "ffmpeg");
      return {
        ok: true,
        source: "test-master",
        targetLufs: -16,
      };
    },
  });

  assert.equal(result.verdict, "AMBER");
  assert.equal(result.receipt.generation_verdict, "GREEN");
  assert.equal(result.receipt.final_media_lineage_status, "PENDING");
  assert.equal(result.audio_sha256, sha256(rawAudio));
  assert.equal(await fs.readFile(outputPath, "utf8"), rawAudio.toString("utf8"));
  const timestamps = await fs.readJson(result.timestampPath);
  assert.equal(
    timestamps.meta.elevenlabsGenerationRights.receiptPath,
    path.relative(artifactDir, result.receiptPath).replace(/\\/g, "/"),
  );
  assert.equal(
    timestamps.meta.elevenlabsGenerationRights.rawProviderAudioSha256,
    sha256(rawAudio),
  );
  assert.ok(
    calls.some((call) =>
      call.url.endsWith("/v1/history/history-same-response/audio"),
    ),
  );
  assert.equal(
    calls.some((call) => call.url.endsWith("/v1/history/download")),
    false,
  );
  assert.equal(billingPolicyAttempts, 2);
  const stored = await fs.readFile(result.receiptPath, "utf8");
  assert.doesNotMatch(
    stored,
    /never-persist|must-not-persist|private-voice/i,
  );
});
