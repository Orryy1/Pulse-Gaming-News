import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIT_MAX,
  KIT_MIN,
  cashIn,
  cashText,
  isGtaStory,
  kitCall,
  kitTexts,
  placeIn,
  planGtaKit,
  versusIn,
  voicedLines,
  type GtaKitInput,
  type KitLine,
} from "../src/render/gtakit.ts";
import { cashAt, cashProgress, placeBlock } from "../src/render/components/GtaKit.tsx";
import { checksClearOfUpgrades } from "../src/render/shortupgrades.ts";
import { speakable } from "../src/voice/speakable.ts";
import {
  gtaKitInput,
  longGtaKitProp,
  shortGtaKit,
  shortUpgradesFor,
} from "../src/shortupgradestep.ts";
import type { Segment } from "../src/render/timeline.ts";
import { testConfig, tmpDir } from "./helpers.ts";

const FPS = 30;
const KIT: GtaKitInput = {
  region: "Leonida",
  places: [
    { name: "Vice City", kind: "city" },
    { name: "Vice City International Airport", kind: "landmark" },
    { name: "Grassrivers", kind: "region" },
    { name: "Downtown", kind: "district", ambiguous: true },
  ],
};

function wordsOf(
  segments: Array<{ text: string; start: number; end: number }>,
) {
  return segments.flatMap((s) => {
    const ws = s.text.split(/\s+/).filter(Boolean);
    const step = (s.end - s.start) / ws.length;
    return ws.map((text, i) => ({
      text,
      start: s.start + i * step,
      end: s.start + (i + 0.8) * step,
    }));
  });
}

test("only GTA stories", () => {
  assert.equal(isGtaStory("Grand Theft Auto VI"), true);
  assert.equal(isGtaStory("GTA 6"), true);
  assert.equal(isGtaStory("Red Dead Redemption 2"), false);
  assert.equal(isGtaStory(""), false);
});

test("places: as the map prints them, the longer name first, never the 2002 game, ambiguous ones after a place word", () => {
  assert.equal(
    placeIn("You land in Vice City at dusk.", KIT.places)?.place.name,
    "Vice City",
  );
  assert.equal(
    placeIn("Flights leave Vice City International Airport hourly.", KIT.places)
      ?.place.name,
    "Vice City International Airport",
  );
  assert.equal(
    placeIn("Grand Theft Auto: Vice City turns 24.", KIT.places),
    undefined,
  );
  assert.equal(
    placeIn("Vice City Stories is not on the list.", KIT.places),
    undefined,
  );
  assert.equal(placeIn("Downtown traffic is awful.", KIT.places), undefined);
  assert.equal(
    placeIn("The bank job is in Downtown.", KIT.places)?.place.name,
    "Downtown",
  );
  assert.equal(
    placeIn("a vice city vibe", KIT.places),
    undefined,
    "capitals matter: the map prints them",
  );
});

test("cash: the figure as said, with what it is, or nothing", () => {
  assert.deepEqual(cashIn("Rockstar spent $2 billion making it."), {
    value: 2,
    unit: "BILLION",
    decimals: 0,
    text: "$2 BILLION",
    label: "BUDGET",
    said: "$2 billion",
  });
  const bn = cashIn("It made $1.5bn on day one.")!;
  assert.equal(bn.text, "$1.5 BILLION");
  assert.equal(bn.label, "EARNED");
  assert.equal(cashIn("The standard edition costs $69.99.")?.text, "$69.99");
  assert.equal(cashIn("The standard edition costs $69.99.")?.label, "PRICE");
  assert.equal(
    cashIn("It sold for $70 at launch.")?.label,
    "PRICE",
    "sold for is a price",
  );
  assert.equal(cashIn("Take-Two earned $1 trillion.")?.text, "$1 TRILLION");
  assert.equal(
    cashIn("Take-Two earned $3 quadrillion."),
    undefined,
    "a unit it does not know",
  );
  assert.equal(
    cashIn("It earned $12.345 billion."),
    undefined,
    "the voice rounds that",
  );
  assert.equal(
    cashIn("There is $5 million in the vault."),
    undefined,
    "no word says what the figure is",
  );
  assert.equal(cashIn("It costs a fortune."), undefined);
  assert.equal(cashText(1250000), "$1,250,000");
});

test("cash: the label comes from the words round the figure, the nearest first", () => {
  const two = cashIn(
    "The game made $1.2 billion in its first day, more than the $265 million budget.",
  )!;
  assert.equal(two.label, "EARNED");
  assert.equal(two.text, "$1.2 BILLION");
  assert.equal(
    cashIn("Its development costs topped $2 billion.")?.label,
    "BUDGET",
  );
  assert.equal(cashIn("It costs $70 and made headlines.")?.label, "PRICE");
  assert.equal(
    cashIn("Fans spent $70 on the special edition, a lot."),
    undefined,
  );
  assert.equal(
    cashIn(
      "Rockstar made a point of it: the edition everyone wanted was $70 again.",
    ),
    undefined,
    "a made far from the figure says nothing about it",
  );
});

test("cash: planned from the words as voiced, so the screen says what the narrator says", () => {
  const script = "The standard edition costs $69.99 at launch.";
  const spoken = speakable(script)
    .split(/\s+/)
    .map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const [line] = voicedLines([{ start: 0, end: 10 }], spoken);
  const c = cashIn(line!.text)!;
  assert.equal(c.text, "$70", `the voice says ${speakable("$69.99")}`);
  const big = speakable("Rockstar spent $1.5bn making it.")
    .split(/\s+/)
    .map((text, i) => ({ text, start: i, end: i + 0.5 }));
  assert.equal(
    cashIn(voicedLines([{ start: 0, end: 99 }], big)[0]!.text)?.text,
    "$1.5 BILLION",
  );
});

test("cash readout: counts in the finished figure's shape and lands on the word", () => {
  assert.equal(cashProgress(0, 24), 0);
  assert.equal(cashProgress(24, 24), 1);
  assert.equal(cashProgress(40, 24), 1);
  assert.ok(cashProgress(12, 24) > 0 && cashProgress(12, 24) < 1);
  assert.equal(cashAt(69.99, 2, "", 1), "$69.99");
  assert.equal(cashAt(1.5, 1, "BILLION", 1), "$1.5 BILLION");
  assert.equal(cashAt(2, 0, "BILLION", 0.5), "$1 BILLION");
  assert.equal(cashAt(1250000, 0, "", 0.5), "$625,000");
  assert.match(cashAt(69.99, 2, "", 0.5), /^\$\d+\.\d\d$/);
});

test("place card: every name in the Leonida table fits its plate, tall and wide, at the entry tracking", () => {
  const names = gtaKitInput("GTA 6").places.flatMap((p) => [
    p.name,
    ...(p.aliases ?? []),
  ]);
  assert.ok(names.length > 10);
  for (const n of [
    ...names,
    "VICE CITY INTERNATIONAL AIRPORT",
    "MOUNT KALAGA NATIONAL PARK",
  ])
    for (const tall of [true, false]) {
      const b = placeBlock(n.toUpperCase(), tall);
      assert.ok(b.fits, `${n} ${tall ? "tall" : "wide"}`);
      assert.ok(b.lines.length <= 2);
    }
});

test("QA: a card the kit stands in for is not sampled, and the kit's words are graphics", () => {
  const checks = [
    { key: "card1", t: 4 },
    { key: "card2", t: 9 },
  ];
  const up = {
    kit: [
      {
        key: "kit1",
        from: 100,
        len: 90,
        at: 10,
        line: 1,
        replacesCard: true,
        data: {
          kind: "place" as const,
          name: "Vice City",
          region: "Leonida",
          label: "CITY",
        },
      },
    ],
  };
  assert.deepEqual(checksClearOfUpgrades(checks, up, 30), [
    { key: "card2", t: 9 },
  ]);
  assert.deepEqual(kitTexts(up.kit[0]!.data), ["Vice City", "Leonida", "CITY"]);
  assert.deepEqual(
    kitTexts({ kind: "versus", left: "GTA 5", right: "GTA 6" }),
    ["GTA 5", "GTA 6", "VS"],
  );
});
test("versus: two known names right round the cue", () => {
  assert.deepEqual(versusIn("It is GTA 5 versus GTA 6 on the same street."), {
    left: "GTA 5",
    right: "GTA 6",
    saidRight: "GTA 6",
  });
  assert.equal(versusIn("Jason vs Lucia: who drives?")?.right, "Lucia");
  assert.equal(
    versusIn("The PS5 Pro compared to the Series X runs smoother.")?.left,
    "PS5 Pro",
  );
  assert.equal(
    versusIn("Jason versus the whole of Leonida."),
    undefined,
    "a name on each side",
  );
  assert.equal(versusIn("GTA 6 versus GTA 6."), undefined);
  assert.equal(
    versusIn("Jason and Lucia team up."),
    undefined,
    "no cue, no card",
  );
});

test("a line calls for one thing: a place before a figure, a face-off over a place it names", () => {
  assert.equal(
    kitCall("Rockstar spent $2 billion building Vice City.", KIT)?.data.kind,
    "place",
  );
  assert.equal(
    kitCall("Rockstar spent $2 billion making it.", KIT)?.data.kind,
    "cash",
  );
  assert.equal(
    kitCall("GTA 5 versus GTA 6 in Vice City.", KIT)?.data.kind,
    "versus",
  );
  assert.equal(kitCall("Nothing to see here.", KIT), undefined);
  const place = kitCall("You wake up in Grassrivers.", KIT)!;
  assert.deepEqual(place.data, {
    kind: "place",
    name: "Grassrivers",
    region: "Leonida",
    label: "REGION",
  });
});

const lines: KitLine[] = [
  { start: 0, end: 3, text: "Hook line in Vice City." },
  { start: 3, end: 7, text: "Now you are in Vice City for real." },
  { start: 7, end: 11, text: "Rockstar spent $2 billion to make it." },
  { start: 11, end: 15, text: "It is GTA 5 versus GTA 6 now." },
  { start: 15, end: 19, text: "Then Grassrivers, the swamp." },
];
const words = wordsOf(lines);
const wordAt = (i: number, key: string) => {
  const first = key.split(/\s+/)[0]!.toLowerCase();
  return words.find(
    (w) =>
      w.start >= lines[i]!.start - 0.01 &&
      w.start < lines[i]!.end &&
      w.text.toLowerCase().startsWith(first),
  )?.start;
};
const base = {
  lines,
  kit: KIT,
  wordAt,
  fps: FPS,
  startAfter: 90,
  endBefore: 19 * FPS,
  taken: [],
  max: 6,
  gapSeconds: 0,
};

test("plan: never in the hook, on its word, read in full, inside its line", () => {
  const plan = planGtaKit(base);
  assert.deepEqual(
    plan.map((m) => [m.line, m.data.kind]),
    [
      [1, "place"],
      [2, "cash"],
      [3, "versus"],
      [4, "place"],
    ],
  );
  for (const m of plan) {
    assert.ok(m.from >= 90);
    assert.ok(m.len >= KIT_MIN && m.len <= KIT_MAX);
    assert.ok(
      m.at >= 0 && m.at < m.len - 30,
      "its word lands with time left to read",
    );
    assert.ok(m.from + m.len <= Math.round((lines[m.line]!.end + 0.5) * FPS));
  }
});

test("plan: the cap and the gap", () => {
  assert.equal(planGtaKit({ ...base, max: 2 }).length, 2);
  const gapped = planGtaKit({ ...base, gapSeconds: 4 });
  for (let k = 1; k < gapped.length; k++)
    assert.ok(
      gapped[k]!.from - (gapped[k - 1]!.from + gapped[k - 1]!.len) >= 4 * FPS,
    );
});

test("plan: never over another overlay; a line's own card is the one thing it stands in for", () => {
  const cash = planGtaKit(base).find((m) => m.line === 2)!;
  const blocked = planGtaKit({
    ...base,
    taken: [{ kind: "stamp", from: cash.from, to: cash.from + 60 }],
  });
  assert.equal(
    blocked.find((m) => m.line === 2),
    undefined,
  );
  const carded = planGtaKit({
    ...base,
    taken: [{ kind: "card", key: "card2", from: 7 * FPS, to: 11 * FPS }],
    card: (i) => `card${i}`,
  }).find((m) => m.line === 2)!;
  assert.equal(carded.replacesCard, true);
  const others = planGtaKit({ ...base, card: (i) => `card${i}` });
  assert.ok(
    others.every((m) => !m.replacesCard),
    "no card in the way, nothing to replace",
  );
});

test("plan: a short line gives nothing rather than a graphic too quick to read", () => {
  const quick: KitLine[] = [{ start: 4, end: 5, text: "In Vice City." }];
  assert.deepEqual(
    planGtaKit({
      ...base,
      lines: quick,
      wordAt: () => 4.2,
      taken: [{ kind: "card", from: 5.6 * FPS, to: 999 }],
    }),
    [],
  );
});

const segs = (): Segment[] => [
  { kind: "hook", text: "GTA 6 has a secret swamp.", start: 0, end: 3 },
  {
    kind: "beat",
    text: "Out in Grassrivers the airboats all live, deep in the swamp.",
    start: 3,
    end: 8,
  },
  { kind: "beat", text: "It is a big place, honestly, and a wet one.", start: 8, end: 12 },
  {
    kind: "beat",
    text: "Rockstar spent $2 billion to make it, reportedly.",
    start: 12,
    end: 17,
  },
  { kind: "loop", text: "Would you go?", start: 17, end: 20 },
];

test("Short: the real Leonida table, cards it may stand in for, rank lines and map lines left alone", () => {
  assert.equal(gtaKitInput("Grand Theft Auto VI").region, "Leonida");
  assert.equal(gtaKitInput("Some Other Game").places.length, 0);
  const s = segs();
  const kit = shortGtaKit({
    game: "Grand Theft Auto VI",
    segments: s,
    words: wordsOf(s),
    fps: FPS,
    hookEnd: 90,
    loopFrom: 17 * FPS,
    taken: [{ kind: "card", key: "card3", from: 12 * FPS, to: 16 * FPS }],
  });
  assert.deepEqual(
    kit.map((k) => [k.line, k.data.kind, !!k.replacesCard]),
    [
      [1, "place", false],
      [3, "cash", true],
    ],
  );
  const ranked = s.map((x, i) =>
    i === 1
      ? { ...x, visual: { kind: "rank" as const, primary: "1", secondary: "" } }
      : x,
  );
  assert.equal(
    shortGtaKit({
      game: "Grand Theft Auto VI",
      segments: ranked,
      words: wordsOf(s),
      fps: FPS,
      hookEnd: 90,
      loopFrom: 390,
      taken: [],
      mapLines: new Set([2]),
    }).length,
    0,
  );
});

const upgradesFor = async (gtaKit: boolean, game: string) => {
  const dir = await tmpDir();
  const s = segs();
  return shortUpgradesFor({
    cfg: testConfig(dir, { gtaKit }),
    episodeDir: dir,
    game,
    segments: s,
    words: wordsOf(s),
    plan: { fps: FPS, totalFrames: 600, shots: [] },
    layout: { hookEnd: 90, loopFrom: 510 },
    images: [],
    stamps: [],
    kept: [{ key: "hook", kind: "hook", from: 0, to: 90 }],
    mentions: [],
    blender: [],
    isRumour: false,
    stageMaps: async () => ({ moments: [], failed: ["not in tests"] }),
  });
};

test("off means no change: GTA_KIT off, or a story that is not GTA, plans exactly what it did before", async () => {
  const off = await upgradesFor(false, "Grand Theft Auto VI");
  assert.equal("kit" in off.upgrades, false);
  assert.ok(!off.notes.some((n) => n.startsWith("gta kit")));
  const notGta = await upgradesFor(true, "Red Dead Redemption 2");
  assert.deepEqual(notGta, await upgradesFor(false, "Red Dead Redemption 2"));
  const on = await upgradesFor(true, "Grand Theft Auto VI");
  assert.deepEqual(
    on.upgrades.kit?.map((k) => k.data.kind),
    ["place", "cash"],
  );
  const { kit: _kit, ...rest } = on.upgrades;
  assert.deepEqual(
    rest,
    off.upgrades,
    "the switch adds the kit and touches nothing else",
  );
  assert.deepEqual(on.mentions, off.mentions);
});

test("off means no change for long videos: the prop is only there with the switch on and a GTA story", () => {
  assert.deepEqual(longGtaKitProp(false, "Grand Theft Auto VI"), {});
  assert.deepEqual(longGtaKitProp(true, "Elden Ring"), {});
  const on = longGtaKitProp(true, "GTA 6");
  assert.equal(on.gtaKit?.region, "Leonida");
  assert.ok(on.gtaKit!.places.some((p) => p.name === "Vice City"));
  assert.equal(testConfig("/tmp/x").gtaKit, false, "default off");
});

test("review fixes: the earliest place, the alias as said, no face-off for a story beat", () => {
  const places = [
    { name: "Vice City", kind: "city" },
    { name: "Port Gellhorn", kind: "city" },
    { name: "Mount Kalaga National Park", aliases: ["Mount Kalaga"], kind: "landmark" },
  ];
  assert.equal(placeIn("You start in Vice City and drive to Port Gellhorn.", places)?.said, "Vice City");
  const kit = { region: "Leonida", places };
  const alias = kitCall("The climb up Mount Kalaga is long.", kit)!;
  assert.equal(alias.data.kind === "place" && alias.data.name, "Mount Kalaga");
  assert.equal(versusIn("Jason turns against Lucia."), undefined);
});

test("a unit letter must be attached and not run on: a $20 T-shirt is twenty dollars", () => {
  assert.equal(cashIn("A $20 T-shirt costs too much.")?.text, "$20");
  assert.notEqual(cashIn("It earned $5B-movie money.")?.unit, "BILLION");
  assert.equal(cashIn("It earned $5bn in a week.")?.text, "$5 BILLION");
  assert.equal(cashIn("The budget was $300K.")?.text, "$300 THOUSAND");
});
