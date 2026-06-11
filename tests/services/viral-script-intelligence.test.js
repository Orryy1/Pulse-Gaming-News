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
    "Forza Horizon 6 just got the score Xbox needed before launch. " +
    "PC Gamer reports Forza Horizon 6 review at 84 out of 100. " +
    "That matters because review scores do not sell a racing game alone; they give hesitant players permission to care. " +
    "The catch is that an 84 still has to beat real player fatigue once the first weekend lands. " +
    "The debate is whether an 84 proves Horizon is still elite or just comfortably familiar. " +
    "If more outlets line up behind that score, Xbox gets a cleaner launch argument than another trailer could buy. " +
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

test("viral script intelligence rejects producer-scaffold language even when facts are sourced", () => {
  const script =
    "V Rising has a new sequel-sized problem. " +
    "IGN reports Stunlock Studios is working on a new game set in the V Rising universe while the original moves to balance and bug-fix support. " +
    "Here's what matters now: the support plan becomes part of the next game story. " +
    "Fans are no longer just asking about the next patch. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "v-rising-scaffold",
      title: "V Rising Studio Is Working On A New Game",
      source_name: "IGN",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.blockers.includes("producer_scaffold_language"), JSON.stringify(result));
  assert.ok(
    result.rewrite_recommendations.some((item) => /producer-note/i.test(item)),
    JSON.stringify(result.rewrite_recommendations),
  );
});

test("viral script intelligence rejects competent but hollow scripts without debate or payoff", () => {
  const script =
    "Super Mario RPG just dropped to $15 at GameStop. " +
    "GameStop lists Super Mario RPG at $15, 70% off its listed price. " +
    "Stock, platform and seller details can move fast. " +
    "For players, this is a useful deal to check while the listing holds. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "mario-deal-hollow",
      title: "Super Mario RPG Drops To $15",
      source_name: "GameStop",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.blockers.includes("missing_debate_trigger"), JSON.stringify(result));
  assert.ok(result.blockers.includes("missing_story_specific_payoff"), JSON.stringify(result));
});

test("viral script intelligence approves scripts with player stakes, argument and payoff", () => {
  const script =
    "V Rising fans just got sequel news with a nasty trade-off. " +
    "IGN reports Stunlock Studios is working on a new game set in the V Rising universe while the original moves to balance and bug-fix support. " +
    "That is exciting if you wanted the world to grow, but rough if you were waiting for another major content drop. " +
    "The real debate is whether this is smart studio focus or a quiet way of moving on from the game people already bought. " +
    "If the new project keeps V Rising's survival tension without abandoning current players, Stunlock has a universe instead of one hit. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "v-rising-world-class",
      title: "V Rising Studio Is Working On A New Game",
      source_name: "IGN",
    },
    script,
  });

  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
  assert.ok(result.viral_score >= 85, JSON.stringify(result.scores));
  assert.deepEqual(result.blockers, []);
});

test("viral script intelligence rejects repeated source recaps after the payoff", () => {
  const script =
    "Stranger Than Heaven just made its pitch harder to fake. " +
    "Xbox showed the Five Eras reveal during Xbox Partner Preview, and that is a bigger promise than another stylish trailer. " +
    "The catch is why those eras matter: each one has to change how you investigate, fight and move, or it becomes a costume swap. " +
    "The next gameplay cut needs proof, not just another beautiful decade jump. " +
    "Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview. " +
    "Five eras is a big promise: each one needs its own texture, pace and reason to exist, not just a costume change. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: { id: "stranger", title: "Stranger Than Heaven Shows Five Eras", source_name: "Xbox" },
    script,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.blockers.includes("duplicated_source_attribution"));
});

test("viral script intelligence rejects malformed source attribution and stale CTA", () => {
  const script =
    "Capturing Has One Player Question. " +
    "I reports Capturing mewtwo in the office shh pokemon red game boy color og. " +
    "The practical question is whether this changes what people buy, wishlist, reinstall or wait on. " +
    "Follow Pulse Gaming for the gaming stories behind the headline.";

  const result = buildViralScriptIntelligence({
    story: { id: "bad-capture", title: "Capturing Has One Player Question", source_name: "IGN" },
    script,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.blockers.includes("malformed_source_attribution"));
  assert.ok(result.blockers.includes("missing_exact_cta"));
});

test("viral script intelligence treats source names as present despite casing differences", () => {
  const result = buildViralScriptIntelligence({
    story: {
      id: "mario-deal",
      title: "Super Mario RPG Drops To $15",
      source_name: "Gamestop",
    },
    script:
      "Super Mario RPG just dropped to $15 at GameStop. GameStop lists Super Mario RPG at $15, 70% off its listed price. The trade-off is timing: physical Switch copies can vanish fast when a price cut turns into a rush. The debate is whether this is finally cheap enough to buy again, or still too late for players waiting on Switch 2. If the listing holds, GameStop has turned an old RPG into a real impulse-buy test. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(result.scores.source_safety, 86);
  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
});

test("viral script intelligence recognises subscription runway stories as high-value debate scripts", () => {
  const script =
    "GTA 5 just became the GTA 6 waiting room. " +
    "GameSpot reports GTA 5 has joined a subscription service ahead of GTA 6. " +
    "That is the useful bit: Rockstar can keep old players close without asking everyone to buy the same game again. " +
    "For lapsed players, subscription access lowers the friction. " +
    "For Take-Two, it keeps Los Santos active while the sequel owns the calendar. " +
    "The catch is that subscription libraries move, so this is access, not ownership. " +
    "The debate is simple: is this worth jumping back into, or are you better off waiting for GTA 6? " +
    "If people reinstall now, GTA 5 stops looking like old back catalogue and starts working like a warm-up act for GTA 6. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "gta-subscription-runway",
      title: "GTA 5 Joins A Subscription Ahead Of GTA 6 Launch",
      source_name: "GameSpot",
    },
    script,
  });

  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
  assert.ok(result.viral_score >= 85, JSON.stringify(result.scores));
  assert.ok(result.scores.insight_density >= 80, JSON.stringify(result.scores));
  assert.deepEqual(result.blockers, []);
});

test("viral script intelligence recognises anti-cheat trust stories as publishable when sourced", () => {
  const script =
    "Valorant's anti-cheat fight just got nastier. " +
    "PCGamesN reports Riot says Vanguard cannot brick a PC, but the update can block DMA cheat hardware. " +
    "That distinction matters because the scary claim is PC damage, while Riot is drawing a line between a broken computer and hardware used to bypass anti-cheat. " +
    "Kernel-level anti-cheat sits deep in Windows, so every heavy-handed update becomes bigger than one ban wave. " +
    "The actual split is cheat devices versus normal PCs; Riot needs to keep that line impossible to miss. " +
    "If Riot wants this to land cleanly, the next message has to explain exactly what Vanguard touches and what it cannot touch. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "valorant-vanguard-trust",
      title:
        "Valorant's new Vanguard update seems to be bricking cheaters' PCs",
      source_name: "PCGamesN",
    },
    script,
  });

  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
  assert.ok(result.viral_score >= 85, JSON.stringify(result.scores));
  assert.ok(result.scores.insight_density >= 80, JSON.stringify(result.scores));
  assert.deepEqual(result.blockers, []);
});
