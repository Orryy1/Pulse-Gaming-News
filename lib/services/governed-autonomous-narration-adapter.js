"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-narration-generation-v1";
const MODE = "LOCAL_PROOF";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_FIELDS = Object.freeze([
  "alignment_path",
  "audio_path",
  "generated_at",
  "mode",
  "provider",
  "publish_authority",
  "schema_version",
  "script_sha256",
  "script_text",
  "story_id",
]);
const PROVIDER_FIELDS = Object.freeze([
  "model_id",
  "provider",
  "speed",
  "voice_id",
]);

class GovernedAutonomousNarrationAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = "GovernedAutonomousNarrationAdapterError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousNarrationAdapterError(code);
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(value, expected, code) {
  if (!plainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((field, index) => field !== required[index])
  ) {
    fail(code);
  }
  return value;
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function exactAbsolutePath(value, code) {
  const supplied = text(value);
  if (
    !supplied ||
    !path.isAbsolute(supplied) ||
    path.resolve(supplied) !== supplied
  ) {
    fail(code);
  }
  return supplied;
}

function normaliseRequest(value, binding) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "autonomous_narration_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE ||
    value.publish_authority !== false
  ) {
    fail("autonomous_narration_local_proof_only");
  }
  exactFields(
    value.provider,
    PROVIDER_FIELDS,
    "autonomous_narration_provider_fields_invalid",
  );
  const script = String(value.script_text ?? "");
  const storyId = text(value.story_id);
  const generatedAt = text(value.generated_at);
  const speed = Number(value.provider.speed);
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(storyId) ||
    !script.trim() ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    new Date(generatedAt).toISOString() !== generatedAt ||
    exactSha256(
      value.script_sha256,
      "autonomous_narration_script_sha256_invalid",
    ) !== sha256Bytes(Buffer.from(script, "utf8")) ||
    text(value.provider.provider).toLowerCase() !== "elevenlabs" ||
    value.provider.voice_id !== binding.voice_id ||
    value.provider.model_id !== binding.model_id ||
    !Number.isFinite(speed) ||
    speed < 0.7 ||
    speed > 1.2
  ) {
    fail("autonomous_narration_request_invalid");
  }
  const audioPath = exactAbsolutePath(
    value.audio_path,
    "autonomous_narration_audio_path_invalid",
  );
  const alignmentPath = exactAbsolutePath(
    value.alignment_path,
    "autonomous_narration_alignment_path_invalid",
  );
  if (audioPath === alignmentPath) {
    fail("autonomous_narration_output_paths_not_distinct");
  }
  return {
    story_id: storyId,
    generated_at: generatedAt,
    script,
    script_sha256: value.script_sha256,
    provider: {
      id: "elevenlabs",
      voice_id: binding.voice_id,
      model_id: binding.model_id,
      speed,
    },
    audio_path: audioPath,
    alignment_path: alignmentPath,
  };
}

function decodeBase64(value) {
  const encoded = text(value);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    fail("autonomous_narration_audio_base64_invalid");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (
    !bytes.length ||
    bytes.toString("base64").replace(/=+$/, "") !==
      encoded.replace(/=+$/, "")
  ) {
    fail("autonomous_narration_audio_base64_invalid");
  }
  return bytes;
}

function normaliseAlignment(value, script) {
  if (!plainObject(value)) {
    fail("autonomous_narration_alignment_invalid");
  }
  const characters = value.characters;
  const starts = value.character_start_times_seconds;
  const ends = value.character_end_times_seconds;
  if (
    !Array.isArray(characters) ||
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    characters.length === 0 ||
    characters.length !== starts.length ||
    characters.length !== ends.length ||
    characters.join("") !== script
  ) {
    fail("autonomous_narration_alignment_invalid");
  }
  let previousStart = -Infinity;
  let previousEnd = -Infinity;
  for (let index = 0; index < characters.length; index += 1) {
    if (
      typeof characters[index] !== "string" ||
      Array.from(characters[index]).length !== 1
    ) {
      fail("autonomous_narration_alignment_invalid");
    }
    const start = Number(starts[index]);
    const end = Number(ends[index]);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start < previousStart ||
      end < previousEnd
    ) {
      fail("autonomous_narration_alignment_invalid");
    }
    previousStart = start;
    previousEnd = end;
  }
  return {
    characters: [...characters],
    character_start_times_seconds: starts.map(Number),
    character_end_times_seconds: ends.map(Number),
  };
}

async function writeOutputs({
  audioPath,
  alignmentPath,
  audioBytes,
  alignmentBytes,
  fileSystem,
}) {
  await fileSystem.mkdir(path.dirname(audioPath), {
    recursive: true,
  });
  await fileSystem.mkdir(path.dirname(alignmentPath), {
    recursive: true,
  });
  const written = [];
  try {
    const audio = await fileSystem.open(audioPath, "wx");
    try {
      await audio.writeFile(audioBytes);
      await audio.sync();
    } finally {
      await audio.close();
    }
    written.push(audioPath);
    const alignment = await fileSystem.open(alignmentPath, "wx");
    try {
      await alignment.writeFile(alignmentBytes);
      await alignment.sync();
    } finally {
      await alignment.close();
    }
    written.push(alignmentPath);
  } catch (error) {
    await Promise.all(
      written.map((filePath) =>
        fileSystem.rm(filePath, { force: true }),
      ),
    );
    throw error;
  }
}

function createGovernedAutonomousNarrationAdapter(
  options = {},
) {
  if (
    typeof options.creditGovernor?.preflight !== "function" ||
    typeof options.httpClient !== "function"
  ) {
    fail("autonomous_narration_dependencies_invalid");
  }
  const binding = {
    voice_id: text(options.voiceId),
    model_id: text(options.modelId),
  };
  if (!binding.voice_id || !binding.model_id) {
    fail("autonomous_narration_provider_binding_invalid");
  }
  const apiKey = text(options.apiKey);
  if (!apiKey) fail("autonomous_narration_api_key_missing");
  const fileSystem = options.fileSystem || defaultFileSystem;
  return async function generateNarration(value) {
    const request = normaliseRequest(value, binding);
    const idempotencyKey =
      "pulse-governed-autonomous-narration-v1:" +
      sha256Bytes(
        Buffer.from(
          JSON.stringify({
            story_id: request.story_id,
            script_sha256: request.script_sha256,
            voice_id: request.provider.voice_id,
            model_id: request.provider.model_id,
            speed: request.provider.speed,
            audio_path: request.audio_path.replaceAll("\\", "/"),
          }),
          "utf8",
        ),
      );

    // This preflight owns the durable reservation. No provider request
    // is allowed before it succeeds.
    const lease = await options.creditGovernor.preflight({
      text: request.script,
      purpose: "governed_autonomous_breaking_short_narration",
      idempotencyKey,
    });
    let response;
    let providerCallStarted = false;
    if (lease.replayAvailable === true) {
      response = {
        status: 200,
        data: await lease.readRecordedProviderResult(),
      };
    } else {
      try {
        await lease.markProviderCallStarted();
        providerCallStarted = true;
        response = await options.httpClient({
          method: "POST",
          url:
            "https://api.elevenlabs.io/v1/text-to-speech/" +
            `${encodeURIComponent(request.provider.voice_id)}` +
            "/with-timestamps?output_format=mp3_44100_128",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          data: {
            text: request.script,
            model_id: request.provider.model_id,
            voice_settings: {
              stability: 0.35,
              similarity_boost: 0.8,
              style: 0.45,
              use_speaker_boost: true,
              speed: request.provider.speed,
            },
          },
          timeout: 120_000,
        });
      } catch (error) {
        if (providerCallStarted) {
          await lease
            .markProviderCallAmbiguous(
              "provider_request_outcome_unknown",
            )
            .catch(() => {});
        }
        throw error;
      }
    }
    const status = Number(response?.status);
    if (!Number.isInteger(status) || status < 200 || status >= 300) {
      if (lease.replayAvailable !== true) {
        await lease
          .markProviderCallAmbiguous(
            "provider_http_response_not_success",
          )
          .catch(() => {});
      }
      fail("autonomous_narration_provider_response_invalid");
    }
    if (lease.replayAvailable !== true) {
      try {
        await lease.recordProviderSuccess(response.data);
      } catch (error) {
        await lease
          .markProviderCallAmbiguous(
            "provider_result_journal_failed",
          )
          .catch(() => {});
        throw error;
      }
    }
    const audioBytes = decodeBase64(
      response?.data?.audio_base64,
    );
    const alignment = normaliseAlignment(
      response?.data?.alignment,
      request.script,
    );
    const alignmentBytes = Buffer.from(
      `${JSON.stringify(alignment, null, 2)}\n`,
      "utf8",
    );
    await writeOutputs({
      audioPath: request.audio_path,
      alignmentPath: request.alignment_path,
      audioBytes,
      alignmentBytes,
      fileSystem,
    });
    await lease.complete({
      outputSha256: sha256Bytes(audioBytes),
    });
    return Object.freeze({
      provider: {
        id: "elevenlabs",
        model_id: request.provider.model_id,
        voice_id: request.provider.voice_id,
        http_status: status,
        provider_result_recorded: true,
      },
      credit_report: structuredClone(lease.report),
      transform_status: "COMPLETE",
      post_generation_transform_status: "COMPLETE",
      network_used: true,
    });
  };
}

module.exports = {
  GovernedAutonomousNarrationAdapterError,
  REQUEST_SCHEMA_VERSION,
  createGovernedAutonomousNarrationAdapter,
};
