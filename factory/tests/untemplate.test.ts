import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  FIRST_SHOT_MIN,
  holdFirstShot,
  idHash,
  inShare,
  layoutArm,
  LAYOUT_CAP,
  lowerLine,
  lowerLineSize,
  pickShape,
  planSparseSfx,
  sequenceOf,
  sfxName,
  silenceBeat,
  silenceDipAt,
  SILENCE_DIP,
  soundArm,
  SPARSE_MAX,
  type ShortShape,
} from "../src/render/untemplate.ts";
import { planSfx, type RenderPlan, type Shot } from "../src/render/plan.ts";
import { overlaySpans, shortLayout } from "../src/render/cleanframe.ts";
import type { Segment } from "../src/render/timeline.ts";
import { memoryOf, shapeShort, soundShort } from "../src/untemplatestep.ts";
import { recordOf, samenessScore, samenessTable } from "../src/qa/sameness.ts";
import { loadConfig } from "../src/config.ts";
import { LEVEL } from "../src/render/soundscape.ts";

const FPS = 30;

/** A 45 s Short: hook, four beats with cards, the take, the loop, and words spread evenly with small gaps. */
function short(o: { takeGap?: number } = {}) {
  const segs: Array<Omit<Segment, "start" | "end"> & { secs: number }> = [
    {
      kind: "hook",
      text: "Is this the biggest delay of the year so far",
      secs: 4,
    },
    {
      kind: "beat",
      text: "The studio moved the date by nine months on Monday",
      secs: 6,
      visual: { kind: "stat", primary: "9 months", secondary: "" },
    },
    {
      kind: "beat",
      text: "Players had already paid for early access weeks ago",
      secs: 6,
      visual: { kind: "quote", primary: "early access", secondary: "" },
    },
    {
      kind: "beat",
      text: "The publisher says the extra time goes on bugs",
      secs: 6,
      visual: { kind: "report", primary: "bugs", secondary: "" },
    },
    {
      kind: "beat",
      text: "And the new date lands right beside a giant rival",
      secs: 6,
      visual: { kind: "versus", primary: "rival", secondary: "" },
    },
    {
      kind: "take",
      text: "I think the wait is worth it this time",
      secs: 6,
      visual: { kind: "title", primary: "Worth the wait", secondary: "" },
    },
    { kind: "loop", text: "So will you still be playing it in March", secs: 5 },
  ];
  const segments: Segment[] = [];
  const words: Array<{ text: string; start: number; end: number }> = [];
  let t = 0;
  for (const s of segs) {
    if (s.kind === "take" && o.takeGap) t += o.takeGap;
    const ws = s.text.split(" ");
    const step = s.secs / ws.length;
    ws.forEach((w, i) =>
      words.push({
        text: w,
        start: t + i * step,
        end: t + i * step + step * 0.8,
      }),
    );
    segments.push({
      kind: s.kind,
      text: s.text,
      visual: s.visual,
      start: t,
      end: t + s.secs,
    });
    t += s.secs;
  }
  const totalFrames = Math.round((t + 1) * FPS);
  const plan: RenderPlan = {
    version: 1,
    fps: FPS,
    totalFrames,
    tailFrames: 30,
    heroIndex: 0,
    shots: [],
    turns: [],
    sfx: planSfx(segments, totalFrames),
    shelf: [],
  };
  return { segments, words, plan };
}

const stampSound = { name: "v3/land", volume: LEVEL.land };

test("arms split by id, deterministically, and stay off unless switched on", () => {
  assert.equal(inShare("ep_x", 0, "s"), false);
  assert.equal(inShare("ep_x", 1, "s"), true);
  assert.equal(idHash("ep_a", "s"), idHash("ep_a", "s"));
  let on = 0;
  for (let n = 0; n < 2000; n++)
    if (
      inShare(
        `ep_20261118_${n.toString(16).padStart(8, "0")}`,
        0.5,
        "short-sound",
      )
    )
      on++;
  assert.ok(on > 900 && on < 1100, `about half: ${on}`);
  assert.equal(soundArm("ep_x", "v3", 1), "v3");
  assert.equal(soundArm("ep_x", "sparse", 1), "sparse");
  assert.equal(layoutArm("ep_x", false, 1), "off");
  assert.equal(layoutArm("ep_x", true, 1), "on");
});

test("the settings are off by default and parsed in the house style", () => {
  const keys = [
    "SHORT_SOUND_PLAN",
    "SHORT_SOUND_SPARSE_SHARE",
    "SHORT_LAYOUTS",
    "SHORT_LAYOUTS_SHARE",
    "SHORT_FIRST_SHOT_MIN_S",
  ];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    let c = loadConfig();
    assert.equal(c.shortSoundPlan, "v3");
    assert.equal(c.shortSoundSparseShare, 0.5);
    assert.equal(c.shortLayouts, false);
    assert.equal(c.shortLayoutsShare, 0.5);
    assert.equal(c.shortFirstShotMinSeconds, 0);
    Object.assign(process.env, {
      SHORT_SOUND_PLAN: "sparse",
      SHORT_SOUND_SPARSE_SHARE: "7",
      SHORT_LAYOUTS: "on",
      SHORT_LAYOUTS_SHARE: "0",
      SHORT_FIRST_SHOT_MIN_S: "1.5",
    });
    c = loadConfig();
    assert.equal(c.shortSoundPlan, "sparse");
    assert.equal(c.shortSoundSparseShare, 1);
    assert.equal(c.shortLayouts, true);
    assert.equal(c.shortLayoutsShare, 0);
    assert.equal(c.shortFirstShotMinSeconds, 1.5);
  } finally {
    for (const k of keys)
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
  }
});

test("effect names and sequences ignore folders, keys and file type", () => {
  assert.equal(sfxName("sfx/v3/sting-D.mp3"), "sting");
  assert.equal(sfxName("sfx/v3/air-2.mp3"), "air-2");
  assert.equal(
    sequenceOf([
      { file: "sfx/v3/swell.mp3", frame: 300 },
      { file: "sfx/v3/sting.mp3", frame: 0 },
    ]),
    "sting>swell",
  );
  assert.equal(sequenceOf([]), "");
});

test("today's plan opens and closes on the sting (the measured template)", () => {
  const { plan } = short();
  const seq = sequenceOf(plan.sfx).split(">");
  assert.equal(seq[0], "sting");
  assert.equal(seq.at(-1), "sting");
});

test("the sparse plan: no fixed sting, at most four effects, each on something arriving, two and a half seconds apart", () => {
  const { segments, words, plan } = short();
  let silent = 0;
  for (let n = 0; n < 200; n++) {
    const id = `ep_20261118_${n.toString(16).padStart(8, "0")}`;
    const r = planSparseSfx({
      id,
      plan,
      segments,
      words,
      stamps: [],
      clean: true,
      stampSound,
      recent: [],
    });
    assert.ok(r.sfx.length <= SPARSE_MAX);
    assert.ok(!r.sfx.some((c) => /sting/.test(c.file)), "no sting");
    assert.ok(
      r.sfx.every((c) => c.frame > 0),
      "nothing on the opening frame",
    );
    const frames = r.sfx.map((c) => c.frame).sort((a, b) => a - b);
    for (let i = 1; i < frames.length; i++)
      assert.ok(frames[i]! - frames[i - 1]! >= 60, "spaced");
    if (!r.sfx.length) silent++;
    // Deterministic for the same id and memory.
    assert.deepEqual(
      planSparseSfx({
        id,
        plan,
        segments,
        words,
        stamps: [],
        clean: true,
        stampSound,
        recent: [],
      }),
      r,
    );
  }
  assert.ok(silent > 10 && silent < 80, `some Shorts play none: ${silent}/200`);
});

test("the sparse plan never repeats a recent sequence where a choice exists", () => {
  const { segments, words, plan } = short();
  const recent: string[] = [];
  for (let n = 0; n < 30; n++) {
    const id = `ep_20261118_${(n * 977).toString(16).padStart(8, "0")}`;
    const r = planSparseSfx({
      id,
      plan,
      segments,
      words,
      stamps: [],
      clean: true,
      stampSound,
      recent,
    });
    if (r.sequence)
      assert.ok(!recent.includes(r.sequence), `${r.sequence} repeated`);
    recent.unshift(r.sequence);
  }
});

test("the sparse plan keeps cues it does not own and lands a stamp with its own sound", () => {
  const { segments, words, plan } = short();
  const foreign = { file: "sfx/other/brand.mp3", frame: 900, volume: 0.3 };
  const withForeign = { ...plan, sfx: [...plan.sfx, foreign] };
  for (let n = 0; n < 40; n++) {
    const r = planSparseSfx({
      id: `ep_k${n}`,
      plan: withForeign,
      segments,
      words,
      stamps: [{ at: 20 }],
      clean: true,
      stampSound,
      recent: [],
    });
    assert.ok(r.sfx.some((c) => c.file === foreign.file));
    // A stamp is the arrival most worth a sound: whenever there is any effect, the stamp has one.
    if (r.sfx.length > 1)
      assert.ok(
        r.sfx.some(
          (c) =>
            c.file === "sfx/v3/land.mp3" && Math.abs(c.frame - (600 - 5)) <= 3,
        ),
      );
  }
});

test("the silence beat uses the voice's own pause before the verdict and is never invented", () => {
  const tight = short();
  assert.equal(silenceBeat(tight.segments, tight.words, FPS), undefined);
  const roomy = short({ takeGap: 1.2 });
  const beat = silenceBeat(roomy.segments, roomy.words, FPS)!;
  assert.ok(beat, "a 1.2 s pause gives a beat");
  assert.ok(
    beat.to - beat.from >= 0.6 * FPS && beat.to - beat.from <= 1.5 * FPS,
  );
  const long = short({ takeGap: 3 });
  const capped = silenceBeat(long.segments, long.words, FPS)!;
  assert.ok(
    capped.to - capped.from <= Math.round(1.5 * FPS) + 1,
    "capped at 1.5 s",
  );
  // No effect starts inside it, and the music dips there.
  for (let n = 0; n < 60; n++) {
    const r = planSparseSfx({
      id: `ep_s${n}`,
      plan: roomy.plan,
      segments: roomy.segments,
      words: roomy.words,
      stamps: [],
      clean: true,
      stampSound,
      recent: [],
    });
    assert.deepEqual(r.silence, beat);
    assert.ok(!r.sfx.some((c) => c.frame >= beat.from && c.frame < beat.to));
  }
  assert.equal(silenceDipAt([beat], beat.from - 20), 1);
  assert.ok(Math.abs(silenceDipAt([beat], Math.round((beat.from + beat.to) / 2)) - SILENCE_DIP) < 1e-9);
  assert.equal(silenceDipAt(undefined, 10), 1);
});

test("the lower third takes a headline only when it fits one readable line", () => {
  assert.ok(lowerLineSize("GTA 6 slips to November"));
  assert.equal(
    lowerLineSize(
      "A headline far too long to sit on one readable line of the frame",
    ),
    undefined,
  );
  assert.equal(lowerLine("GTA 6 slips to November"), "GTA 6 slips to November");
  assert.equal(
    lowerLine(
      "A headline far too long to sit on one readable line of the frame",
      "DELAYED AGAIN",
    ),
    "DELAYED AGAIN",
  );
  assert.equal(
    lowerLine(
      "A headline far too long to sit on one readable line of the frame",
    ),
    undefined,
  );
});

test("shapes rotate so no opening takes more than 40% of the newest 30", () => {
  const recent: Array<Pick<ShortShape, "open" | "close">> = Array.from(
    { length: 30 },
    () => ({ open: "card", close: "card" }),
  );
  for (let n = 0; n < 30; n++) {
    const shape = pickShape({
      id: `ep_l${n}`,
      recent,
      rumour: false,
      line: "GTA 6 slips to November",
    });
    if (shape.open === "lower")
      assert.equal(shape.line, "GTA 6 slips to November");
    recent.unshift(shape);
  }
  const window = recent.slice(0, 30);
  for (const open of ["card", "footage", "lower"] as const)
    assert.ok(
      window.filter((s) => s.open === open).length / 30 <= LAYOUT_CAP,
      open,
    );
  assert.ok(
    window.some((s) => s.close === "hold") &&
      window.some((s) => s.close === "card"),
  );
  // Today's card-only history: the first chosen opening is never the card again.
  assert.notEqual(
    pickShape({
      id: "ep_z",
      recent: Array(29).fill({ open: "card", close: "card" }),
      rumour: false,
      line: "X",
    }).open,
    "card",
  );
});

test("a rumour, or a headline with no line, never opens on the lower third", () => {
  for (let n = 0; n < 50; n++) {
    assert.notEqual(
      pickShape({
        id: `ep_r${n}`,
        recent: [],
        rumour: true,
        line: "Short line",
      }).open,
      "lower",
    );
    assert.notEqual(
      pickShape({ id: `ep_r${n}`, recent: [], rumour: false }).open,
      "lower",
    );
  }
});

test("the shapes change what the clean frame and the graphics audit count", () => {
  const { segments, words, plan } = short();
  const layout = shortLayout(segments, FPS, plan.totalFrames, plan.tailFrames);
  const base = {
    segments,
    words,
    plan,
    layout,
    stamps: [],
    sting: false as const,
  };
  const keys = (shape?: {
    open: ShortShape["open"];
    close: ShortShape["close"];
  }) => overlaySpans({ ...base, shape }).map((s) => s.key);
  assert.ok(keys().includes("hook") && keys().includes("loop"));
  assert.ok(!keys({ open: "footage", close: "card" }).includes("hook"));
  assert.ok(keys({ open: "lower", close: "card" }).includes("hook"));
  assert.ok(!keys({ open: "card", close: "hold" }).includes("loop"));
});

test("the first shot of a stored plan that opens on 0.4 s is held to 1.5 s, the length unchanged", () => {
  const fx = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/plan_open_04s.json", import.meta.url),
      "utf8",
    ),
  ) as { shots: Shot[] };
  assert.equal(
    fx.shots[0]!.end - fx.shots[0]!.start,
    12,
    "the fixture opens on the 12-frame sting shot",
  );
  const held = holdFirstShot(fx.shots);
  assert.equal(held.length, fx.shots.length, "no shot added or removed");
  assert.equal(held[0]!.end - held[0]!.start, FIRST_SHOT_MIN);
  assert.equal(held[1]!.start, held[0]!.end);
  assert.equal(
    held[1]!.end,
    fx.shots[1]!.end,
    "the second shot ends where it did",
  );
  assert.deepEqual(held.slice(2), fx.shots.slice(2));
  assert.equal(held.at(-1)!.end, fx.shots.at(-1)!.end);
  // A clip second shot starts further in, so it still ends on the same frame of the clip.
  const clip: Shot[] = [
    fx.shots[0]!,
    { ...fx.shots[1]!, media: { type: "clip", index: 0, trimFrom: 40 } },
  ];
  const c = holdFirstShot(clip);
  assert.equal(c[1]!.media.trimFrom, 40 + (FIRST_SHOT_MIN - 12));
  // Already long enough, or a second shot too short to lend: unchanged.
  assert.equal(holdFirstShot(held), held);
  const tiny: Shot[] = [fx.shots[0]!, { ...fx.shots[1]!, end: 60 }];
  assert.equal(holdFirstShot(tiny), tiny);
});

test("SHORT_FIRST_SHOT_MIN_S holds every Short's first shot, whatever the layout test", () => {
  const fx = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/plan_open_04s.json", import.meta.url),
      "utf8",
    ),
  ) as { shots: Shot[] };
  const run = (
    cfg: {
      shortLayouts: boolean;
      shortLayoutsShare: number;
      shortFirstShotMinSeconds: number;
    },
    clean = false,
  ) => {
    const plan = { fps: FPS, shots: fx.shots.map((s) => ({ ...s })) };
    const assets: { shortShape?: unknown } = {};
    const shape = shapeShort({
      cfg,
      id: "ep_f",
      plan,
      clean,
      rumour: false,
      headline: "GTA 6 slips",
      memory: undefined,
      assets,
    });
    return { plan, assets, shape };
  };
  const off = run({
    shortLayouts: false,
    shortLayoutsShare: 0.5,
    shortFirstShotMinSeconds: 0,
  });
  assert.equal(off.plan.shots[0]!.end, 12, "default: today's behaviour");
  assert.equal(off.shape, undefined);
  assert.equal(off.assets.shortShape, undefined);
  const on = run({
    shortLayouts: false,
    shortLayoutsShare: 0.5,
    shortFirstShotMinSeconds: 1.5,
  });
  assert.equal(on.plan.shots[0]!.end, 45);
  const layouts = run(
    { shortLayouts: true, shortLayoutsShare: 1, shortFirstShotMinSeconds: 0 },
    true,
  );
  assert.ok(layouts.shape);
  assert.equal(
    layouts.plan.shots[0]!.end,
    45,
    "the chosen layouts hold it too",
  );
  const notClean = run(
    { shortLayouts: true, shortLayoutsShare: 1, shortFirstShotMinSeconds: 0 },
    false,
  );
  assert.equal(
    notClean.shape,
    undefined,
    "only a clean-frame Short gets a chosen shape",
  );
  assert.deepEqual(notClean.assets.shortShape, {
    arm: "on",
    open: "card",
    close: "card",
    skipped: "not a clean-frame Short",
  });
});

test("the sound step records its arm, rewrites only the sparse side and restores v3 on a stored sparse plan", () => {
  const { segments, words, plan } = short();
  const v3 = plan.sfx;
  const run = (shortSoundPlan: "v3" | "sparse", p: RenderPlan) => {
    const assets: { shortSoundArm?: "sparse" | "v3" } = {};
    const r = soundShort({
      cfg: { shortSoundPlan, shortSoundSparseShare: 1 },
      id: "ep_q",
      plan: p,
      segments,
      words,
      stamps: [],
      clean: true,
      stampSound,
      memory: undefined,
      assets,
      v3: () => v3,
    });
    return { r, assets };
  };
  const sparse = { ...plan, sfx: [...v3] };
  const a = run("sparse", sparse);
  assert.equal(a.assets.shortSoundArm, "sparse");
  assert.equal(sparse.soundPlan, "sparse");
  assert.ok(!sparse.sfx.some((c) => /sting/.test(c.file)));
  const b = run("v3", sparse);
  assert.equal(b.r.arm, "v3");
  assert.equal(
    b.assets.shortSoundArm,
    undefined,
    "no arm recorded while the test is off",
  );
  assert.deepEqual(sparse.sfx, v3);
  assert.equal(sparse.soundPlan, undefined);
});

test("the sameness score and its table", () => {
  const row = (
    id: string,
    sfx: string[],
    open = "card",
    bed = "music/bed_1.wav",
  ) => ({
    id,
    assets: {
      plan: {
        sfx: sfx.map((n, i) => ({
          file: `sfx/v3/${n}.mp3`,
          frame: i * 100,
          volume: 0.2,
        })),
        totalFrames: 1500,
        fps: 30,
      },
      shortShape: { open, close: "card" },
      musicFile: bed,
    },
    script: {
      beats: [{ visual: { kind: "stat" } }, { visual: { kind: "none" } }],
      pulse_take: { on_screen: "Verdict" },
    },
  });
  const recs = [
    row("a", ["sting", "air-1", "sting"]),
    row("b", ["sting", "air-1", "sting"]),
    row("c", ["air-2"], "footage"),
    row("d", [], "lower", "music/bed_2.wav"),
    row("e", []),
  ].map(recordOf);
  assert.deepEqual(recs[0]!.cards, ["stat", "title"]);
  const s = samenessScore(recs, 30);
  assert.equal(s.n, 5);
  assert.equal(s.sharedSequence, 0.4);
  assert.equal(s.sharedSequenceWithSilent, 0.8);
  assert.deepEqual(s.topSequence, {
    sequence: "sting>air-1>sting",
    share: 0.4,
  });
  assert.equal(s.silent, 0.4);
  assert.equal(s.opening[0]![0], "card");
  assert.equal(s.opening[0]![1], 0.6);
  assert.equal(s.sharedCardOrder, 1);
  assert.ok(
    samenessTable(s).includes(
      "| Same effect sequence as another Short (target under 15%) | 40% |",
    ),
  );
  assert.ok(samenessTable(s, s).split("\n")[0]!.includes("After"));
});

test("the memory reads stored plans and shapes, today's Shorts as the card", () => {
  const m = memoryOf([
    {
      sfx: [
        { file: "sfx/v3/sting.mp3", frame: 0 },
        { file: "sfx/v3/air-1.mp3", frame: 90 },
      ],
      shape: null,
    },
    { sfx: null, shape: { open: "lower", close: "hold" } },
  ]);
  assert.deepEqual(m.sequences, ["sting>air-1", ""]);
  assert.deepEqual(m.shapes, [
    { open: "card", close: "card" },
    { open: "lower", close: "hold" },
  ]);
});

test("people and mention insets count as the one overlay in every opening and closing, and arrive with a sound", async () => {
  const { arbitrate } = await import("../src/render/cleanframe.ts");
  const { arrivalsOf } = await import("../src/render/untemplate.ts");
  const { segments, words, plan } = short();
  const layout = shortLayout(segments, FPS, plan.totalFrames, plan.tailFrames);
  // One person named during the hook, one in the last two seconds.
  const people = [
    { name: "Ann Example", src: "a.jpg", credit: "", at: 1 },
    { name: "Bob Example", src: "b.jpg", credit: "", at: plan.totalFrames / FPS - 2.5 },
  ];
  // A mention inset on the second beat's word (MENTION_*), standing in for that beat's card.
  const mentions = [
    {
      key: "mention0",
      from: 10 * FPS + 15,
      to: 10 * FPS + 15 + 84,
      m: { kind: "game" as const, key: "rival", at: 10.5, pictures: [{ src: "r.jpg", label: "Rival" }] },
    },
  ];
  const kept = (shape?: { open: ShortShape["open"]; close: ShortShape["close"] }) =>
    arbitrate(overlaySpans({ segments, words, plan, layout, stamps: [], sting: false, people, mentions, shape }));
  const at = (spans: ReturnType<typeof kept>, f: number) => spans.filter((s) => f >= s.from && f < s.to);
  for (const open of ["card", "footage", "lower"] as const)
    for (const close of ["card", "hold"] as const) {
      const k = kept({ open, close });
      for (let f = 0; f < plan.totalFrames; f++) assert.ok(at(k, f).length <= 1, `${open}/${close}: one overlay at frame ${f}`);
    }
  const peopleIn = (k: ReturnType<typeof kept>, a: number, b: number) => k.some((s) => s.kind === "people" && s.from < b && s.to > a);
  // Over the hook the headline (card or lower third) wins; a full-frame opening lets the inset show.
  assert.ok(!peopleIn(kept({ open: "card", close: "card" }), 0, 40));
  assert.ok(!peopleIn(kept({ open: "lower", close: "card" }), 0, 40));
  assert.ok(peopleIn(kept({ open: "footage", close: "card" }), 0, 60));
  // At the end the return to the headline card wins; holding on the payoff lets the inset show.
  assert.ok(!peopleIn(kept({ open: "card", close: "card" }), layout.loopFrom, plan.totalFrames));
  assert.ok(peopleIn(kept({ open: "card", close: "hold" }), layout.loopFrom, plan.totalFrames));
  // An inset that shows is an arrival the sparse plan may mark.
  const arr = arrivalsOf({ plan, segments, words, stamps: [], clean: true, shape: { open: "footage", close: "hold" }, people, mentions });
  assert.ok(arr.some((a) => a.frame >= 25 && a.frame <= 40));
  // The mention inset is drawn in every shape (on its word, in place of its beat's card), and is an arrival too.
  for (const open of ["card", "footage", "lower"] as const)
    for (const close of ["card", "hold"] as const)
      assert.ok(kept({ open, close }).some((s) => s.kind === "mention"), `${open}/${close}: mention shown`);
  assert.ok(arr.some((a) => Math.abs(a.frame - mentions[0]!.from) <= 3));
});
