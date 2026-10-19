import { test } from "node:test";
import assert from "node:assert/strict";
import { dealScore } from "../src/discovery/deals.ts";
import { euro, groundDeals } from "../src/pipeline.ts";
import { evergreenToScript } from "../src/editorial/evergreen.ts";

test("deals: euro prices read the English way", () => {
  assert.equal(euro("5,99€"), "€5.99");
  assert.equal(euro("1.299,00€"), "€1299.00");
  assert.equal(euro("€5.99"), "€5.99");
});

test("deals: a big cut on a loved game beats a small cut on a bigger one", () => {
  assert.ok(
    dealScore({ pct: 90, rating: 91, reviews: 144_000 }) >
      dealScore({ pct: 50, rating: 97, reviews: 400_000 }),
  );
  assert.ok(
    dealScore({ pct: 75, rating: 96, reviews: 40_000 }) >
      dealScore({ pct: 75, rating: 70, reviews: 40_000 }),
  );
});

test("deal entries take Steam's prices and drop games not in the data", () => {
  const entry = (rank: number, game_title: string) => ({
    rank,
    game_title,
    steam_search_term: game_title,
    platforms: "PC",
    year: 2000,
    verdict_chip: "GREAT",
    price: undefined as string | undefined,
    was: undefined as string | undefined,
  });
  const grounded = groundDeals(
    {
      entries: [
        entry(1, "Hogwarts Legacy"),
        entry(2, "Made Up Game"),
        entry(3, "Dishonored®"),
      ],
    },
    [
      {
        appId: 1,
        name: "Hogwarts Legacy",
        year: 2023,
        usd: { final: "$5.99", initial: "$59.99", pct: 90 },
        gbp: "£4.99",
        eur: "5,99€",
        rating: 91,
        reviews: 144_380,
      },
      {
        appId: 2,
        name: "Dishonored",
        year: 2012,
        usd: { final: "$2.49", initial: "$9.99", pct: 75 },
        rating: 97,
        reviews: 40_010,
      },
    ],
  );
  assert.deepEqual(
    grounded.entries.map((e) => [e.rank, e.game_title, e.year, e.price, e.was]),
    [
      [
        1,
        "Hogwarts Legacy",
        2023,
        "$5.99 · £4.99 · €5.99",
        "WAS $59.99 · 90% OFF",
      ],
      [2, "Dishonored", 2012, "$2.49", "WAS $9.99 · 75% OFF"],
    ],
  );
});

test("the deal card shows the price and the cut", () => {
  const s = evergreenToScript({
    format: "steam_deals",
    theme: "Steam deals",
    title: "Steam Games on Sale",
    hook: "These great Steam games cost less than a sandwich right now.",
    entries: [1, 2, 3, 4].map((rank) => ({
      rank,
      game_title: `Game ${rank}`,
      steam_search_term: `Game ${rank}`,
      year: 2020,
      platforms: "PC (Steam)",
      one_line: "A classic, down to $2.49.",
      verdict_chip: "GRAB IT",
      footage: { want: "gameplay" as const, keywords: ["x"] },
      price: `$${rank}.99 · £${rank}.49`,
      was: `WAS $19.99 · 80% OFF`,
    })),
    pulse_take: { label: "OUR PICK", narration: "x", on_screen: "x" },
    loop_line: "x",
    youtube: { title: "t", description: "d", tags: [] },
    claims: [],
  } as any);
  assert.deepEqual(s.beats[0]!.visual.items, [
    "$4.99 · £4.49",
    "WAS $19.99 · 80% OFF",
  ]);
  assert.equal(s.evergreen_format, "steam_deals");
});
