#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  assertExactDeferredScheduleGreenProof,
  assertExactDeferredScheduleRedReceipt,
  buildGovernedYouTubeScheduleBinding,
  executeDeferredGovernedYouTubeScheduleReconciliation,
  executeGovernedYouTubeScheduledRelease,
  resolveGovernedYouTubePrivateReadiness,
} = require("../lib/services/governed-youtube-scheduled-release");

function clean(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    packageDir: null,
    manifest: null,
    bufferAuthority: null,
    privateReceipt: null,
    receiptOut: null,
    confirmStoryId: null,
    applySchedule: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--package-dir") parsed.packageDir = argv[++index] || null;
    else if (arg === "--manifest") parsed.manifest = argv[++index] || null;
    else if (arg === "--buffer-authority") parsed.bufferAuthority = argv[++index] || null;
    else if (arg === "--private-receipt") parsed.privateReceipt = argv[++index] || null;
    else if (arg === "--receipt-out") parsed.receiptOut = argv[++index] || null;
    else if (arg === "--confirm-story-id") parsed.confirmStoryId = argv[++index] || null;
    else if (arg === "--apply-schedule") parsed.applySchedule = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`unknown_argument:${arg}`);
  }
  return parsed;
}

function usage() {
  return [
    "Usage: node tools/governed-youtube-scheduled-release.js [options]",
    "",
    "Required:",
    "  --package-dir <path>",
    "  --manifest <path>",
    "  --buffer-authority <path>",
    "  --private-receipt <path>",
    "  --receipt-out <path>",
    "  --confirm-story-id <id>",
    "  --apply-schedule",
  ].join("\n");
}

function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function readRegularJson(file, label) {
  const requested = path.resolve(file);
  const stat = await fs.lstat(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_file`);
  }
  const realPath = await fs.realpath(requested);
  try {
    return { document: JSON.parse(await fs.readFile(realPath, "utf8")), realPath };
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

function assertPackContract(pack, episode, storyId) {
  const request = pack?.youtube_upload_request;
  const snippet = request?.snippet;
  const status = request?.status;
  const blockers = [];
  if (pack?.schema_version !== 1 || pack?.story_id !== storyId ||
      pack?.platform !== "youtube_shorts") blockers.push("publish_pack_identity_mismatch");
  if (pack?.title !== episode.title || pack?.description !== episode.description ||
      snippet?.title !== episode.title || snippet?.description !== episode.description ||
      JSON.stringify(snippet?.tags) !== JSON.stringify(episode.tags)) {
    blockers.push("publish_pack_metadata_mismatch");
  }
  if (request?.notifySubscribers !== false || snippet?.categoryId !== "20" ||
      snippet?.defaultLanguage !== "en-GB" || snippet?.defaultAudioLanguage !== "en-GB" ||
      status?.privacyStatus !== "private" || status?.selfDeclaredMadeForKids !== false ||
      status?.containsSyntheticMedia !== true || status?.license !== "youtube" ||
      status?.embeddable !== true || status?.publicStatsViewable !== true) {
    blockers.push("publish_pack_settings_mismatch");
  }
  if (!clean(request?.video_file)) blockers.push("publish_pack_video_file_missing");
  if (blockers.length) {
    const error = new Error("governed_youtube_schedule_pack_blocked");
    error.blockers = blockers;
    throw error;
  }
}

async function currentAuthenticatedGoogleYouTubeClientFactory() {
  const { google } = require("googleapis");
  const { getAuthClient, inspectAuthStatus } = require("../upload_youtube");
  const status = await inspectAuthStatus();
  if (status?.enabled !== true || status?.refresh_available !== true) {
    throw new Error("youtube_auth_must_be_current_before_schedule");
  }
  return google.youtube({ version: "v3", auth: await getAuthClient() });
}

async function writeReceipt(file, receipt, { exclusive = false } = {}) {
  await fs.writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: exclusive ? "wx" : "w",
  });
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const authenticatedYoutubeClientFactory = dependencies.authenticatedYoutubeClientFactory ||
    currentAuthenticatedGoogleYouTubeClientFactory;
  const log = dependencies.log || console.log;
  const clock = typeof dependencies.now === "function" ? dependencies.now : () => new Date();
  const currentTime = () => {
    const value = clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error("trusted_clock_must_return_valid_date");
    }
    return value;
  };
  const args = parseArgs(argv);
  if (args.help) {
    log(usage());
    return { help: true };
  }
  if (!args.applySchedule) throw new Error("governed_youtube_schedule_explicit_apply_required");
  for (const [key, label] of [["packageDir", "package_dir"], ["manifest", "manifest"],
    ["bufferAuthority", "buffer_authority"], ["privateReceipt", "private_receipt"],
    ["receiptOut", "receipt_out"], ["confirmStoryId", "confirm_story_id"]]) {
    if (!clean(args[key])) throw new Error(`${label}_required`);
  }

  const packageRoot = await fs.realpath(path.resolve(args.packageDir));
  const manifestInput = await readRegularJson(args.manifest, "manifest");
  const authorityInput = await readRegularJson(args.bufferAuthority, "buffer_authority");
  const privateInput = await readRegularJson(args.privateReceipt, "private_receipt");
  const storyId = clean(args.confirmStoryId);
  const manifest = manifestInput.document;
  const episode = manifest?.episodes?.find((candidate) => candidate?.story_id === storyId);
  if (manifest?.schema !== "pulse_system_trace_youtube_buffer_v1" ||
      manifest?.schema_version !== 1 || !episode) {
    throw new Error("governed_youtube_schedule_manifest_story_blocked");
  }
  const expectedProject = path.resolve(path.dirname(path.dirname(manifestInput.realPath)), episode.project_dir);
  if (!samePath(expectedProject, packageRoot)) {
    throw new Error("governed_youtube_schedule_package_story_mismatch");
  }

  const publishAt = new Date(episode.publish_at_utc).toISOString();
  const bufferAuthority = authorityInput.document;
  const manifestSha256 = await sha256File(manifestInput.realPath);
  if (bufferAuthority?.schema_version !== 1 || bufferAuthority?.platform !== "youtube" ||
      bufferAuthority?.story_id !== storyId || bufferAuthority?.verdict !== "GREEN" ||
      bufferAuthority?.publish_allowed !== true || bufferAuthority?.control_tower?.verdict !== "GREEN" ||
      bufferAuthority?.operator_decision?.operator_id !== "MORR" ||
      bufferAuthority?.release?.verdict !== "GREEN" ||
      bufferAuthority?.release?.authority_scope !== "EXACT_YOUTUBE_NATIVE_SCHEDULE_ONLY" ||
      bufferAuthority?.release?.channel_id !== manifest.channel.id ||
      bufferAuthority?.release?.publish_at_utc !== publishAt ||
      bufferAuthority?.release?.public_schedule_allowed !== true ||
      bufferAuthority?.release?.auto_publish_general_allowed !== false ||
      bufferAuthority?.release?.notify_subscribers !== false ||
      bufferAuthority?.release?.action_id !== `${storyId}:youtube:schedule:${publishAt}` ||
      bufferAuthority?.buffer_authority?.manifest_sha256 !== manifestSha256) {
    throw new Error("exact_green_buffer_schedule_authority_required");
  }

  const packInput = await readRegularJson(path.join(packageRoot, "youtube_publish_pack.json"), "publish_pack");
  if (!pathInside(packageRoot, packInput.realPath)) throw new Error("publish_pack_must_be_inside_package");
  assertPackContract(packInput.document, episode, storyId);
  const privateReceipt = privateInput.document;
  if (privateReceipt?.story_id !== storyId ||
      privateReceipt?.platform_object?.privacy_status !== "private" ||
      !clean(privateReceipt?.platform_object?.video_id)) {
    throw new Error("governed_private_receipt_identity_required");
  }
  if (!samePath(bufferAuthority?.dispatch?.receipt_path, privateInput.realPath)) {
    throw new Error("private_receipt_not_bound_by_buffer_authority");
  }

  const request = packInput.document.youtube_upload_request;
  const videoPath = path.resolve(packageRoot, request.video_file);
  if (!pathInside(packageRoot, videoPath)) throw new Error("video_must_be_inside_package");
  const videoStat = await fs.lstat(videoPath);
  if (!videoStat.isFile() || videoStat.isSymbolicLink()) throw new Error("video_must_be_regular_file");
  const videoSha256 = await sha256File(videoPath);

  const captionRequest = request.captions;
  const captionPath = path.resolve(packageRoot, clean(captionRequest?.file));
  if (!pathInside(packageRoot, captionPath)) throw new Error("captions_must_be_inside_package");
  const captionStat = await fs.lstat(captionPath);
  if (!captionStat.isFile() || captionStat.isSymbolicLink()) throw new Error("captions_must_be_regular_file");
  const captionsSha256 = await sha256File(captionPath);
  if (captionRequest?.file !== packInput.document?.captions?.file ||
      captionRequest?.sha256 !== captionsSha256 || packInput.document?.captions?.sha256 !== captionsSha256 ||
      bufferAuthority?.captions_sha256 !== captionsSha256 || captionRequest?.language !== "en-GB" ||
      captionRequest?.name !== "English (United Kingdom)" || captionRequest?.isDraft !== false) {
    throw new Error("exact_local_caption_binding_required");
  }

  const privateIntent = {
    story_id: storyId, video_id: privateReceipt.platform_object.video_id,
    channel_id: manifest.channel.id, title: episode.title, description: episode.description,
    tags: episode.tags, category_id: request.snippet.categoryId,
    default_language: request.snippet.defaultLanguage,
    default_audio_language: request.snippet.defaultAudioLanguage,
    video_bytes: videoStat.size, video_sha256: videoSha256,
    authority_action_id: bufferAuthority.dispatch.action_id,
  };
  const privateSourceSha256 = await sha256File(privateInput.realPath);
  let privateReconciliation = null;
  let privateReconciliationSha256 = null;
  if (privateReceipt.verdict === "RED") {
    privateReconciliation = await readRegularJson(
      path.join(path.dirname(privateInput.realPath), `${storyId}-private-upload-reconciliation.json`),
      "private_reconciliation",
    );
    privateReconciliationSha256 = await sha256File(privateReconciliation.realPath);
  }
  const privateReadiness = resolveGovernedYouTubePrivateReadiness({
    privateReceipt,
    reconciliationProof: privateReconciliation?.document || null,
    sourceReceiptSha256: privateSourceSha256,
    intent: privateIntent,
  });

  const intent = {
    story_id: storyId, video_id: privateReadiness.video_id, channel_id: manifest.channel.id,
    publish_at_utc: publishAt, title: episode.title, description: episode.description,
    tags: episode.tags, category_id: request.snippet.categoryId,
    default_language: request.snippet.defaultLanguage,
    default_audio_language: request.snippet.defaultAudioLanguage,
    video_bytes: videoStat.size, contains_synthetic_media: true,
  };
  const authority = {
    verdict: "GREEN", authority_scope: "EXACT_MANIFEST_STATUS_ONLY_SCHEDULE",
    action_id: `${storyId}:youtube:schedule:${publishAt}`,
    binding_sha256: buildGovernedYouTubeScheduleBinding(intent),
  };

  const receiptPath = path.resolve(args.receiptOut);
  const boundReceiptPath = path.resolve(clean(bufferAuthority?.release?.receipt_path) ||
    path.join(path.dirname(path.dirname(privateInput.realPath)), "schedule", `${storyId}-schedule-receipt.json`));
  if (!samePath(receiptPath, boundReceiptPath)) throw new Error("receipt_out_not_bound_by_buffer_authority");
  if (samePath(receiptPath, packageRoot) || pathInside(packageRoot, receiptPath)) {
    throw new Error("receipt_out_must_be_outside_package");
  }
  await fs.ensureDir(path.dirname(receiptPath));

  if (await fs.pathExists(receiptPath)) {
    const sourceInput = await readRegularJson(receiptPath, "existing_schedule_receipt");
    const sourceSha256 = await sha256File(sourceInput.realPath);
    assertExactDeferredScheduleRedReceipt(sourceInput.document, intent, authority, sourceSha256);
    const reconciliationPath = path.join(path.dirname(receiptPath), `${storyId}-schedule-reconciliation.json`);
    if (await fs.pathExists(reconciliationPath)) {
      const proofInput = await readRegularJson(reconciliationPath, "existing_schedule_reconciliation");
      assertExactDeferredScheduleGreenProof(proofInput.document, intent, authority, sourceSha256);
      const client = await authenticatedYoutubeClientFactory();
      const now = currentTime();
      await executeDeferredGovernedYouTubeScheduleReconciliation({
        client, intent, authority, sourceReceipt: sourceInput.document, sourceReceiptSha256: sourceSha256,
        now, generatedAt: now.toISOString(),
      });
      return { receipt: proofInput.document, source_receipt: sourceInput.document, idempotent: true,
        artefacts: { receipt_path: receiptPath, reconciliation_path: reconciliationPath } };
    }
    const client = await authenticatedYoutubeClientFactory();
    const now = currentTime();
    const proof = await executeDeferredGovernedYouTubeScheduleReconciliation({
      client, intent, authority, sourceReceipt: sourceInput.document, sourceReceiptSha256: sourceSha256,
      now, generatedAt: now.toISOString(),
    });
    await writeReceipt(reconciliationPath, proof, { exclusive: true });
    log(`[governed-youtube-scheduled-release] GREEN deferred reconciliation: ${storyId}; proof=${reconciliationPath}`);
    return { receipt: proof, source_receipt: sourceInput.document, idempotent: false,
      artefacts: { receipt_path: receiptPath, reconciliation_path: reconciliationPath } };
  }

  const reserved = {
    schema_version: 1, receipt_type: "governed_youtube_scheduled_release",
    generated_at: currentTime().toISOString(), story_id: storyId, video_id: intent.video_id,
    publish_at_utc: publishAt, verdict: "NOT_EVALUATED", status: "SCHEDULE_ATTEMPT_RESERVED",
    retry_allowed: false, visibility_update_count: 0, authority,
  };
  await writeReceipt(receiptPath, reserved, { exclusive: true });
  try {
    const client = await authenticatedYoutubeClientFactory();
    const now = currentTime();
    const receipt = await executeGovernedYouTubeScheduledRelease({
      client, intent, authority, now, generatedAt: now.toISOString(),
    });
    const governedReceipt = {
      ...receipt,
      private_readiness: {
        evidence_kind: privateReadiness.evidence_kind,
        canonical_receipt_sha256: privateSourceSha256,
        reconciliation_sha256: privateReconciliationSha256,
        captions: {
          local_srt_sha256: captionsSha256, local_srt_bytes: captionStat.size,
          language: captionRequest.language,
          remote_captions_present: privateReadiness.receipt?.readback?.captions_present === true,
          provenance_scope: "LOCAL_SRT_BOUND_AND_REMOTE_CAPTIONS_PRESENT",
        },
      },
    };
    await writeReceipt(receiptPath, governedReceipt);
    log(`[governed-youtube-scheduled-release] ${governedReceipt.verdict}: ${storyId}; publishAt=${publishAt}`);
    return { receipt: governedReceipt, artefacts: { receipt_path: receiptPath } };
  } catch (error) {
    const failure = error?.receipt || {
      ...reserved, generated_at: currentTime().toISOString(), verdict: "RED",
      status: "SCHEDULE_ATTEMPT_BLOCKED",
      blockers: Array.isArray(error?.blockers) ? error.blockers : [clean(error?.code || error?.message || error)],
    };
    await writeReceipt(receiptPath, failure);
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[governed-youtube-scheduled-release] BLOCKED: ${clean(error?.message || error)}`);
    process.exitCode = 2;
  });
}

module.exports = { currentAuthenticatedGoogleYouTubeClientFactory, main, parseArgs, usage };
