"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync: defaultExecFileSync } = require("node:child_process");

const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const MAX_DOWNLOAD_TIMEOUT_MS = 180_000;
const MAX_ARCHIVE_ENTRIES = 2048;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACT_TIMEOUT_MS = 120_000;
const ALLOWED_ARCHIVE_HOST = "www.gyan.dev";
const ARCHIVE_FAILURE_CODES = Object.freeze([
  "archive_binary_duplicate",
  "archive_binary_missing",
  "archive_binary_size_mismatch",
  "archive_compression_ratio_exceeded",
  "archive_entry_limit_exceeded",
  "archive_entry_path_invalid",
  "archive_entry_symlink_not_allowed",
  "archive_root_mismatch",
  "archive_uncompressed_size_exceeded",
]);

const PINNED_FFMPEG_BUILD = Object.freeze({
  version: "8.1.2",
  minimum_version: "8.1.2",
  release_date: "2026-06-17",
  provider: "gyan.dev",
  provider_page_url: "https://www.gyan.dev/ffmpeg/builds/",
  upstream_guidance_url: "https://ffmpeg.org/download.html",
  source_commit_url: "https://github.com/FFmpeg/FFmpeg/commit/38b88335f9",
  build_variant: "essentials_build",
  architecture: "windows-x86_64-static",
  archive_name: "ffmpeg-8.1.2-essentials_build.zip",
  archive_root: "ffmpeg-8.1.2-essentials_build",
  archive_url:
    "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip",
  checksum_url:
    "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip.sha256",
  checksum_algorithm: "SHA-256",
  archive_sha256:
    "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec",
  archive_size_bytes: 109728040,
  provider_version: "8.1.2-essentials_build-www.gyan.dev",
  checksum_verified_on: "2026-07-15",
  binaries: Object.freeze({
    ffmpeg: Object.freeze({
      name: "ffmpeg.exe",
      archive_path:
        "ffmpeg-8.1.2-essentials_build/bin/ffmpeg.exe",
      sha256:
        "1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e",
      size_bytes: 101897728,
    }),
    ffprobe: Object.freeze({
      name: "ffprobe.exe",
      archive_path:
        "ffmpeg-8.1.2-essentials_build/bin/ffprobe.exe",
      sha256:
        "b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07",
      size_bytes: 101692928,
    }),
  }),
});

function matchesHttpsSource(value, hostname, pathname) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === hostname &&
      parsed.port === "" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === pathname &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function validatePinnedSourcePolicy(build = PINNED_FFMPEG_BUILD) {
  if (
    !matchesHttpsSource(
      build?.upstream_guidance_url,
      "ffmpeg.org",
      "/download.html",
    )
  ) {
    return { ok: false, error: "upstream_guidance_source_not_allowed" };
  }
  if (
    build?.provider !== "gyan.dev" ||
    !matchesHttpsSource(
      build?.provider_page_url,
      ALLOWED_ARCHIVE_HOST,
      "/ffmpeg/builds/",
    )
  ) {
    return { ok: false, error: "build_provider_not_allowed" };
  }
  if (
    !matchesHttpsSource(
      build?.archive_url,
      ALLOWED_ARCHIVE_HOST,
      `/ffmpeg/builds/packages/${build?.archive_name || ""}`,
    )
  ) {
    return { ok: false, error: "archive_source_not_allowed" };
  }
  if (
    build?.checksum_url !== `${build.archive_url}.sha256` ||
    !matchesHttpsSource(
      build.checksum_url,
      ALLOWED_ARCHIVE_HOST,
      `/ffmpeg/builds/packages/${build.archive_name}.sha256`,
    )
  ) {
    return { ok: false, error: "checksum_source_not_allowed" };
  }
  if (
    !matchesHttpsSource(
      build?.source_commit_url,
      "github.com",
      "/FFmpeg/FFmpeg/commit/38b88335f9",
    )
  ) {
    return { ok: false, error: "source_commit_not_allowed" };
  }
  const expectedArchiveStem = `ffmpeg-${build.version}-${build.build_variant}`;
  if (
    build.archive_name !== `${expectedArchiveStem}.zip` ||
    build.archive_root !== expectedArchiveStem ||
    build.provider_version !==
      `${build.version}-${build.build_variant}-www.gyan.dev`
  ) {
    return { ok: false, error: "build_identity_mismatch" };
  }
  if (
    build.checksum_algorithm !== "SHA-256" ||
    !/^[a-f0-9]{64}$/.test(String(build.archive_sha256 || "")) ||
    !Number.isSafeInteger(build.archive_size_bytes) ||
    build.archive_size_bytes < 1 ||
    build.archive_size_bytes > MAX_DOWNLOAD_BYTES
  ) {
    return { ok: false, error: "archive_pin_invalid" };
  }
  for (const component of ["ffmpeg", "ffprobe"]) {
    const binary = build.binaries?.[component];
    if (
      binary?.name !== `${component}.exe` ||
      binary.archive_path !== `${build.archive_root}/bin/${component}.exe` ||
      !/^[a-f0-9]{64}$/.test(String(binary.sha256 || "")) ||
      !Number.isSafeInteger(binary.size_bytes) ||
      binary.size_bytes < 1 ||
      binary.size_bytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES
    ) {
      return { ok: false, error: `${component}_binary_pin_invalid` };
    }
  }
  return { ok: true, error: null };
}

function extractVersion(value) {
  const match = String(value || "").match(/\b(\d{1,4}\.\d{1,2}\.\d{1,4})\b/);
  return match ? match[1] : null;
}

function compareVersions(left, right) {
  const a = extractVersion(left)?.split(".").map(Number);
  const b = extractVersion(right)?.split(".").map(Number);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("hex");
}

function safeFailureCode(error, fallback) {
  const candidate = String((error && (error.code || error.message)) || "");
  return /^(?:[a-z][a-z0-9_]{2,80}|E[A-Z0-9_]{1,30})$/.test(candidate)
    ? candidate
    : fallback;
}

function probeBinaryVersion(binaryPath, component, execFileSync) {
  try {
    const output = execFileSync(binaryPath, ["-version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    });
    const firstLine = String(output || "").split(/\r?\n/, 1)[0];
    const expectedPrefix = `${component} version `;
    const detectedVersion = firstLine.startsWith(expectedPrefix)
      ? extractVersion(firstLine)
      : null;
    const detectedBuild = firstLine.startsWith(expectedPrefix)
      ? firstLine.slice(expectedPrefix.length).split(/\s+/, 1)[0]
      : null;
    return {
      ok: Boolean(detectedVersion),
      detected_version: detectedVersion,
      detected_build: detectedBuild,
      provider_build: detectedBuild === PINNED_FFMPEG_BUILD.provider_version,
      error: detectedVersion ? null : "version_output_unrecognised",
    };
  } catch (error) {
    return {
      ok: false,
      detected_version: null,
      detected_build: null,
      provider_build: false,
      error: safeFailureCode(error, "version_probe_failed"),
    };
  }
}

function emptyInspection(binaryPath, overrides = {}) {
  return {
    binary_path: path.resolve(binaryPath),
    exists: false,
    regular_file: false,
    symbolic_link: false,
    file_identity: null,
    probe_ok: false,
    detected_version: null,
    detected_build: null,
    provider_build: false,
    sha256: null,
    meets_minimum: false,
    matches_pinned_binary: false,
    inspection_error: null,
    hash_error: null,
    probe_error: "binary_missing",
    ...overrides,
  };
}

async function inspectCurrentBinary({
  binaryPath,
  component,
  expected,
  execFileSync = defaultExecFileSync,
  fsPromises = fsp,
  hashFile = sha256File,
}) {
  const resolvedPath = path.resolve(binaryPath);
  let stat;
  try {
    stat = await fsPromises.lstat(resolvedPath);
  } catch (error) {
    if (error && error.code === "ENOENT") return emptyInspection(resolvedPath);
    return emptyInspection(resolvedPath, {
      exists: null,
      inspection_error: safeFailureCode(error, "binary_inspection_failed"),
      probe_error: "binary_inspection_failed",
    });
  }

  const symbolicLink = Boolean(stat.isSymbolicLink?.());
  if (symbolicLink || !stat.isFile()) {
    return emptyInspection(resolvedPath, {
      exists: true,
      symbolic_link: symbolicLink,
      probe_error: symbolicLink
        ? "symbolic_link_target_not_allowed"
        : "binary_not_regular_file",
    });
  }

  const hasFileIdentity =
    stat.dev != null &&
    stat.ino != null &&
    String(stat.ino) !== "0";
  const fileIdentity = hasFileIdentity
    ? `${String(stat.dev)}:${String(stat.ino)}`
    : null;

  let sha256;
  try {
    sha256 = await hashFile(resolvedPath);
  } catch (error) {
    return emptyInspection(resolvedPath, {
      exists: true,
      regular_file: true,
      file_identity: fileIdentity,
      hash_error: safeFailureCode(error, "binary_hash_failed"),
      probe_error: "probe_skipped_hash_failed",
    });
  }

  const probe = probeBinaryVersion(resolvedPath, component, execFileSync);
  const comparison = compareVersions(
    probe.detected_version,
    PINNED_FFMPEG_BUILD.minimum_version,
  );
  return {
    binary_path: resolvedPath,
    exists: true,
    regular_file: true,
    symbolic_link: false,
    file_identity: fileIdentity,
    probe_ok: probe.ok,
    detected_version: probe.detected_version,
    detected_build: probe.detected_build,
    provider_build: probe.provider_build,
    sha256,
    meets_minimum: comparison != null && comparison >= 0,
    matches_pinned_binary:
      probe.detected_version === PINNED_FFMPEG_BUILD.version &&
      probe.provider_build &&
      sha256 === expected.sha256,
    inspection_error: null,
    hash_error: null,
    probe_error: probe.error,
  };
}

function binaryBlocker(component, current) {
  if (current.inspection_error) return `${component}_binary_inspection_failed`;
  if (!current.exists) return `${component}_binary_missing`;
  if (current.symbolic_link) {
    return `${component}_symbolic_link_target_not_allowed`;
  }
  if (!current.regular_file) return `${component}_binary_not_regular_file`;
  if (current.hash_error) return `${component}_binary_hash_failed`;
  if (!current.probe_ok) return `${component}_version_probe_failed`;
  if (current.matches_pinned_binary) return null;
  const comparison = compareVersions(
    current.detected_version,
    PINNED_FFMPEG_BUILD.version,
  );
  if (comparison != null && comparison < 0) return `${component}_upgrade_required`;
  if (comparison === 0) return `${component}_pinned_checksum_mismatch`;
  return `${component}_unpinned_version_not_allowed`;
}

function validateArchiveManifest(manifest, destinationDirectory) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, error: "archive_manifest_missing" };
  }
  if (manifest.format !== "zip") {
    return { ok: false, error: "archive_format_mismatch" };
  }
  if (manifest.archive_root !== PINNED_FFMPEG_BUILD.archive_root) {
    return { ok: false, error: "archive_root_mismatch" };
  }
  if (
    !Number.isSafeInteger(manifest.entries_checked) ||
    manifest.entries_checked < 1 ||
    manifest.entries_checked > MAX_ARCHIVE_ENTRIES
  ) {
    return { ok: false, error: "archive_entry_limit_invalid" };
  }
  if (
    !Number.isSafeInteger(manifest.total_uncompressed_bytes) ||
    manifest.total_uncompressed_bytes < 1 ||
    manifest.total_uncompressed_bytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES
  ) {
    return { ok: false, error: "archive_uncompressed_size_invalid" };
  }

  for (const component of ["ffmpeg", "ffprobe"]) {
    const expected = PINNED_FFMPEG_BUILD.binaries[component];
    const actual = manifest.binaries?.[component];
    if (!actual || actual.archive_path !== expected.archive_path) {
      return { ok: false, error: "archive_entry_path_mismatch" };
    }
    const expectedExtractedPath = path.resolve(
      destinationDirectory,
      expected.name,
    );
    if (
      typeof actual.extracted_path !== "string" ||
      path.resolve(actual.extracted_path).toLowerCase() !==
        expectedExtractedPath.toLowerCase()
    ) {
      return { ok: false, error: "extracted_binary_path_mismatch" };
    }
    if (actual.size_bytes !== expected.size_bytes) {
      return { ok: false, error: "extracted_binary_size_mismatch" };
    }
  }
  return { ok: true, error: null };
}

function powershellUtf8Literal(value) {
  const encoded = Buffer.from(String(value), "utf8").toString("base64");
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`;
}

function extractionFailure(error) {
  const detail = [error?.message, error?.stdout, error?.stderr]
    .map((value) => String(value || ""))
    .join(" ");
  const code =
    ARCHIVE_FAILURE_CODES.find((candidate) => detail.includes(candidate)) ||
    "archive_extraction_failed";
  const safe = new Error(code);
  safe.code = code;
  return safe;
}

async function extractPinnedFfmpegArchive({
  archivePath,
  destinationDirectory,
  expectedBuild = PINNED_FFMPEG_BUILD,
  execFileSync = defaultExecFileSync,
  fsPromises = fsp,
  timeoutMs = MAX_EXTRACT_TIMEOUT_MS,
} = {}) {
  if (!archivePath || !path.isAbsolute(archivePath)) {
    throw new Error("archive_path_must_be_absolute");
  }
  if (!destinationDirectory || !path.isAbsolute(destinationDirectory)) {
    throw new Error("extraction_destination_must_be_absolute");
  }
  if (typeof execFileSync !== "function") {
    throw new Error("powershell_dependency_missing");
  }
  const expectedFfmpeg = expectedBuild?.binaries?.ffmpeg;
  const expectedFfprobe = expectedBuild?.binaries?.ffprobe;
  if (
    !expectedBuild?.archive_root ||
    !expectedFfmpeg?.archive_path ||
    !expectedFfprobe?.archive_path ||
    !Number.isSafeInteger(expectedFfmpeg.size_bytes) ||
    !Number.isSafeInteger(expectedFfprobe.size_bytes)
  ) {
    throw new Error("expected_build_manifest_invalid");
  }

  let destinationCreated = false;
  try {
    const stat = await fsPromises.lstat(destinationDirectory);
    if (stat.isSymbolicLink?.() || !stat.isDirectory()) {
      throw new Error("extraction_destination_not_regular_directory");
    }
    if ((await fsPromises.readdir(destinationDirectory)).length !== 0) {
      throw new Error("extraction_destination_not_empty");
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
    await fsPromises.mkdir(destinationDirectory, { recursive: false });
    destinationCreated = true;
  }

  const boundedTimeout =
    Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? Math.min(Number(timeoutMs), MAX_EXTRACT_TIMEOUT_MS)
      : MAX_EXTRACT_TIMEOUT_MS;
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = ${powershellUtf8Literal(path.resolve(archivePath))}
$destination = ${powershellUtf8Literal(path.resolve(destinationDirectory))}
$expectedRoot = ${powershellUtf8Literal(expectedBuild.archive_root)}
$expectedFfmpeg = ${powershellUtf8Literal(expectedFfmpeg.archive_path)}
$expectedFfprobe = ${powershellUtf8Literal(expectedFfprobe.archive_path)}
$expectedFfmpegSize = [int64]${expectedFfmpeg.size_bytes}
$expectedFfprobeSize = [int64]${expectedFfprobe.size_bytes}
$maxEntries = ${MAX_ARCHIVE_ENTRIES}
$maxUncompressed = [int64]${MAX_ARCHIVE_UNCOMPRESSED_BYTES}
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $entries = @($zip.Entries)
  if ($entries.Count -lt 1 -or $entries.Count -gt $maxEntries) {
    throw 'archive_entry_limit_exceeded'
  }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $selected = @{}
  [int64]$totalUncompressed = 0
  [int64]$totalCompressed = 0
  foreach ($entry in $entries) {
    $name = [string]$entry.FullName
    if ([string]::IsNullOrWhiteSpace($name) -or $name.Contains('\\') -or $name.StartsWith('/') -or $name -match '^[A-Za-z]:') {
      throw 'archive_entry_path_invalid'
    }
    $trimmed = $name.TrimEnd('/')
    $parts = @($trimmed.Split('/'))
    if ($parts.Count -lt 1 -or $parts[0] -cne $expectedRoot) {
      throw 'archive_root_mismatch'
    }
    foreach ($part in $parts) {
      if ([string]::IsNullOrEmpty($part) -or $part -eq '.' -or $part -eq '..') {
        throw 'archive_entry_path_invalid'
      }
    }
    if (-not $seen.Add($name)) { throw 'archive_binary_duplicate' }
    $attributeBytes = [BitConverter]::GetBytes([int]$entry.ExternalAttributes)
    $attributes = [BitConverter]::ToUInt32($attributeBytes, 0)
    if ((($attributes -shr 16) -band 0xF000) -eq 0xA000) {
      throw 'archive_entry_symlink_not_allowed'
    }
    $totalUncompressed += [int64]$entry.Length
    $totalCompressed += [int64]$entry.CompressedLength
    if ($totalUncompressed -gt $maxUncompressed) {
      throw 'archive_uncompressed_size_exceeded'
    }
    $leaf = $parts[$parts.Count - 1]
    if ($leaf -ieq 'ffmpeg.exe' -or $leaf -ieq 'ffprobe.exe') {
      if ($name -cne $expectedFfmpeg -and $name -cne $expectedFfprobe) {
        throw 'archive_entry_path_invalid'
      }
      if ($selected.ContainsKey($leaf.ToLowerInvariant())) {
        throw 'archive_binary_duplicate'
      }
      $selected[$leaf.ToLowerInvariant()] = $entry
    }
  }
  if ($totalCompressed -gt 0 -and $totalUncompressed -gt ($totalCompressed * 200)) {
    throw 'archive_compression_ratio_exceeded'
  }
  if (-not $selected.ContainsKey('ffmpeg.exe') -or -not $selected.ContainsKey('ffprobe.exe')) {
    throw 'archive_binary_missing'
  }
  if ([int64]$selected['ffmpeg.exe'].Length -ne $expectedFfmpegSize -or [int64]$selected['ffprobe.exe'].Length -ne $expectedFfprobeSize) {
    throw 'archive_binary_size_mismatch'
  }
  $binaryEvidence = [ordered]@{}
  foreach ($component in @('ffmpeg', 'ffprobe')) {
    $name = "$component.exe"
    $entry = $selected[$name]
    $outputPath = [IO.Path]::Combine($destination, $name)
    $input = $entry.Open()
    $output = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
    $binaryEvidence[$component] = [ordered]@{
      archive_path = [string]$entry.FullName
      extracted_path = $outputPath
      size_bytes = [int64]$entry.Length
    }
  }
  [ordered]@{
    format = 'zip'
    archive_root = $expectedRoot
    entries_checked = $entries.Count
    total_uncompressed_bytes = $totalUncompressed
    total_compressed_bytes = $totalCompressed
    binaries = $binaryEvidence
  } | ConvertTo-Json -Compress -Depth 5
} finally {
  $zip.Dispose()
}
`;
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: boundedTimeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    );
    return JSON.parse(String(output || "").trim());
  } catch (error) {
    await Promise.all(
      [expectedFfmpeg.name, expectedFfprobe.name].map((name) =>
        fsPromises.rm(path.join(destinationDirectory, name), { force: true }),
      ),
    ).catch(() => {});
    if (destinationCreated) {
      await fsPromises.rmdir(destinationDirectory).catch(() => {});
    }
    throw extractionFailure(error);
  }
}

async function buildPinnedFfmpegUpgradePlan({
  ffmpegPath,
  ffprobePath,
  generatedAt = new Date().toISOString(),
  platform = process.platform,
  execFileSync = defaultExecFileSync,
  fsPromises = fsp,
  hashFile = sha256File,
} = {}) {
  if (!ffmpegPath) throw new Error("ffmpegPath is required");
  if (!ffprobePath) throw new Error("ffprobePath is required");

  const ffmpeg = await inspectCurrentBinary({
    binaryPath: ffmpegPath,
    component: "ffmpeg",
    expected: PINNED_FFMPEG_BUILD.binaries.ffmpeg,
    execFileSync,
    fsPromises,
    hashFile,
  });
  const ffprobe = await inspectCurrentBinary({
    binaryPath: ffprobePath,
    component: "ffprobe",
    expected: PINNED_FFMPEG_BUILD.binaries.ffprobe,
    execFileSync,
    fsPromises,
    hashFile,
  });
  const sameDirectory =
    path.dirname(ffmpeg.binary_path).toLowerCase() ===
    path.dirname(ffprobe.binary_path).toLowerCase();
  const distinctPaths =
    ffmpeg.binary_path.toLowerCase() !== ffprobe.binary_path.toLowerCase();
  const distinctFiles =
    ffmpeg.file_identity && ffprobe.file_identity
      ? ffmpeg.file_identity !== ffprobe.file_identity
      : null;
  const canonicalNames =
    path.basename(ffmpeg.binary_path).toLowerCase() ===
      PINNED_FFMPEG_BUILD.binaries.ffmpeg.name &&
    path.basename(ffprobe.binary_path).toLowerCase() ===
      PINNED_FFMPEG_BUILD.binaries.ffprobe.name;
  const sourcePolicy = validatePinnedSourcePolicy();
  const blockers = [];
  if (!sourcePolicy.ok) blockers.push("pinned_source_policy_invalid");
  if (platform !== "win32") blockers.push("windows_platform_required");
  if (
    path.basename(ffmpeg.binary_path).toLowerCase() !==
    PINNED_FFMPEG_BUILD.binaries.ffmpeg.name
  ) {
    blockers.push("ffmpeg_path_must_end_with_ffmpeg_exe");
  }
  if (
    path.basename(ffprobe.binary_path).toLowerCase() !==
    PINNED_FFMPEG_BUILD.binaries.ffprobe.name
  ) {
    blockers.push("ffprobe_path_must_end_with_ffprobe_exe");
  }
  if (!sameDirectory) blockers.push("ffmpeg_pair_must_share_directory");
  if (!distinctPaths) blockers.push("ffmpeg_pair_paths_must_be_distinct");
  if (distinctFiles === false) {
    blockers.push("ffmpeg_pair_must_be_distinct_files");
  } else if (distinctFiles == null) {
    blockers.push("ffmpeg_pair_file_identity_unavailable");
  }
  for (const [component, current] of [
    ["ffmpeg", ffmpeg],
    ["ffprobe", ffprobe],
  ]) {
    const blocker = binaryBlocker(component, current);
    if (blocker) blockers.push(blocker);
  }
  const pairMatchesPinnedBuild =
    sameDirectory &&
    distinctPaths &&
    distinctFiles === true &&
    ffmpeg.matches_pinned_binary &&
    ffprobe.matches_pinned_binary;

  return {
    schema_version: 1,
    generated_at: generatedAt,
    platform,
    mode: "PLAN_VERIFY",
    read_only: true,
    mutation_performed: false,
    verdict: blockers.length === 0 ? "GREEN" : "RED",
    production_safe: blockers.length === 0,
    blockers,
    current: {
      ffmpeg,
      ffprobe,
      same_directory: sameDirectory,
      distinct_paths: distinctPaths,
      distinct_files: distinctFiles,
      canonical_names: canonicalNames,
      pair_matches_pinned_build: pairMatchesPinnedBuild,
    },
    target: PINNED_FFMPEG_BUILD,
    source_verification: {
      policy: "FFMPEG_GUIDANCE_GYAN_HTTPS_SHA256_PIN",
      verified: sourcePolicy.ok,
      failure_code: sourcePolicy.error,
      live_network_check: false,
      checksum_verified_on: PINNED_FFMPEG_BUILD.checksum_verified_on,
    },
    plan: {
      action: pairMatchesPinnedBuild
        ? "NO_CHANGE"
        : "REPLACE_PAIR_WITH_PINNED_BUILD",
      requires_apply: !pairMatchesPinnedBuild,
      apply_flags: ["--apply", "--operator-confirmed"],
      download_destination: "temporary_sibling_directory",
      archive_checksum_required_before_extract: true,
      archive_manifest_required_before_execute: true,
      binary_checksums_required_before_replace: true,
      version_probes_required_before_replace: true,
      backups_required_before_replace: true,
      replacement_method:
        "same_volume_per_file_atomic_renames_with_pair_rollback",
      pair_atomic: false,
    },
    safety: {
      downloads_performed: 0,
      archives_extracted: 0,
      replacements_performed: 0,
      backups_created: 0,
      rollbacks_performed: 0,
      media_published: false,
      runtime_restarted: false,
      oauth_mutated: false,
      secrets_printed: false,
    },
  };
}

function buildApplyEvidence(
  plan,
  {
    status,
    blockers = [],
    operatorConfirmed = true,
    mutationPerformed = false,
    safety = {},
    apply = {},
  },
) {
  const successful = blockers.length === 0;
  return {
    ...plan,
    mode: "APPLY",
    read_only: false,
    mutation_performed: mutationPerformed,
    verdict: successful ? "GREEN" : "RED",
    production_safe: successful,
    blockers,
    safety: {
      ...plan.safety,
      ...safety,
    },
    apply: {
      requested: true,
      operator_confirmed: operatorConfirmed,
      status,
      backup_paths: null,
      checksum_verified: false,
      archive_contents_verified: false,
      binary_checksums_verified: false,
      version_verified: false,
      replacement_atomic: false,
      per_file_atomic_renames: false,
      pair_atomic: false,
      pair_transaction_completed: false,
      rollback_performed: false,
      rollback_verified: false,
      ...apply,
    },
  };
}

async function inspectStagedBinary({
  binaryPath,
  expected,
  fsPromises,
  hashFile,
}) {
  const result = {
    binary_path: path.resolve(binaryPath),
    regular_file: false,
    symbolic_link: false,
    file_identity: null,
    sha256: null,
    checksum_matches: false,
    inspection_error: null,
    hash_error: null,
  };
  let stat;
  try {
    stat = await fsPromises.lstat(result.binary_path);
  } catch (error) {
    result.inspection_error = safeFailureCode(
      error,
      "staged_binary_inspection_failed",
    );
    return result;
  }
  result.symbolic_link = Boolean(stat.isSymbolicLink?.());
  result.regular_file = !result.symbolic_link && Boolean(stat.isFile?.());
  result.file_identity =
    stat.dev != null && stat.ino != null && String(stat.ino) !== "0"
      ? `${String(stat.dev)}:${String(stat.ino)}`
      : null;
  if (!result.regular_file) return result;
  try {
    result.sha256 = await hashFile(result.binary_path);
  } catch (error) {
    result.hash_error = safeFailureCode(error, "staged_binary_hash_failed");
    return result;
  }
  result.checksum_matches = result.sha256 === expected.sha256;
  return result;
}

function stagedInspectionBlocker(component, inspection) {
  if (inspection.inspection_error) {
    return `staged_${component}_inspection_failed`;
  }
  if (inspection.symbolic_link) {
    return `staged_${component}_symbolic_link_not_allowed`;
  }
  if (!inspection.regular_file) {
    return `staged_${component}_not_regular_file`;
  }
  if (inspection.hash_error) return `staged_${component}_hash_failed`;
  if (!inspection.checksum_matches) {
    return `staged_${component}_checksum_mismatch`;
  }
  return null;
}

function stagedProbeBlocker(component, probe) {
  if (!probe.ok) return `staged_${component}_version_probe_failed`;
  if (probe.detected_version !== PINNED_FFMPEG_BUILD.version) {
    return `staged_${component}_version_mismatch`;
  }
  if (!probe.provider_build) {
    return `staged_${component}_provider_build_mismatch`;
  }
  return null;
}

function targetManifestMatchesPin(target) {
  if (!target || validatePinnedSourcePolicy(target).ok !== true) return false;
  const scalarFields = [
    "version",
    "minimum_version",
    "release_date",
    "provider",
    "provider_page_url",
    "upstream_guidance_url",
    "source_commit_url",
    "build_variant",
    "architecture",
    "archive_name",
    "archive_root",
    "archive_url",
    "checksum_url",
    "checksum_algorithm",
    "archive_sha256",
    "archive_size_bytes",
    "provider_version",
    "checksum_verified_on",
  ];
  if (
    scalarFields.some(
      (field) => target[field] !== PINNED_FFMPEG_BUILD[field],
    )
  ) {
    return false;
  }
  return ["ffmpeg", "ffprobe"].every((component) => {
    const actual = target.binaries?.[component];
    const expected = PINNED_FFMPEG_BUILD.binaries[component];
    return (
      actual?.name === expected.name &&
      actual.archive_path === expected.archive_path &&
      actual.sha256 === expected.sha256 &&
      actual.size_bytes === expected.size_bytes
    );
  });
}

function applyPlanIsTrusted(plan) {
  const allowedUpgradeBlockers = new Set([
    "ffmpeg_upgrade_required",
    "ffmpeg_pinned_checksum_mismatch",
    "ffmpeg_unpinned_version_not_allowed",
    "ffprobe_upgrade_required",
    "ffprobe_pinned_checksum_mismatch",
    "ffprobe_unpinned_version_not_allowed",
  ]);
  const ffmpegPath = plan.current?.ffmpeg?.binary_path;
  const ffprobePath = plan.current?.ffprobe?.binary_path;
  const pathsValid =
    typeof ffmpegPath === "string" &&
    typeof ffprobePath === "string" &&
    path.isAbsolute(ffmpegPath) &&
    path.isAbsolute(ffprobePath) &&
    path.basename(ffmpegPath).toLowerCase() === "ffmpeg.exe" &&
    path.basename(ffprobePath).toLowerCase() === "ffprobe.exe" &&
    path.dirname(ffmpegPath).toLowerCase() ===
      path.dirname(ffprobePath).toLowerCase() &&
    ffmpegPath.toLowerCase() !== ffprobePath.toLowerCase();
  const pairMatchesPinnedBuild =
    plan.current?.pair_matches_pinned_build === true;
  const expectedAction = pairMatchesPinnedBuild
    ? "NO_CHANGE"
    : "REPLACE_PAIR_WITH_PINNED_BUILD";
  return (
    plan.schema_version === 1 &&
    plan.read_only === true &&
    plan.mutation_performed === false &&
    plan.platform === "win32" &&
    plan.source_verification?.verified === true &&
    validatePinnedSourcePolicy().ok === true &&
    targetManifestMatchesPin(plan.target) &&
    pathsValid &&
    Array.isArray(plan.blockers) &&
    plan.blockers.every((blocker) => allowedUpgradeBlockers.has(blocker)) &&
    (pairMatchesPinnedBuild ? plan.blockers.length === 0 : plan.blockers.length > 0) &&
    plan.plan?.action === expectedAction &&
    plan.plan?.requires_apply === !pairMatchesPinnedBuild
  );
}

async function syncFile(filePath, fsPromises) {
  const handle = await fsPromises.open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function renameWithEpermRetry(
  sourcePath,
  targetPath,
  fsPromises,
  attempts = 6,
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fsPromises.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!error || error.code !== "EPERM" || attempt === attempts - 1) {
        throw error;
      }
      const delayMs = Math.min(100, 10 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function renameReplacing({
  sourcePath,
  targetPath,
  displacedPath,
  fsPromises,
}) {
  try {
    await renameWithEpermRetry(sourcePath, targetPath, fsPromises);
    return { atomic: true, overwrite_fallback_used: false };
  } catch (error) {
    if (!error || !["EPERM", "EEXIST"].includes(error.code)) throw error;
    await renameWithEpermRetry(targetPath, displacedPath, fsPromises);
    try {
      await renameWithEpermRetry(sourcePath, targetPath, fsPromises);
      return { atomic: false, overwrite_fallback_used: true };
    } catch (replacementError) {
      await renameWithEpermRetry(
        displacedPath,
        targetPath,
        fsPromises,
      ).catch(() => {});
      throw replacementError;
    }
  }
}

async function inspectPairSnapshot({
  pair,
  expectedSha256,
  fsPromises,
  hashFile,
  requirePlannedIdentity = true,
}) {
  const inspections = {};
  for (const component of ["ffmpeg", "ffprobe"]) {
    inspections[component] = await inspectStagedBinary({
      binaryPath: pair[component].binary_path,
      expected: { sha256: expectedSha256[component] },
      fsPromises,
      hashFile,
    });
  }
  const structurallyValid = ["ffmpeg", "ffprobe"].every((component) => {
    const inspection = inspections[component];
    return (
      !inspection.inspection_error &&
      !inspection.symbolic_link &&
      inspection.regular_file &&
      !inspection.hash_error &&
      inspection.checksum_matches
    );
  });
  const identitiesKnown = ["ffmpeg", "ffprobe"].every(
    (component) => Boolean(inspections[component].file_identity),
  );
  const identitiesUnchanged = ["ffmpeg", "ffprobe"].every(
    (component) =>
      !pair[component].file_identity ||
      pair[component].file_identity === inspections[component].file_identity,
  );
  return {
    ok:
      structurallyValid &&
      identitiesKnown &&
      (!requirePlannedIdentity || identitiesUnchanged) &&
      inspections.ffmpeg.file_identity !== inspections.ffprobe.file_identity,
    inspections,
  };
}

async function restorePairFromBackups({
  backupPaths,
  pair,
  tempDir,
  fsPromises,
  hashFile,
}) {
  const expectedSha256 = {
    ffmpeg: pair.ffmpeg.sha256,
    ffprobe: pair.ffprobe.sha256,
  };
  const before = await inspectPairSnapshot({
    pair,
    expectedSha256,
    fsPromises,
    hashFile,
    requirePlannedIdentity: false,
  });
  if (before.ok) {
    return {
      performed: false,
      restored_files: 0,
      verified: true,
      per_file_atomic_renames: true,
      failure_code: null,
    };
  }

  const rollbackPaths = {};
  let firstFailure = null;
  for (const component of ["ffmpeg", "ffprobe"]) {
    const current = before.inspections[component];
    if (
      current.regular_file &&
      !current.symbolic_link &&
      current.checksum_matches
    ) {
      continue;
    }
    const rollbackPath = path.join(tempDir, `${component}.rollback.exe`);
    try {
      await fsPromises.copyFile(
        backupPaths[component],
        rollbackPath,
        fs.constants.COPYFILE_EXCL,
      );
      await syncFile(rollbackPath, fsPromises);
      if ((await hashFile(rollbackPath)) !== expectedSha256[component]) {
        throw new Error("rollback_copy_checksum_mismatch");
      }
      rollbackPaths[component] = rollbackPath;
    } catch (error) {
      firstFailure ||= safeFailureCode(error, "rollback_prepare_failed");
    }
  }

  let restoredFiles = 0;
  let rollbackRenamesAtomic = true;
  for (const component of ["ffmpeg", "ffprobe"]) {
    if (!rollbackPaths[component]) continue;
    try {
      const replacement = await renameReplacing({
        sourcePath: rollbackPaths[component],
        targetPath: pair[component].binary_path,
        displacedPath: path.join(
          tempDir,
          `${component}.rollback-displaced.exe`,
        ),
        fsPromises,
      });
      rollbackRenamesAtomic &&= replacement.atomic;
      restoredFiles += 1;
    } catch (error) {
      firstFailure ||= safeFailureCode(error, "rollback_rename_failed");
    }
  }
  const after = await inspectPairSnapshot({
    pair,
    expectedSha256,
    fsPromises,
    hashFile,
    requirePlannedIdentity: false,
  });
  return {
    performed: restoredFiles > 0,
    restored_files: restoredFiles,
    verified: after.ok,
    per_file_atomic_renames: rollbackRenamesAtomic,
    failure_code: after.ok ? null : firstFailure || "rollback_verification_failed",
  };
}

function backupPathsForPair(plan) {
  const stamp =
    String(plan.generated_at || "").replace(/\D/g, "").slice(0, 17) ||
    "undated";
  const directory = path.dirname(plan.current.ffmpeg.binary_path);
  return {
    ffmpeg: path.join(directory, `.ffmpeg-backup-${stamp}-ffmpeg.exe`),
    ffprobe: path.join(directory, `.ffmpeg-backup-${stamp}-ffprobe.exe`),
  };
}

async function applyPinnedFfmpegUpgrade(
  plan,
  {
    operatorConfirmed = false,
    download = downloadPinnedFfmpegArchive,
    extractArchive = extractPinnedFfmpegArchive,
    execFileSync = defaultExecFileSync,
    fsPromises = fsp,
    hashFile = sha256File,
    platform = process.platform,
  } = {},
) {
  if (!plan || plan.mode !== "PLAN_VERIFY") {
    throw new Error("A PLAN_VERIFY report is required before apply");
  }
  if (!operatorConfirmed) {
    return buildApplyEvidence(plan, {
      status: "BLOCKED",
      blockers: ["operator_confirmation_required"],
      operatorConfirmed: false,
    });
  }
  if (platform !== "win32") {
    return buildApplyEvidence(plan, {
      status: "BLOCKED",
      blockers: ["windows_runtime_required"],
    });
  }
  if (!applyPlanIsTrusted(plan)) {
    return buildApplyEvidence(plan, {
      status: "BLOCKED",
      blockers: ["apply_plan_not_trusted"],
    });
  }
  if (plan.plan.action === "NO_CHANGE") {
    return buildApplyEvidence(plan, {
      status: "SKIPPED_ALREADY_COMPLIANT",
    });
  }
  if (typeof download !== "function") {
    return buildApplyEvidence(plan, {
      status: "BLOCKED",
      blockers: ["download_dependency_missing"],
    });
  }
  const pair = plan.current;
  if (
    !pair?.same_directory ||
    !pair.distinct_paths ||
    pair.distinct_files !== true ||
    !pair.canonical_names ||
    !pair.ffmpeg?.exists ||
    !pair.ffmpeg.regular_file ||
    !pair.ffprobe?.exists ||
    !pair.ffprobe.regular_file
  ) {
    return buildApplyEvidence(plan, {
      status: "BLOCKED",
      blockers: ["existing_regular_binary_pair_required_for_backup"],
    });
  }

  const targetDirectory = path.dirname(pair.ffmpeg.binary_path);
  let tempDir;
  try {
    tempDir = await fsPromises.mkdtemp(
      path.join(targetDirectory, ".ffmpeg-upgrade-"),
    );
  } catch (error) {
    return buildApplyEvidence(plan, {
      status: "FAILED",
      blockers: ["temporary_directory_creation_failed"],
      apply: {
        failure_code: safeFailureCode(
          error,
          "temporary_directory_creation_failed",
        ),
      },
    });
  }

  const archivePath = path.join(tempDir, PINNED_FFMPEG_BUILD.archive_name);
  const perform = async () => {
    let downloadEvidence;
    try {
      downloadEvidence = await download({
        url: PINNED_FFMPEG_BUILD.archive_url,
        destination: archivePath,
      });
    } catch (error) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["download_failed"],
        apply: {
          failure_code: safeFailureCode(error, "download_failed"),
        },
      });
    }

    let archiveSha256;
    try {
      archiveSha256 = await hashFile(archivePath);
    } catch (error) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["downloaded_archive_hash_failed"],
        safety: { downloads_performed: 1 },
        apply: {
          download: downloadEvidence || null,
          failure_code: safeFailureCode(error, "downloaded_archive_hash_failed"),
        },
      });
    }

    const downloadFields = {
      download: downloadEvidence || null,
      downloaded_archive_sha256: archiveSha256,
    };
    if (archiveSha256 !== PINNED_FFMPEG_BUILD.archive_sha256) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["downloaded_archive_checksum_mismatch"],
        safety: { downloads_performed: 1 },
        apply: downloadFields,
      });
    }

    if (typeof extractArchive !== "function") {
      return buildApplyEvidence(plan, {
        status: "BLOCKED",
        blockers: ["archive_extractor_dependency_missing"],
        safety: { downloads_performed: 1 },
        apply: {
          ...downloadFields,
          checksum_verified: true,
        },
      });
    }

    const destinationDirectory = path.join(tempDir, "staged");
    try {
      await fsPromises.mkdir(destinationDirectory, { recursive: false });
    } catch (error) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["staging_directory_creation_failed"],
        safety: { downloads_performed: 1 },
        apply: {
          ...downloadFields,
          checksum_verified: true,
          failure_code: safeFailureCode(error, "staging_directory_creation_failed"),
        },
      });
    }

    let archiveManifest;
    try {
      archiveManifest = await extractArchive({
        archivePath,
        destinationDirectory,
      });
    } catch (error) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["archive_extraction_failed"],
        safety: { downloads_performed: 1 },
        apply: {
          ...downloadFields,
          checksum_verified: true,
          failure_code: safeFailureCode(error, "archive_extraction_failed"),
        },
      });
    }
    const manifestValidation = validateArchiveManifest(
      archiveManifest,
      destinationDirectory,
    );
    if (!manifestValidation.ok) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["archive_contents_invalid"],
        safety: { downloads_performed: 1, archives_extracted: 1 },
        apply: {
          ...downloadFields,
          checksum_verified: true,
          failure_code: manifestValidation.error,
        },
      });
    }

    const stagedPair = {};
    for (const component of ["ffmpeg", "ffprobe"]) {
      stagedPair[component] = await inspectStagedBinary({
        binaryPath: path.join(
          destinationDirectory,
          PINNED_FFMPEG_BUILD.binaries[component].name,
        ),
        expected: PINNED_FFMPEG_BUILD.binaries[component],
        fsPromises,
        hashFile,
      });
    }
    const stagedInspectionFailure = ["ffmpeg", "ffprobe"]
      .map((component) =>
        stagedInspectionBlocker(component, stagedPair[component]),
      )
      .find(Boolean);
    if (stagedInspectionFailure) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: [stagedInspectionFailure],
        safety: { downloads_performed: 1, archives_extracted: 1 },
        apply: {
          ...downloadFields,
          checksum_verified: true,
          archive_contents_verified: true,
          archive_manifest: archiveManifest,
          staged_pair: stagedPair,
        },
      });
    }

    for (const component of ["ffmpeg", "ffprobe"]) {
      stagedPair[component] = {
        ...stagedPair[component],
        ...probeBinaryVersion(
          stagedPair[component].binary_path,
          component,
          execFileSync,
        ),
      };
    }
    const stagedProbeFailure = ["ffmpeg", "ffprobe"]
      .map((component) =>
        stagedProbeBlocker(component, stagedPair[component]),
      )
      .find(Boolean);
    if (stagedProbeFailure) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: [stagedProbeFailure],
        safety: { downloads_performed: 1, archives_extracted: 1 },
        apply: {
          ...downloadFields,
          checksum_verified: true,
          archive_contents_verified: true,
          binary_checksums_verified: true,
          archive_manifest: archiveManifest,
          staged_pair: stagedPair,
        },
      });
    }

    const verifiedStageFields = {
      ...downloadFields,
      checksum_verified: true,
      archive_contents_verified: true,
      binary_checksums_verified: true,
      version_verified: true,
      archive_manifest: archiveManifest,
      staged_pair: stagedPair,
    };

    const targetPair = {};
    for (const component of ["ffmpeg", "ffprobe"]) {
      const planned = pair[component];
      targetPair[component] = await inspectStagedBinary({
        binaryPath: planned.binary_path,
        expected: { sha256: planned.sha256 },
        fsPromises,
        hashFile,
      });
      if (
        stagedInspectionBlocker(component, targetPair[component]) ||
        targetPair[component].file_identity !== planned.file_identity
      ) {
        return buildApplyEvidence(plan, {
          status: "FAILED",
          blockers: ["target_pair_changed_since_plan"],
          safety: { downloads_performed: 1, archives_extracted: 1 },
          apply: {
            ...verifiedStageFields,
            target_pair_reverification: targetPair,
          },
        });
      }
    }

    const backupPaths = backupPathsForPair(plan);
    const backupPair = {};
    for (const component of ["ffmpeg", "ffprobe"]) {
      try {
        await fsPromises.copyFile(
          pair[component].binary_path,
          backupPaths[component],
          fs.constants.COPYFILE_EXCL,
        );
        await syncFile(backupPaths[component], fsPromises);
      } catch (error) {
        const blocker =
          error?.code === "EEXIST"
            ? "backup_path_already_exists"
            : `backup_${component}_creation_failed`;
        return buildApplyEvidence(plan, {
          status: "FAILED",
          blockers: [blocker],
          safety: { downloads_performed: 1, archives_extracted: 1 },
          apply: {
            ...verifiedStageFields,
            backup_paths: backupPaths,
            failure_code: safeFailureCode(error, blocker),
          },
        });
      }
      backupPair[component] = await inspectStagedBinary({
        binaryPath: backupPaths[component],
        expected: { sha256: pair[component].sha256 },
        fsPromises,
        hashFile,
      });
      if (stagedInspectionBlocker(component, backupPair[component])) {
        return buildApplyEvidence(plan, {
          status: "FAILED",
          blockers: [`backup_${component}_verification_failed`],
          safety: { downloads_performed: 1, archives_extracted: 1 },
          apply: {
            ...verifiedStageFields,
            backup_paths: backupPaths,
            backup_pair: backupPair,
            backups_verified: false,
          },
        });
      }
    }

    const preReplaceTarget = await inspectPairSnapshot({
      pair,
      expectedSha256: {
        ffmpeg: pair.ffmpeg.sha256,
        ffprobe: pair.ffprobe.sha256,
      },
      fsPromises,
      hashFile,
    });
    if (!preReplaceTarget.ok) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["target_pair_changed_before_replace"],
        safety: {
          downloads_performed: 1,
          archives_extracted: 1,
          backups_created: 2,
        },
        apply: {
          ...verifiedStageFields,
          backup_paths: backupPaths,
          backup_pair: backupPair,
          backups_verified: true,
          target_pair_reverification: preReplaceTarget.inspections,
        },
      });
    }
    const preReplaceStage = await inspectPairSnapshot({
      pair: stagedPair,
      expectedSha256: {
        ffmpeg: PINNED_FFMPEG_BUILD.binaries.ffmpeg.sha256,
        ffprobe: PINNED_FFMPEG_BUILD.binaries.ffprobe.sha256,
      },
      fsPromises,
      hashFile,
    });
    if (!preReplaceStage.ok) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["staged_pair_changed_before_replace"],
        safety: {
          downloads_performed: 1,
          archives_extracted: 1,
          backups_created: 2,
        },
        apply: {
          ...verifiedStageFields,
          backup_paths: backupPaths,
          backup_pair: backupPair,
          backups_verified: true,
          staged_pair_reverification: preReplaceStage.inspections,
        },
      });
    }

    let replacementsPerformed = 0;
    try {
      for (const component of ["ffmpeg", "ffprobe"]) {
        await fsPromises.rename(
          stagedPair[component].binary_path,
          pair[component].binary_path,
        );
        replacementsPerformed += 1;
      }
    } catch (error) {
      const rollback = await restorePairFromBackups({
        backupPaths,
        pair,
        tempDir,
        fsPromises,
        hashFile,
      });
      const targetWasMutated =
        replacementsPerformed > 0 || rollback.performed;
      const status = !rollback.verified
        ? "ROLLBACK_FAILED"
        : targetWasMutated
          ? "ROLLED_BACK"
          : "FAILED";
      const blocker = !rollback.verified
        ? "pair_replacement_failed_rollback_failed"
        : targetWasMutated
          ? "pair_replacement_failed_rolled_back"
          : "pair_replacement_failed_before_mutation";
      return buildApplyEvidence(plan, {
        status,
        blockers: [blocker],
        mutationPerformed: targetWasMutated,
        safety: {
          downloads_performed: 1,
          archives_extracted: 1,
          backups_created: 2,
          replacements_performed: replacementsPerformed,
          rollbacks_performed: rollback.restored_files,
        },
        apply: {
          ...verifiedStageFields,
          backup_paths: backupPaths,
          backup_pair: backupPair,
          backups_verified: true,
          per_file_atomic_renames: true,
          pair_atomic: false,
          failure_code: safeFailureCode(error, "pair_replacement_failed"),
          rollback_performed: rollback.performed,
          rollback_verified: rollback.verified,
          rollback_per_file_atomic_renames:
            rollback.per_file_atomic_renames,
          rollback_failure_code: rollback.failure_code,
        },
      });
    }

    const installedPair = {};
    let postReplaceVerified = true;
    for (const component of ["ffmpeg", "ffprobe"]) {
      installedPair[component] = await inspectStagedBinary({
        binaryPath: pair[component].binary_path,
        expected: PINNED_FFMPEG_BUILD.binaries[component],
        fsPromises,
        hashFile,
      });
      installedPair[component] = {
        ...installedPair[component],
        ...probeBinaryVersion(
          pair[component].binary_path,
          component,
          execFileSync,
        ),
      };
      if (
        stagedInspectionBlocker(component, installedPair[component]) ||
        stagedProbeBlocker(component, installedPair[component])
      ) {
        postReplaceVerified = false;
      }
    }

    if (!postReplaceVerified) {
      const rollback = await restorePairFromBackups({
        backupPaths,
        pair,
        tempDir,
        fsPromises,
        hashFile,
      });
      const rollbackSucceeded = rollback.verified;
      return buildApplyEvidence(plan, {
        status: rollbackSucceeded ? "ROLLED_BACK" : "ROLLBACK_FAILED",
        blockers: [
          rollbackSucceeded
            ? "post_replace_verification_failed_rolled_back"
            : "post_replace_verification_failed_rollback_failed",
        ],
        mutationPerformed: true,
        safety: {
          downloads_performed: 1,
          archives_extracted: 1,
          backups_created: 2,
          replacements_performed: 2,
          rollbacks_performed: rollback.restored_files,
        },
        apply: {
          ...verifiedStageFields,
          backup_paths: backupPaths,
          backup_pair: backupPair,
          backups_verified: true,
          per_file_atomic_renames: true,
          pair_atomic: false,
          installed_pair: installedPair,
          post_replace_verified: false,
          pair_transaction_completed: false,
          rollback_performed: rollback.performed,
          rollback_verified: rollback.verified,
          rollback_per_file_atomic_renames:
            rollback.per_file_atomic_renames,
          rollback_failure_code: rollback.failure_code,
        },
      });
    }

    return buildApplyEvidence(plan, {
      status: "APPLIED",
      mutationPerformed: true,
      safety: {
        downloads_performed: 1,
        archives_extracted: 1,
        backups_created: 2,
        replacements_performed: 2,
      },
      apply: {
        ...verifiedStageFields,
        backup_paths: backupPaths,
        backup_pair: backupPair,
        backups_verified: true,
        per_file_atomic_renames: true,
        pair_atomic: false,
        pair_transaction_completed: true,
        installed_pair: installedPair,
        post_replace_verified: true,
      },
    });
  };

  let report;
  try {
    report = await perform();
  } catch (error) {
    report = buildApplyEvidence(plan, {
      status: "FAILED",
      blockers: ["unexpected_apply_failure"],
      apply: {
        failure_code: safeFailureCode(error, "unexpected_apply_failure"),
      },
    });
  }

  try {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
    report.apply.temporary_cleanup_verified = true;
    return report;
  } catch (error) {
    return buildApplyEvidence(plan, {
      status: report.apply.status,
      blockers: [...report.blockers, "temporary_cleanup_failed"],
      mutationPerformed: report.mutation_performed,
      safety: report.safety,
      apply: {
        ...report.apply,
        temporary_cleanup_verified: false,
        cleanup_failure_code: safeFailureCode(error, "temporary_cleanup_failed"),
      },
    });
  }
}

async function downloadPinnedFfmpegArchive({
  url,
  destination,
  fetchImpl = global.fetch,
  fsPromises = fsp,
  timeoutMs = MAX_DOWNLOAD_TIMEOUT_MS,
  maxBytes = MAX_DOWNLOAD_BYTES,
} = {}) {
  if (url !== PINNED_FFMPEG_BUILD.archive_url) {
    throw new Error("archive_url_not_pinned");
  }
  if (!destination) throw new Error("download_destination_required");
  if (!path.isAbsolute(destination)) {
    throw new Error("download_destination_must_be_absolute");
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");

  const requestedTimeout = Number(timeoutMs);
  const boundedTimeout =
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.min(requestedTimeout, MAX_DOWNLOAD_TIMEOUT_MS)
      : MAX_DOWNLOAD_TIMEOUT_MS;
  const requestedLimit = Number(maxBytes);
  const boundedLimit =
    Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_DOWNLOAD_BYTES)
      : MAX_DOWNLOAD_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout);
  timeout.unref?.();

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/zip, application/octet-stream",
        "User-Agent": "Pulse-Gaming-pinned-ffmpeg-upgrade/1",
      },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw new Error("download_request_failed", { cause: error });
  }

  let handle = null;
  let destinationCreated = false;
  try {
    if (!response || !response.ok) {
      throw new Error(`download_http_status_${Number(response?.status || 0)}`);
    }
    const finalUrl = new URL(response.url || url);
    if (
      response.redirected === true ||
      finalUrl.protocol !== "https:" ||
      finalUrl.hostname.toLowerCase() !== ALLOWED_ARCHIVE_HOST ||
      finalUrl.href !== new URL(PINNED_FFMPEG_BUILD.archive_url).href
    ) {
      throw new Error("download_final_url_not_pinned");
    }
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > boundedLimit) {
      throw new Error("download_declared_size_exceeds_limit");
    }
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
      throw new Error("download_response_body_missing");
    }

    handle = await fsPromises.open(destination, "wx", 0o600);
    destinationCreated = true;
    let bytesWritten = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesWritten += buffer.length;
      if (bytesWritten > boundedLimit) {
        throw new Error("download_stream_size_exceeds_limit");
      }
      await handle.write(buffer);
    }
    if (bytesWritten === 0) throw new Error("download_empty_response");
    await handle.sync();
    await handle.close();
    handle = null;
    return {
      bytes_written: bytesWritten,
      source_host: ALLOWED_ARCHIVE_HOST,
      final_host: finalUrl.hostname.toLowerCase(),
      size_limit_bytes: boundedLimit,
      timeout_ms: boundedTimeout,
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (destinationCreated) {
      await fsPromises.rm(destination, { force: true }).catch(() => {});
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  PINNED_FFMPEG_BUILD,
  MAX_DOWNLOAD_BYTES,
  applyPinnedFfmpegUpgrade,
  buildPinnedFfmpegUpgradePlan,
  compareVersions,
  downloadPinnedFfmpegArchive,
  extractVersion,
  extractPinnedFfmpegArchive,
  inspectCurrentBinary,
  sha256File,
  validateArchiveManifest,
  validatePinnedSourcePolicy,
};
