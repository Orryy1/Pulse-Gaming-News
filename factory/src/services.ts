// Production wiring for the pipeline's service seam.

import { ReachClient } from "./reach.ts";
import { logEvent } from "./episodes.ts";
import fs from "node:fs/promises";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { Services } from "./pipeline.ts";
import { createClaude } from "./editorial/llm.ts";
import { codexRunnerPresent, createCodexLlm } from "./editorial/codex.ts";
import { FEEDS } from "./discovery/feeds.ts";
import { fetchFeeds } from "./discovery/rss.ts";
import { clusterItems } from "./discovery/cluster.ts";
import { fetchArticle } from "./discovery/article.ts";
import { selectClips } from "./assets/clipscore.ts";
import { evergreenCandidates } from "./discovery/evergreen.ts";
import { dayKey } from "./lanes.ts";
import { episodeIdOf, narrate } from "./voice/index.ts";
import {
  creditPlan,
  elevenLabsSubscription,
  type CreditPlan,
} from "./voice/credits.ts";
import { decodedSeconds, stitch, GAP_SECONDS } from "./voice/local.ts";
import type { Narration } from "./voice/elevenlabs.ts";
import { fetchSteamArt, findSteamApp, steamFacts } from "./assets/steam.ts";
import {
  renderShort,
  renderLong,
  renderLongStills,
  renderLongThumbs,
  renderShortThumb,
  countAsRender,
  renderCutdown,
  renderGameplayShort,
} from "./render/render.ts";
import {
  extractFrames,
  imageAspect,
  normaliseLoudness,
  technicalQa,
} from "./qa/media.ts";
import { visionQa } from "./qa/vision.ts";
import { checkNarration, transcribeWords } from "./qa/narration.ts";
import { YouTubeClient } from "./youtube/upload.ts";
import { accessToken, storedRefreshToken } from "./youtube/oauth.ts";
import { trailerFrames, officialMedia } from "./assets/officialTrailer.ts";
import {
  archiveLibrary,
  libraryStockClips,
  pexelsLibrary,
  pixabayLibrary,
  type StockLibrary,
} from "./assets/stock.ts";
import {
  searchLicensedPhotos,
  searchOpenverse,
  searchPixabayImages,
} from "./assets/libraries.ts";
import { searchPress } from "./assets/press.ts";
import { breaker } from "./lib/breaker.ts";
import { rankStills } from "./assets/stillscore.ts";
import path from "node:path";
import { fetchRockstarNewswire } from "./discovery/newsrooms.ts";
import { releaseRadar, freeGames } from "./discovery/weekly.ts";
import { fetchAchievements } from "./discovery/achievements.ts";
import { researchGame } from "./discovery/wikipedia.ts";
import { steamClimbers } from "./discovery/charts.ts";
import { steamDeals } from "./discovery/deals.ts";
import { libraryClips } from "./assets/library.ts";
import { trendingVideos } from "./discovery/demand.ts";
import { parseDemandRows } from "./discovery/searchdemand.ts";
import { runCapped } from "./lib/child.ts";
import { YTDLP_TEXT } from "./lib/bin.ts";
import { searchCommons, downloadCommons } from "./assets/commons.ts";
import { findIgdbGame, fetchIgdbArt } from "./assets/igdb.ts";
import { gameplayClips, judgeGameplay } from "./assets/gameplay.ts";
import { footageFirstDeps } from "./assets/footagedeps.ts";
import { macFootageDeps } from "./assets/footagemac.ts";
import { macOrLocal, macSettings, macTranscribeWords } from "./macworker.ts";
import {
  macRenderShort,
  macRenderThumbs,
} from "./render/macrender.ts";
import {
  QUOTA,
  QUOTA_RESERVE_FOR_UPLOAD,
  quotaAdd,
  quotaCall,
  quotaCalls,
  quotaUsed,
} from "./lanes.ts";
import { postDiscord } from "./approval/discord.ts";
import { startAlertLedger } from "./alertlog.ts";
import { fetchWithTimeout, log } from "./lib/util.ts";
import { fetchPublic } from "./lib/publicurl.ts";

export function oauthConfig(cfg: Config) {
  return {
    clientId: cfg.googleClientId,
    clientSecret: cfg.googleClientSecret,
    redirectUri: cfg.oauthRedirectUri || `${cfg.publicUrl}/oauth/callback`,
    appSecret: cfg.appSecret,
    envRefreshToken: cfg.youtubeRefreshToken,
  };
}

let creditCache: { at: number; plan: CreditPlan | undefined } | undefined;

// The outside picture libraries answer slowly or not at all some days (Openverse and the Internet Archive both
// timed out on 1 Nov 2026): after two failures in a row a library is skipped for ten minutes.
const openverseBreaker = breaker("openverse");
const pixabayBreaker = breaker("pixabay");
const archiveBreaker = breaker("internet archive");

/** The stock libraries a line's B-roll search asks, Pexels first (each behind its setting and key). */
export function stockLibraries(
  cfg: Pick<Config, "pexelsApiKey" | "libraryPixabay" | "pixabayApiKey" | "libraryArchive">,
): StockLibrary[] {
  const out: StockLibrary[] = [];
  if (cfg.pexelsApiKey) out.push(pexelsLibrary(cfg.pexelsApiKey));
  if (cfg.libraryPixabay && cfg.pixabayApiKey) {
    const p = pixabayLibrary(cfg.pixabayApiKey);
    out.push({ name: p.name, search: (q) => pixabayBreaker.call(() => p.search(q), []) });
  }
  if (cfg.libraryArchive) {
    const a = archiveLibrary();
    out.push({ name: a.name, search: (q) => archiveBreaker.call(() => a.search(q), []) });
  }
  return out;
}

export function createServices(db: Db, cfg: Config): Services {
  // The Mac mini's jobs (src/macworker.ts): each setting off means the old local path, untouched.
  const mac = macSettings(cfg);
  if (cfg.alertLedger)
    startAlertLedger(
      path.join(cfg.dataDir, "logs", "alerts.jsonl"),
      cfg.discordWebhookUrl,
    );
  const tellMac = (content: string) =>
    postDiscord(cfg.discordWebhookUrl, { content }).catch(() => undefined);
  const speechWords = (file: string) =>
    cfg.macAsr
      ? macOrLocal(
          "the speech timing",
          (f: string) => macTranscribeWords(mac, f),
          (f: string) =>
            cfg.whisperPython
              ? transcribeWords(f, cfg.whisperPython)
              : Promise.resolve([]),
          tellMac,
        )(file)
      : transcribeWords(file, cfg.whisperPython);
  const claude = createClaude({
    top: cfg.anthropicModel,
    mid: cfg.claudeModelMid,
    low: cfg.claudeModelLow,
  });
  // Codex answers the listed off-slot steps; anything else, and any Codex failure, is Claude as before.
  // Its helper lives in the PC orchestrator's folder: on a machine without it (the Mac mini) every routed
  // call would fail and then go to Claude, so routing is off there, said once, rather than failing each time.
  const codexWanted = cfg.codexLlm && cfg.codexCalls.length > 0;
  const codexHere = codexWanted && codexRunnerPresent(cfg.codexRunnerDir);
  if (codexWanted && !codexHere) {
    log("warn", "Codex routing off: codex_runner.py not on this machine", {
      dir: cfg.codexRunnerDir,
    });
    logEvent(db, null, "note", {
      text: `Codex is switched on (CODEX_LLM) but its helper codex_runner.py is not in ${cfg.codexRunnerDir} on this machine, so these steps use Claude: ${cfg.codexCalls.join(", ")}. Setting: CODEX_RUNNER_DIR.`,
    }).catch(() => undefined);
  }
  const llm = codexHere
      ? createCodexLlm(claude, {
          enabled: true,
          sites: cfg.codexCalls,
          vision: cfg.codexVision,
          timeoutMs: cfg.codexTimeoutMinutes * 60_000,
          python: cfg.codexPython,
          runnerDir: cfg.codexRunnerDir,
          tmpDir: path.join(cfg.dataDir, "tmp", "codex"),
          // Claude is out of allowance: say which normally-Claude steps went to Codex, once each, for checking.
          onLimitRouted: ((seen) => (site: string) => {
            if (seen.has(site)) return;
            seen.add(site);
            logEvent(db, null, "note", {
              text: `Claude hit its usage limit, so ${site} is being written by Codex for now. Worth checking those videos.`,
            }).catch(() => undefined);
          })(new Set<string>()),
        })
      : claude;
  if (llm !== claude)
    logEvent(db, null, "note", {
      text: `Codex (the ChatGPT plan) now answers these steps instead of Claude, with Claude as the fallback: ${cfg.codexCalls.join(", ")}${cfg.codexVision ? " (vision checks included)" : ""}.`,
    }).catch(() => undefined);
  return {
    db,
    cfg,
    llm,
    discover: async () => {
      const [rss, rockstar] = await Promise.all([
        fetchFeeds(FEEDS),
        fetchRockstarNewswire(
          process.env.ROCKSTAR_NEWSWIRE_LIST_HASH || undefined,
        ),
      ]);
      return clusterItems(
        [...rss, ...rockstar],
        new Date(),
        // After a day or two down, a big story is still in the feeds: keep it long enough to be made late.
        cfg.bigStoryMode === "off"
          ? cfg.maxStoryAgeHours
          : Math.max(cfg.maxStoryAgeHours, cfg.bigStoryMaxAgeHours),
      );
    },
    discoverEvergreen: () =>
      evergreenCandidates(dayKey(new Date(), cfg.timezone)),
    fetchArticle,
    synthesise: (text, out, voice, opts) =>
      narrate(
        {
          ...cfg,
          ...(opts?.provider ? { voiceProvider: opts.provider } : {}),
          // LONG_MIN_WPM: a test dial, passed for rankings only; it only ever raises the floor.
          ...(opts?.minWpm
            ? {
                minWordsPerMinute: Math.max(
                  cfg.minWordsPerMinute,
                  opts.minWpm,
                ),
              }
            : {}),
        },
        text,
        out,
        voice,
        // The long narrator's take check lands in the episode's log (data/episodes/<id>/voice.mp3).
        {
          onEvent: (kind, detail) => {
            const id = episodeIdOf(cfg.dataDir, out);
            return id
              ? logEvent(db, id, kind, detail).catch(() => undefined)
              : undefined;
          },
        },
      ),
    findGame: findSteamApp,
    gameFacts: steamFacts,
    fetchArt: (app, dir, maxScreens) => fetchSteamArt(app, dir, maxScreens),
    // Commons, then Openverse (Flickr and other archives) and Pixabay photos when switched on, interleaved; a slow
    // or failing library is left alone for ten minutes (src/lib/breaker.ts) so the gather never waits on it.
    searchPhotos: (q) =>
      searchLicensedPhotos(
        {
          commons: (x) => searchCommons(x),
          openverse: cfg.libraryOpenverse
            ? (x) => openverseBreaker.call(() => searchOpenverse(x), [])
            : undefined,
          pixabay:
            cfg.libraryPixabay && cfg.pixabayApiKey
              ? (x) => pixabayBreaker.call(() => searchPixabayImages(cfg.pixabayApiKey, x), [])
              : undefined,
        },
        q,
      ),
    searchPress: (game) => (cfg.libraryPress ? searchPress(game) : Promise.resolve([])),
    gameplayClips: async (
      game,
      franchise,
      year,
      dir,
      targets,
      maxClips,
      scope,
    ) => {
      if (!cfg.officialTrailers || !cfg.footage) return [];
      return gameplayClips({
        token: () => accessToken(db, oauthConfig(cfg)),
        llm: cfg.clipRanking === "llm" ? llm : undefined,
        ytdlp: cfg.ytdlpPath,
        game,
        franchise,
        year,
        episodeDir: dir,
        targets,
        maxClips,
        scope,
        quotaOk: async () => {
          const now = new Date();
          if ((await quotaCalls(db, now, "search")) >= cfg.searchCallsPerDay)
            return false;
          if (
            (await quotaUsed(db, now)) +
              QUOTA.search +
              QUOTA_RESERVE_FOR_UPLOAD >
            cfg.quotaUnitsPerDay
          )
            return false;
          await quotaCall(db, now, "search");
          await quotaAdd(db, now, QUOTA.search);
          return true;
        },
      });
    },
    judgeFootage: async (game, year, title, scope) => {
      if (cfg.clipRanking !== "llm") return true;
      const keep = await judgeGameplay(
        llm,
        game,
        year,
        [{ title, description: "", channelTitle: "" }],
        scope,
      ).catch(() => [0]);
      return keep.includes(0);
    },
    igdbArt: async (title, year, dir, max) => {
      const game = await findIgdbGame(
        { clientId: cfg.twitchClientId, secret: cfg.twitchClientSecret },
        title,
        year,
      ).catch(() => undefined);
      return game ? fetchIgdbArt(game, dir, max) : [];
    },
    downloadPhoto: (img, dest) => downloadCommons(img, dest),
    fetchClips: (app, dir, targets, maxClips, scope, fill) =>
      selectClips({
        app,
        episodeDir: dir,
        targets,
        maxClips,
        llm: cfg.clipRanking === "llm" ? llm : undefined,
        scope,
        fillSeconds: fill?.seconds,
        textCheck: fill?.textCheck,
      }),
    trailerFrames: (trailer, dir, gameTitle, count, textCheck) =>
      trailerFrames({ episodeDir: dir, gameTitle, ytdlp: cfg.ytdlpPath }, trailer, count, textCheck),
    releaseRadar: (from) => releaseRadar(from),
    freeGames: (now) => freeGames(now),
    achievements: (appId) => fetchAchievements(appId),
    steamClimbers: (now) => steamClimbers(now),
    steamDeals: (exclude) => steamDeals(exclude),
    footageFirstDeps: () => {
      const local = footageFirstDeps({
        ytdlp: cfg.ytdlpPath,
        // The title check is the existing low-tier judge, one call per chapter, only where clips are ranked by Claude.
        llm: cfg.clipRanking === "llm" ? llm : undefined,
      });
      return cfg.macFootageGather ? macFootageDeps(mac, local, tellMac) : local;
    },
    ownClips: (game, franchise, dir, targets, maxClips) =>
      cfg.footage && (cfg.footageLibrary || cfg.gameplayRoot)
        ? libraryClips({
            root: cfg.footageLibrary,
            inbox: cfg.gameplayRoot,
            game,
            franchise,
            episodeDir: dir,
            targets,
            maxClips,
            llm: cfg.clipRanking === "llm" ? llm : undefined,
          })
        : Promise.resolve([]),
    // The demand check's search page: yt-dlp reads YouTube's own results (no API quota), 20 videos at most.
    searchDemand: async (url) => {
      const { stdout } = await runCapped(
        cfg.ytdlpPath || "yt-dlp",
        [
          ...YTDLP_TEXT.args,
          "--no-warnings",
          "--flat-playlist",
          "--playlist-end",
          "20",
          "--print",
          "%(id)s\t%(view_count)s\t%(channel)s\t%(title)s",
          url,
        ],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: YTDLP_TEXT.env },
      );
      return parseDemandRows(stdout);
    },
    trending: () =>
      trendingVideos(
        () => accessToken(db, oauthConfig(cfg)),
        (units) => quotaAdd(db, new Date(), units),
      ),
    research: (title, fallbackQuery, maxChars, focus) =>
      researchGame(title, fallbackQuery, maxChars, undefined, focus),
    fetchStock: (dir, targets, gameWords, maxClips, avoidUrls) =>
      stockLibraries(cfg).length
        ? libraryStockClips(
            stockLibraries(cfg),
            dir,
            targets,
            gameWords,
            maxClips,
            async (t, previews) => {
              // The picture editor sees each result's preview beside the line and keeps one only when it fits.
              const r = await rankStills(
                llm,
                [{ key: "m0", show: t.keywords.join(", "), sentence: t.text }],
                previews.map((file) => ({ file })),
                path.join(dir, "stock", "pick"),
                undefined,
                "stock",
              );
              return r.picks[0]?.image;
            },
            avoidUrls,
          )
        : Promise.resolve([]),
    fetchOfficialMedia: async (
      gameTitle,
      dir,
      targets,
      maxClips,
      hint,
      story,
      fill,
    ) => {
      if (!cfg.officialTrailers) return { clips: [], stills: [] };
      return officialMedia({
        token: () => accessToken(db, oauthConfig(cfg)),
        gameTitle,
        episodeDir: dir,
        targets,
        maxClips,
        llm: cfg.clipRanking === "llm" ? llm : undefined,
        ytdlp: cfg.ytdlpPath,
        hint,
        story,
        fill,
        stillFrames: cfg.officialStillFrames,
        quotaOk: async () => {
          const now = new Date();
          if ((await quotaCalls(db, now, "search")) >= cfg.searchCallsPerDay)
            return false;
          if (
            (await quotaUsed(db, now)) +
              QUOTA.search +
              QUOTA_RESERVE_FOR_UPLOAD >
            cfg.quotaUnitsPerDay
          )
            return false;
          await quotaCall(db, now, "search");
          await quotaAdd(db, now, QUOTA.search);
          return true;
        },
      });
    },
    downloadImage: async (url, dest) => {
      // A picture link comes from an article or a feed: a private address is a bad link, not a failed step.
      const res = await fetchPublic(url, {}, 30_000).catch((err: unknown) => {
        if (String(err).includes("refused link")) return undefined;
        throw err;
      });
      if (
        !res ||
        !res.ok ||
        !(res.headers.get("content-type") ?? "").startsWith("image/")
      )
        return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8_000) return false;
      await fs.writeFile(dest, buf);
      return true;
    },
    imageAspect,
    render: cfg.macRenderShorts
      ? macOrLocal(
          "the Short render",
          (input) => countAsRender(() => macRenderShort(mac, input)),
          renderShort,
          tellMac,
        )
      : renderShort,
    renderLong: cfg.macStills
      ? (input) =>
          renderLong({
            ...input,
            thumbRenderer: macOrLocal(
              "the thumbnails",
              (t) => macRenderThumbs(mac, t),
              renderLongThumbs,
              tellMac,
            ),
          })
      : renderLong,
    reachClient: () => new ReachClient(() => accessToken(db, oauthConfig(cfg))),
    renderLongStills,
    renderShortThumb,
    renderCutdown,
    renderGameplayShort,
    normalise: normaliseLoudness,
    technicalQa,
    extractFrames,
    visionQa: (frames, ctx) => visionQa(llm, frames, ctx),
    stitchTakes: async (parts, outPath) => {
      const words: Narration["words"] = [];
      let offset = 0;
      for (const p of parts) {
        const seconds = await decodedSeconds(p.audioPath);
        for (const w of p.words)
          words.push({
            text: w.text,
            start: w.start + offset,
            end: w.end + offset,
          });
        offset += seconds + GAP_SECONDS;
      }
      await stitch(
        parts.map((p) => p.audioPath),
        outPath,
      );
      return {
        audioPath: outPath,
        words,
        durationSeconds: offset - GAP_SECONDS + 0.15,
      };
    },
    creditPlan: async () => {
      if (!cfg.elevenLabsApiKey) return undefined;
      const now = Date.now();
      if (creditCache && now - creditCache.at < 30 * 60_000)
        return creditCache.plan;
      const sub = await elevenLabsSubscription(cfg.elevenLabsApiKey);
      const plan = sub
        ? creditPlan(sub, cfg.elevenLabsMonthlyCredits, new Date(now))
        : undefined;
      creditCache = { at: now, plan };
      return plan;
    },
    hearClip: async (file) =>
      cfg.whisperPython || cfg.macAsr
        ? (await speechWords(file)).map((w) => ({
            text: w.text,
            start: w.start,
            end: w.end ?? w.start + 0.3,
          }))
        : [],
    checkNarration: async (file, words) =>
      cfg.whisperPython || cfg.macAsr
        ? checkNarration(words, await speechWords(file))
        : undefined,
    youtube: (account = "") =>
      new YouTubeClient(() => accessToken(db, oauthConfig(cfg), account)),
    youtubeConnected: async (account = "") =>
      Boolean(await storedRefreshToken(db, oauthConfig(cfg), account)),
    publicReachable: async () => {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(cfg.publicUrl))
        return true;
      try {
        const res = await fetchWithTimeout(
          `${cfg.publicUrl}/health`,
          {},
          8_000,
        );
        return res.ok;
      } catch {
        return false;
      }
    },
    // Background news waits for the evening summary; only what the owner should see now is sent.
    notify: async (msg) => {
      if (msg.level === "info") {
        await logEvent(db, null, "note", {
          text: (msg.content ?? String(msg.embeds?.[0]?.title ?? "")).slice(
            0,
            300,
          ),
        });
        return true;
      }
      return postDiscord(cfg.discordWebhookUrl, msg);
    },
    now: () => new Date(),
  };
}
