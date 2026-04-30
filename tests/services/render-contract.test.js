"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const c = require("../../lib/render-contract");
const d = require("../../lib/render-decision");

// 2026-04-30 audit P0 #2: render contract that decides whether a
// story has reached premium / standard / fallback / reject grade.
// The contract MUST be observable (so Discord shows the verdict on
// every publish) AND env-flagged (BLOCK_BELOW_CONTRACT) so the
// audit's "don't burn auto-publish on heuristics" caution is
// honoured by default.

// ── evaluateRenderContract: hard rejects ─────────────────────────

test("evaluateRenderContract: missing exported_path → reject", () => {
  const v = c.evaluateRenderContract({
    title: "X",
    full_script: "Some script",
  });
  assert.equal(v.class, "reject");
  assert.ok(v.reasons.includes("no_exported_mp4"));
});

test("evaluateRenderContract: missing script does NOT reject (delegated to content-qa upstream)", () => {
  // The contract intentionally doesn't duplicate content-qa's
  // script-presence check — by the time the contract runs, the story
  // already passed QA. This keeps the contract focused on render-
  // quality + brand-safety signals only. (See render-contract.js
  // hard-reject block for the rationale.)
  const v = c.evaluateRenderContract({
    title: "X",
    exported_path: "/tmp/x.mp4",
    full_script: "   ",
    distinct_visual_count: 4,
    render_lane: "legacy_multi_image",
    outro_present: true,
    thumbnail_candidate_present: true,
  });
  assert.notEqual(v.class, "reject");
  assert.ok(!v.reasons.includes("no_script"));
});

test("evaluateRenderContract: topicality reject is NOT a contract reject (upstream-only)", () => {
  // The contract intentionally trusts upstream topicality decisions.
  // By the time a story reaches publishNextStory it's already been
  // approved; re-evaluating topicality here would double-block stories
  // that the operator already explicitly approved. Topicality is
  // surfaced into the premium/standard split (review demotes to
  // standard) but no longer drives a hard reject.
  const v = c.evaluateRenderContract(
    {
      title: "TV show review",
      exported_path: "/tmp/x.mp4",
      full_script: "long enough script",
      distinct_visual_count: 4,
      render_lane: "legacy_multi_image",
      outro_present: true,
      thumbnail_candidate_present: true,
    },
    {
      topicalityResult: {
        decision: "reject",
        reasons: ["off_brand_entertainment"],
      },
    },
  );
  assert.notEqual(v.class, "reject");
  assert.ok(!v.reasons.includes("topicality_reject"));
});

test("evaluateRenderContract: zero distinct_visual_count → reject", () => {
  const v = c.evaluateRenderContract({
    title: "X",
    exported_path: "/tmp/x.mp4",
    full_script: "ok script",
    distinct_visual_count: 0,
  });
  assert.equal(v.class, "reject");
  assert.ok(v.reasons.includes("zero_visuals_used_composite"));
});

test("evaluateRenderContract: title text-hygiene fail → reject", () => {
  const v = c.evaluateRenderContract(
    {
      title: "Broken &fakebadcoded; title",
      exported_path: "/tmp/x.mp4",
      full_script: "ok script",
      distinct_visual_count: 4,
    },
    {
      textHygiene: {
        severity: "fail",
        issues: ["raw_html_entity_after_normalise"],
      },
    },
  );
  assert.equal(v.class, "reject");
  assert.ok(v.reasons.includes("title_text_hygiene_fail"));
});

// ── floor (standard) ─────────────────────────────────────────────

test("evaluateRenderContract: standard floor met (multi-image, 4 visuals, outro, thumb) → standard", () => {
  const v = c.evaluateRenderContract({
    title: "Standard render",
    exported_path: "/tmp/x.mp4",
    full_script: "ok script with words",
    distinct_visual_count: 4,
    render_lane: "legacy_multi_image",
    outro_present: true,
    thumbnail_candidate_present: true,
  });
  assert.equal(v.class, "standard");
  assert.deepEqual(v.missing, []);
});

test("evaluateRenderContract: missing outro drops to fallback", () => {
  const v = c.evaluateRenderContract({
    title: "Missing outro",
    exported_path: "/tmp/x.mp4",
    full_script: "ok script",
    distinct_visual_count: 5,
    render_lane: "legacy_multi_image",
    outro_present: false,
    thumbnail_candidate_present: true,
  });
  assert.equal(v.class, "fallback");
  assert.ok(v.missing.includes("outro_card_missing"));
});

test("evaluateRenderContract: single-image lane → fallback", () => {
  const v = c.evaluateRenderContract({
    title: "Single image",
    exported_path: "/tmp/x.mp4",
    full_script: "ok script",
    distinct_visual_count: 4,
    render_lane: "legacy_single_image_fallback",
    outro_present: true,
    thumbnail_candidate_present: true,
  });
  assert.equal(v.class, "fallback");
  assert.ok(v.missing.includes("multi_image_lane"));
});

test("evaluateRenderContract: visuals < 3 → fallback", () => {
  const v = c.evaluateRenderContract({
    title: "Thin",
    exported_path: "/tmp/x.mp4",
    full_script: "ok script",
    distinct_visual_count: 2,
    render_lane: "legacy_multi_image",
    outro_present: true,
    thumbnail_candidate_present: true,
  });
  assert.equal(v.class, "fallback");
  assert.ok(v.missing.some((m) => m.startsWith("visuals_below_3")));
});

// ── premium ──────────────────────────────────────────────────────

test("evaluateRenderContract: every premium box → premium", () => {
  const v = c.evaluateRenderContract(
    {
      title: "Clean title",
      exported_path: "/tmp/x.mp4",
      full_script: "Substantial premium script with body",
      distinct_visual_count: 7,
      render_lane: "legacy_multi_image",
      outro_present: true,
      thumbnail_candidate_present: true,
    },
    {
      topicalityResult: { decision: "auto", reasons: [] },
      textHygiene: { severity: "clean", issues: [] },
      provenanceRows: [
        { accepted: 1, source_type: "steam_capsule" },
        { accepted: 1, source_type: "igdb_screenshot" },
      ],
    },
  );
  assert.equal(v.class, "premium");
  assert.deepEqual(v.missing, []);
});

test("evaluateRenderContract: premium without official source → standard", () => {
  const v = c.evaluateRenderContract(
    {
      title: "Clean title",
      exported_path: "/tmp/x.mp4",
      full_script: "Substantial premium script",
      distinct_visual_count: 7,
      render_lane: "legacy_multi_image",
      outro_present: true,
      thumbnail_candidate_present: true,
    },
    {
      topicalityResult: { decision: "auto", reasons: [] },
      textHygiene: { severity: "clean", issues: [] },
      provenanceRows: [
        { accepted: 1, source_type: "pexels" }, // stock only
      ],
    },
  );
  assert.equal(v.class, "standard");
});

test("evaluateRenderContract: topicality review-only also bars premium", () => {
  const v = c.evaluateRenderContract(
    {
      title: "Adjacent",
      exported_path: "/tmp/x.mp4",
      full_script: "Substantial script",
      distinct_visual_count: 7,
      render_lane: "legacy_multi_image",
      outro_present: true,
      thumbnail_candidate_present: true,
    },
    {
      topicalityResult: { decision: "review", reasons: ["weak_signal"] },
      provenanceRows: [{ accepted: 1, source_type: "steam_hero" }],
    },
  );
  assert.equal(v.class, "standard");
});

// ── decideContractGate (env-flagged) ─────────────────────────────

test("decideContractGate: reject is always blocked", () => {
  const r = c.decideContractGate(
    { class: "reject", reasons: ["no_script"] },
    { BLOCK_BELOW_CONTRACT: "false" },
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason, /contract_reject/);
});

test("decideContractGate: default env (BLOCK off) → fallback allowed", () => {
  const r = c.decideContractGate(
    { class: "fallback", reasons: [], missing: ["outro_card_missing"] },
    {},
  );
  assert.equal(r.allowed, true);
});

test("decideContractGate: BLOCK_BELOW_CONTRACT=true with floor=standard blocks fallback", () => {
  const r = c.decideContractGate(
    { class: "fallback", reasons: [], missing: ["thin_visuals"] },
    { BLOCK_BELOW_CONTRACT: "true", CONTRACT_FLOOR: "standard" },
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason, /below_contract_floor/);
});

test("decideContractGate: BLOCK_BELOW_CONTRACT=true with floor=standard allows standard", () => {
  const r = c.decideContractGate(
    { class: "standard", reasons: [], missing: [] },
    { BLOCK_BELOW_CONTRACT: "true", CONTRACT_FLOOR: "standard" },
  );
  assert.equal(r.allowed, true);
});

test("decideContractGate: BLOCK with floor=premium allows only premium", () => {
  const r1 = c.decideContractGate(
    { class: "standard", reasons: [], missing: [] },
    { BLOCK_BELOW_CONTRACT: "true", CONTRACT_FLOOR: "premium" },
  );
  assert.equal(r1.allowed, false);
  const r2 = c.decideContractGate(
    { class: "premium", reasons: [], missing: [] },
    { BLOCK_BELOW_CONTRACT: "true", CONTRACT_FLOOR: "premium" },
  );
  assert.equal(r2.allowed, true);
});

// ── formatContractLine ──────────────────────────────────────────

test("formatContractLine: premium has no missing line", () => {
  const line = c.formatContractLine({
    class: "premium",
    missing: [],
    reasons: [],
  });
  assert.match(line, /PREMIUM/);
  assert.doesNotMatch(line, /missing/);
});

test("formatContractLine: fallback shows missing", () => {
  const line = c.formatContractLine({
    class: "fallback",
    missing: ["multi_image_lane"],
    reasons: [],
  });
  assert.match(line, /FALLBACK/);
  assert.match(line, /missing=multi_image_lane/);
});

test("formatContractLine: reject shows reasons", () => {
  const line = c.formatContractLine({
    class: "reject",
    missing: [],
    reasons: ["no_script"],
  });
  assert.match(line, /REJECT/);
  assert.match(line, /reject=no_script/);
});

// ── decideForStory orchestration ─────────────────────────────────

test("decideForStory: composes contract + topicality + hygiene + gate", async () => {
  const decision = await d.decideForStory(
    {
      id: "x1",
      title: "Halo Infinite update lands today",
      exported_path: "/tmp/x.mp4",
      full_script: "long script body",
      distinct_visual_count: 6,
      render_lane: "legacy_multi_image",
      outro_present: true,
      thumbnail_candidate_present: true,
    },
    {
      provenanceRows: [{ accepted: 1, source_type: "steam_screenshot" }],
      env: {},
    },
  );
  assert.ok(
    ["premium", "standard", "fallback"].includes(decision.verdict.class),
  );
  assert.equal(decision.gate.allowed, true);
});

test("decideForStory: missing modules → graceful default reject?", async () => {
  // When the contract module is explicitly null, decideForStory should
  // return a reject so production is never published without verdict.
  const decision = await d.decideForStory(
    { id: "x" },
    { renderContract: null, env: {} },
  );
  assert.equal(decision.verdict.class, "reject");
  assert.equal(decision.gate.allowed, false);
});

// ── summariseDecisions ──────────────────────────────────────────

test("summariseDecisions: tallies by class and blocked", () => {
  const summary = d.summariseDecisions([
    { verdict: { class: "premium" }, gate: { allowed: true } },
    { verdict: { class: "standard" }, gate: { allowed: true } },
    {
      verdict: { class: "fallback" },
      gate: { allowed: false, reason: "below_contract_floor" },
    },
    {
      verdict: { class: "reject", reasons: ["no_script"] },
      gate: { allowed: false, reason: "contract_reject:no_script" },
    },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.by_class.premium, 1);
  assert.equal(summary.by_class.standard, 1);
  assert.equal(summary.by_class.fallback, 1);
  assert.equal(summary.by_class.reject, 1);
  assert.equal(summary.allowed, 2);
  assert.equal(summary.blocked, 2);
  assert.ok(summary.blocked_reasons["below_contract_floor"] >= 1);
});
