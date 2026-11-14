// The Twitch-to-YouTube relay (src/relay/job.ts). Run on the Mac mini from ~/PulseFactory/factory:
//   node --import tsx src/tools/stream-relay.ts watch
//       the relay itself, kept running by launchd (mac/relay.sh installs com.pulse.streamrelay). With STREAM_RELAY
//       off it rests 10 minutes and exits, so launchd starts it again and a changed .env is picked up without a deploy.
//   ... detect [login]                       is a Twitch channel live (Helix streams?user_login=)
//   ... pipe-test <login> <seconds> <out.ts> streamlink (ads filtered) to ffmpeg into a local file: the pipe, no YouTube
//   ... yt-test [seconds]                    a PRIVATE test broadcast fed with an ffmpeg test pattern and tone, checks
//                                            that YouTube receives it, then ends it (the private archive is kept)
//   ... status                               the relay's state and the archive list
// It runs outside the factory process on purpose: a factory restart (every deploy) must not cut a live stream.
// It does not go through ~/orch/macrun.sh either: that queue waits behind renders and throttles the network, and a
// live stream cannot wait. The pipe copies, never encodes video, so it costs a few per cent of one core.
// Nothing prints the stream key: ingest addresses are only ever passed to ffmpeg.

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { postDiscord } from "../approval/discord.ts";
import { Helix } from "../liveclips/twitch.ts";
import {
  archiveFileName,
  readArchives,
  eraseSongQueue,
  RelayJob,
  relayDir,
  type Archive,
} from "../relay/job.ts";
import { redact, startPipe, streamlinkArgs, keyOf } from "../relay/pipe.ts";
import { relaySettings, relaySummary } from "../relay/settings.ts";
import { tokenFromEnv, YouTubeLive } from "../relay/youtube.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // the variables may already be set
}

const say = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ at: new Date().toISOString(), level, msg, ...extra }),
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const env = process.env;
const settings = relaySettings(env);
const helix = new Helix(
  env.TWITCH_CLIENT_ID || "",
  env.TWITCH_CLIENT_SECRET || "",
);
const youtube = () => new YouTubeLive(tokenFromEnv(env));
const cmd = process.argv[2];

if (cmd === "watch") {
  if (!settings.enabled) {
    say("info", "relay off (STREAM_RELAY); resting 10 minutes");
    await sleep(10 * 60_000);
    process.exit(0);
  }
  if (!helix.ready) {
    say(
      "warn",
      "relay: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are needed; resting 10 minutes",
    );
    await sleep(10 * 60_000);
    process.exit(0);
  }
  say("info", `relay ${relaySummary(settings)}`);
  const filterCmd =
    settings.musicStrip && settings.musicStripCmd
      ? settings.musicStripCmd
      : undefined;
  const job = new RelayJob({
    settings,
    twitch: {
      live: (login) => helix.liveByLogin(login),
      vodFor: (login, id) => helix.vodFor(login, id),
    },
    yt: youtube(),
    startPipe: (url) =>
      startPipe({
        channel: settings.channel,
        quality: settings.quality,
        url,
        streamlink: settings.streamlink,
        ffmpeg: settings.ffmpeg,
        filterCmd,
        onEvent: (kind, detail) =>
          say(kind === "started" ? "info" : "warn", `relay pipe ${kind}`, {
            detail,
          }),
      }),
    notify: async (text) => {
      say("info", "relay notice", { text });
      await postDiscord(env.DISCORD_WEBHOOK_URL || "", { content: text }).catch(
        () => undefined,
      );
    },
    fetchArchive: (a) => fetchArchive(a),
    now: () => Date.now(),
    log: (level, msg, extra) => say(level, msg, extra),
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
    job.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  while (!stopping) {
    await job
      .tick()
      .catch((err) =>
        say("warn", "relay pass failed", { error: String(err).slice(0, 300) }),
      );
    await sleep(settings.pollSeconds * 1000);
  }
} else if (cmd === "detect") {
  const login = process.argv[3] || settings.channel;
  const live = await helix.liveByLogin(login);
  console.log(
    JSON.stringify(
      { login, live: Boolean(live), stream: live ?? null },
      null,
      2,
    ),
  );
} else if (cmd === "pipe-test") {
  const [login, secs, out] = process.argv.slice(3);
  if (!login || !out) {
    console.error("usage: pipe-test <login> <seconds> <out.ts>");
    process.exit(2);
  }
  const seconds = Number(secs || 60);
  const t0 = Date.now();
  const sl = spawn(
    settings.streamlink,
    [...streamlinkArgs(login, settings.quality)].map((a) =>
      a === "warning" ? "info" : a,
    ),
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const ff = spawn(
    settings.ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-y",
      "-fflags",
      "+genpts+discardcorrupt",
      "-i",
      "pipe:0",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-t",
      String(seconds),
      "-f",
      "mpegts",
      out,
    ],
    {
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  sl.stdout.pipe(ff.stdin);
  ff.stdin.on("error", () => undefined);
  let slLog = "";
  sl.stderr.on("data", (b: Buffer) => (slLog += b.toString()));
  sl.stdout.on("error", () => undefined);
  let ffLog = "";
  ff.stderr.on("data", (b: Buffer) => (ffLog += b.toString()));
  await new Promise<void>((r) => ff.on("exit", () => r()));
  sl.kill("SIGTERM");
  const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0;
  console.log(
    JSON.stringify(
      {
        login,
        seconds,
        wallSeconds: Math.round((Date.now() - t0) / 1000),
        bytes,
        streamlink: slLog.trim().split("\n").slice(-12),
        ffmpeg: ffLog.trim().split("\n").slice(-5),
      },
      null,
      2,
    ),
  );
} else if (cmd === "yt-test") {
  const seconds = Number(process.argv[3] || 120);
  const yt = youtube();
  const ingest = await yt.ingest();
  const id = await yt.createBroadcast({
    title: `Pulse relay test ${new Date().toISOString().slice(0, 16).replace("T", " ")} (private)`,
    description:
      "A private test of the Twitch to YouTube relay: a test pattern and a tone. Not public.",
    privacy: "private",
    start: new Date(),
  });
  await yt.bind(id, ingest.streamId);
  say("info", "private test broadcast made and bound", {
    broadcast: id,
    stream: ingest.streamId,
  });
  const ff = spawn(
    settings.ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-re",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-b:v",
      "2500k",
      "-maxrate",
      "2500k",
      "-bufsize",
      "5000k",
      "-g",
      "60",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-t",
      String(seconds + 30),
      "-f",
      "flv",
      ingest.url,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let ffErr = "";
  ff.stderr.on(
    "data",
    (b: Buffer) =>
      (ffErr = redact((ffErr + b.toString()).slice(-600), [
        ingest.url,
        keyOf(ingest.url),
      ])),
  );
  const seen: Array<Record<string, unknown>> = [];
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000 && ff.exitCode === null) {
    await sleep(15_000);
    const [st, b] = await Promise.all([
      yt.stream(ingest.streamId).catch(() => undefined),
      yt.broadcast(id).catch(() => undefined),
    ]);
    const row = {
      t: Math.round((Date.now() - t0) / 1000),
      streamStatus: st?.status,
      health: st?.health,
      broadcast: b?.lifeCycle,
      privacy: b?.privacy,
    };
    seen.push(row);
    say("info", "test status", row);
  }
  const before = await yt.broadcast(id).catch(() => undefined);
  if (before && ["live", "testing"].includes(before.lifeCycle))
    await yt
      .end(id)
      .catch((e) => say("warn", "end failed", { error: String(e) }));
  ff.kill("SIGTERM");
  await sleep(5_000);
  const after = await yt.broadcast(id).catch(() => undefined);
  console.log(
    JSON.stringify(
      {
        broadcast: id,
        url: `https://www.youtube.com/watch?v=${id}`,
        seen,
        endedAs: after?.lifeCycle,
        privacy: after?.privacy,
        ffmpegErrors: ffErr.trim() || null,
      },
      null,
      2,
    ),
  );
} else if (cmd === "status") {
  const state = (() => {
    try {
      return JSON.parse(
        fs.readFileSync(
          path.join(relayDir(settings.dataDir), "state.json"),
          "utf8",
        ),
      );
    } catch {
      return {};
    }
  })();
  const archives = readArchives(settings.dataDir);
  console.log(
    JSON.stringify(
      {
        settings: relaySummary(settings),
        state,
        archives: archives.length,
        eraseSongPending: eraseSongQueue(archives).map((a) => a.url),
      },
      null,
      2,
    ),
  );
} else {
  console.error(
    "usage: stream-relay.ts watch | detect [login] | pipe-test <login> <seconds> <out.ts> | yt-test [seconds] | status",
  );
  process.exit(2);
}

/** The YouTube archive into the recordings folder, through the Mac's turn-taking (a batch download can wait). */
function fetchArchive(a: Archive): Promise<string> {
  const file = path.join(settings.vodDir, archiveFileName(a));
  const macrun = path.join(os.homedir(), "orch", "macrun.sh");
  const ytdlp = [
    settings.ytdlp,
    "-q",
    "--no-part",
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format",
    "mp4",
    "-o",
    file,
    a.url,
  ];
  const [c, args] = fs.existsSync(macrun)
    ? ["/bin/bash", [macrun, "pulse-relay-archive", ...ytdlp]]
    : [ytdlp[0]!, ytdlp.slice(1)];
  fs.mkdirSync(settings.vodDir, { recursive: true });
  return new Promise((resolve, reject) =>
    execFile(
      c,
      args,
      {
        timeout: 6 * 3_600_000,
        env: { ...process.env, MACRUN_WAIT_MIN: "240" },
      },
      (err) =>
        err
          ? reject(err)
          : fs.existsSync(file)
            ? resolve(file)
            : reject(new Error("yt-dlp wrote no file")),
    ),
  );
}
