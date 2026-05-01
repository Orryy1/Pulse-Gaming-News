"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  runBrandNameQa,
  extractAssPlainText,
  PROTECTED_NAMES,
} = require("../../lib/brand-name-qa");

test("runBrandNameQa fails damaged protected names in downstream TTS text", () => {
  const qa = runBrandNameQa({
    title: "Pokemon TCG expansion announced",
    full_script: "Pok\u00e9mon's next card set was confirmed today.",
    tts_script: "Pokmon's next card set was confirmed today.",
  });

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) =>
      f.includes("protected_name_damaged:Pok\u00e9mon:tts_script:Pokmon"),
    ),
  );
});

test("runBrandNameQa warns on non-official spelling without blocking", () => {
  const qa = runBrandNameQa({
    title: "New Pokemon TCG expansion announced",
    full_script: "Pokemon's next card set was confirmed today.",
  });

  assert.equal(qa.result, "warn");
  assert.deepEqual(qa.failures, []);
  assert.ok(
    qa.warnings.some((w) =>
      w.includes("protected_name_noncanonical:Pok\u00e9mon:full_script:Pokemon"),
    ),
  );
});

test("runBrandNameQa treats repairable mojibake as clean after normalisation", () => {
  const qa = runBrandNameQa({
    title: "Pok\u00c3\u00a9mon news",
    full_script: "Pok\u00c3\u00a9mon returns today.",
    tts_script: "Pok\u00e9mon returns today.",
  });

  assert.equal(qa.result, "pass");
  assert.deepEqual(qa.failures, []);
  assert.deepEqual(qa.warnings, []);
});

test("extractAssPlainText strips ASS tags and keeps subtitle words inspectable", () => {
  const ass = [
    "[Events]",
    "Dialogue: 0,0:00:00.00,0:00:01.20,Caption,,0,0,0,,{\\b1}Pokmon\\Nreturns",
  ].join("\n");

  assert.equal(extractAssPlainText(ass), "Pokmon returns");
});

test("PROTECTED_NAMES pins core gaming brand spellings", () => {
  const names = PROTECTED_NAMES.map((entry) => entry.canonical);
  assert.ok(names.includes("Pok\u00e9mon"));
  assert.ok(names.includes("NVIDIA"));
  assert.ok(names.includes("Bethesda"));
  assert.ok(names.includes("HoYoverse"));
});
