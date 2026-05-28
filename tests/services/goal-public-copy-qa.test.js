"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateGoalPublicCopy } = require("../../lib/goal-public-copy-qa");

test("goal public copy QA passes a sharp source-safe gaming story", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "PlayStation Plus",
    selected_title: "PlayStation Plus Just Got More Expensive",
    first_spoken_line: "PlayStation Plus just got more expensive for new customers.",
    narration_script:
      "PlayStation Plus just got more expensive for new customers. Sony says the change affects new sign-ups first. That matters if you were waiting to renew or compare tiers.",
    description:
      "PlayStation Plus prices are rising for new customers. Source: Eurogamer.",
  });

  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.failures, []);
});

test("goal public copy QA blocks price direction mismatches", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Super Mario RPG",
    canonical_title: "Super Mario RPG - $15 (70% off) at GameStop, physical, lowest price ever",
    confirmed_claims: [
      "Super Mario RPG - $15 (70% off) at GameStop, physical, lowest price ever",
    ],
    selected_title: "Super Mario RPG Just Got More Expensive",
    thumbnail_headline: "SUPER MARIO RPG PRICE JUMP",
    first_spoken_line: "Super Mario RPG just got more expensive for players.",
    narration_script:
      "Super Mario RPG just got more expensive for players. GameStop reports Super Mario RPG is $15, 70% off and at its lowest price ever.",
    description: "Super Mario RPG is $15 at GameStop, 70% off. Source: GameStop.",
    primary_source: "GameStop",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:price_direction_mismatch"));
});

test("goal public copy QA blocks malformed quote fragments as subjects and titles", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: 'Honestly? We botched it"',
    selected_title: 'Honestly? We botched it" Just Raised The Stakes',
    first_spoken_line: "Honestly?",
    narration_script:
      'Honestly? We botched it" just gave players the update they needed. Eurogamer says the Kickstarter adult content rules changed.',
    description:
      'Honestly? We botched it": Crowdfunding website Kickstarter has issued an apology. Read more Source: Eurogamer.',
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:canonical_subject_is_quote_fragment"));
  assert.ok(report.failures.includes("public_copy:malformed_quote_title"));
  assert.ok(report.failures.includes("public_copy:first_line_too_weak"));
  assert.ok(report.failures.includes("public_copy:description_contains_article_residue"));
});

test("goal public copy QA blocks article quote fragments in descriptions", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Kickstarter",
    selected_title: "Kickstarter Just Walked Back Its Rules",
    first_spoken_line: "Kickstarter just walked back one of its most controversial rule changes.",
    narration_script:
      "Kickstarter just walked back one of its most controversial rule changes. Eurogamer reports the company apologised after backlash from game creators.",
    description: '"Honestly?. Source: Eurogamer.',
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:malformed_quote_description"));
  assert.ok(report.failures.includes("public_copy:description_too_thin"));
});

test("goal public copy QA blocks weak AI-ish title patterns and bloated descriptions", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Warhammer 40,000 Boltgun 2",
    selected_title: "Warhammer 40,000 Boltgun 2 Just Got A Content Push",
    first_spoken_line: "Warhammer 40,000 Boltgun 2 just got a new demo.",
    narration_script:
      "Warhammer 40,000 Boltgun 2 just got a new demo. IGN played it and highlighted the two playable characters.",
    description: `${"This is article copy. ".repeat(40)} Source: IGN.`,
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:weak_title_pattern"));
  assert.ok(report.failures.includes("public_copy:description_too_long"));
});

test("goal public copy QA blocks visibly broken thumbnail headlines", () => {
  const danglingReport = evaluateGoalPublicCopy({
    canonical_subject: "Deus Ex",
    selected_title: "Deus Ex Composer Says The Jobs Vanished",
    thumbnail_headline: "DEUS EX COMPOSER SAYS THE",
    first_spoken_line: "A Deus Ex composer says the games job market has gone brutally quiet.",
    narration_script:
      "A Deus Ex composer says the games job market has gone brutally quiet. PC Gamer reports that a veteran composer sent dozens of resumes and got one interview.",
    description: "A Deus Ex composer says the games job market is brutal. Source: PC Gamer.",
  });

  assert.equal(danglingReport.verdict, "fail");
  assert.ok(danglingReport.failures.includes("public_copy:thumbnail_headline_dangles"));

  const repeatedTokenReport = evaluateGoalPublicCopy({
    canonical_subject: "PS5",
    selected_title: "PS5 Prices Went Up Again",
    thumbnail_headline: "PS5 PS5 PRICES WENT UP",
    first_spoken_line: "PS5 prices just went up again for new buyers.",
    narration_script:
      "PS5 prices just went up again for new buyers. Sony says the new price applies in selected markets from this week.",
    description: "PS5 prices are rising in selected markets. Source: PlayStation Blog.",
  });

  assert.equal(repeatedTokenReport.verdict, "fail");
  assert.ok(repeatedTokenReport.failures.includes("public_copy:thumbnail_headline_repeated_token"));

  const repeatedSubjectReport = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    thumbnail_headline: "EXPANSE: OSIRIS REBORN THE EXPANSE",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed the new cut during Partner Preview.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay. Source: Xbox.",
  });

  assert.equal(repeatedSubjectReport.verdict, "fail");
  assert.ok(repeatedSubjectReport.failures.includes("public_copy:thumbnail_headline_repeated_token"));

  const determinerBeforeVerbReport = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    thumbnail_headline: "EXPANSE: OSIRIS REBORN THE SHOWS",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed the new cut during Partner Preview.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay. Source: Xbox.",
  });

  assert.equal(determinerBeforeVerbReport.verdict, "fail");
  assert.ok(determinerBeforeVerbReport.failures.includes("public_copy:thumbnail_headline_dangles"));

  const semanticallyCutReports = [
    {
      canonical_subject: "V Rising",
      selected_title: "V Rising Devs Are Making Another Vampire Game",
      thumbnail_headline: "V RISING DEVS ARE MAKING",
      first_spoken_line: "V Rising's developers are already building another vampire game.",
      narration_script:
        "V Rising's developers are already building another vampire game. Stunlock Studios says the new project stays inside the V Rising world.",
      description: "Stunlock Studios says it is working on another vampire game. Source: Stunlock Studios.",
    },
    {
      canonical_subject: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Premium Already Made $140M",
      thumbnail_headline: "FORZA HORIZON 6 PREMIUM ALREADY",
      first_spoken_line: "Forza Horizon 6 Premium Edition is already turning early access into the real launch story.",
      narration_script:
        "Forza Horizon 6 Premium Edition is already turning early access into the real launch story. Insider Gaming reports Premium Edition has made more than $140 million.",
      description: "Forza Horizon 6 Premium Edition has made more than $140 million. Source: Insider Gaming.",
    },
    {
      canonical_subject: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Finally Hit Steam",
      thumbnail_headline: "FORZA HORIZON 6 FINALLY HIT",
      first_spoken_line: "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
      narration_script:
        "Forza Horizon 6 just turned its Steam launch into an Xbox signal. Steam now lists the game as available.",
      description: "Forza Horizon 6 is available on Steam. Source: Steam.",
    },
    {
      canonical_subject: "Stranger Than Heaven",
      selected_title: "Stranger Than Heaven Shows Five Eras",
      thumbnail_headline: "STRANGER THAN HEAVEN SHOWS FIVE",
      first_spoken_line: "Stranger Than Heaven just showed its five-era setup.",
      narration_script:
        "Stranger Than Heaven just showed its five-era setup. Xbox showed the new trailer during Partner Preview.",
      description: "Stranger Than Heaven showed its five-era setup. Source: Xbox.",
    },
    {
      canonical_subject: "Subnautica 2",
      selected_title: "Subnautica 2 Dev Calls Out Leakers",
      thumbnail_headline: "SUBNAUTICA 2 DEV CALLS OUT",
      first_spoken_line: "Subnautica 2's developer is already fighting leaked builds.",
      narration_script:
        "Subnautica 2's developer is already fighting leaked builds. Respawnfirst reports the studio responded after the game leaked early.",
      description: "Subnautica 2's developer responded to leaked builds. Source: Respawnfirst.",
    },
  ].map((manifest) => evaluateGoalPublicCopy(manifest));

  for (const report of semanticallyCutReports) {
    assert.equal(report.verdict, "fail");
    assert.ok(report.failures.includes("public_copy:thumbnail_semantically_truncated"));
  }
});

test("goal public copy QA blocks stale identity CTA wording", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Turns Steam Into Xbox's Launch Test",
    first_spoken_line: "Forza Horizon 6 turned Steam into Xbox's launch test.",
    narration_script:
      "Forza Horizon 6 turned Steam into Xbox's launch test. GamesRadar says the Premium Edition launch pulled a major Steam audience before the standard release. That makes the early access number useful, but not the final ceiling. Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "Forza Horizon 6 drew a major Steam audience before standard launch. Source: GamesRadar.",
    primary_source: "GamesRadar",
    source_card_label: "GamesRadar",
  });

  assert.ok(report.failures.includes("public_copy:stale_identity_cta"));
});

test("goal public copy QA blocks unsupported accusation-style titles", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Crimson Desert",
    selected_title: "Crimson Desert's Secret Problem Pearl Abyss Won't Admit",
    first_spoken_line: "Crimson Desert has a secret problem.",
    narration_script:
      "Crimson Desert has a secret problem Pearl Abyss won't admit. GameSpot reports the game launched on March 19.",
    description: "Crimson Desert launched on March 19. Source: GameSpot.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:weak_title_pattern"));
});

test("goal public copy QA blocks generic subjects and fallback repair titles", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "This story",
    selected_title: "This story Has One Player Question",
    first_spoken_line: "This story has one player question.",
    narration_script:
      "This story has one player question. Reddit reports a gaming claim that still needs a proper subject.",
    description: "This story: a gaming claim still needs a proper subject. Source: Reddit.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:generic_canonical_subject"));
  assert.ok(report.failures.includes("public_copy:weak_title_pattern"));
});

test("goal public copy QA blocks unnormalised lower-case brand subjects and titles", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "xbox",
    selected_title: "xbox Deal Has One Catch",
    first_spoken_line: "xbox has a deal worth checking before you buy.",
    narration_script:
      "xbox has a deal worth checking before you buy. The practical question is whether the change hits the version people actually buy.",
    description: "xbox has a deal worth checking before you buy. Source: YouTube.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:subject_capitalisation_required"));
  assert.ok(report.failures.includes("public_copy:title_capitalisation_required"));
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks formulaic repair filler from public narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Lego Batman",
    selected_title: "Lego Batman Is Packed With Deep Cuts",
    first_spoken_line: "Lego Batman is packed with deep cuts for players who know the Arkham games.",
    narration_script:
      "Lego Batman is packed with deep cuts for players who know the Arkham games. For players, the question is what changes before the next purchase, download or watchlist decision. Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "Lego Batman has new Easter eggs in its latest showcase. Source: GameSpot.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks concrete-change production-note narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Xbox",
    selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
    first_spoken_line: "Xbox asked for feedback and immediately got the exclusives argument.",
    narration_script:
      "Xbox asked for feedback and immediately got the exclusives argument. IGN reports Microsoft launched Xbox Player Voice to gather feedback. Xbox now has one concrete change worth remembering after the scroll moves on. Follow Pulse Gaming so you never miss a beat.",
    description: "IGN reports Microsoft launched Xbox Player Voice to gather feedback. Source: IGN.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks TTS-hostile Hades filler from public narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Hades II",
    canonical_game: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    thumbnail_headline: "HADES II CONSOLE DATE",
    first_spoken_line: "Hades II just put PlayStation and Xbox players on the same April countdown.",
    narration_script:
      "Hades II just put PlayStation and Xbox players on the same April countdown. The real question is brutal: does the console version feel as lethal from the sofa as it does on PC? Hades lives on instant inputs, clean reads and players sharing broken builds within hours. That is the part to watch when longer console footage lands. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "Hades II just put PlayStation and Xbox players on the same April countdown. The real question is brutal: does the console version feel as lethal from the sofa as it does on PC? Hades lives on instant inputs, clean reads and players sharing broken builds within hours. That is the part to watch when longer console footage lands. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Hades II just put PlayStation and Xbox players on the same April countdown. The real question is brutal: does the console version feel as lethal from the sofa as it does on PC? Hades lives on instant inputs, clean reads and players sharing broken builds within hours. That is the part to watch when longer console footage lands. Follow Pulse Gaming so you never miss a beat.",
    description: "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. Source: Xbox.",
    primary_source: "Xbox",
    source_card_label: "Xbox",
    official_source: "Xbox",
    confirmed_claims: ["Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date."],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks source-process memo language from public narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "V Rising",
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    first_spoken_line: "V Rising's developers are already building another vampire game.",
    narration_script:
      "V Rising's developers are already building another vampire game. Stunlock says the next project stays in the same world. Stunlock keeps the story bounded without making it bigger than the evidence. The useful test is whether players get a clearer choice after the next official detail.",
    description: "Stunlock says its next game is set in the same world as V Rising. Source: Stunlock Studios.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks duration-repair memo language", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    first_spoken_line: "Forza Horizon 6 just broke the Xbox ceiling that usually matters on Steam.",
    narration_script:
      "Forza Horizon 6 just broke the Xbox ceiling that usually matters on Steam. The practical question is whether Forza Horizon 6 changes what people play, buy, wishlist or wait on. The Phrasemaker gives the story enough shape to act on without turning it into a bigger claim than it is. The confirmed bit is still the anchor: Forza Horizon 6 Just Broke Xbox's Steam Ceiling.",
    description: "Forza Horizon 6 is drawing heavy Steam attention. Source: The Phrasemaker.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks instruction-like buyer-advice narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Just Got More Expensive",
    first_spoken_line: "Forza Horizon 6 just got more expensive for players.",
    narration_script:
      "Forza Horizon 6 just got more expensive for players. Insider Gaming reports Forza Horizon 6 Has Made Over $140 Million from Premium Edition. Before you spend, check the live price, the platform listing and whether the deal is still active. Forza Horizon 6 is the hook, but the decision is simpler: buy now, wait or skip it until the next confirmed listing. If the listing moves again, the recommendation moves with it. Treat the headline as a price check, not a victory lap. The next update that matters is a store page, official post or platform listing changing the practical call.",
    description:
      "Forza Horizon 6 has reportedly made over $140 million from its Premium Edition. Source: Insider Gaming.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:instruction_like_buyer_advice_narration"));
});

test("goal public copy QA blocks checklist-style player decision narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Crimson Desert",
    selected_title: "Crimson Desert Finally Has A Launch Signal",
    first_spoken_line: "Crimson Desert finally has a launch signal.",
    narration_script:
      "Crimson Desert finally has a launch signal. The next choice is practical: buy, download, wait or skip. That matters if deciding what to wishlist, download or ignore next. Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "Crimson Desert has a new launch signal. Source: PlayStation Blog.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:instruction_like_buyer_advice_narration"));
});

test("goal public copy QA blocks instruction-like headline-to-decision narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Crimson Desert",
    selected_title: "Crimson Desert Finally Has A Date",
    first_spoken_line: "Crimson Desert is already live, so the question is whether players should jump in now.",
    narration_script:
      "Crimson Desert is already live, so the question is whether players should jump in now. GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. That matters because this is where a headline turns into a real player decision. Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "Crimson Desert launched on March 19, 2026. Source: GameSpot.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:instruction_like_buyer_advice_narration"));
});

test("goal public copy QA blocks deterministic repair-template narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Steam Controller",
    selected_title: "Steam Controller Date May Have Leaked",
    first_spoken_line: "Steam Controller release timing may have leaked early.",
    narration_script:
      "Steam Controller release timing may have leaked early. Eurogamer reports The Steam controller release date may have been leaked online. The important part is the named change, the source behind it and why it matters now. The number only matters if it hits the version people actually buy. Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "The Steam controller release date may have been leaked online. Source: Eurogamer.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks editor-instruction narration that is not a news story", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Nintendo Switch 2",
    selected_title: "Nintendo Switch 2 Just Got More Expensive",
    first_spoken_line: "Nintendo Switch 2 just got more expensive for players.",
    narration_script:
      "Nintendo Switch 2 just got more expensive for players. IGN reports This Iniu 20,000 Power Bank Quadruples Your Nintendo Switch 2 Play Time For $17. The real test is whether Nintendo Switch 2 changes play, not whether the patch note sounds bigger. A useful update should fix a real friction point, not just add a louder headline. If the next patch moves the detail again, update the story before treating it as settled.",
    description: "Nintendo Switch 2 has a new accessory deal. Source: IGN.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks fallback writer instructions leaking into narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Resident Evil Requiem",
    selected_title: "Resident Evil Requiem Shows New Gameplay",
    first_spoken_line: "Resident Evil Requiem just showed new first-person gameplay.",
    narration_script:
      "Resident Evil Requiem just showed new first-person gameplay. IGN reports the preview has new lighting, exploration and survival-horror pacing. Keep the claim tight: cite the source and do not turn preview momentum into fake certainty. Anything outside the report should stay out of the narration. For players, that is the difference between a news recap and a decision filter.",
    description: "Resident Evil Requiem has new first-person gameplay footage. Source: IGN.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks raw image posts being promoted as news sources", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Capturing",
    selected_title: "Capturing Has One Player Question",
    first_spoken_line: "Capturing Has One Player Question.",
    narration_script:
      "Capturing Has One Player Question. I reports Capturing Mewtwo in the office on Pokemon Red. Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "Capturing Mewtwo in the office on Pokemon Red. Source: I.",
    primary_source: "I",
    primary_source_url: "https://i.redd.it/g9uhlr6g9u0h1.jpeg",
    confirmed_claims: ["Capturing Mewtwo in the office on Pokemon Red"],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:non_news_image_post_source"));
});

test("goal public copy QA blocks abstract strategy filler passing as narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Crushed Its Steam Record",
    first_spoken_line: "Forza Horizon 6 just smashed its Steam launch signal.",
    narration_script:
      "Forza Horizon 6 just smashed its Steam launch signal. GamesRadar reports Forza Horizon 6 is already being framed as a major Steam success for Xbox. The next serious detail is whether timing, pricing or access moves around that momentum. That is where a launch stat becomes a strategy story. For now, the smart read is momentum with a clear source boundary.",
    description: "Forza Horizon 6 is drawing heavy Steam attention. Source: GamesRadar.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks cross-story residue and repeated sentences", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Subnautica 2",
    selected_title: "Subnautica 2 Dev Calls Out Leakers",
    first_spoken_line: "Subnautica 2 is keeping one of its strangest survival rules.",
    narration_script:
      "Subnautica 2 is keeping one of its strangest survival rules. Respawnfirst reports Subnautica 2 Dev Responds to Pirates Leaking the Game. If either side answers, the story changes from odd filing to clearer dispute. For now, the facts are the lawsuit, the rejection and the named companies involved. If either side answers, the story changes from odd filing to clearer dispute.",
    description: "Subnautica 2 Dev Responds to Pirates Leaking the Game. Source: Respawnfirst.",
    primary_source: "Respawnfirst",
    confirmed_claims: ["Subnautica 2 Dev Responds to Pirates Leaking the Game"],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:source_claim_scope_mismatch"));
  assert.ok(report.failures.includes("public_copy:cross_story_residue"));
  assert.ok(report.failures.includes("public_copy:repeated_sentence"));
});

test("goal public copy QA blocks generic gameplay filler on industry stories", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Deus Ex",
    selected_title: "Deus Ex Composer Says The Jobs Vanished",
    first_spoken_line: "A Deus Ex composer says the games job market has gone brutally quiet.",
    narration_script:
      "A Deus Ex composer says the games job market has gone brutally quiet. PC Gamer reports a Deus Ex and Unreal composer submitted 50 resumes and got one interview in the last year. The sharper angle is what changes once players see footage, price, platform details or real reaction. Deus Ex has a concrete gaming hook, but the follow-up still needs footage, platform detail or player reaction. The named game and source give viewers something specific to argue about.",
    description: "A Deus Ex and Unreal composer says he submitted 50 resumes and got one interview. Source: PC Gamer.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks stale duration-expansion access filler", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. The Expanse: Osiris Reborn is not just a price headline; it is a read on how access is being used to shape launch demand. That keeps the value question tied to the source without pretending the headline settles it. The next update that matters is a store page, official post or platform listing with firmer access details.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));

  const premiumAccessReport = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. The Expanse: Osiris Reborn turns premium access into the story, because the paid tier is starting to look like launch day. The tension is whether early access feels like a bonus or the real starting line. That makes the value angle sharper than a raw revenue number.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
  });

  assert.equal(premiumAccessReport.verdict, "fail");
  assert.ok(premiumAccessReport.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks bland duration-repair gameplay narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Now players can read the camera, gunfights and scale without guessing from a name reveal. A fast showcase cut can still flatter a rough game, so the excitement needs a little restraint. A second gameplay cut would help players judge combat, camera and pace without stretching the claim. Clear platforms and timing decide whether viewers can act on the reveal today. Follow Pulse Gaming so you never miss a beat.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
    primary_source: "Xbox",
    confirmed_claims: [
      "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks meta editing instructions in narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. The Expanse: Osiris Reborn is a price-and-access story, so the edit should stay close to the actual offer. The details that matter are the discount, the platform and whether the deal is live where players can use it. That keeps the commercial angle useful without turning the short into an advert. The Expanse: Osiris Reborn stays worth tracking because the next official detail could change the launch, access or value story.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks launch-date narration after the story is already live", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Crimson Desert",
    selected_title: "Crimson Desert Is Already Live",
    first_spoken_line:
      "Crimson Desert finally has a launch date after years of spectacle-first trailers.",
    narration_script:
      "Crimson Desert finally has a launch date after years of spectacle-first trailers. GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. The launch pressure is simple: Pearl Abyss has to prove the spectacle still works once real players touch it. Crimson Desert finally has a date attached to years of spectacle. The next thing players need is performance footage that survives more than a perfect showcase shot.",
    description:
      "Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. Source: GameSpot.",
    confirmed_claims: [
      "Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:stale_launch_date_framing"));
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks narration that reads like editorial planning notes", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Finally Hit Steam",
    first_spoken_line:
      "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
    narration_script:
      "Forza Horizon 6 just turned its Steam launch into an Xbox signal. Store reports Forza Horizon 6 is already being framed as a major Steam success for Xbox. The watch point is whether Steam attention changes how Xbox times the wider launch push. The narrow version of the story is this: Forza Horizon 6 is already being framed as a major Steam success for Xbox.",
    description: "Forza Horizon 6 is drawing Steam attention. Source: Store.",
    confirmed_claims: [
      "Forza Horizon 6 is already being framed as a major Steam success for Xbox.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks malformed source labels narrated as reporting outlets", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Finally Hit Steam",
    first_spoken_line: "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
    narration_script:
      "Forza Horizon 6 just turned its Steam launch into an Xbox signal. Store reports Forza Horizon 6 is already being framed as a major Steam success for Xbox. If Steam is where Forza takes off, Xbox has a different launch story on its hands.",
    description: "Forza Horizon 6 is drawing Steam attention. Source: Store.",
    primary_source: "Store",
    confirmed_claims: [
      "Forza Horizon 6 is already being framed as a major Steam success for Xbox.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:malformed_primary_source_label"));
});

test("goal public copy QA blocks raw article-headline source sentences in narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Pragmata",
    selected_title: "Pragmata's AI-Look Stage Was Handmade",
    first_spoken_line: "Pragmata's AI-looking stage was actually handmade by developers.",
    narration_script:
      'Pragmata\'s AI-looking stage was actually handmade by developers. Automaton Media reports Pragmata\'s newly revealed New York stage was painstakingly made by human developers to look "AI generated," according to director - AUTOMATON WEST. That flips the read: the strange texture is art direction, not a machine shortcut.',
    description: "Pragmata's New York stage was handmade to look AI generated. Source: Automaton Media.",
    primary_source: "Automaton Media",
    confirmed_claims: [
      "Pragmata's newly revealed New York stage was handmade by human developers to look AI generated.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:raw_article_headline_in_narration"));
});

test("goal public copy QA blocks unsupported gameplay specifics in repaired narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "V Rising",
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    first_spoken_line: "V Rising's developers are already building another vampire game.",
    narration_script:
      "V Rising's developers are already building another vampire game. Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update. V Rising has to survive players now, not just the patch notes. Frame-rate clips, matchmaking clips and balance complaints will expose weak fixes fast. A bad one becomes another clip people pass around for the wrong reason.",
    description:
      "Stunlock Studios says it is making another game set in the world of V Rising. Source: Stunlock Studios.",
    primary_source: "Stunlock Studios",
    confirmed_claims: [
      "Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:unsupported_specific_detail_narration"));
});

test("goal public copy QA blocks repair planning residue in narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Subnautica 2",
    selected_title: "Subnautica 2 Dev Calls Out Leakers",
    first_spoken_line: "Subnautica 2 is keeping one of its strangest survival rules.",
    narration_script:
      "Subnautica 2 is keeping one of its strangest survival rules. Respawnfirst reports Subnautica 2 Dev Responds to Pirates Leaking the Game. The hook has to stay tied to the named game, the source and the concrete detail viewers can repeat. The next beat should add a real detail, not a loose buyer checklist. If there is no footage, price or platform angle, the story needs a clearer consequence before it earns another upload.",
    description: "A Subnautica 2 developer responded to leaked game material. Source: Respawnfirst.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks meta visual-proof narration that sounds like edit instructions", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Footage matters here because it shows whether there is a real game behind the announcement. For an Expanse RPG, the pitch lives or dies on ship pressure, dialogue choices and whether ground combat feels heavier than a licensed skin. Players need to see a loop with real decisions before this feels like more than a familiar logo. A longer gameplay cut can prove whether the pitch survives beyond montage pace.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
    primary_source: "Xbox",
    confirmed_claims: [
      "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks unanchored premium edition claims", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. The Expanse: Osiris Reborn Premium Edition turns the launch window into the argument because players are paying before the standard start.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
    confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:unanchored_premium_edition_claim"));
});

test("goal public copy QA blocks platform strategy misclassified as gameplay showcase", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Xbox",
    selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
    first_spoken_line: "Xbox asked for feedback and immediately got the exclusives argument.",
    narration_script:
      "Xbox asked for feedback and immediately got the exclusives argument. The first test is movement, combat readability and whether the UI looks like a real game. Players do not need another logo sweep; they need scenes that show how the game starts.",
    description: "Microsoft launched Xbox Player Voice and fans demanded exclusives. Source: IGN.",
    confirmed_claims: ["Microsoft launched Xbox Player Voice and fans demanded exclusives."],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:platform_strategy_misclassified_as_gameplay_showcase"));
});

test("goal public copy QA blocks unanchored review-score language", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Xbox",
    selected_title: "Xbox Exclusives Are Back Under Review",
    first_spoken_line: "Xbox exclusives are back under review at the top.",
    narration_script:
      "Xbox exclusives are back under review at the top. Xbox is past headline hype now; the reviews are the first real pressure test. For players, this is where the review score has to connect with performance.",
    description: "Xbox's new CEO is reevaluating exclusive games. Source: Kotaku.",
    confirmed_claims: ["New Xbox CEO is reevaluating exclusive games."],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:unanchored_review_score_language"));
});

test("goal public copy QA blocks source-process and operator-advice residue", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Dawn of War 4",
    selected_title: "Dawn Of War 4 Sets Up Its Roadmap",
    first_spoken_line: "Dawn of War 4 already has its roadmap pressure point.",
    narration_script:
      "Dawn of War 4 already has its roadmap pressure point. Eurogamer is the source for the confirmed claim. Dawn of War 4 stays a gaming story because it changes what players check around the launch window. The smart move is to watch the gameplay, then wait for the hard launch details.",
    description: "Dawn of War 4 has a Year 1 roadmap. Source: Eurogamer.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks public claims that are unsupported by the source scope", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Subnautica 2",
    selected_title: "Subnautica 2 Is Keeping Its Peaceful Rule",
    first_spoken_line: "Subnautica 2 is keeping one of its strangest survival rules.",
    narration_script:
      "Subnautica 2 is keeping one of its strangest survival rules. Respawnfirst reports After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch. Keeping wildlife out of the kill-list means tension has to come from creature design, not monster-hunting.",
    description: "After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch. Source: Respawnfirst.",
    primary_source: "Respawnfirst",
    confirmed_claims: ["After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch"],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:source_claim_scope_mismatch"));
});

test("goal public copy QA blocks confirmed-claim repair memo language", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    first_spoken_line: "Hades II just broke PlayStation's silence.",
    narration_script:
      "Hades II just broke PlayStation's silence. Xbox showed the new trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation. Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "Xbox showed the latest Hades II trailer. Source: Xbox.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks official sources reporting raw trailer titles", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Hades II",
    canonical_game: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    first_spoken_line: "Hades II just broke PlayStation's silence.",
    narration_script:
      "Hades II just broke PlayStation's silence. Xbox reports Hades II - Xbox and PlayStation Trailer (Coming April 14th!). Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "Hades II is coming to Xbox and PlayStation. Source: Xbox.",
    primary_source: "Xbox",
    official_source: "Xbox",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:official_source_reporting_language"));
});

test("goal public copy QA blocks stale duration-repair player filler", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    first_spoken_line: "Hades II just broke PlayStation's silence.",
    narration_script:
      "Hades II just broke PlayStation's silence. Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. For players, this only matters if it changes what to buy, download or ignore.",
    description: "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. Source: Xbox.",
    primary_source: "Xbox",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks stale full_script and tts_script after narration repair", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    first_spoken_line: "Hades II just broke PlayStation's silence.",
    narration_script:
      "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. Follow Pulse Gaming for the gaming stories behind the headline.",
    full_script:
      "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation.",
    tts_script:
      "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation.",
    description: "Xbox showed the latest Hades II trailer. Source: Xbox.",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:full_script_diverges_from_narration"));
  assert.ok(report.failures.includes("public_copy:tts_script_diverges_from_narration"));
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks source-process narration that reads like internal notes", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Spellcasters Chronicles",
    selected_title: "Spellcasters Chronicles Is Shutting Down",
    first_spoken_line: "Spellcasters Chronicles is shutting down only months after early access.",
    narration_script:
      "Spellcasters Chronicles is shutting down only months after early access. Eurogamer is the source for this story. It stays a gaming story because it changes what players check around the game, platform or launch window.",
    full_script:
      "Spellcasters Chronicles is shutting down only months after early access. Eurogamer is the source for this story. It stays a gaming story because it changes what players check around the game, platform or launch window.",
    tts_script:
      "Spellcasters Chronicles is shutting down only months after early access. Eurogamer is the source for this story. It stays a gaming story because it changes what players check around the game, platform or launch window.",
    description:
      "Spellcasters Chronicles is shutting down only months after early access. Source: Eurogamer.",
    primary_source: "Eurogamer",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks YouTube host labels as public reporting sources", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    canonical_company: "xbox",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Youtube reports The Expanse: Osiris Reborn official gameplay trailer.",
    description: "The Expanse: Osiris Reborn official gameplay trailer. Source: Youtube.",
    primary_source: "Youtube",
    primary_source_url: "https://www.youtube.com/watch?v=LBxjH-lZjEo",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:platform_host_source_label"));
  assert.ok(report.failures.includes("public_copy:platform_host_reporting_language"));
});

test("goal public copy QA blocks Reddit discovery labels as confirmed primary sources", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "V Rising",
    canonical_angle: "Confirmed Drop",
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    first_spoken_line: "V Rising's developers are already building another vampire game.",
    narration_script:
      "V Rising's developers are already building another vampire game. Reddit reports the studio is making a new vampire project.",
    description: "V Rising devs are working on a new vampire game. Source: Reddit.",
    primary_source: "Reddit",
    primary_source_url:
      "https://www.reddit.com/r/Games/comments/1s47yge/v_rising_devs_working_on_a_new_vampire_game/",
    discovery_source: "Reddit",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:reddit_discovery_label_used_as_primary_source"));
});

test("goal public copy QA blocks Reddit-only rumour stories from normal production", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "PS5",
    selected_title: "PS5 Price Hike Rumour Hits Europe",
    first_spoken_line: "PS5 price hike rumours are back in Europe.",
    narration_script:
      "PS5 price hike rumours are back in Europe. Reddit reports Rumor: Another PS5 price hike coming to at least Europe shortly.",
    description: "PS5 price hike rumours are back in Europe. Source: Reddit.",
    primary_source: "Reddit",
    primary_source_url:
      "https://www.reddit.com/r/GamingLeaksAndRumours/comments/1s4d0ev/rumor_another_ps5_price_hike_coming_to_at_least/",
    discovery_source: "Reddit",
    canonical_angle: "Rumour Watch",
    secondary_sources: [],
  });

  assert.ok(report.failures.includes("public_copy:reddit_only_rumour_without_external_source"));
});

test("goal public copy QA blocks Reddit as the public source label when an external source carries the claim", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Valorant Vanguard",
    selected_title: "Valorant Vanguard Just Bricked Cheaters' PCs",
    first_spoken_line: "Valorant Vanguard just bricked cheaters' PCs after Riot's update.",
    narration_script:
      "Valorant Vanguard just bricked cheaters' PCs after Riot's update. IGN reports the key claim, while Reddit is only where the post was found.",
    description: "Valorant Vanguard has a PC-breaking claim. Source: Reddit.",
    primary_source: {
      name: "Reddit",
      url: "https://www.reddit.com/r/pcgaming/comments/example",
    },
    discovery_source: {
      name: "Reddit",
      url: "https://www.reddit.com/r/pcgaming/comments/example",
    },
    secondary_sources: [
      {
        name: "IGN",
        url: "https://www.ign.com/articles/valorant-vanguard-update",
      },
    ],
    source_card_label: "Reddit",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:reddit_discovery_label_used_as_primary_source"));
});

test("goal public copy QA can derive the first public line from narration when the manifest omits a duplicate field", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Star Fox",
    selected_title: "Star Fox Just Got A Switch 2 Route",
    narration_script:
      "Star Fox just got a Switch 2 camera route. Nintendo listed the feature, and it changes which setup players need.",
    description: "Star Fox has a Switch 2 camera route. Source: Nintendo.",
    primary_source: "Nintendo",
    source_card_label: "Nintendo",
  });

  assert.equal(report.verdict, "pass");
  assert.ok(!report.failures.includes("public_copy:first_line_too_weak"));
});

test("goal public copy QA accepts a shorter public subject token for long colon-separated game names", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Warhammer Age Of Sigmar: Deathmaster",
    selected_title: "Deathmaster Brings Stealth To Consoles",
    first_spoken_line: "Deathmaster brings stealth to consoles next year.",
    narration_script:
      "Deathmaster brings stealth to consoles next year. GameSpot reports the launch window, and the player decision is whether this belongs on the wishlist.",
    description: "Deathmaster is coming to consoles. Source: GameSpot.",
    primary_source: "GameSpot",
    source_card_label: "GameSpot",
  });

  assert.equal(report.verdict, "pass");
  assert.ok(!report.failures.includes("public_copy:first_line_too_weak"));
});

test("goal public copy QA blocks stale platform packs that drift onto another subject", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Subnautica 2",
    selected_title: "Subnautica 2 Is Keeping Its Peaceful Rule",
    first_spoken_line: "Subnautica 2 is keeping one of its strangest survival rules.",
    narration_script:
      "Subnautica 2 is keeping one of its strangest survival rules. Respawnfirst reports the launch timing may have leaked.",
    description: "Subnautica 2 timing may have leaked. Source: Respawnfirst.",
    primary_source: "Respawnfirst",
    platform_publish_manifest: {
      outputs: {
        x: {
          hot_take_post:
            "Forza Horizon 6 is the part of this story everyone will argue about.",
          source_safe_post:
            "Forza Horizon 6 Just Got A Date\n\nSource: Respawnfirst.",
          thread_posts: [
            "Forza Horizon 6 Just Got A Date",
            "Source: Respawnfirst.",
          ],
        },
        threads: {
          discussion_post:
            "Forza Horizon 6 is worth watching for the player impact, not just the headline.",
        },
        pinterest: {
          pin_title: "Forza Horizon 6 story guide",
          pin_description: "Racing setup notes are on the story page.",
        },
      },
    },
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:platform_copy_missing_canonical_subject"));
});

test("goal public copy QA blocks stale platform source labels", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "The Expanse: Osiris Reborn",
    canonical_company: "Xbox",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed the game during Xbox Partner Preview.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay. Source: Xbox.",
    primary_source: "Xbox",
    official_source: "Xbox",
    platform_publish_manifest: {
      outputs: {
        x: {
          source_safe_post:
            "The Expanse Game Just Broke Gaming's Biggest Rule\n\nSource: Youtube.",
        },
        threads: {
          discussion_post:
            "The Expanse: Osiris Reborn is worth watching. Source: Youtube.",
        },
      },
    },
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:platform_source_label_mismatch"));
});

test("goal public copy QA blocks narration that openly describes the edit plan", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Reviews Are In",
    first_spoken_line: "Forza Horizon 6 reviews are finally in.",
    narration_script:
      "Forza Horizon 6 reviews are finally in. PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in. That is the review angle worth compressing into a short.",
    description:
      "PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in. Source: PC Gamer.",
    primary_source: "PC Gamer",
    confirmed_claims: [
      "PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks producer-note phrasing in narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Star Wars Zero Company",
    selected_title: "Star Wars Zero Company Is More Than XCOM",
    first_spoken_line: "Star Wars Zero Company is trying to be more than Star Wars XCOM.",
    narration_script:
      "Star Wars Zero Company is trying to be more than Star Wars XCOM. PC Gamer reports the game mixes turn-based tactics with crew pressure. That is the angle to watch when longer footage lands.",
    description:
      "PC Gamer reports Star Wars Zero Company mixes turn-based tactics with crew pressure. Source: PC Gamer.",
    primary_source: "PC Gamer",
    source_card_label: "PC Gamer",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks deterministic vague-tease repair narration", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Pragmata",
    selected_title: "Pragmata's AI-Look Stage Was Handmade",
    first_spoken_line: "Pragmata's AI-looking stage was actually handmade by developers.",
    narration_script:
      "Pragmata's AI-looking stage was actually handmade by developers. Automaton Media reports Pragmata's New York stage was handmade by developers to look AI generated. Pragmata now has a real detail on the table, which is better than another vague tease. Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "Pragmata's New York stage was handmade to look AI generated. Source: Automaton Media.",
    primary_source: "Automaton Media",
    confirmed_claims: [
      "Pragmata's New York stage was handmade by developers to look AI generated.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:formulaic_public_narration"));
});

test("goal public copy QA blocks transcript lines that sound like production notes", () => {
  const badLines = [
    "The news is simple: this moved from title-card promise to actual gameplay people can judge.",
    "Warhammer 40,000 just turned the Warhammer showcase into a player watchlist story.",
    "The first gameplay cut gives players something firmer than another logo reveal.",
    "The pressure is whether this changes the version people were actually about to pick up.",
    "Boltgun has a clearer public hook now, and that is the bit players will argue over.",
    "The tension is who benefits if the sequel lands: the studio, the publisher or the people who actually built it.",
    "The pressure is bigger than launch quality: studio control, publisher timing and a huge payout are all colliding in public.",
    "The argument is whether this changes what players do next.",
    "The question now is whether the full game has the same deliberate weirdness once players are moving through it.",
  ];

  for (const line of badLines) {
    const report = evaluateGoalPublicCopy({
      canonical_subject: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
      narration_script:
        `The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed the game during Xbox Partner Preview. ${line}`,
      description: "Xbox showed The Expanse: Osiris Reborn gameplay. Source: Xbox.",
      primary_source: "Xbox",
      confirmed_claims: [
        "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
      ],
    });

    assert.equal(report.verdict, "fail", line);
    assert.ok(report.failures.includes("public_copy:formulaic_public_narration"), line);
  }
});

test("goal public copy QA blocks cross-story jobs-market residue on non-jobs stories", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Subnautica 2",
    selected_title: "Subnautica 2 Dev Calls Out Leakers",
    first_spoken_line: "Subnautica 2's developer is already fighting leaked builds.",
    narration_script:
      "Subnautica 2's developer is already fighting leaked builds. Respawnfirst reports A Subnautica 2 developer responded after leaked builds started spreading before launch. Subnautica 2 is the familiar name attached to a brutal jobs story. When a composer with Deus Ex and Unreal credits is sending dozens of resumes, the market problem stops sounding abstract. Follow Pulse Gaming for the gaming stories behind the headline.",
    description: "A Subnautica 2 developer responded to leaked builds. Source: Respawnfirst.",
    primary_source: "Respawnfirst",
    confirmed_claims: [
      "A Subnautica 2 developer responded after leaked builds started spreading before launch.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:cross_story_residue"));
});

test("goal public copy QA blocks truncated YouTube host labels as reporting sources", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Stranger Than Heaven",
    canonical_company: "Xbox",
    selected_title: "Stranger Than Heaven Shows Five Eras",
    first_spoken_line: "Stranger Than Heaven just showed its five-era setup.",
    narration_script:
      "Stranger Than Heaven just showed its five-era setup. Youtu reports STRANGER THAN HEAVEN Five Eras Reveal Trailer at Xbox Partner Preview.",
    description: "Stranger Than Heaven showed its Five Eras trailer. Source: Youtu.",
    primary_source: "Youtu",
    primary_source_url: "https://www.youtube.com/watch?v=example",
    confirmed_claims: [
      "STRANGER THAN HEAVEN showed a Five Eras reveal trailer at Xbox Partner Preview.",
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:platform_host_source_label"));
  assert.ok(report.failures.includes("public_copy:platform_host_reporting_language"));
});

test("goal public copy QA blocks source labels that disagree with source URLs", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Finally Hit Steam",
    first_spoken_line: "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
    narration_script:
      "Forza Horizon 6 just turned its Steam launch into an Xbox signal. Xbox reports Forza Horizon 6 is available now on Steam.",
    description: "Forza Horizon 6 is available now on Steam. Source: Xbox.",
    primary_source: "Xbox",
    source_card_label: "Xbox",
    primary_source_url: "https://store.steampowered.com/app/2483190/Forza_Horizon_6/",
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("public_copy:source_url_label_mismatch"));
});

test("goal public copy QA ignores boilerplate disclosure captions for subject parity", () => {
  const report = evaluateGoalPublicCopy({
    canonical_subject: "Spellcasters Chronicles",
    selected_title: "Spellcasters Chronicles Is Shutting Down",
    first_spoken_line: "Spellcasters Chronicles is shutting down only months after early access.",
    narration_script:
      "Spellcasters Chronicles is shutting down only months after early access. Eurogamer reports the shutdown timing.",
    description:
      "Spellcasters Chronicles is shutting down only months after early access. Source: Eurogamer.",
    primary_source: "Eurogamer",
    platform_publish_manifest: {
      outputs: {
        youtube_shorts: {
          title: "Spellcasters Chronicles Is Shutting Down",
          description:
            "Spellcasters Chronicles is shutting down only months after early access. Source: Eurogamer.",
          disclosure_status: {
            required: false,
            caption: "No commercial link attached.",
          },
        },
        instagram_reels: {
          caption: "Spellcasters Chronicles is shutting down only months after early access.",
          disclosure_status: {
            required: false,
            caption: "No commercial link attached.",
          },
        },
      },
    },
  });

  assert.equal(report.verdict, "pass", report.failures.join(", "));
});
