// Moving footage in long videos, part two (13 Nov 2026): gathering was the bottleneck once the planner played every
// clip it got. The fans' names for a game in gameplay titles, the 403 retry on YouTube sections, the game's own
// scenes keeping a chapter's allowance before trailers, and the Codex picture check while the PC relay is down.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  gameAliases,
  seriesOf,
  titleNamesGame,
} from "../src/sceneindex/gamenames.ts";
import { canonicalGame, isSeriesName } from "../src/sceneindex/gamefetch.ts";
import { junkSourceReason, namesGame } from "../src/assets/footagefirst.ts";
import { gameplayTitleFits } from "../src/assets/gameplay.ts";
import {
  downloadSectionRetrying,
  sectionAttempts,
  streamRefused,
} from "../src/lib/ytsection.ts";
import { reconcileCutsceneBudgets } from "../src/assets/cutscenes.ts";
import {
  checkClip,
  codexSubjectLook,
  lookSubject,
  setSubjectFallback,
} from "../src/assets/scenecheck.ts";
import { tmpDir } from "./helpers.ts";

const SA = "Grand Theft Auto: San Andreas";

// ---------------------------------------------------------------- the game's names in titles

test("canonicalGame and isSeriesName still come from gamefetch (moved to gamenames, re-exported)", () => {
  assert.equal(canonicalGame("GTA VI"), "grand theft auto 6");
  assert.equal(canonicalGame("GTA:SA"), "grand theft auto sa");
  assert.equal(isSeriesName("GTA"), true);
  assert.equal(seriesOf(SA), "grand theft auto");
  assert.deepEqual(gameAliases(SA), [
    "grand theft auto san andreas",
    "san andreas",
    "grand theft auto sa",
    "gtasa",
  ]);
  assert.deepEqual(gameAliases("Grand Theft Auto"), ["grand theft auto"]);
});

test("a gameplay title may name the game the way fans write it: GTA SA, GTA:SA, San Andreas, GTA 5, GTAV, RDR2", () => {
  for (const t of [
    "GTA SA walkthrough part 1",
    "GTA:SA gameplay",
    "GTASA mission 5",
    "San Andreas walkthrough no commentary",
  ])
    assert.equal(titleNamesGame(t, SA), true, t);
  assert.equal(titleNamesGame("GTA 5 walkthrough", "Grand Theft Auto V"), true);
  assert.equal(titleNamesGame("GTAV gameplay", "Grand Theft Auto V"), true);
  assert.equal(
    titleNamesGame("RDR2 walkthrough", "Red Dead Redemption 2"),
    true,
  );
  assert.equal(
    titleNamesGame(
      "Ocarina of Time 100% walkthrough",
      "The Legend of Zelda: Ocarina of Time",
    ),
    true,
  );
  assert.equal(titleNamesGame("GTA Vice City walkthrough", SA), false);
  // A series name is the first game: every sequel's title names it too, so the alias rule never matches it.
  assert.equal(
    titleNamesGame("GTA Vice City gameplay", "Grand Theft Auto"),
    false,
  );
});

test("a retrospective's series is its own game: San Andreas uploads are no longer refused for not naming it", () => {
  // The 13 Nov proof passed the game as its own series, which left no distinguishing words: 41 of 75 refused.
  for (const t of [
    "GTA SA walkthrough part 1 - In the Beginning",
    "GTA San Andreas - Mission #1 - Big Smoke (PS2 gameplay)",
    "Grand Theft Auto San Andreas walkthrough no commentary",
    "San Andreas full game walkthrough",
  ])
    assert.equal(junkSourceReason(t, "x", SA, SA, 2004), undefined, t);
  assert.equal(namesGame("GTA:SA gameplay", SA, SA, 2004), true);
  // Still refused: another numbered entry, another game, the first game without its year.
  assert.equal(
    junkSourceReason("GTA 5 San Andreas map gameplay", "x", SA, SA, 2004),
    "names another entry of the series",
  );
  assert.equal(
    junkSourceReason("GTA Vice City walkthrough", "x", SA, SA, 2004),
    "title does not name this game",
  );
  assert.equal(
    namesGame(
      "GTA Vice City gameplay",
      "Grand Theft Auto",
      "Grand Theft Auto",
      1997,
    ),
    false,
  );
  // The licensed-gameplay search's own rule takes the aliases too, and refuses a sibling.
  assert.equal(gameplayTitleFits("GTA SA walkthrough part 3", SA, SA), true);
  assert.equal(
    gameplayTitleFits("GTA 4 walkthrough San Andreas", SA, SA),
    false,
  );
});

// ---------------------------------------------------------------- YouTube 403s

test("a refused section is fetched again with fresh formats, then another format, and only then given up", async () => {
  const args = [
    "--no-playlist",
    "-f",
    "bv*[height<=1080][ext=mp4][vcodec^=avc1]/b",
    "--download-sections",
    "*1-5",
    "-o",
    "x.mp4",
    "u",
  ];
  const tries = sectionAttempts(args);
  assert.deepEqual(tries[0], args);
  assert.deepEqual(
    tries[1]!.slice(0, 2),
    ["--no-cache-dir", "--force-overwrites"],
    "fresh formats, a partial file overwritten",
  );
  assert.ok(tries.length >= 4);
  assert.match(tries[2]![tries[2]!.indexOf("-f") + 1]!, /height<=720/);
  assert.equal(
    streamRefused(new Error("Server returned 403 Forbidden (access denied)")),
    true,
  );
  assert.equal(streamRefused(new Error("Video unavailable")), false);
  // Refused twice, fetched on the third try.
  const seen: string[][] = [];
  await downloadSectionRetrying(
    "yt-dlp",
    args,
    {},
    {
      run: async (_c, a) => {
        seen.push(a);
        if (seen.length < 3)
          throw Object.assign(new Error("Command failed"), {
            stderr: "HTTP error 403 Forbidden",
          });
      },
      wait: async () => undefined,
    },
  );
  assert.equal(seen.length, 3);
  // Any other failure is not retried.
  let n = 0;
  await assert.rejects(
    downloadSectionRetrying(
      "yt-dlp",
      args,
      {},
      {
        run: async () => {
          n++;
          throw new Error("Video unavailable");
        },
        wait: async () => undefined,
      },
    ),
  );
  assert.equal(n, 1);
});

// ---------------------------------------------------------------- the game's own scenes first

test("LONG_INDEX_FIRST: the game's own scenes keep a chapter's allowance; trailers, then gameplay, give way", () => {
  const clip = (provenance: string, durationSeconds: number) => ({
    provenance,
    durationSeconds,
    beatIndex: 0,
  });
  const clips = [
    clip("Official trailer: Rockstar Games", 10),
    clip("Gameplay from YouTube video by someone", 20),
    clip('Cutscenes for "GTA SA" from YouTube video "movie" by x', 30),
    clip('Cutscenes for "GTA SA" from YouTube video "movie" by x', 30),
  ];
  const jobs = [{ gameTitle: SA, beatIndex: 0, ownSeconds: 70 }];
  const before = reconcileCutsceneBudgets(clips, jobs, 70);
  assert.equal(
    before
      .filter((c) => c.provenance.startsWith("Cutscenes"))
      .reduce((n, c) => n + c.durationSeconds, 0),
    40,
    "as before: the trailer and gameplay spend it first",
  );
  const after = reconcileCutsceneBudgets(clips, jobs, 70, {
    cutscenesFirst: true,
  });
  assert.equal(
    after.filter((c) => c.provenance.startsWith("Cutscenes")).length,
    2,
    "both scenes kept whole",
  );
  assert.equal(
    after.some((c) => /trailer/i.test(c.provenance)),
    false,
    "the trailer gives way first",
  );
  assert.ok(
    after.reduce((n, c) => n + c.durationSeconds, 0) <= 70 + 0.01,
    "the allowance holds",
  );
});

// ---------------------------------------------------------------- the picture check while the relay is down

test("SCENE_MATCH_CODEX: with the local model unable to look, the fallback (Codex) answers for every frame", async () => {
  const ask = {
    game: SA,
    line: "Big Smoke waits at the station",
    names: ["Big Smoke"],
  };
  const dir = await tmpDir();
  const files = [0, 1, 2].map((i) => path.join(dir, `f${i}.jpg`));
  for (const f of files) await fs.writeFile(f, "jpg");
  try {
    // No fallback: nothing judged (the local model never runs under the test runner).
    setSubjectFallback(undefined);
    assert.deepEqual(await lookSubject(files, ask), [
      undefined,
      undefined,
      undefined,
    ]);
    // Codex through a stand-in client: one call, the frames in order.
    let calls = 0;
    const llm = {
      structured: async (o: { content: unknown; site?: string }) => {
        calls++;
        assert.equal(o.site, "scenematch");
        return {
          frames: [0.9, 0.8, 0.2].map((c) => ({
            shows: c > 0.5,
            confidence: c,
            seen: "Big Smoke on the platform",
          })),
        };
      },
    } as never;
    setSubjectFallback(codexSubjectLook(llm, 1));
    const looks = await lookSubject(files, ask);
    assert.equal(calls, 1);
    assert.deepEqual(
      looks.map((l) => l?.shows),
      [true, true, false],
    );
    // Past its call cap the fallback judges nothing: unchecked, not a "no".
    const capped = await checkClip(files[0]!, 3, ask, {
      grab: async () => files,
      keepFrames: true,
    });
    assert.equal(capped.unchecked, true);
    assert.equal(capped.ok, false);
    // A clip the fallback confirms is ok.
    setSubjectFallback(codexSubjectLook(llm, 5));
    const seen = await checkClip(files[0]!, 3, ask, {
      grab: async () => files,
      keepFrames: true,
    });
    assert.equal(seen.ok, true);
    assert.equal(seen.unchecked, undefined);
  } finally {
    setSubjectFallback(undefined);
  }
});

test("FOOTAGE_LOOK_CODEX: segments the local model left unjudged go to Codex, six a call; LONG_INWORLD_TEXT keeps game text", async () => {
  const { codexSegmentLook, lookFramesOrFallback, setSegmentLookFallback } = await import("../src/assets/localvision.ts");
  const { segmentRejectReason, footageOptions } = await import("../src/assets/footagefirst.ts");
  const dir = await tmpDir();
  const files = Array.from({ length: 8 }, (_, i) => path.join(dir, `seg${i}.jpg`));
  for (const f of files) await fs.writeFile(f, "jpg");
  const sizes: number[] = [];
  const llm = {
    structured: async (o: { content: Array<{ type: string }>; site?: string }) => {
      assert.equal(o.site, "footagelook");
      const n = o.content.filter((c) => c.type === "image").length;
      sizes.push(n);
      return {
        segments: Array.from({ length: n }, () => ({ label: "car on a desert road", text: true, hud_only: false, webcam: false, gore: false, mod: false })),
      };
    },
  } as never;
  try {
    setSegmentLookFallback(undefined);
    assert.ok((await lookFramesOrFallback(files)).every((l) => l === undefined), "nothing judged without a fallback");
    setSegmentLookFallback(codexSegmentLook(llm, 5));
    const looks = await lookFramesOrFallback(files);
    assert.deepEqual(sizes, [6, 2]);
    assert.ok(looks.every((l) => l?.label === "car on a desert road"));
    // The look's text flag refuses only without LONG_INWORLD_TEXT (the OCR then judges whose writing it is).
    assert.equal(segmentRejectReason(looks[0]), "text on screen");
    assert.equal(segmentRejectReason(looks[0], { inWorldText: true }), undefined);
    const base = { footageShareTarget: 60, footageSources: 6, footagePullSeconds: 240, footageVisionMax: 120, footageFirstMaxMinutes: 40 };
    assert.equal(footageOptions(base).inWorldText, undefined);
    assert.equal(footageOptions({ ...base, longInWorldText: true }).inWorldText, true);
  } finally {
    setSegmentLookFallback(undefined);
  }
});

test("LONG_INDEX_FIRST passes: the index pass never runs the slow search, the search pass never the index", async () => {
  const { indexFirstCutscenes } = await import("../src/sceneindex/footage.ts");
  const dataDir = await tmpDir();
  const cfg = { sceneIndex: true, sceneIndexMinConfidence: 0.45, dataDir, ytdlpPath: "yt-dlp" };
  const base = { gameTitle: "A Game With No Index", episodeDir: dataDir, targets: [], maxClips: 4, maxSeconds: 20 };
  let searched = 0;
  const search = async () => {
    searched++;
    return [];
  };
  await indexFirstCutscenes(cfg, { ...base, mode: "index" as const }, search);
  assert.equal(searched, 0);
  await indexFirstCutscenes(cfg, { ...base, mode: "search" as const }, search);
  assert.equal(searched, 1);
});

test("LONG_INDEX_FIRST never trims licensed Creative Commons gameplay to fit the publisher's allowance", () => {
  const clip = (provenance: string, durationSeconds: number) => ({ provenance, durationSeconds, beatIndex: 0 });
  const clips = [
    clip("Official trailer: Rockstar Games", 10),
    clip('Gameplay "x" by someone, Creative Commons Attribution licence (CC BY)', 40),
    clip('Cutscenes for "GTA SA" from YouTube video "movie" by x', 30),
    clip('Cutscenes for "GTA SA" from YouTube video "movie" by x', 30),
  ];
  const after = reconcileCutsceneBudgets(clips, [{ gameTitle: SA, beatIndex: 0, ownSeconds: 60 }], 60, { cutscenesFirst: true });
  assert.equal(after.filter((c) => c.provenance.startsWith("Cutscenes")).length, 2);
  assert.ok(after.some((c) => /Creative Commons/.test(c.provenance)), "the CC gameplay stays");
  assert.equal(after.some((c) => /trailer/i.test(c.provenance)), false, "the trailer gives way");
});

test("a fade or cut to black inside an index clip is cut off (every frame read, not four a second)", async () => {
  const { brightTrim } = await import("../src/sceneindex/footage.ts");
  const { brightRun } = await import("../src/assets/clipscore.ts");
  // The San Andreas proof's clip: 63 frames, its last four at 16 (four-a-second sampling saw 32 at worst).
  const fade = [...Array(59).fill(85), 16, 16, 16, 16];
  assert.deepEqual(brightRun(fade), { start: 0, end: 59 });
  const v = brightTrim(fade);
  assert.equal(v.ok, true);
  assert.equal(v.trim?.from, 0);
  assert.ok(Math.abs(v.trim!.seconds - 59 / 30) < 0.04);
  // A cut through black near the end of a short clip: the longer bright part is kept.
  const cutThrough = [...Array(49).fill(85), 1, 8, 13, 27, 42];
  assert.ok(Math.abs(brightTrim(cutThrough).trim!.seconds - 49 / 30) < 0.04);
  // Bright throughout: kept whole; mostly black: refused.
  assert.deepEqual(brightTrim(Array(60).fill(80)), { ok: true });
  assert.equal(brightTrim([...Array(30).fill(5), ...Array(20).fill(80)]).ok, false);
});

test("an editing app's watermark (KineMaster, InShot, CapCut) is writing not from the game", async () => {
  const { OVERLAY_WORD } = await import("../src/assets/cliptext.ts");
  for (const w of ["KINEMASTER", "KineMast", "InShot", "CapCut", "Bandicam"]) assert.ok(OVERLAY_WORD.test(w), w);
  assert.equal(OVERLAY_WORD.test("Grove"), false);
});
