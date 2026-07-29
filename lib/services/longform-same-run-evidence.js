"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  assessRightsLedger,
} = require("./publication-evidence-gates");

const MANIFEST_SCHEMA = "pulse-longform-same-run-manifest-v1";
const REPORT_SCHEMA = "pulse-longform-same-run-evidence-report-v1";
const TIMESTAMPS_BINDING_SCHEMA =
  "pulse-longform-word-timestamps-binding-v1";
const CAPTION_MANIFEST_SCHEMA = "pulse-longform-caption-manifest-v1";
const RIGHTS_LINEAGE_SCHEMA = "pulse-longform-rights-lineage-v1";
const PLATFORM_VARIANTS_SCHEMA =
  "pulse-longform-platform-variants-binding-v1";
const DECODED_QA_SCHEMA = "pulse-longform-decoded-qa-binding-v1";
const HUMAN_REVIEW_PACKET_SCHEMA =
  "pulse-longform-human-review-packet-v1";
const GENERATOR_ID = "pulse-longform-same-run-evidence-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUIRED_DECODED_QA_CHECKS = [
  "video_decode",
  "audio_decode",
  "captions",
  "av_sync",
  "black_frames",
  "freeze_frames",
  "blur",
  "repetition",
];
const REAL_ALIGNMENT_PROVIDERS = new Set([
  "elevenlabs",
  "whisper",
  "whisperx",
  "assemblyai",
  "deepgram",
  "google_speech_to_text",
  "aws_transcribe",
  "forced_alignment",
  "provider_alignment",
]);
const REAL_TIMING_BASES = new Set([
  "",
  "provider_word_alignment",
  "forced_alignment",
  "speech_to_text_word_alignment",
]);

class LongformSameRunEvidenceError extends Error {
  constructor(codes, message = "longform_same_run_evidence_invalid") {
    const normalised = unique(Array.isArray(codes) ? codes : [codes]);
    super(`${message}: ${normalised.join(", ")}`);
    this.name = "LongformSameRunEvidenceError";
    this.codes = normalised;
  }
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function validateRunId(value) {
  const runId = text(value);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(runId)) {
    throw new LongformSameRunEvidenceError("longform_run_id_invalid");
  }
  return runId;
}

function validateGeneratedAt(value) {
  const generatedAt = text(value);
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    throw new LongformSameRunEvidenceError(
      "longform_generated_at_invalid",
    );
  }
  return new Date(generatedAt).toISOString();
}

function readRequiredFile(filePath, code, { json = false } = {}) {
  const resolvedPath = path.resolve(text(filePath));
  if (
    !filePath ||
    !fs.existsSync(resolvedPath) ||
    !fs.statSync(resolvedPath).isFile()
  ) {
    throw new LongformSameRunEvidenceError(code);
  }
  const bytes = fs.readFileSync(resolvedPath);
  if (bytes.length === 0) {
    throw new LongformSameRunEvidenceError(`${code}_empty`);
  }
  let value;
  if (json) {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new LongformSameRunEvidenceError(`${code}_json_invalid`);
    }
  }
  return {
    path: resolvedPath,
    bytes,
    byte_length: bytes.length,
    sha256: sha256Buffer(bytes),
    value,
  };
}

function normaliseExpectedHash(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function sourceRecord(bound) {
  return {
    path: bound.path,
    sha256: bound.sha256,
    byte_length: bound.byte_length,
  };
}

async function writeJson(filePath, value) {
  const bytes = jsonBytes(value);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
  return sha256Buffer(bytes);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeBytes(filePath, bytes) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
  return sha256Buffer(bytes);
}

function normaliseTranscript(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function assessWordTimestamps({
  timestampsPath,
  runId,
  script,
  narrationAudio,
  generatedAt,
}) {
  if (!timestampsPath) {
    return {
      blockers: ["word_timestamps_missing"],
      bound: null,
      timestamps: null,
    };
  }

  let bound;
  try {
    bound = readRequiredFile(
      timestampsPath,
      "word_timestamps_missing",
      { json: true },
    );
  } catch (error) {
    if (error instanceof LongformSameRunEvidenceError) {
      return {
        blockers: ["word_timestamps_invalid", ...error.codes],
        bound: null,
        timestamps: null,
      };
    }
    throw error;
  }

  const value = bound.value;
  const errors = [];
  if (value?.schema_version !== "pulse-word-timestamps-v1") {
    errors.push("word_timestamps_schema_invalid");
  }
  if (text(value?.run_id) !== runId) {
    errors.push("word_timestamps_run_id_mismatch");
  }
  if (
    normaliseExpectedHash(value?.script_sha256) !== script.sha256
  ) {
    errors.push("word_timestamps_script_sha256_mismatch");
  }
  if (
    normaliseExpectedHash(value?.audio_sha256) !==
    narrationAudio.sha256
  ) {
    errors.push("word_timestamps_audio_sha256_mismatch");
  }
  const alignmentSha256 = normaliseExpectedHash(
    value?.source_alignment_sha256,
  );
  if (!alignmentSha256) {
    errors.push("word_timestamps_source_alignment_sha256_required");
  }
  const provider = text(value?.provider).toLowerCase();
  const declaredTimingBasis = text(value?.timing_basis).toLowerCase();
  if (
    !REAL_ALIGNMENT_PROVIDERS.has(provider) ||
    !REAL_TIMING_BASES.has(declaredTimingBasis)
  ) {
    errors.push("word_timestamps_provider_alignment_required");
  }

  const words = Array.isArray(value?.words) ? value.words : [];
  if (!words.length) {
    errors.push("word_timestamps_words_required");
  }
  const canonicalWords = [];
  let previousEnd = 0;
  for (const [index, word] of words.entries()) {
    const wordText = text(word?.text);
    const start = Number(word?.start_seconds);
    const end = Number(word?.end_seconds);
    if (
      !wordText ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      (index > 0 && start < previousEnd)
    ) {
      errors.push("word_timestamps_timing_invalid");
      break;
    }
    canonicalWords.push({
      text: wordText,
      start_seconds: start,
      end_seconds: end,
    });
    previousEnd = end;
  }
  if (
    Number(value?.word_count) !== words.length ||
    canonicalWords.length !== words.length
  ) {
    errors.push("word_timestamps_word_count_mismatch");
  }
  const scriptText = normaliseTranscript(script.bytes.toString("utf8"));
  const alignedText = normaliseTranscript(
    canonicalWords.map((word) => word.text).join(" "),
  );
  if (scriptText !== alignedText) {
    errors.push("word_timestamps_exact_script_mismatch");
  }

  if (errors.length) {
    return {
      blockers: ["word_timestamps_invalid", ...unique(errors)],
      bound,
      timestamps: null,
    };
  }

  return {
    blockers: [],
    bound,
    timestamps: {
      schema_version: TIMESTAMPS_BINDING_SCHEMA,
      generated_at: generatedAt,
      run_id: runId,
      timing_basis: "provider_word_alignment",
      provider,
      source_alignment_sha256: alignmentSha256,
      source_timestamps_sha256: bound.sha256,
      script_sha256: script.sha256,
      audio_sha256: narrationAudio.sha256,
      exact_script_match: true,
      word_count: canonicalWords.length,
      words: canonicalWords,
    },
  };
}

function buildCaptionCues(words) {
  const cues = [];
  let current = [];
  for (const word of words) {
    const proposed = [...current, word];
    const duration =
      proposed.at(-1).end_seconds - proposed[0].start_seconds;
    if (current.length && (proposed.length > 7 || duration > 3.5)) {
      cues.push(current);
      current = [word];
    } else {
      current = proposed;
    }
  }
  if (current.length) cues.push(current);
  return cues.map((cue, index) => ({
    index: index + 1,
    start_seconds: cue[0].start_seconds,
    end_seconds: cue.at(-1).end_seconds,
    text: cue.map((word) => word.text).join(" "),
  }));
}

function srtTimestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return [hours, minutes, secs]
    .map((value) => String(value).padStart(2, "0"))
    .join(":")
    .concat(",", String(millis).padStart(3, "0"));
}

function renderSrt(cues) {
  return `${cues
    .map(
      (cue) =>
        `${cue.index}\r\n${srtTimestamp(cue.start_seconds)} --> ${srtTimestamp(cue.end_seconds)}\r\n${cue.text}`,
    )
    .join("\r\n\r\n")}\r\n`;
}

function blockedInputAssessment({
  schemaVersion,
  generatedAt,
  runId,
  missingCode,
}) {
  return {
    blockers: [missingCode],
    artifact: {
      schema_version: schemaVersion,
      generated_at: generatedAt,
      generator_identity: GENERATOR_ID,
      run_id: runId,
      status: "BLOCKED",
      ready: false,
      blockers: [missingCode],
    },
  };
}

function readEvidenceJson(filePath, missingCode, invalidCode) {
  if (!filePath) return { bound: null, blockers: [missingCode] };
  try {
    return {
      bound: readRequiredFile(filePath, missingCode, { json: true }),
      blockers: [],
    };
  } catch (error) {
    if (error instanceof LongformSameRunEvidenceError) {
      return {
        bound: null,
        blockers: [invalidCode, ...error.codes],
      };
    }
    throw error;
  }
}

function assessRightsLineage({
  rightsPath,
  runId,
  generatedAt,
  master,
}) {
  const input = readEvidenceJson(
    rightsPath,
    "rights_lineage_missing",
    "rights_lineage_invalid",
  );
  if (!input.bound) {
    const blocked = blockedInputAssessment({
      schemaVersion: RIGHTS_LINEAGE_SCHEMA,
      generatedAt,
      runId,
      missingCode: input.blockers[0],
    });
    blocked.blockers = unique(input.blockers);
    blocked.artifact.blockers = blocked.blockers;
    return blocked;
  }

  const value = input.bound.value;
  const errors = [];
  if (value?.schema_version !== "pulse-longform-rights-ledger-v1") {
    errors.push("rights_lineage_schema_invalid");
  }
  if (text(value?.run_id) !== runId) {
    errors.push("rights_lineage_run_id_mismatch");
  }
  if (normaliseExpectedHash(value?.master_sha256) !== master.sha256) {
    errors.push("rights_lineage_master_sha256_mismatch");
  }
  const assessment = assessRightsLedger(value, value?.ledger_sha256);
  errors.push(...assessment.blockers);
  const blockers = errors.length
    ? ["rights_lineage_invalid", ...unique(errors)]
    : [];

  return {
    blockers,
    artifact: {
      schema_version: RIGHTS_LINEAGE_SCHEMA,
      generated_at: generatedAt,
      generator_identity: GENERATOR_ID,
      run_id: runId,
      status: blockers.length ? "BLOCKED" : "CLEARED",
      ready: blockers.length === 0,
      blockers,
      source: sourceRecord(input.bound),
      bindings: {
        master_sha256: master.sha256,
        canonical_ledger_sha256: assessment.sha256,
        declared_ledger_sha256:
          normaliseExpectedHash(value?.ledger_sha256),
      },
      decision: assessment.decision,
    },
  };
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function assessPlatformVariants({
  platformVariantsPath,
  runId,
  generatedAt,
  master,
}) {
  const input = readEvidenceJson(
    platformVariantsPath,
    "platform_variants_missing",
    "platform_variants_invalid",
  );
  if (!input.bound) {
    const blocked = blockedInputAssessment({
      schemaVersion: PLATFORM_VARIANTS_SCHEMA,
      generatedAt,
      runId,
      missingCode: input.blockers[0],
    });
    blocked.blockers = unique(input.blockers);
    blocked.artifact.blockers = blocked.blockers;
    blocked.artifact.variants = [];
    return blocked;
  }

  const value = input.bound.value;
  const errors = [];
  if (
    value?.schema_version !== "pulse-longform-platform-variants-v1"
  ) {
    errors.push("platform_variants_schema_invalid");
  }
  if (text(value?.run_id) !== runId) {
    errors.push("platform_variants_run_id_mismatch");
  }
  if (normaliseExpectedHash(value?.master_sha256) !== master.sha256) {
    errors.push("platform_variants_master_sha256_mismatch");
  }
  const rawVariants = Array.isArray(value?.variants) ? value.variants : [];
  if (!rawVariants.length) errors.push("platform_variants_items_required");

  const variants = [];
  const seenIds = new Set();
  for (const raw of rawVariants) {
    const id = text(raw?.id);
    const platform = text(raw?.platform).toUpperCase();
    if (!id || seenIds.has(id)) {
      errors.push(
        id
          ? "platform_variant_id_duplicate"
          : "platform_variant_id_required",
      );
    }
    if (id) seenIds.add(id);
    if (!platform) errors.push("platform_variant_platform_required");

    let bound = null;
    try {
      bound = readRequiredFile(
        raw?.path,
        "platform_variant_file_missing",
      );
    } catch (error) {
      if (error instanceof LongformSameRunEvidenceError) {
        errors.push(...error.codes);
      } else {
        throw error;
      }
    }
    const declaredSha256 = normaliseExpectedHash(raw?.sha256);
    if (!declaredSha256) {
      errors.push("platform_variant_sha256_required");
    } else if (bound && declaredSha256 !== bound.sha256) {
      errors.push("platform_variant_sha256_mismatch");
    }
    const width = positiveNumber(raw?.width);
    const height = positiveNumber(raw?.height);
    const durationSeconds = positiveNumber(raw?.duration_seconds);
    if (!width || !height) errors.push("platform_variant_geometry_required");
    if (!durationSeconds) {
      errors.push("platform_variant_duration_required");
    }
    if (
      !text(raw?.container) ||
      !text(raw?.video_codec) ||
      !text(raw?.audio_codec)
    ) {
      errors.push("platform_variant_codec_metadata_required");
    }
    variants.push({
      id,
      platform,
      path: bound?.path || path.resolve(text(raw?.path)),
      declared_sha256: declaredSha256,
      observed_sha256: bound?.sha256 || null,
      sha256_matches:
        Boolean(bound) && declaredSha256 === bound.sha256,
      width,
      height,
      duration_seconds: durationSeconds,
      container: text(raw?.container),
      video_codec: text(raw?.video_codec),
      audio_codec: text(raw?.audio_codec),
    });
  }

  const blockers = errors.length
    ? ["platform_variants_invalid", ...unique(errors)]
    : [];
  return {
    blockers,
    artifact: {
      schema_version: PLATFORM_VARIANTS_SCHEMA,
      generated_at: generatedAt,
      generator_identity: GENERATOR_ID,
      run_id: runId,
      status: blockers.length ? "BLOCKED" : "READY",
      ready: blockers.length === 0,
      blockers,
      source: sourceRecord(input.bound),
      bindings: {
        master_sha256: master.sha256,
      },
      variants,
    },
  };
}

function assessDecodedQa({
  decodedQaPath,
  runId,
  generatedAt,
  master,
}) {
  const input = readEvidenceJson(
    decodedQaPath,
    "decoded_qa_missing",
    "decoded_qa_invalid",
  );
  if (!input.bound) {
    const blocked = blockedInputAssessment({
      schemaVersion: DECODED_QA_SCHEMA,
      generatedAt,
      runId,
      missingCode: input.blockers[0],
    });
    blocked.blockers = unique(input.blockers);
    blocked.artifact.blockers = blocked.blockers;
    blocked.artifact.bindings = {
      master_sha256: master.sha256,
      caption_manifest_sha256: null,
      platform_variants_sha256: null,
    };
    blocked.artifact.decoded_media = null;
    blocked.artifact.checks = {};
    return blocked;
  }

  const value = input.bound.value;
  const errors = [];
  if (value?.schema_version !== "pulse-decoded-qa-v1") {
    errors.push("decoded_qa_schema_invalid");
  }
  if (text(value?.run_id) !== runId) {
    errors.push("decoded_qa_run_id_mismatch");
  }
  if (normaliseExpectedHash(value?.master_sha256) !== master.sha256) {
    errors.push("decoded_qa_master_sha256_mismatch");
  }
  if (value?.complete !== true) errors.push("decoded_qa_incomplete");
  if (text(value?.verdict).toUpperCase() !== "PASS") {
    errors.push("decoded_qa_verdict_not_pass");
  }
  const media = value?.decoded_media || {};
  if (
    !positiveNumber(media.width) ||
    !positiveNumber(media.height) ||
    !positiveNumber(media.duration_seconds) ||
    !text(media.container) ||
    !text(media.video_codec) ||
    !text(media.audio_codec)
  ) {
    errors.push("decoded_qa_media_metadata_incomplete");
  }
  for (const check of REQUIRED_DECODED_QA_CHECKS) {
    if (value?.checks?.[check]?.pass !== true) {
      errors.push(`decoded_qa_check_failed_${check}`);
    }
  }
  const blockers = errors.length
    ? ["decoded_qa_invalid", ...unique(errors)]
    : [];

  return {
    blockers,
    source: input.bound,
    sourceValue: value,
    artifact: {
      schema_version: DECODED_QA_SCHEMA,
      generated_at: generatedAt,
      generator_identity: GENERATOR_ID,
      run_id: runId,
      status: blockers.length ? "BLOCKED" : "PASS",
      ready: blockers.length === 0,
      blockers,
      source: sourceRecord(input.bound),
      bindings: {
        master_sha256: master.sha256,
        caption_manifest_sha256: null,
        platform_variants_sha256: null,
      },
      decoded_media: value?.decoded_media || null,
      checks: value?.checks || {},
    },
  };
}

function renderEvidenceSummary({ manifest, report, humanReviewPacket }) {
  const blockerLines = report.blockers.length
    ? report.blockers.map((blocker) => `  - \`${blocker}\``)
    : ["  - None"];
  return [
    "# Longform Same-Run Evidence",
    "",
    `- Run: \`${report.run_id}\``,
    `- Status: **${report.status}**`,
    `- Mode: **${report.mode}**`,
    `- Same-run core bound: **${report.same_run_core_bound ? "Yes" : "No"}**`,
    `- Machine evidence complete: **${report.machine_evidence_complete ? "Yes" : "No"}**`,
    `- Human review: **${humanReviewPacket.status}**`,
    `- Package SHA-256: \`${manifest.sources.production_package.sha256}\``,
    `- Script SHA-256: \`${manifest.sources.script.sha256}\``,
    `- Narration SHA-256: \`${manifest.sources.narration_audio.sha256}\``,
    `- Master SHA-256: \`${manifest.sources.master.sha256}\``,
    "- External publication authorised: **No**",
    "- Database mutation authorised: **No**",
    "- OAuth mutation authorised: **No**",
    "- Network used: **No**",
    "",
    "## Blockers",
    "",
    ...blockerLines,
    "",
    "This is local proof evidence only. It does not grant upload or publish authority.",
    "",
  ].join("\n");
}

function packageBinding({
  packageValue,
  packageKey,
  observed,
  blockers,
}) {
  const declared = packageValue?.assets?.[packageKey];
  const declaredHash = normaliseExpectedHash(declared?.sha256);
  const hashMatches = declaredHash === observed.sha256;
  const declaredPath = declared?.path
    ? path.resolve(text(declared.path))
    : null;
  const pathMatches = declaredPath === observed.path;
  if (!declaredHash) {
    blockers.push(`package_${packageKey}_sha256_missing_or_invalid`);
  } else if (!hashMatches) {
    blockers.push(`package_${packageKey}_sha256_mismatch`);
  }
  if (!declaredPath) {
    blockers.push(`package_${packageKey}_path_missing`);
  } else if (!pathMatches) {
    blockers.push(`package_${packageKey}_path_mismatch`);
  }
  return {
    declared_path: declaredPath,
    observed_path: observed.path,
    path_matches: pathMatches,
    declared_sha256: declaredHash,
    observed_sha256: observed.sha256,
    sha256_matches: hashMatches,
  };
}

async function materializeLongformSameRunEvidence({
  runId,
  generatedAt,
  packagePath,
  scriptPath,
  audioPath,
  masterPath,
  timestampsPath,
  rightsPath,
  platformVariantsPath,
  decodedQaPath,
  outputDir,
} = {}) {
  const exactRunId = validateRunId(runId);
  const exactGeneratedAt = validateGeneratedAt(generatedAt);
  const outputRoot = path.resolve(text(outputDir));
  if (!outputDir) {
    throw new LongformSameRunEvidenceError(
      "longform_output_dir_required",
    );
  }

  const productionPackage = readRequiredFile(
    packagePath,
    "longform_production_package_missing",
    { json: true },
  );
  const script = readRequiredFile(
    scriptPath,
    "longform_script_missing",
  );
  const narrationAudio = readRequiredFile(
    audioPath,
    "longform_narration_audio_missing",
  );
  const master = readRequiredFile(
    masterPath,
    "longform_master_missing",
  );

  const blockers = [];
  const packageSchemaMatches =
    productionPackage.value?.schema_version ===
    "pulse-longform-production-package-v1";
  if (!packageSchemaMatches) {
    blockers.push("production_package_schema_invalid");
  }
  if (text(productionPackage.value?.run_id) !== exactRunId) {
    blockers.push("production_package_run_id_mismatch");
  }
  const bindings = {
    script: packageBinding({
      packageValue: productionPackage.value,
      packageKey: "script",
      observed: script,
      blockers,
    }),
    narration_audio: packageBinding({
      packageValue: productionPackage.value,
      packageKey: "narration_audio",
      observed: narrationAudio,
      blockers,
    }),
    master: packageBinding({
      packageValue: productionPackage.value,
      packageKey: "master",
      observed: master,
      blockers,
    }),
  };
  const timestampEvidence = assessWordTimestamps({
    timestampsPath,
    runId: exactRunId,
    script,
    narrationAudio,
    generatedAt: exactGeneratedAt,
  });
  const rightsEvidence = assessRightsLineage({
    rightsPath,
    runId: exactRunId,
    generatedAt: exactGeneratedAt,
    master,
  });
  const platformEvidence = assessPlatformVariants({
    platformVariantsPath,
    runId: exactRunId,
    generatedAt: exactGeneratedAt,
    master,
  });
  const decodedEvidence = assessDecodedQa({
    decodedQaPath,
    runId: exactRunId,
    generatedAt: exactGeneratedAt,
    master,
  });
  blockers.push(
    ...timestampEvidence.blockers,
    ...rightsEvidence.blockers,
    ...platformEvidence.blockers,
    ...decodedEvidence.blockers,
  );

  const manifest = {
    schema_version: MANIFEST_SCHEMA,
    generated_at: exactGeneratedAt,
    generator_identity: GENERATOR_ID,
    run_id: exactRunId,
    mode: "LOCAL_PROOF",
    sources: {
      production_package: sourceRecord(productionPackage),
      script: sourceRecord(script),
      narration_audio: sourceRecord(narrationAudio),
      master: sourceRecord(master),
    },
    package_bindings: {
      schema_matches: packageSchemaMatches,
      run_id_matches:
        text(productionPackage.value?.run_id) === exactRunId,
      assets: bindings,
      all_match:
        packageSchemaMatches &&
        text(productionPackage.value?.run_id) === exactRunId &&
        Object.values(bindings).every(
          (binding) =>
            binding.path_matches === true &&
            binding.sha256_matches === true,
        ),
    },
    controls: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    },
  };

  await fsp.mkdir(outputRoot, { recursive: true });
  const paths = {
    manifest: path.join(outputRoot, "longform-run-manifest.json"),
    report: path.join(outputRoot, "longform-same-run-evidence-report.json"),
    captionManifest: path.join(outputRoot, "caption-manifest.json"),
    rightsLineage: path.join(outputRoot, "rights-lineage.json"),
    platformVariants: path.join(outputRoot, "platform-variants.json"),
    decodedQa: path.join(outputRoot, "decoded-qa-binding.json"),
    humanReviewPacket: path.join(outputRoot, "human-review-packet.json"),
    summary: path.join(
      outputRoot,
      "longform-same-run-evidence-summary.md",
    ),
  };
  let timestamps = null;
  let captionManifest = null;
  let captionManifestSha256 = null;
  if (timestampEvidence.timestamps) {
    timestamps = timestampEvidence.timestamps;
    paths.timestamps = path.join(outputRoot, "word-timestamps.json");
    const timestampsSha256 = await writeJson(paths.timestamps, timestamps);
    const cues = buildCaptionCues(timestamps.words);
    const srtBytes = Buffer.from(renderSrt(cues), "utf8");
    paths.srt = path.join(outputRoot, "captions.srt");
    const srtSha256 = await writeBytes(paths.srt, srtBytes);
    captionManifest = {
      schema_version: CAPTION_MANIFEST_SCHEMA,
      generated_at: exactGeneratedAt,
      generator_identity: GENERATOR_ID,
      run_id: exactRunId,
      timing_basis: "provider_word_alignment",
      source: {
        path: timestampEvidence.bound.path,
        sha256: timestampEvidence.bound.sha256,
      },
      bindings: {
        script_sha256: script.sha256,
        audio_sha256: narrationAudio.sha256,
        master_sha256: master.sha256,
        word_timestamps_sha256: timestampsSha256,
      },
      outputs: {
        word_timestamps: {
          path: paths.timestamps,
          sha256: timestampsSha256,
          word_count: timestamps.word_count,
        },
        srt: {
          path: paths.srt,
          sha256: srtSha256,
          cue_count: cues.length,
        },
      },
      ready: true,
      blockers: [],
    };
  } else {
    captionManifest = {
      schema_version: CAPTION_MANIFEST_SCHEMA,
      generated_at: exactGeneratedAt,
      generator_identity: GENERATOR_ID,
      run_id: exactRunId,
      timing_basis: null,
      source: null,
      bindings: {
        script_sha256: script.sha256,
        audio_sha256: narrationAudio.sha256,
        master_sha256: master.sha256,
        word_timestamps_sha256: null,
      },
      outputs: {
        word_timestamps: null,
        srt: null,
      },
      ready: false,
      blockers: timestampEvidence.blockers,
    };
  }
  captionManifestSha256 = await writeJson(
    paths.captionManifest,
    captionManifest,
  );

  const rightsLineage = rightsEvidence.artifact;
  const rightsLineageSha256 = await writeJson(
    paths.rightsLineage,
    rightsLineage,
  );
  const platformVariants = platformEvidence.artifact;
  const platformVariantsSha256 = await writeJson(
    paths.platformVariants,
    platformVariants,
  );
  const decodedQa = decodedEvidence.artifact;
  decodedQa.bindings.caption_manifest_sha256 =
    captionManifestSha256;
  decodedQa.bindings.platform_variants_sha256 =
    platformVariantsSha256;
  const decodedQaSha256 = await writeJson(paths.decodedQa, decodedQa);

  const machineBlockers = unique(blockers);
  const machineEvidenceComplete = machineBlockers.length === 0;
  manifest.evidence_outputs = {
    captions: {
      path: paths.captionManifest,
      sha256: captionManifestSha256,
      ready: captionManifest.ready,
    },
    rights_lineage: {
      path: paths.rightsLineage,
      sha256: rightsLineageSha256,
      ready: rightsLineage.ready,
    },
    platform_variants: {
      path: paths.platformVariants,
      sha256: platformVariantsSha256,
      ready: platformVariants.ready,
    },
    decoded_qa: {
      path: paths.decodedQa,
      sha256: decodedQaSha256,
      ready: decodedQa.ready,
    },
  };
  manifest.machine_evidence_complete = machineEvidenceComplete;
  const manifestSha256 = sha256Buffer(jsonBytes(manifest));

  const humanReviewPacket = {
    schema_version: HUMAN_REVIEW_PACKET_SCHEMA,
    generated_at: exactGeneratedAt,
    generator_identity: GENERATOR_ID,
    run_id: exactRunId,
    mode: "HUMAN_REVIEW",
    status: machineEvidenceComplete
      ? "PENDING_HUMAN_REVIEW"
      : "BLOCKED_MACHINE_EVIDENCE",
    machine_evidence_complete: machineEvidenceComplete,
    machine_blockers: machineBlockers,
    bindings: {
      production_package_sha256: productionPackage.sha256,
      script_sha256: script.sha256,
      audio_sha256: narrationAudio.sha256,
      master_sha256: master.sha256,
      longform_run_manifest_sha256: manifestSha256,
      caption_manifest_sha256: captionManifestSha256,
      rights_lineage_sha256: rightsLineageSha256,
      platform_variants_sha256: platformVariantsSha256,
      decoded_qa_sha256: decodedQaSha256,
    },
    review_checklist: [
      "Watch the complete decoded master from start to finish",
      "Confirm narration, visuals, captions and music remain intelligible",
      "Confirm every included asset is represented in the rights lineage",
      "Confirm title cards, claims and calls to action are suitable for publication",
      "Record approval or rejection against every exact SHA-256 binding",
    ],
    human_decision: null,
    publish_authorised: false,
    external_publish_authorised: false,
  };
  const humanReviewPacketSha256 = await writeJson(
    paths.humanReviewPacket,
    humanReviewPacket,
  );

  const reportBlockers = machineEvidenceComplete
    ? ["human_review_pending"]
    : machineBlockers;
  const report = {
    schema_version: REPORT_SCHEMA,
    generated_at: exactGeneratedAt,
    generator_identity: GENERATOR_ID,
    run_id: exactRunId,
    mode: "LOCAL_PROOF",
    status: machineEvidenceComplete
      ? "MACHINE_EVIDENCE_COMPLETE_AWAITING_HUMAN_REVIEW"
      : "BLOCKED",
    blockers: reportBlockers,
    same_run_core_bound: manifest.package_bindings.all_match,
    machine_evidence_complete: machineEvidenceComplete,
    human_review_status: humanReviewPacket.status,
    evidence: {
      manifest_sha256: manifestSha256,
      human_review_packet_sha256: humanReviewPacketSha256,
    },
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    network_used: false,
  };
  await writeJson(paths.manifest, manifest);
  await writeJson(paths.report, report);
  await writeBytes(
    paths.summary,
    Buffer.from(
      renderEvidenceSummary({
        manifest,
        report,
        humanReviewPacket,
      }),
      "utf8",
    ),
  );

  return {
    manifest,
    report,
    timestamps,
    captionManifest,
    rightsLineage,
    platformVariants,
    decodedQa,
    humanReviewPacket,
    paths,
  };
}

module.exports = {
  GENERATOR_ID,
  LongformSameRunEvidenceError,
  MANIFEST_SCHEMA,
  REPORT_SCHEMA,
  CAPTION_MANIFEST_SCHEMA,
  DECODED_QA_SCHEMA,
  HUMAN_REVIEW_PACKET_SCHEMA,
  PLATFORM_VARIANTS_SCHEMA,
  RIGHTS_LINEAGE_SCHEMA,
  TIMESTAMPS_BINDING_SCHEMA,
  buildCaptionCues,
  materializeLongformSameRunEvidence,
  renderEvidenceSummary,
  renderSrt,
  sha256Buffer,
};
