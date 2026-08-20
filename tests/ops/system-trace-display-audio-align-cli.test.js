"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { main } = require("../../tools/system-trace-display-audio-align");

test("audio alignment CLI has one fixed apply mode and no caller paths", async () => {
  let calls = 0;
  const run = async () => {
    calls += 1;
    return { verdict: "GREEN", frame_count: 42 };
  };
  assert.equal(await main([], { run, write: () => {} }), 64);
  assert.equal(
    await main(["--apply", "--root", "elsewhere"], { run, write: () => {} }),
    64,
  );
  assert.equal(calls, 0);
  assert.equal(await main(["--apply"], { run, write: () => {} }), 0);
  assert.equal(calls, 1);
});
