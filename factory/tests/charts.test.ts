import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickClimbers,
  parseNews,
  climbLabel,
} from "../src/discovery/charts.ts";
import { groundClimbers } from "../src/pipeline.ts";
import { evergreenToScript } from "../src/editorial/evergreen.ts";

test("climbers: most places gained first, new entries counted from 101, small moves ignored", () => {
  const rows = [
    { rank: 1, appid: 730, last_week_rank: 1, peak_in_game: 1_300_000 },
    { rank: 17, appid: 1, last_week_rank: 53, peak_in_game: 108_551 },
    { rank: 35, appid: 2, last_week_rank: -1, peak_in_game: 102_491 },
    { rank: 20, appid: 3, last_week_rank: 22, peak_in_game: 70_000 },
    { rank: 90, appid: 4, last_week_rank: 99, peak_in_game: 10_000 },
  ];
  const c = pickClimbers(rows);
  assert.deepEqual(
    c.map((x) => x.appid),
    [2, 1, 4],
  );
  assert.equal(c[0]!.climb, 66);
  assert.equal(c[0]!.isNew, true);
  assert.equal(
    climbLabel({ rank: 35, lastRank: undefined, climb: 66 }),
    "NEW AT #35",
  );
  assert.equal(
    climbLabel({ rank: 17, lastRank: 53, climb: 36 }),
    "UP 36 TO #17",
  );
});

test("Steam news: the publisher's own recent announcements, cleaned", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const day = (d: string) => Date.parse(d) / 1000;
  const json = {
    appnews: {
      newsitems: [
        {
          title: "Season 3 is live",
          contents: "[b]Big[/b] update https://x.y/z with new maps",
          date: day("2026-10-15"),
          feed_type: 1,
          feedname: "steam_community_announcements",
        },
        {
          title: "Review roundup",
          contents: "PC Gamer says",
          date: day("2026-10-16"),
          feed_type: 0,
          feedname: "pcgamer",
        },
        {
          title: "Old patch",
          contents: "ancient",
          date: day("2026-08-01"),
          feed_type: 1,
        },
      ],
    },
  };
  assert.deepEqual(parseNews(json, now), [
    "Season 3 is live (2026-10-15): Big update with new maps",
  ]);
});

test("climber entries take Steam's numbers and rank by climb, unknown games dropped", () => {
  const entry = (rank: number, game_title: string) => ({
    rank,
    game_title,
    steam_search_term: game_title,
    year: 1999,
    platforms: "PC",
    one_line: "x",
    verdict_chip: "HOT",
    footage: { want: "gameplay" as const, keywords: [game_title] },
    peak: undefined as number | undefined,
  });
  const draft = {
    entries: [
      entry(1, "Call of Duty®"),
      entry(2, "Made Up Game"),
      entry(3, "ARC Raiders"),
    ],
  };
  const grounded = groundClimbers(draft, [
    { name: "ARC Raiders", rank: 35, climb: 66, peak: 102_491, year: 2025 },
    {
      name: "Call of Duty®",
      rank: 17,
      lastRank: 53,
      climb: 36,
      peak: 108_551,
      year: 2022,
    },
  ]);
  assert.deepEqual(
    grounded.entries.map((e) => [
      e.rank,
      e.game_title,
      e.platforms,
      e.peak,
      e.year,
    ]),
    [
      [1, "ARC Raiders", "NEW AT #35", 102_491, 2025],
      [2, "Call of Duty", "UP 36 TO #17", 108_551, 2022],
    ],
  );
});

test("the climber card shows the climb and the peak", () => {
  const s = evergreenToScript({
    format: "steam_climbers",
    theme: "Steam charts",
    title: "Exploded on Steam",
    hook: "These games just exploded on Steam.",
    entries: [1, 2, 3, 4].map((rank) => ({
      rank,
      game_title: `Game ${rank}`,
      steam_search_term: `Game ${rank}`,
      year: 2024,
      platforms: `UP ${10 * rank} TO #${rank}`,
      one_line: "A big update landed.",
      verdict_chip: "HOT",
      footage: { want: "gameplay" as const, keywords: ["x"] },
      peak: 12345 * rank,
    })),
    pulse_take: { label: "OUR PICK", narration: "x", on_screen: "x" },
    loop_line: "x",
    youtube: { title: "t", description: "d", tags: [] },
    claims: [],
  } as any);
  assert.deepEqual(s.beats[0]!.visual.items, [
    "UP 40 TO #4",
    "49,380 peak players",
  ]);
  assert.equal(s.evergreen_format, "steam_climbers");
});
