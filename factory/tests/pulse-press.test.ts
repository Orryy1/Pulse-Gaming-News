import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestSeller,
  coverLook,
  fitsPulseMonthly,
  fitsPulseStore,
  fitsPulseTV,
  pressCredit,
  storeCase,
  storeLook,
  tvLook,
} from "../src/render/components/packs/pulse/pressKit.ts";
import { STYLES } from "../src/render/components/packs/pulse/press.ts";
import { inEra } from "../src/render/components/packs/types.ts";

const head = (primary: string, secondary = "PC Zone, 1997") =>
  ({ kind: "headline", primary, secondary, items: [] }) as never;
const stat = (primary: string, secondary: string) =>
  ({ kind: "stat", primary, secondary, items: [] }) as never;

test("a press credit gives the outlet and only the credit's own year", () => {
  assert.deepEqual(
    pressCredit(head("MP calls for a ban", "The Guardian, 2005")),
    {
      credit: "The Guardian, 2005",
      outlet: "The Guardian",
      year: 2005,
    },
  );
  // A bare year names no outlet, so there is no STORY strip.
  assert.equal(
    pressCredit(head("Grand Theft Auto tops the charts", "1998")).outlet,
    undefined,
  );
  assert.equal(
    pressCredit(head("Grand Theft Auto tops the charts", "1998")).year,
    1998,
  );
  // A year inside the headline is not the cover date.
  assert.equal(
    pressCredit(head("GTA IV delayed to 2008", "IGN")).year,
    undefined,
  );
  assert.equal(
    pressCredit(head("GTA IV delayed to 2008", "IGN")).outlet,
    "IGN",
  );
});

test("Pulse Monthly takes headlines of 4 to 12 words and nothing else", () => {
  assert.equal(
    fitsPulseMonthly(head("MP calls for Grand Theft Auto ban")),
    true,
  );
  assert.equal(fitsPulseMonthly(head("GTA banned")), false);
  assert.equal(fitsPulseMonthly(head("Three word headline")), false);
  assert.equal(
    fitsPulseMonthly(
      head(
        "one two three four five six seven eight nine ten eleven twelve thirteen",
      ),
    ),
    false,
  );
  assert.equal(
    fitsPulseMonthly(head("MP calls for Grand Theft Auto ban", "x".repeat(60))),
    false,
  );
  // A quote or a stat is never a cover line.
  assert.equal(
    fitsPulseMonthly({
      kind: "quote",
      primary: "We wanted to make a game about crime",
      secondary: "Dan Houser, Rockstar co-founder",
      items: [],
    } as never),
    false,
  );
  assert.equal(fitsPulseMonthly(stat("17 million", "copies sold")), false);
});

test("Pulse TV takes headlines of 3 to 14 words with a short credit", () => {
  assert.equal(fitsPulseTV(head("GTA III delayed")), true);
  assert.equal(fitsPulseTV(head("GTA")), false);
  assert.equal(fitsPulseTV(head("a ".repeat(15).trim())), false);
  assert.equal(
    fitsPulseTV(head("MP calls for Grand Theft Auto ban", "y".repeat(50))),
    false,
  );
  assert.equal(fitsPulseTV(stat("17 million", "copies sold")), false);
});

test("Pulse Store draws only a price or a sales figure", () => {
  assert.equal(storeCase(stat("$59.99", "GTA V launch price")), "price");
  assert.equal(storeCase(stat("£39.99", "retail price in Britain")), "price");
  assert.equal(storeCase(stat("60 dollars", "what the game costs")), "price");
  assert.equal(storeCase(stat("17 million", "copies sold in a week")), "sales");
  assert.equal(storeCase(stat("$800 million", "first-day sales")), "sales");
  assert.equal(storeCase(stat("25 million", "units shipped")), "sales");
  // A price word without a currency in the figure is not a price, and has no sales word either.
  assert.equal(storeCase(stat("60", "launch price")), undefined);
  // Other stats: not the shop's.
  assert.equal(
    storeCase(stat("$265 million", "development budget")),
    undefined,
  );
  assert.equal(storeCase(stat("1,000", "staff at Rockstar North")), undefined);
  assert.equal(
    storeCase(stat("90 million", "trailer views in a day")),
    undefined,
  );
  assert.equal(storeCase(stat("many", "copies sold")), undefined);
  assert.equal(storeCase(stat("17 million", "sold")), undefined);
  assert.equal(
    storeCase(head("GTA V sells 11 million copies", "copies sold")),
    undefined,
  );
  assert.equal(fitsPulseStore(stat("$59.99", "GTA V launch price")), true);
  assert.equal(
    fitsPulseStore(stat("$265 million", "development budget")),
    false,
  );
});

test("a sales ribbon says BEST SELLER only for millions of copies", () => {
  assert.equal(bestSeller(stat("17 million", "copies sold")), true);
  assert.equal(bestSeller(stat("1,200,000", "units sold")), true);
  assert.equal(bestSeller(stat("200,000", "copies sold")), false);
  assert.equal(bestSeller(stat("$800 million", "first-day sales")), false);
  assert.equal(bestSeller(stat("25 million", "first-week sales")), false);
});

test("each press look keeps to its years", () => {
  assert.deepEqual([1987, 1995, 2004].map(coverLook), [
    "eighties",
    "nineties",
    "glossy",
  ]);
  assert.deepEqual([1990, 1997].map(tvLook), ["wood", "plastic"]);
  assert.deepEqual([1997, 2004, 2013, 2020].map(storeLook), [
    "bigbox",
    "case",
    "glossy",
    "flat",
  ]);
  const { PulseMonthly, PulseTV, PulseStore } = STYLES;
  assert.equal(inEra(PulseMonthly!, 2009), true);
  assert.equal(inEra(PulseMonthly!, 2010), false);
  assert.equal(inEra(PulseTV!, 2005), true);
  assert.equal(inEra(PulseTV!, 2006), false);
  assert.equal(inEra(PulseStore!, 2023), true);
  assert.equal(inEra(PulseStore!, 1975), false);
  assert.deepEqual(
    Object.values(STYLES).map((s) => s.kind),
    ["headline", "headline", "stat"],
  );
});
