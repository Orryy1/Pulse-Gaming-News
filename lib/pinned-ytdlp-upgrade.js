"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync: defaultExecFileSync } = require("node:child_process");

const PINNED_YTDLP_RELEASE = Object.freeze({
  minimum_version: "2026.06.09",
  version: "2026.06.09",
  asset_name: "yt-dlp.exe",
  asset_url:
    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/yt-dlp.exe",
  sha256: "3a48cb955d55c8821b60ccbdbbc6f61bc958f2f3d3b7ad5eaf3d83a543293a27",
  publisher: "yt-dlp/yt-dlp",
});
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const ALLOWED_RELEASE_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

function extractVersion(value) {
  const match = String(value || "").match(/\b(20\d{2}\.\d{2}\.\d{2})\b/);
  return match ? match[1] : null;
}

function compareVersions(left, right) {
  const leftParts = extractVersion(left)?.split(".").map(Number);
  const rightParts = extractVersion(right)?.split(".").map(Number);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
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

function probeVersion(binaryPath, execFileSync) {
  try {
    const output = execFileSync(binaryPath, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    });
    const detectedVersion = extractVersion(output);
    return {
      ok: Boolean(detectedVersion),
      detected_version: detectedVersion,
      error: detectedVersion ? null : "version_output_unrecognised",
    };
  } catch (error) {
    return {
      ok: false,
      detected_version: null,
      error: String(error && error.message ? error.message : error)
        .replace(/[\r\n]+/g, " ")
        .slice(0, 240),
    };
  }
}

function safeFailureCode(error, fallback) {
  const candidate = String((error && (error.code || error.message)) || "");
  return /^(?:[a-z][a-z0-9_]{2,80}|E[A-Z0-9_]{1,30})$/.test(candidate)
    ? candidate
    : fallback;
}

async function inspectCurrentBinary({
  binaryPath,
  execFileSync = defaultExecFileSync,
  fsPromises = fsp,
  hashFile = sha256File,
}) {
  const resolvedPath = path.resolve(binaryPath);
  let stat = null;
  try {
    const lstat = fsPromises.lstat || fsPromises.stat;
    stat = await lstat.call(fsPromises, resolvedPath);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      return {
        binary_path: resolvedPath,
        exists: null,
        regular_file: false,
        symbolic_link: false,
        probe_ok: false,
        detected_version: null,
        sha256: null,
        meets_minimum: false,
        matches_pinned_release: false,
        inspection_error: safeFailureCode(error, "binary_inspection_failed"),
        hash_error: null,
        probe_error: "binary_inspection_failed",
      };
    }
  }
  if (!stat) {
    return {
      binary_path: resolvedPath,
      exists: false,
      regular_file: false,
      symbolic_link: false,
      probe_ok: false,
      detected_version: null,
      sha256: null,
      meets_minimum: false,
      matches_pinned_release: false,
      inspection_error: null,
      hash_error: null,
      probe_error: "binary_missing",
    };
  }
  const symbolicLink = Boolean(stat.isSymbolicLink?.());
  if (symbolicLink || !stat.isFile()) {
    return {
      binary_path: resolvedPath,
      exists: true,
      regular_file: false,
      symbolic_link: symbolicLink,
      probe_ok: false,
      detected_version: null,
      sha256: null,
      meets_minimum: false,
      matches_pinned_release: false,
      inspection_error: null,
      hash_error: null,
      probe_error: symbolicLink
        ? "symbolic_link_target_not_allowed"
        : "binary_not_regular_file",
    };
  }

  let sha256;
  try {
    sha256 = await hashFile(resolvedPath);
  } catch (error) {
    return {
      binary_path: resolvedPath,
      exists: true,
      regular_file: true,
      symbolic_link: false,
      probe_ok: false,
      detected_version: null,
      sha256: null,
      meets_minimum: false,
      matches_pinned_release: false,
      inspection_error: null,
      hash_error: safeFailureCode(error, "binary_hash_failed"),
      probe_error: "probe_skipped_hash_failed",
    };
  }
  const probe = probeVersion(resolvedPath, execFileSync);
  const comparison = compareVersions(
    probe.detected_version,
    PINNED_YTDLP_RELEASE.minimum_version,
  );
  return {
    binary_path: resolvedPath,
    exists: true,
    regular_file: true,
    symbolic_link: false,
    probe_ok: probe.ok,
    detected_version: probe.detected_version,
    sha256,
    meets_minimum: comparison != null && comparison >= 0,
    matches_pinned_release:
      probe.detected_version === PINNED_YTDLP_RELEASE.version &&
      sha256 === PINNED_YTDLP_RELEASE.sha256,
    inspection_error: null,
    hash_error: null,
    probe_error: probe.error,
  };
}

async function buildPinnedYtDlpUpgradePlan({
  binaryPath,
  generatedAt = new Date().toISOString(),
  execFileSync = defaultExecFileSync,
  fsPromises = fsp,
  hashFile = sha256File,
} = {}) {
  if (!binaryPath) throw new Error("binaryPath is required");
  const current = await inspectCurrentBinary({
    binaryPath,
    execFileSync,
    fsPromises,
    hashFile,
  });
  const blockers = [];
  if (current.inspection_error) {
    blockers.push("yt_dlp_binary_inspection_failed");
  } else if (!current.exists) blockers.push("yt_dlp_binary_missing");
  else if (current.symbolic_link) {
    blockers.push("yt_dlp_symbolic_link_target_not_allowed");
  } else if (!current.regular_file) blockers.push("yt_dlp_binary_not_regular_file");
  else if (current.hash_error) blockers.push("yt_dlp_binary_hash_failed");
  else if (!current.probe_ok) blockers.push("yt_dlp_version_probe_failed");
  else if (!current.meets_minimum) blockers.push("yt_dlp_upgrade_required");
  else if (
    current.detected_version === PINNED_YTDLP_RELEASE.version &&
    !current.matches_pinned_release
  ) {
    blockers.push("yt_dlp_pinned_checksum_mismatch");
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "PLAN_VERIFY",
    read_only: true,
    mutation_performed: false,
    verdict: blockers.length === 0 ? "GREEN" : "RED",
    production_safe: blockers.length === 0,
    blockers,
    current,
    target: { ...PINNED_YTDLP_RELEASE },
    plan: {
      action: blockers.length === 0 ? "NO_CHANGE" : "REPLACE_WITH_PINNED_RELEASE",
      requires_apply: blockers.length > 0,
      apply_flags: ["--apply", "--operator-confirmed"],
      download_destination: "temporary_sibling_directory",
      checksum_required_before_replace: true,
      version_probe_required_before_replace: true,
      backup_required_before_replace: true,
      replacement_method: "same_volume_atomic_rename",
    },
    safety: {
      downloads_performed: 0,
      replacements_performed: 0,
      media_published: false,
      secrets_printed: false,
    },
  };
}

async function downloadPinnedYtDlpAsset({
  url,
  destination,
  fetchImpl = global.fetch,
  fsPromises = fsp,
  timeoutMs = 120_000,
  maxBytes = MAX_DOWNLOAD_BYTES,
}) {
  if (url !== PINNED_YTDLP_RELEASE.asset_url) {
    throw new Error("asset_url_not_pinned");
  }
  if (!destination) throw new Error("download_destination_required");
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  if (!path.isAbsolute(destination)) {
    throw new Error("download_destination_must_be_absolute");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "Pulse-Gaming-pinned-ytdlp-upgrade/1",
      },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw new Error("download_request_failed", { cause: error });
  }

  let fileHandle = null;
  let destinationCreated = false;
  try {
    if (!response || !response.ok) {
      throw new Error(`download_http_status_${Number(response?.status || 0)}`);
    }
    const finalUrl = new URL(response.url || url);
    if (
      finalUrl.protocol !== "https:" ||
      !ALLOWED_RELEASE_HOSTS.has(finalUrl.hostname.toLowerCase())
    ) {
      throw new Error("download_final_host_not_allowed");
    }
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error("download_declared_size_exceeds_limit");
    }
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
      throw new Error("download_response_body_missing");
    }

    fileHandle = await fsPromises.open(destination, "wx", 0o700);
    destinationCreated = true;
    let bytesWritten = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesWritten += buffer.length;
      if (bytesWritten > maxBytes) {
        throw new Error("download_stream_size_exceeds_limit");
      }
      await fileHandle.write(buffer);
    }
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;
    return {
      bytes_written: bytesWritten,
      source_host: "github.com",
      final_host: finalUrl.hostname.toLowerCase(),
      size_limit_bytes: maxBytes,
    };
  } catch (error) {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
      fileHandle = null;
    }
    if (destinationCreated) {
      await fsPromises.rm(destination, { force: true }).catch(() => {});
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildApplyEvidence(
  plan,
  {
    status,
    blockers = [],
    operatorConfirmed = true,
    mutationPerformed = false,
    downloadsPerformed = 0,
    replacementsPerformed = 0,
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
      downloads_performed: downloadsPerformed,
      replacements_performed: replacementsPerformed,
    },
    apply: {
      requested: true,
      operator_confirmed: operatorConfirmed,
      status,
      backup_path: null,
      replacement_atomic: false,
      ...apply,
    },
  };
}

function backupPathFor(plan) {
  const stamp = String(plan.generated_at || "")
    .replace(/\D/g, "")
    .slice(0, 17) || "undated";
  return `${plan.current.binary_path}.backup-${stamp}`;
}

async function restoreBackup({
  backupPath,
  expectedSha256,
  fsPromises,
  hashFile,
  targetPath,
  tempDir,
}) {
  const rollbackPath = path.join(tempDir, "yt-dlp.rollback.exe");
  let performed = false;
  try {
    await fsPromises.copyFile(
      backupPath,
      rollbackPath,
      fs.constants.COPYFILE_EXCL,
    );
    await fsPromises.rename(rollbackPath, targetPath);
    performed = true;
    return {
      performed,
      verified: (await hashFile(targetPath)) === expectedSha256,
      failure_code: null,
    };
  } catch (error) {
    return {
      performed,
      verified: false,
      failure_code: safeFailureCode(error, "rollback_failed"),
    };
  }
}

async function applyPinnedYtDlpUpgrade(
  plan,
  {
    operatorConfirmed = false,
    download,
    execFileSync = defaultExecFileSync,
    fsPromises = fsp,
    hashFile = sha256File,
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
  if (!plan.current.exists || !plan.current.regular_file) {
    return buildApplyEvidence(plan, {
      status: "BLOCKED",
      blockers: ["existing_binary_required_for_backup"],
    });
  }

  const targetPath = plan.current.binary_path;
  let tempDir;
  try {
    tempDir = await fsPromises.mkdtemp(
      path.join(path.dirname(targetPath), ".yt-dlp-upgrade-"),
    );
  } catch (error) {
    return buildApplyEvidence(plan, {
      status: "FAILED",
      blockers: ["temporary_directory_creation_failed"],
      apply: {
        failure_code: safeFailureCode(error, "temporary_directory_creation_failed"),
      },
    });
  }

  const temporaryBinaryPath = path.join(
    tempDir,
    PINNED_YTDLP_RELEASE.asset_name,
  );
  const perform = async () => {
    let downloadEvidence;
    try {
      downloadEvidence = await download({
        url: PINNED_YTDLP_RELEASE.asset_url,
        destination: temporaryBinaryPath,
      });
    } catch (error) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["download_failed"],
        apply: {
          failure_code: safeFailureCode(error, "download_failed"),
          checksum_verified: false,
          version_verified: false,
        },
      });
    }

    let downloadedSha256;
    try {
      downloadedSha256 = await hashFile(temporaryBinaryPath);
    } catch (error) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["downloaded_asset_hash_failed"],
        downloadsPerformed: 1,
        apply: {
          failure_code: safeFailureCode(error, "downloaded_asset_hash_failed"),
          download: downloadEvidence || null,
          checksum_verified: false,
          version_verified: false,
        },
      });
    }
    const downloadedFields = {
      downloaded_sha256: downloadedSha256,
      download: downloadEvidence || null,
    };
    if (downloadedSha256 !== PINNED_YTDLP_RELEASE.sha256) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["downloaded_asset_checksum_mismatch"],
        downloadsPerformed: 1,
        apply: {
          ...downloadedFields,
          checksum_verified: false,
          probed_version: null,
          version_verified: false,
        },
      });
    }

    const downloadedProbe = probeVersion(temporaryBinaryPath, execFileSync);
    if (
      !downloadedProbe.ok ||
      downloadedProbe.detected_version !== PINNED_YTDLP_RELEASE.version
    ) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: [
          downloadedProbe.ok
            ? "downloaded_asset_version_mismatch"
            : "downloaded_asset_version_probe_failed",
        ],
        downloadsPerformed: 1,
        apply: {
          ...downloadedFields,
          checksum_verified: true,
          probed_version: downloadedProbe.detected_version,
          version_verified: false,
          probe_error: downloadedProbe.error,
        },
      });
    }
    const verifiedDownloadFields = {
      ...downloadedFields,
      checksum_verified: true,
      probed_version: downloadedProbe.detected_version,
      version_verified: true,
    };

    let currentStat;
    let currentSha256;
    try {
      currentStat = await fsPromises.lstat(targetPath);
      currentSha256 = await hashFile(targetPath);
    } catch (error) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["target_reverification_failed"],
        downloadsPerformed: 1,
        apply: {
          ...verifiedDownloadFields,
          failure_code: safeFailureCode(error, "target_reverification_failed"),
        },
      });
    }
    if (
      !currentStat.isFile() ||
      currentStat.isSymbolicLink() ||
      currentSha256 !== plan.current.sha256
    ) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["target_changed_since_plan"],
        downloadsPerformed: 1,
        apply: verifiedDownloadFields,
      });
    }

    const backupPath = backupPathFor(plan);
    try {
      await fsPromises.copyFile(
        targetPath,
        backupPath,
        fs.constants.COPYFILE_EXCL,
      );
    } catch (error) {
      const blocker =
        error && error.code === "EEXIST"
          ? "backup_path_already_exists"
          : "backup_creation_failed";
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: [blocker],
        downloadsPerformed: 1,
        apply: {
          ...verifiedDownloadFields,
          failure_code: safeFailureCode(error, blocker),
          backup_path: backupPath,
          backup_verified: false,
        },
      });
    }

    let backupSha256;
    try {
      backupSha256 = await hashFile(backupPath);
    } catch (error) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["backup_verification_failed"],
        downloadsPerformed: 1,
        apply: {
          ...verifiedDownloadFields,
          failure_code: safeFailureCode(error, "backup_verification_failed"),
          backup_path: backupPath,
          backup_verified: false,
        },
      });
    }
    const backupFields = {
      backup_path: backupPath,
      backup_sha256: backupSha256,
      backup_verified: backupSha256 === plan.current.sha256,
    };
    if (!backupFields.backup_verified) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["backup_checksum_mismatch"],
        downloadsPerformed: 1,
        apply: {
          ...verifiedDownloadFields,
          ...backupFields,
        },
      });
    }

    try {
      await fsPromises.rename(temporaryBinaryPath, targetPath);
    } catch (error) {
      return buildApplyEvidence(plan, {
        status: "FAILED",
        blockers: ["atomic_replace_failed"],
        downloadsPerformed: 1,
        apply: {
          ...verifiedDownloadFields,
          ...backupFields,
          failure_code: safeFailureCode(error, "atomic_replace_failed"),
        },
      });
    }

    let postReplaceSha256 = null;
    let postReplaceHashError = null;
    try {
      postReplaceSha256 = await hashFile(targetPath);
    } catch (error) {
      postReplaceHashError = safeFailureCode(error, "post_replace_hash_failed");
    }
    const postReplaceProbe = probeVersion(targetPath, execFileSync);
    const postReplaceVerified =
      postReplaceSha256 === PINNED_YTDLP_RELEASE.sha256 &&
      postReplaceProbe.ok &&
      postReplaceProbe.detected_version === PINNED_YTDLP_RELEASE.version;
    const postReplaceFields = {
      post_replace_sha256: postReplaceSha256,
      post_replace_version: postReplaceProbe.detected_version,
      post_replace_verified: postReplaceVerified,
    };
    if (!postReplaceVerified) {
      const rollback = await restoreBackup({
        backupPath,
        expectedSha256: plan.current.sha256,
        fsPromises,
        hashFile,
        targetPath,
        tempDir,
      });
      const rollbackSucceeded = rollback.performed && rollback.verified;
      return buildApplyEvidence(plan, {
        status: rollbackSucceeded ? "ROLLED_BACK" : "ROLLBACK_FAILED",
        blockers: [
          rollbackSucceeded
            ? "post_replace_verification_failed_rolled_back"
            : "post_replace_verification_failed_rollback_failed",
        ],
        mutationPerformed: true,
        downloadsPerformed: 1,
        replacementsPerformed: 1,
        apply: {
          ...verifiedDownloadFields,
          ...backupFields,
          ...postReplaceFields,
          replacement_atomic: true,
          post_replace_failure_code:
            postReplaceHashError || postReplaceProbe.error || "version_mismatch",
          rollback_performed: rollback.performed,
          rollback_verified: rollback.verified,
          rollback_error: rollback.failure_code,
        },
      });
    }

    return buildApplyEvidence(plan, {
      status: "APPLIED",
      mutationPerformed: true,
      downloadsPerformed: 1,
      replacementsPerformed: 1,
      apply: {
        ...verifiedDownloadFields,
        ...backupFields,
        ...postReplaceFields,
        replacement_atomic: true,
        rollback_performed: false,
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
    return report;
  } catch (error) {
    return buildApplyEvidence(plan, {
      status: report.apply.status,
      blockers: [...report.blockers, "temporary_cleanup_failed"],
      mutationPerformed: report.mutation_performed,
      downloadsPerformed: report.safety.downloads_performed,
      replacementsPerformed: report.safety.replacements_performed,
      apply: {
        ...report.apply,
        temporary_cleanup_verified: false,
        cleanup_failure_code: safeFailureCode(error, "temporary_cleanup_failed"),
      },
    });
  }
}

module.exports = {
  PINNED_YTDLP_RELEASE,
  applyPinnedYtDlpUpgrade,
  buildPinnedYtDlpUpgradePlan,
  compareVersions,
  downloadPinnedYtDlpAsset,
  extractVersion,
  inspectCurrentBinary,
  sha256File,
};
