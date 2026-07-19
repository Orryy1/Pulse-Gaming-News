"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("fs-extra");
const { verifyFinalRenderInputLineage } = require("./goal-contract");
const { narrationRightsRecord } = require("./narration-rights-policy");
const {
  isOfficialYoutubeMotionRightsRecord,
  isTransformativeRightsEvidenceKind,
  officialYoutubeTransformativeRightsBlockers,
} = require("./rights-evidence-policy");
const {
  REQUIRED_POLICY_URLS: ELEVENLABS_REQUIRED_POLICY_URLS,
} = require("./elevenlabs-generation-rights-lineage");

const execFileAsync = promisify(execFile);
const ENABLED_PLATFORMS = ["youtube_shorts", "instagram_reels", "facebook_reels"];
const DEFAULT_WORKSPACE_ROOT = path.resolve(__dirname, "..");
const ELEVENLABS_SUBSCRIPTION_ENDPOINT =
  "https://api.elevenlabs.io/v1/user/subscription";
const ELEVENLABS_MODELS_ENDPOINT = "https://api.elevenlabs.io/v1/models";
function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(asArray(values).map(clean).filter(Boolean))];
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(clean(value));
}

function timestampMs(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function paidActiveElevenLabsSnapshot(snapshot = {}) {
  const tier = clean(snapshot.tier).toLowerCase();
  return Boolean(
    snapshot.source_endpoint === ELEVENLABS_SUBSCRIPTION_ENDPOINT &&
      timestampMs(snapshot.retrieved_at) !== null &&
      tier &&
      !["free", "trial"].includes(tier) &&
      clean(snapshot.status).toLowerCase() === "active" &&
      snapshot.paid_plan === true &&
      snapshot.secrets_recorded === false &&
      validSha256(snapshot.sanitised_snapshot_sha256),
  );
}

function containsSensitiveEvidenceFields(value, parentKey = "") {
  if (Array.isArray(value)) {
    return value.some((entry) => containsSensitiveEvidenceFields(entry, parentKey));
  }
  if (!value || typeof value !== "object") return false;
  const forbidden = /^(?:api[_-]?key|xi[_-]?api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|user[_-]?id|invoice(?:s)?|payment(?:s|_method)?|card(?:_number)?|bank(?:_account)?)$/i;
  return Object.entries(value).some(([key, entry]) => (
    forbidden.test(key) ||
    containsSensitiveEvidenceFields(entry, key || parentKey)
  ));
}

async function materialisedEvidenceEntryCurrent(entry = {}, artifactDir = "") {
  const resolved = resolveAssetPath(entry.materialised_path, artifactDir);
  if (
    !resolved ||
    !(await fs.pathExists(resolved)) ||
    !validSha256(entry.sha256) ||
    Number(entry.size_bytes) <= 0
  ) {
    return false;
  }
  const current = await fingerprintFile(resolved);
  return (
    current.sha256 === clean(entry.sha256).toLowerCase() &&
    current.size_bytes === Number(entry.size_bytes)
  );
}

async function strictElevenLabsGenerationEvidenceBlockers({
  evidence = {},
  artifactDir,
  storyId,
  used,
  targetPlatforms = ENABLED_PLATFORMS,
  currentAudioFingerprint,
}) {
  const blockers = [];
  if (
    clean(evidence.schema) !== "pulse_elevenlabs_commercial_tts_evidence_v3" ||
    Number(evidence.schema_version) !== 3
  ) {
    return ["generation_bound_schema_missing"];
  }
  if (
    clean(evidence.story_id) !== clean(storyId) ||
    clean(evidence.asset_id) !== clean(used.asset_id)
  ) {
    blockers.push("story_or_asset_binding_mismatch");
  }
  if (
    !["GREEN", "PASS", "PASSED"].includes(
      clean(evidence.verdict || evidence.status).toUpperCase(),
    ) ||
    asArray(evidence.blockers).length ||
    evidence.commercial_use_allowed !== true
  ) {
    blockers.push("evidence_not_strict_green");
  }
  const provider = evidence.provider || {};
  const modelEvidence = provider.model_evidence || {};
  if (
    clean(provider.id).toLowerCase() !== "elevenlabs" ||
    !clean(provider.model_id) ||
    /\b(?:alpha|beta|preview|pilot)\b/i.test(clean(provider.model_id)) ||
    modelEvidence.source_endpoint !== ELEVENLABS_MODELS_ENDPOINT ||
    timestampMs(modelEvidence.retrieved_at) === null ||
    modelEvidence.text_to_speech !== true ||
    modelEvidence.requires_alpha_access !== false
  ) {
    blockers.push("production_model_evidence_invalid");
  }
  if (
    !validSha256(provider.model_snapshot_sha256) ||
    Number(provider.model_snapshot_size_bytes) <= 0 ||
    !(await materialisedEvidenceEntryCurrent({
      materialised_path: provider.model_snapshot_path,
      sha256: provider.model_snapshot_sha256,
      size_bytes: provider.model_snapshot_size_bytes,
    }, artifactDir))
  ) {
    blockers.push("model_snapshot_missing_or_stale");
  }
  const entitlement = evidence.account_entitlement || {};
  const pre = entitlement.pre_generation || {};
  const post = entitlement.post_generation || {};
  const generation = evidence.generation || {};
  const requestStartedAt = timestampMs(generation.request_started_at);
  const responseReceivedAt = timestampMs(generation.response_received_at);
  const preRetrievedAt = timestampMs(pre.retrieved_at);
  const postRetrievedAt = timestampMs(post.retrieved_at);
  if (
    entitlement.paid_at_generation !== true ||
    entitlement.secrets_recorded !== false ||
    !paidActiveElevenLabsSnapshot(pre) ||
    !paidActiveElevenLabsSnapshot(post)
  ) {
    blockers.push("generation_time_paid_entitlement_missing");
  }
  if (
    requestStartedAt === null ||
    responseReceivedAt === null ||
    preRetrievedAt === null ||
    postRetrievedAt === null ||
    preRetrievedAt > requestStartedAt ||
    responseReceivedAt > postRetrievedAt ||
    requestStartedAt > responseReceivedAt
  ) {
    blockers.push("entitlement_does_not_bracket_generation");
  }
  const rawProviderAudioSha256 = clean(
    generation.raw_provider_audio_sha256,
  ).toLowerCase();
  if (
    !clean(generation.request_id) ||
    !clean(generation.history_item_id) ||
    Number(generation.history_date_unix) <= 0 ||
    !validSha256(generation.voice_id_sha256) ||
    !validSha256(generation.request_text_sha256) ||
    !validSha256(generation.request_settings_sha256) ||
    !validSha256(rawProviderAudioSha256) ||
    Number(generation.raw_provider_audio_size_bytes) <= 0
  ) {
    blockers.push("provider_request_history_identity_incomplete");
  }
  if (
    clean(generation.history_audio_sha256).toLowerCase() !==
      rawProviderAudioSha256 ||
    Number(generation.history_audio_size_bytes) !==
      Number(generation.raw_provider_audio_size_bytes)
  ) {
    blockers.push("history_audio_does_not_match_raw_response");
  }
  const generationReceiptEvidence = evidence.generation_receipt || {};
  const generationReceiptPath = resolveAssetPath(
    generationReceiptEvidence.path ||
      generationReceiptEvidence.materialised_path,
    artifactDir,
  );
  const generationReceiptCurrent =
    generationReceiptPath &&
    await materialisedEvidenceEntryCurrent({
      materialised_path: generationReceiptPath,
      sha256: generationReceiptEvidence.sha256,
      size_bytes: generationReceiptEvidence.size_bytes,
    }, artifactDir);
  let generationReceipt = {};
  if (!generationReceiptCurrent) {
    blockers.push("generation_receipt_missing_or_stale");
  } else {
    generationReceipt = await readJson(generationReceiptPath, {});
    const receiptGeneration = generationReceipt.generation || {};
    const receiptMastering = generationReceipt.mastering_lineage || {};
    if (
      clean(generationReceipt.schema) !==
        "pulse_elevenlabs_generation_receipt_v1" ||
      Number(generationReceipt.schema_version) !== 1 ||
      clean(generationReceipt.story_id) !== clean(storyId) ||
      clean(generationReceipt.asset_id) !== clean(used.asset_id) ||
      clean(generationReceipt.generation_verdict).toUpperCase() !== "GREEN" ||
      asArray(generationReceipt.generation_blockers).length ||
      clean(receiptGeneration.request_id) !== clean(generation.request_id) ||
      clean(receiptGeneration.history_item_id) !==
        clean(generation.history_item_id) ||
      clean(receiptGeneration.raw_provider_audio_sha256).toLowerCase() !==
        rawProviderAudioSha256 ||
      clean(receiptMastering.mastered_audio_sha256).toLowerCase() !==
        currentAudioFingerprint.sha256 ||
      Number(receiptMastering.mastered_audio_size_bytes) !==
        Number(currentAudioFingerprint.size_bytes)
    ) {
      blockers.push("generation_receipt_binding_invalid");
    }
  }
  const lineage = evidence.lineage || {};
  if (
    clean(lineage.raw_provider_audio_sha256).toLowerCase() !==
      rawProviderAudioSha256 ||
    !validSha256(lineage.spoken_script_sha256) ||
    !validSha256(lineage.word_timestamps_sha256) ||
    !validSha256(lineage.captions_sha256) ||
    !validSha256(lineage.final_video_sha256) ||
    clean(lineage.mastered_audio_output_sha256).toLowerCase() !==
      currentAudioFingerprint.sha256 ||
    clean(lineage.final_audio_sha256).toLowerCase() !==
      currentAudioFingerprint.sha256
  ) {
    blockers.push("raw_to_final_media_lineage_incomplete");
  }
  const allowedPlatforms = new Set(
    asArray(evidence.allowed_platforms).map(normalisePlatformKey),
  );
  if (
    clean(evidence.licence_basis) !==
      "elevenlabs_commercial_tts_generation" ||
    targetPlatforms.some(
      (platform) => !allowedPlatforms.has(normalisePlatformKey(platform)),
    )
  ) {
    blockers.push("commercial_platform_scope_incomplete");
  }
  const policy = evidence.policy_evidence || {};
  const documents = asArray(policy.documents);
  const documentUrls = new Set(documents.map((entry) => clean(entry.url)));
  if (
    clean(policy.jurisdiction) !== "UK_EEA" ||
    policy.paid_plan_required !== true ||
    policy.beta_service_production_forbidden !== true ||
    ELEVENLABS_REQUIRED_POLICY_URLS.some((url) => !documentUrls.has(url))
  ) {
    blockers.push("official_policy_evidence_incomplete");
  } else {
    for (const document of documents) {
      if (
        !/^https:\/\/(?:help\.)?elevenlabs\.io\//i.test(clean(document.url)) ||
        timestampMs(document.retrieved_at) === null ||
        !(await materialisedEvidenceEntryCurrent(document, artifactDir))
      ) {
        blockers.push("official_policy_file_missing_or_stale");
        break;
      }
    }
  }
  const checks = evidence.checks || {};
  for (const requiredCheck of [
    "entitlement_brackets_generation",
    "request_id_matches_history",
    "history_audio_matches_raw_response",
    "lineage_hash_chain_complete",
    "current_story_and_audio_match",
    "policy_files_verified",
    "model_is_production_tts",
    "no_secret_fields",
  ]) {
    if (checks[requiredCheck] !== true) {
      blockers.push("required_generation_check_missing");
      break;
    }
  }
  if (
    evidence.safety?.secrets_recorded !== false ||
    evidence.safety?.personal_account_fields_recorded !== false ||
    evidence.safety?.invoice_fields_recorded !== false ||
    containsSensitiveEvidenceFields(evidence)
  ) {
    blockers.push("sensitive_account_evidence_detected");
  }
  return unique(blockers);
}

function workspaceEvidenceRoots(workspaceRoot = DEFAULT_WORKSPACE_ROOT) {
  const start = path.resolve(workspaceRoot || DEFAULT_WORKSPACE_ROOT);
  const roots = [start];
  let current = start;
  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      roots.push(current);
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  roots.push(DEFAULT_WORKSPACE_ROOT);
  return unique(roots.map((root) => path.resolve(root)));
}

function objectHasKeys(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}

function statusIsRed(value) {
  return [
    "RED",
    "FAIL",
    "FAILED",
    "BLOCKED",
    "HARD_STOP",
    "HELD",
    "HOLD",
    "REJECTED",
  ].includes(clean(value).toUpperCase());
}

function authoritativeFailures(value = {}) {
  return unique([
    ...asArray(value.blockers),
    ...asArray(value.hard_blockers),
    ...asArray(value.failures),
    ...asArray(value.reason_codes),
    ...asArray(value.rejection_reasons),
  ]);
}

function hasAuthoritativeRed(value = {}) {
  if (!objectHasKeys(value)) return false;
  return Boolean(
    [
      value.publish_status,
      value.final_verdict,
      value.verdict,
      value.status,
      value.result,
      value.overall_verdict,
      value.control_tower_verdict,
      value.package_verdict,
      value.readiness_status,
      value.governance_publish_status,
    ].some(statusIsRed) ||
      value.can_auto_publish === false ||
      authoritativeFailures(value).length,
  );
}

function packageSummaryHasAuthoritativeRed(packageSummary = {}) {
  return [
    packageSummary,
    packageSummary.publish_verdict,
    packageSummary.package_verdict,
    packageSummary.control_tower,
    packageSummary.readiness,
  ].some(hasAuthoritativeRed);
}

function aggregateRows(document) {
  if (Array.isArray(document)) return document.filter(Boolean);
  if (!objectHasKeys(document)) return [];
  for (const key of [
    "story_packages",
    "packages",
    "candidates",
    "scheduler_bridge_candidates",
    "bridge_candidates",
    "stories",
  ]) {
    if (Array.isArray(document[key])) return document[key].filter(Boolean);
  }
  return [];
}

function aggregateEntryViews(entry = {}) {
  return [
    entry,
    entry.acceptance_entry,
    entry.story_package,
    entry.goal_package_summary,
    entry.package_summary,
    entry.publish_verdict,
    entry.package_verdict,
    entry.control_tower,
    entry.readiness,
    entry.platform_publish_manifest,
  ].filter(objectHasKeys);
}

function storyIdFor(value = {}) {
  return clean(value.story_id || value.id || value.storyId);
}

function aggregateEntryMatches(entry = {}, storyId = "") {
  return aggregateEntryViews(entry).some((value) => storyIdFor(value) === clean(storyId));
}

function aggregateEntryHasAuthoritativeRed(entry = {}) {
  return aggregateEntryViews(entry).some((value) => (
    packageSummaryHasAuthoritativeRed(value) ||
    hasAuthoritativeRed(value.platform_publish_manifest)
  ));
}

async function inspectAuthoritativePublishEvidence({ artifactDir, storyId, aggregatePaths = [] }) {
  const evidence = [
    {
      key: "goal_package_summary",
      path: path.join(artifactDir, "goal_package_summary.json"),
      blocker: "authoritative_goal_package_summary_red",
      invalidBlocker: "authoritative_goal_package_summary_invalid",
      isRed: packageSummaryHasAuthoritativeRed,
    },
    {
      key: "platform_publish_manifest",
      path: path.join(artifactDir, "platform_publish_manifest.json"),
      blocker: "authoritative_platform_publish_manifest_red",
      invalidBlocker: "authoritative_platform_publish_manifest_invalid",
      isRed: hasAuthoritativeRed,
    },
    {
      key: "publish_verdict",
      path: path.join(artifactDir, "publish_verdict.json"),
      blocker: "authoritative_publish_verdict_red",
      invalidBlocker: "authoritative_publish_verdict_invalid",
      isRed: hasAuthoritativeRed,
    },
    {
      key: "final_av_review",
      path: path.join(artifactDir, "final_av_review.json"),
      blocker: "authoritative_final_av_review_not_green",
      invalidBlocker: "authoritative_final_av_review_invalid",
      isRed: (review) => finalAvPublishBlockers(review).length > 0,
    },
  ];
  const blockers = [];
  const reportedFailures = [];
  const sources = [];
  for (const item of evidence) {
    const present = await fs.pathExists(item.path);
    let document = null;
    let valid = true;
    if (present) {
      try {
        document = await fs.readJson(item.path);
      } catch {
        valid = false;
      }
    }
    const red = present && valid && item.isRed(document);
    if (present && !valid) blockers.push(item.invalidBlocker);
    if (red) blockers.push(item.blocker);
    const sourceFailures = present && valid ? authoritativeFailures(document) : [];
    reportedFailures.push(...sourceFailures.map((failure) => `${item.key}:${failure}`));
    sources.push({
      key: item.key,
      path: item.path,
      present,
      valid: present ? valid : null,
      authoritative_red: red,
      reported_failures: sourceFailures,
    });
  }
  for (const requestedPath of unique(aggregatePaths)) {
    const aggregatePath = path.resolve(requestedPath);
    if (!(await fs.pathExists(aggregatePath))) {
      blockers.push("aggregate_evidence_missing");
      sources.push({
        key: "aggregate",
        path: aggregatePath,
        present: false,
        story_found: false,
        authoritative_red: false,
      });
      continue;
    }
    const document = await readJson(aggregatePath, null);
    if (!document) {
      blockers.push("aggregate_evidence_invalid");
      sources.push({
        key: "aggregate",
        path: aggregatePath,
        present: true,
        story_found: false,
        authoritative_red: false,
      });
      continue;
    }
    const entry = aggregateRows(document).find((row) => aggregateEntryMatches(row, storyId));
    const red = Boolean(entry && aggregateEntryHasAuthoritativeRed(entry));
    if (!entry) blockers.push("aggregate_story_missing");
    if (red) blockers.push("authoritative_aggregate_package_red");
    sources.push({
      key: "aggregate",
      path: aggregatePath,
      present: true,
      story_found: Boolean(entry),
      authoritative_red: red,
    });
  }
  const uniqueBlockers = unique(blockers);
  return {
    verdict: uniqueBlockers.length ? "FAIL" : "PASS",
    publish_readiness: uniqueBlockers.length ? "RED" : "UNCHANGED",
    blockers: uniqueBlockers,
    reported_failures: unique(reportedFailures),
    sources,
  };
}

function ledgerRows(ledger) {
  if (Array.isArray(ledger)) return ledger.filter(Boolean);
  if (!ledger || typeof ledger !== "object") return [];
  return [
    ...asArray(ledger.records),
    ...asArray(ledger.rights_ledger),
    ...asArray(ledger.matched_assets),
  ];
}

function fileUrlPath(value) {
  const text = clean(value);
  if (!/^file:\/\//i.test(text)) return text;
  return decodeURIComponent(text.replace(/^file:\/\//i, ""));
}

function resolveAssetPath(value, artifactDir) {
  const text = fileUrlPath(value);
  if (!text || /^https?:\/\//i.test(text) || /^[a-z]+:\/\//i.test(text)) return "";
  return path.resolve(path.isAbsolute(text) ? text : path.join(artifactDir, text));
}

function normalisePath(value, artifactDir) {
  const resolved = resolveAssetPath(value, artifactDir);
  return resolved ? resolved.replace(/\\/g, "/").toLowerCase() : "";
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function fingerprintFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return {
    sha256: sha256(buffer),
    size_bytes: buffer.length,
  };
}

function declaredAssetFingerprint(record = {}) {
  const fileEvidence = record.materialized_file_evidence &&
    typeof record.materialized_file_evidence === "object"
    ? record.materialized_file_evidence
    : {};
  const digest = clean(
    record.asset_sha256 ||
      record.sha256 ||
      record.content_sha256 ||
      fileEvidence.sha256,
  ).replace(/^sha256:/i, "").toLowerCase();
  const sizeBytes = Number(
    record.asset_size_bytes ||
      record.size_bytes ||
      record.file_size_bytes ||
      fileEvidence.size_bytes,
  );
  return {
    sha256: /^[a-f0-9]{64}$/.test(digest) ? digest : "",
    size_bytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : null,
  };
}

function declaredFingerprintMatches(record, current) {
  const declared = declaredAssetFingerprint(record);
  return Boolean(
    declared.sha256 &&
      declared.size_bytes &&
      declared.sha256 === current.sha256 &&
      declared.size_bytes === current.size_bytes
  );
}

function renderSelectedAssetFingerprintMatches({
  renderManifest,
  used,
  current,
  artifactDir,
}) {
  const selected = renderManifest.selected_input_assets;
  if (!selected || selected.authoritative !== true) return false;
  const usedId = clean(used.asset_id).toLowerCase();
  const usedPath = normalisePath(used.path, artifactDir);
  return asArray(selected.assets).some((asset) => {
    const selectedId = clean(asset.asset_id || asset.id).toLowerCase();
    const selectedPath = normalisePath(
      asset.path ||
        asset.local_materialized_path ||
        asset.local_materialised_path ||
        asset.file_path,
      artifactDir,
    );
    return Boolean(
      usedId &&
        selectedId === usedId &&
        usedPath &&
        selectedPath === usedPath &&
        declaredFingerprintMatches(asset, current)
    );
  });
}

async function readJson(filePath, fallback = {}) {
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function serialiseJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function pathIsWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function transactionTempPath(filePath, purpose) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.candidate-evidence-reconciliation.${purpose}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
}

async function availableTransactionBackupPath(preferredPath) {
  const resolvedPreferredPath = path.resolve(preferredPath);
  if (!(await fs.pathExists(resolvedPreferredPath))) return resolvedPreferredPath;
  let suffix = 1;
  while (await fs.pathExists(`${resolvedPreferredPath}.${suffix}`)) suffix += 1;
  return `${resolvedPreferredPath}.${suffix}`;
}

function failedRenderRightsReconciliation(report = {}, blocker = "local_file_transaction_failed") {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  return {
    ...report,
    verdict: "FAIL",
    status: "RED",
    applied: false,
    blockers: unique([...asArray(report.blockers), blocker]),
    applied_ledger_verdict: "NOT_APPLIED",
    applied_ledger_sha256: null,
    applied_ledger_size_bytes: 0,
    can_auto_publish: false,
    final_state_verified: false,
    final_state_verification_basis: "local_file_transaction_rolled_back",
  };
}

async function restoreTransactionEntry(entry) {
  if (!entry.existed) {
    await fs.remove(entry.path);
    return;
  }
  const restorePath = transactionTempPath(entry.path, "rollback");
  try {
    await fs.writeFile(restorePath, entry.original, {
      flag: "wx",
      mode: entry.mode & 0o777,
    });
    if (await fs.pathExists(entry.path)) await fs.chmod(entry.path, 0o666).catch(() => {});
    await fs.rename(restorePath, entry.path);
    await fs.chmod(entry.path, entry.mode & 0o777).catch(() => {});
  } finally {
    await fs.remove(restorePath).catch(() => {});
  }
}

class LocalJsonFileTransaction {
  constructor() {
    this.entries = new Map();
  }

  async readJson(filePath, fallback = {}) {
    const entry = this.entries.get(path.resolve(filePath));
    if (!entry) return readJson(filePath, fallback);
    try {
      return JSON.parse(entry.next.toString("utf8"));
    } catch {
      return fallback;
    }
  }

  async stageJson(filePath, value, backupPath = "") {
    const resolvedPath = path.resolve(filePath);
    let entry = this.entries.get(resolvedPath);
    if (!entry) {
      const existed = await fs.pathExists(resolvedPath);
      const stat = existed ? await fs.stat(resolvedPath) : null;
      entry = {
        path: resolvedPath,
        existed,
        original: existed ? await fs.readFile(resolvedPath) : null,
        mode: stat?.mode || 0o666,
        next: null,
        backupPaths: new Set(),
        tempPath: null,
      };
    } else {
      this.entries.delete(resolvedPath);
    }
    entry.next = serialiseJson(value);
    if (backupPath) entry.backupPaths.add(path.resolve(backupPath));
    this.entries.set(resolvedPath, entry);
  }

  async commit() {
    const entries = [...this.entries.values()];
    const committed = [];
    let failedPath = null;
    try {
      for (const entry of entries) {
        entry.tempPath = transactionTempPath(entry.path, "next");
        await fs.writeFile(entry.tempPath, entry.next, {
          flag: "wx",
          mode: entry.mode & 0o777,
        });
      }
      for (const entry of entries) {
        for (const backupPath of entry.backupPaths) {
          if (!entry.existed) throw new Error(`Cannot back up missing transaction target: ${entry.path}`);
          if (await fs.pathExists(backupPath)) {
            const collision = new Error(`Transaction backup already exists: ${backupPath}`);
            collision.code = "EEXIST";
            throw collision;
          }
          const backupTempPath = transactionTempPath(backupPath, "backup");
          try {
            await fs.writeFile(backupTempPath, entry.original, {
              flag: "wx",
              mode: entry.mode & 0o777,
            });
            await fs.rename(backupTempPath, backupPath);
          } finally {
            await fs.remove(backupTempPath).catch(() => {});
          }
        }
      }
      for (const entry of entries) {
        failedPath = entry.path;
        await fs.rename(entry.tempPath, entry.path);
        entry.tempPath = null;
        committed.push(entry);
      }
      return {
        committed: true,
        rolled_back: false,
        changed_file_count: committed.length,
      };
    } catch (cause) {
      const rollbackErrors = [];
      for (const entry of committed.reverse()) {
        try {
          await restoreTransactionEntry(entry);
        } catch (error) {
          rollbackErrors.push({ path: entry.path, code: clean(error.code) || "ROLLBACK_FAILED" });
        }
      }
      for (const entry of entries) {
        if (entry.existed && await fs.pathExists(entry.path)) {
          await fs.chmod(entry.path, entry.mode & 0o777).catch(() => {});
        }
      }
      const error = new Error(`Local file transaction failed for ${failedPath || "transaction preparation"}`);
      error.code = "LOCAL_FILE_TRANSACTION_FAILED";
      error.cause = cause;
      error.failedPath = failedPath;
      error.rolledBack = rollbackErrors.length === 0;
      error.rollbackErrors = rollbackErrors;
      throw error;
    } finally {
      for (const entry of entries) {
        if (entry.tempPath) await fs.remove(entry.tempPath).catch(() => {});
      }
    }
  }
}

function transactionFailure(error) {
  return {
    committed: false,
    rolled_back: error?.rolledBack === true,
    error_code: clean(error?.code) || "LOCAL_FILE_TRANSACTION_FAILED",
    failed_path: error?.failedPath || null,
    rollback_errors: asArray(error?.rollbackErrors),
  };
}

function rightsBasis(record = {}) {
  return clean(
    record.licence_basis ||
      record.license_basis ||
      record.rights_basis ||
      record.allowed_use,
  );
}

function evidenceReference(record = {}) {
  return clean(
    record.evidence_file ||
      record.evidence_reference ||
      record.licence_evidence ||
      record.license_evidence ||
      record.licence_evidence_url ||
      record.permission_evidence ||
      record.permission_evidence_url,
  );
}

function normalisePlatformKey(value) {
  const raw = value && typeof value === "object"
    ? value.platform || value.platform_key || value.key || value.name || value.id
    : value;
  const key = clean(raw).toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    youtube: "youtube_shorts",
    youtube_short: "youtube_shorts",
    youtube_shorts: "youtube_shorts",
    instagram: "instagram_reels",
    instagram_reel: "instagram_reels",
    instagram_reels: "instagram_reels",
    facebook: "facebook_reels",
    facebook_reel: "facebook_reels",
    facebook_reels: "facebook_reels",
    twitter: "x",
    twitter_video: "x",
    twitter_image: "x",
    x_twitter: "x",
    x: "x",
  };
  return aliases[key] || key;
}

function hasPlatformScope(record = {}, targetPlatforms = ENABLED_PLATFORMS) {
  const platforms = asArray(record.allowed_platforms || record.platforms)
    .map(normalisePlatformKey)
    .filter(Boolean);
  const targets = asArray(targetPlatforms)
    .map(normalisePlatformKey)
    .filter(Boolean);
  return targets.length > 0 && targets.every((platform) => platforms.includes(platform));
}

function hasPositiveRightsDecision(record = {}) {
  const approval = clean(record.approval_status).toLowerCase().replace(/[\s-]+/g, "_");
  const verdict = clean(record.verdict).toLowerCase().replace(/[\s-]+/g, "_");
  if (!approval && !verdict) return false;
  if (approval && !/^approved(?:_|$)/.test(approval)) return false;
  if (verdict && !/^(?:green|pass|passed)$/.test(verdict)) return false;
  return true;
}

function completeRightsRecord(record = {}, targetPlatforms = ENABLED_PLATFORMS) {
  if (!record || typeof record !== "object") return false;
  return Boolean(
    clean(record.asset_id || record.id) &&
      rightsBasis(record) &&
      hasPositiveRightsDecision(record) &&
      record.commercial_use_allowed === true &&
      hasPlatformScope(record, targetPlatforms) &&
      evidenceReference(record),
  );
}

function completeMaterialRightsRecord(record = {}, targetPlatforms = ENABLED_PLATFORMS) {
  const complete = Boolean(
    completeRightsRecord(record, targetPlatforms) &&
      clean(record.source_owner || record.creator) &&
      clean(record.path || record.local_path || record.local_materialized_path) &&
      /^[a-f0-9]{64}$/i.test(clean(record.asset_sha256)) &&
      Number(record.asset_size_bytes) > 0 &&
      clean(record.evidence_file) &&
      !/^https?:\/\//i.test(clean(record.evidence_file)) &&
      /^[a-f0-9]{64}$/i.test(clean(record.evidence_sha256)) &&
      Number(record.evidence_size_bytes) > 0,
  );
  if (!complete) return false;
  const officialYoutubeMotion = isOfficialYoutubeMotionRightsRecord(record);
  if (!officialYoutubeMotion) return record.rights_grant !== false;
  return officialYoutubeTransformativeRightsBlockers(record).length === 0;
}

function explicitRightsRestrictionReasons(record = {}, targetPlatforms = ENABLED_PLATFORMS) {
  if (!record || typeof record !== "object") return [];
  const reasons = [];
  if (record.commercial_use_allowed === false) reasons.push("commercial_use_prohibited");
  if (
    record.rights_grant === false &&
    clean(record.identity_scope).toLowerCase() !== "source_identity_only"
  ) {
    reasons.push("rights_grant_denied");
  }
  const allowed = asArray(record.allowed_platforms || record.platforms)
    .map(normalisePlatformKey)
    .filter(Boolean);
  const targets = unique(asArray(targetPlatforms).map(normalisePlatformKey));
  if (allowed.length && targets.some((platform) => !allowed.includes(platform))) {
    reasons.push("platform_scope_restricted");
  }
  const restricted = asArray(record.restricted_platforms).map(normalisePlatformKey).filter(Boolean);
  if (targets.some((platform) => restricted.includes(platform))) reasons.push("platform_explicitly_restricted");
  const statusText = [
    record.approval_status,
    record.rights_status,
    record.usage_status,
    record.status,
    record.verdict,
  ].map(clean).join(" ").toLowerCase();
  if (/(?:^|\s|[_-])(?:reject(?:ed)?|deny|denied|blocked|revoked|expired|prohibited|failed?|red)(?:$|\s|[_-])/.test(statusText)) {
    reasons.push("rights_status_restrictive");
  }
  if (Number(record.risk_score) >= 0.65) reasons.push("rights_risk_too_high");
  return unique(reasons);
}

function duplicateCount(rows = []) {
  const keys = rows.map((row) => clean(row.asset_id || row.id || row.path)).filter(Boolean);
  return keys.length - new Set(keys).size;
}

function recordPaths(record = {}, artifactDir) {
  return unique([
    normalisePath(record.path, artifactDir),
    normalisePath(record.local_path, artifactDir),
    normalisePath(record.local_materialized_path, artifactDir),
    normalisePath(record.local_materialised_path, artifactDir),
    normalisePath(record.file, artifactDir),
    normalisePath(record.source_url, artifactDir),
  ]);
}

function metadataForPath(rows, filePath, artifactDir) {
  const key = normalisePath(filePath, artifactDir);
  const primary = rows.find((row) => unique([
    normalisePath(row.path, artifactDir),
    normalisePath(row.local_path, artifactDir),
    normalisePath(row.file, artifactDir),
  ]).includes(key));
  return primary || rows.find((row) => recordPaths(row, artifactDir).includes(key)) || null;
}

function strictMotionSourceOwner(record = {}) {
  const identity = record.motion_source_identity && typeof record.motion_source_identity === "object"
    ? record.motion_source_identity
    : {};
  if (clean(identity.status).toLowerCase() !== "resolved" || identity.strict_pass !== true) return "";
  const pending = [identity.source_identity_provenance, record.source_identity_provenance]
    .filter((value) => value && typeof value === "object");
  const seen = new Set();
  while (pending.length) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const authorName = clean(value.channel_identity?.author_name);
    if (authorName) return authorName;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        if (Array.isArray(child)) pending.push(...child);
        else pending.push(child);
      }
    }
  }
  return "";
}

async function verifiedMotionSourceIdentity(record = {}, artifactDir) {
  const identity = record.motion_source_identity && typeof record.motion_source_identity === "object"
    ? record.motion_source_identity
    : {};
  const canonicalSourceUrl = clean(identity.canonical_source_url || record.canonical_source_url);
  const sourceMasterSha256 = clean(identity.source_master_sha256 || record.source_master_sha256);
  const declaredMasterSha256 = clean(record.source_master_sha256);
  const strictIdentity = clean(identity.status).toLowerCase() === "resolved" &&
    identity.strict_pass === true &&
    /^https?:\/\//i.test(canonicalSourceUrl) &&
    /^[a-f0-9]{64}$/i.test(sourceMasterSha256) &&
    (!declaredMasterSha256 || declaredMasterSha256 === sourceMasterSha256);
  if (!strictIdentity) return null;
  const localSourceMasterPath = resolveAssetPath(
    record.local_source_master_path || record.source_master_path || record.source_url,
    artifactDir,
  );
  const provenance = identity.source_identity_provenance &&
    typeof identity.source_identity_provenance === "object"
    ? identity.source_identity_provenance
    : {};
  let channelIdentity = resolvedYoutubeChannelIdentity(provenance, {
    expectedVideoId: clean(identity.youtube_video_id || record.youtube_video_id),
    expectedSourceMasterSha256: sourceMasterSha256,
  });
  const sidecarPath = resolveAssetPath(
    provenance.sidecar_path || provenance.path,
    artifactDir,
  );
  const declaredSidecarSha256 = clean(
    provenance.sidecar_sha256 || provenance.sha256,
  ).toLowerCase();
  if (
    !channelIdentity &&
    sidecarPath &&
    /^[a-f0-9]{64}$/.test(declaredSidecarSha256) &&
    await fs.pathExists(sidecarPath)
  ) {
    const currentSidecar = await fingerprintFile(sidecarPath);
    if (currentSidecar.sha256 === declaredSidecarSha256) {
      const sidecar = await readJson(sidecarPath, null);
      const sidecarSourceUrl = clean(sidecar?.canonical_source_url);
      const sidecarVideoId = clean(
        sidecar?.youtube_video_id || youtubeVideoIdFromUrl(sidecarSourceUrl),
      );
      const sidecarMasterSha256 = clean(sidecar?.source_master_sha256).toLowerCase();
      const sidecarIdentityVerified =
        clean(sidecar?.status).toLowerCase() === "resolved" ||
        (
          clean(provenance.status).toLowerCase() === "resolved" &&
          clean(sidecar?.schema) === "pulse_motion_source_identity_sidecar_v1" &&
          clean(sidecar?.producer) === "pulse_source_identity_oembed_verifier_v1"
        );
      if (
        sidecarIdentityVerified &&
        sidecarSourceUrl === canonicalSourceUrl &&
        sidecarVideoId === clean(identity.youtube_video_id || record.youtube_video_id) &&
        sidecarMasterSha256 === sourceMasterSha256 &&
        sidecar?.rights_grant === false
      ) {
        channelIdentity = resolvedYoutubeChannelIdentity({
          ...sidecar,
          status: "resolved",
        }, {
          expectedVideoId: sidecarVideoId,
          expectedSourceMasterSha256: sourceMasterSha256,
        });
      }
    }
  }
  return {
    canonical_source_url: canonicalSourceUrl,
    local_source_master_path: localSourceMasterPath || null,
    source_master_sha256: sourceMasterSha256,
    youtube_video_id: clean(identity.youtube_video_id || record.youtube_video_id) || null,
    source_owner: clean(channelIdentity?.authorName) || strictMotionSourceOwner(record) || null,
    verified_channel_identity: channelIdentity || null,
  };
}

function generatedCardRole(value = {}) {
  const text = [
    value.asset_id,
    value.id,
    value.path,
    value.local_materialized_path,
    value.source_url,
    value.source_type,
    value.source_family,
    value.motion_family,
  ].map(clean).join(" ").toLowerCase();
  if (!/(?:hyperframes|hf[_-])/.test(text)) return "";
  for (const role of ["source", "takeaway", "quote", "context", "timeline", "proof", "hook", "cta"]) {
    if (new RegExp(`(?:^|[^a-z])${role}(?:[^a-z]|$)`).test(text)) return role;
  }
  return "";
}

function ownedGeneratedCardRecord(record = {}) {
  const basis = rightsBasis(record).toLowerCase();
  const type = [record.source_type, record.media_kind, record.rights_risk_class]
    .map(clean)
    .join(" ")
    .toLowerCase();
  const approval = clean(record.approval_status).toLowerCase();
  return generatedCardRole(record) &&
    /owned.*generated|generated.*owned/.test(basis) &&
    /generated.*motion.*graphic|motion.*graphic|hyperframes.*card|owned.*generated.*motion/.test(type) &&
    /^approved/.test(approval);
}

function sourceEquivalent(record = {}, used = {}) {
  const sourceUrl = clean(used.source_url).toLowerCase();
  const sourceFamily = clean(used.source_family).toLowerCase();
  if (used.kind === "narration") {
    const donorText = [record.asset_id, record.source_url, record.source_type, record.provider]
      .map(clean)
      .join(" ")
      .toLowerCase();
    return /elevenlabs|tts/.test(donorText) && donorText.includes(clean(used.story_id).toLowerCase());
  }
  if (used.kind === "video") {
    const usedCardRole = generatedCardRole(used);
    const donorCardRole = generatedCardRole(record);
    if (usedCardRole && usedCardRole === donorCardRole && ownedGeneratedCardRecord(record)) {
      return true;
    }
  }
  if (sourceUrl && clean(record.source_url).toLowerCase() === sourceUrl) return true;
  return Boolean(sourceFamily && clean(record.source_family || record.motion_family).toLowerCase() === sourceFamily);
}

function trustedOfficialDirectMediaHost(value) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return [
      /(?:^|\.)playstation\.com$/,
      /(?:^|\.)playstation\.net$/,
      /(?:^|\.)steamstatic\.com$/,
      /(?:^|\.)xbox\.com$/,
      /(?:^|\.)xboxservices\.com$/,
      /(?:^|\.)nintendo\.com$/,
    ].some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

function youtubeVideoIdFromUrl(value) {
  try {
    const url = new URL(clean(value));
    const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
    if (host === "youtu.be") return clean(url.pathname.split("/").filter(Boolean)[0]);
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return "";
    return clean(
      url.searchParams.get("v") ||
        url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i)?.[1],
    );
  } catch {
    return "";
  }
}

function resolvedYoutubeChannelIdentity(
  provenance = {},
  { expectedVideoId = "", expectedSourceMasterSha256 = "" } = {},
) {
  if (!provenance || typeof provenance !== "object") return null;
  const candidates = [
    ...(provenance.channel_identity ? [provenance] : []),
    ...(clean(provenance.kind) === "source_identity_evidence_bundle"
      ? asArray(provenance.sources)
      : []),
  ];
  const verified = candidates
    .filter((candidate) => clean(candidate?.status).toLowerCase() === "resolved")
    .map((candidate) => {
      const authorName = clean(candidate.channel_identity?.author_name);
      const authorUrl = clean(candidate.channel_identity?.author_url);
      const videoId = clean(
        candidate.youtube_video_id ||
          youtubeVideoIdFromUrl(candidate.canonical_source_url),
      );
      const sourceMasterSha256 = clean(candidate.source_master_sha256).toLowerCase();
      if (
        !authorName ||
        !/^https:\/\/www\.youtube\.com\/@[^/]+$/i.test(authorUrl) ||
        (videoId && expectedVideoId && videoId !== expectedVideoId) ||
        (
          sourceMasterSha256 &&
          expectedSourceMasterSha256 &&
          sourceMasterSha256 !== expectedSourceMasterSha256
        )
      ) {
        return null;
      }
      return { authorName, authorUrl };
    })
    .filter(Boolean);
  if (!verified.length) return null;
  const identities = new Set(
    verified.map(({ authorName, authorUrl }) =>
      `${authorName.toLowerCase()}|${authorUrl.toLowerCase()}`,
    ),
  );
  return identities.size === 1 ? verified[0] : null;
}

function hashBoundOfficialYoutubeIdentity(used = {}, metadata = {}) {
  const identity = metadata.motion_source_identity && typeof metadata.motion_source_identity === "object"
    ? metadata.motion_source_identity
    : {};
  const provenance = identity.source_identity_provenance &&
    typeof identity.source_identity_provenance === "object"
    ? identity.source_identity_provenance
    : {};
  const declaredVideoId = clean(identity.youtube_video_id || used.youtube_video_id);
  const sourceVideoId =
    youtubeVideoIdFromUrl(used.source_url) ||
    youtubeVideoIdFromUrl(identity.canonical_source_url);
  const sourceMasterSha256 = clean(
    identity.source_master_sha256 || used.source_master_sha256,
  ).toLowerCase();
  const channelIdentity =
    used.verified_channel_identity ||
    resolvedYoutubeChannelIdentity(provenance, {
      expectedVideoId: declaredVideoId,
      expectedSourceMasterSha256: sourceMasterSha256,
    });
  const authorName = clean(channelIdentity?.authorName);
  const authorUrl = clean(channelIdentity?.authorUrl);
  const sourceOwner = clean(used.source_owner || metadata.source_owner);
  const sourceType = clean(metadata.source_type || used.source_type).toLowerCase();
  return Boolean(
    identity.strict_pass === true &&
      clean(identity.status).toLowerCase() === "resolved" &&
      declaredVideoId &&
      sourceVideoId === declaredVideoId &&
      youtubeVideoIdFromUrl(identity.canonical_source_url) === declaredVideoId &&
      /^[a-f0-9]{64}$/i.test(sourceMasterSha256) &&
      authorName &&
      /^https:\/\/www\.youtube\.com\/@[^/]+$/i.test(authorUrl) &&
      sourceOwner &&
      sourceOwner.toLowerCase() === authorName.toLowerCase() &&
      /official_(?:youtube_channel|publisher_(?:trailer|gameplay)(?:_segment|_clip)?|platform_channel)/.test(sourceType) &&
      asArray(identity.blockers).length === 0
  );
}

async function inspectBoundTransformativeRightsEvidence(record = {}, artifactDir = "") {
  const reference = evidenceReference(record);
  const evidencePath = resolveAssetPath(reference, artifactDir);
  const declaredSha256 = clean(
    record.evidence_sha256 || record.policy_evidence_sha256,
  ).replace(/^sha256:/i, "").toLowerCase();
  const declaredSizeBytes = Number(
    record.evidence_size_bytes || record.policy_evidence_size_bytes,
  );
  if (
    !isTransformativeRightsEvidenceKind(record.evidence_kind) ||
    !reference ||
    /^https?:\/\//i.test(reference) ||
    !evidencePath ||
    !/^[a-f0-9]{64}$/.test(declaredSha256) ||
    !Number.isFinite(declaredSizeBytes) ||
    declaredSizeBytes <= 0 ||
    !(await fs.pathExists(evidencePath))
  ) {
    return {
      valid: false,
      path: evidencePath || null,
      fingerprint: null,
      blockers: ["transformative_rights_policy_evidence_missing_or_unbound"],
    };
  }
  const stat = await fs.stat(evidencePath);
  if (!stat.isFile() || stat.size <= 0) {
    return {
      valid: false,
      path: evidencePath,
      fingerprint: null,
      blockers: ["transformative_rights_policy_evidence_missing_or_unbound"],
    };
  }
  const fingerprint = await fingerprintFile(evidencePath);
  if (
    fingerprint.sha256 !== declaredSha256 ||
    fingerprint.size_bytes !== declaredSizeBytes
  ) {
    return {
      valid: false,
      path: evidencePath,
      fingerprint,
      blockers: ["transformative_rights_policy_evidence_fingerprint_mismatch"],
    };
  }
  return {
    valid: true,
    path: evidencePath,
    fingerprint,
    blockers: [],
  };
}

async function currentValidatedOfficialMotionRights(
  used = {},
  targetPlatforms = ENABLED_PLATFORMS,
  artifactDir = "",
) {
  if (used.kind !== "video" || used.current_owned_generated_card_sidecar === true) {
    return { record: null, blockers: [] };
  }
  const metadata = used.metadata && typeof used.metadata === "object" ? used.metadata : {};
  const provenance = metadata.provenance && typeof metadata.provenance === "object"
    ? metadata.provenance
    : {};
  const validated = metadata.materialized === true &&
    metadata.validated === true &&
    metadata.segmentValidationPassed === true &&
    provenance.segment_validated === true;
  const officialBasis = rightsBasis(metadata);
  const sourceType = clean(metadata.source_type || used.source_type).toLowerCase();
  const officialType = /(?:official|steam_movie|platform_storefront)/.test(sourceType);
  const hashBoundOfficialYoutube = hashBoundOfficialYoutubeIdentity(used, metadata);
  const trustedOfficialSource =
    trustedOfficialDirectMediaHost(used.source_url) ||
    hashBoundOfficialYoutube;
  const policyEvidence = hashBoundOfficialYoutube
    ? await inspectBoundTransformativeRightsEvidence(metadata, artifactDir)
    : { valid: false, path: null, fingerprint: null, blockers: [] };
  const documentedPublisherVideoPolicy = Boolean(
    hashBoundOfficialYoutube &&
      /(?:^|_)(?:publisher|[a-z0-9]+)_video_policy_transformative_editorial_use$/i.test(
        officialBasis,
      ) &&
      policyEvidence.valid &&
      metadata.commercial_use_allowed === true &&
      hasPlatformScope(metadata, targetPlatforms) &&
      typeof metadata.credit_required === "boolean" &&
      Number(metadata.risk_score) < 0.65
  );
  if (hashBoundOfficialYoutube && !documentedPublisherVideoPolicy) {
    return {
      record: null,
      blockers: policyEvidence.blockers.length
        ? policyEvidence.blockers
        : ["transformative_rights_policy_evidence_missing_or_unbound"],
    };
  }
  const officialBasisAllowed =
    /(?:official_direct_media|steam_storefront_promotional_editorial_use|source_documented_transformative_editorial_use|official_storefront_promotional_editorial)/i.test(officialBasis) ||
    documentedPublisherVideoPolicy;
  if (!validated || !officialType || !officialBasisAllowed || !trustedOfficialSource) {
    return { record: null, blockers: [] };
  }
  if (explicitRightsRestrictionReasons(metadata, targetPlatforms).length) {
    return { record: null, blockers: [] };
  }
  const sourceOwner = clean(used.source_owner || metadata.source_owner || metadata.creator);
  if (!sourceOwner) return { record: null, blockers: [] };
  return {
    record: {
      ...metadata,
      asset_id: used.asset_id,
      id: used.asset_id,
      path: used.path,
      local_materialized_path: used.path,
      source_url: used.source_url,
      source_type: used.source_type || metadata.source_type,
      source_family: used.source_family || metadata.source_family || metadata.motion_family,
      source_owner: sourceOwner,
      licence_basis: officialBasis,
      rights_basis: clean(metadata.rights_basis) || officialBasis,
      allowed_use: clean(metadata.allowed_use) || "transformative_editorial_short_form",
      allowed_platforms: unique(asArray(targetPlatforms).map(normalisePlatformKey)),
      commercial_use_allowed: metadata.commercial_use_allowed !== false,
      credit_required: metadata.credit_required === true,
      approval_status: clean(metadata.approval_status) || "approved_for_transformative_editorial_use",
      risk_score: Number.isFinite(Number(metadata.risk_score)) ? Number(metadata.risk_score) : 0.28,
      evidence_reference: documentedPublisherVideoPolicy
        ? policyEvidence.path
        : "materialised_motion_clips.json",
      evidence_file: documentedPublisherVideoPolicy ? policyEvidence.path : undefined,
      evidence_kind: documentedPublisherVideoPolicy ? clean(metadata.evidence_kind) : undefined,
      evidence_sha256: documentedPublisherVideoPolicy
        ? policyEvidence.fingerprint.sha256
        : undefined,
      evidence_size_bytes: documentedPublisherVideoPolicy
        ? policyEvidence.fingerprint.size_bytes
        : undefined,
      current_validated_official_materialised_clip: true,
      transformative_rights_evidence_verified: documentedPublisherVideoPolicy,
      rights_decision_basis: "validated_official_direct_media_editorial_policy",
      rights_status: "approved_under_transformative_editorial_policy",
      usage_scope: "transformative_editorial_short_form",
      source_identity_rights_grant: hashBoundOfficialYoutube ? false : undefined,
      rights_grant: documentedPublisherVideoPolicy ? true : undefined,
    },
    blockers: [],
  };
}

function provisionalRendererLocalProofRecord(record = {}) {
  const explicitLocalProofScope = /local[_ -]?proof/i.test(clean(record.usage_scope));
  const failClosedRendererShape = Boolean(
    record.commercial_use_allowed === false &&
    asArray(record.allowed_platforms || record.platforms).length === 0 &&
    Number(record.risk_score) >= 0.65 &&
    statusIsRed(record.rights_verdict || record.verdict || record.status)
  );
  return Boolean(
    clean(record.rights_decision_basis) ===
      "provisional_renderer_local_proof_pending_policy_reconciliation" &&
      record.rights_grant === false &&
      /operator[_ -]?legal[_ -]?review/i.test(clean(record.approval_status || record.rights_status)) &&
      (explicitLocalProofScope || failClosedRendererShape)
  );
}

function materialisedRows(manifest = {}) {
  return [
    ...asArray(manifest.clips),
    ...asArray(manifest.materialised_clips),
    ...asArray(manifest.materialized_clips),
  ];
}

function platformVariantReference(output = {}) {
  return clean(
    output.variant_video_path ||
      output.platform_video_path ||
      output.video_path ||
      output.platform_variant_render?.output_path ||
      output.platform_variant_render?.video_path,
  );
}

function collectPlatformNativeAssets({ artifactDir, storyId, platformManifest, targetPlatforms, finalVideoPath }) {
  const outputs = platformManifest?.outputs && typeof platformManifest.outputs === "object"
    ? platformManifest.outputs
    : {};
  return unique(asArray(targetPlatforms).map(normalisePlatformKey))
    .map((platform) => {
      const output = outputs[platform] && typeof outputs[platform] === "object" ? outputs[platform] : {};
      const reference = platformVariantReference(output);
      if (!reference) return null;
      return {
        kind: "platform_native",
        platform,
        asset_id: clean(
          output.asset_id ||
            output.platform_variant_render?.asset_id ||
            `platform-native-${platform}`,
        ),
        path: resolveAssetPath(reference, artifactDir),
        source_url: `local://pulse-gaming/${clean(storyId)}/platform-native/${platform}`,
        source_type: "platform_native_render",
        source_family: `platform_native_${platform}`,
        source_owner: "Pulse Gaming",
        provider_id: "pulse_gaming",
        derived_from: finalVideoPath,
        transformation_provenance:
          output.transformation_provenance ||
          output.platform_variant_render?.transformation_provenance ||
          {},
      };
    })
    .filter(Boolean);
}

function usedAssetId({ exact, metadata, storyId, kind, index }) {
  return clean(exact?.asset_id || exact?.id || metadata?.asset_id || metadata?.id) ||
    `${storyId}_${kind}_${String(index + 1).padStart(2, "0")}`;
}

function authoritativeSelectedAssetForPath(renderManifest = {}, filePath = "", artifactDir = "") {
  const selected = renderManifest.selected_input_assets;
  if (!selected || selected.authoritative !== true) return null;
  const targetPath = normalisePath(filePath, artifactDir);
  if (!targetPath) return null;
  const matches = asArray(selected.assets).filter((asset) => {
    const selectedPath = normalisePath(
      asset.path ||
        asset.local_materialized_path ||
        asset.local_materialised_path ||
        asset.file_path,
      artifactDir,
    );
    return selectedPath === targetPath;
  });
  return matches.length === 1 ? matches[0] : null;
}

function collectDeclaredAssetIds(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectDeclaredAssetIds(item, out);
  } else if (value && typeof value === "object") {
    const assetId = clean(value.asset_id || value.id || value.rights_record_id);
    if (assetId) out.add(assetId);
    for (const item of Object.values(value)) collectDeclaredAssetIds(item, out);
  }
  return out;
}

async function exactLocalProviderEvidencePath(used = {}, donor = {}, workspaceRoot = DEFAULT_WORKSPACE_ROOT) {
  const providerText = [
    used.asset_id,
    used.source_type,
    used.source_url,
    donor.provider,
    donor.provider_id,
    donor.source_type,
    donor.source_url,
  ].map(clean).join(" ").toLowerCase();
  if (
    (used.kind !== "sfx" && used.kind !== "music") ||
    !/epidemic(?:_|\s|-)?sound/.test(providerText)
  ) return "";
  const candidates = workspaceEvidenceRoots(workspaceRoot).flatMap((root) => [
    path.join(root, "output", "epidemic-sound-intake", "sfx_rights_ledger.json"),
    path.join(root, "output", "epidemic-sound-intake", "epidemic_rights_ledger.json"),
  ]);
  for (const candidate of candidates) {
    const ledger = await readJson(candidate, null);
    if (!ledger) continue;
    if (collectDeclaredAssetIds(ledger).has(clean(used.asset_id))) return candidate;
  }
  return "";
}

async function exactLocalProviderRightsDonor(
  used = {},
  targetPlatforms = ENABLED_PLATFORMS,
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
) {
  const providerText = [
    used.asset_id,
    used.provider_id,
    used.source_type,
    used.source_url,
  ].map(clean).join(" ").toLowerCase();
  if (
    (used.kind !== "sfx" && used.kind !== "music") ||
    !/epidemic(?:_|\s|-)?sound/.test(providerText)
  ) return null;
  const candidates = workspaceEvidenceRoots(workspaceRoot).flatMap((root) => [
    {
      root,
      path: path.join(root, "output", "epidemic-sound-intake", "epidemic_rights_ledger.json"),
    },
    {
      root,
      path: path.join(root, "output", "epidemic-sound-intake", "sfx_rights_ledger.json"),
    },
  ]);
  for (const entry of candidates) {
    const candidate = entry.path;
    const ledger = await readJson(candidate, null);
    if (!ledger) continue;
    const record = ledgerRows(ledger).find((row) => {
      if (clean(row.asset_id || row.id) !== clean(used.asset_id)) return false;
      const rowPath = normalisePath(
        row.path || row.local_materialized_path || row.local_materialised_path,
        entry.root,
      );
      const usedPath = normalisePath(used.path, entry.root);
      return Boolean(rowPath && usedPath && rowPath === usedPath);
    });
    if (!record || !completeRightsRecord(record, targetPlatforms)) continue;
    return {
      ...record,
      evidence_file: candidate,
      evidence_reference: candidate,
    };
  }
  return null;
}

async function evidencePathForUsedAsset(used, artifactDir, donor = {}, workspaceRoot = DEFAULT_WORKSPACE_ROOT) {
  if (used.kind === "narration") return path.join(artifactDir, "narration_manifest.json");
  if (used.kind === "video" && used.generated_card_sidecar_path) return used.generated_card_sidecar_path;
  if (
    used.kind === "video" &&
    donor.transformative_rights_evidence_verified === true
  ) {
    const policyEvidence = resolveAssetPath(evidenceReference(donor), artifactDir);
    if (policyEvidence) return policyEvidence;
  }
  if (used.kind === "video") return path.join(artifactDir, "materialised_motion_clips.json");
  if (used.kind === "platform_native") return path.join(artifactDir, "platform_publish_manifest.json");
  const localProviderEvidence = await exactLocalProviderEvidencePath(used, donor, workspaceRoot);
  if (localProviderEvidence) return localProviderEvidence;
  const donorEvidence = evidenceReference(donor);
  if (/^https?:\/\//i.test(donorEvidence)) return donorEvidence;
  const resolved = resolveAssetPath(donorEvidence, artifactDir);
  return resolved || donorEvidence;
}

async function generatedCardRightsFromCurrentSidecar({
  filePath,
  scene,
  storyId,
  artifactDir,
  workspaceRoot,
  targetPlatforms,
}) {
  const role = generatedCardRole({
    path: filePath,
    source_family: scene.sourceRootKey,
    motion_family: scene.sourceRootKey,
  });
  if (!role) return null;
  const sidecarPath = [
    filePath.replace(/\.[^.]+$/i, ".shell.json"),
    `${filePath}.shell.json`,
  ].find((candidate) => fs.existsSync(candidate));
  if (!sidecarPath) return null;
  const sidecar = await readJson(sidecarPath, null);
  const shell = sidecar?.hyperframes_premium_shell;
  const checks = shell?.checks && typeof shell.checks === "object" ? shell.checks : {};
  const outputReference = clean(shell?.output_path || sidecar?.output_path);
  const outputCandidates = outputReference
    ? unique([
      path.isAbsolute(outputReference) ? outputReference : path.resolve(artifactDir, outputReference),
      ...workspaceEvidenceRoots(workspaceRoot).map((root) =>
        path.isAbsolute(outputReference) ? outputReference : path.resolve(root, outputReference),
      ),
    ])
    : [];
  const outputMatches = outputCandidates.some(
    (candidate) => path.resolve(candidate) === path.resolve(filePath),
  );
  const legacyChecksPass = ["lint", "validate", "inspect", "render"].every(
    (key) => clean(checks[key]?.status).toLowerCase() === "pass",
  );
  const currentChecksPass =
    clean(checks.check?.status).toLowerCase() === "pass" &&
    clean(checks.render?.status).toLowerCase() === "pass" &&
    [
      shell?.visual_identity,
      shell?.animation_contract,
      shell?.readability_contract,
      shell?.creative_identity_contract,
    ].every(
      (contract) =>
        clean(contract?.status).toLowerCase() === "pass" &&
        asArray(contract?.blockers).length === 0,
    );
  const checksPass = legacyChecksPass || currentChecksPass;
  const valid = clean(sidecar?.story_id || shell?.story_id) === clean(storyId) &&
    clean(sidecar?.card_kind || shell?.card_kind).toLowerCase() === role &&
    clean(shell?.status).toLowerCase() === "pass" &&
    checksPass &&
    asArray(shell?.blockers).length === 0 &&
    outputMatches;
  if (!valid) return null;
  return {
    asset_type: "owned_generated_motion_graphic",
    source_url: `local://pulse-hyperframes/${storyId}/${role}`,
    source_type: "internally_generated_motion_graphic",
    source_family: `hyperframes_${role}_card`,
    source_owner: "Pulse Gaming",
    creator: "Pulse Gaming",
    provider_id: "pulse_hyperframes",
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "owned_editorial_motion_graphic",
    allowed_platforms: unique(asArray(targetPlatforms).map(normalisePlatformKey)),
    commercial_use_allowed: true,
    rights_grant: true,
    credit_required: false,
    risk_score: 0.02,
    approval_status: "approved_for_owned_editorial_use",
    rights_status: "approved",
    usage_scope: "owned_editorial_commercial_distribution",
    rights_decision_basis: "validated_current_owned_hyperframes_shell_sidecar",
    evidence_kind: "owned_generated_hyperframes_shell_sidecar",
    evidence_file: sidecarPath,
    evidence_reference: sidecarPath,
    generated_card_sidecar_path: sidecarPath,
    current_owned_generated_card_sidecar: true,
  };
}

async function collectUsedAssets({
  artifactDir,
  storyId,
  renderManifest,
  audioManifest,
  narrationManifest,
  sfxManifest,
  platformManifest,
  targetPlatforms,
  finalVideoPath,
  rows,
  workspaceRoot,
  canonicalManifest,
}) {
  const materialisedManifest = await readJson(path.join(artifactDir, "materialised_motion_clips.json"), {});
  const materialised = materialisedRows(materialisedManifest);
  const used = [];
  for (const [index, scene] of asArray(renderManifest.clip_scene_plan?.scenes).entries()) {
    const filePath = resolveAssetPath(scene.path, artifactDir);
    const exact = metadataForPath(rows, filePath, artifactDir);
    const metadata = metadataForPath(materialised, filePath, artifactDir);
    const selected = authoritativeSelectedAssetForPath(
      renderManifest,
      filePath,
      artifactDir,
    );
    const verifiedIdentity = await verifiedMotionSourceIdentity(
      metadata || {},
      artifactDir,
    );
    const currentGeneratedCardRights = await generatedCardRightsFromCurrentSidecar({
      filePath,
      scene,
      storyId,
      artifactDir,
      workspaceRoot,
      targetPlatforms,
    });
    used.push({
      ...(currentGeneratedCardRights || {}),
      story_id: storyId,
      kind: "video",
      asset_id: clean(selected?.asset_id) ||
        usedAssetId({ exact, metadata, storyId, kind: "video", index }),
      path: filePath,
      source_url: clean(
        currentGeneratedCardRights?.source_url ||
          verifiedIdentity?.canonical_source_url ||
          selected?.source_url ||
          metadata?.source_url ||
          exact?.source_url,
      ),
      local_source_master_path: verifiedIdentity?.local_source_master_path || null,
      source_master_sha256: verifiedIdentity?.source_master_sha256 || null,
      youtube_video_id: verifiedIdentity?.youtube_video_id || null,
      verified_channel_identity: verifiedIdentity?.verified_channel_identity || null,
      source_type: clean(
        currentGeneratedCardRights?.source_type ||
          metadata?.source_type ||
          exact?.source_type ||
          "selected_render_motion_clip",
      ),
      source_family: clean(
        currentGeneratedCardRights?.source_family ||
          metadata?.source_family ||
          metadata?.motion_family ||
          exact?.source_family ||
          scene.sourceRootKey,
      ),
      source_owner: clean(
        currentGeneratedCardRights?.source_owner ||
          verifiedIdentity?.source_owner ||
          metadata?.source_owner ||
          metadata?.creator ||
          canonicalManifest?.canonical_company ||
          canonicalManifest?.primary_source ||
          canonicalManifest?.canonical_subject ||
          exact?.source_owner ||
          exact?.creator,
      ),
      exact,
      metadata,
    });
  }

  const packageNarrationPath = resolveAssetPath(
    audioManifest.resolved_narration_audio_path || audioManifest.narration_audio_path,
    artifactDir,
  );
  const manifestAudioPath = resolveAssetPath(
    narrationManifest.resolved_audio_path || narrationManifest.audio_path,
    artifactDir,
  );
  const generationEvidence = renderManifest.flagship_generation_evidence || {};
  const manifestAudioSha256 = clean(narrationManifest.audio_sha256).toLowerCase();
  const lineageAudioSha256 = clean(
    narrationManifest.lineage?.final_audio_sha256,
  ).toLowerCase();
  const renderAudioSha256 = clean(
    renderManifest.input_fingerprint?.audio_sha256,
  ).toLowerCase();
  let manifestAudioFingerprint = null;
  if (manifestAudioPath && await fs.pathExists(manifestAudioPath)) {
    manifestAudioFingerprint = await fingerprintFile(manifestAudioPath);
  }
  const authoritativeSameRunNarration =
    narrationManifest.authoritative === true &&
    clean(narrationManifest.producer_id) === "pulse-gaming-post-render-narration-qa" &&
    ["pass", "passed", "green", "ready"].includes(
      clean(narrationManifest.verdict || narrationManifest.status).toLowerCase(),
    ) &&
    generationEvidence.complete === true &&
    clean(generationEvidence.verdict).toLowerCase() === "green" &&
    clean(narrationManifest.run_id) &&
    clean(narrationManifest.run_id) === clean(generationEvidence.run_id) &&
    /^[a-f0-9]{64}$/.test(manifestAudioSha256) &&
    manifestAudioSha256 === lineageAudioSha256 &&
    manifestAudioSha256 === renderAudioSha256 &&
    manifestAudioFingerprint?.sha256 === manifestAudioSha256;
  const narrationPath = authoritativeSameRunNarration
    ? manifestAudioPath
    : packageNarrationPath;
  if (narrationPath) {
    const exact = metadataForPath(rows, narrationPath, artifactDir);
    const acquisitionModes = new Set(["existing", "preexisting", "pre-existing", "reused"]);
    const concreteProvider = (...values) => values
      .map((value) => clean(value).toLowerCase())
      .find((value) => value && !acquisitionModes.has(value)) || "";
    const audioProvider = concreteProvider(audioManifest.voice_provider, audioManifest.provider);
    const manifestProvider = concreteProvider(narrationManifest.voice_provider, narrationManifest.provider);
    const provider = manifestProvider || audioProvider;
    const policy = narrationRightsRecord({ storyId, provider, audioPath: narrationPath });
    const provenanceBlockers = [];
    let narrationManifestAudioMirrorVerified = false;
    if (audioProvider && manifestProvider && audioProvider !== manifestProvider) {
      provenanceBlockers.push("narration_provider_mismatch");
    }
    if (manifestAudioPath && normalisePath(manifestAudioPath, artifactDir) !== normalisePath(narrationPath, artifactDir)) {
      if (await fs.pathExists(manifestAudioPath) && await fs.pathExists(narrationPath)) {
        const narrationFingerprint = await fingerprintFile(narrationPath);
        const mirrorFingerprint = await fingerprintFile(manifestAudioPath);
        narrationManifestAudioMirrorVerified = narrationFingerprint.sha256 === mirrorFingerprint.sha256 &&
          narrationFingerprint.size_bytes === mirrorFingerprint.size_bytes;
      }
      if (!narrationManifestAudioMirrorVerified) {
        provenanceBlockers.push("narration_manifest_audio_path_mismatch");
      }
    }
    if (!provider || (!provider.includes("elevenlabs") && !provider.includes("local"))) {
      provenanceBlockers.push("narration_provider_unrecognised");
    }
    used.push({
      ...policy,
      story_id: storyId,
      kind: "narration",
      asset_id: clean(policy.asset_id) || usedAssetId({ exact, storyId, kind: "narration", index: 0 }),
      path: narrationPath,
      source_url: clean(policy.source_url),
      source_type: clean(policy.source_type),
      source_family: "pulse_gaming_narration",
      source_owner: "Pulse Gaming",
      provider_id: provider.includes("elevenlabs") ? "elevenlabs" : "pulse_local_tts",
      allowed_platforms: unique(asArray(targetPlatforms).map(normalisePlatformKey)),
      evidence_reference: "narration_manifest.json",
      commercial_rights_evidence_reference: policy.evidence_reference,
      expected_asset_sha256: clean(narrationManifest.audio_sha256 || audioManifest.narration_audio_sha256),
      expected_asset_size_bytes: authoritativeSameRunNarration
        ? manifestAudioFingerprint.size_bytes
        : Number(
          narrationManifest.audio_size_bytes || audioManifest.narration_audio_size_bytes,
        ) || null,
      provenance_blockers: provenanceBlockers,
      narration_manifest_audio_mirror_path: narrationManifestAudioMirrorVerified ? manifestAudioPath : null,
      narration_manifest_audio_mirror_verified: narrationManifestAudioMirrorVerified,
      exact,
    });
  }

  const rendererSelection = renderManifest.selected_input_assets || {};
  const authoritativeRendererAssets =
    rendererSelection.authoritative === true &&
    rendererSelection.complete === true &&
    Number(rendererSelection.schema_version) >= 2
      ? asArray(rendererSelection.assets)
      : null;
  const authoritativeRendererAudioIds = new Set(
    asArray(authoritativeRendererAssets)
      .filter((asset) => ["sfx", "music"].includes(clean(asset.kind).toLowerCase()))
      .map((asset) => clean(asset.asset_id || asset.id).toLowerCase())
      .filter(Boolean),
  );
  const authoritativeRendererAudioPaths = new Set(
    asArray(authoritativeRendererAssets)
      .filter((asset) => ["sfx", "music"].includes(clean(asset.kind).toLowerCase()))
      .map((asset) => resolveAssetPath(
        asset.local_materialized_path ||
          asset.local_materialised_path ||
          asset.local_path ||
          asset.path ||
          asset.file_path ||
          asset.media_path ||
          asset.source_url,
        artifactDir,
      ))
      .map((assetPath) => normalisePath(assetPath, artifactDir))
      .filter(Boolean),
  );
  const rendererSelectedInputsAreAuthoritative =
    renderManifest.selected_input_assets?.authoritative === true;
  const manifestSelectedSfxAssets = rendererSelectedInputsAreAuthoritative
    ? []
    : asArray(sfxManifest.source_plan?.selected_assets);
  for (const [index, selected] of manifestSelectedSfxAssets.entries()) {
    const filePath = resolveAssetPath(
      selected.local_materialized_path ||
        selected.local_materialised_path ||
        selected.local_path ||
        selected.path ||
        selected.file_path ||
        selected.media_path ||
        selected.source_url,
      artifactDir,
    );
    const selectedAssetId = clean(selected.asset_id || selected.id).toLowerCase();
    if (
      authoritativeRendererAssets &&
      !authoritativeRendererAudioIds.has(selectedAssetId) &&
      !authoritativeRendererAudioPaths.has(normalisePath(filePath, artifactDir))
    ) {
      continue;
    }
    const exact = metadataForPath(rows, filePath, artifactDir) ||
      rows.find((row) => clean(row.asset_id) === clean(selected.asset_id));
    used.push({
      story_id: storyId,
      kind: "sfx",
      asset_id: clean(selected.asset_id) || usedAssetId({ exact, storyId, kind: "sfx", index }),
      path: filePath,
      source_url: clean(selected.source_url || exact?.source_url),
      source_type: clean(exact?.source_type || selected.provider_id || "licensed_sfx"),
      source_family: clean(exact?.source_family || selected.family || selected.role),
      exact,
    });
  }
  const alreadySelectedAudio = new Set(used
    .filter((asset) => asset.kind === "sfx" || asset.kind === "music")
    .flatMap((asset) => [
      `id:${clean(asset.asset_id).toLowerCase()}`,
      `path:${normalisePath(asset.path, artifactDir)}`,
    ])
    .filter((value) => !value.endsWith(":")));
  for (const [index, selected] of asArray(renderManifest.selected_input_assets?.assets).entries()) {
    const kind = clean(selected.kind).toLowerCase();
    if (kind !== "sfx" && kind !== "music") continue;
    const filePath = resolveAssetPath(
      selected.local_materialized_path ||
        selected.local_materialised_path ||
        selected.local_path ||
        selected.path ||
        selected.file_path ||
        selected.media_path ||
        selected.source_url,
      artifactDir,
    );
    const assetId = clean(selected.asset_id);
    const pathKey = `path:${normalisePath(filePath, artifactDir)}`;
    const idKey = `id:${assetId.toLowerCase()}`;
    if (alreadySelectedAudio.has(pathKey) || (assetId && alreadySelectedAudio.has(idKey))) continue;
    const exact = metadataForPath(rows, filePath, artifactDir) ||
      rows.find((row) => clean(row.asset_id || row.id) === assetId);
    used.push({
      story_id: storyId,
      kind,
      asset_id: assetId || usedAssetId({ exact, storyId, kind, index }),
      path: filePath,
      source_url: clean(selected.source_url || exact?.source_url),
      source_type: clean(exact?.source_type || selected.source_type || selected.provider_id || "licensed_audio"),
      source_family: clean(exact?.source_family || selected.source_family || selected.role || kind),
      source_owner: clean(exact?.source_owner || exact?.creator || selected.source_owner),
      provider_id: clean(exact?.provider_id || exact?.provider || selected.provider_id),
      role: clean(selected.role || exact?.role),
      exact,
    });
    alreadySelectedAudio.add(pathKey);
    if (assetId) alreadySelectedAudio.add(idKey);
  }
  used.push(...collectPlatformNativeAssets({
    artifactDir,
    storyId,
    platformManifest,
    targetPlatforms,
    finalVideoPath,
  }));
  return used;
}

function platformNativeRightsDonor(reconciled = [], targetPlatforms = []) {
  const underlying = reconciled.filter((record) => record.kind !== "platform_native");
  if (!underlying.length || underlying.some((record) => !completeMaterialRightsRecord(record, targetPlatforms))) {
    return null;
  }
  const platformSets = underlying.map((record) => new Set(
    asArray(record.allowed_platforms || record.platforms).map(normalisePlatformKey).filter(Boolean),
  ));
  const allowedPlatforms = [...platformSets[0]].filter((platform) =>
    platformSets.every((set) => set.has(platform)),
  );
  const requiredPlatforms = unique(asArray(targetPlatforms).map(normalisePlatformKey));
  if (requiredPlatforms.some((platform) => !allowedPlatforms.includes(platform))) return null;
  return {
    licence_basis: "derived_platform_variant_of_fully_rights_covered_final_render",
    allowed_use: "platform_native_transcode_of_governed_final_render",
    approval_status: "approved_for_platform_native_transcode",
    allowed_platforms: allowedPlatforms,
    commercial_use_allowed: underlying.every((record) => record.commercial_use_allowed === true),
    credit_required: underlying.some((record) => record.credit_required === true),
    risk_score: Math.max(0, ...underlying.map((record) => Number(record.risk_score) || 0)),
    underlying_rights_record_ids: underlying.map((record) => clean(record.asset_id || record.id)).filter(Boolean),
  };
}

async function defaultProbeMedia(filePath) {
  try {
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "json", filePath,
    ], { windowsHide: true, timeout: 30_000 });
    const parsed = JSON.parse(stdout || "{}");
    const duration = Number(parsed.format?.duration);
    return { decodable: Number.isFinite(duration) && duration > 0, duration_seconds: duration || null };
  } catch (error) {
    return { decodable: false, error: clean(error.message) };
  }
}

function flagshipInventoryAssets(inventory = {}) {
  const roots = asArray(
    inventory.used_assets ||
    inventory.assets ||
    inventory.used_asset_inventory,
  );
  const rightsRecords = ledgerRows(inventory);
  const flattened = [];
  const visit = (asset) => {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) return;
    const assetId = clean(asset.asset_id || asset.id || asset.asset_identity || asset.identity);
    const matches = rightsRecords.filter((record) => (
      clean(record.asset_id || record.id || record.asset_identity || record.identity) === assetId
    ));
    flattened.push({
      ...asset,
      ...(matches.length === 1 ? matches[0] : {}),
      asset_id: assetId,
      evidence_file: clean(
        asset.evidence_file ||
        asset.evidence_path ||
        asset.rights_evidence_path ||
        matches[0]?.evidence_file ||
        matches[0]?.evidence_path ||
        matches[0]?.rights_evidence_path,
      ),
      inventory_rights_record_count: matches.length,
    });
    for (const nested of [
      ...asArray(asset.nested_backdrops),
      ...asArray(asset.backdrops),
      ...asArray(asset.generated_card?.backdrops),
    ]) {
      visit(nested);
    }
  };
  for (const asset of roots) visit(asset);
  return flattened;
}

function sortedPlatforms(value) {
  return unique(asArray(value).map(normalisePlatformKey)).sort();
}

function equalCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function flagshipSidecarClaimBlockers({ asset, document, record }) {
  const assetId = clean(asset.asset_id);
  const blockers = [];
  const recordCreator = clean(record.creator || record.source_owner);
  const recordSourceUrl = clean(record.source_url);
  const recordLicenceBasis = rightsBasis(record);
  const recordPlatforms = sortedPlatforms(record.allowed_platforms || record.platforms);
  const sidecarPlatforms = sortedPlatforms(document.allowed_platforms || document.platforms);
  const assetPlatforms = sortedPlatforms(asset.allowed_platforms || asset.platforms);
  const expectedAssetHash = clean(record.asset_sha256).toLowerCase();
  const actualAssetHash = clean(document.asset_sha256 || document.sha256).toLowerCase();
  const sidecarVerdict = clean(document.rights_verdict || document.verdict).toUpperCase();

  if (document.schema_version !== 1) blockers.push(`flagship_rights_sidecar_schema_invalid:${assetId}`);
  if (clean(document.asset_id) !== assetId) {
    blockers.push(`flagship_rights_sidecar_asset_id_mismatch:${assetId}`);
  }
  if (!expectedAssetHash || actualAssetHash !== expectedAssetHash) {
    blockers.push(`flagship_rights_sidecar_asset_hash_mismatch:${assetId}`);
  }
  if (clean(document.source_url) !== recordSourceUrl) {
    blockers.push(`flagship_rights_sidecar_source_mismatch:${assetId}`);
  }
  if (clean(document.creator) !== recordCreator) {
    blockers.push(`flagship_rights_sidecar_creator_mismatch:${assetId}`);
  }
  if (rightsBasis(document) !== recordLicenceBasis) {
    blockers.push(`flagship_rights_sidecar_licence_mismatch:${assetId}`);
  }
  if (document.commercial_use_allowed !== true || record.commercial_use_allowed !== true) {
    blockers.push(`flagship_rights_sidecar_commercial_entitlement_missing:${assetId}`);
  }
  if (!["GREEN", "PASS", "PASSED", "APPROVED", "CLEARED"].includes(sidecarVerdict)) {
    blockers.push(`flagship_rights_sidecar_verdict_unacceptable:${assetId}`);
  }
  if (!equalCanonical(sidecarPlatforms, recordPlatforms)) {
    blockers.push(`flagship_rights_sidecar_platforms_mismatch:${assetId}`);
  }

  const inventorySourceUrl = clean(asset.source_url || asset.source?.url);
  const inventoryCreator = clean(asset.creator || asset.source_owner || asset.owner);
  const inventoryLicenceBasis = rightsBasis(asset);
  if (inventorySourceUrl && inventorySourceUrl !== recordSourceUrl) {
    blockers.push(`flagship_inventory_source_record_mismatch:${assetId}`);
  }
  if (inventoryCreator && inventoryCreator !== recordCreator) {
    blockers.push(`flagship_inventory_creator_record_mismatch:${assetId}`);
  }
  if (inventoryLicenceBasis && inventoryLicenceBasis !== recordLicenceBasis) {
    blockers.push(`flagship_inventory_licence_record_mismatch:${assetId}`);
  }
  if (assetPlatforms.length && !equalCanonical(assetPlatforms, recordPlatforms)) {
    blockers.push(`flagship_inventory_platforms_record_mismatch:${assetId}`);
  }
  return blockers;
}

async function prepareFlagshipRightsSidecarBindings({
  artifactDir,
  rightsPath,
  ledger,
  generatedAt,
}) {
  const inventoryPath = path.join(artifactDir, "flagship", "inventory.json");
  if (!(await fs.pathExists(inventoryPath))) {
    return {
      inventory_path: inventoryPath,
      present: false,
      discovered_count: 0,
      verified_count: 0,
      rebound_count: 0,
      rebound: [],
      blockers: [],
      updates: [],
    };
  }

  const blockers = [];
  let inventory = null;
  try {
    inventory = await fs.readJson(inventoryPath);
  } catch {
    blockers.push("flagship_inventory_invalid");
  }
  const inventoryVerdict = clean(
    inventory?.verdict || inventory?.status,
  ).toUpperCase();
  const inventoryRequiresRebuild =
    inventory?.complete === false ||
    ["RED", "FAIL", "FAILED", "BLOCKED"].includes(inventoryVerdict);
  if (inventoryRequiresRebuild) {
    return {
      inventory_path: inventoryPath,
      present: true,
      rebuild_required: true,
      discovered_count: 0,
      verified_count: 0,
      rebound_count: 0,
      rebound: [],
      blockers: [],
      updates: [],
    };
  }
  const assets = flagshipInventoryAssets(inventory || {});
  const ledgerRecords = asArray(ledger.records);
  const ledgerBuffer = serialiseJson(ledger);
  const ledgerSha256 = sha256(ledgerBuffer);
  const packageRoot = await fs.realpath(artifactDir);
  const stamp = generatedAt.replace(/[^0-9]/g, "");
  const updates = [];
  const discovered = [];
  const seenBindings = new Set();

  for (const asset of assets) {
    const assetId = clean(asset.asset_id);
    const evidenceReference = clean(asset.evidence_file);
    if (!assetId) {
      blockers.push("flagship_inventory_asset_id_missing");
      continue;
    }
    if (!evidenceReference || /^https?:\/\//i.test(evidenceReference)) {
      blockers.push(`flagship_rights_sidecar_path_missing:${assetId}`);
      continue;
    }
    const evidencePath = path.resolve(
      path.isAbsolute(evidenceReference)
        ? evidenceReference
        : path.join(artifactDir, evidenceReference),
    );
    if (!pathIsWithin(evidencePath, path.resolve(artifactDir))) {
      blockers.push(`flagship_rights_sidecar_outside_package:${assetId}`);
      continue;
    }
    if (!(await fs.pathExists(evidencePath))) {
      blockers.push(`flagship_rights_sidecar_missing:${assetId}`);
      continue;
    }
    const canonicalEvidencePath = await fs.realpath(evidencePath);
    if (!pathIsWithin(canonicalEvidencePath, packageRoot)) {
      blockers.push(`flagship_rights_sidecar_outside_package:${assetId}`);
      continue;
    }
    if (path.resolve(canonicalEvidencePath) === path.resolve(rightsPath)) {
      blockers.push(`flagship_rights_sidecar_not_distinct_from_ledger:${assetId}`);
      continue;
    }
    const bindingKey = `${assetId}|${canonicalEvidencePath.toLowerCase()}`;
    if (seenBindings.has(bindingKey)) {
      blockers.push(`flagship_rights_sidecar_inventory_duplicate:${assetId}`);
      continue;
    }
    seenBindings.add(bindingKey);

    const matches = ledgerRecords.filter((record) => clean(record.asset_id || record.id) === assetId);
    if (matches.length !== 1) {
      blockers.push(
        matches.length
          ? `flagship_rights_sidecar_source_record_duplicate:${assetId}`
          : `flagship_rights_sidecar_source_record_missing:${assetId}`,
      );
      continue;
    }
    let document = null;
    try {
      document = await fs.readJson(canonicalEvidencePath);
    } catch {
      blockers.push(`flagship_rights_sidecar_json_invalid:${assetId}`);
      continue;
    }
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      blockers.push(`flagship_rights_sidecar_json_invalid:${assetId}`);
      continue;
    }
    const declaredLedgerPath = clean(document.source_ledger_path);
    if (!declaredLedgerPath) {
      blockers.push(`flagship_rights_sidecar_source_ledger_path_missing:${assetId}`);
      continue;
    }
    const resolvedDeclaredLedgerPath = path.resolve(
      path.isAbsolute(declaredLedgerPath)
        ? declaredLedgerPath
        : path.join(artifactDir, declaredLedgerPath),
    );
    if (resolvedDeclaredLedgerPath !== path.resolve(rightsPath)) {
      blockers.push(`flagship_rights_sidecar_source_ledger_path_mismatch:${assetId}`);
      continue;
    }
    const claimBlockers = flagshipSidecarClaimBlockers({
      asset,
      document,
      record: matches[0],
    });
    blockers.push(...claimBlockers);
    if (claimBlockers.length) continue;

    const recordSha256 = sha256(Buffer.from(canonicalJson(matches), "utf8"));
    const needsRebind =
      clean(document.source_ledger_sha256).toLowerCase() !== ledgerSha256 ||
      clean(document.source_record_sha256).toLowerCase() !== recordSha256;
    const backupPath = needsRebind
      ? await availableTransactionBackupPath(
          `${canonicalEvidencePath}.pre_candidate_evidence_reconciliation.${stamp}.bak`,
        )
      : null;
    discovered.push({
      asset_id: assetId,
      path: canonicalEvidencePath,
      source_ledger_sha256: ledgerSha256,
      source_record_sha256: recordSha256,
      needs_rebind: needsRebind,
      backup_path: backupPath,
    });
    if (needsRebind) {
      updates.push({
        asset_id: assetId,
        path: canonicalEvidencePath,
        backup_path: backupPath,
        document: {
          ...document,
          source_ledger_sha256: ledgerSha256,
          source_record_sha256: recordSha256,
          source_binding_reconciled_at: generatedAt,
        },
      });
    }
  }

  return {
    inventory_path: inventoryPath,
    present: true,
    rebuild_required: !assets.length,
    discovered_count: discovered.length,
    verified_count: discovered.length,
    rebound_count: updates.length,
    rebound: updates.map((update) => ({
      asset_id: update.asset_id,
      path: update.path,
      backup_path: update.backup_path,
    })),
    blockers: unique(blockers),
    updates,
  };
}

async function reconcileRightsEvidence({
  artifactDir,
  bridgePath,
  storyId,
  apply,
  generatedAt,
  probeMedia,
  targetPlatforms = ENABLED_PLATFORMS,
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  authorityBlockers = [],
  fileTransaction = null,
}) {
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const renderManifestPath = path.join(artifactDir, "render_manifest.json");
  const renderManifest = await readJson(renderManifestPath, {});
  const audioManifest = await readJson(path.join(artifactDir, "audio_manifest.json"), {});
  const narrationManifest = await readJson(path.join(artifactDir, "narration_manifest.json"), {});
  const sfxManifest = await readJson(path.join(artifactDir, "sfx_manifest.json"), {});
  const platformManifest = await readJson(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const canonicalManifest = await readJson(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const original = await readJson(rightsPath, null);
  const rows = ledgerRows(original);
  const blockers = [];
  const strictFlagshipNarrationRightsRequired =
    renderManifest.selected_input_assets?.authoritative === true &&
    renderManifest.flagship_generation_evidence?.complete === true &&
    clean(renderManifest.flagship_generation_evidence?.verdict).toUpperCase() === "GREEN";
  const finalVideoPath = resolveAssetPath(
    renderManifest.output_path || renderManifest.output || "visual_v4_render.mp4",
    artifactDir,
  );
  if (!finalVideoPath || !(await fs.pathExists(finalVideoPath))) {
    blockers.push("final_render_missing");
  } else {
    const mediaProbe = await probeMedia(finalVideoPath);
    if (mediaProbe?.decodable !== true) blockers.push("final_render_not_decodable");
  }

  const usedAssets = await collectUsedAssets({
    artifactDir,
    storyId,
    renderManifest,
    audioManifest,
    narrationManifest,
    sfxManifest,
    platformManifest,
    targetPlatforms,
    finalVideoPath,
    rows,
    workspaceRoot,
    canonicalManifest,
  });
  const reconciled = [];
  for (const used of usedAssets) {
    let narrationCommercialRightsEvidence = null;
    let narrationCommercialRightsEvidencePath = "";
    let narrationCommercialRightsEvidenceFingerprint = null;
    if (asArray(used.provenance_blockers).length) {
      blockers.push(...asArray(used.provenance_blockers));
      continue;
    }
    if (!used.path || !(await fs.pathExists(used.path))) {
      blockers.push(`used_asset_missing:${used.asset_id}`);
      continue;
    }
    const assetFingerprint = await fingerprintFile(used.path);
    if (
      strictFlagshipNarrationRightsRequired &&
      used.kind === "narration" &&
      clean(used.provider_id).toLowerCase() === "elevenlabs"
    ) {
      narrationCommercialRightsEvidencePath = resolveAssetPath(
        used.commercial_rights_evidence_reference,
        artifactDir,
      );
      if (
        !narrationCommercialRightsEvidencePath ||
        !(await fs.pathExists(narrationCommercialRightsEvidencePath))
      ) {
        blockers.push(
          `narration_commercial_rights_evidence_missing:${used.asset_id}`,
        );
        continue;
      }
      narrationCommercialRightsEvidence = await readJson(
        narrationCommercialRightsEvidencePath,
        null,
      );
      narrationCommercialRightsEvidenceFingerprint = await fingerprintFile(
        narrationCommercialRightsEvidencePath,
      );
      const rightsEvidenceVerdict = clean(
        narrationCommercialRightsEvidence?.verdict ||
          narrationCommercialRightsEvidence?.status,
      ).toUpperCase();
      if (!["GREEN", "PASS", "PASSED"].includes(rightsEvidenceVerdict)) {
        blockers.push(
          `narration_commercial_rights_evidence_not_green:${used.asset_id}`,
        );
        continue;
      }
      const legacyDeclaredAudioSha256 = clean(
        narrationCommercialRightsEvidence.audio_sha256,
      ).toLowerCase();
      if (
        validSha256(legacyDeclaredAudioSha256) &&
        legacyDeclaredAudioSha256 !== assetFingerprint.sha256
      ) {
        blockers.push(
          `narration_commercial_rights_audio_fingerprint_mismatch:${used.asset_id}`,
        );
      }
      const legacySubscriptionEvidence =
        narrationCommercialRightsEvidence.subscription_evidence || {};
      const legacySubscriptionTier = clean(
        legacySubscriptionEvidence.tier,
      ).toLowerCase();
      if (
        legacySubscriptionTier &&
        (
          ["free", "trial"].includes(legacySubscriptionTier) ||
          legacySubscriptionEvidence.paid_plan !== true
        )
      ) {
        blockers.push(
          `narration_commercial_rights_paid_entitlement_missing:${used.asset_id}`,
        );
      }
      const generationLineageBlockers =
        await strictElevenLabsGenerationEvidenceBlockers({
          evidence: narrationCommercialRightsEvidence,
          artifactDir,
          storyId,
          used,
          targetPlatforms,
          currentAudioFingerprint: assetFingerprint,
        });
      if (generationLineageBlockers.length) {
        blockers.push(
          `narration_commercial_rights_generation_lineage_incomplete:${used.asset_id}`,
          ...generationLineageBlockers.map(
            (blocker) =>
              `narration_commercial_rights_generation_lineage:${blocker}:${used.asset_id}`,
          ),
        );
        continue;
      }
    }
    const exactCandidates = rows.filter((row) => recordPaths(row, artifactDir).includes(normalisePath(used.path, artifactDir)));
    const currentValidatedRightsAssessment = await currentValidatedOfficialMotionRights(
      used,
      targetPlatforms,
      artifactDir,
    );
    const currentValidatedRights = currentValidatedRightsAssessment.record;
    if (currentValidatedRightsAssessment.blockers.length) {
      blockers.push(
        ...currentValidatedRightsAssessment.blockers.map(
          (blocker) => `${blocker}:${used.asset_id}`,
        ),
      );
      continue;
    }
    const restrictiveExact = exactCandidates.find((row) =>
      explicitRightsRestrictionReasons(row, targetPlatforms).length > 0,
    );
    const currentOwnedGeneratedCardRights =
      used.current_owned_generated_card_sidecar === true &&
      used.rights_grant === true &&
      clean(used.evidence_kind) === "owned_generated_hyperframes_shell_sidecar" &&
      completeRightsRecord(used, targetPlatforms);
    if (
      restrictiveExact &&
      !(
        currentOwnedGeneratedCardRights ||
        (
          currentValidatedRights &&
          provisionalRendererLocalProofRecord(restrictiveExact)
        )
      )
    ) {
      blockers.push(`restrictive_rights_record:${used.asset_id}`);
      continue;
    }
    const restrictiveNarrationDonor = used.kind === "narration"
      ? rows.find((row) =>
        sourceEquivalent(row, used) && explicitRightsRestrictionReasons(row, targetPlatforms).length > 0,
      )
      : null;
    if (restrictiveNarrationDonor) {
      blockers.push(`restrictive_rights_record:${used.asset_id}`);
      continue;
    }
    const exact = exactCandidates.find((row) => completeRightsRecord(row, targetPlatforms)) || used.exact || null;
    let donor = (used.kind === "narration" || used.current_owned_generated_card_sidecar === true) &&
      completeRightsRecord(used, targetPlatforms)
      ? used
      : completeRightsRecord(exact, targetPlatforms)
      ? exact
      : rows.find((row) => completeRightsRecord(row, targetPlatforms) && sourceEquivalent(row, used));
    if (!donor) donor = currentValidatedRights;
    if (!donor) {
      donor = await exactLocalProviderRightsDonor(used, targetPlatforms, workspaceRoot);
    }
    if (!donor && used.kind === "platform_native") {
      donor = platformNativeRightsDonor(reconciled, targetPlatforms);
    }
    if (!donor) {
      blockers.push(`complete_rights_record_missing:${used.asset_id}`);
      continue;
    }
    const evidenceFile = await evidencePathForUsedAsset(used, artifactDir, donor, workspaceRoot);
    const evidenceResolved = resolveAssetPath(evidenceFile, artifactDir);
    if (!/^https?:\/\//i.test(evidenceFile) && (!evidenceResolved || !(await fs.pathExists(evidenceResolved)))) {
      blockers.push(`rights_evidence_missing:${used.asset_id}`);
      continue;
    }
    if (narrationCommercialRightsEvidence) {
      const declaredAudioSha256 = clean(
        narrationCommercialRightsEvidence.lineage?.final_audio_sha256,
      ).toLowerCase();
      if (
        declaredAudioSha256 !== assetFingerprint.sha256
      ) {
        blockers.push(
          `narration_commercial_rights_audio_fingerprint_mismatch:${used.asset_id}`,
        );
        continue;
      }
    }
    const fingerprintedExactCandidates = exactCandidates.filter((row) => {
      const declared = declaredAssetFingerprint(row);
      return Boolean(declared.sha256 && declared.size_bytes);
    });
    const exactFingerprintStillCurrent = fingerprintedExactCandidates.some((row) =>
      declaredFingerprintMatches(row, assetFingerprint),
    );
    if (
      used.kind === "video" &&
      fingerprintedExactCandidates.length &&
      !exactFingerprintStillCurrent &&
      !renderSelectedAssetFingerprintMatches({
        renderManifest,
        used,
        current: assetFingerprint,
        artifactDir,
      })
    ) {
      blockers.push(
        `render_selected_asset_fingerprint_missing_or_mismatch:${used.asset_id}`,
      );
      continue;
    }
    if (used.expected_asset_sha256 && used.expected_asset_sha256 !== assetFingerprint.sha256) {
      blockers.push(`narration_manifest_audio_hash_mismatch:${used.asset_id}`);
      continue;
    }
    if (used.expected_asset_size_bytes && used.expected_asset_size_bytes !== assetFingerprint.size_bytes) {
      blockers.push(`narration_manifest_audio_size_mismatch:${used.asset_id}`);
      continue;
    }
    const evidenceFingerprint = evidenceResolved && await fs.pathExists(evidenceResolved)
      ? await fingerprintFile(evidenceResolved)
      : null;
    const ownedGeneratedCard = used.kind === "video" && ownedGeneratedCardRecord(donor);
    const providerText = [
      used.provider_id,
      used.source_type,
      used.source_url,
      donor.provider_id,
      donor.provider,
      donor.source_type,
      donor.source_url,
    ].map(clean).join(" ").toLowerCase();
    const ownedNarration = used.kind === "narration";
    const epidemicAudio =
      (used.kind === "sfx" || used.kind === "music") &&
      /epidemic(?:_|\s|-)?sound/.test(providerText);
    const record = {
      ...donor,
      ...(used.exact || {}),
      ...(used.metadata || {}),
      asset_id: used.asset_id,
      id: used.asset_id,
      kind: used.kind,
      path: used.path,
      local_materialized_path: used.path,
      source_url: used.source_url || clean(donor.source_url),
      local_source_master_path: used.local_source_master_path ||
        clean(donor.local_source_master_path || donor.source_master_path) || null,
      source_master_sha256: used.source_master_sha256 || clean(donor.source_master_sha256) || null,
      youtube_video_id: used.youtube_video_id || clean(donor.youtube_video_id) || null,
      source_type: used.source_type || clean(donor.source_type),
      source_family: used.source_family || clean(donor.source_family || donor.motion_family),
      source_owner: clean(
        used.source_owner ||
          (ownedGeneratedCard || ownedNarration ? "Pulse Gaming" : "") ||
          (epidemicAudio ? "Epidemic Sound" : "") ||
          donor.source_owner || donor.creator,
      ),
      provider_id: clean(
        used.provider_id || donor.provider_id || donor.provider ||
          (ownedGeneratedCard ? "pulse_hyperframes" : "") ||
          (ownedNarration ? "pulse_local_tts" : "") ||
          (epidemicAudio ? "epidemic_sound" : ""),
      ),
      approval_status: clean(
        used.approval_status || donor.approval_status ||
          (used.kind === "platform_native" ? "approved_for_platform_native_transcode" : ""),
      ),
      rights_verdict: "GREEN",
      rights_grant: donor.rights_grant === true
        ? true
        : used.rights_grant === false
          ? false
          : undefined,
      source_identity_rights_grant:
        donor.source_identity_rights_grant === false ? false : undefined,
      transformative_rights_evidence_verified:
        donor.transformative_rights_evidence_verified === true,
      evidence_kind: clean(donor.evidence_kind || used.evidence_kind) || undefined,
      verdict: undefined,
      status: undefined,
      usage_status: undefined,
      rights_status: clean(donor.rights_status || used.rights_status),
      usage_scope: clean(donor.usage_scope || used.usage_scope),
      rights_decision_basis: clean(
        donor.rights_decision_basis ||
          used.rights_decision_basis,
      ),
      licence_basis: rightsBasis(used) || rightsBasis(donor),
      allowed_use: clean(used.allowed_use || donor.allowed_use) || null,
      commercial_use_allowed:
        used.commercial_use_allowed === true || donor.commercial_use_allowed === true,
      allowed_platforms: unique(
        asArray(used.allowed_platforms || donor.allowed_platforms || donor.platforms).map(normalisePlatformKey),
      ),
      credit_required: used.credit_required === true || donor.credit_required === true,
      risk_score: Number.isFinite(Number(used.risk_score))
        ? Number(used.risk_score)
        : Number(donor.risk_score) || 0,
      derived_from: used.derived_from || donor.derived_from || null,
      transformation_provenance:
        used.transformation_provenance || donor.transformation_provenance || {},
      underlying_rights_record_ids: asArray(donor.underlying_rights_record_ids),
      evidence_file: evidenceFile,
      ...(narrationCommercialRightsEvidence
        ? {
            commercial_rights_evidence_file:
              narrationCommercialRightsEvidencePath,
            commercial_rights_evidence_sha256:
              narrationCommercialRightsEvidenceFingerprint.sha256,
            commercial_rights_evidence_size_bytes:
              narrationCommercialRightsEvidenceFingerprint.size_bytes,
            subscription_tier_at_generation: clean(
              narrationCommercialRightsEvidence.account_entitlement
                ?.pre_generation?.tier,
            ).toLowerCase(),
            subscription_status_at_generation: clean(
              narrationCommercialRightsEvidence.account_entitlement
                ?.pre_generation?.status,
            ).toLowerCase(),
            elevenlabs_request_id: clean(
              narrationCommercialRightsEvidence.generation?.request_id,
            ),
            elevenlabs_history_item_id: clean(
              narrationCommercialRightsEvidence.generation?.history_item_id,
            ),
            elevenlabs_raw_provider_audio_sha256: clean(
              narrationCommercialRightsEvidence.generation
                ?.raw_provider_audio_sha256,
            ).toLowerCase(),
          }
        : {}),
      ...(used.narration_manifest_audio_mirror_verified === true
        ? {
            narration_manifest_audio_mirror_path: used.narration_manifest_audio_mirror_path,
            narration_manifest_audio_mirror_verified: true,
          }
        : {}),
      asset_sha256: assetFingerprint.sha256,
      asset_size_bytes: assetFingerprint.size_bytes,
      evidence_sha256: evidenceFingerprint?.sha256 || null,
      evidence_size_bytes: evidenceFingerprint?.size_bytes || null,
      reconciled_at: generatedAt,
      reconciliation_basis: used.kind === "platform_native" && !exact
        ? "derived_from_complete_final_used_asset_rights"
        : used.current_owned_generated_card_sidecar === true && donor === used
          ? "current_owned_generated_card_sidecar"
        : donor?.current_validated_official_materialised_clip === true
          ? "current_validated_official_materialised_clip"
        : exact === donor
          ? "exact_current_asset_record"
          : "same_source_current_asset_record",
    };
    if (!completeMaterialRightsRecord(record, targetPlatforms)) {
      blockers.push(`reconciled_rights_record_incomplete:${used.asset_id}`);
      continue;
    }
    reconciled.push(record);
  }

  const uniqueRecords = [];
  const seen = new Set();
  for (const record of reconciled) {
    const key = `${clean(record.asset_id).toLowerCase()}|${normalisePath(record.path, artifactDir)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRecords.push(record);
  }
  if (!usedAssets.length) blockers.push("used_asset_inventory_empty");
  if (uniqueRecords.length !== usedAssets.length) blockers.push("used_asset_rights_coverage_incomplete");
  const uniqueBlockers = unique(blockers);
  const ledger = {
    schema_version: 2,
    story_id: storyId,
    generated_at: generatedAt,
    verdict: uniqueBlockers.length ? "fail" : "pass",
    used_assets: uniqueRecords.map((record) => ({
      asset_id: record.asset_id,
      kind: record.kind,
      path: record.path,
      source_url: record.source_url || null,
      source_type: record.source_type || null,
      source_family: record.source_family || null,
      asset_sha256: record.asset_sha256,
      asset_size_bytes: record.asset_size_bytes,
    })),
    records: uniqueRecords,
    metrics: {
      used_asset_count: usedAssets.length,
      rights_record_count: uniqueRecords.length,
      missing_asset_count: Math.max(0, usedAssets.length - uniqueRecords.length),
      duplicate_record_count: duplicateCount(uniqueRecords),
    },
    blockers: uniqueBlockers,
    reconciliation: {
      current_files_hashed: true,
      final_render_decoded: !uniqueBlockers.includes("final_render_not_decodable") &&
        !uniqueBlockers.includes("final_render_missing"),
      source_equivalence_required_for_inherited_rights: true,
      authoritative_publish_verdict_unchanged: true,
      used_asset_record_coverage: `${uniqueRecords.length}/${usedAssets.length}`,
    },
  };
  const flagshipSidecarBindings = await prepareFlagshipRightsSidecarBindings({
    artifactDir,
    rightsPath,
    ledger,
    generatedAt,
  });
  uniqueBlockers.push(...flagshipSidecarBindings.blockers);
  ledger.verdict = uniqueBlockers.length ? "fail" : "pass";
  ledger.blockers = uniqueBlockers;

  let backupPath = null;
  let bridgeBackupPath = null;
  let bridgeRightsSynced = false;
  let bridgeDocument = null;
  let bridgeCandidateIndex = -1;
  const resolvedBridgePath = bridgePath ? path.resolve(bridgePath) : "";
  if (resolvedBridgePath) {
    if (!(await fs.pathExists(resolvedBridgePath))) {
      uniqueBlockers.push("scheduler_bridge_candidates_missing");
    } else {
      bridgeDocument = fileTransaction
        ? await fileTransaction.readJson(resolvedBridgePath, null)
        : await readJson(resolvedBridgePath, null);
      const rows = bridgeRows(bridgeDocument);
      bridgeCandidateIndex = rows.findIndex((candidate) => clean(candidate.story_id || candidate.id) === storyId);
      if (bridgeCandidateIndex < 0) {
        uniqueBlockers.push("bridge_candidate_missing");
      }
    }
  }
  const ledgerBuffer = serialiseJson(ledger);
  const ledgerFingerprint = {
    sha256: sha256(ledgerBuffer),
    size_bytes: ledgerBuffer.length,
  };
  const bridgeWillBeSynced = Boolean(
    !uniqueBlockers.length &&
    resolvedBridgePath &&
    bridgeDocument &&
    bridgeCandidateIndex >= 0,
  );
  const reconciliationPassed = uniqueBlockers.length === 0;
  const renderRightsReconciliation = {
    verdict: reconciliationPassed ? "PASS" : "FAIL",
    status: reconciliationPassed ? "GREEN" : "RED",
    rights_ledger_path: rightsPath,
    bridge_rights_synced: bridgeWillBeSynced,
    applied: reconciliationPassed,
    used_asset_count: usedAssets.length,
    reconciled_record_count: uniqueRecords.length,
    duplicate_record_count_after: duplicateCount(uniqueRecords),
    blockers: uniqueBlockers,
    applied_ledger_verdict: reconciliationPassed ? "GREEN" : "RED",
    applied_ledger_record_count: uniqueRecords.length,
    applied_ledger_sha256: ledgerFingerprint.sha256,
    applied_ledger_size_bytes: ledgerFingerprint.size_bytes,
    can_auto_publish: reconciliationPassed,
    generated_at: generatedAt,
    final_state_verified: reconciliationPassed,
    final_state_verification_basis:
      "stored_rights_ledger_after_candidate_evidence_reconciliation",
  };
  const reconciledRenderManifest = {
    ...renderManifest,
    rights_reconciliation: renderRightsReconciliation,
  };
  const updatedBridgeCandidate = bridgeWillBeSynced
    ? {
        ...bridgeRows(bridgeDocument)[bridgeCandidateIndex],
        rights_ledger: ledger,
        rights_records: ledger.records,
        render_manifest: {
          ...(bridgeRows(bridgeDocument)[bridgeCandidateIndex].render_manifest || {}),
          rights_reconciliation: renderRightsReconciliation,
        },
      }
    : null;
  let applied = false;
  let sectionTransaction = null;
  let renderManifestBackupPath = null;
  if (apply && !uniqueBlockers.length) {
    const stamp = generatedAt.replace(/[^0-9]/g, "");
    backupPath = await availableTransactionBackupPath(
      `${rightsPath}.pre_candidate_evidence_reconciliation.${stamp}.bak`,
    );
    renderManifestBackupPath = await availableTransactionBackupPath(
      `${renderManifestPath}.pre_candidate_evidence_reconciliation.${stamp}.bak`,
    );
    const activeTransaction = fileTransaction || new LocalJsonFileTransaction();
    try {
      await activeTransaction.stageJson(rightsPath, ledger, backupPath);
      await activeTransaction.stageJson(
        renderManifestPath,
        reconciledRenderManifest,
        renderManifestBackupPath,
      );
      for (const sidecar of flagshipSidecarBindings.updates) {
        await activeTransaction.stageJson(
          sidecar.path,
          sidecar.document,
          sidecar.backup_path,
        );
      }
      if (resolvedBridgePath && updatedBridgeCandidate) {
        bridgeBackupPath = await availableTransactionBackupPath(
          `${resolvedBridgePath}.pre_candidate_evidence_reconciliation.rights.${stamp}.bak`,
        );
        const nextRows = bridgeRows(bridgeDocument).slice();
        nextRows[bridgeCandidateIndex] = updatedBridgeCandidate;
        await activeTransaction.stageJson(
          resolvedBridgePath,
          withBridgeRows(bridgeDocument, nextRows),
          bridgeBackupPath,
        );
      }
      if (!fileTransaction) {
        sectionTransaction = await activeTransaction.commit();
        applied = true;
        bridgeRightsSynced = Boolean(bridgeBackupPath);
      }
    } catch (error) {
      uniqueBlockers.push("local_file_transaction_failed");
      Object.assign(
        renderRightsReconciliation,
        failedRenderRightsReconciliation(renderRightsReconciliation),
      );
      sectionTransaction = transactionFailure(error);
    }
  }
  return {
    verdict: uniqueBlockers.length ? "FAIL" : "PASS",
    rights_ledger_path: rightsPath,
    backup_path: backupPath,
    render_manifest_backup_path: renderManifestBackupPath,
    bridge_backup_path: bridgeBackupPath,
    bridge_rights_synced: bridgeRightsSynced,
    applied,
    used_asset_count: usedAssets.length,
    reconciled_record_count: uniqueRecords.length,
    duplicate_record_count_before: duplicateCount(rows),
    duplicate_record_count_after: duplicateCount(uniqueRecords),
    authority_blockers: unique(authorityBlockers),
    blockers: uniqueBlockers,
    flagship_sidecar_bindings: {
      inventory_path: flagshipSidecarBindings.inventory_path,
      present: flagshipSidecarBindings.present,
      rebuild_required: flagshipSidecarBindings.rebuild_required === true,
      discovered_count: flagshipSidecarBindings.discovered_count,
      verified_count: flagshipSidecarBindings.verified_count,
      rebound_count: flagshipSidecarBindings.rebound_count,
      rebound: flagshipSidecarBindings.rebound,
      blockers: flagshipSidecarBindings.blockers,
    },
    proposed_ledger: ledger,
    proposed_render_rights_reconciliation: renderRightsReconciliation,
    ...(sectionTransaction ? { transaction: sectionTransaction } : {}),
  };
}

function bridgeRows(document) {
  if (Array.isArray(document)) return document;
  if (Array.isArray(document?.scheduler_bridge_candidates)) return document.scheduler_bridge_candidates;
  if (Array.isArray(document?.bridge_candidates)) return document.bridge_candidates;
  if (Array.isArray(document?.candidates)) return document.candidates;
  return [];
}

function withBridgeRows(document, rows) {
  if (Array.isArray(document)) return rows;
  if (Array.isArray(document?.bridge_candidates) && !Array.isArray(document?.scheduler_bridge_candidates)) {
    return { ...document, bridge_candidates: rows };
  }
  if (Array.isArray(document?.candidates) && !Array.isArray(document?.scheduler_bridge_candidates)) {
    return { ...document, candidates: rows };
  }
  return { ...document, scheduler_bridge_candidates: rows };
}

function fingerprintMatchesCurrent(fingerprint = {}, audioFingerprint = {}, timestampFingerprint = {}) {
  return (
    clean(fingerprint.audio_sha256) === audioFingerprint.sha256 &&
    clean(fingerprint.word_timestamps_sha256) === timestampFingerprint.sha256 &&
    Number(fingerprint.audio_size_bytes) === audioFingerprint.size_bytes &&
    Number(fingerprint.word_timestamps_size_bytes) === timestampFingerprint.size_bytes
  );
}

function normaliseSha256(value) {
  return clean(value).replace(/^sha256:/i, "").toLowerCase();
}

function finalAvPublishBlockers(review) {
  if (!objectHasKeys(review)) return ["final_av_review_missing"];
  const explicit = authoritativeFailures(review);
  if (explicit.length) return explicit;
  const reviewStatus = clean(review.verdict || review.status).toUpperCase();
  if (reviewStatus === "PENDING" || review.independent_review_required === true) {
    return ["independent_final_av_review_pending"];
  }
  if (
    statusIsRed(reviewStatus) ||
    review.publish_ready === false ||
    review.can_auto_publish === false
  ) {
    return ["final_av_review_not_green"];
  }
  const reviewGreen = ["GREEN", "PASS", "PASSED"].includes(reviewStatus);
  return reviewGreen && review.publish_ready === true
    ? []
    : ["final_av_review_not_green"];
}

async function inspectCurrentEvidence({
  artifactDir,
  storyId,
  probeMedia,
  authority,
  rights,
}) {
  const blockers = [];
  const renderManifest = await readJson(path.join(artifactDir, "render_manifest.json"), {});
  const audioManifest = await readJson(path.join(artifactDir, "audio_manifest.json"), {});
  const canonicalManifest = await readJson(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const decodedForensic = await readJson(path.join(artifactDir, "decoded_forensic_report.json"), null);
  const finalAvReview = await readJson(path.join(artifactDir, "final_av_review.json"), null);
  const authoritativeFingerprint = renderManifest.input_fingerprint || {};
  const audioPath = resolveAssetPath(
    audioManifest.resolved_narration_audio_path || audioManifest.narration_audio_path,
    artifactDir,
  );
  const timestampsPath = resolveAssetPath(
    audioManifest.resolved_word_timestamps_path || audioManifest.word_timestamps_path,
    artifactDir,
  );
  const finalVideoPath = resolveAssetPath(
    renderManifest.output_path || renderManifest.output || "visual_v4_render.mp4",
    artifactDir,
  );
  if (!audioPath || !(await fs.pathExists(audioPath))) blockers.push("current_narration_audio_missing");
  if (!timestampsPath || !(await fs.pathExists(timestampsPath))) blockers.push("current_word_timestamps_missing");
  if (!finalVideoPath || !(await fs.pathExists(finalVideoPath))) blockers.push("final_render_missing");

  const audioFingerprint = blockers.includes("current_narration_audio_missing")
    ? null
    : await fingerprintFile(audioPath);
  const timestampFingerprint = blockers.includes("current_word_timestamps_missing")
    ? null
    : await fingerprintFile(timestampsPath);
  let finalVideoFingerprint = null;
  let finalRenderDecodable = false;
  if (!blockers.includes("final_render_missing")) {
    finalVideoFingerprint = await fingerprintFile(finalVideoPath);
    const mediaProbe = await probeMedia(finalVideoPath);
    finalRenderDecodable = mediaProbe?.decodable === true;
    if (!finalRenderDecodable) blockers.push("final_render_not_decodable");
  }
  if (
    audioFingerprint &&
    timestampFingerprint &&
    !fingerprintMatchesCurrent(authoritativeFingerprint, audioFingerprint, timestampFingerprint)
  ) {
    blockers.push("authoritative_render_fingerprint_not_same_run");
  }
  const lineage = verifyFinalRenderInputLineage(
    { story_id: storyId, artifact_dir: artifactDir },
    renderManifest,
  );
  if (lineage.pass !== true) blockers.push(...asArray(lineage.blockers));
  const decodedRenderHash = normaliseSha256(decodedForensic?.final_media?.sha256);
  if (
    decodedRenderHash &&
    finalVideoFingerprint &&
    decodedRenderHash !== finalVideoFingerprint.sha256
  ) {
    blockers.push("decoded_forensic_render_hash_mismatch");
  }
  if (
    objectHasKeys(decodedForensic) &&
    (decodedForensic.decoded !== true || decodedForensic.full_duration_decoded !== true)
  ) {
    blockers.push("decoded_forensic_full_duration_decode_missing");
  }
  const rightsComplete = rights?.verdict === "PASS";
  if (!rightsComplete) {
    blockers.push(...(
      rights?.verdict === "FAIL"
        ? asArray(rights.blockers)
        : ["current_rights_evidence_not_reconciled"]
    ));
  }
  const uniqueBlockers = unique(blockers);
  const reviewBlockers = finalAvPublishBlockers(finalAvReview);
  const publishBlockers = unique([
    ...uniqueBlockers,
    ...asArray(authority?.blockers),
    ...asArray(authority?.reported_failures),
    ...reviewBlockers,
  ]);
  return {
    verdict: uniqueBlockers.length ? "FAIL" : "PASS",
    reconciled: uniqueBlockers.length === 0,
    same_run_verified: Boolean(
      audioFingerprint &&
      timestampFingerprint &&
      fingerprintMatchesCurrent(authoritativeFingerprint, audioFingerprint, timestampFingerprint) &&
      lineage.pass === true &&
      rightsComplete
    ),
    final_render_decodable: finalRenderDecodable,
    rights_complete: rightsComplete,
    publish_readiness: publishBlockers.length ? "RED" : "UNCHANGED",
    green_eligible: publishBlockers.length === 0,
    blockers: uniqueBlockers,
    publish_blockers: publishBlockers,
    final_av_review: {
      path: path.join(artifactDir, "final_av_review.json"),
      present: objectHasKeys(finalAvReview),
      verdict: clean(finalAvReview?.verdict || finalAvReview?.status) || "MISSING",
      blockers: reviewBlockers,
    },
    current_files: {
      final_render_path: finalVideoPath || null,
      final_render_sha256: finalVideoFingerprint?.sha256 || null,
      final_render_size_bytes: finalVideoFingerprint?.size_bytes || null,
      narration_audio_path: audioPath || null,
      audio_sha256: audioFingerprint?.sha256 || null,
      audio_size_bytes: audioFingerprint?.size_bytes || null,
      word_timestamps_path: timestampsPath || null,
      word_timestamps_sha256: timestampFingerprint?.sha256 || null,
      word_timestamps_size_bytes: timestampFingerprint?.size_bytes || null,
    },
    lineage_verification: lineage,
    canonical_story_id: storyIdFor(canonicalManifest) || null,
  };
}

async function reconcileBridgeFingerprintEvidence({
  artifactDir,
  bridgePath,
  storyId,
  apply,
  generatedAt,
  probeMedia,
  authorityBlockers = [],
  fileTransaction = null,
}) {
  const blockers = [...authorityBlockers];
  const resolvedBridgePath = bridgePath ? path.resolve(bridgePath) : "";
  if (!resolvedBridgePath || !(await fs.pathExists(resolvedBridgePath))) {
    return {
      verdict: "FAIL",
      bridge_path: resolvedBridgePath || null,
      applied: false,
      changed: false,
      same_run_verified: false,
      backup_path: null,
      blockers: ["scheduler_bridge_candidates_missing"],
    };
  }
  const renderManifestPath = path.join(artifactDir, "render_manifest.json");
  const renderManifest = fileTransaction
    ? await fileTransaction.readJson(renderManifestPath, {})
    : await readJson(renderManifestPath, {});
  const audioManifest = await readJson(path.join(artifactDir, "audio_manifest.json"), {});
  const canonicalManifest = await readJson(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const authoritativeFingerprint = renderManifest.input_fingerprint || {};
  const expectedStoryId = clean(storyId);
  const canonicalStoryId = storyIdFor(canonicalManifest);
  const renderStoryId = storyIdFor(renderManifest);
  const audioStoryId = storyIdFor(audioManifest);
  const fingerprintStoryId = storyIdFor(authoritativeFingerprint.canonical_snapshot || {});
  if (canonicalStoryId && canonicalStoryId !== expectedStoryId) blockers.push("canonical_story_id_mismatch");
  if (renderStoryId && renderStoryId !== expectedStoryId) blockers.push("render_manifest_story_id_mismatch");
  if (audioStoryId && audioStoryId !== expectedStoryId) blockers.push("audio_manifest_story_id_mismatch");
  if (fingerprintStoryId && fingerprintStoryId !== expectedStoryId) {
    blockers.push("render_fingerprint_story_id_mismatch");
  }
  const audioPath = resolveAssetPath(
    audioManifest.resolved_narration_audio_path || audioManifest.narration_audio_path,
    artifactDir,
  );
  const timestampsPath = resolveAssetPath(
    audioManifest.resolved_word_timestamps_path || audioManifest.word_timestamps_path,
    artifactDir,
  );
  const finalVideoPath = resolveAssetPath(
    renderManifest.output_path || renderManifest.output || "visual_v4_render.mp4",
    artifactDir,
  );
  if (!audioPath || !(await fs.pathExists(audioPath))) blockers.push("current_narration_audio_missing");
  if (!timestampsPath || !(await fs.pathExists(timestampsPath))) blockers.push("current_word_timestamps_missing");
  if (!finalVideoPath || !(await fs.pathExists(finalVideoPath))) blockers.push("final_render_missing");

  let audioFingerprint = null;
  let timestampFingerprint = null;
  if (!blockers.includes("current_narration_audio_missing")) audioFingerprint = await fingerprintFile(audioPath);
  if (!blockers.includes("current_word_timestamps_missing")) timestampFingerprint = await fingerprintFile(timestampsPath);
  if (!blockers.includes("final_render_missing")) {
    const mediaProbe = await probeMedia(finalVideoPath);
    if (mediaProbe?.decodable !== true) blockers.push("final_render_not_decodable");
  }
  if (audioFingerprint && timestampFingerprint &&
    !fingerprintMatchesCurrent(authoritativeFingerprint, audioFingerprint, timestampFingerprint)) {
    blockers.push("authoritative_render_fingerprint_not_same_run");
  }
  const lineage = verifyFinalRenderInputLineage(
    { story_id: storyId, artifact_dir: artifactDir },
    renderManifest,
  );
  if (lineage.pass !== true) blockers.push(...asArray(lineage.blockers));

  const bridgeDocument = fileTransaction
    ? await fileTransaction.readJson(resolvedBridgePath, null)
    : await readJson(resolvedBridgePath, null);
  const rows = bridgeRows(bridgeDocument);
  const index = rows.findIndex((candidate) => clean(candidate.story_id || candidate.id) === storyId);
  if (index < 0) blockers.push("bridge_candidate_missing");
  const uniqueBlockers = unique(blockers);
  if (uniqueBlockers.length) {
    return {
      verdict: "FAIL",
      bridge_path: resolvedBridgePath,
      applied: false,
      changed: false,
      same_run_verified: false,
      backup_path: null,
      blockers: uniqueBlockers,
      current_files: {
        audio_sha256: audioFingerprint?.sha256 || null,
        audio_size_bytes: audioFingerprint?.size_bytes || null,
        word_timestamps_sha256: timestampFingerprint?.sha256 || null,
        word_timestamps_size_bytes: timestampFingerprint?.size_bytes || null,
      },
      lineage_verification: lineage,
    };
  }

  const reconciledInputEvidence = {
    ...(renderManifest.input_evidence || {}),
    narration_audio_path: audioPath,
    resolved_narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
    resolved_word_timestamps_path: timestampsPath,
    evidence_reconciled_at: generatedAt,
  };
  const reconciledRenderManifest = {
    ...renderManifest,
    input_fingerprint: authoritativeFingerprint,
    input_evidence: reconciledInputEvidence,
  };
  const originalCandidate = rows[index];
  const updatedCandidate = {
    ...originalCandidate,
    render_manifest: {
      ...(originalCandidate.render_manifest || {}),
      input_fingerprint: authoritativeFingerprint,
      input_evidence: reconciledInputEvidence,
    },
  };
  for (const key of ["input_fingerprint", "render_input_fingerprint"]) {
    if (Object.prototype.hasOwnProperty.call(originalCandidate, key)) {
      updatedCandidate[key] = authoritativeFingerprint;
    }
  }
  const bridgeChanged = JSON.stringify(originalCandidate) !== JSON.stringify(updatedCandidate);
  const renderManifestChanged = JSON.stringify(renderManifest) !== JSON.stringify(reconciledRenderManifest);
  const changed = bridgeChanged || renderManifestChanged;
  let backupPath = null;
  let renderManifestBackupPath = null;
  let applied = false;
  let sectionTransaction = null;
  if (apply && changed) {
    const stamp = generatedAt.replace(/[^0-9]/g, "");
    const activeTransaction = fileTransaction || new LocalJsonFileTransaction();
    try {
      if (renderManifestChanged) {
        renderManifestBackupPath = await availableTransactionBackupPath(
          `${renderManifestPath}.pre_candidate_evidence_reconciliation.${stamp}.bak`,
        );
        await activeTransaction.stageJson(
          renderManifestPath,
          reconciledRenderManifest,
          renderManifestBackupPath,
        );
      }
      if (bridgeChanged) {
        backupPath = await availableTransactionBackupPath(
          `${resolvedBridgePath}.pre_candidate_evidence_reconciliation.fingerprints.${stamp}.bak`,
        );
        const nextRows = rows.slice();
        nextRows[index] = updatedCandidate;
        await activeTransaction.stageJson(
          resolvedBridgePath,
          withBridgeRows(bridgeDocument, nextRows),
          backupPath,
        );
      }
      if (!fileTransaction) {
        sectionTransaction = await activeTransaction.commit();
        applied = true;
      }
    } catch (error) {
      uniqueBlockers.push("local_file_transaction_failed");
      sectionTransaction = transactionFailure(error);
    }
  }
  return {
    verdict: uniqueBlockers.length ? "FAIL" : "PASS",
    bridge_path: resolvedBridgePath,
    applied,
    changed,
    same_run_verified: true,
    backup_path: backupPath,
    render_manifest_backup_path: renderManifestBackupPath,
    blockers: uniqueBlockers,
    authoritative_fingerprint: authoritativeFingerprint,
    lineage_verification: lineage,
    current_files: {
      audio_sha256: audioFingerprint.sha256,
      audio_size_bytes: audioFingerprint.size_bytes,
      word_timestamps_sha256: timestampFingerprint.sha256,
      word_timestamps_size_bytes: timestampFingerprint.size_bytes,
    },
    monotonicity: {
      authoritative_status_unchanged: true,
      authoritative_publish_verdict_unchanged: true,
      can_auto_publish_unchanged: true,
    },
    ...(sectionTransaction ? { transaction: sectionTransaction } : {}),
  };
}

async function reconcileLineageHashEvidence({
  artifactDir,
  storyId,
  apply,
  generatedAt,
  fileTransaction = null,
}) {
  const manifestPaths = {
    audio: path.join(artifactDir, "audio_manifest.json"),
    narration: path.join(artifactDir, "narration_manifest.json"),
    captions: path.join(artifactDir, "caption_manifest.json"),
    canonical: path.join(artifactDir, "canonical_story_manifest.json"),
    render: path.join(artifactDir, "render_manifest.json"),
  };
  const manifests = Object.fromEntries(
    await Promise.all(
      Object.entries(manifestPaths).map(async ([key, filePath]) => [
        key,
        await readJson(filePath, null),
      ]),
    ),
  );
  const blockers = [];
  for (const key of ["audio", "narration", "captions", "canonical", "render"]) {
    if (!objectHasKeys(manifests[key])) blockers.push(`${key}_manifest_missing_or_invalid`);
  }
  for (const key of ["audio", "narration", "captions", "canonical", "render"]) {
    const manifestStoryId = storyIdFor(manifests[key]);
    if (manifestStoryId && manifestStoryId !== clean(storyId)) {
      blockers.push(`${key}_manifest_story_id_mismatch`);
    }
  }

  const audioPath = resolveAssetPath(
    manifests.audio?.resolved_narration_audio_path ||
      manifests.audio?.narration_audio_path ||
      manifests.narration?.resolved_audio_path ||
      manifests.narration?.audio_path,
    artifactDir,
  );
  const timestampsPath = resolveAssetPath(
    manifests.audio?.resolved_word_timestamps_path ||
      manifests.audio?.word_timestamps_path ||
      manifests.narration?.resolved_word_timestamps_path ||
      manifests.narration?.word_timestamps_path,
    artifactDir,
  );
  const captionsPath = resolveAssetPath(
    manifests.captions?.resolved_caption_srt_path ||
      manifests.captions?.caption_srt_path,
    artifactDir,
  );
  for (const [label, filePath] of [
    ["current_narration_audio", audioPath],
    ["current_word_timestamps", timestampsPath],
    ["current_captions", captionsPath],
  ]) {
    if (!filePath || !(await fs.pathExists(filePath))) blockers.push(`${label}_missing`);
  }

  let audioFingerprint = null;
  let timestampFingerprint = null;
  let captionFingerprint = null;
  if (audioPath && await fs.pathExists(audioPath)) audioFingerprint = await fingerprintFile(audioPath);
  if (timestampsPath && await fs.pathExists(timestampsPath)) {
    timestampFingerprint = await fingerprintFile(timestampsPath);
    const timestampDocument = await readJson(timestampsPath, null);
    const timestampRows = Array.isArray(timestampDocument)
      ? timestampDocument
      : asArray(
        timestampDocument?.words ||
        timestampDocument?.timestamps ||
        timestampDocument?.word_timestamps,
      );
    if (!timestampRows.length) blockers.push("current_word_timestamps_invalid");
  }
  if (captionsPath && await fs.pathExists(captionsPath)) {
    captionFingerprint = await fingerprintFile(captionsPath);
    if (captionFingerprint.size_bytes <= 0) blockers.push("current_captions_empty");
  }

  const authoritativeFingerprint = manifests.render?.input_fingerprint || {};
  if (
    audioFingerprint &&
    timestampFingerprint &&
    !fingerprintMatchesCurrent(
      authoritativeFingerprint,
      audioFingerprint,
      timestampFingerprint,
    )
  ) {
    blockers.push("authoritative_render_fingerprint_not_same_run");
  }
  const lineage = verifyFinalRenderInputLineage(
    { story_id: storyId, artifact_dir: artifactDir },
    manifests.render || {},
  );
  if (lineage.pass !== true) blockers.push(...asArray(lineage.blockers));
  const uniqueBlockers = unique(blockers);
  if (uniqueBlockers.length) {
    return {
      verdict: "FAIL",
      applied: false,
      changed: false,
      same_run_verified: false,
      blockers: uniqueBlockers,
      backups: [],
      lineage_verification: lineage,
    };
  }

  const commonEvidence = {
    lineage_evidence_reconciled_at: generatedAt,
    lineage_evidence_reconciliation_basis:
      "current_files_match_authoritative_render_input_fingerprint",
  };
  const proposed = {
    audio: {
      ...manifests.audio,
      verdict: "PASS",
      status: "ready",
      narration_audio_sha256: audioFingerprint.sha256,
      narration_audio_size_bytes: audioFingerprint.size_bytes,
      word_timestamps_sha256: timestampFingerprint.sha256,
      word_timestamps_size_bytes: timestampFingerprint.size_bytes,
      ...commonEvidence,
    },
    narration: {
      ...manifests.narration,
      verdict: "PASS",
      status: "ready",
      audio_sha256: audioFingerprint.sha256,
      audio_size_bytes: audioFingerprint.size_bytes,
      word_timestamps_sha256: timestampFingerprint.sha256,
      word_timestamps_size_bytes: timestampFingerprint.size_bytes,
      ...commonEvidence,
    },
    captions: {
      ...manifests.captions,
      verdict: "PASS",
      status: "ready",
      blockers: [],
      word_timestamps_path: timestampsPath,
      resolved_word_timestamps_path: timestampsPath,
      word_timestamps_sha256: timestampFingerprint.sha256,
      word_timestamps_size_bytes: timestampFingerprint.size_bytes,
      caption_srt_path: captionsPath,
      resolved_caption_srt_path: captionsPath,
      caption_srt_sha256: captionFingerprint.sha256,
      caption_srt_size_bytes: captionFingerprint.size_bytes,
      ...commonEvidence,
    },
  };
  const changedKeys = ["audio", "narration", "captions"].filter(
    (key) => JSON.stringify(manifests[key]) !== JSON.stringify(proposed[key]),
  );
  const stamp = generatedAt.replace(/[^0-9]/g, "");
  const backups = await Promise.all(
    changedKeys.map((key) =>
      availableTransactionBackupPath(
        `${manifestPaths[key]}.pre_candidate_lineage_reconciliation.${stamp}.bak`,
      )),
  );
  let sectionTransaction = null;
  let applied = false;
  if (apply && changedKeys.length) {
    const activeTransaction = fileTransaction || new LocalJsonFileTransaction();
    try {
      for (let index = 0; index < changedKeys.length; index += 1) {
        const key = changedKeys[index];
        await activeTransaction.stageJson(
          manifestPaths[key],
          proposed[key],
          backups[index],
        );
      }
      if (!fileTransaction) {
        sectionTransaction = await activeTransaction.commit();
        applied = true;
      }
    } catch (error) {
      return {
        verdict: "FAIL",
        applied: false,
        changed: false,
        same_run_verified: false,
        blockers: ["local_file_transaction_failed"],
        backups: [],
        transaction: transactionFailure(error),
        lineage_verification: lineage,
      };
    }
  }
  return {
    verdict: "PASS",
    applied,
    changed: changedKeys.length > 0,
    same_run_verified: true,
    blockers: [],
    backups,
    current_files: {
      narration_audio_path: audioPath,
      narration_audio_sha256: audioFingerprint.sha256,
      narration_audio_size_bytes: audioFingerprint.size_bytes,
      word_timestamps_path: timestampsPath,
      word_timestamps_sha256: timestampFingerprint.sha256,
      word_timestamps_size_bytes: timestampFingerprint.size_bytes,
      caption_srt_path: captionsPath,
      caption_srt_sha256: captionFingerprint.sha256,
      caption_srt_size_bytes: captionFingerprint.size_bytes,
    },
    lineage_verification: lineage,
    monotonicity: {
      authoritative_status_unchanged: true,
      authoritative_publish_verdict_unchanged: true,
      can_auto_publish_unchanged: true,
    },
    ...(sectionTransaction ? { transaction: sectionTransaction } : {}),
  };
}

async function applySafeRightsDemotion({
  artifactDir,
  rights,
  generatedAt,
}) {
  const proposedLedger = rights?.proposed_ledger;
  if (
    rights?.verdict !== "FAIL" ||
    clean(proposedLedger?.verdict).toLowerCase() !== "fail" ||
    !asArray(proposedLedger?.blockers).length
  ) {
    return null;
  }
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const renderManifestPath = path.join(artifactDir, "render_manifest.json");
  const flagshipRightsReportPath = path.join(
    artifactDir,
    "flagship",
    "rights_reconciliation_report.json",
  );
  const forensicQaPath = path.join(artifactDir, "forensic_qa_report.json");
  const renderManifest = await readJson(renderManifestPath, {});
  const flagshipRightsReport = await readJson(flagshipRightsReportPath, null);
  const forensicQa = await readJson(forensicQaPath, null);
  const stamp = generatedAt.replace(/[^0-9]/g, "");
  const rightsBackupPath = await availableTransactionBackupPath(
    `${rightsPath}.pre_candidate_evidence_reconciliation.demotion.${stamp}.bak`,
  );
  const renderManifestBackupPath = await availableTransactionBackupPath(
    `${renderManifestPath}.pre_candidate_evidence_reconciliation.demotion.${stamp}.bak`,
  );
  const flagshipRightsReportBackupPath = objectHasKeys(flagshipRightsReport)
    ? await availableTransactionBackupPath(
      `${flagshipRightsReportPath}.pre_candidate_evidence_reconciliation.demotion.${stamp}.bak`,
    )
    : null;
  const forensicQaBackupPath = objectHasKeys(forensicQa)
    ? await availableTransactionBackupPath(
      `${forensicQaPath}.pre_candidate_evidence_reconciliation.demotion.${stamp}.bak`,
    )
    : null;
  const demotedLedger = {
    ...proposedLedger,
    verdict: "fail",
    blockers: unique(proposedLedger.blockers),
    reconciliation: {
      ...(proposedLedger.reconciliation || {}),
      safe_demotion_applied: true,
      safe_demotion_reason:
        "current_evidence_failed_and_stale_stored_rights_were_not_publishable",
    },
  };
  const demotedLedgerBytes = serialiseJson(demotedLedger);
  const demotedLedgerSha256 = crypto
    .createHash("sha256")
    .update(demotedLedgerBytes)
    .digest("hex");
  const demotedRenderRights = {
    ...(rights.proposed_render_rights_reconciliation || {}),
    verdict: "FAIL",
    status: "RED",
    applied: true,
    blockers: unique([
      ...asArray(rights.proposed_render_rights_reconciliation?.blockers),
      ...asArray(demotedLedger.blockers),
    ]),
    applied_ledger_verdict: "RED",
    applied_ledger_record_count: asArray(demotedLedger.records).length,
    applied_ledger_sha256: demotedLedgerSha256,
    applied_ledger_size_bytes: demotedLedgerBytes.length,
    can_auto_publish: false,
    generated_at: generatedAt,
    final_state_verified: true,
    final_state_verification_basis:
      "stored_red_rights_ledger_after_safe_monotonic_demotion",
    safe_demotion_applied: true,
  };
  const demotedRenderManifest = {
    ...renderManifest,
    rights_reconciliation: demotedRenderRights,
  };
  const demotedFlagshipRightsReport = objectHasKeys(flagshipRightsReport)
    ? {
        ...flagshipRightsReport,
        verdict: "FAIL",
        status: "RED",
        applied: true,
        blockers: unique([
          ...asArray(flagshipRightsReport.blockers),
          ...asArray(demotedLedger.blockers),
        ]),
        proposed_ledger: demotedLedger,
        proposed_render_rights_reconciliation: demotedRenderRights,
        applied_ledger_verdict: "fail",
        applied_ledger_record_count: asArray(demotedLedger.records).length,
        applied_ledger_sha256: demotedLedgerSha256,
        applied_ledger_size_bytes: demotedLedgerBytes.length,
        can_auto_publish: false,
        generated_at: generatedAt,
        final_state_verified: true,
        final_state_verification_basis:
          "stored_red_rights_ledger_after_safe_monotonic_demotion",
        safe_demotion_applied: true,
      }
    : null;
  const demotedForensicQa = objectHasKeys(forensicQa)
    ? {
        ...forensicQa,
        generated_at: generatedAt,
        verdict: "post_render_forensics_failed",
        result: "fail",
        checks: {
          ...(forensicQa.checks || {}),
          rights: "fail",
        },
        blockers: unique([
          ...asArray(forensicQa.blockers),
          "post_render_rights_reconciliation_not_green",
          ...asArray(demotedLedger.blockers),
        ]),
        rights_reconciliation: demotedRenderRights,
        safe_demotion_applied: true,
      }
    : null;
  const transaction = new LocalJsonFileTransaction();
  await transaction.stageJson(rightsPath, demotedLedger, rightsBackupPath);
  await transaction.stageJson(
    renderManifestPath,
    demotedRenderManifest,
    renderManifestBackupPath,
  );
  if (demotedFlagshipRightsReport) {
    await transaction.stageJson(
      flagshipRightsReportPath,
      demotedFlagshipRightsReport,
      flagshipRightsReportBackupPath,
    );
  }
  if (demotedForensicQa) {
    await transaction.stageJson(
      forensicQaPath,
      demotedForensicQa,
      forensicQaBackupPath,
    );
  }
  try {
    const result = {
      requested: true,
      attempted: true,
      ...await transaction.commit(),
    };
    return {
      transaction: result,
      rights: {
        ...rights,
        applied: true,
        demotion_applied: true,
        backup_path: rightsBackupPath,
        render_manifest_backup_path: renderManifestBackupPath,
        flagship_rights_report_backup_path: flagshipRightsReportBackupPath,
        forensic_qa_backup_path: forensicQaBackupPath,
        proposed_ledger: demotedLedger,
        proposed_render_rights_reconciliation: demotedRenderRights,
        transaction: result,
      },
    };
  } catch (error) {
    const result = {
      requested: true,
      attempted: true,
      changed_file_count: 0,
      ...transactionFailure(error),
    };
    return {
      transaction: result,
      rights: {
        ...rights,
        applied: false,
        demotion_applied: false,
        blockers: unique([
          ...asArray(rights.blockers),
          "local_file_transaction_failed",
        ]),
        transaction: result,
      },
    };
  }
}

async function reconcileCandidateEvidence({
  artifactDir,
  bridgePath = "",
  aggregatePaths = [],
  storyId,
  repairRights = true,
  repairBridgeFingerprints = false,
  repairLineageHashes = false,
  apply = false,
  generatedAt = new Date().toISOString(),
  probeMedia = defaultProbeMedia,
  targetPlatforms = ENABLED_PLATFORMS,
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
} = {}) {
  if (!artifactDir) throw new Error("artifactDir is required");
  if (!storyId) throw new Error("storyId is required");
  const resolvedArtifactDir = path.resolve(artifactDir);
  let authority = await inspectAuthoritativePublishEvidence({
    artifactDir: resolvedArtifactDir,
    storyId,
    aggregatePaths,
  });
  const runSections = async (sectionApply, currentAuthority, fileTransaction = null) => {
    const rights = repairRights
      ? await reconcileRightsEvidence({
          artifactDir: resolvedArtifactDir,
          bridgePath,
          storyId,
          apply: sectionApply,
          generatedAt,
          probeMedia,
          targetPlatforms,
          workspaceRoot,
          authorityBlockers: currentAuthority.blockers,
          fileTransaction,
        })
      : { verdict: "SKIPPED", blockers: [], applied: false };
    const bridge_fingerprints = repairBridgeFingerprints
      ? await reconcileBridgeFingerprintEvidence({
          artifactDir: resolvedArtifactDir,
          bridgePath,
          storyId,
          apply: sectionApply,
          generatedAt,
          probeMedia,
          authorityBlockers: currentAuthority.blockers,
          fileTransaction,
        })
      : { verdict: "SKIPPED", blockers: [], applied: false };
    const lineage_hashes = repairLineageHashes
      ? await reconcileLineageHashEvidence({
          artifactDir: resolvedArtifactDir,
          storyId,
          apply: sectionApply,
          generatedAt,
          fileTransaction,
        })
      : { verdict: "SKIPPED", blockers: [], applied: false };
    return { rights, bridge_fingerprints, lineage_hashes };
  };
  let { rights, bridge_fingerprints, lineage_hashes } = await runSections(false, authority);
  const preflightFailures = [rights, bridge_fingerprints, lineage_hashes]
    .filter((section) => section.verdict === "FAIL");
  if (repairBridgeFingerprints && authority.verdict === "FAIL") {
    preflightFailures.unshift(authority);
  }
  let transaction = {
    requested: apply === true,
    attempted: false,
    committed: false,
    rolled_back: false,
    changed_file_count: 0,
  };
  const safeRightsDemotionAllowed = Boolean(
    apply &&
      repairRights &&
      rights.verdict === "FAIL" &&
      clean(rights.proposed_ledger?.verdict).toLowerCase() === "fail" &&
      asArray(rights.proposed_ledger?.blockers).length,
  );
  if (safeRightsDemotionAllowed) {
    const demotion = await applySafeRightsDemotion({
      artifactDir: resolvedArtifactDir,
      rights,
      generatedAt,
    });
    if (demotion) {
      rights = demotion.rights;
      transaction = demotion.transaction;
    }
  } else if (apply && !preflightFailures.length) {
    authority = await inspectAuthoritativePublishEvidence({
      artifactDir: resolvedArtifactDir,
      storyId,
      aggregatePaths,
    });
    if (authority.verdict !== "FAIL" || !repairBridgeFingerprints) {
      const fileTransaction = new LocalJsonFileTransaction();
      ({ rights, bridge_fingerprints, lineage_hashes } = await runSections(
        true,
        authority,
        fileTransaction,
      ));
      const applyFailures = [rights, bridge_fingerprints, lineage_hashes]
        .filter((section) => section.verdict === "FAIL");
      if (!applyFailures.length) {
        transaction.attempted = true;
        try {
          transaction = {
            requested: true,
            attempted: true,
            ...await fileTransaction.commit(),
          };
          if (repairRights) {
            rights = {
              ...rights,
              applied: true,
              bridge_rights_synced: Boolean(rights.bridge_backup_path),
              transaction,
            };
          }
          if (repairBridgeFingerprints) {
            bridge_fingerprints = {
              ...bridge_fingerprints,
              applied: bridge_fingerprints.changed === true,
              transaction,
            };
          }
          if (repairLineageHashes) {
            lineage_hashes = {
              ...lineage_hashes,
              applied: lineage_hashes.changed === true,
              transaction,
            };
          }
        } catch (error) {
          transaction = {
            requested: true,
            attempted: true,
            changed_file_count: 0,
            ...transactionFailure(error),
          };
          const failedSection = (section, rightsSection = false) => ({
            ...section,
            verdict: "FAIL",
            applied: false,
            ...(rightsSection
              ? {
                  bridge_rights_synced: false,
                  proposed_render_rights_reconciliation:
                    failedRenderRightsReconciliation(
                      section.proposed_render_rights_reconciliation,
                    ),
                }
              : {}),
            blockers: unique([...asArray(section.blockers), "local_file_transaction_failed"]),
            transaction,
          });
          if (repairRights) rights = failedSection(rights, true);
          if (repairBridgeFingerprints) bridge_fingerprints = failedSection(bridge_fingerprints);
          if (repairLineageHashes) lineage_hashes = failedSection(lineage_hashes);
        }
      }
    }
  }
  const failures = [authority, rights, bridge_fingerprints, lineage_hashes]
    .filter((section) => section.verdict === "FAIL");
  const current_evidence = await inspectCurrentEvidence({
    artifactDir: resolvedArtifactDir,
    storyId,
    probeMedia,
    authority,
    rights,
  });
  const remaining_blockers = unique([
    ...current_evidence.publish_blockers,
    ...(bridge_fingerprints.verdict === "FAIL" ? asArray(bridge_fingerprints.blockers) : []),
  ]);
  return {
    schema_version: 1,
    story_id: storyId,
    generated_at: generatedAt,
    mode: apply ? "LOCAL_APPLY" : "LOCAL_PROOF",
    verdict: failures.length ? "FAIL" : "PASS",
    publish_readiness: failures.length ? "RED" : "UNCHANGED",
    apply_preflight: {
      required: apply === true,
      passed: preflightFailures.length === 0,
      writes_allowed:
        apply === true &&
        (preflightFailures.length === 0 || safeRightsDemotionAllowed),
      write_mode: safeRightsDemotionAllowed
        ? "SAFE_DEMOTION_ONLY"
        : preflightFailures.length === 0
          ? "FULL_RECONCILIATION"
          : "NONE",
    },
    authority,
    rights,
    bridge_fingerprints,
    lineage_hashes,
    current_evidence,
    remaining_blockers,
    transaction,
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_authoritative_verdict_promotion: true,
    },
  };
}

module.exports = {
  ENABLED_PLATFORMS,
  completeRightsRecord,
  defaultProbeMedia,
  inspectCurrentEvidence,
  inspectAuthoritativePublishEvidence,
  normalisePlatformKey,
  reconcileBridgeFingerprintEvidence,
  reconcileCandidateEvidence,
  reconcileLineageHashEvidence,
  reconcileRightsEvidence,
  strictElevenLabsGenerationEvidenceBlockers,
};
