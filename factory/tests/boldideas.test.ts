import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPARE_MAX,
  DEPTH_TYPE_MAX,
  WALL_MAX,
  compareWipePlan,
  depthTypePlan,
  gameCallNames,
  typeablePhrase,
  wallLayout,
  wallPictures,
  type IdeaImage,
  type IdeaShot,
  type IdeaWindow,
} from "../src/render/boldideas.ts";

const L = { bg: "b", mid: "m", fg: "f" };

test("chapter wall: the chapter's own wide stills first, topped up from the nearest chapters, capped, or none", () => {
  const images: IdeaImage[] = [
    ...Array.from({ length: 3 }, () => ({
      kind: "screenshot",
      aspect: 1.78,
      beatIndex: 2,
    })),
    { kind: "capsule", aspect: 2.1, beatIndex: 2 },
    { kind: "photo", aspect: 1.5, beatIndex: 2 },
    ...Array.from({ length: 3 }, () => ({
      kind: "hero",
      aspect: 1.78,
      beatIndex: 3,
    })),
    ...Array.from({ length: 3 }, () => ({
      kind: "hero",
      aspect: 1.78,
      beatIndex: 9,
    })),
  ];
  const wall = wallPictures(images, 2);
  assert.deepEqual(wall.slice(0, 3), [0, 1, 2]);
  assert.deepEqual(wall.slice(3, 6), [5, 6, 7]);
  assert.ok(!wall.includes(3) && !wall.includes(4));
  assert.equal(new Set(wall).size, wall.length);
  assert.deepEqual(wallPictures(images.slice(0, 5), 2), []);
  const many = Array.from({ length: 30 }, () => ({
    kind: "hero",
    aspect: 1.78,
    beatIndex: 1,
  }));
  assert.equal(wallPictures(many, 1).length, WALL_MAX);
});

test("chapter wall: the layout is the same for the same seed, and every card sits behind the camera's start", () => {
  assert.deepEqual(wallLayout(8, 3), wallLayout(8, 3));
  assert.notDeepEqual(wallLayout(8, 3), wallLayout(8, 4));
  for (const c of wallLayout(12, 5)) assert.ok(c.z <= 0);
});

test("depth type: only one to three words of at most 18 letters are set", () => {
  assert.equal(typeablePhrase("thirteen years."), "thirteen years");
  assert.equal(typeablePhrase("“Vice City”"), "Vice City");
  assert.equal(typeablePhrase("the most expensive game ever made"), undefined);
  assert.equal(typeablePhrase("extraordinarily expensive"), undefined);
  assert.equal(typeablePhrase(""), undefined);
});

const shots: IdeaShot[] = [
  { start: 0, end: 300, media: { type: "image", index: 0 } },
  { start: 300, end: 600, media: { type: "clip", index: 0 } },
  { start: 600, end: 900, media: { type: "image", index: 1 } },
  { start: 900, end: 1200, media: { type: "image", index: 2 } },
  { start: 1200, end: 3000, media: { type: "image", index: 0 } },
];
const images: IdeaImage[] = [
  { kind: "hero", aspect: 1.78, layers: L },
  { kind: "screenshot", aspect: 1.78 },
  { kind: "screenshot", aspect: 1.78, layers: L, wordy: true },
];
const win = (moment: number, at: number): IdeaWindow => ({
  entry: 0,
  moment,
  start: at - 1,
  end: at + 3,
  at,
});

test("depth type: a short stressed phrase on a wide layered still, two seconds left, spaced and capped", () => {
  const ws = [
    win(0, 2),
    win(1, 3),
    win(2, 12),
    win(3, 22),
    win(4, 32),
    win(5, 45),
    win(6, 90),
  ];
  const phrase = () => "thirteen years";
  const plan = depthTypePlan(ws, phrase, shots, images, 30);
  // The opening sentence never; the clip, the flat still and the wordy still never; one per 45 s.
  assert.deepEqual([...plan.keys()], [0, 4]);
  assert.deepEqual(plan.get(0), {
    phrase: "thirteen years",
    window: 1,
    at: 90,
  });
  assert.equal(plan.get(4)!.window, 6);
  // Blocked shots are left alone.
  assert.deepEqual(
    [...depthTypePlan(ws, phrase, shots, images, 30, new Set([0])).keys()],
    [4],
  );
  // Too near the shot's end.
  assert.equal(depthTypePlan([win(1, 9.5)], phrase, shots, images, 30).size, 0);
  // The cap.
  const long: IdeaShot[] = [
    { start: 0, end: 1e6, media: { type: "image", index: 0 } },
  ];
  const wsMany = Array.from({ length: 20 }, (_, k) => win(k + 1, 10 + k * 50));
  const many = depthTypePlan(wsMany, phrase, long, images, 30);
  assert.ok(many.size <= 1);
  const longShots: IdeaShot[] = Array.from({ length: 20 }, (_, k) => ({
    start: k * 1500,
    end: (k + 1) * 1500,
    media: { type: "image", index: 0 },
  }));
  assert.equal(
    depthTypePlan(wsMany, phrase, longShots, images, 30).size,
    DEPTH_TYPE_MAX,
  );
});

test("compare wipe: a comparison naming another chapter's game, both with pictures, one per chapter", () => {
  const games = new Map([
    [0, "Grand Theft Auto: San Andreas"],
    [1, "Grand Theft Auto IV"],
    [2, "Grand Theft Auto V"],
  ]);
  const imgs: IdeaImage[] = [
    { kind: "hero", aspect: 1.78, beatIndex: 0 },
    { kind: "screenshot", aspect: 1.78, beatIndex: 1 },
    { kind: "screenshot", aspect: 1.78, beatIndex: 2 },
  ];
  const words = [
    { start: 10, text: "Liberty" },
    { start: 10.3, text: "City" },
    { start: 10.6, text: "felt" },
    { start: 10.9, text: "smaller" },
    { start: 11.2, text: "than" },
    { start: 11.5, text: "San" },
    { start: 11.8, text: "Andreas." },
    { start: 20, text: "It" },
    { start: 20.3, text: "was" },
    { start: 20.6, text: "huge." },
  ];
  const ws: IdeaWindow[] = [
    { entry: 1, moment: 2, start: 10, end: 15, at: 11 },
    { entry: 1, moment: 3, start: 20, end: 25, at: 20 },
  ];
  const plan = compareWipePlan(ws, words, games, imgs, 30);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0], {
    from: 300,
    len: 120,
    left: 1,
    right: 0,
    leftGame: "Grand Theft Auto IV",
    rightGame: "Grand Theft Auto: San Andreas",
    window: 0,
  });
  // No comparison word, no wipe; a chapter without a picture of the other game, no wipe.
  assert.equal(compareWipePlan([ws[1]!], words, games, imgs, 30).length, 0);
  assert.equal(compareWipePlan(ws, words, games, imgs.slice(1), 30).length, 0);
  assert.ok(COMPARE_MAX >= 1);
});

test("compare wipe: a game is called by its distinctive name, never by the series name the others share", () => {
  assert.deepEqual(gameCallNames("Grand Theft Auto: San Andreas"), [
    "gta san andreas",
    "san andreas",
  ]);
  // "GTA V" folds to "gta v"; "v" alone is too short to count.
  assert.deepEqual(gameCallNames("Grand Theft Auto V"), ["gta v"]);
});

test("compare wipe: a game's name must be written as a name, so an ordinary word never triggers it", () => {
  const games = new Map([
    [0, "Journey"],
    [1, "Grand Theft Auto IV"],
  ]);
  const imgs: IdeaImage[] = [
    { kind: "hero", aspect: 1.78, beatIndex: 0 },
    { kind: "hero", aspect: 1.78, beatIndex: 1 },
  ];
  const ws: IdeaWindow[] = [{ entry: 1, moment: 1, start: 0, end: 5, at: 1 }];
  const say = (line: string) => line.split(" ").map((text, k) => ({ start: k * 0.3, text }));
  assert.equal(compareWipePlan(ws, say("the journey felt longer than before"), games, imgs, 30).length, 0);
  assert.equal(compareWipePlan(ws, say("it felt longer than Journey ever did"), games, imgs, 30).length, 1);
  // "while" is no longer a comparison word.
  assert.equal(compareWipePlan(ws, say("Journey played while the city slept"), games, imgs, 30).length, 0);
});
