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
  tickLong,
  maybeSelectWeekly,
  footageCredits,
  selectionPause,
  clearSelectionPause,
  type Services,
} from "../src/pipeline.ts";
import { FatalError } from "../src/lib/util.ts";
import { getEpisode, listEpisodes, countToday } from "../src/episodes.ts";
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
import {
  EvergreenScriptSchema,
  type EvergreenScript,
} from "../src/editorial/evergreen.ts";
import { TwinScriptSchema } from "../src/editorial/twin.ts";
import { LongformPlanSchema } from "../src/editorial/longform.ts";

/** A small, valid ranking draft for the fake writer. */
function rankingDraft(): EvergreenScript {
  const names = ["Halo 5", "Halo 4", "Halo Reach", "Halo 2", "Halo 3"];
  return {
    format: "ranking",
    theme: "Halo",
    title: "Ranking Every Halo",
    hook: "Every mainline Halo ranked by one thing only, how good the campaign still is today.",
    entries: names.map((game_title, i) => ({
      rank: names.length - i,
      game_title,
      steam_search_term: game_title,
      year: 2001 + i * 3,
      platforms: "Xbox, PC",
      one_line: `${game_title} had the budget, yet its campaign ran out of ideas faster than the rest.`,
      verdict_chip: i === names.length - 1 ? "STILL THE ONE" : "PLAY IT ONCE",
      footage: { want: "gameplay", keywords: ["warthog run"] },
    })),
    pulse_take: {
      label: "THE CRITERION",
      narration:
        "Number one still has the best campaign pacing in the series, and nothing else here comes close.",
      on_screen: "Still the best campaign",
    },
    loop_line:
      "And that is every Halo ranked by how good the campaign still is.",
    youtube: {
      title: "Ranking EVERY Halo game",
      description: "Every mainline Halo ranked by campaign.",
      tags: ["Halo"],
    },
    claims: [{ claim: "Halo 3 released in 2007", source: "public knowledge" }],
  };
}

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
  privacy?: string;
  captions: Array<{ id: string; language: string; name: string }>;
  comments: string[];
  resources: Array<{
    snippet: { title: string; description: string; defaultLanguage?: string };
  }>;
  voices: string[];
  visual?: "none" | "game_footage" | "real_world_images";
  media?: number;
  stock?: number;
  radar?: Array<{
    name: string;
    appId: number;
    date: string;
    price?: string;
    developer?: string;
  }>;
  free?: {
    now: Array<{
      title: string;
      url: string;
      until?: string;
      originalPrice?: string;
      description: string;
      imageUrl?: string;
    }>;
    next: Array<{
      title: string;
      url: string;
      starts?: string;
      description: string;
    }>;
  };
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
          visual_dependency: f.visual ?? "none",
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
      if (schema === (EvergreenScriptSchema as unknown))
        return rankingDraft() as z.infer<S>;
      if (schema === (TwinScriptSchema as unknown))
        return {
          headline: "Expansión de Starfield retrasada a 2027",
          hook: "La segunda expansión de Starfield se retrasa a principios de 2027.",
          beats: [
            {
              narration:
                "Bethesda confirmó el cambio esta mañana en Xbox Wire y dice que el tiempo extra irá a pulido y rendimiento en todas las plataformas.",
              primary: "Principios de 2027",
              secondary: "nueva ventana",
            },
            {
              narration:
                "La expansión estaba prevista para este diciembre, así que es un retraso de al menos tres meses si la estabas esperando.",
              primary: "3+ meses",
              secondary: "más tarde de lo previsto",
            },
          ],
          take_label: "QUÉ SIGNIFICA",
          take_narration:
            "Para nosotros, Bethesda ya ha retrasado contenido grande antes y suele llegar en mejor estado, así que todavía no es una señal de alarma.",
          take_on_screen: "Todavía no es una alarma",
          loop_line:
            "Así que si la esperas, apunta principios de 2027 para la segunda expansión de Starfield.",
          attribution: "Fuente: Xbox Wire / IGN",
          youtube_title: "Starfield retrasa su expansión a principios de 2027",
          youtube_description:
            "Bethesda ha movido la expansión. Fuentes: Xbox Wire e IGN.",
          youtube_tags: ["starfield", "bethesda", "expansión"],
          pinned_comment:
            "Nuestra lectura: todavía no es una alarma. ¿Esperas o pasas?",
        } as z.infer<S>;
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
  yt.createSession = async (resource) => {
    f.sessions++;
    f.resources.push(
      resource as {
        snippet: {
          title: string;
          description: string;
          defaultLanguage?: string;
        };
      },
    );
    return `https://upload.example/session/${f.sessions}`;
  };
  yt.uploadToSession = async () => {
    if (f.failUploadOnce) {
      f.failUploadOnce = false;
      // The bytes reached YouTube but the response was lost.
      f.existingOnChannel = "vid_from_lost_response";
      throw new Error("socket hang up");
    }
    // As a real resumable session does: once every byte has arrived, asking again returns the video
    // without sending anything.
    if (f.existingOnChannel === "vid_from_lost_response")
      return "vid_from_lost_response";
    f.uploads++;
    // Each upload is its own video (the table keeps video ids unique).
    return f.uploads === 1 ? "vid_123" : `vid_123_${f.uploads}`;
  };
  yt.status = async () => ({
    uploadStatus: "processed",
    privacyStatus: f.privacy ?? "public",
  });
  yt.listCaptions = async () => f.captions;
  yt.stats = async (ids) =>
    new Map(
      ids.map((id) => [
        id,
        { views: 1200, likes: 40, comments: 3, privacyStatus: "public" },
      ]),
    );
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
    resources: [],
    voices: [],
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
    stitchTakes: async (parts, out) => {
      await fs.writeFile(out, "mp3");
      const words: Array<{ text: string; start: number; end: number }> = [];
      let offset = 0;
      for (const p of parts) {
        for (const w of p.words)
          words.push({
            text: w.text,
            start: w.start + offset,
            end: w.end + offset,
          });
        offset += p.durationSeconds + 0.18;
      }
      return { audioPath: out, words, durationSeconds: offset - 0.18 + 0.15 };
    },
    synthesise: async (text, out, voice) => {
      f.voices.push(voice?.name ?? "default");
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
    releaseRadar: async () => f.radar ?? [],
    freeGames: async () => f.free ?? { now: [], next: [] },
    achievements: async () => [],
    research: async () => undefined,
    steamClimbers: async () => [],
    steamDeals: async () => [],
    trending: async () => [],
    ownClips: async () => [],
    searchPhotos: async () => [],
    igdbArt: async () => [],
    gameplayClips: async () => [],
    judgeFootage: async () => true,
    downloadPhoto: async () => false,
    fetchStock: async (_dir, targets) =>
      (f.stock ?? 0) > 0
        ? targets
            .slice(0, f.stock)
            .map((t, i) => ({
              kind: "clip" as const,
              file: `assets/stock_${i}.mp4`,
              sourceUrl: "https://www.pexels.com/video/1",
              durationSeconds: 4,
              beatIndex: Number.parseInt(t.key.slice(5), 10),
              stock: true,
              provenance:
                "Illustrative stock footage from Pexels (https://www.pexels.com/video/1) by x, free to use under the Pexels licence",
            }))
        : [],
    fetchOfficialMedia: async () => ({
      clips: [],
      stills: Array.from({ length: f.media ?? 2 }, (_, i) => ({
        kind: "hero" as const,
        file: `assets/official_${i}.jpg`,
        sourceUrl: "https://www.youtube.com/watch?v=x",
        provenance: "test still",
      })),
    }),
    downloadImage: async () => false,
    imageAspect: async () => 16 / 9,
    render: async (input) => {
      await fs.writeFile(input.outFile, "mp4");
      await fs.writeFile(input.posterFile, "jpg");
    },
    renderLong: async (input) => {
      await fs.writeFile(input.outFile, "mp4");
      await fs.writeFile(input.posterFile, "jpg");
      await fs.writeFile(input.thumbFile, "jpg");
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

test("footage credits name every trailer source and skip an empty sources block", () => {
  const clips = [
    {
      provenance:
        'Official Steam trailer "Launch" for "Resident Evil 4" (app 1), 2.4s at 10.0s, muted; chosen for beat:0 by model (x)',
    },
    {
      provenance:
        'Official Steam trailer "Reveal" for "Resident Evil 7 Biohazard" (app 2), 2.4s at 10.0s, muted; chosen for beat:1 by model (x)',
    },
    {
      provenance:
        'Official trailer "RE Code Veronica" from the Capcom YouTube channel, publisher: Capcom (https://www.youtube.com/watch?v=abc), 2s at 5.0s, muted; chosen for beat:2 by model (x)',
    },
  ];
  const credit = footageCredits(
    goodScript({
      entries: [
        {
          rank: 1,
          game_title: "x",
          steam_search_term: "",
          year: 2020,
          platforms: "PC",
        },
      ],
    }),
    clips,
    undefined,
    "Capcom",
    "ranking",
  );
  assert.match(
    credit,
    /official Steam trailers, a few seconds each: Resident Evil 4, Resident Evil 7 Biohazard/,
  );
  assert.match(
    credit,
    /official Capcom YouTube channel \(https:\/\/www\.youtube\.com\/watch\?v=abc\)/,
  );
  const single = footageCredits(
    goodScript(),
    [clips[0]!],
    undefined,
    "Capcom",
    "news",
  );
  assert.match(
    single,
    /^\nFootage: Resident Evil 4 official trailer \(Capcom\), via Steam/,
  );
  assert.equal(footageCredits(goodScript(), [], undefined, undefined, "x"), "");
});

test("a picture story goes out only with safe pictures of it, and a Short with nothing to show is dropped and frees its slot", async () => {
  {
    // A picture story with nothing safe to show is dropped before upload.
    const { s, f, db } = await setup({}, { visual: "real_world_images" });
    await tick(s);
    const [ep] = await db.query<{ status: string; last_error: string }>(
      `SELECT status, last_error FROM episodes`,
    );
    assert.equal(ep?.status, "rejected");
    assert.match(ep!.last_error, /picture story with nothing safe to show/);
    assert.equal(f.uploads, 0);
    await db.close();
  }
  {
    // With illustrative stock for its real-world lines it goes out, credited.
    const { s, f, db } = await setup(
      {},
      { visual: "real_world_images", stock: 2 },
    );
    await tick(s);
    const [ep] = await db.query<{ status: string; assets_json: any }>(
      `SELECT status, assets_json FROM episodes`,
    );
    assert.equal(ep?.status, "published");
    assert.equal(ep!.assets_json.clips.filter((c: any) => c.stock).length, 2);
    assert.equal(f.uploads, 1);
    await db.close();
  }
  {
    const { s, f, db } = await setup({}, { media: 0 });
    await tick(s);
    const [ep] = await db.query<{ status: string; last_error: string }>(
      `SELECT status, last_error FROM episodes`,
    );
    assert.equal(ep?.status, "rejected");
    assert.match(ep!.last_error, /nothing worth showing/);
    assert.ok(
      f.notifications.some((n) => /Dropped/.test(n)),
      "Discord is told",
    );
    assert.equal(f.uploads, 0, "nothing was uploaded");
    await db.close();
  }
});

test("Free This Week runs on its day from Epic's own data as an official story, and only once a day", async () => {
  // Thursday 22 Oct 2026, 19:00 London: the 20:00 weekly slot is due.
  const { db, s, setClock } = await setup(
    {
      weeklyEnabled: true,
      newsSlots: [],
      breakingEnabled: false,
      evergreenEnabled: false,
      dailyTarget: 4,
    },
    {
      free: {
        now: [
          {
            title: "Bad Cheese",
            url: "https://store.epicgames.com/en-US/p/bad-cheese",
            until: "2026-10-29T15:00:00.000Z",
            originalPrice: "$19.99",
            description: "A cartoon horror game.",
            imageUrl: "https://cdn/x.jpg",
          },
        ],
        next: [],
      },
    },
  );
  setClock(new Date("2026-10-22T18:00:00Z"));
  const id = await maybeSelectWeekly(s);
  assert.ok(id, "selected");
  const [ep] = await db.query<{
    lane: string;
    story_json: any;
    slot_at: string;
  }>(`SELECT lane, story_json, slot_at FROM episodes`);
  assert.equal(ep!.lane, "free");
  assert.equal(ep!.story_json.items[0].sourceKind, "official");
  assert.match(ep!.story_json.items[0].summary, /normally costs \$19\.99/);
  assert.equal(new Date(ep!.slot_at).toISOString(), "2026-10-22T19:00:00.000Z");
  assert.equal(await maybeSelectWeekly(s), undefined, "not twice in a day");
  await db.close();
});

test("Release Radar hands the week's dated releases to the writer, and skips a thin week", async () => {
  const games = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map(
    (name, i) => ({
      name,
      appId: 100 + i,
      date: `2026-10-${20 + i}`,
      price: "$29.99",
      developer: "Studio",
    }),
  );
  {
    const { db, s, setClock } = await setup(
      {
        weeklyEnabled: true,
        newsSlots: [],
        breakingEnabled: false,
        evergreenEnabled: false,
      },
      { radar: games },
    );
    setClock(new Date("2026-10-19T18:00:00Z")); // Monday 19:00 London
    assert.ok(await maybeSelectWeekly(s));
    const [ep] = await db.query<{ lane: string; factcheck_json: any }>(
      `SELECT lane, factcheck_json FROM episodes`,
    );
    assert.equal(ep!.lane, "evergreen");
    assert.equal(ep!.factcheck_json.topic.format, "release_radar");
    assert.match(ep!.factcheck_json.brief, /Alpha \| out 2026-10-20/);
    await db.close();
  }
  {
    const { db, s, setClock } = await setup(
      {
        weeklyEnabled: true,
        newsSlots: [],
        breakingEnabled: false,
        evergreenEnabled: false,
      },
      { radar: games.slice(0, 2) },
    );
    setClock(new Date("2026-10-19T18:00:00Z"));
    assert.equal(await maybeSelectWeekly(s), undefined);
    await db.close();
  }
});

test("one tick takes a corroborated story all the way to published", async () => {
  const { db, f, s, dir } = await setup();
  const r = await tick(s);
  assert.equal(r.ran, true);
  const ep = await only(db);
  assert.equal(ep.status, "published", ep.last_error ?? "");
  assert.equal(ep.youtube_video_id, "vid_123");
  assert.equal(f.uploads, 1);
  // A Short's captions stay on disk: YouTube captions Shorts itself, and the quota pays for the deals Short.
  assert.equal(
    f.captionInserts,
    0,
    "a Short's SRT is not uploaded as a caption track",
  );
  assert.equal(ep.assets_json?.srt, "captions.srt");
  assert.equal(f.comments.length, 1, "the channel posts its first comment");
  assert.match(
    f.comments[0]!,
    /\? (Our take|Where we land|The short version|Bottom line|Our verdict): /,
  );
  assert.doesNotMatch(f.comments[0]!, /our read/i);
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
  const { quotaCalls } = await import("../src/lanes.ts");
  assert.equal(
    await quotaCalls(db, s.now(), "upload"),
    1,
    "the adopted upload is counted once",
  );
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
  assert.ok(f.notifications.some((n) => n.includes("Gave up on")));
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

const SINGLE_SOURCE_RUMOUR = (clock: Date) =>
  clusterItems(
    [
      item(
        "Insider claims a new Halo reveal is coming next week",
        "Insider Gaming",
        "outlet",
        15,
        clock,
      ),
    ],
    clock,
  );

test("a rumour two outlets carry goes out labelled under the lane's own mode; a single-source one waits for a human", async () => {
  const rumour = goodScript({
    is_rumour: true,
    hook: "Starfield's second expansion has reportedly slipped to early 2027.",
  });
  {
    // Xbox Wire and IGN both carry the report: timeout mode applies, and the Short is labelled.
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
    assert.equal(ep.approval_mode, "timeout");
    setClock(new Date("2026-10-16T13:01:00Z"));
    await tick(s);
    assert.equal((await getEpisode(db, ep.id))!.status, "published");
    assert.equal(f.uploads, 1);
    await db.close();
  }
  {
    // One outlet's claim: a human decides, whatever the mode.
    const { db, f, s, setClock } = await setup(
      {
        approvalMode: "timeout",
        approvalTimeoutMinutes: 60,
        includeRumours: true,
      },
      { script: rumour },
    );
    s.discover = async () =>
      SINGLE_SOURCE_RUMOUR(new Date("2026-10-16T12:00:00Z"));
    await tick(s);
    const ep = await only(db);
    assert.equal(ep.status, "awaiting_approval");
    assert.equal(ep.approval_mode, "manual");
    setClock(new Date("2026-10-17T12:00:00Z"));
    await tick(s);
    assert.equal((await getEpisode(db, ep.id))!.status, "awaiting_approval");
    assert.equal(f.uploads, 0);
    await db.close();
  }
});

test("one rumour Short a day: a second story with rumour signals waits for tomorrow", async () => {
  const rumour = goodScript({
    is_rumour: true,
    hook: "Starfield's second expansion has reportedly slipped to early 2027.",
  });
  const { db, s, setClock } = await setup(
    {
      approvalMode: "auto",
      includeRumours: true,
      dailyTarget: 3,
      rumoursPerDay: 1,
    },
    { script: rumour },
  );
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 1, "today's rumour is in");
  // A fresh report an hour later is left alone; a corroborated plain story is not.
  setClock(new Date("2026-10-16T13:00:00Z"));
  s.discover = async () =>
    clusterItems(
      [
        item(
          "Halo reveal reportedly set for next week, per two insiders",
          "VGC",
          "outlet",
          20,
          new Date("2026-10-16T13:00:00Z"),
        ),
        item(
          "Report: Halo reveal next week",
          "Eurogamer",
          "outlet",
          30,
          new Date("2026-10-16T13:00:00Z"),
        ),
      ],
      new Date("2026-10-16T13:00:00Z"),
    );
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 1, "the second rumour waits");
  await db.close();
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
  assert.ok(f.notifications.some((n) => n.includes("Needs you")));
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
  s.discover = async () =>
    SINGLE_SOURCE_RUMOUR(new Date("2026-10-16T12:00:00Z"));
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
        item(
          "Grand Theft Auto VI trailer 3 is out now",
          "Rockstar Newswire",
          "official",
          2,
          now,
        ),
        item(
          "GTA 6 trailer 3 just dropped and it is enormous",
          "IGN",
          "outlet",
          1,
          now,
        ),
        item(
          "Rockstar releases Grand Theft Auto VI trailer 3",
          "VGC",
          "outlet",
          1,
          now,
        ),
      ],
      now,
    );
}

test("the breaking lane fires on a huge fresh official story outside any news slot, with a short approval countdown", async () => {
  // 09:00 London: no news slot is due, but a massive official story landed minutes ago.
  const { db, f, s, setClock } = await setup({
    dailyTarget: 4,
    newsSlots: ["19:30"],
    approvalMode: "timeout",
    approvalTimeoutMinutes: 60,
    breakingApprovalMinutes: 20,
    breakingScoreMin: 40,
  });
  const at = new Date("2026-10-16T08:00:00Z");
  setClock(at);
  breakingStory(s, at);
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.lane, "news_breaking");
  assert.equal(ep.priority, 100);
  assert.equal(ep.status, "awaiting_approval");
  assert.ok(
    f.notifications.some((n) => n.startsWith("Breaking story picked")),
    "the owner is told a breaking Short is in production",
  );
  setClock(new Date("2026-10-16T08:25:00Z"));
  await tick(s);
  const done = await only(db);
  assert.equal(
    done.status,
    "published",
    "published after the 20-minute countdown",
  );
  assert.equal(
    done.publish_at,
    null,
    "breaking publishes immediately inside its window",
  );

  // The same franchise cannot fire again within the cooldown, even with a new story hash.
  setClock(new Date("2026-10-16T09:00:00Z"));
  s.discover = async () =>
    clusterItems(
      [
        item(
          "Grand Theft Auto VI trailer 3 breaks the internet",
          "Rockstar Newswire",
          "official",
          2,
          new Date("2026-10-16T09:00:00Z"),
        ),
        item(
          "GTA 6 trailer 3 record views",
          "IGN",
          "outlet",
          1,
          new Date("2026-10-16T09:00:00Z"),
        ),
      ],
      new Date("2026-10-16T09:00:00Z"),
    );
  await tick(s);
  assert.equal((await listEpisodes(db)).length, 1, "franchise cooldown holds");
});

test("news Shorts are made for their slots and publish at the slot; a waiting episode never blocks the next one", async () => {
  // Slots at 13:00 and 14:30 London (12:00Z and 13:30Z). Clock 12:00Z: the 13:00 slot is due.
  const { db, s, setClock } = await setup({
    dailyTarget: 4,
    newsSlots: ["13:00", "14:30"],
    approvalMode: "manual",
    breakingEnabled: false,
    youtubePrivacy: "unlisted",
  });
  await tick(s);
  const first = await only(db);
  assert.equal(first.lane, "news");
  assert.equal(
    new Date(first.slot_at!).toISOString(),
    "2026-10-16T12:00:00.000Z",
  );
  assert.equal(
    first.status,
    "awaiting_approval",
    "manual mode waits for the owner",
  );

  // 12:20Z: the 14:30 slot (due from 12:15Z) is selected although the first episode is still waiting.
  const later = new Date("2026-10-16T12:20:00Z");
  setClock(later);
  freshStory(s, later);
  await tick(s);
  const eps = await listEpisodes(db);
  assert.equal(
    eps.length,
    2,
    "a waiting episode does not block production for the next slot",
  );
  const second = eps.find((e) => e.id !== first.id)!;
  assert.equal(
    new Date(second.slot_at!).toISOString(),
    "2026-10-16T13:30:00.000Z",
  );

  // Approving the second one schedules it for its slot rather than publishing early.
  await db.query(
    `UPDATE episodes SET status = 'approved', approved_by = 'owner' WHERE id = $1`,
    [second.id],
  );
  await tick(s);
  const scheduled = (await getEpisode(db, second.id))!;
  assert.equal(scheduled.status, "uploading");
  assert.equal(
    new Date(scheduled.publish_at!).toISOString(),
    "2026-10-16T13:30:00.000Z",
    "publishes at its slot",
  );
  assert.ok(
    scheduled.next_attempt_at &&
      new Date(scheduled.next_attempt_at).toISOString() ===
        "2026-10-16T13:30:00.000Z",
    "the unlisted upload itself waits for the slot",
  );
  // Nothing happens until the slot.
  setClock(new Date("2026-10-16T13:00:00Z"));
  await tick(s);
  assert.equal((await getEpisode(db, second.id))!.status, "uploading");
  setClock(new Date("2026-10-16T13:31:00Z"));
  await tick(s);
  assert.equal((await getEpisode(db, second.id))!.status, "published");
});

test("uploads draw on their own daily bucket: a busy shared pool no longer holds a Short back", async () => {
  const { db, s, f } = await setup({
    dryRun: false,
    approvalMode: "auto",
    breakingEnabled: false,
  });
  await quotaAdd(db, new Date("2026-10-16T12:00:00Z"), 9000);
  await tick(s);
  assert.equal((await only(db)).status, "published");
  assert.equal(f.uploads, 1);
  const { quotaCalls } = await import("../src/lanes.ts");
  assert.equal(
    await quotaCalls(db, new Date("2026-10-16T12:00:00Z"), "upload"),
    1,
    "one upload call counted",
  );
});

test("uploads are deferred to the next Pacific day when the day's upload calls are spent", async () => {
  const { db, s, setClock } = await setup({
    dryRun: false,
    approvalMode: "auto",
    breakingEnabled: false,
    uploadCallsPerDay: 3,
  });
  const { quotaCall } = await import("../src/lanes.ts");
  for (let k = 0; k < 3; k++)
    await quotaCall(db, new Date("2026-10-16T12:00:00Z"), "upload");
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "uploading", "the upload waits");
  assert.equal(
    new Date(ep.next_attempt_at!).toISOString(),
    "2026-10-17T07:00:00.000Z",
    "retried at midnight Pacific",
  );
  setClock(new Date("2026-10-17T07:05:00Z"));
  await tick(s);
  assert.equal((await only(db)).status, "published");
});

async function delayedEpisode(
  db: Db,
  cfg: Config,
  id: string,
  lane: string,
  plannedAt: Date,
) {
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, publish_at)
     VALUES ($1, $1, 'uploading', $2, $3, $4, $5)`,
    [
      id,
      JSON.stringify({
        headline: id,
        items: [],
        sources: ["IGN"],
        corroborated: true,
      }),
      lane,
      JSON.stringify(goodScript()),
      plannedAt,
    ],
  );
  const dir = path.join(cfg.dataDir, "episodes", id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "short.mp4"), "mp4");
}

test("the publishing hold stops uploads and survives a restart and a quota reset", async () => {
  const { setPublishHold } = await import("../src/lanes.ts");
  const { db, s, f, cfg, setClock } = await setup({
    dryRun: false,
    breakingEnabled: false,
  });
  await setPublishHold(db, true);
  await delayedEpisode(
    db,
    cfg,
    "ep_held",
    "evergreen",
    new Date("2026-10-16T18:00:00Z"),
  );
  await tick(s);
  assert.equal(f.uploads, 0);
  // A "restart" is a fresh pass over the same database; the next Pacific day resets the quota.
  setClock(new Date("2026-10-17T08:00:00Z"));
  await tick(s);
  await tick(s);
  assert.equal(f.uploads, 0, "still held");
  assert.equal((await getEpisode(db, "ep_held"))!.status, "uploading");
  await setPublishHold(db, false);
  setClock(new Date("2026-10-17T09:00:00Z"));
  await tick(s);
  assert.equal(f.uploads, 1, "released once the hold is off");
});

test("delayed Shorts get fresh, spaced slots instead of past times; stale news goes back to the owner", async () => {
  const { db, s, f, cfg } = await setup({
    dryRun: false,
    breakingEnabled: false,
    minUploadGapMinutes: 60,
  });
  const now = new Date("2026-10-16T12:00:00Z");
  for (const k of [1, 2, 3])
    await delayedEpisode(
      db,
      cfg,
      `ep_late_${k}`,
      "evergreen",
      new Date(now.getTime() - k * 3600_000),
    );
  await delayedEpisode(
    db,
    cfg,
    "ep_old_news",
    "news",
    new Date(now.getTime() - 20 * 3600_000),
  );
  await tick(s);
  const slots = (
    await db.query<{ id: string; publish_at: string }>(
      `SELECT id, publish_at FROM episodes WHERE id LIKE 'ep_late_%' ORDER BY publish_at`,
    )
  ).map((r) => new Date(r.publish_at).getTime());
  assert.equal(new Set(slots).size, 3, "three distinct slots");
  for (const t of slots)
    assert.ok(t >= now.getTime() + 15 * 60_000, "every slot is in the future");
  for (let k = 1; k < slots.length; k++)
    assert.ok(
      slots[k]! - slots[k - 1]! >= cfg.minUploadGapMinutes * 60_000,
      "spaced by the upload gap",
    );
  const news = (await getEpisode(db, "ep_old_news"))!;
  assert.equal(news.status, "awaiting_approval");
  assert.ok(f.notifications.some((n) => /may be out of date/.test(n)));
});

test("the fact-checker sees every card figure, and rankings get a final adjudication that can stop a wrong figure", async () => {
  const { cardText } = await import("../src/editorial/editorial.ts");
  assert.equal(
    cardText({
      kind: "price",
      primary: "$59.99",
      secondary: "on Steam",
      was: "$69.99",
      region: "US",
      items: ["£49.99", "€59.99"],
    } as never),
    "[price] $59.99 on Steam (was $69.99, region US, rows: £49.99; €59.99)",
  );
  assert.equal(
    cardText({
      kind: "timeline",
      primary: "Delayed",
      secondary: "",
      date_from: "2026-03",
      date_to: "2026-11",
    } as never),
    "[timeline] Delayed (from 2026-03, to 2026-11)",
  );
  // A ranking whose fact-check keeps failing is stopped, never published.
  const { db, s, f } = await setup({
    dryRun: false,
    evergreenEnabled: true,
    approvalMode: "auto",
    breakingEnabled: false,
  });
  f.factChecks = [
    {
      verdict: "fail",
      issues: [
        {
          quote: "released in 2019",
          problem: "the facts say 2020",
          severity: "blocker",
        },
      ],
      rumour_labelling_ok: true,
      summary: "wrong year",
    },
    {
      verdict: "fail",
      issues: [
        {
          quote: "released in 2019",
          problem: "the facts say 2020",
          severity: "blocker",
        },
      ],
      rumour_labelling_ok: true,
      summary: "still wrong",
    },
  ];
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, factcheck_json, slot_at)
     VALUES ('ep_rank', 'rank', 'selected', $1, 'evergreen', $2, $3)`,
    [
      JSON.stringify({
        headline: "Ranked",
        items: [],
        sources: ["Steam"],
        hasOfficial: true,
        corroborated: true,
      }),
      JSON.stringify({
        topic: {
          theme: "Halo",
          format: "ranking",
          reason: "r",
          criterion: "c",
          title_idea: "Halo Ranked",
          candidate_index: 0,
        },
      }),
      new Date("2026-10-16T18:00:00Z"),
    ],
  );
  await tick(s);
  const ep = (await getEpisode(db, "ep_rank"))!;
  assert.notEqual(ep.status, "published");
  assert.match(String(ep.last_error ?? ""), /fact-check still failing/);
  assert.equal(f.uploads, 0);
});

test("the go-live check keeps looking for days, hourly after the first two, and records when it saw the video public", async () => {
  const { db, s, f, setClock } = await setup({ youtubePrivacy: "public" });
  const { confirmPublished } = await import("../src/pipeline.ts");
  const { logEvent } = await import("../src/episodes.ts");
  await db.query(
    `INSERT INTO episodes (id, story_hash, story_json, status, lane, script_json, youtube_video_id, publish_at, updated_at)
     VALUES ('ep_late', 'late', '{"headline":"x","items":[]}', 'published', 'news', $1, 'vid_late', '2026-10-16T07:00:00Z', now())`,
    [JSON.stringify(goodScript())],
  );
  // Still processing five hours on, looked at ten minutes ago: left alone this tick.
  f.privacy = "processing";
  await logEvent(db, "ep_late", "public_pending", { was: "processing" });
  // The fake clock reads 12:00 on 16 Oct; the check was ten minutes before that.
  await db.query(
    `UPDATE events SET created_at = '2026-10-16T11:50:00Z' WHERE episode_id = 'ep_late'`,
  );
  await confirmPublished(s);
  const pend = await db.query(
    `SELECT 1 FROM events WHERE episode_id = 'ep_late' AND kind = 'public_pending'`,
  );
  assert.equal(pend.length, 1, "not re-checked within the hour");
  // An hour later it is checked again and found public: the time is recorded, and the first comment goes up.
  await db.query(
    `UPDATE events SET created_at = '2026-10-16T15:50:00Z' WHERE episode_id = 'ep_late'`,
  );
  f.privacy = "public";
  setClock(new Date("2026-10-16T17:00:00Z"));
  await confirmPublished(s);
  const [done] = await db.query<{ detail: { at?: string } }>(
    `SELECT detail FROM events WHERE episode_id = 'ep_late' AND kind = 'public_confirmed'`,
  );
  assert.equal(done?.detail?.at, "2026-10-16T17:00:00.000Z");
  assert.equal(
    f.comments.length,
    1,
    "the first comment waited for the video to be public",
  );
  await db.close();
});

test("the twin channel: a published Short gets a translated twin, voiced by ElevenLabs, uploaded in its language to the second login", async () => {
  const { db, f, s, setClock } = await setup({
    youtubePrivacy: "public",
    twinLanguage: "es",
    twinChannelId: "UCtwin",
    twinDelayMinutes: 30,
  });
  const accounts: string[] = [];
  const baseYoutube = s.youtube;
  s.youtube = (account = "") => {
    accounts.push(account);
    return baseYoutube();
  };
  const voiced: Array<{ text: string; provider?: string }> = [];
  const baseSynth = s.synthesise;
  s.synthesise = async (text, out, voice, opts) => {
    voiced.push({ text, provider: opts?.provider });
    return baseSynth(text, out, voice);
  };
  await tick(s);
  const parent = await only(db);
  assert.equal(parent.status, "published");
  // Fifteen minutes after the original is live, its twin is made.
  setClock(new Date("2026-10-16T12:30:00Z"));
  await db.query(
    `UPDATE episodes SET publish_at = '2026-10-16T12:05:00Z' WHERE id = $1`,
    [parent.id],
  );
  for (let i = 0; i < 4; i++) await tick(s);
  const twin = (await listEpisodes(db)).find((e) => e.lane === "twin");
  assert.ok(twin, "a twin episode exists");
  assert.equal(twin!.story_json.twin?.parent, parent.id);
  assert.equal(twin!.status, "published", twin!.last_error ?? "");
  assert.equal(
    twin!.approval_mode,
    "auto",
    "no second tap for a Short the owner already approved",
  );
  assert.match(twin!.script_json!.hook, /^La segunda expansión/);
  assert.equal(twin!.script_json!.twin?.parent_video, parent.youtube_video_id);
  assert.ok(
    voiced.some((v) => v.provider === "elevenlabs" && /expansión/.test(v.text)),
    "the twin is voiced by ElevenLabs from the Spanish text as written",
  );
  assert.ok(
    voiced.every(
      (v) => !/expansión/.test(v.text) || !/sesenta|veinte/.test(v.text),
    ),
    "no English number words in the Spanish narration",
  );
  assert.ok(accounts.includes("es"), "the twin uploads with the second login");
  assert.equal(f.uploads, 2);
  const up = f.resources.at(-1)!;
  assert.equal(up.snippet.defaultLanguage, "es");
  assert.match(up.snippet.title, /Starfield retrasa/);
  assert.match(up.snippet.description, /Versión en español/);
  // The twin does not count as one of the day's Shorts, and nothing is twinned twice.
  assert.equal(await countToday(db, "Europe/London"), 1);
  await tick(s);
  assert.equal(
    (await listEpisodes(db)).filter((e) => e.lane === "twin").length,
    1,
  );
  await db.close();
});

test("the desk experiment: a second voice asks the viewer's question before the take, stitched into one narration and captioned by name", async () => {
  const { db, f, s } = await setup({
    deskVoiceId: "voice_alice",
    deskVoiceName: "Alice",
    deskShare: 1,
  });
  await tick(s);
  const ep = await only(db);
  assert.equal(ep.status, "published");
  assert.deepEqual(
    f.voices,
    ["Liam", "Alice", "Liam"],
    "narrator, the desk partner's question, narrator",
  );
  const a = ep.assets_json!;
  assert.equal(a.desk?.voice.name, "Alice");
  assert.equal(a.desk?.question, "So is early 2027 a sign of trouble?");
  const text = a.words!.map((w) => w.text).join(" ");
  assert.match(
    text,
    /sign of trouble\? For us,/,
    "the question sits between the facts and the take",
  );
  for (let i = 1; i < a.words!.length; i++)
    assert.ok(a.words![i]!.start >= a.words![i - 1]!.start, "one timeline");
  const { segmentInputs } = await import("../src/pipeline.ts");
  const { buildSegments } = await import("../src/render/timeline.ts");
  const segs = buildSegments(
    segmentInputs(ep.script_json!, true),
    a.words!,
    a.durationSeconds!,
  );
  assert.deepEqual(
    segs.map((x) => x.kind),
    ["hook", "beat", "beat", "desk", "take", "loop"],
  );
  assert.match(
    await fs.readFile(
      path.join(episodeDirOf(s, ep.id), "captions.srt"),
      "utf8",
    ),
    /sign of trouble/,
  );
  await db.close();
});

test("outside the experiment's share, or with the desk off, a Short is voiced in one take", async () => {
  const { db, f, s } = await setup({
    deskVoiceId: "voice_alice",
    deskShare: 0,
  });
  await tick(s);
  const ep = await only(db);
  assert.equal(f.voices.length, 1);
  assert.equal(ep.assets_json!.desk, undefined);
  await db.close();
});

function episodeDirOf(s: Services, id: string): string {
  return path.join(s.cfg.dataDir, "episodes", id);
}

test("the narrator test: the test voice narrates its share of news Shorts, and Liam asks the desk question when Alice narrates", async () => {
  const { narratorFor } = await import("../src/pipeline.ts");
  const cfg = testConfig("x", {
    narratorTestVoiceId: "voice_alice",
    narratorTestVoiceName: "Alice",
    narratorTestShare: 0.5,
  });
  const ids = Array.from(
    { length: 200 },
    (_, i) => `ep_2026_${i.toString(16).padStart(6, "0")}`,
  );
  const alice = ids.filter((id) =>
    narratorFor(cfg, { id, lane: "news" }),
  ).length;
  assert.ok(alice > 70 && alice < 130, `about half: ${alice}`);
  assert.equal(
    narratorFor(cfg, { id: ids[0]!, lane: "evergreen" }),
    undefined,
    "rankings keep the usual narrator",
  );
  assert.equal(
    narratorFor(testConfig("x"), { id: ids[0]!, lane: "news" }),
    undefined,
    "off by default",
  );
  // In a Short Alice narrates with the desk on, the question is asked by the usual narrator, never by herself.
  const aliceId = ids.find((id) => narratorFor(cfg, { id, lane: "news" }))!;
  const { db, f, s } = await setup({
    narratorTestVoiceId: "voice_alice",
    narratorTestVoiceName: "Alice",
    narratorTestShare: 0.5,
    deskVoiceId: "voice_alice",
    deskVoiceName: "Alice",
    deskShare: 1,
    elevenLabsVoiceId: "voice_liam",
    narratorName: "Liam",
  });
  const { shortId } = await import("../src/lib/util.ts");
  void shortId;
  await db.query(
    `INSERT INTO episodes (id, story_hash, story_json, status, lane, script_json) VALUES ($1, $1, '{"headline":"x","items":[],"sources":[],"corroborated":true}', 'scripted', 'news', $2)`,
    [aliceId, JSON.stringify(goodScript())],
  );
  const ep = (await getEpisode(db, aliceId))!;
  const { advance } = await import("../src/pipeline.ts");
  await advance(s, ep);
  assert.deepEqual(f.voices, ["Alice", "Liam", "Alice"]);
  await db.close();
});

/** A ranking video already selected, its writer next. */
async function longEpisode(db: Db, id: string) {
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, priority, factcheck_json)
     VALUES ($1, $2, 'selected', $3, 'longform', 40, $4)`,
    [
      id,
      `long:${id}`,
      JSON.stringify({ hash: `long:${id}`, headline: `Long ${id}`, items: [] }),
      JSON.stringify({
        topic: {
          theme: "Open worlds",
          title_idea: "The best open worlds",
          criterion: "By how much there is to find",
        },
      }),
    ],
  );
}

/** The long-form writer, busy until the test lets it go (then it fails, as the fake knows no such script). */
function slowLongWriter(s: Services) {
  const base = s.llm;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let started!: () => void;
  const writing = new Promise<void>((r) => (started = r));
  const w = { calls: 0, active: 0, most: 0, release, writing };
  s.llm = {
    structured: (async (opts: Parameters<Llm["structured"]>[0]) => {
      if (opts.schema !== LongformPlanSchema) return base.structured(opts);
      w.calls++;
      w.most = Math.max(w.most, ++w.active);
      started();
      try {
        await gate;
      } finally {
        w.active--;
      }
      throw new Error("the long-form writer stopped");
    }) as Llm["structured"],
  };
  return w;
}

test("a long video hours into its work never holds back a due Short", async () => {
  // 28 Oct 2026: a documentary remake held the tick from 15:31 and the 17:00 and 18:30 Shorts were missed.
  // (The long video counts towards the day's videos, so the target leaves room for the Short.)
  const { s, db, f } = await setup({ dailyTarget: 2 });
  await longEpisode(db, "long1");
  const writer = slowLongWriter(s);
  const long = tickLong(s);
  await writer.writing;
  // The news slot is due: the Short is written, voiced, rendered and uploaded while the long video is still busy.
  const r = await tick(s);
  assert.equal(r.ran, true);
  const short = (await listEpisodes(db)).find((e) => e.lane === "news");
  assert.equal(short?.status, "published");
  assert.equal(f.uploads, 1);
  // The Shorts tick left the long video to its own lane.
  assert.equal(writer.calls, 1);
  assert.equal((await getEpisode(db, "long1"))?.status, "selected");
  writer.release();
  assert.deepEqual(await long, { ran: true, episodes: ["long1"] });
  await db.close();
});

test("only one long video is worked on at a time", async () => {
  const { s, db } = await setup({ newsSlots: [] });
  await longEpisode(db, "long1");
  await longEpisode(db, "long2");
  const writer = slowLongWriter(s);
  const first = tickLong(s);
  const second = tickLong(s);
  await writer.writing;
  // The lane is held: a second run finds the lease taken and does nothing.
  assert.deepEqual(await second, { ran: false });
  assert.equal((await tick(s)).ran, true);
  assert.equal(writer.calls, 1);
  writer.release();
  await first;
  // Both were worked on, one after the other, never together.
  assert.equal(writer.calls, 2);
  assert.equal(writer.most, 1);
  const rows = await db.query<{ attempts: number }>(
    `SELECT attempts FROM episodes WHERE lane = 'longform' ORDER BY id`,
  );
  assert.deepEqual(
    rows.map((r) => r.attempts),
    [1, 1],
  );
  await db.close();
});
