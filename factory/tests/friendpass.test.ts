import { test } from "node:test";
import assert from "node:assert/strict";
import {
  factDrift,
  figuresOf,
  namesOf,
  friendShort,
  friendShortProblems,
  friendChapter,
  friendChapterProblems,
  friendPass,
  friendPassOn,
  friendCheckVerdict,
  shortSettledText,
  newProblems,
  FRIEND_STYLE,
  FRIEND_FACT_LOCK,
  friendPassPrompt,
} from "../src/editorial/friendpass.ts";
import { friendPassFrom } from "../src/config.ts";
import { voiceProblems, PULSE_VOICE } from "../src/editorial/voice.ts";
import { midQuestions } from "../src/editorial/editorial.ts";
import {
  PULSE_CHECK_LABEL,
  pulseCheckProblems,
  pulseCheckReading,
} from "../src/editorial/newssegment.ts";
import { narrationOf, type Script } from "../src/editorial/schema.ts";
import { goodScript, testConfig } from "./helpers.ts";

const UNKNOWN9 =
  "Bandai Namco expects a €21 million loss from closing Reflector Entertainment. Reflector cut 18% of its staff a month after the 2024 launch. Reflector said Bandai Namco \"could not justify several more years of investment.\" On Steam it's $20 with three players, so you'd play alone.";

test("the guard passes a delivery rewrite that keeps every figure, name and quotation", () => {
  const after =
    "Bandai Namco expects a €21 million loss from closing Reflector. [sighs] Reflector had already cut 18% of its staff a month after the 2024 launch. Reflector said Bandai Namco \"could not justify several more years of investment.\" Honestly? On Steam it's $20 with three players, so you'd have the universe to yourself.";
  assert.deepEqual(factDrift(UNKNOWN9, after), []);
});

test("the guard catches a figure added, dropped or changed, including a sum worked out from two", () => {
  assert.match(
    factDrift(UNKNOWN9, UNKNOWN9.replace("18%", "19%")).join(" "),
    /drops the figure 18[\s\S]*adds the figure 19/,
  );
  assert.match(
    factDrift(UNKNOWN9, `${UNKNOWN9} That's ten dollars for a box.`).join(" "),
    /adds the figure 10/,
  );
  assert.match(
    factDrift(UNKNOWN9, UNKNOWN9.replace(" with three players", "")).join(" "),
    /drops the figure 3/,
  );
  // Spelled and written figures are the same figure; "one" is how people talk, not a number.
  assert.deepEqual(
    [...figuresOf("three players, $7.19, 2,400 reviews, this one")].sort(),
    ["2400", "3", "7.19"].sort(),
  );
});

test("the guard catches a new name, a dropped name and a changed or invented quotation", () => {
  assert.match(
    factDrift(UNKNOWN9, `${UNKNOWN9} Even Ubisoft would blush.`).join(" "),
    /adds the name Ubisoft/,
  );
  assert.match(
    factDrift(
      UNKNOWN9,
      UNKNOWN9.replace(/Reflector Entertainment/, "the studio").replace(
        /Reflector (cut|said)/g,
        "It $1",
      ),
    ).join(" "),
    /drops the name Reflector/,
  );
  // A name shortened to the part people say is not a dropped name.
  assert.doesNotMatch(
    factDrift(
      UNKNOWN9,
      UNKNOWN9.replace("Reflector Entertainment", "Reflector"),
    ).join(" "),
    /drops the name/,
  );
  assert.match(
    factDrift(
      UNKNOWN9,
      UNKNOWN9.replace("several more years", "more years"),
    ).join(" "),
    /changes the quotation/,
  );
  assert.match(
    factDrift(UNKNOWN9, `${UNKNOWN9} Call it a "new desk".`).join(" "),
    /adds the quotation "new desk"/,
  );
  assert.ok(
    namesOf("Rockstar North co-studio head Rob Nelson told Famitsu.").has(
      "Famitsu",
    ),
  );
  assert.ok(
    !namesOf("Honestly, it works.").has("Honestly"),
    "a sentence opener is not a name",
  );
});

test("the guard catches an invented experience, a lost rumor label and new advertiser trouble", () => {
  assert.match(
    factDrift(UNKNOWN9, `${UNKNOWN9} I played it at launch.`).join(" "),
    /claims an experience/,
  );
  const rumor = "Insider Gaming reportedly saw the memo. The price is $80.";
  assert.match(
    factDrift(rumor, "Insider Gaming saw the memo. The price is $80.").join(
      " ",
    ),
    /drops an attribution/,
  );
  assert.match(
    factDrift(UNKNOWN9, `${UNKNOWN9} What a shitshow.`).join(" "),
    /advertiser-unfriendly/,
  );
});

test("the narrator's own take passes the voice check; an experience he never had goes back", () => {
  assert.deepEqual(
    voiceProblems(
      "Honestly, I think Sony's wrong here, and I'd wait for a sale. I'm not convinced.",
    ),
    [],
  );
  assert.match(
    voiceProblems("I played six hours of it.").join(" "),
    /never did/,
  );
  assert.match(
    voiceProblems("When I was a kid this was huge.").join(" "),
    /never did/,
  );
  // A quotation never counts against the narrator.
  assert.deepEqual(voiceProblems('Nelson said "I played every mission."'), []);
});

const tagged = (s: Script) => narrationOf(s, { tags: true });

test("a Short's pass applies the model's edits to the spoken lines only and turns braced tags into delivery tags", async () => {
  const seen: any[] = [];
  const llm = {
    structured: async (o: any) => {
      seen.push(o);
      return {
        edits: [
          {
            find: "For us, Bethesda has delayed",
            replace: "{sighs} Honestly, I think Bethesda has delayed",
          },
        ],
      };
    },
  } as any;
  const before = goodScript();
  const after = await friendShort(llm, before, { wordsMin: 20, wordsMax: 100 });
  assert.equal(seen.length, 1, "one call when the length holds");
  assert.equal(seen[0].tier, "mid");
  assert.equal(seen[0].site, "friend.short");
  assert.match(seen[0].system, /The friend pass/);
  assert.match(
    after.pulse_take.narration,
    /^Honestly, I think Bethesda has delayed/,
  );
  assert.doesNotMatch(
    after.pulse_take.narration,
    /[[{]/,
    "the text itself stays clean",
  );
  assert.equal(after.voice_tags?.[0]?.tag, "sighs");
  assert.match(tagged(after), /\[sighs\] Honestly, I think Bethesda/);
  assert.equal(after.hook, before.hook);
  assert.deepEqual(
    after.beats.map((b) => b.visual),
    before.beats.map((b) => b.visual),
    "cards stay",
  );
  assert.equal(after.youtube.title, before.youtube.title);
  assert.deepEqual(
    friendShortProblems(before, after, { wordsMin: 20, wordsMax: 100 }),
    [],
  );
});

test("an edit that lands on nothing, or on the fixed hook, fails the pass instead of guessing", async () => {
  const llm = (edits: any[]) =>
    ({ structured: async () => ({ edits }) }) as any;
  await assert.rejects(
    friendShort(
      llm([{ find: "not in the script", replace: "x" }]),
      goodScript(),
    ),
    /didn't land/,
  );
  await assert.rejects(
    friendShort(
      llm([
        { find: "Starfield's second expansion has been delayed", replace: "x" },
      ]),
      goodScript(),
    ),
    /didn't land/,
  );
  await assert.rejects(friendShort(llm([]), goodScript()), /no edits/);
});

test("a version over the word limit gets one trim, by edits on what it wrote", async () => {
  const calls: any[] = [];
  const padding =
    " and honestly that is a lot to take in for anyone who was hoping for it this year".repeat(
      2,
    );
  const llm = {
    structured: async (o: any) => {
      calls.push(o);
      return calls.length === 1
        ? {
            edits: [
              {
                find: "isn't a red flag yet.",
                replace: `isn't a red flag yet${padding}.`,
              },
            ],
          }
        : { edits: [{ find: padding, replace: "" }] };
    },
  } as any;
  const after = await friendShort(llm, goodScript(), {
    wordsMin: 20,
    wordsMax: 90,
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].content, /words over its limit/);
  assert.match(after.pulse_take.narration, /isn't a red flag yet\.$/);
});

test("the Short guard sends back a changed hook, a lost Pulse Check reading, a lost stamp word and too many tags", () => {
  const before = goodScript({
    pulse_take: {
      label: PULSE_CHECK_LABEL,
      narration: "You can wait a week. Pulse check: steady.",
      on_screen: "STEADY: nothing changes yet",
    },
    stamp: { text: "DELAYED", sub: "", tone: "warn", word: "delayed" } as any,
  });
  const after = goodScript({
    hook: "Starfield slipped.",
    pulse_take: {
      ...before.pulse_take,
      narration: "You can wait a week. My Pulse check? Weak, sadly.",
    },
    voice_tags: [1, 2, 3, 4, 5].map(() => ({
      tag: "sighs" as const,
      after: "",
      before: "So",
    })),
  });
  const p = friendShortProblems(before, after).join(" ");
  assert.match(p, /changed the hook/);
  assert.match(p, /lost the Pulse Check's reading "steady"/);
  assert.match(p, /stamp's word "delayed"/);
  assert.match(p, /5 delivery tags/);
});

test("a chapter's pass keeps the paragraphs, callouts and footage and is guarded the same way", async () => {
  const chapter = {
    paragraphs: [
      {
        narration:
          "In 2001 Rockstar shipped GTA 3 on PS2. It sold 8 million copies.",
        callout: { kind: "stat", primary: "8 million", secondary: "copies" },
        footage: { keywords: ["Liberty City"] },
      },
      {
        narration:
          "Sam Houser called it a leap. The studio bet everything on it.",
        callout: { kind: "none", primary: "", secondary: "" },
        footage: { keywords: ["studio"] },
      },
    ],
    claims: [],
  } as any;
  const llm = {
    structured: async (o: any) => {
      assert.equal(o.site, "friend.doc");
      return {
        edits: [
          {
            find: "The studio bet everything on it.",
            replace:
              "Honestly, the studio bet it all. {chuckles} Bold.",
          },
        ],
      };
    },
  } as any;
  const after = await friendChapter(llm, chapter);
  assert.equal(after.paragraphs.length, 2);
  assert.deepEqual(after.paragraphs[0], chapter.paragraphs[0]);
  assert.deepEqual(after.paragraphs[1]!.callout, chapter.paragraphs[1].callout);
  assert.equal(after.voice_tags?.[0]?.tag, "chuckles");
  assert.deepEqual(friendChapterProblems(chapter, after), []);
  const moved = {
    ...after,
    paragraphs: [
      {
        ...after.paragraphs[0]!,
        narration:
          "In 2001 Rockstar shipped GTA 3 on PS2. It sold 9 million copies.",
      },
      after.paragraphs[1]!,
    ],
  };
  assert.match(
    friendChapterProblems(chapter, moved).join(" "),
    /adds the figure 9/,
  );
});

test("the original stands when the guard or the fact check says no, and the check never runs on a guarded failure", async () => {
  let checked = 0;
  const guarded = await friendPass({
    before: "old",
    write: async () => "new",
    guard: () => ["The rewrite adds the figure 10."],
    check: async () => (checked++, []),
  });
  assert.deepEqual(guarded, {
    value: "old",
    kept: false,
    why: ["The rewrite adds the figure 10."],
  });
  assert.equal(checked, 0);
  const blocked = await friendPass({
    before: "old",
    write: async () => "new",
    guard: () => [],
    check: async () => ["wrong date"],
  });
  assert.equal(blocked.value, "old");
  assert.match(blocked.why[0]!, /fact check: wrong date/);
  const broken = await friendPass({
    before: "old",
    write: async () => {
      throw new Error("timeout");
    },
    guard: () => [],
    check: async () => [],
  });
  assert.equal(broken.value, "old");
  const fine = await friendPass({
    before: "old",
    write: async () => "new",
    guard: () => [],
    check: async () => [],
  });
  assert.deepEqual(fine, { value: "new", kept: true, why: [] });
});

test("the fact check's verdict on the pass counts blockers on changed words only", () => {
  const before = goodScript();
  const check = (quote: string) => ({
    verdict: "fail" as const,
    issues: [
      { quote, problem: "not in the sources", severity: "blocker" as const },
    ],
    rumour_labelling_ok: true,
    summary: "",
  });
  // The settled check passed this line, and the pass left it alone.
  const old = friendCheckVerdict(
    check("so that's a slip of at least three months"),
    shortSettledText(before),
  );
  assert.deepEqual(old.blockers, []);
  assert.equal(old.check.verdict, "pass");
  assert.equal(old.check.issues[0]!.severity, "minor");
  const fresh = friendCheckVerdict(
    check("even Ubisoft would blush"),
    shortSettledText(before),
  );
  assert.equal(fresh.blockers.length, 1);
  assert.equal(fresh.check.verdict, "fail");
  assert.ok(
    friendCheckVerdict(
      { ...check("x"), issues: [], rumour_labelling_ok: false },
      "",
    ).blockers.length,
  );
});

test("FRIEND_PASS: Shorts and documentary chapters by default, off, all or a named list; tests run with it off", () => {
  assert.deepEqual(friendPassFrom(undefined), ["shorts", "documentary"]);
  assert.deepEqual(friendPassFrom(""), ["shorts", "documentary"]);
  assert.deepEqual(friendPassFrom("off"), []);
  assert.deepEqual(friendPassFrom("false"), []);
  assert.deepEqual(friendPassFrom("on"), ["shorts", "documentary"]);
  assert.deepEqual(friendPassFrom("shorts"), ["shorts"]);
  assert.deepEqual(friendPassFrom("docs"), ["documentary"]);
  assert.deepEqual(friendPassFrom("recap, longform"), []);
  const cfg = testConfig("/tmp/x");
  assert.deepEqual(cfg.friendPass, []);
  assert.equal(friendPassOn(cfg, "shorts"), false);
  assert.equal(friendPassOn({ friendPass: ["shorts"] }, "shorts"), true);
  assert.equal(friendPassOn({ friendPass: ["shorts"] }, "documentary"), false);
});

test("the style lives in one constant on top of the shared voice, and the fact lock stays separate", () => {
  const p = friendPassPrompt();
  assert.ok(p.startsWith(PULSE_VOICE));
  assert.ok(p.includes(FRIEND_STYLE) && p.includes(FRIEND_FACT_LOCK));
  assert.doesNotMatch(FRIEND_STYLE, /Never change/);
  assert.match(FRIEND_FACT_LOCK, /number, price, percentage, date, name/);
  assert.doesNotMatch(`${FRIEND_STYLE}${FRIEND_FACT_LOCK}`, /—/);
});

test("the Pulse Check reads as a friend's verdict and keeps its four readings", () => {
  assert.equal(
    pulseCheckReading(
      "You can wait. My Pulse check? Steady, but don't hold your breath for a sequel.",
    ),
    "steady",
  );
  assert.equal(
    pulseCheckReading(
      "Sony hasn't said. So my Pulse check on this one? Faint, until Sony says it.",
    ),
    "faint",
  );
  assert.equal(
    pulseCheckReading("You can wait. Pulse check: weak, if you buy day one."),
    "weak",
  );
  assert.equal(
    pulseCheckReading("You can wait. My Pulse check? Great."),
    undefined,
    "only the four readings",
  );
  assert.equal(
    pulseCheckReading("My Pulse check? Steady. You can wait."),
    undefined,
    "it ends the take",
  );
  const s = goodScript({
    pulse_take: {
      label: PULSE_CHECK_LABEL,
      narration:
        "You can wait a week. My Pulse check? Steady, nothing changes yet.",
      on_screen: "STEADY: nothing changes yet",
    },
  });
  assert.deepEqual(pulseCheckProblems(s), []);
  assert.deepEqual(
    midQuestions(s),
    [],
    "its lead-in is not a question answered to nobody",
  );
  assert.equal(
    midQuestions(
      goodScript({
        pulse_take: {
          ...s.pulse_take,
          narration: "Why trust them? Not yet. Pulse check: weak.",
        },
      }),
    ).length,
    1,
    "any other question in the take still goes back",
  );
});

test("new problems are judged by kind, so a quoted word or a count doesn't make one new", () => {
  assert.deepEqual(
    newProblems(
      ['The hook is 13 words, over "x"'],
      ['The hook is 14 words, over "y"'],
    ),
    [],
  );
  assert.equal(
    newProblems([], ["Spoken word count is 104; it must be 70-100."]).length,
    1,
  );
});
