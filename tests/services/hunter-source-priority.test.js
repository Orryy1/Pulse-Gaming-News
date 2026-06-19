const test = require("node:test");
const assert = require("node:assert/strict");

const { scoreBreakingValue } = require("../../hunter");

const BREAKING_KEYWORDS = [
  "announced",
  "revealed",
  "confirmed",
  "trailer",
  "gameplay",
  "update",
  "xbox",
  "gta 6",
];

test("scoreBreakingValue prioritises fresh official platform stories over speculative community rumours", () => {
  const officialScore = scoreBreakingValue(
    "Granblue Fantasy: Relink - Endless Ragnarok hands-on report, demo available today",
    50,
    0,
    BREAKING_KEYWORDS,
    [],
    { sourceType: "rss", sourceName: "PlayStation Blog" },
  );
  const speculativeScore = scoreBreakingValue(
    "Steam Machine release date and price announcement possibly coming this month",
    300,
    0,
    BREAKING_KEYWORDS,
    [],
    { sourceType: "reddit", sourceName: "GamingLeaksAndRumours" },
  );

  assert.ok(
    officialScore > speculativeScore,
    `expected official score ${officialScore} to beat speculative score ${speculativeScore}`,
  );
});
