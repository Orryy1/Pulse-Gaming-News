"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  createGovernedProcessRunner,
  resolveMediaExecutablePaths,
} = require("./weekly-longform-runtime-factory");
const {
  classifyPlatformVideoQa,
} = require("./platform-video-qa");
const {
  AUDIT_SCHEMA,
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  getPlatformSafeZoneProfile,
  validatePlatformSafeZoneAudit,
} = require("./platform-safe-zones");

const CAPABILITIES_SCHEMA =
  "pulse-evergreen-production-runtime-capabilities-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normaliseSha256(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeStem(value) {
  const stem = text(value)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  if (!stem) throw new Error("evergreen_runtime_story_id_invalid");
  return stem;
}

function isSecretPath(filePath) {
  const resolved = path.resolve(filePath);
  const parts = resolved
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
  const basename = path.basename(resolved).toLowerCase();
  return (
    parts.includes("tokens") ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    /(?:credential|oauth|access[_-]?token|client[_-]?secret)/i.test(
      basename,
    )
  );
}

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
]);

async function writeContentAddressedAsset({
  bytes,
  sha256,
  extension,
  outputDir,
}) {
  const assetDir = path.join(path.resolve(outputDir), "exact-subject-assets");
  await fsp.mkdir(assetDir, { recursive: true });
  const destination = path.join(assetDir, `${sha256}${extension}`);
  try {
    const existing = await fsp.readFile(destination);
    if (sha256Bytes(existing) !== sha256) {
      throw new Error("evergreen_staged_asset_hash_mismatch");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temporary, bytes, { flag: "wx" });
      await fsp.rename(temporary, destination);
    } catch (writeError) {
      await fsp.rm(temporary, { force: true });
      throw writeError;
    }
  }
  return destination;
}

async function stageExactSubjectAssets({
  rightsLedger,
  beats,
  outputDir,
}) {
  const items = Array.isArray(rightsLedger?.items)
    ? rightsLedger.items
    : [];
  const byId = new Map(
    items.map((item) => [text(item?.item_id), item]),
  );
  const stagedById = new Map();
  for (const beat of beats) {
    const assetId = text(beat.asset_id);
    const item = byId.get(assetId);
    if (
      !assetId ||
      !item ||
      item.included_in_final !== true ||
      text(item.rights_decision).toUpperCase() !== "CLEARED"
    ) {
      const error = new Error(
        "evergreen_exact_subject_asset_not_cleared",
      );
      error.code = "evergreen_exact_subject_asset_not_cleared";
      throw error;
    }
    if (stagedById.has(assetId)) continue;
    const sourcePath = text(
      item.materialised_path ||
        item.local_path ||
        item.asset_path ||
        item.path,
    );
    const expectedSha256 = normaliseSha256(item.asset_sha256);
    if (!sourcePath || !expectedSha256) {
      const error = new Error(
        "evergreen_exact_subject_asset_materialisation_required",
      );
      error.code =
        "evergreen_exact_subject_asset_materialisation_required";
      throw error;
    }
    const resolvedPath = path.resolve(sourcePath);
    if (isSecretPath(resolvedPath)) {
      const error = new Error(
        "evergreen_exact_subject_asset_secret_path_forbidden",
      );
      error.code =
        "evergreen_exact_subject_asset_secret_path_forbidden";
      throw error;
    }
    const extension = path.extname(resolvedPath).toLowerCase();
    const mediaType = IMAGE_EXTENSIONS.has(extension)
      ? "image"
      : VIDEO_EXTENSIONS.has(extension)
        ? "video"
        : null;
    if (!mediaType) {
      const error = new Error(
        "evergreen_exact_subject_asset_media_type_unsupported",
      );
      error.code =
        "evergreen_exact_subject_asset_media_type_unsupported";
      throw error;
    }
    let before;
    let after;
    let bytes;
    try {
      before = await fsp.lstat(resolvedPath, { bigint: true });
      if (before.isSymbolicLink() || !before.isFile()) {
        throw new Error("unsafe_file");
      }
      bytes = await fsp.readFile(resolvedPath);
      after = await fsp.lstat(resolvedPath, { bigint: true });
    } catch {
      const error = new Error(
        "evergreen_exact_subject_asset_read_failed",
      );
      error.code = "evergreen_exact_subject_asset_read_failed";
      throw error;
    }
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      Number(after.size) !== bytes.length
    ) {
      const error = new Error(
        "evergreen_exact_subject_asset_changed_during_read",
      );
      error.code =
        "evergreen_exact_subject_asset_changed_during_read";
      throw error;
    }
    const observedSha256 = sha256Bytes(bytes);
    if (observedSha256 !== expectedSha256) {
      const error = new Error(
        "evergreen_exact_subject_asset_sha256_mismatch",
      );
      error.code =
        "evergreen_exact_subject_asset_sha256_mismatch";
      throw error;
    }
    const stagedPath = await writeContentAddressedAsset({
      bytes,
      sha256: observedSha256,
      extension,
      outputDir,
    });
    stagedById.set(assetId, {
      asset_id: assetId,
      path: stagedPath,
      sha256: observedSha256,
      byte_length: bytes.length,
      media_type: mediaType,
      rights_decision: "CLEARED",
      source_url: text(item.source_url) || null,
    });
  }
  return {
    assets: [...stagedById.values()],
    byId: stagedById,
  };
}

function wrapWords(value, maxCharacters = 14) {
  const words = text(value)
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxCharacters) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function sceneSafeZoneContract(storyId) {
  const profile = getPlatformSafeZoneProfile(
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  );
  const layout = {
    kicker: { x: 120, y: 280, width: 600, height: 64 },
    headline: { x: 120, y: 500, width: 660, height: 420 },
    brand: { x: 120, y: 1132, width: 660, height: 48 },
    progress: { x: 120, y: 1248, width: 660, height: 16 },
    counter: { x: 120, y: 1292, width: 180, height: 44 },
  };
  const audit = {
    schema_version: AUDIT_SCHEMA,
    profile_id: profile.id,
    canvas: profile.canvas,
    safe_rect: profile.safe_rect,
    covered_surfaces: profile.covered_surfaces,
    story_id: text(storyId),
    lane_id: "evergreen_short",
    elements: [
      {
        id: "kicker",
        selector: "#kicker",
        role: "context_label",
        bbox: layout.kicker,
      },
      {
        id: "headline",
        selector: "#headline",
        role: "headline",
        bbox: layout.headline,
      },
      {
        id: "brand",
        selector: "#brand",
        role: "brand_label",
        bbox: layout.brand,
      },
      {
        id: "progress",
        selector: "#progress",
        role: "scene_progress",
        bbox: layout.progress,
      },
      {
        id: "counter",
        selector: "#counter",
        role: "scene_counter",
        bbox: layout.counter,
      },
    ],
    decorative_exemptions: [
      {
        id: "full-bleed-shade",
        selector: "#full-bleed-shade",
        carries_meaning: false,
        rationale:
          "Decorative contrast gradient carries no editorial meaning.",
      },
      {
        id: "outer-frame",
        selector: "#outer-frame",
        carries_meaning: false,
        rationale:
          "Decorative hairline frame carries no editorial meaning.",
      },
      {
        id: "accent-rule",
        selector: "#accent-rule",
        carries_meaning: false,
        rationale:
          "Decorative Pulse accent carries no editorial meaning.",
      },
    ],
  };
  const validation = validatePlatformSafeZoneAudit({ audit });
  return { profile, layout, audit, validation };
}

function sceneSvg({
  heading,
  kicker,
  sceneNumber,
  sceneCount,
  layout,
}) {
  const lines = wrapWords(heading);
  const firstY =
    layout.headline.y +
    92 +
    Math.max(0, 4 - lines.length) * 35;
  const lineMarkup = lines
    .map(
      (line, index) =>
        `<tspan x="${layout.headline.x}" dy="${index === 0 ? 0 : 88}">` +
        `${xmlEscape(line)}</tspan>`,
    )
    .join("");
  const progress = Math.round(
    (Math.max(1, sceneNumber) / Math.max(1, sceneCount)) *
      layout.progress.width,
  );
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">` +
      `<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#02050a" stop-opacity=".42"/>` +
      `<stop offset=".38" stop-color="#02050a" stop-opacity=".04"/>` +
      `<stop offset=".68" stop-color="#02050a" stop-opacity=".18"/>` +
      `<stop offset="1" stop-color="#02050a" stop-opacity=".82"/></linearGradient></defs>` +
      `<rect id="full-bleed-shade" width="1080" height="1920" fill="url(#shade)"/>` +
      `<rect id="outer-frame" x="72" y="180" width="936" height="1560" rx="42" fill="none" stroke="#ffffff" stroke-opacity=".15" stroke-width="2"/>` +
      `<rect id="accent-rule" x="72" y="180" width="9" height="1560" rx="5" fill="#ff6b1a"/>` +
      `<g id="kicker">` +
      `<rect x="${layout.kicker.x}" y="${layout.kicker.y}" width="${layout.kicker.width}" height="${layout.kicker.height}" rx="32" fill="#ff6b1a"/>` +
      `<text x="${layout.kicker.x + 30}" y="${layout.kicker.y + 44}" font-family="Arial, sans-serif" font-size="28" ` +
      `font-weight="700" fill="#101010">${xmlEscape(kicker)}</text>` +
      `</g>` +
      `<text id="headline" x="${layout.headline.x}" y="${firstY}" ` +
      `font-family="Arial, sans-serif" font-size="68" ` +
      `font-weight="800" fill="#ffffff">` +
      lineMarkup +
      `</text>` +
      `<text id="brand" x="${layout.brand.x}" y="${layout.brand.y + 36}" font-family="Arial, sans-serif" font-size="28" ` +
      `font-weight="700" letter-spacing="6" fill="#ff9a5c">PULSE GAMING - VERDICT</text>` +
      `<g id="progress">` +
      `<rect x="${layout.progress.x}" y="${layout.progress.y}" width="${layout.progress.width}" height="${layout.progress.height}" rx="8" fill="#ffffff" opacity=".18"/>` +
      `<rect x="${layout.progress.x}" y="${layout.progress.y}" width="${progress}" height="${layout.progress.height}" rx="8" fill="#ff6b1a"/>` +
      `</g>` +
      `<text id="counter" x="${layout.counter.x}" y="${layout.counter.y + 32}" font-family="Arial, sans-serif" font-size="26" fill="#ffffff" opacity=".72">` +
      `${String(sceneNumber).padStart(2, "0")} / ${String(sceneCount).padStart(2, "0")}</text>` +
      `</svg>`,
    "utf8",
  );
}

function exactBeatPlan(workOrder) {
  const beats =
    workOrder?.evergreen_governance?.work_order?.visual_beat_plan
      ?.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error("evergreen_runtime_visual_beat_plan_required");
  }
  return beats.map((beat, index) => {
    const start = Number(beat?.start_seconds);
    const end = Number(beat?.end_seconds);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      throw new Error("evergreen_runtime_visual_beat_timing_invalid");
    }
    return {
      id: text(beat?.id) || `beat-${index + 1}`,
      heading: text(
        beat?.meaningful_overlay?.text ||
          beat?.overlay_text ||
          beat?.section,
      ),
      section: text(beat?.section).toUpperCase() || "VERDICT",
      asset_id: text(
        beat?.background?.asset_id || beat?.asset_id,
      ),
      start,
      end,
      duration: Number((end - start).toFixed(3)),
    };
  });
}

async function defaultNarrationDependency(input) {
  const outputPath = path.join(
    path.resolve(input.output_dir),
    `${safeStem(input.story_id)}-narration.mp3`,
  );
  const generateTTS = require("../../audio").generateTTS;
  await generateTTS(input.script.text, outputPath);
  const bytes = await fsp.readFile(outputPath);
  return {
    path: outputPath,
    sha256: sha256Bytes(bytes),
    byte_length: bytes.length,
    provider: text(process.env.TTS_PROVIDER || "elevenlabs"),
    network_used: true,
  };
}

async function defaultRenderDependency({
  processRunner,
  ffmpegPath,
  input,
}) {
  const outputDir = path.resolve(input.output_dir);
  const overlayDir = path.join(outputDir, "safe-zone-overlays");
  await fsp.mkdir(overlayDir, { recursive: true });
  const sharp = require("sharp");
  const beats = exactBeatPlan(input.work_order);
  const staged = await stageExactSubjectAssets({
    rightsLedger: input.rights_ledger?.value,
    beats,
    outputDir,
  });
  const safeZone = sceneSafeZoneContract(input.story_id);
  const safeZoneAuditValue = {
    ...safeZone.audit,
    generated_at: input.generated_at,
    verdict: safeZone.validation.verdict,
    validation: safeZone.validation,
    authority: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  const safeZoneAuditBytes = Buffer.from(
    `${JSON.stringify(safeZoneAuditValue, null, 2)}\n`,
    "utf8",
  );
  const safeZoneAuditPath = path.join(
    outputDir,
    "platform-safe-zone-audit.json",
  );
  await fsp.writeFile(safeZoneAuditPath, safeZoneAuditBytes);
  const overlayPaths = [];
  for (const [index, beat] of beats.entries()) {
    const overlayPath = path.join(
      overlayDir,
      `${String(index + 1).padStart(2, "0")}-${safeStem(beat.id)}.png`,
    );
    await sharp(
      sceneSvg({
        heading: beat.heading,
        kicker: beat.section,
        sceneNumber: index + 1,
        sceneCount: beats.length,
        layout: safeZone.layout,
      }),
    )
      .png()
      .toFile(overlayPath);
    overlayPaths.push(overlayPath);
  }
  const outputPath = path.join(
    outputDir,
    `${safeStem(input.story_id)}-evergreen-master.mp4`,
  );
  const args = ["-y"];
  for (const [index, overlayPath] of overlayPaths.entries()) {
    const subject = staged.byId.get(beats[index].asset_id);
    if (subject.media_type === "image") {
      args.push(
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        String(beats[index].duration),
        "-i",
        subject.path,
      );
    } else {
      args.push(
        "-stream_loop",
        "-1",
        "-t",
        String(beats[index].duration),
        "-i",
        subject.path,
      );
    }
    args.push(
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      String(beats[index].duration),
      "-i",
      overlayPath,
    );
  }
  args.push("-i", input.narration.path);
  const videoFilters = beats.flatMap((beat, index) => {
    const subject = staged.byId.get(beat.asset_id);
    const subjectIndex = index * 2;
    const overlayIndex = subjectIndex + 1;
    const fadeOutAt = Math.max(0, beat.duration - 0.22).toFixed(3);
    const frames = Math.max(1, Math.round(beat.duration * 30));
    const subjectFilter =
      subject.media_type === "image"
        ? `[${subjectIndex}:v]scale=1200:2134:force_original_aspect_ratio=increase,` +
          `crop=1200:2134,zoompan=z='min(zoom+0.00055,1.085)':` +
          `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
          `d=${frames}:s=1080x1920:fps=30,setsar=1[bg${index}]`
        : `[${subjectIndex}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
          `crop=1080:1920,fps=30,trim=duration=${beat.duration},` +
          `setpts=PTS-STARTPTS,setsar=1[bg${index}]`;
    return [
      subjectFilter,
      `[${overlayIndex}:v]scale=1080:1920,format=rgba,` +
        `fade=t=in:st=0:d=0.22:alpha=1,` +
        `fade=t=out:st=${fadeOutAt}:d=0.18:alpha=1[ol${index}]`,
      `[bg${index}][ol${index}]overlay=0:0:shortest=1,` +
        `format=yuv420p,trim=duration=${beat.duration},` +
        `setpts=PTS-STARTPTS[v${index}]`,
    ];
  });
  const videoInputs = beats.map((_, index) => `[v${index}]`).join("");
  const totalDuration = beats[beats.length - 1].end;
  const narrationIndex = beats.length * 2;
  const filterComplex = [
    ...videoFilters,
    `${videoInputs}concat=n=${beats.length}:v=1:a=0[vout]`,
    `[${narrationIndex}:a]apad=pad_dur=${totalDuration},` +
      `atrim=duration=${totalDuration}[aout]`,
  ].join(";");
  args.push(
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "21",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level:v",
    "4.0",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-b:a",
    "192k",
    "-t",
    String(totalDuration),
    "-movflags",
    "+faststart",
    outputPath,
  );
  const execution = await processRunner({
    command: ffmpegPath,
    args,
    cwd: outputDir,
    timeout_ms: 20 * 60 * 1000,
  });
  if (execution?.status !== 0) {
    throw new Error("evergreen_ffmpeg_render_failed");
  }
  const bytes = await fsp.readFile(outputPath);
  return {
    path: outputPath,
    sha256: sha256Bytes(bytes),
    byte_length: bytes.length,
    renderer: "governed_ffmpeg_exact_subject_v1",
    exact_subject_assets: staged.assets,
    safe_zone_audit: {
      path: safeZoneAuditPath,
      sha256: sha256Bytes(safeZoneAuditBytes),
      byte_length: safeZoneAuditBytes.length,
      story_id: input.story_id,
      lane_id: input.lane_id,
      profile_id: safeZone.profile.id,
      verdict: safeZone.validation.verdict,
    },
    composition: {
      background_full_bleed: true,
      video_motion_preserved: true,
      still_motion: "cinematic_slow_push",
      overlay_profile: CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
      text_inside_platform_safe_zone: true,
      cards_replace_subject_media: false,
    },
    network_used: false,
  };
}

async function defaultQaDependency({
  processRunner,
  ffprobePath,
  input,
}) {
  const execution = await processRunner({
    command: ffprobePath,
    args: [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      input.final_media.path,
    ],
    cwd: input.output_dir,
    timeout_ms: 30_000,
  });
  let probe = null;
  try {
    probe = JSON.parse(text(execution?.stdout));
  } catch {
    probe = null;
  }
  const platformQa =
    execution?.status === 0
      ? classifyPlatformVideoQa(probe, {
          platform: "youtube_shorts",
        })
      : {
          result: "fail",
          failures: ["ffprobe_execution_failed"],
          warnings: [],
        };
  const passed =
    ["pass", "warn"].includes(platformQa.result) &&
    !platformQa.failures?.length;
  const qaValue = {
    schema_version: "pulse-evergreen-decoded-qa-v1",
    generated_at: input.generated_at,
    story_id: input.story_id,
    lane_id: input.lane_id,
    verdict: passed ? "PASS" : "FAIL",
    passed,
    blockers: passed ? [] : platformQa.failures || ["decoded_qa_failed"],
    warnings: platformQa.warnings || [],
    media_sha256: input.final_media.sha256,
    renderer_manifest_sha256:
      input.renderer_manifest.sha256,
    technical: platformQa.technical || null,
  };
  const outputPath = path.join(
    path.resolve(input.output_dir),
    "decoded-qa.json",
  );
  const bytes = Buffer.from(
    `${JSON.stringify(qaValue, null, 2)}\n`,
    "utf8",
  );
  await fsp.writeFile(outputPath, bytes);
  return {
    path: outputPath,
    sha256: sha256Bytes(bytes),
    byte_length: bytes.length,
    network_used: false,
  };
}

function buildGovernedEvergreenProductionRuntime(options = {}) {
  const env =
    options.env &&
    typeof options.env === "object" &&
    !Array.isArray(options.env)
      ? options.env
      : process.env;
  const dependencies =
    options.dependencies &&
    typeof options.dependencies === "object" &&
    !Array.isArray(options.dependencies)
      ? options.dependencies
      : {};
  const executablePaths =
    options.executablePaths ||
    resolveMediaExecutablePaths({ env });
  const needsDefaultRender =
    typeof dependencies.renderEvergreen !== "function";
  const needsDefaultQa =
    typeof dependencies.runDecodedQa !== "function";
  const needsProcessRuntime = needsDefaultRender || needsDefaultQa;
  const processRunner =
    options.processRunner ||
    (needsProcessRuntime
      ? createGovernedProcessRunner({
          allowedCommands: [
            executablePaths.ffmpeg_path,
            executablePaths.ffprobe_path,
          ].filter(Boolean),
          env,
        })
      : null);
  const provider = text(env.TTS_PROVIDER || "elevenlabs").toLowerCase();
  const defaultNarrationAvailable =
    provider === "local" ||
    Boolean(text(env.ELEVENLABS_API_KEY));
  const blockers = [
    ...(typeof dependencies.produceNarration === "function" ||
    defaultNarrationAvailable
      ? []
      : ["evergreen_narration_runtime_unavailable"]),
    ...(needsDefaultRender && !executablePaths.ffmpeg_path
      ? ["evergreen_ffmpeg_runtime_unavailable"]
      : []),
    ...(needsDefaultQa && !executablePaths.ffprobe_path
      ? ["evergreen_ffprobe_runtime_unavailable"]
      : []),
    ...(needsProcessRuntime && typeof processRunner !== "function"
      ? ["evergreen_process_runner_unavailable"]
      : []),
  ];
  const ready = blockers.length === 0;
  const adapters = ready
    ? {
        materializeNarration: async (input) => {
          const dependency =
            dependencies.produceNarration ||
            defaultNarrationDependency;
          const output = await dependency(input);
          return {
            ...output,
            network_used:
              typeof output?.network_used === "boolean"
                ? output.network_used
                : dependency === defaultNarrationDependency,
          };
        },
        renderEvergreen: async (input) => {
          if (typeof dependencies.renderEvergreen === "function") {
            return dependencies.renderEvergreen(input);
          }
          return defaultRenderDependency({
            processRunner,
            ffmpegPath: executablePaths.ffmpeg_path,
            input,
          });
        },
        runDecodedQa: async (input) => {
          if (typeof dependencies.runDecodedQa === "function") {
            return dependencies.runDecodedQa(input);
          }
          return defaultQaDependency({
            processRunner,
            ffprobePath: executablePaths.ffprobe_path,
            input,
          });
        },
      }
    : {};
  return {
    capabilities: {
      schema_version: CAPABILITIES_SCHEMA,
      ready,
      blockers: unique(blockers),
      dependencies: {
        narration: {
          available:
            typeof dependencies.produceNarration === "function" ||
            defaultNarrationAvailable,
          resolution:
            typeof dependencies.produceNarration === "function"
              ? "injected_provider_dependency"
              : "audio_generate_tts",
        },
        render: {
          available:
            typeof dependencies.renderEvergreen === "function" ||
            Boolean(executablePaths.ffmpeg_path),
          resolution:
            typeof dependencies.renderEvergreen === "function"
              ? "injected_local_renderer_dependency"
              : "governed_ffmpeg_exact_subject_v1",
        },
        decoded_qa: {
          available:
            typeof dependencies.runDecodedQa === "function" ||
            Boolean(executablePaths.ffprobe_path),
          resolution:
            typeof dependencies.runDecodedQa === "function"
              ? "injected_local_qa_dependency"
              : "ffprobe_platform_video_qa",
        },
      },
      safety: {
        external_publish_authority: false,
        database_mutation_authority: false,
        oauth_mutation_authority: false,
        process_commands_allowlisted: true,
      },
    },
    adapters,
  };
}

module.exports = {
  CAPABILITIES_SCHEMA,
  buildGovernedEvergreenProductionRuntime,
  defaultQaDependency,
  defaultRenderDependency,
  sha256Bytes,
};
