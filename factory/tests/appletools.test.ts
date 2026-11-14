import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipCrop,
  cropAt,
  cropPosition,
  cropWindow,
  frameTarget,
  smoothPath,
  type FrameBoxes,
  type VisionBox,
} from "../src/render/smartcrop.ts";
import {
  appleVisionCommand,
  parseBoxes,
  usableLift,
} from "../src/assets/applevision.ts";
import {
  HW_QUALITY,
  hwEncodeOn,
  intermediateVideoArgs,
} from "../src/lib/videoenc.ts";
import { focusPosition } from "../src/render/components/Background.tsx";
import { loadConfig } from "../src/config.ts";

const box = (x: number, w: number, c = 0.8, y = 0.1, h = 0.7): VisionBox => ({
  x,
  y,
  w,
  h,
  c,
});
const finds = (o: Partial<FrameBoxes>): FrameBoxes => ({
  salient: [],
  objects: [],
  humans: [],
  faces: [],
  animals: [],
  ...o,
});

test("the upright window on a 16:9 clip: the cover crop keeps 31.6% of the width, 25.5% once zoomed", () => {
  const w = cropWindow(16 / 9);
  assert.ok(Math.abs(w.cover - 0.3164) < 1e-3);
  assert.ok(Math.abs(w.view - 0.3164 / 1.24) < 1e-3);
  assert.ok(
    Math.abs(w.lo - w.cover / 2) < 1e-9 &&
      Math.abs(w.hi - (1 - w.cover / 2)) < 1e-9,
  );
  // A picture already upright has nothing to pan across.
  assert.equal(cropWindow(9 / 16).cover, 1);
});

test("the crop's object-position matches the stills' focus rule and clamps at the edges", () => {
  const image = { src: "", kind: "hero", aspect: 16 / 9, focusX: 0.3 };
  const css = cropPosition(16 / 9, 0.3);
  assert.equal(
    css.split(" ")[0]!.slice(0, 4),
    focusPosition(image)!.split(" ")[0]!.slice(0, 4),
  );
  assert.equal(cropPosition(16 / 9, 0), "0.00% 46%");
  assert.equal(cropPosition(16 / 9, 1), "100.00% 46%");
  assert.equal(cropPosition(16 / 9, 0.5), "50.00% 46%");
  assert.equal(cropPosition(0.5, 0.2), "50% 46%");
});

test("a person outweighs a big blob of saliency, and nothing found means no target", () => {
  const view = cropWindow(16 / 9).view;
  assert.equal(frameTarget(finds({}), view), undefined);
  const t = frameTarget(
    finds({ salient: [box(0.5, 0.45, 0.5)], humans: [box(0.1, 0.2, 0.9)] }),
    view,
  )!;
  assert.ok(Math.abs(t - 0.2) < 1e-9, `aimed at the person, got ${t}`);
});

test("two finds that fit in the window are framed together; a second person too far away is left out", () => {
  const view = cropWindow(16 / 9).view;
  const together = frameTarget(
    finds({ humans: [box(0.3, 0.1), box(0.42, 0.1)] }),
    view,
  )!;
  assert.ok(Math.abs(together - 0.41) < 1e-9);
  const apart = frameTarget(
    finds({ humans: [box(0.1, 0.12, 0.9), box(0.8, 0.1, 0.6)] }),
    view,
  )!;
  assert.ok(Math.abs(apart - 0.16) < 1e-9);
});

test("a face inside a person wider than the window stays whole in the crop", () => {
  const view = cropWindow(16 / 9).view;
  const person = box(0, 0.4, 0.9, 0.05, 0.9);
  const face = box(0.3, 0.08, 0.8, 0.15, 0.15);
  const t = frameTarget(finds({ humans: [person], faces: [face] }), view)!;
  assert.ok(
    t - view / 2 <= face.x && t + view / 2 >= face.x + face.w,
    `face cut at ${t}`,
  );
  // With no face the crop sits on the person's middle.
  assert.ok(
    Math.abs(frameTarget(finds({ humans: [person] }), view)! - 0.2) < 1e-9,
  );
});

test("the camera holds still for jitter, pans no faster than its limit, and cuts with the shot", () => {
  const o = {
    lo: 0.16,
    hi: 0.84,
    maxSpeed: 0.3,
    deadzone: 0.03,
    cutJump: 0.18,
  };
  const still = smoothPath(
    [0.5, 0.51, 0.49, 0.52, 0.5].map((x, i) => ({ t: i / 4, x })),
    o,
  )!;
  for (const [, x] of still) assert.ok(Math.abs(x - 0.5) < 0.006);
  // A steady drift of 0.04 every quarter second is followed at no more than 0.3 a second.
  const drift = smoothPath(
    Array.from({ length: 12 }, (_, i) => ({ t: i / 4, x: 0.3 + i * 0.04 })),
    o,
  )!;
  for (let i = 1; i < drift.length; i++)
    assert.ok(
      drift[i]![1] - drift[i - 1]![1] <= 0.3 / 4 + 1e-6,
      `too fast at ${i}`,
    );
  assert.ok(drift.at(-1)![1] > drift[0]![1] + 0.2, "it follows");
  // A lasting jump (a cut) is taken at once, not panned across.
  const cut = smoothPath(
    [0.25, 0.25, 0.25, 0.7, 0.7, 0.7].map((x, i) => ({ t: i / 4, x })),
    o,
  )!;
  assert.ok(
    Math.abs(cut[3]![1] - 0.7) < 1e-6 && Math.abs(cut[2]![1] - 0.25) < 1e-6,
  );
  // A one-frame flicker is voted out.
  const flick = smoothPath(
    [0.4, 0.4, 0.8, 0.4, 0.4].map((x, i) => ({ t: i / 4, x })),
    o,
  )!;
  for (const [, x] of flick) assert.ok(Math.abs(x - 0.4) < 1e-6);
});

test("gaps take the last subject, the path stays in bounds, and no subject at all keeps the centre crop", () => {
  const o = { lo: 0.16, hi: 0.84 };
  const p = smoothPath(
    [{ t: 0 }, { t: 0.25, x: 0.05 }, { t: 0.5 }, { t: 0.75, x: 0.05 }],
    o,
  )!;
  assert.equal(p.length, 4);
  for (const [, x] of p) assert.equal(x, 0.16);
  assert.equal(smoothPath([{ t: 0 }, { t: 0.25 }], o), undefined);
  assert.equal(clipCrop(16 / 9, [{ t: 0 }, { t: 0.25 }]), undefined);
  assert.equal(
    clipCrop(9 / 16, [{ t: 0, boxes: finds({ humans: [box(0.1, 0.2)] }) }]),
    undefined,
  );
});

test("the crop between samples is a straight line, held before the first and after the last", () => {
  const path: Array<[number, number]> = [
    [0, 0.3],
    [1, 0.5],
    [2, 0.5],
  ];
  assert.equal(cropAt(path, -1), 0.3);
  assert.ok(Math.abs(cropAt(path, 0.5) - 0.4) < 1e-9);
  assert.equal(cropAt(path, 5), 0.5);
  assert.equal(cropAt([], 1), 0.5);
});

test("a clip's crop from real-shaped finds: the subject left of centre is followed", () => {
  const frames = Array.from({ length: 8 }, (_, i) => ({
    t: i / 4,
    boxes: finds({
      humans: [box(0.12, 0.18, 0.9)],
      salient: [box(0.05, 0.7, 0.5)],
    }),
  }));
  const crop = clipCrop(16 / 9, frames)!;
  assert.equal(crop.path.length, 8);
  for (const [, x] of crop.path) assert.ok(Math.abs(x - 0.21) < 1e-3);
});

test("the Vision helper's output is parsed by file; a picture it could not read is skipped", () => {
  const raw = JSON.stringify({
    results: [
      {
        file: "/a.jpg",
        width: 640,
        height: 360,
        salient: [box(0.1, 0.2)],
        humans: [],
      },
      { file: "/b.jpg", width: 0, height: 0, error: "cannot open image" },
    ],
  });
  const m = parseBoxes(raw);
  assert.deepEqual([...m.keys()], ["/a.jpg"]);
  assert.equal(m.get("/a.jpg")!.salient.length, 1);
  assert.deepEqual(m.get("/a.jpg")!.faces, []);
});

test("the Vision helper runs only on the Mac, through the picture-text Python", () => {
  assert.equal(appleVisionCommand("win32", "boxes", "l.json"), undefined);
  const c = appleVisionCommand("darwin", "lift", "l.json", "/py")!;
  assert.equal(c.cmd, "/py");
  assert.equal(c.args[0], "-I");
  assert.ok(c.args[1]!.endsWith("applevision.py"));
  assert.deepEqual(c.args.slice(2), ["lift", "l.json"]);
});

test("a lift is used only when it caught a subject: not nothing, not a speck, not the whole picture", () => {
  assert.equal(usableLift(undefined), false);
  assert.equal(usableLift({ src: "a", out: "b", ok: false }), false);
  assert.equal(
    usableLift({ src: "a", out: "b", ok: true, share: 0.01 }),
    false,
  );
  assert.equal(
    usableLift({ src: "a", out: "b", ok: true, share: 0.95 }),
    false,
  );
  assert.equal(
    usableLift({ src: "a", out: "b", ok: true, share: 0.37, x: 0.54 }),
    true,
  );
});

test("in-between encodes: libx264 as before unless APPLE_HW_ENCODE is on, on the Mac", () => {
  assert.deepEqual(intermediateVideoArgs({ crf: 17, preset: "fast" }, false), [
    "-c:v",
    "libx264",
    "-crf",
    "17",
    "-preset",
    "fast",
  ]);
  assert.deepEqual(
    intermediateVideoArgs({ crf: 17, preset: "fast" }, true).slice(0, 4),
    ["-c:v", "h264_videotoolbox", "-q:v", String(HW_QUALITY)],
  );
  assert.equal(hwEncodeOn("darwin", { APPLE_HW_ENCODE: "true" }), true);
  assert.equal(hwEncodeOn("darwin", {}), false);
  assert.equal(hwEncodeOn("win32", { APPLE_HW_ENCODE: "true" }), false);
  assert.equal(
    hwEncodeOn("darwin", {
      APPLE_HW_ENCODE: "true",
      NODE_TEST_CONTEXT: "child",
    }),
    false,
  );
  // Under the test runner the default is always libx264.
  assert.equal(
    intermediateVideoArgs({ crf: 18, preset: "veryfast" })[1],
    "libx264",
  );
});

test("all three Apple settings are off unless switched on", () => {
  const keys = ["APPLE_SMART_CROP", "APPLE_SUBJECT_LIFT", "APPLE_HW_ENCODE"];
  const saved = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  try {
    const cfg = loadConfig();
    assert.equal(cfg.appleSmartCrop, false);
    assert.equal(cfg.appleSubjectLift, false);
    assert.equal(cfg.appleHwEncode, false);
  } finally {
    keys.forEach((k, i) => {
      if (saved[i] !== undefined) process.env[k] = saved[i];
    });
  }
});
