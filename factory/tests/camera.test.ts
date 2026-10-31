import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowed,
  CAMERA_TECHNIQUES,
  cameraInputs,
  cameraNotice,
  emotionScale,
  flickerStep,
  freezeSource,
  isPerson,
  parseCameraSetting,
  planCamera,
  spacingFrames,
  trackScale,
  TRACK_LAND,
  TRACK_PEAK,
  whipOffset,
  type CameraInput,
  type CameraShot,
} from "../src/render/camera.ts";
import { moveTransform, twoStageProgress } from "../src/render/motion.ts";
import {
  isLogo,
  parseOcrOutput,
  pickTextDetails,
  textBox,
} from "../src/assets/ocr.ts";

const FPS = 30;

/** Shots of `len` frames back to back, alternating footage and wide stills, all one chapter. */
function shotsOf(
  n: number,
  len: number,
  type: "mixed" | "clip" | "image" = "mixed",
): CameraShot[] {
  return Array.from({ length: n }, (_, i) => ({
    start: i * len,
    end: (i + 1) * len,
    segment: 1,
    media: {
      type: type === "mixed" ? (i % 2 ? "image" : "clip") : type,
      index: i,
    },
  }));
}
const wideImages = (n: number, layers = false) =>
  Array.from({ length: n }, () => ({
    kind: "screenshot",
    aspect: 16 / 9,
    layers: layers ? {} : undefined,
  }));

function input(over: Partial<CameraInput> = {}): CameraInput {
  return {
    shots: shotsOf(120, 150),
    images: wideImages(120),
    chapterOf: () => 0,
    fps: FPS,
    enabled: [...CAMERA_TECHNIQUES],
    variant: 0,
    ...over,
  };
}

test("DOC_CAMERA: all by default, off turns everything off, a list picks and -name removes", () => {
  assert.deepEqual(parseCameraSetting(undefined), [...CAMERA_TECHNIQUES]);
  assert.deepEqual(parseCameraSetting(""), [...CAMERA_TECHNIQUES]);
  assert.deepEqual(parseCameraSetting("off"), []);
  assert.deepEqual(parseCameraSetting("none"), []);
  assert.deepEqual(parseCameraSetting("whip, track,bogus"), ["track", "whip"]);
  assert.deepEqual(
    parseCameraSetting("all,-whip,-lens"),
    CAMERA_TECHNIQUES.filter((t) => t !== "whip" && t !== "lens"),
  );
  assert.deepEqual(parseCameraSetting("TwoStage"), ["twoStage"]);
});

test("the rules: never the same technique twice in a row, spaced out, a minimum gap and a per-minute cap", () => {
  const ev = (kind: "track" | "whip" | "rack" | "twoStage", s: number) => ({
    kind,
    frame: s * FPS,
    shot: 0,
  });
  // Twice in a row (nothing between, within 90 s) is refused either side.
  assert.equal(allowed([ev("rack", 300)], "rack", 360 * FPS, FPS), false);
  assert.equal(allowed([ev("rack", 400)], "rack", 330 * FPS, FPS), false);
  // Another move between them breaks the run, but the technique's own spacing still holds (rack: 40 s).
  assert.equal(
    allowed([ev("rack", 300), ev("track", 320)], "rack", 335 * FPS, FPS),
    false,
  );
  assert.equal(
    allowed([ev("rack", 300), ev("track", 320)], "rack", 345 * FPS, FPS),
    true,
  );
  // Minutes apart with nothing between is not "in a row".
  assert.equal(allowed([ev("rack", 300)], "rack", 500 * FPS, FPS), true);
  // Later in the video two moves need 8 s between them; the first three minutes only 4.
  assert.equal(allowed([ev("track", 300)], "rack", 306 * FPS, FPS), false);
  assert.equal(allowed([ev("track", 100)], "rack", 105 * FPS, FPS), true);
  // At most 3 moves in a minute later, 5 early.
  const later = [ev("track", 300), ev("rack", 310), ev("whip", 320)];
  assert.equal(allowed(later, "detail", 335 * FPS, FPS), false);
  const early = [
    ev("track", 20),
    ev("rack", 26),
    ev("whip", 32),
    ev("track", 50),
  ];
  assert.equal(allowed(early, "detail", 60 * FPS, FPS), true);
  // The ambient two-stage drift never counts against the gap or the cap.
  assert.equal(allowed(later, "twoStage", 335 * FPS, FPS), true);
  // The opening's spacing is tighter.
  assert.ok(
    spacingFrames("track", 60 * FPS, FPS) <
      spacingFrames("track", 600 * FPS, FPS),
  );
});

test("a plan keeps its own rules: no technique twice in a row, the caps hold, the opening is busier", () => {
  const plan = planCamera(input({ images: wideImages(120, true) }));
  assert.ok(plan.events.length > 10);
  const loud = plan.events.filter((e) => e.kind !== "twoStage");
  for (let k = 1; k < plan.events.length; k++) {
    const a = plan.events[k - 1]!;
    const b = plan.events[k]!;
    assert.ok(
      !(a.kind === b.kind && b.frame - a.frame < 90 * FPS),
      `${a.kind} twice in a row at ${b.frame}`,
    );
  }
  for (const e of loud) {
    const early = e.frame < 180 * FPS;
    const n = loud.filter(
      (x) => x.frame > e.frame - 60 * FPS && x.frame <= e.frame,
    ).length;
    assert.ok(n <= (early ? 5 : 3), `${n} moves in the minute to ${e.frame}`);
  }
  const perMinute = (from: number, to: number) =>
    loud.filter((e) => e.frame >= from * FPS && e.frame < to * FPS).length /
    ((to - from) / 60);
  assert.ok(
    perMinute(0, 180) > perMinute(180, 600),
    "the first three minutes cut tighter",
  );
  // Whips are used sparingly: never more than one a minute.
  const whips = plan.events.filter((e) => e.kind === "whip");
  for (let k = 1; k < whips.length; k++)
    assert.ok(whips[k]!.frame - whips[k - 1]!.frame >= 36 * FPS);
});

test("each technique sits behind the setting, and off means no moves at all", () => {
  assert.equal(planCamera(input({ enabled: [] })).events.length, 0);
  const only = planCamera(input({ enabled: ["track"] }));
  assert.ok(only.events.length > 0);
  assert.ok(only.events.every((e) => e.kind === "track"));
  assert.equal(only.lens, false);
  assert.equal(planCamera(input({ enabled: ["lens", "boil"] })).lens, true);
  assert.equal(planCamera(input({ enabled: ["lens", "boil"] })).boil, true);
});

test("cuts move only where they will be seen: not into prints, plates, dressed shots, quiet spans or explainers", () => {
  const shots = shotsOf(6, 150, "image");
  const images = [
    { kind: "screenshot", aspect: 1.78 },
    { kind: "photo", aspect: 1.5 },
    { kind: "screenshot", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78 },
  ];
  const plan = planCamera(
    input({
      shots,
      images,
      enabled: ["track"],
      dressed: new Set([3]),
      explainers: [{ from: 740, to: 760 }],
    }),
  );
  // 1 and 2 touch the photo; 3 and 4 the dressed shot; 5 sits under an explainer.
  assert.deepEqual([...plan.cuts.keys()], []);
  const open = planCamera(
    input({
      shots,
      images: wideImages(6),
      enabled: ["track"],
      quiet: [{ from: 0, to: 400 }],
    }),
  );
  assert.ok([...open.cuts.keys()].every((i) => shots[i]!.start > 400));
});

test("a whip only joins two shots of one chapter, and like to like", () => {
  const shots = shotsOf(40, 150, "clip").map((s, i) => ({ ...s, segment: i }));
  const across = planCamera(
    input({ shots, enabled: ["whip"], chapterOf: (seg) => seg }),
  );
  assert.equal(across.cuts.size, 0);
  const mixed = planCamera(
    input({ shots: shotsOf(40, 150, "mixed"), enabled: ["whip"] }),
  );
  assert.equal(mixed.cuts.size, 0);
  const same = planCamera(
    input({ shots, enabled: ["whip"], chapterOf: () => 2 }),
  );
  assert.ok(same.cuts.size > 0);
  assert.ok([...same.cuts.values()].every((c) => c.kind === "whip"));
});

test("a named detail gets a hand-drawn mark, never a face, and circle and arrow take turns", () => {
  const shots = shotsOf(40, 300, "image");
  const details = [
    { id: 0, shot: 2, at: 2 * 300 + 30, face: false },
    { id: 1, shot: 10, at: 10 * 300 + 30, face: true },
    { id: 2, shot: 20, at: 20 * 300 + 30, face: false },
  ];
  const plan = planCamera(
    input({ shots, images: wideImages(40), enabled: ["detail"], details }),
  );
  assert.equal(plan.details.get(0), "circle");
  assert.equal(plan.details.has(1), false);
  assert.equal(plan.details.get(2), "arrow");
  // A shot with any detail keeps its push: no other move inside it.
  const all = planCamera(
    input({ shots, images: wideImages(40, true), details }),
  );
  for (const d of details) assert.equal(all.shots.has(d.shot), false);
});

test("the writer's beats push in on a reveal and pull out on a quiet line", () => {
  const shots = shotsOf(20, 300, "image");
  const beats = [
    { kind: "reveal", at: 3 * 300 + 40 },
    { kind: "quiet", at: 12 * 300 + 40 },
    { kind: "turn", at: 16 * 300 + 40 },
  ];
  const plan = planCamera(
    input({ shots, images: wideImages(20), enabled: ["emotion"], beats }),
  );
  assert.deepEqual(plan.shots.get(3), {
    kind: "emotion",
    at: 3 * 300 + 40,
    push: true,
  });
  assert.deepEqual(plan.shots.get(12), {
    kind: "emotion",
    at: 12 * 300 + 40,
    push: false,
  });
  assert.equal(plan.shots.has(16), false);
  assert.ok(emotionScale(200, 40, true, FPS) > 1.05);
  assert.ok(emotionScale(200, 40, false, FPS) < 1);
  assert.equal(emotionScale(20, 40, true, FPS), 1);
});

test("a freeze lands on footage a beat after the cut, then the clip plays on from where it held", () => {
  const shots = shotsOf(10, 300, "clip");
  const plan = planCamera(
    input({
      shots,
      enabled: ["freeze"],
      freezeCues: [{ at: 3 * 300, label: "Vice City" }],
    }),
  );
  const m = plan.shots.get(3);
  assert.equal(m?.kind, "freeze");
  assert.ok(m?.kind === "freeze" && m.at > 3 * 300 && m.label === "Vice City");
  assert.equal(freezeSource(10, 40, 54), 10);
  assert.equal(freezeSource(60, 40, 54), 40);
  assert.equal(freezeSource(100, 40, 54), 46);
  // A cue in an earlier shot is never dragged into this one.
  const none = planCamera(
    input({
      shots,
      enabled: ["freeze"],
      freezeCues: [{ at: 299, label: "x" }],
    }),
  );
  assert.equal(none.shots.size, 0);
});

test("depth moves only on layered stills, and the vertigo push only on key art", () => {
  const shots = shotsOf(20, 200, "image");
  const shotsKinds = Array.from({ length: 20 }, () => ({
    kind: "screenshot",
    aspect: 1.78,
    layers: {},
  }));
  const screens = planCamera(
    input({ shots, images: shotsKinds, enabled: ["dolly", "rack"] }),
  );
  assert.ok([...screens.shots.values()].every((m) => m.kind === "rack"));
  assert.ok(screens.shots.size > 0);
  const art = planCamera(
    input({
      shots,
      images: shotsKinds.map((x) => ({ ...x, kind: "hero" })),
      enabled: ["dolly"],
    }),
  );
  assert.ok([...art.shots.values()].some((m) => m.kind === "dolly"));
  const flat = planCamera(
    input({ shots, images: wideImages(20), enabled: ["dolly", "rack"] }),
  );
  assert.equal(flat.shots.size, 0);
});

test("transitions: the push accelerates into the cut and carries on through it; the whip leaves and lands", () => {
  const cut = { kind: "track" as const, dir: 1 as const, frames: 9 };
  assert.equal(trackScale(50, 100, cut), 1);
  assert.ok(Math.abs(trackScale(100, 100, cut) - TRACK_PEAK) < 1e-9);
  // Full speed either side of the cut: the outgoing shot's last step is its biggest.
  const last = trackScale(99, 100, cut) - trackScale(98, 100, cut);
  const first =
    trackScale(1, 100, undefined, cut) - trackScale(0, 100, undefined, cut);
  assert.ok(last > trackScale(93, 100, cut) - trackScale(92, 100, cut));
  assert.ok(
    first >
      trackScale(8, 100, undefined, cut) - trackScale(7, 100, undefined, cut),
  );
  // The incoming shot only ever grows (the camera never reverses) and rests at TRACK_LAND.
  assert.equal(trackScale(0, 100, undefined, cut), 1);
  assert.ok(Math.abs(trackScale(60, 100, undefined, cut) - TRACK_LAND) < 1e-9);
  const whip = { kind: "whip" as const, dir: 1 as const, frames: 5 };
  assert.ok(whipOffset(99, 100, whip) < -0.25);
  assert.ok(whipOffset(99, 100, whip) < whipOffset(97, 100, whip));
  assert.ok(whipOffset(0, 100, undefined, whip) > 0.4);
  assert.equal(whipOffset(5, 100, undefined, whip), 0);
});

test("two-stage Ken Burns moves, settles and moves again, never jumping", () => {
  assert.equal(twoStageProgress(0), 0);
  assert.equal(twoStageProgress(0.5), 0.5);
  assert.equal(twoStageProgress(0.45), twoStageProgress(0.55));
  assert.equal(twoStageProgress(1), 1);
  for (let p = 0; p < 1; p += 0.01)
    assert.ok(
      Math.abs(twoStageProgress(p + 0.01) - twoStageProgress(p)) < 0.04,
    );
  assert.ok(
    moveTransform("twoStage", 1).scale > moveTransform("twoStage", 0).scale,
  );
  // Two-stage drift goes to long stills only, never footage.
  const plan = planCamera(input({ enabled: ["twoStage"] }));
  assert.ok(plan.moves.size > 0);
  for (const i of plan.moves.keys())
    assert.equal(input().shots[i]!.media.type, "image");
});

test("the texture flicker steps at 12 fps", () => {
  const steps = new Set(
    Array.from({ length: 30 }, (_, f) => flickerStep(f, 30)),
  );
  assert.equal(steps.size, 12);
});

test("camera inputs: freeze cues only where nothing else is drawn, faces found by name", () => {
  const shots: CameraShot[] = [
    { start: 0, end: 300, segment: 0, media: { type: "clip", index: 0 } },
    { start: 300, end: 600, segment: 0, media: { type: "clip", index: 1 } },
    { start: 600, end: 900, segment: 0, media: { type: "image", index: 0 } },
  ];
  const words = [
    { text: "Then", start: 9 },
    { text: "Vice", start: 10.1 },
    { text: "City", start: 10.4 },
    { text: "came.", start: 10.7 },
    { text: "Later", start: 11 },
    { text: "Tommy", start: 12 },
    { text: "Vercetti", start: 12.3 },
  ];
  const none = { kind: "none", primary: "", secondary: "", items: [] };
  const got = cameraInputs({
    shots,
    images: [{ kind: "screenshot", aspect: 1.78 }],
    clips: [
      { beatIndex: 0, moment: 0 },
      { beatIndex: 0, moment: 1 },
    ],
    chapterOf: () => 0,
    fps: FPS,
    enabled: ["freeze", "detail"],
    variant: 0,
    windows: [
      { entry: 0, moment: 1, start: 9, end: 11, at: 10.1 },
      { entry: 0, moment: 2, start: 11, end: 13, at: 12 },
    ],
    moments: [
      [
        { show: "", graphic: none },
        { show: "Vice City streets", graphic: none, emphasis: "" },
        { show: "Tommy Vercetti", graphic: none, person: "Tommy Vercetti" },
      ],
    ],
    words,
    details: [
      { id: 0, shot: 2, from: 640, label: "Tommy Vercetti", k: 1 },
      { id: 1, shot: 2, from: 640, label: "Ocean Drive sign", k: 1 },
    ],
  });
  assert.deepEqual(got.freezeCues, [{ at: 303, label: "Vice City" }]);
  assert.equal(got.details![0]!.face, true);
  assert.equal(got.details![1]!.face, false);
  assert.equal(isPerson("Sam Houser", ["sam houser"]), true);
  assert.equal(isPerson("Ocean Drive", ["Sam Houser"]), false);
});

test("the owner's notice names what the camera does and the setting", () => {
  const line = cameraNotice("Vice City", ["track", "whip", "detail"], 2);
  assert.match(
    line,
    /pushes through the cut, whip pans and hand-drawn circles/,
  );
  assert.match(line, /2 named details/);
  assert.match(line, /DOC_CAMERA/);
  assert.ok(!line.includes(String.fromCharCode(0x2014)), "no long dash");
  assert.match(cameraNotice("Vice City", [], 0), /off/);
});

test("OCR: a phrase is found on consecutive words and boxed; logos and scraps are not", () => {
  const page = {
    width: 1000,
    height: 500,
    words: [
      { text: "Ocean", x: 100, y: 100, w: 80, h: 20 },
      { text: "Drive", x: 190, y: 100, w: 70, h: 20 },
      { text: "GREGGS.", x: 600, y: 300, w: 120, h: 30 },
      { text: "in", x: 10, y: 10, w: 10, h: 10 },
    ],
  };
  const box = textBox(page, "Ocean Drive")!;
  assert.ok(box[0] < 0.1 && box[2] > 0.26 && box[1] < 0.2 && box[3] > 0.24);
  assert.ok(textBox(page, "Greggs"));
  assert.equal(textBox(page, "in"), undefined);
  assert.equal(textBox(page, "Drive Ocean"), undefined);
  assert.equal(
    isLogo("Grand Theft Auto", ["Grand Theft Auto: Vice City"]),
    true,
  );
  assert.equal(isLogo("Ocean Drive", ["Grand Theft Auto: Vice City"]), false);
  const pages = new Map([["a.jpg", page]]);
  const picked = pickTextDetails(
    [
      {
        entry: 0,
        moment: 1,
        image: 3,
        file: "a.jpg",
        keys: ["Vice City", "Ocean Drive"],
        frame: 100,
      },
      {
        entry: 0,
        moment: 2,
        image: 3,
        file: "a.jpg",
        keys: ["Greggs"],
        frame: 200,
      },
      {
        entry: 0,
        moment: 3,
        image: 3,
        file: "a.jpg",
        keys: ["Greggs"],
        frame: 2000,
      },
    ],
    pages,
    ["Vice City"],
    900,
  );
  assert.deepEqual(
    picked.map((p) => [p.moment, p.label]),
    [
      [1, "Ocean Drive"],
      [3, "Greggs"],
    ],
  );
});

test("OCR output from Windows PowerShell parses despite raw control characters and one-word lists", () => {
  const raw =
    '﻿{"results":[{"file":"a.jpg","width":10,"height":5,"words":{"text":"\u0007X","x":1,"y":1,"w":2,"h":2}},{"file":"b.jpg","width":1,"height":1,"words":[]}]}';
  const pages = parseOcrOutput(raw);
  assert.equal(pages.get("a.jpg")!.words.length, 1);
  assert.equal(pages.get("b.jpg")!.words.length, 0);
});
