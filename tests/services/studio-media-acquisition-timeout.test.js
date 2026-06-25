"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveFfprobeDurationTimeoutMs,
} = require("../../lib/studio/media-acquisition");

test("ffprobe duration timeout defaults to a bounded remote-media cap", () => {
  assert.equal(resolveFfprobeDurationTimeoutMs({}), 10000);
});

test("ffprobe duration timeout accepts sane overrides and rejects unsafe values", () => {
  assert.equal(resolveFfprobeDurationTimeoutMs({ timeoutMs: 2500 }), 2500);
  assert.equal(resolveFfprobeDurationTimeoutMs({ timeoutMs: 50 }), 10000);
  assert.equal(resolveFfprobeDurationTimeoutMs({ timeoutMs: 999999 }), 120000);
});
