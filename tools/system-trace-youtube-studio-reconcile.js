#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  assertExactDeferredRedReceipt,
  assertExactDeferredGreenProof,
  executeDeferredSystemTraceYouTubeStudioReconciliation,
  executeSystemTraceYouTubeStudioReconcile,
  verifyExactSystemTraceYouTubeStudioVideo,
} = require("../lib/services/system-trace-youtube-studio-reconcile");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_EVIDENCE_ROOT = String.raw`D:\pulse-evidence\system-trace-youtube-buffer-20260814`;

function clean(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    confirmStoryId: null,
    videoId: null,
    applyReconcile: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--confirm-story-id") parsed.confirmStoryId = argv[++index] || null;
    else if (arg === "--video-id") parsed.videoId = argv[++index] || null;
    else if (arg === "--apply-reconcile") parsed.applyReconcile = true;
    else throw new Error(`unknown_argument:${arg}`);
  }
  return parsed;
}

function usage() {
  return [
    "Usage: node tools/system-trace-youtube-studio-reconcile.js [options]",
    "",
    "Required:",
    "  --confirm-story-id <id>  Exact closed-buffer story acknowledgement",
    "  --video-id <id>          Exact YouTube Studio-created private video ID",
    "  --apply-reconcile        Verify, and only if needed repair defaultLanguage",
  ].join("\n");
}

function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function readRegularJson(file, label) {
  const requested = path.resolve(file);
  const stat = await fs.lstat(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_file`);
  }
  const realPath = await fs.realpath(requested);
  try {
    return {
      document: JSON.parse(await fs.readFile(realPath, "utf8")),
      realPath,
    };
  } catch {
    throw new Error(`${label}_must_be_valid_json`);
  }
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function assertPackContract(pack, episode) {
  const request = pack?.youtube_upload_request;
  const snippet = request?.snippet;
  const status = request?.status;
  const blockers = [];
  if (
    pack?.schema_version !== 1 ||
    pack?.story_id !== episode.story_id ||
    pack?.platform !== "youtube_shorts"
  ) blockers.push("publish_pack_identity_mismatch");
  if (
    pack?.title !== episode.title ||
    pack?.description !== episode.description ||
    snippet?.title !== episode.title ||
    snippet?.description !== episode.description ||
    JSON.stringify(snippet?.tags) !== JSON.stringify(episode.tags)
  ) blockers.push("publish_pack_metadata_mismatch");
  if (
    request?.notifySubscribers !== false ||
    snippet?.categoryId !== "20" ||
    snippet?.defaultLanguage !== "en-GB" ||
    snippet?.defaultAudioLanguage !== "en-GB" ||
    status?.privacyStatus !== "private" ||
    status?.selfDeclaredMadeForKids !== false ||
    status?.containsSyntheticMedia !== true ||
    status?.license !== "youtube" ||
    status?.embeddable !== true ||
    status?.publicStatsViewable !== true
  ) blockers.push("publish_pack_settings_mismatch");
  if (!clean(request?.video_file) || !/^[a-f0-9]{64}$/.test(clean(request?.video_sha256))) {
    blockers.push("publish_pack_video_binding_missing");
  }
  if (blockers.length) {
    const error = new Error("system_trace_youtube_studio_pack_blocked");
    error.blockers = blockers;
    throw error;
  }
}

async function currentAuthenticatedGoogleYouTubeClientFactory() {
  const { google } = require("googleapis");
  const { getAuthClient, inspectAuthStatus } = require("../upload_youtube");
  const status = await inspectAuthStatus();
  if (status?.enabled !== true || status?.refresh_available !== true) {
    throw new Error("youtube_auth_must_be_current_before_studio_reconcile");
  }
  const auth = await getAuthClient();
  return google.youtube({ version: "v3", auth });
}

function receiptReplayIsExact(receipt, intent) {
  return (
    receipt?.schema_version === 1 &&
    receipt?.story_id === intent.story_id &&
    receipt?.platform === "youtube" &&
    receipt?.verdict === "GREEN" &&
    receipt?.status === "PRIVATE_VERIFIED" &&
    receipt?.retry_allowed === false &&
    receipt?.studio_ingest === true &&
    receipt?.authority?.action_id === intent.authority_action_id &&
    receipt?.platform_object?.video_id === intent.video_id &&
    receipt?.platform_object?.privacy_status === "private" &&
    receipt?.requests?.video?.media_sha256 === intent.video_sha256
  );
}

async function writeReceipt(file, receipt, { exclusive = false } = {}) {
  await fs.writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: exclusive ? "wx" : "w",
  });
}

async function main(
  argv = process.argv.slice(2),
  {
    repoRoot = DEFAULT_REPO_ROOT,
    evidenceRoot = DEFAULT_EVIDENCE_ROOT,
    authenticatedYoutubeClientFactory = currentAuthenticatedGoogleYouTubeClientFactory,
    log = console.log,
  } = {},
) {
  const args = parseArgs(argv);
  if (args.applyReconcile !== true) {
    throw new Error("system_trace_youtube_studio_explicit_apply_required");
  }
  const storyId = clean(args.confirmStoryId);
  const videoId = clean(args.videoId);
  if (!storyId) throw new Error("confirm_story_id_required");
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(videoId)) throw new Error("video_id_invalid");

  const fixedRepoRoot = await fs.realpath(path.resolve(repoRoot));
  const manifestInput = await readRegularJson(
    path.join(fixedRepoRoot, "videos", "system-trace-youtube-buffer.json"),
    "fixed_manifest",
  );
  const manifest = manifestInput.document;
  const episode = manifest?.episodes?.find((candidate) => candidate?.story_id === storyId);
  if (
    manifest?.schema !== "pulse_system_trace_youtube_buffer_v1" ||
    manifest?.schema_version !== 1 ||
    manifest?.channel?.id !== "UCvgNDjtTezrpxL8oUe6mYwA" ||
    !episode
  ) throw new Error("system_trace_youtube_studio_manifest_story_blocked");

  const packageRoot = await fs.realpath(path.resolve(fixedRepoRoot, episode.project_dir));
  const expectedPackageRoot = path.resolve(fixedRepoRoot, "videos", storyId);
  if (!samePath(packageRoot, expectedPackageRoot)) {
    throw new Error("system_trace_youtube_studio_package_story_mismatch");
  }
  const packInput = await readRegularJson(
    path.join(packageRoot, "youtube_publish_pack.json"),
    "publish_pack",
  );
  if (!pathInside(packageRoot, packInput.realPath)) {
    throw new Error("publish_pack_must_be_inside_package");
  }
  assertPackContract(packInput.document, episode);

  const fixedEvidenceRoot = path.resolve(evidenceRoot);
  const authorityInput = await readRegularJson(
    path.join(fixedEvidenceRoot, "authorities", "private", `${storyId}-authority.json`),
    "fixed_private_authority",
  );
  const authority = authorityInput.document;
  const fixedReceiptPath = path.resolve(
    fixedEvidenceRoot,
    "receipts",
    "private",
    `${storyId}-private-upload-receipt.json`,
  );
  const fixedReconciliationPath = path.resolve(
    fixedEvidenceRoot,
    "receipts",
    "private",
    `${storyId}-private-upload-reconciliation.json`,
  );
  const manifestSha256 = await sha256File(manifestInput.realPath);
  if (
    authority?.schema_version !== 1 ||
    authority?.platform !== "youtube" ||
    authority?.story_id !== storyId ||
    authority?.verdict !== "GREEN" ||
    authority?.publish_allowed !== true ||
    authority?.control_tower?.verdict !== "GREEN" ||
    authority?.control_tower?.scope !== "EXACT_PRIVATE_FIRST_UPLOAD_ONLY" ||
    authority?.dispatch?.action_id !== `${storyId}:youtube:private` ||
    authority?.dispatch?.mode !== "PRIVATE_FIRST" ||
    authority?.dispatch?.single_use !== true ||
    !samePath(authority?.dispatch?.receipt_path, fixedReceiptPath) ||
    authority?.operator_decision?.operator_id !== "MORR" ||
    authority?.evidence_binding?.manifest_sha256 !== manifestSha256
  ) throw new Error("exact_green_private_studio_authority_required");

  const request = packInput.document.youtube_upload_request;
  const videoPath = path.resolve(packageRoot, request.video_file);
  if (!pathInside(packageRoot, videoPath)) throw new Error("video_must_be_inside_package");
  const videoStat = await fs.lstat(videoPath);
  if (!videoStat.isFile() || videoStat.isSymbolicLink()) {
    throw new Error("video_must_be_regular_file");
  }
  const videoSha256 = await sha256File(videoPath);
  if (
    request.video_sha256 !== videoSha256 ||
    authority.video_sha256 !== videoSha256
  ) throw new Error("private_studio_video_sha256_mismatch");

  const intent = {
    story_id: storyId,
    video_id: videoId,
    channel_id: manifest.channel.id,
    title: episode.title,
    description: episode.description,
    tags: episode.tags,
    category_id: request.snippet.categoryId,
    default_language: request.snippet.defaultLanguage,
    default_audio_language: request.snippet.defaultAudioLanguage,
    video_bytes: videoStat.size,
    video_sha256: videoSha256,
    authority_action_id: authority.dispatch.action_id,
  };

  await fs.ensureDir(path.dirname(fixedReceiptPath));
  if (await fs.pathExists(fixedReceiptPath)) {
    const existingInput = await readRegularJson(fixedReceiptPath, "existing_private_receipt");
    if (receiptReplayIsExact(existingInput.document, intent)) {
      const client = await authenticatedYoutubeClientFactory();
      const readback = await verifyExactSystemTraceYouTubeStudioVideo({ client, intent });
      log(
        `[system-trace-youtube-studio-reconcile] GREEN idempotent readback: ` +
        `${storyId}; video=${videoId}`,
      );
      return {
        receipt: existingInput.document,
        readback,
        idempotent: true,
        artefacts: { receipt_path: fixedReceiptPath },
      };
    }
    const sourceReceiptSha256 = await sha256File(existingInput.realPath);
    assertExactDeferredRedReceipt(
      existingInput.document,
      intent,
      sourceReceiptSha256,
    );
    if (await fs.pathExists(fixedReconciliationPath)) {
      const proofInput = await readRegularJson(
        fixedReconciliationPath,
        "existing_private_reconciliation",
      );
      assertExactDeferredGreenProof(
        proofInput.document,
        intent,
        sourceReceiptSha256,
      );
      const client = await authenticatedYoutubeClientFactory();
      const readback = await verifyExactSystemTraceYouTubeStudioVideo({ client, intent });
      log(
        `[system-trace-youtube-studio-reconcile] GREEN deferred proof replay: ` +
        `${storyId}; video=${videoId}`,
      );
      return {
        receipt: proofInput.document,
        source_receipt: existingInput.document,
        readback,
        idempotent: true,
        artefacts: {
          receipt_path: fixedReceiptPath,
          reconciliation_path: fixedReconciliationPath,
        },
      };
    }
    const client = await authenticatedYoutubeClientFactory();
    const proof = await executeDeferredSystemTraceYouTubeStudioReconciliation({
      client,
      intent,
      sourceReceipt: existingInput.document,
      sourceReceiptSha256,
    });
    await writeReceipt(fixedReconciliationPath, proof, { exclusive: true });
    log(
      `[system-trace-youtube-studio-reconcile] GREEN deferred reconciliation: ` +
      `${storyId}; video=${videoId}; proof=${fixedReconciliationPath}`,
    );
    return {
      receipt: proof,
      source_receipt: existingInput.document,
      idempotent: false,
      artefacts: {
        receipt_path: fixedReceiptPath,
        reconciliation_path: fixedReconciliationPath,
      },
    };
  }

  const reserved = {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    generated_at: new Date().toISOString(),
    story_id: storyId,
    platform: "youtube",
    verdict: "NOT_EVALUATED",
    status: "STUDIO_RECONCILIATION_ATTEMPT_RESERVED",
    retry_allowed: false,
    studio_ingest: true,
    authority: { action_id: authority.dispatch.action_id },
    platform_object: { video_id: videoId, privacy_status: "private" },
    requests: { video: { media_sha256: videoSha256 } },
  };
  await writeReceipt(fixedReceiptPath, reserved, { exclusive: true });

  try {
    const client = await authenticatedYoutubeClientFactory();
    const receipt = await executeSystemTraceYouTubeStudioReconcile({ client, intent });
    await writeReceipt(fixedReceiptPath, receipt);
    log(
      `[system-trace-youtube-studio-reconcile] GREEN: ${storyId}; ` +
      `video=${videoId}; receipt=${fixedReceiptPath}`,
    );
    return { receipt, idempotent: false, artefacts: { receipt_path: fixedReceiptPath } };
  } catch (error) {
    const failure = error?.receipt || {
      ...reserved,
      generated_at: new Date().toISOString(),
      verdict: "RED",
      status: "STUDIO_RECONCILIATION_ATTEMPT_BLOCKED",
      blockers: Array.isArray(error?.blockers)
        ? error.blockers
        : [clean(error?.code || error?.message || error)],
    };
    await writeReceipt(fixedReceiptPath, failure);
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `[system-trace-youtube-studio-reconcile] BLOCKED: ${clean(error?.message || error)}`,
    );
    process.exitCode = 2;
  });
}

module.exports = {
  currentAuthenticatedGoogleYouTubeClientFactory,
  main,
  parseArgs,
  usage,
};
