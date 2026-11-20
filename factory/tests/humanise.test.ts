import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliasFromAlternativeName,
  dictionary,
  entityFromIgdb,
} from "../src/editorial/humanise/aliases.ts";
import { progressiveNaming } from "../src/editorial/humanise/naming.ts";
import {
  aiTells,
  attribution,
  emDashes,
  filler,
  register,
  repetition,
  type RuleContext,
} from "../src/editorial/humanise/rules.ts";
import {
  callbacks,
  humanNumbers,
  publishDay,
  relativeDates,
  spokenFiguresBack,
} from "../src/editorial/humanise/numbers.ts";
import {
  humaniseChapter,
  humaniseDrift,
  humaniseMode,
  humaniseSegments,
  humaniseShort,
  humaniseShortProblems,
  humanScore,
  shortSegments,
} from "../src/editorial/humanise/humanise.ts";
import {
  speakable,
  speakTitles,
  sayAbbreviations,
} from "../src/voice/speakable.ts";
import { goodScript } from "./helpers.ts";

const entities = dictionary();
const fix: RuleContext = { fix: true, format: "short" };
const check: RuleContext = { fix: false, format: "short" };
const name = (
  segs: string[],
  extra: Partial<Parameters<typeof progressiveNaming>[1]> = {},
) => progressiveNaming(segs, { entities, ...extra });

// ---------------------------------------------------------------- rule 1: progressive naming

test("the Civilization ranking says Sid Meier's once, then Civ", () => {
  const r = name(
    [
      "Which Civilization campaigns are most fun today?",
      "Sid Meier's Civilization feels clunky today.",
      "Sid Meier's Civilization 2's advisers add charm.",
      "Sid Meier's Civilization VII deserves 4th.",
      "Civilization 5 wins on campaign pacing. I'd pick Civilization 5 because its battles are clear.",
    ],
    { games: ["Sid Meier's Civilization", "Sid Meier's Civilization II"] },
  );
  assert.deepEqual(r.segments, [
    "Which Civilization campaigns are most fun today?",
    "Sid Meier's Civilization feels clunky today.",
    "Civ 2's advisers add charm.",
    "Civ 7 deserves 4th.",
    "Civ 5 wins on campaign pacing. I'd pick it because its battles are clear.",
  ]);
  assert.ok(r.repeatedFull >= 3);
});

test("a full title is said first and the short form after", () => {
  const r = name([
    "Grand Theft Auto VI is out in May.",
    "Rockstar says Grand Theft Auto VI will run at 30fps on consoles.",
  ]);
  assert.equal(r.segments[0], "Grand Theft Auto VI is out in May.");
  assert.equal(
    r.segments[1],
    "Rockstar says GTA 6 will run at 30fps on consoles.",
  );
});

test("companies and long subtitled titles shorten the way the press does", () => {
  const r = name([
    "Take-Two Interactive posted its earnings, and Take-Two Interactive kept the date.",
    "The Legend of Zelda: Tears of the Kingdom sold well. Fans still love The Legend of Zelda: Tears of the Kingdom and Nintendo knows.",
  ]);
  assert.match(
    r.segments[0]!,
    /^Take-Two Interactive posted its earnings, and Take-Two kept the date\.$/,
  );
  assert.match(
    r.segments[1]!,
    /^The Legend of Zelda: Tears of the Kingdom sold well\. Fans still love it and Nintendo knows\.$/,
  );
});

test("people go by surname after the full name, and never become a pronoun", () => {
  const r = name([
    "Hideo Kojima spoke today.",
    "Hideo Kojima said the game is close.",
  ]);
  assert.equal(r.segments[1], "Kojima said the game is close.");
});

test("a short form two things would share is never used", () => {
  const r = name([
    "Red Dead Redemption 2 and Red Dead Redemption are both on sale.",
    "Red Dead Redemption 2 is cheaper, and Red Dead Redemption is older.",
  ]);
  // "Red Dead 2" and "Red Dead" are distinct, so the numbered one shortens; the bare one has no short form at all.
  assert.match(r.segments[1]!, /^Red Dead 2 is cheaper/);
  assert.match(r.segments[1]!, /Red Dead Redemption is older/);
});

test("a series name that is also one of the games is never shortened", () => {
  const r = name(
    ["Civilization is the classic.", "Civilization 6 is the best seller."],
    { games: ["Civilization"] },
  );
  assert.deepEqual(r.segments, [
    "Civilization is the classic.",
    "Civ 6 is the best seller.",
  ]);
});

test("a written-only alias never reaches the voice on a first mention", () => {
  const r = name(["TotK is on sale this week."]);
  assert.equal(
    r.segments[0],
    "The Legend of Zelda: Tears of the Kingdom is on sale this week.",
  );
});

test("a short form alone does not count as a mention before its full name (Vice City the city)", () => {
  const r = name([
    "Vice City sits inside Leonida.",
    "If Grand Theft Auto: Vice City is your reference, the map is bigger.",
  ]);
  assert.equal(
    r.segments[1],
    "If Grand Theft Auto: Vice City is your reference, the map is bigger.",
  );
});

test("a pronoun only in object or subject position, never after an article or before a noun", () => {
  const r1 = name([
    "Grand Theft Auto VI is huge. The Grand Theft Auto VI trailer broke records.",
  ]);
  assert.equal(
    r1.segments[0],
    "Grand Theft Auto VI is huge. The GTA 6 trailer broke records.",
  );
  const r2 = name([
    "I played Grand Theft Auto V and Sony bought Grand Theft Auto V ads.",
  ]);
  assert.doesNotMatch(r2.segments[0]!, /\bit ads\b/);
  const r3 = name([
    "Grand Theft Auto VI looks great, and I'd buy Grand Theft Auto VI today.",
  ]);
  assert.equal(
    r3.segments[0],
    "Grand Theft Auto VI looks great, and I'd buy it today.",
  );
});

test("a brand prefix the dictionary doesn't know is still said once", () => {
  const r = name([
    "Sid Meier's Pirates! was a hit.",
    "Sid Meier's Pirates! still sells.",
  ]);
  assert.equal(r.segments[1], "Pirates! still sells.");
});

test("quotations and locked lines are never renamed", () => {
  const r = name(
    [
      "Grand Theft Auto VI is out.",
      'He said "Grand Theft Auto VI is ours" and Grand Theft Auto VI shipped.',
    ],
    {},
  );
  assert.match(r.segments[1]!, /"Grand Theft Auto VI is ours"/);
  const locked = name(
    ["Grand Theft Auto VI is out.", "Grand Theft Auto VI again."],
    { locked: [false, true] },
  );
  assert.equal(locked.segments[1], "Grand Theft Auto VI again.");
});

test("earlier chapters count as already said", () => {
  const r = name(["Grand Theft Auto VI changes everything."], {
    earlier: "Grand Theft Auto VI was announced in 2023.",
  });
  assert.equal(r.segments[0], "GTA 6 changes everything.");
});

test("check mode counts the repeats and changes nothing", () => {
  const segs = [
    "Sid Meier's Civilization VI is great.",
    "Sid Meier's Civilization VI again.",
  ];
  const r = name(segs, { fix: false });
  assert.deepEqual(r.segments, segs);
  assert.ok(r.repeatedFull >= 1);
});

test("IGDB alternative names: initials are written-only, word runs are spoken, translations are dropped", () => {
  assert.deepEqual(aliasFromAlternativeName("Baldur's Gate 3", "BG3"), {
    kind: "written",
    text: "BG3",
  });
  assert.deepEqual(
    aliasFromAlternativeName("Hollow Knight: Silksong", "Silksong Hollow"),
    undefined,
  );
  assert.deepEqual(
    aliasFromAlternativeName(
      "Death Stranding 2: On the Beach",
      "Death Stranding 2",
    ),
    { kind: "short", text: "Death Stranding 2" },
  );
  assert.equal(
    aliasFromAlternativeName("Final Fantasy VII", "ファイナルファンタジーVII"),
    undefined,
  );
  assert.equal(
    aliasFromAlternativeName("Starfield", "Starfield (working title)"),
    undefined,
  );
  const e = entityFromIgdb("igdb-1", "Clair Obscur: Expedition 33", [
    "Expedition 33",
    "CO:E33",
  ]);
  assert.equal(e?.short?.text, "Expedition 33");
  assert.equal(e?.short?.cold, false);
});

// ---------------------------------------------------------------- rule 2: spoken titles and fan names

test("roman numerals and fan abbreviations are said the way fans say them", () => {
  assert.equal(speakTitles("Civ VII and Civ V"), "Civ 7 and Civ 5");
  assert.equal(
    sayAbbreviations("BG3 and SF6"),
    "Baldur's Gate 3 and Street Fighter 6",
  );
  assert.equal(
    sayAbbreviations("SF6, MK1 and HL2"),
    "Street Fighter 6, Mortal Kombat 1 and Half-Life 2",
  );
  assert.equal(
    sayAbbreviations("CP2077 and MHW"),
    "Cyberpunk 2077 and Monster Hunter World",
  );
  assert.match(
    speakable("Final Fantasy VII Rebirth"),
    /Final Fantasy 7 Rebirth/,
  );
});

// ---------------------------------------------------------------- rule 3: repetition

test("the same word or name inside 15 words is flagged with a note", () => {
  const r = repetition(
    ["The campaign is long. Every campaign feels fresh."],
    check,
  );
  assert.ok(
    r.findings.some(
      (f) => f.rule === "repetition.near" && /campaign/.test(f.text) && f.note,
    ),
  );
});

test("a several-word name counts once, not word by word", () => {
  const r = repetition(["Grand Theft Auto is back."], check);
  assert.equal(
    r.findings.filter((f) => f.rule === "repetition.near").length,
    0,
  );
});

test("the same opening twice: a droppable starter goes, anything else gets a note", () => {
  const r = repetition(
    ["Plus, the price is up. Plus, the date moved too."],
    fix,
  );
  assert.equal(r.segments[0], "Plus, the price is up. The date moved too.");
  const n = repetition(["Sony says yes. Sony says no again."], fix);
  assert.ok(n.findings.some((f) => f.rule === "repetition.opening" && f.note));
});

test("a connective more than twice: additive ones are dropped, contrasts get a note", () => {
  const segs = [
    "Also, one thing happened. Also, a second thing came. Also, a third thing arrived here.",
  ];
  const r = repetition(segs, fix);
  assert.equal(
    r.segments[0],
    "Also, one thing happened. A second thing came. A third thing arrived here.",
  );
  const b = repetition(["But one. But two came. But three came along."], fix);
  assert.ok(
    b.findings.some((f) => f.rule === "repetition.connective" && f.note),
  );
});

test("three sentences of the same shape in a row are flagged", () => {
  const r = repetition(
    ["Civ 2 adds charm. Civ 3 adds armies. Civ 4 adds religion."],
    check,
  );
  assert.ok(r.findings.some((f) => f.rule === "repetition.shape"));
});

// ---------------------------------------------------------------- rule 4: spoken register

test("contractions where speech contracts, never at a sentence end or inside a quote", () => {
  const r = register(
    [
      'It is not coming. They are late. We do not know. That is what it is. He said "it is not".',
    ],
    fix,
  );
  assert.equal(
    r.segments[0],
    `It's not coming. They're late. We don't know. That's what it is. He said "it is not".`,
  );
  assert.equal(
    register(["You will not believe the price, it cannot last."], fix)
      .segments[0],
    "You won't believe the price, it can't last.",
  );
  assert.equal(
    register(["They have been quiet and it has been a year."], fix).segments[0],
    "They've been quiet and it's been a year.",
  );
});

test("formal connectives become plain ones", () => {
  const r = register(
    [
      "However, the date held. Additionally, the price rose. Therefore, wait. It shipped prior to launch in order to sell.",
    ],
    fix,
  );
  assert.equal(
    r.segments[0],
    "But the date held. Plus, the price rose. So wait. It shipped before launch to sell.",
  );
});

test("a flat rhythm is flagged with a note", () => {
  const flat = Array.from(
    { length: 6 },
    (_, i) => `This sentence number ${i} has exactly nine words in it.`,
  ).join(" ");
  const r = register([flat], check);
  assert.ok(r.findings.some((f) => f.rule === "register.rhythm" && f.note));
});

// ---------------------------------------------------------------- rule 5: AI tells and em dashes

test("AI-tell words are swapped for plain ones", () => {
  const r = aiTells(
    [
      "It's worth noting that the game boasts a rich tapestry of quests, a testament to the gaming landscape. Let's dive in.",
    ],
    fix,
  );
  assert.equal(
    r.segments[0],
    "The game has a mix of quests, proof of the gaming scene.",
  );
  assert.equal(
    aiTells(["This is a game-changer, so we delve into it."], fix).segments[0],
    "This is a big deal, so we dig into it.",
  );
});

test("tells that need a rewrite get notes: in a world where, not just X but Y twice, lists of three, stacked questions", () => {
  const r = aiTells(
    [
      "In a world where prices rise, it's not just big but loud. It's not just fast but smooth. Red, blue and green. Cats, dogs and birds. Why now? Why here?",
    ],
    check,
  );
  const notes = r.findings
    .filter((f) => f.note)
    .map((f) => f.note!)
    .join(" | ");
  assert.match(notes, /in a world where/);
  assert.match(notes, /Not just X, but Y/);
  assert.match(notes, /lists of three/);
  assert.match(notes, /Two questions in a row/);
});

test("em dashes: a pair becomes commas, a single one a full stop", () => {
  assert.equal(
    emDashes(["Rainbow Six Vegas is returning—don't expect it soon."], fix)
      .segments[0],
    "Rainbow Six Vegas is returning. Don't expect it soon.",
  );
  assert.equal(
    emDashes(["The game — a hit in 2010 — is back."], fix).segments[0],
    "The game, a hit in 2010, is back.",
  );
  assert.equal(
    emDashes(["A range 2–3 stays."], fix).segments[0],
    "A range 2–3 stays.",
  );
});

// ---------------------------------------------------------------- rule 6: human numbers

test("exact spoken numbers only; the point of the story keeps its figure", () => {
  assert.equal(
    humanNumbers(
      ["It sold 1.5 million copies and 50% of players finished it."],
      { ...fix },
    ).segments[0],
    "It sold one and a half million copies and half of players finished it.",
  );
  assert.equal(
    humanNumbers(["It sold 1.5 million copies."], {
      ...fix,
      pointFigures: ["1.5M"],
    }).segments[0],
    "It sold 1.5 million copies.",
  );
  assert.equal(
    humanNumbers(["It sold 1.5 million copies."], { ...fix, exact: [0] })
      .segments[0],
    "It sold 1.5 million copies.",
  );
  assert.equal(
    humanNumbers(["$1.5 million and 33% of fans."], fix).segments[0],
    "$1.5 million and 33% of fans.",
  );
  assert.equal(
    spokenFiguresBack("one and a half million and half of"),
    "1.5 million and 50% of",
  );
});

// ---------------------------------------------------------------- rule 7: relative dates

test("relative dates are computed against the publish date, US Eastern", () => {
  const pub = new Date("2026-11-14T18:00:00Z"); // a Saturday
  assert.equal(publishDay(pub).weekday, 6);
  const r = relativeDates(
    [
      "Sony confirmed it on November 13. Xbox said so on November 10. Tickets went on sale in March 2026. The game launches on November 19.",
    ],
    {
      ...fix,
      publishAt: pub,
    },
  );
  assert.equal(
    r.segments[0],
    "Sony confirmed it yesterday. Xbox said so on Tuesday. Tickets went on sale back in March. The game launches on November 19.",
  );
  assert.deepEqual(r.removed.sort(), ["10", "13", "2026", "November", "November"].sort());
});

test("dates stay exact without a publish date, in a date story or in the hook", () => {
  const s = ["It came out on November 13."];
  assert.equal(relativeDates(s, { ...fix }).segments[0], s[0]);
  assert.equal(
    relativeDates(s, {
      ...fix,
      publishAt: new Date("2026-11-14T18:00:00Z"),
      exactDates: true,
    }).segments[0],
    s[0],
  );
  assert.equal(
    relativeDates(s, {
      ...fix,
      publishAt: new Date("2026-11-14T18:00:00Z"),
      exact: [0],
    }).segments[0],
    s[0],
  );
  // A late-evening UTC slot is still the same US day.
  const late = relativeDates(["It came out on November 13."], {
    ...fix,
    publishAt: new Date("2026-11-14T03:00:00Z"),
  });
  assert.equal(late.segments[0], "It came out today.");
});

// ---------------------------------------------------------------- rule 8: callbacks

test("a figure said again minutes later gets one callback, long videos only", () => {
  const filler450 = Array.from({ length: 460 }, () => "word").join(" ");
  const segs = [
    `The Standard Edition is $69.99. ${filler450}.`,
    "The Standard Edition is $69.99 at most stores.",
  ];
  const r = callbacks(segs, { fix: true, format: "long" });
  assert.equal(
    r.segments[1],
    "Remember, the Standard Edition is $69.99 at most stores.",
  );
  assert.equal(
    callbacks(segs, { fix: true, format: "short" }).segments[1],
    segs[1],
  );
  // Too soon after the first mention: no callback.
  assert.equal(
    callbacks(["It is $70. It is $70 again."], { fix: true, format: "long" })
      .segments[0],
    "It is $70. It is $70 again.",
  );
});

// ---------------------------------------------------------------- rule 9: filler

test("filler is capped: one in a Short, extra openers dropped, others noted", () => {
  const r = filler(
    ["Honestly, it's late. Honestly, it's fine. Look, the price is up."],
    fix,
  );
  assert.equal(
    r.segments[0],
    "Honestly, it's late. It's fine. The price is up.",
  );
  assert.equal(
    filler(["Look at the map and listen to the music."], fix).findings.length,
    0,
  );
});

// ---------------------------------------------------------------- rule 10: attribution variety

test("a repeated According to X becomes X says", () => {
  const r = attribution(
    [
      "According to Kotaku, the game is big. According to Kotaku, the patch is out.",
    ],
    fix,
  );
  assert.equal(
    r.segments[0],
    "According to Kotaku, the game is big. Kotaku says the patch is out.",
  );
});

// ---------------------------------------------------------------- the whole pass, the guard and the score

test("HUMANISE reads off, check and fix; anything else is off", () => {
  assert.equal(humaniseMode("fix"), "fix");
  assert.equal(humaniseMode(" CHECK "), "check");
  assert.equal(humaniseMode("yes"), "off");
  assert.equal(humaniseMode(undefined), "off");
});

test("check mode changes nothing and measures; fix mode improves the score", () => {
  const segs = [
    "Sid Meier's Civilization VI is great.",
    "However, Sid Meier's Civilization VI is not cheap—it is $60.",
  ];
  const c = humaniseSegments(segs, { mode: "check", format: "short" });
  assert.deepEqual(c.segments, segs);
  assert.ok(c.before.counts.naming >= 1 && c.before.counts.emdash === 1);
  const f = humaniseSegments(segs, { mode: "fix", format: "short" });
  assert.equal(f.segments[1], "But Civ 6 isn't cheap. It's $60.");
  assert.ok(f.after.score > f.before.score);
  assert.equal(f.after.counts.naming, 0);
});

test("the guard allows alias names and planned date figures, refuses any other moved fact", () => {
  assert.deepEqual(
    humaniseDrift(
      "Civilization 5 wins. I'd pick Civilization 5.",
      "Civ 5 wins. I'd pick it.",
    ),
    [],
  );
  assert.deepEqual(
    humaniseDrift("It shipped on November 13.", "It shipped yesterday.", {
      removedFigures: ["13", "November"],
    }),
    [],
  );
  assert.ok(humaniseDrift("It costs $70.", "It costs $80.").length > 0);
  assert.ok(
    humaniseDrift("Today Sony confirmed it.", "Today Microsoft confirmed it.").length > 0,
  );
  assert.deepEqual(
    humaniseDrift("It sold 1.5 million.", "It sold one and a half million."),
    [],
  );
  // A tokeniser quirk in the original ("R18+") is not drift.
  assert.deepEqual(
    humaniseDrift("There was no R18+ rating.", "There was no R18+ rating."),
    [],
  );
});

test("a Short: character-quote beats and the stamp word stay; the hook keeps its figures", () => {
  const s = goodScript({
    story_type: "sales",
    hook: "Grand Theft Auto VI sold 1.5 million copies on November 13.",
    beats: [
      {
        narration: "Grand Theft Auto VI is Rockstar's fastest seller.",
        visual: { kind: "stat", primary: "1.5M", secondary: "" },
      },
      {
        narration: "Grand Theft Auto VI line.",
        quote: "q1",
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ],
    stamp: { word: "Grand", text: "GTA 6", sub: "", tone: "neutral" },
  });
  const r = humaniseShort(s, {
    mode: "fix",
    publishAt: new Date("2026-11-14T18:00:00Z"),
  });
  assert.equal(r.script.hook, s.hook);
  assert.equal(r.script.beats[1]!.narration, "Grand Theft Auto VI line.");
  assert.deepEqual(
    humaniseShortProblems(s, r.script, r.result.removedFigures),
    [],
  );
  assert.equal(shortSegments(r.script).length, shortSegments(s).length);
});

test("a documentary chapter uses the names said in earlier chapters", () => {
  const ch = {
    paragraphs: [
      { narration: "Grand Theft Auto VI sold well." },
      { narration: "Take-Two Interactive was pleased." },
    ],
  };
  const r = humaniseChapter(ch, {
    mode: "fix",
    earlier:
      "Grand Theft Auto VI launched. Take-Two Interactive set the price.",
  });
  assert.equal(r.chapter.paragraphs[0]!.narration, "GTA 6 sold well.");
  assert.equal(r.chapter.paragraphs[1]!.narration, "Take-Two was pleased.");
});

test("the score falls with findings and is scaled by length", () => {
  const zero = humaniseSegments(["Fine."], { mode: "check", format: "short" })
    .before.counts;
  assert.equal(humanScore(zero, 100), 10);
  assert.ok(
    humanScore({ ...zero, aitell: 3 }, 100) <
      humanScore({ ...zero, aitell: 3 }, 600),
  );
});

// ---------------------------------------------------------------- the pipeline step

import { humaniseStep } from "../src/humanisestep.ts";

const civSegs = ["Sid Meier's Civilization VI is great.", "Sid Meier's Civilization VI is in a world where turns matter."];
const run = (v: string[], mode: "check" | "fix") => {
  const r = humaniseSegments(v, { mode, format: "short" });
  return { value: r.segments, result: r };
};
const drift = (b: string[], a: string[], removed: string[]) => humaniseDrift(b.join(" "), a.join(" "), { removedFigures: removed });

test("HUMANISE=off does nothing; check logs and keeps the settled script", async () => {
  const off = await humaniseStep({ mode: "off", value: civSegs, run, problems: drift, check: async () => [] });
  assert.equal(off.value, civSegs);
  const chk = await humaniseStep({ mode: "check", value: civSegs, run, problems: drift, check: async () => assert.fail("no fact check in check mode") });
  assert.equal(chk.value, civSegs);
  assert.equal(chk.stage, "settled");
  assert.ok(((chk.log.before as Record<string, number>).naming ?? 0) >= 1);
});

test("HUMANISE=fix: the writer's rewrite is tried first, then the rule fixes; the fact check runs on the humanised words", async () => {
  const seen: string[][] = [];
  const kept = await humaniseStep({
    mode: "fix",
    value: civSegs,
    run,
    problems: drift,
    rewrite: async (v, notes) => {
      assert.ok(notes.some((n) => /in a world where/.test(n)));
      return v.map((x) => x.replace("in a world where turns matter", "where every turn matters"));
    },
    check: async (v) => {
      seen.push(v);
      return [];
    },
  });
  assert.equal(kept.stage, "rewrite");
  assert.equal(kept.value[1], "Civ 6 is where every turn matters.");
  assert.deepEqual(seen[0], kept.value);
});

test("HUMANISE=fix: a rewrite that moves a fact falls back to the rule fixes; a failed fact check keeps the settled script", async () => {
  const fallback = await humaniseStep({
    mode: "fix",
    value: civSegs,
    run,
    problems: drift,
    rewrite: async (v) => v.map((x) => x.replace("VI", "VII")),
    check: async () => [],
  });
  assert.equal(fallback.stage, "rules");
  assert.equal(fallback.value[1], "Civ 6 is in a world where turns matter.");
  const refused = await humaniseStep({ mode: "fix", value: civSegs, run, problems: drift, check: async () => ["a blocker"] });
  assert.equal(refused.stage, "settled");
  assert.equal(refused.value, civSegs);
  const unclear = await humaniseStep({
    mode: "fix",
    value: civSegs,
    run,
    problems: drift,
    rewrite: async (v) => v,
    clear: async () => false,
    check: async () => [],
  });
  assert.notEqual(unclear.stage, "rewrite");
});

test("a name inside a longer name is left alone, and only halves become words", () => {
  const r = name(["Rockstar Games made it.", "The Rockstar Games Launcher went offline."]);
  assert.equal(r.segments[1], "The Rockstar Games Launcher went offline.");
  assert.equal(humanNumbers(["It added 1.75 million copies."], fix).segments[0], "It added 1.75 million copies.");
});
