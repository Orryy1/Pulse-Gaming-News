"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  assessRightsLedger,
  hashRightsLedger,
} = require("./publication-evidence-gates");
const {
  workOrderFingerprint,
} = require("./weekly-longform-work-order");

const CAPABILITIES_SCHEMA =
  "pulse-weekly-longform-hyperframes-capabilities-v1";
const PROJECT_SCHEMA = "pulse-weekly-longform-hyperframes-project-v1";
const RIGHTS_SCHEMA = "pulse-longform-rights-ledger-v1";
const RESULT_SCHEMA = "pulse-weekly-longform-hyperframes-render-result-v1";
const GENERATOR_ID = "pulse-weekly-longform-hyperframes-renderer-v1";
const MINIMUM_HYPERFRAMES_VERSION = "0.7.76";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{5,127}$/i;
const VISUAL_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".m4v",
  ".mov",
  ".mp4",
  ".png",
  ".webm",
  ".webp",
]);
const VIDEO_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".webm"]);
const PLATFORM_THEMES = Object.freeze({
  xbox: {
    label: "XBOX WATCH",
    accent: "#107c10",
    surface: "#071507",
  },
  playstation: {
    label: "PLAYSTATION WATCH",
    accent: "#2f6fff",
    surface: "#071126",
  },
  nintendo: {
    label: "NINTENDO WATCH",
    accent: "#e60012",
    surface: "#220608",
  },
  steam: {
    label: "PC / STEAM WATCH",
    accent: "#66c0f4",
    surface: "#06131d",
  },
  pulse: {
    label: "PULSE GAMING",
    accent: "#ff6b1a",
    surface: "#170b05",
  },
});
const REQUIRED_FONT_SOURCES = Object.freeze({
  sans_regular: "ibm-plex-sans-regular.woff2",
  sans_bold: "ibm-plex-sans-bold.woff2",
  mono_regular: "ibm-plex-mono-regular.woff2",
  mono_bold: "ibm-plex-mono-bold.woff2",
  display: "bebas-neue-regular.woff2",
});

class WeeklyLongformHyperframesRendererError extends Error {
  constructor(codes) {
    const values = unique(Array.isArray(codes) ? codes : [codes]);
    super(`weekly_longform_hyperframes_renderer_invalid: ${values.join(", ")}`);
    this.name = "WeeklyLongformHyperframesRendererError";
    this.codes = values;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set((values || []).map(text).filter(Boolean))];
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normaliseSha256(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Json(value) {
  return sha256Buffer(Buffer.from(stableJson(value), "utf8"));
}

function contained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function absoluteFile(filePath) {
  return (
    Boolean(text(filePath)) &&
    path.isAbsolute(text(filePath)) &&
    fs.existsSync(text(filePath)) &&
    fs.statSync(text(filePath)).isFile()
  );
}

function parseVersion(value) {
  const match = text(value).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function versionAtLeast(value, minimum) {
  const observed = parseVersion(value);
  const required = parseVersion(minimum);
  if (!observed || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (observed[index] > required[index]) return true;
    if (observed[index] < required[index]) return false;
  }
  return true;
}

function fileSha256Sync(filePath) {
  return absoluteFile(filePath)
    ? sha256Buffer(fs.readFileSync(path.resolve(filePath)))
    : null;
}

function detectedHyperframesVersion(cliPath) {
  if (!absoluteFile(cliPath)) return null;
  const candidates = [
    path.resolve(path.dirname(cliPath), "..", "package.json"),
    path.resolve(path.dirname(cliPath), "package.json"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }
    try {
      const value = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (
        value?.name === "hyperframes" &&
        parseVersion(value?.version)
      ) {
        return text(value.version);
      }
    } catch {
      // A malformed neighbouring package is not version evidence.
    }
  }
  return null;
}

function inspectWeeklyLongformHyperframesCapabilities(options = {}) {
  const blockers = [];
  const cliPath = text(options.hyperframes_cli_path);
  const declaredVersion = text(options.hyperframes_version);
  const detectedVersion = detectedHyperframesVersion(cliPath);
  const version = detectedVersion || declaredVersion;
  const gsapPath = text(options.gsap_source_path);
  const fontSourcePaths =
    options.font_source_paths &&
    typeof options.font_source_paths === "object" &&
    !Array.isArray(options.font_source_paths)
      ? options.font_source_paths
      : {};
  const command = text(options.command) || process.execPath;

  if (!cliPath) {
    blockers.push("hyperframes_cli_path_required");
  } else if (!absoluteFile(cliPath)) {
    blockers.push("hyperframes_cli_path_invalid");
  }
  if (!version) {
    blockers.push("hyperframes_cli_version_required");
  } else if (!versionAtLeast(version, MINIMUM_HYPERFRAMES_VERSION)) {
    blockers.push("hyperframes_cli_check_capability_required");
  }
  if (
    detectedVersion &&
    declaredVersion &&
    detectedVersion !== declaredVersion
  ) {
    blockers.push("hyperframes_cli_version_mismatch");
  }
  if (!gsapPath) {
    blockers.push("gsap_runtime_path_required");
  } else if (!absoluteFile(gsapPath)) {
    blockers.push("gsap_runtime_path_invalid");
  }
  const fontDependencies = {};
  for (const fontId of Object.keys(REQUIRED_FONT_SOURCES)) {
    const fontPath = text(fontSourcePaths[fontId]);
    const available = absoluteFile(fontPath);
    fontDependencies[fontId] = {
      available,
      path: available ? path.resolve(fontPath) : null,
      sha256: fileSha256Sync(fontPath),
    };
    if (!fontPath) {
      blockers.push(`hyperframes_font_${fontId}_path_required`);
    } else if (!available) {
      blockers.push(`hyperframes_font_${fontId}_path_invalid`);
    }
  }
  if (typeof options.process_runner !== "function") {
    blockers.push("hyperframes_process_runner_required");
  }
  if (!absoluteFile(command)) {
    blockers.push("hyperframes_command_path_invalid");
  }
  if (
    options.command_args_prefix !== undefined &&
    !Array.isArray(options.command_args_prefix)
  ) {
    blockers.push("hyperframes_command_args_prefix_invalid");
  }

  const exactBlockers = unique(blockers);
  return {
    schema_version: CAPABILITIES_SCHEMA,
    generator_identity: GENERATOR_ID,
    ready: exactBlockers.length === 0,
    blockers: exactBlockers,
    dependencies: {
      hyperframes_cli: {
        available: absoluteFile(cliPath),
        path: absoluteFile(cliPath) ? path.resolve(cliPath) : null,
        version: version || null,
        declared_version: declaredVersion || null,
        detected_version: detectedVersion,
        sha256: fileSha256Sync(cliPath),
        minimum_version: MINIMUM_HYPERFRAMES_VERSION,
        check_command_required: true,
      },
      gsap_runtime: {
        available: absoluteFile(gsapPath),
        path: absoluteFile(gsapPath) ? path.resolve(gsapPath) : null,
        sha256: fileSha256Sync(gsapPath),
      },
      font_runtime: fontDependencies,
      process_renderer: {
        available: typeof options.process_runner === "function",
        command: absoluteFile(command) ? path.resolve(command) : null,
        injected: typeof options.process_runner === "function",
      },
    },
    output_contract: {
      canvas: { width: 1920, height: 1080 },
      fps: 30,
      container: "mp4",
      quality: "high",
      check_before_render: true,
      strict_render: true,
    },
    safety: {
      external_network_authority: false,
      upload_authority: false,
      database_mutation_authority: false,
      oauth_mutation_authority: false,
      implicit_process_spawn_enabled: false,
    },
  };
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function observeFile({
  filePath,
  expectedSha256,
  prefix,
  allowedRoot = null,
  json = false,
  maximumBytes = null,
}) {
  const blockers = [];
  const resolvedPath = text(filePath) ? path.resolve(filePath) : null;
  const expected = normaliseSha256(expectedSha256);
  if (!resolvedPath) blockers.push(`${prefix}_path_required`);
  if (!expected) blockers.push(`${prefix}_sha256_required`);
  if (resolvedPath && allowedRoot && !contained(allowedRoot, resolvedPath)) {
    blockers.push(`${prefix}_outside_allowed_root`);
  }
  let stat = null;
  if (resolvedPath) {
    try {
      stat = await fsp.stat(resolvedPath);
    } catch {
      blockers.push(`${prefix}_file_missing`);
    }
  }
  if (stat && !stat.isFile()) blockers.push(`${prefix}_file_missing`);
  if (stat && stat.size <= 0) blockers.push(`${prefix}_file_empty`);
  if (
    stat &&
    Number.isFinite(maximumBytes) &&
    maximumBytes > 0 &&
    stat.size > maximumBytes
  ) {
    blockers.push(`${prefix}_file_too_large`);
  }
  if (blockers.length) {
    throw new WeeklyLongformHyperframesRendererError(blockers);
  }
  const observedSha256 = await hashFile(resolvedPath);
  if (observedSha256 !== expected) {
    throw new WeeklyLongformHyperframesRendererError(
      `${prefix}_sha256_mismatch`,
    );
  }
  let bytes = null;
  let value = null;
  if (json) {
    bytes = await fsp.readFile(resolvedPath);
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new WeeklyLongformHyperframesRendererError(
        `${prefix}_json_invalid`,
      );
    }
  }
  return {
    path: resolvedPath,
    sha256: observedSha256,
    byte_length: stat.size,
    bytes,
    value,
  };
}

function validateDate(value, code) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) {
    throw new WeeklyLongformHyperframesRendererError(code);
  }
  return new Date(parsed).toISOString();
}

function normalisedTranscript(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function validateAlignment({
  alignment,
  runId,
  scriptText,
  scriptSha256,
  audioSha256,
}) {
  const blockers = [];
  if (alignment?.schema_version !== "pulse-word-timestamps-v1") {
    blockers.push("alignment_schema_invalid");
  }
  if (text(alignment?.run_id) !== runId) {
    blockers.push("alignment_run_id_mismatch");
  }
  if (normaliseSha256(alignment?.script_sha256) !== scriptSha256) {
    blockers.push("alignment_script_sha256_mismatch");
  }
  if (normaliseSha256(alignment?.audio_sha256) !== audioSha256) {
    blockers.push("alignment_audio_sha256_mismatch");
  }
  if (!normaliseSha256(alignment?.source_alignment_sha256)) {
    blockers.push("alignment_source_sha256_required");
  }
  if (
    text(alignment?.provider).toLowerCase() !== "elevenlabs" ||
    text(alignment?.timing_basis).toLowerCase() !==
      "provider_word_alignment"
  ) {
    blockers.push("provider_word_alignment_required");
  }
  const words = Array.isArray(alignment?.words) ? alignment.words : [];
  if (!words.length) blockers.push("alignment_words_required");
  if (Number(alignment?.word_count) !== words.length) {
    blockers.push("alignment_word_count_mismatch");
  }
  let previousEnd = 0;
  for (const [index, word] of words.entries()) {
    const start = Number(word?.start_seconds);
    const end = Number(word?.end_seconds);
    if (
      !text(word?.text) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      (index > 0 && start < previousEnd)
    ) {
      blockers.push("alignment_word_timing_invalid");
      break;
    }
    previousEnd = end;
  }
  const observedTranscript = words.map((word) => text(word?.text)).join(" ");
  if (normalisedTranscript(observedTranscript) !== normalisedTranscript(scriptText)) {
    blockers.push("alignment_exact_script_mismatch");
  }
  if (previousEnd < 60 || previousEnd > 1800) {
    blockers.push("alignment_duration_outside_longform_bounds");
  }
  if (blockers.length) {
    throw new WeeklyLongformHyperframesRendererError(blockers);
  }
  return {
    words: words.map((word) => ({
      text: text(word.text),
      start_seconds: Number(word.start_seconds),
      end_seconds: Number(word.end_seconds),
    })),
    duration_seconds: Number(previousEnd.toFixed(3)),
  };
}

async function validateInput(input) {
  const blockers = [];
  const runId = text(input?.run_id);
  if (!RUN_ID_PATTERN.test(runId)) blockers.push("render_run_id_invalid");
  const generatedAt = validateDate(
    input?.generated_at,
    "render_generated_at_invalid",
  );
  const outputDir = text(input?.output_dir)
    ? path.resolve(input.output_dir)
    : null;
  if (!outputDir) blockers.push("render_output_dir_required");
  const workOrder = input?.work_order;
  if (
    !workOrder ||
    typeof workOrder !== "object" ||
    Array.isArray(workOrder)
  ) {
    blockers.push("render_work_order_required");
  } else {
    if (
      workOrder.schema_version !==
      "pulse-weekly-longform-work-order-v1"
    ) {
      blockers.push("render_work_order_schema_invalid");
    }
    if (text(workOrder.run_id) !== runId) {
      blockers.push("render_work_order_run_id_mismatch");
    }
    if (
      validateDate(
        workOrder.generated_at,
        "render_work_order_generated_at_invalid",
      ) !== generatedAt
    ) {
      blockers.push("render_work_order_generated_at_mismatch");
    }
    if (workOrder.mode !== "LOCAL_PROOF") {
      blockers.push("render_work_order_local_proof_required");
    }
    if (
      text(workOrder.production_runner_admission?.status).toUpperCase() !==
        "READY" ||
      workOrder.production_runner_admission?.scope !==
        "LOCAL_PROOF_PRODUCTION_RUNNER" ||
      (Array.isArray(workOrder.production_runner_admission?.blockers) &&
        workOrder.production_runner_admission.blockers.length > 0)
    ) {
      blockers.push("render_work_order_production_admission_required");
    }
    if (workOrder.safety?.external_publish_authorised !== false) {
      blockers.push("render_work_order_publish_authority_forbidden");
    }
    const declaredFingerprint = normaliseSha256(
      workOrder.work_order_sha256,
    );
    if (
      !declaredFingerprint ||
      workOrderFingerprint(workOrder) !== declaredFingerprint
    ) {
      blockers.push("render_work_order_fingerprint_invalid");
    }
  }
  if (blockers.length) {
    throw new WeeklyLongformHyperframesRendererError(blockers);
  }

  const runRoot = path.resolve(outputDir, "..", "..");
  const scriptText = String(input?.script_text ?? "");
  const scriptSha256 = normaliseSha256(input?.script_sha256);
  if (!scriptText) blockers.push("render_script_text_required");
  if (
    !scriptSha256 ||
    sha256Buffer(Buffer.from(scriptText, "utf8")) !== scriptSha256
  ) {
    blockers.push("render_script_sha256_mismatch");
  }
  if (
    normaliseSha256(workOrder?.script?.sha256) !== scriptSha256 ||
    String(workOrder?.script?.full_script ?? "") !== scriptText
  ) {
    blockers.push("render_script_work_order_mismatch");
  }
  if (
    stableJson(input?.visual_beat_plan) !==
    stableJson(workOrder?.visual_beat_plan)
  ) {
    blockers.push("visual_beat_plan_work_order_mismatch");
  }
  if (
    stableJson(input?.derivative_plan) !==
    stableJson(workOrder?.derivative_plan)
  ) {
    blockers.push("derivative_plan_work_order_mismatch");
  }
  if (blockers.length) {
    throw new WeeklyLongformHyperframesRendererError(blockers);
  }

  const script = await observeFile({
    filePath: input.script_path,
    expectedSha256: input.script_sha256,
    prefix: "render_script",
    allowedRoot: runRoot,
  });
  if ((await fsp.readFile(script.path, "utf8")) !== scriptText) {
    blockers.push("render_script_file_text_mismatch");
  }
  const audio = await observeFile({
    filePath: input.audio_path,
    expectedSha256: input.audio_sha256,
    prefix: "render_audio",
    allowedRoot: runRoot,
  });
  const alignmentFile = await observeFile({
    filePath: input.alignment_path,
    expectedSha256: input.alignment_sha256,
    prefix: "render_alignment",
    allowedRoot: runRoot,
    json: true,
    maximumBytes: 16 * 1024 * 1024,
  });
  if (stableJson(input.alignment) !== stableJson(alignmentFile.value)) {
    blockers.push("alignment_object_file_mismatch");
  }
  if (blockers.length) {
    throw new WeeklyLongformHyperframesRendererError(blockers);
  }
  const alignment = validateAlignment({
    alignment: alignmentFile.value,
    runId,
    scriptText,
    scriptSha256,
    audioSha256: audio.sha256,
  });

  const visualBeatPlan = input.visual_beat_plan;
  const beats = Array.isArray(visualBeatPlan?.beats)
    ? visualBeatPlan.beats
    : [];
  if (
    visualBeatPlan?.schema_version !==
      "pulse-weekly-visual-beat-plan-v1" ||
    !beats.length ||
    Number(visualBeatPlan?.beat_count) !== beats.length
  ) {
    blockers.push("visual_beat_plan_invalid");
  }
  const seenBeatIds = new Set();
  let previousStart = -Infinity;
  for (const beat of beats) {
    const beatId = text(beat?.beat_id);
    const start = Number(beat?.estimated_start_seconds);
    const end = Number(beat?.estimated_end_seconds);
    if (!beatId || seenBeatIds.has(beatId)) {
      blockers.push("visual_beat_id_invalid");
    } else {
      seenBeatIds.add(beatId);
    }
    if (
      !text(beat?.story_id) ||
      !text(beat?.purpose) ||
      !text(beat?.treatment) ||
      !text(beat?.asset_item_id) ||
      beat?.rights_bound !== true ||
      beat?.claims_bound !== true ||
      !Array.isArray(beat?.claim_ids) ||
      beat.claim_ids.length === 0
    ) {
      blockers.push("visual_beat_binding_invalid");
    }
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      start < previousStart
    ) {
      blockers.push("visual_beat_timing_invalid");
    }
    previousStart = start;
  }
  if (blockers.length) {
    throw new WeeklyLongformHyperframesRendererError(blockers);
  }
  return {
    runId,
    generatedAt,
    outputDir,
    runRoot,
    workOrder,
    scriptText,
    script,
    audio,
    alignmentFile,
    alignment,
    beats: beats.map((beat) => structuredClone(beat)),
    visualBeatPlan,
    derivativePlan: input.derivative_plan,
  };
}

function localAssetPath(item, ledgerPath) {
  const declared =
    text(item?.local_path) ||
    text(item?.asset_path) ||
    text(item?.path);
  if (!declared) return null;
  return path.isAbsolute(declared)
    ? path.resolve(declared)
    : path.resolve(path.dirname(ledgerPath), declared);
}

async function resolveRightsBoundAssets(validated) {
  const blockers = [];
  const dossierStories = Array.isArray(
    validated.workOrder?.dossier?.stories,
  )
    ? validated.workOrder.dossier.stories
    : [];
  const storyById = new Map(
    dossierStories.map((story) => [text(story?.story_id), story]),
  );
  const ledgerByStory = new Map();
  for (const storyId of unique(validated.beats.map((beat) => beat.story_id))) {
    const story = storyById.get(storyId);
    if (!story) {
      blockers.push("visual_beat_story_dossier_missing");
      continue;
    }
    let observed;
    try {
      observed = await observeFile({
        filePath: story.rights_lineage?.path,
        expectedSha256: story.rights_lineage?.sha256,
        prefix: "source_rights_ledger",
        json: true,
        maximumBytes: 8 * 1024 * 1024,
      });
    } catch (error) {
      if (error instanceof WeeklyLongformHyperframesRendererError) {
        blockers.push(...error.codes);
        continue;
      }
      throw error;
    }
    const ledger = observed.value;
    const expectedCanonicalSha256 =
      normaliseSha256(story.rights_lineage?.canonical_sha256) ||
      normaliseSha256(ledger?.ledger_sha256);
    const assessment = assessRightsLedger(
      ledger,
      expectedCanonicalSha256,
    );
    blockers.push(...assessment.blockers);
    ledgerByStory.set(storyId, {
      story,
      observed,
      ledger,
      assessment,
    });
  }
  if (blockers.length) {
    throw new WeeklyLongformHyperframesRendererError(blockers);
  }

  const assets = [];
  const dedupe = new Map();
  for (const beat of validated.beats) {
    const source = ledgerByStory.get(text(beat.story_id));
    const rawItem = source.ledger.items.find(
      (item) => text(item?.item_id) === text(beat.asset_item_id),
    );
    if (!rawItem) {
      blockers.push("visual_asset_rights_item_missing");
      continue;
    }
    if (
      rawItem.included_in_final !== true ||
      text(rawItem.rights_decision).toUpperCase() !== "CLEARED"
    ) {
      blockers.push("visual_asset_not_cleared");
      continue;
    }
    const assetPath = localAssetPath(rawItem, source.observed.path);
    if (!assetPath) {
      blockers.push("visual_asset_materialised_path_required");
      continue;
    }
    const extension = path.extname(assetPath).toLowerCase();
    if (!VISUAL_EXTENSIONS.has(extension)) {
      blockers.push("visual_asset_media_type_unsupported");
      continue;
    }
    let observedAsset;
    try {
      observedAsset = await observeFile({
        filePath: assetPath,
        expectedSha256: rawItem.asset_sha256,
        prefix: "visual_asset",
      });
    } catch (error) {
      if (error instanceof WeeklyLongformHyperframesRendererError) {
        blockers.push(...error.codes);
        continue;
      }
      throw error;
    }
    const claimIds = new Set(
      Array.isArray(source.story?.verified_claims)
        ? source.story.verified_claims.map((claim) => text(claim?.claim_id))
        : [],
    );
    if (
      beat.claim_ids.some((claimId) => !claimIds.has(text(claimId)))
    ) {
      blockers.push("visual_beat_verified_claim_mismatch");
      continue;
    }
    const key = `${beat.story_id}:${beat.asset_item_id}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, {
        key,
        story_id: text(beat.story_id),
        source_item_id: text(beat.asset_item_id),
        source_ledger: source,
        source_item: rawItem,
        source_path: observedAsset.path,
        extension,
        media_type: VIDEO_EXTENSIONS.has(extension) ? "video" : "image",
        declared_sha256: normaliseSha256(rawItem.asset_sha256),
        observed_sha256: observedAsset.sha256,
        byte_length: observedAsset.byte_length,
      });
    }
    assets.push({
      beat_id: text(beat.beat_id),
      asset_key: key,
    });
  }
  if (blockers.length) {
    throw new WeeklyLongformHyperframesRendererError(blockers);
  }
  if (!dedupe.size) {
    throw new WeeklyLongformHyperframesRendererError(
      "visual_asset_required",
    );
  }
  return {
    assets: [...dedupe.values()],
    beatAssets: new Map(assets.map((item) => [item.beat_id, item.asset_key])),
    ledgerByStory,
  };
}

function platformTheme(story) {
  const haystack = [
    story?.title,
    story?.section_title,
    story?.angle,
    story?.why_it_matters,
  ]
    .map(text)
    .join(" ")
    .toLowerCase();
  if (/\b(xbox|microsoft|game pass)\b/.test(haystack)) return "xbox";
  if (/\b(playstation|sony|ps[345])\b/.test(haystack)) {
    return "playstation";
  }
  if (/\b(nintendo|switch)\b/.test(haystack)) return "nintendo";
  if (/\b(steam|valve|pc gaming|pc)\b/.test(haystack)) return "steam";
  return "pulse";
}

function safeId(value, fallback = "scene") {
  const id = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return id || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function number(value) {
  const rounded = Number(Number(value).toFixed(3));
  return Number.isFinite(rounded) ? rounded : 0;
}

function relativeWebPath(fromDir, targetPath) {
  return path.relative(fromDir, targetPath).split(path.sep).join("/");
}

function planScenes(validated, rights) {
  const beats = validated.beats;
  const firstPlanned = Number(beats[0].estimated_start_seconds);
  const lastPlanned = Math.max(
    ...beats.map((beat) => Number(beat.estimated_end_seconds)),
  );
  const plannedSpan = lastPlanned - firstPlanned;
  if (!(plannedSpan > 0)) {
    throw new WeeklyLongformHyperframesRendererError(
      "visual_beat_timing_span_invalid",
    );
  }
  const storyById = new Map(
    validated.workOrder.dossier.stories.map((story) => [
      text(story.story_id),
      story,
    ]),
  );
  const assetByKey = new Map(rights.assets.map((asset) => [asset.key, asset]));
  const starts = beats.map((beat, index) =>
    index === 0
      ? 0
      : number(
          ((Number(beat.estimated_start_seconds) - firstPlanned) /
            plannedSpan) *
            validated.alignment.duration_seconds,
        ),
  );
  return beats.map((beat, index) => {
    const start = starts[index];
    const end =
      index + 1 < beats.length
        ? starts[index + 1]
        : validated.alignment.duration_seconds;
    if (end - start < 0.5) {
      throw new WeeklyLongformHyperframesRendererError(
        "visual_beat_scaled_duration_too_short",
      );
    }
    const story = storyById.get(text(beat.story_id));
    const assetKey = rights.beatAssets.get(text(beat.beat_id));
    const asset = assetByKey.get(assetKey);
    const themeId = platformTheme(story);
    const previous =
      index > 0 ? storyById.get(text(beats[index - 1].story_id)) : null;
    const storyChange =
      index > 0 && text(previous?.story_id) !== text(story?.story_id);
    return {
      index,
      id: safeId(beat.beat_id, `scene-${index + 1}`),
      start_seconds: number(start),
      end_seconds: number(end),
      duration_seconds: number(end - start),
      beat,
      story,
      asset,
      theme_id: themeId,
      theme: PLATFORM_THEMES[themeId],
      transition_in: storyChange ? "push-slide" : "hard-cut",
    };
  });
}

function buildCaptionGroups(words) {
  const groups = [];
  let active = [];
  const flush = () => {
    if (!active.length) return;
    groups.push({
      id: `caption-${groups.length + 1}`,
      words: active,
      start_seconds: active[0].start_seconds,
      end_seconds: active[active.length - 1].end_seconds,
    });
    active = [];
  };
  for (const word of words) {
    active.push(word);
    const duration =
      active[active.length - 1].end_seconds - active[0].start_seconds;
    if (
      active.length >= 7 ||
      duration >= 2.6 ||
      /[.!?]$/.test(text(word.text))
    ) {
      flush();
    }
  }
  flush();
  return groups.map((group) => {
    const candidates = group.words
      .map((word, index) => ({ word, index }))
      .filter(({ word }) => text(word.text).replace(/\W/g, "").length >= 5)
      .sort(
        (left, right) =>
          text(right.word.text).length - text(left.word.text).length ||
          left.index - right.index,
      );
    return {
      ...group,
      keyword_index: candidates[0]?.index ?? 0,
    };
  });
}

function buildBrief(validated, scenes) {
  const title =
    text(validated.workOrder.editorial_frame?.episode_title) ||
    text(validated.workOrder.dossier?.episode_title) ||
    "Pulse Gaming Weekly";
  const thesis =
    text(validated.workOrder.editorial_frame?.editorial_thesis) ||
    text(validated.workOrder.dossier?.editorial_thesis) ||
    "The week in gaming, explained through verified player impact.";
  return `---
workflow: general-video
flow: automation
storyboard: no
message: ${JSON.stringify(thesis)}
destination: youtube
aspect: 1920x1080
language: en-GB
audience: "Gaming-news viewers who want fast context and player impact"
length: ${validated.alignment.duration_seconds}s
angle: weekly-verified-player-impact
narration: yes
---

## Intent

${title} is a high-density weekly gaming briefing. It leads with player impact,
uses locally materialised cleared media as visual evidence and keeps every
editorial overlay inside a landscape title-safe frame while the imagery remains
full bleed.

## Assets

- \`assets/audio/narration${path.extname(validated.audio.path).toLowerCase() || ".mp3"}\` — exact hash-bound ElevenLabs narration.
- \`assets/evidence/word-timestamps.json\` — provider word alignment used for captions.
- \`assets/visuals/\` — ${scenes.length} beat bindings backed by source rights ledgers.

## Customizations

- Pulse amber broadcast spine with platform-coded story chapters.
- Full-bleed source visuals with title-safe editorial overlays.
- Provider-timed captions with deterministic keyword emphasis.
- Multi-phase camera motion, smooth pop entrances, amber push-slide chapter
  handoffs and a designed opening/close.

## Notes

- Run: \`${validated.runId}\`.
- Work-order SHA-256: \`${validated.workOrder.work_order_sha256}\`.
- No external network, upload, database or OAuth authority.
- Attribution is displayed only when the admitted source ledger requires it;
  attribution never substitutes for permission.
`;
}

function buildFrameDesign() {
  return `# Pulse Gaming Weekly — Frame Truth

## Concept angle

A living editorial command centre: full-bleed verified game imagery is evidence,
while an amber broadcast spine, platform-coded chapters and word-timed captions
turn the weekly recap into a fast, premium briefing.

## Palette

- Canvas: \`#090807\`
- Foreground: \`#fff7ef\`
- Muted: \`#c9b8aa\`
- Pulse accent: \`#ff6b1a\`
- Platform accents: Xbox \`#107c10\`, PlayStation \`#2f6fff\`,
  Nintendo \`#e60012\`, Steam \`#66c0f4\`

## Typography

- Display: bundled Bebas Neue.
- Editorial/body: IBM Plex Sans, with Arial fallback.
- Metadata: IBM Plex Mono, with monospace fallback.
- Display/body weight contrast is 900/350; all public text is at least 24px.

## Composition

- Focal element: full-bleed cleared visual media.
- Edge anchors: top metadata rail, left chapter lockup, lower caption rail and
  right-side progress counter.
- Supporting detail: verified claim count, chapter index, rule lines, source
  attribution and Pulse watermark.
- Background: media-derived full bleed with a dark editorial scrim, amber bloom,
  grain and platform-colour atmosphere.
- Title-safe overlay inset: 104px horizontal, 74px top and 86px bottom.
`;
}

function buildStoryboard(validated, scenes) {
  const title =
    text(validated.workOrder.editorial_frame?.episode_title) ||
    "Pulse Gaming Weekly";
  const lines = [
    "---",
    "format: 1920x1080",
    `duration: ${validated.alignment.duration_seconds}s`,
    `message: ${JSON.stringify(
      text(validated.workOrder.editorial_frame?.editorial_thesis) ||
        "Verified gaming news translated into player impact.",
    )}`,
    "arc: Stakes → Verified stories → Player impact → Weekly lockup",
    'audience: "Gaming-news viewers"',
    "mode: autonomous",
    "---",
    "",
    `# ${title}`,
    "",
  ];
  for (const scene of scenes) {
    const numberLabel = String(scene.index + 1).padStart(2, "0");
    lines.push(
      `## Frame ${numberLabel} — ${text(scene.story?.section_title) || text(scene.story?.title)}`,
      "",
      "- status: built",
      `- src: compositions/${scene.id}.html`,
      `- duration: ${scene.duration_seconds}s`,
      `- transition_in: ${scene.transition_in}`,
      `- scene: ${text(scene.beat.purpose)}`,
      "- motion_rules: multi-phase-camera, spring-pop-entrance, ambient-glow-bloom, asr-keyword-glow",
      "",
      `${text(scene.beat.purpose)} The ${scene.theme.label.toLowerCase()} colour family`,
      "identifies the chapter without copying a third-party interface. Cleared",
      "media fills the frame; the title-safe editorial layer explains why it matters.",
      "",
    );
  }
  return lines.join("\n");
}

function fontFaceStyles() {
  return `@font-face {
  font-family: "IBM Plex Sans";
  src: url("assets/fonts/ibm-plex-sans-regular.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 500;
  font-display: block;
}
@font-face {
  font-family: "IBM Plex Sans";
  src: url("assets/fonts/ibm-plex-sans-bold.woff2") format("woff2");
  font-style: normal;
  font-weight: 600 900;
  font-display: block;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("assets/fonts/ibm-plex-mono-regular.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 500;
  font-display: block;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("assets/fonts/ibm-plex-mono-bold.woff2") format("woff2");
  font-style: normal;
  font-weight: 600 900;
  font-display: block;
}
@font-face {
  font-family: "Bebas Neue";
  src: url("assets/fonts/bebas-neue-regular.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: block;
}`;
}

function buildStyles() {
  return `${fontFaceStyles()}
:root {
  --pulse-amber: #ff6b1a;
  --ink: #090807;
  --paper: #fff7ef;
  --muted: #c9b8aa;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background: #090807;
  color: #fff7ef;
}
body {
  font-family: "IBM Plex Sans", Arial, sans-serif;
}
#root {
  position: relative;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background: #090807;
}
[data-composition-src] {
  position: absolute;
  inset: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
}
.host-video {
  position: absolute;
  inset: 0;
  display: block;
  width: 1920px;
  height: 1080px;
  object-fit: cover;
  background: #090807;
}
.title-safe {
  position: absolute;
  inset: 74px 104px 86px;
  pointer-events: none;
}
.chapter-wipe {
  position: absolute;
  inset: -32px;
  z-index: 80;
  display: block;
  width: 1984px;
  height: 1144px;
  background: #ff6b1a;
  transform: translateX(-2050px);
  will-change: transform;
  pointer-events: none;
}
.caption-shell {
  position: absolute;
  left: 164px;
  right: 164px;
  bottom: 92px;
  z-index: 70;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  min-height: 108px;
  padding: 18px 34px 20px;
  border: 2px solid rgba(255, 107, 26, 0.78);
  border-radius: 18px;
  background: rgba(9, 8, 7, 0.88);
  box-shadow: 0 22px 64px rgba(0, 0, 0, 0.48);
  font-size: 46px;
  font-weight: 850;
  line-height: 1.08;
  letter-spacing: -0.025em;
  text-align: center;
  will-change: transform, opacity;
}
.caption-word {
  display: inline-block;
  color: #fff7ef;
  will-change: transform, color;
}
.caption-word.keyword {
  color: #ffb27e;
}
.corner-brand {
  position: absolute;
  top: 74px;
  right: 104px;
  z-index: 72;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #fff7ef;
  font-family: "IBM Plex Mono", monospace;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  pointer-events: none;
}
.corner-brand::before {
  content: "";
  display: block;
  width: 34px;
  height: 8px;
  background: #ff6b1a;
}
`;
}

function sceneImageMarkup(scene, projectDir, assetTarget) {
  if (scene.asset.media_type === "video") return "";
  const src = relativeWebPath(
    projectDir,
    assetTarget,
  );
  return `<img class="scene-media" src="${escapeHtml(src)}" alt="" />`;
}

function buildSceneHtml({
  scene,
  projectDir,
  assetTarget,
  sceneCount,
}) {
  const title =
    text(scene.story?.section_title) ||
    text(scene.story?.title) ||
    "Weekly story";
  const why =
    text(scene.story?.why_it_matters) ||
    text(scene.beat?.purpose) ||
    "What this changes for players.";
  const attribution =
    text(scene.asset.source_item?.attribution_text) ||
    (text(scene.asset.source_item?.attribution_decision).toUpperCase() ===
    "NOT_REQUIRED"
      ? ""
      : "");
  const baseBackground =
    scene.asset.media_type === "video"
      ? "rgba(9, 8, 7, 0)"
      : scene.theme.surface;
  const duration = scene.duration_seconds;
  const phaseTwoDuration = number(Math.min(1.6, duration * 0.16));
  const phaseThreeAt = number(Math.max(phaseTwoDuration + 0.3, duration * 0.56));
  const phaseThreeDuration = number(
    Math.min(1.8, Math.max(0.6, duration - phaseThreeAt - 0.1)),
  );
  const cycles = Math.max(1, Math.min(3, Math.floor(duration / 8)));
  const repeat = Math.max(0, Math.floor((duration - 1.1) / 2.4) - 1);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template id="${scene.id}-template">
      <div
        id="${scene.id}-root"
        data-composition-id="${scene.id}"
        data-start="0"
        data-width="1920"
        data-height="1080"
        data-duration="${duration}"
        class="scene-root theme-${scene.theme_id}"
      >
        <style>
          ${fontFaceStyles()}
          [data-composition-id="${scene.id}"] {
            position: absolute;
            inset: 0;
            display: block;
            width: 1920px;
            height: 1080px;
            overflow: hidden;
            background-color: ${baseBackground};
            color: #fff7ef;
            font-family: "IBM Plex Sans", Arial, sans-serif;
          }
          [data-composition-id="${scene.id}"] .scene-camera {
            position: absolute;
            inset: -32px;
            display: block;
            width: 1984px;
            height: 1144px;
            transform-origin: 50% 50%;
            will-change: transform;
          }
          [data-composition-id="${scene.id}"] .scene-media {
            position: absolute;
            inset: 0;
            display: block;
            width: 1984px;
            height: 1144px;
            object-fit: cover;
          }
          [data-composition-id="${scene.id}"] .media-fallback {
            position: absolute;
            inset: 0;
            background-color: ${baseBackground};
          }
          [data-composition-id="${scene.id}"] .editorial-scrim {
            position: absolute;
            inset: 0;
            background-color: rgba(9, 8, 7, 0.52);
            background-image:
              radial-gradient(circle at 78% 30%, ${scene.theme.accent}66 0%, ${scene.theme.accent}00 38%);
          }
          [data-composition-id="${scene.id}"] .grain {
            position: absolute;
            inset: 0;
            opacity: 0.18;
            background-image:
              repeating-linear-gradient(0deg, rgba(255, 247, 239, 0.04) 0px, rgba(255, 247, 239, 0.04) 1px, rgba(255, 247, 239, 0) 1px, rgba(255, 247, 239, 0) 4px);
          }
          [data-composition-id="${scene.id}"] .glow {
            position: absolute;
            left: 40px;
            top: 220px;
            display: block;
            width: 720px;
            height: 720px;
            border-radius: 50%;
            opacity: 0.34;
            background: radial-gradient(circle, ${scene.theme.accent}88 0%, ${scene.theme.accent}00 68%);
            will-change: transform, opacity;
          }
          [data-composition-id="${scene.id}"] .title-safe {
            position: absolute;
            inset: 74px 104px 86px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          [data-composition-id="${scene.id}"] .top-rail {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-right: 350px;
          }
          [data-composition-id="${scene.id}"] .platform-pill {
            display: inline-flex;
            align-items: center;
            gap: 13px;
            min-height: 48px;
            padding: 10px 18px;
            border: 2px solid ${scene.theme.accent};
            border-radius: 999px;
            background: rgba(9, 8, 7, 0.78);
            font-family: "IBM Plex Mono", monospace;
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 0.13em;
            color: #fff7ef;
            transform-origin: 0% 50%;
            will-change: transform, opacity;
          }
          [data-composition-id="${scene.id}"] .platform-pill::before {
            content: "";
            display: block;
            width: 13px;
            height: 13px;
            border-radius: 50%;
            background: ${scene.theme.accent};
          }
          [data-composition-id="${scene.id}"] .chapter-count {
            font-family: "IBM Plex Mono", monospace;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: 0.1em;
            color: #c9b8aa;
            font-variant-numeric: tabular-nums;
          }
          [data-composition-id="${scene.id}"] .story-lockup {
            display: grid;
            grid-template-columns: 18px minmax(0, 1060px);
            gap: 30px;
            align-items: stretch;
            margin-top: auto;
            margin-bottom: 210px;
          }
          [data-composition-id="${scene.id}"] .accent-rail {
            display: block;
            width: 18px;
            min-height: 330px;
            background: ${scene.theme.accent};
            transform-origin: 50% 100%;
          }
          [data-composition-id="${scene.id}"] .copy-stack {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 20px;
            max-width: 1140px;
            padding: 34px 42px 38px;
            border-radius: 24px;
            background: rgba(9, 8, 7, 0.68);
            box-shadow: 0 30px 80px rgba(0, 0, 0, 0.38);
          }
          [data-composition-id="${scene.id}"] .eyebrow {
            font-family: "IBM Plex Mono", monospace;
            font-size: 24px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: ${scene.theme.accent};
          }
          [data-composition-id="${scene.id}"] h2 {
            max-width: 1060px;
            margin: 0;
            font-family: "Bebas Neue", sans-serif;
            font-size: 118px;
            font-weight: 900;
            line-height: 0.9;
            letter-spacing: -0.025em;
            text-transform: uppercase;
            text-wrap: balance;
            text-shadow: 0 8px 32px rgba(0, 0, 0, 0.64);
            will-change: transform, opacity;
          }
          [data-composition-id="${scene.id}"] .impact {
            max-width: 920px;
            margin: 0;
            color: #fff7ef;
            font-size: 34px;
            font-weight: 350;
            line-height: 1.22;
            text-shadow: 0 6px 28px rgba(0, 0, 0, 0.72);
            will-change: transform, opacity;
          }
          [data-composition-id="${scene.id}"] .proof-row {
            display: flex;
            align-items: center;
            gap: 16px;
          }
          [data-composition-id="${scene.id}"] .proof-pill {
            display: inline-flex;
            align-items: center;
            min-height: 42px;
            padding: 8px 14px;
            border: 2px solid rgba(255, 247, 239, 0.45);
            border-radius: 8px;
            background: rgba(9, 8, 7, 0.76);
            font-family: "IBM Plex Mono", monospace;
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #fff7ef;
            will-change: transform, opacity;
          }
          [data-composition-id="${scene.id}"] .attribution {
            position: absolute;
            right: 104px;
            bottom: 142px;
            max-width: 520px;
            color: #c9b8aa;
            font-size: 24px;
            font-weight: 500;
            text-align: right;
            text-shadow: 0 4px 18px rgba(0, 0, 0, 0.8);
          }
          [data-composition-id="${scene.id}"] .progress {
            position: absolute;
            left: 104px;
            right: 104px;
            bottom: 54px;
            display: block;
            height: 6px;
            background: rgba(255, 247, 239, 0.18);
          }
          [data-composition-id="${scene.id}"] .progress-fill {
            display: block;
            width: 100%;
            height: 6px;
            background: ${scene.theme.accent};
            transform-origin: 0% 50%;
          }
          [data-composition-id="${scene.id}"] .register {
            position: absolute;
            right: 104px;
            top: 310px;
            display: grid;
            grid-template-columns: repeat(2, 14px);
            gap: 14px;
          }
          [data-composition-id="${scene.id}"] .register i {
            display: block;
            width: 14px;
            height: 14px;
            border: 2px solid ${scene.theme.accent};
          }
        </style>
        <div class="media-fallback"></div>
        <div class="scene-camera">
          ${sceneImageMarkup(scene, projectDir, assetTarget)}
          <div class="editorial-scrim"></div>
          <div class="grain"></div>
          <div class="glow"></div>
        </div>
        <div class="title-safe">
          <div class="top-rail">
            <div class="platform-pill">${escapeHtml(scene.theme.label)}</div>
            <div class="chapter-count">${String(scene.index + 1).padStart(2, "0")} / ${String(sceneCount).padStart(2, "0")}</div>
          </div>
          <div class="story-lockup">
            <div class="accent-rail"></div>
            <div class="copy-stack">
              <div class="eyebrow">Verified weekly briefing</div>
              <h2>${escapeHtml(title)}</h2>
              <p class="impact">${escapeHtml(why)}</p>
              <div class="proof-row">
                <div class="proof-pill">${scene.beat.claim_ids.length} claim${scene.beat.claim_ids.length === 1 ? "" : "s"} bound</div>
                <div class="proof-pill">Player impact</div>
              </div>
            </div>
          </div>
        </div>
        ${attribution ? `<div class="attribution">${escapeHtml(attribution)}</div>` : ""}
        <div class="register" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="progress"><div class="progress-fill"></div></div>
        <script>
          window.__timelines = window.__timelines || {};
          var tl = gsap.timeline({ paused: true });
          var phase = { scale: 1.04 };
          var drift = { p: 0 };
          var camera = document.querySelector('[data-composition-id="${scene.id}"] .scene-camera');
          tl.to(phase, { scale: 1, duration: ${phaseTwoDuration}, ease: "power2.out" }, 0);
          tl.to(phase, { scale: 1.055, duration: ${phaseThreeDuration}, ease: "power2.inOut" }, ${phaseThreeAt});
          tl.to(drift, {
            p: Math.PI * 2 * ${cycles},
            duration: ${duration},
            ease: "none",
            onUpdate: function () {
              var dx = Math.sin(drift.p) * 5;
              var dy = Math.sin(drift.p * 1.3) * 3;
              camera.style.transform = "scale(" + phase.scale + ") translate(" + dx + "px," + dy + "px)";
            }
          }, 0);
          tl.fromTo(".platform-pill", { scale: 0, opacity: 0, y: 12 }, { scale: 1, opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0.08);
          tl.fromTo(".accent-rail", { scaleY: 0 }, { scaleY: 1, duration: 0.54, ease: "power4.out" }, 0.16);
          tl.fromTo("h2", { x: -90, opacity: 0 }, { x: 0, opacity: 1, duration: 0.58, ease: "expo.out" }, 0.22);
          tl.fromTo(".impact", { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.52, ease: "circ.out" }, 0.42);
          tl.fromTo(".proof-pill", { scale: 0, opacity: 0, y: 16 }, { scale: 1, opacity: 1, y: 0, duration: 0.44, ease: "power3.out", stagger: 0.07 }, 0.58);
          tl.fromTo(".glow", { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 0.34, duration: 0.9, ease: "power2.out" }, 0.05);
          tl.to(".glow", { scale: 1.045, duration: 1.2, ease: "sine.inOut", yoyo: true, repeat: ${repeat} }, 1.1);
          tl.fromTo(".progress-fill", { scaleX: 0 }, { scaleX: 1, duration: ${number(Math.max(0.5, duration - 0.25))}, ease: "none" }, 0.25);
          window.__timelines["${scene.id}"] = tl;
        </script>
      </div>
    </template>
  </body>
</html>
`;
  return html.replaceAll(
    `[data-composition-id="${scene.id}"]`,
    `#${scene.id}-root`,
  );
}

function buildIndex({
  validated,
  scenes,
  projectDir,
  assetTargets,
  audioTarget,
  captions,
}) {
  const sceneSlots = [];
  for (const scene of scenes) {
    if (scene.asset.media_type === "video") {
      sceneSlots.push(`      <video
        id="media-${scene.id}"
        class="clip host-video"
        src="${escapeHtml(relativeWebPath(projectDir, assetTargets.get(scene.asset.key)))}"
        data-start="${scene.start_seconds}"
        data-duration="${scene.duration_seconds}"
        data-track-index="1"
        preload="auto"
        muted
        loop
        playsinline
      ></video>`);
    }
    sceneSlots.push(`      <div
        id="slot-${scene.id}"
        data-composition-id="${scene.id}"
        data-composition-src="compositions/${scene.id}.html"
        data-start="${scene.start_seconds}"
        data-duration="${scene.duration_seconds}"
        data-track-index="2"
      ></div>`);
  }
  const captionMarkup = captions
    .map((caption, captionIndex) => {
      const duration = number(caption.end_seconds - caption.start_seconds);
      const wordMarkup = caption.words
        .map(
          (word, index) =>
            `<span id="${caption.id}-word-${index + 1}" class="caption-word${index === caption.keyword_index ? " keyword" : ""}">${escapeHtml(word.text)}</span>`,
        )
        .join("");
      return `      <section
        id="${caption.id}"
        class="clip"
        data-start="${number(caption.start_seconds)}"
        data-duration="${duration}"
        data-track-index="${20 + captionIndex}"
      ><div class="caption-shell">${wordMarkup}</div></section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="assets/runtime/gsap.min.js"></script>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${validated.alignment.duration_seconds}"
      data-fps="30"
      data-width="1920"
      data-height="1080"
    >
${sceneSlots.join("\n")}
      <audio
        id="narration"
        class="clip"
        src="${escapeHtml(relativeWebPath(projectDir, audioTarget))}"
        data-start="0"
        data-duration="${validated.alignment.duration_seconds}"
        data-track-index="10"
        data-volume="1"
        preload="auto"
      ></audio>
${captionMarkup}
      <div id="chapter-wipe" class="chapter-wipe" aria-hidden="true"></div>
      <div class="corner-brand">Pulse Gaming</div>
    </div>
    <script src="timeline.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = window.createPulseLongformTimeline();
    </script>
  </body>
</html>
`;
}

function buildTimeline({ scenes, captions }) {
  const lines = [
    '"use strict";',
    "",
    "window.createPulseLongformTimeline = function createPulseLongformTimeline() {",
    "  var tl = gsap.timeline({ paused: true });",
  ];
  for (const scene of scenes.filter(
    (item) => item.transition_in === "push-slide",
  )) {
    const transitionAt = scene.start_seconds;
    const coverAt = number(Math.max(0, transitionAt - 0.2));
    lines.push(
      `  tl.set("#chapter-wipe", { x: -2050, opacity: 1 }, ${coverAt});`,
      `  tl.to("#chapter-wipe", { x: 0, duration: 0.2, ease: "power4.in" }, ${coverAt});`,
      `  tl.to("#chapter-wipe", { x: 2050, duration: 0.22, ease: "power4.out" }, ${transitionAt});`,
    );
  }
  for (const caption of captions) {
    const start = number(caption.start_seconds);
    lines.push(
      `  tl.fromTo("#${caption.id} .caption-shell", { y: 24, opacity: 0, scale: 0.98 }, { y: 0, opacity: 1, scale: 1, duration: 0.22, ease: "power3.out" }, ${start});`,
    );
    caption.words.forEach((word, index) => {
      if (index !== caption.keyword_index) return;
      const attack = number(word.start_seconds);
      const hold = number(
        Math.max(0.16, Number(word.end_seconds) - Number(word.start_seconds)),
      );
      lines.push(
        `  tl.fromTo("#${caption.id}-word-${index + 1}", { scale: 1, color: "#ffb27e" }, { scale: 1.08, color: "#ff6b1a", duration: ${Math.min(0.16, hold / 2)}, ease: "power3.out", yoyo: true, repeat: 1 }, ${attack});`,
      );
    });
  }
  lines.push("  return tl;", "};", "");
  return lines.join("\n");
}

async function writeAtomic(filePath, value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(String(value), "utf8");
  const temporaryPath = `${filePath}.${process.pid}.${crypto
    .randomBytes(6)
    .toString("hex")}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    path: filePath,
    sha256: sha256Buffer(bytes),
    byte_length: bytes.length,
  };
}

async function copyHashBoundFile(source, target, expectedSha256, prefix) {
  await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  const observedSha256 = await hashFile(target);
  if (observedSha256 !== expectedSha256) {
    await fsp.rm(target, { force: true });
    throw new WeeklyLongformHyperframesRendererError(
      `${prefix}_copy_sha256_mismatch`,
    );
  }
  const stat = await fsp.stat(target);
  return {
    path: target,
    sha256: observedSha256,
    byte_length: stat.size,
  };
}

async function ensureFreshOutput(outputDir) {
  await fsp.mkdir(outputDir, { recursive: true });
  const entries = await fsp.readdir(outputDir);
  if (entries.length > 0) {
    throw new WeeklyLongformHyperframesRendererError(
      "render_output_dir_not_fresh",
    );
  }
}

function rendererInvocation(options, phase, projectDir, masterPath = null) {
  const prefix = Array.isArray(options.command_args_prefix)
    ? options.command_args_prefix.map(String)
    : [];
  const args =
    phase === "check"
      ? [...prefix, "check", projectDir]
      : [
          ...prefix,
          "render",
          projectDir,
          "--output",
          masterPath,
          "--fps",
          "30",
          "--quality",
          "high",
          "--workers",
          "auto",
          "--strict",
        ];
  return {
    phase,
    command: path.resolve(text(options.command) || process.execPath),
    args,
    cwd: projectDir,
    timeout_ms:
      phase === "check"
        ? Number(options.check_timeout_ms) || 5 * 60 * 1000
        : Number(options.render_timeout_ms) || 3 * 60 * 60 * 1000,
    ...(masterPath ? { expected_output_path: masterPath } : {}),
    external_network_authorised: false,
    upload_authorised: false,
  };
}

async function invokeRendererProcess(options, invocation) {
  let result;
  try {
    result = await options.process_runner(invocation);
  } catch {
    throw new WeeklyLongformHyperframesRendererError(
      `hyperframes_${invocation.phase}_failed`,
    );
  }
  if (Number(result?.status) !== 0) {
    throw new WeeklyLongformHyperframesRendererError(
      `hyperframes_${invocation.phase}_failed`,
    );
  }
  return {
    phase: invocation.phase,
    status: 0,
    stdout: String(result?.stdout || "").slice(0, 32768),
    stderr: String(result?.stderr || "").slice(0, 32768),
  };
}

async function assertMp4(filePath) {
  let handle;
  try {
    handle = await fsp.open(filePath, "r");
    const header = Buffer.alloc(12);
    const read = await handle.read(header, 0, header.length, 0);
    if (
      read.bytesRead < 12 ||
      header.subarray(4, 8).toString("ascii") !== "ftyp"
    ) {
      throw new WeeklyLongformHyperframesRendererError(
        "render_master_mp4_invalid",
      );
    }
  } catch (error) {
    if (error instanceof WeeklyLongformHyperframesRendererError) throw error;
    throw new WeeklyLongformHyperframesRendererError(
      "render_master_file_missing",
    );
  } finally {
    await handle?.close();
  }
}

async function materializeProject({
  validated,
  rights,
  capabilities,
  options,
}) {
  await ensureFreshOutput(validated.outputDir);
  const projectDir = path.join(
    validated.outputDir,
    "hyperframes-project",
  );
  const directories = {
    project: projectDir,
    compositions: path.join(projectDir, "compositions"),
    audio: path.join(projectDir, "assets", "audio"),
    evidence: path.join(projectDir, "assets", "evidence"),
    fonts: path.join(projectDir, "assets", "fonts"),
    runtime: path.join(projectDir, "assets", "runtime"),
    visuals: path.join(projectDir, "assets", "visuals"),
    processEvidence: path.join(validated.outputDir, "process-evidence"),
  };
  await Promise.all(
    Object.values(directories).map((directory) =>
      fsp.mkdir(directory, { recursive: true }),
    ),
  );

  const audioExtension =
    path.extname(validated.audio.path).toLowerCase() || ".mp3";
  const audioTarget = path.join(
    directories.audio,
    `narration${audioExtension}`,
  );
  const alignmentTarget = path.join(
    directories.evidence,
    "word-timestamps.json",
  );
  const scriptTarget = path.join(directories.evidence, "script.txt");
  const gsapTarget = path.join(directories.runtime, "gsap.min.js");
  const copiedFonts = {};
  for (const [fontId, targetName] of Object.entries(
    REQUIRED_FONT_SOURCES,
  )) {
    const source = path.resolve(options.font_source_paths[fontId]);
    copiedFonts[fontId] = await copyHashBoundFile(
      source,
      path.join(directories.fonts, targetName),
      await hashFile(source),
      `font_${fontId}`,
    );
  }
  const copied = {
    script: await copyHashBoundFile(
      validated.script.path,
      scriptTarget,
      validated.script.sha256,
      "script",
    ),
    audio: await copyHashBoundFile(
      validated.audio.path,
      audioTarget,
      validated.audio.sha256,
      "audio",
    ),
    alignment: await copyHashBoundFile(
      validated.alignmentFile.path,
      alignmentTarget,
      validated.alignmentFile.sha256,
      "alignment",
    ),
    gsap: await copyHashBoundFile(
      path.resolve(options.gsap_source_path),
      gsapTarget,
      await hashFile(path.resolve(options.gsap_source_path)),
      "gsap",
    ),
    fonts: copiedFonts,
  };

  const assetTargets = new Map();
  const copiedAssets = [];
  for (const asset of rights.assets) {
    const target = path.join(
      directories.visuals,
      `${asset.observed_sha256}${asset.extension}`,
    );
    if (!fs.existsSync(target)) {
      await copyHashBoundFile(
        asset.source_path,
        target,
        asset.observed_sha256,
        "visual_asset",
      );
    } else if ((await hashFile(target)) !== asset.observed_sha256) {
      throw new WeeklyLongformHyperframesRendererError(
        "visual_asset_copy_sha256_mismatch",
      );
    }
    assetTargets.set(asset.key, target);
    copiedAssets.push({
      story_id: asset.story_id,
      source_item_id: asset.source_item_id,
      source_ledger_sha256: asset.source_ledger.observed.sha256,
      source_canonical_ledger_sha256: asset.source_ledger.assessment.sha256,
      source_path: asset.source_path,
      project_path: relativeWebPath(projectDir, target),
      media_type: asset.media_type,
      declared_sha256: asset.declared_sha256,
      observed_sha256: asset.observed_sha256,
      byte_length: asset.byte_length,
      full_bleed: true,
    });
  }

  const scenes = planScenes(validated, rights);
  for (const scene of scenes) {
    await writeAtomic(
      path.join(directories.compositions, `${scene.id}.html`),
      buildSceneHtml({
        scene,
        projectDir,
        assetTarget: assetTargets.get(scene.asset.key),
        sceneCount: scenes.length,
      }),
    );
  }
  const captions = buildCaptionGroups(validated.alignment.words);
  await Promise.all([
    writeAtomic(
      path.join(projectDir, "BRIEF.md"),
      buildBrief(validated, scenes),
    ),
    writeAtomic(path.join(projectDir, "frame.md"), buildFrameDesign()),
    writeAtomic(
      path.join(projectDir, "STORYBOARD.md"),
      buildStoryboard(validated, scenes),
    ),
    writeAtomic(path.join(projectDir, "styles.css"), buildStyles()),
    writeAtomic(
      path.join(projectDir, "timeline.js"),
      buildTimeline({ scenes, captions }),
    ),
    writeAtomic(
      path.join(projectDir, "index.html"),
      buildIndex({
        validated,
        scenes,
        projectDir,
        assetTargets,
        audioTarget,
        captions,
      }),
    ),
    writeAtomic(
      path.join(projectDir, "hyperframes.json"),
      `${JSON.stringify(
        {
          $schema:
            "https://hyperframes.heygen.com/schema/hyperframes.json",
          paths: {
            blocks: "compositions",
            components: "compositions/components",
            assets: "assets",
          },
          media: { autoProxy: false },
        },
        null,
        2,
      )}\n`,
    ),
    writeAtomic(
      path.join(projectDir, "package.json"),
      `${JSON.stringify(
        {
          name: safeId(validated.runId),
          private: true,
          type: "module",
          scripts: {
            check: "hyperframes check",
            render: "hyperframes render",
          },
        },
        null,
        2,
      )}\n`,
    ),
  ]);

  const rightsCopies = [];
  for (const [storyId, source] of rights.ledgerByStory) {
    const target = path.join(
      directories.evidence,
      `${safeId(storyId)}-source-rights.json`,
    );
    const copiedLedger = await copyHashBoundFile(
      source.observed.path,
      target,
      source.observed.sha256,
      "source_rights_ledger",
    );
    rightsCopies.push({
      story_id: storyId,
      source_path: source.observed.path,
      source_sha256: source.observed.sha256,
      canonical_sha256: source.assessment.sha256,
      project_path: relativeWebPath(projectDir, copiedLedger.path),
    });
  }
  rightsCopies.sort((left, right) =>
    left.story_id.localeCompare(right.story_id),
  );
  const sourceRightsManifest = {
    schema_version: "pulse-longform-source-rights-manifest-v1",
    run_id: validated.runId,
    generated_at: validated.generatedAt,
    work_order_sha256: validated.workOrder.work_order_sha256,
    ledgers: rightsCopies,
  };
  await writeAtomic(
    path.join(directories.evidence, "source-rights-manifest.json"),
    `${JSON.stringify(sourceRightsManifest, null, 2)}\n`,
  );

  const projectManifest = {
    schema_version: PROJECT_SCHEMA,
    generated_at: validated.generatedAt,
    generator_identity: GENERATOR_ID,
    run_id: validated.runId,
    mode: "LOCAL_PROOF",
    concept_angle:
      "Full-bleed verified game imagery inside an original Pulse editorial command-centre treatment.",
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      duration_seconds: validated.alignment.duration_seconds,
    },
    bindings: {
      work_order_sha256: validated.workOrder.work_order_sha256,
      script_sha256: validated.script.sha256,
      audio_sha256: validated.audio.sha256,
      alignment_sha256: validated.alignmentFile.sha256,
      visual_beat_plan_sha256: sha256Json(validated.visualBeatPlan),
      derivative_plan_sha256: sha256Json(validated.derivativePlan),
    },
    project_assets: {
      script: relativeWebPath(projectDir, copied.script.path),
      narration_audio: relativeWebPath(projectDir, copied.audio.path),
      word_alignment: relativeWebPath(projectDir, copied.alignment.path),
      gsap_runtime: {
        path: relativeWebPath(projectDir, copied.gsap.path),
        sha256: copied.gsap.sha256,
      },
      fonts: Object.fromEntries(
        Object.entries(copied.fonts).map(([fontId, font]) => [
          fontId,
          {
            path: relativeWebPath(projectDir, font.path),
            sha256: font.sha256,
          },
        ]),
      ),
    },
    scene_count: scenes.length,
    caption_group_count: captions.length,
    assets: copiedAssets,
    motion_contract: {
      rules: [
        "multi-phase-camera",
        "spring-pop-entrance",
        "ambient-glow-bloom",
        "asr-keyword-glow",
      ],
      primary_transition: "push-slide",
      deterministic: true,
      render_time_network_fetches: false,
      unseeded_randomness: false,
    },
    title_safe_zone: {
      left: 104,
      top: 74,
      right: 104,
      bottom: 86,
      full_bleed_media: true,
    },
    capabilities,
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      external_network_authorised: false,
    },
  };
  const projectManifestArtifact = await writeAtomic(
    path.join(projectDir, "project-manifest.json"),
    `${JSON.stringify(projectManifest, null, 2)}\n`,
  );
  const capabilityArtifact = await writeAtomic(
    path.join(validated.outputDir, "hyperframes-capability-report.json"),
    `${JSON.stringify(capabilities, null, 2)}\n`,
  );
  return {
    projectDir,
    directories,
    scenes,
    captions,
    assets: copiedAssets,
    projectManifest,
    projectManifestArtifact,
    capabilityArtifact,
    assetTargets,
  };
}

async function renderGovernedWeeklyLongform(input, options, capabilities) {
  const validated = await validateInput(input);
  const rights = await resolveRightsBoundAssets(validated);
  const project = await materializeProject({
    validated,
    rights,
    capabilities,
    options,
  });

  const checkInvocation = rendererInvocation(
    options,
    "check",
    project.projectDir,
  );
  const checkResult = await invokeRendererProcess(
    options,
    checkInvocation,
  );
  const checkArtifact = await writeAtomic(
    path.join(project.directories.processEvidence, "hyperframes-check.json"),
    `${JSON.stringify(checkResult, null, 2)}\n`,
  );

  const masterPath = path.join(validated.outputDir, "master.mp4");
  const renderInvocationValue = rendererInvocation(
    options,
    "render",
    project.projectDir,
    masterPath,
  );
  const renderResult = await invokeRendererProcess(
    options,
    renderInvocationValue,
  );
  const renderArtifact = await writeAtomic(
    path.join(project.directories.processEvidence, "hyperframes-render.json"),
    `${JSON.stringify(renderResult, null, 2)}\n`,
  );
  await assertMp4(masterPath);
  const master = await observeFile({
    filePath: masterPath,
    expectedSha256: await hashFile(masterPath),
    prefix: "render_master",
  });

  const finalRightsItems = rights.assets
    .map((asset) => ({
      item_id: `${asset.story_id}:${asset.source_item_id}`,
      source_story_id: asset.story_id,
      source_item_id: asset.source_item_id,
      source_ledger_sha256: asset.source_ledger.observed.sha256,
      source_canonical_ledger_sha256:
        asset.source_ledger.assessment.sha256,
      materialized_project_path: relativeWebPath(
        project.projectDir,
        project.assetTargets.get(asset.key),
      ),
      source_url: text(asset.source_item.source_url),
      asset_sha256: asset.observed_sha256,
      included_in_final: true,
      rights_decision: "CLEARED",
      rights_basis: text(asset.source_item.rights_basis).toUpperCase(),
      rights_evidence: {
        reference: text(asset.source_item.rights_evidence?.reference),
        sha256: normaliseSha256(
          asset.source_item.rights_evidence?.sha256,
        ),
      },
      attribution_decision: text(
        asset.source_item.attribution_decision,
      ).toUpperCase(),
      attribution_text: text(asset.source_item.attribution_text) || null,
    }))
    .sort((left, right) => left.item_id.localeCompare(right.item_id));
  const finalRightsLedger = {
    schema_version: RIGHTS_SCHEMA,
    generated_at: validated.generatedAt,
    generator_identity: GENERATOR_ID,
    run_id: validated.runId,
    work_order_sha256: validated.workOrder.work_order_sha256,
    master_sha256: master.sha256,
    ledger_version: 1,
    decision: "CLEARED",
    items: finalRightsItems,
  };
  finalRightsLedger.ledger_sha256 =
    hashRightsLedger(finalRightsLedger);
  const finalRightsAssessment = assessRightsLedger(
    finalRightsLedger,
    finalRightsLedger.ledger_sha256,
  );
  if (finalRightsAssessment.blockers.length) {
    throw new WeeklyLongformHyperframesRendererError(
      finalRightsAssessment.blockers,
    );
  }
  const rightsArtifact = await writeAtomic(
    path.join(validated.outputDir, "longform-rights-ledger.json"),
    `${JSON.stringify(finalRightsLedger, null, 2)}\n`,
  );

  const resultValue = {
    schema_version: RESULT_SCHEMA,
    generated_at: validated.generatedAt,
    generator_identity: GENERATOR_ID,
    run_id: validated.runId,
    status: "MATERIALISED_LOCAL_PROOF",
    renderer: `hyperframes-cli-${text(
      capabilities.dependencies.hyperframes_cli.version,
    )}+gsap`,
    project: {
      path: project.projectDir,
      manifest: {
        path: project.projectManifestArtifact.path,
        sha256: project.projectManifestArtifact.sha256,
      },
    },
    master: {
      path: master.path,
      sha256: master.sha256,
      byte_length: master.byte_length,
    },
    rights: {
      path: rightsArtifact.path,
      sha256: rightsArtifact.sha256,
      byte_length: rightsArtifact.byte_length,
      canonical_sha256: finalRightsLedger.ledger_sha256,
    },
    process_evidence: {
      check: {
        path: checkArtifact.path,
        sha256: checkArtifact.sha256,
      },
      render: {
        path: renderArtifact.path,
        sha256: renderArtifact.sha256,
      },
    },
    capability_report: {
      path: project.capabilityArtifact.path,
      sha256: project.capabilityArtifact.sha256,
    },
    network_used: false,
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
  };
  const resultArtifact = await writeAtomic(
    path.join(validated.outputDir, "hyperframes-render-result.json"),
    `${JSON.stringify(resultValue, null, 2)}\n`,
  );
  return {
    ...resultValue,
    result: {
      path: resultArtifact.path,
      sha256: resultArtifact.sha256,
      byte_length: resultArtifact.byte_length,
    },
  };
}

function createGovernedWeeklyLongformHyperframesRenderer(options = {}) {
  const capabilities =
    inspectWeeklyLongformHyperframesCapabilities(options);
  return {
    capabilities,
    renderLongform: capabilities.ready
      ? async (input) =>
          renderGovernedWeeklyLongform(input, options, capabilities)
      : null,
  };
}

module.exports = {
  CAPABILITIES_SCHEMA,
  GENERATOR_ID,
  MINIMUM_HYPERFRAMES_VERSION,
  PROJECT_SCHEMA,
  RESULT_SCHEMA,
  RIGHTS_SCHEMA,
  WeeklyLongformHyperframesRendererError,
  createGovernedWeeklyLongformHyperframesRenderer,
  inspectWeeklyLongformHyperframesCapabilities,
  sha256Buffer,
};
