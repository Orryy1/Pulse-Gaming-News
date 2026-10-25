"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  parseLoudnormOutput,
  parseTerminalSilenceOutput,
} = require("./governed-final-composite");
const {
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  getAssCaptionSafeZoneContract,
  getPlatformSafeZoneProfile,
} = require("./platform-safe-zones");
const { fitTextLines } = require("./svg-text-layout");

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const MAX_PROGRAMME_ZOOM = 1.06;
const APPROVED_TOWNFALL_STORY_ID = "official_cb7d986c3ad4";
const APPROVED_TOWNFALL_HOOK_HEADLINE =
  "SILENT HILL: TOWNFALL LAUNCHES 24 SEPTEMBER";
const APPROVED_TOWNFALL_FACT_LOCKUPS = Object.freeze([
  Object.freeze({
    role: "verified_change",
    headline: "SCREEN BURN INTERACTIVE CONFIRMS THE GAME",
    supporting:
      "Screen Burn Interactive confirms the game replaces the iconic radio with an active CRTV device.",
    label: "RADIO → CRTV",
  }),
  Object.freeze({
    role: "verified_detail",
    headline: "THIS SHIFT MARKS THE FRANCHISE'S FIRST",
    supporting:
      "This shift marks the franchise's first full-length title using this perspective.",
    label: "FULL-LENGTH / FIRST-PERSON",
  }),
  Object.freeze({
    role: "player_impact",
    headline: APPROVED_TOWNFALL_HOOK_HEADLINE,
    supporting:
      "Silent Hill: Townfall launches 24 September on PlayStation 5 with first-person combat.",
    label: "PLAYSTATION 5 / FIRST-PERSON",
  }),
  Object.freeze({
    role: "source_payoff",
    headline: "SCREEN BURN INTERACTIVE CONFIRMS THE GAME",
    supporting:
      "Screen Burn Interactive confirms the game replaces the iconic radio with an active CRTV device.",
    label: "PLAYSTATION BLOG",
  }),
]);
const PUBLIC_LABEL_FALLBACK = "PULSE UPDATE";
const PUBLIC_LAYOUT_LABELS = Object.freeze({
  BACKBONE: "BREAKING UPDATE",
  COMPARISON: "WHY IT MATTERS",
  GRID: "PLAYER IMPACT",
  IMPACT: "KEY DETAIL",
  OUTRO: "THE TAKEAWAY",
  TIMELINE: "WHAT CHANGED",
  TITLE: "BREAKING UPDATE",
});
const PUBLIC_ROLE_LABELS = Object.freeze({
  hook_slam: "THE HEADLINE",
  owned_motion_backbone: "OFFICIAL UPDATE",
  player_impact: "PLAYER IMPACT",
  source_payoff: "OFFICIAL SOURCE",
  verified_change: "WHAT CHANGED",
  verified_detail: "KEY DETAIL",
});
const PORTRAIT_SAFE_RECT = getPlatformSafeZoneProfile(
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
).safe_rect;
const CAPTION_SAFE_RECT = getAssCaptionSafeZoneContract(
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
).caption_rect;
const AUTHORED_TEXT_LEFT = Math.ceil(
  WIDTH / 2 +
    (PORTRAIT_SAFE_RECT.x - WIDTH / 2) / MAX_PROGRAMME_ZOOM,
) + 2;
const AUTHORED_TEXT_RIGHT = Math.floor(
  WIDTH / 2 +
    (PORTRAIT_SAFE_RECT.x +
      PORTRAIT_SAFE_RECT.width -
      WIDTH / 2) /
      MAX_PROGRAMME_ZOOM,
) - 2;
const AUTHORED_TEXT_WIDTH =
  AUTHORED_TEXT_RIGHT - AUTHORED_TEXT_LEFT;
const AUTHORED_TEXT_TOP = Math.ceil(
  HEIGHT / 2 +
    (PORTRAIT_SAFE_RECT.y - HEIGHT / 2) / MAX_PROGRAMME_ZOOM,
);
const AUTHORED_TEXT_BOTTOM = Math.floor(
  HEIGHT / 2 +
    (PORTRAIT_SAFE_RECT.y +
      PORTRAIT_SAFE_RECT.height -
      HEIGHT / 2) /
      MAX_PROGRAMME_ZOOM,
);
const AUTHORED_CAPTION_TOP = Math.ceil(
  HEIGHT / 2 +
    (CAPTION_SAFE_RECT.y - HEIGHT / 2) / MAX_PROGRAMME_ZOOM,
);
const AUTHORED_CAPTION_BOTTOM = Math.floor(
  HEIGHT / 2 +
    (CAPTION_SAFE_RECT.y +
      CAPTION_SAFE_RECT.height -
      HEIGHT / 2) /
      MAX_PROGRAMME_ZOOM,
);
const APPROVED_DATE_LOCKUP_TOP = AUTHORED_CAPTION_BOTTOM + 24;
const APPROVED_DATE_LOCKUP_BOTTOM = AUTHORED_TEXT_BOTTOM - 10;
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

function svgTextBlock({
  value,
  x,
  baseline,
  align = "start",
  maxWidth = AUTHORED_TEXT_WIDTH,
  maxFontSize,
  minFontSize,
  multilineMaxFontSize = maxFontSize,
  maxLines,
  lineHeight,
  fill,
  fontWeight,
  letterSpacing = 0,
} = {}) {
  const layout = fitTextLines(value, {
    maxWidth,
    maxFontSize,
    minFontSize,
    multilineMaxFontSize,
    maxLines,
    lineHeight,
    letterSpacing,
  });
  const firstBaseline =
    align === "end"
      ? baseline - (layout.lines.length - 1) * layout.lineHeight
      : baseline;
  const tspans = layout.lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : layout.lineHeight}">${xml(
          `${line}${layout.lineSuffixes[index]}`,
        )}</tspan>`,
    )
    .join("");
  return {
    layout,
    svg:
      `<text x="${x}" y="${firstBaseline}" fill="${fill}" ` +
      `font-family="Arial, sans-serif" font-size="${layout.fontSize}" ` +
      `font-weight="${fontWeight}"${letterSpacing ? ` letter-spacing="${letterSpacing}"` : ""} ` +
      `aria-label="${xml(value)}">${tspans}</text>`,
  };
}

function publicLayoutLabel(value) {
  return (
    PUBLIC_LAYOUT_LABELS[text(value).toUpperCase()] ||
    PUBLIC_LABEL_FALLBACK
  );
}

function publicRoleLabel(value) {
  return (
    PUBLIC_ROLE_LABELS[text(value).toLowerCase()] ||
    PUBLIC_LABEL_FALLBACK
  );
}

function approvedHookDateLabel(storyId, role, headline) {
  if (
    storyId !== APPROVED_TOWNFALL_STORY_ID ||
    text(role).toLowerCase() !== "hook_slam" ||
    headline !== APPROVED_TOWNFALL_HOOK_HEADLINE
  ) {
    return null;
  }
  const match = /\b(24) (SEPTEMBER)\b/.exec(headline);
  return match ? `${match[1]} / ${match[2].slice(0, 3)}` : null;
}

function approvedSceneFactLabel(storyId, role, headline, supporting) {
  if (storyId !== APPROVED_TOWNFALL_STORY_ID) {
    return null;
  }
  const exactRole = text(role).toLowerCase();
  return (
    APPROVED_TOWNFALL_FACT_LOCKUPS.find(
      (item) =>
        item.role === exactRole &&
        item.headline === headline &&
        item.supporting === supporting,
    )?.label || null
  );
}

function svgForScene(scene) {
  const design = scene?.design || {};
  const accent = /^#[A-Fa-f0-9]{6}$/.test(text(design.accent_colour))
    ? text(design.accent_colour).toUpperCase()
    : "#FF6B1A";
  const headline = text(design.headline).toUpperCase();
  const supporting = text(design.supporting_text);
  const layout = publicLayoutLabel(design.layout);
  const role = publicRoleLabel(scene?.role);
  const approvedDate = approvedHookDateLabel(
    scene?.story_id,
    scene?.role,
    headline,
  );
  const approvedFact = approvedSceneFactLabel(
    scene?.story_id,
    scene?.role,
    headline,
    supporting,
  );
  const layoutBlock = svgTextBlock({
    value: layout,
    x: AUTHORED_TEXT_LEFT + 94,
    baseline: AUTHORED_TEXT_TOP + 50,
    maxWidth: AUTHORED_TEXT_WIDTH - 94,
    maxFontSize: 30,
    minFontSize: 18,
    maxLines: 1,
    lineHeight: 36,
    fill: accent,
    fontWeight: 700,
    letterSpacing: 5,
  });
  const roleBlock = svgTextBlock({
    value: role,
    x: AUTHORED_TEXT_LEFT,
    baseline: AUTHORED_TEXT_TOP + 96,
    maxFontSize: 20,
    minFontSize: 14,
    maxLines: 1,
    lineHeight: 26,
    fill: "#AAB8C6",
    fontWeight: 700,
    letterSpacing: 3,
  });
  const headlineBlock = svgTextBlock({
    value: headline,
    x: AUTHORED_TEXT_LEFT,
    baseline: 750,
    align: "end",
    maxFontSize: 104,
    minFontSize: 24,
    multilineMaxFontSize: 80,
    maxLines: 4,
    lineHeight: 116,
    fill: "#FFFFFF",
    fontWeight: 900,
  });
  const supportingBlock = svgTextBlock({
    value: supporting,
    x: AUTHORED_TEXT_LEFT,
    baseline: 820,
    maxFontSize: 44,
    minFontSize: 13,
    multilineMaxFontSize: 36,
    maxLines: 4,
    lineHeight: 56,
    fill: "#D8E1EA",
    fontWeight: 500,
  });
  const storyMarkBlock = svgTextBlock({
    value: "PULSE GAMING",
    x: AUTHORED_TEXT_LEFT,
    baseline: AUTHORED_CAPTION_TOP - 40,
    align: "end",
    maxFontSize: 28,
    minFontSize: 12,
    maxLines: 2,
    lineHeight: 38,
    fill: "#AAB8C6",
    fontWeight: 700,
    letterSpacing: 4,
  });
  const approvedDateBlock = approvedDate
    ? svgTextBlock({
        value: approvedDate,
        x: AUTHORED_TEXT_LEFT + 28,
        baseline: APPROVED_DATE_LOCKUP_BOTTOM - 32,
        maxWidth: AUTHORED_TEXT_WIDTH - 56,
        maxFontSize: 88,
        minFontSize: 88,
        maxLines: 1,
        lineHeight: 96,
        fill: "#FFFFFF",
        fontWeight: 900,
        letterSpacing: 8,
      })
    : null;
  const approvedDateLockup = approvedDateBlock
    ? [
        '  <g data-owned-motif="approved-date-lockup">',
        '    <g aria-hidden="true">',
        `      <line x1="${AUTHORED_TEXT_LEFT + 2}" y1="${APPROVED_DATE_LOCKUP_TOP + 2}" x2="${AUTHORED_TEXT_RIGHT - 2}" y2="${APPROVED_DATE_LOCKUP_TOP + 2}" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`,
        `      <line x1="${AUTHORED_TEXT_LEFT + 2}" y1="${APPROVED_DATE_LOCKUP_BOTTOM - 2}" x2="${AUTHORED_TEXT_RIGHT - 2}" y2="${APPROVED_DATE_LOCKUP_BOTTOM - 2}" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`,
        `      <path d="M${AUTHORED_TEXT_LEFT + 2} ${APPROVED_DATE_LOCKUP_TOP + 2}v20 M${AUTHORED_TEXT_RIGHT - 2} ${APPROVED_DATE_LOCKUP_TOP + 2}v20 M${AUTHORED_TEXT_LEFT + 2} ${APPROVED_DATE_LOCKUP_BOTTOM - 22}v20 M${AUTHORED_TEXT_RIGHT - 2} ${APPROVED_DATE_LOCKUP_BOTTOM - 22}v20" fill="none" stroke="${accent}" stroke-width="4"/>`,
        "    </g>",
        `    ${approvedDateBlock.svg}`,
        "  </g>",
      ].join("\n")
    : "";
  const approvedFactBlock = approvedFact
    ? svgTextBlock({
        value: approvedFact,
        x: AUTHORED_TEXT_LEFT + 28,
        baseline: APPROVED_DATE_LOCKUP_BOTTOM - 42,
        maxWidth: AUTHORED_TEXT_WIDTH - 56,
        maxFontSize: 52,
        minFontSize: 28,
        maxLines: 1,
        lineHeight: 60,
        fill: "#FFFFFF",
        fontWeight: 900,
        letterSpacing: 1,
      })
    : null;
  const approvedFactLockup = approvedFactBlock
    ? [
        '  <g data-owned-motif="approved-fact-lockup">',
        '    <g aria-hidden="true">',
        `      <line x1="${AUTHORED_TEXT_LEFT + 2}" y1="${APPROVED_DATE_LOCKUP_TOP + 2}" x2="${AUTHORED_TEXT_RIGHT - 2}" y2="${APPROVED_DATE_LOCKUP_TOP + 2}" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`,
        `      <line x1="${AUTHORED_TEXT_LEFT + 2}" y1="${APPROVED_DATE_LOCKUP_BOTTOM - 2}" x2="${AUTHORED_TEXT_RIGHT - 2}" y2="${APPROVED_DATE_LOCKUP_BOTTOM - 2}" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`,
        `      <path d="M${AUTHORED_TEXT_LEFT + 2} ${APPROVED_DATE_LOCKUP_TOP + 2}v20 M${AUTHORED_TEXT_RIGHT - 2} ${APPROVED_DATE_LOCKUP_TOP + 2}v20 M${AUTHORED_TEXT_LEFT + 2} ${APPROVED_DATE_LOCKUP_BOTTOM - 22}v20 M${AUTHORED_TEXT_RIGHT - 2} ${APPROVED_DATE_LOCKUP_BOTTOM - 22}v20" fill="none" stroke="${accent}" stroke-width="4"/>`,
        "    </g>",
        `    ${approvedFactBlock.svg}`,
        "  </g>",
      ].join("\n")
    : "";
  const dividerY = AUTHORED_CAPTION_TOP - 16;
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
    `  <g aria-hidden="true"><circle data-signal-dot="" cx="${AUTHORED_TEXT_LEFT + 8}" cy="${AUTHORED_TEXT_TOP + 40}" r="6" fill="${accent}"/><line data-signal-rule="" x1="${AUTHORED_TEXT_LEFT + 26}" y1="${AUTHORED_TEXT_TOP + 40}" x2="${AUTHORED_TEXT_LEFT + 72}" y2="${AUTHORED_TEXT_TOP + 40}" stroke="${accent}" stroke-width="4" stroke-linecap="round"/></g>`,
    `  ${layoutBlock.svg}`,
    `  ${roleBlock.svg}`,
    `  ${headlineBlock.svg}`,
    `  ${supportingBlock.svg}`,
    `  ${storyMarkBlock.svg}`,
    `  <line x1="${AUTHORED_TEXT_LEFT}" y1="${dividerY}" x2="${AUTHORED_TEXT_RIGHT}" y2="${dividerY}" stroke="${accent}" stroke-width="5"/>`,
    approvedDateLockup,
    approvedFactLockup,
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
    ffmpegPath,
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
      return {
        duration_seconds: duration,
        codec_name: text(audio.codec_name).toLowerCase(),
        has_audio: true,
      };
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
