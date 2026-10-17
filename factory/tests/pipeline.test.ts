import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { Llm } from "../src/editorial/llm.ts";
import {
  SelectionSchema,
  ScriptSchema,
  FactCheckSchema,
  VisionQaSchema,
  type FactCheck,
  type Script,
} from "../src/editorial/schema.ts";
import {
  tick,
  selectionPause,
  clearSelectionPause,
  type Services,
} from "../src/pipeline.ts";
import { FatalError } from "../src/lib/util.ts";
import { getEpisode, listEpisodes } from "../src/episodes.ts";
import { quotaAdd } from "../src/lanes.ts";
import { clusterItems } from "../src/discovery/cluster.ts";
import {
  YouTubeClient,
  SessionGone,
  type FetchLike,
} from "../src/youtube/upload.ts";
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
  publicReachable?: boolean;
  captions: Array<{ id: string; language: string; name: string }>;
  comments: string[];
}

function fakeLlm(f: Fakes): Llm {
  return {
    async structured<S extends z.ZodType>({ schema }: { schema: S }) {
      if (schema === (SelectionSchema as unknown))
        return {
          candidate_index: f.pick,
          reason: "big story",
          story_type: "delay",
          game_title: "Starfield",
        } as z.infer<S>;
      if (schema === (ScriptSchema as unknown)) return f.script as z.infer<S>;
      if (schema === (FactCheckSchema as unknown))
        return (f.factChecks.shift() ?? {
          verdict: "pass",
          issues: [],
          rumour_labelling_ok: true,
          summary: "All claims supported.",
        }) as z.infer<S>;
      if (schema === (VisionQaSchema as unknown))
        return { verdict: "pass", problems: [], notes: "" } as z.infer<S>;
      throw new Error("unexpected schema");
    },
  } as Llm;
}

function fakeYouTube(f: Fakes): YouTubeClient {
  const yt = new YouTubeClient(
    async () => "token",
    (async () => new Response("{}")) as FetchLike,
  );
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
  yt.status = async () => ({
    uploadStatus: "processed",
    privacyStatus: "public",
  });
  yt.listCaptions = async () => f.captions;
  yt.stats = async (ids) => new Map(ids.map((id) => [id, { views: 1200, likes: 40, comments: 3, privacyStatus: "public" }]));
  yt.insertComment = async (_v, text) => {
    f.comments.push(text);
    return "c_1";
  };
  yt.insertCaption = async () => {
    f.captionInserts++;
    f.captions.push({ id: "cap_1", language: "en-GB", name: "English" });
    return "cap_1";
  };
  return yt;
}

async function setup(
  cfgOverrides: Partial<Config> = {},
  fakeOverrides: Partial<Fakes> = {},
) {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir, cfgOverrides);
  const f: Fakes = {
    script: goodScript(),
    factChecks: [],
    pick: 0,
    uploads: 0,
    sessions: 0,
    failUploadOnce: false,
    notifications: [],
    captionInserts: 0,
    captions: [],
    comments: [],
    ...fakeOverrides,
  };
  let clock = new Date("2026-10-16T12:00:00Z");
  const now = () => clock;
  const s: Services = {
    db,
    cfg,
    llm: fakeLlm(f),
    discover: async () =>
      clusterItems(
        [
          item(
            "Starfield second expansion delayed to early 2027",
            "Xbox Wire",
            "official",
            20,
            clock,
          ),
          item(
            "Bethesda delays Starfield second expansion to early 2027",
            "IGN",
            "outlet",
            40,
            clock,
          ),
          item(
            "Unconfirmed: insider claims new Halo reveal next week",
            "Insider Gaming",
            "outlet",
            15,
            clock,
          ),
        ],
        clock,
      ),
    discoverEvergreen: async () => [],
    fetchArticle: async (url) => ({
      url,
      title: "t",
      text: "Bethesda has delayed the second Starfield expansion to early 2027. ".repeat(
        10,
      ),
    }),
    synthesise: async (text, out) => {
      await fs.writeFile(out, "mp3");
      const words = text
        .split(/\s+/)
        .map((w, i) => ({ text: w, start: i * 0.33, end: i * 0.33 + 0.3 }));
      return {
        audioPath: out,
        words,
        durationSeconds: words.length * 0.33 + 0.2,
      };
    },
    findGame: async () => undefined,
    gameFacts: async () => ({ name: "", storeUrl: "", fetchedAt: "" }),
    fetchArt: async () => [],
    fetchClips: async () => [],
    fetchOfficialMedia: async () => ({ clips: [], stills: [] }),
    downloadImage: async () => false,
    imageAspect: async () => 16 / 9,
    render: async (input) => {
      await fs.writeFile(input.outFile, "mp4");
      await fs.writeFile(input.posterFile, "jpg");
    },
    normalise: async (a, b) => fs.copyFile(a, b),
    publicReachable: async () => f.publicReachable ?? true,
    technicalQa: async () => ({
      ok: true,
      problems: [],
      probe: {
        width: 1080,
        height: 1920,
        durationSeconds: 30,
        hasAudio: true,
        videoCodec: "h264",
        fps: 30,
      },
      loudnessLufs: -14,
      blackSeconds: 0,
    }),
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
  assert.equal(
    f.captionInserts,
    1,
    "the SRT was uploaded as a caption track once",
  );
  assert.equal(ep.assets_json?.srt, "captions.srt");
  assert.equal(f.comments.length, 1, "the channel posts its first comment");
  assert.match(f.comments[0]!, /^Our read: /);
  assert.match(
    await fs.readFile(
      path.join(dir, "episodes", ep.id, "captions.srt"),
      "utf8",
    ),
    /^1\n\d\d:\d\d:\d\d,\d{3} --> /,
  );
  assert.equal(ep.story_json.corroborated, true);
  assert.ok(await fs.stat(path.join(dir, "episodes", ep.id, "short.mp4")));
  assert.ok(
    f.notifications.some((n) => n.startsWith("🎬")),
    "approval/preview notice sent",
  );
  assert.ok(
    f.notifications.some((n) => n.startsWith("✅")),
    "published notice sent",
  );

  // Daily target reached: a second tick does nothing new.
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 1);
  assert.equal(f.uploads, 1);
});

test("timeout approval waits, then publishes; rumours never auto-approve", async () => {
  const { db, f, s, setClock } = await setup({
    approvalMode: "timeout",
    approvalTimeoutMinutes: 60,
  });
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
  const fail: FactCheck = {
    verdict: "fail",
    issues: [
      {
        quote: "early 2027",
        problem: "source says late 2027",
        severity: "blocker",
      },
    ],
    rumour_labelling_ok: true,
    summary: "Wrong date.",
  };
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
  s.discover = async () =>
    clusterItems(
      [
        item(
          "Insider claims a new Halo reveal is coming next week",
          "Insider Gaming",
          "outlet",
          15,
          new Date("2026-10-16T12:00:00Z"),
        ),
      ],
      new Date("2026-10-16T12:00:00Z"),
    );
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
  s.technicalQa = async () => ({
    ok: false,
    problems: ["No audio stream."],
    probe: {
      width: 1080,
      height: 1920,
      durationSeconds: 30,
      hasAudio: false,
      videoCodec: "h264",
      fps: 30,
    },
    loudnessLufs: -14,
    blackSeconds: 0,
  });
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
  const { db, f, s, setClock } = await setup(
    {
      approvalMode: "timeout",
      approvalTimeoutMinutes: 60,
      includeRumours: true,
    },
    { script: rumour },
  );
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
        item(
          "Hollow Knight Silksong expansion dated for December",
          "Nintendo Life",
          "outlet",
          20,
          now,
        ),
        item(
          "Silksong expansion dated for December by Team Cherry",
          "IGN",
          "outlet",
          40,
          now,
        ),
      ],
      now,
    );
}

test("a fatal upload error pauses story selection until it lapses or YouTube is reconnected", async () => {
  // A second slot (14:30 London = 13:30Z, due from 12:15Z) so selection can resume at 13:00Z.
  const { db, f, s, setClock } = await setup({
    dailyTarget: 3,
    newsSlots: ["13:00", "14:30"],
  });
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
  assert.match(
    (await selectionPause(db, new Date("2026-10-16T12:05:00Z"))) ?? "",
    /invalid_grant/,
  );

  const later = new Date("2026-10-16T13:00:00Z");
  setClock(later);
  freshStory(s, later);
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 1, "no new story while paused");

  await clearSelectionPause(db); // what a successful /oauth/callback does
  await tick(s);
  assert.equal(
    (await listEpisodes(db)).length,
    2,
    "selection resumes once reconnected",
  );
});

test("uncorroborated stories always wait for a human, even in auto mode", async () => {
  const { db, f, s } = await setup(
    { approvalMode: "auto", includeRumours: true },
    {
      script: goodScript({
        is_rumour: true,
        hook: "Starfield's second expansion has reportedly slipped to early 2027.",
      }),
    },
  );
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "awaiting_approval");
  assert.equal(ep.approval_mode, "manual");
  assert.equal(f.uploads, 0);
});

test("an unanswered manual approval expires after 48h and frees the daily slot", async () => {
  const { db, s, setClock } = await setup({
    approvalMode: "manual",
    dailyTarget: 1,
  });
  await tick(s);
  const first = await only(db);
  assert.equal(first.status, "awaiting_approval");
  const later = new Date("2026-10-18T12:30:00Z");
  setClock(later);
  freshStory(s, later);
  await tick(s);
  assert.equal((await getEpisode(db, first.id))!.status, "rejected");
  await tick(s); // the next run (10 minutes later) picks a new story
  assert.equal(
    (await listEpisodes(db)).length,
    2,
    "a new story was picked once the slot freed",
  );
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
  s.visionQa = async () => ({
    verdict: "fail",
    problems: [],
    notes: "headline clipped",
  });
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "failed");
  assert.match(ep.last_error ?? "", /headline clipped/);
  assert.equal(f.uploads, 0);
});

test("timeout approval is held while the public URL is unreachable", async () => {
  const { db, f, s, setClock } = await setup(
    { approvalMode: "timeout", approvalTimeoutMinutes: 60 },
    { publicReachable: false },
  );
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "awaiting_approval");
  setClock(new Date("2026-10-16T14:00:00Z"));
  await tick(s);
  assert.equal(
    (await only(db)).status,
    "awaiting_approval",
    "held: nobody could have tapped Reject",
  );
  f.publicReachable = true;
  await tick(s);
  assert.equal((await only(db)).status, "published");
});

function breakingStory(s: Services, now: Date) {
  s.discover = async () =>
    clusterItems(
      [
        item("Grand Theft Auto VI trailer 3 is out now", "Rockstar Newswire", "official", 2, now),
        item("GTA 6 trailer 3 just dropped and it is enormous", "IGN", "outlet", 1, now),
        item("Rockstar releases Grand Theft Auto VI trailer 3", "VGC", "outlet", 1, now),
      ],
      now,
    );
}

test("the breaking lane fires on a huge fresh official story outside any news slot, with a short approval countdown", async () => {
  // 09:00 London: no news slot is due, but a massive official story landed minutes ago.
  const { db, f, s, setClock } = await setup({ dailyTarget: 4, newsSlots: ["19:30"], approvalMode: "timeout", approvalTimeoutMinutes: 60, breakingApprovalMinutes: 20, breakingScoreMin: 40 });
  const at = new Date("2026-10-16T08:00:00Z");
  setClock(at);
  breakingStory(s, at);
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.lane, "news_breaking");
  assert.equal(ep.priority, 100);
  assert.equal(ep.status, "awaiting_approval");
  assert.ok(f.notifications.some((n) => n.startsWith("🚨")), "the owner is told a breaking Short is in production");
  setClock(new Date("2026-10-16T08:25:00Z"));
  await tick(s);
  const done = await only(db);
  assert.equal(done.status, "published", "published after the 20-minute countdown");
  assert.equal(done.publish_at, null, "breaking publishes immediately inside its window");

  // The same franchise cannot fire again within the cooldown, even with a new story hash.
  setClock(new Date("2026-10-16T09:00:00Z"));
  s.discover = async () => clusterItems([item("Grand Theft Auto VI trailer 3 breaks the internet", "Rockstar Newswire", "official", 2, new Date("2026-10-16T09:00:00Z")), item("GTA 6 trailer 3 record views", "IGN", "outlet", 1, new Date("2026-10-16T09:00:00Z"))], new Date("2026-10-16T09:00:00Z"));
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 1, "franchise cooldown holds");
});

test("news Shorts are made for their slots and publish at the slot; a waiting episode never blocks the next one", async () => {
  // Slots at 13:00 and 14:30 London (12:00Z and 13:30Z). Clock 12:00Z: the 13:00 slot is due.
  const { db, s, setClock } = await setup({ dailyTarget: 4, newsSlots: ["13:00", "14:30"], approvalMode: "manual", breakingEnabled: false, youtubePrivacy: "unlisted" });
  await tick(s);
  const first = await only(db);
  assert.equal(first.lane, "news");
  assert.equal(new Date(first.slot_at!).toISOString(), "2026-10-16T12:00:00.000Z");
  assert.equal(first.status, "awaiting_approval", "manual mode waits for the owner");

  // 12:20Z: the 14:30 slot (due from 12:15Z) is selected although the first episode is still waiting.
  const later = new Date("2026-10-16T12:20:00Z");
  setClock(later);
  freshStory(s, later);
  await tick(s);
  const eps = await listEpisodes(db);
  assert.equal(eps.length, 2, "a waiting episode does not block production for the next slot");
  const second = eps.find((e) => e.id !== first.id)!;
  assert.equal(new Date(second.slot_at!).toISOString(), "2026-10-16T13:30:00.000Z");

  // Approving the second one schedules it for its slot rather than publishing early.
  await db.query(`UPDATE episodes SET status = 'approved', approved_by = 'owner' WHERE id = $1`, [second.id]);
  await tick(s);
  const scheduled = (await getEpisode(db, second.id))!;
  assert.equal(scheduled.status, "uploading");
  assert.equal(new Date(scheduled.publish_at!).toISOString(), "2026-10-16T13:30:00.000Z", "publishes at its slot");
  assert.ok(scheduled.next_attempt_at && new Date(scheduled.next_attempt_at).toISOString() === "2026-10-16T13:30:00.000Z", "the unlisted upload itself waits for the slot");
  // Nothing happens until the slot.
  setClock(new Date("2026-10-16T13:00:00Z"));
  await tick(s);
  assert.equal((await getEpisode(db, second.id))!.status, "uploading");
  setClock(new Date("2026-10-16T13:31:00Z"));
  await tick(s);
  assert.equal((await getEpisode(db, second.id))!.status, "published");
});

test("uploads are deferred to the next Pacific day when the YouTube quota is nearly spent", async () => {
  const { db, s, setClock } = await setup({ dryRun: false, approvalMode: "auto", breakingEnabled: false });
  await quotaAdd(db, new Date("2026-10-16T12:00:00Z"), 9000);
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "uploading", "the upload waits");
  assert.equal(new Date(ep.next_attempt_at!).toISOString(), "2026-10-17T07:00:00.000Z", "retried at midnight Pacific");
  setClock(new Date("2026-10-17T07:05:00Z"));
  await tick(s);
  assert.equal((await only(db)).status, "published");
});
