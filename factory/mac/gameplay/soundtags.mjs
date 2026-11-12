// What can be heard in game audio, by Apple's Sound Analysis on the Mac mini (APPLE_SOUND_TAGS, 12 Nov 2026):
// src/assets/applesound.py runs the built-in classifier (about 300 sounds) over a recording's audio, and this
// turns its windows into the tags the highlight finder scores (explosions, crashes, gunfire, laughter, crowd,
// shouting, engines, music, speech) and the spans where someone is talking. Plain JavaScript, so the finder
// (find-highlights.mjs, run by plain node) and the factory (src/assets/applesound.ts) share one copy.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

/** The finder's tags, each the classifier's labels that mean it. */
export const SOUND_TAGS = {
  explosion: [
    "boom",
    "artillery_fire",
    "eruption",
    "fireworks",
    "firecracker",
    "thunder",
  ],
  gunfire: ["gunshot_gunfire", "artillery_fire"],
  crash: [
    "glass_breaking",
    "vehicle_skidding",
    "crushing",
    "thump_thud",
    "slap_smack",
    "wood_cracking",
    "door_slam",
  ],
  laughter: [
    "laughter",
    "belly_laugh",
    "giggling",
    "chuckle_chortle",
    "snicker",
  ],
  crowd: ["crowd", "cheering", "applause", "booing", "chatter", "babble"],
  shout: ["shout", "yell", "battle_cry", "screaming", "children_shouting"],
  engine: [
    "engine_accelerating_revving",
    "race_car",
    "motorcycle",
    "engine_starting",
    "car_horn",
    "siren",
    "police_siren",
  ],
  music: ["music"],
  speech: ["speech", "whispering", "chatter"],
};

/** How much each tag lifts a second's excitement in the finder (speech and music lift nothing: they are not action). */
export const TAG_WEIGHTS = {
  explosion: 2.4,
  gunfire: 1.8,
  crash: 1.6,
  shout: 1.4,
  laughter: 1.2,
  crowd: 1.0,
  engine: 0.6,
  music: 0,
  speech: 0,
};

/** A window counts for a label at this confidence. */
export const MIN_CONFIDENCE = 0.35;

/**
 * Tags heard in each whole second (pure): windows = applesound.py's [{t, d, top: [[label, confidence]]}].
 * Returns an array of length `seconds` (or the audio's own length), each a sorted list of tags.
 */
export function tagsPerSecond(
  windows,
  seconds,
  minConfidence = MIN_CONFIDENCE,
) {
  const end = Math.ceil(
    seconds ??
      Math.max(0, ...(windows ?? []).map((w) => (w.t ?? 0) + (w.d ?? 0))),
  );
  const out = Array.from({ length: Math.max(0, end) }, () => new Set());
  for (const w of windows ?? []) {
    const tags = new Set();
    for (const [label, confidence] of w.top ?? []) {
      if (!(confidence >= minConfidence)) continue;
      for (const [tag, labels] of Object.entries(SOUND_TAGS))
        if (labels.includes(label)) tags.add(tag);
    }
    if (!tags.size) continue;
    // A window is about three seconds and overlaps the next by half: its tags belong to its middle second or two,
    // so a gunshot does not smear across three seconds of the score.
    const from = Math.max(0, Math.floor((w.t ?? 0) + (w.d ?? 0) / 4));
    const to = Math.min(out.length, Math.ceil((w.t ?? 0) + (w.d ?? 0) * 0.75));
    for (let s = from; s < to; s++) for (const t of tags) out[s].add(t);
  }
  return out.map((s) => [...s].sort());
}

/** Each second's lift for the finder's excitement score (pure): the strongest tag heard, not the sum. */
export function soundBonus(tags) {
  return tags.map((ts) => Math.max(0, ...ts.map((t) => TAG_WEIGHTS[t] ?? 0)));
}

/**
 * Where someone is talking (pure): [{from, to}] in seconds, windows whose speech confidence reaches `min`, merged
 * across gaps under `gap` seconds. Flags a cutscene's spoken lines and a streamer's commentary.
 */
export function speechSpans(windows, min = 0.5, gap = 1) {
  const spans = [];
  for (const w of [...(windows ?? [])].sort((a, b) => a.t - b.t)) {
    const heard = (w.top ?? []).some(
      ([label, confidence]) =>
        SOUND_TAGS.speech.includes(label) && confidence >= min,
    );
    if (!heard) continue;
    const from = w.t + w.d / 4;
    const to = w.t + (w.d * 3) / 4;
    const last = spans[spans.length - 1];
    if (last && from - last.to <= gap) last.to = Math.max(last.to, to);
    else spans.push({ from, to });
  }
  return spans.map((s) => ({
    from: Math.round(s.from * 100) / 100,
    to: Math.round(s.to * 100) / 100,
  }));
}

/** The share of `seconds` covered by speech spans (pure), 0-1. */
export function speechShare(spans, seconds) {
  if (!(seconds > 0)) return 0;
  const said = spans.reduce(
    (n, s) => n + Math.max(0, Math.min(seconds, s.to) - Math.max(0, s.from)),
    0,
  );
  return Math.min(1, said / seconds);
}

/** True for "on", "true", "yes" and "1" (the factory's bool settings). */
export function soundTagsOn(raw = process.env.APPLE_SOUND_TAGS) {
  return ["on", "true", "yes", "1"].includes(
    String(raw ?? "")
      .trim()
      .toLowerCase(),
  );
}

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "assets",
  "applesound.py",
);

/** The command for one classification run; undefined off the Mac. */
export function soundCommand(platform, wav, python) {
  if (platform !== "darwin") return undefined;
  return {
    cmd:
      python ||
      process.env.MAC_OCR_PYTHON ||
      path.join(os.homedir(), "PulseFactory", "ocr", "bin", "python"),
    args: ["-I", SCRIPT, wav, "0.1"],
  };
}

/**
 * Apple's sound windows for a file's audio, or undefined off the Mac, with no audio, or on any failure. The audio is
 * taken out as 16 kHz mono first (the classifier's own rate); about a second of work for a ten-minute recording.
 */
export async function classifySound(file, o = {}) {
  const command = soundCommand(o.platform ?? process.platform, "", o.python);
  if (!command) return undefined;
  const ffmpeg = o.ffmpeg ?? "ffmpeg";
  const wav = path.join(
    os.tmpdir(),
    `pulse-sound-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );
  try {
    const args = ["-v", "error", "-y"];
    if (o.from !== undefined) args.push("-ss", String(o.from));
    args.push("-i", file);
    if (o.seconds !== undefined) args.push("-t", String(o.seconds));
    args.push("-vn", "-ac", "1", "-ar", "16000", wav);
    await run(ffmpeg, args, { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
    command.args[2] = wav;
    const { stdout } = await run(command.cmd, command.args, {
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const body = JSON.parse(stdout);
    if (body.error && !body.windows?.length) return undefined;
    return body.windows ?? [];
  } catch {
    return undefined;
  } finally {
    await fs.rm(wav, { force: true }).catch(() => undefined);
  }
}
