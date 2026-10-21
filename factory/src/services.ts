// Production wiring for the pipeline's service seam.

import { logEvent } from "./episodes.ts";
import fs from "node:fs/promises";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { Services } from "./pipeline.ts";
import { createClaude } from "./editorial/llm.ts";
import { FEEDS } from "./discovery/feeds.ts";
import { fetchFeeds } from "./discovery/rss.ts";
import { clusterItems } from "./discovery/cluster.ts";
import { fetchArticle } from "./discovery/article.ts";
import { selectClips } from "./assets/clipscore.ts";
import { evergreenCandidates } from "./discovery/evergreen.ts";
import { dayKey } from "./lanes.ts";
import { narrate } from "./voice/index.ts";
import { fetchSteamArt, findSteamApp, steamFacts } from "./assets/steam.ts";
import { renderShort, renderLong, renderCutdown } from "./render/render.ts";
import { extractFrames, imageAspect, normaliseLoudness, technicalQa } from "./qa/media.ts";
import { visionQa } from "./qa/vision.ts";
import { YouTubeClient } from "./youtube/upload.ts";
import { accessToken } from "./youtube/oauth.ts";
import { officialMedia } from "./assets/officialTrailer.ts";
import { stockClips } from "./assets/stock.ts";
import { fetchRockstarNewswire } from "./discovery/newsrooms.ts";
import { releaseRadar, freeGames } from "./discovery/weekly.ts";
import { fetchAchievements } from "./discovery/achievements.ts";
import { researchGame } from "./discovery/wikipedia.ts";
import { steamClimbers } from "./discovery/charts.ts";
import { steamDeals } from "./discovery/deals.ts";
import { libraryClips } from "./assets/library.ts";
import { trendingVideos } from "./discovery/demand.ts";
import { searchCommons, downloadCommons } from "./assets/commons.ts";
import { findIgdbGame, fetchIgdbArt } from "./assets/igdb.ts";
import { gameplayClips, judgeGameplay } from "./assets/gameplay.ts";
import { QUOTA, QUOTA_RESERVE_FOR_UPLOAD, quotaAdd, quotaUsed } from "./lanes.ts";
import { postDiscord } from "./approval/discord.ts";
import { fetchWithTimeout } from "./lib/util.ts";

export function oauthConfig(cfg: Config) {
  return {
    clientId: cfg.googleClientId,
    clientSecret: cfg.googleClientSecret,
    redirectUri: cfg.oauthRedirectUri || `${cfg.publicUrl}/oauth/callback`,
    appSecret: cfg.appSecret,
    envRefreshToken: cfg.youtubeRefreshToken,
  };
}

export function createServices(db: Db, cfg: Config): Services {
  const llm = createClaude({ top: cfg.anthropicModel, mid: cfg.claudeModelMid, low: cfg.claudeModelLow });
  return {
    db,
    cfg,
    llm,
    discover: async () => {
      const [rss, rockstar] = await Promise.all([fetchFeeds(FEEDS), fetchRockstarNewswire(process.env.ROCKSTAR_NEWSWIRE_LIST_HASH || undefined)]);
      return clusterItems([...rss, ...rockstar], new Date(), cfg.maxStoryAgeHours);
    },
    discoverEvergreen: () => evergreenCandidates(dayKey(new Date(), cfg.timezone)),
    fetchArticle,
    synthesise: (text, out, voice) => narrate(cfg, text, out, voice),
    findGame: findSteamApp,
    gameFacts: steamFacts,
    fetchArt: (app, dir, maxScreens) => fetchSteamArt(app, dir, maxScreens),
    searchPhotos: (q) => searchCommons(q),
            gameplayClips: async (game, franchise, year, dir, targets, maxClips, scope) => {
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
          if ((await quotaUsed(db, now)) + QUOTA.search + QUOTA_RESERVE_FOR_UPLOAD > cfg.quotaUnitsPerDay) return false;
          await quotaAdd(db, now, QUOTA.search);
          return true;
        },
      });
    },
        judgeFootage: async (game, year, title, scope) => {
      if (cfg.clipRanking !== "llm") return true;
      const keep = await judgeGameplay(llm, game, year, [{ title, description: "", channelTitle: "" }], scope).catch(() => [0]);
      return keep.includes(0);
    },
    igdbArt: async (title, year, dir, max) => {
      const game = await findIgdbGame({ clientId: cfg.twitchClientId, secret: cfg.twitchClientSecret }, title, year).catch(() => undefined);
      return game ? fetchIgdbArt(game, dir, max) : [];
    },
    downloadPhoto: (img, dest) => downloadCommons(img, dest),
        fetchClips: (app, dir, targets, maxClips, scope) => selectClips({ app, episodeDir: dir, targets, maxClips, llm: cfg.clipRanking === "llm" ? llm : undefined, scope }),
    releaseRadar: (from) => releaseRadar(from),
    freeGames: (now) => freeGames(now),
    achievements: (appId) => fetchAchievements(appId),
    steamClimbers: (now) => steamClimbers(now),
    steamDeals: (exclude) => steamDeals(exclude),
    ownClips: (game, franchise, dir, targets, maxClips) =>
      cfg.footage && cfg.footageLibrary
        ? libraryClips({ root: cfg.footageLibrary, game, franchise, episodeDir: dir, targets, maxClips, llm: cfg.clipRanking === "llm" ? llm : undefined })
        : Promise.resolve([]),
    trending: () => trendingVideos(() => accessToken(db, oauthConfig(cfg)), (units) => quotaAdd(db, new Date(), units)),
    research: (title, fallbackQuery, maxChars) => researchGame(title, fallbackQuery, maxChars),
    fetchStock: (dir, targets, gameWords, maxClips) => (cfg.pexelsApiKey ? stockClips(cfg.pexelsApiKey, dir, targets, gameWords, maxClips) : Promise.resolve([])),
    fetchOfficialMedia: async (gameTitle, dir, targets, maxClips, hint, story) => {
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
        quotaOk: async () => {
          const now = new Date();
          if ((await quotaUsed(db, now)) + QUOTA.search + QUOTA_RESERVE_FOR_UPLOAD > cfg.quotaUnitsPerDay) return false;
          await quotaAdd(db, now, QUOTA.search);
          return true;
        },
      });
    },
    downloadImage: async (url, dest) => {
      const res = await fetchWithTimeout(url, {}, 30_000);
      if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8_000) return false;
      await fs.writeFile(dest, buf);
      return true;
    },
    imageAspect,
        render: renderShort,
    renderLong,
    renderCutdown,
    normalise: normaliseLoudness,
    technicalQa,
    extractFrames,
    visionQa: (frames, ctx) => visionQa(llm, frames, ctx),
    youtube: () => new YouTubeClient(() => accessToken(db, oauthConfig(cfg))),
    publicReachable: async () => {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(cfg.publicUrl)) return true;
      try {
        const res = await fetchWithTimeout(`${cfg.publicUrl}/health`, {}, 8_000);
        return res.ok;
      } catch {
        return false;
      }
    },
    // Background news waits for the evening summary; only what the owner should see now is sent.
    notify: async (msg) => {
      if (msg.level === "info") {
        await logEvent(db, null, "note", { text: (msg.content ?? String(msg.embeds?.[0]?.title ?? "")).slice(0, 300) });
        return true;
      }
      return postDiscord(cfg.discordWebhookUrl, msg);
    },
    now: () => new Date(),
  };
}
