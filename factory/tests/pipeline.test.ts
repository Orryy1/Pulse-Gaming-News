import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { Llm } from "../src/editorial/llm.ts";
import { SelectionSchema, ScriptSchema, FactCheckSchema, VisionQaSchema, type FactCheck, type Script } from "../src/editorial/schema.ts";
import { tick, selectionPause, clearSelectionPause, type Services } from "../src/pipeline.ts";
import { FatalError } from "../src/lib/util.ts";
import { getEpisode, listEpisodes } from "../src/episodes.ts";
import { clusterItems } from "../src/discovery/cluster.ts";
import { YouTubeClient, SessionGone, type FetchLike } from "../src/youtube/upload.ts";
import type { Config } from "../src/config.ts";
import type { Db } from "../src/db.ts";
import { testDb, tmpDir, testConfig, item, goodScript } from "./helpers.ts";

interface Fakes {
  script: Script;
  factChecks: FactCheck[];
  pick: number;
  uploads: number;
  sessions: number;
  failUploadOnce: boolean;
  existingOnChannel?: string;
  notifications: string[];
  captionInserts: number;
  captions: Array<{ id: string; language: string; name: string }>;
}

function fakeLlm(f: Fakes): Llm {
  return {
    async structured<S extends z.ZodType>({ schema }: { schema: S }) {
      if (schema === (SelectionSchema as unknown)) return { candidate_index: f.pick, reason: "big story", story_type: "delay", game_title: "Starfield" } as z.infer<S>;
      if (schema === (ScriptSchema as unknown)) return f.script as z.infer<S>;
      if (schema === (FactCheckSchema as unknown)) return (f.factChecks.shift() ?? { verdict: "pass", issues: [], rumour_labelling_ok: true, summary: "All claims supported." }) as z.infer<S>;
      if (schema === (VisionQaSchema as unknown)) return { verdict: "pass", problems: [], notes: "" } as z.infer<S>;
      throw new Error("unexpected schema");
    },
  } as Llm;
}

function fakeYouTube(f: Fakes): YouTubeClient {
  const yt = new YouTubeClient(async () => "token", (async () => new Response("{}")) as FetchLike);
  yt.findByMarker = async () => f.existingOnChannel;
  yt.createSession = async () => {
    f.sessions++;
    return `https://upload.example/session/${f.sessions}`;
  };
  yt.uploadToSession = async () => {
    if (f.failUploadOnce) {
      f.failUploadOnce = false;
      // The bytes reached YouTube but the response was lost.
      f.existingOnChannel = "vid_from_lost_response";
      throw new Error("socket hang up");
    }
    f.uploads++;
    return "vid_123";
  };
  yt.status = async () => ({ uploadStatus: "processed", privacyStatus: "public" });
  yt.listCaptions = async () => f.captions;
  yt.insertCaption = async () => {
    f.captionInserts++;
    f.captions.push({ id: "cap_1", language: "en-GB", name: "English" });
    return "cap_1";
  };
  return yt;
}

async function setup(cfgOverrides: Partial<Config> = {}, fakeOverrides: Partial<Fakes> = {}) {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir, cfgOverrides);
  const f: Fakes = { script: goodScript(), factChecks: [], pick: 0, uploads: 0, sessions: 0, failUploadOnce: false, notifications: [], captionInserts: 0, captions: [], ...fakeOverrides };
  let clock = new Date("2026-10-16T12:00:00Z");
  const now = () => clock;
  const s: Services = {
    db,
    cfg,
    llm: fakeLlm(f),
    discover: async () =>
      clusterItems(
        [
          item("Starfield second expansion delayed to early 2027", "Xbox Wire", "official", 20, clock),
          item("Bethesda delays Starfield second expansion to early 2027", "IGN", "outlet", 40, clock),
          item("Unconfirmed: insider claims new Halo reveal next week", "Insider Gaming", "outlet", 15, clock),
        ],
        clock,
      ),
    fetchArticle: async (url) => ({ url, title: "t", text: "Bethesda has delayed the second Starfield expansion to early 2027. ".repeat(10) }),
    synthesise: async (text, out) => {
      await fs.writeFile(out, "mp3");
      const words = text.split(/\s+/).map((w, i) => ({ text: w, start: i * 0.33, end: i * 0.33 + 0.3 }));
      return { audioPath: out, words, durationSeconds: words.length * 0.33 + 0.2 };
    },
    findGame: async () => undefined,
    gameFacts: async () => ({ name: "", storeUrl: "", fetchedAt: "" }),
    fetchArt: async () => [],
    fetchClips: async () => [],
    downloadImage: async () => false,
    imageAspect: async () => 16 / 9,
    render: async (input) => {
      await fs.writeFile(input.outFile, "mp4");
      await fs.writeFile(input.posterFile, "jpg");
    },
    normalise: async (a, b) => fs.copyFile(a, b),
    technicalQa: async () => ({ ok: true, problems: [], probe: { width: 1080, height: 1920, durationSeconds: 30, hasAudio: true, videoCodec: "h264", fps: 30 }, loudnessLufs: -14, blackSeconds: 0 }),
    extractFrames: async () => [],
    visionQa: async () => ({ verdict: "pass", problems: [], notes: "" }),
    youtube: () => fakeYouTube(f),
    notify: async (m) => {
      f.notifications.push(m.content ?? String(m.embeds?.[0]?.title ?? ""));
    },
    now,
  };
  return { db, cfg, f, s, setClock: (d: Date) => (clock = d), dir };
}

async function only(db: Db) {
  const eps = await listEpisodes(db);
  assert.equal(eps.length, 1);
  return eps[0]!;
}

test("one tick takes a corroborated story all the way to published", async () => {
  const { db, f, s, dir } = await setup();
  const r = await tick(s);
  assert.equal(r.ran, true);
  const ep = await only(db);
  assert.equal(ep.status, "published", ep.last_error ?? "");
  assert.equal(ep.youtube_video_id, "vid_123");
  assert.equal(f.uploads, 1);
  assert.equal(f.captionInserts, 1, "the SRT was uploaded as a caption track once");
  assert.equal(ep.assets_json?.srt, "captions.srt");
  assert.match(await fs.readFile(path.join(dir, "episodes", ep.id, "captions.srt"), "utf8"), /^1\n\d\d:\d\d:\d\d,\d{3} --> /);
  assert.equal(ep.story_json.corroborated, true);
  assert.ok(await fs.stat(path.join(dir, "episodes", ep.id, "short.mp4")));
  assert.ok(f.notifications.some((n) => n.startsWith("🎬")), "approval/preview notice sent");
  assert.ok(f.notifications.some((n) => n.startsWith("✅")), "published notice sent");

  // Daily target reached: a second tick does nothing new.
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 1);
  assert.equal(f.uploads, 1);
});

test("timeout approval waits, then publishes; rumours never auto-approve", async () => {
  const { db, f, s, setClock } = await setup({ approvalMode: "timeout", approvalTimeoutMinutes: 60 });
  await tick(s);
  let ep = await only(db);
  assert.equal(ep.status, "awaiting_approval");
  setClock(new Date("2026-10-16T12:30:00Z"));
  await tick(s);
  assert.equal((await getEpisode(db, ep.id))!.status, "awaiting_approval");
  setClock(new Date("2026-10-16T13:01:00Z"));
  await tick(s);
  ep = (await getEpisode(db, ep.id))!;
  assert.equal(ep.status, "published");
  assert.equal(ep.approved_by, "timeout");
  assert.equal(f.uploads, 1);
});

test("a story that fails fact-check twice is dropped, never voiced", async () => {
  const fail: FactCheck = { verdict: "fail", issues: [{ quote: "early 2027", problem: "source says late 2027", severity: "blocker" }], rumour_labelling_ok: true, summary: "Wrong date." };
  const { db, s } = await setup({}, { factChecks: [fail, { ...fail }] });
  await tick(s);
  const eps = await listEpisodes(db);
  const rejected = eps.find((e) => e.status === "rejected")!;
  assert.ok(rejected, "first episode rejected");
  assert.equal(rejected.assets_json, null, "no narration was paid for");
  assert.match(rejected.last_error ?? "", /late 2027/);
});

test("rumour-only stories are skipped while rumours are disabled", async () => {
  const { db, s } = await setup({}, { pick: 0 });
  s.discover = async () => clusterItems([item("Insider claims a new Halo reveal is coming next week", "Insider Gaming", "outlet", 15, new Date("2026-10-16T12:00:00Z"))], new Date("2026-10-16T12:00:00Z"));
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 0);
});

test("a lost upload response is adopted from the channel instead of uploading twice", async () => {
  const { db, f, s } = await setup({}, { failUploadOnce: true });
  await tick(s);
  let ep = await only(db);
  assert.equal(ep.status, "uploading");
  assert.equal(ep.attempts, 1);
  assert.ok(ep.upload_session_uri, "session persisted before bytes moved");
  // Let the back-off elapse.
  await db.query(`UPDATE episodes SET next_attempt_at = NULL`);
  await tick(s);
  ep = (await getEpisode(db, ep.id))!;
  assert.equal(ep.status, "published");
  assert.equal(ep.youtube_video_id, "vid_from_lost_response");
  assert.equal(f.uploads, 0, "never re-uploaded");
  assert.equal(f.sessions, 1);
});

test("an expired session is cleared and a fresh one is used next attempt", async () => {
  const { db, f, s } = await setup();
  let calls = 0;
  s.youtube = () => {
    const yt = fakeYouTube(f);
    yt.uploadToSession = async () => {
      calls++;
      if (calls === 1) throw new SessionGone("gone");
      f.uploads++;
      return "vid_456";
    };
    return yt;
  };
  await tick(s);
  let ep = await only(db);
  assert.equal(ep.status, "uploading");
  assert.equal(ep.upload_session_uri, null);
  await db.query(`UPDATE episodes SET next_attempt_at = NULL`);
  await tick(s);
  ep = (await getEpisode(db, ep.id))!;
  assert.equal(ep.status, "published");
  assert.equal(f.sessions, 2);
  assert.equal(f.uploads, 1);
});

test("QA failures retry, then fail loudly", async () => {
  const { db, f, s } = await setup({ maxAttempts: 2 });
  s.technicalQa = async () => ({ ok: false, problems: ["No audio stream."], probe: { width: 1080, height: 1920, durationSeconds: 30, hasAudio: false, videoCodec: "h264", fps: 30 }, loudnessLufs: -14, blackSeconds: 0 });
  await tick(s);
  await db.query(`UPDATE episodes SET next_attempt_at = NULL`);
  await tick(s);
  const ep = (await listEpisodes(db)).find((e) => e.status === "failed")!;
  assert.ok(ep);
  assert.match(ep.last_error ?? "", /No audio stream/);
  assert.ok(f.notifications.some((n) => n.includes("Episode failed")));
  assert.equal(f.uploads, 0);
});

test("DRY_RUN goes end to end without touching YouTube", async () => {
  const { db, f, s } = await setup({ dryRun: true });
  s.youtube = () => {
    throw new Error("must not be called");
  };
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "published");
  assert.equal(ep.youtube_status, "dry_run");
  assert.equal(f.uploads, 0);
});

test("a second concurrent tick is a no-op", async () => {
  const { s } = await setup();
  const [a, b] = await Promise.all([tick(s), tick(s)]);
  assert.equal([a.ran, b.ran].filter(Boolean).length, 1);
});

test("rumour episodes always wait for a human, even in timeout mode", async () => {
  const rumour = goodScript({
    is_rumour: true,
    hook: "Starfield's second expansion has reportedly slipped to early 2027.",
  });
  const { db, f, s, setClock } = await setup({ approvalMode: "timeout", approvalTimeoutMinutes: 60, includeRumours: true }, { script: rumour });
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "awaiting_approval");
  assert.equal(ep.approval_mode, "manual");
  setClock(new Date("2026-10-17T12:00:00Z"));
  await tick(s);
  assert.equal((await getEpisode(db, ep.id))!.status, "awaiting_approval");
  assert.equal(f.uploads, 0);
});

/** A different, corroborated story so the next selection has something new to pick. */
function freshStory(s: Services, now: Date) {
  s.discover = async () =>
    clusterItems(
      [
        item("Hollow Knight Silksong expansion dated for December", "Nintendo Life", "outlet", 20, now),
        item("Silksong expansion dated for December by Team Cherry", "IGN", "outlet", 40, now),
      ],
      now,
    );
}

test("a fatal upload error pauses story selection until it lapses or YouTube is reconnected", async () => {
  const { db, f, s, setClock } = await setup({ dailyTarget: 3 });
  s.youtube = () => {
    const yt = fakeYouTube(f);
    yt.createSession = async () => {
      throw new FatalError("YouTube refresh token is invalid (invalid_grant)");
    };
    return yt;
  };
  await tick(s);
  assert.equal((await only(db)).status, "failed");
  assert.ok(f.notifications.some((n) => n.includes("Episode failed")));
  assert.match((await selectionPause(db, new Date("2026-10-16T12:05:00Z"))) ?? "", /invalid_grant/);

  const later = new Date("2026-10-16T13:00:00Z");
  setClock(later);
  freshStory(s, later);
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 1, "no new story while paused");

  await clearSelectionPause(db); // what a successful /oauth/callback does
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 2, "selection resumes once reconnected");
});

test("uncorroborated stories always wait for a human, even in auto mode", async () => {
  const { db, f, s } = await setup({ approvalMode: "auto", includeRumours: true }, { script: goodScript({ is_rumour: true, hook: "Starfield's second expansion has reportedly slipped to early 2027." }) });
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "awaiting_approval");
  assert.equal(ep.approval_mode, "manual");
  assert.equal(f.uploads, 0);
});

test("an unanswered manual approval expires after 48h and frees the daily slot", async () => {
  const { db, s, setClock } = await setup({ approvalMode: "manual", dailyTarget: 1 });
  await tick(s);
  const first = await only(db);
  assert.equal(first.status, "awaiting_approval");
  const later = new Date("2026-10-18T12:30:00Z");
  setClock(later);
  freshStory(s, later);
  await tick(s);
  assert.equal((await getEpisode(db, first.id))!.status, "rejected");
  await tick(s); // the next run (10 minutes later) picks a new story
  assert.equal((await listEpisodes(db)).length, 2, "a new story was picked once the slot freed");
});

test("timeout mode never starts a countdown when the Discord notice failed", async () => {
  const { db, s } = await setup({ approvalMode: "timeout" });
  s.notify = async () => false;
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "rendered");
  assert.match(ep.last_error ?? "", /Discord/);
});

test("a vision QA fail with no listed problems still blocks the upload", async () => {
  const { db, f, s } = await setup({ maxAttempts: 1 });
  s.visionQa = async () => ({ verdict: "fail", problems: [], notes: "headline clipped" });
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "failed");
  assert.match(ep.last_error ?? "", /headline clipped/);
  assert.equal(f.uploads, 0);
});
