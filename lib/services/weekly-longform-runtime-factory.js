"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  assertSafeOutboundUrl,
  safeRedirectConfig,
} = require("../safe-url");

const STACK_SCHEMA = "pulse-weekly-longform-runtime-stack-v1";
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PROCESS_TIMEOUT_MS = 3 * 60 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set((values || []).map(text).filter(Boolean))];
}

function existingAbsoluteFile(value) {
  const candidate = text(value);
  if (!candidate || !path.isAbsolute(candidate)) return null;
  try {
    if (!fs.statSync(candidate).isFile()) return null;
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

function configuredExecutable(env, keys) {
  for (const key of keys) {
    if (text(env?.[key])) return { key, value: text(env[key]) };
  }
  return null;
}

function pathExecutable({
  env,
  executable,
  platform,
}) {
  const pathValue = text(env?.PATH || env?.Path);
  if (!pathValue) return null;
  const fileName =
    platform === "win32" ? `${executable}.exe` : executable;
  for (const directory of pathValue.split(path.delimiter)) {
    const root = text(directory).replace(/^"(.*)"$/, "$1");
    if (!root) continue;
    const found = existingAbsoluteFile(path.resolve(root, fileName));
    if (found) return found;
  }
  return null;
}

function resolveOneExecutable({
  env,
  keys,
  executable,
  platform,
}) {
  const configured = configuredExecutable(env, keys);
  if (configured) {
    const resolved = existingAbsoluteFile(configured.value);
    return resolved
      ? {
          path: resolved,
          resolution: `environment:${configured.key}`,
          blocker: null,
        }
      : {
          path: null,
          resolution: `invalid_environment:${configured.key}`,
          blocker: `configured_${executable}_path_invalid`,
        };
  }
  const found = pathExecutable({ env, executable, platform });
  return found
    ? {
        path: found,
        resolution: "path_search",
        blocker: null,
      }
    : {
        path: null,
        resolution: "unavailable",
        blocker: `${executable}_binary_unavailable`,
      };
}

function resolveMediaExecutablePaths({
  env = process.env,
  platform = process.platform,
} = {}) {
  const ffmpeg = resolveOneExecutable({
    env,
    keys: ["PULSE_FFMPEG_PATH", "FFMPEG_PATH"],
    executable: "ffmpeg",
    platform,
  });
  const ffprobe = resolveOneExecutable({
    env,
    keys: ["PULSE_FFPROBE_PATH", "FFPROBE_PATH"],
    executable: "ffprobe",
    platform,
  });
  return {
    ffmpeg_path: ffmpeg.path,
    ffprobe_path: ffprobe.path,
    blockers: unique([ffmpeg.blocker, ffprobe.blocker]),
    resolution: {
      ffmpeg: ffmpeg.resolution,
      ffprobe: ffprobe.resolution,
    },
  };
}

function resolvePackageJson(packageName) {
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch {
    return null;
  }
}

function resolvePackageFile(packageName, ...segments) {
  const packagePath = resolvePackageJson(packageName);
  return packagePath
    ? existingAbsoluteFile(
        path.join(path.dirname(packagePath), ...segments),
      )
    : null;
}

function resolveHyperframesRuntime() {
  const blockers = [];
  const packagePath = resolvePackageJson("hyperframes");
  let cliPath = null;
  let version = null;
  if (packagePath) {
    try {
      const packageValue = JSON.parse(
        fs.readFileSync(packagePath, "utf8"),
      );
      version = text(packageValue.version) || null;
      const binEntry =
        typeof packageValue.bin === "string"
          ? packageValue.bin
          : packageValue.bin?.hyperframes;
      cliPath = existingAbsoluteFile(
        path.resolve(path.dirname(packagePath), text(binEntry)),
      );
    } catch {
      /* reported below */
    }
  }
  if (!cliPath) blockers.push("hyperframes_cli_unavailable");
  if (!version) blockers.push("hyperframes_version_unavailable");

  let gsapPath = null;
  try {
    gsapPath = existingAbsoluteFile(
      require.resolve("gsap/dist/gsap.min.js"),
    );
  } catch {
    /* reported below */
  }
  if (!gsapPath) blockers.push("gsap_runtime_unavailable");
  const fontPaths = {
    sans_regular: resolvePackageFile(
      "@fontsource/ibm-plex-sans",
      "files",
      "ibm-plex-sans-latin-400-normal.woff2",
    ),
    sans_bold: resolvePackageFile(
      "@fontsource/ibm-plex-sans",
      "files",
      "ibm-plex-sans-latin-700-normal.woff2",
    ),
    mono_regular: resolvePackageFile(
      "@fontsource/ibm-plex-mono",
      "files",
      "ibm-plex-mono-latin-400-normal.woff2",
    ),
    mono_bold: resolvePackageFile(
      "@fontsource/ibm-plex-mono",
      "files",
      "ibm-plex-mono-latin-700-normal.woff2",
    ),
    display: resolvePackageFile(
      "@fontsource/bebas-neue",
      "files",
      "bebas-neue-latin-400-normal.woff2",
    ),
  };
  for (const [fontId, fontPath] of Object.entries(fontPaths)) {
    if (!fontPath) blockers.push(`font_runtime_${fontId}_unavailable`);
  }
  return {
    cli_path: cliPath,
    version,
    gsap_path: gsapPath,
    font_paths: fontPaths,
    blockers,
  };
}

function commandKey(value) {
  const resolved = existingAbsoluteFile(value);
  if (!resolved) return null;
  return process.platform === "win32"
    ? resolved.toLowerCase()
    : resolved;
}

function safeChildEnvironment(env = process.env) {
  const allowedKeys = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "COMSPEC",
    "ComSpec",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "PROGRAMDATA",
    "ProgramData",
    "LANG",
    "LC_ALL",
  ];
  return {
    ...Object.fromEntries(
      allowedKeys
        .filter((key) => typeof env[key] === "string")
        .map((key) => [key, env[key]]),
    ),
    HYPERFRAMES_NO_TELEMETRY: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    HYPERFRAMES_NO_AUTO_INSTALL: "1",
    DO_NOT_TRACK: "1",
  };
}

function createGovernedProcessRunner({
  allowedCommands = [],
  env = process.env,
  maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES,
} = {}) {
  const allowlist = new Set(
    allowedCommands.map(commandKey).filter(Boolean),
  );
  const outputLimit =
    Number.isSafeInteger(Number(maxOutputBytes)) &&
    Number(maxOutputBytes) > 0 &&
    Number(maxOutputBytes) <= 16 * 1024 * 1024
      ? Number(maxOutputBytes)
      : MAX_PROCESS_OUTPUT_BYTES;
  const childEnvironment = safeChildEnvironment(env);

  return async function governedProcessRunner({
    command,
    args = [],
    cwd,
    timeout_ms: timeoutMs = 120_000,
  } = {}) {
    const resolvedCommand = existingAbsoluteFile(command);
    const key = commandKey(resolvedCommand);
    if (!key || !allowlist.has(key)) {
      throw new Error("process_command_not_allowlisted");
    }
    if (!Array.isArray(args) || args.length > 512) {
      throw new Error("process_arguments_invalid");
    }
    const exactArgs = args.map((value) => String(value));
    if (
      exactArgs.some(
        (value) => value.includes("\0") || value.length > 32_768,
      )
    ) {
      throw new Error("process_arguments_invalid");
    }
    const resolvedCwd = path.resolve(text(cwd || process.cwd()));
    try {
      if (!fs.statSync(resolvedCwd).isDirectory()) {
        throw new Error("not_directory");
      }
    } catch {
      throw new Error("process_working_directory_invalid");
    }
    const exactTimeout = Number(timeoutMs);
    if (
      !Number.isSafeInteger(exactTimeout) ||
      exactTimeout < 1_000 ||
      exactTimeout > MAX_PROCESS_TIMEOUT_MS
    ) {
      throw new Error("process_timeout_invalid");
    }

    return new Promise((resolve, reject) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let finished = false;
      const child = spawn(resolvedCommand, exactArgs, {
        cwd: resolvedCwd,
        env: childEnvironment,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const finish = (callback) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        callback();
      };
      const collect = (current, chunk) => {
        const next = Buffer.concat([current, Buffer.from(chunk)]);
        if (next.length > outputLimit) {
          child.kill("SIGKILL");
          finish(() => reject(new Error("process_output_limit_exceeded")));
          return current;
        }
        return next;
      };
      child.stdout.on("data", (chunk) => {
        stdout = collect(stdout, chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr = collect(stderr, chunk);
      });
      child.on("error", () => {
        finish(() => reject(new Error("process_spawn_failed")));
      });
      child.on("close", (code, signal) => {
        finish(() =>
          resolve({
            status: Number.isInteger(code) ? code : 1,
            signal: signal || null,
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
          }),
        );
      });
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new Error("process_timeout_exceeded")));
      }, exactTimeout);
      timeout.unref?.();
    });
  };
}

function createGovernedElevenLabsHttpClient({
  axiosInstance,
  baseUrl = "https://api.elevenlabs.io",
} = {}) {
  const exactProviderOrigin = "https://api.elevenlabs.io";
  const client = axiosInstance || require("axios");
  const request =
    typeof client === "function"
      ? client
      : typeof client?.request === "function"
        ? client.request.bind(client)
        : null;
  if (!request) throw new Error("axios_http_client_required");
  const base = new URL(text(baseUrl));
  assertSafeOutboundUrl(base.href);
  if (
    base.origin !== exactProviderOrigin ||
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.port ||
    base.pathname.replace(/\/+$/, "") !== "" ||
    base.search ||
    base.hash
  ) {
    throw new Error("elevenlabs_base_url_invalid");
  }
  return async function governedElevenLabsRequest(input = {}) {
    const target = new URL(text(input.url));
    assertSafeOutboundUrl(target.href);
    if (
      target.origin !== base.origin ||
      target.protocol !== "https:" ||
      target.username ||
      target.password
    ) {
      throw new Error("elevenlabs_request_origin_forbidden");
    }
    const method = text(input.method).toUpperCase();
    const isSubscriptionRead =
      method === "GET" &&
      target.pathname === "/v1/user/subscription" &&
      !target.search;
    const isTtsWrite =
      method === "POST" &&
      /^\/v1\/text-to-speech\/[^/]+\/with-timestamps$/.test(
        target.pathname,
      );
    if (!isSubscriptionRead && !isTtsWrite) {
      throw new Error("elevenlabs_request_method_forbidden");
    }
    return request({
      ...input,
      url: target.href,
      method,
      maxBodyLength: 2 * 1024 * 1024,
      maxContentLength: isSubscriptionRead
        ? 2 * 1024 * 1024
        : 64 * 1024 * 1024,
      validateStatus: () => true,
      ...safeRedirectConfig(0),
    });
  };
}

function buildWeeklyLongformRuntimeStack(options = {}) {
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
  const allowedCommands = [
    process.execPath,
    executablePaths.ffmpeg_path,
    executablePaths.ffprobe_path,
  ].filter(Boolean);
  const processRunner =
    options.processRunner ||
    createGovernedProcessRunner({
      allowedCommands,
      env,
    });
  let httpClient = options.httpClient || null;
  const hasElevenLabsCredentials =
    Boolean(text(env.ELEVENLABS_API_KEY)) &&
    Boolean(text(env.ELEVENLABS_VOICE_ID));
  if (!httpClient && hasElevenLabsCredentials) {
    try {
      httpClient = createGovernedElevenLabsHttpClient({
        axiosInstance: options.axiosInstance,
        baseUrl:
          text(env.ELEVENLABS_BASE_URL) ||
          "https://api.elevenlabs.io",
      });
    } catch {
      httpClient = null;
    }
  }

  const rendererFactory =
    options.rendererFactory ||
    require("./weekly-longform-hyperframes-renderer")
      .createGovernedWeeklyLongformHyperframesRenderer;
  let rendererStack;
  if (typeof options.renderLongform === "function") {
    rendererStack = {
      capabilities:
        options.rendererCapabilities || {
          schema_version:
            "pulse-weekly-longform-injected-renderer-capabilities-v1",
          ready: true,
          blockers: [],
          safety: {
            external_network_authority: false,
            upload_authority: false,
            database_mutation_authority: false,
            oauth_mutation_authority: false,
          },
        },
      renderLongform: options.renderLongform,
    };
  } else {
    rendererStack = rendererFactory({
      command: process.execPath,
      command_args_prefix: hyperframesRuntime.cli_path
        ? [hyperframesRuntime.cli_path]
        : [],
      hyperframes_cli_path: hyperframesRuntime.cli_path,
      hyperframes_version: hyperframesRuntime.version,
      gsap_source_path: hyperframesRuntime.gsap_path,
      font_source_paths: hyperframesRuntime.font_paths,
      process_runner: processRunner,
    });
  }

  const runtimeFactory =
    options.runtimeFactory ||
    require("./weekly-longform-runtime-dependencies")
      .createWeeklyLongformRuntimeDependencies;
  const runtime = runtimeFactory({
    env,
    httpClient,
    creditGovernor: options.creditGovernor,
    ffmpegPath: executablePaths.ffmpeg_path,
    ffprobePath: executablePaths.ffprobe_path,
    processRunner,
    renderLongform: rendererStack.renderLongform,
  });
  const adapterFactory =
    options.adapterFactory ||
    require("./weekly-longform-production-adapters")
      .createWeeklyLongformProductionAdapters;
  const adapterStack = adapterFactory(runtime.dependencies);
  const materializeDerivatives =
    typeof options.materializeDerivatives === "function"
      ? options.materializeDerivatives
      : runtime.dependencies.materializeDerivatives || null;
  const blockers = unique([
    ...(executablePaths.blockers || []),
    ...(hyperframesRuntime.blockers || []),
    ...(rendererStack.capabilities?.blockers || []),
    ...(runtime.capabilities?.blockers || []),
    ...(adapterStack.capabilities?.blockers || []),
  ]);
  const ready =
    blockers.length === 0 &&
    rendererStack.capabilities?.ready === true &&
    runtime.capabilities?.ready === true &&
    adapterStack.capabilities?.ready === true;
  return {
    capabilities: {
      schema_version: STACK_SCHEMA,
      ready,
      blockers,
      media_executables: {
        ffmpeg: {
          available: Boolean(executablePaths.ffmpeg_path),
          path: executablePaths.ffmpeg_path || null,
          resolution:
            executablePaths.resolution?.ffmpeg || "unavailable",
        },
        ffprobe: {
          available: Boolean(executablePaths.ffprobe_path),
          path: executablePaths.ffprobe_path || null,
          resolution:
            executablePaths.resolution?.ffprobe || "unavailable",
        },
      },
      hyperframes: {
        cli_path: hyperframesRuntime.cli_path || null,
        version: hyperframesRuntime.version || null,
        gsap_path: hyperframesRuntime.gsap_path || null,
        font_paths: hyperframesRuntime.font_paths || {},
      },
      safety: {
        external_publish_authority: false,
        database_mutation_authority: false,
        oauth_mutation_authority: false,
        process_commands_allowlisted: true,
        provider_network_origin_pinned: true,
      },
    },
    runtime_capabilities: runtime.capabilities,
    renderer_capabilities: rendererStack.capabilities,
    adapter_capabilities: adapterStack.capabilities,
    adapters: ready ? adapterStack.adapters : {},
    materializeDerivatives:
      ready && typeof materializeDerivatives === "function"
        ? materializeDerivatives
        : null,
  };
}

module.exports = {
  STACK_SCHEMA,
  buildWeeklyLongformRuntimeStack,
  createGovernedElevenLabsHttpClient,
  createGovernedProcessRunner,
  resolveHyperframesRuntime,
  resolveMediaExecutablePaths,
};
