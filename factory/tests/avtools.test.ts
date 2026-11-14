// RADIO_STRIP, COPYRIGHT_CHECK_GATE, INSTANT_REPLAY, CROP_UPSCALE and RELAY_MUSIC_STRIP: the settings, the residue
// verdict, the inbox's use of radio-free copies, the copyright gate's decisions and release, the replay timing and
// filters, and the live filter's plumbing. Pure or temp-folder only: no model, no network, no ffmpeg.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  avToolsSettings,
  avToolsSummary,
} from "../src/assets/avtools/settings.ts";
import {
  isRadioFree,
  radioFreeName,
  stripCardLine,
  stripVerdict,
  type StripJobResult,
} from "../src/assets/radiostrip.ts";
import { classicalUpscaleFilter, slowFactor } from "../src/assets/avtools.ts";
import { inboxFiles } from "../src/assets/library.ts";
import {
  copyrightCheckNeeded,
  copyrightChecks,
  copyrightClearLink,
  copyrightDecision,
  releaseHeldVideo,
  releaseTime,
  type CopyrightProbe,
} from "../src/youtube/copyrightgate.ts";
import { verifyToken } from "../src/lib/crypto.ts";
import {
  atempoChain,
  directFilter,
  directTiming,
  instantReplayTiming,
  replayWindow,
  DIRECT_LONGEST,
  INSTANT_REPLAY_SPEED,
} from "../src/gameplaydirect.ts";
import { clipSourceFile, radioStripped } from "../src/gameplay.ts";
import { replayTagOn } from "../src/render/GameplayShort.tsx";
import {
  latencyOk,
  musicStripSpec,
  muxArgs,
  parseStripLine,
  splitArgs,
  MAX_WALL_LATENCY,
} from "../src/relay/musicstrip.ts";
import { loadConfig } from "../src/config.ts";
import type { Db } from "../src/db.ts";

const none = () => false;

// ---------------------------------------------------------------- settings

test("every tool is off by default and the summary says so", () => {
  const s = avToolsSettings({}, none, "/home/x");
  assert.equal(s.radioStrip.enabled, false);
  assert.equal(s.replay.enabled, false);
  assert.equal(s.upscale.enabled, false);
  assert.equal(s.relay.enabled, false);
  // The copyright gate defaults on: it only acts on videos that used stripped sound.
  assert.equal(s.radioStrip.copyrightGate, true);
  assert.equal(avToolsSummary(s), "off");
  assert.equal(
    loadConfig().avTools.radioStrip.enabled,
    process.env.RADIO_STRIP === "true",
  );
});

test("settings parse, clamp and find the machine's Python and models", () => {
  const s = avToolsSettings(
    {
      RADIO_STRIP: "true",
      RADIO_STRIP_CHECKPOINTS: "9",
      RADIO_STRIP_MAX_RESIDUE: "0.05",
      INSTANT_REPLAY: "1",
      INSTANT_REPLAY_FACTOR: "1",
      CROP_UPSCALE: "on",
      CROP_UPSCALE_MODE: "Classical",
      RELAY_MUSIC_STRIP: "yes",
      RELAY_STRIP_BLOCK: "20",
    },
    (p) => p.startsWith("/home/x/"),
    "/home/x",
  );
  assert.equal(s.radioStrip.checkpoints, 3);
  assert.equal(s.radioStrip.maxResidue, 0.05);
  assert.equal(s.replay.factor, 2);
  assert.equal(s.upscale.mode, "classical");
  assert.equal(s.relay.block, 8);
  assert.equal(s.python, "/home/x/PulseFactory/avtools/venv/bin/python");
  assert.equal(s.models, "/home/x/PulseFactory/avtools/models");
  assert.match(
    avToolsSummary(s),
    /radio strip \(x3, lyric pass, copyright gate\)/,
  );
  assert.match(avToolsSummary(s), /relay music strip/);
  assert.equal(
    avToolsSettings({ CROP_UPSCALE_MODE: "magic" }, none).upscale.mode,
    "ai",
  );
});

// ---------------------------------------------------------------- the residue verdict

const result = (after: number, fp: number, ok = true): StripJobResult => ({
  src: "clip.mp4",
  ok,
  after: {
    seconds: 40,
    musicShare: after,
    musicMean: after,
    musicP95: after,
    speechShare: 0,
    vehicleShare: 0.5,
  },
  fingerprint: {
    kept: { blocks: 30, matchShare: fp, minBer: 0.4, meanBer: 0.48 },
    original: { blocks: 30, matchShare: 0.9, minBer: 0.1, meanBer: 0.2 },
  },
});
const limits = { maxResidue: 0.1, maxFingerprint: 0.1 };

test("a stripped clip is clean only when neither the classifier nor the fingerprint finds the song", () => {
  assert.deepEqual(stripVerdict(result(0.05, 0.0), limits), {
    clean: true,
    reasons: [],
  });
  const music = stripVerdict(result(0.4, 0.0), limits);
  assert.equal(music.clean, false);
  assert.match(
    music.reasons[0]!,
    /music still heard in 40% of the clip \(allowed 10%\)/,
  );
  const fp = stripVerdict(result(0.0, 0.3), limits);
  assert.equal(fp.clean, false);
  assert.match(fp.reasons[0]!, /fingerprint still matches 30%/);
  assert.equal(stripVerdict(result(0.4, 0.3), limits).reasons.length, 2);
  assert.match(
    stripVerdict({ ok: false, error: "CUDA out of memory" }, limits)
      .reasons[0]!,
    /stripping failed: CUDA/,
  );
  assert.equal(
    stripVerdict({ ...result(0, 0), fingerprint: undefined }, limits).clean,
    false,
  );
});

test("radio-free copies are named per clip and recognised in names, URLs and provenance", () => {
  assert.equal(radioFreeName("tw 1/2"), "tw_1_2.radiofree.mp4");
  assert.ok(isRadioFree("own:abc123.radiofree.mp4"));
  assert.ok(
    isRadioFree(
      `Pulse's own gameplay capture of GTA V (abc.radiofree.mp4), 8s at 3.0s, muted`,
    ),
  );
  assert.ok(!isRadioFree("clip.mp4"));
  assert.ok(!isRadioFree(undefined));
});

test("the owner's card says what stripping did", () => {
  assert.equal(stripCardLine(undefined), undefined);
  const clean = stripCardLine({
    at: "",
    verdict: "clean",
    file: "a.radiofree.mp4",
    reasons: [],
    model: "CDX23 x1",
    before: {
      seconds: 40,
      musicShare: 0.85,
      musicMean: 0.8,
      musicP95: 0.9,
      speechShare: 0,
      vehicleShare: 0,
    },
    after: {
      seconds: 40,
      musicShare: 0.02,
      musicMean: 0.1,
      musicP95: 0.2,
      speechShare: 0,
      vehicleShare: 0,
    },
  });
  assert.match(clean!, /85% of the clip before, 2% after/);
  assert.match(clean!, /private first/);
  assert.match(
    stripCardLine({
      at: "",
      verdict: "music_remains",
      reasons: ["x"],
      model: "m",
    })!,
    /not used/,
  );
});

// ---------------------------------------------------------------- the inbox

async function inboxClip(
  root: string,
  id: string,
  meta: Record<string, unknown>,
  files: string[],
) {
  const dir = path.join(root, "inbox", id);
  await fs.mkdir(dir, { recursive: true });
  for (const f of files) await fs.writeFile(path.join(dir, f), "x");
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({ id, clip: { file: "clip.mp4", seconds: 40 }, ...meta }),
  );
}

test("the inbox leaves radio clips out unless a clean radio-free copy exists, and then uses the copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "avtools-inbox-"));
  try {
    const review = (radio: boolean) => ({
      status: "picked",
      review: { game: "GTA V", radio },
    });
    await inboxClip(root, "plain", review(false), ["clip.mp4"]);
    await inboxClip(root, "radio", review(true), ["clip.mp4"]);
    await inboxClip(
      root,
      "stripped",
      {
        ...review(true),
        strip: { verdict: "clean", file: "stripped.radiofree.mp4" },
      },
      ["clip.mp4", "stripped.radiofree.mp4"],
    );
    await inboxClip(
      root,
      "dirty",
      { ...review(true), strip: { verdict: "music_remains", reasons: ["x"] } },
      ["clip.mp4"],
    );
    await inboxClip(
      root,
      "odd",
      {
        ...review(true),
        strip: { verdict: "clean", file: "../../elsewhere.radiofree.mp4" },
      },
      ["clip.mp4"],
    );
    const got = (await inboxFiles(root))
      .map((f) => path.basename(f.file))
      .sort();
    assert.deepEqual(got, ["clip.mp4", "stripped.radiofree.mp4"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the gameplay lane cuts from the radio-free copy only when it is clean", () => {
  const clip = { file: "clip.mp4", seconds: 40 };
  assert.equal(clipSourceFile({ clip }), "clip.mp4");
  assert.equal(clipSourceFile({ clip: { file: "", seconds: 1 } }), "clip.mp4");
  const clean = {
    verdict: "clean" as const,
    file: "a.radiofree.mp4",
    reasons: [],
    at: "",
    model: "",
  };
  assert.equal(clipSourceFile({ clip, strip: clean }), "a.radiofree.mp4");
  assert.equal(radioStripped({ strip: clean }), true);
  assert.equal(
    clipSourceFile({ clip, strip: { ...clean, verdict: "music_remains" } }),
    "clip.mp4",
  );
  assert.equal(radioStripped({ strip: { ...clean, file: undefined } }), false);
});

// ---------------------------------------------------------------- the copyright gate

const probe = (p: Partial<CopyrightProbe>): CopyrightProbe => ({
  uploadStatus: "processed",
  privacyStatus: "private",
  processingStatus: "succeeded",
  regionBlocked: [],
  ...p,
});

test("a video needs the check when any clip, or the lane's own clip, had its radio removed", () => {
  assert.equal(
    copyrightCheckNeeded({ assets_json: { clips: [] }, script_json: null }),
    false,
  );
  assert.equal(
    copyrightCheckNeeded({
      assets_json: {
        clips: [
          {
            file: "c.mp4",
            sourceUrl: "own:x.radiofree.mp4",
            provenance: "p",
            durationSeconds: 8,
          },
        ],
      },
      script_json: null,
    }),
    true,
  );
  assert.equal(
    copyrightCheckNeeded({
      assets_json: {
        clips: [
          {
            file: "c.mp4",
            sourceUrl: "u",
            provenance: "p",
            durationSeconds: 8,
            radioStripped: true,
          },
        ],
      },
      script_json: null,
    }),
    true,
  );
  assert.equal(
    copyrightCheckNeeded({
      assets_json: null,
      script_json: { gameplay: { radio_stripped: true } },
    } as never),
    true,
  );
});

test("the probe finds what the API can show and leaves the rest to the owner", () => {
  assert.equal(copyrightDecision(undefined).kind, "pending");
  assert.equal(
    copyrightDecision(
      probe({ uploadStatus: "uploaded", processingStatus: "processing" }),
    ).kind,
    "pending",
  );
  const rejected = copyrightDecision(
    probe({ uploadStatus: "rejected", rejectionReason: "claim" }),
  );
  assert.equal(rejected.kind, "claimed");
  assert.match(rejected.why, /rejected it: claim/);
  const blocked = copyrightDecision(probe({ regionBlocked: ["DE", "US"] }));
  assert.equal(blocked.kind, "claimed");
  assert.match(blocked.why, /blocked in 2 countries/);
  assert.equal(copyrightDecision(probe({})).kind, "owner_check");
});

test("a released video keeps its slot unless that has passed", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  assert.equal(
    releaseTime("2026-11-14T19:00:00Z", now).toISOString(),
    "2026-11-14T19:00:00.000Z",
  );
  assert.equal(
    releaseTime("2026-11-14T11:00:00Z", now).toISOString(),
    "2026-11-14T12:20:00.000Z",
  );
  assert.equal(
    releaseTime(null, now).toISOString(),
    "2026-11-14T12:20:00.000Z",
  );
});

test("the clear link is signed for this episode only", () => {
  const link = copyrightClearLink(
    { publicUrl: "https://x.test", appSecret: "s" },
    "ep1",
  );
  assert.match(link, /^https:\/\/x\.test\/episodes\/ep1\/copyright-clear\?t=/);
  const t = new URL(link).searchParams.get("t")!;
  assert.ok(verifyToken("copyright:ep1:clear", t, "s"));
  assert.ok(!verifyToken("copyright:ep2:clear", t, "s"));
  assert.ok(!verifyToken("approve:ep1", t, "s"));
});

/** A database that answers the gate's few queries and records events. */
function fakeDb(o: {
  held?: Array<Record<string, unknown>>;
  events?: string[];
  episode?: Record<string, unknown>;
}) {
  const logged: Array<{ kind: string; detail: unknown }> = [];
  const updates: unknown[][] = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith("INSERT INTO events")) {
        logged.push({
          kind: String(params[1]),
          detail: JSON.parse(String(params[2])),
        });
        return [];
      }
      if (sql.includes("FROM episodes e") && sql.includes("copyright_hold"))
        return o.held ?? [];
      if (sql.startsWith("SELECT * FROM episodes"))
        return o.episode ? [o.episode] : [];
      if (sql.startsWith("SELECT kind FROM events"))
        return (o.events ?? []).map((kind) => ({ kind }));
      if (sql.startsWith("UPDATE episodes")) {
        updates.push(params);
        return [];
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
    async exec() {},
    async close() {},
  } as unknown as Db;
  return { db, logged, updates };
}

function fakeYouTube(p: CopyrightProbe | undefined) {
  const scheduled: Array<{ id: string; at: string }> = [];
  return {
    scheduled,
    yt: {
      copyrightProbe: async () => p,
      schedulePublish: async (id: string, at: Date) => {
        scheduled.push({ id, at: at.toISOString() });
      },
    },
  };
}

test("the gate asks the owner once, and reports a claim without releasing", async () => {
  const notes: string[] = [];
  const base = {
    cfg: { publicUrl: "https://x.test", appSecret: "s" },
    now: () => new Date("2026-11-14T12:00:00Z"),
  };
  const notify = async (m: { content?: string }) => {
    notes.push(m.content ?? "");
  };
  const row = {
    id: "ep1",
    video: "vid1",
    title: "Can you outrun five stars?",
    account: "",
    asked: false,
  };
  {
    const { db, logged } = fakeDb({ held: [row] });
    await copyrightChecks({
      ...base,
      db,
      notify,
      youtube: () => fakeYouTube(probe({})).yt,
    });
    assert.deepEqual(
      logged.map((l) => l.kind),
      ["copyright_asked"],
    );
    assert.match(notes.at(-1)!, /PRIVATE until its copyright check is clean/);
    assert.match(notes.at(-1)!, /copyright-clear\?t=/);
  }
  {
    const { db, logged } = fakeDb({ held: [{ ...row, asked: true }] });
    await copyrightChecks({
      ...base,
      db,
      notify,
      youtube: () => fakeYouTube(probe({})).yt,
    });
    assert.equal(logged.length, 0);
  }
  {
    const { db, logged } = fakeDb({ held: [row] });
    await copyrightChecks({
      ...base,
      db,
      notify,
      youtube: () => fakeYouTube(probe({ regionBlocked: ["US"] })).yt,
    });
    assert.deepEqual(
      logged.map((l) => l.kind),
      ["copyright_claimed"],
    );
    assert.match(notes.at(-1)!, /stays private/);
  }
});

test("the owner's tap schedules the video, but never one with a claim", async () => {
  const base = {
    cfg: { publicUrl: "https://x.test", appSecret: "s" },
    now: () => new Date("2026-11-14T12:00:00Z"),
    notify: async () => undefined,
  };
  const episode = {
    id: "ep1",
    youtube_video_id: "vid1",
    publish_at: "2026-11-14T19:00:00Z",
    story_json: {},
  };
  {
    const { db, logged, updates } = fakeDb({
      episode,
      events: ["copyright_hold"],
    });
    const y = fakeYouTube(probe({}));
    const r = await releaseHeldVideo(
      { ...base, db, youtube: () => y.yt },
      "ep1",
    );
    assert.equal(r.ok, true);
    assert.deepEqual(y.scheduled, [
      { id: "vid1", at: "2026-11-14T19:00:00.000Z" },
    ]);
    assert.deepEqual(
      logged.map((l) => l.kind),
      ["copyright_cleared"],
    );
    assert.equal(updates.length, 1);
  }
  {
    const { db } = fakeDb({
      episode,
      events: ["copyright_hold", "copyright_claimed"],
    });
    const y = fakeYouTube(probe({}));
    const r = await releaseHeldVideo(
      { ...base, db, youtube: () => y.yt },
      "ep1",
    );
    assert.equal(r.ok, false);
    assert.equal(y.scheduled.length, 0);
  }
  {
    const { db, logged } = fakeDb({ episode, events: ["copyright_hold"] });
    const y = fakeYouTube(
      probe({ uploadStatus: "rejected", rejectionReason: "copyright" }),
    );
    const r = await releaseHeldVideo(
      { ...base, db, youtube: () => y.yt },
      "ep1",
    );
    assert.equal(r.ok, false);
    assert.equal(y.scheduled.length, 0);
    assert.deepEqual(
      logged.map((l) => l.kind),
      ["copyright_claimed"],
    );
  }
  {
    const { db } = fakeDb({ episode, events: [] });
    const r = await releaseHeldVideo(
      { ...base, db, youtube: () => fakeYouTube(probe({})).yt },
      "ep1",
    );
    assert.equal(r.ok, false);
    assert.match(r.message, /not waiting/);
  }
});

// ---------------------------------------------------------------- instant replay

test("the instant replay always shows the outcome again at a quarter speed, the answer over it", () => {
  const t = instantReplayTiming(20, 15, 4, 3);
  assert.equal(t.replaySource, 1.4);
  assert.equal(t.replaySpeed, INSTANT_REPLAY_SPEED);
  assert.equal(t.seconds, 25.6);
  assert.ok(t.answerAt >= 15.9 && t.answerAt + 3 <= t.seconds);
  // Near the length limit the replay shrinks; with no room at all it is the old timing.
  const tight = instantReplayTiming(DIRECT_LONGEST - 2.5, 50, 4, 3);
  assert.ok(tight.replaySource >= 0.5 && tight.replaySource < 0.7, String(tight.replaySource));
  assert.ok(tight.seconds <= DIRECT_LONGEST);
  assert.deepEqual(
    instantReplayTiming(DIRECT_LONGEST - 0.05, 50, 4, 3),
    directTiming(DIRECT_LONGEST - 0.05, 50, 4, 3),
  );
});

test("the replay window shows the outcome, and atempo reaches a quarter in two stages", () => {
  assert.deepEqual(replayWindow({ seconds: 20, payoffAt: 15 }, 1.4), {
    from: 14.3,
    to: 15.7,
  });
  assert.deepEqual(replayWindow({ seconds: 15.5, payoffAt: 15 }, 1.4), {
    from: 14.1,
    to: 15.5,
  });
  assert.equal(atempoChain(0.25), "atempo=0.5,atempo=0.5");
  assert.equal(atempoChain(0.7), "atempo=0.7");
  assert.equal(atempoChain(0.3), "atempo=0.5,atempo=0.6");
  assert.equal(slowFactor(0.25), 4);
  assert.equal(slowFactor(0.7), 2);
});

test("the cut's filter can crop natively and replay at any speed", () => {
  const cut = { segments: [{ start: 2, end: 12 }], seconds: 10, payoffAt: 8 };
  const base = {
    tone: "",
    focusStart: 0.5,
    focusPayoff: 0.5,
    replaySource: 1.4,
  };
  const old = directFilter(cut, base);
  assert.match(old, /setpts=\(PTS-STARTPTS\)\/0\.7/);
  assert.match(old, /scale=-2:1920,crop=1080:1920/);
  const quarter = directFilter(cut, {
    ...base,
    replaySpeed: 0.25,
    native: true,
  });
  assert.match(quarter, /setpts=\(PTS-STARTPTS\)\/0\.25/);
  assert.match(quarter, /atempo=0\.5,atempo=0\.5/);
  assert.match(quarter, /crop=trunc\(ih\*9\/32\)\*2:ih/);
  assert.doesNotMatch(quarter, /scale=-2:1920/);
});

test("the REPLAY tag shows over the replay only", () => {
  const r = { from: 20, to: 25.6 };
  assert.equal(replayTagOn(19.9, r), false);
  assert.equal(replayTagOn(20, r), true);
  assert.equal(replayTagOn(25.5, r), false);
  assert.equal(replayTagOn(22, undefined), false);
});

test("the classical upscale is Lanczos then contrast-adaptive sharpening", () => {
  assert.equal(
    classicalUpscaleFilter(),
    "scale=1080:1920:flags=lanczos,cas=strength=0.50",
  );
});

// ---------------------------------------------------------------- the live relay filter

test("the live filter's command, delays and the relay's ffmpeg arguments fit together", () => {
  const s = avToolsSettings({ RELAY_MUSIC_STRIP: "true" }, none, "/home/x");
  const spec = musicStripSpec(s);
  assert.equal(spec.sampleDelaySeconds, 1.55);
  assert.equal(spec.wallLatencySeconds, 5.55);
  assert.ok(spec.args.includes("stream"));
  assert.deepEqual(
    spec.args.slice(
      spec.args.indexOf("--device"),
      spec.args.indexOf("--device") + 2,
    ),
    ["--device", "mps"],
  );
  assert.ok(
    musicStripSpec(s, { passthrough: true }).args.includes("--passthrough"),
  );
  assert.ok(latencyOk(spec, 2));
  assert.ok(!latencyOk(spec, MAX_WALL_LATENCY));
  const split = splitArgs();
  assert.deepEqual(
    split.slice(split.indexOf("pipe:1") - 6, split.indexOf("pipe:1") + 1),
    ["-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
  );
  assert.ok(split.includes("pipe:3"));
  const mux = muxArgs(spec, "rtmp://a.rtmp.youtube.com/live2/KEY");
  assert.equal(mux[mux.indexOf("-itsoffset") + 1], "1.550");
  assert.equal(mux.at(-1), "rtmp://a.rtmp.youtube.com/live2/KEY");
});

test("the filter's stderr reports are read, anything else ignored", () => {
  assert.deepEqual(
    parseStripLine(
      '{"musicStrip": "ready", "device": "mps", "sampleDelaySeconds": 1.55}',
    ),
    {
      ready: { sampleDelaySeconds: 1.55, device: "mps" },
    },
  );
  assert.deepEqual(
    parseStripLine('{"blocks": 15, "rtf": 0.42, "worstSeconds": 2.1}'),
    {
      stats: { blocks: 15, rtf: 0.42, worstSeconds: 2.1 },
    },
  );
  assert.equal(parseStripLine("Traceback (most recent call last):"), undefined);
  assert.equal(parseStripLine("{broken"), undefined);
});
