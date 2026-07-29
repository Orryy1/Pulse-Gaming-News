"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  buildWeeklyLongformRuntimeStack,
  createGovernedElevenLabsHttpClient,
  createGovernedProcessRunner,
  resolveMediaExecutablePaths,
} = require("../../lib/services/weekly-longform-runtime-factory");

function temporaryRuntime(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-weekly-runtime-factory-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executableName = (name) =>
    process.platform === "win32" ? `${name}.exe` : name;
  const files = {
    ffmpeg: path.join(root, executableName("ffmpeg")),
    ffprobe: path.join(root, executableName("ffprobe")),
    cli: path.join(root, "hyperframes-cli.js"),
    gsap: path.join(root, "gsap.min.js"),
    sansRegular: path.join(root, "sans-regular.woff2"),
    sansBold: path.join(root, "sans-bold.woff2"),
    monoRegular: path.join(root, "mono-regular.woff2"),
    monoBold: path.join(root, "mono-bold.woff2"),
    display: path.join(root, "display.woff2"),
  };
  for (const filePath of Object.values(files)) {
    fs.writeFileSync(filePath, "fixture", "utf8");
  }
  return { root, files };
}

test("media binaries resolve to exact absolute files from a bounded PATH search", (t) => {
  const runtime = temporaryRuntime(t);
  const resolved = resolveMediaExecutablePaths({
    env: {
      PATH: runtime.root,
    },
    platform: process.platform,
  });

  assert.equal(resolved.ffmpeg_path, runtime.files.ffmpeg);
  assert.equal(resolved.ffprobe_path, runtime.files.ffprobe);
  assert.deepEqual(resolved.blockers, []);
  assert.equal(resolved.resolution.ffmpeg, "path_search");
  assert.equal(resolved.resolution.ffprobe, "path_search");
});

test("an invalid explicitly configured media binary fails closed instead of silently falling back", (t) => {
  const runtime = temporaryRuntime(t);
  const resolved = resolveMediaExecutablePaths({
    env: {
      PATH: runtime.root,
      PULSE_FFMPEG_PATH: path.join(runtime.root, "missing-ffmpeg"),
    },
    platform: process.platform,
  });

  assert.equal(resolved.ffmpeg_path, null);
  assert.equal(resolved.ffprobe_path, runtime.files.ffprobe);
  assert.ok(resolved.blockers.includes("configured_ffmpeg_path_invalid"));
});

test("the default runtime stack reports concrete missing capabilities and grants no publishing authority", () => {
  const stack = buildWeeklyLongformRuntimeStack({
    env: {},
    executablePaths: {
      ffmpeg_path: null,
      ffprobe_path: null,
      blockers: [
        "ffmpeg_binary_unavailable",
        "ffprobe_binary_unavailable",
      ],
      resolution: {
        ffmpeg: "unavailable",
        ffprobe: "unavailable",
      },
    },
    hyperframesRuntime: {
      cli_path: null,
      version: null,
      gsap_path: null,
      blockers: [
        "hyperframes_cli_unavailable",
        "gsap_runtime_unavailable",
      ],
    },
  });

  assert.equal(
    stack.capabilities.schema_version,
    "pulse-weekly-longform-runtime-stack-v1",
  );
  assert.equal(stack.capabilities.ready, false);
  assert.ok(
    stack.capabilities.blockers.includes(
      "elevenlabs_api_key_unavailable",
    ),
  );
  assert.ok(
    stack.capabilities.blockers.includes(
      "verified_render_longform_dependency_unavailable",
    ),
  );
  assert.deepEqual(stack.capabilities.safety, {
    external_publish_authority: false,
    database_mutation_authority: false,
    oauth_mutation_authority: false,
    process_commands_allowlisted: true,
    provider_network_origin_pinned: true,
  });
  assert.deepEqual(stack.adapters, {});
});

test("a fully supplied runtime builds all five production adapters without executing them", (t) => {
  const runtime = temporaryRuntime(t);
  const processRunner = async () => ({
    status: 0,
    stdout: "",
    stderr: "",
  });
  const stack = buildWeeklyLongformRuntimeStack({
    env: {
      ELEVENLABS_API_KEY: "fixture-secret",
      ELEVENLABS_VOICE_ID: "fixture-voice",
      PULSE_STATE_ROOT: path.join(runtime.root, "state"),
    },
    executablePaths: {
      ffmpeg_path: runtime.files.ffmpeg,
      ffprobe_path: runtime.files.ffprobe,
      blockers: [],
      resolution: {
        ffmpeg: "injected",
        ffprobe: "injected",
      },
    },
    hyperframesRuntime: {
      cli_path: runtime.files.cli,
      version: "0.7.77",
      gsap_path: runtime.files.gsap,
      font_paths: {
        sans_regular: runtime.files.sansRegular,
        sans_bold: runtime.files.sansBold,
        mono_regular: runtime.files.monoRegular,
        mono_bold: runtime.files.monoBold,
        display: runtime.files.display,
      },
      blockers: [],
    },
    processRunner,
    httpClient: async () => {
      throw new Error("must_not_execute_during_factory_build");
    },
  });

  assert.equal(stack.capabilities.ready, true);
  assert.deepEqual(stack.capabilities.blockers, []);
  assert.deepEqual(
    Object.keys(stack.adapters).sort(),
    ["alignment", "decodedQa", "narration", "render", "variants"],
  );
  assert.equal(typeof stack.materializeDerivatives, "function");
  assert.equal(
    stack.runtime_capabilities.safety.upload_authority,
    false,
  );
  assert.equal(
    stack.renderer_capabilities.safety.upload_authority,
    false,
  );
});

test("the governed process runner executes only exact allowlisted binaries without a shell", async () => {
  const runner = createGovernedProcessRunner({
    allowedCommands: [process.execPath],
  });
  const result = await runner({
    command: process.execPath,
    args: ["-e", "process.stdout.write('pulse-ok')"],
    cwd: process.cwd(),
    timeout_ms: 10_000,
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "pulse-ok");
  await assert.rejects(
    () =>
      runner({
        command: path.join(os.tmpdir(), "not-allowlisted"),
        args: [],
        cwd: process.cwd(),
        timeout_ms: 10_000,
      }),
    /process_command_not_allowlisted/,
  );
});

test("the governed process runner disables HyperFrames telemetry, updates and auto-install in every child", async () => {
  const runner = createGovernedProcessRunner({
    allowedCommands: [process.execPath],
    env: {
      ...process.env,
      HYPERFRAMES_NO_TELEMETRY: "0",
      HYPERFRAMES_NO_UPDATE_CHECK: "0",
      HYPERFRAMES_NO_AUTO_INSTALL: "0",
      DO_NOT_TRACK: "0",
    },
  });
  const result = await runner({
    command: process.execPath,
    args: [
      "-e",
      [
        "process.stdout.write(JSON.stringify({",
        "telemetry: process.env.HYPERFRAMES_NO_TELEMETRY,",
        "updates: process.env.HYPERFRAMES_NO_UPDATE_CHECK,",
        "install: process.env.HYPERFRAMES_NO_AUTO_INSTALL,",
        "tracking: process.env.DO_NOT_TRACK",
        "}))",
      ].join(""),
    ],
    cwd: process.cwd(),
    timeout_ms: 10_000,
  });

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    telemetry: "1",
    updates: "1",
    install: "1",
    tracking: "1",
  });
});

test("the governed ElevenLabs client pins the provider origin and cannot have its redirect guard overridden", async () => {
  const calls = [];
  const client = createGovernedElevenLabsHttpClient({
    axiosInstance: async (options) => {
      calls.push(options);
      return { status: 200, data: {} };
    },
  });

  await client({
    method: "POST",
    url: "https://api.elevenlabs.io/v1/text-to-speech/voice/with-timestamps",
    ["maxRedirects"]: 5,
    beforeRedirect() {
      throw new Error("untrusted_redirect_hook_must_not_win");
    },
  });
  await client({
    method: "GET",
    url: "https://api.elevenlabs.io/v1/user/subscription",
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].maxRedirects, 0);
  assert.equal(calls[1].method, "GET");
  assert.equal(calls[1].maxContentLength, 2 * 1024 * 1024);
  assert.equal(typeof calls[0].beforeRedirect, "function");
  assert.throws(
    () =>
      calls[0].beforeRedirect({
        protocol: "http:",
        hostname: "169.254.169.254",
        path: "/latest/meta-data/",
      }),
    /ipv4_private_or_reserved/,
  );
  await assert.rejects(
    () =>
      client({
        method: "POST",
        url: "https://example.com/collect",
      }),
    /elevenlabs_request_origin_forbidden/,
  );
  await assert.rejects(
    () =>
      client({
        method: "GET",
        url: "https://api.elevenlabs.io/v1/user",
      }),
    /elevenlabs_request_method_forbidden/,
  );
  assert.equal(calls.length, 2);
});

test("the governed ElevenLabs client rejects unsafe configured origins before transport exists", () => {
  let called = false;
  assert.throws(
    () =>
      createGovernedElevenLabsHttpClient({
        baseUrl: "https://127.0.0.1",
        axiosInstance: async () => {
          called = true;
        },
      }),
    /ipv4_private_or_reserved/,
  );
  assert.throws(
    () =>
      createGovernedElevenLabsHttpClient({
        baseUrl: "https://collector.example",
        axiosInstance: async () => {
          called = true;
        },
      }),
    /elevenlabs_base_url_invalid/,
  );
  assert.equal(called, false);
});
