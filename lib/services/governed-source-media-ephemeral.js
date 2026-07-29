"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ACQUISITION_SCHEMA =
  "pulse-governed-source-media-ephemeral-v1";
const MANIFEST_SCHEMA =
  "pulse-governed-source-media-manifest-v1";
const LOCAL_PROOF = "LOCAL_PROOF";
const EXPECTED_STORY_ID = "official_d86953ca92ca";
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_TIMEOUT_MS = 60_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const OFFICIAL_SOURCE_ALLOWLIST = Object.freeze([
  Object.freeze({
    componentId: "ffxiv-bastion-official-thumbnail",
    assetPath:
      "assets/official/bastion-official-thumbnail.jpg",
    url:
      "https://i.ytimg.com/vi/uaZlrprwSq4/" +
      "maxresdefault.jpg",
  }),
  Object.freeze({
    componentId: "ffxiv-bastion-concept-art",
    assetPath: "assets/official/bastion-concept-art.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/h/" +
      "WQDKabyATGkXE7PxktcDmWjBHI.jpg",
  }),
  Object.freeze({
    componentId: "ffxiv-evolved-mode",
    assetPath: "assets/official/evolved-mode.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/K/" +
      "mR4RvzvRLTG23XBa2HwXoqWC6A.jpg",
  }),
  Object.freeze({
    componentId: "ffxiv-naglfar-gameplay-01",
    assetPath:
      "assets/official/naglfar-gameplay-01.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/C/" +
      "xhgo2LNiT7aGiAmzwy1Jd3-O7M.jpg",
  }),
  Object.freeze({
    componentId: "ffxiv-naglfar-gameplay-02",
    assetPath:
      "assets/official/naglfar-gameplay-02.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/3/" +
      "RE7XFlpGSnui4n6SWIXcq7dIQ8.jpg",
  }),
  Object.freeze({
    componentId: "ffxiv-beyond-lifestream",
    assetPath: "assets/official/beyond-lifestream.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/t/" +
      "XB4O-xPrmB6n_wOvwrpDp07WmI.jpg",
  }),
  Object.freeze({
    componentId: "ffxiv-evercold-key-art",
    assetPath: "assets/official/evercold-key-art.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/f/" +
      "zmuw00jJ6Cltw9cXd43BUxHq3E.jpg",
  }),
]);

class GovernedSourceMediaEphemeralError extends Error {
  constructor(codes) {
    const values = Array.isArray(codes) ? codes : [codes];
    const normalised = [...new Set(values.filter(Boolean))];
    super(
      "governed_source_media_ephemeral_failed: " +
        normalised.join(", "),
    );
    this.name = "GovernedSourceMediaEphemeralError";
    this.codes = normalised;
  }
}

function fail(code) {
  throw new GovernedSourceMediaEphemeralError(code);
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256(bytes) {
  return crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
}

function normaliseExpectedSha256(value, invalidCode) {
  const expected = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(expected)) fail(invalidCode);
  return expected;
}

function readBoundManifest({
  manifestPath,
  expectedManifestSha256,
  expectedStoryId,
}) {
  const resolvedManifestPath = path.resolve(text(manifestPath));
  if (!text(manifestPath)) {
    fail("source_media_manifest_path_required");
  }
  if (!fs.existsSync(resolvedManifestPath)) {
    fail("source_media_manifest_file_not_found");
  }
  const manifestStat = fs.lstatSync(resolvedManifestPath);
  if (
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile()
  ) {
    fail("source_media_manifest_file_invalid");
  }
  const expectedHash = normaliseExpectedSha256(
    expectedManifestSha256,
    "source_media_manifest_sha256_invalid",
  );
  const bytes = fs.readFileSync(resolvedManifestPath);
  const observedHash = sha256(bytes);
  if (observedHash !== expectedHash) {
    fail("source_media_manifest_sha256_mismatch");
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("source_media_manifest_json_invalid");
  }
  if (manifest?.schema_version !== MANIFEST_SCHEMA) {
    fail("source_media_manifest_schema_invalid");
  }
  const storyId = text(expectedStoryId);
  if (!storyId) fail("source_media_expected_story_id_required");
  if (
    storyId !== EXPECTED_STORY_ID ||
    text(manifest?.story_id) !== storyId
  ) {
    fail("source_media_story_id_mismatch");
  }
  const components = validateComponents(
    manifest,
    path.dirname(resolvedManifestPath),
  );
  return {
    path: resolvedManifestPath,
    dir: path.dirname(resolvedManifestPath),
    sha256: observedHash,
    storyId,
    components,
  };
}

function validateComponents(manifest, manifestDir) {
  if (
    !Array.isArray(manifest?.components) ||
    manifest.components.length !==
      OFFICIAL_SOURCE_ALLOWLIST.length
  ) {
    fail("source_media_official_asset_set_incomplete");
  }
  const byId = new Map();
  for (const component of manifest.components) {
    const componentId = text(component?.component_id);
    if (!componentId || byId.has(componentId)) {
      fail("source_media_component_id_duplicate_or_missing");
    }
    byId.set(componentId, component);
  }

  return OFFICIAL_SOURCE_ALLOWLIST.map((approved) => {
    const component = byId.get(approved.componentId);
    if (!component) {
      fail("source_media_official_asset_set_incomplete");
    }
    if (text(component?.media_type).toUpperCase() !== "IMAGE") {
      fail(`${approved.componentId}_media_type_invalid`);
    }
    const directUrl = text(
      component?.source?.direct_media_url,
    );
    assertExactHttpsUrl(directUrl, approved);
    const assetPath = text(component?.asset?.path);
    if (assetPath !== approved.assetPath) {
      fail(`${approved.componentId}_asset_path_not_allowlisted`);
    }
    const assetSha256 = normaliseExpectedSha256(
      component?.asset?.sha256,
      `${approved.componentId}_asset_sha256_invalid`,
    );
    const targetPath = path.resolve(manifestDir, assetPath);
    const expectedTargetPath = path.resolve(
      manifestDir,
      approved.assetPath,
    );
    if (targetPath !== expectedTargetPath) {
      fail(`${approved.componentId}_asset_path_escape`);
    }
    return {
      componentId: approved.componentId,
      assetPath,
      targetPath,
      url: directUrl,
      sha256: assetSha256,
    };
  });
}

function assertExactHttpsUrl(value, approved) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${approved.componentId}_source_url_invalid`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    fail(`${approved.componentId}_source_url_not_https`);
  }
  if (value !== approved.url) {
    fail(`${approved.componentId}_source_url_not_allowlisted`);
  }
}

function assertSafeParentPath(targetPath, manifestDir) {
  const relative = path.relative(manifestDir, targetPath);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    fail("source_media_asset_path_escape");
  }
  let cursor = manifestDir;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("source_media_asset_parent_invalid");
    }
  }
}

function inspectExistingAsset(component, manifestDir) {
  assertSafeParentPath(component.targetPath, manifestDir);
  if (!fs.existsSync(component.targetPath)) {
    return { state: "MISSING" };
  }
  const stat = fs.lstatSync(component.targetPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`${component.componentId}_existing_asset_invalid`);
  }
  const bytes = fs.readFileSync(component.targetPath);
  const observedHash = sha256(bytes);
  if (observedHash !== component.sha256) {
    fail(`${component.componentId}_existing_asset_hash_drift`);
  }
  return {
    state: "EXACT",
    bytes: bytes.length,
    sha256: observedHash,
  };
}

function normaliseDownloadTimeout(value) {
  const timeout = Number(
    value === undefined ? DEFAULT_DOWNLOAD_TIMEOUT_MS : value,
  );
  if (
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > MAX_DOWNLOAD_TIMEOUT_MS
  ) {
    fail("source_media_download_timeout_invalid");
  }
  return timeout;
}

async function readBoundedResponseBody(response, component) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    return Buffer.from(await response.arrayBuffer());
  }
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = Buffer.from(chunk.value);
      totalBytes += bytes.length;
      if (totalBytes > MAX_ASSET_BYTES) {
        await reader.cancel?.();
        fail(`${component.componentId}_download_too_large`);
      }
      chunks.push(bytes);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, totalBytes);
}

async function fetchExactAsset(
  component,
  fetchImpl,
  downloadTimeoutMs,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, downloadTimeoutMs);
  let response;
  try {
    response = await fetchImpl(component.url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "image/jpeg",
        "User-Agent":
          "PulseGaming-LOCAL_PROOF-source-media/1.0",
      },
    });
  } catch {
    clearTimeout(timer);
    fail(
      timedOut
        ? `${component.componentId}_download_timeout`
        : `${component.componentId}_download_failed`,
    );
  }
  try {
    if (
      !response ||
      response.ok !== true ||
      response.status !== 200
    ) {
      fail(`${component.componentId}_download_http_invalid`);
    }
    if (
      text(response.url) &&
      text(response.url) !== component.url
    ) {
      fail(`${component.componentId}_download_redirect_refused`);
    }
    const contentType = text(
      response.headers?.get?.("content-type"),
    )
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (contentType !== "image/jpeg") {
      fail(`${component.componentId}_download_type_invalid`);
    }
    const declaredLengthText = text(
      response.headers?.get?.("content-length"),
    );
    const declaredLength = declaredLengthText
      ? Number(declaredLengthText)
      : null;
    if (
      declaredLength !== null &&
      (!Number.isSafeInteger(declaredLength) || declaredLength < 0)
    ) {
      fail(`${component.componentId}_download_length_invalid`);
    }
    if (
      declaredLength !== null &&
      declaredLength > MAX_ASSET_BYTES
    ) {
      fail(`${component.componentId}_download_too_large`);
    }
    let bytes;
    try {
      bytes = await readBoundedResponseBody(response, component);
    } catch (error) {
      if (error instanceof GovernedSourceMediaEphemeralError) {
        throw error;
      }
      fail(
        timedOut
          ? `${component.componentId}_download_timeout`
          : `${component.componentId}_download_read_failed`,
      );
    }
    if (bytes.length === 0) {
      fail(`${component.componentId}_download_empty`);
    }
    if (bytes.length > MAX_ASSET_BYTES) {
      fail(`${component.componentId}_download_too_large`);
    }
    if (
      declaredLength !== null &&
      declaredLength !== bytes.length
    ) {
      fail(`${component.componentId}_download_length_mismatch`);
    }
    const observedHash = sha256(bytes);
    if (observedHash !== component.sha256) {
      fail(`${component.componentId}_download_sha256_mismatch`);
    }
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

function writeStagedAsset(component, bytes) {
  fs.mkdirSync(path.dirname(component.targetPath), {
    recursive: true,
  });
  const temporaryPath = path.join(
    path.dirname(component.targetPath),
    `.${path.basename(component.targetPath)}.` +
      `${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const handle = fs.openSync(
    temporaryPath,
    fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_WRONLY,
    0o600,
  );
  try {
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  return temporaryPath;
}

function cleanStaged(staged) {
  for (const item of staged) {
    if (!item.temporaryPath) continue;
    fs.rmSync(item.temporaryPath, { force: true });
  }
}

function promoteStagedAsset(sourcePath, targetPath) {
  fs.linkSync(sourcePath, targetPath);
}

function rollbackPromoted(promoted) {
  for (const item of [...promoted].reverse()) {
    fs.rmSync(item.component.targetPath, { force: true });
    item.promoted = false;
  }
}

function validateEphemeralSourceMedia({
  mode,
  manifestPath,
  expectedManifestSha256,
  expectedStoryId,
} = {}) {
  if (text(mode) !== LOCAL_PROOF) {
    fail("source_media_mode_must_be_local_proof");
  }
  const manifest = readBoundManifest({
    manifestPath,
    expectedManifestSha256,
    expectedStoryId,
  });
  const assets = manifest.components.map((component) => {
    const existing = inspectExistingAsset(
      component,
      manifest.dir,
    );
    if (existing.state !== "EXACT") {
      fail(`${component.componentId}_asset_not_materialised`);
    }
    return {
      component_id: component.componentId,
      asset_path: component.targetPath,
      sha256: existing.sha256,
      size_bytes: existing.bytes,
      status: "EXACT",
    };
  });
  return buildResult({
    operation: "VALIDATE_EPHEMERAL_SOURCE_MEDIA",
    manifest,
    assets,
    officialHostsContacted: false,
  });
}

async function acquireEphemeralSourceMedia({
  mode,
  manifestPath,
  expectedManifestSha256,
  expectedStoryId,
  fetchImpl = globalThis.fetch,
  downloadTimeoutMs,
  promoteImpl = promoteStagedAsset,
} = {}) {
  if (text(mode) !== LOCAL_PROOF) {
    fail("source_media_mode_must_be_local_proof");
  }
  if (typeof fetchImpl !== "function") {
    fail("source_media_fetch_unavailable");
  }
  if (typeof promoteImpl !== "function") {
    fail("source_media_promotion_unavailable");
  }
  const boundedDownloadTimeoutMs = normaliseDownloadTimeout(
    downloadTimeoutMs,
  );
  const manifest = readBoundManifest({
    manifestPath,
    expectedManifestSha256,
    expectedStoryId,
  });
  const exactAssets = new Map();
  const missing = [];
  for (const component of manifest.components) {
    const existing = inspectExistingAsset(
      component,
      manifest.dir,
    );
    if (existing.state === "EXACT") {
      exactAssets.set(component.componentId, existing);
    } else {
      missing.push(component);
    }
  }

  const staged = [];
  const promoted = [];
  try {
    for (const component of missing) {
      const bytes = await fetchExactAsset(
        component,
        fetchImpl,
        boundedDownloadTimeoutMs,
      );
      const temporaryPath = writeStagedAsset(
        component,
        bytes,
      );
      staged.push({
        component,
        temporaryPath,
        bytes: bytes.length,
      });
    }

    for (const item of staged) {
      const observed = inspectExistingAsset(
        item.component,
        manifest.dir,
      );
      if (observed.state === "EXACT") {
        item.reusedRace = observed;
      }
    }
    for (const item of staged) {
      if (item.reusedRace) {
        fs.rmSync(item.temporaryPath, { force: true });
        item.temporaryPath = null;
        exactAssets.set(
          item.component.componentId,
          item.reusedRace,
        );
        continue;
      }
      promoteImpl(
        item.temporaryPath,
        item.component.targetPath,
      );
      item.promoted = true;
      promoted.push(item);
      fs.rmSync(item.temporaryPath, { force: true });
      item.temporaryPath = null;
    }
  } catch (error) {
    cleanStaged(staged);
    rollbackPromoted(promoted);
    throw error;
  }

  const materialisedIds = new Set(
    staged
      .filter((item) => item.promoted)
      .map((item) => item.component.componentId),
  );
  const validated = validateEphemeralSourceMedia({
    mode,
    manifestPath,
    expectedManifestSha256,
    expectedStoryId,
  });
  return {
    ...validated,
    operation: "ACQUIRE_EPHEMERAL_SOURCE_MEDIA",
    official_asset_hosts_contacted: missing.length > 0,
    assets: validated.assets.map((asset) => ({
      ...asset,
      status: materialisedIds.has(asset.component_id)
        ? "MATERIALISED"
        : "REUSED_EXISTING_EXACT",
    })),
  };
}

function buildResult({
  operation,
  manifest,
  assets,
  officialHostsContacted,
}) {
  return {
    schema_version: ACQUISITION_SCHEMA,
    verdict: "READY",
    operation,
    mode: LOCAL_PROOF,
    acquisition_scope:
      "OFFICIAL_MEDIA_BYTES_ONLY",
    persistence: "EPHEMERAL_UNTRACKED",
    story_id: manifest.storyId,
    manifest_path: manifest.path,
    manifest_sha256: manifest.sha256,
    official_asset_hosts_contacted:
      officialHostsContacted,
    assets,
    safety: {
      database_mutated: false,
      oauth_mutated: false,
      platform_contacted: false,
      published: false,
    },
  };
}

module.exports = {
  ACQUISITION_SCHEMA,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  EXPECTED_STORY_ID,
  GovernedSourceMediaEphemeralError,
  LOCAL_PROOF,
  MAX_ASSET_BYTES,
  OFFICIAL_SOURCE_ALLOWLIST,
  acquireEphemeralSourceMedia,
  validateEphemeralSourceMedia,
};
