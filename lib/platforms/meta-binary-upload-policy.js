"use strict";

const MEBIBYTE = 1024 * 1024;
const MIN_OVERRIDE_MS = 120000;
const MAX_TIMEOUT_MS = 1800000;
const DEFAULT_MIN_TIMEOUT_MS = 300000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function metaBinaryUploadTimeoutMs(fileSizeBytes, {
  env = process.env,
  envName = "META_BINARY_UPLOAD_TIMEOUT_MS",
} = {}) {
  const override = Number(env?.[envName]);
  if (Number.isFinite(override) && override > 0) {
    return clamp(Math.round(override), MIN_OVERRIDE_MS, MAX_TIMEOUT_MS);
  }

  const sizeMb = Math.max(1, Math.ceil(Number(fileSizeBytes || 0) / MEBIBYTE));
  const adaptive = 180000 + Math.ceil(sizeMb / 25) * 60000;
  return clamp(adaptive, DEFAULT_MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

function metaBinaryUploadHeaders(fileSizeBytes, {
  accessToken = "",
  contentType = "application/octet-stream",
} = {}) {
  const size = Math.max(0, Math.trunc(Number(fileSizeBytes) || 0)).toString();
  return {
    Authorization: `OAuth ${accessToken}`,
    offset: "0",
    file_size: size,
    "Content-Length": size,
    "X-Entity-Length": size,
    "Content-Type": contentType,
  };
}

function instagramResumableUploadHeaders(fileSizeBytes, {
  accessToken = "",
} = {}) {
  const size = Math.max(0, Math.trunc(Number(fileSizeBytes) || 0)).toString();
  return {
    Authorization: `OAuth ${accessToken}`,
    offset: "0",
    file_size: size,
    "Content-Length": size,
    "X-Entity-Length": size,
  };
}

module.exports = {
  DEFAULT_MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_OVERRIDE_MS,
  instagramResumableUploadHeaders,
  metaBinaryUploadHeaders,
  metaBinaryUploadTimeoutMs,
};
