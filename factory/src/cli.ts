// Operator commands. Everything here also works inside the Railway shell.
//   migrate            apply database migrations
//   tick               run one pipeline tick and exit
//   discover           print today's ranked story clusters (no writes)
//   episodes           list recent episodes
//   retry <id>         move a failed episode back to the step it failed at
//   doctor             check the key, YouTube login and scopes, voice server, ffmpeg, disk, tunnel, webhook
//   tiktok-login       sign in to TikTok once in the factory's own Chrome profile

import { loadConfig, redactedConfig } from "./config.ts";
import { openDb, migrate } from "./db.ts";
import { createServices } from "./services.ts";
import { tick, tickLong } from "./pipeline.ts";
import { listEpisodes, getEpisode } from "./episodes.ts";
import { FEEDS } from "./discovery/feeds.ts";
import { fetchFeeds } from "./discovery/rss.ts";
import { clusterItems } from "./discovery/cluster.ts";
import { runDoctor, formatDoctor } from "./doctor.ts";
import { storedRefreshToken } from "./youtube/oauth.ts";
import { oauthConfig } from "./services.ts";

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  const cfg = loadConfig();

  if (cmd === "discover") {
    const clusters = clusterItems(await fetchFeeds(FEEDS), new Date(), cfg.maxStoryAgeHours);
    for (const c of clusters.slice(0, 25)) {
      console.log(`${String(c.score).padStart(4)} ${c.corroborated ? "✓" : " "} ${c.hasOfficial ? "OFF" : "   "} ${c.headline}  [${c.sources.join(", ")}]`);
    }
    return;
  }

  if (cmd === "tiktok-login") {
    // One-time: sign in to TikTok in the factory's own Chrome profile (a QR code from the TikTok app works).
    const { tiktokLogin } = await import("./social/tiktokBrowser.ts");
    console.log("A Chrome window is opening on TikTok's sign-in page. Sign in to the Pulse Gaming TikTok account; this window closes by itself.");
    const ok = await tiktokLogin(cfg.dataDir);
    console.log(ok ? "Signed in. Every Short now posts to TikTok publicly by itself." : "Not signed in within ten minutes. Run this again when ready.");
    return;
  }

  const db = await openDb(cfg.databaseUrl, cfg.dataDir);
  try {
    if (cmd === "doctor") {
      const checks = await runDoctor(cfg, await storedRefreshToken(db, oauthConfig(cfg)));
      console.log(formatDoctor(checks));
      if (checks.some((k) => !k.ok && k.critical)) process.exitCode = 2;
    } else if (cmd === "migrate") {
      console.log("applied:", await migrate(db));
    } else if (cmd === "tick") {
      await migrate(db);
      console.log(redactedConfig(cfg));
      const services = createServices(db, cfg);
      console.log(await tick(services), await tickLong(services));
    } else if (cmd === "episodes") {
      for (const e of await listEpisodes(db, 30)) {
        console.log(`${e.id}  ${e.status.padEnd(18)} ${e.script_json?.youtube.title ?? e.story_json.headline}${e.last_error ? `\n    ! ${e.last_error.slice(0, 160)}` : ""}`);
      }
    } else if (cmd === "retry" && arg) {
      const ep = await getEpisode(db, arg);
      if (!ep || ep.status !== "failed") throw new Error("episode not found or not failed");
      // Resume from the furthest completed artefact; the upload step re-checks
      // the channel for an existing copy before uploading again.
      const resume = ep.youtube_video_id ? "uploaded" : ep.upload_session_uri || ep.approved_by ? "uploading" : ep.qa_json && ep.assets_json?.video ? "rendered" : ep.assets_json?.audio ? "voiced" : ep.script_json ? "scripted" : "selected";
      // attempts = 1 on an upload resume forces the channel search first.
      await db.query(`UPDATE episodes SET status = $2, attempts = $3, next_attempt_at = NULL, updated_at = now() WHERE id = $1`, [arg, resume, resume === "uploading" ? 1 : 0]);
      console.log(`${arg} -> ${resume}`);
    } else {
      console.log("usage: cli.ts migrate | tick | discover | episodes | retry <id> | doctor");
      process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
