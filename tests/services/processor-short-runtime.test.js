"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const processor = require("../../processor");
const pulseChannel = require("../../channels/pulse-gaming");
const {
  CTA_POLICY,
  buildPulseGenerationPrompt,
  resolvePulseScriptContract,
} = require("../../lib/services/pulse-editorial-contract");
const PROCESSOR_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "processor.js"),
  "utf8",
);
const AUDIT_HASH = `sha256:${"a".repeat(64)}`;

function words(count) {
  return Array.from({ length: count }, (_, index) => `detail${index}`).join(
    " ",
  );
}

function script(wordCount, cta = "", declarations = {}) {
  const ctaWords = cta ? cta.trim().split(/\s+/).length : 0;
  const body = words(Math.max(0, wordCount - ctaWords));
  return {
    classification: "[CONFIRMED]",
    editorial_lane_id:
      declarations.editorial_lane_id || "what_changes_for_players",
    hook_type: declarations.hook_type || "direct",
    duration_band_id:
      declarations.duration_band_id || "what_changes_short_25_32",
    hook: "Nintendo quietly confirmed a hardware shift.",
    body: "Details landed from an official source.",
    cta,
    full_script: [body, cta].filter(Boolean).join(" "),
    word_count: wordCount,
    suggested_thumbnail_text: "Nintendo shift",
  };
}

function scriptForContract(wordCount, selectedContract, cta = "") {
  return script(wordCount, cta, {
    editorial_lane_id: selectedContract.editorial_lane_id,
    hook_type: selectedContract.hook_type,
    duration_band_id: selectedContract.duration_band_id,
  });
}

function contract(durationBandId, laneId) {
  return resolvePulseScriptContract({
    story: {
      id: `story-${durationBandId}`,
      editorial_lane_id: laneId,
      hook_type: "direct",
      duration_band_id: durationBandId,
    },
  });
}

function ctaDecision(includeCta) {
  return {
    policy_version: CTA_POLICY.version,
    scope: "shorts",
    include_cta: includeCta,
    copy_strategy: includeCta ? CTA_POLICY.copy_strategy : "none",
    cohort_bucket: includeCta ? 0 : 1,
    cohort_numerator: 1,
    cohort_denominator: 3,
    audit_hash: AUDIT_HASH,
  };
}

test("processor quality scoring fails closed when the editorial provider fails", async () => {
  const secret = "provider-error-must-not-escape";
  const result = await processor.scoreScript(
    {
      messages: {
        async create() {
          throw new Error(`upstream failed with ${secret}`);
        },
      },
    },
    {
      classification: "[CONFIRMED]",
      full_script: "A valid script awaiting a governed quality score.",
    },
    { title: "Verified gaming story" },
    pulseChannel,
  );

  assert.equal(result.score, 0);
  assert.equal(result.failed, true);
  assert.match(result.reason, /human review required/i);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("processor quality scoring honours a selected direct-hook contract instead of demanding an open loop", async () => {
  let request = null;
  let calls = 0;
  const selected = contract(
    "what_changes_short_25_32",
    "what_changes_for_players",
  );
  const result = await processor.scoreScript(
    {
      messages: {
        async create(input) {
          calls += 1;
          request = input;
          return {
            content: [
              {
                text: JSON.stringify({
                  score: 8,
                  reason:
                    "The consequence is immediate and specific without manufacturing a curiosity gap.",
                }),
              },
            ],
          };
        },
      },
    },
    scriptForContract(42, selected),
    { title: "Verified gaming story" },
    pulseChannel,
    {
      contract: selected,
      ctaDecision: ctaDecision(false),
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.score, 8);
  assert.match(
    request.system,
    /direct hook should state the verified consequence immediately/i,
  );
  assert.match(
    request.system,
    /must not be penalised for revealing the core verified change/i,
  );
  assert.doesNotMatch(
    request.system,
    /hook that reveals the answer or is vague scores 1-3/i,
  );
});

test("processor re-scores a direct hook when the critic applies an open-loop rubric", async () => {
  const requests = [];
  const selected = contract(
    "what_changes_short_25_32",
    "what_changes_for_players",
  );
  const responses = [
    {
      score: 2,
      reason: "The hook reveals the entire answer upfront.",
    },
    {
      score: 8,
      reason:
        "The verified player consequence lands immediately and specifically.",
    },
  ];

  const result = await processor.scoreScript(
    {
      messages: {
        async create(input) {
          requests.push(input);
          return {
            content: [
              {
                text: JSON.stringify(responses[requests.length - 1]),
              },
            ],
          };
        },
      },
    },
    scriptForContract(42, selected),
    { title: "Verified gaming story" },
    pulseChannel,
    {
      contract: selected,
      ctaDecision: ctaDecision(false),
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(result.score, 8);
  assert.equal(result.failed, false);
  assert.match(requests[1].system, /rubric-correction rescore/i);
  assert.match(
    requests[1].system,
    /do not apply an open-loop or curiosity-gap criterion/i,
  );
});

test("processor fails a direct-hook quality score closed when the corrected critic repeats the wrong rubric", async () => {
  let calls = 0;
  const selected = contract(
    "what_changes_short_25_32",
    "what_changes_for_players",
  );

  const result = await processor.scoreScript(
    {
      messages: {
        async create() {
          calls += 1;
          return {
            content: [
              {
                text: JSON.stringify({
                  score: 2,
                  reason:
                    "It still gives away the answer instead of building a curiosity gap.",
                }),
              },
            ],
          };
        },
      },
    },
    scriptForContract(42, selected),
    { title: "Verified gaming story" },
    pulseChannel,
    {
      contract: selected,
      ctaDecision: ctaDecision(false),
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.score, 0);
  assert.equal(result.failed, true);
  assert.match(result.reason, /human review required/i);
});

test("processor accepts a valid low direct-hook score for a real direct-hook defect", async () => {
  let calls = 0;
  const selected = contract(
    "what_changes_short_25_32",
    "what_changes_for_players",
  );

  const result = await processor.scoreScript(
    {
      messages: {
        async create() {
          calls += 1;
          return {
            content: [
              {
                text: JSON.stringify({
                  score: 3,
                  reason:
                    "The hook is vague and never states the exact player consequence.",
                }),
              },
            ],
          };
        },
      },
    },
    scriptForContract(42, selected),
    { title: "Verified gaming story" },
    pulseChannel,
    {
      contract: selected,
      ctaDecision: ctaDecision(false),
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.score, 3);
  assert.equal(result.failed, false);
});

test("processor labels a fabricated review fallback as local instead of model-generated", () => {
  const identity = processor.resolveScriptGeneratorIdentity({
    client: {
      editorial_identity: {
        provider: "google",
        model: "gemini-3.1-pro-preview",
        adapter: "gemini.generateContent",
      },
    },
    usedLocalFallback: true,
  });

  assert.deepEqual(identity, {
    provider: "local",
    model: "deterministic-review-fallback",
    adapter: "processor.manual-review-fallback",
  });
});

test("processor retries an existing title-only generation failure but preserves a real completed script", () => {
  const failed = {
    id: "rss_failed",
    title: "Silent Hill: Townfall hands-on report",
    hook: "Silent Hill: Townfall hands-on report",
    body: "Script generation failed. Manual edit required.",
    full_script: "Silent Hill: Townfall hands-on report",
  };
  const complete = {
    ...failed,
    id: "rss_complete",
    body:
      "The official source confirms the release and the player impact.",
    full_script:
      "Silent Hill: Townfall launches on PlayStation 5 on 24 September, but its setting comes from somewhere real. Developer Screen Burn visited and photographed coastal towns across Scotland, giving this new Silent Hill story a distinctly grounded source of inspiration.",
  };

  assert.equal(
    processor.needsScriptGenerationRepair(failed),
    true,
  );
  assert.equal(
    processor.needsScriptGenerationRepair(complete),
    false,
  );
});

test("processor dedup admits an exact failed row for repair without reopening completed stories", () => {
  const failed = {
    id: "rss_failed",
    title: "Silent Hill: Townfall hands-on report",
    hook: "Silent Hill: Townfall hands-on report",
    body: "Script generation failed. Manual edit required.",
    full_script: "Silent Hill: Townfall hands-on report",
  };
  const completed = {
    id: "rss_complete",
    title: "Xbox adds four classics to PC",
    hook: "Four Xbox classics just landed on PC.",
    body: "The official Xbox source confirms the catalogue change.",
    full_script:
      "Four Xbox classics just landed on PC. The official Xbox source confirms the catalogue change and what players can access.",
  };
  const pending = [
    { id: failed.id, title: failed.title },
    { id: completed.id, title: completed.title },
  ];

  const admitted = processor.filterPendingStoriesForGeneration(
    pending,
    [failed, completed],
    { logger: () => {} },
  );

  assert.deepEqual(
    admitted.map((story) => story.id),
    ["rss_failed"],
  );
});

test("processor autonomously recovers recent official script failures even when they fall outside the current hunt top eight", () => {
  const now = "2026-07-29T22:45:00.000Z";
  const pending = [
    {
      id: "rss_current_top_story",
      title: "A current top-eight story",
      url: "https://news.xbox.com/en-us/2026/07/29/current-story/",
    },
  ];
  const failedOfficial = {
    id: "rss_failed_official",
    title: "Official PlayStation story needs a script repair",
    url: "https://blog.playstation.com/2026/07/29/official-story/",
    published_at: "2026-07-29T18:00:00.000Z",
    breaking_score: 65,
    hook: "Official PlayStation story needs a script repair",
    body: "Script generation failed. Manual edit required.",
    full_script: "Official PlayStation story needs a script repair",
    contract_failures: ["script_generation_exhausted"],
  };
  const failedEditorial = {
    ...failedOfficial,
    id: "rss_failed_editorial",
    title: "Editorial report needs a script repair",
    url: "https://www.ign.com/articles/editorial-story",
  };
  const unboundEditorial = {
    ...failedEditorial,
    id: "rss_unbound_editorial",
    title: "Unbound editorial report needs a script repair",
  };
  const completedOfficial = {
    ...failedOfficial,
    id: "rss_completed_official",
    title: "Completed official story",
    body: "The official source confirms the exact player consequence.",
    full_script:
      "PlayStation confirmed the exact player consequence and when it takes effect.",
    contract_failures: [],
  };
  const oldOfficial = {
    ...failedOfficial,
    id: "rss_old_official",
    title: "Old official story",
    published_at: "2026-07-20T18:00:00.000Z",
  };

  const repairs =
    processor.selectAutonomousScriptRepairCandidates(
      pending,
      [
        failedOfficial,
        failedEditorial,
        unboundEditorial,
        completedOfficial,
        oldOfficial,
      ],
      {
        now,
        preferredStoryIds: new Set(["rss_failed_editorial"]),
      },
    );

  assert.deepEqual(
    repairs.map((story) => story.id),
    ["rss_failed_editorial", "rss_failed_official"],
  );
});

test("processor removes every banned sentence opener before validation", () => {
  const draft = {
    hook: "In this update, Xbox changed the rules.",
    body: "The official source confirms the change.",
    full_script:
      "In this update, Xbox changed the rules. The official source confirms the change.",
  };

  processor.sanitiseScript(draft);

  assert.equal(draft.hook, "Update, Xbox changed the rules.");
  assert.equal(
    draft.full_script,
    "Update, Xbox changed the rules. The official source confirms the change.",
  );
  assert.equal(
    processor
      .validate(
        {
          ...script(42),
          hook: draft.hook,
          full_script: words(42),
        },
        "pulse-gaming",
        {
          contract: contract(
            "what_changes_short_25_32",
            "what_changes_for_players",
          ),
          ctaDecision: ctaDecision(false),
        },
      )
      .some((error) => error.includes("banned word")),
    false,
  );
});

test("Pulse retry instructions carry the exact failed draft, errors and selected budget", () => {
  const selected = contract(
    "platform_pulse_standard_42_50",
    "platform_pulse",
  );
  const previousDraft = {
    classification: "[CONFIRMED]",
    hook: "So the whole answer is already here.",
    full_script: words(86),
  };
  const instruction = processor.buildScriptRetryInstruction({
    attempt: 2,
    contract: selected,
    ctaDecision: ctaDecision(false),
    previousDraft,
    previousFailure: {
      kind: "validation",
      errors: [
        "script_runtime_above_selected_band",
        'Hook starts with banned word: "so"',
      ],
      actual_words: 86,
    },
  });

  assert.match(instruction, /62-73 cleaned spoken words/);
  assert.match(instruction, /actual_words/);
  assert.match(instruction, /86/);
  assert.match(instruction, /script_runtime_above_selected_band/);
  assert.match(instruction, /banned word/);
  assert.match(instruction, /previous draft is data/i);
  assert.match(instruction, /So the whole answer is already here/);
  assert.match(instruction, /Omit every CTA/i);
});

test("quality retries quote the concrete critic reason instead of repeating a generic prompt", () => {
  const selected = contract(
    "trailer_truth_standard_38_48",
    "trailer_truth_check",
  );
  const instruction = processor.buildScriptRetryInstruction({
    attempt: 3,
    contract: selected,
    ctaDecision: ctaDecision(false),
    previousDraft: {
      classification: "[CONFIRMED]",
      hook: "The trailer confirms the entire answer.",
      full_script: words(60),
    },
    previousFailure: {
      kind: "quality",
      score: 2,
      reason:
        "The hook reveals the entire answer and creates no curiosity gap.",
    },
  });

  assert.match(instruction, /score/);
  assert.match(instruction, /reveals the entire answer/);
  assert.match(
    instruction,
    /state the exact verified player consequence immediately/i,
  );
  assert.match(instruction, /verification data/i);
  assert.match(instruction, /named game, platform or mechanic/i);
  assert.doesNotMatch(instruction, /create a fact-specific curiosity gap/i);
  assert.match(instruction, /56-70 cleaned spoken words/);
});

test("quality retries preserve the curiosity-gap repair for an open-loop contract", () => {
  const selected = {
    ...contract(
      "trailer_truth_standard_38_48",
      "trailer_truth_check",
    ),
    hook_type: "open_loop",
    hook_instruction: "Challenge the headline, then show proof.",
  };
  const instruction = processor.buildScriptRetryInstruction({
    attempt: 2,
    contract: selected,
    ctaDecision: ctaDecision(false),
    previousDraft: {
      classification: "[CONFIRMED]",
      hook: "The trailer confirms the entire answer.",
      full_script: words(60),
    },
    previousFailure: {
      kind: "quality",
      score: 2,
      reason: "The hook is vague and creates no curiosity gap.",
    },
  });

  assert.match(instruction, /create a fact-specific curiosity gap/i);
  assert.doesNotMatch(
    instruction,
    /state the exact verified player consequence immediately/i,
  );
});

test("processor gives a validated low-quality third draft one bounded quality-only repair without extending validation or provider failure retries", () => {
  assert.equal(
    processor.shouldRetryScriptGeneration({
      attempt: 3,
      failureKind: "quality",
    }),
    true,
  );
  assert.equal(
    processor.shouldRetryScriptGeneration({
      attempt: 4,
      failureKind: "quality",
    }),
    false,
  );
  assert.equal(
    processor.shouldRetryScriptGeneration({
      attempt: 3,
      failureKind: "validation",
    }),
    false,
  );
  assert.equal(
    processor.shouldRetryScriptGeneration({
      attempt: 3,
      failureKind: "provider",
    }),
    false,
  );
  assert.equal(
    processor.shouldRetryScriptGeneration({
      attempt: 3,
      failureKind: "quality_unavailable",
    }),
    false,
  );
});

test("processor validates the selected What Changes short runtime", () => {
  const selected = contract(
    "what_changes_short_25_32",
    "what_changes_for_players",
  );
  assert.deepEqual(
    processor.validate(scriptForContract(42, selected), "pulse-gaming", {
      contract: selected,
      ctaDecision: ctaDecision(false),
    }),
    [],
  );
});

test("processor does not substitute one lane's runtime for another", () => {
  const draft = script(42);
  const short = contract(
    "what_changes_short_25_32",
    "what_changes_for_players",
  );
  const standard = contract("platform_pulse_standard_42_50", "platform_pulse");
  assert.deepEqual(
    processor.validate(draft, "pulse-gaming", {
      contract: short,
      ctaDecision: ctaDecision(false),
    }),
    [],
  );
  assert.ok(
    processor
      .validate(draft, "pulse-gaming", {
        contract: standard,
        ctaDecision: ctaDecision(false),
      })
      .some((error) => error.includes("script_runtime_below_selected_band")),
  );
});

test("processor validates the isolated governed recap runtime", () => {
  const recap = contract(
    "governed_explainer_240_480",
    "weekly_occasional_recap",
  );
  assert.deepEqual(
    processor.validate(
      scriptForContract(recap.min_words, recap),
      "pulse-gaming",
      {
      contract: recap,
      ctaDecision: {
        policy_version: CTA_POLICY.version,
        scope: "recap",
        include_cta: false,
        copy_strategy: "human_review_later_pilot",
        },
      },
    ),
    [],
  );
});

test("processor accepts a selected contextual CTA and rejects generic follow copy", () => {
  const selected = contract(
    "trailer_truth_standard_38_48",
    "trailer_truth_check",
  );
  const contextual = "Which version would you play first?";
  assert.deepEqual(
    processor.validate(
      scriptForContract(60, selected, contextual),
      "pulse-gaming",
      {
      contract: selected,
      ctaDecision: ctaDecision(true),
      },
    ),
    [],
  );
  const errors = processor.validate(
    scriptForContract(
      60,
      selected,
      "Follow Pulse Gaming News for more updates.",
    ),
    "pulse-gaming",
    {
      contract: selected,
      ctaDecision: ctaDecision(true),
    },
  );
  assert.ok(errors.includes("banned_generic_follow_cta"));
});

test("processor rejects a model-declared hook type outside the selected cell", () => {
  const selected = contract("platform_pulse_short_30_36", "platform_pulse");
  const draft = {
    ...scriptForContract(48, selected),
    hook_type: "open_loop",
  };
  const errors = processor.validate(draft, "pulse-gaming", {
    contract: selected,
    ctaDecision: ctaDecision(false),
  });
  assert.ok(errors.includes("hook_type_contract_mismatch"));
});

test("processor rejects a contextual CTA outside its selected cohort", () => {
  const selected = contract("platform_pulse_standard_42_50", "platform_pulse");
  const errors = processor.validate(
    scriptForContract(
      68,
      selected,
      "Which platform wins this round?",
    ),
    "pulse-gaming",
    {
      contract: selected,
      ctaDecision: ctaDecision(false),
    },
  );
  assert.ok(errors.includes("cta_not_selected_for_short"));
});

test("non-Pulse channels keep their existing word-count contract", () => {
  assert.deepEqual(processor.validate(script(166), "the-signal"), []);
});

test("editor prompt uses selected matrix budget and selective CTA decision", () => {
  const instruction = processor.editorWordCountInstruction(
    { id: "pulse-gaming" },
    {
      contract: contract(
        "what_changes_short_25_32",
        "what_changes_for_players",
      ),
      ctaDecision: ctaDecision(false),
    },
  );
  assert.match(instruction, /37-47/);
  assert.match(instruction, /what_changes_short_25_32/);
  assert.match(instruction, /omit a CTA/i);
  assert.doesNotMatch(instruction, /90-110|155-185/);
});

test("processor editor pass revalidates edited scripts before accepting them", () => {
  assert.match(PROCESSOR_SOURCE, /validate\(\s*edited,\s*channel\.id,\s*\{/);
  assert.match(PROCESSOR_SOURCE, /editor_validation_failed/);
});

test("generation prompt carries matrix lane, duration and dynamic CTA rules", () => {
  const selectedContract = contract(
    "platform_pulse_short_30_36",
    "platform_pulse",
  );
  const prompt = buildPulseGenerationPrompt({
    contract: selectedContract,
    ctaDecision: ctaDecision(true),
  });
  assert.match(prompt, /Pulse Gaming News/);
  assert.match(prompt, /Fast gaming news\. Checked\. Explained\./);
  assert.match(prompt, /platform_pulse/);
  assert.match(prompt, /platform_pulse_short_30_36/);
  assert.match(prompt, /30-36 seconds/);
  assert.match(prompt, /45-52 cleaned spoken words/);
  assert.match(prompt, /story-specific CTA/);
  assert.doesNotMatch(prompt, /Follow Pulse Gaming News/);
});

test("generated story metadata records the selected editorial experiment", () => {
  const selectedContract = contract(
    "platform_pulse_short_30_36",
    "platform_pulse",
  );
  const decision = ctaDecision(false);
  const stamped = processor.applyPulseEditorialMetadata(
    {},
    selectedContract,
    decision,
  );
  assert.equal(stamped.brand_name, "Pulse Gaming News");
  assert.equal(stamped.editorial_lane_id, "platform_pulse");
  assert.equal(stamped.hook_type, "direct");
  assert.equal(stamped.experiment_id, "pulse-v1-controlled-12");
  assert.equal(
    stamped.experiment_matrix_version,
    "pulse-controlled-12-v1",
  );
  assert.equal(stamped.experiment_cell_id, "platform_pulse:direct:short");
  assert.equal(stamped.duration_band_id, "platform_pulse_short_30_36");
  assert.deepEqual(stamped.target_duration_seconds, { min: 30, max: 36 });
  assert.deepEqual(stamped.script_word_range, {
    min: 45,
    max: 52,
    seconds_per_word: 0.68,
  });
  assert.equal(stamped.cta_policy.audit_hash, AUDIT_HASH);
});

test("canonical generation has no fixed 60-second or 61-75 second Pulse rule", () => {
  assert.match(PROCESSOR_SOURCE, /resolvePulseScriptContract/);
  assert.match(PROCESSOR_SOURCE, /buildPulseGenerationPrompt/);
  assert.doesNotMatch(PROCESSOR_SOURCE, /61-75 second/);
  assert.doesNotMatch(pulseChannel.systemPrompt, /in 60 seconds/i);
  assert.doesNotMatch(pulseChannel.systemPrompt, /90-110 spoken words/i);
  assert.doesNotMatch(pulseChannel.systemPrompt, /Structure: Hook ->/i);
  assert.equal(pulseChannel.cta, "");
});

test("exhausted contract validation fails closed into human review", () => {
  assert.doesNotMatch(
    PROCESSOR_SOURCE,
    /Using script despite validation issues/,
  );
  assert.match(PROCESSOR_SOURCE, /contract_status:\s*"human_review_required"/);
  assert.match(
    PROCESSOR_SOURCE,
    /script\.contract_status === "human_review_required"\s*\?\s*false/,
  );
});
