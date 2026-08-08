"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  validateGovernedAutonomousProductionRequestBuild,
} = require("./governed-autonomous-production-request-builder");
const {
  createElevenLabsCreditGovernor,
} = require("./elevenlabs-credit-governor");
const {
  createGovernedElevenLabsHttpClient,
  createGovernedProcessRunner,
  resolveHyperframesRuntime,
  resolveMediaExecutablePaths,
} = require("./weekly-longform-runtime-factory");
const {
  createGovernedAutonomousNarrationAdapter,
} = require("./governed-autonomous-narration-adapter");
const {
  createGovernedAutonomousProductionMediaAdapters,
} = require("./governed-autonomous-production-media-adapters");
const {
  createGovernedAutonomousVisualQaAdapters,
} = require("./governed-autonomous-visual-qa-adapters");
const { safeRedirectConfig } = require("../safe-url");

const CAPABILITIES_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-runtime-capabilities-v1";

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))].sort();
}

function existingAbsoluteFile(value) {
  const supplied = text(value);
  if (!supplied || !path.isAbsolute(supplied)) return null;
  try {
    const stat = fs.statSync(supplied);
    if (!stat.isFile()) return null;
    return fs.realpathSync(supplied);
  } catch {
    return null;
  }
}

function requestFunction(client) {
  if (typeof client === "function") return client;
  if (typeof client?.request === "function") {
    return client.request.bind(client);
  }
  return null;
}

function createGovernedLoopbackHttpClient({
  axiosInstance,
  allowedOrigins,
} = {}) {
  const request =
    requestFunction(axiosInstance) ||
    requestFunction(require("axios"));
  if (!request) throw new Error("loopback_http_client_required");
  const origins = new Set(
    (allowedOrigins || []).map((value) => {
      const parsed = new URL(text(value));
      if (
        parsed.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(
          parsed.hostname,
        ) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error("loopback_http_origin_invalid");
      }
      return parsed.origin;
    }),
  );
  return async function governedLoopbackRequest(input = {}) {
    const target = new URL(text(input.url));
    if (
      !origins.has(target.origin) ||
      target.protocol !== "http:" ||
      target.username ||
      target.password ||
      !["/api/show", "/api/chat"].includes(target.pathname) ||
      target.search ||
      target.hash ||
      text(input.method).toUpperCase() !== "POST"
    ) {
      throw new Error("loopback_http_request_forbidden");
    }
    return request({
      ...input,
      method: "POST",
      url: target.href,
      proxy: false,
      ...safeRedirectConfig(0),
      maxBodyLength: 48 * 1024 * 1024,
      maxContentLength: 8 * 1024 * 1024,
      validateStatus: () => true,
    });
  };
}

function defaultImageRuntime(sharpImpl) {
  let sharp = sharpImpl;
  try {
    sharp = sharp || require("sharp");
  } catch {
    return null;
  }
  if (typeof sharp !== "function") return null;
  return {
    async render({ svg, outputPath, width, height }) {
      await sharp(Buffer.from(svg, "utf8"), {
        density: 144,
      })
        .resize(width, height, {
          fit: "fill",
          kernel: "lanczos3",
        })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: false,
          palette: false,
        })
        .toFile(outputPath);
    },
    async inspect(filePath) {
      const metadata = await sharp(filePath).metadata();
      return {
        width: Number(metadata.width),
        height: Number(metadata.height),
      };
    },
  };
}

function buildGovernedAutonomousProductionRuntime(
  options = {},
) {
  const builder =
    validateGovernedAutonomousProductionRequestBuild(
      options.builderResult,
    );
  const productionRequest = builder.production_request;
  const env =
    options.env &&
    typeof options.env === "object" &&
    !Array.isArray(options.env)
      ? options.env
      : process.env;
  const executablePaths =
    options.executablePaths ||
    resolveMediaExecutablePaths({ env });
  const hyperframesRuntime =
    options.hyperframesRuntime || resolveHyperframesRuntime();
  const ffmpegPath = existingAbsoluteFile(
    executablePaths.ffmpeg_path,
  );
  const ffprobePath = existingAbsoluteFile(
    executablePaths.ffprobe_path,
  );
  const hyperframesCliPath = existingAbsoluteFile(
    hyperframesRuntime.cli_path,
  );
  const gsapPath = existingAbsoluteFile(
    hyperframesRuntime.gsap_path,
  );
  const hyperframesVersion = text(
    hyperframesRuntime.version,
  );
  const blockers = [
    ...(executablePaths.blockers || []),
    ...(hyperframesRuntime.blockers || []),
  ];
  if (!ffmpegPath) blockers.push("ffmpeg_binary_unavailable");
  if (!ffprobePath) blockers.push("ffprobe_binary_unavailable");
  if (!hyperframesCliPath) {
    blockers.push("hyperframes_cli_unavailable");
  }
  if (
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      hyperframesVersion,
    )
  ) {
    blockers.push("hyperframes_version_unavailable");
  }
  if (!gsapPath && typeof options.processRunner !== "function") {
    blockers.push("gsap_runtime_unavailable");
  }

  const configuredApiKey = text(env.ELEVENLABS_API_KEY);
  const configuredVoiceId = text(env.ELEVENLABS_VOICE_ID);
  const configuredModelId =
    text(env.ELEVENLABS_MODEL_ID) ||
    productionRequest.narration.model_id;
  const stateRoot = text(env.PULSE_STATE_ROOT);
  if (!configuredApiKey) {
    blockers.push("elevenlabs_api_key_unavailable");
  }
  if (!configuredVoiceId) {
    blockers.push("elevenlabs_voice_id_unavailable");
  } else if (
    configuredVoiceId !==
    productionRequest.narration.voice_id
  ) {
    blockers.push("elevenlabs_voice_binding_mismatch");
  }
  if (
    configuredModelId !==
    productionRequest.narration.model_id
  ) {
    blockers.push("elevenlabs_model_binding_mismatch");
  }
  if (!stateRoot) {
    blockers.push("elevenlabs_credit_state_root_unavailable");
  }

  let processRunner = options.processRunner || null;
  if (!processRunner && ffmpegPath && ffprobePath && hyperframesCliPath) {
    try {
      processRunner = createGovernedProcessRunner({
        allowedCommands: [
          process.execPath,
          ffmpegPath,
          ffprobePath,
        ],
        env,
      });
    } catch {
      processRunner = null;
    }
  }
  if (typeof processRunner !== "function") {
    blockers.push("governed_process_runner_unavailable");
  }

  let elevenLabsHttpClient =
    options.elevenLabsHttpClient || null;
  if (!elevenLabsHttpClient && configuredApiKey) {
    try {
      elevenLabsHttpClient =
        createGovernedElevenLabsHttpClient({
          axiosInstance: options.axiosInstance,
          baseUrl:
            text(env.ELEVENLABS_BASE_URL) ||
            "https://api.elevenlabs.io",
        });
    } catch {
      elevenLabsHttpClient = null;
    }
  }
  if (typeof elevenLabsHttpClient !== "function") {
    blockers.push("elevenlabs_http_client_unavailable");
  }

  let creditGovernor = options.creditGovernor || null;
  if (
    !creditGovernor &&
    typeof elevenLabsHttpClient === "function" &&
    configuredApiKey &&
    stateRoot
  ) {
    try {
      creditGovernor = createElevenLabsCreditGovernor({
        env,
        request: elevenLabsHttpClient,
        stateRoot,
      });
    } catch {
      creditGovernor = null;
    }
  }
  if (typeof creditGovernor?.preflight !== "function") {
    blockers.push("elevenlabs_credit_governor_unavailable");
  }

  const reviewerOrigins =
    productionRequest.visual_qa.reviewers.map(
      (reviewer) => reviewer.endpoint_origin,
    );
  let loopbackHttpClient =
    options.loopbackHttpClient || null;
  if (!loopbackHttpClient) {
    try {
      loopbackHttpClient =
        createGovernedLoopbackHttpClient({
          axiosInstance: options.axiosInstance,
          allowedOrigins: reviewerOrigins,
        });
    } catch {
      loopbackHttpClient = null;
    }
  }
  if (typeof loopbackHttpClient !== "function") {
    blockers.push("ollama_loopback_http_client_unavailable");
  }

  const defaultImages = defaultImageRuntime(
    options.sharpImpl,
  );
  const imageRenderer =
    options.imageRenderer || defaultImages?.render || null;
  const imageInspector =
    options.imageInspector || defaultImages?.inspect || null;
  if (typeof imageRenderer !== "function") {
    blockers.push("image_renderer_unavailable");
  }
  if (typeof imageInspector !== "function") {
    blockers.push("image_inspector_unavailable");
  }

  const exactBlockers = unique(blockers);
  const ready = exactBlockers.length === 0;
  let dependencies = {};
  if (ready) {
    const media =
      createGovernedAutonomousProductionMediaAdapters({
        ffmpegPath,
        ffprobePath,
        hyperframesCliPath,
        hyperframesVersion,
        gsapPath,
        processRunner,
        imageRenderer,
        imageInspector,
        fileSystem: options.fileSystem,
      });
    dependencies = {
      ownedProgramme: media.ownedProgramme,
      narrationTimingEvidence: Object.freeze({
        state_root: path.resolve(stateRoot),
      }),
      generateNarration:
        createGovernedAutonomousNarrationAdapter({
          apiKey: configuredApiKey,
          voiceId: configuredVoiceId,
          modelId: configuredModelId,
          creditGovernor,
          httpClient: elevenLabsHttpClient,
          fileSystem: options.fileSystem,
        }),
      probeNarrationAudio: media.probeNarrationAudio,
      finalComposite: media.finalComposite,
      visualQa: {
        extractFrames: media.extractFrames,
        reviewerAdapters:
          createGovernedAutonomousVisualQaAdapters({
            reviewers:
              productionRequest.visual_qa.reviewers,
            httpClient: loopbackHttpClient,
            fileSystem: options.fileSystem,
          }),
      },
    };
  }
  return Object.freeze({
    capabilities: Object.freeze({
      schema_version: CAPABILITIES_SCHEMA_VERSION,
      ready,
      blockers: exactBlockers,
      story_id: builder.story_id,
      scheduled_for: builder.scheduled_for,
      role: builder.role,
      bindings: Object.freeze({
        voice_id:
          productionRequest.narration.voice_id,
        model_id:
          productionRequest.narration.model_id,
        reviewer_keys:
          productionRequest.visual_qa.reviewers.map(
            (reviewer) =>
              `${text(reviewer.provider).toLowerCase()}:` +
              text(reviewer.model),
          ),
        hyperframes_generator_identity:
          hyperframesVersion
            ? `hyperframes@${hyperframesVersion}`
            : null,
      }),
      media_executables: Object.freeze({
        ffmpeg_path: ffmpegPath,
        ffprobe_path: ffprobePath,
        hyperframes_cli_path: hyperframesCliPath,
      }),
      safety: Object.freeze({
        local_proof_only: true,
        paid_narration_credit_governor_enforced: true,
        provider_network_origin_pinned: true,
        visual_qa_loopback_only: true,
        process_commands_allowlisted: true,
        external_publish_authority: false,
        platform_contact_authority: false,
        oauth_mutation_authority: false,
        scheduler_authority: false,
        database_mutation_authority: false,
      }),
    }),
    dependencies: Object.freeze(dependencies),
  });
}

module.exports = {
  CAPABILITIES_SCHEMA_VERSION,
  buildGovernedAutonomousProductionRuntime,
  createGovernedLoopbackHttpClient,
};
