"use strict";

const crypto = require("node:crypto");

const MOTION_REPAIR_WORK_ORDER_SCHEMA =
  "pulse-evergreen-motion-coverage-repair-work-order-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashEvergreenMotionRepairWorkOrder(value) {
  const material = structuredClone(object(value));
  delete material.work_order_sha256;
  return crypto
    .createHash("sha256")
    .update(stableJson(material))
    .digest("hex");
}

function hasValidEvergreenMotionRepairWorkOrderHash(value) {
  const declared = String(value?.work_order_sha256 || "")
    .trim()
    .toLowerCase();
  return (
    SHA256_PATTERN.test(declared) &&
    hashEvergreenMotionRepairWorkOrder(value) === declared
  );
}

module.exports = {
  MOTION_REPAIR_WORK_ORDER_SCHEMA,
  hasValidEvergreenMotionRepairWorkOrderHash,
  hashEvergreenMotionRepairWorkOrder,
};
