"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  validateStoryIntake,
} = require("./governed-final-composite");
const {
  countSpokenWords,
} = require("./short-runtime-planner");

const MODE = "LOCAL_PROOF";
const RESULT_SCHEMA =
  "pulse-governed-owned-programme-pack-result-v1";
const PACK_SCHEMA = "pulse-governed-owned-programme-pack-v1";
const OWNED_MOTION_SCHEMA = "pulse-owned-motion-manifest-v1";
const PROJECT_SCHEMA = "pulse-owned-hyperframes-project-v1";
const PROBE_SCHEMA = "pulse-owned-programme-probe-v1";
const AUTHORED_SCENE_SCHEMA = "pulse-owned-vector-scene-v1";
const GENERATOR_ID = "pulse-governed-owned-programme-pack-v1";
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const DURATION_TOLERANCE_SECONDS = 0.1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{5,127}$/i;
const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ROLE_PATTERN = /^[a-z0-9][a-z0-9_]{2,63}$/;
const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/i;
const HYPERFRAMES_GENERATOR_PATTERN =
  /^hyperframes@(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;
const SUPPORTED_INTAKE_PROFILES = Object.freeze({
  what_changes_breaking_flash_18_24: Object.freeze({
    min_seconds: 18,
    max_seconds: 24,
    min_words: 36,
    max_words: 48,
    reviewed_target_required: true,
    timing_evidence_required: true,
  }),
  what_changes_short_25_32: Object.freeze({
    min_seconds: 25,
    max_seconds: 32,
    min_words: 37,
    max_words: 47,
    reviewed_target_required: false,
  }),
  what_changes_breaking_high_cadence_35_42: Object.freeze({
    min_seconds: 35,
    max_seconds: 42,
    min_words: 100,
    max_words: 120,
    reviewed_target_required: true,
  }),
});
const ALLOWED_LAYOUTS = new Set([
  "BACKBONE",
  "COMPARISON",
  "GRID",
  "IMPACT",
  "OUTRO",
  "TIMELINE",
  "TITLE",
]);
const OPTION_FIELDS = Object.freeze([
  "generatedAt",
  "mode",
  "scenes",
  "storyId",
  "storyIntakeRef",
  "storyRoot",
]);
const STORY_INTAKE_REF_FIELDS = Object.freeze(["path", "sha256"]);
const SCENE_FIELDS = Object.freeze([
  "asset_id",
  "attribution_required",
  "design",
  "duration_seconds",
  "media_type",
  "ownership",
  "provenance",
  "rights_basis",
  "role",
  "start_seconds",
]);
const DESIGN_FIELDS = Object.freeze([
  "accent_colour",
  "headline",
  "layout",
  "schema_version",
  "supporting_text",
]);
const PROVENANCE_FIELDS = Object.freeze([
  "source",
  "third_party_media_used",
  "third_party_music",
]);
const RENDER_RECEIPT_FIELDS = Object.freeze([
  "adapter_id",
  "attribution_required",
  "deterministic",
  "network_used",
  "ownership",
  "rights_basis",
  "third_party_media_used",
  "third_party_music",
]);
const PROGRAMME_RENDER_RECEIPT_FIELDS = Object.freeze([
  ...RENDER_RECEIPT_FIELDS,
  "generator_identity",
]);

class GovernedOwnedProgrammePackError extends Error {
  constructor(codes) {
    const values = [
      ...new Set(
        (Array.isArray(codes) ? codes : [codes]).filter(Boolean),
      ),
    ];
    super(
      `governed_owned_programme_pack_failed: ${values.join(", ")}`,
    );
    this.name = "GovernedOwnedProgrammePackError";
    this.codes = values;
  }
}

function fail(codes) {
  throw new GovernedOwnedProgrammePackError(codes);
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function slashPath(value) {
  return String(value).split(path.sep).join("/");
}

function relativeRecordPath(baseDir, filePath) {
  return slashPath(path.relative(baseDir, filePath));
}

function exactFields(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((field, index) => field !== required[index])
  ) {
    fail(code);
  }
}

function canonicalise(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalise(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function normaliseHash(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function normaliseStoryId(value) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) {
    fail("owned_programme_pack_story_id_invalid");
  }
  return storyId;
}

function normaliseGeneratedAt(value) {
  const generatedAt = text(value);
  if (
    !generatedAt ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    new Date(generatedAt).toISOString() !== generatedAt
  ) {
    fail("owned_programme_pack_generated_at_invalid");
  }
  return generatedAt;
}

function sameResolvedPath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function assertNoSymlinkComponents(candidate, code) {
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  const relative = resolved.slice(parsed.root.length);
  const segments = relative.split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = await fsp.lstat(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) fail(code);
  }
}

async function assertRegularOwnedFile(root, filePath, code) {
  if (!pathWithin(root, filePath)) fail(`${code}_outside_story_root`);
  let stat;
  try {
    stat = await fsp.lstat(filePath);
  } catch {
    fail(`${code}_missing`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${code}_not_regular_file`);
  }
  const realRoot = await fsp.realpath(root);
  const realFile = await fsp.realpath(filePath);
  if (!pathWithin(realRoot, realFile)) {
    fail(`${code}_outside_story_root`);
  }
  return stat;
}

async function readExactStoryIntake({
  storyId,
  storyIntakeRef,
  generatedAt,
}) {
  exactFields(
    storyIntakeRef,
    STORY_INTAKE_REF_FIELDS,
    "owned_programme_pack_story_intake_ref_invalid",
  );
  if (!path.isAbsolute(text(storyIntakeRef.path))) {
    fail("owned_programme_pack_story_intake_path_must_be_absolute");
  }
  const intakePath = path.resolve(storyIntakeRef.path);
  const declaredHash = normaliseHash(
    storyIntakeRef.sha256,
    "owned_programme_pack_story_intake_sha256_invalid",
  );
  let stat;
  try {
    stat = await fsp.lstat(intakePath);
  } catch {
    fail("owned_programme_pack_story_intake_missing");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("owned_programme_pack_story_intake_not_regular_file");
  }
  const intakeBytes = await fsp.readFile(intakePath);
  if (sha256Bytes(intakeBytes) !== declaredHash) {
    fail("owned_programme_pack_story_intake_sha256_mismatch");
  }
  let validated;
  try {
    validated = validateStoryIntake(intakePath);
  } catch (error) {
    fail(
      Array.isArray(error?.codes)
        ? error.codes.map(
            (code) => `owned_programme_pack_${code}`,
          )
        : "owned_programme_pack_story_intake_invalid",
    );
  }
  validateProgrammePackIntakeContract({
    intake: validated.intake,
    scriptSha256: validated.scriptSha256,
    fullScript: validated.fullScript,
    generatedAt,
  });
  if (validated.storyId !== storyId) {
    fail("owned_programme_pack_story_id_mismatch");
  }
  const targetDurationSeconds = Number(
    validated.intake?.contract?.target_duration_seconds,
  );
  if (
    !Number.isFinite(targetDurationSeconds) ||
    targetDurationSeconds <= 0
  ) {
    fail("owned_programme_pack_target_duration_required");
  }
  const postValidationBytes = await fsp.readFile(intakePath);
  if (sha256Bytes(postValidationBytes) !== declaredHash) {
    fail("owned_programme_pack_story_intake_changed_during_validation");
  }
  return {
    ...validated,
    path: intakePath,
    sha256: declaredHash,
    initial_bytes: intakeBytes,
    targetDurationSeconds,
  };
}

function validateProgrammePackIntakeContract({
  intake,
  scriptSha256,
  fullScript,
  generatedAt,
}) {
  const errors = [];
  if (intake?.source_type !== "official") {
    errors.push("owned_programme_pack_story_intake_source_not_official");
  }
  if (
    !Array.isArray(intake?.claims) ||
    intake.claims.length === 0 ||
    intake.claims.some(
      (claim) => typeof claim !== "string" || !claim.trim(),
    )
  ) {
    errors.push("owned_programme_pack_story_intake_claims_missing");
  }
  const contract = intake?.contract;
  const durationBandId = text(contract?.duration_band_id);
  const profile = SUPPORTED_INTAKE_PROFILES[durationBandId] || null;
  if (
    !profile ||
    contract?.editorial_lane_id !== "what_changes_for_players" ||
    contract?.hook_type !== "direct"
  ) {
    errors.push(
      "owned_programme_pack_story_intake_editorial_contract_invalid",
    );
  }
  const targetDurationSeconds = Number(
    contract?.target_duration_seconds,
  );
  if (
    profile &&
    (!Number.isFinite(targetDurationSeconds) ||
      targetDurationSeconds < profile.min_seconds ||
      targetDurationSeconds > profile.max_seconds)
  ) {
    errors.push(
      "owned_programme_pack_story_intake_target_duration_invalid",
    );
  }
  const wordCount = countSpokenWords(fullScript);
  if (
    profile &&
    (wordCount < profile.min_words || wordCount > profile.max_words)
  ) {
    errors.push(
      "owned_programme_pack_story_intake_script_word_count_invalid",
    );
  }
  if (profile?.reviewed_target_required) {
    const review = contract?.target_duration_review;
    const reviewFields = [
      "reviewed_at",
      "reviewed_by",
      "script_sha256",
      "status",
      "target_duration_seconds",
      ...(profile.timing_evidence_required
        ? [
            "narration_alignment_end_seconds",
            "narration_alignment_sha256",
            "narration_audio_duration_seconds",
            "narration_audio_sha256",
            "narration_provider_result_sha256",
            "narration_tail_seconds",
            "narration_timing_evidence_path",
            "narration_timing_evidence_sha256",
          ]
        : []),
    ];
    if (
      !review ||
      typeof review !== "object" ||
      Array.isArray(review) ||
      Object.keys(review).sort().join(",") !==
        reviewFields.sort().join(",")
    ) {
      errors.push(
        "owned_programme_pack_target_duration_review_required",
      );
    } else {
      const reviewedAt = text(review.reviewed_at);
      if (review.status !== "APPROVED") {
        errors.push(
          "owned_programme_pack_target_duration_review_status_invalid",
        );
      }
      if (
        Number(review.target_duration_seconds) !== targetDurationSeconds
      ) {
        errors.push(
          "owned_programme_pack_target_duration_review_target_mismatch",
        );
      }
      if (
        text(review.script_sha256).toLowerCase() !== scriptSha256
      ) {
        errors.push(
          "owned_programme_pack_target_duration_review_script_mismatch",
        );
      }
      if (!text(review.reviewed_by)) {
        errors.push(
          "owned_programme_pack_target_duration_review_actor_required",
        );
      }
      if (
        !Number.isFinite(Date.parse(reviewedAt)) ||
        new Date(reviewedAt).toISOString() !== reviewedAt ||
        Date.parse(reviewedAt) > Date.parse(generatedAt)
      ) {
        errors.push(
          "owned_programme_pack_target_duration_review_time_invalid",
        );
      }
      if (
        profile.timing_evidence_required &&
        (!path.isAbsolute(
          text(review.narration_timing_evidence_path),
        ) ||
          !SHA256_PATTERN.test(
            text(
              review.narration_timing_evidence_sha256,
            ).toLowerCase(),
          ) ||
          !SHA256_PATTERN.test(
            text(review.narration_audio_sha256).toLowerCase(),
          ) ||
          !SHA256_PATTERN.test(
            text(
              review.narration_provider_result_sha256,
            ).toLowerCase(),
          ) ||
          !SHA256_PATTERN.test(
            text(review.narration_alignment_sha256).toLowerCase(),
          ) ||
          !Number.isFinite(
            Number(
              review.narration_audio_duration_seconds,
            ),
          ) ||
          !Number.isFinite(
            Number(
              review.narration_alignment_end_seconds,
            ),
          ) ||
          !Number.isFinite(
            Number(review.narration_tail_seconds),
          ) ||
          Number(review.narration_tail_seconds) < 0 ||
          Number(review.narration_tail_seconds) > 1.5)
      ) {
        errors.push(
          "owned_programme_pack_narration_timing_evidence_invalid",
        );
      }
    }
  }
  if (errors.length) fail(errors);
}

function cleanSceneText(value, code, maximum) {
  const cleaned = text(value);
  if (
    !cleaned ||
    cleaned.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(cleaned)
  ) {
    fail(code);
  }
  return cleaned;
}

function normaliseScene(input, index, storyId, targetDurationSeconds) {
  const prefix = `owned_programme_pack_scene_${index + 1}`;
  exactFields(input, SCENE_FIELDS, `${prefix}_fields_invalid`);
  exactFields(input.design, DESIGN_FIELDS, `${prefix}_design_invalid`);
  exactFields(
    input.provenance,
    PROVENANCE_FIELDS,
    `${prefix}_provenance_invalid`,
  );
  const assetId = text(input.asset_id);
  const role = text(input.role);
  const mediaType = text(input.media_type).toLowerCase();
  const startSeconds = Number(input.start_seconds);
  const durationSeconds = Number(input.duration_seconds);
  if (!ASSET_ID_PATTERN.test(assetId)) fail(`${prefix}_asset_id_invalid`);
  if (!ROLE_PATTERN.test(role)) fail(`${prefix}_role_invalid`);
  if (!["image", "video"].includes(mediaType)) {
    fail(`${prefix}_media_type_invalid`);
  }
  if (
    !Number.isFinite(startSeconds) ||
    startSeconds < 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    startSeconds + durationSeconds >
      targetDurationSeconds + DURATION_TOLERANCE_SECONDS
  ) {
    fail(`${prefix}_timeline_invalid`);
  }
  if (
    text(input.ownership).toLowerCase() !== "owned" ||
    text(input.rights_basis).toUpperCase() !== "OWNED" ||
    input.attribution_required !== false ||
    input.provenance.source !==
      "repository_owned_authored_vector_scene" ||
    input.provenance.third_party_media_used !== false ||
    input.provenance.third_party_music !== false
  ) {
    fail(`${prefix}_owned_provenance_required`);
  }
  if (input.design.schema_version !== AUTHORED_SCENE_SCHEMA) {
    fail(`${prefix}_design_schema_invalid`);
  }
  const accentColour = text(input.design.accent_colour).toUpperCase();
  const layout = text(input.design.layout).toUpperCase();
  if (!/^#[A-F0-9]{6}$/.test(accentColour)) {
    fail(`${prefix}_accent_colour_invalid`);
  }
  if (!ALLOWED_LAYOUTS.has(layout)) {
    fail(`${prefix}_layout_invalid`);
  }
  const scene = {
    asset_id: assetId,
    role,
    media_type: mediaType,
    start_seconds: startSeconds,
    duration_seconds: durationSeconds,
    design: {
      schema_version: AUTHORED_SCENE_SCHEMA,
      headline: cleanSceneText(
        input.design.headline,
        `${prefix}_headline_invalid`,
        96,
      ),
      supporting_text: cleanSceneText(
        input.design.supporting_text,
        `${prefix}_supporting_text_invalid`,
        180,
      ),
      accent_colour: accentColour,
      layout,
    },
    ownership: "owned",
    rights_basis: "OWNED",
    attribution_required: false,
    provenance: {
      source: "repository_owned_authored_vector_scene",
      third_party_media_used: false,
      third_party_music: false,
    },
  };
  return {
    ...scene,
    story_id: storyId,
    authored_input_sha256: sha256Bytes(canonicalJson(scene)),
  };
}

function normaliseScenes(inputs, storyId, targetDurationSeconds) {
  if (!Array.isArray(inputs) || inputs.length < 6) {
    fail("owned_programme_pack_six_authored_scenes_required");
  }
  const scenes = inputs.map((input, index) =>
    normaliseScene(input, index, storyId, targetDurationSeconds),
  );
  const assetIds = new Set(scenes.map((scene) => scene.asset_id));
  const roles = new Set(scenes.map((scene) => scene.role));
  if (assetIds.size !== scenes.length) {
    fail("owned_programme_pack_scene_asset_id_duplicate");
  }
  if (roles.size !== scenes.length) {
    fail("owned_programme_pack_scene_role_duplicate");
  }
  const opening = scenes[0];
  if (
    opening.role !== "hook_slam" ||
    opening.media_type !== "image" ||
    opening.start_seconds !== 0
  ) {
    fail("owned_programme_pack_opening_scene_invalid");
  }
  const backbones = scenes.filter(
    (scene) => scene.role === "owned_motion_backbone",
  );
  if (
    backbones.length !== 1 ||
    backbones[0].media_type !== "video" ||
    backbones[0].start_seconds !== 0 ||
    Math.abs(
      backbones[0].duration_seconds - targetDurationSeconds,
    ) > DURATION_TOLERANCE_SECONDS
  ) {
    fail("owned_programme_pack_exact_backbone_required");
  }
  return scenes.map(deepFreeze);
}

function normaliseRenderReceipt(receipt, code) {
  exactFields(receipt, RENDER_RECEIPT_FIELDS, `${code}_receipt_invalid`);
  const adapterId = text(receipt.adapter_id);
  if (!ADAPTER_ID_PATTERN.test(adapterId)) {
    fail(`${code}_adapter_id_invalid`);
  }
  if (
    receipt.deterministic !== true ||
    text(receipt.ownership).toLowerCase() !== "owned" ||
    text(receipt.rights_basis).toUpperCase() !== "OWNED" ||
    receipt.attribution_required !== false ||
    receipt.third_party_media_used !== false ||
    receipt.third_party_music !== false ||
    receipt.network_used !== false
  ) {
    fail(`${code}_owned_local_provenance_required`);
  }
  return {
    adapter_id: adapterId,
    deterministic: true,
    ownership: "owned",
    rights_basis: "OWNED",
    attribution_required: false,
    third_party_media_used: false,
    third_party_music: false,
    network_used: false,
  };
}

function normaliseHyperframesGeneratorIdentity(value, code) {
  const identity = text(value);
  if (!HYPERFRAMES_GENERATOR_PATTERN.test(identity)) fail(code);
  return identity;
}

function normaliseProgrammeRenderReceipt(
  receipt,
  expectedGeneratorIdentity,
  code,
) {
  exactFields(
    receipt,
    PROGRAMME_RENDER_RECEIPT_FIELDS,
    `${code}_receipt_invalid`,
  );
  const { generator_identity: rawIdentity, ...baseReceipt } = receipt;
  const normalised = normaliseRenderReceipt(baseReceipt, code);
  const generatorIdentity = normaliseHyperframesGeneratorIdentity(
    rawIdentity,
    `${code}_generator_identity_invalid`,
  );
  if (generatorIdentity !== expectedGeneratorIdentity) {
    fail(
      "owned_programme_pack_hyperframes_generator_identity_mismatch",
    );
  }
  return {
    ...normalised,
    generator_identity: generatorIdentity,
  };
}

function parseFrameRate(value) {
  const raw = text(value);
  if (!raw) return null;
  const [numerator, denominator] = raw.split("/").map(Number);
  if (
    Number.isFinite(numerator) &&
    Number.isFinite(denominator) &&
    denominator !== 0
  ) {
    return numerator / denominator;
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function inspectProbe(
  probe,
  { code, mediaType, expectedDurationSeconds },
) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const videoStreams = streams.filter(
    (stream) => text(stream?.codec_type).toLowerCase() === "video",
  );
  const audioStreams = streams.filter(
    (stream) => text(stream?.codec_type).toLowerCase() === "audio",
  );
  const video = videoStreams[0];
  const width = Number(video?.width);
  const height = Number(video?.height);
  const durationSeconds = Number(
    probe?.format?.duration ?? video?.duration,
  );
  const fps = parseFrameRate(
    video?.avg_frame_rate || video?.r_frame_rate,
  );
  const errors = [];
  if (videoStreams.length !== 1) errors.push(`${code}_video_stream_invalid`);
  if (audioStreams.length !== 0) errors.push(`${code}_audio_stream_forbidden`);
  if (width !== WIDTH || height !== HEIGHT) {
    errors.push(`${code}_dimensions_invalid`);
  }
  if (mediaType === "video") {
    if (
      !Number.isFinite(durationSeconds) ||
      Math.abs(durationSeconds - Number(expectedDurationSeconds)) >
        DURATION_TOLERANCE_SECONDS
    ) {
      errors.push(`${code}_duration_invalid`);
    }
    if (!Number.isFinite(fps) || Math.abs(fps - FPS) > 0.01) {
      errors.push(`${code}_fps_invalid`);
    }
  }
  if (errors.length) fail(errors);
  return {
    width,
    height,
    duration_seconds:
      mediaType === "video" ? durationSeconds : null,
    fps: mediaType === "video" ? fps : null,
    video_stream_count: videoStreams.length,
    audio_stream_count: audioStreams.length,
  };
}

async function writeAtomic(filePath, bytes) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fsp.open(temporary, "wx");
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    await fsp.rename(temporary, filePath);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

async function writeJsonAtomic(filePath, value) {
  await writeAtomic(
    filePath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
  );
}

function assetExtension(mediaType) {
  return mediaType === "image" ? ".png" : ".mp4";
}

async function renderDeterministicScene({
  scene,
  stageRoot,
  renderScene,
  probeMedia,
}) {
  const relativePath = path.posix.join(
    "assets",
    `${scene.asset_id}${assetExtension(scene.media_type)}`,
  );
  const outputPath = path.join(stageRoot, ...relativePath.split("/"));
  const verificationPath = path.join(
    stageRoot,
    ".determinism",
    "scenes",
    `${scene.asset_id}${assetExtension(scene.media_type)}`,
  );
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.mkdir(path.dirname(verificationPath), { recursive: true });
  const adapterInput = {
    storyId: scene.story_id,
    scene,
    outputPath,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
  };
  const firstReceipt = normaliseRenderReceipt(
    await renderScene(adapterInput),
    `owned_programme_pack_scene_${scene.asset_id}`,
  );
  await assertRegularOwnedFile(
    stageRoot,
    outputPath,
    `owned_programme_pack_scene_${scene.asset_id}`,
  );
  const firstHash = hashFile(outputPath);
  const verificationReceipt = normaliseRenderReceipt(
    await renderScene({
      ...adapterInput,
      outputPath: verificationPath,
    }),
    `owned_programme_pack_scene_${scene.asset_id}_verification`,
  );
  await assertRegularOwnedFile(
    stageRoot,
    verificationPath,
    `owned_programme_pack_scene_${scene.asset_id}_verification`,
  );
  const verificationHash = hashFile(verificationPath);
  if (
    firstHash !== verificationHash ||
    canonicalJson(firstReceipt) !== canonicalJson(verificationReceipt)
  ) {
    fail(
      `owned_programme_pack_scene_${scene.asset_id}_render_nondeterministic`,
    );
  }
  await fsp.rm(verificationPath, { force: true });
  const observation = inspectProbe(
    await probeMedia({
      filePath: outputPath,
      mediaType: scene.media_type,
      expectedDurationSeconds: scene.duration_seconds,
    }),
    {
      code: `owned_programme_pack_scene_${scene.asset_id}`,
      mediaType: scene.media_type,
      expectedDurationSeconds: scene.duration_seconds,
    },
  );
  if (hashFile(outputPath) !== firstHash) {
    fail(`owned_programme_pack_scene_${scene.asset_id}_changed_during_probe`);
  }
  return {
    scene,
    path: outputPath,
    relative_path: relativePath,
    sha256: firstHash,
    size_bytes: (await fsp.stat(outputPath)).size,
    observation,
    renderer: firstReceipt,
  };
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function numberText(value) {
  return Number(value).toString();
}

function renderHyperframesIndex({
  storyId,
  targetDurationSeconds,
  sceneAssets,
}) {
  const clips = sceneAssets
    .map((asset, index) => {
      const scene = asset.scene;
      const source = slashPath(asset.project_relative_path);
      const common = [
        `id="${htmlEscape(scene.asset_id)}"`,
        'class="clip"',
        `src="${htmlEscape(source)}"`,
        `data-start="${numberText(scene.start_seconds)}"`,
        `data-duration="${numberText(scene.duration_seconds)}"`,
        `data-track-index="${index + 1}"`,
      ].join(" ");
      if (scene.media_type === "video") {
        return `      <video ${common} muted playsinline preload="auto"></video>`;
      }
      return `      <img ${common} alt="" />`;
    })
    .join("\n");
  return [
    "<!doctype html>",
    '<html lang="en" data-resolution="portrait">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=1080, height=1920" />',
    `    <title>${htmlEscape(storyId)} owned programme</title>`,
    '    <script src="node_modules/gsap/dist/gsap.min.js"></script>',
    "    <style>",
    "      html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #080b10; }",
    "      #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; }",
    "      .clip { position: absolute; inset: 0; width: 1080px; height: 1920px; object-fit: cover; }",
    "    </style>",
    "  </head>",
    "  <body>",
    `    <div id="root" data-composition-id="main" data-start="0" data-duration="${numberText(targetDurationSeconds)}" data-fps="30" data-width="1080" data-height="1920">`,
    clips,
    "    </div>",
    '    <script src="timeline.js"></script>',
    "    <script>",
    "      window.__timelines = window.__timelines || {};",
    "      window.__timelines.main = window.createPulseOwnedProgrammeTimeline();",
    "    </script>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function renderTimelineScript() {
  return [
    '"use strict";',
    "",
    "window.createPulseOwnedProgrammeTimeline = function createPulseOwnedProgrammeTimeline() {",
    "  return gsap.timeline({ paused: true });",
    "};",
    "",
  ].join("\n");
}

async function materialiseHyperframesProject({
  stageRoot,
  story,
  generatedAt,
  sceneAssets,
  hyperframesGeneratorIdentity,
}) {
  const projectRoot = path.join(stageRoot, "hyperframes");
  await fsp.mkdir(projectRoot, { recursive: true });
  const projectSceneAssets = [];
  for (const asset of sceneAssets) {
    const code =
      `owned_programme_pack_hyperframes_asset_${asset.scene.asset_id}`;
    await assertRegularOwnedFile(stageRoot, asset.path, code);
    if (hashFile(asset.path) !== asset.sha256) {
      fail(`${code}_source_hash_mismatch`);
    }
    const fileName =
      `${asset.scene.asset_id}${assetExtension(asset.scene.media_type)}`;
    const projectRelativePath = path.posix.join(
      "assets",
      fileName,
    );
    const projectPath = path.join(
      projectRoot,
      ...projectRelativePath.split("/"),
    );
    await fsp.mkdir(path.dirname(projectPath), { recursive: true });
    await fsp.copyFile(
      asset.path,
      projectPath,
      fs.constants.COPYFILE_EXCL,
    );
    const stat = await assertRegularOwnedFile(
      projectRoot,
      projectPath,
      code,
    );
    const projectSha256 = hashFile(projectPath);
    if (
      projectSha256 !== asset.sha256 ||
      hashFile(asset.path) !== asset.sha256
    ) {
      fail(`${code}_copy_hash_mismatch`);
    }
    projectSceneAssets.push({
      ...asset,
      project_path: projectPath,
      project_relative_path: projectRelativePath,
      project_size_bytes: stat.size,
    });
  }
  const primaryFiles = [
    {
      name: "index.html",
      bytes: Buffer.from(
        renderHyperframesIndex({
          storyId: story.storyId,
          targetDurationSeconds: story.targetDurationSeconds,
          sceneAssets: projectSceneAssets,
        }),
        "utf8",
      ),
    },
    {
      name: "hyperframes.json",
      bytes: Buffer.from(
        `${JSON.stringify(
          {
            paths: {
              blocks: "compositions",
              components: "compositions/components",
              assets: "assets",
            },
            media: {
              autoProxy: false,
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
    },
    {
      name: "timeline.js",
      bytes: Buffer.from(renderTimelineScript(), "utf8"),
    },
    {
      name: "package.json",
      bytes: Buffer.from(
        `${JSON.stringify(
          {
            name: `pulse-owned-${story.storyId.toLowerCase()}`,
            private: true,
            scripts: {
              check: "hyperframes check",
              render: "hyperframes render",
            },
            dependencies: {
              gsap: "3.15.0",
            },
            devDependencies: {
              hyperframes:
                HYPERFRAMES_GENERATOR_PATTERN.exec(
                  hyperframesGeneratorIdentity,
                )[1],
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
    },
  ];
  const records = [];
  for (const file of primaryFiles) {
    const filePath = path.join(projectRoot, file.name);
    await writeAtomic(filePath, file.bytes);
    records.push({
      path: filePath,
      relative_path: path.posix.join("hyperframes", file.name),
      sha256: sha256Bytes(file.bytes),
      size_bytes: file.bytes.length,
    });
  }
  for (const asset of projectSceneAssets) {
    records.push({
      path: asset.project_path,
      relative_path: path.posix.join(
        "hyperframes",
        asset.project_relative_path,
      ),
      sha256: asset.sha256,
      size_bytes: asset.project_size_bytes,
    });
  }
  const manifestPath = path.join(projectRoot, "project-manifest.json");
  const manifest = {
    schema_version: PROJECT_SCHEMA,
    generated_at: generatedAt,
    mode: MODE,
    story_id: story.storyId,
    story_intake: {
      sha256: story.sha256,
    },
    composition: {
      id: "main",
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      duration_seconds: story.targetDurationSeconds,
      audio_elements: 0,
      render_time_network_allowed: false,
      generator_identity: hyperframesGeneratorIdentity,
    },
    authored_scene_assets: projectSceneAssets.map((asset) => ({
      asset_id: asset.scene.asset_id,
      role: asset.scene.role,
      path: asset.project_relative_path,
      sha256: asset.sha256,
      authored_input_sha256: asset.scene.authored_input_sha256,
      start_seconds: asset.scene.start_seconds,
      duration_seconds: asset.scene.duration_seconds,
      media_type: asset.scene.media_type,
      ownership: "owned",
      rights_basis: "OWNED",
      attribution_required: false,
      third_party_media_used: false,
      third_party_music: false,
    })),
    project_files: records.map((record) => ({
      path: relativeRecordPath(projectRoot, record.path),
      sha256: record.sha256,
    })),
    authority: {
      network_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      publish_authorised: false,
    },
  };
  await writeJsonAtomic(manifestPath, manifest);
  const manifestRecord = {
    path: manifestPath,
    relative_path: "hyperframes/project-manifest.json",
    sha256: hashFile(manifestPath),
    size_bytes: (await fsp.stat(manifestPath)).size,
  };
  return {
    root: projectRoot,
    manifest,
    manifest_path: manifestPath,
    manifest_sha256: manifestRecord.sha256,
    files: [...records, manifestRecord],
  };
}

async function renderDeterministicProgramme({
  stageRoot,
  story,
  sceneAssets,
  project,
  renderProgramme,
  probeMedia,
  hyperframesGeneratorIdentity,
}) {
  const relativePath = path.posix.join(
    "programme",
    `${story.storyId}-owned-programme.mp4`,
  );
  const outputPath = path.join(stageRoot, ...relativePath.split("/"));
  const verificationPath = path.join(
    stageRoot,
    ".determinism",
    "programme",
    `${story.storyId}-owned-programme.mp4`,
  );
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.mkdir(path.dirname(verificationPath), { recursive: true });
  const stableInput = {
    storyId: story.storyId,
    storyIntakeSha256: story.sha256,
    targetDurationSeconds: story.targetDurationSeconds,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    sceneAssets: sceneAssets.map((asset) => ({
      asset_id: asset.scene.asset_id,
      role: asset.scene.role,
      media_type: asset.scene.media_type,
      start_seconds: asset.scene.start_seconds,
      duration_seconds: asset.scene.duration_seconds,
      path: asset.path,
      sha256: asset.sha256,
      authored_input_sha256: asset.scene.authored_input_sha256,
    })),
    hyperframesProject: {
      root: project.root,
      manifest_path: project.manifest_path,
      manifest_sha256: project.manifest_sha256,
      project_files: project.files.map((record) => ({
        path: record.path,
        sha256: record.sha256,
      })),
    },
  };
  const firstReceipt = normaliseProgrammeRenderReceipt(
    await renderProgramme({
      ...stableInput,
      outputPath,
    }),
    hyperframesGeneratorIdentity,
    "owned_programme_pack_programme",
  );
  if (!/hyperframes/i.test(firstReceipt.adapter_id)) {
    fail("owned_programme_pack_hyperframes_adapter_required");
  }
  await assertRegularOwnedFile(
    stageRoot,
    outputPath,
    "owned_programme_pack_programme",
  );
  const firstHash = hashFile(outputPath);
  const verificationReceipt = normaliseProgrammeRenderReceipt(
    await renderProgramme({
      ...stableInput,
      outputPath: verificationPath,
    }),
    hyperframesGeneratorIdentity,
    "owned_programme_pack_programme_verification",
  );
  await assertRegularOwnedFile(
    stageRoot,
    verificationPath,
    "owned_programme_pack_programme_verification",
  );
  if (
    firstHash !== hashFile(verificationPath) ||
    canonicalJson(firstReceipt) !== canonicalJson(verificationReceipt)
  ) {
    fail("owned_programme_pack_programme_render_nondeterministic");
  }
  await fsp.rm(verificationPath, { force: true });
  const observation = inspectProbe(
    await probeMedia({
      filePath: outputPath,
      mediaType: "video",
      expectedDurationSeconds: story.targetDurationSeconds,
    }),
    {
      code: "owned_programme_pack_programme",
      mediaType: "video",
      expectedDurationSeconds: story.targetDurationSeconds,
    },
  );
  if (hashFile(outputPath) !== firstHash) {
    fail("owned_programme_pack_programme_changed_during_probe");
  }
  if (sceneAssets.some((asset) => asset.sha256 === firstHash)) {
    fail("owned_programme_pack_programme_not_distinct");
  }
  return {
    path: outputPath,
    relative_path: relativePath,
    sha256: firstHash,
    size_bytes: (await fsp.stat(outputPath)).size,
    observation,
    renderer: firstReceipt,
  };
}

async function createProbeEvidence({
  stageRoot,
  story,
  programme,
}) {
  const evidencePath = path.join(
    stageRoot,
    "proof",
    "owned-programme-probe.json",
  );
  const evidence = {
    schema_version: PROBE_SCHEMA,
    generated_at: story.generatedAt,
    mode: MODE,
    story_id: story.storyId,
    verdict: "GREEN",
    blockers: [],
    programme: {
      path: relativeRecordPath(stageRoot, programme.path),
      sha256: programme.sha256,
      size_bytes: programme.size_bytes,
    },
    observation: programme.observation,
    assertions: {
      one_video_stream: true,
      zero_audio_streams: true,
      portrait_1080x1920: true,
      exact_target_duration: true,
      fps_30: true,
    },
    probe_boundary: {
      network_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      publish_authorised: false,
    },
  };
  await writeJsonAtomic(evidencePath, evidence);
  return {
    path: evidencePath,
    sha256: hashFile(evidencePath),
    value: evidence,
  };
}

function sourceAssetRecord({
  manifestDir,
  sceneAsset,
  programme,
}) {
  const scene = sceneAsset.scene;
  return {
    asset_id: scene.asset_id,
    path: relativeRecordPath(manifestDir, sceneAsset.path),
    sha256: sceneAsset.sha256,
    media_type: scene.media_type,
    role: scene.role,
    ownership: "owned",
    width: sceneAsset.observation.width,
    height: sceneAsset.observation.height,
    duration_seconds: sceneAsset.observation.duration_seconds,
    fps: sceneAsset.observation.fps,
    generator_identity: GENERATOR_ID,
    rights_basis: "OWNED",
    attribution_required: false,
    provenance: {
      source: "repository_owned_authored_vector_scene",
      authored_input_sha256: scene.authored_input_sha256,
      renderer_adapter_id: sceneAsset.renderer.adapter_id,
      source_programme_sha256: programme.sha256,
      source_programme_audio_streams: 0,
      third_party_media_used: false,
      third_party_music: false,
    },
  };
}

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, withoutUndefined(nested)]),
    );
  }
  return value;
}

async function createOwnedMotionManifests({
  stageRoot,
  story,
  sceneAssets,
  programme,
  project,
  probeEvidence,
}) {
  const sourceManifestPath = path.join(
    stageRoot,
    "motion",
    "owned-motion-manifest.json",
  );
  const sourceDir = path.dirname(sourceManifestPath);
  const sourceAssets = sceneAssets.map((sceneAsset) =>
    withoutUndefined(
      sourceAssetRecord({
        manifestDir: sourceDir,
        sceneAsset,
        programme,
      }),
    ),
  );
  for (const asset of sourceAssets) {
    asset.provenance.intake_manifest_sha256 = story.sha256;
  }
  const openingAsset = sourceAssets[0];
  const sourceManifest = {
    schema_version: OWNED_MOTION_SCHEMA,
    generated_at: story.generatedAt,
    story_id: story.storyId,
    opening_treatment: {
      role: openingAsset.role,
      first_frame_text: sceneAssets[0].scene.design.headline,
      source: "owned_motion_opening_treatment_v1",
      asset: {
        path: openingAsset.path,
        sha256: openingAsset.sha256,
      },
    },
    assets: sourceAssets,
    combination: {
      mode: MODE,
      source_programme: {
        path: relativeRecordPath(sourceDir, programme.path),
        sha256: programme.sha256,
      },
      source_programme_sha256: programme.sha256,
      source_programme_audio_streams: 0,
      programme_probe: {
        path: relativeRecordPath(sourceDir, probeEvidence.path),
        sha256: probeEvidence.sha256,
      },
      hyperframes_project_manifest: {
        path: relativeRecordPath(sourceDir, project.manifest_path),
        sha256: project.manifest_sha256,
      },
      third_party_media_used: false,
      third_party_music: false,
    },
  };
  await writeJsonAtomic(sourceManifestPath, sourceManifest);
  const sourceManifestSha256 = hashFile(sourceManifestPath);

  const combinedManifestPath = path.join(
    stageRoot,
    "final",
    "combined-owned-motion-manifest.json",
  );
  const combinedDir = path.dirname(combinedManifestPath);
  const rebasedAssets = sourceAssets.map((asset, index) => ({
    ...asset,
    path: relativeRecordPath(combinedDir, sceneAssets[index].path),
  }));
  const backbone = rebasedAssets.find(
    (asset) => asset.role === "owned_motion_backbone",
  );
  const combinedManifest = {
    ...sourceManifest,
    opening_treatment: {
      ...sourceManifest.opening_treatment,
      asset: {
        path: rebasedAssets[0].path,
        sha256: rebasedAssets[0].sha256,
      },
    },
    assets: [
      ...rebasedAssets,
      {
        asset_id: "owned-programme",
        path: relativeRecordPath(combinedDir, programme.path),
        sha256: programme.sha256,
        media_type: "video",
        role: "hyperframes_intermediate",
        ownership: "owned",
        width: programme.observation.width,
        height: programme.observation.height,
        duration_seconds: programme.observation.duration_seconds,
        fps: programme.observation.fps,
        generator_identity:
          programme.renderer.generator_identity,
        rights_basis: "OWNED",
        attribution_required: false,
        provenance: {
          source: "hyperframes_material_stage",
          renderer_adapter_id: programme.renderer.adapter_id,
          source_commit: null,
          source_programme_sha256: programme.sha256,
          source_programme_audio_streams: 0,
          third_party_media_used: false,
          third_party_music: false,
          source_backbone: {
            path: backbone.path,
            sha256: backbone.sha256,
          },
          project_manifest: {
            path: relativeRecordPath(
              combinedDir,
              project.manifest_path,
            ),
            sha256: project.manifest_sha256,
          },
          project_files: project.files.map((record) => ({
            path: relativeRecordPath(combinedDir, record.path),
            sha256: record.sha256,
          })),
          probe_evidence: {
            path: relativeRecordPath(
              combinedDir,
              probeEvidence.path,
            ),
            sha256: probeEvidence.sha256,
          },
        },
      },
    ],
    combination: {
      mode: MODE,
      source_manifest: {
        path: relativeRecordPath(
          combinedDir,
          sourceManifestPath,
        ),
        sha256: sourceManifestSha256,
      },
      source_programme_sha256: programme.sha256,
      source_programme_audio_streams: 0,
      third_party_media_used: false,
      third_party_music: false,
    },
  };
  await writeJsonAtomic(combinedManifestPath, combinedManifest);
  return {
    source: {
      path: sourceManifestPath,
      sha256: sourceManifestSha256,
      value: sourceManifest,
    },
    combined: {
      path: combinedManifestPath,
      sha256: hashFile(combinedManifestPath),
      value: combinedManifest,
    },
  };
}

function renderSummary(pack) {
  return [
    "# Governed owned programme pack",
    "",
    `- Story: \`${pack.story_id}\``,
    `- Mode: **${pack.mode}**`,
    `- Generated: ${pack.generated_at}`,
    `- Owned visual assets: ${pack.owned_visual_assets.length}`,
    `- Programme: ${pack.programme.duration_seconds}s, ${pack.programme.width}×${pack.programme.height}, silent`,
    `- Programme SHA-256: \`${pack.programme.sha256}\``,
    `- Source manifest SHA-256: \`${pack.owned_motion_source_manifest.sha256}\``,
    `- Combined manifest SHA-256: \`${pack.combined_owned_motion_manifest.sha256}\``,
    "- Third-party media: none",
    "- Third-party music: none",
    "- Network use: none",
    "- Database mutation: none",
    "- OAuth or token mutation: none",
    "- No publication authority.",
    "",
  ].join("\n");
}

async function createPackRecords({
  stageRoot,
  story,
  sceneAssets,
  programme,
  project,
  probeEvidence,
  manifests,
}) {
  const packPath = path.join(stageRoot, "owned-programme-pack.json");
  const summaryPath = path.join(stageRoot, "owned-programme-pack.md");
  const pack = {
    schema_version: PACK_SCHEMA,
    generated_at: story.generatedAt,
    mode: MODE,
    story_id: story.storyId,
    story_intake: {
      sha256: story.sha256,
    },
    owned_visual_assets: sceneAssets.map((asset) => ({
      asset_id: asset.scene.asset_id,
      role: asset.scene.role,
      path: relativeRecordPath(stageRoot, asset.path),
      sha256: asset.sha256,
      size_bytes: asset.size_bytes,
      media_type: asset.scene.media_type,
      width: asset.observation.width,
      height: asset.observation.height,
      duration_seconds: asset.observation.duration_seconds,
      authored_input_sha256: asset.scene.authored_input_sha256,
      ownership: "owned",
      rights_basis: "OWNED",
      attribution_required: false,
      third_party_media_used: false,
      third_party_music: false,
    })),
    programme: {
      asset_id: "owned-programme",
      path: relativeRecordPath(stageRoot, programme.path),
      sha256: programme.sha256,
      size_bytes: programme.size_bytes,
      media_type: "video",
      width: programme.observation.width,
      height: programme.observation.height,
      duration_seconds: programme.observation.duration_seconds,
      fps: programme.observation.fps,
      audio_stream_count: programme.observation.audio_stream_count,
      renderer_adapter_id: programme.renderer.adapter_id,
      generator_identity:
        programme.renderer.generator_identity,
      ownership: "owned",
      rights_basis: "OWNED",
      attribution_required: false,
      third_party_media_used: false,
      third_party_music: false,
    },
    programme_probe: {
      path: relativeRecordPath(stageRoot, probeEvidence.path),
      sha256: probeEvidence.sha256,
    },
    hyperframes_project: {
      manifest: {
        path: relativeRecordPath(stageRoot, project.manifest_path),
        sha256: project.manifest_sha256,
      },
      project_files: project.files.map((record) => ({
        path: relativeRecordPath(stageRoot, record.path),
        sha256: record.sha256,
      })),
    },
    owned_motion_source_manifest: {
      path: relativeRecordPath(stageRoot, manifests.source.path),
      sha256: manifests.source.sha256,
    },
    combined_owned_motion_manifest: {
      path: relativeRecordPath(stageRoot, manifests.combined.path),
      sha256: manifests.combined.sha256,
    },
    authority: {
      network_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      publish_authorised: false,
    },
  };
  await writeJsonAtomic(packPath, pack);
  await writeAtomic(
    summaryPath,
    Buffer.from(renderSummary(pack), "utf8"),
  );
  return {
    pack,
    path: packPath,
    sha256: hashFile(packPath),
    summary_path: summaryPath,
    summary_sha256: hashFile(summaryPath),
  };
}

async function collectFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await fsp.readdir(directory, {
      withFileTypes: true,
    })) {
      const entryPath = path.join(directory, entry.name);
      const stat = await fsp.lstat(entryPath);
      if (stat.isSymbolicLink()) {
        fail("owned_programme_pack_output_symlink_forbidden");
      }
      if (stat.isDirectory()) {
        await visit(entryPath);
      } else if (stat.isFile()) {
        files.push(entryPath);
      } else {
        fail("owned_programme_pack_output_type_forbidden");
      }
    }
  }
  await visit(root);
  return files;
}

async function verifyExpectedTree(stageRoot, expectedPaths) {
  const expected = new Set(
    expectedPaths.map((candidate) => path.resolve(candidate)),
  );
  const actual = await collectFiles(stageRoot);
  if (
    actual.length !== expected.size ||
    actual.some((candidate) => !expected.has(path.resolve(candidate)))
  ) {
    fail("owned_programme_pack_unexpected_output_detected");
  }
  for (const candidate of actual) {
    await assertRegularOwnedFile(
      stageRoot,
      candidate,
      "owned_programme_pack_output",
    );
  }
}

function promotePath(stageRoot, storyRoot, candidate) {
  const relative = path.relative(stageRoot, candidate);
  if (!pathWithin(stageRoot, candidate)) {
    fail("owned_programme_pack_result_path_outside_story_root");
  }
  return path.join(storyRoot, relative);
}

async function materialiseToStage({
  options,
  story,
  scenes,
  stageRoot,
  dependencies,
}) {
  const renderScene = dependencies.renderScene;
  const renderProgramme = dependencies.renderProgramme;
  const probeMedia = dependencies.probeMedia;
  if (
    typeof renderScene !== "function" ||
    typeof renderProgramme !== "function" ||
    typeof probeMedia !== "function"
  ) {
    fail("owned_programme_pack_render_probe_adapters_required");
  }
  const hyperframesGeneratorIdentity =
    normaliseHyperframesGeneratorIdentity(
      dependencies.hyperframesGeneratorIdentity,
      "owned_programme_pack_hyperframes_generator_identity_required",
    );

  const sceneAssets = [];
  for (const scene of scenes) {
    sceneAssets.push(
      await renderDeterministicScene({
        scene,
        stageRoot,
        renderScene,
        probeMedia,
      }),
    );
  }
  if (
    new Set(sceneAssets.map((asset) => asset.sha256)).size !==
    sceneAssets.length
  ) {
    fail("owned_programme_pack_distinct_visual_assets_required");
  }
  const project = await materialiseHyperframesProject({
    stageRoot,
    story,
    generatedAt: options.generatedAt,
    sceneAssets,
    hyperframesGeneratorIdentity,
  });
  const programme = await renderDeterministicProgramme({
    stageRoot,
    story,
    sceneAssets,
    project,
    renderProgramme,
    probeMedia,
    hyperframesGeneratorIdentity,
  });
  const probeEvidence = await createProbeEvidence({
    stageRoot,
    story,
    programme,
  });
  const manifests = await createOwnedMotionManifests({
    stageRoot,
    story,
    sceneAssets,
    programme,
    project,
    probeEvidence,
  });
  const packRecords = await createPackRecords({
    stageRoot,
    story,
    sceneAssets,
    programme,
    project,
    probeEvidence,
    manifests,
  });

  const intakeAfter = await fsp.readFile(story.path);
  if (sha256Bytes(intakeAfter) !== story.sha256) {
    fail("owned_programme_pack_story_intake_changed_during_materialisation");
  }
  const hashRecords = [
    ...sceneAssets.map((asset) => ({
      path: asset.path,
      sha256: asset.sha256,
    })),
    ...project.files,
    programme,
    probeEvidence,
    manifests.source,
    manifests.combined,
    {
      path: packRecords.path,
      sha256: packRecords.sha256,
    },
    {
      path: packRecords.summary_path,
      sha256: packRecords.summary_sha256,
    },
  ];
  for (const record of hashRecords) {
    if (hashFile(record.path) !== record.sha256) {
      fail("owned_programme_pack_hash_drift_detected");
    }
  }
  await fsp.rm(path.join(stageRoot, ".determinism"), {
    recursive: true,
    force: true,
  });
  await verifyExpectedTree(
    stageRoot,
    hashRecords.map((record) => record.path),
  );
  return {
    sceneAssets,
    project,
    programme,
    probeEvidence,
    manifests,
    packRecords,
  };
}

async function materialiseGovernedOwnedProgrammePack(
  rawOptions = {},
  dependencies = {},
) {
  exactFields(
    rawOptions,
    OPTION_FIELDS,
    "owned_programme_pack_option_fields_invalid",
  );
  if (rawOptions.mode !== MODE) {
    fail("owned_programme_pack_local_proof_only");
  }
  const storyId = normaliseStoryId(rawOptions.storyId);
  const generatedAt = normaliseGeneratedAt(rawOptions.generatedAt);
  if (!path.isAbsolute(text(rawOptions.storyRoot))) {
    fail("owned_programme_pack_story_root_must_be_absolute");
  }
  const storyRoot = path.resolve(rawOptions.storyRoot);
  if (path.basename(storyRoot) !== storyId) {
    fail("owned_programme_pack_story_root_identity_mismatch");
  }
  const parentRoot = path.dirname(storyRoot);
  await fsp.mkdir(parentRoot, { recursive: true });
  await assertNoSymlinkComponents(
    parentRoot,
    "owned_programme_pack_output_parent_symlink_forbidden",
  );
  const realParent = await fsp.realpath(parentRoot);
  if (!sameResolvedPath(realParent, parentRoot)) {
    fail("owned_programme_pack_output_parent_alias_forbidden");
  }
  if (fs.existsSync(storyRoot)) {
    fail("owned_programme_pack_story_root_already_exists");
  }
  const story = await readExactStoryIntake({
    storyId,
    storyIntakeRef: rawOptions.storyIntakeRef,
    generatedAt,
  });
  story.generatedAt = generatedAt;
  const scenes = normaliseScenes(
    rawOptions.scenes,
    storyId,
    story.targetDurationSeconds,
  );

  const lockPath = path.join(
    parentRoot,
    `.${storyId}.owned-programme-pack.lock`,
  );
  let lockHandle;
  try {
    lockHandle = await fsp.open(lockPath, "wx");
    await lockHandle.writeFile(
      Buffer.from(`${storyId}\n${generatedAt}\n`, "utf8"),
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("owned_programme_pack_story_root_locked");
    }
    throw error;
  }
  const stageRoot = path.join(
    parentRoot,
    `.op-${process.pid}-${crypto.randomUUID()}`,
  );
  let staged;
  try {
    if (fs.existsSync(storyRoot)) {
      fail("owned_programme_pack_story_root_already_exists");
    }
    await fsp.mkdir(stageRoot);
    staged = await materialiseToStage({
      options: {
        ...rawOptions,
        generatedAt,
      },
      story,
      scenes,
      stageRoot,
      dependencies,
    });
    await assertNoSymlinkComponents(
      parentRoot,
      "owned_programme_pack_output_parent_symlink_forbidden",
    );
    if (fs.existsSync(storyRoot)) {
      fail("owned_programme_pack_story_root_already_exists");
    }
    await fsp.rename(stageRoot, storyRoot);
  } catch (error) {
    await fsp.rm(stageRoot, { recursive: true, force: true });
    throw error;
  } finally {
    if (lockHandle) await lockHandle.close();
    await fsp.rm(lockPath, { force: true });
    await fsp.rm(stageRoot, { recursive: true, force: true });
  }

  const promotedAssets = staged.sceneAssets.map((asset) => ({
    asset_id: asset.scene.asset_id,
    role: asset.scene.role,
    media_type: asset.scene.media_type,
    path: promotePath(stageRoot, storyRoot, asset.path),
    sha256: asset.sha256,
    size_bytes: asset.size_bytes,
    authored_input_sha256: asset.scene.authored_input_sha256,
  }));
  const promotedProjectFiles = staged.project.files.map((record) => ({
    path: promotePath(stageRoot, storyRoot, record.path),
    sha256: record.sha256,
    size_bytes: record.size_bytes,
  }));
  return Object.freeze({
    schema_version: RESULT_SCHEMA,
    generated_at: generatedAt,
    mode: MODE,
    story_id: storyId,
    story_root: storyRoot,
    story_intake_sha256: story.sha256,
    owned_visual_assets: promotedAssets,
    source_manifest_path: promotePath(
      stageRoot,
      storyRoot,
      staged.manifests.source.path,
    ),
    source_manifest_sha256: staged.manifests.source.sha256,
    combined_manifest_path: promotePath(
      stageRoot,
      storyRoot,
      staged.manifests.combined.path,
    ),
    combined_manifest_sha256: staged.manifests.combined.sha256,
    programme_path: promotePath(
      stageRoot,
      storyRoot,
      staged.programme.path,
    ),
    programme_sha256: staged.programme.sha256,
    programme_probe_path: promotePath(
      stageRoot,
      storyRoot,
      staged.probeEvidence.path,
    ),
    programme_probe_sha256: staged.probeEvidence.sha256,
    project_manifest_path: promotePath(
      stageRoot,
      storyRoot,
      staged.project.manifest_path,
    ),
    project_manifest_sha256: staged.project.manifest_sha256,
    hyperframes_project_files: promotedProjectFiles,
    result_path: promotePath(
      stageRoot,
      storyRoot,
      staged.packRecords.path,
    ),
    result_sha256: staged.packRecords.sha256,
    summary_path: promotePath(
      stageRoot,
      storyRoot,
      staged.packRecords.summary_path,
    ),
    summary_sha256: staged.packRecords.summary_sha256,
    publish_authorised: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    network_used: false,
  });
}

module.exports = {
  GovernedOwnedProgrammePackError,
  PACK_SCHEMA,
  PROBE_SCHEMA,
  PROJECT_SCHEMA,
  RESULT_SCHEMA,
  materialiseGovernedOwnedProgrammePack,
};
