import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { z } from "zod";
import type { Llm } from "../src/editorial/llm.ts";
import {
  gameplayWindow,
  GameplayReviewSchema,
  parseExperiments,
  worthPosting,
  type GameplayReview,
} from "../src/gameplay.ts";
import {
  advance,
  ingestGameplay,
  nextGameplaySlot,
  syncGameplaySkips,
  videoMetadata,
  type Services,
} from "../src/pipeline.ts";
import {
  getEpisode,
  listEpisodes,
  countToday,
  transition,
} from "../src/episodes.ts";
import { pinnedComment } from "../src/editorial/seo.ts";
import { YouTubeClient, type FetchLike } from "../src/youtube/upload.ts";
import { FFMPEG, FFPROBE } from "../src/lib/bin.ts";
import { testDb, tmpDir, testConfig } from "./helpers.ts";

const LIST = `# GTA 6 experiment Shorts

## Police and wanted level

1. Can you lose a 5-star wanted level by swimming out to sea? (/gta-6-escape-police-swimming/)
2. What actually happens at 6 stars? How long can you survive? (/gta-6-six-star-wanted-level/)

## Physics and silly tests

14. Highest fall you can survive. (/gta-6-fall-damage/)

## After launch

- Pin a comment on every Short.
`;

function review(over: Partial<GameplayReview> = {}): GameplayReview {
  return {
    keep: true,
    score: 8,
    reason: "Clear chase with a clean escape at the end.",
    game_title: "Grand Theft Auto VI",
    experiment_number: 1,
    question: "CAN YOU OUTSWIM 5 STARS",
    result_line: "THE COPS GAVE UP",
    result:
      "The police boats lost track after about forty seconds offshore and the stars faded.",
    start_seconds: 6,
    end_seconds: 34,
    youtube_title: "GTA 6: Can You Outswim a 5-Star Wanted Level?",
    description:
      "We swam out to sea with five stars. Here is what the police did.",
    hashtags: ["#GTA6", "GTA", "#RockstarGames"],
    radio_audible: false,
    spoiler: false,
    strong_language: false,
    captions_ok: true,
    ...over,
  };
}

test("the test list parses into numbered questions with their Leonida Intel pages", () => {
  const list = parseExperiments(LIST);
  assert.deepEqual(
    list.map((e) => e.number),
    [1, 2, 14],
  );
  assert.equal(list[0]!.slug, "/gta-6-escape-police-swimming/");
  assert.equal(
    list[1]!.question,
    "What actually happens at 6 stars? How long can you survive?",
  );
});

test("the window stays inside the clip and between 20 and 35 seconds; only safe, strong clips go to the owner", () => {
  assert.deepEqual(gameplayWindow({ start_seconds: 6, end_seconds: 34 }, 40), {
    start: 6,
    end: 34,
  });
  assert.deepEqual(
    gameplayWindow({ start_seconds: 0, end_seconds: 40 }, 40),
    { start: 5, end: 40 },
    "too long: keeps the ending",
  );
  assert.deepEqual(
    gameplayWindow({ start_seconds: 30, end_seconds: 33 }, 40),
    { start: 20, end: 40 },
    "too short: widened inside the clip",
  );
  assert.deepEqual(
    gameplayWindow({ start_seconds: 0, end_seconds: 15 }, 15),
    { start: 0, end: 15 },
    "a short Xbox clip is taken whole",
  );
  assert.ok(worthPosting(review(), 7));
  assert.ok(!worthPosting(review({ score: 6 }), 7));
  assert.ok(!worthPosting(review({ spoiler: true }), 7));
  assert.ok(!worthPosting(review({ strong_language: true }), 7));
  assert.ok(!worthPosting(review({ keep: false }), 7));
});

test("a gameplay slot keeps an upload gap from every scheduled video and never doubles up", () => {
  const cfg = testConfig("x", {
    timezone: "Europe/London",
    gameplaySlots: ["21:00", "23:30"],
    minUploadGapMinutes: 90,
  });
  const now = new Date("2026-11-20T12:00:00Z"); // GMT
  assert.equal(
    nextGameplaySlot(cfg, now, [], [])!.toISOString(),
    "2026-11-20T21:00:00.000Z",
  );
  // A news Short at 22:00 blocks 21:00 (an hour apart) and 23:30 is clear of it.
  assert.equal(
    nextGameplaySlot(
      cfg,
      now,
      [new Date("2026-11-20T22:00:00Z")],
      [],
    )!.toISOString(),
    "2026-11-20T23:30:00.000Z",
  );
  // Both taken today: tomorrow's first.
  assert.equal(
    nextGameplaySlot(
      cfg,
      now,
      [],
      [new Date("2026-11-20T21:00:00Z"), new Date("2026-11-20T23:30:00Z")],
    )!.toISOString(),
    "2026-11-21T21:00:00.000Z",
  );
  // Less than 20 minutes away is too close for YouTube's scheduler.
  assert.equal(
    nextGameplaySlot(
      cfg,
      new Date("2026-11-20T20:50:00Z"),
      [],
      [],
    )!.toISOString(),
    "2026-11-20T23:30:00.000Z",
  );
});

/** A 40-second 720p clip with sound, eight frames and the finder's meta.json. */
async function inboxClip(
  root: string,
  id: string,
  title = "Testing: can you swim away from 5 stars",
) {
  const dir = path.join(root, "inbox", id);
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1280x720:rate=30:duration=40",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=40",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    path.join(dir, "clip.mp4"),
  ]);
  const frames: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const f = `frames/0${i}.jpg`;
    execFileSync(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-ss",
      String(i * 4),
      "-i",
      path.join(dir, "clip.mp4"),
      "-frames:v",
      "1",
      "-vf",
      "scale=480:-2",
      path.join(dir, f),
    ]);
    frames.push(f);
  }
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({
      id,
      status: "new",
      source: {
        file: `C:\\x\\${title}.mp4`,
        title,
        kind: "twitch_vod",
        duration_seconds: 10800,
      },
      clip: {
        file: "clip.mp4",
        start_in_source: 4520,
        peak_in_clip: 14,
        seconds: 40,
      },
      score: 1.6,
      frames,
      created_at: "2026-11-20T05:41:00.000Z",
    }),
  );
  return dir;
}

async function meta(dir: string) {
  return JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
}

async function setup() {
  const db = await testDb();
  const data = await tmpDir();
  const root = await tmpDir();
  const list = path.join(root, "list.md");
  await fs.writeFile(list, LIST);
  const cfg = testConfig(data, {
    gameplayEnabled: true,
    gameplayRoot: root,
    gameplayExperiments: list,
    youtubePrivacy: "public",
    minUploadGapMinutes: 90,
  });
  const reviews: GameplayReview[] = [];
  const llm: Llm = {
    async structured<S extends z.ZodType>({
      schema,
      content,
    }: {
      schema: S;
      content: unknown;
    }) {
      if (schema !== (GameplayReviewSchema as unknown))
        throw new Error("unexpected schema");
      const text = JSON.stringify(content);
      assert.match(text, /image\/jpeg/, "the reviewer sees the frames");
      assert.match(
        text,
        /1\. Can you lose a 5-star wanted level/,
        "and the test list",
      );
      assert.match(text, /swim away from 5 stars/, "and the stream title");
      return (reviews.shift() ?? review()) as z.infer<S>;
    },
  };
  const notes: Array<{
    content?: string;
    embeds?: Array<{ title?: string; description?: string }>;
  }> = [];
  let clock = new Date("2026-11-20T12:00:00Z");
  const uploads: Array<{
    title: string;
    description: string;
    synthetic: boolean;
    publishAt?: string;
  }> = [];
  const yt = new YouTubeClient(
    async () => "token",
    (async () => new Response("{}")) as FetchLike,
  );
  yt.findByMarker = async () => undefined;
  yt.createSession = async (resource: object) => {
    const r = resource as { snippet: { title: string; description: string }; status: { containsSyntheticMedia: boolean; publishAt?: string } };
    uploads.push({ title: r.snippet.title, description: r.snippet.description, synthetic: r.status.containsSyntheticMedia, publishAt: r.status.publishAt });
    return "https://upload.example/session/1";
  };
  yt.uploadToSession = async () => "vid_gp1";
  yt.status = async () => ({
    uploadStatus: "processed",
    privacyStatus: "public",
  });
  yt.insertComment = async () => "c1";
  const s = {
    db,
    cfg,
    llm,
    now: () => clock,
    hearClip: async () => [
      { text: "Okay,", start: 7, end: 7.4 },
      { text: "five", start: 7.5, end: 7.8 },
      { text: "stars.", start: 7.9, end: 8.3 },
      { text: "here", start: 8.5, end: 8.8 },
      { text: "goes.", start: 8.9, end: 9.3 },
      { text: "outside", start: 36, end: 36.5 },
    ],
    renderCutdown: async (input: {
      outFile: string;
      posterFile: string;
      props: Record<string, unknown>;
    }) => {
      await fs.writeFile(input.outFile, "mp4");
      await fs.writeFile(input.posterFile, "jpg");
      await fs.writeFile(
        path.join(path.dirname(input.outFile), "props.json"),
        JSON.stringify(input.props),
      );
    },
    normalise: async (a: string, b: string) => fs.copyFile(a, b),
    technicalQa: async () => ({
      ok: true,
      problems: [],
      probe: {
        width: 1080,
        height: 1920,
        durationSeconds: 28,
        hasAudio: true,
        videoCodec: "h264",
        fps: 30,
      },
      loudnessLufs: -14,
      blackSeconds: 0,
    }),
    publicReachable: async () => true,
    youtube: () => yt,
    notify: async (m: (typeof notes)[number]) => {
      notes.push(m);
      return true;
    },
  } as unknown as Services;
  return {
    db,
    cfg,
    root,
    s,
    notes,
    uploads,
    reviews,
    setClock: (d: Date) => (clock = d),
  };
}

async function run(s: Services, id: string, steps = 10) {
  for (let i = 0; i < steps; i++) {
    const ep = await getEpisode(s.db, id);
    if (!ep || !(await advance(s, ep))) return getEpisode(s.db, id);
  }
  return getEpisode(s.db, id);
}

test("a recording becomes an experiment Short: reviewed, trimmed, captioned, held for the owner's tap, slotted, live, and reported to Leonida Intel", async () => {
  const { db, root, s, notes, uploads, setClock } = await setup();
  const dir = await inboxClip(root, "gp_swim");
  const [id] = await ingestGameplay(s);
  assert.ok(id, "an episode was made");
  assert.equal((await meta(dir)).status, "picked");
  assert.equal(
    await countToday(db, "Europe/London"),
    0,
    "gameplay never counts against the news lanes' day",
  );

  // Script, voice (skipped: the game's own sound), render and the approval card, then it waits.
  let ep = await run(s, id!);
  assert.equal(ep!.status, "awaiting_approval");
  assert.equal(ep!.approval_mode, "manual", "always the owner's tap");
  assert.equal((await meta(dir)).status, "awaiting_approval");
  const card = notes.find((n) => n.embeds?.length)!.embeds![0]!;
  assert.match(
    card.description!,
    /\*\*Question:\*\* CAN YOU OUTSWIM 5 STARS\?/,
  );
  assert.match(card.description!, /test #1 on the list/);
  assert.match(card.description!, /No licensed music heard/);
  const props = JSON.parse(
    await fs.readFile(path.join(cfg(s), id!, "props.json"), "utf8"),
  );
  assert.equal(props.title, "CAN YOU OUTSWIM 5 STARS?");
  assert.equal(props.kicker, "TEST #1");
  assert.equal(props.cta, "THE COPS GAVE UP", "the answer is the end card");
  assert.deepEqual(
    props.words.map((w: { text: string; start: number }) => [
      w.text,
      Math.round(w.start * 10) / 10,
    ]),
    [
      ["Okay,", 1],
      ["five", 1.5],
      ["stars.", 1.9],
      ["here", 2.5],
      ["goes.", 2.9],
    ],
    "captions from what was said inside the window, from zero",
  );
  assert.equal(props.durationSeconds, 28);
  const cut = execFileSync(
    FFPROBE,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      path.join(cfg(s), id!, "cut.mp4"),
    ],
  ).toString();
  assert.ok(
    Math.abs(Number(cut) - 28) < 0.3,
    `cut is the 28-second window (${cut.trim()})`,
  );

  // Two days later it would expire; the owner approves after an hour instead.
  setClock(new Date("2026-11-20T13:00:00Z"));
  await transition(db, id!, "awaiting_approval", "approved", {
    approved_by: "owner",
  });
  ep = await run(s, id!);
  assert.equal(ep!.status, "published");
  assert.equal(
    new Date(ep!.publish_at!).toISOString(),
    "2026-11-20T21:00:00.000Z",
    "the first gameplay slot",
  );
  assert.equal(uploads.length, 1);
  assert.equal(
    uploads[0]!.synthetic,
    false,
    "no AI voice, so not labelled synthetic",
  );
  assert.match(
    uploads[0]!.description,
    /Gameplay recorded by Pulse Gaming on Xbox Series X/,
  );
  assert.doesNotMatch(uploads[0]!.description, /AI-generated synthetic voice/);
  assert.match(pinnedComment(ep!.script_json!), /What should we test next\?/);
  // Scheduled, so not public yet: no manifest until it is.
  await assert.rejects(fs.stat(path.join(root, "published", "gp_swim.json")));
  assert.match(videoMetadata(ep!, "public").title, /GTA 6/);
});

test("the manifest is written once the video is public, and a rejected Short marks its clip skipped", async () => {
  const { db, root, s, reviews } = await setup();
  const dir = await inboxClip(root, "gp_live");
  const [id] = await ingestGameplay(s);
  await run(s, id!);
  await transition(db, id!, "awaiting_approval", "approved", {
    approved_by: "owner",
  });
  // A slot inside 20 minutes means "go now": live at once, manifest written.
  await db.query(`UPDATE episodes SET slot_at = $2 WHERE id = $1`, [
    id,
    new Date("2026-11-20T12:05:00Z"),
  ]);
  const ep = await run(s, id!);
  assert.equal(ep!.status, "published");
  const m = JSON.parse(
    await fs.readFile(path.join(root, "published", "gp_live.json"), "utf8"),
  );
  assert.equal(m.youtube_id, "vid_gp1");
  assert.equal(m.question, "CAN YOU OUTSWIM 5 STARS?");
  assert.equal(m.experiment_slug, "/gta-6-escape-police-swimming/");
  assert.equal((await meta(dir)).status, "published");

  // A fresh question with radio heard: flagged on the card; the owner rejects it.
  reviews.push(
    review({
      experiment_number: 0,
      radio_audible: true,
      question: "DOES A TRAIN STOP FOR YOU?",
    }),
  );
  const dir2 = await inboxClip(root, "gp_train");
  const [id2] = await ingestGameplay(s);
  await run(s, id2!);
  await transition(db, id2!, "awaiting_approval", "rejected", {
    last_error: "owner rejected",
  });
  await syncGameplaySkips(s);
  assert.equal((await meta(dir2)).status, "skipped");
});

test("weak, spoiler or sweary clips are passed over; the daily review cap and one-at-a-time rule hold", async () => {
  const { db, root, s, reviews, cfg: c } = await setup();
  reviews.push(review({ score: 5 }), review({ spoiler: true }), review());
  const a = await inboxClip(root, "gp_a");
  const b = await inboxClip(root, "gp_b");
  const d = await inboxClip(root, "gp_c");
  const made = await ingestGameplay(s);
  assert.equal(made.length, 1, "the third is kept");
  assert.deepEqual(
    [
      (await meta(a)).status,
      (await meta(b)).status,
      (await meta(d)).status,
    ].sort(),
    ["picked", "rejected", "rejected"],
  );
  // Another clip waits while the picked one is still in production.
  const e = await inboxClip(root, "gp_d");
  assert.deepEqual(await ingestGameplay(s), []);
  assert.equal((await meta(e)).status, "new");
  // The daily cap.
  c.gameplayReviewsPerDay = 3;
  await db.query(`UPDATE episodes SET status = 'awaiting_approval'`);
  assert.deepEqual(await ingestGameplay(s), []);
  assert.equal((await meta(e)).status, "new");
  assert.equal((await listEpisodes(db)).length, 1);
});

function cfg(s: Services): string {
  return s.cfg.dataDir.endsWith("episodes")
    ? s.cfg.dataDir
    : path.join(s.cfg.dataDir, "episodes");
}

test("captions only for real speech, never for Whisper's looping phrase over gunfire", async () => {
  const { captionable } = await import("../src/gameplay.ts");
  const w = (t: string) => t.split(" ").map((text, i) => ({ text, start: i, end: i + 0.5 }));
  assert.ok(!captionable(w("death of death of death of death")));
  assert.ok(!captionable(w("okay go")));
  assert.ok(captionable(w("Okay, five stars, let's see if the boats follow me out")));
});
