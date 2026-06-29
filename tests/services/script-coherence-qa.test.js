"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  repeatedNumericClaims,
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

test("script coherence rejects the stale identity CTA", () => {
  const story = {
    title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    source_type: "rss",
    subreddit: "GameSpot",
    cta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    full_script:
      "Forza Horizon 6 just gave Xbox the Steam number it needed. SteamDB shows the paid early-access peak landed before the standard launch, which makes the number a demand signal rather than the final ceiling. Follow Pulse Gaming for the gaming stories behind the headline.",
  };

  const qa = runScriptCoherenceQa(story, {
    requireCtaField: true,
    requireFullScriptCta: true,
  });

  assert.equal(qa.result, "fail");
  assert.ok(qa.failures.includes("script_coherence:cta_not_exact"));
  assert.ok(qa.failures.includes("script_coherence:missing_exact_cta_in_script"));
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

test("script coherence catches repeated near-phrases inside one sentence", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Garfield Gameplay Trailer Shows Real Gameplay",
      source_type: "rss",
      subreddit: "IGN",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Garfield just showed real gameplay. For players, repeated play matters more than one perfect trailer a perfect trailer moment. Follow Pulse Gaming so you never miss a beat.",
    },
    {
      requireCtaField: true,
      requireFullScriptCta: true,
    },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:repeated_near_phrase:perfect trailer"),
    qa.failures.join(", "),
  );
});

test("script coherence allows repeated number words in spoken prices", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Nintendo Switch 2 Bundle Gets A Price",
      source_type: "rss",
      subreddit: "Nintendo",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Nintendo just made the Switch 2 bundle easier to judge. Nintendo says the Choose Your Game Bundle launches in early June for four hundred and ninety nine dollars and ninety nine cents. The important part is the download code, because buyers can choose the game that actually fits their house. Follow Pulse Gaming so you never miss a beat.",
    },
    {
      requireCtaField: true,
      requireFullScriptCta: true,
    },
  );

  assert.ok(
    !qa.failures.some((failure) => failure.includes("repeated_near_phrase")),
    `unexpected near-repeat failure: ${qa.failures.join(", ")}`,
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

test("script coherence does not let generated wording turn community Reddit into news", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Had a PS5 for years and someone just pointed this out to me.",
      source_type: "reddit",
      subreddit: "PS5",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "According to a Reddit post, Sony just confirmed a hidden PlayStation 5 feature that most players missed. The discovery proves the console still has buried quality-of-life updates years after launch. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:general_reddit_thread_as_news"),
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

test("script coherence blocks speculative sequel talk becoming a made-up numbered sequel title", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Mina The Hollower Ending Points At The Sequel Risk",
      source_type: "rss",
      source_name: "GameSpot",
      source_title: "Mina the Hollower spoiler interview",
      confirmed_claims: [
        "GameSpot says its spoiler interview with Yacht Club gets into sequel talk and Chrono Trigger-style ideas.",
      ],
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Mina the Hollower may have hidden its sequel problem inside the ending. For players, that changes whether Mina 2 feels like an instant wishlist. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:unsupported_numbered_sequel_claim:Mina 2"),
    qa.failures.join(", "),
  );
});

test("script coherence allows numbered sequel titles when source context names them", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Hades II Hits Consoles In April",
      source_type: "rss",
      source_name: "Xbox",
      source_title: "Hades II launches on Xbox and PlayStation on April 14",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Hades II hits Xbox and PlayStation on the same April clock. The sequel lands on both consoles, so the launch fight is controller feel. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "pass", qa.failures.join(", "));
});

test("script coherence allows common sequel-title expansions when the abbreviation is sourced", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "GTA 5 Became Rockstar's GTA 6 Warm-Up",
      source_type: "rss",
      source_name: "GameSpot",
      source_title: "GTA 5 launches on subscription ahead of GTA 6",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Rockstar's Grand Theft Auto 6 is the looming sequel context here. GTA 5 became the warm-up, not the final verdict. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "pass", qa.failures.join(", "));

  const romanQa = runScriptCoherenceQa(
    {
      title: "GTA VI Cover Art Starts The Pre-Order Fight",
      source_type: "rss",
      source_name: "Xbox Wire",
      source_title: "GTA VI cover art and preorders confirmed",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Xbox Wire reports Rockstar confirmed Grand Theft Auto VI preorders begin on June 25. If the page feels messy, preorders open the price fight before launch. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(romanQa.result, "pass", romanQa.failures.join(", "));
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

test("script coherence blocks paraphrased internal interpretation language", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Xbox confirms a Game Pass update",
      source_type: "rss",
      subreddit: "Xbox Wire",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Xbox confirmed three new Game Pass titles this week. Our safest interpretation is that the signal is not the headline. We are watching for confirmation before naming the next drop. Follow Pulse Gaming so you never miss a beat.",
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

test("script coherence blocks restart-pack editorial scaffolding in public narration", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Xbox Controller Deal Has One Catch",
      source_type: "rss",
      subreddit: "IGN",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Xbox controller deals are getting aggressive, but the catch is the retailer. Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories. If Steam is where Forza takes off, Xbox has a different launch story on its hands. Xbox Controller is a price story because the cost of jumping in has changed. Anyone already building that setup now has a lower entry point; everyone else still needs a reason to care. The clean angle is the discount, the platform and whether it fits the audience watching this short. If the listing changes, the story changes with it. Right now the news is the offer itself, not a hard sell. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:internal_audience_scaffold"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks public narration that says producer notes out loud", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Doom The Dark Ages Gets A New Reveal",
      source_type: "rss",
      subreddit: "IGN",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Doom The Dark Ages just showed a new campaign beat. IGN reports the latest reveal puts the new shield saw front and centre. The hook here is that this gives fans something concrete to argue about after the trailer. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:public_narration_meta_language"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks generated player-consequence placeholders", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Quake Champions Gets A Huge Update",
      source_type: "rss",
      subreddit: "PC Gamer",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Quake Champions just became a value test, not just a catalogue listing. PC Gamer says the shooter has a huge update and free battle pass. That is the gap to watch now: hype is easy, but the player consequence has to show up on screen. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:generated_player_consequence_placeholder"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks abstracted source-person stories that drop the named subject", () => {
  const qa = runScriptCoherenceQa(
    {
      title:
        "It's brutal out there: Deus Ex and Unreal composer says he's submitted 50 resumes and gotten one interview in the last year",
      source_title:
        "It's brutal out there: Deus Ex and Unreal composer says he's submitted 50 resumes and gotten one interview in the last year",
      source_type: "rss",
      subreddit: "PC Gamer",
      source_body:
        "This is Alexander Brandon, the man behind Deus Ex and Unreal's iconic soundtracks. Brandon submitted 50 job applications and received exactly one interview.",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "A Deus Ex composer says the games job market has gone brutally quiet. PC Gamer reports the composer submitted 50 resumes and got one interview in the last year. That number lands because the credits are not obscure. They are attached to games people still recognise. Here's what matters: the talent squeeze sits behind sequels, remakes and new studios players still ask for. Fewer stable specialist jobs means fewer experienced people staying around to shape those games. One resume story is not the whole industry, but it is a sharp warning from inside it. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:named_source_subject_missing:Alexander Brandon"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:abstract_industry_bridge"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks overused clickbait pivots that make stories sound generic", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Nintendo confirms a Switch 2 bundle",
      source_type: "rss",
      subreddit: "Nintendo",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Nintendo confirmed a Switch 2 bundle with a named release window. But here is where it gets interesting. Nobody expected this, and that changes everything. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:formulaic_pivot"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:nobody_expected_or_noticed"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:changes_everything"),
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

test("script coherence blocks generic launch padding and unsupported invented details", () => {
  const qa = runScriptCoherenceQa(
    {
      title:
        "Forza Horizon 6 immediately beats its predecessor's all-time Steam record with 130,000 concurrent players",
      source_type: "reddit",
      subreddit: "pcgaming",
      article_url: "https://www.gamesradar.com/forza-horizon-6-steam-record",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Forza Horizon 6 hit 130,000 concurrent players on Steam. According to GamesRadar+, Forza Horizon 6 reached 130,000 concurrent players through early access. This represents a significant increase compared with Forza Horizon 5, exceeding projections by a substantial margin. Initial reports suggest server load and minor performance issues, however Playground Games are actively monitoring the situation and deploying fixes. Over 130,000 gamers simultaneously enjoyed the new open-world maps and vehicles. The future of the Forza Horizon franchise looks brighter than ever. Don’t miss out on the latest gaming news and breaking revelations. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:unsupported_projection_claim"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:unsupported_live_ops_claim"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:generic_hype_closer"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:pre_cta_channel_promo"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.some((failure) =>
      failure.startsWith("script_coherence:repeated_numeric_claim:130,000"),
    ),
    qa.failures.join(", "),
  );
});

test("repeatedNumericClaims ignores normal one-or-two-use statistics", () => {
  assert.deepEqual(
    repeatedNumericClaims(
      "Subnautica 2 sold 1 million copies and hit 460,000 players. That 1 million figure is the story.",
    ),
    [],
  );
  assert.deepEqual(repeatedNumericClaims("130,000 players. 130,000 players. 130,000 players."), [
    { claim: "130,000", count: 3 },
  ]);
});

test("script coherence blocks hybrid spoken years and generic success-padding from uploaded-style drafts", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
      source_type: "reddit",
      subreddit: "PCMasterRace",
      article_url:
        "https://twistedvoxel.com/forza-horizon-6-becomes-highest-rated-game-of-2026-on-metacritic/",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Forza Horizon 6 just hit 92 on Metacritic. Playground Games' Forza Horizon 6 has topped Metacritic's charts for twenty 26, achieving a 92. The game's critical acclaim is driving phenomenal Steam numbers. The strong numbers underscore the game's appeal, proving to be a massive success. This sets a new benchmark for racing games in twenty 26 and has resonated with players worldwide, further cementing its status. Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:hybrid_spoken_year"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:generic_hype_closer"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks cross-story editorial template leakage", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Dragon's Dogma 2 gets first of two major updates",
      source_type: "rss",
      subreddit: "Polygon",
      article_url: "https://www.polygon.com/dragons-dogma-2-june-2026-update-fast-travel-fix/",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Forza just gave Xbox the headline it badly needed. " +
        "Polygon says Forza Horizon 6 has moved to the top of Metacritic's 2026 list. " +
        "A top score does not prove sales, retention or Game Pass engagement. " +
        "Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:cross_story_template_leak:forza_horizon_6"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:source_url_subject_conflict:dragons_dogma_2"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks subscription and paid-crowd templates without matching source context", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Today's Top Deals: Switch 2 and Xbox Series X consoles",
      source_type: "rss",
      subreddit: "IGN",
      article_url: "https://www.ign.com/articles/best-deals-for-june-11-2026",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Nintendo Switch 2 just became easier to try, but there is a catch. " +
        "IGN reports Nintendo Switch 2 has joined a subscription service. " +
        "That changes the first decision from buying the game to deciding whether it is worth the download. " +
        "Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:contextless_editorial_template:subscription_access"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:source_url_subject_conflict:best_deals"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks source-bound filler that invents generic player stakes", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Xbox Console Price Update",
      source_type: "rss",
      subreddit: "Xbox Wire",
      article_url: "https://news.xbox.com/en-us/2026/06/25/xbox-console-price-update/",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Updated XBOX Console Prices is getting a content push that has to prove it is more than maintenance. " +
        "Xbox Wire says Updated XBOX Console Prices has a new player-facing detail to judge. " +
        "Players will judge the practical change first: what feels better, what lasts longer and what gives them a reason to come back now. " +
        "If the update does not change that loop, the headline fades before the patch notes do. " +
        "Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:generic_source_bound_padding"),
    qa.failures.join(", "),
  );
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:producer_scaffold_language"),
    qa.failures.join(", "),
  );
});

test("script coherence blocks generic source-detail fallback narration", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Blue Meadow Gets A Studio Note",
      source_type: "rss",
      source_name: "PC Gamer",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Blue Meadow has a new source detail, but the real question is still what players can do with it. " +
        "PC Gamer says Blue Meadow has a new controller note. " +
        "If it changes when people buy, download, wishlist or return, the update matters. " +
        "If it only repeats a headline, it needs stronger proof before it deserves attention. " +
        "The next official detail has to make that choice clear: play now, wait, skip or watch for gameplay. " +
        "Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:generic_source_bound_padding"),
    qa.failures.join(", "),
  );
});

test("script coherence does not block named game scripts when no source context exists", () => {
  const qa = runScriptCoherenceQa(
    {
      title: "Runtime fixture",
      cta: "Follow Pulse Gaming so you never miss a beat",
      full_script:
        "Forza Horizon 6 finally has a release window. " +
        "The important part is whether Xbox can turn that date into a clean first-party win. " +
        "Follow Pulse Gaming so you never miss a beat.",
    },
    { requireCtaField: true, requireFullScriptCta: true },
  );

  assert.equal(qa.result, "pass");
});
