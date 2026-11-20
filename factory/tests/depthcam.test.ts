import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEPTH_CAM_KINDS,
  camEdgesHidden,
  camLens,
  camOverscan,
  camPlane,
  camProgress,
  depthCamPlan,
  leakAt,
  stressedFrame,
} from "../src/render/depthcam.ts";

test("depth camera: the move starts at rest, ends at 1, never runs backwards and is fastest on the stressed word", () => {
  for (const e of [0.2, 0.5, 0.85]) {
    assert.equal(camProgress(0, e), 0);
    assert.ok(Math.abs(camProgress(1, e) - 1) < 1e-9);
    let last = -1;
    let fastest = 0;
    let at = 0;
    for (let k = 0; k <= 200; k++) {
      const p = camProgress(k / 200, e);
      assert.ok(p >= last - 1e-12, `monotonic at ${k}`);
      if (k > 0 && p - last > fastest) {
        fastest = p - last;
        at = k / 200;
      }
      last = p;
    }
    assert.ok(Math.abs(at - e) <= 0.02, `fastest at ${at}, wanted ${e}`);
  }
});

test("depth camera: plans rotate the paths, alternate direction and rack, and keep the emphasis off the ends", () => {
  const kinds = Array.from({ length: 6 }, (_, i) => depthCamPlan(i, 120).kind);
  assert.deepEqual(kinds, [...DEPTH_CAM_KINDS]);
  assert.equal(depthCamPlan(0, 120).dir, 1);
  assert.equal(depthCamPlan(1, 120).dir, -1);
  assert.notEqual(depthCamPlan(0, 120).rack, depthCamPlan(1, 120).rack);
  assert.equal(depthCamPlan(0, 120).emphasis, 0.55);
  assert.equal(depthCamPlan(0, 120, 60).emphasis, 0.5);
  assert.equal(depthCamPlan(0, 120, 2).emphasis, 0.2);
  assert.equal(depthCamPlan(0, 120, 119).emphasis, 0.85);
  assert.equal(
    [0, 1, 2, 3, 4, 5].filter((i) => depthCamPlan(i, 90).leak).length,
    2,
  );
});

test("depth camera: the chosen overscan hides the plane's edges on every path, long and Short, near and far subjects", () => {
  for (const frameAspect of [16 / 9, 9 / 16])
    for (const aspect of [16 / 9, 3.1, 1.3])
      for (const pivot of [0.2, 0.55, 0.95])
        for (let i = 0; i < 6; i++)
          for (const emphasisFrame of [undefined, 10, 100]) {
            const plan = depthCamPlan(i, 120, emphasisFrame);
            for (const fx of [0, 0.5, 1]) {
              const o = camOverscan(plan, aspect, frameAspect, pivot, fx);
              assert.ok(
                o < 1.6,
                `overscan ran out: ${plan.kind} ${aspect} ${frameAspect} ${pivot}`,
              );
              assert.ok(
                camEdgesHidden(plan, aspect, frameAspect, pivot, o, fx),
              );
            }
          }
});

test("depth camera: a tall frame crops round the subject but never past the picture's edge", () => {
  const mid = camPlane(16 / 9, 9 / 16, 1.1, 0.5);
  assert.equal(mid.offsetX, 0);
  const left = camPlane(16 / 9, 9 / 16, 1.1, 0.1);
  const right = camPlane(16 / 9, 9 / 16, 1.1, 0.9);
  assert.ok(left.offsetX > 0 && right.offsetX < 0);
  const edge = camPlane(16 / 9, 9 / 16, 1.1, 0);
  const spare = (edge.w - (9 / 16) * 1.1) / 2;
  assert.ok(edge.offsetX <= spare + 1e-9);
  // A wide frame of a wide picture has nothing to spare sideways.
  assert.equal(camPlane(16 / 9, 16 / 9, 1.1, 0.1).offsetX, 0);
});

test("depth camera: the rack lands on the subject by the stressed word; the open lens only softens the background", () => {
  const plan = depthCamPlan(0, 100, 50);
  assert.equal(plan.rack, "in");
  const start = camLens(plan, 0, 0.7);
  const after = camLens(plan, 0.55, 0.7);
  assert.ok(start.focus < 0.3);
  assert.ok(Math.abs(after.focus - 0.7) < 1e-9);
  const open = depthCamPlan(1, 100, 50);
  assert.equal(camLens(open, 0, 0.6).focus, 0.6);
  assert.ok(camLens(open, 0, 0.6).strength < camLens(open, 0.9, 0.6).strength);
});

test("depth camera: the light leak swells on the word and is gone well away from it", () => {
  assert.ok(leakAt(0.5, 0.5) > 0.99);
  assert.ok(leakAt(0, 0.8) < 0.01);
});

test("depth camera: the stressed word is the writer's emphasis, else a figure or a mid-line name, else none", () => {
  const words = [
    { start: 1.0, text: "The" },
    { start: 1.3, text: "studio" },
    { start: 1.6, text: "hired" },
    { start: 1.9, text: "Leslie" },
    { start: 2.2, text: "Benzies" },
    { start: 2.5, text: "in" },
    { start: 2.7, text: "1999." },
  ];
  const shot = { start: 0, end: 120 };
  assert.equal(
    stressedFrame(shot, 30, words, [
      { start: 1, end: 3, text: "the studio hired" },
    ]),
    Math.round(1.3 * 30),
  );
  assert.equal(stressedFrame(shot, 30, words), Math.round(1.9 * 30));
  assert.equal(
    stressedFrame(shot, 30, [
      { start: 1, text: "quiet" },
      { start: 1.4, text: "words" },
    ]),
    undefined,
  );
  // Words outside the shot do not count.
  assert.equal(stressedFrame({ start: 90, end: 120 }, 30, words), undefined);
});

// ---------------------------------------------------------------- which stills the depth camera gets (src/depthstep.ts)

import { deepCandidates, meshStills, type DepthConfig, type DepthDeps } from "../src/depthstep.ts";

const L = { bg: "b", mid: "m", fg: "f" };
const deepImages = () => [
  { file: "a.jpg", kind: "hero", aspect: 1.78, layers: { ...L } },
  { file: "b.jpg", kind: "screenshot", aspect: 1.78, layers: { ...L }, wordy: true },
  { file: "c.jpg", kind: "screenshot", aspect: 1.78, layers: { ...L } },
  { file: "d.jpg", kind: "photo", aspect: 1.5, layers: { ...L } },
  { file: "e.jpg", kind: "screenshot", aspect: 1.78 },
  { file: "f.jpg", kind: "capsule", aspect: 2.1, layers: { ...L } },
  { file: "g.jpg", kind: "article", aspect: 1.0, layers: { ...L } },
];

test("depth camera: the stills it films are layered, wide, full-bleed kinds without HUD text, in order, capped", () => {
  assert.deepEqual(deepCandidates(deepImages(), 40), [0, 2]);
  assert.deepEqual(deepCandidates(deepImages(), 1), [0]);
  assert.deepEqual(deepCandidates(deepImages(), 0), []);
});

const deepCfg = (over: Partial<DepthConfig>): DepthConfig => ({
  dataDir: "/data",
  parallax: true,
  parallaxPython: "python",
  depthOrbit: false,
  depthOrbitMax: 16,
  subjectPop: false,
  parallaxDeep: false,
  parallaxDeepMax: 40,
  upscale: false,
  upscaleModel: "anime",
  upscaleModelDir: "",
  upscaleMaxHeight: 576,
  upscaleMaxSeconds: 150,
  ...over,
});

function deepFakes(cfg: DepthConfig) {
  const calls: Array<{ files: string[]; fill?: string }> = [];
  const notices: string[] = [];
  const d: DepthDeps = {
    cfg,
    makeMeshes: async (_p, _d, files, fill) => {
      calls.push({ files, fill });
      return new Map(files.map((f) => [f, { depth: "d", far: "far", farDepth: "fd", pivot: 0.7, grid: "0" }]));
    },
    upscaleStills: async () => ({ made: new Map(), gpuSeconds: 0 }),
    upscaleFootage: async () => ({ upscaled: 0, cached: 0, overBudget: 0, failed: 0, footageSeconds: 0, gpuSeconds: 0 }),
    logEvent: async () => undefined,
    notify: async (m) => {
      notices.push(m.content);
    },
  };
  return { d, calls, notices };
}

test("depth camera: off, no maps are made; on, its stills get maps painted with the push-pull fill and the owner is told", async () => {
  const off = deepFakes(deepCfg({}));
  assert.equal(await meshStills(off.d, { headline: "H", episodeDir: "/e", images: deepImages() }), 0);
  assert.equal(off.calls.length, 0);
  const on = deepFakes(deepCfg({ parallaxDeep: true }));
  const images = deepImages();
  assert.equal(await meshStills(on.d, { headline: "H", episodeDir: "/e", images }), 2);
  assert.deepEqual(on.calls, [{ files: ["a.jpg", "c.jpg"], fill: "pushpull" }]);
  assert.ok(images[0]!.layers!.mesh && images[2]!.layers!.mesh && !images[1]!.layers!.mesh);
  assert.match(on.notices[0]!, /depth camera/);
  assert.match(on.notices[0]!, /PARALLAX_DEEP/);
  // The orbit alone keeps the old fill.
  const orbit = deepFakes(deepCfg({ depthOrbit: true }));
  await meshStills(orbit.d, { headline: "H", episodeDir: "/e", images: deepImages() });
  assert.equal(orbit.calls[0]!.fill, undefined);
});
