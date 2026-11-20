import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cleanFrameReason,
  cutsceneBudgetSeconds,
  cutsceneMedia,
  cutscenePublisher,
  cutsceneAllowance,
  gatherCutsceneSources,
  reconcileCutsceneBudgets,
  cutsceneQueries,
  cutsceneDownloadArgs,
  silentSectionArgs,
  cutsceneGrant,
  pickCutsceneUpload,
  findCutsceneMoment,
  parseCutsceneVtt,
  extractCutsceneQuotes,
  sceneQueries,
  type CutsceneUpload,
} from "../src/assets/cutscenes.ts";
import { preferredSceneAssignments, rankByModel, SCENE_PROMPT, SCENE_REVIEW_FRAMES, sceneCandidates, verifySceneAssignments } from "../src/assets/clipscore.ts";
import { quoteProblems } from "../src/editorial/quotes.ts";
import { writeScript } from "../src/editorial/editorial.ts";
import { validateChapter, writeChapter } from "../src/editorial/documentary.ts";
import { loadConfig } from "../src/config.ts";
import { frameFlagsFromAnswer } from "../src/assets/localvision.ts";
import { footageCredits, gatherMedia } from "../src/pipeline.ts";
import { goodScript, testConfig } from "./helpers.ts";

const upload = (title: string, extra: Partial<CutsceneUpload> = {}): CutsceneUpload => ({
  videoId: "abcdefghijk",
  title,
  uploader: "Game Cinema",
  duration: 3600,
  height: 1080,
  viewCount: 1000,
  ...extra,
});

test("cutscene searches name the game and the desired footage", () => {
  assert.deepEqual(cutsceneQueries("Halo 3"), [
    "Halo 3 all cutscenes no commentary",
    "Halo 3 full movie",
    "Halo 3 cutscenes 4K",
    "Halo 3 game movie",
  ]);
  assert.deepEqual(cutsceneQueries("  "), []);
});

test("the upload picker wants the exact game and rejects commentary and other distractions", () => {
  const good = upload("Halo 3 All Cutscenes Full Movie No Commentary");
  assert.equal(pickCutsceneUpload([good], "Halo 3"), good);
  for (const title of [
    "Halo 3 cutscenes with commentary",
    "Halo 3 cutscenes reaction, no commentary",
    "Halo 3 movie with face cam",
    "Halo 3 cutscenes lore explained",
    "Halo 3 cutscenes theory",
    "Halo 3 fan film movie",
    "Halo 3 fan films movie",
    "Halo 3 cutscenes with mods",
    "Halo 3 remastered cutscenes",
    "Halo 3 cutscenes ranked",
    "Halo 3 top ten cutscenes",
    "Halo 3 walkthrough let's play cutscenes",
    "Halo 3 review of the movie",
    "Halo 4 all cutscenes no commentary",
  ]) assert.equal(pickCutsceneUpload([upload(title)], "Halo 3"), undefined, title);
  assert.equal(pickCutsceneUpload([upload("Halo 3 movie", { isLive: true })], "Halo 3"), undefined);
  assert.equal(pickCutsceneUpload([upload("Halo 3 movie", { liveStatus: "was_live" })], "Halo 3"), undefined);
  assert.equal(pickCutsceneUpload([upload("Halo 3 movie", { videoId: "../../bad" })], "Halo 3"), undefined);
});

test("longer, sharper and more viewed uploads rank above weaker matches", () => {
  const short = upload("Halo 3 movie", { duration: 300, height: 720, viewCount: 100 });
  const long = upload("Halo 3 movie", { videoId: "12345678901", duration: 2400, height: 1080, viewCount: 10000 });
  assert.equal(pickCutsceneUpload([short, long], "Halo 3"), long);
});

const W = 160;
const H = 90;
const frames = (paint?: (x: number, y: number, frame: number, value: number) => number) =>
  [0, 1, 2, 3, 4].map((frame) => Uint8Array.from({ length: W * H }, (_, i) => {
    const x = i % W;
    const y = Math.floor(i / W);
    const moving = 30 + ((x * 3 + y * 7 + frame * 31) % 180);
    return paint?.(x, y, frame, moving) ?? moving;
  }));

test("the clean-frame gate rejects persistent corner marks and bottom text", () => {
  assert.equal(cleanFrameReason(frames(), W, H), undefined);
  const logo = frames((x, y, _f, v) => x < 30 && y < 18 ? ((x + y) % 2 ? 240 : 30) : v);
  assert.match(cleanFrameReason(logo, W, H)!, /corner/i);
  const smallLogo = frames((x, y, _f, v) => x < 16 && y < 9 ? ((x + y) % 2 ? 240 : 30) : v);
  assert.match(cleanFrameReason(smallLogo, W, H)!, /corner/i);
  const subtitles = frames((x, y, _f, v) => x > 38 && x < 122 && y > 71 && y < 78 ? (x % 4 < 2 ? 245 : 10) : v);
  assert.match(cleanFrameReason(subtitles, W, H)!, /text/i);
  const busySubtitles = frames((x, y, frame, v) => {
    if (x > 38 && x < 122 && y > 71 && y < 78) return x % 4 < 2 ? 245 : 10;
    return y > 64 && y < 83 ? ((x * 7 + y * 11 + frame * 13) % 5 < 2 ? 245 : 10) : v;
  });
  assert.match(cleanFrameReason(busySubtitles, W, H)!, /text/i);
  const lateSubtitles = frames((x, y, frame, v) => frame > 0 && x > 38 && x < 122 && y > 71 && y < 78 ? (x % 4 < 2 ? 245 : 10) : v);
  assert.match(cleanFrameReason(lateSubtitles, W, H)!, /text/i);
  const staticSubtitles = frames((x, y) => x > 38 && x < 122 && y > 71 && y < 78 ? (x % 4 < 2 ? 245 : 10) : 100);
  assert.match(cleanFrameReason(staticSubtitles, W, H)!, /text/i);
  const bars = frames((x, y, _f, v) => y < 7 || y >= 83 ? 0 : v);
  assert.equal(cleanFrameReason(bars, W, H), undefined, "plain black bars are not a watermark");
  assert.match(cleanFrameReason(frames().slice(0, 2), W, H)!, /frames/i);
});

test("the per-video limit starts at 20 seconds and scales with long videos", () => {
  assert.equal(cutsceneBudgetSeconds(20, 45), 20);
  assert.equal(cutsceneBudgetSeconds(20, 180), 60);
  assert.equal(cutsceneBudgetSeconds(20, 3600), 120);
  assert.equal(cutsceneBudgetSeconds(0, 3600), 0);
});

test("cutscenes share the existing publisher and video budgets", () => {
  assert.deepEqual(cutscenePublisher("Grand Theft Auto VI"), { key: "Rockstar Games", seconds: 10 });
  assert.deepEqual(cutscenePublisher("The Legend of Zelda"), { key: "Nintendo", seconds: 0 });
  assert.deepEqual(cutscenePublisher("An Unknown Game", ["Ubisoft Entertainment"]), { key: "Ubisoft", seconds: 8 });
  assert.deepEqual(cutscenePublisher("An Unknown Game"), { key: "game:an unknown game", seconds: 34 });
  assert.equal(cutsceneAllowance(20, 8, 10, 7), 3);
  assert.equal(cutsceneAllowance(20, 18, 34, 0), 2);
  assert.equal(cutsceneAllowance(20, 0, 0, 0), 0);
});

test("cutscene provenance receives its own description credit", () => {
  const provenance = 'Cutscenes for "Halo 3" from YouTube video "Halo 3 Movie" by Game Cinema, video ID: abcdefghijk (https://www.youtube.com/watch?v=abcdefghijk), 4s, source time: 60s, muted';
  const credit = footageCredits({ game_title: "Halo 3" } as never, [{ provenance }], undefined, undefined, "Halo");
  assert.match(credit, /Halo 3 cutscenes, via YouTube/);
  assert.doesNotMatch(credit, /official trailer|via Steam/i);
});

test("the episode gather shares publisher caps across entries and tags clips with their entry", async () => {
  const calls: Array<{ gameTitle: string; maxSeconds: number }> = [];
  const target = { key: "beat:0", text: "A scene", want: "cinematic" as const, energy: "medium" as const, keywords: [] };
  const clips = await gatherCutsceneSources({
    enabled: true,
    videoLimit: 20,
    jobs: [
      { gameTitle: "Grand Theft Auto V", episodeDir: "ep/entry_0", pathPrefix: "entry_0", beatIndex: 0, targets: [target] },
      { gameTitle: "Grand Theft Auto IV", episodeDir: "ep/entry_1", pathPrefix: "entry_1", beatIndex: 1, targets: [target] },
      { gameTitle: "The Legend of Zelda", episodeDir: "ep/entry_2", pathPrefix: "entry_2", beatIndex: 2, targets: [target] },
      { gameTitle: "Halo 3", episodeDir: "ep/entry_3", pathPrefix: "entry_3", beatIndex: 3, targets: [target] },
    ],
    existing: [{ provenance: "Rockstar footage", beatIndex: 0, durationSeconds: 8 }],
    fetch: async (job) => {
      calls.push(job);
      return [{ kind: "clip", file: "assets/cutscene_0.mp4", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        provenance: "cutscene", durationSeconds: Math.min(2, job.maxSeconds), credit: "Cutscene", audio: false,
        span: { source: "https://www.youtube.com/watch?v=abcdefghijk", from: 10, to: 12 } }];
    },
  });
  assert.deepEqual(calls.map((c) => [c.gameTitle, c.maxSeconds]), [["Grand Theft Auto V", 2], ["Halo 3", 14]]);
  assert.deepEqual(clips.map((c) => c.beatIndex), [0, 3]);
  assert.match(clips[0]!.file, /entry_0[\\/]assets/);
  assert.ok(clips.every((c) => c.audio === false && c.span.source.includes("abcdefghijk")));
});

test("later gameplay cannot put cutscenes above the publisher cap", () => {
  const clips = [
    { provenance: "Rockstar trailer", beatIndex: 0, durationSeconds: 4 },
    { provenance: 'Cutscenes for "Grand Theft Auto V" from YouTube video "Movie" by C, video ID: abcdefghijk, publisher: Rockstar Games (https://youtube.com/watch?v=abcdefghijk)', beatIndex: 0, durationSeconds: 6,
      span: { source: "https://youtube.com/watch?v=abcdefghijk", from: 20, to: 26 } },
    { provenance: "Gameplay added later", beatIndex: 0, durationSeconds: 4 },
  ];
  const jobs = [{ gameTitle: "Grand Theft Auto V", beatIndex: 0 }];
  const result = reconcileCutsceneBudgets(clips, jobs, 20);
  assert.deepEqual(result.map((c) => c.durationSeconds), [4, 2, 4]);
  assert.equal(result[1]!.span?.to, 22);
  assert.deepEqual(reconcileCutsceneBudgets(clips, jobs, 0).map((c) => c.provenance), ["Rockstar trailer", "Gameplay added later"]);
});

test("the disabled source never searches, downloads or creates episode files", async () => {
  let calls = 0;
  const result = await cutsceneMedia({
    enabled: false,
    gameTitle: "Halo 3",
    episodeDir: "unused",
    targets: [{ key: "hook", text: "Halo", want: "cinematic", energy: "high", keywords: [] }],
    maxClips: 1,
    maxSeconds: 20,
    ytdlp: "yt-dlp",
    deps: { search: async () => { calls++; return []; } },
  });
  assert.deepEqual(result, []);
  assert.equal(calls, 0);
});

test("section download arguments limit the interval and the audio is stripped", () => {
  const args = cutsceneDownloadArgs(upload("Halo 3 movie"), 120, 130, "section.mp4");
  assert.ok(args.includes("--download-sections"));
  assert.ok(args.includes("*120.00-130.00"));
  assert.ok(args.some((a) => a.includes("height<=1080")));
  assert.ok(silentSectionArgs("download.mp4", "section.mp4").includes("-an"));
});

test("each downloaded section and final clip is screened and its source is recorded", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-test-"));
  const downloads: Array<[number, number]> = [];
  const screened: string[] = [];
  let releases = 0;
  const candidate = upload("Halo 3 All Cutscenes No Commentary", { uploader: "Game Cinema, publisher: Rockstar Games" });
  try {
    await fs.mkdir(path.join(dir, "cutscene_work"));
    await fs.writeFile(path.join(dir, "cutscene_work", "keep.txt"), "existing work");
    const clips = await cutsceneMedia({
      enabled: true, gameTitle: "Halo 3", episodeDir: dir, maxClips: 2, maxSeconds: 10, ytdlp: "yt-dlp", publisher: "Xbox",
      targets: [{ key: "beat:0", text: "A scene", want: "cinematic", energy: "medium", keywords: [] }],
      deps: {
        search: async () => [candidate],
        details: async (item) => item,
        lease: async () => () => { releases++; },
        download: async (_upload, from, to) => { downloads.push([from, to]); },
        screen: async (file) => { screened.push(file); return !file.endsWith("section_1.mp4") && !file.endsWith("cutscene_bad.mp4"); },
        match: async (options) => {
          assert.match(options.prefix!, /^cutscene_work_/);
          assert.ok(options.trailers.every((t) => !t.file.endsWith("section_1.mp4")));
          const first = options.trailers[0]!;
          return ["cutscene_good.mp4", "cutscene_bad.mp4"].map((name) => ({
            kind: "clip" as const, file: path.join("assets", name), sourceUrl: first.url,
            durationSeconds: 4, startSeconds: 1.5, provenance: options.describe(first, 4, 1),
          }));
        },
      },
    });
    assert.ok(downloads.length >= 2 && downloads.every(([from, to]) => from > 0 && to - from <= 30));
    assert.equal(clips.length, 1);
    assert.ok(screened.some((file) => file.endsWith("cutscene_good.mp4")));
    assert.match(clips[0]!.provenance, /video ID: abcdefghijk/);
    assert.match(clips[0]!.provenance, /Halo 3 All Cutscenes No Commentary/);
    assert.match(clips[0]!.provenance, /Game Cinema/);
    assert.doesNotMatch(clips[0]!.provenance, /publisher: Rockstar Games/);
    assert.deepEqual(clips[0]!.youtubeSource, { videoId: "abcdefghijk", title: candidate.title, uploader: candidate.uploader });
    assert.equal(clips[0]!.audio, false);
    assert.equal(releases, 1);
    assert.equal(await fs.readFile(path.join(dir, "cutscene_work", "keep.txt"), "utf8"), "existing work");
    assert.equal(clips[0]!.span.from, Number((downloads[0]![0] + 1.5).toFixed(2)));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("detailed metadata decides resolution and rejects a stream before any section download", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-test-"));
  const seen: string[] = [];
  const stream = upload("Halo 3 movie", { videoId: "11111111111", viewCount: 10000, height: undefined });
  const low = upload("Halo 3 movie", { videoId: "22222222222", viewCount: 2000, height: undefined });
  const hd = upload("Halo 3 movie", { videoId: "33333333333", viewCount: 1000, height: undefined });
  try {
    await cutsceneMedia({
      enabled: true, gameTitle: "Halo 3", episodeDir: dir, maxClips: 1, maxSeconds: 4.8, ytdlp: "yt-dlp",
      targets: [{ key: "hook", text: "Halo", want: "cinematic", energy: "high", keywords: [] }],
      deps: {
        search: async () => [stream, low, hd],
        details: async (item) => item.videoId === stream.videoId ? { ...item, liveStatus: "was_live" } :
          { ...item, height: item.videoId === hd.videoId ? 1080 : 720, liveStatus: "not_live" },
        lease: async () => () => undefined,
        download: async (item) => { seen.push(item.videoId); },
        screen: async () => true,
        match: async () => [],
      },
    });
    assert.ok(seen.length > 0);
    assert.ok(seen.every((id) => id === hd.videoId));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a missing or fail-open PC turn does not start cutscene downloads", async () => {
  assert.equal(cutsceneGrant("GRANTED"), true);
  assert.equal(cutsceneGrant("GRANTED NOOP"), false);
  assert.equal(cutsceneGrant("GRANTED FORCED"), false);
  let downloads = 0;
  const found = upload("Halo 3 movie");
  const result = await cutsceneMedia({
    enabled: true, gameTitle: "Halo 3", episodeDir: "unused", maxClips: 1, maxSeconds: 4.8, ytdlp: "yt-dlp",
    targets: [{ key: "hook", text: "Halo", want: "cinematic", energy: "high", keywords: [] }],
    deps: { search: async () => [found], details: async (item) => item,
      lease: async () => { throw new Error("turn unavailable"); }, download: async () => { downloads++; } },
  });
  assert.deepEqual(result, []);
  assert.equal(downloads, 0);
});

test("episode gathering places cutscenes after Steam and official footage only when enabled", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-test-"));
  let calls = 0;
  const clip = (name: string) => ({ kind: "clip" as const, file: `assets/${name}.mp4`, sourceUrl: "https://example.test/video",
    provenance: name, durationSeconds: 4, beatIndex: 0 });
  const script = goodScript({ game_title: "Example Game", entries: undefined });
  const ep = { id: "test", lane: "news", script_json: script, story_json: { items: [], visualNeed: "game_footage" },
    assets_json: { durationSeconds: 45 } } as never;
  const cfg = testConfig(dir, { cutsceneFootage: true, cutsceneMaxSeconds: 20 });
  const s = {
    cfg, now: () => new Date("2026-11-08T12:00:00Z"),
    findGame: async () => ({ appId: 1, name: "Example Game", details: {} }),
    fetchArt: async () => [], fetchClips: async () => [clip("steam")],
    fetchOfficialMedia: async () => ({ clips: [clip("official")], stills: [] }),
    fetchCutscenes: async () => { calls++; return [{ ...clip("cutscene"), audio: false, credit: "Cutscenes",
      span: { source: "https://www.youtube.com/watch?v=abcdefghijk", from: 5, to: 9 } }]; },
    notify: async () => undefined,
  } as never;
  try {
    const enabled = await gatherMedia(s, ep, dir, true);
    assert.deepEqual(enabled.clips?.map((c) => c.provenance), ["steam", "official", "cutscene"]);
    assert.equal(calls, 1);
    cfg.cutsceneFootage = false;
    const disabled = await gatherMedia(s, ep, dir, true);
    assert.deepEqual(disabled.clips?.map((c) => c.provenance), ["steam", "official"]);
    assert.equal(calls, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a remake's cutscenes are picked when the video is about the remake, the original's otherwise", async () => {
  const { pickCutsceneUpload } = await import("../src/assets/cutscenes.ts");
  const up = (videoId: string, title: string, duration = 7000) => ({ videoId, title, uploader: "u", duration, height: 2160, viewCount: 1000 });
  const ups = [
    up("aaaaaaaaaaa", "Zelda: Ocarina of Time Remake - All Cutscenes Full Movie HD"),
    up("bbbbbbbbbbb", "The Legend of Zelda: Ocarina of Time All Cutscenes (N64)"),
    up("ccccccccccc", "ZELDA OCARINA OF TIME REMAKE Gameplay Walkthrough FULL GAME No Commentary", 40000),
  ];
  const game = "The Legend of Zelda: Ocarina of Time";
  assert.equal(pickCutsceneUpload(ups, game, { recentRelease: true })?.videoId, "aaaaaaaaaaa", "the remake's cutscene movie");
  assert.equal(pickCutsceneUpload(ups, game)?.videoId, "bbbbbbbbbbb", "the original when the video is not about the remake");
});

test("a nearly blank frame (a white dialogue card) is screened out", async () => {
  const { cleanFrameReason, FRAME_WIDTH, FRAME_HEIGHT } = await import("../src/assets/cutscenes.ts");
  const n = FRAME_WIDTH * FRAME_HEIGHT;
  const card = () => { const f = new Uint8Array(n).fill(225); for (let i = 0; i < 60; i++) f[4000 + i] = 60; return f; };
  assert.equal(cleanFrameReason([card(), card(), card()]), "nearly blank picture");
});

test("chapter and caption matches locate the named scene", () => {
  const target = { key: "beat:0#m2", text: "Ganondorf rises over Hyrule Castle", want: "character" as const,
    energy: "medium" as const, keywords: ["Ganondorf", "Hyrule Castle"] };
  const chapters = [{ title: "Link leaves the forest", start: 100, end: 180 },
    { title: "Ganondorf rises above Hyrule Castle", start: 1470, end: 1580 }];
  assert.deepEqual(findCutsceneMoment(target, chapters, []), { how: "chapter", time: 1470 });
  const captions = parseCutsceneVtt(`WEBVTT\n\n00:25:35.000 --> 00:25:38.000\nGanondorf rises over Hyrule Castle.\n`);
  assert.deepEqual(findCutsceneMoment(target, [], captions), { how: "caption", time: 1535 });
  assert.equal(findCutsceneMoment({ ...target, keywords: ["Sheik"], text: "Sheik returns" }, chapters, captions), undefined);
  assert.deepEqual(findCutsceneMoment(target, [{ title: "Hyrule Castle", start: 20 }], captions), { how: "caption", time: 1535 });
  assert.equal(findCutsceneMoment({ ...target, keywords: ["Example Game", "Ganondorf"] },
    [{ title: "Example Game introduction", start: 10 }], [], "Example Game"), undefined);
});

test("scene fallback queries use the named character and omit generic or game-only terms", () => {
  const target = { key: "beat:0", text: "Ganondorf rises over Hyrule", want: "character" as const,
    energy: "medium" as const, keywords: ["Ganondorf", "Hyrule Castle"] };
  assert.deepEqual(sceneQueries("Ocarina of Time", target), [
    "Ocarina of Time Ganondorf scene", "Ocarina of Time all Ganondorf scenes",
    "Ocarina of Time Hyrule Castle scene", "Ocarina of Time all Hyrule Castle scenes",
  ]);
  assert.deepEqual(sceneQueries("Halo 3", { ...target, text: "No gameplay shown", keywords: ["Halo 3", "gameplay"] }), []);
  assert.deepEqual(sceneQueries("Ocarina of Time", { ...target, text: "Link draws the Master Sword", keywords: [] }), [
    "Ocarina of Time Link scene", "Ocarina of Time all Link scenes",
    "Ocarina of Time Master Sword scene", "Ocarina of Time all Master Sword scenes",
  ]);
});

test("caption quotes keep their source timing and reject music, long and unsafe lines", () => {
  const cues = parseCutsceneVtt(`WEBVTT\n\n1\n00:00:03.250 --> 00:00:05.750 align:start\n<v Zelda>Open your eyes, Link.</v>\n\n2\n00:00:06.000 --> 00:00:07.000\n[Music]\n\n3\n00:00:08.000 --> 00:00:15.000\nA line that takes far too long.\n\n4\n00:00:16.000 --> 00:00:18.000\nI will kill you.\n`);
  const quotes = extractCutsceneQuotes(cues, "abcdefghijk");
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0]!.text, "Open your eyes, Link.");
  assert.equal(quotes[0]!.start, 3.25);
  assert.equal(quotes[0]!.end, 5.75);
  assert.equal(quotes[0]!.videoId, "abcdefghijk");
});

test("a quote must be available, exact, safe, surrounded by narration and used once", () => {
  const quotes = [{ id: "q1", text: "Open your eyes, Link.", start: 3.25, end: 5.75, videoId: "abcdefghijk" }];
  const beats = [{ narration: "Zelda calls out." }, { narration: "Open your eyes, Link.", quote: "q1" },
    { narration: "Link wakes to a changed world." }];
  assert.deepEqual(quoteProblems(beats, quotes), []);
  assert.ok(quoteProblems([{ ...beats[1]!, quote: "unknown" }], quotes).length);
  assert.ok(quoteProblems([beats[0]!, { ...beats[1]!, narration: "Open your eyes." }, beats[2]!], quotes).length);
  assert.ok(quoteProblems([beats[1]!, beats[2]!], quotes).length);
  assert.ok(quoteProblems([beats[0]!, beats[1]!, beats[1]!, beats[2]!], quotes).length);
  assert.ok(quoteProblems([beats[0]!, beats[1]!, { narration: quotes[0]!.text }], quotes).length);
  assert.ok(quoteProblems(beats, [{ ...quotes[0]!, text: "I will kill you." }]).length);
});

test("a located scene is assigned only to its own target and near its timestamp", () => {
  const targets = [
    { key: "beat:0#m0", text: "Ganondorf rises", want: "character" as const, energy: "medium" as const, keywords: ["Ganondorf"] },
    { key: "beat:0#m1", text: "Link returns", want: "character" as const, energy: "medium" as const, keywords: ["Link"] },
  ];
  const trailers = [
    { file: "ganon.mp4", name: "G", url: "g", total: 30, targetKey: targets[0]!.key, anchor: 15 },
    { file: "link.mp4", name: "L", url: "l", total: 30, targetKey: targets[1]!.key, anchor: 15 },
  ];
  const candidate = (index: number, movie: number, time: number, motion: number) =>
    ({ index, movie, time, motion, luma: 100, frame: "unused.jpg" });
  const picks = preferredSceneAssignments(targets, [candidate(1, 1, 14, 5), candidate(2, 0, 14, 1),
    candidate(3, 0, 10, 99), candidate(4, 1, 10, 99)], trailers);
  assert.deepEqual(picks.map((p) => [p.key, p.candidate]), [["beat:0#m0", 2], ["beat:0#m1", 1]]);
  const cutsBeforeAnchor = { ...candidate(5, 0, 14, 99), nextCut: 14.4, nextCut2: 19 };
  const sameShot = { ...candidate(6, 0, 13, 1), nextCut: 19 };
  assert.equal(preferredSceneAssignments([targets[0]!], [cutsBeforeAnchor, sameShot], trailers)[0]?.candidate, 6);
});

test("located frames require a real safety verdict and cannot be approved for another target", async () => {
  const target = { key: "beat:0", text: "Alpha arrives", want: "character" as const, energy: "medium" as const, keywords: ["Alpha"] };
  const trailers = [{ file: "alpha.mp4", name: "Alpha", url: "a", total: 30, targetKey: target.key, anchor: 15 }];
  const candidates = [{ index: 1, movie: 0, time: 14, motion: 5, luma: 100, frame: "unused" }];
  assert.deepEqual(await verifySceneAssignments([target], candidates, trailers, new Map()), []);
  const clean = new Map([[1, { text: false, webcam: false, gore: false, dark: false, hud: false, letterbox: false, blurry: false }]]);
  assert.equal((await verifySceneAssignments([target], candidates, trailers, clean)).length, 1);
  assert.deepEqual(await verifySceneAssignments([target], candidates, trailers, clean, async () => []), []);
  assert.deepEqual(await verifySceneAssignments([target], candidates, trailers, clean,
    async () => [{ key: "beat:1", candidate: 1, confidence: 1, reason: "wrong target" }]), []);
});

test("a partial local vision response cannot be treated as a clean frame", () => {
  assert.equal(frameFlagsFromAnswer({}), undefined);
  assert.equal(frameFlagsFromAnswer({ message: { content: '{"text":false}' } }), undefined);
  const body = { text: false, hud_only: false, webcam: false, gore: false, letterbox: false, dark: false, blurry: false };
  assert.equal(frameFlagsFromAnswer({ message: { content: JSON.stringify(body) } })?.gore, false);
});

test("scene discovery downloads targeted sections, screens them and preserves source and target", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-scene-test-"));
  const movie = upload("Example Game All Cutscenes No Commentary", { chapters: [{ title: "Ganondorf rises", start: 1500 }] });
  const scene = upload("Example Game All Sheik Scenes No Commentary", { videoId: "12345678901", duration: 120 });
  const calls: Array<{ id: string; from: number; to: number }> = [];
  const targets = [
    { key: "beat:0#m0", text: "Ganondorf rises", want: "character" as const, energy: "medium" as const, keywords: ["Ganondorf"] },
    { key: "beat:0#m1", text: "Sheik returns", want: "character" as const, energy: "medium" as const, keywords: ["Sheik"] },
  ];
  try {
    const clips = await cutsceneMedia({ enabled: true, scenes: true, quotes: true, gameTitle: "Example Game", episodeDir: dir,
      maxClips: 2, maxSeconds: 10, ytdlp: "unused", targets,
      deps: {
        search: async (query) => query.includes("Sheik") ? [scene] : [movie],
        details: async (item) => item,
        captions: async () => "WEBVTT\n\n00:01:00.000 --> 00:01:02.000\nOpen your eyes, Link.\n",
        lease: async () => () => undefined,
        download: async (item, from, to) => { calls.push({ id: item.videoId, from, to }); },
        screen: async () => true,
        match: async (options) => options.trailers.map((trailer, i) => ({
          kind: "clip" as const, file: `assets/scene_${i}.mp4`, sourceUrl: trailer.url, durationSeconds: 4,
          beatIndex: 0, moment: i, startSeconds: (trailer.anchor ?? 0) - 1,
          provenance: options.describe(trailer, 4, (trailer.anchor ?? 0) - 1),
        })),
      },
    });
    assert.deepEqual(calls.map((c) => c.id), [movie.videoId, scene.videoId]);
    assert.ok(calls[0]!.from < 1500 && calls[0]!.to > 1500);
    assert.deepEqual(clips.map((c) => c.cutsceneMatch), [
      { targetKey: "beat:0#m0", how: "chapter" }, { targetKey: "beat:0#m1", how: "scene upload" },
    ]);
    assert.deepEqual(clips.map((c) => c.youtubeSource?.videoId), [movie.videoId, scene.videoId]);
    assert.ok(clips.every((c) => c.audio === false));
    const saved = JSON.parse(await fs.readFile(path.join(dir, "cutscene_quotes.json"), "utf8"));
    assert.equal(saved.quotes[0].text, "Open your eyes, Link.");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("both writers receive available quotes and reject invented or changed wording", async () => {
  const quote = { id: "q1", videoId: "abcdefghijk", text: "Open your eyes, Link.", start: 3, end: 5 };
  const script = goodScript();
  const visual = script.beats[0]!.visual;
  script.beats = [{ narration: "Zelda calls out.", visual }, { narration: quote.text, quote: quote.id, visual },
    { narration: "Link wakes to a changed world.", visual }];
  const prompts: string[] = [];
  const llm = { structured: async (options: { content: string }) => { prompts.push(options.content); return structuredClone(script); } } as never;
  const cluster = { hash: "x", headline: "h", items: [] } as never;
  assert.equal((await writeScript(llm, cluster, [], { mustLabelRumour: false, availableQuotes: [quote] })).beats[1]!.quote, "q1");
  await assert.rejects(() => writeScript(llm, cluster, [], { mustLabelRumour: false }), /Invalid character quote/);
  const repeated = { ...script, hook: quote.text };
  const repeatLlm = { structured: async () => repeated } as never;
  await assert.rejects(() => writeScript(repeatLlm, cluster, [], { mustLabelRumour: false, availableQuotes: [quote] }), /Invalid character quote/);
  const deskLlm = { structured: async () => ({ ...script, desk_question: quote.text }) } as never;
  await assert.rejects(() => writeScript(deskLlm, cluster, [], { mustLabelRumour: false, availableQuotes: [quote] }), /Invalid character quote/);
  const paragraph = (narration: string, id?: string) => ({ narration, ...(id ? { quote: id } : {}),
    footage: { want: "cinematic" as const, keywords: [] }, callout: { kind: "none" as const, primary: "", secondary: "" } });
  const chapter = { paragraphs: [paragraph("Zelda calls out."), paragraph(quote.text, "q1"),
    paragraph("Link wakes to a changed world.")], claims: [] };
  const docLlm = { structured: async (options: { content: string }) => { prompts.push(options.content); return structuredClone(chapter); } } as never;
  const plan = { chapter_title: "The awakening", game_title: "Example Game", year: 2001, platforms: "PC", focus: "story" } as never;
  const ctx = { franchise: "Example Game", plan, index: 0, outline: { title: "Example", chapters: [plan] } as never,
    source: { title: "Example", url: "https://example.test", text: "source" }, availableQuotes: [quote] };
  assert.equal((await writeChapter(docLlm, ctx)).paragraphs[1]!.quote, "q1");
  await assert.rejects(() => writeChapter(docLlm, { ...ctx, availableQuotes: [] }), /Invalid character quote/);
  assert.ok(prompts[0]!.includes(quote.text));
  assert.ok(prompts[2]!.includes(quote.text));
});

test("scene and quote settings follow their safe defaults and explicit overrides", () => {
  const keys = ["CUTSCENE_FOOTAGE", "CUTSCENE_SCENES", "CUTSCENE_QUOTES"] as const;
  const previous = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(loadConfig().cutsceneScenes, false);
    assert.equal(loadConfig().cutsceneQuotes, false);
    // Cutscene footage alone no longer switches the scene search on (12 Nov 2026: the Mac runs CUTSCENE_FOOTAGE=true).
    process.env.CUTSCENE_FOOTAGE = "true";
    assert.equal(loadConfig().cutsceneScenes, false);
    process.env.CUTSCENE_SCENES = "true";
    assert.equal(loadConfig().cutsceneScenes, true);
    process.env.CUTSCENE_SCENES = "false";
    process.env.CUTSCENE_QUOTES = "true";
    const cfg = loadConfig();
    assert.equal(cfg.cutsceneScenes, false);
    assert.equal(cfg.cutsceneQuotes, true);
  } finally {
    keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]);
  }
});

test("a verified quote is exempt from documentary paragraph length without bypassing quote validation", () => {
  const quote = { id: "q1", videoId: "abcdefghijk", text: "Open your eyes, Link.", start: 3, end: 5 };
  const paragraph = (narration: string, id?: string) => ({ narration, ...(id ? { quote: id } : {}),
    footage: { want: "cinematic" as const, keywords: [] }, callout: { kind: "none" as const, primary: "", secondary: "" } });
  const filler = Array.from({ length: 96 }, (_, i) => `word${i}`).join(" ") + ".";
  const chapter = { paragraphs: [paragraph(filler), paragraph(quote.text, quote.id), paragraph(filler), paragraph(filler), paragraph(filler)], claims: [] };
  const accepted = validateChapter(chapter, { availableQuotes: [quote] });
  assert.ok(accepted.every((problem) => !problem.includes("Paragraph 2 is") && !problem.includes("character quote")));
  assert.ok(validateChapter(chapter).some((problem) => /character quote/i.test(problem)));
});

test("overlapping sections of one movie retain their separate target identities", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-identity-test-"));
  const movie = upload("Example Game All Cutscenes", { chapters: [{ title: "Alpha speaks", start: 5 }, { title: "Beta appears", start: 10 }] });
  const targets = ["Alpha", "Beta"].map((name, i) => ({ key: `beat:${i}`, text: `${name} appears`, want: "character" as const,
    energy: "medium" as const, keywords: [name] }));
  try {
    const clips = await cutsceneMedia({ enabled: true, scenes: true, gameTitle: "Example Game", episodeDir: dir,
      maxClips: 2, maxSeconds: 10, ytdlp: "unused", targets,
      deps: { search: async () => [movie], details: async (item) => item, captions: async () => "", lease: async () => () => undefined,
        download: async () => undefined, screen: async () => true,
        match: async (options) => options.trailers.map((trailer, i) => ({ kind: "clip" as const, file: `assets/identity_${i}.mp4`,
          sourceUrl: trailer.url, sourceSectionId: trailer.sectionId, durationSeconds: 4, beatIndex: i,
          startSeconds: trailer.anchor, provenance: options.describe(trailer, 4, trailer.anchor ?? 0) })) },
    });
    assert.deepEqual(clips.map((clip) => clip.cutsceneMatch?.targetKey), ["beat:0", "beat:1"]);
    assert.deepEqual(clips.map((clip) => clip.span.from), [5, 10]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("a scene rejected by matching retries a scene upload and then spread footage", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-retry-test-"));
  const movie = upload("Example Game All Cutscenes", { chapters: [{ title: "Alpha appears", start: 100 }] });
  const scene = upload("Example Game Alpha Scene No Commentary", { videoId: "12345678901", duration: 120 });
  const target = { key: "beat:0", text: "Alpha appears", want: "character" as const, energy: "medium" as const, keywords: ["Alpha"] };
  let matchCalls = 0;
  try {
    const clips = await cutsceneMedia({ enabled: true, scenes: true, gameTitle: "Example Game", episodeDir: dir,
      maxClips: 1, maxSeconds: 4.8, ytdlp: "unused", targets: [target],
      deps: { search: async (query) => query.includes("Alpha") ? [scene] : [movie], details: async (item) => item,
        captions: async () => "", lease: async () => () => undefined, download: async () => undefined,
        screen: async () => true,
        match: async (options) => {
          matchCalls++;
          if (matchCalls === 1) throw new Error("matcher unavailable");
          if (matchCalls === 2) return [];
          const trailer = options.trailers[0]!;
          return [{ kind: "clip" as const, file: "assets/retry.mp4", sourceUrl: trailer.url,
            sourceSectionId: trailer.sectionId, durationSeconds: 4, beatIndex: 0, startSeconds: 1,
            provenance: `${options.describe(trailer, 4, 1)}; chosen for beat:0 by rule` }];
        } },
    });
    assert.equal(matchCalls, 3);
    assert.equal(clips[0]?.cutsceneMatch?.how, "spread");
    assert.equal(clips[0]?.youtubeSource?.videoId, movie.videoId);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("a section rejected by the frame screen falls back to a scene upload", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-screen-retry-test-"));
  const movie = upload("Example Game All Cutscenes", { chapters: [{ title: "Alpha appears", start: 100 }] });
  const scene = upload("Example Game Alpha Scene No Commentary", { videoId: "12345678901", duration: 120 });
  const target = { key: "beat:0", text: "Alpha appears", want: "character" as const, energy: "medium" as const, keywords: ["Alpha"] };
  try {
    const clips = await cutsceneMedia({ enabled: true, scenes: true, gameTitle: "Example Game", episodeDir: dir,
      maxClips: 1, maxSeconds: 4.8, ytdlp: "unused", targets: [target],
      deps: { search: async (query) => query.includes("Alpha") ? [scene] : [movie], details: async (item) => item,
        captions: async () => "", lease: async () => () => undefined, download: async () => undefined,
        screen: async (file) => !file.endsWith("section_0.mp4"), match: async (options) => {
          const trailer = options.trailers[0]!;
          return [{ kind: "clip" as const, file: "assets/scene.mp4", sourceUrl: trailer.url, sourceSectionId: trailer.sectionId,
            durationSeconds: 4, beatIndex: 0, startSeconds: trailer.anchor, provenance: options.describe(trailer, 4, trailer.anchor ?? 0) }];
        } },
    });
    assert.equal(clips[0]?.cutsceneMatch?.how, "scene upload");
    assert.equal(clips[0]?.youtubeSource?.videoId, scene.videoId);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("scene-specific uploads can be used when no full movie was found", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-no-movie-test-"));
  const scene = upload("Example Game Alpha Scene No Commentary", { videoId: "12345678901", duration: 120 });
  const target = { key: "beat:0", text: "Alpha appears", want: "character" as const, energy: "medium" as const, keywords: ["Alpha"] };
  try {
    const clips = await cutsceneMedia({ enabled: true, scenes: true, gameTitle: "Example Game", episodeDir: dir,
      maxClips: 1, maxSeconds: 4.8, ytdlp: "unused", targets: [target],
      deps: { search: async (query) => query.includes("Alpha") ? [scene] : [], details: async (item) => item,
        captions: async () => "", lease: async () => () => undefined, download: async () => undefined,
        screen: async () => true, match: async (options) => {
          const trailer = options.trailers[0]!;
          return [{ kind: "clip" as const, file: "assets/scene.mp4", sourceUrl: trailer.url, sourceSectionId: trailer.sectionId,
            durationSeconds: 4, beatIndex: 0, startSeconds: trailer.anchor, provenance: options.describe(trailer, 4, trailer.anchor ?? 0) }];
        } },
    });
    assert.equal(clips[0]?.cutsceneMatch?.how, "scene upload");
    assert.equal(clips[0]?.youtubeSource?.videoId, scene.videoId);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("many targets cannot exhaust all section attempts before fallback", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-many-targets-test-"));
  const names = Array.from({ length: 20 }, (_, i) => `Person${i}`);
  const movie = upload("Example Game All Cutscenes", { chapters: names.map((name, i) => ({ title: `${name} appears`, start: 100 + i * 40 })) });
  const targets = names.map((name, i) => ({ key: `beat:${i}`, text: `${name} appears`, want: "character" as const,
    energy: "medium" as const, keywords: [name] }));
  let calls = 0;
  try {
    const clips = await cutsceneMedia({ enabled: true, scenes: true, gameTitle: "Example Game", episodeDir: dir,
      maxClips: 2, maxSeconds: 10, ytdlp: "unused", targets,
      deps: { search: async (query) => query.includes("Person") ? [] : [movie], details: async (item) => item,
        captions: async () => "", lease: async () => () => undefined, download: async () => undefined,
        screen: async () => true, match: async (options) => {
          calls++;
          if (calls === 1) return [];
          const trailer = options.trailers[0]!;
          return [{ kind: "clip" as const, file: `assets/fallback_${calls}.mp4`, sourceUrl: trailer.url,
            sourceSectionId: trailer.sectionId, durationSeconds: 4, beatIndex: calls - 2, startSeconds: 1,
            provenance: options.describe(trailer, 4, 1) }];
        } },
    });
    assert.equal(clips.length, 2);
    assert.ok(clips.every((clip) => clip.cutsceneMatch?.how === "spread"));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("a semantic spread match stays pinned while a motion-only fallback stays unpinned", async () => {
  for (const semantic of [true, false]) {
    const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-spread-target-test-"));
    const movie = upload("Example Game All Cutscenes");
    const target = { key: "take", text: "Alpha appears", want: "character" as const, energy: "medium" as const, keywords: ["Alpha"] };
    try {
      const clips = await cutsceneMedia({ enabled: true, scenes: true, gameTitle: "Example Game", episodeDir: dir,
        maxClips: 1, maxSeconds: 4.8, ytdlp: "unused", targets: [target],
        deps: { search: async (query) => query.includes("Alpha") ? [] : [movie], details: async (item) => item,
          captions: async () => "", lease: async () => () => undefined, download: async () => undefined,
          screen: async () => true, match: async (options) => {
            const trailer = options.trailers[0]!;
            return [{ kind: "clip" as const, file: "assets/spread.mp4", sourceUrl: trailer.url,
              sourceSectionId: trailer.sectionId, assignedTargetKey: semantic ? "take" : undefined,
              durationSeconds: 4, startSeconds: 1, provenance: options.describe(trailer, 4, 1) }];
          } },
      });
      assert.equal(clips[0]?.cutsceneMatch?.targetKey, semantic ? "take" : undefined);
      assert.equal(clips[0]?.cutsceneMatch?.requestedTarget, "take");
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
});

test("later targets are attempted when earlier targets produce no usable clips", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-later-target-test-"));
  const names = ["Alpha", "Beta", "Gamma"];
  const movie = upload("Example Game All Cutscenes", { chapters: names.map((name, i) => ({ title: `${name} appears`, start: 100 + i * 50 })) });
  const targets = names.map((name, i) => ({ key: `beat:${i}`, text: `${name} appears`, want: "character" as const,
    energy: "medium" as const, keywords: [name] }));
  try {
    const clips = await cutsceneMedia({ enabled: true, scenes: true, gameTitle: "Example Game", episodeDir: dir,
      maxClips: 2, maxSeconds: 10, ytdlp: "unused", targets,
      deps: { search: async (query) => names.some((name) => query.includes(name)) ? [] : [movie], details: async (item) => item,
        captions: async () => "", lease: async () => () => undefined, download: async () => undefined,
        screen: async () => true, match: async (options) => {
          const trailer = options.trailers.find((item) => item.targetKey === "beat:2");
          if (!trailer) return [];
          return [{ kind: "clip" as const, file: "assets/later.mp4", sourceUrl: trailer.url, sourceSectionId: trailer.sectionId,
            durationSeconds: 4, beatIndex: 2, startSeconds: trailer.anchor, provenance: options.describe(trailer, 4, trailer.anchor ?? 0) }];
        } },
    });
    assert.equal(clips[0]?.cutsceneMatch?.targetKey, "beat:2");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

// 8 Nov 2026 Ocarina trial: "All Ganondorf Scenes" was found, its chapter "Ganondorf's introduction" starts at 0:00, and
// the only frame at or before that second was a white flash, so the check never saw Ganondorf. These frames copy that
// section's brightness: a flash at 0 s, Link at 6 s, Ganondorf before the castle at night (luma 33) at 24 s.
const ganonTarget = { key: "beat:0", text: "Ganondorf rises over Hyrule Castle", want: "cinematic" as const,
  energy: "medium" as const, keywords: ["Ganondorf", "Hyrule Castle"] };
const sceneTrailers = [
  { file: "ganon.mp4", name: "All Ganondorf Scenes", url: "g", total: 30, targetKey: "beat:0", anchor: 1, sceneMethod: "scene upload" as const },
  { file: "other.mp4", name: "Other", url: "o", total: 30, targetKey: "beat:9", anchor: 15, sceneMethod: "chapter" as const },
];
const sceneFrame = (index: number, movie: number, time: number, luma: number, extra: object = {}) =>
  ({ index, movie, time, luma, motion: 5, frame: `frame_${index}.jpg`, nextCut: time + 4, ...extra });
const sceneFrames = [sceneFrame(1, 0, 0, 240), sceneFrame(2, 0, 6, 47), sceneFrame(3, 0, 24, 33),
  sceneFrame(4, 0, 25.5, 60, { nextCut: 26 }), sceneFrame(5, 0, 12, 20), sceneFrame(6, 1, 24, 100)];

test("a located section offers every lit frame after a chapter's start, night scenes included", () => {
  assert.deepEqual(sceneCandidates(ganonTarget, sceneFrames, sceneTrailers).map((c) => c.index), [2, 3]);
  // Without a picture check the frame nearest the timestamp is the guess, either side of it.
  assert.equal(preferredSceneAssignments([ganonTarget], sceneFrames, sceneTrailers)[0]?.candidate, 2);
  const many = Array.from({ length: 30 }, (_, i) => sceneFrame(100 + i, 0, i, 90, { nextCut: i + 3 }));
  const spread = sceneCandidates(ganonTarget, many, sceneTrailers);
  assert.equal(spread.length, SCENE_REVIEW_FRAMES);
  assert.ok(spread[0]!.time < 3 && spread.at(-1)!.time > 24);
});

test("the picture check accepts the frame that shows the named character and refuses a wrong or unsure one", async () => {
  const seen: number[][] = [];
  const reviewer = (answer: { key?: string; candidate: number; confidence: number }) =>
    async (targets: { key: string }[], frames: { index: number }[]) => {
      seen.push(frames.map((f) => f.index));
      assert.deepEqual(targets.map((t) => t.key), ["beat:0"]);
      return [{ key: answer.key ?? "beat:0", candidate: answer.candidate, confidence: answer.confidence, reason: "Ganondorf before Hyrule Castle" }];
    };
  const none = new Map();
  const ok = await verifySceneAssignments([ganonTarget], sceneFrames, sceneTrailers, none, reviewer({ candidate: 3, confidence: 0.9 }));
  assert.deepEqual(ok.map((a) => a.candidate), [3]);
  assert.match(ok[0]!.reason, /scene upload checked/);
  assert.deepEqual(seen[0], [2, 3]); // only this line's own section, never another target's
  for (const wrong of [{ candidate: 3, confidence: 0.3 }, { candidate: 6, confidence: 1 }, { candidate: 1, confidence: 1 },
    { key: "beat:9", candidate: 3, confidence: 1 }])
    assert.deepEqual(await verifySceneAssignments([ganonTarget], sceneFrames, sceneTrailers, none, reviewer(wrong)), [], JSON.stringify(wrong));
  // A failed call falls back to the local screen, and with no verdict at all nothing is used.
  const clean = new Map([[2, { text: false, webcam: false, gore: false, dark: false, hud: false, letterbox: false, blurry: false }]]);
  const failing = async () => { throw new Error("vision call failed"); };
  assert.deepEqual((await verifySceneAssignments([ganonTarget], sceneFrames, sceneTrailers, clean, failing)).map((a) => a.candidate), [2]);
  assert.deepEqual(await verifySceneAssignments([ganonTarget], sceneFrames, sceneTrailers, none, failing), []);
  assert.deepEqual(await verifySceneAssignments([ganonTarget], sceneFrames, sceneTrailers, none), []);
});

test("the scene check uses its own instructions and refuses a frame it reads text or a watermark in", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-scene-check-test-"));
  try {
    const frames = sceneFrames.map((f) => ({ ...f, frame: path.join(dir, f.frame) }));
    for (const f of frames) await fs.writeFile(f.frame, "jpeg");
    const asked: string[] = [];
    const answer = (textOnGanondorf: boolean) => ({
      structured: async (o: { system: string; content: Array<{ type: string; text?: string }> }) => {
        asked.push(o.system);
        assert.match(o.content.at(-1)!.text!, /Ganondorf rises over Hyrule Castle/);
        return {
          candidates: [{ index: 2, label: "Link and Navi at night", has_text_or_logo: false, energy: "low" },
            { index: 3, label: "Ganondorf before the castle", has_text_or_logo: textOnGanondorf, energy: "medium" }],
          assignments: [{ key: "beat:0", candidate_index: 3, confidence: 0.92, reason: "Ganondorf on screen, castle behind" }],
        };
      },
    }) as never;
    for (const withText of [false, true]) {
      const textFrames = new Set<number>();
      const picks = await verifySceneAssignments([ganonTarget], frames, sceneTrailers, new Map(),
        (t, f) => rankByModel(answer(withText), t, f, textFrames, SCENE_PROMPT));
      assert.deepEqual(picks.map((a) => a.candidate), withText ? [] : [3]);
      assert.equal(textFrames.has(3), withText);
    }
    assert.ok(asked.every((s) => s === SCENE_PROMPT));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("a chapter's section starts at the chapter and a rejected scene upload gives way to the next", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "cutscene-next-scene-test-"));
  const first = upload("Example Game All Ganondorf Scenes", { videoId: "AAAAAAAAAAA", duration: 1112, viewCount: 5000,
    chapters: [{ title: "Ganondorf's introduction", start: 0, end: 246 }, { title: "Ganondorf's defeat", start: 607, end: 730 }] });
  const second = upload("Example Game All Ganondorf Scenes", { videoId: "BBBBBBBBBBB", duration: 1100, viewCount: 10 });
  const target = { key: "beat:0", text: "Ganondorf rises", want: "character" as const, energy: "medium" as const, keywords: ["Ganondorf"] };
  const calls: Array<{ id: string; from: number; to: number }> = [];
  try {
    const clips = await cutsceneMedia({ enabled: true, scenes: true, recentRelease: true, gameTitle: "Example Game", episodeDir: dir,
      maxClips: 1, maxSeconds: 4.8, ytdlp: "unused", targets: [target],
      deps: { search: async (query) => query.includes("Ganondorf") ? [first, second] : [], details: async (item) => item,
        captions: async () => "", lease: async () => () => undefined,
        download: async (item, from, to) => { calls.push({ id: item.videoId, from, to }); },
        screen: async () => true,
        match: async (options) => {
          const trailer = options.trailers[0]!;
          if (trailer.url.includes(first.videoId)) return [];
          return [{ kind: "clip" as const, file: "assets/next.mp4", sourceUrl: trailer.url, sourceSectionId: trailer.sectionId,
            durationSeconds: 4, beatIndex: 0, startSeconds: 3, provenance: options.describe(trailer, 4, 3) }];
        } },
    });
    assert.deepEqual(calls.map((c) => c.id), [first.videoId, second.videoId]);
    assert.equal(calls[0]!.from, 0); // "Ganondorf's introduction" at 0:00, not a section centred on it
    assert.equal(calls[0]!.to, 30);
    assert.equal(clips[0]?.youtubeSource?.videoId, second.videoId);
    assert.equal(clips[0]?.cutsceneMatch?.how, "scene upload");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
