import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import {
  NEGATIVE_PROMPT,
  createSketchRun,
  illustratable,
  illustrate,
  namesPerson,
  placeholderPng,
  sceneOf,
  sketchPrompt,
  sketchSeed,
  sketchWorkflow,
} from "../src/assets/illustrate.ts";
import { fillSentencePictures } from "../src/assets/fill.ts";
import { tmpDir } from "./helpers.ts";

const bare = (
  show: string,
  extra: Partial<{
    person: string;
    broll: string;
    graphic: { kind: string; items?: string[] };
  }> = {},
) => ({
  show,
  person: "",
  broll: "",
  graphic: { kind: "none" },
  ...extra,
});

test("a scene nothing filmed can show qualifies; figures, named faces, the game itself and sensitive lines do not", () => {
  const office =
    "The team crammed into a two-room office above a shop in Dundee.";
  assert.equal(
    illustratable(office, bare("DMA Design team at work in the 1990s")),
    true,
  );
  assert.equal(
    illustratable(
      "Each time, the crew had to talk them into letting the work continue.",
      bare("Team pitching to managers in a meeting"),
    ),
    true,
  );
  // The scene must be in the writer's shot note; a stock note alone does not make one.
  assert.equal(
    illustratable(
      "Nobody at the publisher expected the pitch to land that way.",
      bare("the publisher's reaction", { broll: "office meeting" }),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "Nobody at the publisher expected the pitch to land that way.",
      bare("the pitch meeting at the publisher", { broll: "office meeting" }),
    ),
    true,
  );
  // A headcount or a growth figure is a card, not a drawing; a line about race stays on a neutral shot.
  assert.equal(
    illustratable(
      "The core team at Rockstar North numbered 220 people.",
      bare("Rockstar North developers at their desks"),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "The team grew to 75 once the other game came out.",
      bare("Rockstar North team growing"),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "One long-time employee quit in objection to how the studio portrayed African Americans.",
      bare("Empty desk of a departing employee"),
    ),
    false,
  );
  // The game's own city is not a real place to draw.
  assert.equal(
    illustratable(
      "A year later, Rockstar would leave it for somewhere warmer.",
      bare("Palm trees and sunset over Vice City"),
    ),
    false,
  );
  // Already covered, or given a graphic: never.
  assert.equal(illustratable(office, bare("the office"), true), false);
  assert.equal(
    illustratable(office, bare("the office", { graphic: { kind: "map" } })),
    false,
  );
  // A figure is a card, not a drawing.
  assert.equal(
    illustratable(
      "The game sold 17.5 million copies in its first year across the office network.",
      bare("the sales office"),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "The studio's budget rose to $40 million by the time the team moved offices.",
      bare("the new office"),
    ),
    false,
  );
  // A named person's face is never drawn.
  assert.equal(
    illustratable(
      "Sam Houser wanted the office to feel like a film set.",
      bare("the founders' office"),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "He wanted the office to feel like a film set.",
      bare("the founder at work in the office", { person: "Sam Houser" }),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "He wanted the office to feel like a film set.",
      bare("Sam Houser at his desk"),
    ),
    false,
  );
  assert.equal(
    namesPerson("A portrait of the founder", bare("portrait of Dan Houser")),
    true,
  );
  assert.equal(
    namesPerson(
      "The founders' office was above a shop.",
      bare("Vice City at night"),
    ),
    false,
  );
  // The sensitive-line rule of fill.ts: controversy, violence, crime, race, a lawsuit, a tragedy.
  assert.equal(
    illustratable(
      "The lawsuit over the mod reached the studio's office within weeks.",
      bare("the studio office"),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "The team met to decide how to handle the shooting in the game's story.",
      bare("a team meeting"),
    ),
    false,
  );
  // The game itself, hardware, logos and charts have real pictures; a drawing of them would be a fake.
  assert.equal(
    illustratable(
      "They weren't the Grand Theft Auto 2 team at all, in the end.",
      bare("Grand Theft Auto 2 top-down gameplay"),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "Rockstar also offered the game to Microsoft as an Xbox exclusive.",
      bare("Xbox console and Microsoft logo"),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "Reviews were mixed, but sales at the shops weren't.",
      bare("Sales charts rising, game on shelves"),
    ),
    false,
  );
  // The scene is the writer's note: a sentence that mentions the team while talking about the game stays on footage.
  assert.equal(
    illustratable(
      "They unlocked as the story went on, because the team wanted you to feel poor.",
      bare("Locked bridges opening as the story advances"),
    ),
    false,
  );
  assert.equal(
    illustratable(
      "It was the moment everything changed for the series.",
      bare("a turning point"),
    ),
    false,
  );
  assert.equal(illustratable("Too short a line.", bare("the office")), false);
});

test("the prompt is the writer's scene, the sentence, the period and the fixed style and negative", () => {
  const { prompt, negative } = sketchPrompt(
    "And the team crammed into a two-room office above a shop - working through the night.",
    { game: "Grand Theft Auto", year: 1997, place: "Dundee" },
    "DMA Design team at work",
  );
  assert.ok(
    prompt.startsWith(
      "Concept sketch of a scene: DMA Design team at work. The moment: The team crammed into a two-room office above a shop, working through the night.",
    ),
    prompt,
  );
  assert.ok(prompt.includes("Setting: in Dundee, around 1997"));
  assert.ok(prompt.includes("Pencil and ink concept sketch"));
  assert.ok(
    prompt.includes(
      "No text, no letters, no logos, no readable signage, no recognisable real faces",
    ),
  );
  assert.equal(negative, NEGATIVE_PROMPT);
  assert.ok(
    /photograph|photorealistic/.test(negative) &&
      /logo/.test(negative) &&
      /recognisable face/.test(negative),
  );
  // No period line when the chapter has none; a sentence alone when there is no note; quotes go.
  const plain = sketchPrompt(
    'The founders said "no" and went back to their desks.',
    { game: "x" },
  );
  assert.ok(
    plain.prompt.startsWith(
      "Concept sketch of a scene: The founders said no and went back to their desks.",
    ),
  );
  assert.ok(!plain.prompt.includes("Setting:"));
  assert.equal(
    sceneOf("But the two-room office - above a shop — was all they had!"),
    "The two-room office, above a shop, was all they had",
  );
});

test("seeds are deterministic per episode and sentence", () => {
  const a = sketchSeed("ep_1", "The team crammed into an office.");
  assert.equal(a, sketchSeed("ep_1", "The team crammed into an office."));
  assert.equal(a, sketchSeed("ep_1", "the team  crammed into an office"));
  assert.notEqual(a, sketchSeed("ep_2", "The team crammed into an office."));
  assert.notEqual(a, sketchSeed("ep_1", "The team crammed into a garage."));
  assert.ok(Number.isInteger(a) && a >= 0 && a < 2 ** 31);
});

test("the workflow gets only the prompt, negative and seed substituted", async () => {
  const wf = await sketchWorkflow("a sketch", "no photo", 42);
  assert.equal(wf["6"]!.inputs.text, "a sketch");
  assert.equal(wf["7"]!.inputs.text, "no photo");
  assert.equal(wf["3"]!.inputs.seed, 42);
  assert.equal(wf["12"]!.inputs.unet_name, "flux1-dev.safetensors");
  assert.equal(wf["5"]!.inputs.width, 1280);
  assert.ok(!("_comment" in wf));
  // Every node reference points at a node that exists.
  for (const n of Object.values(wf))
    for (const v of Object.values(n.inputs))
      if (Array.isArray(v)) assert.ok(wf[String(v[0])], `node ${v[0]} missing`);
});

test("the stub writes a valid PNG of the sketch size, different per seed", async () => {
  const dir = await tmpDir();
  const file = await illustrate("anything", {
    dest: path.join(dir, "a", "s.png"),
    seed: 7,
    stub: true,
  });
  const png = await fs.readFile(file);
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.readUInt32BE(16), 1280);
  assert.equal(png.readUInt32BE(20), 720);
  const idatLen = png.readUInt32BE(33);
  assert.equal(png.subarray(37, 41).toString("ascii"), "IDAT");
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, (1280 * 3 + 1) * 720);
  assert.notDeepEqual(placeholderPng(1, 128, 96), placeholderPng(2, 128, 96));
  await fs.rm(dir, { recursive: true, force: true });
});

test("the run draws the qualifying bare lines, keeps what the judge passes and holds the cap", async () => {
  const dir = await tmpDir();
  const drawn: string[] = [];
  const draw: typeof illustrate = async (prompt, o) => {
    drawn.push(prompt);
    return illustrate(prompt, { ...o, stub: true });
  };
  // The judge picks sketch 0 for its sentence, sees text on sketch 1 and is unsure about sketch 2.
  const llm = {
    structured: async () => ({
      images: [
        { index: 0, label: "a cramped office at night", has_text: false },
        { index: 1, label: "a studio sign", has_text: true },
        { index: 2, label: "an airport", has_text: false },
      ],
      picks: [
        { key: "m1", image_index: 0, confidence: 0.9 },
        { key: "m3", image_index: 1, confidence: 0.9 },
        { key: "m4", image_index: 2, confidence: 0.3 },
      ],
    }),
  } as never;
  const run = createSketchRun({
    llm,
    dir,
    episodeId: "ep_t",
    url: "http://127.0.0.1:1",
    max: 3,
    stub: true,
    timeoutMs: 1000,
    draw,
  });
  const ch = {
    entry: 2,
    game: "Grand Theft Auto",
    year: 1997,
    place: "Dundee",
    moments: [
      bare("the skyline", { graphic: { kind: "map", items: ["Dundee"] } }),
      bare("the team's two-room office"),
      bare("a sales figure"),
      bare("the founders' new studio"),
      bare("the crew at the airport"),
      bare("the team's new office"),
    ],
    sentences: [
      "Dundee's skyline sits grey over the river Tay this morning.",
      "The team crammed into a two-room office above a shop.",
      "The game sold 2 million copies in its first year.",
      "The founders rented a bigger studio on the edge of town.",
      "The crew flew to the airport with a demo in a bag.",
      "The team moved offices again before the sequel shipped.", // over the cap of 3
    ],
  };
  const images: Array<{
    file: string;
    kind: string;
    beatIndex?: number;
    moment?: number;
    label?: string;
  }> = [];
  const kept = await run.forChapter(ch, [1, 2, 3, 4, 5], images);
  assert.equal(kept, 1);
  assert.equal(drawn.length, 3, "the cap holds");
  assert.ok(
    drawn[0]!.includes("two-room office") &&
      drawn[0]!.includes("in Dundee, around 1997"),
    drawn[0] ?? "",
  );
  assert.deepEqual(
    images.map((i) => [i.kind, i.beatIndex, i.moment, i.label]),
    [["sketch", 2, 1, "a cramped office at night"]],
  );
  assert.equal(images[0]!.file, path.join("entry_2", "fill", "sketch_1.png"));
  assert.ok((await fs.stat(path.join(dir, images[0]!.file))).size > 0);
  // A second chapter gets nothing: the documentary's cap is spent.
  assert.equal(await run.forChapter({ ...ch, entry: 3 }, [1], images), 0);
  assert.deepEqual(run.summary(), {
    asked: 3,
    drawn: 3,
    kept: 1,
    dropped: 2,
    failed: 0,
    seconds: run.summary().seconds,
  });
  await fs.rm(dir, { recursive: true, force: true });
});

test("fill.ts calls the sketch hook after its search and before the graphics pass, on the bare lines only", async () => {
  const calls: Array<{ bare: number[] } | { graphicsAsked: number[] }> = [];
  const llm = {
    structured: async (o: { content: string }) => {
      // The graphics pass: record which sentences it was asked about.
      const asked = [...o.content.matchAll(/^(\d+)\. "/gm)].map((m) =>
        Number(m[1]),
      );
      calls.push({ graphicsAsked: asked });
      return { graphics: [], picks: [], images: [] };
    },
  } as never;
  const deps = {
    llm,
    igdbArt: async () => [],
    searchPhotos: async () => [],
    downloadPhoto: async () => false,
    fetchStock: async () => [],
  };
  const dir = await tmpDir();
  const ch = {
    entry: 0,
    game: "g",
    moments: [bare("a"), bare("b"), bare("c"), bare("d")],
    sentences: [
      "The chapter opens on the skyline of the city.",
      "The team crammed into an office.",
      "A line about the game's hero.",
      "A line the picture search already covered.",
    ],
  };
  const images: Array<{
    file: string;
    kind: string;
    beatIndex?: number;
    moment?: number;
  }> = [{ file: "x.jpg", kind: "screenshot", beatIndex: 0, moment: 3 }];
  const illustrateHook = async (
    _c: unknown,
    bare: number[],
    imgs: typeof images,
  ) => {
    calls.push({ bare });
    imgs.push({
      file: "entry_0/fill/sketch_1.png",
      kind: "sketch",
      beatIndex: 0,
      moment: 1,
    });
    return 1;
  };
  await fillSentencePictures(
    deps,
    dir,
    [ch],
    images,
    [],
    "g",
    undefined,
    illustrateHook,
  );
  // The hook saw the bare lines (not 3, which had a picture); the graphics pass then saw only what was still
  // bare after the sketch (1 is covered; 0 plays under the title card and is never asked about).
  assert.deepEqual(calls, [{ bare: [0, 1, 2] }, { graphicsAsked: [2] }]);
  await fs.rm(dir, { recursive: true, force: true });
});
