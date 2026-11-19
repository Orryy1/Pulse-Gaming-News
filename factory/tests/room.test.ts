import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROOM,
  ROOM_CRITIC_SITE,
  ROOM_EDIT_SITE,
  ROOM_LAYOUT_SITE,
  ROOM_PACK_SITE,
  ROOM_REPAIR_SITE,
  ROOM_VIEWER_SITE,
  ROOM_WRITE_SITE,
  EditorPanelSchema,
  FactPackSchema,
  RoomWriterSchema,
  answerShare,
  bothDrop,
  clearsRoom,
  factoryHosts,
  layoutDiff,
  layoutKeeps,
  narrationKey,
  numberFound,
  packUsed,
  pickDraft,
  primaryLinks,
  quoteFound,
  roomArm,
  roomCaps,
  roomChecks,
  roomEditProblems,
  roomInstruction,
  roomLinesForReport,
  roomRecord,
  runLayout,
  runRoom,
  spokenNames,
  spokenNumbers,
  verifyPack,
  writerPrompt,
  editorPrompt,
  viewerPrompt,
  packPrompt,
  type EditorRead,
  type FactPack,
  type RoomWriting,
  type ViewerRead,
} from "../src/editorial/room.ts";
import { scriptPrompt, writeScript } from "../src/editorial/editorial.ts";
import { extractArticle } from "../src/discovery/article.ts";
import { siteListed } from "../src/editorial/codex.ts";
import { spearman } from "../src/analyticsloop.ts";
import { loadConfig } from "../src/config.ts";
import type { Llm } from "../src/editorial/llm.ts";
import type { FactCheck, Script } from "../src/editorial/schema.ts";
import {
  roomCheckStep,
  roomControlRecord,
  roomEvent,
  roomWriteStep,
  type RoomStepInput,
} from "../src/roomstep.ts";
import { clusterOf, describeRun } from "../src/tools/room-proof.ts";
import { goodScript, item } from "./helpers.ts";

// ---------------------------------------------------------------- fixtures

const S = [
  "Starfield's second expansion just slipped, and Bethesda already knew why.",
  "The studio promised a December launch only eight weeks ago.",
  "That promise sat on the official roadmap with a firm date.",
  "So the obvious guess is that the content simply isn't finished.",
  "But Bethesda says the story missions are done and playable.",
  "The trouble is somewhere else entirely, in the console versions.",
  "Testers found the new planets ran badly on Xbox Series S.",
  "Bethesda's post says the extra months go to performance on that console.",
  "I think that's the right call, because a broken expansion costs more than a late one.",
];
const NARRATION = S.join(" ");
const ANSWER = S[7]!;
const WORDS = { min: 80, max: 115 };
const CHECK = { game: "Starfield", company: "Bethesda", words: WORDS };

const ARTICLE =
  'Bethesda said the extra time will go to performance on Xbox Series S. "We would rather ship it right than ship it early," said Todd Howard, director. The expansion was due in December. Players were promised the date eight weeks ago and 2 million people own the game. The story missions are done.';

const cluster = {
  hash: "starfield-slip",
  headline: "Starfield's second expansion delayed",
  gameHint: "Starfield",
  corroborated: true,
  items: [
    {
      ...item("Starfield expansion delayed", "IGN"),
      url: "https://ign.example/starfield",
    },
  ],
} as never;
const articles = [
  {
    url: "https://ign.example/starfield",
    title: "Starfield expansion delayed",
    text: ARTICLE,
  },
];

function pack(over: Partial<FactPack> = {}): FactPack {
  return {
    game: "Starfield",
    company: "Bethesda",
    what_happened:
      "Bethesda delayed Starfield's second expansion on November 18. It was due in December.",
    the_why: {
      stated: true,
      reason: "Performance on Xbox Series S",
      who: "Bethesda",
      url: "https://ign.example/starfield",
    },
    quotes: [
      {
        text: "We would rather ship it right than ship it early",
        speaker: "Todd Howard",
        role: "director",
        outlet: "IGN",
        url: "https://ign.example/starfield",
      },
    ],
    numbers: [
      {
        value: "2 million",
        spoken: "two million",
        what: "owners",
        url: "https://ign.example/starfield",
      },
    ],
    surprise: {
      detail:
        "The story missions are already done; the console versions are the hold-up.",
      url: "https://ign.example/starfield",
    },
    stakes_for_player:
      "Series S players wait longer but get a version that runs.",
    fan_argument: { side_a: "", side_b: "" },
    callback: {
      date: "2026-09",
      line: "The December date was promised eight weeks ago.",
    },
    best_questions: [
      {
        question: "Is it unfinished?",
        answer: "No, the missions are done.",
        solidity: "confirmed",
      },
      {
        question: "Why the wait?",
        answer: "Series S performance.",
        solidity: "confirmed",
      },
    ],
    thin: { thin: false, reason: "" },
    unverified: [],
    ...over,
  };
}

function writing(over: Partial<RoomWriting> = {}): RoomWriting {
  const angle = {
    question: "Why slip it?",
    answer: "Series S performance",
    solidity: "confirmed" as const,
    why_stop: "a broken promise",
    first_line: S[0]!,
  };
  return {
    angles: [angle, angle, angle, angle],
    best: 0,
    second: 1,
    kill: false,
    kill_reason: "",
    point:
      "Bethesda delayed the expansion for Series S performance, not unfinished content.",
    drafts: (["A", "B", "C"] as const).map((label, i) => ({
      label,
      angle: i === 2 ? 1 : 0,
      structure: "contradiction" as const,
      title: `Starfield's expansion slipped, draft ${label}`,
      narration: NARRATION,
      answer_line: ANSWER,
    })),
    ...over,
  };
}

function ed(
  label: string,
  overall: number,
  over: Partial<EditorRead> = {},
): EditorRead {
  return {
    label,
    clarity: Math.max(overall, 7),
    hook: Math.max(overall, 7),
    payoff: Math.max(overall, 7),
    voice: Math.max(overall, 7),
    human: Math.max(overall, 7),
    promise_kept: Math.max(overall, 7),
    overall,
    swipe: 0,
    weakness: `Weak at ${overall}: "That promise sat on the official roadmap".`,
    fix: "Cut the roadmap line.",
    second_thread: "",
    drop: false,
    ...over,
  };
}
function vw(
  label: string,
  overall: number,
  over: Partial<ViewerRead> = {},
): ViewerRead {
  return {
    label,
    stop: overall,
    stay: overall,
    got_it: overall,
    worth_it: overall,
    comment: overall,
    share: overall,
    overall,
    swipe: 0,
    lost_me: "",
    fix: "",
    drop: false,
    ...over,
  };
}

function laidOut(over: Partial<Script> = {}): Script {
  return goodScript({
    hook: S[0]!,
    beats: [
      {
        narration: `${S[1]} ${S[2]}`,
        visual: {
          kind: "date",
          primary: "December",
          secondary: "the old date",
        },
      },
      {
        narration: `${S[3]} ${S[4]}`,
        visual: { kind: "title", primary: "Missions done", secondary: "" },
      },
      {
        narration: `${S[5]} ${S[6]}`,
        visual: { kind: "title", primary: "Xbox Series S", secondary: "" },
      },
    ],
    pulse_take: {
      label: "THE CATCH",
      narration: S[7]!,
      on_screen: "Performance first",
    },
    loop_line: S[8]!,
    desk_question: undefined,
    ...over,
  });
}

const pass: FactCheck = {
  verdict: "pass",
  issues: [],
  rumour_labelling_ok: true,
  summary: "ok",
};
const fail: FactCheck = {
  verdict: "fail",
  issues: [
    { quote: "eight weeks ago", problem: "not supported", severity: "blocker" },
  ],
  rumour_labelling_ok: true,
  summary: "no",
};

interface Seen {
  site: string;
  system: string;
  content: string;
  schema: { shape?: Record<string, unknown> };
}

/** A fake model keyed by step: queues per site, the last answer repeated. */
function fakeLlm(
  q: Partial<Record<string, unknown[]>>,
  seen: Seen[] = [],
): Llm {
  return {
    structured: async (req: Seen) => {
      seen.push(req);
      const list = q[req.site];
      if (!list?.length) throw new Error(`unexpected step ${req.site}`);
      return (list.length > 1 ? list.shift() : list[0]) as never;
    },
  } as unknown as Llm;
}

function input(llm: Llm, over: Partial<RoomStepInput> = {}): RoomStepInput {
  return {
    llm,
    cfg: {
      scriptRoomViewer: true,
      scriptRoomRounds: 2,
      scriptRoomMin: 8,
      scriptRoomLinks: false,
    },
    cluster,
    articles,
    length: {
      seconds: { min: 30, max: 50 },
      wordsMin: WORDS.min,
      wordsMax: WORDS.max,
      beatsMax: 6,
    },
    mustLabelRumour: false,
    ...over,
  };
}

const deps = (checks: FactCheck[] = [pass]) => ({
  safety: () => [] as string[],
  factCheck: async () => (checks.length > 1 ? checks.shift()! : checks[0]!),
  airTime: () => [] as string[],
});

// ---------------------------------------------------------------- settings and arms

test("settings default off: no room, half share, viewer on, two rounds, pass mark 8, no links", () => {
  const keys = [
    "SCRIPT_ROOM",
    "SCRIPT_ROOM_SHARE",
    "SCRIPT_ROOM_VIEWER",
    "SCRIPT_ROOM_ROUNDS",
    "SCRIPT_ROOM_MIN",
    "SCRIPT_ROOM_LINKS",
  ];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  try {
    const cfg = loadConfig();
    assert.equal(cfg.scriptRoom, "off");
    assert.equal(cfg.scriptRoomShare, 0.5);
    assert.equal(cfg.scriptRoomViewer, true);
    assert.equal(cfg.scriptRoomRounds, 2);
    assert.equal(cfg.scriptRoomMin, 8);
    assert.equal(cfg.scriptRoomLinks, false);
    process.env.SCRIPT_ROOM = "bogus";
    process.env.SCRIPT_ROOM_ROUNDS = "9";
    assert.equal(
      loadConfig().scriptRoom,
      "off",
      "anything but check or on is off",
    );
    assert.equal(loadConfig().scriptRoomRounds, 2, "the rounds are capped");
    process.env.SCRIPT_ROOM = "on";
    assert.equal(loadConfig().scriptRoom, "on");
  } finally {
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
});

test("the arm is stable per episode, follows the share and is independent of the desk's split", () => {
  assert.equal(roomArm("ep1", 0), "control");
  assert.equal(roomArm("ep1", 1), "room");
  const ids = Array.from({ length: 400 }, (_, i) => `ep-${i}`);
  const inRoom = ids.filter((id) => roomArm(id, 0.5) === "room").length;
  assert.ok(inRoom > 160 && inRoom < 240, String(inRoom));
  for (const id of ids.slice(0, 20))
    assert.equal(roomArm(id, 0.5), roomArm(id, 0.5));
});

test("caps: one pack, one write, three reads per critic, two edits, two layouts and one repair at most", () => {
  assert.deepEqual(roomCaps(2), {
    pack: 1,
    write: 1,
    critic: 3,
    viewer: 3,
    edit: 2,
    layout: 2,
    repair: 1,
  });
  assert.deepEqual(roomCaps(9), roomCaps(2), "the settings can't lift the cap");
  assert.equal(roomCaps(0).edit, 0);
  assert.equal(roomCaps(0).critic, 1);
  assert.equal(roomCaps(1).critic, 2);
});

test("every step's site starts with room. so CODEX_CALLS can route each one or the family", () => {
  for (const s of [
    ROOM_PACK_SITE,
    ROOM_WRITE_SITE,
    ROOM_CRITIC_SITE,
    ROOM_VIEWER_SITE,
    ROOM_EDIT_SITE,
    ROOM_LAYOUT_SITE,
    ROOM_REPAIR_SITE,
  ]) {
    assert.match(s, /^room\./);
    assert.ok(siteListed(s, ["room"]));
    assert.ok(siteListed(s, [s]));
  }
  assert.ok(!siteListed(ROOM_WRITE_SITE, ["room.critic"]));
});

// ---------------------------------------------------------------- schemas

test("schemas: the pack, the writer and the critics parse their fixtures and refuse out-of-range marks", () => {
  assert.ok(FactPackSchema.safeParse(pack()).success);
  assert.ok(RoomWriterSchema.safeParse(writing()).success);
  assert.ok(
    EditorPanelSchema.safeParse({ reads: [ed("A", 7)], pick: "A" }).success,
  );
  assert.ok(
    !EditorPanelSchema.safeParse({ reads: [ed("A", 11)], pick: "A" }).success,
  );
  assert.ok(
    !FactPackSchema.safeParse({
      ...pack(),
      best_questions: [{ question: "q", answer: "a", solidity: "maybe" }],
    }).success,
  );
});

// ---------------------------------------------------------------- the pack's verification

test("a quote is kept only when a source says it word for word, after case, quotes, dashes and spaces", () => {
  const texts = [
    "He said: “We’d rather ship it right — than   ship it EARLY.”",
  ];
  assert.ok(
    quoteFound('"we\'d rather ship it right - than ship it early"', texts),
  );
  assert.ok(
    quoteFound("We'd rather ship it right -- than ship it early.", texts) ===
      false,
    "a double hyphen is not a dash",
  );
  assert.ok(
    !quoteFound("We would rather ship it right", texts),
    "a paraphrase is not a quote",
  );
  assert.ok(!quoteFound("right", texts), "one word is not a quote");
});

test("numbers are kept only when every figure is in a source; words only in the same words", () => {
  assert.ok(numberFound("$1,299.99", ["It costs 1299.99 dollars"]));
  assert.ok(numberFound("2 million", ["2 million people"]));
  assert.ok(!numberFound("$70", ["It costs $69.99"]));
  assert.ok(numberFound("two million", ["about two million players"]));
  assert.ok(!numberFound("three million", ["about two million players"]));
});

test("verifyPack drops and counts what the code can't find, and quotes over 15 words", () => {
  const long =
    "the story missions are done and playable and the planets run well on every console we have";
  const raw = pack({
    quotes: [
      pack().quotes[0]!,
      {
        text: "We never planned December",
        speaker: "x",
        role: "y",
        outlet: "z",
        url: "u",
      },
      { text: long, speaker: "x", role: "y", outlet: "z", url: "u" },
    ],
    numbers: [
      pack().numbers[0]!,
      { value: "$70", spoken: "seventy dollars", what: "price", url: "u" },
    ],
  });
  const { pack: kept, drops } = verifyPack(raw, {
    quotes: [ARTICLE],
    numbers: [ARTICLE],
  });
  assert.equal(kept.quotes.length, 1);
  assert.equal(kept.numbers.length, 1);
  assert.equal(drops.quotes, 2);
  assert.equal(drops.numbers, 1);
  assert.ok(drops.dropped.some((d) => d.includes("too long")));
});

test("packUsed: which quotes, numbers and surprise the published words carry", () => {
  const used = packUsed(
    pack(),
    `${NARRATION} "We would rather ship it right than ship it early." 2 million own it.`,
  );
  assert.deepEqual(used, { quotes: 1, numbers: 1, surprise: true });
  assert.deepEqual(packUsed(pack(), "Starfield slipped."), {
    quotes: 0,
    numbers: 0,
    surprise: false,
  });
});

test("primary links: only hosts the factory already reads, never social, at most three", () => {
  const allowed = factoryHosts([
    "https://news.xbox.com/en-us/feed/",
    "https://ign.example/starfield",
  ]);
  assert.ok(allowed("news.xbox.com"));
  assert.ok(!allowed("evil.example"));
  const links = primaryLinks(
    [
      "https://evil.example/press/release",
      "https://twitter.com/bethesda/status/1",
      "https://news.xbox.com/en-us/2026/11/18/starfield-update/",
      "https://news.xbox.com/en-us/2026/11/18/starfield-update/#top",
      "https://news.xbox.com/en-us/2026/11/18/b/",
      "https://news.xbox.com/en-us/2026/11/18/c/",
      "https://news.xbox.com/en-us/2026/11/18/d/",
    ],
    allowed,
  );
  assert.equal(links.length, ROOM.linksMax);
  assert.ok(links.every((l) => l.startsWith("https://news.xbox.com/")));
});

test("extractArticle is unchanged without the links option and lists outbound body links with it", () => {
  const html = `<html><head><title>T</title></head><body><article><p>Bethesda confirmed the delay in a post on its own site, which <a href="https://bethesda.net/news/1">says why</a> and <a href="/local">more</a>.</p></article></body></html>`;
  const plain = extractArticle(html, "https://ign.example/a");
  assert.deepEqual(Object.keys(plain).sort(), [
    "ogImage",
    "text",
    "title",
    "url",
  ]);
  const withLinks = extractArticle(html, "https://ign.example/a", {
    links: true,
  });
  assert.deepEqual(withLinks.links, ["https://bethesda.net/news/1"]);
});

// ---------------------------------------------------------------- deterministic checks

test("a clean draft passes every room check", () => {
  const { findings, counts } = roomChecks({
    narration: NARRATION,
    answerLine: ANSWER,
    ...CHECK,
  });
  assert.deepEqual(findings, []);
  assert.equal(counts.words, 101);
  assert.equal(counts.names, 0);
  assert.equal(counts.numbers, 1);
  assert.ok((counts.answer_at ?? 0) >= ROOM.answerAt);
});

test("each check fires on its own fault", () => {
  const rules = (
    narration: string,
    answerLine = ANSWER,
    o: Partial<typeof CHECK> = {},
  ) =>
    roomChecks({ narration, answerLine, ...CHECK, ...o }).findings.map(
      (f) => f.rule,
    );
  const long = NARRATION.replace(
    S[0]!,
    "Starfield's second expansion just slipped this week, and Bethesda already knew exactly why.",
  );
  assert.ok(rules(long).includes("first_long"));
  assert.ok(
    rules(
      NARRATION.replace(
        S[0]!,
        "The second expansion just slipped, and the studio knew why.",
      ),
    ).includes("first_unnamed"),
  );
  assert.ok(rules(S.slice(0, 5).join(" ")).includes("words"));
  assert.ok(
    rules(
      NARRATION.replace(
        S[8]!,
        "Would you still wait for it, or play something else this winter instead?",
      ),
    ).includes("last_line_ask"),
  );
  assert.ok(
    rules(NARRATION.replace("slipped, and", "slipped — and")).includes(
      "em_dash",
    ),
  );
  const early = [S[0], S[1], ANSWER, S[2], S[3], S[4], S[5], S[6], S[8]].join(
    " ",
  );
  assert.ok(rules(early).includes("early_answer"));
  assert.ok(
    rules(
      NARRATION,
      "Something nobody ever said in this script at all.",
    ).includes("answer_unfound"),
  );
  const names = NARRATION.replace(
    S[4]!,
    "But Todd Howard told IGN and Bloomberg the missions are done.",
  );
  assert.ok(rules(names).includes("names"));
  const nums = NARRATION.replace(
    S[4]!,
    "But 2 million players paid $70 for the 40% bigger map.",
  );
  assert.ok(rules(nums).includes("numbers"));
  const short = NARRATION.replace(S[8]!, "I'd wait. Worth it.");
  assert.ok(rules(short).includes("closer_short"));
  const echo = NARRATION.replace(
    S[8]!,
    "So the second expansion slipped because Bethesda already knew why it had to.",
  );
  assert.ok(rules(echo).includes("closer_echo"));
});

test("names and numbers are counted without the game, its maker or the game's own numeral", () => {
  assert.deepEqual(
    spokenNames("Bethesda told IGN that Todd Howard signed off on Starfield.", {
      game: "Starfield",
      company: "Bethesda",
    }).sort(),
    ["IGN", "Todd Howard"],
  );
  assert.deepEqual(
    spokenNames("Rockstar says GTA 6 lands in 2026.", {
      game: "Grand Theft Auto VI",
      company: "Rockstar",
    }),
    [],
  );
  assert.deepEqual(
    spokenNumbers(
      "GTA 6 costs $70 and sold 2 million on day one.",
      "Grand Theft Auto VI",
    ).sort(),
    ["$70", "2 million"].sort(),
  );
  assert.deepEqual(
    spokenNumbers("Grand Theft Auto VI is out.", "Grand Theft Auto VI"),
    [],
  );
});

test("answerShare finds the answer line's start as a share of the words", () => {
  assert.equal(Math.round(answerShare(NARRATION, ANSWER)! * 100), 72);
  assert.equal(answerShare(NARRATION, "too short"), undefined);
});

// ---------------------------------------------------------------- pick, clear, drop

test("the pick is the best mean of the two overall marks; a tie goes to the editor critic", () => {
  assert.equal(
    pickDraft([ed("A", 7), ed("B", 6)], [vw("A", 5), vw("B", 8)]),
    1,
    "B's mean 7 beats A's 6",
  );
  assert.equal(
    pickDraft([ed("A", 6), ed("B", 8)], [vw("A", 8), vw("B", 6)], "A"),
    0,
    "a tied mean goes to the editor's own pick",
  );
  assert.equal(
    pickDraft([ed("A", 6), ed("B", 8)], [vw("A", 8), vw("B", 6)]),
    1,
    "then to the editor's higher overall",
  );
  assert.equal(
    pickDraft([ed("A", 7), ed("B", 7)], undefined),
    0,
    "without a viewer, the editor alone; then the earlier draft",
  );
});

test("clearing needs the mean at the pass mark and no editor mark under the floor; drop needs both critics", () => {
  assert.ok(clearsRoom(ed("A", 8), vw("A", 8)));
  assert.ok(!clearsRoom(ed("A", 9), vw("A", 6)), "mean 7.5 is under 8");
  assert.ok(
    !clearsRoom(ed("A", 9, { promise_kept: 6 }), vw("A", 9)),
    "a broken promise holds it back",
  );
  assert.ok(clearsRoom(ed("A", 8), undefined));
  assert.ok(
    !clearsRoom(ed("A", 8), undefined, 9),
    "SCRIPT_ROOM_MIN moves the mark",
  );
  assert.ok(bothDrop({ drop: true }, { drop: true }));
  assert.ok(!bothDrop({ drop: true }, { drop: false }));
  assert.ok(!bothDrop({ drop: true }, undefined));
});

test("the instruction puts a broken promise first, then the weakness, a second thread, the viewer and the flags", () => {
  const i = roomInstruction({
    editor: ed("A", 6, { promise_kept: 5, second_thread: "the roadmap aside" }),
    viewer: vw("A", 5, { lost_me: "official roadmap", fix: "Cut it." }),
    findings: [{ rule: "names", problem: "3 names are read out." }],
    point: "One point.",
  });
  assert.ok(i.startsWith("First: the ending is smaller"));
  assert.ok(i.indexOf("Biggest weakness") > i.indexOf("First:"));
  assert.ok(i.includes("Cut the second thread (the roadmap aside)"));
  assert.ok(i.includes('lost interest at "official roadmap"'));
  assert.ok(i.includes("3 names are read out."));
  assert.ok(!/—/.test(i));
  const ok = roomInstruction({ editor: ed("A", 7), findings: [] });
  assert.ok(
    ok.startsWith("Biggest weakness"),
    "no promise line when the promise is kept",
  );
});

// ---------------------------------------------------------------- the loop and its stop rule

function loopSteps(o: {
  editor: Array<{ reads: EditorRead[]; pick: string }>;
  viewer?: Array<{ reads: ViewerRead[] }>;
  edits?: Array<{ title: string; narration: string } | undefined>;
  w?: RoomWriting;
  accept?: (a: { narration: string }, b: { narration: string }) => string[];
}) {
  const calls = { editor: 0, viewer: 0, edit: 0 };
  return {
    calls,
    steps: {
      pack: async () => ({
        pack: pack(),
        drops: { quotes: 0, numbers: 0, dropped: [] },
      }),
      write: async () => o.w ?? writing(),
      editor: async () => {
        calls.editor++;
        const r = o.editor.shift();
        if (!r) throw new Error("no read");
        return r;
      },
      ...(o.viewer
        ? {
            viewer: async () => {
              calls.viewer++;
              return o.viewer!.shift() ?? { reads: [] };
            },
          }
        : {}),
      edit: async () => {
        calls.edit++;
        return o.edits?.shift();
      },
      ...(o.accept ? { accept: o.accept } : {}),
      check: (n: string, a?: string) =>
        roomChecks({ narration: n, answerLine: a, ...CHECK }),
    },
  };
}

test("stop rule: a first read that clears costs no edit", async () => {
  const { steps, calls } = loopSteps({
    editor: [{ reads: [ed("A", 8), ed("B", 7), ed("C", 6)], pick: "A" }],
    viewer: [{ reads: [vw("A", 8), vw("B", 7), vw("C", 6)] }],
  });
  const run = await runRoom(steps);
  assert.equal(run.stop, "cleared");
  assert.equal(run.pick, "A");
  assert.equal(calls.edit, 0);
  assert.deepEqual(run.calls, {
    pack: 1,
    write: 1,
    critic: 1,
    viewer: 1,
    edit: 0,
    layout: 0,
    repair: 0,
  });
  assert.equal(run.final?.narration, NARRATION);
});

test("stop rule: edits until it clears, each read fresh by both critics", async () => {
  const better = {
    title: "Starfield's expansion slipped",
    narration: NARRATION.replace(
      S[2]!,
      "That date sat on the official roadmap for weeks.",
    ),
  };
  const { steps, calls } = loopSteps({
    editor: [
      { reads: [ed("A", 6), ed("B", 5), ed("C", 5)], pick: "A" },
      { reads: [ed("A", 8)], pick: "A" },
    ],
    viewer: [
      { reads: [vw("A", 6), vw("B", 5), vw("C", 5)] },
      { reads: [vw("A", 8)] },
    ],
    edits: [better],
  });
  const run = await runRoom(steps);
  assert.equal(run.stop, "cleared");
  assert.equal(calls.edit, 1);
  assert.equal(run.final?.narration, better.narration);
  assert.deepEqual(
    run.rounds.map((r) => r.mean),
    [6, 8],
  );
});

test("stop rule: a round that does not improve stops the loop and keeps the better version", async () => {
  const worse = {
    title: "t",
    narration: NARRATION.replace(
      S[2]!,
      "That date was on the roadmap, plain as day, for anyone.",
    ),
  };
  const { steps, calls } = loopSteps({
    editor: [
      { reads: [ed("A", 6), ed("B", 5), ed("C", 5)], pick: "A" },
      { reads: [ed("A", 5)], pick: "A" },
    ],
    edits: [worse],
  });
  const run = await runRoom(steps);
  assert.equal(run.stop, "no_gain");
  assert.equal(calls.edit, 1);
  assert.equal(run.final?.narration, NARRATION, "never a later worse version");
});

test("stop rule: two edit rounds at most, whatever the setting, and a refused edit costs no read", async () => {
  const e1 = {
    title: "t",
    narration: NARRATION.replace(
      S[2]!,
      "That date sat right there on the roadmap, firm as anything.",
    ),
  };
  const e2 = {
    title: "t",
    narration: NARRATION.replace(
      S[2]!,
      "That date sat on the roadmap, and nobody hedged it at all.",
    ),
  };
  const { steps, calls } = loopSteps({
    editor: [
      { reads: [ed("A", 5), ed("B", 5), ed("C", 5)], pick: "A" },
      { reads: [ed("A", 6)], pick: "A" },
      { reads: [ed("A", 7)], pick: "A" },
      { reads: [ed("A", 9)], pick: "A" },
    ],
    edits: [e1, e2, e1],
  });
  const run = await runRoom({ ...steps, rounds: 9 });
  assert.equal(calls.edit, 2);
  assert.equal(run.stop, "rounds");
  assert.ok(run.calls.critic <= 3);

  const refused = loopSteps({
    editor: [{ reads: [ed("A", 5), ed("B", 5), ed("C", 5)], pick: "A" }],
    edits: [e1, e2],
    accept: () => ["The edit adds the figure 9, which no source gives."],
  });
  const r2 = await runRoom(refused.steps);
  assert.equal(refused.calls.editor, 1, "a refused edit is never read");
  assert.equal(r2.final?.narration, NARRATION);
  assert.ok(r2.rounds.slice(1).every((r) => r.refused?.length));
});

test("a killed story and a story both critics drop come back with no final words", async () => {
  const k = loopSteps({
    editor: [{ reads: [ed("A", 8)], pick: "A" }],
    w: writing({ kill: true, kill_reason: "Nothing at stake." }),
  });
  const killed = await runRoom(k.steps);
  assert.equal(killed.stop, "killed");
  assert.equal(killed.final, undefined);
  assert.equal(k.calls.editor, 0, "a kill costs no critic");
  assert.equal(killed.kill?.why, "Nothing at stake.");

  const d = loopSteps({
    editor: [
      {
        reads: [ed("A", 4, { drop: true }), ed("B", 3), ed("C", 3)],
        pick: "A",
      },
    ],
    viewer: [{ reads: [vw("A", 3, { drop: true }), vw("B", 3), vw("C", 3)] }],
  });
  const dropped = await runRoom(d.steps);
  assert.equal(dropped.stop, "dropped");
  assert.equal(dropped.final, undefined);

  const one = loopSteps({
    editor: [
      {
        reads: [ed("A", 8, { drop: true }), ed("B", 3), ed("C", 3)],
        pick: "A",
      },
    ],
    viewer: [{ reads: [vw("A", 8), vw("B", 3), vw("C", 3)] }],
  });
  assert.equal(
    (await runRoom(one.steps)).stop,
    "cleared",
    "one critic's drop is not enough",
  );
});

test("the fact guard on an edit refuses a new figure or a quote no source says", () => {
  const corpora = { quotes: [ARTICLE], numbers: [ARTICLE] };
  const before = { title: "t", narration: NARRATION };
  assert.deepEqual(roomEditProblems(before, corpora, before), []);
  assert.equal(
    roomEditProblems(
      { title: "t", narration: `${NARRATION} It sold 9 million.` },
      corpora,
      before,
    ).length,
    1,
  );
  assert.equal(
    roomEditProblems(
      { title: "t", narration: `${NARRATION} It sold 2 million.` },
      corpora,
      before,
    ).length,
    0,
  );
  assert.equal(
    roomEditProblems(
      {
        title: "t",
        narration: `Howard said "we always planned to slip it" in the post.`,
      },
      corpora,
      before,
    ).length,
    1,
  );
  assert.equal(
    roomEditProblems(
      {
        title: "t",
        narration: `Howard said "We would rather ship it right than ship it early" today.`,
      },
      corpora,
      before,
    ).length,
    0,
  );
});

// ---------------------------------------------------------------- the layout

test("layout keeps the words: whitespace, punctuation and case may move, a word may not", () => {
  assert.ok(layoutKeeps(laidOut(), NARRATION));
  assert.ok(
    layoutKeeps(
      laidOut({ hook: S[0]!.replace(",", "").toUpperCase() }),
      NARRATION,
    ),
  );
  assert.ok(
    !layoutKeeps(
      laidOut({ hook: S[0]!.replace("slipped", "slid") }),
      NARRATION,
    ),
  );
  assert.ok(
    !layoutKeeps(laidOut({ loop_line: "" }), NARRATION),
    "a dropped sentence fails",
  );
  assert.match(
    layoutDiff(laidOut({ hook: S[0]!.replace("slipped", "slid") }), NARRATION),
    /says "slid/,
  );
  assert.equal(narrationKey("It’s — “fine.”"), narrationKey("its fine"));
});

test("runLayout: one retry with the difference, then it gives up and the caller falls back", async () => {
  const feedbacks: Array<string | undefined> = [];
  const ok = await runLayout({
    narration: NARRATION,
    layout: async (fb) => {
      feedbacks.push(fb);
      return feedbacks.length === 1
        ? laidOut({ hook: "Starfield slid." })
        : laidOut();
    },
  });
  assert.ok(ok.script);
  assert.equal(ok.calls, 2);
  assert.equal(feedbacks[0], undefined);
  assert.match(feedbacks[1]!, /differs from the locked words/);
  const bad = await runLayout({
    narration: NARRATION,
    layout: async () => laidOut({ hook: "Starfield slid." }),
  });
  assert.equal(bad.script, undefined);
  assert.equal(bad.calls, 2, "never a third layout call");
  assert.match(bad.fallback!, /changed the words/);
});

test("writeScript's layout mode: its own brief, none of the stacked shapes, the locked words and no plans", async () => {
  const seen: Seen[] = [];
  const llm = fakeLlm({ "room.layout": [laidOut()] }, seen);
  await writeScript(llm, cluster, articles, {
    mustLabelRumour: false,
    layout: { title: "Starfield's expansion slipped", narration: NARRATION },
  });
  const r = seen[0]!;
  assert.equal(r.site, ROOM_LAYOUT_SITE);
  assert.ok(r.content.includes("LOCKED NARRATION"));
  assert.ok(r.content.includes(NARRATION));
  assert.equal(r.schema.shape?.desk_plan, undefined);
  assert.equal(r.schema.shape?.payoff, undefined);
  for (const stacked of [
    "desk_question: before the take",
    "take shape",
    "Editor's desk",
    "Pulse Check",
    "Recent Shorts",
    "Three shapes work",
  ])
    assert.ok(
      !r.system.includes(stacked) && !r.content.includes(stacked),
      stacked,
    );
  assert.ok(
    r.system.includes('"timeline" for a delay'),
    "the card rules are the normal writer's",
  );
  assert.ok(!r.system.includes("—"));
});

test("off: the normal writer's brief is exactly scriptPrompt and asks for nothing of the room", async () => {
  const seen: Seen[] = [];
  const llm = {
    structured: async (req: Seen) => (seen.push(req), goodScript()),
  } as unknown as Llm;
  await writeScript(llm, cluster, articles, { mustLabelRumour: false });
  assert.equal(seen[0]!.system, scriptPrompt(true));
  assert.ok(!(seen[0] as { site?: string }).site?.startsWith("room."));
  assert.ok(!seen[0]!.content.includes("LOCKED NARRATION"));
  // The pieces scriptPrompt now shares with the layout sit where they always did.
  const p = scriptPrompt(false);
  assert.ok(
    p.indexOf('   - "timeline" for a delay') <
      p.indexOf("   Every beat also carries"),
  );
  assert.ok(p.trimEnd().endsWith("then credits the sources by name."));
});

// ---------------------------------------------------------------- the step, end to end with a fake model

function roomQueues(over: Partial<Record<string, unknown[]>> = {}) {
  return {
    "room.pack": [pack()],
    "room.write": [writing()],
    "room.critic": [{ reads: [ed("A", 8), ed("B", 7), ed("C", 6)], pick: "A" }],
    "room.viewer": [{ reads: [vw("A", 8), vw("B", 7), vw("C", 6)] }],
    "room.layout": [laidOut()],
    ...over,
  };
}

test("on: the room's words go out, laid out, fact-checked, with every call recorded", async () => {
  const seen: Seen[] = [];
  const out = await roomWriteStep(input(fakeLlm(roomQueues(), seen)), deps(), [
    "friend_pass",
  ]);
  assert.ok(out.script);
  assert.ok(layoutKeeps(out.script!, NARRATION));
  assert.equal(out.check?.verdict, "pass");
  assert.equal(out.record.wrote, true);
  assert.equal(out.record.arm, "room");
  assert.equal(out.record.mode, "on");
  assert.equal(out.record.pick, "A");
  assert.equal(out.record.editor_overall, 8);
  assert.equal(out.record.viewer_overall, 8);
  assert.deepEqual(out.record.calls, {
    pack: 1,
    write: 1,
    critic: 1,
    viewer: 1,
    edit: 0,
    layout: 1,
    repair: 0,
  });
  assert.deepEqual(out.record.skipped, ["friend_pass"]);
  assert.equal(out.record.pack?.quotes, 1);
  assert.equal(out.record.angles?.length, 4);
  // The critics never see the pack, the angles or the plan.
  for (const r of seen.filter(
    (x) => x.site === "room.critic" || x.site === "room.viewer",
  )) {
    assert.ok(!r.content.includes("FACT PACK"));
    assert.ok(!r.content.includes("Why slip it?"));
    assert.ok(!r.content.includes(pack().surprise.detail));
  }
  // The writer's brief is the room's own, not the stacked one.
  const w = seen.find((x) => x.site === "room.write")!;
  assert.ok(w.system.includes(`at most ${ROOM.namesMax} spoken proper names`));
  assert.ok(
    !w.system.includes("desk_question") && !w.system.includes("Pulse Check"),
  );
  const ev = roomEvent(out.record);
  assert.equal(ev.wrote, true);
});

test("on: a fact check that blocks gets one repair; still blocked, the normal writer writes it", async () => {
  const edits = {
    edits: [{ find: "only eight weeks ago", replace: "recently" }],
  };
  const blocked = await roomWriteStep(
    input(fakeLlm(roomQueues({ "room.repair": [edits] }))),
    deps([fail, fail]),
  );
  assert.equal(blocked.script, undefined);
  assert.match(blocked.record.fallback!, /^fact check/);
  assert.equal(blocked.record.calls.repair, 1);
  assert.equal(blocked.record.wrote, false);

  const fixed = await roomWriteStep(
    input(fakeLlm(roomQueues({ "room.repair": [edits] }))),
    deps([fail, pass]),
  );
  assert.ok(fixed.script);
  assert.ok(fixed.script!.beats[0]!.narration.includes("recently"));
  assert.equal(fixed.record.wrote, true);
  assert.equal(fixed.record.calls.repair, 1);
});

test("on: a kill, a drop by both critics or a layout that changes the words falls back, recorded", async () => {
  const seen: Seen[] = [];
  const killed = await roomWriteStep(
    input(
      fakeLlm(
        roomQueues({
          "room.write": [writing({ kill: true, kill_reason: "Thin." })],
        }),
        seen,
      ),
    ),
    deps(),
  );
  assert.equal(killed.script, undefined);
  assert.equal(killed.record.fallback, "killed: Thin.");
  assert.ok(!seen.some((s) => s.site === "room.critic"));

  const dropped = await roomWriteStep(
    input(
      fakeLlm(
        roomQueues({
          "room.critic": [
            {
              reads: [ed("A", 3, { drop: true }), ed("B", 3), ed("C", 3)],
              pick: "A",
            },
          ],
          "room.viewer": [
            { reads: [vw("A", 3, { drop: true }), vw("B", 3), vw("C", 3)] },
          ],
        }),
      ),
    ),
    deps(),
  );
  assert.equal(dropped.record.fallback, "both critics dropped the story");
  assert.deepEqual(dropped.record.drop, { editor: true, viewer: true });

  const changed = await roomWriteStep(
    input(
      fakeLlm(
        roomQueues({ "room.layout": [laidOut({ hook: "Starfield slid." })] }),
      ),
    ),
    deps(),
  );
  assert.equal(changed.script, undefined);
  assert.match(changed.record.fallback!, /^layout:/);
  assert.equal(changed.record.calls.layout, 2);

  const rumour = await roomWriteStep(
    input(fakeLlm(roomQueues())),
    deps([{ ...pass, rumour_labelling_ok: false }]),
  );
  assert.equal(rumour.record.fallback, "rumour labelling");
});

test("on: the viewer critic stays out under SCRIPT_ROOM_VIEWER=false", async () => {
  const seen: Seen[] = [];
  const out = await roomWriteStep(
    input(fakeLlm(roomQueues(), seen), {
      cfg: {
        scriptRoomViewer: false,
        scriptRoomRounds: 2,
        scriptRoomMin: 8,
        scriptRoomLinks: false,
      },
    }),
    deps(),
  );
  assert.ok(!seen.some((s) => s.site === "room.viewer"));
  assert.equal(out.record.calls.viewer, 0);
  assert.equal(out.record.viewer_overall, undefined);
});

test("check: one pack call, recorded with what the published script used; the control arm costs nothing", async () => {
  const seen: Seen[] = [];
  const rec = await roomCheckStep(
    input(fakeLlm({ "room.pack": [pack()] }, seen)),
    goodScript(),
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.site, ROOM_PACK_SITE);
  assert.equal(rec.mode, "check");
  assert.equal(rec.calls.pack, 1);
  assert.equal(rec.calls.write, 0);
  assert.equal(rec.pack?.stated_reason, true);
  assert.equal(rec.pack?.surprise, true);
  assert.equal(rec.pack?.thin, false);
  assert.deepEqual(rec.used, { quotes: 0, numbers: 0, surprise: false });
  const ctl = roomControlRecord("on");
  assert.equal(ctl.arm, "control");
  assert.deepEqual(Object.values(ctl.calls), [0, 0, 0, 0, 0, 0, 0]);
});

test("the record keeps each critic's mark separately and the kept round's counts", () => {
  const rec = roomRecord({ arm: "room", mode: "on", wrote: true });
  assert.equal(rec.editor_overall, undefined);
  assert.deepEqual(rec.calls, {
    pack: 0,
    write: 0,
    critic: 0,
    viewer: 0,
    edit: 0,
    layout: 0,
    repair: 0,
  });
});

// ---------------------------------------------------------------- the weekly report

test("the weekly lines: room against control, no verdict before 20 a side, each critic against retention", () => {
  const rows = (
    arm: "room" | "control",
    n: number,
    viewed: number,
    wrote = true,
  ) =>
    Array.from({ length: n }, (_, i) => ({
      arm,
      wrote,
      editor: 5 + (i % 4),
      viewer: 4 + (i % 5),
      views: 1000,
      viewed_pct: viewed + (i % 4),
      comments: 2,
    }));
  const few = roomLinesForReport(
    [...rows("room", 5, 60), ...rows("control", 30, 50)],
    spearman,
  );
  assert.match(few.join("\n"), /no verdict before 20 a side/);
  assert.match(few.join("\n"), /editor critic: 5 of 20/);
  const many = roomLinesForReport(
    [
      ...rows("room", 20, 60),
      ...rows("control", 20, 50),
      ...rows("room", 3, 40, false),
    ],
    spearman,
  );
  assert.match(many[0]!, /room wrote 20 Shorts/);
  assert.match(many[0]!, /room arm, normal writer 3 Shorts/);
  assert.match(many[1]!, /10\.0 points/);
  assert.match(many[2]!, /editor critic: rank correlation/);
  assert.match(many[2]!, /viewer critic: rank correlation/);
  assert.deepEqual(roomLinesForReport([], spearman), []);
});

// ---------------------------------------------------------------- prompts and the proof tool

test("prompts: no em dash, the critics' corrections in the writer's brief, no stacked rules", () => {
  for (const p of [
    writerPrompt(WORDS),
    editorPrompt(),
    viewerPrompt(),
    packPrompt(),
  ])
    assert.ok(!p.includes("—"));
  const w = writerPrompt(WORDS);
  assert.ok(w.includes("80 to 115 spoken words"));
  assert.ok(w.includes(`at most ${ROOM.numbersSpokenMax} numbers`));
  assert.ok(w.includes("after 70% of the words"));
  assert.ok(w.includes("No echo of the first line"));
  assert.ok(w.includes('"X, not Y"'));
  for (const stacked of [
    "desk_question",
    "skeleton",
    "take shape",
    "Pulse Check",
    "loop_line",
  ])
    assert.ok(!w.includes(stacked), stacked);
  assert.ok(editorPrompt().includes("promise_kept"));
  assert.ok(editorPrompt().includes("second_thread"));
  assert.ok(viewerPrompt().includes("drop"));
});

test("the proof tool reads episodes or clusters and prints a run without a model", () => {
  assert.equal(
    clusterOf({ id: "e1", story_json: { headline: "h", items: [] } })?.headline,
    "h",
  );
  assert.equal(
    clusterOf({ hash: "c", headline: "h2", items: [] })?.headline,
    "h2",
  );
  assert.equal(clusterOf({ id: "x" }), undefined);
  const text = describeRun("e1", {
    drafts: [],
    rounds: [{ round: 0, label: "A", mean: 7, findings: [] }],
    stop: "rounds",
    calls: {
      pack: 1,
      write: 1,
      critic: 1,
      viewer: 1,
      edit: 0,
      layout: 0,
      repair: 0,
    },
    pack: pack(),
  });
  assert.match(text, /PACK what happened/);
  assert.match(text, /ROUND 0: mean 7/);
});
