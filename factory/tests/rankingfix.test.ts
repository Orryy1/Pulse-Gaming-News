// The owner's three faults with ranked Shorts (4 Nov 2026): number one given away in the first line, achievements
// that never said their names or what they ask, and rank cards gone after 2.5 s.
import test from "node:test";
import assert from "node:assert/strict";
import {
  namesWinner,
  patchSpoilers,
  spoilerProblems,
  underFigure,
  type RankedDraft,
} from "../src/editorial/spoilers.ts";
import {
  achievementProblems,
  evergreenToScript,
  leansOnLast,
  validateEvergreen,
  type EvergreenScript,
} from "../src/editorial/evergreen.ts";
import { pinnedComment } from "../src/editorial/seo.ts";
import {
  iconUrl,
  parseAchievementsPage,
} from "../src/discovery/achievements.ts";
import { achievementRequirement, groundAchievements } from "../src/pipeline.ts";
import {
  ENTRY_TEXT_FLOOR,
  cardRequirement,
  entryCardProblems,
  entryHolds,
  fitMeta,
  fitName,
  fitRequirement,
} from "../src/render/rankcard.ts";
import { arbitrate, overlaySpans, keptSpan } from "../src/render/cleanframe.ts";
import { cardWindow } from "../src/render/shortcraft.ts";
import type { Segment } from "../src/render/timeline.ts";

const titles = [
  "Street Fighter 6",
  "Street Fighter III: New Generation",
  "Street Fighter IV",
  "Street Fighter II: The World Warrior",
  "Street Fighter V",
  "Street Fighter",
];
const entries = (list: string[]) =>
  list.map((game_title, i) => ({
    rank: i + 1,
    game_title,
    steam_search_term: game_title,
    year: 2000 + i,
    platforms: "PC",
    one_line: `${game_title} earns this spot with its sharp, specific combat system.`,
    verdict_chip: "SOLID PICK",
    footage: { want: "gameplay" as const, keywords: ["combat"] },
  }));

const draft = (over: Partial<EvergreenScript> = {}): EvergreenScript =>
  ({
    format: "ranking",
    theme: "Street Fighter",
    title: "Street Fighter Ranked",
    hook: "We rank numbered Street Fighter games by how combat plays today.",
    entries: entries(titles),
    pulse_take: {
      label: "OUR PICK",
      narration:
        "Street Fighter 6 wins because its Drive Gauge changes every round.",
      on_screen: "Drive Gauge wins it",
    },
    loop_line: "Which Street Fighter would you put at the top?",
    youtube: {
      title: "Street Fighter: Ranking EVERY Numbered Game",
      description: "We count down the numbered Street Fighter games by combat.",
      tags: ["Street Fighter"],
    },
    claims: [],
    ...over,
  }) as EvergreenScript;

test("spoilers: the published hook, near-matches and short forms are caught", () => {
  for (const hook of [
    "Street Fighter 6 wins. We rank numbered entries by combat today.",
    "SF6 takes the crown in our ranking of numbered games.",
    "SF 6 is still our favorite, so we rank the rest.",
    "Nothing beats street fighter six in this countdown of ours.",
  ]) {
    const p = spoilerProblems(draft({ hook }));
    assert.ok(
      p.some((x) => x.startsWith("The hook gives away")),
      hook,
    );
  }
  // A title without its subtitle, and the subtitle alone.
  const vegas = entries(["Fallout: New Vegas", "Fallout 4", "Fallout 3"]);
  for (const hook of [
    "New Vegas wins this one, so let's count up.",
    "Fallout wins with New Vegas, every time.",
  ])
    assert.ok(
      spoilerProblems(draft({ theme: "Fallout", entries: vegas, hook })).length,
      hook,
    );
  const cod = entries([
    "Call of Duty 4: Modern Warfare",
    "Call of Duty: Black Ops",
  ]);
  assert.ok(
    spoilerProblems(
      draft({
        theme: "Shooters",
        entries: cod,
        hook: "COD4 still rules, and we explain why below.",
      }),
    ).length,
  );
  // Roman and digit are one title.
  assert.ok(
    namesWinner(
      "We love Street Fighter 5 best",
      "Street Fighter V",
      "Street Fighter",
      [],
    ),
  );
  // Every surface a viewer sees first.
  for (const over of [
    { title: "Street Fighter 6 Is the Best" },
    {
      youtube: {
        title: "Why Street Fighter 6 Wins",
        description: "Ranked.",
        tags: [],
      },
    },
    {
      youtube: {
        title: "Ranked",
        description: "Street Fighter 6 gets our vote.",
        tags: [],
      },
    },
  ])
    assert.ok(spoilerProblems(draft(over)).length, JSON.stringify(over));
});

test("spoilers: a theme written as a sentence hides nothing (the real oiyFG7VPy-k theme)", () => {
  const theme =
    "Street Fighter's six numbered mainline games ranked by how well their core one-on-one combat holds up today";
  assert.ok(
    spoilerProblems(
      draft({ theme, hook: "Street Fighter 6 wins. We rank numbered entries by combat today." }),
    ).some((x) => x.startsWith("The hook gives away")),
  );
  // A short form every entry shares says nothing; the series name in a title is not a spoiler.
  const mw = entries(["Call of Duty 4: Modern Warfare", "Call of Duty: Modern Warfare 3", "Call of Duty: Modern Warfare II"]);
  assert.deepEqual(
    spoilerProblems(
      draft({
        theme: "Call of Duty: Modern Warfare series, ranked by campaign",
        entries: mw,
        title: "Every Modern Warfare Campaign, Ranked",
        hook: "Every Modern Warfare campaign from 2007 to 2023, ranked by missions.",
        youtube: { title: "Ranking EVERY Modern Warfare Campaign", description: "Every Modern Warfare story.", tags: [] },
      }),
    ),
    [],
  );
  const gta = entries(["Grand Theft Auto III", "Grand Theft Auto V"]);
  assert.deepEqual(
    spoilerProblems(draft({ theme: "Grand Theft Auto", entries: gta, title: "Every GTA Ranked", hook: "Every GTA, ranked by what it did for open worlds." })),
    [],
  );
  assert.ok(
    spoilerProblems(draft({ theme: "Grand Theft Auto", entries: gta, hook: "GTA 3 changed everything, and we rank the rest." })).length,
  );
  // The series, worked out from the entries when the theme doesn't say it.
  const mario = entries(["Super Mario Galaxy 2", "Super Mario 64", "Super Mario Sunshine"]);
  assert.ok(
    spoilerProblems(draft({ theme: "3D Super Mario games", entries: mario, hook: "Galaxy 2 is the one, and we rank the rest of them." })).length,
  );
});

test("spoilers: a clean countdown passes, with no false alarms from other entries or the theme", () => {
  assert.deepEqual(spoilerProblems(draft()), []);
  // "Halo 3" is number one and "Halo 3: ODST" is an earlier entry: its own line must not fire.
  const halo = entries(["Halo 3", "Halo 3: ODST", "Halo 4"]);
  assert.deepEqual(
    spoilerProblems(
      draft({
        theme: "Halo",
        entries: halo,
        hook: "We rank Halo's campaigns by solo replayability.",
      }),
    ),
    [],
  );
  // Number one's bare series name is the theme, not a spoiler.
  const original = entries(["Street Fighter", "Street Fighter V"]);
  assert.deepEqual(spoilerProblems(draft({ entries: original })), []);
  // "reach" the verb is not "Halo: Reach".
  const reach = entries(["Halo: Reach", "Halo 4"]);
  assert.deepEqual(
    spoilerProblems(
      draft({
        theme: "Halo",
        entries: reach,
        hook: "Reach for the controller: we rank Halo by solo fights.",
        youtube: {
          title: "Halo Ranked",
          description: "How far can you reach in solo fights?",
          tags: [],
        },
      }),
    ),
    [],
  );
  assert.ok(
    spoilerProblems(
      draft({
        theme: "Halo",
        entries: reach,
        hook: "We think Halo: Reach beats them all.",
      }),
    ).length,
  );
});

test("spoilers: an earlier entry may not mention number one, and its own turn may", () => {
  const list = entries(titles);
  list[3]!.one_line =
    "Street Fighter 2 set the rules that Street Fighter 6 still follows.";
  const p = spoilerProblems(draft({ entries: list }));
  assert.equal(p.length, 1);
  assert.match(p[0]!, /number 4/);
});

test("spoilers: number one's figure stays back, the list's ceiling is fine", () => {
  const list = entries(["I'm Blue", "Belting It Out", "Make an Impact"]).map(
    (x, i) => ({
      ...x,
      percent: [0.9, 2.3, 4.4][i]!,
    }),
  );
  const base = {
    format: "rarest_achievements" as const,
    theme: "Street Fighter 30th Anniversary Collection",
    entries: list,
  };
  assert.ok(
    spoilerProblems(
      draft({
        ...base,
        hook: "Street Fighter 30th Anniversary Collection's achievements get rarer, down to 0.9% unlocked.",
      }),
    ).some((x) => /0\.9%/.test(x)),
  );
  assert.ok(
    spoilerProblems(
      draft({
        ...base,
        hook: "Only 2 percent have these Street Fighter achievements.",
      }),
    ).length,
  );
  assert.deepEqual(
    spoilerProblems(
      draft({
        ...base,
        hook: "The rarest achievements in Street Fighter 30th Anniversary Collection, all under 5% of players.",
      }),
    ),
    [],
  );
  assert.equal(underFigure([0.9, 4.4]), 5);
  assert.equal(underFigure([5]), 6);
  // The published description counted down to the same figure.
  assert.ok(
    spoilerProblems(
      draft({
        ...base,
        hook: "All under 5% of players.",
        youtube: { title: "T", description: "From 4.4% to 0.9%.", tags: [] },
      }),
    ).some((x) => x.startsWith("The description")),
  );
  // A climb is a figure too.
  const climb = entries(["Phantom Blade Zero", "R.E.P.O."]).map((x, i) => ({
    ...x,
    platforms: ["UP 96 TO #5", "UP 33 TO #15"][i]!,
    peak: [775647, 72051][i],
  }));
  assert.ok(
    spoilerProblems(
      draft({
        format: "steam_climbers",
        theme: "Steam",
        entries: climb,
        hook: "One game jumped 96 places on Steam this week.",
      }),
    ).length,
  );
});

test("spoilers: deals and release lists may lead with rank 1, by design; a versus only for its result", () => {
  const deals = entries(["Grim Fandango Remastered", "Wall World"]);
  assert.deepEqual(
    spoilerProblems(
      draft({
        format: "steam_deals",
        theme: "Steam Deals",
        entries: deals,
        hook: "Grim Fandango Remastered is $2.24 on Steam right now.",
        youtube: {
          title: "Grim Fandango Remastered Is $2.24, Plus 3 More",
          description: "Deals.",
          tags: [],
        },
      }),
    ),
    [],
  );
  const pair = entries(["Halo 3", "Halo 2"]);
  assert.deepEqual(
    spoilerProblems(
      draft({
        format: "versus",
        theme: "Halo",
        entries: pair,
        hook: "Halo 3 against Halo 2, by how the campaigns play.",
      }),
    ),
    [],
  );
  assert.ok(
    spoilerProblems(
      draft({
        format: "versus",
        theme: "Halo",
        entries: pair,
        hook: "Halo 3 beats Halo 2, and here's why.",
      }),
    ).length,
  );
});

test("spoilers: the last resort leaves nothing given away", () => {
  const bad = draft({
    hook: "Street Fighter 6 wins.",
    title: "Why Street Fighter 6 Is Best",
    youtube: {
      title: "Street Fighter 6 Wins",
      description: "Street Fighter 6 gets our vote.",
      tags: [],
    },
  });
  const fixed = patchSpoilers(bad);
  assert.deepEqual(spoilerProblems(fixed), []);
  assert.doesNotMatch(fixed.hook, /Street Fighter 6/);
  assert.equal(patchSpoilers(draft()).hook, draft().hook);
});

const named = (over: Record<string, unknown> = {}) => ({
  ...entries(["x"])[0]!,
  ...over,
});
const achievements = (lines: string[], names: string[]) =>
  draft({
    format: "rarest_achievements",
    theme: "Street Fighter 30th Anniversary Collection",
    hook: "The rarest achievements in Street Fighter 30th Anniversary Collection, all under 5% of players.",
    entries: names.map((game_title, i) =>
      named({
        rank: i + 1,
        game_title,
        one_line: lines[i],
        percent: [0.9, 1.9, 2.1, 2.3][i],
        platforms: "Street Fighter 30th Anniversary Collection",
      }),
    ) as EvergreenScript["entries"],
  });

test("achievements: every line says the exact name; a condition can't be made up", () => {
  const names = ["I'm Blue", "SF 30th Anniversary!"];
  // The published line: the name never said.
  const old = achievements(
    [
      "Reaching ranked Blue Belt looks tougher still.",
      "Winning 30 ranked matches in one game is rarer, a serious test of persistence.",
    ],
    names,
  );
  const p = achievementProblems(old);
  assert.equal(p.length, 2);
  assert.match(p[0]!, /I'm Blue/);
  const good = achievements(
    [
      '"I\'m Blue" asks you to reach a Blue Belt in Ranked Matches, and just 0.9% of players have.',
      '"SF 30th Anniversary!" asks you to win 30 ranked matches in one game, which only 1.9% have done.',
    ],
    names,
  );
  const steam = new Map([
    ["im blue", "Achieve a Blue Belt level in Ranked Matches."],
    ["sf 30th anniversary", "Win 30 Ranked Matches in a Game."],
  ]);
  assert.deepEqual(achievementProblems(good, steam), []);
  // A curly apostrophe and a dropped exclamation mark still count as the name.
  assert.deepEqual(
    achievementProblems(
      achievements(
        [
          "“I’m Blue” asks for a Blue Belt in ranked play.",
          "SF 30th Anniversary asks for 30 ranked wins in one game.",
        ],
        names,
      ),
    ),
    [],
  );
  const invented = achievements(
    [
      '"I\'m Blue" asks you to reach a Blue Belt within 50 Ranked Matches.',
      '"SF 30th Anniversary!" simply looks like a very painful grind for most.',
    ],
    names,
  );
  const q = achievementProblems(invented, steam);
  assert.ok(q.some((x) => /says 50/.test(x)));
  assert.ok(q.some((x) => /does not say what you must do/.test(x)));
});

test("achievements: longer lines allowed, the empty comparison is not", () => {
  const long =
    '"I\'m Blue" asks you to reach a Blue Belt level in Ranked Matches against real opponents, and just 0.9% of players have.';
  const names = [
    "I'm Blue",
    "Belting It Out",
    "Make an Impact",
    "Challenge Everyone!",
  ];
  const lines = names.map((n, i) =>
    i === 0
      ? long
      : `"${n}" asks you to clear a whole arcade ladder from start to finish, and few players bother.`,
  );
  const p = validateEvergreen(achievements(lines, names));
  assert.ok(!p.some((x) => /over \d+ words/.test(x)), p.join("; "));
  assert.equal(
    leansOnLast("Earning your first ranked belt looks tougher."),
    "tougher.",
  );
  assert.ok(leansOnLast("Reaching ranked Blue Belt looks tougher still."));
  assert.ok(leansOnLast("7th, Super Mario 64's backflips feel freer."));
  assert.ok(
    leansOnLast(
      "6th, Halo 2's dodging Elites make better opponents than those teleporting Prometheans.",
    ),
  );
  assert.ok(
    leansOnLast(
      "1st, Super Mario Galaxy 2 trades that freedom for brilliantly judged challenges.",
    ),
  );
  assert.equal(
    leansOnLast(
      "Fallout 4 brought the series' best gunplay in 2015, and it holds up.",
    ),
    undefined,
  );
  assert.equal(
    leansOnLast(
      "Halo 2's Elites dodge your shots, so every fight feels alive.",
    ),
    undefined,
  );
  assert.equal(leansOnLast("It says that players wanted more."), undefined);
});

test("achievements: Steam's words reach the card, cut only to fit, and never tiny", () => {
  assert.equal(
    achievementRequirement("Win 30 Ranked Matches in a Game.", "ignored"),
    "Win 30 Ranked Matches in a Game.",
  );
  const long =
    "Defeat every boss in the main campaign on the hardest difficulty without using a single healing item, without dying once, without any companion and within a single sitting of under four hours total.";
  assert.equal(fitRequirement(long).fits, false);
  assert.equal(
    achievementRequirement(
      long,
      "Beat every boss on the hardest difficulty, no healing.",
    ),
    "Beat every boss on the hardest difficulty, no healing.",
  );
  const cut = cardRequirement(long);
  assert.ok(cut.length > 20 && fitRequirement(cut).fits);
  assert.ok(fitRequirement(cut).size >= 42);
  const g = groundAchievements(
    {
      entries: [
        {
          rank: 3,
          game_title: "I'm blue",
          steam_search_term: "",
          platforms: "",
          year: 2000,
          one_line: "x",
          requirement: "wrong",
        } as never,
      ],
    },
    [
      {
        name: "I'm Blue",
        game: "SF30",
        percent: 0.9,
        icon: "http://i",
        description: "Achieve a Blue Belt level in Ranked Matches.",
      },
    ],
  );
  assert.equal(
    (g.entries[0] as unknown as { requirement?: string }).requirement,
    "Achieve a Blue Belt level in Ranked Matches.",
  );
  const script = evergreenToScript({
    ...achievements(['"I\'m Blue" x', '"B" x'], ["I'm Blue", "B"]),
    entries: [
      {
        ...(g.entries[0] as unknown as object),
        rank: 1,
        one_line: "a",
        verdict_chip: "A",
        footage: { want: "gameplay", keywords: [] },
      } as never,
    ],
  });
  assert.deepEqual(script.beats[0]!.visual.items, [
    "0.9% of players",
    "",
    "Achieve a Blue Belt level in Ranked Matches.",
  ]);
});

test("achievements: Steam's bare icon names become addresses; old full addresses stand", () => {
  assert.equal(
    iconUrl("abc.jpg", 586200),
    "https://shared.akamai.steamstatic.com/community_assets/images/apps/586200/abc.jpg",
  );
  assert.equal(iconUrl("https://x/y.jpg", 1), "https://x/y.jpg");
  assert.equal(iconUrl("", 1), undefined);
  const page = `{"percentages":{"7":1.5}} {"internal_key":7,"api_name":"a","name":"N","description":"D","hidden":false,"icon_achieved":"h.jpg"}`;
  assert.match(parseAchievementsPage(page, 42)[0]!.icon!, /apps\/42\/h\.jpg$/);
});

test("pinned comment: a ranking's comment is up from the first second and names no winner", () => {
  const take = {
    label: "OUR PICK",
    narration: "x",
    on_screen: "Street Fighter 6 wins",
  };
  const base = {
    pulse_take: take,
    game_title: "Street Fighter",
    headline: "Ranked",
    story_type: "other",
    entries: [{ rank: 1 }],
  };
  for (const evergreen_format of [
    "ranking",
    "rarest_achievements",
    "hardest_achievements",
    "steam_climbers",
    "weekly_recap",
  ])
    assert.doesNotMatch(
      pinnedComment({ ...base, evergreen_format } as never),
      /Street Fighter 6/,
    );
});

// ---- The card on screen ----------------------------------------------------------------------------------

const seg = (
  kind: Segment["kind"],
  start: number,
  end: number,
  visual?: unknown,
): Segment => ({ kind, text: "words here", start, end, visual }) as Segment;
const rank = (primary: string, value_a: number, items?: string[]) => ({
  kind: "rank",
  primary,
  secondary: "CHIP",
  value_a,
  items,
});
const segments = [
  seg("hook", 0, 4),
  seg("beat", 4, 12, rank("Make an Impact", 2)),
  seg("beat", 12, 22, rank("I'm Blue", 1)),
  seg("take", 22, 28, { kind: "stat", primary: "Pick", secondary: "" }),
  seg("loop", 28, 32),
];

test("rank card: it holds its whole entry, while small graphics keep their word-level hold", () => {
  const w = cardWindow(segments, [], 1, 30, 960);
  assert.deepEqual(w, { from: 120, len: 240 });
  assert.equal(cardWindow(segments, [], 3, 30, 960).len, 105);
  const news = [
    seg("hook", 0, 4),
    seg("beat", 4, 12, { kind: "stat", primary: "$70", secondary: "" }),
    seg("loop", 12, 16),
  ];
  assert.equal(cardWindow(news, [], 1, 30, 480).len, 75);
});

test("rank card: every other graphic in the beat gives way, and the gate measures what is drawn", () => {
  const plan = {
    fps: 30,
    totalFrames: 960,
    shelf: [{ device: "stat", from: 130, to: 200 }],
    craft: undefined,
  } as never;
  const layout = { hookEnd: 120, loopFrom: 900, totalFrames: 960 };
  const spans = overlaySpans({
    segments,
    words: [],
    plan,
    layout,
    stamps: [{ at: 6 }],
    sting: true,
  });
  const kept = arbitrate(spans);
  assert.deepEqual(keptSpan(kept, "card1"), {
    key: "card1",
    kind: "entry",
    from: 120,
    to: 360,
  });
  assert.equal(keptSpan(kept, "stamp0"), undefined);
  assert.equal(keptSpan(kept, "shelf0"), undefined);
  assert.equal(keptSpan(kept, "sting"), undefined);
  const holds = entryHolds(segments, kept, 30, 960);
  assert.deepEqual(
    holds.map((h) => h.holdSeconds),
    [8, 10],
  );
  assert.deepEqual(entryCardProblems(holds, segments), []);
  // The published Short's hold, as the gate would have seen it.
  const old = entryHolds(
    segments,
    [
      { key: "card1", from: 120, to: 195 },
      { key: "card2", from: 360, to: 435 },
    ],
    30,
    960,
  );
  const p = entryCardProblems(old, segments);
  assert.equal(p.length, 2);
  assert.match(p[0]!, /holds 2\.5 s of its 8\.0 s entry/);
});

test("rank card: text sizes stay above the floor for the real worst cases", () => {
  for (const t of [
    "Fallout: A Post Nuclear Role Playing Game",
    "The Devil is in the Details",
    "Probably Stolen - Cyberpunk Shopkeeper Sim",
  ])
    assert.ok(fitName(t, true).fits, t);
  for (const m of [
    "2023 · PC, PS4, PS5, Xbox Series X|S",
    "£0.88 · €1.03 · WAS $6.99",
    "UP 33 TO #15 · 72,051 peak players",
  ]) {
    const f = fitMeta(m.toUpperCase(), 600);
    assert.ok(f.size >= ENTRY_TEXT_FLOOR && f.lines <= 2, m);
  }
  assert.ok(
    fitRequirement(
      "Discover Akuma in Super Street Fighter II Turbo to prove your worth.",
    ).fits,
  );
  assert.ok(
    entryCardProblems(
      [],
      [seg("beat", 0, 1, rank("x", 1, ["1%", "", "a ".repeat(200)]))],
    ).length,
  );
});
