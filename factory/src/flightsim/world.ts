// The world outside the factory, recorded and stubbed for the flight simulator (src/flightsim): the news feeds, the
// writers (a fake model answering every schema), the voice, the renderer, YouTube at the HTTP level (so the real
// client and its error handling run), the vision relay and Discord. Each answers as the real one does, including
// when a fault is switched on, and everything it sees is written down for the invariants.

import fs from "node:fs/promises";
import type { z } from "zod";
import type { Services } from "../pipeline.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { Llm } from "../editorial/llm.ts";
import {
  SelectionSchema,
  ScriptSchema,
  FactCheckSchema,
  VisionQaSchema,
  type Script,
} from "../editorial/schema.ts";
import {
  EvergreenScriptSchema,
  EvergreenTopicSchema,
  type EvergreenScript,
} from "../editorial/evergreen.ts";
import { WhyTopicSchema } from "../editorial/why.ts";
import { clusterItems } from "../discovery/cluster.ts";
import type { FeedItem } from "../discovery/rss.ts";
import { YouTubeClient, type FetchLike } from "../youtube/upload.ts";
import { FatalError } from "../lib/util.ts";
import { providerOrder } from "../voice/index.ts";
import type { SimClock } from "./clock.ts";
import { activeAt, type FaultWindow } from "./faults.ts";
import { minimalOf } from "./zodfill.ts";

/** Thrown into nothing: a step that meets it never finishes, as when the process dies under it. */
export class SimCrash extends Error {}

export interface Notice {
  at: string;
  text: string;
  ping: boolean;
  faults: string[];
}

export interface ChannelVideo {
  id: string;
  marker: string;
  title: string;
  description: string;
  publishAt?: string;
  uploadedAt: string;
  privacy: string;
}

export interface WorldLog {
  notices: Notice[];
  videos: ChannelVideo[];
  /** Outbound requests the stubs do not know: the factory reaching for the real network. */
  strayHosts: Record<string, number>;
  llmCalls: number;
  unknownSchemas: Record<string, number>;
  codexFallbacks: number;
  voices: Record<string, number>;
  renders: number;
  crashes: Array<{ at: string; where: string }>;
}

const GAMES = [
  "Starfield",
  "Halo Infinite",
  "Elden Ring",
  "Cyberpunk 2077",
  "Baldur's Gate 3",
  "Hollow Knight Silksong",
  "Resident Evil 9",
  "The Witcher 4",
  "Fable",
  "Mass Effect",
  "Hades 2",
  "Metroid Prime 4",
  "Death Stranding 2",
  "Marvel's Wolverine",
  "Ghost of Yotei",
  "Monster Hunter Wilds",
  "Doom The Dark Ages",
  "Borderlands 4",
  "Grand Theft Auto VI",
  "Horizon Forbidden West",
];
// Franchises the Why and evergreen editors choose from: more than six weeks of three a day, so the freshness rule
// never runs out of games in a run.
const FRANCHISES = [
  "Grand Theft Auto: San Andreas", "Half-Life 2", "Portal 2", "BioShock", "Mass Effect 2", "The Elder Scrolls V: Skyrim",
  "Fallout: New Vegas", "Red Dead Redemption 2", "The Last of Us", "Uncharted 2", "Metal Gear Solid 3", "Silent Hill 2",
  "Resident Evil 4", "Super Mario 64", "The Legend of Zelda: Ocarina of Time", "Halo 3", "Gears of War", "Fable II",
  "StarCraft", "Diablo II", "World of Warcraft", "Minecraft", "Dark Souls", "Bloodborne", "Sekiro", "Hollow Knight",
  "Celeste", "Stardew Valley", "Terraria", "Doom", "Quake", "Deus Ex", "System Shock 2", "Thief", "Max Payne", "Mafia",
  "Saints Row 2", "Burnout 3", "Need for Speed: Most Wanted", "Tony Hawk's Pro Skater 2", "Crash Bandicoot",
  "Spyro the Dragon", "Jak and Daxter", "Ratchet & Clank", "Sly Cooper", "God of War", "Shadow of the Colossus", "Ico",
  "Okami", "Kingdom Hearts", "Final Fantasy VII", "Chrono Trigger", "Persona 5", "Metroid Prime", "Star Fox 64",
  "GoldenEye 007", "Perfect Dark", "Banjo-Kazooie", "Conker's Bad Fur Day",
];
const EVENTS = [
  "delayed to early 2027",
  "gets a release date",
  "patch adds new mode",
  "sales pass ten million",
  "studio confirms sequel",
  "free weekend announced",
  "new trailer revealed",
  "price cut announced",
];

export interface WorldOptions {
  clock: SimClock;
  faults: FaultWindow[];
  cfg: Config;
  /** Seeded so a run repeats exactly. */
  seed: number;
}

/** A small repeatable random source (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function feedItem(
  title: string,
  source: string,
  kind: FeedItem["sourceKind"],
  minutesAgo: number,
  now: Date,
): FeedItem {
  return {
    title,
    url: `https://${source.toLowerCase().replace(/\W+/g, "")}.example/${encodeURIComponent(title.toLowerCase().replace(/\W+/g, "-"))}`,
    summary: `${title}. More detail here.`,
    publishedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    source,
    sourceKind: kind,
  };
}

function rankingDraft(theme: string): EvergreenScript {
  const names = [
    `${theme} 5`,
    `${theme} 4`,
    `${theme} Reach`,
    `${theme} 2`,
    `${theme} 3`,
  ];
  return {
    format: "ranking",
    theme,
    title: `Ranking Every ${theme}`,
    hook: `Every mainline ${theme} ranked by one thing only, how good the campaign still is today.`,
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
    loop_line: `And that is every ${theme} ranked by how good the campaign still is.`,
    youtube: {
      title: `Ranking EVERY ${theme} game`,
      description: `Every mainline ${theme} ranked by campaign.`,
      tags: [theme],
    },
    claims: [
      { claim: `${theme} 3 released in 2007`, source: "public knowledge" },
    ],
  } as EvergreenScript;
}

export function newsScript(
  game: string,
  n: number,
  extra?: string,
  spoiler?: boolean,
): Script {
  const beat0 = `Bethesda confirmed the move on Xbox Wire this morning and says the extra time will go on polish and performance across every platform.`;
  return {
    story_type: "delay",
    game_title: game,
    steam_search_term: game,
    headline: `${game} Update Number ${n}`,
    hook: `${game} just moved, and here is what changes for you.`,
    beats: [
      {
        narration: extra ? `${beat0} ${extra}` : beat0,
        visual: {
          kind: "date",
          primary: "Early 2027",
          secondary: "new window",
        },
      },
      {
        narration: spoiler
          ? `And yes, the true ending of ${game} is the part everyone will be talking about, so watch for it.`
          : `It was previously due this December, so that's a slip of at least three months if you were waiting on it.`,
        visual: {
          kind: "stat",
          primary: "3+ months",
          secondary: "later than planned",
        },
      },
    ],
    pulse_take: {
      label: "WHAT IT MEANS",
      narration:
        "For us, big content that slips usually lands in better shape, so this isn't a red flag yet.",
      on_screen: "Not a red flag yet",
    },
    loop_line: `So if you're waiting, mark early 2027 for ${game}.`,
    desk_question: "So is early 2027 a sign of trouble?",
    is_rumour: false,
    attribution: "Source: Xbox Wire / IGN",
    youtube: {
      title: `${game} Update ${n}: Early 2027`,
      description: `The latest on ${game}. Sources: Xbox Wire and IGN.`,
      tags: [game.toLowerCase()],
    },
    claims: [
      {
        claim: "Delayed to early 2027",
        source_url: "https://xboxwire.example/x",
      },
    ],
  } as Script;
}

// The words the real failures used (Mac alert ledger, 6 and 14 Nov 2026).
export const FACTCHECK_14NOV =
  'Fact-check: "GameSpot\'s review called the gameplay very repetitive." - The supplied GameSpot article concerns a distribution dispute, not a review. The review attribution and exact quotation are unsupported.';
export const REFUSAL_6NOV =
  "I cannot verify this from what I was given; the publisher refused to confirm the cause.";
export const FORBIDDEN_WEST_NOTE =
  "I cannot verify the Horizon Forbidden West sales figure from the supplied text.";

export interface World {
  services(db: Db): Services;
  log: WorldLog;
  /** Set by the scheduler: a crash fault fired, and the step under it must never finish. */
  crashPending(): string | undefined;
  clearCrash(): void;
  /** Called by the scheduler before each pass so stories keep arriving. */
  faultsNow(): string[];
}

export function createWorld(o: WorldOptions): World {
  const { clock, cfg } = o;
  const rand = rng(o.seed);
  const log: WorldLog = {
    notices: [],
    videos: [],
    strayHosts: {},
    llmCalls: 0,
    unknownSchemas: {},
    codexFallbacks: 0,
    voices: {},
    renders: 0,
    crashes: [],
  };
  const on = (id: string) =>
    activeAt(o.faults, clock.now()).some((w) => w.id === id);
  const faultsNow = () => activeAt(o.faults, clock.now()).map((w) => w.id);
  // Each fault window fires its once-only effect (a crash, a lost answer) once.
  const fired = new Set<string>();
  const once = (id: string) => {
    const w = activeAt(o.faults, clock.now()).find((x) => x.id === id);
    if (!w) return false;
    const key = `${id}@${w.from.toISOString()}`;
    if (fired.has(key)) return false;
    fired.add(key);
    return true;
  };
  let crash: string | undefined;
  const hang = (where: string): Promise<never> => {
    crash = where;
    log.crashes.push({ at: clock.now().toISOString(), where });
    return new Promise<never>(() => undefined);
  };

  // ---------------------------------------------------------------- the news
  // Stories arrive through the day: each hour a few outlets cover one event, an official source most hours, a rumour
  // now and then; one story a day is fresh, official and big enough to break.
  const seenHours = new Map<number, FeedItem[]>();
  const discover = async () => {
    if (on("network"))
      throw new Error("fetch failed: read ECONNRESET (all feeds)");
    const now = clock.now();
    const hour = Math.floor(now.getTime() / 3_600_000);
    for (let h = hour - 6; h <= hour; h++) {
      if (seenHours.has(h)) continue;
      const r = rng(o.seed * 7919 + h);
      const game = GAMES[Math.floor(r() * GAMES.length)]!;
      const ev = EVENTS[Math.floor(r() * EVENTS.length)]!;
      const at = new Date(h * 3_600_000);
      const mins = Math.max(
        1,
        Math.round((now.getTime() - at.getTime()) / 60_000),
      );
      const items = [
        feedItem(`${game} ${ev}`, "Xbox Wire", "official", mins, now),
        feedItem(
          `${game} ${ev}, studio confirms`,
          "IGN",
          "outlet",
          mins + 5,
          now,
        ),
        feedItem(
          `${game} ${ev} according to the studio`,
          "Eurogamer",
          "outlet",
          mins + 9,
          now,
        ),
      ];
      if (r() < 0.25)
        items.push(
          feedItem(
            `Unconfirmed: insider claims ${game} reveal next week`,
            "Insider Gaming",
            "outlet",
            mins,
            now,
          ),
        );
      seenHours.set(h, items);
    }
    const items = [...seenHours.entries()]
      .filter(([h]) => h >= hour - 6)
      .flatMap(([, v]) => v);
    return clusterItems(items, now);
  };

  // ---------------------------------------------------------------- the writers
  let scripts = 0;
  let whys = 0;
  const llm: Llm = {
    async structured(opts) {
      log.llmCalls++;
      const { schema } = opts;
      const site = opts.site ?? "";
      // Codex answers its routed steps; while it times out each costs twenty minutes, then Claude answers.
      if (
        on("codex_timeout") &&
        cfg.codexCalls.some((c) => site.startsWith(c) || c === "factcheck")
      ) {
        clock.advance(cfg.codexTimeoutMinutes * 60_000);
        log.codexFallbacks++;
      }
      const content =
        typeof opts.content === "string"
          ? opts.content
          : JSON.stringify(opts.content).slice(0, 4000);
      if (schema === (SelectionSchema as unknown))
        return {
          candidate_index: 0,
          reason: "the biggest story",
          story_type: "delay",
          game_title: "x",
          visual_dependency: "none",
        } as never;
      if (schema === (ScriptSchema as unknown)) {
        scripts++;
        const named = GAMES.find((g) => content.includes(g));
        let game = named ?? GAMES[scripts % GAMES.length]!;
        let extra: string | undefined;
        let spoiler = false;
        if (on("writer_refusal")) extra = REFUSAL_6NOV;
        if (on("forbidden_west")) {
          game = "Horizon Forbidden West";
          extra = FORBIDDEN_WEST_NOTE;
        }
        if (on("spoiler")) {
          game = "Grand Theft Auto VI";
          spoiler = true;
        }
        return newsScript(game, scripts, extra, spoiler) as never;
      }
      if (schema === (FactCheckSchema as unknown))
        return (
          on("factcheck")
            ? {
                verdict: "fail",
                issues: [
                  {
                    quote:
                      "GameSpot's review called the gameplay very repetitive.",
                    problem:
                      "The review attribution and exact quotation are unsupported.",
                    severity: "blocker",
                  },
                ],
                rumour_labelling_ok: true,
                summary: FACTCHECK_14NOV,
              }
            : {
                verdict: "pass",
                issues: [],
                rumour_labelling_ok: true,
                summary: "All claims supported.",
              }
        ) as never;
      if (schema === (VisionQaSchema as unknown))
        return { verdict: "pass", problems: [], notes: "" } as never;
      if (schema === (WhyTopicSchema as unknown)) {
        const game = FRANCHISES[whys++ % FRANCHISES.length]!;
        return {
          candidate_index: 0,
          question: `Why did ${game} change everything?`,
          title: `Why ${game} Changed Everything`,
          game,
          wikipedia_title: game,
          arc: "Fans loved it; the studio moved on; it still sells.",
          angle: "The studio chose a new direction.",
          reason: "a loved game with a turn",
        } as never;
      }
      if (schema === (EvergreenTopicSchema as unknown)) {
        const theme = FRANCHISES[(whys++ * 7) % FRANCHISES.length]!;
        return { candidate_index: 0, format: "ranking", theme, title_idea: `Ranking every ${theme}`, criterion: "how well it holds up", reason: "strong demand" } as never;
      }
      if (schema === (EvergreenScriptSchema as unknown))
        return rankingDraft(
          ["Halo", "Fallout", "Resident Evil", "Zelda"][scripts++ % 4]!,
        ) as never;
      const filled = minimalOf(schema as z.ZodType);
      if (filled === undefined) {
        const key = site || "unnamed";
        log.unknownSchemas[key] = (log.unknownSchemas[key] ?? 0) + 1;
        throw new Error(
          `flight simulator: no fixture for this model call (${key})`,
        );
      }
      return filled as never;
    },
  } as Llm;

  // ---------------------------------------------------------------- YouTube, at the HTTP level
  const sessions = new Map<
    string,
    {
      resource: {
        snippet?: { title?: string; description?: string; tags?: string[] };
        status?: { publishAt?: string; privacyStatus?: string };
      };
      videoId?: string;
    }
  >();
  const youtubeFetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (
      body: unknown,
      status = 200,
      headers: Record<string, string> = {},
    ) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    if (
      u.pathname.startsWith("/upload/youtube/v3/videos") &&
      method === "POST"
    ) {
      if (once("bad_metadata"))
        return json(
          { error: { code: 400, message: "The request metadata specifies an invalid video title.", errors: [{ reason: "invalidTitle" }] } },
          400,
        );
      if (on("quota"))
        return json(
          {
            error: {
              code: 403,
              message:
                "The request cannot be completed because you have exceeded your quota.",
              errors: [{ reason: "quotaExceeded" }],
            },
          },
          403,
        );
      const id = `https://sim.upload/session/${sessions.size + 1}`;
      sessions.set(id, { resource: JSON.parse(String(init?.body ?? "{}")) });
      return new Response("", { status: 200, headers: { location: id } });
    }
    if (u.host === "sim.upload") {
      const sess = sessions.get(url);
      if (!sess) return new Response("", { status: 404 });
      const range =
        new Headers(init?.headers as HeadersInit).get("content-range") ?? "";
      if (range.startsWith("bytes */"))
        return sess.videoId
          ? json({ id: sess.videoId })
          : new Response("", { status: 308 });
      // The bytes arrive: the video exists on the channel from here on, whatever happens to the answer.
      const tags = sess.resource.snippet?.tags ?? [];
      const video: ChannelVideo = {
        id: `vid_${log.videos.length + 1}`,
        marker:
          tags.find((t) => /^pulse[-_:]/i.test(t)) ??
          tags[tags.length - 1] ??
          "",
        title: sess.resource.snippet?.title ?? "",
        description: sess.resource.snippet?.description ?? "",
        publishAt: sess.resource.status?.publishAt,
        uploadedAt: clock.now().toISOString(),
        privacy: sess.resource.status?.privacyStatus ?? "private",
      };
      log.videos.push(video);
      sess.videoId = video.id;
      (video as ChannelVideo & { tags?: string[] }).tags = tags;
      if (once("reboot_mid_upload"))
        return hang("upload (the Mac rebooted with the bytes sent)");
      if (once("duplicate_upload")) throw new Error("socket hang up");
      return json({ id: video.id });
    }
    if (u.pathname.endsWith("/channels"))
      return json({
        items: [
          {
            id: "UCsim",
            contentDetails: { relatedPlaylists: { uploads: "UUsim" } },
            statistics: { subscriberCount: "1000" },
          },
        ],
      });
    if (
      u.pathname.endsWith("/playlistItems") &&
      u.searchParams.get("playlistId") === "UUsim"
    )
      return json({
        items: log.videos
          .slice(-25)
          .reverse()
          .map((v) => ({ contentDetails: { videoId: v.id } })),
      });
    if (u.pathname.endsWith("/videos") && method === "GET") {
      const ids = (u.searchParams.get("id") ?? "").split(",");
      return json({
        items: log.videos
          .filter((v) => ids.includes(v.id))
          .map((v) => {
            const live = !v.publishAt || new Date(v.publishAt) <= clock.now();
            return {
              id: v.id,
              snippet: {
                title: v.title,
                description: v.description,
                tags: (v as ChannelVideo & { tags?: string[] }).tags ?? [],
                publishedAt: v.publishAt ?? v.uploadedAt,
              },
              status: {
                uploadStatus: "processed",
                privacyStatus: live ? "public" : "private",
                publishAt: v.publishAt,
              },
              processingDetails: { processingStatus: "succeeded" },
              statistics: {
                viewCount: "1200",
                likeCount: "40",
                commentCount: "3",
              },
              contentDetails: { duration: "PT45S" },
            };
          }),
      });
    }
    if (method === "GET") return json({ items: [] });
    return json({ id: `sim_${Math.floor(rand() * 1e9)}` });
  };
  const youtube = () =>
    new YouTubeClient(async () => {
      // The real refresh's words (src/youtube/oauth.ts) when Google says the login is gone.
      if (on("token_expired"))
        throw new FatalError(
          "YouTube refresh token is invalid (invalid_grant): reconnect via /oauth/start",
        );
      return "sim-token";
    }, youtubeFetch);

  // ---------------------------------------------------------------- the rest of the seam
  const services = (db: Db): Services => ({
    db,
    cfg,
    llm,
    discover,
    discoverEvergreen: async () => FRANCHISES.map((name) => ({ name, source: "franchise seed" })),
    fetchArticle: async (url) => ({
      url,
      title: "t",
      text: "The studio has confirmed the change in an official post this morning. ".repeat(
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
    synthesise: async (text, out, voice, opts) => {
      // The real order of narrators (src/voice/index.ts): ElevenLabs out of characters hands over to the local voice.
      let used: "local" | "elevenlabs" | undefined;
      const errors: string[] = [];
      for (const p of providerOrder(opts?.provider ?? "elevenlabs-first")) {
        if (p === "elevenlabs" && on("elevenlabs_credit")) {
          errors.push(
            "elevenlabs: ElevenLabs has 0 characters left this month",
          );
          continue;
        }
        used = p;
        break;
      }
      if (!used)
        throw new Error(`no narrator could voice this: ${errors.join("; ")}`);
      log.voices[used] = (log.voices[used] ?? 0) + 1;
      clock.advance(30_000);
      await fs.writeFile(out, "mp3");
      const words = text
        .split(/\s+/)
        .map((w, i) => ({ text: w, start: i * 0.33, end: i * 0.33 + 0.3 }));
      return {
        audioPath: out,
        words,
        durationSeconds: words.length * 0.33 + 0.2,
        voice: {
          provider: used,
          id: voice?.id ?? "v",
          name: voice?.name ?? "Liam",
        },
      };
    },
    findGame: async () => undefined,
    gameFacts: async () => ({ name: "", storeUrl: "", fetchedAt: "" }),
    fetchArt: async () => [],
    fetchClips: async () => [],
    releaseRadar: async () => [],
    freeGames: async () => ({ now: [], next: [] }),
    achievements: async () => [],
    research: async (title) => ({
      title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      text: `${title} is a video game. It was developed over several years and released to strong reviews. The studio later moved on to new projects, and the game still sells today. `.repeat(6),
    }),
    steamClimbers: async () => [],
    steamDeals: async () => [],
    trending: async () => [],
    ownClips: async () => [],
    searchPhotos: async () => [],
    igdbArt: async () => [],
    gameplayClips: async () => [],
    judgeFootage: async () => true,
    downloadPhoto: async () => false,
    fetchStock: async () => [],
    fetchOfficialMedia: async () => ({
      clips: [],
      stills: Array.from({ length: 3 }, (_, i) => ({
        kind: "hero" as const,
        file: `assets/official_${i}.jpg`,
        sourceUrl: "https://www.youtube.com/watch?v=x",
        provenance: "sim still",
      })),
    }),
    downloadImage: async () => false,
    imageAspect: async () => 16 / 9,
    render: async (input) => {
      if (on("disk_full"))
        throw new Error(
          `ENOSPC: no space left on device, write '${input.outFile}'`,
        );
      if (on("render_crash"))
        throw new Error(
          "Remotion: the browser crashed while rendering frame 412 (Target closed, SIGSEGV)",
        );
      if (once("restart_mid_step"))
        return hang("render (the factory restarted)");
      log.renders++;
      clock.advance(6 * 60_000);
      await fs.writeFile(input.outFile, "mp4");
      await fs.writeFile(input.posterFile, "jpg");
    },
    renderLong: async (input) => {
      if (on("disk_full"))
        throw new Error(
          `ENOSPC: no space left on device, write '${input.outFile}'`,
        );
      log.renders++;
      await fs.writeFile(input.outFile, "mp4");
      await fs.writeFile(input.posterFile, "jpg");
      await fs.writeFile(input.thumbFile, "jpg");
    },
    normalise: async (a, b) => fs.copyFile(a, b),
    publicReachable: async () => true,
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
    visionDown: async () => on("vision_down"),
    visionQa: async () => {
      // No paid stand-in while the relay is down (VISION_PAID_FALLBACK off): the check says it was skipped.
      if (on("vision_down"))
        throw new Error(
          "the PC vision relay is down (127.0.0.1:11434 refused) and VISION_PAID_FALLBACK is off",
        );
      return { verdict: "pass", problems: [], notes: "" };
    },
    youtube,
    youtubeConnected: async () => !on("token_expired"),
    notify: async (m) => {
      const text = m.content ?? String(m.embeds?.[0]?.title ?? "");
      log.notices.push({
        at: clock.now().toISOString(),
        text,
        ping: Boolean(m.ping),
        faults: faultsNow(),
      });
      return true;
    },
    now: () => clock.now(),
  });

  return {
    services,
    log,
    crashPending: () => crash,
    clearCrash: () => {
      crash = undefined;
    },
    faultsNow,
  };
}

/** The sim's stand-in for every outbound fetch the stubs do not cover: counted, and answered 503. */
export function strayFetch(log: WorldLog): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    let host = "unknown";
    try {
      host = new URL(url).host;
    } catch {
      /* not a URL */
    }
    log.strayHosts[host] = (log.strayHosts[host] ?? 0) + 1;
    return new Response("flight simulator: no network", { status: 503 });
  }) as typeof fetch;
}
