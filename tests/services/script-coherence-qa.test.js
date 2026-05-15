"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  runScriptCoherenceQa,
} = require("../../lib/script-coherence-qa");

test("script coherence does not double-count hook/body/loop mirrored in full_script", () => {
  const story = {
    title: "Capcom confirms more sequels and remakes are on the table",
    source_type: "rss",
    subreddit: "Eurogamer",
    hook: "Capcom just put seven dormant franchises back on the table.",
    body:
      "In a new investor update, Capcom named Mega Man, Dragon's Dogma, Ace Attorney, Onimusha, Dead Rising, Okami and Devil May Cry as properties it wants to keep using. That does not confirm one specific sequel today, but it does show the company is actively treating its older catalogue as a growth plan.",
    loop:
      "The big takeaway is simple: Capcom is not done with its classics.",
    cta: "Follow Pulse Gaming so you never miss a beat",
    full_script:
      "Capcom just put seven dormant franchises back on the table. In a new investor update, Capcom named Mega Man, Dragon's Dogma, Ace Attorney, Onimusha, Dead Rising, Okami and Devil May Cry as properties it wants to keep using. That does not confirm one specific sequel today, but it does show the company is actively treating its older catalogue as a growth plan. The big takeaway is simple: Capcom is not done with its classics. Follow Pulse Gaming so you never miss a beat.",
  };

  const qa = runScriptCoherenceQa(story, {
    requireCtaField: true,
    requireFullScriptCta: true,
  });

  assert.equal(qa.result, "pass", qa.failures.join(", "));
});

test("script coherence still catches true repeated sentences inside full_script", () => {
  const repeated = "Capcom named Mega Man and Ace Attorney in the same investor update.";
  const qa = runScriptCoherenceQa(
    {
      title: "Capcom confirms catalogue plans",
      source_type: "rss",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script: `${repeated} ${repeated} That makes the plan specific enough to watch. Follow Pulse Gaming so you never miss a beat.`,
    },
    {
      requireCtaField: true,
      requireFullScriptCta: true,
    },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.some((failure) => failure.startsWith("script_coherence:repeated_sentence")),
    qa.failures.join(", "),
  );
});

test("script coherence requires the spoken script itself to contain the exact CTA", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Nintendo confirms Switch 2 bundle",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Nintendo confirmed the bundle and named the launch window. The key detail is the price, because it changes the value calculation for early buyers.",
    },
    { requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:missing_exact_cta_in_script"),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("script coherence blocks invented verified-insider framing, even on rumour subreddits", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Capcom lists several franchises in an investor presentation",
      source_type: "reddit",
      subreddit: "GamingLeaksAndRumours",
      flair: "Rumour",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Capcom just named seven legacy series in one investor presentation. A verified insider claims developers have not slept in years, which sounds dramatic but is not in the source. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:unsupported_verified_insider_framing"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks Reddit top comments being turned into source facts", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Capcom lists several franchises in an investor presentation",
      source_type: "reddit",
      subreddit: "GamingLeaksAndRumours",
      top_comment: "Sources say capcom developers haven't seen a bed in 5 years",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Capcom listed Mega Man, Dragon's Dogma and Ace Attorney in its investor presentation. Sources say Capcom developers have not seen a bed in five years, fuelling speculation. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:top_comment_used_as_fact"),
    qa.failures.join(", "),
  );
});

test("script coherence does not treat RSS description reuse as Reddit-comment sourcing", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Nintendo confirms a new bundle",
      source_type: "rss",
      subreddit: "Nintendo",
      top_comment: "Nintendo confirmed the bundle includes Mario Kart World.",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Nintendo confirmed the bundle includes Mario Kart World. That makes the offer concrete, not speculation. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "pass", qa.failures.join(", "));
});

test("script coherence blocks abstract Pulse signal language and orphan entity contamination", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Lord of the Rings MMO Reportedly Canceled",
      source_type: "reddit",
      subreddit: "pcgaming",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "According to sources, the Lord of the Rings MMO is dead, and Lara's future looks uncertain. For players, the safest read is signal first, certainty later. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:abstract_signal_language"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:orphan_entity_contamination:lara"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks vague sources on general Reddit rows", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Lord of the Rings MMO Reportedly Canceled",
      source_type: "reddit",
      subreddit: "pcgaming",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "According to sources, the Lord of the Rings MMO is reportedly cancelled. Amazon has not confirmed the exact status. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:vague_sources_on_general_reddit"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks verified Reddit posts and Redditors as factual sources", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Subnautica 2 sales are moving quickly",
      source_type: "reddit",
      subreddit: "pcgaming",
      article_url: "https://aftermath.site/subnautica-2-units-sold-250-million-bonus-krafton/",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "According to a verified Reddit post, Subnautica 2 has already triggered a massive payout story. One Redditor thinks Krafton is about to pay the whole bonus. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:verified_reddit_post_as_source"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:redditor_as_source_fact"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks hedged stories being overclaimed as confirmed payouts", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Sure Seems Like Subnautica 2’s Developers Are Going To Get Their $250 Million Bonus",
      source_type: "reddit",
      subreddit: "pcgaming",
      article_url: "https://aftermath.site/subnautica-2-units-sold-250-million-bonus-krafton/",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Krafton just paid out $250 million for Subnautica 2, and that is now confirmed. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:hedged_story_overclaimed"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks generic uncertainty boilerplate and internal Pulse framing", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Subnautica 2 has been officially released in Early Access",
      source_type: "reddit",
      subreddit: "Games",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Subnautica 2 is officially in Early Access. The important point is the direction of travel, not just the headline itself. The next thing to watch is whether an official post, platform listing or patch note backs it up. For Pulse, that means tracking the official follow-up before calling it a guaranteed change. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:generic_uncertainty_boilerplate"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:internal_pulse_framing"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks broader internal signal and tracking language", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Subnautica 2 sales are moving quickly",
      source_type: "rss",
      subreddit: "GameSpot",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Subnautica 2 is moving quickly, but the safest takeaway is signal over certainty. We are tracking confirmation before calling it the final number. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:abstract_signal_language"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:internal_tracking_language"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks false bill ownership and mangled campaign names", () => {
  const qa = runScriptCoherenceQa(
    {
      title:
        "California bill backed by Stop Killing Games campaign passes key hurdle",
      source_type: "rss",
      subreddit: "Rock Paper Shotgun",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Ubisoft's AB 1921 just passed a key committee vote, and the Stop ending Games campaign is pushing it forward. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:false_bill_ownership"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes(
      "script_coherence:mangled_stop_killing_games_campaign",
    ),
    qa.failures.join(", "),
  );
});
