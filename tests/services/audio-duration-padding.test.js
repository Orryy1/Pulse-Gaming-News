"use strict";

process.env.PULSE_SKIP_DOTENV = "true";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDeterministicDurationRewrite,
  insertBeforeSpokenOutro,
} = require("../../audio");
const { runScriptCoherenceQa } = require("../../lib/script-coherence-qa");

test("duration padding keeps the approved CTA once at the end", () => {
  const script =
    "A short source-backed script. Follow Pulse Gaming so you never miss a beat.";

  const out = insertBeforeSpokenOutro(script, "Extra context goes here.");

  assert.equal(
    out,
    "A short source-backed script. Extra context goes here. Follow Pulse Gaming so you never miss a beat.",
  );
  assert.equal(
    (out.match(/Follow Pulse Gaming so you never miss a beat/g) || []).length,
    1,
  );
});

test("duration padding restores the approved CTA when the source script is missing it", () => {
  const script = "A short source-backed script.";

  const out = insertBeforeSpokenOutro(script, "Extra context goes here.");

  assert.equal(
    out,
    "A short source-backed script. Extra context goes here. Follow Pulse Gaming so you never miss a beat.",
  );
  assert.equal(
    (out.match(/Follow Pulse Gaming so you never miss a beat/g) || []).length,
    1,
  );
});

test("duration padding adds caveat language without strengthening hypothetical claims", () => {
  const story = {
    title: "Stardew Valley dev considers relationship drama",
    full_script:
      "Stardew Valley might add a relationship system one day, but this is not confirmed. Creator Eric Barone said the idea is still hypothetical. Follow Pulse Gaming so you never miss a beat.",
  };

  const out = buildDeterministicDurationRewrite(story, { attempt: 1 });

  assert.match(out.full_script, /not the same thing as a dated feature announcement/i);
  assert.match(out.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(out.full_script, /\bconfirmed he wants\b/i);
  assert.doesNotMatch(out.full_script, /\bis coming\b/i);
  assert.equal(
    (out.full_script.match(/Follow Pulse Gaming so you never miss a beat/g) || [])
      .length,
    1,
  );
  assert.equal(out.word_count > story.full_script.split(/\s+/).length, true);
});

test("second duration padding attempt adds a source-safe follow-up sentence", () => {
  const story = {
    title: "Reportedly leaked game build still needs confirmation",
    full_script:
      "A game build reportedly leaked before launch. Follow Pulse Gaming so you never miss a beat.",
  };

  const out = buildDeterministicDurationRewrite(story, { attempt: 2 });

  assert.match(out.full_script, /still needs official confirmation/i);
  assert.match(out.full_script, /honest angle is what has changed for players today/i);
  assert.match(out.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(out.full_script, /For Pulse|direction of travel|signal first|tracking the official follow-up/i);
  assert.equal(
    runScriptCoherenceQa(
      { ...story, full_script: out.full_script, cta: "Follow Pulse Gaming so you never miss a beat" },
      { requireCtaField: true, requireFullScriptCta: true },
    ).result,
    "pass",
  );
});
