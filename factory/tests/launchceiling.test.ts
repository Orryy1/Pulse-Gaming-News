import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import {
  cleanLine,
  cropX,
  DIRECT_MAX_RUNUP,
  DIRECT_MAX_SECONDS,
  DIRECT_MIN_SECONDS,
  directCut,
  directFilter,
  directProblems,
  directTiming,
  fitLines,
  LOOP_LEAD_INS,
  loopDangles,
  loopLeadIn,
  loopRepeatsHook,
  onCutClock,
} from "../src/gameplaydirect.ts";
import { gameVolume } from "../src/render/GameplayShort.tsx";
import { createApp } from "../src/server.ts";
import { createEpisode, getEpisode, transition } from "../src/episodes.ts";
import { clusterItems } from "../src/discovery/cluster.ts";
import { signToken } from "../src/lib/crypto.ts";
import {
  gameplayLinks,
  videoMetadata,
  type Services,
} from "../src/pipeline.ts";
import {
  docCandidates,
  emptySignals,
  rankDocCandidates,
  readFilmSlate,
  scoreShape,
  slateCandidate,
  type DocSignals,
} from "../src/docpick.ts";
import { affiliateBlock } from "../src/editorial/affiliate.ts";
import { hookYouProblems } from "../src/editorial/longrules.ts";
import type { Script } from "../src/editorial/schema.ts";
import { testDb, tmpDir, testConfig, item } from "./helpers.ts";

const dead = (start: number, end: number) => ({ start, end });

test("the cut starts on the attempt, drops dead air and black, and always keeps the outcome", () => {
  const c = directCut(
    {
      action_start_seconds: 20,
      payoff_seconds: 30,
      payoff_end_seconds: 33,
      dead_spans: [dead(23, 25)],
    },
    [dead(27, 27.5)],
    40,
  );
  assert.deepEqual(c.segments, [
    { start: 19.8, end: 23 },
    { start: 25, end: 27 },
    { start: 27.5, end: 33 },
  ]);
  assert.equal(c.seconds, 10.7);
  assert.equal(c.payoffAt, 7.7, "the outcome on the Short's own clock");
});

test("a dead span cannot swallow the outcome", () => {
  const c = directCut(
    {
      action_start_seconds: 10,
      payoff_seconds: 20,
      payoff_end_seconds: 22,
      dead_spans: [dead(15, 21)],
    },
    [],
    40,
  );
  assert.equal(c.segments.length, 1, "the span over the payoff is ignored");
  assert.equal(c.payoffAt, 10.2);
});

test("the Maze Bank shape: a late jump reaches back to 8 s and runs on to the clip's end", () => {
  const c = directCut(
    {
      action_start_seconds: 33,
      payoff_seconds: 36,
      payoff_end_seconds: 39.5,
      dead_spans: [],
    },
    [dead(10, 14)],
    40,
  );
  assert.equal(
    c.segments.at(-1)!.end,
    40,
    "within a second of the end: to the end",
  );
  assert.ok(c.seconds >= DIRECT_MIN_SECONDS);
});

test("the train shape: an 18 s descent loses its start, down to the run-up limit", () => {
  const c = directCut(
    {
      action_start_seconds: 10.5,
      payoff_seconds: 32,
      payoff_end_seconds: 34.5,
      dead_spans: [dead(12, 15)],
    },
    [],
    40,
  );
  assert.ok(c.payoffAt <= DIRECT_MAX_RUNUP, `run-up ${c.payoffAt}`);
  assert.equal(c.segments.at(-1)!.end, 34.5);
  assert.ok(c.seconds >= DIRECT_MIN_SECONDS);
});

test("too long a clip loses its start, never its end", () => {
  const c = directCut(
    {
      action_start_seconds: 0,
      payoff_seconds: 70,
      payoff_end_seconds: 74,
      dead_spans: [],
    },
    [],
    75,
  );
  assert.ok(c.seconds <= DIRECT_MAX_SECONDS);
  assert.equal(c.segments.at(-1)!.end, 75);
});

test("clip times map onto the cut's clock", () => {
  const segs = [dead(10, 12), dead(20, 25)];
  assert.equal(onCutClock(11, segs), 1);
  assert.equal(onCutClock(15, segs), 2);
  assert.equal(onCutClock(21, segs), 3);
  assert.equal(onCutClock(99, segs), 7);
});

test("the setup goes whole sentences at a time when the voice would talk over the outcome", () => {
  const long =
    "One two three four five six. Seven eight nine ten eleven twelve.";
  assert.equal(
    fitLines({ hook: "Can you do it?", setup: long }, 10).setup,
    long,
  );
  assert.equal(
    fitLines({ hook: "Can you do it?", setup: long }, 3.5).setup,
    "One two three four five six.",
  );
  assert.equal(
    fitLines({ hook: "Can you do it?", setup: long }, 1.5).setup,
    "",
  );
});

test("the answer waits for a breath after the outcome; the ending replays slowed when the footage runs out", () => {
  const roomy = directTiming(20, 10, 4, 4);
  assert.equal(roomy.replaySource, 0);
  assert.equal(roomy.seconds, 20);
  assert.equal(roomy.answerAt, 15.9);
  const tight = directTiming(8, 5.5, 2, 5);
  assert.ok(tight.replaySource > 0, "needs a replay");
  assert.ok(tight.seconds > 8);
  assert.ok(tight.answerAt >= 5.5 + 0.9, "never over the outcome");
  assert.ok(
    Math.abs(tight.answerAt + 5 + 0.1 - tight.seconds) < 0.01 ||
      tight.answerAt + 5 + 0.1 <= tight.seconds + 0.01,
    "ends with the film",
  );
});

test("the filter joins the segments, fills the phone and adds a replay only when asked", () => {
  const cut = { segments: [dead(1, 3), dead(5, 9)], seconds: 6, payoffAt: 4 };
  const plain = directFilter(cut, {
    tone: "",
    focusStart: 0.5,
    focusPayoff: 0.4,
    replaySource: 0,
  });
  assert.match(plain, /concat=n=2:v=1:a=1/);
  assert.match(plain, /scale=-2:1920,crop=1080:1920/);
  assert.doesNotMatch(plain, /atempo/);
  assert.match(
    directFilter(cut, {
      tone: "",
      focusStart: 0.5,
      focusPayoff: 0.4,
      replaySource: 2,
    }),
    /atempo=0\.7/,
  );
  assert.match(
    cropX(0.5, 0.4, 4),
    /iw\*\(0\.500\+\(0\.400-0\.500\)\*min\(1,t\/4\.00\)\)/,
  );
});

test("a model's stray tag never reaches the voice, and a loop that repeats the hook is caught", () => {
  assert.equal(
    cleanLine("whether you can ride off the tallest tower.</parameter>"),
    "whether you can ride off the tallest tower.",
  );
  assert.ok(
    loopRepeatsHook(
      "And the only thing left to ask is whether you can ride off the tallest tower.",
      "Can you ride off the tallest tower?",
    ),
  );
  assert.ok(
    !loopRepeatsHook(
      "So the next time someone asks you,",
      "Can you ride off the tallest tower?",
    ),
  );
});

test("the replay repeats the outcome itself, and stand-in loop lines rotate by clip", () => {
  const f = directFilter(
    { segments: [dead(10, 20)], seconds: 10, payoffAt: 4 },
    { tone: "", focusStart: 0.5, focusPayoff: 0.5, replaySource: 2 },
  );
  assert.match(f, /trim=start=3\.3:end=5\.3,setpts/);
  assert.ok(LOOP_LEAD_INS.includes(loopLeadIn("gp_abc")));
  assert.ok(loopDangles("Now picture trying the same thing when you ask whether"));
  assert.ok(!LOOP_LEAD_INS.some(loopDangles));
  assert.ok(new Set(["gp_a", "gp_b", "gp_c", "gp_d", "gp_e", "gp_f"].map(loopLeadIn)).size > 1);
});

test("the opening's own you count: a cold first minute is sent back even when the whole video would pass", () => {
  assert.equal(hookYouProblems("You will see this. You, your, you're.", 4).length, 0);
  assert.equal(hookYouProblems("Rockstar made a game in Dundee.", 4).length, 1);
  assert.equal(hookYouProblems("Rockstar made a game in Dundee.", 0).length, 0);
  assert.equal(
    hookYouProblems('A critic wrote "you will hate this". Nobody did.', 1).length,
    1,
    "a quoted you is not the narrator talking to you",
  );
});

test("the gate names every fault the audit found in the old Shorts", () => {
  const good = {
    blacks: [],
    firstWordAt: 0,
    payoffAt: 9,
    seconds: 15,
    answerAt: 10,
    loopLine: "So the next time someone asks you,",
  };
  assert.deepEqual(directProblems(good), []);
  assert.equal(directProblems({ ...good, blacks: [dead(0, 2.5)] }).length, 1);
  assert.equal(directProblems({ ...good, firstWordAt: 18 }).length, 1);
  assert.equal(directProblems({ ...good, payoffAt: 14.9, answerAt: 15 }).length, 1);
  assert.equal(directProblems({ ...good, answerAt: 8 }).length, 1);
  assert.equal(directProblems({ ...good, loopLine: " " }).length, 1);
});

test("the game's sound is whole between the takes and low under the voice", () => {
  const voiced = [dead(0, 4), dead(10, 14)];
  assert.equal(gameVolume(2, voiced), 0.22);
  assert.equal(gameVolume(7, voiced), 1);
  const ramp = gameVolume(4.05, voiced);
  assert.ok(ramp > 0.22 && ramp < 1);
});

function directScript(): Script {
  return {
    story_type: "other",
    game_title: "Grand Theft Auto VI",
    steam_search_term: "",
    headline: "Can you outswim 5 stars?",
    hook: "Can you outswim 5 stars?",
    beats: [
      { narration: "", visual: { kind: "none", primary: "", secondary: "" } },
    ],
    pulse_take: {
      label: "THE RESULT",
      narration: "They gave up.",
      on_screen: "GONE",
    },
    loop_line: "So the next time someone asks you,",
    is_rumour: false,
    attribution: "Gameplay: Pulse Gaming",
    hashtags: ["#GTA6"],
    youtube: {
      title: "GTA 6: Can You Outswim 5 Stars?",
      description: "A test.",
      tags: [],
    },
    claims: [],
    runtime: "short",
    gameplay: {
      inbox_id: "gp_1",
      question: "Can you outswim 5 stars?",
      result: "They gave up.",
      result_line: "GONE",
      experiment_number: 0,
      experiment_slug: null,
      radio: false,
      real_test: true,
      direct: {
        hook: "Can you outswim 5 stars?",
        setup: "",
        payoff_line: "They gave up.",
        loop_line: "So the next time someone asks you,",
        segments: [dead(1, 12)],
        seconds: 11,
        payoff_at: 8,
        focus_start: 0.5,
        focus_payoff: 0.5,
      },
    },
  } as unknown as Script;
}

test("a voiced gameplay Short says so, flags synthetic media, and carries no affiliate link (Rockstar's rule)", async () => {
  const cfg = testConfig(await tmpDir());
  const script = directScript();
  const tags = { uk: "uk-21", us: "us-20" };
  assert.equal(
    affiliateBlock(script, tags),
    "",
    "a Short carries no shop block",
  );
  const ep = {
    id: "ep1",
    lane: "gameplay",
    script_json: script,
    story_json: { sources: [], items: [], headline: "x" },
    assets_json: {},
  } as never;
  const meta = videoMetadata(ep, "private", cfg.syntheticMedia, tags) as {
    description: string;
  };
  assert.match(meta.description, /AI-generated synthetic voice/);
  assert.doesNotMatch(meta.description, /No AI voice/);
  assert.doesNotMatch(meta.description, /amazon|Affiliate/i);
});

test("one tap: a gameplay link acts as it opens through the page's own script; nothing else changes", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), { gameplayOneTap: true });
  const cluster = clusterItems([
    item(
      "Starfield second expansion delayed to early 2027",
      "Xbox Wire",
      "official",
    ),
  ])[0]!;
  await createEpisode(db, "gp1", cluster, {
    lane: "gameplay",
    priority: 1,
  } as never);
  await createEpisode(db, "news1", { ...cluster, hash: "other" });
  await transition(db, "gp1", "selected", "awaiting_approval", {});
  await transition(db, "news1", "selected", "awaiting_approval", {});
  const services = {
    db,
    cfg,
    notify: async () => undefined,
  } as unknown as Services;
  (services as never as { discover: unknown }).discover = async () => [];
  const server = http.createServer(
    (req, res) => void createApp(db, cfg, services, {})(req, res),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.match(gameplayLinks(cfg, "gp1").approve, /&now=1$/);
    assert.match(gameplayLinks(cfg, "gp1").reject, /&now=1$/);
    const t = signToken("approve:gp1", cfg.appSecret, 600);
    const page = await (
      await fetch(`${base}/episodes/gp1/approve?t=${t}&now=1`)
    ).text();
    assert.match(page, /document\.getElementById\("tap"\)\.submit\(\)/);
    assert.match(
      page,
      /Approve and publish/,
      "the button is there with no script",
    );
    assert.equal(
      (await getEpisode(db, "gp1"))!.status,
      "awaiting_approval",
      "an unfurler, which runs no script, changes nothing",
    );
    assert.equal(
      (await fetch(`${base}/episodes/gp1/approve?t=bad&now=1`)).status,
      403,
    );
    const n = signToken("approve:news1", cfg.appSecret, 600);
    assert.doesNotMatch(
      await (await fetch(`${base}/episodes/news1/approve?t=${n}&now=1`)).text(),
      /getElementById\("tap"\)/,
      "a news Short keeps its confirmation page",
    );
  } finally {
    server.close();
  }
  const off = testConfig(await tmpDir());
  assert.doesNotMatch(gameplayLinks(off, "gp1").approve, /now=1/);
});

test("a person, a hunt or a failure scores above a survey; a list of topics is a survey", () => {
  const list = scoreShape(
    "Why GTA 6 took thirteen years: GTA Online's money, Red Dead 2, Dan Houser leaving, the 2022 leak and the delays",
  );
  const person = scoreShape(
    "The teenager who broke into Rockstar from a hotel room and how he was caught",
  );
  const survey = scoreShape(
    "The Tomb Raider story, game by game, told through its turning points",
  );
  assert.ok(person.score > 0.7, `person ${person.score}`);
  assert.ok(list.score < 0.2, `list ${list.score}`);
  assert.ok(survey.score < person.score);
  assert.ok(person.reasons.includes("a person"));
});

test("DOC_PICK_SINGLE_SUBJECT takes series surveys out of the running; off, the ranking is as it was", () => {
  const cands = docCandidates(
    [{ subject: "Story", wiki: "Story", angle: "The man who was caught" }],
    ["Tomb Raider"],
  );
  const signals = new Map<string, DocSignals>();
  for (const c of cands)
    signals.set(c.subject, { ...emptySignals(c), newsMentions: 50 });
  const now = new Date("2026-11-22T00:00:00Z");
  const off = rankDocCandidates(cands, signals, now);
  assert.ok(off.every((x) => !x.excluded));
  const on = rankDocCandidates(cands, signals, now, { singleSubject: true });
  assert.match(
    on.find((x) => x.candidate.kind === "franchise")!.excluded!,
    /survey/,
  );
  assert.equal(on[0]!.candidate.subject, "Story");
});

test("the factory's film slate reads in rank order and every film is a story candidate", async () => {
  const dir = await tmpDir();
  const file = path.join(dir, "s.json");
  await fs.writeFile(
    file,
    JSON.stringify([
      { rank: 2, subject: "B", wiki: "B", angle: "b", title_idea: "tb" },
      { rank: 1, subject: "A", wiki: "A", angle: "a", title_idea: "ta" },
    ]),
  );
  const films = await readFilmSlate(file);
  assert.deepEqual(
    films.map((f) => f.subject),
    ["A", "B"],
  );
  assert.equal(slateCandidate(films[0]!).kind, "story");
  assert.equal(slateCandidate(films[0]!).slate!.rank, 1);
  assert.deepEqual(await readFilmSlate(""), []);
  assert.deepEqual(await readFilmSlate(path.join(dir, "none.json")), []);
});

test("the slate in the repo: eight single-subject films, none of them a survey", async () => {
  const films = await readFilmSlate(
    new URL("../film_slate.json", import.meta.url).pathname.replace(
      /^\/(\w:)/,
      "$1",
    ),
  );
  assert.equal(films.length, 8);
  for (const f of films) {
    const s = scoreShape(f.angle);
    assert.ok(s.score >= 0.55, `${f.subject}: ${s.score} ${s.reasons}`);
    assert.doesNotMatch(`${f.angle} ${f.title_idea}`, /—/, "no em dashes");
  }
});
