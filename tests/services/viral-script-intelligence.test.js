"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildViralScriptIntelligence,
} = require("../../lib/viral-script-intelligence");

const STORY = {
  id: "forza-viral-script",
  title: "Forza Horizon 6 Hits 92 on Metacritic, Steam Numbers Skyrocket",
  source_name: "Twisted Voxel",
};

test("viral script intelligence rejects boring recap, repeated hook wording and duplicate CTA", () => {
  const draft =
    "Forza Horizon 6 Hits 92 on Metacritic, Steam Numbers Skyrocket. " +
    "Forza Horizon 6 Hits 92 on Metacritic, Steam Numbers Skyrocket. " +
    "Twisted Voxel reports a source-backed update with a 92 aggregate and 178,009 SteamDB concurrent users. " +
    "The useful detail is the review-score framing and the broader launch data. " +
    "So the clean read is this: Forza has critic momentum, but the final verdict needs broader launch data. " +
    "Follow Pulse Gaming so you never miss a beat. Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: STORY,
    script: draft,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.blockers.includes("weak_hook_repeats_headline"));
  assert.ok(result.blockers.includes("duplicated_cta"));
  assert.ok(result.blockers.includes("boring_recap_language"));
  assert.ok(result.scores.hook_strength < 55);
  assert.ok(result.scores.curiosity_gap < 60);
  assert.ok(
    result.rewrite_recommendations.some((item) =>
      /paid-access contradiction|contradiction/i.test(item),
    ),
  );
  assert.ok(result.prompt_directives.some((item) => /CTA once/i.test(item)));
});

test("viral script intelligence approves a source-safe angle with concrete numbers and one CTA", () => {
  const script =
    "Forza just gave Xbox the headline it badly needed. " +
    "Twisted Voxel says Forza Horizon 6 now has a 92 Metacritic aggregate, ahead of Pokemon Pokopia at 89, while SteamDB shows 178,009 concurrent users. " +
    "But the number has a catch: that spike came during Premium Edition early access, around $120 before the standard launch. " +
    "That means critics are not the only early audience reacting, but it still is not full demand yet. " +
    "If the wider launch holds, this becomes Xbox's cleanest first-party win of the year. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: STORY,
    script,
  });

  assert.equal(result.verdict, "viral_ready");
  assert.ok(result.viral_score >= 85);
  assert.ok(result.scores.hook_strength >= 85);
  assert.ok(result.scores.insight_density >= 80);
  assert.equal(result.fact_lock.numeric_claims.includes("178,009"), true);
  assert.equal(result.fact_lock.numeric_claims.includes("$120"), true);
  assert.equal(result.fact_lock.bad_numeric_spellouts.includes("120 DOLLARS"), false);
  assert.equal(result.cta.count, 1);
});

test("viral script intelligence accepts sharp non-numeric gameplay stories with proof and player impact", () => {
  const script =
    "The Expanse: Osiris Reborn finally has the thing licensed games usually hide: real gameplay. " +
    "Xbox showed a narrative sci-fi action game built around The Expanse universe, not just a logo and a promise. " +
    "That matters because players can now judge the combat, world and Mass Effect-style pitch. " +
    "But the catch is brutal: a famous licence only helps if the game actually feels worth playing. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "expanse-gameplay",
      title: "The Expanse Game Finally Looks Real",
      source_name: "Xbox",
    },
    script,
  });

  assert.notEqual(result.verdict, "rewrite_required");
  assert.ok(result.viral_score >= 75);
  assert.ok(result.scores.insight_density >= 70);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.cta.count, 1);
});

test("viral script intelligence scores review-spread curiosity beats above the publish threshold", () => {
  const script =
    "Forza Horizon 6 just landed a strong PC Gamer review. " +
    "PC Gamer reports Forza Horizon 6 review at 84 out of 100. " +
    "Strong reviews matter here because this is when fence-sitters decide whether another Horizon is enough. " +
    "The number is only the opening beat; repeated praise or complaints across outlets matter more. " +
    "One high score can hide split opinions, but a steady spread says the reception is harder to dismiss. " +
    "Until players have it, this is a strong signal, not a final verdict. " +
    "That is what makes the score matter to players instead of becoming chart noise. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "forza-review-spread",
      title: "Forza Horizon 6 Scores 84 On PC Gamer",
      source_name: "PC Gamer",
    },
    script,
  });

  assert.notEqual(result.verdict, "rewrite_required");
  assert.ok(result.scores.curiosity_gap >= 70, JSON.stringify(result.scores));
  assert.ok(!result.warnings.includes("no_curiosity_marker"), JSON.stringify(result));
  assert.deepEqual(result.blockers, []);
});

test("viral script intelligence scores platform-strategy curiosity beats above the publish threshold", () => {
  const script =
    "Forza Horizon 6 just turned its Steam launch into an Xbox signal. " +
    "Xbox reports Forza Horizon 6 is already being framed as a major Steam success for Xbox. " +
    "If Steam is where Forza takes off, Xbox has a different launch story on its hands. " +
    "Forza Horizon 6 is becoming an Xbox-on-Steam story, not just another racing launch. " +
    "That is the uncomfortable bit: the store where Xbox wins might not be Xbox. " +
    "Game Pass messaging, price and release timing are the pieces that could move around that attention. " +
    "If Microsoft leans into it, this becomes a distribution story as much as a game story. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "forza-steam-strategy",
      title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
      source_name: "Xbox",
    },
    script,
  });

  assert.notEqual(result.verdict, "rewrite_required");
  assert.ok(result.scores.curiosity_gap >= 70, JSON.stringify(result.scores));
  assert.ok(!result.warnings.includes("no_curiosity_marker"), JSON.stringify(result));
  assert.deepEqual(result.blockers, []);
});

test("viral script intelligence rejects generic reveal-catch template narration", () => {
  const script =
    "The Expanse: Osiris Reborn finally showed real gameplay. " +
    "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. " +
    "The catch is what matters after the reveal cut: whether the full mission flow can match it. " +
    "Now the camera, gunfights and scale are on screen instead of hidden behind a logo. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "generic-reveal-template",
      title: "The Expanse Shows Real Gameplay",
      source_name: "Xbox",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.blockers.includes("generic_reveal_catch_template"), JSON.stringify(result));
});

test("viral script intelligence produces a concise rewrite brief for the next script pass", () => {
  const draft =
    "Today, Forza Horizon 6 is making headlines. " +
    "Twisted Voxel says it has a 92 score and 178,009 Steam users. " +
    "This is a source-backed update for players. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: STORY,
    script: draft,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.prompt_directives.some((item) => /Open on/i.test(item)));
  assert.ok(result.prompt_directives.some((item) => /178,009/i.test(item)));
  assert.ok(result.prompt_directives.some((item) => /\$120/.test(item)));
  assert.ok(
    result.prompt_directives.every(
      (item) => !/\b(?:delve|crucial|showcase|underscore)\b/i.test(item),
    ),
  );
  assert.equal(result.safety.no_publishing_side_effects, true);
});

test("viral script intelligence rejects instruction-like buyer advice narration", () => {
  const script =
    "Boltgun 2 already feels loud in the new demo. " +
    "IGN reports Warhammer 40,000 Boltgun 2 takes the ultraviolent '90s FPS to the great outdoors. " +
    "The player angle is simple: check the price, access or platform details before you decide what to play next. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "boltgun-buyer-advice",
      title: "Boltgun 2 Already Feels Loud",
      source_name: "IGN",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.blockers.includes("instruction_like_buyer_advice"));
  assert.ok(result.rewrite_recommendations.some((item) => /story consequence/i.test(item)));
});

test("viral script intelligence rejects formulaic not-just hooks", () => {
  const script =
    "Hades 2 is not just leaving early access. " +
    "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. " +
    "The useful part is the console timing: PlayStation and Xbox players would land on the same day instead of waiting on a late port. " +
    "The catch is controller feel, because Hades lives or dies on dodge timing and clean combat reads. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "hades-not-just-hook",
      title: "Hades II Just Broke PlayStation's Silence",
      source_name: "Xbox",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.blockers.includes("formulaic_not_just_hook"));
  assert.ok(result.scores.hook_strength < 55);
  assert.ok(result.rewrite_recommendations.some((item) => /specific consequence/i.test(item)));
});

test("viral script intelligence treats source names as present despite casing differences", () => {
  const result = buildViralScriptIntelligence({
    story: {
      id: "mario-deal",
      title: "Super Mario RPG Drops To $15",
      source_name: "Gamestop",
    },
    script:
      "Super Mario RPG just dropped to $15 at GameStop. GameStop lists Super Mario RPG at $15, 70% off its listed price. The catch is what matters: platform, seller and timing can change the value before players act. For anyone who skipped the physical Switch copy, that is a real pickup point while the listing holds. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(result.scores.source_safety, 86);
  assert.notEqual(result.verdict, "rewrite_required");
});
