// Production wiring for the pipeline's service seam.

import fs from "node:fs/promises";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { Services } from "./pipeline.ts";
import { createClaude } from "./editorial/llm.ts";
import { FEEDS } from "./discovery/feeds.ts";
import { fetchFeeds } from "./discovery/rss.ts";
import { clusterItems } from "./discovery/cluster.ts";
import { fetchArticle } from "./discovery/article.ts";
import { narrate } from "./voice/index.ts";
import { fetchSteamArt, fetchSteamClips, findSteamApp, steamFacts } from "./assets/steam.ts";
import { renderShort } from "./render/render.ts";
import { extractFrames, imageAspect, normaliseLoudness, technicalQa } from "./qa/media.ts";
import { visionQa } from "./qa/vision.ts";
import { YouTubeClient } from "./youtube/upload.ts";
import { accessToken } from "./youtube/oauth.ts";
import { postDiscord } from "./approval/discord.ts";
import { fetchWithTimeout } from "./lib/util.ts";

export function oauthConfig(cfg: Config) {
  return {
    clientId: cfg.googleClientId,
    clientSecret: cfg.googleClientSecret,
    redirectUri: `${cfg.publicUrl}/oauth/callback`,
    appSecret: cfg.appSecret,
    envRefreshToken: cfg.youtubeRefreshToken,
  };
}

export function createServices(db: Db, cfg: Config): Services {
  const llm = createClaude(cfg.anthropicModel);
  return {
    db,
    cfg,
    llm,
    discover: async () => clusterItems(await fetchFeeds(FEEDS), new Date(), cfg.maxStoryAgeHours),
    fetchArticle,
    synthesise: (text, out) => narrate(cfg, text, out),
    findGame: findSteamApp,
    gameFacts: steamFacts,
    fetchArt: (app, dir) => fetchSteamArt(app, dir),
    fetchClips: (app, dir, n) => fetchSteamClips(app, dir, n),
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
    notify: (msg) => postDiscord(cfg.discordWebhookUrl, msg),
    now: () => new Date(),
  };
}
