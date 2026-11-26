// Studio names with digits said the way fans say them (26 Nov 2026: "343 Industries" came out as a count).
import test from "node:test";
import assert from "node:assert/strict";
import { speakable, SAID_BACK } from "../src/voice/speakable.ts";

test("studio names with digits are said as fans say them; plain counts are not touched", () => {
  assert.match(speakable("343 Industries laid off staff."), /^three four three Industries/);
  assert.equal(speakable("4A Games and 505 Games"), "four A Games and five oh five Games");
  assert.match(speakable("2K Games said 2K Sports grew."), /two K Games said two K Sports/);
  assert.match(speakable("3D Realms is back."), /three D Realms/);
  assert.doesNotMatch(speakable("It sold 343 copies."), /three four three/);
});

test("captions turn the spoken studio names back into their written form", () => {
  const back = new Map(SAID_BACK.map(([words, written]) => [words.join(" "), written]));
  assert.equal(back.get("three four three industries"), "343 Industries");
  assert.equal(back.get("five oh five games"), "505 Games");
  assert.equal(back.get("four a games"), "4A Games");
});
