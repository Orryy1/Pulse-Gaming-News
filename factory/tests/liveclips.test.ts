import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { testConfig, tmpDir } from "./helpers.ts";
import {
  LiveDetector,
  matchAsk,
  momentWindow,
  rateCheck,
  type DetectOptions,
} from "../src/liveclips/detect.ts";
import {
  expiredSegments,
  listSegments,
  parseLoudness,
  parseMotion,
  segmentStart,
  segmentsFor,
} from "../src/liveclips/recorder.ts";
import { parseIrcLine } from "../src/liveclips/twitch.ts";
import { dayStartIn, liveMeta, takenByVod } from "../src/liveclips/job.ts";
import {
  liveClipsSettings,
  liveClipsSummary,
} from "../src/liveclips/settings.ts";
import {
  gameplayScript,
  newClips,
  type GameplayReview,
} from "../src/gameplay.ts";
import { gameplayLinks } from "../src/pipeline.ts";

const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
const opts = (o: Partial<DetectOptions> = {}): DetectOptions => ({
  minScore: 1,
  perHour: 2,
  perDay: 8,
  gapMinutes: 10,
  warmupMinutes: 8,
  chatLagSeconds: 8,
  clipLagSeconds: 15,
  dayStart: dayStartIn("Europe/London"),
  ...o,
});

/** A quiet stream (gentle noise) with loud, busy bursts at the given seconds. */
function feed(
  det: LiveDetector,
  seconds: number,
  bursts: number[] = [],
  until = seconds,
) {
  const out = [];
  for (let i = 0; i < Math.min(seconds, until); i++) {
    const loud = bursts.some((b) => i >= b && i < b + 4);
    det.addSecond({
      at: T0 + i * 1000,
      loud: loud ? -8 : -30 + ((i * 7) % 5),
      motion: loud ? 0.6 : 0.02,
    });
    if (i % 15 === 0) out.push(...det.poll(T0 + i * 1000));
  }
  return out;
}

test("liveclips: settings are off by default and summarised", () => {
  const s = liveClipsSettings({});
  assert.equal(s.enabled, false);
  assert.equal(s.channel, "tinotv");
  assert.equal(liveClipsSummary(s), "off");
  const on = liveClipsSettings({
    LIVE_CLIPS: "true",
    LIVE_CLIPS_PER_HOUR: "99",
    LIVE_CLIPS_CHAT: "false",
  });
  assert.equal(on.perHour, 6, "clamped");
  assert.match(liveClipsSummary(on), /loudness\+viewer clips; up to 6\/h/);
});

test("liveclips: a loud, busy burst after the warm-up is one moment, cut with 14 s of build-up", () => {
  const det = new LiveDetector(opts());
  const found = feed(det, 900, [700]);
  assert.equal(found.length, 1);
  const m = found[0]!;
  assert.equal(m.signals[0]!.kind, "loudness");
  assert.ok(Math.abs(m.at - (T0 + 700_000)) <= 4000, "at the burst");
  assert.equal(m.end - m.start, 40_000);
  assert.equal(m.peakInClip, 14);
  assert.ok(m.decidedAt - m.at <= 60_000, "decided within a minute");
});

test("liveclips: loudness alone waits for the warm-up", () => {
  const det = new LiveDetector(opts());
  assert.equal(feed(det, 400, [200]).length, 0);
});

test("liveclips: the caps hold, and say why", () => {
  const det = new LiveDetector(opts({ gapMinutes: 10 }));
  const found = feed(det, 1500, [700, 900, 1300]);
  assert.equal(
    found.length,
    2,
    "the burst 200 s after the first waits out the gap",
  );
  assert.ok(det.skipped.some((x) => /within 10 min/.test(x.why)));
  const day = dayStartIn("Europe/London");
  assert.equal(
    rateCheck(T0, [T0 - 3_000_000], {
      perHour: 1,
      perDay: 8,
      gapMinutes: 5,
      dayStart: day,
    }),
    "1 already this hour",
  );
  assert.equal(
    rateCheck(T0, [], { perHour: 1, perDay: 0, gapMinutes: 5, dayStart: day }),
    "0 already today",
  );
  assert.equal(
    rateCheck(T0, [T0 - 7_200_000], {
      perHour: 1,
      perDay: 8,
      gapMinutes: 5,
      dayStart: day,
    }),
    undefined,
  );
});

test("liveclips: a chat burst from several people is a moment, timed back by the reaction lag", () => {
  const det = new LiveDetector(opts());
  for (let i = 0; i < 60; i++)
    det.addChat({ at: T0 + i * 20_000, user: `u${i % 3}`, text: "hi" });
  const burst = T0 + 1_210_000;
  for (let k = 0; k < 9; k++)
    det.addChat({
      at: burst + k * 900,
      user: `v${k % 5}`,
      text: k % 2 ? "OMG no way" : "LMAO",
    });
  det.addChat({ at: burst + 5000, user: "v1", text: "clip it" });
  const out = [...det.poll(burst + 20_000), ...det.poll(burst + 120_000)];
  assert.equal(out.length, 1);
  const m = out[0]!;
  assert.equal(m.signals[0]!.kind, "chat");
  assert.equal(m.at, burst - 8000);
  assert.equal(m.peakInClip, 24);
  assert.ok(m.score > 1.5, `hype and the clip ask add up (${m.score})`);
});

test("liveclips: one person spamming is not a burst", () => {
  const det = new LiveDetector(opts());
  for (let k = 0; k < 20; k++)
    det.addChat({ at: T0 + k * 400, user: "solo", text: "LOL" });
  assert.equal([...det.poll(T0 + 30_000), ...det.poll(T0 + 200_000)].length, 0);
});

test("liveclips: a viewer clip is a moment; signals close together add up into one", () => {
  const det = new LiveDetector(opts());
  feed(det, 600, [], 600);
  const pressed = T0 + 560_000;
  det.addClip({
    id: "Abc",
    at: pressed,
    url: "u",
    title: "insane jump",
    creator: "fan",
  });
  det.addClip({
    id: "Abc",
    at: pressed,
    url: "u",
    title: "insane jump",
    creator: "fan",
  });
  for (let k = 0; k < 8; k++)
    det.addChat({
      at: pressed - 4000 + k * 500,
      user: `c${k % 4}`,
      text: "WTF",
    });
  const out = [...det.poll(pressed + 10_000), ...det.poll(pressed + 120_000)];
  assert.equal(
    out.length,
    1,
    "the same clip twice and the chat are one moment",
  );
  assert.deepEqual(out[0]!.signals.map((s) => s.kind).sort(), ["chat", "clip"]);
  assert.ok(out[0]!.score >= 2.5);
});

test("liveclips: an open stream ask the chat names is attached", () => {
  const asks = [
    { id: "a1", question: "Can you lose the cops by changing clothes?" },
    { id: "a2", question: "Can you swim away from a five-star wanted level?" },
  ];
  assert.equal(
    matchAsk(["did he just lose the cops changing clothes??"], asks)?.id,
    "a1",
  );
  assert.equal(matchAsk(["nice car"], asks), undefined);
});

test("liveclips: windows, pieces and the buffer", async () => {
  assert.deepEqual(momentWindow(100_000, true), {
    start: 86_000,
    end: 126_000,
    peakInClip: 14,
  });
  assert.equal(
    segmentStart("seg_20261118T120005.ts"),
    Date.UTC(2026, 10, 18, 12, 0, 5),
  );
  assert.equal(segmentStart("clip.mp4"), undefined);
  const segs = [0, 10, 20, 30, 40].map((s) => ({
    name: `s${s}`,
    start: T0 + s * 1000,
  }));
  assert.deepEqual(segmentsFor(segs, T0 + 12_000, T0 + 38_000), {
    names: ["s10", "s20", "s30"],
    offset: 2,
  });
  assert.equal(
    segmentsFor(segs, T0 + 12_000, T0 + 61_000),
    undefined,
    "the end is not recorded yet",
  );
  const holed = segs.filter((s) => s.name !== "s20");
  assert.equal(
    segmentsFor(holed, T0 + 12_000, T0 + 38_000),
    undefined,
    "never a jump",
  );
  assert.deepEqual(expiredSegments(segs, T0 + 6 * 60_000 + 15_000, 6), [
    "s0",
    "s10",
  ]);
  const dir = await tmpDir();
  for (const n of [
    "seg_20261118T120000.ts",
    "seg_20261118T120010.ts",
    "seg_20261118T120020.ts",
    "notes.txt",
  ])
    fs.writeFileSync(path.join(dir, n), "");
  assert.deepEqual(
    listSegments(dir).map((s) => s.name),
    ["seg_20261118T120000.ts", "seg_20261118T120010.ts"],
    "the newest is still being written",
  );
});

test("liveclips: ffmpeg's loudness and scene output per second", () => {
  assert.deepEqual(
    parseLoudness(
      "lavfi.astats.Overall.RMS_level=-23.5\nx\nlavfi.astats.Overall.RMS_level=-inf",
    ),
    [-23.5, -90],
  );
  const m = parseMotion(
    "pts_time:0.0\nlavfi.scene_score=0.5\npts_time:2.1\nlavfi.scene_score=0.2\n",
    4,
  );
  assert.deepEqual(
    m.map((x) => Math.round(x * 100) / 100),
    [0.5, 0.45, 0.2, 0.18],
  );
});

test("liveclips: chat lines from Twitch IRC", () => {
  const l = parseIrcLine(
    "@badge-info=;display-name=FanOne;tmi-sent-ts=1763467200000;user-id=1 :fanone!fanone@fanone.tmi.twitch.tv PRIVMSG #tinotv :clip it!!",
  );
  assert.deepEqual(l, { at: 1763467200000, user: "FanOne", text: "clip it!!" });
  assert.equal(
    parseIrcLine(":tmi.twitch.tv 001 justinfan123 :Welcome"),
    undefined,
  );
});

test("liveclips: the local day starts at local midnight", () => {
  const day = dayStartIn("Europe/London")(
    Date.UTC(2026, 10, 18, 15, 30, 12, 500),
  );
  assert.equal(day, Date.UTC(2026, 10, 18, 0, 0, 0));
});

test("liveclips: the inbox entry, and the stretches the nightly finder skips", () => {
  const m = {
    at: Date.UTC(2026, 10, 18, 12, 30, 0),
    score: 2.2,
    signals: [
      { kind: "chat" as const, at: 0, score: 2.2, detail: "9 messages" },
    ],
    start: Date.UTC(2026, 10, 18, 12, 29, 36),
    end: Date.UTC(2026, 10, 18, 12, 30, 16),
    peakInClip: 24,
    decidedAt: Date.UTC(2026, 10, 18, 12, 31, 0),
  };
  const meta = liveMeta(
    m,
    { id: "318", startedAt: "2026-11-18T11:00:00Z", title: "GTA VI day one" },
    ["frames/01.jpg"],
    new Date(T0),
  );
  assert.match(meta.id, /^gp_live_[0-9a-f]{10}$/);
  assert.equal(meta.status, "new");
  assert.equal(meta.source.kind, "twitch_live");
  assert.equal(meta.clip.start_in_source, 5376);
  assert.equal(meta.clip.peak_in_clip, 24);
  assert.equal(meta.live?.signals[0]!.detail, "9 messages");
  assert.deepEqual(
    takenByVod({
      sent: [],
      streams: {
        "318": { startedAt: "x", vod: "v9", taken: [[5376, 5416]] },
        "319": { startedAt: "y", taken: [[1, 2]] },
      },
    }),
    { v9: [[5376, 5416]] },
  );
});

test("liveclips: a live clip is first in the lane's queue, and its card is always one tap", async () => {
  const root = await tmpDir();
  const write = (id: string, kind: string, score: number) => {
    fs.mkdirSync(path.join(root, "inbox", id), { recursive: true });
    fs.writeFileSync(
      path.join(root, "inbox", id, "meta.json"),
      JSON.stringify({
        id,
        status: "new",
        source: { file: "", title: "", kind },
        clip: { file: "clip.mp4", seconds: 40 },
        score,
        frames: [],
        created_at: "",
      }),
    );
  };
  write("gp_vod", "twitch_vod", 5);
  write("gp_live_x", "twitch_live", 1.1);
  assert.deepEqual(
    (await newClips(root)).map((c) => c.meta.id),
    ["gp_live_x", "gp_vod"],
  );
  const cfg = testConfig(root, { gameplayOneTap: false });
  assert.doesNotMatch(gameplayLinks(cfg, "e1").approve, /now=1/);
  assert.match(gameplayLinks(cfg, "e1", true).approve, /&now=1$/);
  const review = {
    keep: true,
    score: 8,
    reason: "",
    game_title: "Grand Theft Auto VI",
    real_test: false,
    experiment_number: 0,
    question: "Can you X?",
    result_line: "YES",
    result: "It worked.",
    start_seconds: 0,
    end_seconds: 30,
    youtube_title: "t",
    description: "d",
    hashtags: ["#GTA6"],
    radio_audible: false,
    spoiler: false,
    strong_language: false,
    captions_ok: false,
  } satisfies GameplayReview;
  assert.equal(
    gameplayScript(review, "gp_live_x", [], true).gameplay?.live,
    true,
  );
  assert.equal(gameplayScript(review, "gp_vod", []).gameplay?.live, undefined);
});

test("simulcast: chapters from the stream index, the day's title and description", async () => {
  const { chaptersFromIndex, stamp, streamDescription, streamTitle } = await import("../src/liveclips/simulcast.ts");
  const shot = (start: number, where: string) => ({ start, end: start + 30, where, tags: [] as string[] });
  const index = {
    duration: 7200,
    shots: [shot(5, "Vice City beach"), shot(300, "Vice City beach"), shot(700, "the Keys"), shot(900, "a gas station"), shot(2000, "vice city beach"), shot(7180, "Swamp")],
  } as unknown as Parameters<typeof chaptersFromIndex>[0];
  assert.deepEqual(chaptersFromIndex(index), [
    { at: 0, title: "Stream starts" },
    { at: 700, title: "The Keys" },
    { at: 2000, title: "Vice city beach" },
  ]);
  assert.deepEqual(chaptersFromIndex({ ...index, shots: index.shots.slice(0, 2) }), [], "fewer than three: none");
  assert.equal(stamp(3725), "1:02:05");
  assert.equal(stamp(65), "1:05");
  assert.equal(streamTitle({ game: "Grand Theft Auto VI", day: 2, plan: "escaping 5 stars on foot" }), "GTA 6 LIVE Day 2: Escaping 5 stars on foot");
  const d = streamDescription({ game: "Grand Theft Auto VI", day: 2, date: "2026-11-19", chapters: [{ at: 0, title: "Stream starts" }], twitch: "tinotv" });
  assert.match(d, /^GTA 6 live gameplay, day 2/);
  assert.match(d, /\n0:00 Stream starts/);
  assert.doesNotMatch(d, /[\u2014\u2013]/, "no em dashes");
});

test("simulcast: the live eligibility check is read only and reads YouTube's answer", async () => {
  const { liveEligibility } = await import("../src/liveclips/simulcast.ts");
  const asked: string[] = [];
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const off = (async (url: string | URL) => {
    asked.push(String(url));
    if (String(url).includes("/channels"))
      return reply(200, { items: [{ id: "UC1", snippet: { title: "Pulse Gaming" }, statistics: { subscriberCount: "50" }, status: { madeForKids: false } }] });
    return reply(403, { error: { message: "not enabled", errors: [{ reason: "liveStreamingNotEnabled" }] } });
  }) as typeof fetch;
  const r = await liveEligibility("t", off);
  assert.equal(r.liveEnabled, false);
  assert.equal(r.channel?.subscribers, 50);
  assert.ok(asked.every((u) => !/cdn|insert|update|delete/.test(u)), "no stream keys asked for, nothing changed");
  const on = (async (url: string | URL) =>
    reply(200, { items: String(url).includes("/channels") ? [{ id: "UC1", snippet: {}, statistics: {}, status: {} }] : [] })) as typeof fetch;
  const r2 = await liveEligibility("t", on);
  assert.equal(r2.liveEnabled, true);
  assert.equal(r2.broadcasts, 0);
});

test("liveclips: a moment twice as strong may come before the gap is out; the hourly cap still holds", () => {
  const day = dayStartIn("Europe/London");
  const o = { perHour: 2, perDay: 8, gapMinutes: 10, dayStart: day };
  assert.equal(rateCheck(T0, [T0 - 300_000], o, 3, 1.4), undefined);
  assert.match(rateCheck(T0, [T0 - 300_000], o, 2.5, 1.4) ?? "", /within 10 min/);
  assert.match(rateCheck(T0, [T0 - 600_000, T0 - 300_000], o, 6, 1) ?? "", /2 already this hour/);
});
