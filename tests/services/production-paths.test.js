"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  resolveProductionPaths,
} = require("../../lib/runtime/production-paths");

function fakeFs({ reparse = [], realpaths = {}, existing = [] } = {}) {
  const exists = new Set([
    "C:\\",
    "C:\\repo",
    "D:\\",
    "D:\\pulse-data",
    ...existing,
  ].map((value) => value.toLowerCase()));
  const reparseSet = new Set(reparse.map((value) => value.toLowerCase()));
  return {
    exists: (value) => exists.has(String(value).toLowerCase()),
    realpath: (value) =>
      realpaths[String(value).toLowerCase()] || String(value),
    lstat: (value) => ({
      isSymbolicLink: () => reparseSet.has(String(value).toLowerCase()),
    }),
    isReparsePoint: (value) => reparseSet.has(String(value).toLowerCase()),
  };
}

function environment(overrides = {}) {
  return { PULSE_DATA_ROOT: "D:\\pulse-data", ...overrides };
}

test("external production paths resolve beneath one trusted data root", () => {
  const result = resolveProductionPaths({
    env: environment(),
    checkoutRoot: "C:\\repo",
    fsApi: fakeFs(),
  });
  assert.equal(result.dataRoot, "D:\\pulse-data");
  assert.equal(result.db, "D:\\pulse-data\\pulse.db");
  assert.equal(result.media, "D:\\pulse-data\\media");
  assert.equal(result.evidence, "D:\\pulse-data\\evidence");
  assert.equal(result.receipts, "D:\\pulse-data\\receipts");
  assert.equal(result.logs, "D:\\pulse-data\\logs");
  assert.equal(result.backups, "D:\\pulse-data\\backups");
  assert.equal(result.control, "D:\\pulse-data\\control");
  assert.equal(result.temp, "D:\\pulse-data\\temp");
  assert.ok(Object.isFrozen(result));
});

test("a data root inside the checkout is rejected case-insensitively", () => {
  assert.throws(
    () => resolveProductionPaths({
      env: environment({ PULSE_DATA_ROOT: "c:\\REPO\\output" }),
      checkoutRoot: "C:\\repo",
      fsApi: fakeFs({ existing: ["C:\\repo\\output"] }),
    }),
    /production_data_root_checkout_overlap/,
  );
});

test("a checkout nested inside the mutable data root is rejected", () => {
  assert.throws(
    () => resolveProductionPaths({
      env: environment({ PULSE_DATA_ROOT: "C:\\" }),
      checkoutRoot: "C:\\repo",
      fsApi: fakeFs(),
    }),
    /production_data_root_too_broad|production_data_root_checkout_overlap/,
  );
});

test("a junction or symbolic-link data root fails closed", () => {
  assert.throws(
    () => resolveProductionPaths({
      env: environment(),
      checkoutRoot: "C:\\repo",
      fsApi: fakeFs({ reparse: ["D:\\pulse-data"] }),
    }),
    /production_data_root_reparse_point/,
  );
});

test("a reparse-point descendant cannot be selected for media", () => {
  assert.throws(
    () => resolveProductionPaths({
      env: environment({ PULSE_MEDIA_ROOT: "D:\\pulse-data\\media-link" }),
      checkoutRoot: "C:\\repo",
      fsApi: fakeFs({
        existing: ["D:\\pulse-data\\media-link"],
        reparse: ["D:\\pulse-data\\media-link"],
      }),
    }),
    /production_media_path_reparse_point/,
  );
});

test("an override cannot escape the approved data root", () => {
  assert.throws(
    () => resolveProductionPaths({
      env: environment({ PULSE_BACKUP_ROOT: "E:\\backups" }),
      checkoutRoot: "C:\\repo",
      fsApi: fakeFs({ existing: ["E:\\", "E:\\backups"] }),
    }),
    /production_backups_outside_data_root/,
  );
});

test("non-existent descendants are resolved through their trusted ancestor", () => {
  const result = resolveProductionPaths({
    env: environment({
      PULSE_MEDIA_ROOT: "D:\\pulse-data\\future\\media",
    }),
    checkoutRoot: "C:\\repo",
    fsApi: fakeFs(),
  });
  assert.equal(result.media, "D:\\pulse-data\\future\\media");
});

test("the mutable root cannot be an entire drive", () => {
  assert.throws(
    () => resolveProductionPaths({
      env: environment({ PULSE_DATA_ROOT: "D:\\" }),
      checkoutRoot: "C:\\repo",
      fsApi: fakeFs(),
    }),
    /production_data_root_too_broad/,
  );
});
