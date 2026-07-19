"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  generateStrictElevenLabsNarration,
} = require("./strict-elevenlabs-narration-generator");
const {
  REQUIRED_POLICY_URLS,
  finalizeElevenLabsGenerationRightsLineage,
} = require("./elevenlabs-generation-rights-lineage");
const DEFAULT_POLICY_URLS = REQUIRED_POLICY_URLS;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requireArtifactDir(value) {
  const supplied = clean(value);
  if (!supplied) throw new Error("artifact_dir_missing");
  return path.resolve(supplied);
}

async function captureElevenLabsGenerationRightsWorkbench({
  artifactDir,
  storyId,
  assetId,
  voiceId,
  modelId,
  requestText,
  requestSettings = {},
  targetPlatforms = [],
  policyUrls = DEFAULT_POLICY_URLS,
  outputFormat = "mp3_44100_128",
  requestImpl,
  apiKey,
  now = () => new Date(),
} = {}) {
  const root = requireArtifactDir(artifactDir);
  if (typeof requestImpl !== "function") {
    throw new Error("request_impl_unavailable");
  }
  let ttsGenerationCalls = 0;
  const guardedRequest = async (request) => {
    if (clean(request?.url).includes("/with-timestamps")) {
      ttsGenerationCalls += 1;
      if (ttsGenerationCalls > 1) {
        throw new Error("multiple_tts_generation_calls_forbidden");
      }
    }
    return requestImpl(request);
  };
  const rawNarrationPath = path.join(
    root,
    "audio",
    "elevenlabs-provider-raw.mp3",
  );
  const generation = await generateStrictElevenLabsNarration({
    workspaceRoot: root,
    artifactDir: root,
    storyId,
    assetId,
    voiceId,
    modelId,
    text: requestText,
    outputPath: rawNarrationPath,
    apiKey,
    requestSettings,
    targetPlatforms,
    outputFormat,
    policyUrls,
    now,
    requestImpl: guardedRequest,
    masterAudioFile: async () => ({
      ok: true,
      source: "strict_generation_raw_capture",
      transform: "none",
    }),
  });
  if (ttsGenerationCalls !== 1) {
    throw new Error(`tts_generation_call_count_invalid:${ttsGenerationCalls}`);
  }
  const alignmentPath = generation.timestampPath;
  const alignment = await fs.readJson(alignmentPath);
  await fs.outputJson(alignmentPath, {
    schema: "pulse_elevenlabs_provider_alignment_v1",
    schema_version: 1,
    story_id: clean(storyId),
    asset_id: clean(assetId),
    raw_audio_path: relativePath(root, rawNarrationPath),
    raw_audio_sha256: generation.audio_sha256,
    raw_audio_size_bytes: generation.audio_size_bytes,
    ...alignment,
  }, {
    spaces: 2,
  });

  return {
    verdict: "AMBER",
    receipt: generation.receipt,
    receiptPath: generation.receiptPath,
    rawNarrationPath,
    alignmentPath,
    mode: "LOCAL_PROOF",
    safety: {
      tts_generation_calls: ttsGenerationCalls,
      credentials_persisted: false,
      publishing_triggered: false,
      database_mutated: false,
      oauth_mutated: false,
      token_mutated: false,
      billing_mutated: false,
    },
  };
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function readBoundArtifactFile({
  root,
  realRoot,
  descriptor,
  label,
  blockers,
}) {
  const suppliedPath = clean(descriptor?.path);
  if (!suppliedPath) {
    blockers.push(`${label}_path_missing`);
    return { bytes: Buffer.alloc(0), binding: null };
  }
  const resolvedPath = path.isAbsolute(suppliedPath)
    ? path.resolve(suppliedPath)
    : path.resolve(root, suppliedPath);
  if (!isInsideRoot(root, resolvedPath)) {
    blockers.push(`${label}_outside_artifact_root`);
    return { bytes: Buffer.alloc(0), binding: null };
  }
  if (!(await fs.pathExists(resolvedPath))) {
    blockers.push(`${label}_file_missing`);
    return {
      bytes: Buffer.alloc(0),
      binding: { path: relativePath(root, resolvedPath) },
    };
  }
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    blockers.push(`${label}_not_a_file`);
    return {
      bytes: Buffer.alloc(0),
      binding: { path: relativePath(root, resolvedPath) },
    };
  }
  const realPath = await fs.realpath(resolvedPath);
  if (!isInsideRoot(realRoot, realPath)) {
    blockers.push(`${label}_symlink_outside_artifact_root`);
    return { bytes: Buffer.alloc(0), binding: null };
  }
  const bytes = await fs.readFile(realPath);
  const actualSha256 = sha256(bytes);
  const actualSizeBytes = bytes.length;
  const expectedSha256 = clean(descriptor?.sha256).toLowerCase();
  const expectedSizeBytes = Number(descriptor?.size_bytes);
  if (
    !/^[a-f0-9]{64}$/.test(expectedSha256) ||
    !Number.isInteger(expectedSizeBytes) ||
    expectedSizeBytes <= 0
  ) {
    blockers.push(`${label}_expected_fingerprint_missing`);
    return {
      bytes: Buffer.alloc(0),
      binding: {
        path: relativePath(root, realPath),
        actual_sha256: actualSha256,
        actual_size_bytes: actualSizeBytes,
      },
    };
  }
  if (
    expectedSha256 !== actualSha256 ||
    expectedSizeBytes !== actualSizeBytes
  ) {
    blockers.push(`${label}_stale_fingerprint_mismatch`);
    return {
      bytes: Buffer.alloc(0),
      binding: {
        path: relativePath(root, realPath),
        expected_sha256: expectedSha256,
        expected_size_bytes: expectedSizeBytes,
        actual_sha256: actualSha256,
        actual_size_bytes: actualSizeBytes,
      },
    };
  }
  return {
    bytes,
    binding: {
      path: relativePath(root, realPath),
      sha256: actualSha256,
      size_bytes: actualSizeBytes,
    },
  };
}

async function finalizeElevenLabsGenerationRightsWorkbench({
  artifactDir,
  receiptPath,
  requestText,
  targetPlatforms = [],
  files = {},
  now = () => new Date(),
} = {}) {
  const root = requireArtifactDir(artifactDir);
  await fs.ensureDir(root);
  const realRoot = await fs.realpath(root);
  const blockers = [];
  const descriptors = {
    narration: files.narration,
    word_timestamps: files.wordTimestamps,
    captions: files.captions,
    final_video: files.finalVideo,
  };
  const materialised = {};
  const bindings = {};
  for (const [label, descriptor] of Object.entries(descriptors)) {
    const result = await readBoundArtifactFile({
      root,
      realRoot,
      descriptor,
      label,
      blockers,
    });
    materialised[label] = result.bytes;
    bindings[label] = result.binding;
  }

  const defaultReceiptPath = path.join(
    root,
    "rights",
    "evidence",
    "elevenlabs-generation-receipt.json",
  );
  const suppliedReceiptPath = clean(receiptPath);
  const resolvedReceiptPath = suppliedReceiptPath
    ? path.isAbsolute(suppliedReceiptPath)
      ? path.resolve(suppliedReceiptPath)
      : path.resolve(root, suppliedReceiptPath)
    : defaultReceiptPath;
  let safeReceiptPath = resolvedReceiptPath;
  if (!isInsideRoot(root, resolvedReceiptPath)) {
    blockers.push("generation_receipt_outside_artifact_root");
    safeReceiptPath = path.join(
      root,
      "rights",
      "evidence",
      "__blocked_outside_generation_receipt.json",
    );
  } else if (await fs.pathExists(resolvedReceiptPath)) {
    const realReceiptPath = await fs.realpath(resolvedReceiptPath);
    if (!isInsideRoot(realRoot, realReceiptPath)) {
      blockers.push("generation_receipt_symlink_outside_artifact_root");
      safeReceiptPath = path.join(
        root,
        "rights",
        "evidence",
        "__blocked_outside_generation_receipt.json",
      );
    }
  }
  if (
    blockers.length === 0 &&
    safeReceiptPath === resolvedReceiptPath &&
    (await fs.pathExists(safeReceiptPath))
  ) {
    const receipt = await fs.readJson(safeReceiptPath);
    receipt.mastering_lineage = {
      ...(receipt.mastering_lineage || {}),
      raw_provider_audio_sha256: clean(
        receipt.generation?.raw_provider_audio_sha256,
      ).toLowerCase(),
      raw_provider_audio_size_bytes: Number(
        receipt.generation?.raw_provider_audio_size_bytes,
      ),
      mastered_audio_sha256: sha256(materialised.narration),
      mastered_audio_size_bytes: materialised.narration.length,
      transform_status: "COMPLETE",
      binding_source: "hash_bound_current_narration",
    };
    await fs.outputJson(safeReceiptPath, receipt, { spaces: 2 });
  }

  const finalised = await finalizeElevenLabsGenerationRightsLineage({
    artifactDir: root,
    receiptPath: safeReceiptPath,
    requestText,
    targetPlatforms,
    now,
    finalizeLineage: async ({ rawAudioBytes }) => ({
      masteredAudioInputBytes: rawAudioBytes,
      masteredAudioOutputBytes: materialised.narration,
      finalAudioBytes: materialised.narration,
      wordTimestampsBytes: materialised.word_timestamps,
      captionsBytes: materialised.captions,
      finalVideoBytes: materialised.final_video,
    }),
  });

  const combinedBlockers = [
    ...new Set([...(finalised.evidence.blockers || []), ...blockers]),
  ];
  const workbenchFilesVerified = blockers.length === 0;
  finalised.evidence.workbench = {
    schema: "pulse_elevenlabs_generation_rights_workbench_v1",
    mode: "LOCAL_PROOF",
    files: bindings,
    checks: {
      files_inside_artifact_root: !blockers.some((entry) =>
        entry.includes("outside_artifact_root"),
      ),
      current_file_fingerprints_match: workbenchFilesVerified,
    },
    safety: {
      publishing_triggered: false,
      database_mutated: false,
      oauth_mutated: false,
      token_mutated: false,
      billing_mutated: false,
      credentials_persisted: false,
    },
  };
  finalised.evidence.blockers = combinedBlockers;
  finalised.evidence.checks.every_strict_v3_condition_proven =
    finalised.evidence.checks.every_strict_v3_condition_proven === true &&
    workbenchFilesVerified;
  finalised.evidence.verdict =
    finalised.evidence.checks.every_strict_v3_condition_proven
      ? "GREEN"
      : "AMBER";
  finalised.evidence.commercial_use_allowed =
    finalised.evidence.verdict === "GREEN";
  await fs.outputJson(finalised.evidencePath, finalised.evidence, {
    spaces: 2,
  });

  return {
    ...finalised,
    verdict: finalised.evidence.verdict,
    mode: "LOCAL_PROOF",
    blockers: combinedBlockers,
  };
}

module.exports = {
  DEFAULT_POLICY_URLS,
  captureElevenLabsGenerationRightsWorkbench,
  finalizeElevenLabsGenerationRightsWorkbench,
};
