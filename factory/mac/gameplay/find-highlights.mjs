// Finds the best moments in new gameplay recordings (TinoTV Twitch VODs, Xbox
// clips, anything dropped in the "Drop clips here" folder) and cuts each one
// into a 40-second candidate clip for the Pulse Factory gameplay lane.
//
// Free and local: scores every second of a recording by sudden loudness
// (crashes, explosions, gunfire, shouting) and on-screen action (scene
// changes), then keeps the strongest non-overlapping windows. With
// APPLE_SOUND_TAGS on (the Mac mini only), Apple's Sound Analysis also names
// what is heard (soundtags.mjs): explosions, gunfire, crashes, shouting and
// laughter lift a second's score, and each clip's meta.json lists its sounds
// and where someone is talking.
//
//   node find-highlights.mjs            process new recordings
//   node find-highlights.mjs --dry      score only, cut nothing
//
// Output: <GAMEPLAY_ROOT>/inbox/<id>/clip.mp4, frames/*.jpg, meta.json
// The Pulse Factory lane reads the inbox; see INBOX-CONTRACT.md.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  classifySound,
  soundBonus,
  soundTagsOn,
  speechShare,
  speechSpans,
  tagsPerSecond,
} from "./soundtags.mjs";

const run = promisify(execFile);
const HOME = os.homedir();
const ROOT =
  process.env.GAMEPLAY_ROOT || path.join(HOME, "Videos", "Pulse Gameplay");
const WATCH = process.env.GAMEPLAY_WATCH
  ? [
      ...process.env.GAMEPLAY_WATCH.split(";"),
      path.join(ROOT, "Drop clips here"),
    ]
  : [
      path.join(HOME, "Videos", "TinoTV VODs"),
      path.join(HOME, "Videos", "Captures", "Xbox DVR"),
      path.join(ROOT, "Drop clips here"),
    ];
const INBOX = path.join(ROOT, "inbox");
const STATE = path.join(ROOT, "state.json");
const NTFY = "https://ntfy.sh/leonida-alerts-547db63b3fb46528bf";
const VIDEO = /\.(mp4|mkv|mov|webm)$/i;
// The PC's copy uses the 4090; the Mac has no NVENC (4 Nov 2026: every cut failed "Unrecognized option 'cq'").
// libx264 at these settings came within 0.001 SSIM of the PC's cut against the source (4 Nov 2026), in 7 s on the M4.
const VIDEO_ENCODER =
  process.platform === "darwin"
    ? ["libx264", "-preset", "fast", "-crf", "15"]
    : ["h264_nvenc", "-preset", "p5", "-cq", "19"];
const CLIP_SECONDS = 40;
const MIN_GAP_SECONDS = 90;
const DRY = process.argv.includes("--dry");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function ffprobeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(stdout.trim()) || 0;
}

// Loudness (RMS dB) for every second of audio.
async function loudnessPerSecond(file) {
  const { stderr } = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-af",
      "asetnsamples=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 1 << 28 },
  ).catch((e) => ({ stderr: e.stderr || "" }));
  return [...stderr.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) =>
    m[1] === "-inf" ? -90 : Math.max(-90, Number(m[1])),
  );
}

// Scene-change score per keyframe, bucketed per second (keyframes only, so a
// three-hour VOD takes a few minutes, not an hour).
async function motionPerSecond(file, seconds) {
  const { stderr } = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-skip_frame",
      "nokey",
      "-i",
      file,
      "-an",
      "-vf",
      "scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score",
      "-fps_mode",
      "passthrough",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 1 << 28 },
  ).catch((e) => ({ stderr: e.stderr || "" }));
  const out = new Array(Math.ceil(seconds) + 1).fill(0);
  let t = null;
  for (const line of stderr.split("\n")) {
    const pt = line.match(/pts_time:([\d.]+)/);
    if (pt) t = Number(pt[1]);
    const sc = line.match(/scene_score=([\d.]+)/);
    if (sc && t !== null) {
      const i = Math.min(out.length - 1, Math.floor(t));
      out[i] = Math.max(out[i], Number(sc[1]));
    }
  }
  // Keyframes are ~2s apart on Twitch; spread each score over its gap.
  for (let i = 1; i < out.length; i++) if (!out[i]) out[i] = out[i - 1] * 0.9;
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// Per-second excitement: loudness above the local baseline (a rolling
// two-minute median, so quiet and loud games are judged on their own terms)
// plus on-screen action, plus (APPLE_SOUND_TAGS) what Apple heard there.
function excitement(loud, motion, bonus) {
  const n = Math.min(loud.length, motion.length);
  const score = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 60),
      hi = Math.min(n, i + 60);
    const base = median(loud.slice(lo, hi));
    const spike = Math.max(0, loud[i] - base); // dB above baseline
    const silent = loud[i] < -55; // menus, pauses, loading screens
    score[i] = silent ? 0 : spike * 0.12 + motion[i] * 3 + (bonus?.[i] ?? 0);
  }
  return score;
}

// LIVE_CLIPS (src/liveclips): the stretches of each broadcast the live clipper already cut, by VOD id, in seconds
// from the VOD's start: { "v2923231248": [[4520, 4560]] }. The VOD's id is in its file name ("[v2923231248]").
async function liveTaken(file) {
  const vod = path.basename(file).match(/\[(v\d+)\]/)?.[1];
  if (!vod) return [];
  try {
    const all = JSON.parse(
      await fs.readFile(path.join(ROOT, "live_taken.json"), "utf8"),
    );
    return Array.isArray(all[vod]) ? all[vod] : [];
  } catch {
    return [];
  }
}

function pickWindows(score, duration) {
  const want = Math.max(2, Math.min(12, Math.round(duration / 60 / 12)));
  const windows = [];
  for (let s = 0; s + CLIP_SECONDS <= score.length; s += 5) {
    const slice = score.slice(s, s + CLIP_SECONDS);
    const peak = Math.max(...slice);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    windows.push({ start: s, peak, mean, value: peak * 0.6 + mean * 0.4 });
  }
  windows.sort((a, b) => b.value - a.value);
  const kept = [];
  for (const w of windows) {
    if (kept.length >= want) break;
    if (w.value < 0.6) break; // nothing exciting left
    if (kept.some((k) => Math.abs(k.start - w.start) < MIN_GAP_SECONDS))
      continue;
    // Start the clip a few seconds before the peak so the build-up is kept.
    const slice = score.slice(w.start, w.start + CLIP_SECONDS);
    const peakAt = w.start + slice.indexOf(w.peak);
    const start = Math.max(0, Math.min(peakAt - 14, duration - CLIP_SECONDS));
    kept.push({ ...w, start, peakAt });
  }
  return kept.sort((a, b) => a.start - b.start);
}

// What a cut clip sounds like (APPLE_SOUND_TAGS): its tags by seconds heard, and its spoken lines, in clip time.
function clipSound(windows, tags, w, duration) {
  const from = w.start;
  const seconds = w.whole ? Math.round(duration) : CLIP_SECONDS;
  const heard = {};
  for (const ts of tags.slice(from, from + seconds))
    for (const t of ts) heard[t] = (heard[t] || 0) + 1;
  const speech = speechSpans(windows)
    .map((s) => ({ from: s.from - from, to: s.to - from }))
    .filter((s) => s.to > 0 && s.from < seconds)
    .map((s) => ({ from: Math.max(0, s.from), to: Math.min(seconds, s.to) }));
  return {
    tags: heard,
    speech,
    speech_share: Number(speechShare(speech, seconds).toFixed(2)),
  };
}

// "2026-11-19 Testing: can you swim away from 5 stars [v123].mp4" -> title
function recordingTitle(file) {
  const base = path.basename(file).replace(VIDEO, "");
  return (
    base
      .replace(/^\d{4}-\d{2}-\d{2}\s*/, "")
      .replace(/\s*\[[^\]]+\]$/, "")
      .trim() || base
  );
}

async function cut(file, w, dir) {
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(w.start),
    "-i",
    file,
    "-t",
    String(CLIP_SECONDS),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    ...VIDEO_ENCODER,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    path.join(dir, "clip.mp4"),
  ]);
  // Eight frames across the clip for a quick visual review.
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    path.join(dir, "clip.mp4"),
    "-vf",
    `fps=8/${CLIP_SECONDS},scale=480:-2`,
    "-frames:v",
    "8",
    path.join(dir, "frames", "%02d.jpg"),
  ]);
}

// Xbox auto-upload puts clips in a folder such as OneDrive\Videos\Xbox Game DVR.
// Looked up on every run: it doesn't exist until the first clip uploads, and the
// name varies by console version.
async function oneDriveXboxFolders() {
  const root =
    process.env.GAMEPLAY_ONEDRIVE ||
    process.env.OneDriveConsumer ||
    path.join(HOME, "OneDrive");
  const found = [];
  for (const parent of [root, path.join(root, "Video"), path.join(root, "Videos")]) {
    const entries = await fs
      .readdir(parent, { withFileTypes: true })
      .catch(() => []);
    for (const e of entries)
      if (e.isDirectory() && /xbox/i.test(e.name))
        found.push(path.join(parent, e.name));
  }
  return found;
}

// The same clip can arrive twice: OneDrive upload and USB into "Drop clips here".
const sameClip = (full, size) => `${path.basename(full).toLowerCase()}|${size}`;

async function listRecordings() {
  const files = [];
  for (const dir of [...WATCH, ...(await oneDriveXboxFolders())]) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      // yt-dlp's half-finished copies (name.temp.mp4, .part): the finished file is cut instead (27 Oct 2026: a .temp.mp4 doubled every clip).
      if (
        !e.isFile() ||
        !VIDEO.test(e.name) ||
        /\.(temp|part)\.\w+$|\.part$|\.ytdl$/i.test(e.name)
      )
        continue;
      const full = path.join(e.parentPath || e.path || dir, e.name);
      const st = await fs.stat(full);
      if (Date.now() - st.mtimeMs < 10 * 60_000) continue; // still being written
      files.push({ full, key: `${full}|${st.size}`, size: st.size });
    }
  }
  return files;
}

async function main() {
  await fs.mkdir(INBOX, { recursive: true });
  await fs.mkdir(path.join(ROOT, "Drop clips here"), { recursive: true });
  const firstRun = !(await fs.stat(STATE).catch(() => null));
  const state = JSON.parse(
    await fs.readFile(STATE, "utf8").catch(() => '{"done":{}}'),
  );
  if (firstRun && !process.argv.includes("--include-existing")) {
    // First run: everything already on disk is old footage, so only record it
    // as seen. Recordings made from now on get processed.
    for (const f of await listRecordings()) state.done[f.key] = "baseline";
    await fs.writeFile(STATE, JSON.stringify(state, null, 2));
    log(
      `first run: ${Object.keys(state.done).length} existing recording(s) marked as already seen`,
    );
    return;
  }
  const seen = new Set(
    Object.keys(state.done).map((key) => {
      const [full, size] = key.split("|");
      return sameClip(full, size);
    }),
  );
  const todo = (await listRecordings()).filter((f) => {
    const clip = sameClip(f.full, f.size);
    if (seen.has(clip)) return false;
    seen.add(clip);
    return true;
  });
  log(`${todo.length} new recording(s)`);
  let total = 0;
  for (const f of todo) {
    // One unreadable recording (or a OneDrive file that can't download yet) must
    // not stop the rest. It isn't marked done, so the next run tries it again.
    try {
    const duration = await ffprobeDuration(f.full);
    const title = recordingTitle(f.full);
    log(`scoring "${title}" (${Math.round(duration / 60)} min)`);
    let windows;
    // APPLE_SOUND_TAGS (Mac only, off until switched on): Apple's sound windows for the whole recording.
    const sound = soundTagsOn() ? await classifySound(f.full) : undefined;
    const tags = sound ? tagsPerSecond(sound, Math.ceil(duration)) : undefined;
    if (duration <= 75) {
      windows = [{ start: 0, peakAt: 0, value: 1, whole: true }]; // a short Xbox clip is already the moment
    } else {
      const [loud, motion] = await Promise.all([
        loudnessPerSecond(f.full),
        motionPerSecond(f.full, duration),
      ]);
      windows = pickWindows(
        excitement(loud, motion, tags && soundBonus(tags)),
        duration,
      );
      // LIVE_CLIPS: a moment already cut from this broadcast while it was live is not cut again from its VOD.
      const taken = await liveTaken(f.full);
      if (taken.length)
        windows = windows.filter(
          (w) =>
            !taken.some(
              ([from, to]) =>
                w.start < to + 30 && w.start + CLIP_SECONDS > from - 30,
            ),
        );
    }
    log(`  ${windows.length} moment(s)`);
    for (const w of windows) {
      const id =
        "gp_" +
        crypto
          .createHash("sha1")
          .update(`${f.key}|${w.start}`)
          .digest("hex")
          .slice(0, 10);
      const dir = path.join(INBOX, id);
      if (DRY) {
        log(`  would cut ${id} at ${w.start}s (score ${w.value.toFixed(2)})`);
        continue;
      }
      if (w.whole) {
        await fs.mkdir(path.join(dir, "frames"), { recursive: true });
        await fs.copyFile(f.full, path.join(dir, "clip.mp4"));
        await run("ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          f.full,
          "-vf",
          `fps=8/${Math.max(1, duration)},scale=480:-2`,
          "-frames:v",
          "8",
          path.join(dir, "frames", "%02d.jpg"),
        ]);
      } else await cut(f.full, w, dir);
      const meta = {
        id,
        status: "new",
        source: {
          file: f.full,
          title,
          kind: f.full.includes("TinoTV") ? "twitch_vod" : "xbox_clip",
          duration_seconds: Math.round(duration),
        },
        clip: {
          file: "clip.mp4",
          start_in_source: w.start,
          peak_in_clip: w.whole ? null : w.peakAt - w.start,
          seconds: w.whole ? Math.round(duration) : CLIP_SECONDS,
        },
        score: Number(w.value.toFixed(3)),
        ...(sound ? { sound: clipSound(sound, tags, w, duration) } : {}),
        frames: (await fs.readdir(path.join(dir, "frames"))).map(
          (n) => `frames/${n}`,
        ),
        created_at: new Date().toISOString(),
      };
      await fs.writeFile(
        path.join(dir, "meta.json"),
        JSON.stringify(meta, null, 2),
      );
      total++;
    }
    if (!DRY) {
      state.done[f.key] = new Date().toISOString();
      await fs.writeFile(STATE, JSON.stringify(state, null, 2));
    }
    } catch (e) {
      log(`  skipped for now: ${f.full}: ${e?.message || e}`);
    }
  }
  // At most one phone alert an hour: this runs every 15 minutes during launch.
  if (!DRY) state.unnotified = (state.unnotified || 0) + total;
  const alertDue =
    !state.notifiedAt ||
    Date.now() - Date.parse(state.notifiedAt) >= 60 * 60_000;
  if (!DRY && state.unnotified && alertDue) {
    try {
      await fetch(NTFY, {
        method: "POST",
        body: `${state.unnotified} gameplay moment(s) cut. Pulse Factory will turn the best into Shorts for your approval.`,
        headers: { Title: "Gameplay moments found", Tags: "video_game" },
      });
      state.unnotified = 0;
      state.notifiedAt = new Date().toISOString();
    } catch {}
  }
  if (!DRY && total) await fs.writeFile(STATE, JSON.stringify(state, null, 2));
  log(`done: ${total} clip(s) in ${INBOX}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
