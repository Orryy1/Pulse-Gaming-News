"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  captureElevenLabsGenerationRightsWorkbench,
  finalizeElevenLabsGenerationRightsWorkbench,
} = require("../../lib/elevenlabs-generation-rights-workbench");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clock(...timestamps) {
  let index = 0;
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]);
}

async function writeBoundFile(root, relativePath, bytes) {
  const filePath = path.join(root, relativePath);
  await fs.outputFile(filePath, bytes);
  return {
    path: relativePath.replace(/\\/g, "/"),
    sha256: sha256(bytes),
    size_bytes: bytes.length,
  };
}

async function captureReadyArtifact(artifactDir) {
  const voiceId = "workbench-finalize-private-voice";
  const modelId = "eleven_multilingual_v2";
  const requestText = "A governed narration can only be finalised once.";
  const rawAudio = Buffer.from("ID3 finalization source");
  const result = await captureElevenLabsGenerationRightsWorkbench({
    artifactDir,
    storyId: "workbench-finalize-story",
    assetId: "workbench-finalize-story_audio_path",
    voiceId,
    modelId,
    requestText,
    apiKey: "capture-only-secret",
    targetPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    now: clock(
      "2026-07-19T22:00:00.000Z",
      "2026-07-19T22:00:01.000Z",
      "2026-07-19T22:00:02.000Z",
      "2026-07-19T22:00:03.000Z",
      "2026-07-19T22:00:04.000Z",
      "2026-07-19T22:00:05.000Z",
      "2026-07-19T22:00:06.000Z",
      "2026-07-19T22:00:07.000Z",
    ),
    requestImpl: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/v1/user/subscription") {
        return { status: 200, data: { tier: "pro", status: "active" } };
      }
      if (url.pathname === "/v1/models") {
        return {
          status: 200,
          data: [{
            model_id: modelId,
            name: "Eleven Multilingual v2",
            can_do_text_to_speech: true,
          }],
        };
      }
      if (
        url.hostname === "elevenlabs.io" ||
        url.hostname === "help.elevenlabs.io"
      ) {
        return {
          status: 200,
          data: Buffer.from(`official policy ${url.pathname}`),
        };
      }
      if (url.pathname.endsWith("/with-timestamps")) {
        return {
          status: 200,
          headers: { "request-id": "request-finalize-workbench" },
          data: {
            audio_base64: rawAudio.toString("base64"),
            alignment: {
              characters: ["A"],
              character_start_times_seconds: [0],
              character_end_times_seconds: [0.2],
            },
          },
        };
      }
      if (url.pathname === "/v1/history") {
        return {
          status: 200,
          data: {
            history: [{
              history_item_id: "history-finalize-workbench",
              request_id: "request-finalize-workbench",
              date_unix: 1784498400,
              model_id: modelId,
              voice_id: voiceId,
              text: requestText,
            }],
          },
        };
      }
      if (
        url.pathname ===
        "/v1/history/history-finalize-workbench/audio"
      ) {
        return { status: 200, data: rawAudio };
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    },
  });
  return { ...result, requestText, rawAudio };
}

test("capture performs exactly one governed generation and materialises an AMBER receipt", async () => {
  const artifactDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-elevenlabs-workbench-capture-"),
  );
  const apiKey = "secret-must-never-be-persisted";
  const voiceId = "private-pulse-voice";
  const modelId = "eleven_multilingual_v2";
  const requestText = "Black Flag crossed three million sales.";
  const rawAudio = Buffer.from("ID3 governed provider narration");
  const calls = [];

  const result = await captureElevenLabsGenerationRightsWorkbench({
    artifactDir,
    storyId: "black-flag-three-million",
    assetId: "black-flag-three-million_audio_path",
    voiceId,
    modelId,
    requestText,
    apiKey,
    targetPlatforms: [
      "youtube_shorts",
      "instagram_reels",
      "facebook_reels",
    ],
    now: clock(
      "2026-07-19T21:00:00.000Z",
      "2026-07-19T21:00:01.000Z",
      "2026-07-19T21:00:02.000Z",
      "2026-07-19T21:00:03.000Z",
      "2026-07-19T21:00:04.000Z",
      "2026-07-19T21:00:05.000Z",
      "2026-07-19T21:00:06.000Z",
      "2026-07-19T21:00:07.000Z",
    ),
    requestImpl: async (request) => {
      calls.push({
        method: request.method || "GET",
        url: request.url,
        params: request.params || null,
      });
      const url = new URL(request.url);
      if (url.pathname === "/v1/user/subscription") {
        return {
          status: 200,
          data: {
            tier: "pro",
            status: "active",
            api_key: apiKey,
            user_id: "private-account",
          },
        };
      }
      if (url.pathname === "/v1/models") {
        return {
          status: 200,
          data: [
            {
              model_id: modelId,
              name: "Eleven Multilingual v2",
              can_do_text_to_speech: true,
            },
          ],
        };
      }
      if (
        url.hostname === "elevenlabs.io" ||
        url.hostname === "help.elevenlabs.io"
      ) {
        return {
          status: 200,
          data: Buffer.from(`<html>Official policy: ${url.pathname}</html>`),
        };
      }
      if (url.pathname.endsWith("/with-timestamps")) {
        assert.equal(request.params.enable_logging, true);
        return {
          status: 200,
          headers: { "request-id": "request-workbench-1" },
          data: {
            audio_base64: rawAudio.toString("base64"),
            alignment: {
              characters: ["B"],
              character_start_times_seconds: [0],
              character_end_times_seconds: [0.2],
            },
            normalized_alignment: {
              characters: ["B"],
              character_start_times_seconds: [0],
              character_end_times_seconds: [0.2],
            },
          },
        };
      }
      if (url.pathname === "/v1/history") {
        return {
          status: 200,
          data: {
            history: [
              {
                history_item_id: "history-workbench-1",
                request_id: "request-workbench-1",
                date_unix: 1784494800,
                model_id: modelId,
                voice_id: voiceId,
                text: requestText,
              },
            ],
          },
        };
      }
      if (url.pathname === "/v1/history/history-workbench-1/audio") {
        assert.equal(request.method, "GET");
        assert.equal(request.data, undefined);
        return { status: 200, data: rawAudio };
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    },
  });

  assert.equal(
    calls.filter((call) => call.url.includes("/with-timestamps")).length,
    1,
  );
  assert.equal(result.verdict, "AMBER");
  assert.equal(result.receipt.generation_verdict, "GREEN");
  assert.equal(result.receipt.commercial_use_allowed, false);
  assert.ok(result.receipt.blockers.includes("final_media_lineage_pending"));
  assert.equal(
    result.receipt.account_entitlement.pre_generation.retrieved_at,
    "2026-07-19T21:00:03.000Z",
  );
  assert.equal(
    result.receipt.generation.request_started_at,
    "2026-07-19T21:00:04.000Z",
  );
  assert.equal(
    result.receipt.generation.response_received_at,
    "2026-07-19T21:00:05.000Z",
  );
  assert.equal(
    result.receipt.account_entitlement.post_generation.retrieved_at,
    "2026-07-19T21:00:06.000Z",
  );
  assert.ok(
    Date.parse(result.receipt.account_entitlement.pre_generation.retrieved_at) <=
      Date.parse(result.receipt.generation.request_started_at),
  );
  assert.ok(
    Date.parse(result.receipt.generation.request_started_at) <=
      Date.parse(result.receipt.generation.response_received_at),
  );
  assert.ok(
    Date.parse(result.receipt.generation.response_received_at) <=
      Date.parse(result.receipt.account_entitlement.post_generation.retrieved_at),
  );
  assert.equal(await fs.pathExists(result.rawNarrationPath), true);
  assert.equal(path.extname(result.rawNarrationPath), ".mp3");
  assert.deepEqual(await fs.readFile(result.rawNarrationPath), rawAudio);
  assert.equal(await fs.pathExists(result.alignmentPath), true);
  const alignment = await fs.readJson(result.alignmentPath);
  assert.equal(alignment.schema, "pulse_elevenlabs_provider_alignment_v1");
  assert.equal(
    alignment.meta.elevenlabsGenerationRights.requestId,
    "request-workbench-1",
  );
  assert.equal(alignment.raw_audio_sha256, sha256(rawAudio));
  assert.deepEqual(alignment.characters, ["B"]);

  const storedReceipt = await fs.readJson(result.receiptPath);
  assert.equal(
    storedReceipt.account_entitlement.pre_generation.retrieved_at,
    "2026-07-19T21:00:03.000Z",
  );
  assert.equal(
    storedReceipt.generation.request_started_at,
    "2026-07-19T21:00:04.000Z",
  );
  assert.equal(
    storedReceipt.generation.response_received_at,
    "2026-07-19T21:00:05.000Z",
  );
  assert.equal(
    storedReceipt.account_entitlement.post_generation.retrieved_at,
    "2026-07-19T21:00:06.000Z",
  );

  const persisted = (
    await Promise.all(
      (await fs.readdir(artifactDir, { recursive: true }))
        .filter((entry) => /\.(?:json|mp3|bin)$/i.test(String(entry)))
        .map((entry) =>
          fs.readFile(path.join(artifactDir, String(entry))).catch(() => Buffer.alloc(0)),
        ),
    )
  )
    .map((entry) => entry.toString("utf8"))
    .join("\n");
  assert.doesNotMatch(
    persisted,
    /secret-must-never-be-persisted|private-account|"api_key"\s*:/i,
  );
});

test("finalize binds exact current files and writes canonical strict v3 rights evidence", async () => {
  const artifactDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-elevenlabs-workbench-finalize-"),
  );
  const captured = await captureReadyArtifact(artifactDir);
  const narration = Buffer.from("ID3 mastered current narration");
  const timestamps = Buffer.from(
    '[{"word":"governed","start":0,"end":0.4}]',
  );
  const captions = Buffer.from(
    "1\n00:00:00,000 --> 00:00:00,400\ngoverned\n",
  );
  const finalVideo = Buffer.from("decodable final MP4 fixture");
  const files = {
    narration: await writeBoundFile(
      artifactDir,
      "audio/current-narration.mp3",
      narration,
    ),
    wordTimestamps: await writeBoundFile(
      artifactDir,
      "captions/current-words.json",
      timestamps,
    ),
    captions: await writeBoundFile(
      artifactDir,
      "captions/current-captions.srt",
      captions,
    ),
    finalVideo: await writeBoundFile(
      artifactDir,
      "final/current-video.mp4",
      finalVideo,
    ),
  };

  const result = await finalizeElevenLabsGenerationRightsWorkbench({
    artifactDir,
    receiptPath: captured.receiptPath,
    requestText: captured.requestText,
    targetPlatforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    files,
    now: () => new Date("2026-07-19T22:10:00.000Z"),
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(
    result.evidence.schema,
    "pulse_elevenlabs_commercial_tts_evidence_v3",
  );
  assert.equal(result.evidence.commercial_use_allowed, true);
  assert.equal(result.evidence.lineage.final_audio_sha256, sha256(narration));
  assert.equal(
    result.evidence.lineage.word_timestamps_sha256,
    sha256(timestamps),
  );
  assert.equal(result.evidence.lineage.captions_sha256, sha256(captions));
  assert.equal(result.evidence.lineage.final_video_sha256, sha256(finalVideo));
  assert.deepEqual(result.evidence.blockers, []);
  assert.equal(
    result.evidencePath,
    path.join(artifactDir, "rights", "elevenlabs-commercial-tts.json"),
  );
  assert.equal(await fs.pathExists(result.evidencePath), true);
});

test("finalize keeps missing, stale and outside-root media AMBER with precise blockers", async (t) => {
  const artifactDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-elevenlabs-workbench-blocked-"),
  );
  const captured = await captureReadyArtifact(artifactDir);
  const narration = Buffer.from("ID3 current narration");
  const timestamps = Buffer.from('[{"word":"current","start":0,"end":0.3}]');
  const captions = Buffer.from(
    "1\n00:00:00,000 --> 00:00:00,300\ncurrent\n",
  );
  const finalVideo = Buffer.from("current final MP4");
  const files = {
    narration: await writeBoundFile(
      artifactDir,
      "audio/current.mp3",
      narration,
    ),
    wordTimestamps: await writeBoundFile(
      artifactDir,
      "captions/current.json",
      timestamps,
    ),
    captions: await writeBoundFile(
      artifactDir,
      "captions/current.srt",
      captions,
    ),
    finalVideo: await writeBoundFile(
      artifactDir,
      "final/current.mp4",
      finalVideo,
    ),
  };
  const finalize = (scenarioFiles) =>
    finalizeElevenLabsGenerationRightsWorkbench({
      artifactDir,
      receiptPath: captured.receiptPath,
      requestText: captured.requestText,
      targetPlatforms: ["youtube_shorts"],
      files: scenarioFiles,
      now: () => new Date("2026-07-19T22:20:00.000Z"),
    });

  await t.test("stale narration fingerprint", async () => {
    const result = await finalize({
      ...files,
      narration: {
        ...files.narration,
        sha256: "0".repeat(64),
      },
    });
    assert.equal(result.verdict, "AMBER");
    assert.equal(result.evidence.commercial_use_allowed, false);
    assert.ok(
      result.evidence.blockers.includes(
        "narration_stale_fingerprint_mismatch",
      ),
    );
  });

  await t.test("missing caption file", async () => {
    const result = await finalize({
      ...files,
      captions: {
        path: "captions/missing.srt",
        sha256: sha256(captions),
        size_bytes: captions.length,
      },
    });
    assert.equal(result.verdict, "AMBER");
    assert.equal(result.evidence.commercial_use_allowed, false);
    assert.ok(result.evidence.blockers.includes("captions_file_missing"));
  });

  await t.test("final video outside the artifact root", async () => {
    const outsidePath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "pulse-outside-media-")),
      "outside.mp4",
    );
    await fs.outputFile(outsidePath, finalVideo);
    const result = await finalize({
      ...files,
      finalVideo: {
        path: outsidePath,
        sha256: sha256(finalVideo),
        size_bytes: finalVideo.length,
      },
    });
    assert.equal(result.verdict, "AMBER");
    assert.equal(result.evidence.commercial_use_allowed, false);
    assert.ok(
      result.evidence.blockers.includes(
        "final_video_outside_artifact_root",
      ),
    );
    assert.equal(
      result.evidence.workbench.checks.files_inside_artifact_root,
      false,
    );
  });
});

test("CLI requires one explicit phase, defaults LOCAL_PROOF and keeps the API key in memory", async () => {
  const {
    parseWorkbenchArgs,
    runWorkbenchCli,
  } = require("../../tools/elevenlabs-generation-rights-workbench");

  assert.throws(
    () => parseWorkbenchArgs([]),
    /explicit_capture_or_finalize_required/,
  );
  assert.throws(
    () => parseWorkbenchArgs(["--capture", "--finalize"]),
    /capture_and_finalize_are_mutually_exclusive/,
  );
  const parsed = parseWorkbenchArgs([
    "--capture",
    "--artifact-dir",
    "artifact",
    "--story-id",
    "story",
    "--asset-id",
    "story_audio_path",
    "--voice-id",
    "voice",
    "--model-id",
    "eleven_multilingual_v2",
    "--text",
    "A governed capture.",
  ]);
  assert.equal(parsed.phase, "capture");
  assert.equal(parsed.mode, "LOCAL_PROOF");

  const writes = [];
  let received = null;
  const env = { ELEVENLABS_API_KEY: "memory-only-api-key" };
  const result = await runWorkbenchCli({
    argv: [
      "--capture",
      "--artifact-dir",
      "artifact",
      "--story-id",
      "story",
      "--asset-id",
      "story_audio_path",
      "--voice-id",
      "voice",
      "--model-id",
      "eleven_multilingual_v2",
      "--text",
      "A governed capture.",
    ],
    env,
    requestImpl: async () => {
      throw new Error("transport should be owned by the injected capture");
    },
    capture: async (options) => {
      received = options;
      return {
        verdict: "AMBER",
        receiptPath: "artifact/rights/evidence/receipt.json",
        rawNarrationPath: "artifact/audio/raw.mp3",
        alignmentPath: "artifact/audio/raw_timestamps.json",
        safety: {
          credentials_persisted: false,
          publishing_triggered: false,
          database_mutated: false,
        },
      };
    },
    write: (value) => writes.push(String(value)),
  });

  assert.equal(result.verdict, "AMBER");
  assert.equal(received.apiKey, env.ELEVENLABS_API_KEY);
  assert.equal(received.requestText, "A governed capture.");
  assert.equal(received.mode, undefined);
  assert.doesNotMatch(writes.join("\n"), /memory-only-api-key/);
  assert.equal(env.ELEVENLABS_API_KEY, "memory-only-api-key");
});
