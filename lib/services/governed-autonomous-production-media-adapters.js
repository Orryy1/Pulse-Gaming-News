"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  parseLoudnormOutput,
  parseTerminalSilenceOutput,
} = require("./governed-final-composite");

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const RECEIPT_BASE = Object.freeze({
  deterministic: true,
  ownership: "owned",
  rights_basis: "OWNED",
  attribution_required: false,
  third_party_media_used: false,
  third_party_music: false,
  network_used: false,
});

class GovernedAutonomousProductionMediaAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name =
      "GovernedAutonomousProductionMediaAdapterError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousProductionMediaAdapterError(code);
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgForScene(scene) {
  const design = scene?.design || {};
  const accent = /^#[A-Fa-f0-9]{6}$/.test(text(design.accent_colour))
    ? text(design.accent_colour).toUpperCase()
    : "#FF6B1A";
  const headline = xml(text(design.headline).toUpperCase());
  const supporting = xml(text(design.supporting_text));
  const layout = xml(text(design.layout).toUpperCase());
  const storyMark = xml(text(scene?.role).replaceAll("_", " ").toUpperCase());
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">',
    "  <defs>",
    '    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '      <stop offset="0" stop-color="#080B10"/>',
    '      <stop offset="0.62" stop-color="#111A24"/>',
    `      <stop offset="1" stop-color="${accent}" stop-opacity="0.34"/>`,
    "    </linearGradient>",
    '    <pattern id="grid" width="72" height="72" patternUnits="userSpaceOnUse">',
    '      <path d="M72 0H0V72" fill="none" stroke="#FFFFFF" stroke-opacity="0.055" stroke-width="2"/>',
    "    </pattern>",
    "  </defs>",
    '  <rect width="1080" height="1920" fill="url(#bg)"/>',
    '  <rect width="1080" height="1920" fill="url(#grid)"/>',
    `  <rect x="72" y="150" width="12" height="260" rx="6" fill="${accent}"/>`,
    `  <text x="108" y="196" fill="${accent}" font-family="Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="5">${layout}</text>`,
    `  <text x="72" y="830" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="104" font-weight="900">${headline}</text>`,
    `  <text x="76" y="936" fill="#D8E1EA" font-family="Arial, sans-serif" font-size="44" font-weight="500">${supporting}</text>`,
    `  <line x1="72" y1="1040" x2="1008" y2="1040" stroke="${accent}" stroke-width="5"/>`,
    `  <text x="72" y="1740" fill="#AAB8C6" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="4">PULSE • ${storyMark}</text>`,
    "</svg>",
    "",
  ].join("\n");
}

async function exactOutput(filePath, fileSystem, code) {
  let stat;
  try {
    stat = await fileSystem.lstat(filePath);
  } catch {
    fail(code);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    fail(code);
  }
  return stat;
}

async function runProcess(
  processRunner,
  invocation,
  code,
) {
  let result;
  try {
    result = await processRunner(invocation);
  } catch {
    fail(code);
  }
  if (Number(result?.status) !== 0) {
    fail(code);
  }
  return {
    stdout: String(result?.stdout || ""),
    stderr: String(result?.stderr || ""),
  };
}

function receipt(adapterId, extra = {}) {
  return {
    adapter_id: adapterId,
    ...RECEIPT_BASE,
    ...extra,
  };
}

function createSceneRenderer({
  ffmpegPath,
  processRunner,
  imageRenderer,
  fileSystem,
}) {
  return async function renderScene(input = {}) {
    const outputPath = exactAbsolutePath(
      input.outputPath,
      "autonomous_media_scene_output_invalid",
    );
    const mediaType = text(input.scene?.media_type).toLowerCase();
    if (
      input.width !== WIDTH ||
      input.height !== HEIGHT ||
      input.fps !== FPS ||
      !["image", "video"].includes(mediaType)
    ) {
      fail("autonomous_media_scene_contract_invalid");
    }
    const svg = svgForScene(input.scene);
    await fileSystem.mkdir(path.dirname(outputPath), {
      recursive: true,
    });
    if (mediaType === "image") {
      await imageRenderer({
        svg,
        outputPath,
        width: WIDTH,
        height: HEIGHT,
      });
    } else {
      const framePath = `${outputPath}.source.png`;
      try {
        await imageRenderer({
          svg,
          outputPath: framePath,
          width: WIDTH,
          height: HEIGHT,
        });
        const duration = Number(input.scene.duration_seconds);
        if (!Number.isFinite(duration) || duration <= 0) {
          fail("autonomous_media_scene_duration_invalid");
        }
        await runProcess(
          processRunner,
          {
            command: ffmpegPath,
            args: [
              "-hide_banner",
              "-loglevel",
              "error",
              "-y",
              "-loop",
              "1",
              "-framerate",
              String(FPS),
              "-i",
              framePath,
              "-t",
              String(duration),
              "-an",
              "-c:v",
              "libx264",
              "-preset",
              "medium",
              "-crf",
              "18",
              "-pix_fmt",
              "yuv420p",
              "-r",
              String(FPS),
              "-map_metadata",
              "-1",
              "-fflags",
              "+bitexact",
              "-flags:v",
              "+bitexact",
              "-movflags",
              "+faststart",
              outputPath,
            ],
            cwd: path.dirname(outputPath),
            timeout_ms: 180_000,
          },
          "autonomous_media_scene_ffmpeg_failed",
        );
      } finally {
        await fileSystem.rm(framePath, { force: true });
      }
    }
    await exactOutput(
      outputPath,
      fileSystem,
      "autonomous_media_scene_output_missing",
    );
    return receipt(
      mediaType === "image"
        ? "pulse-owned-scene-svg-sharp-v1"
        : "pulse-owned-scene-svg-ffmpeg-v1",
    );
  };
}

function createProgrammeRenderer({
  hyperframesCliPath,
  hyperframesVersion,
  gsapPath,
  processRunner,
  fileSystem,
}) {
  return async function renderProgramme(input = {}) {
    const outputPath = exactAbsolutePath(
      input.outputPath,
      "autonomous_media_programme_output_invalid",
    );
    const projectRoot = exactAbsolutePath(
      input.hyperframesProject?.root,
      "autonomous_media_hyperframes_project_invalid",
    );
    if (
      input.width !== WIDTH ||
      input.height !== HEIGHT ||
      input.fps !== FPS ||
      !Number.isFinite(Number(input.targetDurationSeconds)) ||
      Number(input.targetDurationSeconds) <= 0
    ) {
      fail("autonomous_media_programme_contract_invalid");
    }
    await fileSystem.mkdir(path.dirname(outputPath), {
      recursive: true,
    });
    const temporaryNodeModules = path.join(
      projectRoot,
      "node_modules",
    );
    let stagedGsap = false;
    if (gsapPath) {
      try {
        await fileSystem.lstat(temporaryNodeModules);
        fail("autonomous_media_hyperframes_node_modules_conflict");
      } catch (error) {
        if (
          error instanceof
          GovernedAutonomousProductionMediaAdapterError
        ) {
          throw error;
        }
        if (error?.code !== "ENOENT") throw error;
      }
      const gsapTarget = path.join(
        temporaryNodeModules,
        "gsap",
        "dist",
        "gsap.min.js",
      );
      await fileSystem.mkdir(path.dirname(gsapTarget), {
        recursive: true,
      });
      await fileSystem.copyFile(gsapPath, gsapTarget);
      stagedGsap = true;
    }
    try {
      await runProcess(
        processRunner,
        {
          command: process.execPath,
          args: [
            hyperframesCliPath,
            "render",
            "--output",
            outputPath,
            "--fps",
            String(FPS),
            "--quality",
            "high",
            "--workers",
            "1",
            "--no-browser-gpu",
            "--no-best-effort",
            "--strict",
            "--quiet",
            projectRoot,
          ],
          cwd: projectRoot,
          timeout_ms: 20 * 60 * 1000,
        },
        "autonomous_media_hyperframes_render_failed",
      );
    } finally {
      if (stagedGsap) {
        await fileSystem.rm(temporaryNodeModules, {
          recursive: true,
          force: true,
        });
      }
      for (const runtimeDir of [".producer", ".hyperframes", "renders"]) {
        await fileSystem.rm(path.join(projectRoot, runtimeDir), {
          recursive: true,
          force: true,
        });
      }
    }
    await exactOutput(
      outputPath,
      fileSystem,
      "autonomous_media_programme_output_missing",
    );
    return receipt(
      "pulse-governed-hyperframes-programme-renderer-v1",
      {
        generator_identity: `hyperframes@${hyperframesVersion}`,
      },
    );
  };
}

function createProbeMedia({
  ffprobePath,
  processRunner,
}) {
  return async function probeMedia(input) {
    const filePath = exactAbsolutePath(
      typeof input === "string" ? input : input?.filePath,
      "autonomous_media_probe_path_invalid",
    );
    const result = await runProcess(
      processRunner,
      {
        command: ffprobePath,
        args: [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          filePath,
        ],
        cwd: path.dirname(filePath),
        timeout_ms: 30_000,
      },
      "autonomous_media_ffprobe_failed",
    );
    try {
      return JSON.parse(result.stdout);
    } catch {
      fail("autonomous_media_ffprobe_json_invalid");
    }
  };
}

function createFinalCompositeAdapters({
  ffmpegPath,
  probeMedia,
  processRunner,
  fileSystem,
}) {
  return {
    probeMedia,
    async measureLoudness(filePath, prefix) {
      const exactPath = exactAbsolutePath(
        filePath,
        "autonomous_media_loudness_path_invalid",
      );
      const result = await runProcess(
        processRunner,
        {
          command: ffmpegPath,
          args: [
            "-hide_banner",
            "-nostats",
            "-i",
            exactPath,
            "-vn",
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json",
            "-f",
            "null",
            "-",
          ],
          cwd: path.dirname(exactPath),
          timeout_ms: 120_000,
        },
        "autonomous_media_loudness_failed",
      );
      return parseLoudnormOutput(result.stderr, prefix);
    },
    async renderComposite(invocation = {}) {
      if (
        path.resolve(text(invocation.command)) !==
          path.resolve(ffmpegPath) ||
        !Array.isArray(invocation.args)
      ) {
        fail("autonomous_media_composite_invocation_invalid");
      }
      await runProcess(
        processRunner,
        {
          command: ffmpegPath,
          args: invocation.args.map(String),
          cwd: exactAbsolutePath(
            invocation.cwd,
            "autonomous_media_composite_cwd_invalid",
          ),
          timeout_ms: 10 * 60 * 1000,
        },
        "autonomous_media_composite_ffmpeg_failed",
      );
      await exactOutput(
        exactAbsolutePath(
          invocation.outputPath,
          "autonomous_media_composite_output_invalid",
        ),
        fileSystem,
        "autonomous_media_composite_output_missing",
      );
    },
    async measureTerminalSilence(
      filePath,
      durationSeconds,
    ) {
      const exactPath = exactAbsolutePath(
        filePath,
        "autonomous_media_silence_path_invalid",
      );
      const result = await runProcess(
        processRunner,
        {
          command: ffmpegPath,
          args: [
            "-hide_banner",
            "-nostats",
            "-i",
            exactPath,
            "-vn",
            "-af",
            "silencedetect=noise=-50dB:d=0.1",
            "-f",
            "null",
            "-",
          ],
          cwd: path.dirname(exactPath),
          timeout_ms: 120_000,
        },
        "autonomous_media_silence_measurement_failed",
      );
      return parseTerminalSilenceOutput(result.stderr, {
        durationSeconds,
        thresholdDb: -50,
        minimumDurationSeconds: 0.1,
      });
    },
  };
}

function createFrameExtractor({
  ffmpegPath,
  processRunner,
  imageInspector,
  fileSystem,
}) {
  return async function extractFrames(input = {}) {
    if (
      input.publish_authority !== false ||
      !Array.isArray(input.frame_plan)
    ) {
      fail("autonomous_media_frame_request_invalid");
    }
    const source = exactAbsolutePath(
      input.final_mp4?.path,
      "autonomous_media_frame_source_invalid",
    );
    const framesDir = exactAbsolutePath(
      input.frames_dir,
      "autonomous_media_frames_dir_invalid",
    );
    await fileSystem.mkdir(framesDir, { recursive: true });
    const frames = [];
    for (const planned of input.frame_plan) {
      const frameId = text(planned.frame_id);
      const timestampMs = Number(planned.timestamp_ms);
      if (
        !/^[A-Za-z0-9._-]{1,64}$/.test(frameId) ||
        !Number.isInteger(timestampMs) ||
        timestampMs < 0
      ) {
        fail("autonomous_media_frame_plan_invalid");
      }
      const outputPath = path.join(framesDir, `${frameId}.png`);
      await runProcess(
        processRunner,
        {
          command: ffmpegPath,
          args: [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            (timestampMs / 1000).toFixed(3),
            "-i",
            source,
            "-frames:v",
            "1",
            "-vf",
            "scale=1080:1920:flags=lanczos",
            "-map_metadata",
            "-1",
            outputPath,
          ],
          cwd: framesDir,
          timeout_ms: 60_000,
        },
        "autonomous_media_frame_extraction_failed",
      );
      await exactOutput(
        outputPath,
        fileSystem,
        "autonomous_media_frame_output_missing",
      );
      const dimensions = await imageInspector(outputPath);
      const bytes = await fileSystem.readFile(outputPath);
      frames.push({
        frame_id: frameId,
        timestamp_ms: timestampMs,
        path: outputPath,
        sha256: sha256Bytes(bytes),
        width: Number(dimensions?.width),
        height: Number(dimensions?.height),
        deterministic_blockers:
          Number(dimensions?.width) === WIDTH &&
          Number(dimensions?.height) === HEIGHT
            ? []
            : ["frame_dimensions_invalid"],
      });
    }
    return frames;
  };
}

function createGovernedAutonomousProductionMediaAdapters(
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const requiredFunctions = [
    "processRunner",
    "imageRenderer",
    "imageInspector",
  ];
  if (
    requiredFunctions.some(
      (field) => typeof options[field] !== "function",
    )
  ) {
    fail("autonomous_media_dependencies_invalid");
  }
  const ffmpegPath = exactAbsolutePath(
    options.ffmpegPath,
    "autonomous_media_ffmpeg_path_invalid",
  );
  const ffprobePath = exactAbsolutePath(
    options.ffprobePath,
    "autonomous_media_ffprobe_path_invalid",
  );
  const hyperframesCliPath = exactAbsolutePath(
    options.hyperframesCliPath,
    "autonomous_media_hyperframes_cli_path_invalid",
  );
  const hyperframesVersion = text(options.hyperframesVersion);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
    hyperframesVersion,
  )) {
    fail("autonomous_media_hyperframes_version_invalid");
  }
  const probeMedia = createProbeMedia({
    ffprobePath,
    processRunner: options.processRunner,
  });
  return Object.freeze({
    ownedProgramme: Object.freeze({
      hyperframesGeneratorIdentity:
        `hyperframes@${hyperframesVersion}`,
      renderScene: createSceneRenderer({
        ffmpegPath,
        processRunner: options.processRunner,
        imageRenderer: options.imageRenderer,
        fileSystem,
      }),
      renderProgramme: createProgrammeRenderer({
        hyperframesCliPath,
        hyperframesVersion,
        gsapPath: options.gsapPath || null,
        processRunner: options.processRunner,
        fileSystem,
      }),
      probeMedia,
    }),
    probeNarrationAudio: async (filePath) => {
      const probe = await probeMedia(filePath);
      const streams = Array.isArray(probe?.streams)
        ? probe.streams
        : [];
      const audio = streams.find(
        (stream) =>
          text(stream?.codec_type).toLowerCase() === "audio",
      );
      const duration = Number(
        probe?.format?.duration ?? audio?.duration,
      );
      if (!audio || !Number.isFinite(duration) || duration <= 0) {
        fail("autonomous_media_narration_probe_invalid");
      }
      return { duration_seconds: duration };
    },
    finalComposite: Object.freeze(
      createFinalCompositeAdapters({
        ffmpegPath,
        probeMedia,
        processRunner: options.processRunner,
        fileSystem,
      }),
    ),
    extractFrames: createFrameExtractor({
      ffmpegPath,
      processRunner: options.processRunner,
      imageInspector: options.imageInspector,
      fileSystem,
    }),
  });
}

module.exports = {
  GovernedAutonomousProductionMediaAdapterError,
  createGovernedAutonomousProductionMediaAdapters,
  svgForScene,
};
