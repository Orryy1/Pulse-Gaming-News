"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  createElevenLabsCreditGovernor,
} = require("./elevenlabs-credit-governor");

const RUNTIME_CAPABILITIES_SCHEMA =
  "pulse-weekly-longform-runtime-capabilities-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class WeeklyLongformRuntimeDependencyError extends Error {
  constructor(codes) {
    const values = [
      ...new Set((Array.isArray(codes) ? codes : [codes]).filter(Boolean)),
    ];
    super(`weekly_longform_runtime_dependency_invalid: ${values.join(", ")}`);
    this.name = "WeeklyLongformRuntimeDependencyError";
    this.codes = values;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normaliseSha256(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function contained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function observeFile(record, prefix, allowedRoot) {
  const blockers = [];
  const filePath = text(record?.path);
  const declaredSha256 = normaliseSha256(record?.sha256);
  const resolvedPath = filePath ? path.resolve(filePath) : null;
  if (!filePath) blockers.push(`${prefix}_path_required`);
  if (!declaredSha256) blockers.push(`${prefix}_sha256_required`);
  if (
    resolvedPath &&
    allowedRoot &&
    !contained(allowedRoot, resolvedPath)
  ) {
    blockers.push(`${prefix}_outside_allowed_root`);
  }
  if (
    resolvedPath &&
    (!fs.existsSync(resolvedPath) ||
      !fs.statSync(resolvedPath).isFile())
  ) {
    blockers.push(`${prefix}_file_missing`);
  }
  if (blockers.length) {
    throw new WeeklyLongformRuntimeDependencyError(blockers);
  }
  const bytes = fs.readFileSync(resolvedPath);
  const observedSha256 = sha256Buffer(bytes);
  if (!bytes.length) blockers.push(`${prefix}_file_empty`);
  if (observedSha256 !== declaredSha256) {
    blockers.push(`${prefix}_sha256_mismatch`);
  }
  if (blockers.length) {
    throw new WeeklyLongformRuntimeDependencyError(blockers);
  }
  return {
    path: resolvedPath,
    sha256: observedSha256,
    byte_length: bytes.length,
    bytes,
  };
}

function readRequiredFile(filePath, prefix, allowedRoot, { json = false } = {}) {
  const blockers = [];
  const resolvedPath = path.resolve(text(filePath));
  if (!filePath) blockers.push(`${prefix}_path_required`);
  if (
    filePath &&
    allowedRoot &&
    !contained(allowedRoot, resolvedPath)
  ) {
    blockers.push(`${prefix}_outside_allowed_root`);
  }
  if (
    filePath &&
    (!fs.existsSync(resolvedPath) ||
      !fs.statSync(resolvedPath).isFile())
  ) {
    blockers.push(`${prefix}_file_missing`);
  }
  if (blockers.length) {
    throw new WeeklyLongformRuntimeDependencyError(blockers);
  }
  const bytes = fs.readFileSync(resolvedPath);
  if (!bytes.length) {
    throw new WeeklyLongformRuntimeDependencyError(`${prefix}_file_empty`);
  }
  let value = null;
  if (json) {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new WeeklyLongformRuntimeDependencyError(
        `${prefix}_json_invalid`,
      );
    }
  }
  return {
    path: resolvedPath,
    sha256: sha256Buffer(bytes),
    byte_length: bytes.length,
    bytes,
    value,
  };
}

function validateRuntimeInput(input, { script = false } = {}) {
  const blockers = [];
  const runId = text(input?.run_id);
  const generatedAt = text(input?.generated_at);
  const outputDir = text(input?.output_dir);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(runId)) {
    blockers.push("runtime_run_id_invalid");
  }
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    blockers.push("runtime_generated_at_invalid");
  }
  if (!outputDir) blockers.push("runtime_output_dir_required");
  if (script) {
    const scriptText = text(input?.text ?? input?.script_text);
    const scriptSha256 = normaliseSha256(input?.script_sha256);
    if (!scriptText) blockers.push("runtime_script_text_required");
    if (!text(input?.script_path)) {
      blockers.push("runtime_script_path_required");
    }
    if (!scriptSha256) {
      blockers.push("runtime_script_sha256_required");
    } else if (
      scriptText &&
      sha256Buffer(Buffer.from(scriptText, "utf8")) !== scriptSha256
    ) {
      blockers.push("runtime_script_sha256_mismatch");
    }
  }
  if (blockers.length) {
    throw new WeeklyLongformRuntimeDependencyError(blockers);
  }
  const result = {
    runId,
    generatedAt: new Date(generatedAt).toISOString(),
    outputDir: path.resolve(outputDir),
  };
  if (script) {
    result.script = observeFile(
      {
        path: input.script_path,
        sha256: input.script_sha256,
      },
      "runtime_script",
      path.resolve(outputDir, "..", ".."),
    );
    const scriptText = String(input?.text ?? input?.script_text);
    if (result.script.bytes.toString("utf8") !== scriptText) {
      throw new WeeklyLongformRuntimeDependencyError(
        "runtime_script_text_mismatch",
      );
    }
    result.scriptText = scriptText;
  }
  return result;
}

function validateRawAlignment(alignment, expectedText) {
  const characters = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  const blockers = [];
  if (
    !Array.isArray(characters) ||
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    characters.length === 0 ||
    starts.length !== characters.length ||
    ends.length !== characters.length
  ) {
    blockers.push("elevenlabs_alignment_arrays_invalid");
  }
  if (!blockers.length && characters.join("") !== expectedText) {
    blockers.push("elevenlabs_alignment_exact_text_mismatch");
  }
  let previousStart = -Infinity;
  let previousEnd = -Infinity;
  if (!blockers.length) {
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index];
      const start = Number(starts[index]);
      const end = Number(ends[index]);
      if (
        typeof character !== "string" ||
        Array.from(character).length !== 1 ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start ||
        start < previousStart ||
        end < previousEnd
      ) {
        blockers.push("elevenlabs_alignment_timing_invalid");
        break;
      }
      previousStart = start;
      previousEnd = end;
    }
  }
  if (blockers.length) {
    throw new WeeklyLongformRuntimeDependencyError(blockers);
  }
  return {
    characters: [...characters],
    character_start_times_seconds: starts.map(Number),
    character_end_times_seconds: ends.map(Number),
  };
}

function decodeBase64(value) {
  const encoded = text(value);
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) {
    throw new WeeklyLongformRuntimeDependencyError(
      "elevenlabs_audio_base64_invalid",
    );
  }
  const bytes = Buffer.from(encoded, "base64");
  if (
    !bytes.length ||
    bytes.toString("base64").replace(/=+$/, "") !==
      encoded.replace(/=+$/, "")
  ) {
    throw new WeeklyLongformRuntimeDependencyError(
      "elevenlabs_audio_base64_invalid",
    );
  }
  return bytes;
}

async function writeAtomic(filePath, bytes) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

function narrationDependency({ httpClient, creditGovernor, env }) {
  const apiKey = text(env.ELEVENLABS_API_KEY);
  const voiceId = text(env.ELEVENLABS_VOICE_ID);
  const modelId =
    text(env.ELEVENLABS_MODEL_ID) || "eleven_multilingual_v2";
  const baseUrl = "https://api.elevenlabs.io";
  const timeoutMs = Math.max(
    1,
    Number(env.ELEVENLABS_TTS_TIMEOUT_MS) || 120000,
  );

  return async function produceNarration(input) {
    const runtime = validateRuntimeInput(input, { script: true });
    const creditLease = await creditGovernor.preflight({
      text: runtime.scriptText,
      purpose: "weekly_longform_narration",
      idempotencyKey:
        `pulse-weekly-longform-elevenlabs-v1:` +
        sha256Buffer(
          Buffer.from(
            `${runtime.runId}\n${runtime.script.sha256}\n${voiceId}\n${modelId}`,
            "utf8",
          ),
        ),
    });
    let response;
    let providerCallStarted = false;
    if (creditLease.replayAvailable === true) {
      response = {
        status: 200,
        data: await creditLease.readRecordedProviderResult(),
      };
    } else {
      try {
        await creditLease.markProviderCallStarted();
        providerCallStarted = true;
        response = await httpClient({
          method: "POST",
          url:
            `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
            "/with-timestamps?output_format=mp3_44100_128",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          data: {
            text: runtime.scriptText,
            model_id: modelId,
            voice_settings: {
              stability: 0.35,
              similarity_boost: 0.8,
              style: 0.45,
              use_speaker_boost: true,
            },
          },
          timeout: timeoutMs,
        });
      } catch (error) {
        if (providerCallStarted) {
          await creditLease
            .markProviderCallAmbiguous(
              "provider_request_outcome_unknown",
            )
            .catch(() => {});
        }
        throw error;
      }
    }
    const status = Number(response?.status);
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      if (creditLease.replayAvailable !== true) {
        await creditLease
          .markProviderCallAmbiguous(
            "provider_http_response_not_success",
          )
          .catch(() => {});
      }
      throw new WeeklyLongformRuntimeDependencyError(
        "elevenlabs_http_response_invalid",
      );
    }
    if (creditLease.replayAvailable !== true) {
      try {
        await creditLease.recordProviderSuccess(response?.data);
      } catch (error) {
        await creditLease
          .markProviderCallAmbiguous(
            "provider_result_journal_failed",
          )
          .catch(() => {});
        throw error;
      }
    }
    const audioBytes = decodeBase64(response?.data?.audio_base64);
    const alignment = validateRawAlignment(
      response?.data?.alignment,
      runtime.scriptText,
    );
    await fsp.mkdir(runtime.outputDir, { recursive: true });
    const audioPath = path.join(runtime.outputDir, "narration.mp3");
    const rawAlignmentPath = path.join(
      runtime.outputDir,
      "elevenlabs-raw-alignment.json",
    );
    const creditReceiptPath = path.join(
      runtime.outputDir,
      "elevenlabs-credit-receipt.json",
    );
    const alignmentBytes = Buffer.from(
      `${JSON.stringify(alignment, null, 2)}\n`,
      "utf8",
    );
    const creditReceiptBytes = Buffer.from(
      `${JSON.stringify(
        {
          ...creditLease.report,
          committed: true,
          committed_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    try {
      await writeAtomic(audioPath, audioBytes);
      await writeAtomic(rawAlignmentPath, alignmentBytes);
      await writeAtomic(creditReceiptPath, creditReceiptBytes);
      await creditLease.complete({
        outputSha256: sha256Buffer(audioBytes),
      });
    } catch (error) {
      await Promise.all([
        fsp.rm(audioPath, { force: true }),
        fsp.rm(rawAlignmentPath, { force: true }),
        fsp.rm(creditReceiptPath, { force: true }),
      ]);
      throw error;
    }
    return {
      path: audioPath,
      sha256: sha256Buffer(audioBytes),
      byte_length: audioBytes.length,
      provider: "elevenlabs",
      voice_id: voiceId,
      model_id: modelId,
      raw_alignment: {
        path: rawAlignmentPath,
        sha256: sha256Buffer(alignmentBytes),
        byte_length: alignmentBytes.length,
      },
      credit_preflight: {
        path: creditReceiptPath,
        sha256: sha256Buffer(creditReceiptBytes),
        byte_length: creditReceiptBytes.length,
        remaining_percent: creditLease.report.remaining_percent,
        estimated_request_credits:
          creditLease.report.estimated_request_credits,
        hard_reserve_credits:
          creditLease.report.hard_reserve_credits,
      },
      network_used: true,
    };
  };
}

function buildExactWordRecords(alignment) {
  const words = [];
  let startIndex = null;
  for (
    let index = 0;
    index <= alignment.characters.length;
    index += 1
  ) {
    const character = alignment.characters[index];
    const whitespace =
      index === alignment.characters.length || /\s/u.test(character);
    if (!whitespace && startIndex === null) startIndex = index;
    if (whitespace && startIndex !== null) {
      const endIndex = index - 1;
      words.push({
        text: alignment.characters.slice(startIndex, index).join(""),
        start_seconds: Number(
          alignment.character_start_times_seconds[startIndex],
        ),
        end_seconds: Number(
          alignment.character_end_times_seconds[endIndex],
        ),
      });
      startIndex = null;
    }
  }
  const blockers = [];
  let previousEnd = 0;
  for (const [index, word] of words.entries()) {
    if (
      !word.text ||
      !Number.isFinite(word.start_seconds) ||
      !Number.isFinite(word.end_seconds) ||
      word.start_seconds < 0 ||
      word.end_seconds <= word.start_seconds ||
      (index > 0 && word.start_seconds < previousEnd)
    ) {
      blockers.push("elevenlabs_word_alignment_timing_invalid");
      break;
    }
    previousEnd = word.end_seconds;
  }
  if (!words.length) blockers.push("elevenlabs_word_alignment_empty");
  if (blockers.length) {
    throw new WeeklyLongformRuntimeDependencyError(blockers);
  }
  return words;
}

function exactAlignmentDependency() {
  return async function materializeAlignment(input) {
    const runtime = validateRuntimeInput(input, { script: true });
    const runRoot = path.resolve(runtime.outputDir, "..", "..");
    const audio = observeFile(
      {
        path: input.audio_path,
        sha256: input.audio_sha256,
      },
      "alignment_audio",
      runRoot,
    );
    const rawAlignmentPath = path.join(
      path.dirname(audio.path),
      "elevenlabs-raw-alignment.json",
    );
    const raw = readRequiredFile(
      rawAlignmentPath,
      "elevenlabs_raw_alignment",
      runRoot,
      { json: true },
    );
    const alignment = validateRawAlignment(
      raw.value,
      runtime.scriptText,
    );
    const words = buildExactWordRecords(alignment);
    const exactTranscript = words
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const expectedTranscript = runtime.scriptText
      .replace(/\s+/g, " ")
      .trim();
    if (exactTranscript !== expectedTranscript) {
      throw new WeeklyLongformRuntimeDependencyError(
        "elevenlabs_word_alignment_exact_text_mismatch",
      );
    }
    const value = {
      schema_version: "pulse-word-timestamps-v1",
      run_id: runtime.runId,
      generated_at: runtime.generatedAt,
      script_sha256: runtime.script.sha256,
      audio_sha256: audio.sha256,
      source_alignment_sha256: raw.sha256,
      provider: "elevenlabs",
      timing_basis: "provider_word_alignment",
      word_count: words.length,
      words,
    };
    await fsp.mkdir(runtime.outputDir, { recursive: true });
    const outputPath = path.join(
      runtime.outputDir,
      "word-timestamps.json",
    );
    const bytes = Buffer.from(
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await writeAtomic(outputPath, bytes);
    return {
      path: outputPath,
      sha256: sha256Buffer(bytes),
      byte_length: bytes.length,
      provider: "elevenlabs",
      timing_basis: "provider_word_alignment",
      source_alignment_sha256: raw.sha256,
      network_used: false,
    };
  };
}

function validExplicitBinaryPath(value) {
  const filePath = text(value);
  return (
    Boolean(filePath) &&
    path.isAbsolute(filePath) &&
    fs.existsSync(filePath) &&
    fs.statSync(filePath).isFile()
  );
}

function defaultProcessRunner() {
  const { execFile } = require("node:child_process");
  return async function runProcess(invocation) {
    return new Promise((resolve) => {
      execFile(
        invocation.command,
        invocation.args,
        {
          cwd: invocation.cwd,
          encoding: "utf8",
          windowsHide: true,
          timeout: invocation.timeout_ms,
          maxBuffer: 16 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          resolve({
            status: error
              ? Number.isInteger(error.code)
                ? error.code
                : 1
              : 0,
            stdout: String(stdout || ""),
            stderr: String(stderr || error?.message || ""),
          });
        },
      );
    });
  };
}

function resolveProcessRuntime(options) {
  const ffmpegPath = path.resolve(text(options?.ffmpegPath || "."));
  const ffprobePath = path.resolve(text(options?.ffprobePath || "."));
  const ffmpegAvailable = validExplicitBinaryPath(options?.ffmpegPath);
  const ffprobeAvailable = validExplicitBinaryPath(options?.ffprobePath);
  const injected = typeof options?.processRunner === "function";
  const available = ffmpegAvailable && ffprobeAvailable;
  return {
    available,
    ffmpegPath: ffmpegAvailable ? ffmpegPath : null,
    ffprobePath: ffprobeAvailable ? ffprobePath : null,
    processRunner:
      ffmpegAvailable && ffprobeAvailable
        ? injected
          ? options.processRunner
          : defaultProcessRunner()
        : null,
    resolution: injected
      ? "injected_process_runner"
      : available
        ? "explicit_binary_default_runner"
        : "unavailable",
  };
}

async function invokeProcess(
  processRuntime,
  { command, args, cwd, timeoutMs, failureCode },
) {
  let result;
  try {
    result = await processRuntime.processRunner({
      command,
      args,
      cwd,
      timeout_ms: timeoutMs,
    });
  } catch {
    throw new WeeklyLongformRuntimeDependencyError(failureCode);
  }
  if (Number(result?.status) !== 0) {
    throw new WeeklyLongformRuntimeDependencyError(failureCode);
  }
  return {
    stdout: String(result?.stdout || ""),
    stderr: String(result?.stderr || ""),
  };
}

function parseProbe(stdout, prefix) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new WeeklyLongformRuntimeDependencyError(
      `${prefix}_ffprobe_json_invalid`,
    );
  }
  const streams = Array.isArray(value?.streams) ? value.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video");
  const audio = streams.find((stream) => stream?.codec_type === "audio");
  const duration = Number(value?.format?.duration);
  const blockers = [];
  if (
    !video ||
    !positiveNumber(video.width) ||
    !positiveNumber(video.height) ||
    !text(video.codec_name)
  ) {
    blockers.push(`${prefix}_video_stream_invalid`);
  }
  if (!audio || !text(audio.codec_name)) {
    blockers.push(`${prefix}_audio_stream_invalid`);
  }
  if (!positiveNumber(duration)) {
    blockers.push(`${prefix}_duration_invalid`);
  }
  const formatNames = text(value?.format?.format_name).split(",");
  if (!formatNames.some(Boolean)) {
    blockers.push(`${prefix}_container_invalid`);
  }
  if (blockers.length) {
    throw new WeeklyLongformRuntimeDependencyError(blockers);
  }
  return {
    raw: value,
    width: Number(video.width),
    height: Number(video.height),
    duration_seconds: duration,
    container: formatNames.includes("mp4")
      ? "mp4"
      : formatNames[0],
    video_codec: text(video.codec_name).toLowerCase(),
    audio_codec: text(audio.codec_name).toLowerCase(),
    video_duration_seconds: positiveNumber(video.duration),
    audio_duration_seconds: positiveNumber(audio.duration),
  };
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function variantsDependency(processRuntime) {
  return async function materializeVariants(input) {
    const runtime = validateRuntimeInput(input);
    const runRoot = path.resolve(runtime.outputDir, "..", "..");
    const master = observeFile(
      {
        path: input.master_path,
        sha256: input.master_sha256,
      },
      "variants_master",
      runRoot,
    );
    await fsp.mkdir(runtime.outputDir, { recursive: true });
    const variantPath = path.join(
      runtime.outputDir,
      "youtube-longform.mp4",
    );
    await invokeProcess(processRuntime, {
      command: processRuntime.ffmpegPath,
      args: [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        master.path,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-vf",
        "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        variantPath,
      ],
      cwd: runtime.outputDir,
      timeoutMs: 30 * 60 * 1000,
      failureCode: "platform_variant_ffmpeg_failed",
    });
    const variant = readRequiredFile(
      variantPath,
      "platform_variant",
      runtime.outputDir,
    );
    const probeResult = await invokeProcess(processRuntime, {
      command: processRuntime.ffprobePath,
      args: [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        variant.path,
      ],
      cwd: runtime.outputDir,
      timeoutMs: 120000,
      failureCode: "platform_variant_ffprobe_failed",
    });
    const probe = parseProbe(probeResult.stdout, "platform_variant");
    if (probe.width !== 1920 || probe.height !== 1080) {
      throw new WeeklyLongformRuntimeDependencyError(
        "platform_variant_landscape_geometry_invalid",
      );
    }
    const manifestValue = {
      schema_version: "pulse-longform-platform-variants-v1",
      run_id: runtime.runId,
      generated_at: runtime.generatedAt,
      master_sha256: master.sha256,
      variants: [
        {
          id: "youtube-longform",
          platform: "YOUTUBE_LONGFORM",
          path: variant.path,
          sha256: variant.sha256,
          width: probe.width,
          height: probe.height,
          duration_seconds: probe.duration_seconds,
          container: probe.container,
          video_codec: probe.video_codec,
          audio_codec: probe.audio_codec,
        },
      ],
    };
    const manifestPath = path.join(
      runtime.outputDir,
      "platform-variants.json",
    );
    const bytes = Buffer.from(
      `${JSON.stringify(manifestValue, null, 2)}\n`,
      "utf8",
    );
    await writeAtomic(manifestPath, bytes);
    return {
      path: manifestPath,
      sha256: sha256Buffer(bytes),
      byte_length: bytes.length,
      variant_count: 1,
      process_resolution: processRuntime.resolution,
      network_used: false,
    };
  };
}

function parseJsonBound(record, prefix, allowedRoot) {
  const observed = observeFile(record, prefix, allowedRoot);
  try {
    return {
      ...observed,
      value: JSON.parse(observed.bytes.toString("utf8")),
    };
  } catch {
    throw new WeeklyLongformRuntimeDependencyError(
      `${prefix}_json_invalid`,
    );
  }
}

function round(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Number(number.toFixed(digits))
    : null;
}

function parseBlackSegments(value) {
  const segments = [];
  const expression =
    /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/gi;
  let match;
  while ((match = expression.exec(String(value || ""))) !== null) {
    segments.push({
      start_seconds: Number(match[1]),
      end_seconds: Number(match[2]),
      duration_seconds: Number(match[3]),
    });
  }
  return segments;
}

function parseFreezeDurations(value) {
  const durations = [];
  const expression = /freeze_duration:\s*([\d.]+)/gi;
  let match;
  while ((match = expression.exec(String(value || ""))) !== null) {
    durations.push(Number(match[1]));
  }
  return durations.filter(Number.isFinite);
}

function parseBlurMeans(value) {
  const means = [];
  const expression = /blur mean:\s*([\d.]+)/gi;
  let match;
  while ((match = expression.exec(String(value || ""))) !== null) {
    means.push(Number(match[1]));
  }
  return means.filter(Number.isFinite);
}

function parseFrameHashes(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").at(-1)?.trim().toLowerCase())
    .filter((hash) => /^[a-f0-9]{8,}$/.test(hash));
}

function decodedQaDependency(processRuntime, thresholds = {}) {
  const maxAvSyncDeltaSeconds =
    positiveNumber(thresholds.maxAvSyncDeltaSeconds) || 0.25;
  const maxBlackSeconds =
    positiveNumber(thresholds.maxBlackSeconds) || 2;
  const maxFreezeSeconds =
    positiveNumber(thresholds.maxFreezeSeconds) || 2;
  const maxBlurMean =
    positiveNumber(thresholds.maxBlurMean) || 10;
  const minUniqueFrameRatio =
    positiveNumber(thresholds.minUniqueFrameRatio) || 0.5;

  return async function runDecodedQa(input) {
    const runtime = validateRuntimeInput(input);
    await fsp.mkdir(runtime.outputDir, { recursive: true });
    const runRoot = path.resolve(runtime.outputDir, "..", "..");
    const master = observeFile(
      {
        path: input.master_path,
        sha256: input.master_sha256,
      },
      "decoded_qa_master",
      runRoot,
    );
    const alignment = parseJsonBound(
      {
        path: input.alignment_path,
        sha256: input.alignment_sha256,
      },
      "decoded_qa_alignment",
      runRoot,
    );
    const variants = parseJsonBound(
      {
        path: input.variants_path,
        sha256: input.variants_sha256,
      },
      "decoded_qa_variants",
      runRoot,
    );
    const inputBlockers = [];
    if (
      alignment.value?.schema_version !==
        "pulse-word-timestamps-v1" ||
      text(alignment.value?.run_id) !== runtime.runId ||
      !Array.isArray(alignment.value?.words) ||
      alignment.value.words.length === 0
    ) {
      inputBlockers.push("decoded_qa_alignment_invalid");
    }
    if (
      variants.value?.schema_version !==
        "pulse-longform-platform-variants-v1" ||
      text(variants.value?.run_id) !== runtime.runId ||
      normaliseSha256(variants.value?.master_sha256) !== master.sha256
    ) {
      inputBlockers.push("decoded_qa_variants_invalid");
    }
    if (inputBlockers.length) {
      throw new WeeklyLongformRuntimeDependencyError(inputBlockers);
    }

    const probeResult = await invokeProcess(processRuntime, {
      command: processRuntime.ffprobePath,
      args: [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        master.path,
      ],
      cwd: runtime.outputDir,
      timeoutMs: 120000,
      failureCode: "decoded_qa_ffprobe_failed",
    });
    const probe = parseProbe(probeResult.stdout, "decoded_qa");

    await invokeProcess(processRuntime, {
      command: processRuntime.ffmpegPath,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        master.path,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-f",
        "null",
        "-",
      ],
      cwd: runtime.outputDir,
      timeoutMs: 30 * 60 * 1000,
      failureCode: "decoded_qa_full_decode_failed",
    });
    const blackResult = await invokeProcess(processRuntime, {
      command: processRuntime.ffmpegPath,
      args: [
        "-hide_banner",
        "-nostats",
        "-i",
        master.path,
        "-vf",
        "blackdetect=d=0.5:pic_th=0.98",
        "-an",
        "-f",
        "null",
        "-",
      ],
      cwd: runtime.outputDir,
      timeoutMs: 30 * 60 * 1000,
      failureCode: "decoded_qa_blackdetect_failed",
    });
    const freezeResult = await invokeProcess(processRuntime, {
      command: processRuntime.ffmpegPath,
      args: [
        "-hide_banner",
        "-nostats",
        "-i",
        master.path,
        "-vf",
        "freezedetect=n=-60dB:d=2",
        "-an",
        "-f",
        "null",
        "-",
      ],
      cwd: runtime.outputDir,
      timeoutMs: 30 * 60 * 1000,
      failureCode: "decoded_qa_freezedetect_failed",
    });
    const blurResult = await invokeProcess(processRuntime, {
      command: processRuntime.ffmpegPath,
      args: [
        "-hide_banner",
        "-nostats",
        "-i",
        master.path,
        "-vf",
        "fps=1/2,blurdetect=block_width=32:block_height=32:block_pct=80",
        "-an",
        "-f",
        "null",
        "-",
      ],
      cwd: runtime.outputDir,
      timeoutMs: 30 * 60 * 1000,
      failureCode: "decoded_qa_blurdetect_failed",
    });
    const repetitionResult = await invokeProcess(processRuntime, {
      command: processRuntime.ffmpegPath,
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        master.path,
        "-vf",
        "fps=1/5",
        "-an",
        "-hash",
        "sha256",
        "-f",
        "framehash",
        "pipe:1",
      ],
      cwd: runtime.outputDir,
      timeoutMs: 30 * 60 * 1000,
      failureCode: "decoded_qa_framehash_failed",
    });

    const blackSegments = parseBlackSegments(
      `${blackResult.stdout}\n${blackResult.stderr}`,
    );
    const maximumBlackSeconds = Math.max(
      0,
      ...blackSegments.map((segment) => segment.duration_seconds),
    );
    const freezeDurations = parseFreezeDurations(
      `${freezeResult.stdout}\n${freezeResult.stderr}`,
    );
    const maximumFreezeSeconds = Math.max(0, ...freezeDurations);
    const blurMeans = parseBlurMeans(
      `${blurResult.stdout}\n${blurResult.stderr}`,
    );
    const maximumBlurMean = blurMeans.length
      ? Math.max(...blurMeans)
      : null;
    const frameHashes = parseFrameHashes(repetitionResult.stdout);
    const uniqueFrameCount = new Set(frameHashes).size;
    const uniqueFrameRatio = frameHashes.length
      ? uniqueFrameCount / frameHashes.length
      : 0;
    const avSyncDelta =
      probe.video_duration_seconds && probe.audio_duration_seconds
        ? Math.abs(
            probe.video_duration_seconds -
              probe.audio_duration_seconds,
          )
        : null;
    const words = alignment.value.words;
    const captionsPass =
      words.length > 0 &&
      Number(alignment.value?.word_count) === words.length &&
      words.every(
        (word) =>
          text(word?.text) &&
          Number.isFinite(Number(word?.start_seconds)) &&
          Number.isFinite(Number(word?.end_seconds)) &&
          Number(word.end_seconds) > Number(word.start_seconds),
      ) &&
      Number(words.at(-1)?.end_seconds) <=
        probe.duration_seconds + 0.25;
    const checks = {
      video_decode: {
        pass: true,
        codec: probe.video_codec,
      },
      audio_decode: {
        pass: true,
        codec: probe.audio_codec,
      },
      captions: {
        pass: captionsPass,
        word_count: words.length,
        alignment_sha256: alignment.sha256,
      },
      av_sync: {
        pass:
          avSyncDelta !== null &&
          avSyncDelta <= maxAvSyncDeltaSeconds,
        delta_seconds: round(avSyncDelta),
        maximum_seconds: maxAvSyncDeltaSeconds,
      },
      black_frames: {
        pass: maximumBlackSeconds <= maxBlackSeconds,
        segment_count: blackSegments.length,
        maximum_seconds: round(maximumBlackSeconds),
        allowed_seconds: maxBlackSeconds,
      },
      freeze_frames: {
        pass: maximumFreezeSeconds <= maxFreezeSeconds,
        segment_count: freezeDurations.length,
        maximum_seconds: round(maximumFreezeSeconds),
        allowed_seconds: maxFreezeSeconds,
      },
      blur: {
        pass:
          maximumBlurMean !== null &&
          maximumBlurMean <= maxBlurMean,
        sample_count: blurMeans.length,
        maximum_mean: round(maximumBlurMean),
        allowed_mean: maxBlurMean,
      },
      repetition: {
        pass:
          frameHashes.length >= 3 &&
          uniqueFrameRatio >= minUniqueFrameRatio,
        sampled_frame_count: frameHashes.length,
        unique_frame_count: uniqueFrameCount,
        unique_frame_ratio: round(uniqueFrameRatio),
        minimum_unique_frame_ratio: minUniqueFrameRatio,
      },
    };
    const pass = Object.values(checks).every(
      (check) => check.pass === true,
    );
    const value = {
      schema_version: "pulse-decoded-qa-v1",
      run_id: runtime.runId,
      generated_at: runtime.generatedAt,
      master_sha256: master.sha256,
      alignment_sha256: alignment.sha256,
      variants_sha256: variants.sha256,
      decoder: "ffmpeg+ffprobe",
      complete: true,
      verdict: pass ? "PASS" : "FAIL",
      decoded_media: {
        width: probe.width,
        height: probe.height,
        duration_seconds: probe.duration_seconds,
        container: probe.container,
        video_codec: probe.video_codec,
        audio_codec: probe.audio_codec,
      },
      checks,
    };
    const reportPath = path.join(runtime.outputDir, "decoded-qa.json");
    const bytes = Buffer.from(
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await writeAtomic(reportPath, bytes);
    return {
      path: reportPath,
      sha256: sha256Buffer(bytes),
      byte_length: bytes.length,
      decoder: "ffmpeg+ffprobe",
      complete: true,
      verdict: value.verdict,
      process_resolution: processRuntime.resolution,
      network_used: false,
    };
  };
}

function derivativesDependency(processRuntime) {
  return async function materializeDerivatives(input = {}) {
    return require("./weekly-longform-derivative-materializer")
      .materializeGovernedWeeklyLongformDerivatives({
        workOrder: input.workOrder,
        sameRunEvidence: input.sameRunEvidence,
        outputDir: input.outputDir,
        generatedAt: input.generatedAt,
        ffmpegPath: processRuntime.ffmpegPath,
        ffprobePath: processRuntime.ffprobePath,
        processRunner: processRuntime.processRunner,
      });
  };
}

function createWeeklyLongformRuntimeDependencies(options = {}) {
  const env =
    options?.env &&
    typeof options.env === "object" &&
    !Array.isArray(options.env)
      ? options.env
      : {};
  const blockers = [];
  const processRuntime = resolveProcessRuntime(options);
  let creditGovernor = options.creditGovernor || null;
  if (
    !creditGovernor &&
    typeof options?.httpClient === "function" &&
    Boolean(text(env.ELEVENLABS_API_KEY))
  ) {
    try {
      creditGovernor = createElevenLabsCreditGovernor({
        env,
        request: options.httpClient,
      });
    } catch {
      creditGovernor = null;
    }
  }
  const narrationAvailable =
    typeof options?.httpClient === "function" &&
    Boolean(creditGovernor) &&
    Boolean(text(env.ELEVENLABS_API_KEY)) &&
    Boolean(text(env.ELEVENLABS_VOICE_ID));
  if (typeof options?.httpClient !== "function") {
    blockers.push("elevenlabs_http_client_unavailable");
  }
  if (!String(env.ELEVENLABS_API_KEY || "").trim()) {
    blockers.push("elevenlabs_api_key_unavailable");
  }
  if (!String(env.ELEVENLABS_VOICE_ID || "").trim()) {
    blockers.push("elevenlabs_voice_id_unavailable");
  }
  if (!String(env.PULSE_STATE_ROOT || "").trim()) {
    blockers.push("elevenlabs_credit_state_root_unavailable");
  }
  if (
    typeof options?.httpClient === "function" &&
    Boolean(text(env.ELEVENLABS_API_KEY)) &&
    !creditGovernor
  ) {
    blockers.push("elevenlabs_credit_governor_unavailable");
  }
  if (typeof options?.renderLongform !== "function") {
    blockers.push("verified_render_longform_dependency_unavailable");
  }
  if (!validExplicitBinaryPath(options?.ffmpegPath)) {
    blockers.push("explicit_ffmpeg_binary_path_required");
  }
  if (!validExplicitBinaryPath(options?.ffprobePath)) {
    blockers.push("explicit_ffprobe_binary_path_required");
  }
  if (!processRuntime.available) {
    blockers.push("process_runner_unavailable");
  }

  return {
    capabilities: {
      schema_version: RUNTIME_CAPABILITIES_SCHEMA,
      ready: blockers.length === 0,
      blockers,
      dependencies: {
        produceNarration: {
          available: narrationAvailable,
        },
        materializeAlignment: {
          available: true,
          resolution: "built_in_exact_raw_alignment_converter",
        },
        renderLongform: {
          available: typeof options?.renderLongform === "function",
        },
        materializeVariants: {
          available: processRuntime.available,
          resolution: processRuntime.resolution,
        },
        runDecodedQa: {
          available: processRuntime.available,
          resolution: processRuntime.resolution,
        },
        materializeDerivatives: {
          available: processRuntime.available,
          resolution: processRuntime.resolution,
        },
      },
      safety: {
        implicit_network_enabled: false,
        implicit_process_spawn_enabled: false,
        upload_authority: false,
        oauth_mutation_authority: false,
        database_mutation_authority: false,
      },
    },
    dependencies: {
      ...(narrationAvailable
        ? {
            produceNarration: narrationDependency({
              httpClient: options.httpClient,
              creditGovernor,
              env,
            }),
          }
        : {}),
      materializeAlignment: exactAlignmentDependency(),
      ...(typeof options?.renderLongform === "function"
        ? { renderLongform: options.renderLongform }
        : {}),
      ...(processRuntime.available
        ? {
            materializeVariants: variantsDependency(processRuntime),
            runDecodedQa: decodedQaDependency(
              processRuntime,
              options.qaThresholds,
            ),
            materializeDerivatives:
              derivativesDependency(processRuntime),
          }
        : {}),
    },
  };
}

module.exports = {
  RUNTIME_CAPABILITIES_SCHEMA,
  WeeklyLongformRuntimeDependencyError,
  createWeeklyLongformRuntimeDependencies,
  sha256Buffer,
};
