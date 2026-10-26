// The whole service: an HTTP server for approvals, previews, OAuth and health,
// plus the in-process scheduler that ticks the pipeline.

import { pollPlan, recordPollResult } from "./social/poll.ts";
import fs from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { creditLine } from "./voice/credits.ts";
import { fileURLToPath } from "node:url";
import { loadConfig, redactedConfig, type Config } from "./config.ts";
import { runDoctor, formatDoctor } from "./doctor.ts";
import { storedRefreshToken } from "./youtube/oauth.ts";
import { openDb, migrate, withLease, type Db } from "./db.ts";
import { backupDue, makeBackup, markBackup } from "./backup.ts";
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
import {
  QUOTA,
  publishHeld,
  quotaAdd,
  quotaUsed,
  setPublishHold,
} from "./lanes.ts";
import { productsFor, shopPageHtml } from "./editorial/affiliate.ts";
import {
  buildPosters,
  crosspostTick,
  isPublicOnYouTube,
} from "./social/crosspost.ts";
import { engageTick } from "./social/engage.ts";
import { renderEngage, sweepRenderTemp } from "./render/render.ts";
import {
  handleSite,
  startGameWarmer,
  startSiteIndexNow,
} from "./web/routes.ts";
import {
  releaseTransientSkips,
  replyToChannelComments,
  replyToComments,
} from "./youtube/replies.ts";
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
import { activeUploads } from "./youtube/upload.ts";
import { alert } from "./approval/discord.ts";
import {
  dailySummary,
  digestDue,
  markDigestSent,
  summaryDue,
  weeklyDigest,
} from "./analytics.ts";

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
      safeEqual(
        String(req.headers["x-admin-key"] ?? url.searchParams.get("key") ?? ""),
        cfg.adminToken,
      );

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
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          ok: true,
          ...counts,
          ...sight,
          ...met,
          uploads_active: activeUploads(),
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

    // Mac mini setup: the one-line installer (no secrets in it: the PC's public key only), and the Mac's
    // "ready" call, which records its username and home-network address so the PC can reach it.
    if (url.pathname === "/mac-setup.sh" && req.method === "GET") {
      const script = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "mac",
        "setup.sh",
      );
      const key = path.join(cfg.dataDir, "admin", "pulse_mac.pub");
      if (!fs.existsSync(script) || !fs.existsSync(key))
        return send(404, page("Not found", "<h1>Not found</h1>"));
      const codeFile = path.join(cfg.dataDir, "admin", "mac_code");
      const body = fs
        .readFileSync(script, "utf8")
        .replace("__PUBKEY__", fs.readFileSync(key, "utf8").trim())
        .replace(
          "__CODE__",
          fs.existsSync(codeFile)
            ? fs.readFileSync(codeFile, "utf8").trim()
            : "",
        );
      res
        .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end(body);
      return;
    }
    if (url.pathname === "/mac-hello" && req.method === "GET") {
      // Armed only while the Mac move is on: the setup script carries a one-time code (data/admin/mac_code),
      // without which the page is a 404 like every other hidden route (audit, 24 Oct 2026).
      const codeFile = path.join(cfg.dataDir, "admin", "mac_code");
      const expected = fs.existsSync(codeFile)
        ? fs.readFileSync(codeFile, "utf8").trim()
        : "";
      const given = url.searchParams.get("code") ?? "";
      if (
        !expected ||
        !given ||
        given.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
      )
        return send(404, page("Not found", "<h1>Not found</h1>"));
      const user = url.searchParams.get("user") ?? "";
      const ip = url.searchParams.get("ip") ?? "";
      if (
        !/^[a-z_][a-z0-9_.-]{0,31}$/i.test(user) ||
        !/^(192\.168|10)\.\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(ip)
      )
        return send(400, page("Bad request", "<h1>Bad request</h1>"));
      fs.mkdirSync(path.join(cfg.dataDir, "admin"), { recursive: true });
      const macFile = path.join(cfg.dataDir, "admin", "mac.json");
      const seen = fs.existsSync(macFile);
      fs.writeFileSync(
        macFile,
        JSON.stringify({ user, ip, at: new Date().toISOString() }),
      );
      await services.notify({
        content: `🖥️ The Mac mini reported in (user ${user}, ${ip}). Setting it up now; nothing for you to do.`,
      });
      // The first report-in starts the safe half of the move by itself (tools, code, speech check,
      // vision model; nothing secret, as this page is public). Settings, credentials, data and the
      // switch-over stay with the deliberate "cutover" step (mac/migrate.sh).
      const bash =
        process.env.GIT_BASH || "C:\\Program Files\\Git\\bin\\bash.exe";
      if (!seen && process.platform === "win32" && fs.existsSync(bash)) {
        const out = fs.openSync(
          path.join(cfg.dataDir, "logs", "mac-migrate.log"),
          "a",
        );
        const child = spawn(
          bash,
          [
            "-c",
            `export PATH=/usr/bin:$PATH; mac/migrate.sh hello '${user}' '${ip}' && mac/migrate.sh prepare`,
          ],
          {
            cwd: process.cwd(),
            stdio: ["ignore", out, out],
            env: { ...process.env, CHERE_INVOKING: "1" },
          },
        );
        child.on(
          "exit",
          (code) =>
            void services.notify({
              content:
                code === 0
                  ? "✅ The Mac mini is prepared: tools, code, speech check and vision model are in and its checks pass. Next is the switch-over, which Claude runs."
                  : `⚠️ Preparing the Mac mini stopped part-way (exit ${code}). Claude will look at data/logs/mac-migrate.log; nothing for you to do.`,
            }),
        );
      }
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    // One-tap TikTok: the draft's caption with Copy and Open TikTok buttons (a signed link from Discord).
    const tt = url.pathname.match(/^\/tiktok\/([\w-]+)$/);
    if (tt && req.method === "GET") {
      const id = tt[1]!;
      if (
        !verifyToken(
          `tiktok:${id}`,
          url.searchParams.get("t") ?? "",
          cfg.appSecret,
        )
      )
        return send(
          403,
          page("Link expired", "<h1>This link has expired.</h1>"),
        );
      const [row] = await db.query<{ caption: string }>(
        `SELECT detail->>'caption' AS caption FROM events WHERE episode_id = $1 AND kind = 'tiktok_caption' ORDER BY id DESC LIMIT 1`,
        [id],
      );
      const episode = await getEpisode(db, id);
      if (!row?.caption || !episode)
        return send(
          404,
          page("Not found", "<h1>No TikTok caption for this video.</h1>"),
        );
      const esc = (t: string) =>
        t.replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c]!,
        );
      return send(
        200,
        page(
          "Post to TikTok",
          `<h1>📲 ${esc(episode.script_json?.youtube?.title ?? "TikTok draft")}</h1>
<ol><li>Tap <b>Copy caption &amp; open TikTok</b></li><li>Tap the draft in your TikTok inbox</li><li>Paste the caption, turn on <b>AI-generated content</b>, Post</li></ol>
<p><button class="ok" id="go" style="font-size:20px;width:100%;padding:18px">Copy caption &amp; open TikTok</button></p>
<textarea id="c" readonly style="width:100%;height:9em;font:inherit;background:#16161b;color:#f5f5f2;border:1px solid #333;border-radius:10px;padding:10px">${esc(row.caption)}</textarea>
<p style="text-align:center"><a href="#" id="copy" style="color:#ff6b1a">Copy only</a></p>
<script>
const copy=async()=>{const t=document.getElementById("c");try{await navigator.clipboard.writeText(t.value)}catch{t.select();document.execCommand("copy")}};
document.getElementById("go").onclick=async()=>{await copy();document.getElementById("go").textContent="Copied ✓ Opening TikTok…";location.href="https://www.tiktok.com/"};
document.getElementById("copy").onclick=async(e)=>{e.preventDefault();await copy();e.target.textContent="Copied ✓"};
</script>`,
        ),
      );
    }
    // The publishing hold (admin key): ?set=on stops every upload, cross-post, reply and post until ?set=off.
    if (url.pathname === "/admin/hold" && req.method === "GET") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const set = url.searchParams.get("set");
      if (set === "on" || set === "off") {
        await setPublishHold(db, set === "on");
        log("warn", "publishing hold changed", { hold: set });
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ hold: (await publishHeld(db)) ? "on" : "off" }));
      return;
    }
    // Comment decisions (admin key): what the reply pass judged, said or skipped, newest first.
    if (url.pathname === "/admin/comments" && req.method === "GET") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const rows = await db.query(
        `SELECT created_at, video_id, comment, decision, reason, reply_text FROM comment_replies ORDER BY created_at DESC LIMIT 50`,
      );
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(rows));
      return;
    }
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
        // An optional new channel description sits in data/admin/channel_description.txt (written on this PC).
        const descFile = path.join(
          cfg.dataDir,
          "admin",
          "channel_description.txt",
        );
        const description = fs.existsSync(descFile)
          ? fs.readFileSync(descFile, "utf8").trim()
          : undefined;
        const done = await setChannelBanner(token, file, description);
        if (description) fs.rmSync(descFile, { force: true });
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
    // Admin: this week's poll options, and recording the last poll's result (from data/admin/poll_result.json).
    if (url.pathname === "/admin/poll-plan" && req.method === "GET") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const plan = await pollPlan(
        db,
        cfg,
        await services.discoverEvergreen().catch(() => []),
        new Date(),
      );
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(plan));
      return;
    }
    if (url.pathname === "/admin/poll-result" && req.method === "POST") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const file = path.join(cfg.dataDir, "admin", "poll_result.json");
      if (!fs.existsSync(file))
        return send(404, page("No result", "<h1>No result</h1>"));
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
          options?: Array<{ name?: unknown; percent?: unknown }>;
        };
        const options = (raw.options ?? [])
          .map((o) => ({
            name: String(o.name ?? "").slice(0, 40),
            percent: Math.max(0, Math.min(100, Number(o.percent) || 0)),
          }))
          .filter((o) => o.name)
          .slice(0, 5);
        if (!options.length) throw new Error("no options in poll_result.json");
        await recordPollResult(db, { at: new Date().toISOString(), options });
        fs.rmSync(file, { force: true });
        await logEvent(db, null, "poll_result", { options });
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: true, options }));
      } catch (err) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: false, error: errorMessage(err) }));
      }
      return;
    }
    // Admin: one-off YouTube work on a video the factory did not make itself (a sandbox upload), using
    // the factory's own fully-scoped login. The request carries no paths or text: the job is a file
    // written on this PC (data/admin/job.json: { videoId, srt?, comment? }), so nothing outside can steer it.
    if (url.pathname === "/admin/run-job" && req.method === "POST") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const jobFile = path.join(cfg.dataDir, "admin", "job.json");
      if (!fs.existsSync(jobFile))
        return send(404, page("No job", "<h1>No job</h1>"));
      const job = JSON.parse(fs.readFileSync(jobFile, "utf8")) as {
        videoId: string;
        srt?: string;
        comment?: string;
        privacy?: "private" | "unlisted";
        spent?: number;
      };
      const out: Record<string, unknown> = { videoId: job.videoId };
      const yt = services.youtube();
      try {
        if (!/^[\w-]{11}$/.test(job.videoId)) throw new Error("bad video id");
        if (job.srt) {
          const srt = path.resolve(cfg.dataDir, job.srt);
          if (
            !srt.startsWith(path.resolve(cfg.dataDir)) ||
            !srt.endsWith(".srt")
          )
            throw new Error("srt must be an .srt inside the data folder");
          const have = await yt.listCaptions(job.videoId);
          out.captions = have.length
            ? `already has ${have.length}`
            : await yt.insertCaption(job.videoId, srt, "en", "English");
          if (!have.length) await quotaAdd(db, new Date(), QUOTA.captions);
        }
        if (job.comment) {
          out.comment = await yt.insertComment(
            job.videoId,
            job.comment.slice(0, 1000),
          );
          await quotaAdd(db, new Date(), QUOTA.comment);
        }
        // Hiding a video (never making one public: that stays the owner's call).
        if (job.privacy === "private" || job.privacy === "unlisted") {
          await yt.setPrivacy(job.videoId, job.privacy);
          await quotaAdd(db, new Date(), QUOTA.comment);
          out.privacy = (await yt.status(job.videoId))?.privacyStatus;
        }
        // Units spent outside the factory today (a manual upload), so its own uploads keep their headroom.
        if (
          typeof job.spent === "number" &&
          job.spent > 0 &&
          job.spent <= 5000
        ) {
          await quotaAdd(db, new Date(), Math.round(job.spent));
          out.spent = Math.round(job.spent);
        }
        out.quotaUsedToday = await quotaUsed(db, new Date());
        fs.rmSync(jobFile, { force: true });
        await logEvent(db, null, "admin_job", out);
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: true, ...out }));
      } catch (err) {
        res
          .writeHead(500, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: false, error: errorMessage(err) }));
      }
      return;
    }
    // Admin: published videos with their scripts, QA scores and captured numbers, for performance reviews.
    // The channel diagnosis: every upload with its YouTube numbers, where the views came from for the
    // biggest 40, and what the factory knows about each (lane, script, voice, rubric). Read-only.
    if (url.pathname === "/admin/channel-report" && req.method === "GET") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const days = Math.min(
        365,
        Math.max(7, Number(url.searchParams.get("days") ?? 120)),
      );
      const end = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - days * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const yt = services.youtube();
      const [uploads, report] = await Promise.all([
        yt.allUploads(),
        yt.channelReport(start, end),
      ]);
      const traffic: Record<string, Record<string, number>> = {};
      for (const r of report.slice(0, 40)) {
        const id = String(r.video);
        traffic[id] = await yt.trafficSources(id, start, end).catch(() => ({}));
      }
      const episodes = await db.query(
        `SELECT e.id, e.lane, e.status, e.youtube_video_id, coalesce(e.publish_at, e.updated_at) AS live_at, e.script_json,
                e.story_json->'corroborated' AS corroborated, e.assets_json->'durationSeconds' AS duration,
                e.assets_json->'voice'->>'name' AS narrator, (e.assets_json->'desk') IS NOT NULL AS desk,
                e.assets_json->'plan'->'shots'->0->'media'->>'type' AS opening, e.qa_json->'rubric'->'metrics' AS rubric
           FROM episodes e WHERE e.youtube_video_id IS NOT NULL`,
      );
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({ start, end, uploads, report, traffic, episodes }),
        );
      return;
    }
    // Every note the factory's own checks wrote about its videos (the feedback the Discord posts carry):
    // the visual check's verdict, problems and notes, the quality rubric, narration faults, dropped media
    // and failed steps. Read-only, for reviewing what keeps coming up.
    if (url.pathname === "/admin/qa-notes" && req.method === "GET") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const days = Math.min(
        90,
        Math.max(1, Number(url.searchParams.get("days") ?? 21)),
      );
      const rows = await db.query(
        `SELECT e.id, e.lane, e.status, e.youtube_video_id, e.created_at, e.script_json->'youtube'->>'title' AS title,
                e.qa_json->'vision' AS vision, e.qa_json->'rubric' AS rubric, e.qa_json->'technical' AS technical, e.last_error,
                (SELECT json_agg(json_build_object('kind', v.kind, 'at', v.created_at, 'detail', v.detail) ORDER BY v.id)
                   FROM events v WHERE v.episode_id = e.id
                    AND v.kind IN ('narration_check','media_dropped','style_warnings','factcheck','rubric','rejected','stale_review','crosspost_failed','media_floor','pauses_tightened','captions_failed','comment_failed','localize_failed','approved')) AS events
           FROM episodes e
          WHERE e.created_at > now() - make_interval(days => $1)
          ORDER BY e.created_at DESC`,
        [days],
      );
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(rows));
      return;
    }
    // Repair: finish an upload that was cut off (the video sits at "Processing will begin shortly") by
    // resuming its session, which sends only the bytes YouTube is missing. Reports the video's status.
    if (url.pathname === "/admin/resume-upload" && req.method === "POST") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const ep = await getEpisode(db, url.searchParams.get("id") ?? "");
      if (!ep) return send(404, page("Not found", "<h1>No such episode</h1>"));
      const yt = services.youtube();
      const out: Record<string, unknown> = {
        id: ep.id,
        video: ep.youtube_video_id,
        session: Boolean(ep.upload_session_uri),
      };
      if (ep.youtube_video_id)
        out.before = await yt
          .status(ep.youtube_video_id)
          .catch((e) => String(e));
      if (ep.upload_session_uri) {
        const file = path.join(cfg.dataDir, "episodes", ep.id, "short.mp4");
        out.result = await yt
          .uploadToSession(ep.upload_session_uri, file)
          .then((videoId) => ({ ok: true, videoId }))
          .catch((e) => ({ ok: false, error: errorMessage(e) }));
        if (ep.youtube_video_id)
          out.after = await yt
            .status(ep.youtube_video_id)
            .catch((e) => String(e));
      }
      await logEvent(db, ep.id, "upload_resumed", out).catch(() => undefined);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(out));
      return;
    }
    // The latest daily community post (question, caption, picture on disk), for the YouTube Community tab.
    if (url.pathname === "/admin/engage-latest" && req.method === "GET") {
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
      const [row] = await db.query<{
        id: number;
        created_at: string;
        detail: any;
      }>(
        `SELECT id, created_at, detail FROM events WHERE kind = 'engage_post' AND detail ? 'question' AND NOT detail ? 'skipped' ORDER BY id DESC LIMIT 1`,
      );
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(row ?? null));
      return;
    }
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
      if (!isAdmin()) return send(403, page("Forbidden", "<h1>Forbidden</h1>"));
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
    // Bluesky: a form on this PC only. The handle and app password go straight from the owner's browser
    // to the login file (owner-only, outside the repo); they are never logged or shown again.
    if (
      (url.pathname === "/connect" &&
        url.searchParams.get("account") === "bluesky") ||
      url.pathname === "/connect/bluesky"
    ) {
      if (!fromThisPc)
        return send(
          403,
          page(
            "Forbidden",
            "<h1>Open http://localhost:8080/connect?account=bluesky on the PC running the factory.</h1>",
          ),
        );
      if (req.method === "POST") {
        const raw = await new Promise<string>((resolve) => {
          let b = "";
          req.on("data", (c) => (b = (b + c).slice(0, 4000)));
          req.on("end", () => resolve(b));
        });
        const form = new URLSearchParams(raw);
        const identifier = (form.get("handle") ?? "").trim().replace(/^@/, "");
        const appPassword = (form.get("password") ?? "").trim();
        const { checkBluesky } = await import("./social/platforms.ts");
        if (
          !identifier ||
          !appPassword ||
          !(await checkBluesky({ identifier, appPassword }))
        )
          return send(
            200,
            page(
              "Bluesky",
              `<h1>Bluesky did not accept that handle and app password.</h1><p>Nothing was saved. <a href="/connect?account=bluesky" style="font-size:22px">Try again</a></p>`,
            ),
          );
        fs.mkdirSync(path.dirname(cfg.blueskyLoginPath), { recursive: true });
        fs.writeFileSync(
          cfg.blueskyLoginPath,
          JSON.stringify({ identifier, appPassword }),
          { mode: 0o600 },
        );
        log("info", "bluesky connected", { handle: identifier });
        return send(
          200,
          page(
            "Bluesky connected",
            `<h1>Bluesky is connected as @${esc(identifier)}.</h1><p>New Shorts will follow to Bluesky about 20 minutes after YouTube. You can close this tab.</p>`,
          ),
        );
      }
      return send(
        200,
        page(
          "Connect Bluesky",
          `<h1>Connect Bluesky</h1>
<p>Use an <b>app password</b> (Bluesky: Settings, Privacy and security, App passwords, Add), never your account password.</p>
<form method="post" action="/connect/bluesky" style="font-size:20px">
<p><label>Handle<br><input name="handle" placeholder="pulsegmg.bsky.social" style="font-size:20px;width:22em" autocomplete="off"></label></p>
<p><label>App password<br><input name="password" type="password" placeholder="xxxx-xxxx-xxxx-xxxx" style="font-size:20px;width:22em" autocomplete="off"></label></p>
<p><button type="submit" style="font-size:22px">Connect</button></p></form>`,
        ),
      );
    }
    // Threads: Meta's sign-in for the Threads profile, then a 60-day token the factory renews itself.
    if (
      url.pathname === "/connect" &&
      url.searchParams.get("account") === "threads"
    ) {
      if (!fromThisPc && !isAdmin())
        return send(
          403,
          page(
            "Forbidden",
            "<h1>Open http://localhost:8080/connect?account=threads on the PC running the factory.</h1>",
          ),
        );
      if (!cfg.threadsAppId || !cfg.threadsAppSecret)
        return send(
          200,
          page(
            "Threads",
            "<h1>Set THREADS_APP_ID and THREADS_APP_SECRET first.</h1>",
          ),
        );
      const nonce = crypto.randomBytes(12).toString("hex");
      const state = `${nonce}.${signToken(`threads:${nonce}`, cfg.appSecret, 3600)}`;
      const redirect = `${(cfg.siteUrl || cfg.publicUrl).replace(/\/$/, "")}/oauth/threads`;
      const q = new URLSearchParams({
        client_id: cfg.threadsAppId,
        redirect_uri: redirect,
        scope: "threads_basic,threads_content_publish",
        response_type: "code",
        state,
      });
      res
        .writeHead(302, {
          location: `https://threads.net/oauth/authorize?${q}`,
        })
        .end();
      return;
    }
    if (url.pathname === "/oauth/threads") {
      const [nonce, ...rest] = (url.searchParams.get("state") ?? "").split(".");
      if (
        !nonce ||
        !verifyToken(`threads:${nonce}`, rest.join("."), cfg.appSecret)
      )
        return send(
          403,
          page(
            "Bad state",
            "<h1>Sign-in check failed. Start again from /connect?account=threads.</h1>",
          ),
        );
      const code = url.searchParams.get("code");
      if (!code)
        return send(
          400,
          page(
            "No code",
            `<h1>Threads returned: ${esc(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "no code")}</h1>`,
          ),
        );
      try {
        const redirect = `${(cfg.siteUrl || cfg.publicUrl).replace(/\/$/, "")}/oauth/threads`;
        const short = await fetch(
          "https://graph.threads.net/oauth/access_token",
          {
            method: "POST",
            body: new URLSearchParams({
              client_id: cfg.threadsAppId,
              client_secret: cfg.threadsAppSecret,
              grant_type: "authorization_code",
              redirect_uri: redirect,
              code,
            }),
          },
        ).then((r) => r.json() as Promise<any>);
        if (!short?.access_token)
          throw new Error(JSON.stringify(short?.error ?? short).slice(0, 300));
        const long = await fetch(
          `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(cfg.threadsAppSecret)}&access_token=${encodeURIComponent(short.access_token)}`,
        ).then((r) => r.json() as Promise<any>);
        if (!long?.access_token)
          throw new Error(JSON.stringify(long?.error ?? long).slice(0, 300));
        fs.mkdirSync(path.dirname(cfg.threadsLoginPath), { recursive: true });
        fs.writeFileSync(
          cfg.threadsLoginPath,
          JSON.stringify({
            userId: String(short.user_id),
            token: long.access_token,
            refreshedAt: new Date().toISOString(),
          }),
          { mode: 0o600 },
        );
        log("info", "threads connected", { user: String(short.user_id) });
        return send(
          200,
          page(
            "Threads connected",
            "<h1>Threads is connected.</h1><p>New Shorts will follow to Threads about 45 minutes after YouTube. You can close this tab.</p>",
          ),
        );
      } catch (err) {
        return send(
          200,
          page(
            "Threads",
            `<h1>Threads sign-in did not finish.</h1><p>${esc(errorMessage(err))}</p><p>Nothing was saved.</p>`,
          ),
        );
      }
    }
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
      // A second account (the twin channel) rides in the nonce, so the callback knows which login it is.
      const account = (url.searchParams.get("account") ?? "")
        .replace(/[^a-z]/g, "")
        .slice(0, 2);
      const nonce = `${crypto.randomBytes(12).toString("hex")}${account ? `-${account}` : ""}`;
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
        const account = nonce.includes("-") ? nonce.split("-")[1]! : "";
        const expectedChannel = account
          ? account === cfg.twinLanguage
            ? cfg.twinChannelId
            : ""
          : cfg.youtubeChannelId;
        const connectAgain = account
          ? `/connect?account=${account}`
          : "/connect";
        if (account && !expectedChannel)
          return send(
            200,
            page(
              "Unknown account",
              `<h1>No channel is set up for "${esc(account)}".</h1><p>Set TWIN_LANGUAGE and TWIN_YOUTUBE_CHANNEL_ID first. Nothing was changed.</p>`,
            ),
          );
        // Brand accounts on Google's chooser often carry old names: check the channel itself before saving.
        // The check must succeed and match; a lookup that fails keeps the working login (audit, 24 Oct 2026).
        if (expectedChannel) {
          const ch = await channelOf(refreshToken, oauthConfig(cfg)).catch(
            () => undefined,
          );
          if (!ch)
            return send(
              200,
              page(
                "Could not check the channel",
                `<h1>Google did not say which channel that was.</h1><p>Nothing was changed; the existing login stays. <a href="${connectAgain}" style="font-size:22px">Try again</a></p>`,
              ),
            );
          if (ch.id !== expectedChannel)
            return send(
              200,
              page(
                "Wrong channel",
                `<h1>That was the wrong account.</h1><p>You picked <b>${esc(ch.title)}</b>, which is not ${account ? "the twin channel" : "Pulse Gaming News"}. Nothing was changed.</p><p><a href="${connectAgain}" style="font-size:22px">Try again and pick a different account</a></p>`,
              ),
            );
        }
        await saveRefreshToken(db, oauthConfig(cfg), refreshToken, account);
        clearTokenCache();
        if (account) {
          await logEvent(db, null, "youtube_connected", { scope, account });
          await services.notify({
            content: `✅ The ${account.toUpperCase()} twin channel is connected: translated Shorts start with the next one that goes public.`,
          });
          return send(
            200,
            page(
              "Connected",
              `<h1>✅ Twin channel connected.</h1><p>Translated Shorts will start with the next one that goes public. You can close this tab.</p>`,
            ),
          );
        }
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
    services.notify({ content, ping: true }),
  );
  log("info", "crossposting", { platforms: Object.keys(posters) });
  // One pass at a time: Instagram's processing retries once ran a pass past its 30-minute lease and the
  // next pass posted the same Short to TikTok again (23 Oct 2026). The flag holds for as long as a pass
  // runs; the longer lease covers anything outside this process.
  let crossposting = false;
  const crosspost = async () => {
    if (crossposting) return;
    crossposting = true;
    try {
      await crosspostPass();
    } finally {
      crossposting = false;
    }
  };
  const crosspostPass = () =>
    withLease(db, "crosspost", 120 * 60, () =>
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
            // Only a public video is shared on; an unlisted one was hidden on purpose.
            return st?.privacyStatus === "public";
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
  // The renderer leaves a bundle and an assets folder in the system temp folder for every start and render.
  const sweep = () =>
    sweepRenderTemp()
      .then(
        (gb) =>
          gb >= 0.05 &&
          log("info", "render leftovers cleared", {
            gb: Math.round(gb * 10) / 10,
          }),
      )
      .catch((err) =>
        log("warn", "render temp sweep failed", { error: errorMessage(err) }),
      );
  setTimeout(() => void sweep(), 3 * 60_000);
  setInterval(() => void sweep(), 60 * 60_000);
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
    const deps = {
      db,
      youtube: services.youtube,
      llm: services.llm,
      headroom: () => quotaHeadroom(db, cfg, new Date()),
      now: () => new Date(),
    };
    // New videos are watched closely; every other comment on the channel is picked up within 15 minutes.
    const replies = () =>
      replyToComments(deps)
        .then(() => replyToChannelComments(deps))
        .catch((err) =>
          log("warn", "comment reply pass failed", {
            error: errorMessage(err),
          }),
        );
    void releaseTransientSkips(db)
      .then(
        (n) =>
          n &&
          log("info", "held-back comments released for another look", {
            comments: n,
          }),
      )
      .catch(() => undefined);
    setTimeout(() => void replies(), 120_000);
    setInterval(() => void replies(), 5 * 60_000);
  }
  // What viewers ask us to rank next, read from the long videos' comments once a day.
  if (!cfg.dryRun) {
    const requests = () =>
      collectRequests({
        db,
        youtube: services.youtube,
        llm: services.llm,
        now: new Date(),
      }).catch((err) =>
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
  // 03:00 local: an encrypted restore point (database, settings, credentials) copied to BACKUP_DIR.
  setInterval(() => {
    void (async () => {
      const day = await backupDue(db, cfg.timezone, new Date());
      if (!day) return;
      const file = await makeBackup(db, {
        dataDir: cfg.dataDir,
        outDir: cfg.backupDir,
        secret: cfg.appSecret,
        tiktokTokenPath: cfg.tiktokTokenPath || undefined,
        tunnelConfig: "D:/pulse-data/cloudflared-pulse.yml",
      });
      await markBackup(db, day, file);
    })().catch((err) => {
      log("error", "backup failed", { error: errorMessage(err) });
      void services.notify({
        content: `⚠️ Last night's backup failed: ${errorMessage(err).slice(0, 200)}. Claude will look at it.`,
      });
    });
  }, 10 * 60_000);
  // 21:30 local: the day in one message (what went live, TikTok drafts waiting, background news).
  setInterval(() => {
    void (async () => {
      if (!(await summaryDue(db, cfg, new Date()))) return;
      const plan = await services.creditPlan?.().catch(() => undefined);
      await services.notify(
        await dailySummary(
          db,
          cfg,
          new Date(),
          plan ? creditLine(plan) : undefined,
        ),
      );
      log("info", "daily summary sent");
    })().catch((err) =>
      log("error", "daily summary failed", { error: errorMessage(err) }),
    );
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
