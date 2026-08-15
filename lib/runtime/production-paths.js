"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PATH_KEYS = Object.freeze({
  db: ["PULSE_DB_PATH", "pulse.db"],
  media: ["PULSE_MEDIA_ROOT", "media"],
  evidence: ["PULSE_EVIDENCE_ROOT", "evidence"],
  receipts: ["PULSE_RECEIPTS_ROOT", "receipts"],
  logs: ["PULSE_LOG_ROOT", "logs"],
  backups: ["PULSE_BACKUP_ROOT", "backups"],
  control: ["PULSE_CONTROL_ROOT", "control"],
  temp: ["PULSE_TEMP_ROOT", "temp"],
});

function defaultFsApi() {
  return {
    exists: fs.existsSync,
    realpath: (value) => fs.realpathSync.native(value),
    lstat: (value) => fs.lstatSync(value),
    isReparsePoint: (_value, stat) => stat.isSymbolicLink(),
  };
}

function pathApiFor(...values) {
  const windows = values.some((value) =>
    /^[A-Za-z]:[\\/]/.test(String(value || ""))
    || String(value || "").includes("\\"),
  );
  return windows ? path.win32 : path.posix;
}

function canonical(value, pathApi) {
  let result = pathApi.normalize(String(value));
  if (pathApi === path.win32) result = result.toLowerCase();
  const root = pathApi.parse(result).root;
  while (result.length > root.length && result.endsWith(pathApi.sep)) {
    result = result.slice(0, -1);
  }
  return result;
}

function isContained(parent, child, pathApi) {
  const parentPath = canonical(parent, pathApi);
  const childPath = canonical(child, pathApi);
  const relative = pathApi.relative(parentPath, childPath);
  return relative === ""
    || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

function nearestExistingAncestor(value, fsApi, pathApi) {
  let cursor = pathApi.normalize(value);
  const missing = [];
  while (!fsApi.exists(cursor)) {
    const parent = pathApi.dirname(cursor);
    if (parent === cursor) throw new Error("production_path_has_no_existing_ancestor");
    missing.unshift(pathApi.basename(cursor));
    cursor = parent;
  }
  return { ancestor: cursor, missing };
}

function assertTrustedExistingPath(value, fsApi, code) {
  const stat = fsApi.lstat(value);
  if (stat.isSymbolicLink() || fsApi.isReparsePoint(value, stat)) {
    throw new Error(code);
  }
}

function resolveTarget(value, fsApi, pathApi, code) {
  const { ancestor, missing } = nearestExistingAncestor(value, fsApi, pathApi);
  let cursor = ancestor;
  while (true) {
    assertTrustedExistingPath(cursor, fsApi, code);
    const parent = pathApi.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return pathApi.join(fsApi.realpath(ancestor), ...missing);
}

function assertAbsolute(value, pathApi, code) {
  if (!value || !pathApi.isAbsolute(value)) throw new Error(code);
}

function assertNoCheckoutOverlap(value, checkoutRoot, pathApi, code) {
  if (
    isContained(checkoutRoot, value, pathApi)
    || isContained(value, checkoutRoot, pathApi)
  ) {
    throw new Error(code);
  }
}

function resolveProductionPaths({
  env = process.env,
  checkoutRoot,
  fsApi = defaultFsApi(),
}) {
  const configuredRoot = String(env.PULSE_DATA_ROOT || "").trim();
  if (!configuredRoot) throw new Error("production_data_root_required");
  if (!checkoutRoot) throw new Error("production_checkout_root_required");
  const pathApi = pathApiFor(configuredRoot, checkoutRoot);
  assertAbsolute(configuredRoot, pathApi, "production_data_root_must_be_absolute");
  assertAbsolute(checkoutRoot, pathApi, "production_checkout_root_must_be_absolute");
  if (!fsApi.exists(configuredRoot)) {
    throw new Error("production_data_root_missing");
  }
  const checkoutReal = resolveTarget(
    checkoutRoot,
    fsApi,
    pathApi,
    "production_checkout_root_reparse_point",
  );
  const dataRoot = resolveTarget(
    configuredRoot,
    fsApi,
    pathApi,
    "production_data_root_reparse_point",
  );
  const driveRoot = pathApi.parse(dataRoot).root;
  if (canonical(dataRoot, pathApi) === canonical(driveRoot, pathApi)) {
    throw new Error("production_data_root_too_broad");
  }
  assertNoCheckoutOverlap(
    dataRoot,
    checkoutReal,
    pathApi,
    "production_data_root_checkout_overlap",
  );

  const result = { dataRoot };
  for (const [key, [environmentKey, fallback]] of Object.entries(PATH_KEYS)) {
    const configured = String(env[environmentKey] || "").trim();
    const target = configured || pathApi.join(dataRoot, fallback);
    assertAbsolute(target, pathApi, `production_${key}_path_must_be_absolute`);
    const resolved = resolveTarget(
      target,
      fsApi,
      pathApi,
      `production_${key}_path_reparse_point`,
    );
    assertNoCheckoutOverlap(
      resolved,
      checkoutReal,
      pathApi,
      `production_${key}_checkout_overlap`,
    );
    result[key] = resolved;
  }
  if (!isContained(dataRoot, result.db, pathApi)) {
    throw new Error("production_db_outside_data_root");
  }
  for (const key of ["media", "evidence", "receipts", "logs", "backups", "control", "temp"]) {
    if (!isContained(dataRoot, result[key], pathApi)) {
      throw new Error(`production_${key}_outside_data_root`);
    }
  }
  return Object.freeze({
    ...result,
    checkoutRoot: checkoutReal,
  });
}

module.exports = {
  PATH_KEYS,
  canonical,
  defaultFsApi,
  isContained,
  pathApiFor,
  resolveProductionPaths,
  resolveTarget,
};
