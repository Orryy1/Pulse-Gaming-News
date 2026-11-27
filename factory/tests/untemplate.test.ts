import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  arrivalsOf,
  FIRST_SHOT_MIN,
  firstShotArm,
  holdFirstShot,
  hookLine,
  LOWER_WIDTH,
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
import { arbitrate, overlaySpans, shortLayout } from "../src/render/cleanframe.ts";
import type { Segment } from "../src/render/timeline.ts";
import {
  memoryOf,
  restoreV3Sound,
  shapeShort,
  soundShort,
  soundStepDue,
  UNTEMPLATE_VERDICT_MIN,
  untemplateLinesForReport,
  type FirstShotRecord,
} from "../src/untemplatestep.ts";
import { cardStillProps, coverStillProps } from "../src/render/render.ts";
import { SAFE } from "../src/render/layout.ts";
import { recordOf, samenessScore, samenessTable } from "../src/qa/sameness.ts";
import { loadConfig } from "../src/config.ts";
import { LEVEL } from "../src/render/soundscape.ts";
import { testConfig } from "./helpers.ts";

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
    "SHORT_FIRST_SHOT_SHARE",
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
    assert.equal(c.shortFirstShotShare, 0.5);
    Object.assign(process.env, {
      SHORT_SOUND_PLAN: "sparse",
      SHORT_SOUND_SPARSE_SHARE: "7",
      SHORT_LAYOUTS: "on",
      SHORT_LAYOUTS_SHARE: "0",
      SHORT_FIRST_SHOT_MIN_S: "1.5",
      SHORT_FIRST_SHOT_SHARE: "1",
    });
    c = loadConfig();
    assert.equal(c.shortSoundPlan, "sparse");
    assert.equal(c.shortSoundSparseShare, 1);
    assert.equal(c.shortLayouts, true);
    assert.equal(c.shortLayoutsShare, 0);
    assert.equal(c.shortFirstShotMinSeconds, 1.5);
    assert.equal(c.shortFirstShotShare, 1);
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

test("the lower third takes three or four words of the spoken hook, the headline only when the hook gives none", () => {
  // Never a bare first-words cut: a long hook with no short first clause gives no line.
  assert.equal(hookLine("Is this the biggest delay of the year so far"), undefined);
  // Cutting what limits a negation or a verb makes a false claim: every one of these falls back to the headline.
  for (const h of [
    "GTA 6 won't launch on PC at first.",
    "Starfield isn't coming to PS5 this year.",
    "Fable isn't coming in 2026 after all.",
    "Sony is not shutting down Bungie.",
    "Nintendo just cancelled the Switch 2 Lite.",
  ]) {
    assert.equal(hookLine(h), undefined, h);
    assert.equal(lowerLine("Headline", undefined, h), "Headline", h);
  }
  // A whole short hook, or a whole short first clause, is taken as said.
  assert.equal(hookLine("GTA 6 slipped again."), "GTA 6 slipped again");
  // Only the whole hook: what follows a short first clause or sentence can take it back or limit it.
  assert.equal(hookLine("GTA 6 slipped again. Here is why it matters"), undefined);
  for (const h of [
    "Fable isn't coming. Not in 2026, anyway.",
    "Xbox is dead, if you believe the rumours.",
    "GTA 6 is delayed, maybe.",
    "Silksong is out, on PC only.",
    "The PS6 is here. Well, almost.",
  ]) {
    assert.equal(hookLine(h), undefined, h);
    assert.equal(lowerLine("Headline", undefined, h), "Headline", h);
  }
  // Never a weak last word: "Nintendo just killed the" reads "Nintendo just killed".
  assert.equal(hookLine("Nintendo just killed the Switch price cut"), undefined);
  // Never more than four words, every word whole, and always inside the width.
  for (const h of [
    "Is this the biggest delay of the year so far",
    "Rockstar finally confirmed what everyone suspected",
    "Supercalifragilistic extraordinarily overwhelmingly unbelievable",
  ]) {
    const t = hookLine(h);
    if (t === undefined) continue;
    assert.ok(t.split(" ").length >= 2 && t.split(" ").length <= 4, t);
    assert.ok(h.replace(/[.,!?]/g, "").startsWith(t), t);
    assert.ok(lowerLineSize(t), t);
  }
  // Never cut after a figure, before a figure or between a figure and its unit; never on a negation; never an
  // attributed clause: each falls back to the headline.
  assert.equal(hookLine("PS5 Pro sold 2.4 million in a week"), undefined);
  assert.equal(hookLine("Switch 2 costs $449 now, and that is the cheap one"), undefined);
  assert.equal(hookLine("Xbox is dead, says nobody at Microsoft"), undefined);
  assert.notEqual(hookLine("This game was never cancelled at all"), "This game was never");
  assert.equal(hookLine("That is what you\u2019re"), undefined, "a curly apostrophe still reads as a weak word");
  assert.equal(hookLine("GTA 6 slips again today"), undefined);
  assert.equal(hookLine("GTA 6 slips again"), "GTA 6 slips again");
  // The render step passes the written hook, not the voice's respelt one: a figure stays a figure on screen.
  assert.equal(lowerLine("Switch 2 price rises", undefined, "Switch 2 costs $449 now, and that is the cheap one"), "Switch 2 price rises");
  const pipelineSrc = fs.readFileSync(new URL("../src/pipeline.ts", import.meta.url), "utf8");
  assert.ok(/shapeShort\(\{[\s\S]{0,400}hook: script\.hook,/.test(pipelineSrc), "shapeShort gets script.hook");
  // Unusable hooks: empty, one word, or nothing that fits.
  assert.equal(hookLine(""), undefined);
  assert.equal(hookLine("Wow."), undefined);
  assert.equal(hookLine("Supercalifragilisticexpialidocious extraordinarilyoverwhelming"), undefined);
  assert.equal(lowerLine("GTA 6 slips to November", "DELAYED", "Rockstar moved it again"), "Rockstar moved it again");
  assert.equal(lowerLine("GTA 6 slips to November", "DELAYED", "Rockstar just moved it again"), "GTA 6 slips to November");
  assert.equal(lowerLine("GTA 6 slips to November", "DELAYED", "Wow."), "GTA 6 slips to November");
  assert.equal(lowerLine("GTA 6 slips to November", "DELAYED"), "GTA 6 slips to November");
  // The lower third stays inside the safe area: its text width is the content box less the bar, padding and spacing.
  assert.equal(LOWER_WIDTH, SAFE.right - SAFE.left - 72);
  assert.ok(64 + 10 + 44 + LOWER_WIDTH + 18 <= SAFE.right);
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

test("SHORT_FIRST_SHOT_MIN_S is its own test: split by its own share, recorded, and never held by a layout", () => {
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
      shortFirstShotShare?: number;
    },
    clean = false,
    id = "ep_f",
  ) => {
    const plan: { fps: number; shots: Shot[]; firstShotHeld?: number } = { fps: FPS, shots: fx.shots.map((s) => ({ ...s })) };
    const assets: { shortShape?: unknown; shortFirstShot?: FirstShotRecord } = {};
    const shape = shapeShort({
      cfg: { shortFirstShotShare: 1, ...cfg },
      id,
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
  assert.equal(off.assets.shortFirstShot, undefined, "nothing recorded while the test is off");
  const on = run({
    shortLayouts: false,
    shortLayoutsShare: 0.5,
    shortFirstShotMinSeconds: 1.5,
  });
  assert.equal(on.plan.shots[0]!.end, 45);
  assert.deepEqual(on.assets.shortFirstShot, { arm: "held", seconds: 1.5, changed: true });
  // The other side of the split: recorded, not held.
  const notHeld = run({ shortLayouts: false, shortLayoutsShare: 0.5, shortFirstShotMinSeconds: 1.5, shortFirstShotShare: 0 });
  assert.equal(notHeld.plan.shots[0]!.end, 12);
  assert.deepEqual(notHeld.assets.shortFirstShot, { arm: "off", seconds: 0, changed: false });
  // Its own salt: at share 0.5 the first-shot split is not the layout split.
  let differ = 0;
  for (let n = 0; n < 400; n++) {
    const id = `ep_20261127_${n.toString(16).padStart(8, "0")}`;
    if ((firstShotArm(id, 1.5, 0.5) === "held") !== (layoutArm(id, true, 0.5) === "on")) differ++;
  }
  assert.ok(differ > 120 && differ < 280, `independent splits: ${differ} of 400 differ`);
  const layouts = run(
    { shortLayouts: true, shortLayoutsShare: 1, shortFirstShotMinSeconds: 0 },
    true,
  );
  assert.ok(layouts.shape);
  assert.equal(
    layouts.plan.shots[0]!.end,
    12,
    "a chosen layout never holds the first shot by itself",
  );
  assert.equal(layouts.assets.shortFirstShot, undefined);
  // The hold marks the plan, and only a held plan's record says "held".
  assert.equal(on.plan.firstShotHeld, 1.5);
  assert.equal(notHeld.plan.firstShotHeld, undefined);
  // A plan rebuilt after a regather (no mark) never inherits an old "held" record.
  for (const [cfg, want] of [
    [{ shortLayouts: false, shortLayoutsShare: 0.5, shortFirstShotMinSeconds: 0, shortFirstShotShare: 1 }, undefined],
    [{ shortLayouts: false, shortLayoutsShare: 0.5, shortFirstShotMinSeconds: 1.5, shortFirstShotShare: 0 }, { arm: "off", seconds: 0, changed: false }],
  ] as const) {
    const fresh = { fps: FPS, shots: fx.shots.map((s) => ({ ...s })) };
    const a: { shortShape?: unknown; shortFirstShot?: FirstShotRecord } = {
      shortFirstShot: { arm: "held", seconds: 1.5, changed: true },
    };
    shapeShort({ cfg, id: "ep_f", plan: fresh, clean: false, rumour: false, headline: "X", memory: undefined, assets: a });
    assert.deepEqual(a.shortFirstShot, want);
    assert.equal(fresh.shots[0]!.end, 12);
  }
  // A plan an earlier render held stays held on a re-render (the hold is never undone), so its record stays too.
  for (const cfg of [
    { shortLayouts: false, shortLayoutsShare: 0.5, shortFirstShotMinSeconds: 0, shortFirstShotShare: 1 },
    { shortLayouts: false, shortLayoutsShare: 0.5, shortFirstShotMinSeconds: 1.5, shortFirstShotShare: 0 },
  ]) {
    const stored = { fps: FPS, shots: holdFirstShot(fx.shots.map((s) => ({ ...s }))), firstShotHeld: 1.5 };
    const a: { shortShape?: unknown; shortFirstShot?: FirstShotRecord } = {};
    shapeShort({ cfg, id: "ep_f", plan: stored, clean: false, rumour: false, headline: "X", memory: undefined, assets: a });
    assert.deepEqual(a.shortFirstShot, { arm: "held", seconds: 1.5, changed: true });
  }
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

test("the memory reads every Short's sequence and only the shapes the layout test chose", () => {
  const m = memoryOf([
    {
      sfx: [
        { file: "sfx/v3/sting.mp3", frame: 0 },
        { file: "sfx/v3/air-1.mp3", frame: 90 },
      ],
      shape: null,
    },
    { sfx: null, shape: { arm: "on", open: "lower", close: "hold", line: "X Y" } },
    { sfx: null, shape: { arm: "off", open: "card", close: "card" } },
    { sfx: null, shape: { arm: "on", open: "card", close: "card", skipped: "not a clean-frame Short" } },
    { sfx: null, shape: { arm: "on", open: "footage", close: "card" } },
  ]);
  assert.deepEqual(m.sequences, ["sting>air-1", "", "", "", ""]);
  assert.deepEqual(m.shapes, [
    { open: "lower", close: "hold" },
    { open: "footage", close: "card" },
  ]);
});

test("the opening cap holds on the test's side at share 0.5, with the Shorts off it all on the card", () => {
  // A rolling channel: half the Shorts on the test (by id), the rest today's card; the memory as readShortMemory builds it.
  const rows: Array<{ shape: unknown }> = [];
  for (let n = 0; n < 120; n++) {
    const id = `ep_20261127_${n.toString(16).padStart(8, "0")}`;
    const mem = memoryOf([], rows.filter((r) => (r.shape as { arm?: string }).arm === "on").slice(0, 30));
    if (layoutArm(id, true, 0.5) === "on") {
      const sh = pickShape({ id, recent: mem.shapes, rumour: false, line: "GTA 6 slips" });
      rows.unshift({ shape: { arm: "on", ...sh } });
    } else rows.unshift({ shape: { arm: "off", open: "card", close: "card" } });
  }
  const chosen = memoryOf([], rows).shapes.slice(0, 30);
  assert.equal(chosen.length, 30);
  for (const open of ["card", "footage", "lower"] as const)
    assert.ok(chosen.filter((s) => s.open === open).length / 30 <= LAYOUT_CAP, open);
  assert.ok(chosen.some((s) => s.open === "card"), "the test's side still uses today's card in its turn");
});

test("a retry keeps the shape and the sparse sequence an earlier render chose, whatever newer Shorts did", () => {
  const fx = JSON.parse(
    fs.readFileSync(new URL("./fixtures/plan_open_04s.json", import.meta.url), "utf8"),
  ) as { shots: Shot[] };
  const cfg = { shortLayouts: true, shortLayoutsShare: 1, shortFirstShotMinSeconds: 0, shortFirstShotShare: 0.5 };
  const assets: { shortShape?: unknown } = {};
  const shapeOf = (recent: Array<Pick<ShortShape, "open" | "close">>, rumour = false) =>
    shapeShort({
      cfg,
      id: "ep_retry",
      plan: { fps: FPS, shots: fx.shots.map((x) => ({ ...x })) },
      clean: true,
      rumour,
      headline: "GTA 6 slips",
      hook: "Rockstar moved it again",
      memory: { sequences: [], shapes: recent },
      assets,
    });
  const first = shapeOf([]);
  assert.ok(first);
  // Newer Shorts all used the first render's opening and closing: a fresh pick would now avoid them.
  const crowd = Array.from({ length: 29 }, () => ({ open: first!.open, close: first!.close }));
  assert.notDeepEqual(
    pickShape({ id: "ep_retry", recent: crowd, rumour: false, line: "Rockstar moved it again" }),
    first,
    "the memory alone would change the pick",
  );
  assert.deepEqual(shapeOf(crowd), first, "the retry keeps the stored shape");
  assert.deepEqual(assets.shortShape, { arm: "on", ...first });
  // A stored lower third that a rumour can no longer use is chosen again.
  assets.shortShape = { arm: "on", open: "lower", close: "card", line: "Rockstar just moved" };
  assert.notEqual(shapeOf([], true)!.open, "lower");

  const { segments, words, plan } = short();
  const v3 = plan.sfx;
  const sound: { shortSoundArm?: "sparse" | "v3"; shortSoundSequence?: string } = {};
  const play = (recent: string[]) => {
    const p: RenderPlan = { ...plan, sfx: [...v3] };
    const r = soundShort({
      cfg: { shortSoundPlan: "sparse", shortSoundSparseShare: 1 },
      id: "ep_retry_sound",
      plan: p,
      segments,
      words,
      stamps: [],
      clean: true,
      stampSound,
      memory: { sequences: recent, shapes: [] },
      assets: sound,
      v3: () => v3,
    });
    return { r, p };
  };
  // An id whose sparse plan plays effects (about one in five plays none).
  const a = play([]);
  assert.equal(sound.shortSoundSequence, a.r.sequence, "the sequence is recorded on the episode");
  assert.ok(a.r.sequence, "the test id plays at least one effect");
  // A newer Short played exactly that sequence: a fresh plan would avoid it, the retry keeps it.
  const fresh = planSparseSfx({ id: "ep_retry_sound", plan: { ...plan, sfx: [...v3] }, segments, words, stamps: [], clean: true, stampSound, recent: [a.r.sequence] });
  assert.notEqual(fresh.sequence, a.r.sequence, "the memory alone would change the sound");
  const b = play([a.r.sequence]);
  assert.equal(b.r.sequence, a.r.sequence);
  assert.equal(b.r.kept, true);
  assert.deepEqual(b.p.sfx, a.p.sfx);
  // On the v3 side the stored sequence goes with the arm.
  soundShort({
    cfg: { shortSoundPlan: "sparse", shortSoundSparseShare: 0 },
    id: "ep_retry_sound",
    plan: { ...plan, sfx: [...v3] },
    segments,
    words,
    stamps: [],
    clean: true,
    stampSound,
    memory: undefined,
    assets: sound,
    v3: () => v3,
  });
  assert.equal(sound.shortSoundArm, "v3");
  assert.equal(sound.shortSoundSequence, undefined);
});

test("the cover and the frame-0 thumbnail always carry today's card opening", () => {
  type P = { headline: string; openingWords?: string; coverStill?: boolean; shape?: unknown };
  const props: P = {
    headline: "GTA 6 slips to November",
    openingWords: "GTA 6",
    shape: { open: "footage" as const, close: "hold" as const },
  };
  const cover = coverStillProps(props);
  assert.equal("shape" in cover, false, "the cover has no chosen shape");
  assert.equal(cover.openingWords, undefined);
  assert.equal(cover.coverStill, true);
  const lower = cardStillProps({ ...props, shape: { open: "lower" as const, close: "card" as const, line: "GTA 6 slips" } });
  assert.equal("shape" in lower, false, "the thumbnail has no chosen shape");
  assert.equal(lower.openingWords, "GTA 6", "the thumbnail keeps its own opening words, as today");
  // With the test off nothing changes: the same props object, and the cover exactly as before.
  const off: P = { headline: "GTA 6 slips to November", openingWords: "GTA 6" };
  assert.equal(cardStillProps(off), off);
  assert.deepEqual(coverStillProps(off), { headline: "GTA 6 slips to November", coverStill: true });
});

test("a footage opening's cover still shows only the headline card at frame 0, whatever the gate put in the hook", async () => {
  const { stingPlacement } = await import("../src/render/cleanframe.ts");
  const { segments, words, plan } = short();
  // A footage opening has no headline over the hook, so the graphics gate may move a card onto frame 0.
  segments[1] = { ...segments[1]!, visual: { ...segments[1]!.visual!, span: [0, 2.5] } };
  const layout = shortLayout(segments, FPS, plan.totalFrames, plan.tailFrames);
  const people = [{ name: "Ann Example", src: "a.jpg", credit: "", at: 0 }];
  const keptAt0 = (shape?: { open: ShortShape["open"]; close: ShortShape["close"] }) =>
    arbitrate(overlaySpans({ segments, words, plan, layout, stamps: [], sting: false, people, shape }))
      .filter((s) => s.kind !== "shelf" && s.from <= 0 && s.to > 0)
      .map((s) => s.kind);
  const footage = keptAt0({ open: "footage", close: "card" });
  assert.ok(footage.length > 0 && !footage.includes("hook"), `the video's frame 0 shows the gate's overlay: ${footage}`);
  // The cover draws the Short with no shape (cardStillProps): the headline card wins frame 0 and nothing else shows.
  const props = cardStillProps({ shape: { open: "footage" as const, close: "card" as const } });
  assert.deepEqual(keptAt0((props as { shape?: ShortShape }).shape), ["hook"]);
  // The game collage card is never placed inside the hook, whatever the shape.
  const at = stingPlacement({ segments, words, fps: FPS, totalFrames: plan.totalFrames, names: () => true, pictures: 3 });
  assert.ok(!at || at.from >= layout.hookEnd);
});

test("the weekly report reads each test by arm, with no verdict before 20 a side", () => {
  assert.deepEqual(untemplateLinesForReport([]), []);
  const few = untemplateLinesForReport([
    { sound: "sparse", views7d: 1000, viewed_pct: 70 },
    { sound: "sparse", views7d: 3000, viewed_pct: 80 },
    { sound: "v3", views7d: 500 },
    { sound: "v3" },
  ]);
  assert.equal(few.length, 2, "only the sound test has Shorts");
  assert.equal(
    few[0],
    "Short sound test (SHORT_SOUND_PLAN): sparse 2 Shorts, middle 7-day views 2,000 (2 read), average viewed 75.0%; v3 2 Shorts, middle 7-day views 500 (1 read), average viewed n/a.",
  );
  assert.ok(few[1]!.includes(`no verdict before ${UNTEMPLATE_VERDICT_MIN} a side`));
  const many = untemplateLinesForReport([
    ...Array.from({ length: 20 }, (_, i) => ({ layout: "on" as const, open: i % 2 ? "footage" : "card", views7d: 2000, viewed_pct: 60 })),
    ...Array.from({ length: 20 }, () => ({ layout: "off" as const, open: "card", views7d: 1000, viewed_pct: 55 })),
    { layout: "on" as const, open: "card", skipped: true },
    { firstShot: "held" as const, views7d: 10 },
  ]);
  assert.ok(
    many[0]!.includes("openings on the test's side: card 10, footage 10, not clean-frame (today's card, no shape chosen) 1"),
    String(many[0]),
  );
  assert.equal(
    many[1],
    "Short layout test (SHORT_LAYOUTS) verdict: middle 7-day views 2,000 against 1,000 (2.00x), average viewed 60.0% against 55.0%, 20 against 20 Shorts.",
  );
  assert.ok(many[2]!.startsWith("Short first-shot test (SHORT_FIRST_SHOT_MIN_S): held 1 Shorts"));
  assert.ok(many[3]!.includes("no verdict before"));
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

test("with every setting off, a stored Short's plan, effects and overlays are exactly stage's", () => {
  const fx = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/untemplate_off_3658bb74.json", import.meta.url),
      "utf8",
    ),
  ) as {
    segments: Segment[];
    words: Array<{ text: string; start: number; end: number }>;
    stamps: Array<{ at: number; text: string; sub?: string; colour: string }>;
    plan: RenderPlan;
    stage: { sfx: unknown; layout: unknown; spans: unknown; kept: unknown };
  };
  const cfg = testConfig(""); // only the settings are read
  assert.equal(cfg.shortSoundPlan, "v3");
  assert.equal(cfg.shortLayouts, false);
  assert.equal(cfg.shortFirstShotMinSeconds, 0);
  const plan = JSON.parse(JSON.stringify(fx.plan)) as RenderPlan;
  const before = JSON.stringify(plan);
  // The render step's order (src/pipeline.ts): the shape, the overlays, then the sound step.
  const assets: {
    shortShape?: unknown;
    shortSoundArm?: "sparse" | "v3";
    shortSoundSequence?: string;
    shortFirstShot?: FirstShotRecord;
  } = {};
  const shape = shapeShort({
    cfg,
    id: "ep_20261105_3658bb74",
    plan,
    clean: true,
    rumour: false,
    headline: "Nintendo Rules Out Another Switch 2 Hike, For Now",
    hook: fx.segments.find((g) => g.kind === "hook")?.text,
    memory: undefined,
    assets,
  });
  assert.equal(shape, undefined);
  const layout = shortLayout(fx.segments, plan.fps, plan.totalFrames, plan.tailFrames);
  const spans = overlaySpans({
    segments: fx.segments,
    words: fx.words,
    plan,
    layout,
    stamps: fx.stamps,
    sting: false,
    shape,
  });
  assert.equal(JSON.stringify(layout), JSON.stringify(fx.stage.layout));
  assert.equal(JSON.stringify(spans), JSON.stringify(fx.stage.spans));
  assert.equal(JSON.stringify(arbitrate(spans)), JSON.stringify(fx.stage.kept));
  // The pipeline skips the sound step unless SHORT_SOUND_PLAN=sparse or the stored plan is sparse; called anyway, it
  // leaves a v3 plan alone.
  assert.equal(soundStepDue(cfg, plan), false, "the pipeline's own guard");
  assert.equal(
    restoreV3Sound({ cfg, id: "ep_20261105_3658bb74", plan, assets, v3: () => [] }),
    false,
    "a v3 plan is never rebuilt where it is loaded",
  );
  soundShort({
    cfg,
    id: "ep_20261105_3658bb74",
    plan,
    segments: fx.segments,
    words: fx.words,
    stamps: fx.stamps,
    clean: true,
    stampSound,
    shape,
    memory: undefined,
    assets,
    v3: () => {
      throw new Error("a v3 plan is never rebuilt");
    },
  });
  assert.equal(JSON.stringify(plan), before, "the plan, its shots and its effects, byte for byte");
  assert.deepEqual(assets, {}, "nothing recorded on the episode");
  assert.equal(JSON.stringify(planSfx(fx.segments, plan.totalFrames)), JSON.stringify(fx.stage.sfx));
  assert.deepEqual(
    plan.sfx.map((c) => c.file),
    (fx.stage.sfx as Array<{ file: string }>).map((c) => c.file),
  );
  // The render's music level: no silence dip on any frame of a plan with no silences.
  for (let f = 0; f < plan.totalFrames; f++) assert.equal(silenceDipAt(plan.silences, f), 1);
});

test("the sparse plan drops the Pulse ident with the house sting and keeps a series sting", () => {
  const { segments, words, plan } = short();
  const ident = { file: "sfx/ace/ident_1-D.mp3", frame: 0, volume: 0.4 };
  const series = { file: "sfx/signature/gta-D.mp3", frame: 0, volume: 0.4 };
  for (let n = 0; n < 40; n++) {
    const r = planSparseSfx({
      id: `ep_ace${n}`,
      plan: { ...plan, sfx: [ident, ...plan.sfx.slice(1), series] },
      segments,
      words,
      stamps: [],
      clean: true,
      stampSound,
      recent: [],
    });
    assert.ok(!r.sfx.some((c) => c.file.startsWith("sfx/ace/")), "no ident on a sparse Short");
    assert.ok(r.sfx.some((c) => c.file === series.file), "a series' own sting stays");
  }
});

test("the game collage card arrives like a card where it is drawn, and yields to a card it meets", () => {
  const { segments, words, plan } = short();
  const without = arrivalsOf({ plan, segments, words, stamps: [], clean: true });
  // A free stretch on the clean frame (cards and stamps win over the collage card in arbitrate).
  const layout = shortLayout(segments, plan.fps, plan.totalFrames, plan.tailFrames);
  const kept = arbitrate(overlaySpans({ segments, words, plan, layout, stamps: [], sting: false }))
    .filter((x) => x.kind !== "shelf")
    .sort((a, b) => a.from - b.from);
  let free: { from: number; frames: number } | undefined;
  for (let k = 1; k < kept.length && !free; k++)
    if (kept[k]!.from - kept[k - 1]!.to >= 30) free = { from: kept[k - 1]!.to, frames: 24 };
  assert.ok(free, "the test Short has a free stretch");
  const drawn = arrivalsOf({ plan, segments, words, stamps: [], clean: true, sting: free });
  assert.ok(drawn.some((a) => a.frame === free!.from && a.kind === "card"), "the collage card arrives");
  // Over a card it is cut (it arrives late or not at all) and the card still arrives on its own frame.
  const card = without.find((a) => a.kind === "card" || a.kind === "number")!;
  const over = { from: card.frame, frames: 40 };
  const met = arrivalsOf({ plan, segments, words, stamps: [], clean: true, sting: over });
  assert.ok(met.some((a) => a.frame === card.frame), "the card keeps its arrival");
  assert.equal(met.filter((a) => a.frame === card.frame).length, 1, "one arrival, not two, on that frame");
  assert.deepEqual(arrivalsOf({ plan, segments, words, stamps: [], clean: true, sting: false }), without);
});

test("an arm recorded by an earlier render goes when its test is off", () => {
  const { plan } = short();
  const fx = JSON.parse(
    fs.readFileSync(new URL("./fixtures/plan_open_04s.json", import.meta.url), "utf8"),
  ) as { shots: Shot[] };
  const assets: { shortShape?: unknown; shortSoundArm?: "sparse" | "v3" } = {
    shortShape: { arm: "on", open: "lower", close: "hold" },
    shortSoundArm: "sparse",
  };
  shapeShort({
    cfg: { shortLayouts: false, shortLayoutsShare: 1, shortFirstShotMinSeconds: 0, shortFirstShotShare: 1 },
    id: "ep_stale",
    plan: { fps: FPS, shots: fx.shots.map((x) => ({ ...x })) },
    clean: true,
    rumour: false,
    headline: "GTA 6 slips",
    memory: undefined,
    assets,
  });
  assert.equal(assets.shortShape, undefined);
  const v3 = plan.sfx;
  const stored: RenderPlan = { ...plan, sfx: [{ file: "sfx/v3/air-1.mp3", frame: 300, volume: 0.2 }], soundPlan: "sparse", silences: [{ from: 900, to: 930 }] };
  const cfg = { shortSoundPlan: "v3" as const, shortSoundSparseShare: 1 };
  assert.equal(soundStepDue(cfg, stored), true, "a stored sparse plan still runs the step");
  assert.equal(restoreV3Sound({ cfg, id: "ep_stale", plan: stored, assets, v3: () => v3 }), true);
  assert.deepEqual(stored.sfx, v3);
  assert.equal(stored.soundPlan, undefined);
  assert.equal(stored.silences, undefined);
  assert.equal(assets.shortSoundArm, undefined);
  assert.equal(soundStepDue(cfg, stored), false, "and then it is an ordinary v3 plan");
  // Still on the sparse side: left for the sound step.
  const keep: RenderPlan = { ...plan, soundPlan: "sparse" };
  assert.equal(
    restoreV3Sound({ cfg: { shortSoundPlan: "sparse", shortSoundSparseShare: 1 }, id: "ep_stale", plan: keep, assets, v3: () => v3 }),
    false,
  );
  assert.equal(keep.soundPlan, "sparse");
});

test("the first shot is never held across a code scene", () => {
  const fx = JSON.parse(
    fs.readFileSync(new URL("./fixtures/plan_open_04s.json", import.meta.url), "utf8"),
  ) as { shots: Shot[] };
  const scene: Shot[] = [fx.shots[0]!, { ...fx.shots[1]!, media: { type: "scene", index: 0 } }, ...fx.shots.slice(2)];
  assert.equal(holdFirstShot(scene), scene);
  const opening: Shot[] = [{ ...fx.shots[0]!, media: { type: "scene", index: 0 } }, ...fx.shots.slice(1)];
  assert.equal(holdFirstShot(opening), opening);
});
