"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const fs = require("fs-extra");

const MANIFEST_SCHEMA = "pulse_publish_runway_generation_manifest_v1";
const COMMIT_SCHEMA = "pulse_publish_runway_generation_commit_v1";
const T90_LOCK_SCHEMA = "pulse_publish_runway_t90_generation_lock_v1";
const MANIFEST_FILENAME = "manifest.json";
const COMMIT_FILENAME = "commit.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_RESERVED_BASENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

class PublishRunwayGenerationStoreError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "PublishRunwayGenerationStoreError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new PublishRunwayGenerationStoreError(code, message, details);
}

function clean(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function serialiseJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rootDirectory(value) {
  if (typeof value !== "string" || !value.trim()) {
    fail("INVALID_ROOT_DIR", "an explicit generation store root is required");
  }
  return path.resolve(value);
}

function generationIdValue(value) {
  const generationId = clean(value);
  if (
    !generationId ||
    generationId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(generationId) ||
    generationId.endsWith(".") ||
    WINDOWS_RESERVED_BASENAME.test(generationId)
  ) {
    fail("INVALID_GENERATION_ID", "generation id is not a safe directory name");
  }
  return generationId;
}

function windowIdValue(value) {
  const windowId = clean(value);
  if (
    !windowId ||
    windowId.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(windowId)
  ) {
    fail("INVALID_WINDOW_ID", "window id is missing or invalid");
  }
  return windowId;
}

function isoTimestamp(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    fail("INVALID_TIMESTAMP", `${fieldName} must be a valid timestamp`, {
      field: fieldName,
    });
  }
  return date.toISOString();
}

function safeRelativeFilePath(value) {
  const original = clean(value).replace(/\\/g, "/");
  if (
    !original ||
    original.startsWith("/") ||
    /^[A-Za-z]:/.test(original) ||
    original.includes("\u0000")
  ) {
    fail("INVALID_GENERATION_FILE_PATH", "generation file path is unsafe", {
      file_path: original,
    });
  }

  const normalised = path.posix.normalize(original);
  const parts = normalised.split("/");
  if (
    normalised !== original ||
    normalised === "." ||
    normalised === ".." ||
    normalised.startsWith("../") ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"|?*\u0000-\u001f]/.test(part) ||
        /[. ]$/.test(part) ||
        WINDOWS_RESERVED_BASENAME.test(part),
    )
  ) {
    fail("INVALID_GENERATION_FILE_PATH", "generation file path is unsafe", {
      file_path: original,
    });
  }
  if (
    normalised.toLowerCase() === MANIFEST_FILENAME ||
    normalised.toLowerCase() === COMMIT_FILENAME
  ) {
    fail(
      "RESERVED_GENERATION_FILE_PATH",
      "generation metadata filenames are reserved",
      { file_path: normalised },
    );
  }
  return normalised;
}

function bytesForValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value === undefined) {
    fail("INVALID_GENERATION_FILE_CONTENT", "generation file content is undefined");
  }
  return serialiseJson(value);
}

async function fileEntries(value) {
  let rows;
  if (value instanceof Map) {
    rows = [...value.entries()].map(([filePath, contents]) => ({
      path: filePath,
      contents,
    }));
  } else if (Array.isArray(value)) {
    rows = value;
  } else if (object(value)) {
    rows = Object.entries(value).map(([filePath, contents]) => ({
      path: filePath,
      contents,
    }));
  } else {
    fail("INVALID_GENERATION_FILES", "files must be an object, Map or array");
  }
  if (!rows.length) {
    fail("INVALID_GENERATION_FILES", "at least one generation file is required");
  }

  const seen = new Set();
  const entries = [];
  for (const row of rows) {
    if (!object(row)) {
      fail("INVALID_GENERATION_FILES", "file array entries must be objects");
    }
    const filePath = safeRelativeFilePath(row.path || row.file_path || row.name);
    const collisionKey = filePath.toLowerCase();
    if (seen.has(collisionKey)) {
      fail(
        "DUPLICATE_GENERATION_FILE_PATH",
        "generation file paths must be unique on Windows",
        { file_path: filePath },
      );
    }
    seen.add(collisionKey);

    let contents;
    if (Object.hasOwn(row, "contents")) {
      contents = bytesForValue(row.contents);
    } else if (Object.hasOwn(row, "content")) {
      contents = bytesForValue(row.content);
    } else if (Object.hasOwn(row, "bytes")) {
      contents = bytesForValue(row.bytes);
    } else if (Object.hasOwn(row, "json")) {
      contents = serialiseJson(row.json);
    } else {
      const sourcePath = clean(row.sourcePath || row.source_path);
      if (!sourcePath) {
        fail("INVALID_GENERATION_FILE_CONTENT", "generation file content is missing", {
          file_path: filePath,
        });
      }
      contents = await fs.readFile(path.resolve(sourcePath));
    }
    entries.push({ path: filePath, contents });
  }
  return entries.sort((left, right) => compareText(left.path, right.path));
}

async function writeDurableExclusive(filePath, contents) {
  await fs.ensureDir(path.dirname(filePath));
  let handle = null;
  let created = false;
  try {
    handle = await fsp.open(filePath, "wx", 0o600);
    created = true;
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (created) await fs.remove(filePath).catch(() => {});
    throw error;
  }
}

async function syncDirectoryBestEffort(directory) {
  let handle = null;
  try {
    handle = await fsp.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (
      !["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(
        error?.code,
      )
    ) {
      throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function parseJsonBytes(bytes, code, message, details = {}) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!object(value)) fail(code, message, details);
    return value;
  } catch (error) {
    if (error instanceof PublishRunwayGenerationStoreError) throw error;
    fail(code, message, details);
  }
}

async function requiredFileBytes(filePath, code, message, details = {}) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") fail(code, message, details);
    throw error;
  }
}

function validateManifest(manifest, expectedGenerationId = "") {
  if (
    manifest.schema !== MANIFEST_SCHEMA ||
    manifest.schema_version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    fail("GENERATION_MANIFEST_INVALID", "generation manifest shape is invalid");
  }
  const generationId = generationIdValue(manifest.generation_id);
  const windowId = windowIdValue(manifest.window_id);
  const generatedAt = isoTimestamp(manifest.generated_at, "manifest.generated_at");
  if (expectedGenerationId && generationId !== expectedGenerationId) {
    fail(
      "GENERATION_ID_MISMATCH",
      "manifest generation id does not match its immutable directory",
      {
        expected_generation_id: expectedGenerationId,
        actual_generation_id: generationId,
      },
    );
  }

  const seen = new Set();
  const files = manifest.files.map((entry) => {
    if (!object(entry)) {
      fail("GENERATION_MANIFEST_INVALID", "manifest file entry is invalid");
    }
    const filePath = safeRelativeFilePath(entry.path);
    const collisionKey = filePath.toLowerCase();
    if (
      seen.has(collisionKey) ||
      !SHA256_PATTERN.test(clean(entry.sha256)) ||
      !Number.isSafeInteger(entry.size_bytes) ||
      entry.size_bytes < 0
    ) {
      fail("GENERATION_MANIFEST_INVALID", "manifest file entry is invalid", {
        file_path: filePath,
      });
    }
    seen.add(collisionKey);
    return {
      path: filePath,
      sha256: entry.sha256,
      size_bytes: entry.size_bytes,
    };
  });
  const sortedPaths = files.map((entry) => entry.path).sort(compareText);
  if (
    files.some((entry, index) => entry.path !== sortedPaths[index])
  ) {
    fail("GENERATION_MANIFEST_INVALID", "manifest files are not canonical");
  }
  return { generationId, windowId, generatedAt, files };
}

async function walkRegularFiles(rootDir, relativeDir = "") {
  const directory = relativeDir
    ? path.join(rootDir, ...relativeDir.split("/"))
    : rootDir;
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    compareText(left.name, right.name),
  )) {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;
    if (entry.isSymbolicLink()) {
      fail("GENERATION_UNSAFE_FILE_TYPE", "symbolic links are not allowed", {
        file_path: relativePath,
      });
    }
    if (entry.isDirectory()) {
      files.push(...(await walkRegularFiles(rootDir, relativePath)));
      continue;
    }
    if (!entry.isFile()) {
      fail("GENERATION_UNSAFE_FILE_TYPE", "only regular files are allowed", {
        file_path: relativePath,
      });
    }
    files.push(relativePath);
  }
  return files;
}

async function verifyManifestFiles(
  directory,
  manifestFiles,
  metadataFilenames,
) {
  const expected = new Set([
    ...manifestFiles.map((entry) => entry.path.toLowerCase()),
    ...metadataFilenames.map((entry) => entry.toLowerCase()),
  ]);
  const actualPaths = await walkRegularFiles(directory);
  for (const actualPath of actualPaths) {
    if (!expected.has(actualPath.toLowerCase())) {
      fail(
        "GENERATION_UNMANIFESTED_FILE",
        "generation contains an unmanifested file",
        { file_path: actualPath },
      );
    }
  }
  if (actualPaths.length !== expected.size) {
    const actual = new Set(actualPaths.map((entry) => entry.toLowerCase()));
    const missingPath = [...expected].find((entry) => !actual.has(entry));
    fail("GENERATION_FILE_MISSING", "generation manifest file is missing", {
      file_path: missingPath,
    });
  }

  for (const entry of manifestFiles) {
    const filePath = path.join(directory, ...entry.path.split("/"));
    const bytes = await requiredFileBytes(
      filePath,
      "GENERATION_FILE_MISSING",
      "generation manifest file is missing",
      { file_path: entry.path },
    );
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== entry.sha256) {
      fail(
        "GENERATION_FILE_SHA256_MISMATCH",
        "generation file failed SHA-256 verification",
        {
          file_path: entry.path,
          expected_sha256: entry.sha256,
          actual_sha256: actualSha256,
        },
      );
    }
    if (bytes.length !== entry.size_bytes) {
      fail(
        "GENERATION_FILE_SIZE_MISMATCH",
        "generation file size does not match its manifest",
        {
          file_path: entry.path,
          expected_size_bytes: entry.size_bytes,
          actual_size_bytes: bytes.length,
        },
      );
    }
  }
}

function lockFilename(windowId) {
  const readable = windowId
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 40) || "window";
  return `window-${readable}-${sha256(Buffer.from(windowId)).slice(0, 24)}.t90-lock.json`;
}

class PublishRunwayGenerationStore {
  constructor(options = {}) {
    const value = typeof options === "string" ? { rootDir: options } : options;
    this.rootDir = rootDirectory(
      value.rootDir || value.root_dir || value.storeRoot || value.store_root,
    );
    this.stagingDir = path.join(this.rootDir, ".staging");
    this.generationsDir = path.join(this.rootDir, "generations");
    this.locksDir = path.join(this.rootDir, "locks");
    this.now = typeof value.now === "function" ? value.now : () => new Date();
  }

  async ensureStoreDirectories() {
    await Promise.all([
      fs.ensureDir(this.stagingDir),
      fs.ensureDir(this.generationsDir),
      fs.ensureDir(this.locksDir),
    ]);
  }

  generationPath(generationId) {
    return path.join(this.generationsDir, generationIdValue(generationId));
  }

  t90LockPath(windowId) {
    const expectedWindowId = windowIdValue(windowId);
    return path.join(this.locksDir, lockFilename(expectedWindowId));
  }

  currentTimestamp() {
    return isoTimestamp(this.now(), "now");
  }

  async stageGeneration({
    generationId,
    generation_id,
    windowId,
    window_id,
    generatedAt,
    generated_at,
    files,
    documents,
    artifacts,
  } = {}) {
    const expectedGenerationId = generationIdValue(generationId || generation_id);
    const expectedWindowId = windowIdValue(windowId || window_id);
    const expectedGeneratedAt = isoTimestamp(
      generatedAt || generated_at || this.currentTimestamp(),
      "generated_at",
    );
    const entries = await fileEntries(files || documents || artifacts);
    await this.ensureStoreDirectories();

    const stagingPath = await fs.mkdtemp(
      path.join(this.stagingDir, `.${expectedGenerationId}.`),
    );
    const generationPath = this.generationPath(expectedGenerationId);
    try {
      const manifestFiles = [];
      for (const entry of entries) {
        const targetPath = path.join(stagingPath, ...entry.path.split("/"));
        await writeDurableExclusive(targetPath, entry.contents);
        manifestFiles.push({
          path: entry.path,
          sha256: sha256(entry.contents),
          size_bytes: entry.contents.length,
        });
        await syncDirectoryBestEffort(path.dirname(targetPath));
      }
      const manifest = {
        schema: MANIFEST_SCHEMA,
        schema_version: 1,
        generation_id: expectedGenerationId,
        window_id: expectedWindowId,
        generated_at: expectedGeneratedAt,
        files: manifestFiles,
      };
      const manifestBytes = serialiseJson(manifest);
      const manifestPath = path.join(stagingPath, MANIFEST_FILENAME);
      await writeDurableExclusive(manifestPath, manifestBytes);
      await syncDirectoryBestEffort(stagingPath);
      await syncDirectoryBestEffort(this.stagingDir);

      return {
        status: "staged",
        root_dir: this.rootDir,
        generation_id: expectedGenerationId,
        window_id: expectedWindowId,
        generated_at: expectedGeneratedAt,
        staging_path: stagingPath,
        generation_path: generationPath,
        manifest_path: manifestPath,
        manifest_sha256: sha256(manifestBytes),
        visible_to_readers: false,
      };
    } catch (error) {
      await fs.remove(stagingPath).catch(() => {});
      throw error;
    }
  }

  async verifyStagedGeneration(staged) {
    if (!object(staged)) {
      fail(
        "STAGING_GENERATION_INVALID",
        "commit requires the receipt returned by stageGeneration",
      );
    }
    const generationId = generationIdValue(
      staged.generation_id || staged.generationId,
    );
    const windowId = windowIdValue(staged.window_id || staged.windowId);
    const expectedManifestSha256 = clean(
      staged.manifest_sha256 || staged.manifestSha256,
    );
    if (!SHA256_PATTERN.test(expectedManifestSha256)) {
      fail(
        "STAGING_GENERATION_INVALID",
        "staging receipt manifest SHA-256 is invalid",
      );
    }
    const stagingPath = path.resolve(clean(staged.staging_path || staged.stagingPath));
    const relative = path.relative(this.stagingDir, stagingPath);
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      path.dirname(relative) !== "."
    ) {
      fail(
        "STAGING_GENERATION_INVALID",
        "staging path is outside the hidden store staging directory",
      );
    }
    let stagingStat;
    try {
      stagingStat = await fsp.lstat(stagingPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail("STAGING_GENERATION_MISSING", "staging generation does not exist");
      }
      throw error;
    }
    if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink()) {
      fail("STAGING_GENERATION_INVALID", "staging generation is not a directory");
    }

    const manifestBytes = await requiredFileBytes(
      path.join(stagingPath, MANIFEST_FILENAME),
      "GENERATION_MANIFEST_MISSING",
      "staging generation manifest is missing",
    );
    const actualManifestSha256 = sha256(manifestBytes);
    if (actualManifestSha256 !== expectedManifestSha256) {
      fail(
        "STAGING_MANIFEST_SHA256_MISMATCH",
        "staging manifest changed after stageGeneration",
        {
          expected_sha256: expectedManifestSha256,
          actual_sha256: actualManifestSha256,
        },
      );
    }
    const manifest = parseJsonBytes(
      manifestBytes,
      "GENERATION_MANIFEST_INVALID",
      "staging generation manifest is invalid",
    );
    const validated = validateManifest(manifest, generationId);
    if (validated.windowId !== windowId) {
      fail(
        "GENERATION_WINDOW_MISMATCH",
        "staging receipt and manifest refer to different windows",
      );
    }
    await verifyManifestFiles(stagingPath, validated.files, [
      MANIFEST_FILENAME,
    ]);
    return {
      generationId,
      windowId,
      generatedAt: validated.generatedAt,
      stagingPath,
      manifest,
      manifestBytes,
      manifestSha256: actualManifestSha256,
    };
  }

  async commitGeneration(staged, { committedAt, committed_at } = {}) {
    if (!object(staged)) {
      fail(
        "STAGING_GENERATION_INVALID",
        "commit requires the receipt returned by stageGeneration",
      );
    }
    const receiptGenerationId = generationIdValue(
      staged.generation_id || staged.generationId,
    );
    const generationPath = this.generationPath(receiptGenerationId);
    await this.ensureStoreDirectories();
    if (await fs.pathExists(generationPath)) {
      fail(
        "GENERATION_ALREADY_EXISTS",
        "immutable generation already exists",
        { generation_id: receiptGenerationId },
      );
    }

    const verified = await this.verifyStagedGeneration(staged);
    const [stagingParentStat, generationsParentStat] = await Promise.all([
      fsp.stat(path.dirname(verified.stagingPath)),
      fsp.stat(this.generationsDir),
    ]);
    if (
      stagingParentStat.dev !== undefined &&
      generationsParentStat.dev !== undefined &&
      stagingParentStat.dev !== generationsParentStat.dev
    ) {
      fail(
        "STAGING_NOT_ON_GENERATION_VOLUME",
        "staging and immutable generations must share a filesystem volume",
      );
    }

    const commitRecord = {
      schema: COMMIT_SCHEMA,
      schema_version: 1,
      generation_id: verified.generationId,
      window_id: verified.windowId,
      generated_at: verified.generatedAt,
      committed_at: isoTimestamp(
        committedAt || committed_at || this.currentTimestamp(),
        "committed_at",
      ),
      manifest_file: MANIFEST_FILENAME,
      manifest_sha256: verified.manifestSha256,
      commit_method: "same_volume_atomic_rename",
    };
    const commitPath = path.join(verified.stagingPath, COMMIT_FILENAME);
    try {
      await writeDurableExclusive(commitPath, serialiseJson(commitRecord));
      await syncDirectoryBestEffort(verified.stagingPath);
      await fsp.rename(verified.stagingPath, generationPath);
      await syncDirectoryBestEffort(this.generationsDir);
    } catch (error) {
      const targetExists = await fs.pathExists(generationPath);
      if (!targetExists && await fs.pathExists(verified.stagingPath)) {
        await fs.remove(commitPath).catch(() => {});
      }
      if (
        targetExists ||
        ["EEXIST", "ENOTEMPTY"].includes(error?.code)
      ) {
        fail(
          "GENERATION_ALREADY_EXISTS",
          "immutable generation already exists",
          { generation_id: verified.generationId },
        );
      }
      throw error;
    }

    const committed = await this.verifyGeneration({
      generationId: verified.generationId,
      expectedWindowId: verified.windowId,
      expectedManifestSha256: verified.manifestSha256,
    });
    return {
      ...committed,
      status: "committed",
      commit_method: "same_volume_atomic_rename",
    };
  }

  async verifyGeneration(input = {}, possibleWindowId = "") {
    const value =
      typeof input === "string"
        ? { generationId: input, expectedWindowId: possibleWindowId }
        : input;
    const generationId = generationIdValue(
      value.generationId || value.generation_id,
    );
    const expectedWindowId = clean(
      value.expectedWindowId ||
        value.expected_window_id ||
        value.windowId ||
        value.window_id,
    );
    if (expectedWindowId) windowIdValue(expectedWindowId);
    const expectedManifestSha256 = clean(
      value.expectedManifestSha256 || value.expected_manifest_sha256,
    );
    if (
      expectedManifestSha256 &&
      !SHA256_PATTERN.test(expectedManifestSha256)
    ) {
      fail(
        "INVALID_MANIFEST_SHA256",
        "expected manifest SHA-256 is invalid",
      );
    }

    const generationPath = this.generationPath(generationId);
    let generationStat;
    try {
      generationStat = await fsp.lstat(generationPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail("GENERATION_NOT_FOUND", "immutable generation does not exist", {
          generation_id: generationId,
        });
      }
      throw error;
    }
    if (!generationStat.isDirectory() || generationStat.isSymbolicLink()) {
      fail("GENERATION_INVALID", "immutable generation is not a directory");
    }

    const commitBytes = await requiredFileBytes(
      path.join(generationPath, COMMIT_FILENAME),
      "GENERATION_COMMIT_MISSING",
      "generation commit record is missing",
    );
    const commitRecord = parseJsonBytes(
      commitBytes,
      "GENERATION_COMMIT_INVALID",
      "generation commit record is invalid",
    );
    const manifestBytes = await requiredFileBytes(
      path.join(generationPath, MANIFEST_FILENAME),
      "GENERATION_MANIFEST_MISSING",
      "generation manifest is missing",
    );
    const manifestSha256 = sha256(manifestBytes);
    if (
      commitRecord.schema !== COMMIT_SCHEMA ||
      commitRecord.schema_version !== 1 ||
      commitRecord.manifest_file !== MANIFEST_FILENAME ||
      !SHA256_PATTERN.test(clean(commitRecord.manifest_sha256))
    ) {
      fail(
        "GENERATION_COMMIT_INVALID",
        "generation commit record is invalid",
      );
    }
    if (commitRecord.manifest_sha256 !== manifestSha256) {
      fail(
        "GENERATION_MANIFEST_SHA256_MISMATCH",
        "generation manifest failed its committed SHA-256",
        {
          expected_sha256: commitRecord.manifest_sha256,
          actual_sha256: manifestSha256,
        },
      );
    }
    if (
      expectedManifestSha256 &&
      expectedManifestSha256 !== manifestSha256
    ) {
      fail(
        "GENERATION_LOCK_MANIFEST_SHA256_MISMATCH",
        "generation manifest no longer matches the T-90 lock",
        {
          expected_sha256: expectedManifestSha256,
          actual_sha256: manifestSha256,
        },
      );
    }

    const manifest = parseJsonBytes(
      manifestBytes,
      "GENERATION_MANIFEST_INVALID",
      "generation manifest is invalid",
    );
    const validated = validateManifest(manifest, generationId);
    const committedAt = isoTimestamp(
      commitRecord.committed_at,
      "commit.committed_at",
    );
    if (
      clean(commitRecord.generation_id) !== generationId ||
      clean(commitRecord.window_id) !== validated.windowId ||
      isoTimestamp(commitRecord.generated_at, "commit.generated_at") !==
        validated.generatedAt
    ) {
      fail(
        "GENERATION_COMMIT_MISMATCH",
        "commit record does not match the generation manifest",
      );
    }
    if (expectedWindowId && validated.windowId !== expectedWindowId) {
      fail(
        "GENERATION_WINDOW_MISMATCH",
        "generation belongs to a different publish window",
        {
          expected_window_id: expectedWindowId,
          actual_window_id: validated.windowId,
        },
      );
    }
    await verifyManifestFiles(generationPath, validated.files, [
      MANIFEST_FILENAME,
      COMMIT_FILENAME,
    ]);

    return {
      valid: true,
      generation_id: generationId,
      window_id: validated.windowId,
      generated_at: validated.generatedAt,
      committed_at: committedAt,
      generation_path: generationPath,
      manifest_path: path.join(generationPath, MANIFEST_FILENAME),
      commit_path: path.join(generationPath, COMMIT_FILENAME),
      manifest_sha256: manifestSha256,
      manifest,
    };
  }

  async listCommittedGenerations() {
    await this.ensureStoreDirectories();
    const entries = await fsp.readdir(this.generationsDir, {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort(compareText);
  }

  async selectNewestValidGeneration({
    windowId,
    window_id,
  } = {}) {
    const expectedWindowId = windowIdValue(windowId || window_id);
    const generationIds = await this.listCommittedGenerations();
    const valid = [];
    for (const generationId of generationIds) {
      try {
        valid.push(
          await this.verifyGeneration({
            generationId,
            expectedWindowId,
          }),
        );
      } catch {
        // Invalid, wrong-window and tampered generations are all invisible to selection.
      }
    }
    valid.sort((left, right) => {
      const generatedDelta =
        Date.parse(right.generated_at) - Date.parse(left.generated_at);
      if (generatedDelta) return generatedDelta;
      const committedDelta =
        Date.parse(right.committed_at) - Date.parse(left.committed_at);
      if (committedDelta) return committedDelta;
      return compareText(right.generation_id, left.generation_id);
    });
    return valid[0] || null;
  }

  async lockGenerationAtT90({
    windowId,
    window_id,
    generationId,
    generation_id,
    lockedAt,
    locked_at,
  } = {}) {
    const expectedWindowId = windowIdValue(windowId || window_id);
    const requestedGenerationId = clean(generationId || generation_id);
    const generation = requestedGenerationId
      ? await this.verifyGeneration({
          generationId: requestedGenerationId,
          expectedWindowId,
        })
      : await this.selectNewestValidGeneration({
          windowId: expectedWindowId,
        });
    if (!generation) {
      fail(
        "NO_VALID_GENERATION_FOR_WINDOW",
        "no valid generation can be locked for the publish window",
        { window_id: expectedWindowId },
      );
    }

    await this.ensureStoreDirectories();
    const lockPath = this.t90LockPath(expectedWindowId);
    const lock = {
      schema: T90_LOCK_SCHEMA,
      schema_version: 1,
      phase: "T-90",
      window_id: expectedWindowId,
      generation_id: generation.generation_id,
      generation_generated_at: generation.generated_at,
      manifest_sha256: generation.manifest_sha256,
      locked_at: isoTimestamp(
        lockedAt || locked_at || this.currentTimestamp(),
        "locked_at",
      ),
    };
    try {
      await writeDurableExclusive(lockPath, serialiseJson(lock));
      await syncDirectoryBestEffort(this.locksDir);
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail(
          "T90_GENERATION_LOCK_EXISTS",
          "publish window already has an exclusive T-90 generation lock",
          { window_id: expectedWindowId, lock_path: lockPath },
        );
      }
      throw error;
    }
    return {
      ...lock,
      lock_path: lockPath,
    };
  }

  async readT90Lock(windowId) {
    const expectedWindowId = windowIdValue(windowId);
    const lockPath = this.t90LockPath(expectedWindowId);
    const lockBytes = await requiredFileBytes(
      lockPath,
      "T90_GENERATION_LOCK_MISSING",
      "publish window has no T-90 generation lock",
      { window_id: expectedWindowId },
    );
    const lock = parseJsonBytes(
      lockBytes,
      "T90_GENERATION_LOCK_INVALID",
      "T-90 generation lock is invalid",
    );
    if (
      lock.schema !== T90_LOCK_SCHEMA ||
      lock.schema_version !== 1 ||
      lock.phase !== "T-90" ||
      !SHA256_PATTERN.test(clean(lock.manifest_sha256))
    ) {
      fail(
        "T90_GENERATION_LOCK_INVALID",
        "T-90 generation lock is invalid",
      );
    }
    const actualWindowId = windowIdValue(lock.window_id);
    if (actualWindowId !== expectedWindowId) {
      fail(
        "T90_GENERATION_LOCK_WINDOW_MISMATCH",
        "T-90 generation lock belongs to another publish window",
      );
    }
    const generationId = generationIdValue(lock.generation_id);
    const lockedAt = isoTimestamp(lock.locked_at, "lock.locked_at");
    const generationGeneratedAt = isoTimestamp(
      lock.generation_generated_at,
      "lock.generation_generated_at",
    );
    return {
      ...lock,
      generation_id: generationId,
      window_id: actualWindowId,
      generation_generated_at: generationGeneratedAt,
      locked_at: lockedAt,
      lock_path: lockPath,
      lock_sha256: sha256(lockBytes),
    };
  }

  async resolveGenerationAtT0({ windowId, window_id } = {}) {
    const expectedWindowId = windowIdValue(windowId || window_id);
    const lock = await this.readT90Lock(expectedWindowId);
    const generation = await this.verifyGeneration({
      generationId: lock.generation_id,
      expectedWindowId,
      expectedManifestSha256: lock.manifest_sha256,
    });
    if (generation.generated_at !== lock.generation_generated_at) {
      fail(
        "T90_GENERATION_LOCK_MISMATCH",
        "locked generation timestamp does not match its manifest",
      );
    }
    return {
      ...generation,
      resolution_phase: "T0",
      lock_path: lock.lock_path,
      t90_lock: lock,
    };
  }

  stagePublishRunwayGeneration(options) {
    return this.stageGeneration(options);
  }

  commitPublishRunwayGeneration(staged, options) {
    return this.commitGeneration(staged, options);
  }

  verifyPublishRunwayGeneration(options, possibleWindowId) {
    return this.verifyGeneration(options, possibleWindowId);
  }

  selectNewestValidGenerationForWindow(options) {
    return this.selectNewestValidGeneration(options);
  }

  lockPublishRunwayGenerationAtT90(options) {
    return this.lockGenerationAtT90(options);
  }

  acquireT90GenerationLock(options) {
    return this.lockGenerationAtT90(options);
  }

  resolvePublishRunwayGenerationAtT0(options) {
    return this.resolveGenerationAtT0(options);
  }

  resolveT0Generation(options) {
    return this.resolveGenerationAtT0(options);
  }
}

function createPublishRunwayGenerationStore(options) {
  return new PublishRunwayGenerationStore(options);
}

function storeFor(options = {}) {
  return createPublishRunwayGenerationStore({
    rootDir:
      options.rootDir ||
      options.root_dir ||
      options.storeRoot ||
      options.store_root ||
      options.stagedGeneration?.root_dir ||
      options.staged?.root_dir,
    now: options.now,
  });
}

async function stagePublishRunwayGeneration(options = {}) {
  return storeFor(options).stageGeneration(options);
}

async function commitPublishRunwayGeneration(options = {}) {
  const staged = options.stagedGeneration || options.staged || options;
  return storeFor({ ...options, staged }).commitGeneration(staged, options);
}

async function verifyPublishRunwayGeneration(options = {}) {
  return storeFor(options).verifyGeneration(options);
}

async function selectNewestValidGenerationForWindow(options = {}) {
  return storeFor(options).selectNewestValidGeneration(options);
}

async function lockPublishRunwayGenerationAtT90(options = {}) {
  return storeFor(options).lockGenerationAtT90(options);
}

async function resolvePublishRunwayGenerationAtT0(options = {}) {
  return storeFor(options).resolveGenerationAtT0(options);
}

module.exports = {
  COMMIT_FILENAME,
  COMMIT_SCHEMA,
  MANIFEST_FILENAME,
  MANIFEST_SCHEMA,
  PublishRunwayGenerationStore,
  PublishRunwayGenerationStoreError,
  T90_LOCK_SCHEMA,
  acquireT90GenerationLock: lockPublishRunwayGenerationAtT90,
  commitPublishRunwayGeneration,
  createPublishRunwayGenerationStore,
  lockGenerationAtT90: lockPublishRunwayGenerationAtT90,
  lockPublishRunwayGenerationAtT90,
  resolveGenerationAtT0: resolvePublishRunwayGenerationAtT0,
  resolvePublishRunwayGenerationAtT0,
  resolveT0Generation: resolvePublishRunwayGenerationAtT0,
  selectNewestValidGeneration: selectNewestValidGenerationForWindow,
  selectNewestValidGenerationForWindow,
  stagePublishRunwayGeneration,
  verifyPublishRunwayGeneration,
};
