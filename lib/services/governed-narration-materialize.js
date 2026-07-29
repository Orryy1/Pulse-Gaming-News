"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const { cleanScriptForAlignment } = require("../script-clean");

const execFileAsync = promisify(execFile);

const PLAN_SCHEMA = "pulse-governed-narration-plan-v1";
const MANIFEST_SCHEMA = "pulse-governed-narration-manifest-v1";
const TIMESTAMPS_SCHEMA = "pulse-word-timestamps-v1";
const GENERATOR_ID = "pulse-governed-narration-materialize-v1";
const NARRATOR_VERSION_SCHEMA = "pulse-narrator-version-v1";
const MIN_FINAL_SECONDS = 25;
const MAX_FINAL_SECONDS = 32;
const DEFAULT_DURATION_BAND_ID = "what_changes_short_25_32";
const DURATION_BANDS = Object.freeze({
  [DEFAULT_DURATION_BAND_ID]: Object.freeze({
    min_seconds: MIN_FINAL_SECONDS,
    max_seconds: MAX_FINAL_SECONDS,
  }),
  what_changes_breaking_high_cadence_35_42: Object.freeze({
    min_seconds: 35,
    max_seconds: 42,
  }),
  what_changes_standard_35_42: Object.freeze({
    min_seconds: 35,
    max_seconds: 42,
  }),
});
const TIMING_TOLERANCE_SECONDS = 0.01;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class GovernedNarrationMaterializeError extends Error {
  constructor(
    codes,
    message = "governed_narration_materialize_validation_failed",
  ) {
    const normalised = unique(Array.isArray(codes) ? codes : [codes]);
    super(`${message}: ${normalised.join(", ")}`);
    this.name = "GovernedNarrationMaterializeError";
    this.codes = normalised;
  }
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function text(value) {
  return String(value ?? "").trim();
}

function safeStoryId(value) {
  const storyId = text(value);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(storyId)) {
    throw new GovernedNarrationMaterializeError(
      "narration_story_id_invalid",
    );
  }
  return storyId;
}

function normaliseSha256(value, invalidCode) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  if (!SHA256_PATTERN.test(hash)) {
    throw new GovernedNarrationMaterializeError(invalidCode);
  }
  return hash;
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function planFingerprint(plan) {
  const fingerprinted = { ...(plan || {}) };
  delete fingerprinted.plan_sha256;
  return sha256Buffer(Buffer.from(stableJson(fingerprinted), "utf8"));
}

function deriveNarratorVersion({
  generatorIdentity,
  provider,
  modelId,
  voiceId,
  speed,
} = {}) {
  const identity = {
    schema_version: NARRATOR_VERSION_SCHEMA,
    generator_identity: text(generatorIdentity),
    provider: text(provider).toLowerCase(),
    model_id: text(modelId),
    voice_id: text(voiceId),
    speed: Number(speed).toFixed(6),
  };
  return `pulse-narrator-v1:${sha256Buffer(
    Buffer.from(stableJson(identity), "utf8"),
  )}`;
}

function assertRegularFile(filePath, missingCode) {
  if (
    !filePath ||
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    throw new GovernedNarrationMaterializeError(missingCode);
  }
}

function readBoundFile({
  filePath,
  expectedSha256,
  prefix,
  requireJson = false,
} = {}) {
  const resolvedPath = path.resolve(text(filePath));
  assertRegularFile(resolvedPath, `${prefix}_file_not_found`);
  const expected = normaliseSha256(
    expectedSha256,
    `${prefix}_sha256_invalid`,
  );
  const bytes = fs.readFileSync(resolvedPath);
  if (bytes.length === 0) {
    throw new GovernedNarrationMaterializeError(`${prefix}_file_empty`);
  }
  const observed = sha256Buffer(bytes);
  if (observed !== expected) {
    throw new GovernedNarrationMaterializeError(
      `${prefix}_sha256_mismatch`,
    );
  }
  let value = null;
  if (requireJson) {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new GovernedNarrationMaterializeError(
        `${prefix}_json_invalid`,
      );
    }
  }
  return {
    path: resolvedPath,
    bytes,
    value,
    expected_sha256: expected,
    observed_sha256: observed,
  };
}

function validateIsoTimestamp(value, code) {
  const raw = text(value);
  if (!raw || Number.isNaN(Date.parse(raw))) {
    throw new GovernedNarrationMaterializeError(code);
  }
  return new Date(raw).toISOString();
}

function finiteNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new GovernedNarrationMaterializeError(code);
  }
  return number;
}

function validateAlignmentArrays(alignment) {
  const characters = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (
    !Array.isArray(characters) ||
    !Array.isArray(starts) ||
    !Array.isArray(ends)
  ) {
    throw new GovernedNarrationMaterializeError(
      "narration_alignment_arrays_required",
    );
  }
  if (
    characters.length === 0 ||
    starts.length !== characters.length ||
    ends.length !== characters.length
  ) {
    throw new GovernedNarrationMaterializeError(
      "narration_alignment_array_count_mismatch",
    );
  }

  let previousStart = -Infinity;
  let previousEnd = -Infinity;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const start = Number(starts[index]);
    const end = Number(ends[index]);
    if (
      typeof character !== "string" ||
      Array.from(character).length !== 1
    ) {
      throw new GovernedNarrationMaterializeError(
        "narration_alignment_character_invalid",
      );
    }
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start < previousStart ||
      end < previousEnd
    ) {
      throw new GovernedNarrationMaterializeError(
        "narration_alignment_timing_invalid",
      );
    }
    previousStart = start;
    previousEnd = end;
  }
  return { characters, starts, ends };
}

function buildWordRecords({ alignment, normalisedScript } = {}) {
  const script = cleanScriptForAlignment(normalisedScript);
  if (!script) {
    throw new GovernedNarrationMaterializeError(
      "narration_normalised_script_required",
    );
  }
  const { characters, starts, ends } = validateAlignmentArrays(alignment);
  const alignedText = characters.join("");
  if (alignedText !== script) {
    throw new GovernedNarrationMaterializeError(
      "narration_alignment_text_mismatch",
    );
  }

  const words = [];
  let startIndex = null;
  for (let index = 0; index <= characters.length; index += 1) {
    const character = characters[index];
    const isWhitespace =
      index === characters.length || /\s/u.test(character);
    if (!isWhitespace && startIndex === null) {
      startIndex = index;
    }
    if (isWhitespace && startIndex !== null) {
      const endIndex = index - 1;
      words.push({
        text: characters.slice(startIndex, index).join(""),
        start_seconds: Number(starts[startIndex]),
        end_seconds: Number(ends[endIndex]),
      });
      startIndex = null;
    }
  }
  if (words.length === 0) {
    throw new GovernedNarrationMaterializeError(
      "narration_word_records_required",
    );
  }
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (
      !word.text ||
      !Number.isFinite(word.start_seconds) ||
      !Number.isFinite(word.end_seconds) ||
      word.end_seconds < word.start_seconds ||
      (index > 0 &&
        (word.start_seconds < words[index - 1].start_seconds ||
          word.end_seconds < words[index - 1].end_seconds))
    ) {
      throw new GovernedNarrationMaterializeError(
        "narration_word_timing_invalid",
      );
    }
  }
  return words;
}

async function inspectNarrationAudio(
  filePath,
  { ffprobePath = "ffprobe", probeTimeoutMs = 15000 } = {},
) {
  let result;
  try {
    result = await execFileAsync(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name:format=duration",
        "-of",
        "json",
        filePath,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: probeTimeoutMs,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch {
    throw new GovernedNarrationMaterializeError(
      "narration_audio_ffprobe_failed",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new GovernedNarrationMaterializeError(
      "narration_audio_ffprobe_json_invalid",
    );
  }
  const audioStream = (Array.isArray(parsed?.streams)
    ? parsed.streams
    : []
  ).find((stream) => stream?.codec_type === "audio");
  return {
    duration_seconds: Number(parsed?.format?.duration),
    codec_name: text(audioStream?.codec_name).toLowerCase(),
    has_audio: Boolean(audioStream),
  };
}

function validateAudioInspection(inspection, audioPath) {
  const duration = Number(inspection?.duration_seconds);
  const codecName = text(inspection?.codec_name).toLowerCase();
  const errors = [];
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push("narration_audio_duration_invalid");
  }
  if (inspection?.has_audio !== true) {
    errors.push("narration_audio_stream_required");
  }
  if (path.extname(audioPath).toLowerCase() !== ".mp3") {
    errors.push("narration_audio_must_be_mp3");
  }
  if (codecName !== "mp3") {
    errors.push("narration_audio_codec_must_be_mp3");
  }
  if (errors.length) throw new GovernedNarrationMaterializeError(errors);
  return {
    duration_seconds: duration,
    codec_name: codecName,
    has_audio: true,
  };
}

function validateProviderAttestation({
  expectedProvider,
  expectedVoiceId,
  expectedModelId,
  expectedSpeed,
} = {}) {
  const provider = text(expectedProvider).toLowerCase();
  const voiceId = text(expectedVoiceId);
  const modelId = text(expectedModelId);
  const speed = Number(expectedSpeed);
  const errors = [];
  if (provider !== "elevenlabs") {
    errors.push("narration_expected_provider_must_be_elevenlabs");
  }
  if (!voiceId || voiceId.length > 128) {
    errors.push("narration_expected_voice_id_invalid");
  }
  if (!modelId || modelId.length > 128) {
    errors.push("narration_expected_model_id_invalid");
  }
  if (!Number.isFinite(speed) || speed < 0.7 || speed > 1.2) {
    errors.push("narration_expected_speed_invalid");
  }
  if (errors.length) throw new GovernedNarrationMaterializeError(errors);
  return {
    expected_provider: provider,
    expected_voice_id: voiceId,
    expected_model_id: modelId,
    expected_speed: speed,
    attestation_scope:
      "operator-declared expected generation metadata; not inferred from MP3 bytes",
  };
}

function validateLicenceAttestation({
  licenceEvidenceReference,
  licenceAttestedBy,
  licenceAttestedAt,
} = {}) {
  const evidenceReference = text(licenceEvidenceReference);
  const attestedBy = text(licenceAttestedBy);
  const errors = [];
  if (evidenceReference.length < 12 || evidenceReference.length > 512) {
    errors.push("narration_licence_evidence_reference_invalid");
  }
  if (attestedBy.length < 3 || attestedBy.length > 128) {
    errors.push("narration_licence_attested_by_invalid");
  }
  let attestedAt = null;
  try {
    attestedAt = validateIsoTimestamp(
      licenceAttestedAt,
      "narration_licence_attested_at_invalid",
    );
  } catch (error) {
    if (error instanceof GovernedNarrationMaterializeError) {
      errors.push(...error.codes);
    } else {
      throw error;
    }
  }
  if (errors.length) throw new GovernedNarrationMaterializeError(errors);
  return {
    rights_basis: "LICENSED",
    evidence_reference: evidenceReference,
    attested_by: attestedBy,
    attested_at: attestedAt,
    evidence_scope:
      "operator subscription and permitted-use attestation reference",
  };
}

function validateOutputRoot({ outputDir, storyId }) {
  if (!text(outputDir)) {
    throw new GovernedNarrationMaterializeError(
      "narration_explicit_output_dir_required",
    );
  }
  const explicitOutputDir = path.resolve(outputDir);
  const outputRoot = path.join(explicitOutputDir, storyId);
  return { explicitOutputDir, outputRoot };
}

async function buildGovernedNarrationPlan({
  storyId,
  scriptText,
  scriptSha256,
  audioPath,
  audioSha256,
  alignmentPath,
  alignmentSha256,
  outputDir,
  generatedAt = new Date().toISOString(),
  durationBandId = DEFAULT_DURATION_BAND_ID,
  finalTargetSeconds,
  visualBreathAllowanceSeconds,
  expectedProvider,
  expectedVoiceId,
  expectedModelId,
  expectedSpeed,
  licenceEvidenceReference,
  licenceAttestedBy,
  licenceAttestedAt,
  probeAudio = inspectNarrationAudio,
  ffprobePath,
  probeTimeoutMs,
} = {}) {
  const exactStoryId = safeStoryId(storyId);
  const normalisedScript = cleanScriptForAlignment(scriptText);
  if (!normalisedScript) {
    throw new GovernedNarrationMaterializeError(
      "narration_script_text_required",
    );
  }
  const expectedScriptSha = normaliseSha256(
    scriptSha256,
    "narration_script_sha256_invalid",
  );
  const observedScriptSha = sha256Buffer(
    Buffer.from(normalisedScript, "utf8"),
  );
  if (observedScriptSha !== expectedScriptSha) {
    throw new GovernedNarrationMaterializeError(
      "narration_script_sha256_mismatch",
    );
  }

  const boundAudio = readBoundFile({
    filePath: audioPath,
    expectedSha256: audioSha256,
    prefix: "narration_audio",
  });
  const boundAlignment = readBoundFile({
    filePath: alignmentPath,
    expectedSha256: alignmentSha256,
    prefix: "narration_alignment",
    requireJson: true,
  });
  const words = buildWordRecords({
    alignment: boundAlignment.value,
    normalisedScript,
  });

  if (typeof probeAudio !== "function") {
    throw new GovernedNarrationMaterializeError(
      "narration_audio_probe_required",
    );
  }
  let inspection;
  try {
    inspection = await probeAudio(boundAudio.path, {
      ffprobePath,
      probeTimeoutMs,
    });
  } catch (error) {
    if (error instanceof GovernedNarrationMaterializeError) throw error;
    throw new GovernedNarrationMaterializeError(
      "narration_audio_ffprobe_failed",
    );
  }
  const inspectedAudio = validateAudioInspection(
    inspection,
    boundAudio.path,
  );

  const alignmentEnd = Number(
    boundAlignment.value.character_end_times_seconds.at(-1),
  );
  if (
    alignmentEnd >
    inspectedAudio.duration_seconds + TIMING_TOLERANCE_SECONDS
  ) {
    throw new GovernedNarrationMaterializeError(
      "narration_alignment_exceeds_audio_duration",
    );
  }

  const finalTarget = finiteNumber(
    finalTargetSeconds,
    "narration_final_target_invalid",
  );
  const exactDurationBandId = text(durationBandId);
  const durationBand = DURATION_BANDS[exactDurationBandId];
  if (!durationBand) {
    throw new GovernedNarrationMaterializeError(
      "narration_duration_band_invalid",
    );
  }
  if (
    finalTarget < durationBand.min_seconds ||
    finalTarget > durationBand.max_seconds
  ) {
    throw new GovernedNarrationMaterializeError(
      exactDurationBandId === DEFAULT_DURATION_BAND_ID
        ? "narration_final_target_must_be_25_to_32_seconds"
        : "narration_final_target_outside_named_duration_band",
    );
  }
  const visualBreath = finiteNumber(
    visualBreathAllowanceSeconds,
    "narration_visual_breath_allowance_invalid",
  );
  if (visualBreath < 0) {
    throw new GovernedNarrationMaterializeError(
      "narration_visual_breath_allowance_invalid",
    );
  }
  const requiredVisualBreath = Number(
    Math.max(0, finalTarget - inspectedAudio.duration_seconds).toFixed(6),
  );
  if (
    inspectedAudio.duration_seconds >
    finalTarget + TIMING_TOLERANCE_SECONDS
  ) {
    throw new GovernedNarrationMaterializeError(
      "narration_audio_exceeds_final_target",
    );
  }
  if (
    visualBreath + TIMING_TOLERANCE_SECONDS <
    requiredVisualBreath
  ) {
    throw new GovernedNarrationMaterializeError(
      "narration_visual_breath_allowance_insufficient",
    );
  }

  const provider = validateProviderAttestation({
    expectedProvider,
    expectedVoiceId,
    expectedModelId,
    expectedSpeed,
  });
  const licence = validateLicenceAttestation({
    licenceEvidenceReference,
    licenceAttestedBy,
    licenceAttestedAt,
  });
  const generated = validateIsoTimestamp(
    generatedAt,
    "narration_generated_at_invalid",
  );
  const { explicitOutputDir, outputRoot } = validateOutputRoot({
    outputDir,
    storyId: exactStoryId,
  });

  const plan = {
    schema_version: PLAN_SCHEMA,
    generated_at: generated,
    mode: "DRY_RUN",
    ready: true,
    blockers: [],
    story_id: exactStoryId,
    explicit_output_dir: explicitOutputDir,
    output_root: outputRoot,
    generator_identity: GENERATOR_ID,
    narrator_version: deriveNarratorVersion({
      generatorIdentity: GENERATOR_ID,
      provider: provider.expected_provider,
      modelId: provider.expected_model_id,
      voiceId: provider.expected_voice_id,
      speed: provider.expected_speed,
    }),
    script: {
      text: normalisedScript,
      sha256: observedScriptSha,
      aligned_text_sha256: sha256Buffer(
        Buffer.from(
          boundAlignment.value.characters.join(""),
          "utf8",
        ),
      ),
      exact_alignment_match: true,
      character_count: boundAlignment.value.characters.length,
      word_count: words.length,
    },
    sources: {
      audio: {
        path: boundAudio.path,
        expected_sha256: boundAudio.expected_sha256,
        observed_sha256: boundAudio.observed_sha256,
        media_type: "audio/mpeg",
      },
      alignment: {
        path: boundAlignment.path,
        expected_sha256: boundAlignment.expected_sha256,
        observed_sha256: boundAlignment.observed_sha256,
        schema_shape: "elevenlabs-character-alignment",
      },
    },
    timing: {
      audio_duration_seconds: inspectedAudio.duration_seconds,
      alignment_end_seconds: alignmentEnd,
      duration_band_id: exactDurationBandId,
      final_target_min_seconds: durationBand.min_seconds,
      final_target_max_seconds: durationBand.max_seconds,
      final_target_seconds: finalTarget,
      visual_breath_allowance_seconds: visualBreath,
      required_visual_breath_seconds: requiredVisualBreath,
    },
    provider: {
      ...provider,
      observed_audio_codec: inspectedAudio.codec_name,
    },
    licence,
    words,
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    network_authorised: false,
  };
  plan.plan_sha256 = planFingerprint(plan);
  return plan;
}

function compareConfirmation({
  value,
  expected,
  invalidCode,
  mismatchCode,
  blockers,
} = {}) {
  let confirmed;
  try {
    confirmed = normaliseSha256(value, invalidCode);
  } catch (error) {
    if (error instanceof GovernedNarrationMaterializeError) {
      blockers.push(...error.codes);
      return;
    }
    throw error;
  }
  if (confirmed !== expected) blockers.push(mismatchCode);
}

function validateApplyAuthority({
  applyRequested = false,
  confirmStoryId,
  confirmScriptSha256,
  confirmAudioSha256,
  confirmAlignmentSha256,
  confirmPlanSha256,
  plan,
  env = process.env,
} = {}) {
  const blockers = [];
  if (applyRequested !== true) blockers.push("explicit_apply_required");
  if (plan?.ready !== true) {
    blockers.push("governed_narration_plan_not_ready");
  }
  if (text(confirmStoryId) !== text(plan?.story_id)) {
    blockers.push("story_id_confirmation_mismatch");
  }
  compareConfirmation({
    value: confirmScriptSha256,
    expected: plan?.script?.sha256,
    invalidCode: "script_sha256_confirmation_invalid",
    mismatchCode: "script_sha256_confirmation_mismatch",
    blockers,
  });
  compareConfirmation({
    value: confirmAudioSha256,
    expected: plan?.sources?.audio?.expected_sha256,
    invalidCode: "audio_sha256_confirmation_invalid",
    mismatchCode: "audio_sha256_confirmation_mismatch",
    blockers,
  });
  compareConfirmation({
    value: confirmAlignmentSha256,
    expected: plan?.sources?.alignment?.expected_sha256,
    invalidCode: "alignment_sha256_confirmation_invalid",
    mismatchCode: "alignment_sha256_confirmation_mismatch",
    blockers,
  });
  compareConfirmation({
    value: confirmPlanSha256,
    expected: plan?.plan_sha256,
    invalidCode: "plan_sha256_confirmation_invalid",
    mismatchCode: "plan_sha256_confirmation_mismatch",
    blockers,
  });

  if (text(env.DEPLOYMENT_MODE).toLowerCase() !== "local") {
    blockers.push("local_proof_environment_required");
  }
  const operatingMode = text(
    env.PULSE_OPERATING_MODE || env.OPERATING_MODE,
  ).toUpperCase();
  if (operatingMode !== "HUMAN_REVIEW") {
    blockers.push("human_review_operating_mode_required");
  }
  if (text(env.AUTO_PUBLISH).toLowerCase() !== "false") {
    blockers.push("auto_publish_must_be_false");
  }
  if (
    text(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED).toLowerCase() !==
    "false"
  ) {
    blockers.push("guarded_live_dispatch_must_be_false");
  }
  if (
    text(env.PULSE_EMERGENCY_KILL_SWITCH).toLowerCase() !== "true"
  ) {
    blockers.push("emergency_kill_switch_must_be_tripped");
  }
  return {
    authorised: blockers.length === 0,
    blockers: unique(blockers),
    mode: "HUMAN_REVIEW",
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    network_authorised: false,
  };
}

function assertContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new GovernedNarrationMaterializeError(
      "narration_output_path_outside_explicit_root",
    );
  }
}

async function writeFileAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, contents, { flag: "wx" });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

function renderPlanMarkdown(plan) {
  return [
    "# Governed Narration Materialisation Plan",
    "",
    `- Story: \`${plan.story_id}\``,
    `- Verdict: **${plan.ready ? "READY" : "HOLD"}**`,
    `- Plan SHA-256: \`${plan.plan_sha256}\``,
    `- Script SHA-256: \`${plan.script.sha256}\``,
    `- Audio SHA-256: \`${plan.sources.audio.expected_sha256}\``,
    `- Alignment SHA-256: \`${plan.sources.alignment.expected_sha256}\``,
    `- Characters / words: ${plan.script.character_count} / ${plan.script.word_count}`,
    `- Audio duration: ${plan.timing.audio_duration_seconds.toFixed(6)}s`,
    `- Final target: ${plan.timing.final_target_seconds.toFixed(3)}s`,
    `- Declared visual-breath allowance: ${plan.timing.visual_breath_allowance_seconds.toFixed(3)}s`,
    `- Expected voice: \`${plan.provider.expected_voice_id}\``,
    `- Expected model: \`${plan.provider.expected_model_id}\``,
    `- Expected speed: ${plan.provider.expected_speed}`,
    `- Licence evidence: \`${plan.licence.evidence_reference}\``,
    "- External publication authorised: **No**",
    "- Database mutation authorised: **No**",
    "- OAuth mutation authorised: **No**",
    "- Network authorised: **No**",
    "",
    "Dry-run evidence only. Apply requires exact identity and hash confirmations",
    "plus a local HUMAN_REVIEW environment with the emergency kill switch tripped.",
    "",
  ].join("\n");
}

function renderManifestMarkdown(manifest) {
  return [
    "# Governed Narration Manifest",
    "",
    `- Story: \`${manifest.story_id}\``,
    `- Script SHA-256: \`${manifest.script.sha256}\``,
    `- Words: ${manifest.narration.word_count}`,
    `- Audio duration: ${manifest.narration.duration_seconds.toFixed(6)}s`,
    `- Provider attestation: \`${manifest.narration.provider}\``,
    `- Voice / model / speed: \`${manifest.narration.voice_id}\` / \`${manifest.narration.model_id}\` / ${manifest.narration.speed}`,
    `- Licence evidence: \`${manifest.licence.evidence_reference}\``,
    `- Audio pre/post SHA-256: \`${manifest.sources.audio.pre_apply_sha256}\` / \`${manifest.sources.audio.post_apply_sha256}\``,
    `- Alignment pre/post SHA-256: \`${manifest.sources.alignment.pre_apply_sha256}\` / \`${manifest.sources.alignment.post_apply_sha256}\``,
    `- Word timestamps SHA-256: \`${manifest.outputs.word_timestamps.sha256}\``,
    "- Source audio copied or changed: **No**",
    "- Source alignment copied or changed: **No**",
    "- External publication authorised: **No**",
    "- Network used: **No**",
    "",
  ].join("\n");
}

async function writeGovernedNarrationPlan(plan) {
  const explicitRoot = path.resolve(plan?.explicit_output_dir || "");
  const storyRoot = path.resolve(plan?.output_root || "");
  const expectedStoryRoot = path.join(explicitRoot, plan?.story_id || "");
  if (storyRoot !== expectedStoryRoot) {
    throw new GovernedNarrationMaterializeError(
      "narration_output_root_identity_mismatch",
    );
  }
  assertContained(explicitRoot, storyRoot);
  await fsp.mkdir(storyRoot, { recursive: true });
  const planPath = path.join(
    storyRoot,
    "governed-narration-materialize-plan.json",
  );
  const markdownPath = path.join(
    storyRoot,
    "governed-narration-materialize-plan.md",
  );
  await writeFileAtomic(
    planPath,
    Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8"),
  );
  await writeFileAtomic(
    markdownPath,
    Buffer.from(renderPlanMarkdown(plan), "utf8"),
  );
  return {
    plan_path: planPath,
    markdown_path: markdownPath,
  };
}

function currentSourceHash(source, changedCode) {
  assertRegularFile(source?.path, changedCode);
  return sha256Buffer(fs.readFileSync(source.path));
}

async function materializeGovernedNarration({
  plan,
  authority,
  beforeCommit,
} = {}) {
  if (authority?.authorised !== true) {
    throw new GovernedNarrationMaterializeError(
      authority?.blockers?.length
        ? authority.blockers
        : ["governed_narration_apply_not_authorised"],
      "governed_narration_apply_not_authorised",
    );
  }
  if (plan?.ready !== true || planFingerprint(plan) !== plan?.plan_sha256) {
    throw new GovernedNarrationMaterializeError(
      "governed_narration_plan_integrity_invalid",
    );
  }
  const expectedNarratorVersion = deriveNarratorVersion({
    generatorIdentity: plan.generator_identity,
    provider: plan.provider?.expected_provider,
    modelId: plan.provider?.expected_model_id,
    voiceId: plan.provider?.expected_voice_id,
    speed: plan.provider?.expected_speed,
  });
  if (plan.narrator_version !== expectedNarratorVersion) {
    throw new GovernedNarrationMaterializeError(
      "narration_narrator_version_binding_invalid",
    );
  }
  if (beforeCommit !== undefined && typeof beforeCommit !== "function") {
    throw new GovernedNarrationMaterializeError(
      "narration_before_commit_hook_invalid",
    );
  }

  const explicitRoot = path.resolve(plan.explicit_output_dir);
  const storyRoot = path.resolve(plan.output_root);
  const expectedStoryRoot = path.join(explicitRoot, plan.story_id);
  if (storyRoot !== expectedStoryRoot) {
    throw new GovernedNarrationMaterializeError(
      "narration_output_root_identity_mismatch",
    );
  }
  assertContained(explicitRoot, storyRoot);
  const finalRoot = path.join(storyRoot, "materialized");
  assertContained(storyRoot, finalRoot);
  if (fs.existsSync(finalRoot)) {
    throw new GovernedNarrationMaterializeError(
      "narration_output_already_exists",
    );
  }
  await fsp.mkdir(storyRoot, { recursive: true });
  const stagingRoot = path.join(
    storyRoot,
    `.staging-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
  );
  assertContained(storyRoot, stagingRoot);
  await fsp.mkdir(stagingRoot, { recursive: false });

  let promoted = false;
  try {
    const audioPre = currentSourceHash(
      plan.sources.audio,
      "narration_source_audio_missing_before_apply",
    );
    const alignmentPre = currentSourceHash(
      plan.sources.alignment,
      "narration_source_alignment_missing_before_apply",
    );
    const preErrors = [];
    if (audioPre !== plan.sources.audio.expected_sha256) {
      preErrors.push("narration_source_audio_changed_before_apply");
    }
    if (alignmentPre !== plan.sources.alignment.expected_sha256) {
      preErrors.push("narration_source_alignment_changed_before_apply");
    }
    if (preErrors.length) {
      throw new GovernedNarrationMaterializeError(preErrors);
    }

    const timestamps = {
      schema_version: TIMESTAMPS_SCHEMA,
      story_id: plan.story_id,
      generated_at: plan.generated_at,
      script_sha256: plan.script.sha256,
      source_alignment_sha256:
        plan.sources.alignment.expected_sha256,
      audio_sha256: plan.sources.audio.expected_sha256,
      audio_duration_seconds: plan.timing.audio_duration_seconds,
      character_count: plan.script.character_count,
      word_count: plan.script.word_count,
      words: plan.words,
    };
    const timestampsBytes = Buffer.from(
      `${JSON.stringify(timestamps, null, 2)}\n`,
      "utf8",
    );
    const timestampsPath = path.join(
      stagingRoot,
      "word-timestamps.json",
    );
    await fsp.writeFile(timestampsPath, timestampsBytes, { flag: "wx" });

    if (beforeCommit) {
      await beforeCommit({
        plan,
        stagingRoot,
        timestampsPath,
      });
    }

    const audioPost = currentSourceHash(
      plan.sources.audio,
      "narration_source_audio_missing_after_apply",
    );
    const alignmentPost = currentSourceHash(
      plan.sources.alignment,
      "narration_source_alignment_missing_after_apply",
    );
    const postErrors = [];
    if (audioPost !== audioPre) {
      postErrors.push("narration_source_audio_mutated");
    }
    if (alignmentPost !== alignmentPre) {
      postErrors.push("narration_source_alignment_mutated");
    }
    if (postErrors.length) {
      throw new GovernedNarrationMaterializeError(postErrors);
    }

    const manifest = {
      schema_version: MANIFEST_SCHEMA,
      story_id: plan.story_id,
      generated_at: plan.generated_at,
      generator_identity: GENERATOR_ID,
      plan_sha256: plan.plan_sha256,
      script: {
        sha256: plan.script.sha256,
        aligned_text_sha256: plan.script.aligned_text_sha256,
        exact_alignment_match: true,
        character_count: plan.script.character_count,
      },
      narration: {
        narrator_version: expectedNarratorVersion,
        duration_seconds: plan.timing.audio_duration_seconds,
        duration_band_id: plan.timing.duration_band_id,
        final_target_seconds: plan.timing.final_target_seconds,
        visual_breath_allowance_seconds:
          plan.timing.visual_breath_allowance_seconds,
        word_count: plan.script.word_count,
        provider: plan.provider.expected_provider,
        voice_id: plan.provider.expected_voice_id,
        model_id: plan.provider.expected_model_id,
        speed: plan.provider.expected_speed,
        provider_metadata_basis: "operator_attestation",
      },
      licence: plan.licence,
      sources: {
        audio: {
          path: plan.sources.audio.path,
          expected_sha256: plan.sources.audio.expected_sha256,
          pre_apply_sha256: audioPre,
          post_apply_sha256: audioPost,
          copied: false,
          mutated: false,
        },
        alignment: {
          path: plan.sources.alignment.path,
          expected_sha256: plan.sources.alignment.expected_sha256,
          pre_apply_sha256: alignmentPre,
          post_apply_sha256: alignmentPost,
          copied: false,
          mutated: false,
        },
      },
      outputs: {
        word_timestamps: {
          path: "word-timestamps.json",
          schema_version: TIMESTAMPS_SCHEMA,
          sha256: sha256Buffer(timestampsBytes),
          word_count: plan.script.word_count,
        },
      },
      controls: {
        operating_mode: "HUMAN_REVIEW",
        emergency_kill_switch_tripped: true,
        auto_publish_enabled: false,
        live_dispatch_enabled: false,
        external_publish_authorised: false,
        database_mutation_authorised: false,
        oauth_mutation_authorised: false,
        network_used: false,
      },
    };
    const manifestBytes = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    const manifestPath = path.join(
      stagingRoot,
      "governed-narration-manifest.json",
    );
    const markdownPath = path.join(
      stagingRoot,
      "governed-narration-manifest.md",
    );
    await fsp.writeFile(manifestPath, manifestBytes, { flag: "wx" });
    await fsp.writeFile(
      markdownPath,
      Buffer.from(renderManifestMarkdown(manifest), "utf8"),
      { flag: "wx" },
    );
    await fsp.rename(stagingRoot, finalRoot);
    promoted = true;

    const finalAudioHash = currentSourceHash(
      plan.sources.audio,
      "narration_source_audio_missing_after_promotion",
    );
    const finalAlignmentHash = currentSourceHash(
      plan.sources.alignment,
      "narration_source_alignment_missing_after_promotion",
    );
    const finalErrors = [];
    if (finalAudioHash !== audioPost) {
      finalErrors.push("narration_source_audio_mutated");
    }
    if (finalAlignmentHash !== alignmentPost) {
      finalErrors.push("narration_source_alignment_mutated");
    }
    if (finalErrors.length) {
      throw new GovernedNarrationMaterializeError(finalErrors);
    }

    return {
      manifest,
      timestamps,
      manifest_path: path.join(
        finalRoot,
        "governed-narration-manifest.json",
      ),
      markdown_path: path.join(
        finalRoot,
        "governed-narration-manifest.md",
      ),
      timestamps_path: path.join(finalRoot, "word-timestamps.json"),
      manifest_sha256: sha256Buffer(manifestBytes),
      timestamps_sha256: sha256Buffer(timestampsBytes),
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    };
  } catch (error) {
    if (promoted) {
      await fsp.rm(finalRoot, { recursive: true, force: true });
    } else {
      await fsp.rm(stagingRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

module.exports = {
  DEFAULT_DURATION_BAND_ID,
  DURATION_BANDS,
  GENERATOR_ID,
  GovernedNarrationMaterializeError,
  MANIFEST_SCHEMA,
  MAX_FINAL_SECONDS,
  MIN_FINAL_SECONDS,
  PLAN_SCHEMA,
  TIMESTAMPS_SCHEMA,
  buildGovernedNarrationPlan,
  buildWordRecords,
  deriveNarratorVersion,
  inspectNarrationAudio,
  materializeGovernedNarration,
  planFingerprint,
  renderManifestMarkdown,
  renderPlanMarkdown,
  sha256Buffer,
  validateApplyAuthority,
  writeGovernedNarrationPlan,
};
