import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { tmpDir } from "./helpers.ts";
import { relaySettings, relaySummary } from "../src/relay/settings.ts";
import {
  backoff,
  joinArgs,
  keyOf,
  plainArgs,
  redact,
  splitArgs,
  startPipe,
  streamlinkArgs,
  type PipeHandle,
} from "../src/relay/pipe.ts";
import {
  archiveFileName,
  eraseSongQueue,
  readArchives,
  RelayJob,
  setupProblem,
  streamDay,
  type RelayDeps,
} from "../src/relay/job.ts";
import {
  RELAY_STREAM_TITLE,
  YouTubeApiError,
  YouTubeLive,
  type BroadcastState,
  type LiveApi,
  type NewBroadcast,
} from "../src/relay/youtube.ts";
import {
  STREAM_AI_LINE,
  streamDescription,
  streamTitle,
} from "../src/liveclips/simulcast.ts";
import { parseVodName } from "../src/vodindex/schema.ts";
import type { LiveStream } from "../src/liveclips/twitch.ts";

const INGEST = "rtmps://a.rtmps.youtube.com/live2/abcd-efgh-ijkl-mnop";

test("relay settings: off by default, public, three restarts, the owner's channel", () => {
  const s = relaySettings({}, "darwin");
  assert.equal(s.enabled, false);
  assert.equal(s.channel, "tinotv");
  assert.equal(s.privacy, "public");
  assert.equal(s.maxRestarts, 3);
  assert.equal(s.healthMinutes, 3);
  assert.equal(s.musicStrip, false);
  assert.equal(s.streamlink, "/opt/homebrew/bin/streamlink");
  assert.equal(relaySummary(s), "off");
  const on = relaySettings(
    {
      STREAM_RELAY: "true",
      RELAY_MUSIC_STRIP: "1",
      STREAM_RELAY_PRIVACY: "nonsense",
    },
    "linux",
  );
  assert.equal(
    on.privacy,
    "public",
    "anything unknown is public, the owner's choice",
  );
  assert.match(relaySummary(on), /no RELAY_MUSIC_STRIP_CMD, audio untouched/);
});

test("relay pipe: ads filtered, video always copied, the key never shown", () => {
  const sl = streamlinkArgs("tinotv", "best");
  assert.ok(sl.includes("--twitch-disable-ads"));
  assert.ok(sl.includes("--stdout"));
  assert.equal(sl.at(-2), "https://www.twitch.tv/tinotv");
  const plain = plainArgs(INGEST);
  assert.deepEqual(plain.slice(plain.indexOf("-c"), plain.indexOf("-c") + 2), [
    "-c",
    "copy",
  ]);
  assert.equal(plain.at(-1), INGEST);
  assert.ok(!plain.includes("libx264"), "no video encode");
  const split = splitArgs();
  assert.ok(split.includes("pipe:3") && split.includes("pipe:1"));
  assert.ok(split.includes("s16le"));
  const join = joinArgs(INGEST);
  assert.deepEqual(join.slice(join.indexOf("-c:v"), join.indexOf("-c:v") + 2), [
    "-c:v",
    "copy",
  ]);
  assert.ok(join.includes("aac"));
  const text = `Error opening ${INGEST}: I/O error; key abcd-efgh-ijkl-mnop`;
  const safe = redact(text, [INGEST, keyOf(INGEST)]);
  assert.doesNotMatch(safe, /abcd-efgh/);
  assert.match(safe, /rtmp:\/\/\[hidden\]/);
  assert.equal(backoff(1), 5_000);
  assert.equal(backoff(10), 120_000);
});

class FakeProc extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdio: unknown[] = [this.stdin, this.stdout, this.stderr, new PassThrough()];
  exitCode: number | null = null;
  constructor(
    public cmd: string,
    public args: string[],
  ) {
    super();
  }
  kill() {
    this.exitCode = 0;
    return true;
  }
}

test("relay pipe: the plain chain and the music filter chain are wired, and a crash restarts it", async () => {
  const made: FakeProc[] = [];
  const spawnFn = ((cmd: string, args: string[]) => {
    const p = new FakeProc(cmd, args);
    made.push(p);
    return p;
  }) as never;
  const events: string[] = [];
  const h = startPipe({
    channel: "tinotv",
    quality: "best",
    url: INGEST,
    streamlink: "streamlink",
    ffmpeg: "ffmpeg",
    spawnFn,
    onEvent: (k, d) => events.push(`${k}:${d}`),
  });
  assert.equal(made.length, 2);
  assert.equal(made[0]!.cmd, "streamlink");
  assert.ok(h.alive());
  made[1]!.stderr.write(`Connection to ${INGEST} failed`);
  await new Promise((r) => setTimeout(r, 10));
  made[1]!.exitCode = 1;
  made[1]!.emit("exit", 1);
  assert.ok(events.some((e) => e.startsWith("exited:exit 1")));
  assert.ok(
    events.every((e) => !e.includes("abcd-efgh")),
    "the key is never in an event",
  );
  h.restart("test");
  assert.equal(made.length, 4, "restart launches a fresh chain");
  h.stop();

  const filtered: FakeProc[] = [];
  const f = startPipe({
    channel: "tinotv",
    quality: "best",
    url: INGEST,
    streamlink: "streamlink",
    ffmpeg: "ffmpeg",
    filterCmd: "cat",
    spawnFn: ((cmd: string, args: string[]) => {
      const p = new FakeProc(cmd, args);
      filtered.push(p);
      return p;
    }) as never,
  });
  assert.deepEqual(
    filtered.map((p) => p.cmd),
    ["streamlink", "ffmpeg", "/bin/sh", "ffmpeg"],
  );
  assert.deepEqual(filtered[2]!.args, ["-c", "cat"]);
  f.stop();
});

test("relay text: Day N, part numbers, the AI line and the Twitch link", () => {
  assert.equal(
    streamTitle({ game: "Grand Theft Auto VI", day: 3 }),
    "GTA 6 LIVE Day 3: First Playthrough",
  );
  assert.equal(
    streamTitle({ game: "Grand Theft Auto VI", day: 3, part: 2 }),
    "GTA 6 LIVE Day 3: First Playthrough (part 2)",
  );
  assert.ok(
    streamTitle({ game: "x".repeat(200), day: 1, part: 3 }).length < 100,
  );
  const d = streamDescription({
    game: "Grand Theft Auto VI",
    day: 3,
    date: "2026-11-21",
    twitch: "tinotv",
  });
  assert.ok(d.includes(STREAM_AI_LINE));
  assert.match(d, /twitch\.tv\/tinotv/);
  assert.doesNotMatch(d, /[—–]/);
  assert.equal(
    streamDay("Grand Theft Auto VI", "2026-11-21", "2026-11-19", []),
    3,
  );
  assert.equal(
    streamDay("Grand Theft Auto V", "2026-11-15", "2026-11-19", [
      { date: "2026-11-13" },
      { date: "2026-11-14" },
      { date: "2026-11-14" },
    ]),
    3,
  );
  assert.equal(
    streamDay("Grand Theft Auto VI", "2026-11-17", "2026-11-19", []),
    1,
    "before launch: days streamed",
  );
  const name = archiveFileName({
    date: "2026-11-21",
    title: "GTA 6 LIVE Day 3: First Playthrough",
    videoId: "Ab_c-12",
  });
  const parsed = parseVodName(`/x/${name}`);
  assert.equal(parsed.vodId, "yt-Ab_c-12");
  assert.equal(parsed.recordedOn, "2026-11-21");
  assert.match(parsed.title, /GTA 6 LIVE Day 3/);
});

test("relay setup errors read as plain English", () => {
  assert.match(
    setupProblem(new YouTubeApiError(403, ["liveStreamingNotEnabled"], "x")),
    /not switched on/,
  );
  assert.match(
    setupProblem(new YouTubeApiError(403, ["quotaExceeded"], "x")),
    /quota/,
  );
});

class FakeYt implements LiveApi {
  made: NewBroadcast[] = [];
  bound: Array<[string, string]> = [];
  ended: string[] = [];
  states = new Map<string, BroadcastState>();
  streamStatus = "active";
  fail?: Error;
  async ingest() {
    return { streamId: "S1", url: INGEST };
  }
  async createBroadcast(b: NewBroadcast) {
    if (this.fail) throw this.fail;
    this.made.push(b);
    const id = `B${this.made.length}`;
    this.states.set(id, { id, lifeCycle: "ready", privacy: b.privacy });
    return id;
  }
  async bind(b: string, s: string) {
    this.bound.push([b, s]);
  }
  async broadcast(id: string) {
    return this.states.get(id);
  }
  async stream() {
    return { status: this.streamStatus, health: "good" };
  }
  async end(id: string) {
    this.ended.push(id);
    const b = this.states.get(id);
    if (b) b.lifeCycle = "complete";
  }
}

function fakePipe() {
  const p = { restarts: [] as string[], stopped: false, dead: false };
  const handle: PipeHandle = {
    alive: () => !p.stopped,
    lastData: () => Date.now(),
    restart: (why) => p.restarts.push(why),
    stop: () => {
      p.stopped = true;
    },
    gaveUp: () => p.dead,
  };
  return { p, handle };
}

async function rig(env: NodeJS.ProcessEnv = {}) {
  const dir = await tmpDir();
  const settings = {
    ...relaySettings({ STREAM_RELAY: "true", ...env }),
    dataDir: dir,
  };
  let now = Date.parse("2026-11-21T18:00:00Z");
  let live: LiveStream | undefined = {
    id: "T1",
    startedAt: "2026-11-21T17:59:00Z",
    title: "day 3",
    game: "Grand Theft Auto VI",
    viewers: 3,
  };
  const yt = new FakeYt();
  const notes: string[] = [];
  const pipes: ReturnType<typeof fakePipe>[] = [];
  const urls: string[] = [];
  let vod: string | undefined;
  const fetched: string[] = [];
  const deps: RelayDeps = {
    settings,
    twitch: { live: async () => live, vodFor: async () => vod },
    yt,
    startPipe: (url) => {
      urls.push(url);
      const f = fakePipe();
      pipes.push(f);
      return f.handle;
    },
    notify: async (t) => {
      notes.push(t);
    },
    fetchArchive: async (a) => {
      fetched.push(a.videoId);
      return `/vods/${archiveFileName(a)}`;
    },
    now: () => now,
    log: () => undefined,
  };
  return {
    dir,
    yt,
    notes,
    pipes,
    urls,
    fetched,
    job: new RelayJob(deps),
    advance: (ms: number) => (now += ms),
    setLive: (l: LiveStream | undefined) => (live = l),
    setVod: (v: string | undefined) => (vod = v),
  };
}

test("relay: live on Twitch makes a public Gaming broadcast, binds it and starts the pipe", async () => {
  const r = await rig({ GTA_DAILY_START: "2026-11-19" });
  await r.job.tick();
  assert.equal(r.yt.made.length, 1);
  const b = r.yt.made[0]!;
  assert.equal(b.privacy, "public");
  assert.equal(b.title, "GTA 6 LIVE Day 3: First Playthrough");
  assert.ok(b.description.includes(STREAM_AI_LINE));
  assert.deepEqual(r.yt.bound, [["B1", "S1"]]);
  assert.equal(r.pipes.length, 1);
  assert.equal(r.urls[0], INGEST);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0]!, /live on YouTube too/);
  assert.ok(
    r.notes.every((n) => !n.includes("abcd-efgh")),
    "no key in Discord",
  );
  assert.ok(r.notes.every((n) => !/[—–]/.test(n)));
  assert.equal(readArchives(r.dir)[0]!.eraseSong, "pending");
  await r.job.tick();
  assert.equal(r.yt.made.length, 1, "one broadcast a stream");
});

test("relay: no data on YouTube for 3 minutes restarts once, then alerts once", async () => {
  const r = await rig();
  await r.job.tick();
  r.yt.streamStatus = "inactive";
  await r.job.tick();
  r.advance(3 * 60_000);
  await r.job.tick();
  assert.deepEqual(r.pipes[0]!.p.restarts, ["YouTube shows no data"]);
  r.advance(60_000);
  await r.job.tick();
  assert.equal(r.notes.length, 1, "no alert before the second 3 minutes");
  r.advance(2 * 60_000);
  await r.job.tick();
  assert.equal(r.pipes[0]!.p.restarts.length, 1, "restarted only once");
  assert.equal(r.notes.length, 2);
  assert.match(r.notes[1]!, /no picture/);
  r.advance(3 * 60_000);
  await r.job.tick();
  assert.equal(r.notes.length, 2, "alerted once");
});

test("relay: YouTube ending the broadcast mid-stream starts part 2, up to three times", async () => {
  const r = await rig();
  await r.job.tick();
  for (let i = 1; i <= 3; i++) {
    r.yt.states.get(`B${i}`)!.lifeCycle = "complete";
    await r.job.tick();
    assert.equal(r.yt.made.length, i + 1);
    assert.match(r.yt.made[i]!.title, new RegExp(`\\(part ${i + 1}\\)$`));
    assert.match(r.notes.at(-1)!, new RegExp(`started part ${i + 1}`));
  }
  assert.equal(r.pipes.length, 1, "the pipe keeps pushing to the same stream");
  r.yt.states.get("B4")!.lifeCycle = "revoked";
  await r.job.tick();
  assert.equal(r.yt.made.length, 4, "no fourth restart");
  assert.ok(r.pipes[0]!.p.stopped);
  assert.match(r.notes.at(-1)!, /stopped mirroring/);
  const archives = readArchives(r.dir);
  assert.equal(archives.length, 4);
  assert.ok(
    archives.every((a) => a.endedAt && /Content ID/.test(a.endReason ?? "")),
  );
  assert.equal(
    eraseSongQueue(archives).length,
    4,
    "every claimed part goes on the Erase song list",
  );
});

test("relay: offline after the grace stops, ends the broadcast, keeps the archive and hands it to the index", async () => {
  const r = await rig({ STREAM_RELAY_ARCHIVE_WAIT_HOURS: "2" });
  await r.job.tick();
  r.yt.states.get("B1")!.lifeCycle = "live";
  r.setLive(undefined);
  await r.job.tick();
  r.advance(60_000);
  r.setLive({
    id: "T2",
    startedAt: "2026-11-21T18:01:00Z",
    title: "day 3",
    game: "Grand Theft Auto VI",
    viewers: 1,
  });
  await r.job.tick();
  assert.equal(
    r.yt.made.length,
    1,
    "an Xbox reconnect inside the grace is the same broadcast",
  );
  r.setLive(undefined);
  await r.job.tick();
  r.advance(3 * 60_000);
  await r.job.tick();
  assert.deepEqual(r.yt.ended, ["B1"]);
  assert.ok(r.pipes[0]!.p.stopped);
  assert.match(r.notes.at(-1)!, /archive stays public/);
  let a = readArchives(r.dir)[0]!;
  assert.equal(a.endReason, "stream over");
  assert.deepEqual(a.twitchStreamIds, ["T1", "T2"]);
  // No Twitch VOD: the YouTube archive is fetched once the wait is over.
  r.advance(20 * 60_000);
  await r.job.tick();
  assert.equal(r.fetched.length, 0, "waits for the Twitch VOD first");
  r.advance(2 * 3_600_000);
  await r.job.tick();
  assert.deepEqual(r.fetched, ["B1"]);
  a = readArchives(r.dir)[0]!;
  assert.equal(a.indexSource, "youtube");
  assert.match(a.fetchedFile!, /\[yt-B1\]\.mp4$/);
});

test("relay: a Twitch VOD wins over fetching the archive", async () => {
  const r = await rig();
  await r.job.tick();
  r.setLive(undefined);
  await r.job.tick();
  r.advance(3 * 60_000);
  await r.job.tick();
  r.setVod("v999");
  r.advance(20 * 60_000);
  await r.job.tick();
  const a = readArchives(r.dir)[0]!;
  assert.equal(a.indexSource, "twitch");
  assert.equal(a.twitchVod, "v999");
  assert.equal(r.fetched.length, 0);
});

test("relay: live streaming not enabled is told once, retried every 10 minutes", async () => {
  const r = await rig();
  r.yt.fail = new YouTubeApiError(403, ["liveStreamingNotEnabled"], "no");
  await r.job.tick();
  await r.job.tick();
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0]!, /not switched on/);
  r.yt.fail = undefined;
  r.advance(5 * 60_000);
  await r.job.tick();
  assert.equal(r.yt.made.length, 0, "not before 10 minutes");
  r.advance(5 * 60_000);
  await r.job.tick();
  assert.equal(r.yt.made.length, 1);
  assert.equal(r.pipes.length, 1);
});

test("relay YouTube calls: finds its own stream, builds the ingest, asks for the right broadcast", async () => {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes("liveStreams?part=id,snippet,cdn&mine=true"))
      return ok({
        items: [
          {
            id: "other",
            snippet: { title: "Someone else's" },
            cdn: {
              ingestionInfo: {
                ingestionAddress: "rtmp://x/live2",
                streamName: "nope",
              },
            },
          },
          {
            id: "S9",
            snippet: { title: RELAY_STREAM_TITLE },
            cdn: {
              ingestionInfo: {
                ingestionAddress: "rtmp://a.rtmp.youtube.com/live2",
                rtmpsIngestionAddress: "rtmps://a.rtmps.youtube.com/live2",
                streamName: "k-e-y",
              },
            },
          },
        ],
      });
    if (u.includes("liveBroadcasts?part=id,snippet")) return ok({ id: "B7" });
    if (u.includes("liveBroadcasts?part=id,status"))
      return ok({
        items: [
          {
            id: "B7",
            status: { lifeCycleStatus: "live", privacyStatus: "public" },
          },
        ],
      });
    return ok({});
  }) as typeof fetch;
  const yt = new YouTubeLive(async () => "tok", fetchFn);
  const ing = await yt.ingest();
  assert.deepEqual(ing, {
    streamId: "S9",
    url: "rtmps://a.rtmps.youtube.com/live2/k-e-y",
  });
  const id = await yt.createBroadcast({
    title: "T",
    description: "D",
    privacy: "public",
    start: new Date(0),
  });
  assert.equal(id, "B7");
  const create = calls.find(
    (c) => c.method === "POST" && c.url.includes("liveBroadcasts?"),
  )!;
  assert.equal(create.body.status.privacyStatus, "public");
  assert.equal(create.body.status.selfDeclaredMadeForKids, false);
  assert.equal(create.body.contentDetails.enableAutoStart, true);
  assert.equal(create.body.contentDetails.enableAutoStop, true);
  assert.equal(create.body.contentDetails.enableDvr, true);
  assert.equal(create.body.contentDetails.recordFromStart, true);
  const cat = calls.find((c) => c.method === "PUT")!;
  assert.equal(cat.body.snippet.categoryId, "20");
  await yt.bind("B7", "S9");
  assert.ok(
    calls.some(
      (c) =>
        c.url.includes("liveBroadcasts/bind?id=B7") &&
        c.url.includes("streamId=S9"),
    ),
  );
  assert.equal((await yt.broadcast("B7"))!.lifeCycle, "live");
  assert.ok(!calls.some((c) => /delete/i.test(c.method)), "never deletes");
  const bad = new YouTubeLive(
    async () => "tok",
    (async () =>
      new Response(
        JSON.stringify({
          error: { errors: [{ reason: "liveStreamingNotEnabled" }] },
        }),
        { status: 403 },
      )) as typeof fetch,
  );
  await assert.rejects(
    bad.createBroadcast({
      title: "T",
      description: "D",
      privacy: "public",
      start: new Date(),
    }),
    (e: unknown) =>
      e instanceof YouTubeApiError &&
      e.reasons[0] === "liveStreamingNotEnabled",
  );
});
