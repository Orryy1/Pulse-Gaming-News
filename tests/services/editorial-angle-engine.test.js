"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildEditorialAngle,
  buildAngleFirstScript,
} = require("../../lib/editorial-angle-engine");
const {
  buildSourceBoundFallbackScript,
} = require("../../lib/source-bound-script-writer");
const { lintScript } = require("../../lib/services/script-lint");
const { runScriptCoherenceQa } = require("../../lib/script-coherence-qa");

const LOCAL_PROFILE = {
  provider: "local",
  secondsPerWord: 0.34,
  minWords: 180,
  maxWords: 220,
  aimMin: 190,
  aimMax: 210,
};

const FORZA_STORY = {
  id: "1tftq7f",
  title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
  source_type: "reddit",
  subreddit: "PCMasterRace",
  article_url:
    "https://twistedvoxel.com/forza-horizon-6-becomes-highest-rated-game-of-2026-on-metacritic/",
};

const FORZA_SOURCE =
  "Twisted Voxel reports Forza Horizon 6 has moved into the top spot on Metacritic for 2026 releases, earning an aggregate score of 92 and surpassing Pokemon Pokopia, which currently sits at 89. " +
  "Forza Horizon 6 has also posted strong numbers on Steam ahead of its full release. The game reached an all-time peak of 178,009 concurrent users despite currently being limited to early access buyers via the Premium Edition, priced at $120. The standard launch is scheduled for May 19.";

const INSTRUCTION_LIKE_PUBLIC_SCRIPT_RE =
  /keep the claim tight|anything not backed by the named source|outside the script|useful version is narrow|what players can do with the information|decision filter|useful take is not blind hype|if the source is right|cleaner test|marketing line/i;

test("editorial angle engine turns source facts into a retention-first Forza angle", () => {
  const angle = buildEditorialAngle(FORZA_STORY, {
    sourceMaterial: FORZA_SOURCE,
    sourceName: "Twisted Voxel",
  });

  assert.equal(angle.lane, "status_money");
  assert.match(angle.hook, /Xbox/i);
  assert.match(angle.hook, /needed/i);
  assert.match(angle.tension, /92/);
  assert.match(angle.tension, /178,009/);
  assert.match(`${angle.tension} ${angle.stakes}`, /\$120/);
  assert.match(angle.payoff, /cleanest first-party win/i);
  assert.doesNotMatch(
    `${angle.hook} ${angle.tension} ${angle.stakes} ${angle.payoff}`,
    /clean read|broader launch data|not a blank cheque|wait-and-see/i,
  );
});

test("angle-first script keeps source-safe facts but adds hook, tension and payoff", () => {
  const script = buildAngleFirstScript(FORZA_STORY, {
    sourceMaterial: FORZA_SOURCE,
    sourceName: "Twisted Voxel",
    runtimeProfile: LOCAL_PROFILE,
  });

  assert.ok(script);
  assert.equal(script.classification, "[CONFIRMED]");
  assert.match(script.hook, /Xbox/i);
  assert.match(script.full_script, /92/);
  assert.match(script.full_script, /178,009/);
  assert.match(script.full_script, /\$120/);
  assert.match(script.full_script, /cleanest first-party win/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(script.full_script, /clean read|broader launch data|source-backed update/i);
  assert.ok(script.word_count >= LOCAL_PROFILE.minWords && script.word_count <= LOCAL_PROFILE.maxWords);

  const coherence = runScriptCoherenceQa(
    { ...FORZA_STORY, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));

  const lint = lintScript(script.full_script, {
    minWords: LOCAL_PROFILE.minWords,
    maxWords: LOCAL_PROFILE.maxWords,
  });
  assert.notEqual(lint.result, "fail", lint.failures.join(", "));
});

test("source-bound fallback uses angle-first script before conservative recap prose", () => {
  const script = buildSourceBoundFallbackScript(FORZA_STORY, {
    sourceMaterial: FORZA_SOURCE,
    sourceName: "Twisted Voxel",
    runtimeProfile: LOCAL_PROFILE,
  });

  assert.ok(script);
  assert.equal(script.script_source, "angle_first_source_bound_fallback");
  assert.match(script.hook, /Xbox/i);
  assert.match(script.full_script, /cleanest first-party win/i);
  assert.doesNotMatch(script.full_script, /So the clean read is this|broader launch data/i);
});

test("angle-first script does not read like a public copy instruction sheet", () => {
  const story = {
    id: "resident_evil_requiem_preview",
    title: "Resident Evil Requiem shows new first-person gameplay in latest preview",
    source_type: "reddit",
    subreddit: "Games",
    article_url:
      "https://www.ign.com/articles/resident-evil-requiem-preview-first-person-gameplay",
  };

  const script = buildAngleFirstScript(story, {
    sourceMaterial:
      "IGN reports Resident Evil Requiem has new first-person gameplay footage, with a closer look at exploration, lighting and survival-horror pacing.",
    sourceName: "IGN",
    runtimeProfile: LOCAL_PROFILE,
  });

  assert.ok(script);
  assert.match(script.full_script, /Resident Evil Requiem/i);
  assert.match(script.full_script, /IGN/i);
  assert.doesNotMatch(script.full_script, INSTRUCTION_LIKE_PUBLIC_SCRIPT_RE);
});

test("script lint blocks boring source-bound recap language", () => {
  const boring =
    "Forza Horizon 6 just grabbed the year's top review-score slot. " +
    "Twisted Voxel says it now leads Metacritic's 2026 list with a 92 aggregate, ahead of Pokemon Pokopia at 89. " +
    "That is the real headline: a critic-score lead, not proof of total sales or long-term player retention. " +
    "The same report cites a SteamDB peak of 178,009 concurrent users during Premium Edition early access, priced at $120, so the Steam signal is strong but narrow. " +
    "Standard launch and Game Pass can change the picture fast. " +
    "What matters is whether the praised Japan setting, visuals and driving model still hold up once the wider audience arrives. " +
    "So the clean read is this: Forza Horizon 6 has critic momentum and a visible early-access spike, but the final verdict needs broader launch data. " +
    "Follow Pulse Gaming so you never miss a beat.";

  const lint = lintScript(boring, {
    minWords: 110,
    maxWords: 220,
  });

  assert.equal(lint.result, "fail");
  assert.ok(
    lint.failures.some((failure) => failure.includes("boring_source_bound_recap")),
    lint.failures.join(", "),
  );
});
