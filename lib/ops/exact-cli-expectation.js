"use strict";

function assertExpectedCliVerdict({ actual, expected, allowed, required = false }) {
  const allowedValues = new Set(Array.isArray(allowed) ? allowed : []);
  if (!allowedValues.has(actual)) {
    return { matched: false, exitCode: 64 };
  }
  if (expected === undefined || expected === null || String(expected).trim() === "") {
    return required
      ? { matched: false, exitCode: 64 }
      : { matched: true, exitCode: 0 };
  }
  const exactExpected = String(expected).trim();
  if (!allowedValues.has(exactExpected)) {
    return { matched: false, exitCode: 64 };
  }
  return {
    matched: actual === exactExpected,
    exitCode: actual === exactExpected ? 0 : 2,
  };
}

module.exports = { assertExpectedCliVerdict };
