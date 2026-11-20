import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import {
  SHORT_MAP_MIN,
  SHORT_MAP_PIN_FRAME,
  SHORT_WIPE_FRAMES,
  blenderLeadOk,
  blenderWaitVerdict,
  lookTitleAt,
  placeShortMap,
  shortBlenderBeats,
  shortCompareWipe,
  shortDepthTypes,
  shortMapFrame,
  shortOrbit,
  shortTypeable,
} from "../src/render/shortupgrades.ts";
import {
  shortBlenderRequests,
  shortBlenderStep,
  shortMapCandidates,
  shortUpgradesFor,
  shortUpgradesOn,
} from "../src/shortupgradestep.ts";
import {
  closeShot,
  pinWorld,
  project,
  TALL_PIN_BOX,
  FLY_TO,
} from "../src/render/gamemap.ts";
import {
  gameMapFor,
  gameMapGraphic,
  placesIn,
} from "../src/assets/gamemaps.ts";
import { safeParams, sceneSize } from "../src/render/blenderserve.ts";
import { blenderKey } from "../src/render/blender.ts";
import { shortUpgradeUrls } from "../src/render/render.ts";
import type { Segment } from "../src/render/timeline.ts";
import { testConfig, tmpDir } from "./helpers.ts";

const FPS = 30;

/** Words spread evenly over each segment's text. */
function wordsOf(segments: Segment[]) {
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

const ranking = (n = 5): Segment[] => {
  const out: Segment[] = [
    {
      kind: "hook",
      text: "The five best open worlds ever made.",
      start: 0,
      end: 3,
    },
  ];
  for (let r = n; r >= 1; r--) {
    const start = 3 + (n - r) * 7;
    out.push({
      kind: "beat",
      text: `Number ${r}: Game ${r} is bigger than you think.`,
      start,
      end: start + 7,
      visual: {
        kind: "rank",
        primary: `Game ${r}`,
        secondary: "Huge",
        value_a: r,
        items: ["2020", "PS5"],
      },
    });
  }
  out.push({
    kind: "loop",
    text: "Which one did you play first?",
    start: 3 + n * 7,
    end: 3 + n * 7 + 3,
  });
  return out;
};

test("switches: each Short device on by default, and only with its long-video switch", () => {
  const cfg = loadConfig();
  assert.deepEqual(
    Object.values(cfg.shortUpgrades).filter((v) => typeof v === "boolean"),
    [true, true, true, true, true, true, true],
  );
  assert.equal(cfg.shortUpgrades.blenderWaitMinutes, 25);
  const base = testConfig("/tmp/x");
  assert.deepEqual(
    Object.values(shortUpgradesOn(base)).filter(Boolean),
    [],
    "long switches off: nothing in Shorts",
  );
  const on = testConfig("/tmp/x", {
    mapPins: true,
    gameLook: true,
    box3d: true,
    depthType: true,
    compareWipe: true,
    depthOrbit: true,
    parallaxDeep: true,
    blender: { ...base.blender, on: true },
  });
  assert.ok(Object.values(shortUpgradesOn(on)).every(Boolean));
  const off = {
    ...on,
    shortUpgrades: { ...on.shortUpgrades, mapPins: false, depthOrbit: false },
  };
  assert.equal(shortUpgradesOn(off).maps, false);
  assert.equal(shortUpgradesOn(off).orbit, false);
  assert.equal(
    shortUpgradesOn({ ...on, parallaxDeep: false }).orbit,
    false,
    "the orbit needs the depth camera's maps",
  );
});

test("map pace: the Short's camera dives quicker, then runs in real time", () => {
  assert.equal(shortMapFrame(0), 0);
  assert.ok(
    Math.abs(shortMapFrame(SHORT_MAP_PIN_FRAME) - (FLY_TO - 10)) < 1.5,
    "the pin's long-video frame at its Short frame",
  );
  assert.equal(
    shortMapFrame(SHORT_MAP_PIN_FRAME + 30) -
      shortMapFrame(SHORT_MAP_PIN_FRAME),
    30,
  );
  assert.ok(SHORT_MAP_PIN_FRAME <= 30, "the pin lands within a second");
});

test("map placement: the pin lands on the place's word, never in the hook, never over another overlay", () => {
  const base = {
    segStart: 300,
    segEnd: 450,
    hookEnd: 90,
    loopFrom: 900,
    fps: FPS,
    taken: [],
  };
  const a = placeShortMap({ ...base, wordAt: 12 })!;
  assert.equal(a.from + SHORT_MAP_PIN_FRAME, 360);
  assert.ok(a.len >= SHORT_MAP_MIN && a.len <= 150);
  // Inside the hook: it waits for the hook to end (and the line still has time).
  assert.equal(
    placeShortMap({ ...base, segStart: 0, segEnd: 300, wordAt: 1 })!.from,
    90,
  );
  // A word moment holding the word: left out rather than late.
  assert.equal(
    placeShortMap({
      ...base,
      wordAt: 12,
      taken: [{ kind: "stamp", from: 320, to: 400 }],
    }),
    undefined,
  );
  // The shelf steps back under a full-frame device, so it never blocks.
  assert.ok(
    placeShortMap({
      ...base,
      wordAt: 12,
      taken: [{ kind: "shelf", from: 300, to: 500 }],
    }),
  );
  // Too little room before the next overlay: not shown.
  assert.equal(
    placeShortMap({
      ...base,
      wordAt: 12,
      taken: [{ kind: "mention", from: 400, to: 480 }],
    }),
    undefined,
  );
  // Never into the loop's return to frame 0.
  assert.equal(
    placeShortMap({ ...base, wordAt: 12, loopFrom: 380 }),
    undefined,
  );
});

test("map framing: in a tall frame every pin stands in the hero band, clear of the captions and the rail", () => {
  const t = gameMapFor("GTA 6")!;
  const checked = t.places.filter((p) => p.checked);
  for (const set of [
    [checked[0]!],
    [checked[1]!, checked[5]!],
    checked.slice(2, 5),
  ]) {
    const g = gameMapGraphic(t, "GTA 6", set);
    const pins = g.pins.map((p) => pinWorld(p, g.width, g.height));
    const shot = closeShot(pins, g.height, 1080 / 1920, 1920);
    for (const p of pins) {
      const q = project(p, shot, 1080, 1920);
      assert.ok(
        q.x >= 1080 * TALL_PIN_BOX.left - 1 &&
          q.x <= 1080 * TALL_PIN_BOX.right + 1,
        `x ${q.x}`,
      );
      assert.ok(
        q.y >= 1920 * TALL_PIN_BOX.top - 1 &&
          q.y <= 1920 * TALL_PIN_BOX.bottom + 1,
        `y ${q.y}`,
      );
      assert.ok(q.y < 1180, "above the captions");
    }
  }
  // The landscape shot is unchanged by the tall-frame work.
  const g = gameMapGraphic(t, "GTA 6", [checked[0]!]);
  const pins = g.pins.map((p) => pinWorld(p, g.width, g.height));
  assert.deepEqual(closeShot(pins, g.height).target, [
    pins[0]![0],
    0,
    pins[0]![2] - 0.15,
  ]);
});

test("map candidates: a line naming a checked place in the Short's game, with when it is said", () => {
  const segments: Segment[] = [
    { kind: "hook", text: "GTA 6 has a secret swamp.", start: 0, end: 3 },
    {
      kind: "beat",
      text: "Grassrivers is where the airboats live.",
      start: 3,
      end: 8,
    },
    { kind: "beat", text: "Nothing to see here at all.", start: 8, end: 12 },
  ];
  const words = wordsOf(segments);
  const got = shortMapCandidates({
    segments,
    words,
    game: "Grand Theft Auto VI",
  });
  assert.equal(got.length, 1);
  assert.equal(got[0]!.segment, 1);
  assert.equal(got[0]!.wordAt, 3);
  assert.deepEqual(got[0]!.graphic.items, ["Grassrivers"]);
  assert.equal(
    shortMapCandidates({ segments, words, game: "Some Other Game" }).length,
    0,
  );
  // A line with its own explainer keeps it.
  segments[1]!.explainer = { kind: "flow" } as never;
  assert.equal(
    shortMapCandidates({ segments, words, game: "GTA 6" }).length,
    0,
  );
  assert.deepEqual(
    placesIn("Grassrivers", gameMapFor("GTA 6")!).map((p) => p.name),
    ["Grassrivers"],
  );
});

test("look: a ranking's cards wear each entry's game, everything else the Short's game", () => {
  const segs = ranking(3);
  segs.splice(2, 0, {
    kind: "beat",
    text: "And it still holds up.",
    start: 6,
    end: 7,
  });
  assert.equal(lookTitleAt(segs, 0, "Main"), "Main");
  assert.equal(lookTitleAt(segs, 1, "Main"), "Game 3");
  assert.equal(
    lookTitleAt(segs, 2, "Main"),
    "Game 3",
    "a line after a rank card belongs to its entry",
  );
  assert.equal(lookTitleAt(segs, 3, "Main"), "Game 2");
});

test("Blender: only a ranking's number one gets the vertical podium, and only with a slot that leaves time", () => {
  const segs = ranking(5);
  const beats = shortBlenderBeats(segs);
  assert.equal(beats.length, 1);
  assert.equal(beats[0]!.params.rank, 1);
  assert.equal(beats[0]!.params.vertical, true);
  assert.equal(beats[0]!.params.kicker, "Number 1 of 5");
  assert.equal(beats[0]!.params.meta, "2020 | PS5");
  assert.equal(
    shortBlenderBeats(ranking(2)).length,
    0,
    "too short a list for a podium",
  );
  const dated = ranking(4).map((s) =>
    s.visual?.value_a === 1
      ? { ...s, visual: { ...s.visual, date_to: "2027-01-01" } }
      : s,
  );
  assert.equal(
    shortBlenderBeats(dated).length,
    0,
    "a release-date list wears dates, not ranks",
  );
  // The vertical clip has its own cache name.
  const [r] = shortBlenderRequests(segs);
  const { vertical: _v, ...landscape } = r!.params;
  assert.notEqual(
    r!.key,
    blenderKey("podium", { ...landscape, images: [] }, r!.seconds),
  );
  assert.equal(
    shortBlenderRequests(segs)[0]!.key,
    r!.key,
    "the same key on every retry",
  );

  const now = Date.parse("2026-11-20T10:00:00Z");
  assert.equal(
    blenderLeadOk({ now, waitMinutes: 25, marginMinutes: 45 }),
    false,
    "a news Short (no slot) never waits",
  );
  assert.equal(
    blenderLeadOk({
      now,
      slotAt: now + 30 * 60_000,
      waitMinutes: 25,
      marginMinutes: 45,
    }),
    false,
  );
  assert.equal(
    blenderLeadOk({
      now,
      slotAt: now + 3 * 3_600_000,
      waitMinutes: 25,
      marginMinutes: 45,
    }),
    true,
  );
  const slot = now + 3 * 3_600_000;
  const w = blenderWaitVerdict({
    now,
    slotAt: slot,
    pending: 1,
    waitMinutes: 25,
    marginMinutes: 45,
  });
  assert.deepEqual(w, { verdict: "wait", retryAt: now + 3 * 60_000 });
  assert.equal(
    blenderWaitVerdict({
      now,
      slotAt: slot,
      askedAt: now - 26 * 60_000,
      pending: 1,
      waitMinutes: 25,
      marginMinutes: 45,
    }).verdict,
    "render",
  );
  assert.equal(
    blenderWaitVerdict({
      now,
      slotAt: now + 40 * 60_000,
      pending: 1,
      waitMinutes: 25,
      marginMinutes: 45,
    }).verdict,
    "render",
  );
  assert.equal(
    blenderWaitVerdict({
      now,
      slotAt: slot,
      pending: 0,
      waitMinutes: 25,
      marginMinutes: 45,
    }).verdict,
    "render",
  );
});

test("the 3D service: vertical only as true and only for scenes with an upright layout", () => {
  assert.deepEqual(
    safeParams("podium", { rank: 1, vertical: true, width: 4000 }),
    { rank: 1, vertical: true },
  );
  assert.deepEqual(safeParams("data", { mode: "bars", vertical: true }), {
    mode: "bars",
  });
  assert.deepEqual(safeParams("podium", { rank: 1, vertical: "yes" }), {
    rank: 1,
  });
  assert.deepEqual(sceneSize({ vertical: true }), {
    width: 1080,
    height: 1920,
  });
  assert.deepEqual(sceneSize({}), {});
});

test("Blender step: waits with a slot, renders without, and drops a clip that is not upright", async () => {
  const dir = await tmpDir();
  const cfg = testConfig(dir, {
    blender: {
      on: true,
      share: 1,
      capMinutes: 15,
      url: "http://x",
      waitMinutes: 8,
    },
  });
  const segs = ranking(5);
  const now = new Date("2026-11-20T10:00:00Z");
  let asked = 0;
  const none = async () => {
    asked++;
    return [];
  };
  const probe = async () => ({ width: 1080, height: 1920 });
  const wait = await shortBlenderStep({
    cfg,
    episodeDir: dir,
    segments: segs,
    now,
    slotAt: "2026-11-20T14:00:00Z",
    probe,
    fetchClips: none,
  });
  assert.equal(wait.verdict, "wait");
  const news = await shortBlenderStep({
    cfg,
    episodeDir: dir,
    segments: segs,
    now,
    slotAt: null,
    probe,
    fetchClips: none,
  });
  assert.deepEqual(news, { verdict: "render", clips: [], asked: 0 });
  assert.equal(asked, 1, "no slot: nothing asked of the 3D queue");
  const [r] = shortBlenderRequests(segs);
  const file = `assets/blender/${r!.key}.mp4`;
  await fs.mkdir(path.join(dir, "assets", "blender"), { recursive: true });
  await fs.writeFile(path.join(dir, file), Buffer.alloc(20_000));
  const back = async () => [
    {
      file,
      at: r!.at,
      seconds: r!.seconds,
      role: "rank" as const,
      segment: r!.segment,
    },
  ];
  const done = await shortBlenderStep({
    cfg,
    episodeDir: dir,
    segments: segs,
    now,
    slotAt: null,
    probe,
    fetchClips: back,
  });
  assert.equal(done.verdict, "render");
  assert.deepEqual(
    done.verdict === "render" && done.clips.map((c) => [c.from, c.len, c.file]),
    [[Math.round(r!.at * FPS), 90, file]],
  );
  const wide = await shortBlenderStep({
    cfg,
    episodeDir: dir,
    segments: segs,
    now,
    slotAt: null,
    probe: async () => ({ width: 1920, height: 1080 }),
    fetchClips: back,
  });
  assert.deepEqual(
    wide.verdict === "render" && wide.clips,
    [],
    "a landscape clip never fills a Short",
  );
});

test("depth type: a short word moment on a wide layered still after the hook, over its whole shot", () => {
  const layers = { bg: "b", mid: "m", fg: "f" };
  const images = [
    { kind: "screenshot", aspect: 1.78, layers },
    { kind: "screenshot", aspect: 1.78 },
    { kind: "capsule", aspect: 0.67, layers },
  ];
  const shots = [
    { start: 0, end: 90, media: { type: "clip", index: 0 } },
    { start: 90, end: 240, media: { type: "image", index: 0 } },
    { start: 240, end: 400, media: { type: "image", index: 1 } },
  ];
  const base = { shots, images, fps: FPS, hookEnd: 90, loopFrom: 900 };
  const d = shortDepthTypes({ ...base, stamps: [{ at: 4, text: "DELAYED" }] });
  assert.deepEqual(
    d.map((x) => [x.from, x.len, x.phrase, x.at, x.stamp]),
    [[90, 150, "DELAYED", 30, 0]],
  );
  assert.equal(
    shortDepthTypes({
      ...base,
      stamps: [{ at: 4, text: "DELAYED", sub: "to 2027" }],
    }).length,
    0,
    "a second line keeps the stamp",
  );
  assert.equal(
    shortDepthTypes({ ...base, stamps: [{ at: 9, text: "DELAYED" }] }).length,
    0,
    "no layers: the stamp",
  );
  assert.equal(
    shortDepthTypes({ ...base, stamps: [{ at: 7.5, text: "DELAYED" }] }).length,
    0,
    "under 2 s left in the shot",
  );
  assert.equal(shortTypeable("SOLD OUT AGAIN"), undefined);
  assert.equal(shortTypeable("Cancelled!"), "Cancelled");
});

test("orbit: the longest centred meshed still after the hook, once", () => {
  const mesh = { depth: "d", far: "f", farDepth: "fd", pivot: 0.5 };
  const images = [
    {
      kind: "screenshot",
      aspect: 1.78,
      layers: { bg: "", mid: "", fg: "", mesh },
      focusX: 0.5,
    },
    {
      kind: "screenshot",
      aspect: 1.78,
      layers: { bg: "", mid: "", fg: "", mesh },
      focusX: 0.9,
    },
    { kind: "screenshot", aspect: 1.78, layers: { bg: "", mid: "", fg: "" } },
  ];
  const shots = [
    { start: 0, end: 90, media: { type: "image", index: 0 } },
    { start: 90, end: 180, media: { type: "image", index: 0 } },
    { start: 180, end: 400, media: { type: "image", index: 1 } },
    { start: 400, end: 600, media: { type: "image", index: 2 } },
  ];
  const o = shortOrbit({
    shots,
    images,
    fps: FPS,
    hookEnd: 90,
    loopFrom: 900,
  })!;
  assert.deepEqual(
    [o.from, o.len, o.image],
    [90, 90, 0],
    "off-centre subject and unmeshed still are passed over",
  );
  assert.equal(
    shortOrbit({
      shots,
      images,
      fps: FPS,
      hookEnd: 90,
      loopFrom: 900,
      blocked: new Set([90]),
    }),
    undefined,
  );
});

test("compare wipe: a ranking line comparing two entries' games, by name, clear of other overlays", () => {
  const segs = ranking(3);
  segs[2] = {
    ...segs[2]!,
    text: "It is twice the size of Game 3 and better looking.",
  };
  const words = wordsOf(segs);
  const images = [
    { kind: "screenshot", aspect: 1.78, beatIndex: 0 },
    { kind: "screenshot", aspect: 1.78, beatIndex: 1 },
  ];
  const base = {
    segments: segs,
    words,
    images,
    fps: FPS,
    hookEnd: 90,
    loopFrom: 900,
  };
  // No comparison cue ("than"): nothing.
  assert.equal(shortCompareWipe({ ...base, taken: [] }), undefined);
  segs[2] = {
    ...segs[2]!,
    text: "It is bigger than Game 3 and better looking.",
  };
  const w2 = wordsOf(segs);
  const w = shortCompareWipe({
    ...base,
    words: w2,
    taken: [{ kind: "entry", from: 0, to: 900 }],
  })!;
  assert.ok(w, "the entry's own card stays over the wipe");
  assert.equal(w.len, SHORT_WIPE_FRAMES);
  assert.deepEqual(
    [w.left, w.right, w.leftGame, w.rightGame],
    [1, 0, "Game 2", "Game 3"],
  );
  const at = w2.find(
    (x, k) =>
      x.text === "Game" && w2[k + 1]?.text === "3" && x.start >= segs[2]!.start,
  )!;
  assert.equal(w.from, Math.round(at.start * FPS) - 4);
  assert.equal(
    shortCompareWipe({
      ...base,
      words: w2,
      taken: [{ kind: "stamp", from: w.from + 10, to: w.from + 40 }],
    }),
    undefined,
  );
});

test("upgrades end to end: the map is staged, replaces its line's card and an in-game place inset; URLs for the render", async () => {
  const dir = await tmpDir();
  const cfg = testConfig(dir, { mapPins: true, gameLook: true, box3d: true });
  const segments: Segment[] = [
    { kind: "hook", text: "GTA 6 has a secret swamp.", start: 0, end: 3 },
    {
      kind: "beat",
      text: "Grassrivers is where the airboats live.",
      start: 3,
      end: 9,
      visual: { kind: "stat", primary: "40", secondary: "airboats" },
    },
    { kind: "loop", text: "Would you go?", start: 9, end: 12 },
  ];
  const words = wordsOf(segments);
  const mention = {
    key: "m1",
    from: 95,
    to: 160,
    m: { kind: "inworld", key: "grassrivers", pictures: [] },
  } as never;
  const staged: string[] = [];
  const res = await shortUpgradesFor({
    cfg,
    episodeDir: dir,
    game: "Grand Theft Auto VI",
    segments,
    words,
    plan: { fps: FPS, totalFrames: 360, shots: [] },
    layout: { hookEnd: 90, loopFrom: 300 },
    images: [],
    stamps: [],
    kept: [
      { key: "hook", kind: "hook", from: 0, to: 90 },
      { key: "card1", kind: "card", from: 100, to: 175 },
      { key: "m1", kind: "mention", from: 95, to: 160 },
    ],
    mentions: [mention],
    blender: [],
    isRumour: false,
    stageMaps: async (moments) => {
      staged.push(moments[0]!.graphic.gameMap!.map);
      return {
        moments: moments.map((m) => ({
          ...m,
          graphic: {
            ...m.graphic,
            gameMap: { ...m.graphic.gameMap!, file: "gamemaps/gta6.jpg" },
          },
        })),
        failed: [],
      };
    },
  });
  assert.deepEqual(staged, ["gta6"]);
  const map = res.upgrades.maps![0]!;
  assert.equal(map.segment, 1);
  assert.equal(map.replacesCard, true);
  assert.equal(map.from, 90, "starts as the hook ends, the pin on the word");
  assert.deepEqual(res.mentions, [], "the place's inset gives way to its map");
  assert.equal(res.upgrades.look, true);
  assert.equal(res.upgrades.box3d, true);
  const urls = shortUpgradeUrls(
    {
      ...res.upgrades,
      blender: [
        {
          key: "b",
          from: 0,
          len: 90,
          role: "rank",
          segment: 1,
          file: "assets/blender/k.mp4",
        },
      ],
    },
    "http://f",
  );
  assert.equal(
    urls.maps![0]!.graphic.gameMap.src,
    "http://f/gamemaps/gta6.jpg",
  );
  assert.equal(urls.blender![0]!.src, "http://f/assets/blender/k.mp4");
  // A rumour keeps Pulse's rumour colour: no look.
  const rumour = await shortUpgradesFor({
    cfg,
    episodeDir: dir,
    game: "x",
    segments,
    words,
    plan: { fps: FPS, totalFrames: 360, shots: [] },
    layout: { hookEnd: 90, loopFrom: 300 },
    images: [],
    stamps: [],
    kept: [],
    mentions: [],
    blender: [],
    isRumour: true,
  });
  assert.equal(rumour.upgrades.look, undefined);
});
