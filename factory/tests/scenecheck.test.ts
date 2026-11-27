import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./helpers.ts";
import {
  checkClip,
  checkTimes,
  confirmedBy,
  localSceneReview,
  namedSubjects,
  SUBJECT_CONFIDENCE,
} from "../src/assets/scenecheck.ts";
import {
  subjectAnswer,
  subjectFrames,
  subjectPrompt,
} from "../src/assets/localvision.ts";
import { loadConfig } from "../src/config.ts";
import type { Candidate, FootageTarget } from "../src/assets/clipscore.ts";

const GAME = "The Legend of Zelda: Ocarina of Time";
const t = (
  key: string,
  text: string,
  keywords: string[] = [],
): FootageTarget => ({
  key,
  text,
  want: "cinematic",
  energy: "medium",
  keywords,
});

test("named subjects: the index's names found in a line, longest first, never the game's own title", () => {
  const known = [
    "Link",
    "Ganondorf",
    "Hyrule",
    "Hyrule Castle",
    "Princess Zelda",
    "Zelda",
    "Ocarina of Time",
    "Epona",
  ];
  assert.deepEqual(
    namedSubjects(
      t("beat:0", "Ganondorf rises over Hyrule Castle"),
      known,
      GAME,
    ),
    ["Hyrule Castle", "Ganondorf"],
  );
  // "Zelda" inside "Princess Zelda" is one name, not two; the game's title is not a subject.
  assert.deepEqual(
    namedSubjects(
      t("beat:1", "Princess Zelda plays the Ocarina of Time"),
      known,
      GAME,
    ),
    ["Princess Zelda"],
  );
  assert.deepEqual(
    namedSubjects(t("beat:2", "The sales doubled in four days"), known, GAME),
    [],
  );
  // Keywords count, possessives too.
  assert.deepEqual(
    namedSubjects(
      t("beat:3", "Her horse waits at the ranch", ["Epona's"]),
      known,
      GAME,
    ),
    ["Epona"],
  );
});

test("named subjects without a list: a line's capitalised names, not its first word or the game", () => {
  assert.deepEqual(
    namedSubjects(
      t("beat:0", "Then Princess Zelda warns you about Ganondorf."),
      [],
      GAME,
    ),
    ["Princess Zelda", "Ganondorf"],
  );
  assert.deepEqual(
    namedSubjects(
      t("beat:1", "So you start in Kokiri Forest"),
      [],
      "Ocarina of Time",
    ),
    ["Kokiri Forest"],
  );
  assert.deepEqual(
    namedSubjects(
      t("beat:2", "Ocarina of Time sold well."),
      [],
      "Ocarina of Time",
    ),
    [],
  );
});

test("the picture check: the frame on the word and most of the clip must show the subject", () => {
  const yes = { shows: true, confidence: 0.9, seen: "Ganondorf" };
  const no = { shows: false, confidence: 0.1, seen: "a hall" };
  const unsure = {
    shows: true,
    confidence: SUBJECT_CONFIDENCE - 0.01,
    seen: "a man",
  };
  assert.equal(confirmedBy([yes, yes, no]), true);
  assert.equal(
    confirmedBy([no, yes, yes]),
    false,
    "the frame on the word must show it",
  );
  assert.equal(confirmedBy([yes, no, no]), false);
  assert.equal(
    confirmedBy([yes, unsure, undefined]),
    false,
    "an unsure or unjudged frame counts against",
  );
  assert.equal(confirmedBy([]), false);
  assert.deepEqual(checkTimes(4.8), [0.15, 2.4, 4.45]);
  assert.deepEqual(checkTimes(1.6), [0.15, 0.8, 1.25]);
});

test("the subject answer and prompt", () => {
  assert.deepEqual(
    subjectAnswer({ shows: true, confidence: 85, seen: "a red-haired man" }),
    {
      shows: true,
      confidence: 0.85,
      seen: "a red-haired man",
    },
  );
  assert.equal(subjectAnswer({ confidence: 1 }), undefined);
  assert.equal(subjectAnswer({ shows: false, confidence: "x" })!.confidence, 0);
  const p = subjectPrompt({
    game: GAME,
    line: "Ganondorf rises",
    names: ["Ganondorf"],
  });
  assert.match(p, /Ocarina of Time/);
  assert.match(p, /at least one of Ganondorf/);
});

test("under test the local model is never called: nothing is confirmed", async () => {
  assert.deepEqual(
    await subjectFrames(["a.jpg", "b.jpg"], {
      game: GAME,
      line: "x",
      names: ["Link"],
    }),
    [undefined, undefined],
  );
  const dir = await tmpDir();
  const clip = path.join(dir, "clip.mp4");
  await fs.writeFile(clip, "x");
  const r = await checkClip(
    clip,
    4.8,
    { game: GAME, line: "Link", names: ["Link"] },
    {
      grab: async (_f, times, d) => {
        const files = times.map((_, i) => path.join(d, `f${i}.jpg`));
        for (const f of files) await fs.writeFile(f, "j");
        return files;
      },
    },
  );
  assert.equal(r.ok, false);
  assert.deepEqual(
    await fs.readdir(dir),
    ["clip.mp4"],
    "the check's frames are cleaned up",
  );
});

test("checkClip asks about the clip's own frames and passes the line and names", async () => {
  const dir = await tmpDir();
  const clip = path.join(dir, "clip.mp4");
  let got: unknown;
  const r = await checkClip(
    clip,
    3,
    { game: GAME, line: "Ganondorf rises", names: ["Ganondorf"] },
    {
      grab: async (_f, times) => times.map((x) => `${x}.jpg`),
      look: async (files, ask) => {
        got = { files, ask };
        return files.map(() => ({
          shows: true,
          confidence: 0.8,
          seen: "Ganondorf",
        }));
      },
    },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(got, {
    files: ["0.15.jpg", "1.5.jpg", "2.65.jpg"],
    ask: { game: GAME, line: "Ganondorf rises", names: ["Ganondorf"] },
  });
});

test("the local scene reviewer: the surest yes among a section's frames, nothing for an unnamed line", async () => {
  const frames: Candidate[] = [0, 1, 2].map((i) => ({
    index: 10 + i,
    movie: 0,
    time: i * 2,
    luma: 80,
    motion: 5,
    frame: `f${i}.jpg`,
  }));
  const review = localSceneReview(GAME, {
    look: async (files) =>
      files.map((f) =>
        f === "f1.jpg"
          ? { shows: true, confidence: 0.95, seen: "Ganondorf on horseback" }
          : f === "f2.jpg"
            ? { shows: true, confidence: 0.7, seen: "a man" }
            : { shows: false, confidence: 0.2, seen: "a field" },
      ),
  });
  const picks = await review(
    [t("beat:0", "Ganondorf rides out of Hyrule Castle")],
    frames,
  );
  assert.equal(picks.length, 1);
  assert.deepEqual(
    [picks[0]!.key, picks[0]!.candidate, picks[0]!.confidence],
    ["beat:0", 11, 0.95],
  );
  assert.match(picks[0]!.reason, /local picture check/);
  assert.deepEqual(
    await review([t("beat:1", "the sales doubled")], frames),
    [],
  );
  const none = localSceneReview(GAME, {
    look: async (files) =>
      files.map(() => ({ shows: false, confidence: 0.9, seen: "" })),
  });
  assert.deepEqual(
    await none([t("beat:0", "Ganondorf rides out")], frames),
    [],
  );
});

test("settings: the scene search and the picture check are off unless asked for, even with cutscene footage on", () => {
  const keep = { ...process.env };
  try {
    process.env.CUTSCENE_FOOTAGE = "true";
    delete process.env.CUTSCENE_SCENES;
    delete process.env.SCENE_MATCH;
    const off = loadConfig();
    assert.equal(off.cutsceneScenes, false);
    assert.equal(off.sceneMatch, false);
    process.env.CUTSCENE_SCENES = "true";
    process.env.SCENE_MATCH = "true";
    const on = loadConfig();
    assert.equal(on.cutsceneScenes, true);
    assert.equal(on.sceneMatch, true);
  } finally {
    process.env = keep;
  }
});
