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
  type CutsceneUpload,
} from "../src/assets/cutscenes.ts";
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
