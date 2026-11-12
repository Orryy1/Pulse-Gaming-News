// Measures the retrospective proof render (sandbox only): loudness (whole mix, the narration under speech, the voice
// file), Whisper against the script, the share of narration that plays over moving footage, the seconds of character
// quotes and of the game's own sound, a full-frame-rate black-flash scan, a contact sheet and a 20 s excerpt.
//   node --import tsx data/smoke/retro_measure.mts <sandbox data dir> <out dir>      (the episode id is in <out>/episode.txt)
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const [SB, OUT] = process.argv.slice(2);
const ID = fs.readFileSync(path.join(OUT!, "episode.txt"), "utf8").trim();
const { openDb } = await import("../../src/db.ts");
const { narrationOf } = await import("../../src/editorial/schema.ts");
const { clipSoundKind } = await import("../../src/assets/gameaudio.ts");
const db = await openDb("", SB!);
const [ep] = await db.query<any>("SELECT script_json, assets_json FROM episodes WHERE id = $1", [ID]);
const ev = await db.query<any>("SELECT kind, detail FROM events WHERE episode_id = $1 AND kind IN ('game_audio','character_quote') ORDER BY id", [ID]);
await db.close();
const a = ep.assets_json;
const dir = path.join(SB!, "episodes", ID);
const video = path.join(dir, a.video ?? "short.mp4");
const voice = path.join(dir, a.audio);
const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 1024 });
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const lufs = (file: string, spans?: Array<[number, number]>): number | null => {
  if (!fs.existsSync(file)) return null;
  const s = (spans ?? []).filter(([x, y]) => y - x > 0.02);
  const af = spans ? `aselect='${s.map(([x, y]) => `between(t\\,${x.toFixed(3)}\\,${y.toFixed(3)})`).join("+")}',asetpts=N/SR/TB,ebur128` : "ebur128";
  if (spans && !s.length) return null;
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", af, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const m = String(r.stderr).match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/);
  return m ? Number(m[1]) : null;
};
const words: Array<{ start: number; end: number; text: string }> = a.words ?? [];
const quotes: any[] = a.quotes ?? [];
const dur = Number(a.durationSeconds);
const speech: Array<[number, number]> = [];
for (const w of words) {
  const l = speech.at(-1);
  if (l && w.start - l[1] < 0.35) l[1] = Math.max(l[1], w.end);
  else speech.push([w.start, w.end]);
}
const res: any = { id: ID, duration_s: r3(dur), minutes: Math.round((dur / 60) * 10) / 10 };
res.lufs_final = lufs(video);
res.lufs_final_under_speech = lufs(video, speech);
res.lufs_voice_file = lufs(voice);
// ---------------------------------------------------------------- footage
const plan = a.longPlan;
const fps = plan?.fps ?? 30;
const shots: any[] = plan?.shots ?? [];
const clipShots = shots.filter((s) => s.media?.type === "clip");
const inClip = (t: number) => clipShots.some((s) => t >= s.start / fps && t < s.end / fps);
let spoken = 0, moving = 0;
for (const [x, y] of speech) for (let t = x; t < y; t += 0.1) { spoken += 0.1; if (inClip(t)) moving += 0.1; }
res.narration_seconds = r3(spoken);
res.narration_over_moving_footage_s = r3(moving);
res.narration_over_moving_footage_share = spoken ? Math.round((moving / spoken) * 1000) / 1000 : null;
res.screen_by_media = Object.fromEntries(["clip", "image", "plate", "filler"].map((k) => [k, r3(shots.filter((s) => s.media?.type === k).reduce((n, s) => n + (s.end - s.start) / fps, 0))]));
const clips: any[] = a.clips ?? [];
const kinds: Record<string, number> = {};
for (const s of clipShots) {
  const c = clips[s.media.index];
  const k = c ? (/^Cutscenes for "/.test(c.provenance) ? "cutscene (scene index / movie)" : /^Pulse's own/.test(c.provenance) ? "owner's own capture" : /trailer/i.test(c.provenance) ? "official trailer" : "gameplay") : "?";
  kinds[k] = r3((kinds[k] ?? 0) + (s.end - s.start) / fps);
}
res.clip_screen_seconds_by_source = kinds;
// ---------------------------------------------------------------- quotes and game sound
res.quotes = quotes.map((q) => ({ speaker: q.speaker, text: q.text, start: r3(q.start), seconds: r3(q.seconds) }));
res.quote_seconds = r3(quotes.reduce((n, q) => n + Number(q.seconds || 0), 0));
const ga = ev.filter((e) => e.kind === "game_audio").at(-1)?.detail;
res.game_audio_event = ga ? { on: ga.on, hearable: ga.hearable, heard: (ga.heard ?? []).length } : null;
const heardIdx = new Set((ga?.heard ?? []).map((h: any) => h.index));
res.game_sound_screen_seconds = r3(clipShots.filter((s) => heardIdx.has(s.media.index) || (clips[s.media.index]?.audio && clipSoundKind(clips[s.media.index]) !== "none")).reduce((n, s) => n + (s.end - s.start) / fps, 0));
res.quote_events = ev.filter((e) => e.kind === "character_quote").map((e) => e.detail);
// ---------------------------------------------------------------- Whisper
const wav = path.join(OUT!, "asr.wav");
ff(["-y", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", wav]);
const r = await fetch("http://127.0.0.1:8877/transcribe", { method: "POST", headers: { "content-type": "application/octet-stream", "x-pulse-audio-duration-seconds": dur.toFixed(2) }, body: new Uint8Array(fs.readFileSync(wav)) }).catch(() => undefined);
const asr: any = r ? await r.json().catch(() => ({})) : {};
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const heardText = asr.text ?? (asr.words ?? []).map((w: any) => w.word ?? w.text).join(" ");
const heard = norm(heardText);
const align = (said: string[]) => {
  const L = Array.from({ length: said.length + 1 }, () => new Int32Array(heard.length + 1));
  for (let i = said.length - 1; i >= 0; i--) for (let j = heard.length - 1; j >= 0; j--) L[i]![j] = said[i] === heard[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  return { words: said.length, matched: L[0]![0], share: said.length ? Math.round((L[0]![0]! / said.length) * 1000) / 1000 : null };
};
const said = norm(narrationOf({ ...ep.script_json, voice_tags: undefined }).replace(/\[[^\]]*\]/g, " "));
res.whisper = { narration: align(said), quotes: quotes.map((q) => ({ text: q.text, ...align(norm(q.text)) })) };
fs.writeFileSync(path.join(OUT!, "transcript.txt"), heardText);
fs.rmSync(wav, { force: true });
// ---------------------------------------------------------------- black flashes (every frame), contact sheet, excerpt
const st = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
const yav = [...String(st.stdout).matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
const dark = yav.flatMap((y, i) => (y < 18 ? [i] : []));
res.frames_scanned = yav.length;
res.dark_frames = dark.length;
res.black_flashes = dark.filter((f) => (yav[f - 1] ?? 0) > 40 || (yav[f + 1] ?? 0) > 40).map((f) => r3(f / fps));
const every = Math.max(2, Math.round(dur / 48));
ff(["-y", "-v", "error", "-i", video, "-vf", `fps=1/${every},scale=320:180,tile=8x6:padding=4`, "-frames:v", "1", path.join(OUT!, "contact_sheet.jpg")]);
res.contact_sheet_every_s = every;
const q0 = quotes[0];
const from = Math.max(0, q0 ? q0.start - 8 : 60);
res.excerpt_from = r3(from);
ff(["-y", "-v", "error", "-ss", from.toFixed(2), "-t", "20", "-i", video, "-c:v", "libx264", "-crf", "20", "-preset", "fast", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", path.join(OUT!, "excerpt_20s.mp4")]);
fs.writeFileSync(path.join(OUT!, "measurements.json"), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 1));
