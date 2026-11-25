// The stream recordings served from the PC (src/vodindex/sources.ts, serve.ts, remote.ts) and the permitted channel's
// rules: credit by handle, facecam and overlay stretches never used, the owner's channel first, captures outside caps.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { tmpDir } from "./helpers.ts";
import {
  STREAM_CAPTURE,
  sourceByChannel,
  sourceOfFile,
  vodSources,
} from "../src/vodindex/sources.ts";
import {
  wordsFromTags,
  untagged,
  parseTags,
  tagPrompt,
  taggedSceneIndex,
  unknownTags,
  vodMomentBlocked,
  type VodTagFile,
  type VodTags,
} from "../src/vodindex/tags.ts";
import {
  parseVodIndex,
  saveVodIndex,
  vodIndexDir,
  type VodIndex,
} from "../src/vodindex/schema.ts";
import {
  clipSpan,
  handleVod,
  MAX_CLIP_SECONDS,
  vodReady,
  vodServeContext,
  type VodServeContext,
} from "../src/vodindex/serve.ts";
import {
  remoteCacheFile,
  remoteVodDeps,
  scorerFrom,
} from "../src/vodindex/remote.ts";
import {
  ownStreamClips,
  permittedStreamProvenance,
  recordingsOf,
} from "../src/semantic/hook.ts";
import { semanticSettings } from "../src/semantic/settings.ts";
import { spoilerWindow } from "../src/sceneindex/spoilers.ts";
import {
  chapterFootageUsed,
  gatherCutsceneSources,
  type CutsceneClip,
} from "../src/assets/cutscenes.ts";
import { indexFirstCutscenes } from "../src/sceneindex/footage.ts";
import type { SceneShot } from "../src/sceneindex/schema.ts";

const shot = (
  id: number,
  start: number,
  end: number,
  desc: string,
): SceneShot => ({
  id,
  start,
  end,
  keyframes: [start + 0.5],
  desc,
  who: [],
  where: "",
  mood: "",
  tags: [],
  text: "",
  luma: 120,
  motion: 20,
});

function vod(file: string, over: Partial<VodIndex> = {}): VodIndex {
  return {
    version: 1,
    vodId: "v1",
    file,
    title: "GTA 6 | Return to Vice City!",
    game: "Grand Theft Auto VI",
    recordedOn: "2026-11-22",
    duration: 60,
    builtAt: "2026-11-25T10:00:00.000Z",
    coverage: [{ from: 0, to: 60 }],
    shots: [
      shot(0, 0, 10, "a red scooter outside Scooter Bros on a sunny street"),
      shot(1, 10, 20, "a red scooter parked by a beach"),
      shot(2, 30, 40, "two characters talk in an office"),
      shot(3, 40, 50, "a police car chases a sports car at night"),
    ],
    lines: [],
    ...over,
  };
}

const tag = (from: number, to: number, o: Partial<VodTags> = {}): VodTags => ({
  from,
  to,
  place: "Vice City",
  activity: "riding a scooter",
  vehicle: "a scooter",
  brands: [],
  timeOfDay: "day",
  story: false,
  menu: false,
  overlay: false,
  words: [],
  ...o,
});

const tagsOf = (list: VodTags[]): VodTagFile => ({
  version: 1,
  stretches: Object.fromEntries(
    list.map((t) => [`${t.from.toFixed(2)}|${t.to.toFixed(2)}`, t]),
  ),
});

test("sources: the owner's channel first, the cousin's credited by handle only, VOD_SOURCES overrides", () => {
  const s = vodSources({});
  assert.deepEqual(
    s.map((x) => x.channel),
    ["tinotv", "spencey96"],
  );
  assert.equal(s[0]!.own, true);
  assert.equal(s[0]!.credit, "");
  assert.equal(s[1]!.own, false);
  assert.equal(s[1]!.credit, "Gameplay: Spencey96 on Twitch");
  assert.match(s[1]!.dir, /Spencey96 VODs$/);
  assert.match(s[1]!.archive, /spencey96-downloaded\.txt$/);
  const custom = vodSources({
    VOD_SOURCES: "spencey96=E:/a;newone=E:/b",
    VOD_DEFAULT_GAME: "Elden Ring",
  });
  assert.deepEqual(
    custom.map((x) => [x.channel, x.rank, x.defaultGame]),
    [
      ["spencey96", 0, "Elden Ring"],
      ["newone", 1, "Elden Ring"],
    ],
  );
  assert.equal(custom[1]!.credit, "Gameplay: newone on Twitch");
  assert.equal(
    sourceOfFile(path.join(s[1]!.dir, "x [v9].mp4"), s)?.channel,
    "spencey96",
  );
  assert.equal(sourceOfFile("C:/elsewhere/x.mp4", s), undefined);
  assert.equal(sourceByChannel(undefined, s)?.channel, "tinotv");
  assert.equal(
    sourceByChannel("spencey96", [])?.credit,
    "Gameplay: Spencey96 on Twitch",
  );
  assert.ok(STREAM_CAPTURE.test("Pulse's own gameplay capture of X"));
  assert.ok(STREAM_CAPTURE.test("Permitted stream capture of X"));
  assert.ok(!STREAM_CAPTURE.test('Cutscenes for "X"'));
});

test("tags: a facecam or overlay is asked about, parsed, and keeps the stretch out; unknown is held and blocked", () => {
  assert.match(
    tagPrompt({ game: "G", places: [], seen: [], text: "", said: "" }),
    /overlay: true when either frame shows a webcam or facecam box/,
  );
  const t = parseTags(
    {
      place: "Vice Beach",
      activity: "driving",
      vehicle: "",
      brands: [],
      time_of_day: "day",
      story: false,
      menu: false,
      overlay: true,
      words: [],
    },
    { from: 0, to: 30 },
    [],
  );
  assert.equal(t?.overlay, true);
  assert.equal(
    vodMomentBlocked(t, true),
    "a facecam or stream overlay on the picture",
  );
  assert.equal(vodMomentBlocked(tag(0, 1), false), undefined);
  // A shot with no tags at all (blank or not described): fine in the owner's play, never from a permitted channel.
  assert.equal(vodMomentBlocked(undefined, true), undefined);
  assert.equal(vodMomentBlocked(undefined, false), "not tagged, may show a facecam");
  assert.equal(
    vodMomentBlocked(tag(0, 1, { menu: true }), true),
    "a menu or map",
  );
  // Tags made before overlays were asked about: fine for the owner's own play, blocked for a permitted channel.
  const old = { ...tag(0, 1) } as Partial<VodTags>;
  delete old.overlay;
  assert.equal(vodMomentBlocked(old as VodTags, true), undefined);
  assert.equal(
    vodMomentBlocked(old as VodTags, false),
    "not checked for a facecam or overlay",
  );
  assert.equal(unknownTags({ from: 0, to: 1 }).story, true);
  assert.equal(unknownTags({ from: 0, to: 1 }).overlay, true);
  // In the searchable index, a shot under an overlay is a menu: never matched.
  const v = vod("x.mp4");
  const idx = taggedSceneIndex(
    v,
    tagsOf([tag(0, 10, { overlay: true }), tag(10, 20)]),
  );
  assert.equal(idx.shots[0]!.menu, true);
  assert.equal(idx.shots[1]!.menu, undefined);
  assert.equal(
    taggedSceneIndex({ ...v, channel: "spencey96" }, tagsOf([tag(10, 20)]))
      .source.uploader,
    "spencey96",
  );
});

test("schema: the channel survives a round trip; older indexes have none", () => {
  assert.equal(
    parseVodIndex({ ...vod("x.mp4"), channel: "spencey96" })?.channel,
    "spencey96",
  );
  assert.equal(parseVodIndex(vod("x.mp4"))?.channel, undefined);
});

test("recordingsOf: however the game is spelt, the owner's channel first, then newest first", () => {
  const list = [
    vod("a", {
      vodId: "s1",
      channel: "spencey96",
      game: "Grand Theft Auto VI",
    }),
    vod("b", { vodId: "t1", game: "GTA 6" }),
    vod("c", { vodId: "t2", channel: "tinotv", game: "Grand Theft Auto VI" }),
    vod("d", { vodId: "e1", game: "Elden Ring" }),
  ];
  assert.deepEqual(
    recordingsOf(list, "Grand Theft Auto VI", vodSources({})).map(
      (v) => v.vodId,
    ),
    ["t1", "t2", "s1"],
  );
  assert.deepEqual(
    recordingsOf(list, "GTA VI", vodSources({})).map((v) => v.vodId),
    ["t1", "t2", "s1"],
  );
  assert.match(
    permittedStreamProvenance(
      {
        title: 'GTA VI "Chapter 3"',
        vodId: "v9",
        recordedOn: "2026-11-23",
        channel: "spencey96",
      },
      "Grand Theft Auto VI",
      12.34,
      4,
      "Gameplay: Spencey96 on Twitch",
    ),
    /^Permitted stream capture of Grand Theft Auto VI \(Gameplay: Spencey96 on Twitch; stream recording "GTA VI  Chapter 3 ", v9, 2026-11-23\), 4s at 12.3s, muted; used with the streamer's permission$/,
  );
});

test("serve: clip spans stay inside the recording and short; ready means every described stretch tagged", () => {
  assert.deepEqual(clipSpan("10", "14.567", 60), { from: 10, to: 14.57 });
  assert.equal(clipSpan("10", "9", 60), undefined);
  assert.equal(clipSpan("-1", "3", 60), undefined);
  assert.equal(clipSpan("0", String(MAX_CLIP_SECONDS + 1), 600), undefined);
  assert.equal(clipSpan("55", "70", 60), undefined);
  assert.equal(clipSpan("x", "3", 60), undefined);
  const v = vod("x.mp4");
  assert.equal(vodReady(v, tagsOf([tag(0, 20), tag(30, 50)])), true);
  assert.equal(vodReady(v, tagsOf([tag(0, 20)])), false);
  assert.equal(vodReady(v, tagsOf([])), false);
  const ctx = vodServeContext({ VOD_ROOT: "E:/v" }, { model: "m" });
  assert.equal(ctx.dataDir, path.join("C:/pulse-vods", "data"), "the indexes live on C:, never D:");
  assert.equal(vodServeContext({ VOD_INDEX_ROOT: "E:/i" }, { model: "m" }).clipDir, path.join("E:/i", "clips"));
  assert.equal(ctx.windows()[0]?.game, "Grand Theft Auto VI");
  assert.equal(ctx.windows()[0]?.until, "2026-12-18T00:00:00.000Z");
});

/** A real server over a temporary data folder, with handleVod alone. */
async function serveVods(
  ctx: VodServeContext,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    if (!(await handleVod(req, res, ctx))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

test("serve and remote: the Mac lists, copies and scores the PC's ready recordings, never a missing or part-tagged one", async () => {
  const dir = await tmpDir();
  const rec = path.join(dir, "rec [v1].mp4");
  await fs.writeFile(rec, "not really a video");
  await saveVodIndex(dir, vod(rec));
  await saveVodIndex(dir, vod(path.join(dir, "gone.mp4"), { vodId: "v2" }));
  await saveVodIndex(dir, vod(rec, { vodId: "v3" }));
  for (const id of ["v1", "v2"])
    await fs.writeFile(
      path.join(vodIndexDir(dir, id), "tags.json"),
      JSON.stringify(tagsOf([tag(0, 20), tag(30, 50)])),
    );
  await fs.writeFile(
    path.join(vodIndexDir(dir, "v3"), "tags.json"),
    JSON.stringify(tagsOf([tag(0, 20)])),
  );
  const ctx: VodServeContext = {
    ...vodServeContext({}, { model: "m" }),
    dataDir: dir,
    clipDir: path.join(dir, "clips"),
    sources: vodSources({}),
  };
  const srv = await serveVods(ctx);
  try {
    const list = (await (await fetch(`${srv.base}/vod/list`)).json()) as Array<{
      vodId: string;
      channel: string;
    }>;
    assert.deepEqual(
      list.map((l) => [l.vodId, l.channel]),
      [["v1", "tinotv"]],
    );
    assert.equal(
      (await fetch(`${srv.base}/vod/clip?vod=v1&from=0&to=99`)).status,
      400,
    );
    assert.equal((await fetch(`${srv.base}/vod/index?vod=nope`)).status, 404);
    // No vectors on the PC yet: an empty score, so the Mac's words alone judge.
    const sc = await fetch(`${srv.base}/vod/score`, {
      method: "POST",
      body: JSON.stringify({ vod: "v1", targets: [{ key: "k", text: "x" }] }),
    });
    assert.deepEqual(await sc.json(), { scores: {} });
    const stale = await fetch(`${srv.base}/vod/score`, {
      method: "POST",
      body: JSON.stringify({ vod: "v1", builtAt: "old", targets: [] }),
    });
    assert.equal(stale.status, 409);
    const cache = path.join(dir, "mac");
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(remoteCacheFile(cache, "vOld"), "{}");
    const deps = remoteVodDeps(srv.base, cache);
    const got = await deps.list!("unused");
    assert.deepEqual(
      got.map((v) => v.vodId),
      ["v1"],
    );
    assert.equal(Object.keys((await deps.tags!(got[0]!)).stretches).length, 2);
    assert.ok(await fs.stat(remoteCacheFile(cache, "v1")));
    await assert.rejects(
      fs.stat(remoteCacheFile(cache, "vOld")),
      "a recording no longer served is forgotten",
    );
    assert.equal(await deps.readable!("x"), true);
  } finally {
    await srv.close();
  }
  // The PC off: no recordings, no throw.
  assert.deepEqual(
    await remoteVodDeps("http://127.0.0.1:9", path.join(dir, "mac2")).list!(
      "x",
    ),
    [],
  );
  const sc = scorerFrom({ k: [0.9, null, 0.2] });
  assert.deepEqual(
    [...sc!({ key: "k" } as never)!.entries()],
    [
      [0, 0.9],
      [2, 0.2],
    ],
  );
  assert.equal(scorerFrom({}), undefined);
});

test("own stream clips: a permitted channel is credited by handle, its overlay stretches never offered, the owner's first", async () => {
  const dir = await tmpDir();
  const own = vod("own.mp4", { vodId: "t1" });
  const cousin = vod("cousin.mp4", { vodId: "s1", channel: "spencey96" });
  const tags = new Map<string, VodTagFile>([
    ["t1", tagsOf([tag(0, 20), tag(30, 50, { story: true })])],
    ["s1", tagsOf([tag(0, 20, { overlay: true }), tag(30, 50)])],
  ]);
  const order: string[] = [];
  const allowed = new Map<string, number[]>();
  const cuts: string[] = [];
  const w = spoilerWindow("Grand Theft Auto VI", "2026-11-18T11:00Z", {
    days: 28,
    openingShare: 0.1,
    until: "2026-12-17",
  })!;
  const clips = await ownStreamClips(
    {
      dataDir: dir,
      semantic: { ...semanticSettings({}, () => false), vodTags: true },
      sceneIndexMinConfidence: 0.3,
      ytdlpPath: "yt-dlp",
    },
    {
      gameTitle: "GTA 6",
      episodeDir: dir,
      targets: [
        {
          key: "beat:0",
          text: "a scooter",
          want: "gameplay",
          energy: "medium",
          keywords: [],
        },
        {
          key: "beat:1",
          text: "a police chase",
          want: "gameplay",
          energy: "medium",
          keywords: [],
        },
      ],
      maxClips: 4,
      maxSeconds: 20,
    },
    async (x) => {
      order.push(x.index.source.videoId);
      allowed.set(
        x.index.source.videoId,
        x.index.shots.filter((s) => !s.menu && x.allow(s, "")).map((s) => s.id),
      );
      await x.deps.download(
        x.index.source.videoId,
        1,
        4,
        path.join(dir, "section.mp4"),
      );
      const key = x.index.source.videoId === "t1" ? 0 : 1;
      return [
        {
          kind: "clip",
          file: `assets/c_${key}.mp4`,
          sourceUrl: "",
          durationSeconds: 3,
          beatIndex: key,
          startSeconds: 41,
          provenance: "x",
          credit: "x",
          span: { source: "x", from: 41, to: 44 },
          reason: "scene index: a chase",
        } as CutsceneClip,
      ];
    },
    new Date("2026-11-25T12:00:00Z"),
    [w],
    {
      list: async () => [cousin, own],
      tags: async (v) => tags.get(v.vodId)!,
      readable: async () => true,
      cut: async (v, from, to) => {
        cuts.push(`${v.vodId}:${from}-${to}`);
      },
      sources: vodSources({}),
    },
  );
  assert.deepEqual(
    order,
    ["t1", "s1"],
    "the owner's own play is searched first",
  );
  assert.deepEqual(
    allowed.get("t1"),
    [0, 1],
    "the story stretch is held in the window",
  );
  assert.deepEqual(
    allowed.get("s1"),
    [2, 3],
    "the facecam stretch never offered",
  );
  assert.deepEqual(
    cuts,
    ["t1:1-4", "s1:1-4"],
    "clips are cut where the recordings are",
  );
  assert.match(clips[0]!.provenance, /^Pulse's own gameplay capture/);
  assert.equal(clips[0]!.credit, "");
  assert.match(
    clips[1]!.provenance,
    /^Permitted stream capture of GTA 6 \(Gameplay: Spencey96 on Twitch;/,
  );
  assert.equal(clips[1]!.credit, "Gameplay: Spencey96 on Twitch");
});

test("caps: stream captures ride on their own allowance, never shrinking a publisher's or counting against it", async () => {
  const clip = (prov: string, seconds: number, beatIndex = 0) =>
    ({
      kind: "clip",
      file: "f.mp4",
      sourceUrl: "",
      durationSeconds: seconds,
      beatIndex,
      provenance: prov,
      credit: "",
      span: { source: "s", from: 0, to: seconds },
    }) as CutsceneClip;
  assert.equal(
    chapterFootageUsed(
      [clip("Permitted stream capture of X", 5), clip('Cutscenes for "X"', 3)],
      0,
    ),
    3,
  );
  const asked: Array<{ maxSeconds: number; ownMaxSeconds?: number }> = [];
  const added = await gatherCutsceneSources({
    enabled: true,
    videoLimit: 6,
    streamSeconds: 20,
    jobs: [
      {
        gameTitle: "Some Game",
        episodeDir: "/e",
        targets: [
          {
            key: "hook",
            text: "x",
            want: "gameplay",
            energy: "high",
            keywords: [],
          },
        ],
      },
    ],
    // The publisher's allowance already spent elsewhere: only the stream allowance is left.
    existing: [
      {
        provenance: 'Cutscenes for "Some Game" from YouTube',
        durationSeconds: 6,
      },
    ],
    fetch: async (job) => {
      asked.push({
        maxSeconds: job.maxSeconds,
        ...(job.ownMaxSeconds !== undefined
          ? { ownMaxSeconds: job.ownMaxSeconds }
          : {}),
      });
      return [
        clip("Pulse's own gameplay capture of Some Game", 8),
        clip("Pulse's own gameplay capture of Some Game", 8),
        clip('Cutscenes for "Some Game"', 4),
      ];
    },
  });
  assert.equal(asked[0]!.ownMaxSeconds, 20);
  assert.deepEqual(
    added.map((c) => [c.provenance.slice(0, 12), c.durationSeconds]),
    [
      ["Pulse's own ", 8],
      ["Pulse's own ", 8],
    ],
  );
  // Without the stream allowance: as before, the publisher's cap decides and nothing is fetched past it.
  const before = await gatherCutsceneSources({
    enabled: true,
    videoLimit: 6,
    jobs: [
      {
        gameTitle: "Some Game",
        episodeDir: "/e",
        targets: [
          {
            key: "hook",
            text: "x",
            want: "gameplay",
            energy: "high",
            keywords: [],
          },
        ],
      },
    ],
    existing: [
      {
        provenance: 'Cutscenes for "Some Game" from YouTube',
        durationSeconds: 6,
      },
    ],
    fetch: async () => assert.fail("no allowance left"),
  });
  assert.deepEqual(before, []);
});

test("indexFirstCutscenes: with an own allowance the recordings are tried first and the rest still gets its full seconds", async () => {
  const dir = await tmpDir();
  const searched: Array<{ keys: string[]; maxSeconds: number }> = [];
  const out = await indexFirstCutscenes(
    {
      sceneIndex: false,
      sceneIndexMinConfidence: 0.3,
      dataDir: dir,
      ytdlpPath: "yt-dlp",
      semantic: { ...semanticSettings({}, () => false), vodTags: true },
    },
    {
      gameTitle: "Nothing Recorded",
      episodeDir: dir,
      targets: [
        {
          key: "hook",
          text: "x",
          want: "gameplay",
          energy: "high",
          keywords: [],
        },
      ],
      maxClips: 3,
      maxSeconds: 4,
      ownMaxSeconds: 30,
    },
    async (o) => {
      searched.push({
        keys: o.targets.map((t) => t.key),
        maxSeconds: o.maxSeconds,
      });
      return [];
    },
  );
  assert.deepEqual(out, []);
  assert.deepEqual(searched, [{ keys: ["hook"], maxSeconds: 4 }]);
  // The recordings off and the publisher's seconds spent: nothing is fetched at all (no index or search work).
  const none = await indexFirstCutscenes(
    { sceneIndex: true, sceneIndexMinConfidence: 0.3, dataDir: dir, ytdlpPath: "yt-dlp", semantic: { ...semanticSettings({}, () => false), vodTags: false } },
    { gameTitle: "Nothing Recorded", episodeDir: dir, targets: [{ key: "hook", text: "x", want: "gameplay", energy: "high", keywords: [] }], maxClips: 3, maxSeconds: 0, ownMaxSeconds: 30 },
    async () => assert.fail("no allowance left"),
  );
  assert.deepEqual(none, []);
});

test("stretch mode: streams are tagged by the stretch, not described shot by shot, and the shots take the tags' words", async () => {
  const { undescribedVod } = await import("../src/vodindex/build.ts");
  const bare = vod("x.mp4", { describe: "stretch" });
  for (const s of bare.shots) s.desc = "";
  assert.deepEqual(undescribedVod(bare), []);
  assert.equal(untagged(bare, tagsOf([])).length, 2, "every picture shot's stretch wants tags");
  assert.equal(untagged({ ...bare, describe: undefined }, tagsOf([])).length, 0, "the old way waits for descriptions");
  const t = tagsOf([tag(0, 20, { activity: "riding a scooter", place: "Vice Beach" }), tag(30, 50, { menu: true })]);
  assert.equal(untagged(bare, t).length, 0);
  assert.equal(wordsFromTags(bare, t), 4);
  assert.equal(bare.shots[0]!.desc, "riding a scooter, a scooter, in Vice Beach");
  assert.equal(bare.shots[2]!.menu, true);
  assert.equal(wordsFromTags(bare, t), 0, "once");
  assert.equal(parseVodIndex(bare)?.describe, "stretch");
});

test("archive: a recording leaves D: only once the Mac's drive holds it at the same size; otherwise it stays", async () => {
  const { archiveRecording, archivePath, floorFor, roomFor, shQuote } = await import("../src/vodindex/archive.ts");
  const file = path.win32.join("D:", "pulse-data", "vods", "Spencey96 VODs", "2026-11-23 GTA VI Chapter 3 [v9].mp4");
  assert.equal(archivePath(file), "/Volumes/Storage/Spencey96 VODs/2026-11-23 GTA VI Chapter 3 [v9].mp4");
  assert.equal(shQuote("it's"), "'it'\"'\"'s'");
  const calls: string[] = [];
  const deps = (o: { up?: boolean; sizes?: Array<number | "missing">; copyFails?: boolean }) => {
    const sizes = [...(o.sizes ?? [])];
    return {
      driveUp: async () => o.up !== false,
      remoteSize: async () => sizes.shift() ?? "missing",
      copy: async () => {
        calls.push("copy");
        if (o.copyFails) throw new Error("cable out");
      },
      remove: async () => {
        calls.push("remove");
      },
    };
  };
  const r = { file, bytes: 100 };
  assert.deepEqual(await archiveRecording(r, deps({ up: false })), { action: "kept", why: "the Mac's archive drive is not there or not answering" });
  assert.deepEqual(calls, []);
  assert.equal((await archiveRecording(r, deps({ sizes: [100] }))).action, "already");
  assert.deepEqual(calls.splice(0), ["remove"]);
  assert.equal((await archiveRecording(r, deps({ sizes: ["missing", 100] }))).action, "archived");
  assert.deepEqual(calls.splice(0), ["copy", "remove"]);
  // A copy that comes out the wrong size, or fails, never removes the original.
  const short = await archiveRecording(r, deps({ sizes: ["missing", 60] }));
  assert.equal(short.action, "kept");
  assert.match((short as { why: string }).why, /60 bytes, not 100/);
  assert.equal((await archiveRecording(r, deps({ sizes: [50], copyFails: true }))).action, "kept");
  assert.deepEqual(calls.splice(0), ["copy", "copy"]);
  // The floor: 320 GB on the recordings' drive, 30 elsewhere; a write that would cross it is refused with a reason.
  assert.equal(floorFor("D:/pulse-data/vods/clips", {}), 320);
  assert.equal(floorFor("D:/x", { VOD_MIN_FREE_GB: "350" }), 350);
  assert.equal(floorFor("C:/pulse-vods/data", {}), 30);
  assert.deepEqual(await roomFor("D:/x", 5e9, 320, async () => 330), { ok: true, freeGb: 330 });
  const no = await roomFor("D:/x", 15e9, 320, async () => 330);
  assert.equal(no.ok, false);
  assert.match(no.why ?? "", /^refused: .* has 330 GB free and needs 320 GB left after 15.0 GB more$/);
});

test("serve: no new clip is cut when the drive is at its floor; the Mac is told the PC is busy", async () => {
  const dir = await tmpDir();
  const rec = path.join(dir, "rec [v1].mp4");
  await fs.writeFile(rec, "x");
  await saveVodIndex(dir, vod(rec));
  const ctx: VodServeContext = {
    ...vodServeContext({}, { model: "m" }),
    dataDir: dir,
    clipDir: path.join(dir, "clips"),
    sources: vodSources({}),
    room: async () => ({ ok: false, why: "refused: D: has 310 GB free" }),
  };
  const srv = await serveVods(ctx);
  try {
    const res = await fetch(`${srv.base}/vod/clip?vod=v1&from=1&to=4`);
    assert.equal(res.status, 503);
    assert.match(((await res.json()) as { error: string }).error, /310 GB free/);
  } finally {
    await srv.close();
  }
});
