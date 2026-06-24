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

test("viral script intelligence rejects abstract title-test narration before TTS", () => {
  const script =
    "Halo Campaign Evolved's remake debate finally has a real stress test. " +
    "Xbox Wire says Halo Studios showed Assault on the Control Room hands-on. " +
    "This mission is where nostalgia turns into chaos or expensive cosplay. " +
    "The remake launches July 28, with early access July 23 for Premium Edition owners. " +
    "Cross-play and cross-progression put Xbox, PC, Steam and PlayStation players in the same conversation. " +
    "The catch is simple. " +
    "Are vehicles, co-op and enemy encounters still carrying the memory, or is this sharper scenery? " +
    "If Assault on the Control Room still erupts, this is a remake. " +
    "If it only looks cleaner, it is a museum piece. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "halo-abstract-test",
      title: "Halo: Campaign Evolved Shows The Real Remake Test",
      source_name: "Xbox Wire",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required");
  assert.ok(result.blockers.includes("generic_catch_is_simple"), JSON.stringify(result));
  assert.ok(result.blockers.includes("abstract_title_test_hook"), JSON.stringify(result));
  assert.ok(result.blockers.includes("missing_early_concrete_source_detail"), JSON.stringify(result));
});

test("viral script intelligence approves concrete gameplay-first rewrite", () => {
  const script =
    "Halo's remake has one brutal test: Assault on the Control Room. " +
    "Xbox Wire played the new version ahead of its July 28 launch, and this is not just a prettier snow level. " +
    "The original mission worked because the sandbox kept breaking open: Scorpion tanks, Banshees, Marines, Covenant ambushes and long Forerunner corridors. " +
    "The remake is cutting some repetition, giving Marines proper tank support and building around modern co-op across Xbox, PC and PlayStation. " +
    "That is where fans will split. " +
    "If the chaos still feels player-made, Halo: Campaign Evolved is a real remake. " +
    "If it only looks cleaner, it is a museum piece with better lighting. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "halo-concrete-rewrite",
      title: "Halo: Campaign Evolved Shows The Real Remake Test",
      source_name: "Xbox Wire",
    },
    script,
  });

  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
  assert.ok(result.viral_score >= 85, JSON.stringify(result.scores));
  assert.deepEqual(result.blockers, []);
});

test("viral script intelligence accepts concrete horror gameplay stakes", () => {
  const script =
    "Alien: Isolation 2 has one brutal test: can it still make you wait? " +
    "Xbox Wire played the prologue and says the demo leans on Xenomorph pressure, stealth and the moment where moving too early feels like your mistake. " +
    "That is the whole trick. " +
    "Better lighting means nothing if the creature feels scripted. " +
    "Fans need to believe it heard them, changed route and ruined a plan they thought was safe. " +
    "If the sequel keeps that doubt alive, Creative Assembly has a horror comeback. " +
    "If players spot the pattern, the nightmare turns into a route guide. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "alien-isolation-2-horror-risk",
      title: "Alien Isolation 2 Has One Horror Risk",
      source_name: "Xbox Wire",
    },
    script,
  });

  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
  assert.ok(result.viral_score >= 85, JSON.stringify(result.scores));
  assert.deepEqual(result.blockers, []);
});

test("viral script intelligence accepts Steam demo stakes when player choice is explicit", () => {
  const script =
    "Steam Next Fest is the moment a PC game stops hiding behind trailers. " +
    "From June 15 to 22, Valve is putting demos in players' hands, and that changes the stakes fast. " +
    "A demo exposes what marketing can dodge: controls, performance, tutorials and whether the first mechanic feels good. " +
    "For a small studio, one strong demo can turn wishlists into word of mouth. " +
    "A clumsy opening can make players forget the game before reviews even land. " +
    "So should developers show an unfinished slice and risk the backlash, or stay quiet until launch? " +
    "If players try several demos and remember yours, you have already won the week. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "steam-next-fest-demo-stakes",
      title: "Steam Next Fest Turns Demos Into A Trust Fight",
      source_name: "Steam",
    },
    script,
  });

  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
  assert.ok(result.viral_score >= 85, JSON.stringify(result.scores));
  assert.deepEqual(result.blockers, []);
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

test("viral script intelligence rejects public narration that says internal hook or signal labels aloud", () => {
  const script =
    "Nintendo's next Direct has one problem it cannot trailer around. " +
    "VGC reports Nintendo is preparing a June showcase with Switch 2 software still thin after launch. " +
    "The hook here is that players need a reason to keep the new hardware in the dock. " +
    "The signal is whether Nintendo shows playable dates instead of another logo reel. " +
    "That gives fans something to argue about before the next preorder wave. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "nintendo-internal-labels",
      title: "Nintendo Direct Needs A Switch 2 Answer",
      source_name: "VGC",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("producer_scaffold_language"), JSON.stringify(result));
  assert.ok(result.blockers.includes("internal_audience_scaffold"), JSON.stringify(result));
  assert.ok(result.rewrite_recommendations.some((item) => /producer-note/i.test(item)));
});

test("viral script intelligence rejects persuasive authority tropes masquerading as insight", () => {
  const script =
    "Game Pass just got a bigger problem than price. " +
    "The Verge reports Microsoft is reshuffling day-one messaging around several Xbox releases. " +
    "The real question is whether subscribers still trust the promise. " +
    "At its core, this is about the future of Xbox's value proposition. " +
    "What really matters is whether players feel the service still respects their time. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "game-pass-authority-tropes",
      title: "Game Pass Messaging Has A Trust Problem",
      source_name: "The Verge",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("persuasive_authority_trope"), JSON.stringify(result));
  assert.ok(result.scores.insight_density < 70, JSON.stringify(result.scores));
});

test("viral script intelligence rejects source-neutral catch templates that could fit any story", () => {
  const script =
    "Crimson Desert is past the trailer hype, and the risk is the real build. " +
    "GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. " +
    "The catch is whether players get a concrete next step, or just another vague update. " +
    "But now the shipped build has to carry the spectacle: combat, performance and scale, not just trailer shots. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "crimson-generic-catch",
      title: "Crimson Desert Is Already Live",
      source_name: "GameSpot",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("source_neutral_catch_template"), JSON.stringify(result));
  assert.ok(result.scores.curiosity_gap < 70, JSON.stringify(result.scores));
});

test("viral script intelligence rejects raw article-title recitation as narration", () => {
  const script =
    "Forza Horizon 6 just landed strong reviews, but the catch is launch demand. " +
    "PC Gamer reports Forza Horizon 6 review (PC Gamer: 84/100). " +
    "The catch is whether that score still means as much once the wider player base arrives. " +
    "That means fence-sitters get a cleaner signal, but review scores still do not prove the wider launch holds. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "forza-raw-title-recitation",
      title: "Forza Horizon 6 Scores 84 On PC Gamer",
      source_name: "PC Gamer",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("source_title_recitation"), JSON.stringify(result));
  assert.ok(result.blockers.includes("repeated_catch_pivot"), JSON.stringify(result));
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

test("viral script intelligence treats ASR-spaced source names as present", () => {
  const result = buildViralScriptIntelligence({
    story: {
      id: "gta-free-upgrade",
      title: "GTA 5 Has A Free Upgrade Catch",
      source_name: "GameSpot",
    },
    script:
      "GTA 5's paid current gen upgrade is suddenly free for the players most likely to miss it. " +
      "Game Spot reports digital PlayStation 4 and Xbox One owners can claim the PlayStation 5 and Xbox Series X and S version from June 18. " +
      "That matters because this is the native version, with better graphics and faster loading, not just backward compatibility. " +
      "The catch is eligibility: if your old copy is not covered, the free headline does not help. " +
      "Rockstar is moving old players forward before July's next online heist, and paying twice is exactly the mistake this story should prevent. " +
      "The argument is obvious: generous upgrade, or a quiet way to refill G T A Online before the next heist? " +
      "If the free claim brings lapsed owners back, Rockstar turns an old upgrade fee into a retention play instead of a simple gift. " +
      "Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(result.scores.source_safety, 86);
  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
  assert.ok(result.viral_score >= 85, JSON.stringify(result.scores));
});

test("viral script intelligence recognises subscription runway stories as high-value debate scripts", () => {
  const script =
    "GTA 5 just became the GTA 6 waiting room. " +
    "GameSpot reports GTA 5 has joined a subscription service ahead of GTA 6. " +
    "That is the useful bit: Rockstar can keep old players close without asking everyone to buy the same game again. " +
    "For lapsed players, subscription access lowers the friction. " +
    "For Take-Two, it keeps Los Santos active while the sequel owns the calendar. " +
    "The catch is that subscription libraries move, so this is access, not ownership. " +
    "That is the argument: jump back into Los Santos now, or wait for GTA 6 to make the return feel new. " +
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

test("viral script intelligence rejects polished but vague update narration", () => {
  const script =
    "RuneScape Dragonwilds is getting one last chance to win back Early Access players. " +
    "Rock Paper Shotgun says the survival spin-off has another major update coming later this month before full launch. " +
    "The risk is practical. " +
    "Survival games are not judged by patch notes. " +
    "They are judged when chopping, crafting and fighting either clicks, or starts feeling like homework. " +
    "It has to prove this is a RuneScape game people can actually main, not a side experiment they sample for one weekend. " +
    "If the rhythm feels sharper, launch day has a foundation. " +
    "If it does not, full launch starts by asking players to trust it again. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "dragonwilds-vague-update",
      title: "Dragonwilds Has One Last Early Access Test",
      source_name: "Rock Paper Shotgun",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("vague_update_without_concrete_proof"), JSON.stringify(result));
  assert.ok(result.blockers.includes("soft_payoff_language"), JSON.stringify(result));
});

test("viral script intelligence rejects generic fallback watchlist sludge", () => {
  const script =
    "Over Hill's Next Fest demo just picked up a player-facing detail worth watching. " +
    "PC Gamer says Over the Hill's Next Fest demo promises a stylized off-roading game for people who actually like to drive. " +
    "The important bit is whether this changes what people buy, play, wait for or skip. " +
    "That is the gap to watch now: hype is easy, but the player consequence has to show up on screen. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "over-hill-template-sludge",
      title: "Over Hill's Next Fest Demo Deal Has One Catch",
      source_name: "PC Gamer",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("generic_fallback_watchlist_language"), JSON.stringify(result));
});

test("viral script intelligence rejects vague platform-source attribution and HTML entities", () => {
  const script =
    "Hades II has the one kind of reveal fans cannot hand-wave: actual play. " +
    "YouTube says Hades II - Xbox &amp; PlayStation Trailer. " +
    "Players can finally judge the specifics on screen: camera distance, attack timing and whether fights stay readable when they get busy. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "hades-youtube-says",
      title: "Hades II Just Broke PlayStation's Silence",
      source_name: "YouTube",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("vague_source_attribution"), JSON.stringify(result));
  assert.ok(result.blockers.includes("html_entity_in_public_script"), JSON.stringify(result));
});

test("viral script intelligence rejects ungrounded speculative source phrasing", () => {
  const script =
    "PlayStation's about to make your PS5 look like a bargain. " +
    "Sources suggest Sony is planning another price hike across Europe in the coming months. " +
    "The timing is curious given mid-gen refresh rumours and console market pressure. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "playstation-sources-suggest",
      title: "PlayStation Just Got More Expensive",
      source_name: "Reddit",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("ungrounded_speculative_attribution"), JSON.stringify(result));
  assert.ok(result.blockers.includes("vague_source_attribution"), JSON.stringify(result));
});

test("viral script intelligence rejects generated placeholder title templates", () => {
  const script =
    "Forza Horizon 6 should stay in review until it has a sharper player consequence. " +
    "GameSpot says Forza Horizon 6 Signals A New Peak For Open World Driving Games. " +
    "The source is real, but the angle does not yet have a must-watch player consequence. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "forza-placeholder-title",
      title: "Forza Horizon 6 Just Got A New Signal",
      source_name: "GameSpot",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("generic_title_template"), JSON.stringify(result));
});

test("viral script intelligence rejects generic player-test fallback templates", () => {
  const script =
    "Invincible VS has one clear detail players can check before the hype gets ahead of it. " +
    "IGN says the new trailer shows another look at the roster. " +
    "The player test is simple: does this change what people install, wishlist, finish or ignore? " +
    "If it changes that decision, the story earns attention. If it does not, it is background noise. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "invincible-generic-fallback",
      title: "Why Invincible VS Could Split Players",
      source_name: "IGN",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("generic_player_test_template"), JSON.stringify(result));
  assert.ok(result.blockers.includes("generic_could_split_title_template"), JSON.stringify(result));
});

test("viral script intelligence rejects article-fragment subjects as narration hooks", () => {
  const script =
    "Hide-and-seek game where you paint just blinked in one of the year's most crowded release windows. " +
    "PCGamer says the body-paint stealth game sold a million copies in four days. " +
    "The argument is whether that sudden spike turns into an actual player base. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "article-fragment-subject",
      title: "Hide-and-seek game where you paint your body to blend in sells a million copies in four days",
      source_name: "PCGamer",
    },
    script,
  });

  assert.equal(result.verdict, "rewrite_required", JSON.stringify(result, null, 2));
  assert.ok(result.blockers.includes("title_fragment_subject_language"), JSON.stringify(result));
});

test("viral script intelligence approves update scripts with concrete player-visible proof", () => {
  const script =
    "RuneScape Dragonwilds has one last chance to prove its survival loop is not homework. " +
    "Rock Paper Shotgun says the next Early Access update is adding the heat system players have been waiting on before 1.0. " +
    "That is not just balance polish; it changes how long you can push into dangerous zones before crafting stops being a menu and starts becoming a survival problem. " +
    "The argument is whether Dragonwilds can feel like a real RuneScape main game, or just a familiar name wrapped around another tree-punching loop. " +
    "If the heat update makes exploration riskier without slowing everything down, launch suddenly has a reason to pull lapsed players back. " +
    "If it does not, 1.0 starts with a trust problem. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "dragonwilds-concrete-update",
      title: "Dragonwilds Has One Last Early Access Test",
      source_name: "Rock Paper Shotgun",
    },
    script,
  });

  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
  assert.ok(result.viral_score >= 85, JSON.stringify(result.scores));
  assert.deepEqual(result.blockers, []);
});

test("viral script intelligence approves save-loss patch scripts with concrete player stakes", () => {
  const script =
    "Forza Horizon 6 has the kind of bug players do not forgive quickly. " +
    "Eurogamer says players are being told to apply a new patch to avoid losing save data and progress. " +
    "That is bigger than a normal hotfix because progress loss attacks the one thing racing games ask for most: time. " +
    "The useful test is simple. If the patch stops the wipe, this becomes a scary week. " +
    "If it does not, every garage, tune and rare unlock feels less safe. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const result = buildViralScriptIntelligence({
    story: {
      id: "forza-save-loss",
      title: "Forza Horizon 6 Has A Save-Wipe Warning",
      source_name: "Eurogamer",
    },
    script,
  });

  assert.equal(result.verdict, "viral_ready", JSON.stringify(result, null, 2));
  assert.ok(result.viral_score >= 75, JSON.stringify(result.scores));
  assert.deepEqual(result.blockers, []);
});
