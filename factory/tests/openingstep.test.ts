import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  adSafeProblem,
  checkFirstSeconds,
  chooseOpening,
  clipOfGame,
  openerProblem,
  openingCandidates,
  openingLookAnswer,
  openingWindow,
  remainder,
  sampleTimes,
  shotsInFirst,
  windowTimes,
  type OpeningLook,
} from "../src/openingstep.ts";
import type { EpisodeAssets } from "../src/episodes.ts";
import type { RenderPlan } from "../src/render/plan.ts";

type Clip = NonNullable<EpisodeAssets["clips"]>[number];
const clip = (over: Partial<Clip>): Clip => ({
  file: "assets/c.mp4",
  sourceUrl: "",
  provenance:
    'Official Steam trailer "Launch" for "Doom: The Dark Ages" (app 1), 8s at 10.0s, muted',
  durationSeconds: 8,
  ...over,
});
const safe: OpeningLook = {
  gameplay: true,
  gore: false,
  nudity: false,
  weapon: false,
  shocking: false,
  strength: 6,
};

test("an opening frame must be ad-safe and the game's own picture", () => {
  assert.equal(adSafeProblem(safe), undefined);
  assert.equal(adSafeProblem({ ...safe, gore: true }), "gore or blood");
  assert.equal(
    adSafeProblem({ ...safe, weapon: true }),
    "a weapon aimed at the viewer",
  );
  assert.equal(adSafeProblem(undefined), "not screened");
  assert.match(
    openerProblem({ ...safe, gameplay: false })!,
    /card, logo or art/,
  );
  assert.equal(adSafeProblem({ ...safe, gameplay: false }), undefined); // a still later in the 7 s may be art
});

test("the model's answer reads into a look, or none", () => {
  assert.deepEqual(openingLookAnswer({ ...safe, strength: 14 }), {
    ...safe,
    strength: 10,
  });
  assert.equal(openingLookAnswer({ gameplay: true }), undefined);
  assert.equal(openingLookAnswer(undefined), undefined);
});

test("candidates: own capture first, then the hook's moment, cutscenes, trailers; never stock or number one", () => {
  const clips = [
    clip({ file: "trailer.mp4", motion: 0.9 }),
    clip({ file: "hook.mp4", role: "hook" }),
    clip({
      file: "own.mp4",
      provenance: "Pulse's own gameplay capture of Doom (x), 9s at 3.0s, muted",
    }),
    clip({
      file: "cut.mp4",
      provenance:
        'Cutscenes for "Doom" from YouTube video "x" by y, video ID: z',
    }),
    clip({ file: "stock.mp4", stock: true }),
    clip({ file: "short.mp4", durationSeconds: 1.5 }),
  ];
  const order = openingCandidates(clips, {
    game: "Doom: The Dark Ages",
    entries: 0,
    spoilerWindow: false,
  });
  assert.deepEqual(
    order.map((i) => clips[i]!.file),
    ["own.mp4", "hook.mp4", "cut.mp4", "trailer.mp4"],
  );
  // In the game's spoiler window no cutscene opens it.
  const guarded = openingCandidates(clips, {
    game: "Doom: The Dark Ages",
    entries: 0,
    spoilerWindow: true,
  });
  assert.ok(!guarded.map((i) => clips[i]!.file).includes("cut.mp4"));
  // A ranking of three never opens on its number one (the last beat); a clip no entry needs comes before one that is.
  const list = [
    clip({ file: "one.mp4", beatIndex: 2 }),
    clip({ file: "three.mp4", beatIndex: 0 }),
    clip({ file: "free.mp4" }),
  ];
  assert.deepEqual(
    openingCandidates(list, {
      game: "x",
      entries: 3,
      spoilerWindow: false,
    }).map((i) => list[i]!.file),
    ["free.mp4", "three.mp4"],
  );
});

test("a clip of the game names it", () => {
  assert.ok(clipOfGame(clip({}), "Doom: The Dark Ages"));
  assert.ok(
    !clipOfGame(
      clip({ provenance: 'Official trailer "Halo Infinite"' }),
      "Doom: The Dark Ages",
    ),
  );
});

test("windows: three looks inside the clip, the opening a beat before the moment, the longer side kept", () => {
  assert.deepEqual(sampleTimes(10), [1.5, 4.5, 7.5]);
  assert.deepEqual(openingWindow(10, 4.5), { from: 4, to: 10 });
  assert.deepEqual(openingWindow(10, 1.5), { from: 1.2, to: 7.2 });
  assert.deepEqual(openingWindow(4, 2), { from: 0, to: 4 });
  assert.deepEqual(windowTimes(0, 3), [0.1, 1.1, 2.1, 2.85]);
  assert.deepEqual(remainder(10, { from: 1.2, to: 7.2 }), {
    from: 7.2,
    to: 10,
  });
  assert.deepEqual(remainder(10, { from: 4, to: 10 }), { from: 0, to: 4 });
  assert.equal(remainder(7, { from: 0.5, to: 6.5 }), undefined);
});

test("the first seven seconds are the shots that start in them, with the source seconds they play", () => {
  const plan = {
    fps: 30,
    shots: [
      { start: 0, end: 150, media: { type: "clip", index: 0, trimFrom: 0 } },
      { start: 150, end: 240, media: { type: "clip", index: 1, trimFrom: 30 } },
      { start: 240, end: 300, media: { type: "image", index: 0 } },
    ],
  } as unknown as RenderPlan;
  assert.deepEqual(shotsInFirst(plan), [
    { index: 0, from: 0, to: 5 },
    { index: 1, from: 1, to: 3 },
  ]);
});

async function scratch(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "opening-"));
}

test("chooseOpening cuts the strongest safe moment out as the hook clip and keeps the rest in place", async () => {
  const dir = await scratch();
  const assets: EpisodeAssets = {
    clips: [
      clip({ file: "assets/gore.mp4", role: "hook", durationSeconds: 8 }),
      clip({ file: "assets/good.mp4", durationSeconds: 12, motion: 0.5 }),
    ],
  };
  const cuts: string[] = [];
  const res = await chooseOpening(
    dir,
    assets,
    { game: "Doom: The Dark Ages", entries: 0, spoilerWindow: false },
    {
      frames: async (file, _d, times) =>
        times.map((t) => `${path.basename(file)}@${t}`),
      look: async (f) =>
        f.startsWith("gore.mp4")
          ? { ...safe, gore: true }
          : { ...safe, strength: f.endsWith("@5.4") ? 9 : 4 },
      cut: async (_f, out, from, to) => {
        cuts.push(`${path.basename(out)} ${from}-${to}`);
        return to - from;
      },
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.from, "assets/good.mp4");
  assert.deepEqual(res.window, { from: 5.1, to: 11.1 });
  assert.deepEqual(cuts, ["good_opening.mp4 5.1-11.1", "good_rest.mp4 0-5.1"]);
  const files = assets.clips!.map((c) => `${c.file}:${c.role ?? ""}`);
  // The opening first, tagged for the hook; the gory clip loses its hook tag; seconds never grow.
  assert.deepEqual(files, [
    "assets/good_opening.mp4:hook",
    "assets/gore.mp4:",
    "assets/good_rest.mp4:",
  ]);
  assert.ok(assets.clips!.reduce((n, c) => n + c.durationSeconds, 0) <= 20);
  assert.match(res.tried[0]!.problem!, /gore/);
});

test("chooseOpening changes nothing when the model cannot judge", async () => {
  const dir = await scratch();
  const clips = [clip({ file: "assets/a.mp4" })];
  const assets: EpisodeAssets = { clips: [...clips] };
  const res = await chooseOpening(
    dir,
    assets,
    { game: "Doom: The Dark Ages", entries: 0, spoilerWindow: false },
    {
      frames: async (_f, _d, t) => t.map(String),
      look: async () => undefined,
      cut: async () => 1,
    },
  );
  assert.equal(res.ok, false);
  assert.match(res.why, /did not answer/);
  assert.deepEqual(assets.clips, clips);
});

test("a title card in the opening window sends the pick to the next moment", async () => {
  const dir = await scratch();
  const assets: EpisodeAssets = {
    clips: [clip({ file: "assets/a.mp4", durationSeconds: 12 })],
  };
  const res = await chooseOpening(
    dir,
    assets,
    { game: "Doom: The Dark Ages", entries: 0, spoilerWindow: false },
    {
      frames: async (_f, d, times) =>
        times.map((t) => `${path.basename(d)}@${t}`),
      // The strongest sampled moment (5.4) sits next to a title card at 8.5; the earlier one is clean.
      look: async (f) => {
        const t = Number(f.split("@")[1]);
        return {
          ...safe,
          gameplay: !(f.includes("_w54") && t > 8),
          strength: t === 5.4 ? 9 : 5,
        };
      },
      cut: async (_f, _o, from, to) => to - from,
    },
  );
  assert.equal(res.ok, true);
  assert.notEqual(res.window!.from, 5.1);
});

test("checkFirstSeconds swaps a failing later shot for a safe picture and reports a failing first one", async () => {
  const dir = await scratch();
  const plan = {
    fps: 30,
    shots: [
      {
        start: 0,
        end: 120,
        media: { type: "clip", index: 0, trimFrom: 0 },
        framed: false,
      },
      {
        start: 120,
        end: 200,
        media: { type: "image", index: 0 },
        framed: false,
      },
      {
        start: 200,
        end: 300,
        media: { type: "image", index: 1 },
        framed: false,
      },
    ],
  } as unknown as RenderPlan;
  const assets: Pick<EpisodeAssets, "clips" | "images"> = {
    clips: [clip({ file: "assets/open.mp4" })],
    images: [
      {
        file: "blood.jpg",
        kind: "screenshot",
        aspect: 16 / 9,
        sourceUrl: "",
        provenance: "",
      },
      {
        file: "ok.jpg",
        kind: "screenshot",
        aspect: 16 / 9,
        sourceUrl: "",
        provenance: "",
      },
      {
        file: "spare.jpg",
        kind: "hero",
        aspect: 16 / 9,
        sourceUrl: "",
        provenance: "",
      },
    ],
  };
  const res = await checkFirstSeconds(
    dir,
    plan,
    assets,
    { openingChecked: "assets/open.mp4" },
    {
      frames: async () => [],
      look: async (f) =>
        f.endsWith("blood.jpg") ? { ...safe, gore: true } : safe,
    },
  );
  assert.equal(res.openingStill, false);
  assert.deepEqual(res.replaced, [
    { shot: 1, problem: "gore or blood", with: "spare.jpg" },
  ]);
  assert.deepEqual(plan.shots[1]!.media, { type: "image", index: 2 });
  assert.equal(res.checked, 3);
});
