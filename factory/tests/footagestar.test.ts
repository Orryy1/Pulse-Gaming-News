import { test } from "node:test";
import assert from "node:assert/strict";
import { publisherFootageOverride } from "../src/assets/officialTrailer.ts";
import { defaultFootageSeconds } from "../src/assets/footage.ts";

test("PUBLISHER_FOOTAGE_SECONDS star sets every publisher and the default; a named one still wins", () => {
  const was = process.env.PUBLISHER_FOOTAGE_SECONDS;
  try {
    process.env.PUBLISHER_FOOTAGE_SECONDS = "*=180,Nintendo=40";
    assert.equal(publisherFootageOverride("Rockstar Games"), 180);
    assert.equal(publisherFootageOverride("Nintendo"), 40);
    assert.equal(defaultFootageSeconds(), 180);
    process.env.PUBLISHER_FOOTAGE_SECONDS = "Rockstar Games=34";
    assert.equal(publisherFootageOverride("Capcom"), undefined);
    assert.equal(defaultFootageSeconds(), 34);
  } finally {
    if (was === undefined) delete process.env.PUBLISHER_FOOTAGE_SECONDS;
    else process.env.PUBLISHER_FOOTAGE_SECONDS = was;
  }
});
