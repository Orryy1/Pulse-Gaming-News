import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { tmpDir } from "./helpers.ts";
import {
  assign,
  blend,
  cosine,
  fromBase64,
  lineQuery,
  lineScores,
  meanVector,
  probability,
  toBase64,
} from "../src/semantic/match.ts";
import { Embedder } from "../src/semantic/embed.ts";
import {
  embedShots,
  loadShotVectors,
  shotKey,
  shotMeaning,
  targetScorer,
  unembedded,
  vectorFile,
} from "../src/semantic/shots.ts";
import {
  freeStills,
  offTopic,
  pinChapterMoments,
  pinShortStills,
} from "../src/semantic/stills.ts";
import { semanticSettings } from "../src/semantic/settings.ts";
import {
  ownStreamProvenance,
  ownStreamClips,
  recordingsOf,
} from "../src/semantic/hook.ts";
import { findShots } from "../src/sceneindex/lookup.ts";
import { planIndexedClips } from "../src/sceneindex/footage.ts";
import { spoilerWindow } from "../src/sceneindex/spoilers.ts";
import type { SceneIndex, SceneShot } from "../src/sceneindex/schema.ts";
import {
  findVodMoments,
  parseTags,
  stretchesOf,
  stretchKey,
  unknownTags,
  tagPrompt,
  taggedSceneIndex,
  tagVodStretches,
  untagged,
  vodMomentHeld,
  vodTagsReady,
  type VodTagFile,
} from "../src/vodindex/tags.ts";
import {
  saveVodIndex,
  vodIndexDir,
  type VodIndex,
} from "../src/vodindex/schema.ts";
import { vodIndexStep } from "../src/vodindex/build.ts";
import type { CutsceneClip } from "../src/assets/cutscenes.ts";

// ---------------------------------------------------------------- a toy model: one axis per idea

const IDEAS = [
  "phone",
  "car",
  "scooter",
  "trunk",
  "beach",
  "controller",
  "night",
  "boat",
];
const unit = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return Float32Array.from(v.map((x) => x / n));
};
/** Words or a file name to a vector: each idea named adds its axis, plus a little shared noise so cosines are not 0. */
const vec = (text: string) =>
  unit(IDEAS.map((w) => (text.toLowerCase().includes(w) ? 1 : 0.02)));

function toyEmbedder(calls = { texts: 0, images: 0 }) {
  return {
    calls,
    async info() {
      return { model: "toy", dim: IDEAS.length, scale: 10, bias: -5 };
    },
    async texts(ts: string[]) {
      calls.texts++;
      return ts.map(vec);
    },
    async images(files: string[]) {
      calls.images++;
      return files.map((f) =>
        path.basename(f).startsWith("unreadable")
          ? undefined
          : vec(path.basename(f)),
      );
    },
    close() {},
  } as unknown as Embedder & { calls: typeof calls };
}

// ---------------------------------------------------------------- match.ts

test("semantic: vectors survive base64, cosines and the sigmoid behave", () => {
  const a = vec("car");
  const back = fromBase64(toBase64(a));
  assert.equal(back.length, a.length);
  assert.ok(Math.abs(cosine(a, back) - 1) < 1e-6);
  assert.ok(cosine(vec("car"), vec("boat")) < 0.1);
  assert.equal(cosine(a, new Float32Array(3)), 0);
  const m = meanVector([vec("car"), vec("scooter")])!;
  assert.ok(cosine(m, vec("car")) > 0.6 && cosine(m, vec("scooter")) > 0.6);
  assert.ok(probability(0.9, { scale: 10, bias: -5 }) > 0.95);
  assert.ok(probability(0, { scale: 10, bias: -5 }) < 0.01);
});

test("semantic: a line's scores are relative to its typical candidate and zero at the floor", () => {
  // A big pool (an index): measured against its own median, SPREAD 0.1 to a full score.
  const pool = [
    ...Array.from({ length: 30 }, (_, k) => 0.02 + k * 0.001),
    0.2,
    -0.01,
  ];
  const s = lineScores(pool);
  assert.equal(s.at(-1), 0, "no likeness at all scores nothing");
  assert.ok(s.at(-2)! > 0.9, "the clear outlier scores high");
  assert.ok(s[15]! < 0.05, "a typical candidate scores about nothing");
  // A small pool (a Short's stills) is measured against the background's typical likeness when there is one.
  assert.deepEqual(
    lineScores([0.05, 0.1, 0.15], { base: 0.05 }).map(
      (x) => Math.round(x * 10) / 10,
    ),
    [0, 0.5, 1],
  );
  // Without one, against its own lower middle.
  assert.deepEqual(
    lineScores([0.05, 0.12]).map((x) => Math.round(x * 10) / 10),
    [0, 0.7],
  );
  assert.deepEqual(lineScores([-0.02, 0, -0.1], { base: -0.5 }), [0, 0, 0]);
  assert.deepEqual(lineScores([]), []);
});

test("semantic: assign pins only clear winners, respects uses, vetoes and lines already served", () => {
  // Line 0 clearly wants candidate 2; line 1 is a near tie between 0 and 1; line 2 wants 2 as well.
  const sims = [
    [0.04, 0.05, 0.3, 0.05, 0.04],
    [0.2, 0.2, 0.04, 0.04, 0.04],
    [0.04, 0.05, 0.28, 0.05, 0.12],
  ];
  const got = assign(sims, { minScore: 0.5, margin: 0.1, uses: () => 1 });
  assert.deepEqual(
    got.map((p) => [p.line, p.candidate]),
    [
      [0, 2],
      [2, 4],
    ],
    "the tie is left alone; line 2 takes its next clear choice once 2 is used",
  );
  const vetoed = assign(sims, {
    minScore: 0.5,
    margin: 0.1,
    allowed: (_l, c) => c !== 2,
  });
  assert.ok(vetoed.every((p) => p.candidate !== 2));
  const taken = assign(sims, {
    minScore: 0.5,
    margin: 0.1,
    taken: new Set([0]),
  });
  assert.ok(taken.every((p) => p.line !== 0));
  assert.equal(assign(sims, { minScore: 1.01 }).length, 0);
});

test("semantic: blend and the line query", () => {
  assert.equal(blend(0.7, undefined), 0.7, "no vector: the words alone");
  assert.ok(blend(1, 0) < 0.5, "a name match the picture does not show sinks");
  assert.ok(
    blend(0, 1) > 0.5,
    "a picture the words missed can still be offered",
  );
  assert.deepEqual(lineQuery("  A car   arrives. ", "car, driver"), [
    "A car arrives.",
    "car, driver",
  ]);
  assert.deepEqual(lineQuery("Same", "same"), ["Same"]);
  assert.deepEqual(lineQuery("Only the line"), ["Only the line"]);
});

test("semantic: settings default to off for matching and on for stream tags", () => {
  const d = semanticSettings({}, () => false);
  assert.equal(d.enabled, false);
  assert.equal(d.vodTags, true);
  assert.equal(d.model, "google/siglip2-base-patch16-224");
  assert.equal(d.priority, 60);
  const on = semanticSettings(
    {
      MATCH_SEMANTIC: "true",
      VOD_TAGS: "false",
      SEMANTIC_PRIORITY: "20",
      SEMANTIC_MIN_SCORE: "9",
    },
    () => false,
  );
  assert.equal(on.enabled, true);
  assert.equal(on.vodTags, false);
  assert.equal(on.priority, 20);
  assert.equal(on.minScore, 1, "clamped");
});

// ---------------------------------------------------------------- the scene index lookup

const shot = (
  id: number,
  start: number,
  desc: string,
  extra: Partial<SceneShot> = {},
): SceneShot => ({
  id,
  start,
  end: start + 4,
  keyframes: [start + 1],
  desc,
  who: [],
  where: "",
  mood: "",
  tags: [],
  text: "",
  luma: 120,
  motion: 20,
  ...extra,
});

const sceneIndex = (shots: SceneShot[]): SceneIndex => ({
  version: 1,
  game: "Grand Theft Auto VI",
  slug: "grand-theft-auto-vi",
  source: {
    videoId: "vid",
    title: "t",
    uploader: "u",
    duration: 1000,
    kind: "movie",
    pickedAt: "",
  },
  builtAt: "",
  coverage: [{ from: 0, to: 1000 }],
  cast: ["Lucia"],
  places: ["Vice City"],
  shots,
  lines: [],
});

test("semantic: findShots blends meaning into the word score", () => {
  const index = sceneIndex([
    shot(0, 0, "A man holds a phone in Vice City."),
    shot(1, 20, "A driver steps off a scooter beside a parked car."),
    shot(2, 40, "A black screen.", { blank: true }),
  ]);
  const target = {
    text: "A driver arrives within seconds, then leaves on a scooter in Vice City",
  };
  const words = findShots(index, target, { minConfidence: 0 });
  // The meaning model is sure shot 1 is the line and shot 0 is not.
  const semantic = new Map([
    [0, 0],
    [1, 1],
    [2, 1],
  ]);
  const both = findShots(index, target, { minConfidence: 0, semantic });
  assert.equal(both[0]!.shot, 1);
  assert.equal(both[0]!.meaning, 1);
  assert.ok(
    both.every((h) => h.shot !== 2),
    "a blank shot is never returned, whatever its meaning",
  );
  assert.ok(words.length >= 1);
  // A shot no word matches is still offered on meaning alone.
  const only = findShots(
    index,
    { text: "zzz qqq" },
    { minConfidence: 0.3, semantic: new Map([[1, 0.9]]) },
  );
  assert.deepEqual(
    only.map((h) => h.shot),
    [1],
  );
  // Without the map the lookup is exactly as before.
  assert.deepEqual(
    findShots(index, target, { minConfidence: 0 }).map((h) => [
      h.shot,
      h.score,
    ]),
    words.map((h) => [h.shot, h.score]),
  );
});

test("semantic: planIndexedClips asks the scorer per line and keeps the spoiler veto", () => {
  const index = sceneIndex([
    shot(0, 0, "A woman walks on a beach."),
    shot(1, 20, "A speedboat crosses the bay at night."),
  ]);
  const targets = [
    {
      key: "beat:0",
      text: "Out on the water after dark",
      want: "gameplay" as const,
      energy: "medium" as const,
      keywords: [],
    },
  ];
  const asked: string[] = [];
  const plan = planIndexedClips(index, targets, {
    maxClips: 2,
    maxSeconds: 10,
    minConfidence: 0.3,
    semantic: (t) => {
      asked.push(t.key);
      return new Map([
        [0, 0.1],
        [1, 0.95],
      ]);
    },
  });
  assert.deepEqual(asked, ["beat:0"]);
  assert.equal(plan[0]?.shot, 1);
  const vetoed = planIndexedClips(index, targets, {
    maxClips: 2,
    maxSeconds: 10,
    minConfidence: 0.3,
    allow: (s) => s.id !== 1,
    semantic: () => new Map([[1, 0.95]]),
  });
  assert.ok(
    vetoed.every((c) => c.shot !== 1),
    "the spoiler guard still decides",
  );
});

// ---------------------------------------------------------------- the embedder process and its cache

const FAKE_WORKER = `
const rl = require("node:readline").createInterface({ input: process.stdin });
const v = (n) => { const b = Buffer.alloc(16); [n, 1, 0, 0].forEach((x, i) => b.writeFloatLE(x, i * 4)); return b.toString("base64"); };
console.log(JSON.stringify({ id: 0, ready: true, model: "fake", device: "cpu", dim: 4, scale: 10, bias: -5 }));
rl.on("line", (line) => {
  const r = JSON.parse(line);
  if (r.op === "image") console.log(JSON.stringify({ id: r.id, vectors: r.files.map((f) => (f.includes("bad") ? null : v(f.length))) }));
  else if (r.op === "text") console.log(JSON.stringify({ id: r.id, vectors: r.texts.map((t) => v(t.length)) }));
});
`;

test("semantic: the embedder asks its process once and answers again from the cache", async () => {
  const dir = await tmpDir();
  const script = path.join(dir, "worker.cjs");
  await fs.writeFile(script, FAKE_WORKER);
  let spawned = 0;
  const make = () =>
    new Embedder({
      python: "unused",
      model: "fake/model",
      cacheDir: path.join(dir, "cache"),
      idleSeconds: 5,
      lease: async () => () => undefined,
      spawnWorker: () => {
        spawned++;
        return spawn(process.execPath, [script], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      },
    });
  const a = path.join(dir, "a.jpg");
  const bad = path.join(dir, "bad.jpg");
  await fs.writeFile(a, "picture a");
  await fs.writeFile(bad, "picture bad");
  const e1 = make();
  try {
    const got = await e1.images([a, bad, path.join(dir, "missing.jpg")]);
    assert.ok(got[0] instanceof Float32Array);
    assert.equal(
      got[1],
      undefined,
      "an unreadable picture answers undefined in its place",
    );
    assert.equal(
      got[2],
      undefined,
      "a missing file has no key and is never asked",
    );
    const t = await e1.texts(["hello", "a longer line"]);
    assert.equal(t?.length, 2);
    assert.equal((await e1.info())?.dim, 4);
  } finally {
    e1.close();
  }
  assert.equal(spawned, 1);
  // A new client in a new run: everything comes from the cache, the process is never started.
  const e2 = make();
  try {
    const again = await e2.images([a]);
    assert.ok(again[0] instanceof Float32Array);
    assert.ok((await e2.texts(["hello"]))?.[0] instanceof Float32Array);
  } finally {
    e2.close();
  }
  assert.equal(spawned, 1, "cached answers start no process");
});

test("semantic: an embedder whose model cannot start answers undefined and never throws", async () => {
  const dir = await tmpDir();
  const e = new Embedder({
    python: path.join(dir, "no-such-python"),
    model: "none/none",
    cacheDir: path.join(dir, "cache"),
    lease: async () => () => undefined,
  });
  try {
    assert.equal(await e.texts(["x"]), undefined);
    assert.deepEqual(await e.images([path.join(dir, "a.jpg")]), [undefined]);
  } finally {
    e.close();
  }
});

// ---------------------------------------------------------------- shot vectors

test("semantic: shot vectors are made once per shot and kept beside the index", async () => {
  const dir = await tmpDir();
  const shots = [
    shot(0, 0, ""),
    shot(1, 10, "", { blank: true }),
    shot(2, 20, "", { menu: true }),
    shot(3, 30, ""),
  ];
  const file = vectorFile(dir, "google/siglip2-base-patch16-224");
  assert.match(
    path.basename(file),
    /^semantic\.google-siglip2-base-patch16-224\.json$/,
  );
  const grabbed: number[] = [];
  const grab = async (_v: string, at: number, f: string) => {
    grabbed.push(at);
    await fs.writeFile(f, at < 15 ? "car" : "boat");
  };
  const emb = {
    async images(files: string[]) {
      return Promise.all(
        files.map(async (f) => vec(await fs.readFile(f, "utf8"))),
      );
    },
  } as unknown as Embedder;
  const r = await embedShots({
    shots,
    video: "proxy.mp4",
    vectorsFile: file,
    embedder: emb,
    model: "m",
    work: dir,
    grab,
  });
  assert.deepEqual(r, { added: 2, total: 2, left: 0 });
  assert.deepEqual(
    grabbed,
    [2, 32],
    "the middle of each clean shot; blank and menu shots never",
  );
  const vecs = await loadShotVectors(file);
  assert.ok(vecs.has(shotKey(shots[0]!)));
  assert.equal(unembedded(shots, vecs).length, 0);
  const again = await embedShots({
    shots,
    video: "proxy.mp4",
    vectorsFile: file,
    embedder: emb,
    model: "m",
    work: dir,
    grab,
  });
  assert.equal(again.added, 0);
  assert.equal(grabbed.length, 2, "nothing cut twice");
  const meaning = shotMeaning(shots, vecs, vec("a boat"));
  assert.ok(meaning.get(3)! > meaning.get(0)!);
  assert.equal(meaning.has(1), false);
  const scorer = await targetScorer(toyEmbedder(), shots, vecs, [
    { key: "beat:0", text: "a car", keywords: [] },
  ]);
  assert.ok(
    scorer!({ key: "beat:0" })!.get(0)! > scorer!({ key: "beat:0" })!.get(3)!,
  );
  assert.equal(
    await targetScorer(toyEmbedder(), shots, new Map(), [
      { key: "x", text: "y" },
    ]),
    undefined,
    "no vectors: words alone",
  );
});

// ---------------------------------------------------------------- stills

test("semantic: a Short's untagged stills are pinned to the beat they clearly show", async () => {
  const images = [
    { file: "press_controller.jpg", kind: "article" },
    { file: "igdb_phone_app.jpg", kind: "screenshot" },
    { file: "igdb_scooter_car.jpg", kind: "screenshot" },
    { file: "box_cover.jpg", kind: "capsule" },
    { file: "trunk_tagged.jpg", kind: "screenshot", beatIndex: 2 },
  ] as Array<{ file: string; kind: string; beatIndex?: number }>;
  assert.deepEqual(freeStills(images), [0, 1, 2]);
  assert.deepEqual(
    freeStills(images, 1),
    [0, 2],
    "the hero stays free for the opening",
  );
  const { pins, offTopic: off } = await pinShortStills(
    toyEmbedder(),
    "/ep",
    images,
    [
      { text: "A handy phone app brings it to you", note: "ui, phone" },
      {
        text: "Then they leave on a scooter they brought along",
        note: "vehicle, scooter",
      },
      { text: "Your weapons are stored in the trunk", note: "trunk" },
    ],
    { minScore: 0.5, margin: 0.1 },
  );
  assert.deepEqual(
    pins.map((p) => [p.image, p.beat]),
    [
      [1, 0],
      [2, 1],
    ],
  );
  assert.equal(
    images[0]!.beatIndex,
    undefined,
    "the controller shows no line: it stays in turn",
  );
  assert.equal(
    images[4]!.beatIndex,
    2,
    "a still another rule tagged is never moved",
  );
  assert.deepEqual(off, [], "without a background nothing is called off topic");
});

test("semantic: a still clearly under every line's typical picture is off topic", () => {
  // Two lines, three stills; the background says a typical picture scores 0.06 and 0.08 for them.
  const sims = [
    [0.07, 0.01, 0.05],
    [0.09, -0.02, 0.06],
  ];
  assert.deepEqual(offTopic(sims, [0.06, 0.08]), [1]);
  assert.deepEqual(
    offTopic(sims, [undefined, undefined]),
    [],
    "no background: nothing judged",
  );
  assert.deepEqual(offTopic(sims, [0.06, 0.08], 0.2), []);
});

test("semantic: a long chapter's own unpinned pictures are pinned to the bare sentences they show", async () => {
  const images = [
    { file: "a_beach.jpg", kind: "screenshot", beatIndex: 0 },
    { file: "b_boat.jpg", kind: "screenshot", beatIndex: 0 },
    { file: "c_phone.jpg", kind: "screenshot", beatIndex: 1 },
    { file: "d_car.jpg", kind: "screenshot", beatIndex: 0, moment: 0 },
  ] as Array<{
    file: string;
    kind: string;
    beatIndex?: number;
    moment?: number;
  }>;
  const pins = await pinChapterMoments(
    toyEmbedder(),
    "/ep",
    "/ep/work",
    {
      entry: 0,
      moments: [{ show: "car" }, { show: "boat" }, { show: "beach" }],
      sentences: ["A car.", "Out on a boat at night.", "The beach at dawn."],
    },
    [1, 2],
    images,
    [],
    { minScore: 0.5, margin: 0.1 },
  );
  assert.deepEqual(pins.map((p) => p.line).sort(), [1, 2]);
  assert.equal(images[1]!.moment, 1);
  assert.equal(images[0]!.moment, 2);
  assert.equal(
    images[2]!.moment,
    undefined,
    "another chapter's picture is never borrowed",
  );
  assert.equal(images[3]!.moment, 0, "a pinned picture keeps its sentence");
});

// ---------------------------------------------------------------- stream tags

const vodShot = (
  id: number,
  start: number,
  end: number,
  desc: string,
  extra: Partial<SceneShot> = {},
): SceneShot => ({
  ...shot(id, start, desc, extra),
  end,
});

function vod(dataDir: string): VodIndex {
  return {
    version: 1,
    vodId: "v1",
    file: path.join(dataDir, "2026-11-21 GTA 6 [v1].mp4"),
    title: "GTA 6 | Return to Vice City",
    game: "Grand Theft Auto VI",
    recordedOn: "2026-11-21",
    duration: 120,
    builtAt: "2026-11-21T20:00:00Z",
    coverage: [{ from: 0, to: 120 }],
    shots: [
      vodShot(0, 0, 10, "The player drives a red car along a beach road."),
      vodShot(1, 10, 20, "The car stops beside a scooter outside a shop."),
      vodShot(2, 20, 30, "A loading screen.", { menu: true }),
      vodShot(3, 30, 42, "Two characters talk in a dim office."),
      vodShot(4, 42, 50, "The player walks out of the office."),
    ],
    lines: [
      {
        id: 0,
        start: 31,
        end: 34,
        text: "We do this job tonight.",
        via: "voice",
        shot: 3,
      },
    ],
  };
}

test("stream tags: stretches, the question and the answer", () => {
  const v = vod("/d");
  const spans = stretchesOf(v.shots);
  assert.deepEqual(
    spans.map((s) => s.shots),
    [
      [0, 1],
      [3, 4],
    ],
    "a menu shot ends a stretch and is never in one",
  );
  assert.deepEqual(
    stretchesOf(v.shots, 15).map((s) => s.shots),
    [[0], [1], [3], [4]],
  );
  const q = tagPrompt({
    game: "Grand Theft Auto VI",
    places: ["Vice Beach", "Little Havana"],
    seen: ["a car"],
    text: "VICE BEACH",
    said: "",
  });
  assert.match(q, /Vice Beach, Little Havana/);
  assert.match(q, /Writing read on screen: VICE BEACH/);
  assert.doesNotMatch(q, /Heard:/);
  const t = parseTags(
    {
      place: "vice beach",
      activity: "driving along the coast",
      vehicle: "none",
      brands: ["Scooter Bros", "", "n/a"],
      time_of_day: "dusk",
      story: false,
      menu: false,
      words: ["Palm", "x", "sunset"],
    },
    { from: 0, to: 20 },
    ["Vice Beach"],
  )!;
  assert.equal(t.place, "Vice Beach", "the game's own spelling");
  assert.equal(t.vehicle, "");
  assert.deepEqual(t.brands, ["Scooter Bros"]);
  assert.equal(t.timeOfDay, "dusk");
  assert.deepEqual(t.words, ["palm", "sunset"]);
  assert.equal(
    parseTags({ place: "", activity: "", menu: false }, { from: 0, to: 1 }, []),
    undefined,
  );
  assert.equal(
    parseTags(
      { place: "x", activity: "y", time_of_day: "teatime" },
      { from: 0, to: 1 },
      [],
    )!.timeOfDay,
    "",
  );
});

test("stream tags: the spoiler guard holds story stretches during the window only", () => {
  const w = spoilerWindow("Grand Theft Auto VI", "2026-11-19", {
    days: 28,
    openingShare: 0.1,
    until: "2026-12-17",
  });
  const story = {
    from: 0,
    to: 1,
    place: "",
    activity: "",
    vehicle: "",
    brands: [],
    timeOfDay: "" as const,
    story: true,
    menu: false,
    words: [],
  };
  assert.ok(vodMomentHeld(w, story, new Date("2026-11-25T12:00:00Z")));
  assert.equal(
    vodMomentHeld(
      w,
      { ...story, story: false },
      new Date("2026-11-25T12:00:00Z"),
    ),
    undefined,
    "ordinary play goes on",
  );
  assert.equal(
    vodMomentHeld(w, story, new Date("2026-12-19T12:00:00Z")),
    undefined,
    "after the window anything goes",
  );
  assert.ok(
    vodMomentHeld(w, undefined, new Date("2026-11-25T12:00:00Z")),
    "an untagged moment is held during the window",
  );
  assert.equal(
    vodMomentHeld(w, undefined, new Date("2026-12-19T12:00:00Z")),
    undefined,
  );
  assert.equal(
    unknownTags({ from: 0, to: 5 }).story,
    true,
    "an unreadable stretch counts as story",
  );
  assert.equal(
    vodMomentHeld(undefined, story, new Date("2026-11-25T12:00:00Z")),
    undefined,
  );
});

test("stream tags: tagging, the tagged index and finding a moment by its brand", async () => {
  const dataDir = await tmpDir();
  const v = vod(dataDir);
  await saveVodIndex(dataDir, v);
  const answers: Record<string, object> = {
    "0.00|20.00": {
      place: "Vice Beach",
      activity: "driving a car",
      vehicle: "a red car",
      brands: ["Scooter Bros"],
      time_of_day: "day",
      story: false,
      menu: false,
      words: ["palm"],
    },
    "30.00|50.00": {
      place: "an office",
      activity: "talking in a cutscene",
      vehicle: "",
      brands: [],
      time_of_day: "indoors",
      story: true,
      menu: false,
      words: [],
    },
  };
  const grabs: number[] = [];
  const r = await tagVodStretches(
    v,
    { dataDir, places: ["Vice Beach"], limit: 10 },
    {
      grab: async (_v, at, f) => {
        grabs.push(at);
        await fs.writeFile(f, "x");
      },
      look: async (_files, c, span) => {
        assert.equal(c.game, "Grand Theft Auto VI");
        return parseTags(answers[stretchKey(span)], span, c.places);
      },
    },
  );
  assert.deepEqual(r, { tagged: 2, left: 0 });
  assert.equal(grabs.length, 4, "two frames a stretch");
  assert.equal(await vodTagsReady(dataDir, v), true);
  const tags = JSON.parse(
    await fs.readFile(
      path.join(vodIndexDir(dataDir, "v1"), "tags.json"),
      "utf8",
    ),
  ) as VodTagFile;
  assert.equal(untagged(v, tags).length, 0);
  const index = taggedSceneIndex(v, tags);
  assert.ok(index.shots[1]!.tags.includes("Scooter Bros"));
  assert.equal(index.shots[0]!.where, "Vice Beach");
  const now = new Date("2026-11-25T12:00:00Z");
  const w = spoilerWindow("Grand Theft Auto VI", "2026-11-19", {
    days: 28,
    openingShare: 0.1,
    until: "2026-12-17",
  })!;
  const hits = await findVodMoments(
    [v],
    { key: "beat:1", text: "Scooter Bros brings your car" },
    { dataDir, now, windows: [w] },
  );
  assert.equal(hits[0]?.vodId, "v1");
  assert.ok(hits[0]!.start < 20, "the Scooter Bros stretch");
  assert.equal(hits[0]!.held, undefined);
  const office = await findVodMoments(
    [v],
    { key: "beat:2", text: "the job tonight in the office" },
    { dataDir, now, windows: [w] },
  );
  assert.ok(
    office.length && office.every((h) => h.held),
    "story stretches are found but held during the window",
  );
});

test("stream tags: the index step tags after describing, then embeds, then is done", async () => {
  const dataDir = await tmpDir();
  const v = vod(dataDir);
  await saveVodIndex(dataDir, v);
  const emb = {
    async images(files: string[]) {
      return files.map(() => vec("car"));
    },
  } as unknown as Embedder;
  const settings = {
    dataDir,
    whisperPython: "",
    ocrFps: 0,
    chunkSeconds: 600,
    describeBatch: 10,
    tags: { batch: 10, places: [], embedder: emb, model: "toy/model" },
  };
  const deps = {
    visionUp: async () => true,
    tag: {
      grab: async (_v: string, _at: number, f: string) => fs.writeFile(f, "x"),
      look: async (
        _f: string[],
        _c: unknown,
        span: { from: number; to: number },
      ) =>
        parseTags(
          {
            place: "a road",
            activity: "driving",
            vehicle: "",
            brands: [],
            time_of_day: "day",
            story: false,
            menu: false,
            words: [],
          },
          span,
          [],
        ),
    },
  };
  const steps: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await vodIndexStep(v.file, v.game, settings, deps as never);
    steps.push(r.did);
    if (r.did === "done") break;
  }
  assert.ok(steps.includes("tagged"), steps.join(","));
  assert.ok(steps.includes("embedded"), steps.join(","));
  assert.equal(steps.at(-1), "done");
});

// ---------------------------------------------------------------- own stream clips

test("own stream: provenance keeps the clip out of every cap, story moments are held, lines served are not searched again", async () => {
  assert.match(
    ownStreamProvenance(
      { title: 'GTA "6"', vodId: "v1", recordedOn: "2026-11-21" },
      "Grand Theft Auto VI",
      12.34,
      3.4,
    ),
    /^Pulse's own gameplay capture of Grand Theft Auto VI \(stream recording "GTA  6 ", v1, 2026-11-21\), 3.4s at 12.3s, muted$/,
  );
  const dataDir = await tmpDir();
  const v = vod(dataDir);
  const other = { ...vod(dataDir), vodId: "v2", game: "Elden Ring" };
  assert.deepEqual(
    recordingsOf([v, other], "grand theft auto vi").map((x) => x.vodId),
    ["v1"],
  );
  await saveVodIndex(dataDir, v);
  await fs.mkdir(vodIndexDir(dataDir, "v1"), { recursive: true });
  await fs.writeFile(
    path.join(vodIndexDir(dataDir, "v1"), "tags.json"),
    JSON.stringify({
      version: 1,
      stretches: {
        "0.00|20.00": {
          from: 0,
          to: 20,
          place: "Vice Beach",
          activity: "driving",
          vehicle: "a red car",
          brands: ["Scooter Bros"],
          timeOfDay: "day",
          story: false,
          menu: false,
          words: [],
        },
        "30.00|50.00": {
          from: 30,
          to: 50,
          place: "an office",
          activity: "cutscene",
          vehicle: "",
          brands: [],
          timeOfDay: "indoors",
          story: true,
          menu: false,
          words: [],
        },
      },
    }),
  );
  const w = spoilerWindow("Grand Theft Auto VI", "2026-11-19", {
    days: 28,
    openingShare: 0.1,
    until: "2026-12-17",
  })!;
  const allowedShots: number[] = [];
  const cfg = {
    dataDir,
    semantic: { ...semanticSettings({}, () => false), vodTags: true },
    sceneIndexMinConfidence: 0.3,
    ytdlpPath: "yt-dlp",
  };
  const clips = await ownStreamClips(
    cfg,
    {
      gameTitle: "Grand Theft Auto VI",
      episodeDir: dataDir,
      targets: [
        {
          key: "beat:0",
          text: "Scooter Bros brings your car",
          want: "gameplay",
          energy: "medium",
          keywords: [],
        },
        {
          key: "beat:1",
          text: "the job tonight",
          want: "gameplay",
          energy: "medium",
          keywords: [],
        },
      ],
      maxClips: 4,
      maxSeconds: 20,
    },
    async (x) => {
      for (const s of x.index.shots)
        if (x.allow(s, "")) allowedShots.push(s.id);
      return [
        {
          kind: "clip",
          file: "assets/sceneindex_x_0.mp4",
          sourceUrl: "https://www.youtube.com/watch?v=v1",
          durationSeconds: 3,
          beatIndex: 0,
          startSeconds: 10.1,
          provenance: "Cutscenes ... YouTube",
          credit: "FOOTAGE: X / YOUTUBE",
          youtubeSource: { videoId: "v1", title: "t", uploader: "TinoTV" },
          span: {
            source: "https://www.youtube.com/watch?v=v1",
            from: 10.1,
            to: 13.1,
          },
          reason: "scene index: a car beside a scooter",
        } as CutsceneClip,
      ];
    },
    new Date("2026-11-25T12:00:00Z"),
    [w],
    { readable: async () => true },
  );
  assert.equal(clips.length, 1);
  assert.match(clips[0]!.provenance, /^Pulse's own gameplay capture/);
  assert.equal(clips[0]!.youtubeSource, undefined);
  assert.equal(clips[0]!.span.source, "vod:v1");
  assert.match(clips[0]!.reason ?? "", /^own stream: a car beside a scooter/);
  assert.ok(
    !allowedShots.includes(3) && !allowedShots.includes(4),
    "the story stretch is held in the window",
  );
  assert.ok(allowedShots.includes(0) && allowedShots.includes(1));
  // A recording not yet tagged all through is never searched: an untagged stretch could be story.
  const partial = path.join(vodIndexDir(dataDir, "v1"), "tags.json");
  const full = await fs.readFile(partial, "utf8");
  const one = JSON.parse(full);
  delete one.stretches["30.00|50.00"];
  await fs.writeFile(partial, JSON.stringify(one));
  assert.deepEqual(
    await ownStreamClips(
      cfg,
      {
        gameTitle: "Grand Theft Auto VI",
        episodeDir: dataDir,
        targets: [
          {
            key: "beat:0",
            text: "Scooter Bros",
            want: "gameplay",
            energy: "low",
            keywords: [],
          },
        ],
        maxClips: 1,
        maxSeconds: 5,
      },
      async () => assert.fail("a part-tagged recording is not searched"),
      new Date("2026-11-25T12:00:00Z"),
      [w],
      { readable: async () => true },
    ),
    [],
  );
  await fs.writeFile(partial, full);
  // Off, or a recording that cannot be read here: nothing is tried.
  assert.deepEqual(
    await ownStreamClips(
      { ...cfg, semantic: { ...cfg.semantic, vodTags: false } },
      {
        gameTitle: "Grand Theft Auto VI",
        episodeDir: dataDir,
        targets: [
          {
            key: "beat:0",
            text: "x",
            want: "gameplay",
            energy: "low",
            keywords: [],
          },
        ],
        maxClips: 1,
        maxSeconds: 5,
      },
      async () => assert.fail("not asked"),
      new Date(),
      [w],
    ),
    [],
  );
  assert.deepEqual(
    await ownStreamClips(
      cfg,
      {
        gameTitle: "Grand Theft Auto VI",
        episodeDir: dataDir,
        targets: [
          {
            key: "beat:0",
            text: "x",
            want: "gameplay",
            energy: "low",
            keywords: [],
          },
        ],
        maxClips: 1,
        maxSeconds: 5,
      },
      async () => assert.fail("not asked"),
      new Date(),
      [w],
      { readable: async () => false },
    ),
    [],
  );
});

test("semantic: a shot whose frame cannot be cut is marked tried and never holds a turn for ever", async () => {
  const dir = await tmpDir();
  const shots = [shot(0, 0, ""), shot(1, 10, "")];
  const file = vectorFile(dir, "m");
  let grabs = 0;
  const grab = async (_v: string, at: number, f: string) => {
    grabs++;
    if (at > 10) throw new Error("past the end of the proxy");
    await fs.writeFile(f, "car");
  };
  const emb = { images: async (files: string[]) => files.map(() => vec("car")) } as unknown as Embedder;
  const r = await embedShots({ shots, video: "p.mp4", vectorsFile: file, embedder: emb, model: "m", work: dir, grab });
  assert.deepEqual(r, { added: 1, total: 1, left: 0 });
  const again = await embedShots({ shots, video: "p.mp4", vectorsFile: file, embedder: emb, model: "m", work: dir, grab });
  assert.equal(again.added, 0);
  assert.equal(grabs, 2, "the failed shot is not tried again");
});
