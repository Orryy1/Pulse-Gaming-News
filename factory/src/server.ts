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
import { discoverTick, tick, episodeDir, clearSelectionPause, type Services } from "./pipeline.ts";
import { getEpisode, listEpisodes, logEvent, transition } from "./episodes.ts";
import { verifyToken, signToken, safeEqual } from "./lib/crypto.ts";
import { consentUrl, exchangeCode, saveRefreshToken, clearTokenCache } from "./youtube/oauth.ts";
import { errorMessage, log } from "./lib/util.ts";
import { alert } from "./approval/discord.ts";

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0b0e;color:#f5f5f2;padding:24px 16px}
main{max-width:640px;margin:0 auto}h1{font-size:22px}a{color:#ff6b1a}
button{font:inherit;font-weight:700;padding:14px 22px;border:0;border-radius:10px;cursor:pointer;margin:6px 8px 6px 0}
.ok{background:#22c55e;color:#06140a}.no{background:#ff3b3b;color:#1a0505}video{width:100%;max-width:360px;border-radius:12px;background:#000}
table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #222;padding:6px 4px;font-size:14px;vertical-align:top}
</style></head><body><main>${body}</main></body></html>`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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

function streamFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, type: string): void {
  const stat = fs.statSync(file);
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${stat.size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "content-type": type, "content-length": stat.size, "accept-ranges": "bytes" });
    fs.createReadStream(file).pipe(res);
  }
}

export function createApp(db: Db, cfg: Config, services: Services, state: { lastTick?: string; lastError?: string }) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://local");
    const send = (code: number, html: string) => res.writeHead(code, { "content-type": "text/html; charset=utf-8" }).end(html);
    const isAdmin = () => Boolean(cfg.adminToken) && safeEqual(url.searchParams.get("key") ?? "", cfg.adminToken);

    if (url.pathname === "/health") {
      const [counts] = await db.query<Record<string, string>>(
        `SELECT count(*) FILTER (WHERE status = 'published' AND updated_at > now() - interval '24 hours') AS published_24h,
                count(*) FILTER (WHERE status = 'published' AND lane = 'news_breaking' AND updated_at > now() - interval '24 hours') AS breaking_24h,
                count(*) FILTER (WHERE status NOT IN ('published','failed','rejected')) AS in_flight,
                count(*) FILTER (WHERE status IN ('selected','scripted','voiced','rendered')) AS producing,
                count(*) FILTER (WHERE status IN ('uploading') AND publish_at > now()) AS scheduled FROM episodes`,
      );
      const [sight] = await db.query<Record<string, string>>(`SELECT count(*) AS stories_seen_24h, max(last_seen) AS last_discovery FROM cluster_sightings WHERE last_seen > now() - interval '24 hours'`);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, ...counts, ...sight, lastTick: state.lastTick, lastError: state.lastError }));
      return;
    }

    const ep = url.pathname.match(/^\/episodes\/([\w-]+)\/(approve|reject|video\.mp4)$/);
    if (ep) {
      const [, id, action] = ep as unknown as [string, string, string];
      const kind = action === "video.mp4" ? "preview" : action;
      const token = url.searchParams.get("t") ?? "";
      if (!verifyToken(`${kind}:${id}`, token, cfg.appSecret)) return send(403, page("Link expired", "<h1>This link has expired or is invalid.</h1>"));
      const episode = await getEpisode(db, id);
      if (!episode) return send(404, page("Not found", "<h1>Episode not found.</h1>"));

      if (kind === "preview") {
        const file = path.join(episodeDir(cfg, id), "short.mp4");
        if (!fs.existsSync(file)) return send(404, page("Not found", "<h1>No video yet.</h1>"));
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
      if (!verifyToken(`${kind}:${id}`, form.get("t") ?? "", cfg.appSecret)) return send(403, page("Link expired", "<h1>Invalid form token.</h1>"));
      const from = episode.status;
      const allowed = kind === "approve" ? ["awaiting_approval", "rendered"] : ["awaiting_approval", "rendered", "approved", "selected", "scripted", "voiced"];
      if (!allowed.includes(from)) return send(409, page("Too late", `<h1>Episode is already <b>${from}</b>; nothing changed.</h1>`));
      const ok = await transition(db, id, from, kind === "approve" ? "approved" : "rejected", { approved_by: kind === "approve" ? "human" : null });
      await logEvent(db, id, kind === "approve" ? "approved" : "rejected", { by: "human" });
      if (ok && kind === "approve") void runTick(services, state); // publish without waiting for the next tick
      return send(200, page("Done", `<h1>${ok ? (kind === "approve" ? "Approved. Publishing now." : "Rejected.") : "Nothing changed (state moved on)."}</h1>`));
    }

    if (url.pathname === "/oauth/start") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Add ?key=ADMIN_TOKEN</h1>"));
      if (!cfg.googleClientId) return send(500, page("Missing client", "<h1>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.</h1>"));
      const nonce = crypto.randomBytes(12).toString("hex");
      const state = `${nonce}.${signToken(`oauth:${nonce}`, cfg.appSecret, 900)}`;
      res.writeHead(302, { location: consentUrl(oauthConfig(cfg), state) }).end();
      return;
    }
    if (url.pathname === "/oauth/callback") {
      const [nonce, ...rest] = (url.searchParams.get("state") ?? "").split(".");
      if (!nonce || !verifyToken(`oauth:${nonce}`, rest.join("."), cfg.appSecret)) return send(403, page("Bad state", "<h1>OAuth state check failed. Start again.</h1>"));
      const code = url.searchParams.get("code");
      if (!code) return send(400, page("No code", `<h1>Google returned: ${esc(url.searchParams.get("error") ?? "no code")}</h1>`));
      try {
        const { refreshToken, scope } = await exchangeCode(oauthConfig(cfg), code);
        await saveRefreshToken(db, oauthConfig(cfg), refreshToken);
        clearTokenCache();
        await clearSelectionPause(db); // the usual cause of a pause is a dead YouTube token
        await logEvent(db, null, "youtube_connected", { scope });
        return send(200, page("Connected", `<h1>YouTube connected.</h1><p>Scopes: ${esc(scope)}</p><p>You can close this tab.</p>`));
      } catch (err) {
        return send(500, page("Failed", `<h1>Token exchange failed</h1><p>${esc(errorMessage(err))}</p>`));
      }
    }

    if (url.pathname === "/" || url.pathname === "/episodes") {
      if (!isAdmin()) return send(200, page("Pulse Factory", "<h1>Pulse Factory</h1><p>Running.</p>"));
      const rows = await listEpisodes(db, 30);
      const tr = rows
        .map(
          (e) =>
            `<tr><td>${e.created_at ? new Date(e.created_at).toISOString().slice(0, 16).replace("T", " ") : ""}</td><td><b>${e.status}</b></td><td>${esc(e.script_json?.youtube.title ?? e.story_json.headline)}${
              e.youtube_video_id ? ` · <a href="https://youtube.com/shorts/${e.youtube_video_id}">YouTube</a>` : ""
            }${e.last_error ? `<br><small>${esc(e.last_error.slice(0, 200))}</small>` : ""}</td></tr>`,
        )
        .join("");
      return send(200, page("Pulse Factory", `<h1>Episodes</h1><p>Last run: ${state.lastTick ?? "starting up (first run begins about 15 seconds after start, then every few minutes)"}</p>${
          state.lastError ? `<p style="color:#ff6b6b">Last run failed: ${esc(state.lastError)}</p>` : ""
        }${rows.length ? `<table>${tr}</table>` : "<p>No episodes yet. The first one appears once a story is picked; a Short takes about 5-10 minutes to make.</p>"}`));
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
async function runTick(services: Services, state: { lastTick?: string; lastError?: string }): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await tick(services);
    state.lastTick = new Date().toISOString();
    state.lastError = undefined;
    if (r.ran && services.cfg.healthcheckPingUrl) await fetch(services.cfg.healthcheckPingUrl).catch(() => undefined);
  } catch (err) {
    state.lastError = errorMessage(err);
    log("error", "tick crashed", { error: state.lastError });
  } finally {
    running = false;
  }
}

/** Once a day, shout if nothing went out in the last 26 hours. */
async function deadMansSwitch(db: Db, cfg: Config): Promise<void> {
  const [row] = await db.query<{ n: string }>(`SELECT count(*) AS n FROM episodes WHERE status = 'published' AND updated_at > now() - interval '26 hours'`);
  if (Number(row?.n ?? 0) === 0) {
    const [last] = await db.query<{ status: string; last_error: string | null }>(`SELECT status, last_error FROM episodes ORDER BY created_at DESC LIMIT 1`);
    await alert(cfg.discordWebhookUrl, "No Short published in the last 26 hours", last ? `Latest episode is "${last.status}". ${last.last_error ?? ""}` : "No episodes yet.");
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.appSecret) throw new Error("APP_SECRET is required");
  const db = await openDb(cfg.databaseUrl, cfg.dataDir);
  const applied = await migrate(db);
  log("info", "starting", { ...redactedConfig(cfg), migrationsApplied: applied });
  const services = createServices(db, cfg);
  const state: { lastTick?: string; lastError?: string; doctor?: string } = {};
  const app = createApp(db, cfg, services, state);
  http
    .createServer((req, res) => {
      app(req, res).catch((err) => {
        log("error", "request failed", { error: errorMessage(err) });
        if (!res.headersSent) res.writeHead(500).end("error");
      });
    })
    // Localhost only: the Cloudflare tunnel connects locally, so nothing else on the network needs in.
    .listen(cfg.port, process.env.HOST || "127.0.0.1", () => log("info", "listening", { port: cfg.port }));

  // Boot checks: everything that silently stops an unattended factory, posted to Discord once.
  void (async () => {
    try {
      const checks = await runDoctor(cfg, await storedRefreshToken(db, oauthConfig(cfg)));
      for (const k of checks) log(k.ok ? "info" : k.critical ? "error" : "warn", "doctor", { check: k.name, detail: k.detail });
      const bad = checks.filter((k) => !k.ok);
      state.doctor = formatDoctor(checks);
      if (bad.length) await services.notify({ content: `🩺 Pulse Factory boot check:\n${formatDoctor(bad)}` });
    } catch (err) {
      log("warn", "doctor failed", { error: errorMessage(err) });
    }
  })();
  // Discovery runs on its own short clock so a breaking story is seen within minutes.
  const discover = () => withLease(db, "discover", 4 * 60, async () => { await discoverTick(services); }).catch((err) => log("warn", "discovery failed", { error: errorMessage(err) }));
  setTimeout(() => void discover(), 5_000);
  setInterval(() => void discover(), Math.max(1, cfg.discoverMinutes) * 60_000);
  setTimeout(() => void runTick(services, state), 15_000);
  setInterval(() => void runTick(services, state), cfg.tickMinutes * 60_000);
  // Daily at 04:00 UTC, when nothing is mid-production, exit cleanly so the
  // Windows runner can pull updates and restart.
  let lastRestartDay = new Date().toISOString().slice(0, 10);
  setInterval(async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== 4 || day === lastRestartDay || running) return;
    const [busy] = await db.query<{ n: string }>(`SELECT count(*) AS n FROM episodes WHERE status IN ('selected','scripted','voiced','approved','uploading')`);
    if (Number(busy?.n ?? 0) > 0) return;
    lastRestartDay = day;
    log("info", "daily restart for updates");
    await db.close();
    process.exit(0);
  }, 5 * 60_000);
  let lastDmsDay = "";
  setInterval(() => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === cfg.publishWindowEndUtc && day !== lastDmsDay) {
      lastDmsDay = day;
      void deadMansSwitch(db, cfg).catch((err) => log("error", "dead man's switch failed", { error: errorMessage(err) }));
    }
  }, 5 * 60_000);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log("error", "fatal", { error: errorMessage(err) });
    process.exit(1);
  });
}
