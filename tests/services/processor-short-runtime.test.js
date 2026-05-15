const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const processor = require("../../processor");
const PROCESSOR_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "processor.js"),
  "utf8",
);

function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i + 1}`).join(" ");
}

const EXACT_CTA = "Follow Pulse Gaming so you never miss a beat.";
const EXACT_CTA_WORDS = 9;

function script(wordCount) {
  const narrativeWordCount = Math.max(0, wordCount - EXACT_CTA_WORDS);
  const fullScript = [words(narrativeWordCount), EXACT_CTA]
    .filter(Boolean)
    .join(" ");
  return {
    classification: "[CONFIRMED]",
    hook: "Nintendo quietly confirmed a hardware shift.",
    body: "Details landed from an official source.",
    cta: EXACT_CTA,
    full_script: fullScript,
    word_count: wordCount,
    suggested_thumbnail_text: "Nintendo shift",
  };
}

test("processor validate: Pulse accepts current 61-75s spoken word budget", () => {
  const errors = processor.validate(script(100), "pulse-gaming");
  assert.deepEqual(errors, []);
});

test("processor validate: Pulse allows 76-90s scripts as extended Short candidates", () => {
  const errors = processor.validate(script(123), "pulse-gaming");
  assert.deepEqual(errors, []);
});

test("processor validate: Pulse rejects old 160-180 word scripts", () => {
  const errors = processor.validate(script(166), "pulse-gaming");
  assert.ok(
    errors.some((e) => e.includes("script_runtime_too_long")),
    `got: ${errors.join(", ")}`,
  );
});

test("processor validate: rejects future dates presented as already launched", () => {
  const item = script(100);
  item.hook = "Forza Horizon 6 just launched today.";
  item.full_script = `${words(96)} The PC and Xbox Series X versions launched today, May 19th, 2026. Follow Pulse Gaming so you never miss a beat.`;

  const errors = processor.validate(item, "pulse-gaming", {
    now: new Date("2026-05-15T12:00:00Z"),
  });

  assert.ok(
    errors.some((e) => e.includes("unsupported_future_release_claim:May 19th, 2026")),
    `got: ${errors.join(", ")}`,
  );
});

test("processor validate: allows future scheduled dates when not claimed as already live", () => {
  const item = script(100);
  item.hook = "Forza Horizon 6 finally has a release window.";
  item.full_script = `${words(96)} The PC and Xbox Series X versions launch on May 19th, 2026. Follow Pulse Gaming so you never miss a beat.`;

  const errors = processor.validate(item, "pulse-gaming", {
    now: new Date("2026-05-15T12:00:00Z"),
  });

  assert.deepEqual(errors, []);
});

test("processor validate: allows launched today when the explicit date is today", () => {
  const item = script(100);
  item.hook = "Subnautica 2 just launched today.";
  item.full_script = `${words(96)} Subnautica 2 launched today, May 15th, 2026. Follow Pulse Gaming so you never miss a beat.`;

  const errors = processor.validate(item, "pulse-gaming", {
    now: new Date("2026-05-15T12:00:00Z"),
  });

  assert.deepEqual(errors, []);
});

test("processor validate: rejects generated scripts with fake Reddit insider framing", () => {
  const item = script(100);
  item.full_script = `${words(96)} A verified insider claims this ordinary Reddit thread proves a platform shift. Follow Pulse Gaming so you never miss a beat.`;

  const errors = processor.validate(item, "pulse-gaming", {
    story: {
      title: "Had a PS5 for years and someone just pointed this out to me.",
      source_type: "reddit",
      subreddit: "gaming",
    },
  });

  assert.ok(
    errors.includes("script_coherence:general_reddit_verified_insider_claim"),
    `got: ${errors.join(", ")}`,
  );
});

test("processor validate: rejects non-exact CTA field", () => {
  const item = script(100);
  item.cta = "Following Pulse Gaming so you never miss a beat.";

  const errors = processor.validate(item, "pulse-gaming");

  assert.ok(errors.includes("script_coherence:cta_not_exact"), `got: ${errors.join(", ")}`);
});

test("processor validate: rejects scripts where exact CTA is metadata-only", () => {
  const item = script(100);
  item.cta = "Follow Pulse Gaming so you never miss a beat";
  item.full_script =
    "Nintendo confirmed the Switch 2 bundle and named the price. The detail matters because it changes the value calculation for early buyers today.";

  const errors = processor.validate(item, "pulse-gaming");

  assert.ok(
    errors.includes("script_coherence:missing_exact_cta_in_script"),
    `got: ${errors.join(", ")}`,
  );
});

test("processor sanitiseScript tightens an overlong hook before validation", () => {
  const item = script(100);
  item.hook =
    "Subnautica 2 just hit early access with a concrete player milestone, a Steam surge and a comeback problem nobody can ignore";

  processor.sanitiseScript(item);

  assert.ok(
    item.hook.split(/\s+/).filter(Boolean).length <= 24,
    `hook was not tightened: ${item.hook}`,
  );
  assert.deepEqual(processor.validate(item, "pulse-gaming"), []);
});

test("processor sanitiseScript replaces advertiser-risk words before validation", () => {
  const item = script(100);
  item.hook = "EA just killed another Dead Space comeback.";
  item.full_script = `${words(96)} EA killed another Dead Space comeback. Follow Pulse Gaming so you never miss a beat.`;

  processor.sanitiseScript(item);

  assert.doesNotMatch(item.full_script, /\bkilled\b/i);
  assert.deepEqual(processor.validate(item, "pulse-gaming"), []);
});

test("processor sanitiseScript removes direction markers and punctuation spacing from hooks", () => {
  const item = script(100);
  item.hook =
    "AMD just announced FSR 4.1 , and it is coming to older RX 6000 cards. [PAUSE] That matters for PC players.";

  processor.sanitiseScript(item);

  assert.equal(
    item.hook,
    "AMD just announced FSR 4.1, and it is coming to older RX 6000 cards.",
  );
  assert.doesNotMatch(item.hook, /\[/);
  assert.doesNotMatch(item.hook, /\s+[,.!?;:]/);
  assert.deepEqual(processor.validate(item, "pulse-gaming"), []);
});

test("processor validate: non-Pulse channels keep their existing word-count contract", () => {
  const errors = processor.validate(script(166), "the-signal");
  assert.deepEqual(errors, []);
});

test("processor editor prompt: Pulse uses Flash Lane word budget, not old 155-185 range", () => {
  const instruction = processor.editorWordCountInstruction({
    id: "pulse-gaming",
  });

  assert.match(instruction, /90-110/);
  assert.doesNotMatch(instruction, /155-185/);
  assert.match(instruction, /Do not expand it/);
});

test("processor prompt treats Reddit top comments as audience colour, not source evidence", () => {
  assert.match(PROCESSOR_SOURCE, /Top comment \(audience colour only, not source evidence\)/);
  assert.match(PROCESSOR_SOURCE, /Do not use Reddit comments as factual evidence/);
});

test("Pulse channel prompt does not request fake verified-insider attribution", () => {
  const channelSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "channels", "pulse-gaming.js"),
    "utf8",
  );

  assert.doesNotMatch(channelSource, /A verified insider claims/);
  assert.match(channelSource, /Do not invent insider attribution/);
});

test("processor editor prompt: non-Pulse channels keep legacy long-form short range", () => {
  const instruction = processor.editorWordCountInstruction({
    id: "the-signal",
  });

  assert.match(instruction, /155-185/);
});

test("processor editor pass revalidates edited scripts before accepting them", () => {
  assert.match(PROCESSOR_SOURCE, /validate\(edited,\s*channel\.id,\s*\{\s*story\s*\}\)/);
  assert.match(PROCESSOR_SOURCE, /editor_validation_failed/);
});

test("processor final validation failure routes story to review instead of accepting bad Short script", () => {
  assert.doesNotMatch(PROCESSOR_SOURCE, /Using script despite validation issues/);
  assert.match(PROCESSOR_SOURCE, /Final validation failed; routing story to review/);

  const fallback = processor.buildScriptValidationReview(
    { id: "story1", title: "GTA 6 script ran too long" },
    { id: "pulse-gaming" },
    ["script_runtime_too_long (112.00s, max 75.00s)"],
  );

  assert.equal(fallback.classification, "[REVIEW]");
  assert.equal(fallback.full_script, "");
  assert.equal(fallback.tts_script, "");
  assert.equal(fallback.word_count, 0);
  assert.equal(fallback.quality_score, 0);
  assert.equal(fallback.approved, false);
  assert.equal(fallback.auto_approved, false);
  assert.equal(fallback.script_generation_status, "review_required");
  assert.equal(fallback.runtime_route, "briefing_or_longform");
  assert.deepEqual(fallback.script_validation_errors, [
    "script_runtime_too_long (112.00s, max 75.00s)",
  ]);
});

test("processor final validation failure preserves extended-short routing metadata", () => {
  const fallback = processor.buildScriptValidationReview(
    { id: "story2", title: "A richer story needs more than Flash Lane" },
    { id: "pulse-gaming" },
    [
      "script_runtime_extended_review_required (84.00s, flash max 75.00s, review max 90.00s)",
    ],
  );

  assert.equal(fallback.classification, "[REVIEW]");
  assert.equal(fallback.format_route, "extended_or_briefing");
  assert.equal(fallback.runtime_route, "extended_or_briefing");
  assert.equal(fallback.script_generation_status, "review_required");
});
