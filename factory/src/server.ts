// The whole service: an HTTP server for approvals, previews, OAuth and health,
// plus the in-process scheduler that ticks the pipeline.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig, redactedConfig, type Config } from "./config.ts";
import { runDoctor, formatDoctor } from "./doctor.ts";
import { storedRefreshToken } from "./youtube/oauth.ts";
import { openDb, migrate, withLease, type Db } from "./db.ts";
import { createServices, oauthConfig } from "./services.ts";
import {
  discoverTick,
  tick,
  episodeDir,
  clearSelectionPause,
  affiliateTags,
  approvalLinks,
  quotaHeadroom,
  type Services,
} from "./pipeline.ts";
import { QUOTA, quotaAdd } from "./lanes.ts";
import { productsFor, shopPageHtml } from "./editorial/affiliate.ts";
import {
  buildPosters,
  crosspostTick,
  isPublicOnYouTube,
} from "./social/crosspost.ts";
import { engageTick } from "./social/engage.ts";
import { renderEngage } from "./render/render.ts";
import {
  handleSite,
  startGameWarmer,
  startSiteIndexNow,
} from "./web/routes.ts";
import { replyToComments } from "./youtube/replies.ts";
import { collectRequests } from "./social/requests.ts";
import { setChannelBanner } from "./youtube/branding.ts";
import { getEpisode, listEpisodes, logEvent, transition } from "./episodes.ts";
import { verifyToken, signToken, safeEqual } from "./lib/crypto.ts";
import {
  consentUrl,
  exchangeCode,
  saveRefreshToken,
  clearTokenCache,
  channelOf,
  accessToken,
} from "./youtube/oauth.ts";
import { errorMessage, log } from "./lib/util.ts";
import { alert } from "./approval/discord.ts";
import { digestDue, markDigestSent, weeklyDigest } from "./analytics.ts";

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0b0e;color:#f5f5f2;padding:24px 16px}
main{max-width:640px;margin:0 auto}h1{font-size:22px}a{color:#ff6b1a}
button{font:inherit;font-weight:700;padding:14px 22px;border:0;border-radius:10px;cursor:pointer;margin:6px 8px 6px 0}
.ok{background:#22c55e;color:#06140a}.no{background:#ff3b3b;color:#1a0505}video{width:100%;max-width:360px;border-radius:12px;background:#000}
table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #222;padding:6px 4px;font-size:14px;vertical-align:top}
</style></head><body><main>${body}</main></body></html>`;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 10_000) break;
    chunks.push(c as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function streamFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  type: string,
): void {
  const stat = fs.statSync(file);
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, {
      "content-type": type,
      "content-range": `bytes ${start}-${end}/${stat.size}`,
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "content-type": type,
      "content-length": stat.size,
      "accept-ranges": "bytes",
    });
    fs.createReadStream(file).pipe(res);
  }
}

export function createApp(
  db: Db,
  cfg: Config,
  services: Services,
  state: { lastTick?: string; lastError?: string },
) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://local");
    const send = (code: number, html: string) =>
      res
        .writeHead(code, { "content-type": "text/html; charset=utf-8" })
        .end(html);
    const isAdmin = () =>
      Boolean(cfg.adminToken) &&
      safeEqual(url.searchParams.get("key") ?? "", cfg.adminToken);

    if (url.pathname === "/health") {
      const [counts] = await db.query<Record<string, string>>(
        `SELECT count(*) FILTER (WHERE status = 'published' AND updated_at > now() - interval '24 hours') AS published_24h,
                count(*) FILTER (WHERE status = 'published' AND lane = 'news_breaking' AND updated_at > now() - interval '24 hours') AS breaking_24h,
                count(*) FILTER (WHERE status NOT IN ('published','failed','rejected')) AS in_flight,
                count(*) FILTER (WHERE status IN ('selected','scripted','voiced','rendered')) AS producing,
                count(*) FILTER (WHERE status IN ('uploading') AND publish_at > now()) AS scheduled FROM episodes`,
      );
      const [sight] = await db.query<Record<string, string>>(
        `SELECT count(*) AS stories_seen_24h, max(last_seen) AS last_discovery FROM cluster_sightings WHERE last_seen > now() - interval '24 hours'`,
      );
      const [met] = await db.query<Record<string, string>>(
        `SELECT count(*) AS metrics_captured_7d FROM video_metrics WHERE captured_at > now() - interval '7 days'`,
      );
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            ok: true,
            ...counts,
            ...sight,
            ...met,
            lastTick: state.lastTick,
            lastError: state.lastError,
          }),
        );
      return;
    }

    // The public website (home, news, game hubs, videos, sitemaps).
    if (
      await handleSite(req, res, url, {
        db,
        cfg,
        tags: (id) => affiliateTags(cfg, id),
      })
    )
      return;

    const ep = url.pathname.match(
      /^\/episodes\/([\w-]+)\/(approve|reject|video\.mp4)$/,
    );
    if (ep) {
      const [, id, action] = ep as unknown as [string, string, string];
      const kind = action === "video.mp4" ? "preview" : action;
      const token = url.searchParams.get("t") ?? "";
      if (!verifyToken(`${kind}:${id}`, token, cfg.appSecret))
        return send(
          403,
          page("Link expired", "<h1>This link has expired or is invalid.</h1>"),
        );
      const episode = await getEpisode(db, id);
      if (!episode)
        return send(404, page("Not found", "<h1>Episode not found.</h1>"));

      if (kind === "preview") {
        const file = path.join(episodeDir(cfg, id), "short.mp4");
        if (!fs.existsSync(file))
          return send(404, page("Not found", "<h1>No video yet.</h1>"));
        return streamFile(req, res, file, "video/mp4");
      }
      // GET shows a confirmation page (link unfurlers must never trigger an action); POST acts.
      if (req.method !== "POST") {
        const preview = `/episodes/${id}/video.mp4?t=${signToken(`preview:${id}`, cfg.appSecret, 3600)}`;
        return send(
          200,
          page(
            "Review episode",
            `<h1>${esc(episode.script_json?.youtube.title ?? episode.story_json.headline)}</h1>
<p>Status: <b>${episode.status}</b></p><video src="${preview}" controls playsinline></video>
<form method="post"><input type="hidden" name="t" value="${esc(token)}">
<button class="${kind === "approve" ? "ok" : "no"}" type="submit">${kind === "approve" ? "Approve and publish" : "Reject this episode"}</button></form>`,
          ),
        );
      }
      const form = await readForm(req);
      if (!verifyToken(`${kind}:${id}`, form.get("t") ?? "", cfg.appSecret))
        return send(403, page("Link expired", "<h1>Invalid form token.</h1>"));
      const from = episode.status;
      const allowed =
        kind === "approve"
          ? ["awaiting_approval", "rendered"]
          : [
              "awaiting_approval",
              "rendered",
              "approved",
              "selected",
              "scripted",
              "voiced",
            ];
      if (!allowed.includes(from))
        return send(
          409,
          page(
            "Too late",
            `<h1>Episode is already <b>${from}</b>; nothing changed.</h1>`,
          ),
        );
      const ok = await transition(
        db,
        id,
        from,
        kind === "approve" ? "approved" : "rejected",
        { approved_by: kind === "approve" ? "human" : null },
      );
      await logEvent(db, id, kind === "approve" ? "approved" : "rejected", {
        by: "human",
      });
      if (ok && kind === "approve") void runTick(services, state); // publish without waiting for the next tick
      return send(
        200,
        page(
          "Done",
          `<h1>${ok ? (kind === "approve" ? "Approved. Publishing now." : "Rejected.") : "Nothing changed (state moved on)."}</h1>`,
        ),
      );
    }

    // Admin: set the YouTube channel banner from brand/final (the redesign).
    if (url.pathname === "/admin/youtube-banner" && req.method === "POST") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      try {
        const file = path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "brand",
          "final",
          "youtube-banner-2560x1440.png",
        );
        const token = await accessToken(db, oauthConfig(cfg));
        const done = await setChannelBanner(token, file);
        await logEvent(db, null, "youtube_banner", done);
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: true, ...done }));
      } catch (err) {
        res
          .writeHead(500, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: false, error: errorMessage(err) }));
      }
      return;
    }
    // Admin: published videos with their scripts, QA scores and captured numbers, for performance reviews.
    if (url.pathname === "/admin/export" && req.method === "GET") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const days = Math.min(
        120,
        Math.max(1, Number(url.searchParams.get("days") ?? 30)),
      );
      const rows = await db.query(
        `SELECT e.id, e.lane, e.youtube_video_id, coalesce(e.publish_at, e.updated_at) AS live_at, e.script_json,
                e.assets_json->'durationSeconds' AS duration, e.assets_json->'voice' AS voice, e.qa_json->'rubric' AS rubric,
                (SELECT json_agg(json_build_object('label', m.label, 'views', m.views, 'likes', m.likes, 'comments', m.comments, 'raw', m.raw))
                   FROM video_metrics m WHERE m.episode_id = e.id) AS metrics
           FROM episodes e
          WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND coalesce(e.publish_at, e.updated_at) > now() - make_interval(days => $1)
          ORDER BY live_at DESC`,
        [days],
      );
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(rows));
      return;
    }
    if (url.pathname === "/unpause" && req.method === "POST") {
      await clearSelectionPause(db);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: true, unpaused: true }));
      return;
    }
    // One click on this PC: no key needed when the request comes from the PC itself, not through the tunnel.
    const fromThisPc =
      /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
        req.headers.host ?? "",
      ) &&
      !req.headers["cf-connecting-ip"] &&
      !req.headers["cf-ray"];
    if (url.pathname === "/connect" || url.pathname === "/oauth/start") {
      if (!isAdmin() && !(url.pathname === "/connect" && fromThisPc))
        return send(
          403,
          page(
            "Forbidden",
            "<h1>Open http://localhost:8080/connect on the PC running the factory.</h1>",
          ),
        );
      if (!cfg.googleClientId)
        return send(
          500,
          page(
            "Missing client",
            "<h1>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.</h1>",
          ),
        );
      const nonce = crypto.randomBytes(12).toString("hex");
      const state = `${nonce}.${signToken(`oauth:${nonce}`, cfg.appSecret, 4 * 3600)}`;
      res
        .writeHead(302, { location: consentUrl(oauthConfig(cfg), state) })
        .end();
      return;
    }
    // Community post images: public so Facebook and Instagram can fetch them.
    const engageImg = url.pathname.match(
      /^\/engage\/(\d{4}-\d{2}-\d{2})\/(post_\d+\.jpg)$/,
    );
    if (engageImg && req.method === "GET") {
      const file = path.join(
        cfg.dataDir,
        "engage",
        engageImg[1]!,
        engageImg[2]!,
      );
      if (!fs.existsSync(file))
        return send(404, page("Not found", "<h1>Not found</h1>"));
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=86400",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    // Every photo and clip in a video, with its author, licence and source.
    const credits = url.pathname.match(/^\/credits\/([\w-]{4,64})$/);
    if (credits && req.method === "GET") {
      const ep = await getEpisode(db, credits[1]!);
      if (!ep?.assets_json)
        return send(
          404,
          page("Not found", "<h1>No credits for that video.</h1>"),
        );
      const rows = [
        ...(ep.assets_json.images ?? []),
        ...(ep.assets_json.clips ?? []),
      ]
        .map((m) => m.provenance)
        .filter((p, i, a): p is string => Boolean(p) && a.indexOf(p) === i)
        .map(
          (p) =>
            `<li>${esc(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="nofollow noopener">$1</a>')}</li>`,
        )
        .join("");
      return send(
        200,
        page(
          `Credits: ${esc(ep.script_json?.headline ?? ep.id)}`,
          `<h1>Credits: ${esc(ep.script_json?.headline ?? ep.id)}</h1><ul>${rows}</ul><p><a href="/news">Pulse Gaming News</a></p>`,
        ),
      );
    }
    // A video's shop page: public, read-only, each product in the viewer's own Amazon store.
    const shop = url.pathname.match(/^\/shop\/([\w-]{4,64})$/);
    if (shop && req.method === "GET") {
      const ep = await getEpisode(db, shop[1]!);
      if (!ep?.script_json)
        return send(404, page("Not found", "<h1>No shop for that video.</h1>"));
      const products = productsFor(ep.script_json, ep.lane === "free");
      const country = String(req.headers["cf-ipcountry"] ?? "");
      await logEvent(db, ep.id, "shop_view", { country }).catch(
        () => undefined,
      );
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, max-age=300",
      });
      res.end(
        page(
          `Shop: ${esc(ep.script_json.headline)}`,
          shopPageHtml({
            title: ep.script_json.headline,
            products,
            tags: affiliateTags(cfg, ep.id),
            country,
          }),
        ),
      );
      return;
    }
    if (url.pathname === "/oauth/callback") {
      const [nonce, ...rest] = (url.searchParams.get("state") ?? "").split(".");
      if (
        !nonce ||
        !verifyToken(`oauth:${nonce}`, rest.join("."), cfg.appSecret)
      )
        return send(
          403,
          page("Bad state", "<h1>OAuth state check failed. Start again.</h1>"),
        );
      const code = url.searchParams.get("code");
      if (!code)
        return send(
          400,
          page(
            "No code",
            `<h1>Google returned: ${esc(url.searchParams.get("error") ?? "no code")}</h1>`,
          ),
        );
      try {
        // A one-off network drop must not waste the owner's clicks: the code stays valid for a few minutes.
        let exchanged: Awaited<ReturnType<typeof exchangeCode>> | undefined;
        for (let attempt = 1; !exchanged; attempt++) {
          try {
            exchanged = await exchangeCode(oauthConfig(cfg), code);
          } catch (err) {
            if (
              attempt >= 4 ||
              !/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(
                `${errorMessage(err)} ${(err as any)?.cause?.code ?? ""}`,
              )
            )
              throw err;
            log("warn", "oauth exchange retry", {
              attempt,
              error: errorMessage(err),
            });
            await new Promise((r) => setTimeout(r, attempt * 2000));
          }
        }
        const { refreshToken, scope } = exchanged;
        // Brand accounts on Google's chooser often carry old names: check the channel itself before saving.
        if (cfg.youtubeChannelId) {
          const ch = await channelOf(refreshToken, oauthConfig(cfg)).catch(
            () => undefined,
          );
          if (ch && ch.id !== cfg.youtubeChannelId)
            return send(
              200,
              page(
                "Wrong channel",
                `<h1>That was the wrong account.</h1><p>You picked <b>${esc(ch.title)}</b>, which is not Pulse Gaming News. Nothing was changed.</p><p><a href="/connect" style="font-size:22px">Try again and pick a different account</a></p>`,
              ),
            );
        }
        await saveRefreshToken(db, oauthConfig(cfg), refreshToken);
        clearTokenCache();
        await clearSelectionPause(db); // the usual cause of a pause is a dead YouTube token
        await logEvent(db, null, "youtube_connected", { scope });
        const missing = ["youtube.force-ssl", "yt-analytics.readonly"].filter(
          (x) => !scope.includes(x),
        );
        await services.notify({
          content: missing.length
            ? `⚠️ YouTube reconnected but Google left out: ${missing.join(", ")}. Run the connect again and tick every box.`
            : "✅ YouTube fully connected: captions, pinned comments, analytics and thumbnails are on.",
        });
        return send(
          200,
          page(
            "Connected",
            missing.length
              ? `<h1>Almost: one box was left unticked.</h1><p>Google did not grant ${esc(missing.join(", "))}. <a href="/connect">Try again</a> and tick every box on the Google screen.</p>`
              : `<h1>✅ YouTube connected.</h1><p>Captions, pinned comments, analytics and thumbnails are now on. You can close this tab.</p>`,
          ),
        );
      } catch (err) {
        log("error", "oauth callback failed", { error: errorMessage(err) });
        return send(
          500,
          page(
            "Failed",
            `<h1>Token exchange failed</h1><p>${esc(errorMessage(err))}</p><p><a href="/connect" style="font-size:22px">Try again</a></p>`,
          ),
        );
      }
    }

    if (url.pathname === "/episodes") {
      // The factory's own status needs the admin key; visitors go to the website.
      if (!isAdmin()) {
        res.writeHead(302, { location: "/" }).end();
        return;
      }
      const rows = await listEpisodes(db, 30);
      const tr = rows
        .map(
          (e) =>
            `<tr><td>${e.created_at ? new Date(e.created_at).toISOString().slice(0, 16).replace("T", " ") : ""}</td><td><b>${e.status}</b></td><td>${esc(e.script_json?.youtube.title ?? e.story_json.headline)}${
              e.youtube_video_id
                ? ` · <a href="https://youtube.com/shorts/${e.youtube_video_id}">YouTube</a>`
                : ""
            }${e.last_error ? `<br><small>${esc(e.last_error.slice(0, 200))}</small>` : ""}</td></tr>`,
        )
        .join("");
      return send(
        200,
        page(
          "Pulse Factory",
          `<h1>Episodes</h1><p>Last run: ${state.lastTick ?? "starting up (first run begins about 15 seconds after start, then every few minutes)"}</p>${
            state.lastError
              ? `<p style="color:#ff6b6b">Last run failed: ${esc(state.lastError)}</p>`
              : ""
          }${rows.length ? `<table>${tr}</table>` : "<p>No episodes yet. The first one appears once a story is picked; a Short takes about 5-10 minutes to make.</p>"}`,
        ),
      );
    }

    if (url.pathname === "/tick" && req.method === "POST") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      void runTick(services, state);
      return send(202, page("Tick", "<h1>Tick started.</h1>"));
    }

    send(404, page("Not found", "<h1>Not found</h1>"));
  };
}

let running = false;
async function runTick(
  services: Services,
  state: { lastTick?: string; lastError?: string },
): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await tick(services);
    state.lastTick = new Date().toISOString();
    state.lastError = undefined;
    if (r.ran && services.cfg.healthcheckPingUrl)
      await fetch(services.cfg.healthcheckPingUrl).catch(() => undefined);
  } catch (err) {
    state.lastError = errorMessage(err);
    log("error", "tick crashed", { error: state.lastError });
  } finally {
    running = false;
  }
}

/** Once a day, shout if nothing went out in the last 26 hours. */
async function deadMansSwitch(db: Db, cfg: Config): Promise<void> {
  const [row] = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM episodes WHERE status = 'published' AND updated_at > now() - interval '26 hours'`,
  );
  if (Number(row?.n ?? 0) === 0) {
    const [last] = await db.query<{
      status: string;
      last_error: string | null;
    }>(
      `SELECT status, last_error FROM episodes ORDER BY created_at DESC LIMIT 1`,
    );
    await alert(
      cfg.discordWebhookUrl,
      "No Short published in the last 26 hours",
      last
        ? `Latest episode is "${last.status}". ${last.last_error ?? ""}`
        : "No episodes yet.",
    );
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.appSecret) throw new Error("APP_SECRET is required");
  const db = await openDb(cfg.databaseUrl, cfg.dataDir);
  const applied = await migrate(db);
  // One process runs this factory: any lease on the table was left by a process that died mid-tick
  // (a restart during a render) and would otherwise block every tick until it expired.
  const stale = await db.query<{ name: string }>(
    `DELETE FROM leases RETURNING name`,
  );
  if (stale.length)
    log("warn", "stale leases cleared at boot", {
      names: stale.map((r) => r.name),
    });
  log("info", "starting", {
    ...redactedConfig(cfg),
    migrationsApplied: applied,
  });
  const services = createServices(db, cfg);
  const state: { lastTick?: string; lastError?: string; doctor?: string } = {};
  const app = createApp(db, cfg, services, state);
  startGameWarmer({ db, cfg, tags: (id) => affiliateTags(cfg, id) });
  startSiteIndexNow({ db, cfg, tags: (id) => affiliateTags(cfg, id) });
  http
    .createServer((req, res) => {
      app(req, res).catch((err) => {
        log("error", "request failed", { error: errorMessage(err) });
        if (!res.headersSent) res.writeHead(500).end("error");
      });
    })
    // Localhost only: the Cloudflare tunnel connects locally, so nothing else on the network needs in.
    .listen(cfg.port, process.env.HOST || "127.0.0.1", () =>
      log("info", "listening", { port: cfg.port }),
    );

  // Boot checks: everything that silently stops an unattended factory, posted to Discord once.
  void (async () => {
    try {
      const checks = await runDoctor(
        cfg,
        await storedRefreshToken(db, oauthConfig(cfg)),
      );
      for (const k of checks)
        log(k.ok ? "info" : k.critical ? "error" : "warn", "doctor", {
          check: k.name,
          detail: k.detail,
        });
      const bad = checks.filter((k) => !k.ok);
      state.doctor = formatDoctor(checks);
      if (bad.length)
        await services.notify({
          content: `🩺 Pulse Factory boot check:\n${formatDoctor(bad)}`,
        });
    } catch (err) {
      log("warn", "doctor failed", { error: errorMessage(err) });
    }
  })();
  // Discovery runs on its own short clock so a breaking story is seen within minutes.
  const discover = () =>
    withLease(db, "discover", 4 * 60, async () => {
      await discoverTick(services);
    }).catch((err) =>
      log("warn", "discovery failed", { error: errorMessage(err) }),
    );
  setTimeout(() => void discover(), 5_000);
  setInterval(() => void discover(), Math.max(1, cfg.discoverMinutes) * 60_000);
  setTimeout(() => void runTick(services, state), 15_000);
  setInterval(() => void runTick(services, state), cfg.tickMinutes * 60_000);
  // Every public Short follows to Facebook, Instagram, TikTok and X on its own clock, never inside the production tick.
  const posters = await buildPosters(cfg, (content) =>
    services.notify({ content }),
  );
  log("info", "crossposting", { platforms: Object.keys(posters) });
  const crosspost = () =>
    withLease(db, "crosspost", 30 * 60, () =>
      crosspostTick({
        db,
        cfg,
        posters,
        now: () => new Date(),
        isPublic: async (id) => {
          try {
            return await isPublicOnYouTube(id);
          } catch {
            const st = await services.youtube().status(id);
            await quotaAdd(db, new Date(), QUOTA.poll);
            return st?.privacyStatus === "public" || st?.privacyStatus === "unlisted";
          }
        },
        notify: (m) => services.notify(m),
        episodeDir: (id) => episodeDir(cfg, id),
        videoUrl: (id) => approvalLinks(cfg, id).preview,
      }),
    ).catch((err) =>
      log("warn", "crosspost pass failed", { error: errorMessage(err) }),
    );
  if (Object.keys(posters).length) {
    setTimeout(() => void crosspost(), 60_000);
    setInterval(() => void crosspost(), 5 * 60_000);
  }
  // The daily community post on Facebook and Instagram, with tomorrow's answers and the comment counts.
  if (cfg.engageEnabled && (cfg.facebookPageToken || cfg.instagramToken)) {
    const p = await import("./social/platforms.ts");
    const engage = () =>
      withLease(db, "engage", 30 * 60, () =>
        engageTick({
          db,
          cfg,
          llm: services.llm,
          now: () => new Date(),
          headlines: async () =>
            (
              await db.query<{ h: string }>(
                `SELECT story_json->>'headline' AS h FROM episodes WHERE lane IN ('news','news_breaking') AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 25`,
              )
            ).map((r) => r.h),
          candidates: async () =>
            (await services.discoverEvergreen()).map((c) => c.name),
          igdbArt: (title, dir) => services.igdbArt(title, undefined, dir, 4),
          render: (dir, outFile, props) =>
            renderEngage({
              dir,
              outFile,
              props,
              browserExecutable: cfg.browserExecutable || undefined,
            }),
          facebook:
            cfg.facebookPageId && cfg.facebookPageToken
              ? {
                  photo: (url, msg) =>
                    p.postFacebookPhoto(
                      cfg.facebookPageId,
                      cfg.facebookPageToken,
                      url,
                      msg,
                    ),
                  comment: (id, text) =>
                    p.graphComment(id, cfg.facebookPageToken, text, false),
                  comments: (id) =>
                    p.graphCommentCount(id, cfg.facebookPageToken, false),
                }
              : undefined,
          instagram:
            cfg.instagramAccountId && cfg.instagramToken
              ? {
                  image: (url, caption) =>
                    p.postInstagramImage(
                      cfg.instagramAccountId,
                      cfg.instagramToken,
                      url,
                      caption,
                    ),
                  comment: (id, text) =>
                    p.graphComment(id, cfg.instagramToken, text, true),
                  comments: (id) =>
                    p.graphCommentCount(id, cfg.instagramToken, true),
                }
              : undefined,
          notify: (m) => services.notify(m),
        }),
      ).catch((err) =>
        log("warn", "community post pass failed", { error: errorMessage(err) }),
      );
    setTimeout(() => void engage(), 90_000);
    setInterval(() => void engage(), 10 * 60_000);
  }
  // A new video's fresh comments: the good ones get a reply while the video is young.
  if (cfg.commentReplies && !cfg.dryRun) {
    const replies = () =>
      replyToComments({
        db,
        youtube: services.youtube,
        llm: services.llm,
        headroom: () => quotaHeadroom(db, cfg, new Date()),
        now: () => new Date(),
      }).catch((err) =>
        log("warn", "comment reply pass failed", { error: errorMessage(err) }),
      );
    setTimeout(() => void replies(), 120_000);
    setInterval(() => void replies(), 5 * 60_000);
  }
  // What viewers ask us to rank next, read from the long videos' comments once a day.
  if (!cfg.dryRun) {
    const requests = () =>
      collectRequests({ db, youtube: services.youtube, llm: services.llm, now: new Date() }).catch((err) =>
        log("warn", "audience requests failed", { error: errorMessage(err) }),
      );
    setTimeout(() => void requests(), 5 * 60_000);
    setInterval(() => void requests(), 3 * 3600_000);
  }
  // Daily at 04:00 UTC, when nothing is mid-production, exit cleanly so the
  // Windows runner can pull updates and restart.
  let lastRestartDay = new Date().toISOString().slice(0, 10);
  setInterval(async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== 4 || day === lastRestartDay || running) return;
    const [busy] = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM episodes WHERE status IN ('selected','scripted','voiced','approved','uploading')`,
    );
    if (Number(busy?.n ?? 0) > 0) return;
    lastRestartDay = day;
    log("info", "daily restart for updates");
    await db.close();
    process.exit(0);
  }, 5 * 60_000);
  // Monday 09:00 local: the week in numbers, which voices are sticking, quota.
  setInterval(() => {
    void (async () => {
      const key = await digestDue(db, cfg, new Date());
      if (!key) return;
      await markDigestSent(db, key);
      await services.notify(await weeklyDigest(db, cfg, new Date()));
      log("info", "weekly digest sent", { week: key });
    })().catch((err) =>
      log("error", "weekly digest failed", { error: errorMessage(err) }),
    );
  }, 5 * 60_000);
  let lastDmsDay = "";
  setInterval(() => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === cfg.publishWindowEndUtc && day !== lastDmsDay) {
      lastDmsDay = day;
      void deadMansSwitch(db, cfg).catch((err) =>
        log("error", "dead man's switch failed", { error: errorMessage(err) }),
      );
    }
  }, 5 * 60_000);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    log("error", "fatal", { error: errorMessage(err) });
    process.exit(1);
  });
}
