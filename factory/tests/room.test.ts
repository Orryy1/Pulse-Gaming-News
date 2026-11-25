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
  ROOM_VOICE_SITE,
  ROOM_WRITE_SITE,
  EditorPanelSchema,
  FactPackSchema,
  RoomVoiceSchema,
  RoomWriterSchema,
  answerInFirst,
  answerShare,
  blockedSentence,
  claimCorpus,
  firstGivesAway,
  isCutAnswer,
  repairFeedback,
  retryCut,
  unsourcedSentences,
  verdictIn,
  voiceRoom,
  writeRoom,
  bothDrop,
  clearsRoom,
  factoryHosts,
  iThinkBecause,
  layoutDiff,
  layoutKeeps,
  narrationKey,
  numberFound,
  packUsed,
  pickDraft,
  pickVersion,
  primaryLinks,
  quoteFound,
  recentNote,
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
  varietyProblems,
  verifyPack,
  voicePrompt,
  writerPrompt,
  editorPrompt,
  viewerPrompt,
  packPrompt,
  type EditorRead,
  type FactPack,
  type RecentShape,
  type RoomVoiced,
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
  recentShapesFrom,
  roomCheckStep,
  roomControlRecord,
  roomEvent,
  roomWriteStep,
  type RoomStepInput,
} from "../src/roomstep.ts";
import { clusterOf, describeRun } from "../src/tools/room-proof.ts";
import { goodScript, item, testConfig } from "./helpers.ts";
import { CRAFT_RULE, shortRuleNote } from "../src/editorial/shortrules.ts";

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
/** The voice pass's version: the same facts, told in order, the answer still late, a plain consequence last. */
const VOICED = [
  S[0],
  "Eight weeks ago the studio put a December date on its own roadmap, firm and public.",
  S[3],
  S[4],
  S[5],
  S[6],
  S[7],
  "So Series S owners wait a little longer and get an expansion that actually runs on their console.",
].join(" ");

const ARTICLE =
  'Bethesda said the extra time will go to performance on Xbox Series S, where testers found the new planets ran badly. "We would rather ship it right than ship it early," said Todd Howard, director. The expansion was due in December. Players were promised the date eight weeks ago and 2 million people own the game. The story missions are done.';

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
      first_line_shape: "plain_surprise" as const,
      ending: "verdict" as const,
    })),
    ...over,
  };
}

function voiced(over: Partial<RoomVoiced> = {}): RoomVoiced {
  return {
    form: "in_order",
    title: "Starfield's expansion slipped for one console",
    narration: VOICED,
    answer_line: ANSWER,
    first_line_shape: "consequence",
    ending: "consequence",
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
    drop_reason: "",
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
    drop_reason: "",
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
      const answer = list.length > 1 ? list.shift() : list[0];
      // An Error in the queue is a failed call (a cut answer, a refusal).
      if (answer instanceof Error) throw answer;
      return answer as never;
    },
  } as unknown as Llm;
}

const CFG = {
  scriptRoomViewer: true,
  scriptRoomRounds: 1,
  scriptRoomMin: 8,
  scriptRoomLinks: false,
  scriptRoomVoice: true,
};

function input(llm: Llm, over: Partial<RoomStepInput> = {}): RoomStepInput {
  return {
    llm,
    cfg: CFG,
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

test("settings default off: no room, half share, viewer and voice on, one edit, pass mark 8, no links", () => {
  const keys = [
    "SCRIPT_ROOM",
    "SCRIPT_ROOM_SHARE",
    "SCRIPT_ROOM_VIEWER",
    "SCRIPT_ROOM_ROUNDS",
    "SCRIPT_ROOM_MIN",
    "SCRIPT_ROOM_LINKS",
    "SCRIPT_ROOM_VOICE",
  ];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  try {
    const cfg = loadConfig();
    assert.equal(cfg.scriptRoom, "off");
    assert.equal(cfg.scriptRoomShare, 0.5);
    assert.equal(cfg.scriptRoomViewer, true);
    assert.equal(cfg.scriptRoomVoice, true);
    assert.equal(cfg.scriptRoomRounds, 1);
    assert.equal(cfg.scriptRoomMin, 8);
    assert.equal(cfg.scriptRoomLinks, false);
    process.env.SCRIPT_ROOM = "bogus";
    process.env.SCRIPT_ROOM_ROUNDS = "9";
    assert.equal(
      loadConfig().scriptRoom,
      "off",
      "anything but check or on is off",
    );
    assert.equal(
      loadConfig().scriptRoomRounds,
      1,
      "the edit rounds are capped",
    );
    process.env.SCRIPT_ROOM = "on";
    process.env.SCRIPT_ROOM_VOICE = "false";
    assert.equal(loadConfig().scriptRoom, "on");
    assert.equal(loadConfig().scriptRoomVoice, false);
  } finally {
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
});

test("the arm is stable per episode and follows the share", () => {
  assert.equal(roomArm("ep1", 0), "control");
  assert.equal(roomArm("ep1", 1), "room");
  const ids = Array.from({ length: 400 }, (_, i) => `ep-${i}`);
  const inRoom = ids.filter((id) => roomArm(id, 0.5) === "room").length;
  assert.ok(inRoom > 160 && inRoom < 240, String(inRoom));
  for (const id of ids.slice(0, 20))
    assert.equal(roomArm(id, 0.5), roomArm(id, 0.5));
});

test("caps: one pack, one write and one voice (each with one retry), one edit, three reads per critic, two layouts and one repair at most", () => {
  assert.deepEqual(roomCaps(1), {
    pack: 1,
    write: 2,
    critic: 3,
    viewer: 3,
    edit: 1,
    voice: 2,
    layout: 2,
    repair: 1,
  });
  assert.deepEqual(roomCaps(9), roomCaps(1), "the settings can't lift the cap");
  assert.equal(roomCaps(0).edit, 0);
  assert.equal(roomCaps(1, false).voice, 0);
});

test("every step's site starts with room. so CODEX_CALLS can route each one or the family", () => {
  for (const s of [
    ROOM_PACK_SITE,
    ROOM_WRITE_SITE,
    ROOM_CRITIC_SITE,
    ROOM_VIEWER_SITE,
    ROOM_EDIT_SITE,
    ROOM_VOICE_SITE,
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

test("schemas: the pack, the writer, the voice and the critics parse their fixtures and refuse out-of-range marks", () => {
  assert.ok(FactPackSchema.safeParse(pack()).success);
  assert.ok(RoomWriterSchema.safeParse(writing()).success);
  assert.ok(RoomVoiceSchema.safeParse(voiced()).success);
  assert.ok(
    !RoomVoiceSchema.safeParse(voiced({ ending: "punchline" as never }))
      .success,
  );
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
    !quoteFound("We'd rather ship it right -- than ship it early.", texts),
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
  for (const tell of [
    "You'd assume the missions were the problem.",
    "That said, the missions are done.",
    "Which is why nobody saw it coming.",
    "In other words, the console is the problem.",
    "Here's how he put it on the blog.",
  ])
    assert.ok(
      rules(NARRATION.replace(S[3]!, tell)).includes("tell_phrase"),
      tell,
    );
});

test("variety: no form, first line or ending of the last three room Shorts, and one 'I think ... because' in four", () => {
  const recent: RecentShape[] = [
    {
      form: "in_order",
      first_line: "number",
      ending: "reveal",
      i_think: false,
    },
    {
      form: "tiny_story",
      first_line: "quote",
      ending: "dry_line",
      i_think: true,
    },
    { form: "read_again", first_line: "question", ending: "consequence" },
    {
      form: "contradiction_hangs",
      first_line: "consequence",
      ending: "verdict",
    },
  ];
  assert.deepEqual(
    varietyProblems(
      {
        form: "blunt_then_proven",
        first_line: "plain_surprise",
        ending: "verdict",
      },
      recent,
    ),
    [],
  );
  assert.equal(
    varietyProblems(
      { form: "in_order", first_line: "plain_surprise", ending: "verdict" },
      recent,
    ).length,
    1,
  );
  assert.equal(
    varietyProblems(
      { form: "real_question", first_line: "quote", ending: "dry_line" },
      recent,
    ).length,
    2,
  );
  assert.match(
    varietyProblems(
      {
        form: "real_question",
        first_line: "plain_surprise",
        ending: "verdict",
        i_think: true,
      },
      recent,
    ).join(" "),
    /once in 4/,
  );
  // The fourth Short back is outside the window: an "I think" ending there doesn't count.
  const older = [{}, {}, {}, { i_think: true }] as RecentShape[];
  assert.deepEqual(varietyProblems({ i_think: true }, older), []);
  assert.ok(iThinkBecause("I think that's right, because it runs."));
  assert.ok(!iThinkBecause("That's right, because it runs."));
  const note = recentNote(recent);
  assert.match(
    note,
    /Do not repeat the last 3: no form in_order, tiny_story, read_again/,
  );
  assert.match(note, /do not end that way/);
  assert.equal(recentNote([]), "");
  assert.ok(
    roomChecks({
      narration: NARRATION,
      answerLine: ANSWER,
      ...CHECK,
      shape: { ending: "reveal" },
      recent,
    }).findings.some((f) => f.rule === "variety"),
  );
});

test("the stored records feed the variety memory, newest first, room-written ones only", () => {
  const rec = (form: string, wrote: boolean) => ({
    ...roomRecord({ arm: "room", mode: "on", wrote }),
    form,
    ending: "reveal",
    i_think: true,
  });
  const shapes = recentShapesFrom([
    rec("in_order", true),
    rec("tiny_story", false),
    null,
    rec("read_again", true),
  ]);
  assert.deepEqual(
    shapes.map((s) => s.form),
    ["in_order", "read_again"],
  );
  assert.equal(shapes[0]!.i_think, true);
  assert.equal(
    recentShapesFrom(Array.from({ length: 12 }, () => rec("x", true))).length,
    ROOM.recentSeen,
  );
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

test("answerInFirst: the answer line as the first sentence, or most of its words there, gives it away", () => {
  assert.ok(!answerInFirst(NARRATION, [ANSWER], "Starfield"));
  assert.ok(
    answerInFirst(`${ANSWER} ${S.slice(1).join(" ")}`, [ANSWER], "Starfield"),
  );
  assert.ok(
    answerInFirst(
      `Starfield slipped so Bethesda can fix performance on the Series S console. ${S.slice(1).join(" ")}`,
      ["Series S performance"],
      "Starfield",
    ),
  );
  assert.ok(!answerInFirst(NARRATION, [""], "Starfield"));
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

test("the version kept: the best mean, a tie to the edited version, then the original, then the voiced one", () => {
  const r = (
    version: "original" | "edited" | "voiced",
    e: number,
    v?: number,
  ) => ({
    version,
    editor: { overall: e },
    ...(v !== undefined ? { viewer: { overall: v } } : {}),
  });
  assert.equal(
    pickVersion([r("original", 6, 6), r("edited", 7, 7), r("voiced", 8, 7)]),
    "voiced",
  );
  assert.equal(
    pickVersion([r("voiced", 7, 7), r("edited", 8, 6), r("original", 7, 7)]),
    "edited",
  );
  assert.equal(
    pickVersion([r("voiced", 7, 7), r("original", 7, 7)]),
    "original",
  );
  assert.equal(pickVersion([]), undefined);
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

// ---------------------------------------------------------------- the loop

type Panel = { reads: EditorRead[]; pick: string };
function loopSteps(o: {
  editor: Panel[];
  viewer?: Array<{ reads: ViewerRead[] }>;
  edits?: Array<{ title: string; narration: string } | undefined>;
  voice?: Array<RoomVoiced | Error>;
  w?: RoomWriting;
  accept?: (a: { narration: string }, b: { narration: string }) => string[];
  recent?: RecentShape[];
}) {
  const calls = { editor: 0, viewer: 0, edit: 0, voice: 0 };
  const shown: string[][] = [];
  return {
    calls,
    shown,
    steps: {
      pack: async () => ({
        pack: pack(),
        drops: { quotes: 0, numbers: 0, dropped: [] },
      }),
      write: async () => o.w ?? writing(),
      editor: async (d: Array<{ label: string }>) => {
        calls.editor++;
        shown.push(d.map((x) => x.label));
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
      ...(o.voice
        ? {
            voice: async () => {
              calls.voice++;
              const v = o.voice!.shift();
              if (!v || v instanceof Error) throw v ?? new Error("no voice");
              return v;
            },
          }
        : {}),
      ...(o.accept ? { accept: o.accept } : {}),
      ...(o.recent ? { recent: o.recent } : {}),
      game: () => "Starfield",
      check: (n: string, a?: string, shape?: RecentShape) =>
        roomChecks({
          narration: n,
          answerLine: a,
          ...CHECK,
          ...(shape ? { shape } : {}),
        }),
    },
  };
}

const EDITED = {
  title: "Starfield's expansion slipped",
  narration: NARRATION.replace(
    S[2]!,
    "That date sat on the official roadmap for weeks.",
  ),
};

test("a pick that clears with the voice pass off costs no edit and no second read", async () => {
  const { steps, calls } = loopSteps({
    editor: [{ reads: [ed("A", 8), ed("B", 7), ed("C", 6)], pick: "A" }],
    viewer: [{ reads: [vw("A", 8), vw("B", 7), vw("C", 6)] }],
  });
  const run = await runRoom(steps);
  assert.equal(run.stop, "cleared");
  assert.equal(run.pick, "A");
  assert.equal(run.won, "original");
  assert.equal(calls.edit, 0);
  assert.deepEqual(run.calls, {
    pack: 1,
    write: 1,
    critic: 1,
    viewer: 1,
    edit: 0,
    voice: 0,
    layout: 0,
    repair: 0,
  });
  assert.equal(run.final?.narration, NARRATION);
  assert.equal(run.final?.ending, "verdict");
});

test("under the bar: one edit, the voice pass on the edit, both read side by side and the better kept", async () => {
  const { steps, calls, shown } = loopSteps({
    editor: [
      { reads: [ed("A", 6), ed("B", 5), ed("C", 5)], pick: "A" },
      { reads: [ed("O", 6), ed("E", 7), ed("V", 8)], pick: "V" },
    ],
    viewer: [
      { reads: [vw("A", 6), vw("B", 5), vw("C", 5)] },
      { reads: [vw("O", 6), vw("E", 7), vw("V", 8)] },
    ],
    edits: [EDITED],
    voice: [voiced()],
  });
  const run = await runRoom(steps);
  assert.equal(run.stop, "compared");
  assert.equal(run.won, "voiced");
  assert.equal(run.final?.narration, VOICED);
  assert.equal(run.final?.form, "in_order");
  assert.equal(run.final?.ending, "consequence");
  assert.deepEqual(
    shown[1],
    ["O", "E", "V"],
    "the critics read the versions side by side",
  );
  assert.deepEqual(
    [calls.edit, calls.voice, calls.editor, calls.viewer],
    [1, 1, 2, 2],
  );
  assert.deepEqual(
    run.rounds.filter((r) => r.round === 2).map((r) => [r.version, r.mean]),
    [
      ["original", 6],
      ["edited", 7],
      ["voiced", 8],
    ],
  );
});

test("a tie between the edited and the voiced versions goes to the edited one", async () => {
  const { steps } = loopSteps({
    editor: [
      { reads: [ed("A", 6), ed("B", 5), ed("C", 5)], pick: "A" },
      { reads: [ed("O", 6), ed("E", 8), ed("V", 8)], pick: "V" },
    ],
    edits: [EDITED],
    voice: [voiced()],
  });
  const run = await runRoom(steps);
  assert.equal(run.won, "edited");
  assert.equal(run.final?.narration, EDITED.narration);
});

test("a pick that clears still meets the voice pass; the critics choose", async () => {
  const { steps, calls } = loopSteps({
    editor: [
      { reads: [ed("A", 8), ed("B", 7), ed("C", 6)], pick: "A" },
      { reads: [ed("O", 8), ed("V", 7)], pick: "O" },
    ],
    voice: [voiced()],
  });
  const run = await runRoom(steps);
  assert.equal(calls.edit, 0, "a pick that clears is never edited");
  assert.equal(calls.voice, 1);
  assert.equal(run.won, "original");
});

test("the voice pass is refused by code when it puts the answer first or repeats the room's recent shapes", async () => {
  const first = loopSteps({
    editor: [
      { reads: [ed("A", 6), ed("B", 5), ed("C", 5)], pick: "A" },
      { reads: [ed("O", 6), ed("E", 7)], pick: "E" },
    ],
    edits: [EDITED],
    voice: [
      voiced({ narration: `${ANSWER} ${S.slice(1, 7).join(" ")} ${S[8]}` }),
    ],
  });
  const r1 = await runRoom(first.steps);
  assert.match(
    r1.voice!.refused!.join(" "),
    /answer away in its first sentence/,
  );
  assert.deepEqual(first.shown[1], ["O", "E"], "a refused voice is never read");
  assert.equal(r1.won, "edited");

  const repeat = loopSteps({
    editor: [
      { reads: [ed("A", 6), ed("B", 5), ed("C", 5)], pick: "A" },
      { reads: [ed("O", 6), ed("E", 7)], pick: "E" },
    ],
    edits: [EDITED],
    voice: [voiced()],
    recent: [{ form: "tiny_story", ending: "consequence" }],
  });
  const r2 = await runRoom(repeat.steps);
  assert.match(r2.voice!.refused!.join(" "), /ending "consequence" repeats/);

  const failed = loopSteps({
    editor: [
      { reads: [ed("A", 6), ed("B", 5), ed("C", 5)], pick: "A" },
      { reads: [ed("O", 6), ed("E", 7)], pick: "E" },
    ],
    edits: [EDITED],
    voice: [new Error("timeout")],
  });
  const r3 = await runRoom(failed.steps);
  assert.match(r3.voice!.refused!.join(" "), /voice pass failed: timeout/);
  assert.equal(r3.won, "edited");
});

test("a refused edit leaves the pick; the voice pass then works on the pick; the fact guard covers both", async () => {
  const refused = loopSteps({
    editor: [{ reads: [ed("A", 5), ed("B", 5), ed("C", 5)], pick: "A" }],
    edits: [EDITED],
    voice: [voiced()],
    accept: () => ["The edit adds the figure 9, which no source gives."],
  });
  const run = await runRoom(refused.steps);
  assert.equal(refused.calls.editor, 1, "nothing new to read: no second read");
  assert.equal(run.won, "original");
  assert.equal(run.final?.narration, NARRATION);
  assert.ok(run.edit?.refused?.length);
  assert.ok(run.voice?.refused?.length);
});

test("the caps hold whatever the settings say, and an unread comparison keeps the edit", async () => {
  const { steps, calls } = loopSteps({
    editor: [{ reads: [ed("A", 5), ed("B", 5), ed("C", 5)], pick: "A" }],
    edits: [EDITED, EDITED, EDITED],
    voice: [voiced(), voiced()],
  });
  const run = await runRoom({ ...steps, rounds: 9 });
  assert.equal(calls.edit, 1);
  assert.equal(calls.voice, 1);
  assert.ok(run.calls.critic <= ROOM.caps.critic);
  assert.equal(run.stop, "unread");
  assert.equal(run.won, "edited");
  const none = loopSteps({
    editor: [{ reads: [ed("A", 5), ed("B", 5), ed("C", 5)], pick: "A" }],
    edits: [EDITED],
  });
  await runRoom({ ...none.steps, rounds: 0 });
  assert.equal(none.calls.edit, 0, "SCRIPT_ROOM_ROUNDS=0 skips the edit");
});

test("a killed story and a story both critics drop come back with no final words; a drop keeps its reason", async () => {
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
        reads: [
          ed("A", 4, {
            drop: true,
            drop_reason: "Nobody outside the game cares.",
          }),
          ed("B", 3),
          ed("C", 3),
        ],
        pick: "A",
      },
    ],
    viewer: [
      {
        reads: [
          vw("A", 3, { drop: true, drop_reason: "Nothing for me." }),
          vw("B", 3),
          vw("C", 3),
        ],
      },
    ],
  });
  const dropped = await runRoom(d.steps);
  assert.equal(dropped.stop, "dropped");
  assert.equal(dropped.final, undefined);
  assert.deepEqual(dropped.drop, {
    editor: true,
    viewer: true,
    why: "Nobody outside the game cares. / Nothing for me.",
  });

  const one = loopSteps({
    editor: [
      {
        reads: [
          ed("A", 8, { drop: true, drop_reason: "Small." }),
          ed("B", 3),
          ed("C", 3),
        ],
        pick: "A",
      },
    ],
    viewer: [{ reads: [vw("A", 8), vw("B", 3), vw("C", 3)] }],
  });
  const r = await runRoom(one.steps);
  assert.equal(r.stop, "cleared", "one critic's drop is not enough");
  assert.deepEqual(
    r.drop,
    { editor: true, viewer: false, why: "Small." },
    "but it is recorded",
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
    "room.critic": [
      { reads: [ed("A", 8), ed("B", 7), ed("C", 6)], pick: "A" },
      { reads: [ed("O", 8), ed("V", 7)], pick: "O" },
    ],
    "room.viewer": [
      { reads: [vw("A", 8), vw("B", 7), vw("C", 6)] },
      { reads: [vw("O", 8), vw("V", 7)] },
    ],
    "room.voice": [voiced()],
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
  assert.equal(out.record.won, "original");
  assert.equal(
    out.record.editor_overall,
    8,
    "the kept version's side-by-side marks",
  );
  assert.equal(out.record.viewer_overall, 8);
  assert.equal(out.record.form, "contradiction");
  assert.equal(out.record.ending, "verdict");
  assert.equal(out.record.i_think, true);
  assert.deepEqual(out.record.calls, {
    pack: 1,
    write: 1,
    critic: 2,
    viewer: 2,
    edit: 0,
    voice: 1,
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
  // The writer's and the voice's briefs are the room's own, not the stacked one.
  for (const site of ["room.write", "room.voice"]) {
    const w = seen.find((x) => x.site === site)!;
    assert.equal(
      `${w.system}\n${w.content}`.split(CRAFT_RULE).length - 1,
      1,
      `${site}: the craft rules once, from the shared text`,
    );
    assert.ok(
      !w.system.includes("desk_question") && !w.system.includes("Pulse Check"),
      site,
    );
  }
  const ev = roomEvent(out.record);
  assert.equal(ev.wrote, true);
  assert.equal(ev.won, "original");
});

test("on: the variety memory reaches the writer and the voice pass", async () => {
  const seen: Seen[] = [];
  await roomWriteStep(
    input(fakeLlm(roomQueues(), seen), {
      recent: [{ form: "read_again", first_line: "number", ending: "reveal" }],
    }),
    deps(),
  );
  for (const site of ["room.write", "room.voice"])
    assert.match(
      seen.find((x) => x.site === site)!.content,
      /VARIETY: the last 1 room Shorts/,
      site,
    );
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

test("on: a kill, a drop by both critics or a layout that changes the words falls back, recorded with why", async () => {
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
              reads: [
                ed("A", 3, { drop: true, drop_reason: "Niche." }),
                ed("B", 3),
                ed("C", 3),
              ],
              pick: "A",
            },
          ],
          "room.viewer": [
            {
              reads: [
                vw("A", 3, { drop: true, drop_reason: "Not for me." }),
                vw("B", 3),
                vw("C", 3),
              ],
            },
          ],
        }),
      ),
    ),
    deps(),
  );
  assert.equal(
    dropped.record.fallback,
    "both critics dropped the story: Niche. / Not for me.",
  );
  assert.deepEqual(dropped.record.drop, {
    editor: true,
    viewer: true,
    why: "Niche. / Not for me.",
  });

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

test("on: the viewer critic and the voice pass stay out when switched off", async () => {
  const seen: Seen[] = [];
  const out = await roomWriteStep(
    input(fakeLlm(roomQueues(), seen), {
      cfg: { ...CFG, scriptRoomViewer: false, scriptRoomVoice: false },
    }),
    deps(),
  );
  assert.ok(
    !seen.some((s) => s.site === "room.viewer" || s.site === "room.voice"),
  );
  assert.equal(out.record.calls.viewer, 0);
  assert.equal(out.record.calls.voice, 0);
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
  assert.ok(Object.values(ctl.calls).every((n) => n === 0));
});

test("the record starts with no calls and no marks", () => {
  const rec = roomRecord({ arm: "room", mode: "on", wrote: true });
  assert.equal(rec.editor_overall, undefined);
  assert.deepEqual(rec.calls, {
    pack: 0,
    write: 0,
    critic: 0,
    viewer: 0,
    edit: 0,
    voice: 0,
    layout: 0,
    repair: 0,
  });
});

// ---------------------------------------------------------------- the weekly report

test("the weekly lines: room against control, no verdict before 20 a side, each critic, and the stories it could not use", () => {
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
      won: (i % 2 ? "voiced" : "edited") as "voiced" | "edited",
    }));
  const few = roomLinesForReport(
    [...rows("room", 5, 60), ...rows("control", 30, 50)],
    spearman,
  );
  assert.match(few.join("\n"), /no verdict before 20 a side/);
  assert.match(few.join("\n"), /editor critic: 5 of 20/);
  const back = [
    { arm: "room" as const, wrote: false, killed: true },
    {
      arm: "room" as const,
      wrote: false,
      drop: { editor: true, viewer: true },
    },
    {
      arm: "room" as const,
      wrote: true,
      drop: { editor: true, viewer: false },
    },
  ];
  const many = roomLinesForReport(
    [
      ...rows("room", 20, 60),
      ...rows("control", 20, 50),
      ...rows("room", 3, 40, false),
      ...back,
    ],
    spearman,
  );
  assert.match(many[0]!, /room wrote 21 Shorts/);
  assert.match(many[0]!, /room arm, normal writer 5 Shorts/);
  assert.match(many[1]!, /average viewed/);
  assert.match(many[2]!, /editor critic: rank correlation/);
  assert.match(many[2]!, /viewer critic: rank correlation/);
  assert.match(
    many[3]!,
    /2 of 26 in its arm went back to the normal writer \(1 killed by the writer, 1 dropped by both critics\); 1 more were dropped by one critic/,
  );
  assert.match(many[3]!, /10 its edit, 10 the voice pass/);
  assert.deepEqual(roomLinesForReport([], spearman), []);
});

// ---------------------------------------------------------------- prompts and the proof tool

test("prompts: no em dash, the critics' corrections and the tells in the briefs, no stacked rules", () => {
  for (const p of [
    writerPrompt(WORDS),
    voicePrompt(WORDS),
    editorPrompt(),
    viewerPrompt(),
    packPrompt(),
  ])
    assert.ok(!p.includes("—"));
  const w = writerPrompt(WORDS);
  assert.ok(w.includes("80 to 115 spoken words"));
  assert.ok(w.includes("At most two spoken names"));
  assert.ok(w.includes("after 70% of the words"));
  assert.ok(w.includes("No slogan, no echo of the first line"));
  assert.ok(w.includes('"X, not Y"'));
  assert.ok(w.includes('"which is why"') && w.includes('"You\'d assume"'));
  for (const stacked of [
    "desk_question",
    "skeleton",
    "take shape",
    "Pulse Check",
    "loop_line",
  ])
    assert.ok(!w.includes(stacked), stacked);
  const v = voicePrompt(WORDS);
  assert.ok(v.includes("never in the first sentence"));
  assert.ok(v.includes("stay near 80"));
  assert.ok(v.includes("full title once"));
  assert.ok(editorPrompt().includes("promise_kept"));
  assert.ok(editorPrompt().includes("second_thread"));
  assert.ok(editorPrompt().includes("drop_reason"));
  assert.ok(viewerPrompt().includes("drop_reason"));
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
    rounds: [
      { round: 2, label: "A", version: "voiced", mean: 7, findings: [] },
    ],
    stop: "compared",
    won: "voiced",
    calls: {
      pack: 1,
      write: 1,
      critic: 2,
      viewer: 2,
      edit: 1,
      voice: 1,
      layout: 0,
      repair: 0,
    },
    pack: pack(),
  });
  assert.match(text, /PACK what happened/);
  assert.match(text, /ROUND 2 voiced: mean 7/);
  assert.match(text, /KEPT: voiced/);
});

test("the craft rules: in the room writer's and the voice pass's briefs exactly once, never also through shortRuleNote", () => {
  const once = (t: string) => t.split(CRAFT_RULE).length - 1;
  assert.equal(once(writerPrompt(WORDS)), 1);
  assert.equal(once(voicePrompt(WORDS)), 1);
  // Each rule line appears once too, so no second copy in other words sits beside the shared one.
  for (const line of CRAFT_RULE.split("\n").slice(1)) {
    assert.equal(writerPrompt(WORDS).split(line).length - 1, 1, line);
    assert.equal(voicePrompt(WORDS).split(line).length - 1, 1, line);
  }
  // The normal writer still gets them through shortRuleNote; the room never reads shortRuleNote.
  const note = shortRuleNote(
    testConfig("x", { shortCraftRules: true } as never) as never,
    {
      id: "e",
      lane: "news",
    } as never,
  );
  assert.equal(once(note), 1);
  for (const p of [writerPrompt(WORDS), voicePrompt(WORDS)])
    assert.ok(!p.includes(note) || note === CRAFT_RULE);
});
// ---------------------------------------------------------------- the first week's faults (19 to 24 Nov 2026)

/** The two live failures that sent room Shorts back to the normal writer. */
const CUT_21NOV =
  "Failed to parse structured output: SyntaxError: Unterminated string in JSON at position 934";
const CUT_22NOV = "model output hit max_tokens";

test("cut answers: the two live failures count as cut, a refusal or a timeout does not", async () => {
  assert.ok(isCutAnswer(new Error(CUT_21NOV)));
  assert.ok(isCutAnswer(new Error(CUT_22NOV)));
  assert.ok(isCutAnswer(new Error("model output did not match the schema")));
  assert.ok(isCutAnswer(new SyntaxError("Unexpected end of JSON input")));
  assert.ok(!isCutAnswer(new Error("model refused: cyber")));
  assert.ok(!isCutAnswer(new Error("timeout")));
  let tries = 0;
  const retried: string[] = [];
  const ok = await retryCut(
    async () => {
      if (++tries === 1) throw new Error(CUT_22NOV);
      return "second";
    },
    (why) => retried.push(why),
  );
  assert.equal(ok, "second");
  assert.equal(tries, 2);
  assert.deepEqual(retried, [CUT_22NOV]);
  tries = 0;
  await assert.rejects(
    retryCut(
      async () => {
        tries++;
        throw new Error("model refused: cyber");
      },
      () => assert.fail("a refusal is not retried"),
    ),
    /refused/,
  );
  assert.equal(tries, 1);
});

test("the writer and the voice pass ask for room: 32,000 and 24,000 output tokens, thinking included", async () => {
  const seen: Array<{ site: string; maxTokens?: number; effort?: string }> = [];
  const llm = {
    structured: async (req: any) => {
      seen.push(req);
      return req.site === "room.write" ? writing() : voiced();
    },
  } as unknown as Llm;
  await writeRoom(llm, pack(), WORDS);
  await voiceRoom(llm, {
    draft: { title: "t", narration: NARRATION },
    pack: pack(),
    words: WORDS,
  });
  assert.deepEqual(
    seen.map((r) => [r.site, r.maxTokens, r.effort]),
    [
      ["room.write", ROOM.maxTokens.write, "high"],
      ["room.voice", ROOM.maxTokens.voice, "high"],
    ],
  );
  assert.equal(ROOM.maxTokens.write, 32000);
  assert.equal(ROOM.maxTokens.voice, 24000);
});

test("a cut writer answer is asked again once with the same request; a second cut falls back; both are recorded", async () => {
  const cutOnce = loopSteps({
    editor: [{ reads: [ed("A", 8), ed("B", 7), ed("C", 6)], pick: "A" }],
  });
  const packs: unknown[] = [];
  let n = 0;
  const run = await runRoom({
    ...cutOnce.steps,
    write: async (p) => {
      packs.push(p);
      if (++n === 1) throw new Error(CUT_21NOV);
      return writing();
    },
  });
  assert.equal(run.stop, "cleared");
  assert.equal(run.calls.write, 2);
  assert.equal(packs[0], packs[1], "the same request both times");
  assert.deepEqual(run.retries, [{ site: "room.write", why: CUT_21NOV }]);
  const rec = roomRecord({ arm: "room", mode: "on", run });
  assert.equal(rec.calls.write, 2);
  assert.deepEqual(rec.retried, [{ site: "room.write", why: CUT_21NOV }]);
  assert.deepEqual(roomEvent(rec).retried, ["room.write"]);

  const cutTwice = loopSteps({ editor: [] });
  const failed = await runRoom({
    ...cutTwice.steps,
    write: async () => {
      throw new Error(CUT_22NOV);
    },
  });
  assert.equal(failed.stop, "failed");
  assert.equal(failed.error, CUT_22NOV);
  assert.equal(failed.calls.write, 2, "one retry, never more");

  const refused = loopSteps({ editor: [] });
  const r3 = await runRoom({
    ...refused.steps,
    write: async () => {
      throw new Error("model refused: cyber");
    },
  });
  assert.equal(r3.calls.write, 1, "a refusal is not retried");
  assert.equal(r3.retries, undefined);
});

test("a cut voice answer is asked again once and the voiced version is still read", async () => {
  const { steps, calls } = loopSteps({
    editor: [
      { reads: [ed("A", 8), ed("B", 7), ed("C", 6)], pick: "A" },
      { reads: [ed("O", 7), ed("V", 8)], pick: "V" },
    ],
    voice: [new Error(CUT_22NOV), voiced()],
  });
  const run = await runRoom(steps);
  assert.equal(calls.voice, 2);
  assert.equal(run.calls.voice, 2);
  assert.deepEqual(run.retries, [{ site: "room.voice", why: CUT_22NOV }]);
  assert.equal(run.won, "voiced");
});

test("on: a cut room.write is retried inside the step, and the Short is still the room's", async () => {
  const seen: Seen[] = [];
  const out = await roomWriteStep(
    input(
      fakeLlm(
        roomQueues({ "room.write": [new Error(CUT_21NOV), writing()] }),
        seen,
      ),
    ),
    deps(),
  );
  assert.equal(out.record.wrote, true);
  assert.equal(out.record.calls.write, 2);
  assert.deepEqual(
    out.record.retried?.map((r) => r.site),
    ["room.write"],
  );
  const writes = seen.filter((r) => r.site === "room.write") as Array<
    Seen & { maxTokens?: number }
  >;
  assert.equal(writes.length, 2);
  assert.equal(writes[0]!.content, writes[1]!.content);
  assert.equal(writes[1]!.maxTokens, 32000);
});

// The 24 Nov 2026 Short: the story was why Kratos was almost replaced.
const KRATOS_FIRST = "God of War made the right call keeping Kratos.";
const KRATOS_ANGLE = {
  question: "Why was Kratos almost replaced in God of War?",
  answer:
    "Sony wanted a new hero, but Cory Barlog fought to keep Kratos and make him a father.",
};
const KRATOS_REST =
  "Sony's team pitched a brand new lead for the 2018 reboot. Barlog pushed back for months. He wanted an older Kratos, a father this time. That fight is the reason Atreus exists at all.";

test("the answer-first check: 'God of War made the right call keeping Kratos.' is a verdict opener and is refused", () => {
  const narration = `${KRATOS_FIRST} ${KRATOS_REST}`;
  const lines = ["That fight is the reason Atreus exists at all."];
  // Why it went on air: the old check only compared the first sentence with the declared answer lines.
  assert.equal(
    answerInFirst(narration, [...lines, KRATOS_ANGLE.answer], "God of War"),
    false,
  );
  assert.equal(verdictIn(KRATOS_FIRST), "made the right call");
  assert.match(
    firstGivesAway(narration, {
      answerLines: lines,
      game: "God of War",
      company: "Sony Santa Monica",
      angle: KRATOS_ANGLE,
    })!,
    /states a verdict in its first sentence \("made the right call"\)/,
  );
  const checked = roomChecks({
    narration,
    game: "God of War",
    company: "Sony Santa Monica",
    words: { min: 10, max: 200 },
  });
  assert.ok(checked.findings.some((f) => f.rule === "first_verdict"));
  // Other verdicts the first sentence may not state.
  for (const v of [
    "Sony was right to keep Kratos in God of War.",
    "Valve should have kept that Portal 2 puzzle.",
    "Cutting the hub from Starfield was a mistake.",
    "God of War is the best reboot Sony ever made.",
    "Santa Monica got it right with God of War.",
  ])
    assert.ok(verdictIn(v), v);
  // Premises and plain news are not verdicts.
  for (const p of [
    "God of War almost shipped without Kratos.",
    "Kratos could have been replaced in God of War.",
    "God of War Ragnarok is the best-selling entry yet.",
    "PS5 owners should have the patch by Friday.",
    "Starfield's second expansion just slipped, and Bethesda already knew why.",
  ])
    assert.equal(verdictIn(p), undefined, p);
  // A first sentence carrying the angle's own answer words gives it away too; the question's words do not.
  assert.match(
    firstGivesAway(
      `God of War nearly lost Kratos until Cory Barlog fought for a father story. ${KRATOS_REST}`,
      { game: "God of War", company: "Sony Santa Monica", angle: KRATOS_ANGLE },
    )!,
    /angle's answer away in its first sentence \(cory, barlog, fought, father\)/,
  );
  assert.equal(
    firstGivesAway(`God of War almost shipped without Kratos. ${KRATOS_REST}`, {
      answerLines: lines,
      game: "God of War",
      company: "Sony Santa Monica",
      angle: KRATOS_ANGLE,
    }),
    undefined,
  );
});

test("the voice pass is refused when its first sentence states a verdict, and is never read", async () => {
  const { steps, shown } = loopSteps({
    editor: [
      { reads: [ed("A", 6), ed("B", 5), ed("C", 5)], pick: "A" },
      { reads: [ed("O", 6), ed("E", 7)], pick: "E" },
    ],
    edits: [EDITED],
    voice: [voiced({ narration: `${KRATOS_FIRST} ${S.slice(1).join(" ")}` })],
  });
  const run = await runRoom(steps);
  assert.match(
    run.voice!.refused!.join(" "),
    /The voiced version states a verdict in its first sentence \("made the right call"\)/,
  );
  assert.deepEqual(shown[1], ["O", "E"]);
  assert.equal(run.won, "edited");
});

const PORTAL_SOURCES = [
  "Valve released Portal 2 in April 2011. Half-Life 2 required a Steam account to play. Players loved the co-op campaign.",
];

test("the claim guard: a name, a figure or an event word no pack field and no source has is flagged", () => {
  const found = unsourcedSentences(
    [
      "Portal 2 shipped in 2011 and players loved the co-op.",
      "Valve dropped a Portal 2 puzzle mechanic that playtesters reportedly liked.",
      "Half-Life 2's Steam lock went to court.",
      "Gabe Newell signed off on it personally.",
      "It sold 9 million copies.",
      "Players still talk about it.",
    ].join(" "),
    PORTAL_SOURCES,
    { game: "Portal 2", company: "Valve" },
  );
  assert.deepEqual(
    found.map((u) => [u.sentence, u.names, u.figures, u.claims]),
    [
      [
        "Valve dropped a Portal 2 puzzle mechanic that playtesters reportedly liked.",
        [],
        [],
        ["playtesters"],
      ],
      ["Half-Life 2's Steam lock went to court.", [], [], ["court"]],
      ["Gabe Newell signed off on it personally.", ["Gabe", "Newell"], [], []],
      ["It sold 9 million copies.", [], ["9"], []],
    ],
  );
  // The pack is a source too, but never its unverified list.
  const withPack = claimCorpus(
    pack({
      unverified: ["Gabe Newell signed off"],
      surprise: { detail: "Playtesters hated it.", url: "" },
    }),
    PORTAL_SOURCES,
  );
  const again = unsourcedSentences(
    "Valve dropped a puzzle that playtesters reportedly liked. Gabe Newell signed off on it.",
    withPack,
    { game: "Portal 2", company: "Valve" },
  );
  assert.deepEqual(
    again.map((u) => u.sentence),
    ["Gabe Newell signed off on it."],
  );
  // roomChecks reads it as a finding when given the sources.
  const checked = roomChecks({
    narration: NARRATION.replace(
      S[2]!,
      "Phil Spencer reportedly blocked that date in a meeting.",
    ),
    ...CHECK,
    sources: claimCorpus(pack(), [ARTICLE]),
  });
  const u = checked.findings.filter((f) => f.rule === "unsourced");
  assert.equal(u.length, 1);
  assert.match(
    u[0]!.problem,
    /"Phil Spencer reportedly blocked that date in a meeting\." says the name Phil, the name Spencer/,
  );
  // The fixture story itself is clean.
  assert.ok(
    !roomChecks({
      narration: NARRATION,
      ...CHECK,
      sources: claimCorpus(pack(), [ARTICLE]),
    }).findings.some((f) => f.rule === "unsourced"),
  );
});

test("a pick that clears but says something the pack lacks gets an edit on those sentences only", async () => {
  const added = NARRATION.replace(
    S[2]!,
    "Phil Spencer reportedly blocked that date in a meeting.",
  );
  const { steps, calls } = loopSteps({
    editor: [
      { reads: [ed("A", 8), ed("B", 7), ed("C", 6)], pick: "A" },
      { reads: [ed("O", 8), ed("E", 8)], pick: "E" },
    ],
    w: writing({
      drafts: writing().drafts.map((d) => ({ ...d, narration: added })),
    }),
  });
  const instructions: string[] = [];
  const sources = claimCorpus(pack(), [ARTICLE]);
  const run = await runRoom({
    ...steps,
    edit: async (draft, instruction) => {
      instructions.push(instruction);
      return { ...draft, narration: NARRATION };
    },
    check: (n, a, shape) =>
      roomChecks({
        narration: n,
        answerLine: a,
        ...CHECK,
        sources,
        ...(shape ? { shape } : {}),
      }),
  });
  assert.equal(run.calls.edit, 1, "cleared, but the claim is fixed first");
  assert.match(
    instructions[0]!,
    /^First, the facts: The sentence "Phil Spencer reportedly blocked that date in a meeting\." says/,
  );
  assert.match(instructions[0]!, /not even with "reportedly"/);
  assert.ok(
    !instructions[0]!.includes("Biggest weakness"),
    "nothing else is touched",
  );
  assert.equal(run.won, "edited");
  assert.equal(run.final?.unsourced, undefined);
  assert.equal(calls.editor, 2);
  // A kept version that still carries one is recorded.
  const kept = loopSteps({
    editor: [{ reads: [ed("A", 8), ed("B", 7), ed("C", 6)], pick: "A" }],
    w: writing({
      drafts: writing().drafts.map((d) => ({ ...d, narration: added })),
    }),
  });
  const r2 = await runRoom({
    ...kept.steps,
    edit: async () => undefined,
    check: (n, a) =>
      roomChecks({ narration: n, answerLine: a, ...CHECK, sources }),
  });
  assert.equal(r2.final?.unsourced?.length, 1);
  assert.equal(
    roomRecord({ arm: "room", mode: "on", run: r2 }).unsourced?.length,
    1,
  );
});

test("the fact guard refuses an edit or a voiced version that adds an unsupported claim, not one it inherited", () => {
  const corpora = {
    quotes: [ARTICLE],
    numbers: [ARTICLE],
    claims: claimCorpus(pack(), [ARTICLE]),
    game: "Starfield",
    company: "Bethesda",
  };
  const court = {
    title: "t",
    narration: NARRATION.replace(S[2]!, "That promise later went to court."),
  };
  assert.match(
    roomEditProblems(court, corpora, { title: "t", narration: NARRATION }).join(
      " ",
    ),
    /adds a claim no source supports.*"court"/,
  );
  assert.deepEqual(
    roomEditProblems(court, corpora, court),
    [],
    "already in the draft: not the edit's fault",
  );
  assert.deepEqual(
    roomEditProblems(
      court,
      { quotes: [ARTICLE], numbers: [ARTICLE] },
      { title: "t", narration: NARRATION },
    ),
    [],
    "without the claim corpus the guard is as before",
  );
});

test("the writer's and the voice pass's briefs: every claim from a pack field, no background even with 'reportedly'", () => {
  for (const p of [writerPrompt(WORDS), voicePrompt(WORDS)]) {
    assert.match(p, /comes from a field of the pack/);
    assert.match(p, /not with "reportedly"/);
    assert.match(p, /made the right call/);
    assert.ok(!/—/.test(p));
  }
});

test("room.repair gets the fact check's exact blocked sentences, to cut or replace with a pack fact, and the pack", async () => {
  const fb = repairFeedback(
    [
      'Fact-check: "eight weeks ago" - not supported',
      "The take says tomorrow, which is false when it airs.",
    ],
    NARRATION,
    pack(),
  );
  assert.equal(
    fb[0],
    'Blocked sentence: "The studio promised a December launch only eight weeks ago." The fact check says: not supported Cut this sentence, or replace it with a fact from the pack below; add nothing else, and no claim the pack does not hold, not even with "reportedly". Change the matching beat\'s card and claims to agree.',
  );
  assert.equal(fb[1], "The take says tomorrow, which is false when it airs.");
  assert.match(fb[2]!, /^The fact pack, the only facts a replacement may use:/);
  assert.match(fb[2]!, /What happened: Bethesda delayed/);
  assert.match(
    fb[2]!,
    /Quote: "We would rather ship it right than ship it early" \(Todd Howard, director, IGN\)/,
  );
  assert.match(fb[2]!, /Number: two million \(owners\)/);
  // The live 23 Nov case: the check quotes part of the sentence; the repair sees all of it.
  assert.equal(
    blockedSentence(
      "Valve tried this before. Half-Life 2's Steam lock went to court. Players hated it.",
      "Steam lock went to court",
    ),
    "Half-Life 2's Steam lock went to court.",
  );
  assert.equal(
    blockedSentence(NARRATION, "a card no one says"),
    "a card no one says",
  );
  // Nothing blocked by the fact check: no pack list.
  assert.deepEqual(
    repairFeedback(["The stamp is unspoken."], NARRATION, pack()),
    ["The stamp is unspoken."],
  );

  const seen: Seen[] = [];
  const edits = {
    edits: [{ find: "only eight weeks ago", replace: "recently" }],
  };
  const fixed = await roomWriteStep(
    input(fakeLlm(roomQueues({ "room.repair": [edits] }), seen)),
    deps([fail, pass]),
  );
  assert.equal(fixed.record.wrote, true);
  const repair = seen.find((r) => r.site === "room.repair")!;
  assert.ok(
    repair.content.includes(
      'Blocked sentence: "The studio promised a December launch only eight weeks ago."',
    ),
  );
  assert.ok(
    repair.content.includes(
      "The fact pack, the only facts a replacement may use:",
    ),
  );
});

test("the record carries both critics' marks and the desk's, and the weekly lines compare all three", async () => {
  const { steps } = loopSteps({
    editor: [{ reads: [ed("A", 7), ed("B", 6), ed("C", 5)], pick: "A" }],
    viewer: [{ reads: [vw("A", 6), vw("B", 5), vw("C", 5)] }],
  });
  const run = await runRoom({ ...steps, edit: async () => undefined });
  const rec = {
    ...roomRecord({ arm: "room", mode: "on", run, wrote: true }),
    desk_overall: 4,
  };
  assert.equal(rec.editor_overall, 7);
  assert.equal(rec.viewer_overall, 6);
  const ev = roomEvent(rec);
  assert.equal(ev.editor, 7);
  assert.equal(ev.viewer, 6);
  assert.equal(ev.desk, 4);
  const rows = [
    ...Array.from({ length: 5 }, () => ({
      arm: "room" as const,
      wrote: true,
      editor: 6,
      viewer: 6,
      desk: 4,
      viewed_pct: 60,
    })),
    ...Array.from({ length: 6 }, () => ({
      arm: "control" as const,
      desk: 3.3,
    })),
  ];
  const lines = roomLinesForReport(rows, spearman);
  assert.match(lines[2]!, /editor's desk: 5 of 20 Shorts so far/);
  assert.match(
    lines[4]!,
    /average marks where the room wrote: editor critic 6\.0 \(5\), viewer critic 6\.0 \(5\), editor's desk 4\.0 \(5\); editor's desk on the control arm 3\.3 \(6\)/,
  );
});
