// "Early story free" (owner, 26 Nov 2026, for GTA VI): chapter 1 is free everywhere, later chapters may be used where
// the reveal classifier found the moment safe, big reveals never lead a video or fill a title or thumbnail, and the
// whole hold lifts on 3 Dec 2026. Fixed clocks, no network, a faked model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./helpers.ts";
import {
  emptySceneIndex,
  saveSceneIndex,
  sceneIndexDir,
  type SceneIndex,
  type SceneSource,
} from "../src/sceneindex/schema.ts";
import {
  footageAllowed,
  freeChapter,
  isEarlyFree,
  lateTerms,
  spoilerHits,
  spoilerWindow,
  storyChapter,
  streamClipHold,
  type SpoilerWindow,
} from "../src/sceneindex/spoilers.ts";
import {
  liveRevealBook,
  revealAt,
  revealsFile,
  setRevealDir,
  REVEAL_BOOK_VERSION,
  type RevealBook,
} from "../src/sceneindex/revealbook.ts";
import {
  classifyReveals,
  framesVerdict,
  recheckHeld,
  revealPass,
  revealCounts,
  revealScenes,
  rulesReveal,
  verdictOf,
} from "../src/sceneindex/reveals.ts";
import { parseFetchTitles, windowsFrom } from "../src/sceneindex/gamefetch.ts";
import type { Llm } from "../src/editorial/llm.ts";
import type { GameplayMeta } from "../src/gameplay.ts";

const GTA = "Grand Theft Auto VI";
const NOW = new Date("2026-11-26T12:00:00Z");
const LIFT = "2026-12-03T00:00Z";
const CH1: SceneSource = {
  videoId: "qpTWAD4FYF4",
  title:
    "GTA 6 - All Cutscenes Full Movie & Ending Chapter 1 (Grand Theft Auto VI)",
  uploader: "GAMERALISIMUS",
  duration: 1000,
  kind: "movie",
  pickedAt: "2026-11-19T17:00:00Z",
};
const CH2: SceneSource = {
  ...CH1,
  videoId: "PVFdrS4SYzo",
  title: "GTA 6 - All Cutscenes Full Movie Chapter 2",
  chapter: 2,
  spoiler: true,
};

const shot = (id: number, start: number, end: number, desc: string) => ({
  id,
  start,
  end,
  keyframes: [start],
  desc,
  who: [],
  where: "",
  mood: "",
  tags: [],
  text: "",
  luma: 90,
  motion: 5,
});

/** An index of ten 100-second shots, each with one line. */
function idx(
  game: string,
  source: SceneSource,
  descs: string[] = [],
): SceneIndex {
  const i = emptySceneIndex(game, source, NOW);
  for (let k = 0; k < 10; k++) {
    i.shots.push(
      shot(
        k,
        k * 100,
        (k + 1) * 100,
        descs[k] ?? `Lucia drives along the causeway, scene ${k}`,
      ),
    );
    i.lines.push({
      id: k,
      start: k * 100 + 5,
      end: k * 100 + 9,
      text: `Line number ${k} about the drive`,
      via: "voice",
      shot: k,
    });
  }
  i.coverage = [{ from: 0, to: 1000 }];
  return i;
}

/** A book of ten 100-second scenes: the given ones are reveals, "p" ones pending, the rest safe. */
function book(
  source: SceneSource,
  game: string,
  reveal: number[],
  pending: number[] = [],
): RevealBook {
  return {
    version: REVEAL_BOOK_VERSION,
    game,
    videoId: source.videoId,
    sceneSeconds: 100,
    madeAt: NOW.toISOString(),
    scenes: Array.from({ length: 10 }, (_, k) => ({
      start: k * 100,
      end: (k + 1) * 100,
      hash: `h${k}`,
      reveal: reveal.includes(k) || pending.includes(k),
      ...(reveal.includes(k) ? { kind: "death" as const } : {}),
      by: pending.includes(k) ? ("pending" as const) : ("model" as const),
      why: "test",
    })),
  };
}

const early = (): SpoilerWindow =>
  spoilerWindow(GTA, "2026-11-18T11:00Z", {
    days: 28,
    openingShare: 0.1,
    until: LIFT,
    earlyFree: true,
  })!;

test("chapters and the early-free list: chapter 1 from its title, later ones from their tag or name", () => {
  assert.equal(storyChapter(idx(GTA, CH1)), 1);
  assert.equal(storyChapter(idx(`${GTA} (movie 2)`, CH2)), 2);
  assert.equal(
    storyChapter(idx(`${GTA} (movie 3)`, { ...CH1, title: "GTA 6 cutscenes" })),
    3,
    "from the index name",
  );
  assert.equal(
    storyChapter(idx(`${GTA} (gameplay)`, { ...CH1, kind: "playthrough" })),
    undefined,
  );
  assert.equal(freeChapter(early(), idx(GTA, CH1)), true);
  assert.equal(freeChapter(early(), idx(`${GTA} (movie 2)`, CH2)), false);
  const legacy = spoilerWindow(GTA, "2026-11-18T11:00Z", {
    days: 28,
    openingShare: 0.1,
    until: LIFT,
  })!;
  assert.equal(
    freeChapter(legacy, idx(GTA, CH1)),
    false,
    "only an early-free window frees chapter 1",
  );
  assert.ok(isEarlyFree("GTA 6", ["Grand Theft Auto VI"]));
  assert.ok(isEarlyFree(`${GTA} (movie 2)`, ["GTA VI"]));
  assert.ok(!isEarlyFree("Grand Theft Auto V", ["Grand Theft Auto VI"]));
  assert.ok(!isEarlyFree(GTA, []));
});

test("chapter 1 before its reveal check: free in a long video's body; Shorts, thumbnails and openings keep to the opening share", () => {
  const w = early();
  const ch1 = idx(GTA, CH1);
  assert.equal(footageAllowed(w, ch1, 850, "long", NOW, { book: null, placedAt: 90 }).ok, true);
  assert.equal(footageAllowed(w, ch1, 850, "long", NOW, { book: null, placedAt: 10 }).ok, false, "first minute");
  assert.equal(footageAllowed(w, ch1, 850, "short", NOW, { book: null }).ok, false, "a Short can open on any of its moments");
  assert.equal(footageAllowed(w, ch1, 50, "short", NOW, { book: null }).ok, true);
  assert.equal(
    footageAllowed(w, ch1, 50, "thumbnail", NOW, { book: null }).ok,
    true,
    "the opening share as before",
  );
  assert.equal(
    footageAllowed(w, ch1, 850, "thumbnail", NOW, { book: null }).ok,
    false,
  );
  assert.equal(
    footageAllowed(w, ch1, 850, "first-frame", NOW, { book: null }).ok,
    false,
  );
  // A shot whose own words spoil is a reveal: fine in a long video's body, never a Short or a first frame.
  const dies = idx(GTA, CH1, [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Jason's uncle dies in the car",
  ]);
  assert.equal(footageAllowed(w, dies, 750, "long", NOW, { book: null, placedAt: 90 }).ok, true);
  assert.equal(footageAllowed(w, dies, 750, "short", NOW, { book: null }).ok, false);
  assert.equal(
    footageAllowed(w, dies, 750, "first-frame", NOW, { book: null }).ok,
    false,
  );
});

test("chapter 1 with its reveal book: a reveal never in a title, thumbnail, cover, first frame or a long video's first minute", () => {
  const w = early();
  const ch1 = idx(GTA, CH1);
  const b = book(CH1, GTA, [6]);
  for (const use of ["title", "thumbnail", "cover", "first-frame", "short"] as const)
    assert.equal(
      footageAllowed(w, ch1, 650, use, NOW, { book: b }).ok,
      false,
      use,
    );
  assert.equal(
    footageAllowed(w, ch1, 650, "long", NOW, { book: b, placedAt: 10 }).ok,
    false,
    "first minute",
  );
  assert.equal(
    footageAllowed(w, ch1, 650, "long", NOW, { book: b, placedAt: 90 }).ok,
    true,
  );
  assert.equal(footageAllowed(w, ch1, 850, "short", NOW, { book: b }).ok, true, "a safe moment");
  // A safe late moment of chapter 1 may now fill a thumbnail.
  assert.equal(
    footageAllowed(w, ch1, 850, "thumbnail", NOW, { book: b }).ok,
    true,
  );
  // A book for another upload says nothing.
  assert.equal(
    footageAllowed(w, ch1, 850, "thumbnail", NOW, {
      book: { ...b, videoId: "other" },
    }).ok,
    false,
  );
});

test("chapter 2: safe moments anywhere (no reveal in them); reveals and unchecked moments wait", () => {
  const w = early();
  const ch2 = idx(`${GTA} (movie 2)`, CH2);
  const b = book(CH2, GTA, [3], [5]);
  assert.equal(
    footageAllowed(w, ch2, 150, "short", NOW, { book: null }).ok,
    false,
    "no book: held",
  );
  for (const use of ["short", "long", "first-frame", "thumbnail"] as const)
    assert.equal(
      footageAllowed(w, ch2, 150, use, NOW, { book: b }).ok,
      true,
      use,
    );
  // The opening share of a later chapter is no free pass.
  assert.equal(footageAllowed(w, ch2, 50, "short", NOW, { book: null }).ok, false);
  assert.equal(
    footageAllowed(w, ch2, 350, "short", NOW, { book: b }).ok,
    false,
    "a reveal",
  );
  assert.equal(
    footageAllowed(w, ch2, 350, "long", NOW, {
      book: b,
      warned: true,
      placedAt: 300,
    }).ok,
    false,
    "even after a warning",
  );
  assert.equal(
    footageAllowed(w, ch2, 550, "short", NOW, { book: b }).ok,
    false,
    "pending counts as a reveal",
  );
  assert.match(
    footageAllowed(w, ch2, 350, "short", NOW, { book: b }).reason,
    /until 2026-12-03/,
  );
  // The legacy hold, for a game not early free, is unchanged: the whole later chapter waits, a warned long video may use it.
  const legacy = spoilerWindow(GTA, "2026-11-18T11:00Z", {
    days: 28,
    openingShare: 0.1,
    until: LIFT,
  })!;
  assert.equal(
    footageAllowed(legacy, ch2, 150, "short", NOW, { book: b }).ok,
    false,
  );
  assert.equal(
    footageAllowed(legacy, ch2, 150, "long", NOW, {
      warned: true,
      placedAt: 90,
    }).ok,
    true,
  );
});

test("the 3 Dec cut-over (fixed clock): reveals held to the last second of 2 Dec, free from midnight", () => {
  const titles = parseFetchTitles(`${GTA}@2026-11-18T11:00Z~${LIFT}`);
  const [w] = windowsFrom(titles, new Map(), {
    days: 28,
    openingShare: 0.1,
    earlyFree: [GTA],
  });
  assert.ok(w?.earlyFree);
  assert.equal(w!.until, "2026-12-03T00:00:00.000Z");
  const ch2 = idx(`${GTA} (movie 2)`, CH2);
  const b = book(CH2, GTA, [3]);
  const before = new Date("2026-12-02T23:59:59Z");
  const after = new Date("2026-12-03T00:00:00Z");
  assert.equal(
    footageAllowed(w, ch2, 350, "short", before, { book: b }).ok,
    false,
  );
  assert.equal(
    footageAllowed(w, ch2, 350, "thumbnail", before, { book: b }).ok,
    false,
  );
  assert.equal(
    footageAllowed(w, ch2, 350, "short", after, { book: b }).ok,
    true,
  );
  assert.equal(
    footageAllowed(w, ch2, 350, "thumbnail", after, { book: null }).ok,
    true,
  );
  assert.equal(
    spoilerHits("GTA 6: who dies at the end", [w!], before).length > 0,
    true,
  );
  assert.equal(
    spoilerHits("GTA 6: who dies at the end", [w!], after).length,
    0,
  );
  assert.equal(
    streamClipHold(w, ch2, { storyAt: 350, reveal: true }, before).hold,
    true,
  );
  assert.equal(
    streamClipHold(w, ch2, { storyAt: 350, reveal: true }, after).hold,
    false,
  );
});

test("late names: chapter 1 holds none in an early-free window; the writers' reveal words still count", () => {
  const ch1 = idx(GTA, CH1, [
    "Lucia at the motel",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Cal at Port Gellhorn",
  ]);
  ch1.cast = ["Lucia", "Cal"];
  ch1.places = ["Port Gellhorn"];
  assert.deepEqual(
    lateTerms(ch1, 0.1),
    ["Cal", "Port Gellhorn"],
    "the old hold",
  );
  assert.deepEqual(lateTerms(ch1, 0.1, { earlyFree: true }), []);
  const windows = windowsFrom(
    [{ game: GTA, release: "2026-11-18T11:00Z", until: LIFT }],
    new Map([["grand-theft-auto-vi", ch1]]),
    {
      days: 28,
      openingShare: 0.1,
      earlyFree: [GTA],
    },
  );
  assert.deepEqual(windows[0]!.lateTerms, []);
  assert.equal(
    spoilerHits("GTA 6: Cal at Port Gellhorn", windows, NOW).length,
    0,
  );
  for (const t of [
    "GTA 6's betrayal",
    "GTA 6: the undercover cop",
    "GTA 6 ending explained",
    "GTA 6: Jason dies",
  ])
    assert.ok(spoilerHits(t, windows, NOW).length > 0, t);
});

test("rules and scenes: spoiling words are reveals; scenes are contiguous and carry their words", () => {
  assert.equal(
    rulesReveal("They find his lifeless body on the dock")?.kind,
    "death",
  );
  assert.equal(rulesReveal("You set us up, Cal")?.kind, "betrayal");
  assert.equal(
    rulesReveal("He was an informant the whole time")?.kind,
    "identity",
  );
  assert.equal(rulesReveal("Lucia betrayed Jason")?.kind, "betrayal");
  assert.equal(
    rulesReveal("Lucia and Jason drive to the beach and argue about money"),
    undefined,
  );
  const i = idx(GTA, CH1);
  const sc = revealScenes(i, 250);
  assert.equal(sc[0]!.start, 0);
  for (let k = 1; k < sc.length; k++)
    assert.equal(sc[k]!.start, sc[k - 1]!.end);
  assert.equal(sc[sc.length - 1]!.end, 1000);
  assert.match(sc[0]!.text, /causeway, scene 0.*Line number 0/);
});

/** A fake model: answers each scene from the words, records the calls. */
function fakeLlm(
  answer: (
    text: string,
    n: number,
  ) => { reveal: boolean; kind: string; sure: boolean } | undefined,
  fail = new Set<number>(),
) {
  const calls: string[] = [];
  const llm: Llm = {
    structured: (async (opts: { content: string; site?: string }) => {
      calls.push(opts.content);
      if (fail.has(calls.length)) throw new Error("model down");
      const scenes = [
        ...opts.content.matchAll(/^(\d+)\. \[[^\]]+\] (.*)$/gm),
      ].flatMap((m) => {
        const a = answer(m[2]!, Number(m[1]));
        return a ? [{ n: Number(m[1]), ...a, why: "fake" }] : [];
      });
      return { scenes };
    }) as Llm["structured"],
  };
  return { llm, calls };
}

test("the classifier: unsure, missing and failed count as reveals; known scenes are not asked again", async () => {
  const descs = Array.from({ length: 10 }, (_, k) =>
    k === 2
      ? "Boss shoots Dre point blank"
      : k === 4
        ? "a dark blurry room"
        : k === 6
          ? "the crew betrayed by Raul"
          : `driving scene ${k}`,
  );
  const i = idx(`${GTA} (movie 2)`, CH2, descs);
  const { llm, calls } = fakeLlm((text) =>
    /point blank/.test(text)
      ? { reveal: true, kind: "death", sure: true }
      : /dark blurry/.test(text)
        ? { reveal: false, kind: "none", sure: false }
        : /scene 8/.test(text)
          ? undefined
          : { reveal: false, kind: "none", sure: true },
  );
  const r = await classifyReveals(llm, i, undefined, {
    now: NOW,
    seconds: 100,
    batch: 4,
  });
  const at = (k: number) => revealAt(r.book, i, k * 100 + 50);
  assert.equal(r.book.scenes.length, 10);
  assert.equal(at(0), false);
  assert.equal(at(2), true, "a death");
  assert.equal(at(4), true, "unsure is a reveal");
  assert.equal(at(6), true, "a rule");
  assert.equal(r.book.scenes[6]!.by, "rules");
  assert.equal(at(8), true, "no answer: pending");
  assert.equal(r.book.scenes[8]!.by, "pending");
  assert.equal(r.asked, 9, "the rule scene is not asked");
  assert.equal(calls.length, 3);
  const c = revealCounts(r.book);
  assert.deepEqual([c.safe, c.reveal, c.pending], [6, 3, 1]);
  // Again: only the pending scene is asked.
  const again = await classifyReveals(llm, i, r.book, {
    now: NOW,
    seconds: 100,
    batch: 4,
  });
  assert.equal(again.asked, 1);
  assert.equal(again.reused, 9);
  // New words in a scene: asked again.
  i.shots[0]!.desc = "Raul hands over the keys";
  const changed = await classifyReveals(llm, i, again.book, {
    now: NOW,
    seconds: 100,
    batch: 4,
  });
  assert.equal(changed.asked, 2);
  // A failed call leaves its scenes pending (held); no model at all leaves everything unasked held.
  const down = fakeLlm(
    () => ({ reveal: false, kind: "none", sure: true }),
    new Set([1]),
  );
  const d = await classifyReveals(down.llm, i, undefined, {
    now: NOW,
    seconds: 100,
    batch: 5,
  });
  assert.equal(d.failed, 5);
  assert.equal(revealAt(d.book, i, 50), true);
  assert.equal(revealAt(d.book, i, 950), false);
  const none = await classifyReveals(undefined, i, undefined, {
    now: NOW,
    seconds: 100,
  });
  assert.ok(none.book.scenes.every((s) => s.reveal));
  assert.equal(
    verdictOf(
      { n: 1, start: 0, end: 1, text: "x", hash: "h" },
      { n: 1, reveal: false, kind: "twist", sure: true, why: "" },
    ).reveal,
    true,
    "a kind is a reveal",
  );
});

test("the live books: read from the server's data folder, ignored for another upload", async () => {
  const dir = await tmpDir();
  try {
    const ch2 = idx(`${GTA} (movie 2)`, CH2);
    await fs.mkdir(sceneIndexDir(dir, ch2.game), { recursive: true });
    await fs.writeFile(
      revealsFile(dir, ch2.game),
      JSON.stringify(book(CH2, ch2.game, [3])),
    );
    setRevealDir(dir);
    assert.equal(liveRevealBook(ch2.game)?.videoId, CH2.videoId);
    const w = early();
    assert.equal(
      footageAllowed(w, ch2, 150, "short", NOW).ok,
      true,
      "the live book",
    );
    assert.equal(footageAllowed(w, ch2, 350, "short", NOW).ok, false);
    assert.equal(streamClipHold(w, ch2, { storyAt: 150 }, NOW).hold, false);
    assert.equal(streamClipHold(w, ch2, { storyAt: 350 }, NOW).hold, true);
  } finally {
    setRevealDir(undefined);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("stream clips: chapter 1 scenes go on, reveals wait, a cutscene no chapter knows needs frames without a reveal", () => {
  const w = early();
  const ch1 = idx(GTA, CH1);
  const b = book(CH1, GTA, [7]);
  assert.equal(
    streamClipHold(w, ch1, { storyAt: 600, letterboxShare: 1 }, NOW).hold,
    true,
    "chapter 1 past its opening, not checked: a clip is a whole Short",
  );
  assert.equal(streamClipHold(w, ch1, { storyAt: 50 }, NOW).hold, false, "the opening of chapter 1");
  assert.equal(streamClipHold(w, ch1, { storyAt: 650, reveal: false }, NOW).hold, false, "checked safe");
  assert.equal(
    streamClipHold(w, ch1, { storyAt: 750, reveal: true }, NOW).hold,
    true,
    "a chapter 1 reveal is held from Shorts",
  );
  assert.equal(
    streamClipHold(w, ch1, { letterboxShare: 0.9 }, NOW).hold,
    true,
    "a cutscene nobody places",
  );
  assert.equal(
    streamClipHold(w, ch1, { letterboxShare: 0.9, framesReveal: false }, NOW)
      .hold,
    false,
  );
  assert.equal(
    streamClipHold(w, ch1, { letterboxShare: 0.9, framesReveal: true }, NOW)
      .hold,
    true,
  );
  assert.equal(
    streamClipHold(w, ch1, { reviewSpoiler: true, framesReveal: false }, NOW)
      .hold,
    true,
    "the reviewer's flag stands",
  );
  assert.equal(
    streamClipHold(w, ch1, { speechShare: 0.1 }, NOW).hold,
    false,
    "gameplay",
  );
  void b;
  assert.equal(
    framesVerdict({ reveal: false, kind: "none", sure: false, why: "too dark" })
      .reveal,
    true,
    "unsure frames",
  );
  assert.equal(
    framesVerdict({ reveal: false, kind: "none", sure: true, why: "a chase" })
      .reveal,
    false,
  );
  assert.equal(framesVerdict({}).reveal, true, "unreadable");
});

test("held inbox clips: a safe one goes back to new for the owner's review, the rest wait until 3 Dec", () => {
  const held: GameplayMeta = {
    id: "gp_hud_x",
    status: "rejected",
    source: {
      file: "a.mp4",
      title: "GTA VI!!! First Play!",
      kind: "twitch_vod",
    },
    clip: { file: "clip.mp4", seconds: 40 },
    frames: ["frames/01.jpg"],
    created_at: NOW.toISOString(),
    review: {
      at: NOW.toISOString(),
      keep: false,
      reason: "held",
      spoiler_held_until: "2026-12-18T00:00:00.000Z",
    },
  };
  const until = "2026-12-03T00:00:00.000Z";
  const out = recheckHeld(
    held,
    { reveal: false, why: "a police chase" },
    until,
    NOW,
  );
  assert.equal(out.action, "release");
  assert.equal(out.meta.status, "new");
  assert.equal(out.meta.review, undefined);
  assert.equal(out.meta.spoiler_recheck?.reveal, false);
  const kept = recheckHeld(held, { reveal: true, why: "a death" }, until, NOW);
  assert.equal(kept.action, "hold");
  assert.equal(kept.meta.review?.spoiler_held_until, until);
  assert.match(kept.meta.review!.reason, /until 2026-12-03/);
  assert.equal(
    recheckHeld(held, undefined, until, NOW).action,
    "hold",
    "not checked: held",
  );
  assert.equal(
    recheckHeld(
      { ...held, status: "new" },
      { reveal: false, why: "" },
      until,
      NOW,
    ).action,
    "skip",
  );
  assert.equal(
    recheckHeld(
      { ...held, review: { ...held.review!, spoiler_held_until: undefined } },
      { reveal: false, why: "" },
      until,
      NOW,
    ).action,
    "skip",
  );
});

test("the guard's file lives beside the index", () => {
  assert.equal(
    path.basename(revealsFile("/d", `${GTA} (movie 2)`)),
    "reveals.json",
  );
  assert.match(
    revealsFile("/d", `${GTA} (movie 2)`),
    /grand-theft-auto-vi-movie-2/,
  );
});

test("the server's pass: movie chapters before playthroughs, books written, a failing model rests for hours", async () => {
  const dir = await tmpDir();
  try {
    await saveSceneIndex(dir, idx(GTA, CH1));
    await saveSceneIndex(dir, idx(`${GTA} (gameplay)`, { ...CH1, videoId: "PLAYthru001", kind: "playthrough", title: "GTA 6 full playthrough" }));
    await saveSceneIndex(dir, idx(`${GTA} (movie 2)`, CH2));
    const w = early();
    const seen: string[] = [];
    const ok = fakeLlm((text) => (seen.push(text), { reveal: false, kind: "none", sure: true }));
    const done = await revealPass(dir, [w], ok.llm, NOW, { maxCalls: 2 });
    assert.deepEqual(done.map((d) => d.index), [GTA, `${GTA} (movie 2)`], "movies first, the playthrough waits for budget");
    assert.ok(JSON.parse(await fs.readFile(revealsFile(dir, `${GTA} (movie 2)`), "utf8")).scenes.length > 0);
    // Outside an early-free window nothing is asked.
    const legacy = spoilerWindow(GTA, "2026-11-18T11:00Z", { days: 28, openingShare: 0.1, until: LIFT })!;
    assert.deepEqual(await revealPass(dir, [legacy], ok.llm, NOW), []);
    // A failing model: the next pass within three hours asks nothing.
    await saveSceneIndex(dir, idx(`${GTA} (movie 3)`, { ...CH2, videoId: "CHAPTER3aaa", chapter: 3 }));
    const down = fakeLlm(() => undefined, new Set([1, 2, 3, 4, 5]));
    await revealPass(dir, [w], down.llm, NOW);
    assert.equal(down.calls.length, 1);
    await revealPass(dir, [w], down.llm, new Date(NOW.getTime() + 3_600_000));
    assert.equal(down.calls.length, 1, "resting");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
