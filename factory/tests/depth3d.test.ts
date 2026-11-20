import { test } from "node:test";
import assert from "node:assert/strict";
import {
  edgesHidden,
  orbitCandidates,
  orbitMatrix,
  orbitPose,
  ORBIT_YAW_DEGREES,
  planeSize,
  project,
  reliefZ,
} from "../src/render/orbit.ts";
import {
  CAMERA_TECHNIQUES,
  cameraNotice,
  ORBIT_MIN_FRAMES,
  parseCameraSetting,
  planCamera,
  type CameraInput,
  type CameraShot,
} from "../src/render/camera.ts";
import {
  frameToPicture,
  GRID_H,
  GRID_W,
  overlap,
  parseGrid,
  popAmount,
  popLayout,
  popPicture,
  POP_FALL,
  POP_HOLD,
  POP_RISE,
} from "../src/render/popout.ts";
import {
  boxShape,
  boxTurn,
  BOX_REST_DEGREES,
  BOX_START_DEGREES,
  BOX_TURN_FRAMES,
  launchBeats,
} from "../src/render/boxart.ts";
import {
  needsUpscale,
  parseHeight,
  pickUpscale,
  sdCopy,
} from "../src/assets/upscale.ts";
import {
  footageNotice,
  meshStills,
  upscaleOldFootage,
  upscaleOldStills,
  type DepthConfig,
  type DepthDeps,
  type DepthImage,
} from "../src/depthstep.ts";

// ---------------------------------------------------------------- the 3D photo's camera

test("the orbit swings from one side to the other, starting and landing at rest", () => {
  const a = orbitPose(0, 1);
  const b = orbitPose(1, 1);
  const rad = (ORBIT_YAW_DEGREES * Math.PI) / 180;
  assert.ok(Math.abs(a.yaw + rad) < 1e-9 && Math.abs(b.yaw - rad) < 1e-9);
  assert.equal(orbitPose(0.5, 1).yaw, 0);
  // The other way round with dir -1.
  assert.ok(orbitPose(0, -1).yaw > 0);
  // Eased: the first and last hundredth move far less than the middle hundredth.
  const step = (p: number) =>
    Math.abs(orbitPose(p + 0.01, 1).yaw - orbitPose(p, 1).yaw);
  assert.ok(step(0) < step(0.495) / 10);
  assert.ok(orbitPose(1, 1).distance < orbitPose(0, 1).distance);
});

test("the plane covers the frame for wide, square-ish and very wide pictures", () => {
  for (const aspect of [16 / 9, 4 / 3, 3.1]) {
    const { w, h } = planeSize(aspect, 16 / 9);
    assert.ok(Math.abs(w / h - aspect) < 1e-9);
    assert.ok(h >= 1 && w >= 16 / 9);
  }
});

test("the plane's edge never shows during the move, whatever the subject's depth", () => {
  for (const aspect of [16 / 9, 4 / 3, 3.1])
    for (const pivot of [0.2, 0.6, 0.95])
      for (const dir of [1, -1] as const)
        assert.ok(
          edgesHidden(aspect, 16 / 9, pivot, dir),
          `${aspect} ${pivot} ${dir}`,
        );
});

test("the subject holds its place while the camera swings round it", () => {
  const pivot = reliefZ(0.8);
  const at = (p: number) =>
    project(orbitMatrix(orbitPose(p, 1), 16 / 9, pivot), [0, 0, pivot]);
  for (const p of [0, 0.5, 1]) {
    const [x, y] = at(p);
    assert.ok(Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6);
  }
  // A point far behind the subject moves across the frame: real parallax.
  const far = (p: number) =>
    project(orbitMatrix(orbitPose(p, 1), 16 / 9, pivot), [0.3, 0, 0])[0];
  assert.ok(Math.abs(far(1) - far(0)) > 0.02);
});

test("3D photo candidates: key art first, two a chapter, a cap in all, no wordy screenshots", () => {
  const L = {};
  const images = [
    { kind: "screenshot", aspect: 1.78, beatIndex: 0, layers: L },
    { kind: "hero", aspect: 1.78, beatIndex: 0, layers: L },
    { kind: "hero", aspect: 3.1, beatIndex: 0, layers: L },
    { kind: "header", aspect: 2.1, beatIndex: 0, layers: L },
    { kind: "hero", aspect: 1.78, beatIndex: 1 }, // no layers
    { kind: "screenshot", aspect: 1.78, beatIndex: 1, layers: L, wordy: true },
    { kind: "screenshot", aspect: 1.78, beatIndex: 1, layers: L },
    { kind: "capsule", aspect: 0.67, beatIndex: 2, layers: L },
    { kind: "hero", aspect: 1.1, beatIndex: 2, layers: L }, // too narrow
  ];
  assert.deepEqual(orbitCandidates(images, 10), [1, 2, 6]);
  assert.deepEqual(orbitCandidates(images, 2), [1, 2]);
  assert.deepEqual(orbitCandidates(images, 10, 1), [1, 6]);
});

// ---------------------------------------------------------------- the camera chooses the orbit

const shots = (n: number, len: number, chapterEvery: number): CameraShot[] =>
  Array.from({ length: n }, (_, i) => ({
    start: i * len,
    end: (i + 1) * len,
    segment: Math.floor(i / chapterEvery),
    media: { type: "image" as const, index: i },
  }));

function orbitInput(
  meshEvery: number,
  over: Partial<CameraInput> = {},
): CameraInput {
  const n = 40;
  return {
    shots: shots(n, 400, 10),
    images: Array.from({ length: n }, (_, i) => ({
      kind: "hero",
      aspect: 16 / 9,
      layers: i % meshEvery === 0 ? { mesh: { grid: "" } } : {},
    })),
    chapterOf: (seg) => seg,
    fps: 30,
    enabled: [...CAMERA_TECHNIQUES],
    variant: 0,
    ...over,
  };
}

test("the orbit lands once a chapter, only on stills with their 3D photo maps", () => {
  // The other moves are left out so the caps on camera moves a minute do not decide this test.
  const plan = planCamera(orbitInput(3, { enabled: ["orbit"] }));
  const orbits = plan.events.filter((e) => e.kind === "orbit");
  assert.equal(orbits.length, 4); // four chapters of ten shots
  const chapters = orbits.map((e) => Math.floor(e.shot / 10));
  assert.deepEqual(chapters, [0, 1, 2, 3]);
  for (const e of orbits) assert.equal(e.shot % 3, 0);
  for (const [, m] of plan.shots)
    if (m.kind === "orbit") assert.ok(m.dir === 1 || m.dir === -1);
});

test("no orbit without maps, when switched off, or on a still too short to carry it", () => {
  assert.equal(
    planCamera(
      orbitInput(1000 /* only shot 0 */, {
        shots: shots(40, ORBIT_MIN_FRAMES - 1, 10),
      }),
    ).events.filter((e) => e.kind === "orbit").length,
    0,
  );
  const off = planCamera(
    orbitInput(3, { enabled: parseCameraSetting("all,-orbit") }),
  );
  assert.equal(off.events.filter((e) => e.kind === "orbit").length, 0);
  const none = planCamera({
    ...orbitInput(3),
    images: orbitInput(3).images.map((im) => ({ ...im, layers: {} })),
  });
  assert.equal(none.events.filter((e) => e.kind === "orbit").length, 0);
  assert.match(cameraNotice("Vice City", ["orbit"], 0), /3D orbit/);
});

// ---------------------------------------------------------------- the subject pop-out

/** A footprint with the subject filling the given cell columns and rows. */
function footprint(x0: number, x1: number, y0: number, y1: number): string {
  let s = "";
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++)
      s += x >= x0 && x < x1 && y >= y0 && y < y1 ? "9" : "0";
  return s;
}

test("grid parsing refuses anything but a full grid of digits", () => {
  assert.equal(parseGrid(""), undefined);
  assert.equal(parseGrid("12"), undefined);
  assert.equal(parseGrid("x".repeat(GRID_W * GRID_H)), undefined);
  assert.equal(
    parseGrid(footprint(0, 1, 0, 1))!.filter((v) => v === 1).length,
    1,
  );
});

test("overlap is the share of the box the subject covers", () => {
  const cells = parseGrid(footprint(16, 32, 0, 18))!; // the right half
  assert.ok(
    Math.abs(overlap(cells, { x0: 0.5, y0: 0, x1: 1, y1: 1 }) - 1) < 1e-9,
  );
  assert.ok(Math.abs(overlap(cells, { x0: 0, y0: 0, x1: 0.5, y1: 1 })) < 1e-9);
  assert.ok(
    Math.abs(overlap(cells, { x0: 0.25, y0: 0, x1: 0.75, y1: 1 }) - 0.5) < 1e-9,
  );
});

test("a very wide picture's crop maps the frame's box into its middle", () => {
  const b = frameToPicture({ x0: 0, y0: 0, x1: 1, y1: 1 }, 32 / 9);
  assert.ok(Math.abs(b.x0 - 0.25) < 1e-9 && Math.abs(b.x1 - 0.75) < 1e-9);
});

test("the title goes where the subject overlaps it a little, never where it hides it", () => {
  // A subject standing at the right edge: the right-hand title would sit on it, the centre one only grazes it.
  const right = popLayout(footprint(24, 32, 2, 18), 16 / 9);
  assert.ok(right);
  assert.notEqual(right!.align, "right");
  assert.ok(right!.overlap >= 0.03 && right!.overlap <= 0.28);
  // A subject filling the middle hides every placement; a tiny one pops nothing; no grid, no pop.
  assert.equal(popLayout(footprint(4, 28, 0, 18), 16 / 9), undefined);
  assert.equal(popLayout(footprint(30, 31, 17, 18), 16 / 9), undefined);
  assert.equal(popLayout(undefined, 16 / 9), undefined);
});

test("the pop rises, holds and steps back, and holds to the end on a short card", () => {
  const at = 30;
  assert.equal(popAmount(at - 1, at, 300), 0);
  assert.equal(popAmount(at + POP_RISE + 5, at, 300), 1);
  assert.equal(popAmount(at + POP_RISE + POP_HOLD + POP_FALL + 1, at, 300), 0);
  assert.equal(popAmount(at + POP_RISE + 20, at, at + POP_RISE + 30), 1);
});

test("the pop picture is the chapter's own, key art first, with maps and a fitting footprint", () => {
  const fits = footprint(24, 32, 2, 18);
  const images = [
    {
      kind: "screenshot",
      aspect: 1.78,
      beatIndex: 1,
      layers: { mesh: { grid: fits } },
    },
    {
      kind: "hero",
      aspect: 1.78,
      beatIndex: 1,
      layers: { mesh: { grid: fits } },
    },
    { kind: "hero", aspect: 1.78, beatIndex: 2, layers: {} },
    {
      kind: "hero",
      aspect: 1.78,
      beatIndex: 3,
      layers: { mesh: { grid: footprint(4, 28, 0, 18) } },
    },
  ];
  assert.equal(popPicture(images, 1)?.index, 1);
  assert.equal(popPicture(images, 2), undefined);
  assert.equal(popPicture(images, 3), undefined);
  assert.equal(popPicture(images, undefined), undefined);
  assert.equal(popPicture(images, undefined, true)?.index, 1);
});

// ---------------------------------------------------------------- the 3D box

test("the box turns in from its back, overshoots a touch and settles at three quarters", () => {
  assert.equal(boxTurn(0, 120), BOX_START_DEGREES);
  assert.ok(Math.abs(boxTurn(BOX_TURN_FRAMES, 120) - BOX_REST_DEGREES) < 1e-9);
  const mid = [...Array(BOX_TURN_FRAMES).keys()].map((f) => boxTurn(f, 120));
  assert.ok(Math.min(...mid) < BOX_REST_DEGREES); // the overshoot
  for (let f = BOX_TURN_FRAMES; f < 120; f++)
    assert.ok(Math.abs(boxTurn(f, 120) - BOX_REST_DEGREES) <= 7.01);
  assert.ok(boxShape(1997).depth > boxShape(2004).depth);
});

test("launch beats: the first 'came out' sentence of each chapter, free and long enough", () => {
  const words = [
    { text: "It", start: 10 },
    { text: "launched", start: 10.4 },
    { text: "in", start: 10.8 },
    { text: "2001.", start: 11 },
    { text: "It", start: 20 },
    { text: "was", start: 20.2 },
    { text: "released", start: 20.5 },
    { text: "Then", start: 30 },
    { text: "released", start: 30.5 },
    { text: "Short", start: 40 },
    { text: "released", start: 40.2 },
  ];
  const windows = [
    { entry: 0, moment: 1, start: 10, end: 14 },
    { entry: 0, moment: 2, start: 20, end: 24 }, // same chapter: only the first counts
    { entry: 1, moment: 1, start: 30, end: 33 }, // busy: a graphic over it
    { entry: 2, moment: 1, start: 40, end: 41.5 }, // too short
  ];
  const beats = launchBeats({
    windows,
    words,
    fps: 30,
    busy: (e) => e === 1,
  });
  assert.deepEqual(beats, [{ entry: 0, from: 300, len: 120 }]);
  assert.deepEqual(
    launchBeats({
      windows,
      words,
      fps: 30,
      busy: () => false,
      filler: (f) => f < 600,
    }).map((b) => b.entry),
    [0, 1],
  );
});

// ---------------------------------------------------------------- upscaling

test("only old, small pictures and footage are upscaled", () => {
  assert.equal(needsUpscale(480, 576), true);
  assert.equal(needsUpscale(576, 576), true);
  assert.equal(needsUpscale(720, 576), false);
  assert.equal(needsUpscale(1080, 576), false);
  assert.equal(needsUpscale(undefined, 576), false);
  assert.equal(needsUpscale(480, 0), false);
  assert.equal(sdCopy("a/b/ff_1_3.mp4"), "a/b/ff_1_3.sd.mp4");
});

test("ffmpeg's banner gives the video's height", () => {
  const banner =
    "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 640x480 [SAR 1:1 DAR 4:3], 1200 kb/s, 30 fps\n  Stream #0:1: Audio: aac";
  assert.equal(parseHeight(banner), 480);
  assert.equal(parseHeight("Stream #0:0: Audio: aac"), undefined);
});

test("the budget takes the oldest chapters first and skips a clip that would pass it", () => {
  const items = [
    { file: "c", seconds: 5, order: 3 },
    { file: "a", seconds: 6, order: 0 },
    { file: "b", seconds: 6, order: 1 },
    { file: "d", seconds: 2, order: 4 },
  ];
  assert.deepEqual(
    pickUpscale(items, 14).map((x) => x.file),
    ["a", "b", "d"],
  );
  assert.deepEqual(pickUpscale(items, 0), []);
  assert.deepEqual(
    pickUpscale(items, 100).map((x) => x.file),
    ["a", "b", "c", "d"],
  );
});

// ---------------------------------------------------------------- the steps, with fakes

const cfg = (over: Partial<DepthConfig> = {}): DepthConfig => ({
  dataDir: "/data",
  parallax: true,
  parallaxPython: "python",
  depthOrbit: true,
  depthOrbitMax: 16,
  subjectPop: true,
  upscale: true,
  upscaleModel: "anime",
  upscaleModelDir: "/models",
  upscaleMaxHeight: 576,
  upscaleMaxSeconds: 150,
  parallaxDeep: false,
  parallaxDeepMax: 40,
  ...over,
});

function fakes(c: DepthConfig) {
  const events: Array<{ kind: string; detail: Record<string, unknown> }> = [];
  const notices: string[] = [];
  const asked: string[][] = [];
  const d: DepthDeps = {
    cfg: c,
    makeMeshes: async (_p, _d, files) => {
      asked.push(files);
      return new Map(
        files.map((f) => [
          f,
          {
            depth: `${f}.d.png`,
            far: `${f}.far.webp`,
            farDepth: `${f}.fd.png`,
            pivot: 0.8,
            grid: "0",
          },
        ]),
      );
    },
    upscaleStills: async (o) => {
      asked.push(o.files);
      return {
        made: new Map(
          o.files.map((f) => [f, `assets/up/${f.split("/").pop()}.png`]),
        ),
        gpuSeconds: 3,
      };
    },
    upscaleFootage: async () => ({
      upscaled: 4,
      cached: 1,
      overBudget: 2,
      failed: 0,
      footageSeconds: 18,
      gpuSeconds: 40,
    }),
    logEvent: async (kind, detail) => {
      events.push({ kind, detail });
    },
    notify: async (m) => {
      notices.push(m.content);
    },
  };
  return { d, events, notices, asked };
}

test("still upscaling points the picture at the sharper copy, keeps the original and skips layered ones", async () => {
  const f = fakes(cfg());
  const images: DepthImage[] = [
    { file: "entry_1/assets/header_2.jpg", kind: "header", aspect: 2.1 },
    { file: "entry_1/assets/photo_0.jpg", kind: "photo", aspect: 1.5 },
    {
      file: "entry_1/assets/hero_0.jpg",
      kind: "hero",
      aspect: 3.1,
      layers: { bg: "", mid: "", fg: "" },
    },
  ];
  const n = await upscaleOldStills(f.d, {
    headline: "Vice City",
    episodeDir: "/ep",
    images,
  });
  assert.equal(n, 1);
  assert.deepEqual(f.asked, [["entry_1/assets/header_2.jpg"]]);
  assert.equal(images[0]!.file, "assets/up/header_2.jpg.png");
  assert.equal(images[0]!.upscaledFrom, "entry_1/assets/header_2.jpg");
  assert.equal(f.events[0]!.kind, "upscale_stills");
  assert.match(f.notices[0]!, /UPSCALE/);
  // Off: nothing asked, nothing changed.
  const g = fakes(cfg({ upscale: false }));
  assert.equal(
    await upscaleOldStills(g.d, {
      headline: "x",
      episodeDir: "/ep",
      images: [{ file: "a.jpg", kind: "header", aspect: 2 }],
    }),
    0,
  );
  assert.equal(g.asked.length, 0);
});

test("the 3D photo maps are made for the candidates only, attached to their layers and told to the owner", async () => {
  const f = fakes(cfg());
  const L = () => ({ bg: "", mid: "", fg: "" });
  const images: DepthImage[] = [
    { file: "a.jpg", kind: "hero", aspect: 1.78, beatIndex: 0, layers: L() },
    {
      file: "b.jpg",
      kind: "screenshot",
      aspect: 1.78,
      beatIndex: 0,
      layers: L(),
    },
    { file: "c.jpg", kind: "photo", aspect: 1.5, beatIndex: 0, layers: L() },
  ];
  assert.equal(
    await meshStills(f.d, { headline: "Vice City", episodeDir: "/ep", images }),
    1,
  );
  assert.deepEqual(f.asked, [["a.jpg"]]);
  assert.equal(images[0]!.layers!.mesh!.pivot, 0.8);
  assert.equal(images[1]!.layers!.mesh, undefined);
  assert.equal(f.events[0]!.kind, "depth_mesh");
  assert.match(f.notices[0]!, /3D/);
  // Made already: not asked again. Both crafts off: nothing at all.
  assert.equal(
    await meshStills(f.d, { headline: "x", episodeDir: "/ep", images }),
    0,
  );
  const g = fakes(cfg({ depthOrbit: false, subjectPop: false }));
  assert.equal(
    await meshStills(g.d, {
      headline: "x",
      episodeDir: "/ep",
      images: [{ ...images[0]!, layers: L() }],
    }),
    0,
  );
  assert.equal(g.asked.length, 0);
});

test("the footage pass logs and tells the owner, cap included; off or without models it does nothing", async () => {
  const f = fakes(cfg());
  const r = await upscaleOldFootage(f.d, {
    headline: "Vice City",
    episodeDir: "/ep",
    clips: [{ file: "entry_2/assets/ff_2_0.mp4", durationSeconds: 4 }],
  });
  assert.equal(r?.upscaled, 4);
  assert.equal(f.events[0]!.kind, "upscale_footage");
  assert.match(f.notices[0]!, /4 old gameplay clips \(18 s of footage\)/);
  assert.match(f.notices[0]!, /UPSCALE_MAX_SECONDS/);
  assert.doesNotMatch(f.notices[0]!, /—/); // no em dashes in the owner's notices
  const g = fakes(cfg({ upscaleModelDir: "" }));
  assert.equal(
    await upscaleOldFootage(g.d, {
      headline: "x",
      episodeDir: "/ep",
      clips: [{ file: "a.mp4", durationSeconds: 3 }],
    }),
    undefined,
  );
  assert.equal(g.events.length, 0);
  assert.match(
    footageNotice(
      "X",
      {
        upscaled: 1,
        cached: 0,
        overBudget: 0,
        failed: 0,
        footageSeconds: 3,
        gpuSeconds: 2,
      },
      "anime",
    ),
    /1 old gameplay clip \(/,
  );
});
