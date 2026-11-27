// Measures a game-audio proof Short (sandbox only): narration LUFS under speech, the game bed under the voice, in the
// gaps the bed swells into and under the quotes, the final mix, Whisper against the script, the quote's lip sync
// (the clip's own picture and sound against the scene index's proxy, and where the Short plays them), the bed's
// cutscene pieces against the proxy, full-frame-rate black flashes, a contact sheet and a 10 s excerpt.
// Usage: node --import tsx data/smoke/_gameaudio_measure.mts <episode id> <sandbox data dir> <out dir>
// 12 Nov 2026 fixes: the aselect expression's commas are escaped for the filtergraph (every LUFS figure was null),
// and gaps are found the way the bed finds them (GAP_MIN_SECONDS between held speech), not a stricter rule of its own.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const [ID, SB, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT!, { recursive: true });
const { openDb } = await import("../../src/db.ts");
const { narrationOf } = await import("../../src/editorial/schema.ts");
const { WORD_LEAD, WORD_TAIL, GAP_MIN_SECONDS, cutsceneSource, clipSoundKind } = await import("../../src/assets/gameaudio.ts");
const db = await openDb("", SB!);
const [ep] = await db.query<any>("SELECT script_json, assets_json FROM episodes WHERE id = $1", [ID]);
await db.close();
const a = ep.assets_json;
const dir = path.join(SB!, "episodes", ID!);
const short = path.join(dir, "short.mp4");
const bed = path.join(dir, "game_bed.wav");
const voice = path.join(dir, a.audio);
const ff = (args: string[]) =>
  execFileSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 });
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- loudness
// ebur128 prints its summary to stderr even on success. Inside a filtergraph a comma separates filters, so the
// commas of between(t,a,b) must reach ffmpeg escaped as "\,": in this source that is "\\,".
const lufs = (file: string, spans: Array<[number, number]>): number | null => {
  const s = spans.filter(([x, y]) => y - x > 0.02);
  if (!s.length || !fs.existsSync(file)) return null;
  const expr = s.map(([x, y]) => `between(t\\,${x.toFixed(3)}\\,${y.toFixed(3)})`).join("+");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `aselect='${expr}',asetpts=N/SR/TB,ebur128`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const m = String(r.stderr).match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/);
  if (!m) return null;
  const v = Number(m[1]);
  return v <= -69.9 ? -70 : v; // ebur128's floor: silent (or quieter than its gate)
};
// RMS in dBFS, for spans too short or too quiet for the gated LUFS measure.
const rmsDb = (file: string, spans: Array<[number, number]>): number | null => {
  const s = spans.filter(([x, y]) => y - x > 0.02);
  if (!s.length || !fs.existsSync(file)) return null;
  const raw = ff(["-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
  const x = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  let sum = 0, n = 0;
  for (const [a0, b0] of s) for (let i = Math.floor(a0 * 16000); i < Math.min(x.length, Math.ceil(b0 * 16000)); i++) { sum += x[i]! * x[i]!; n++; }
  return n ? Math.round(10 * Math.log10(sum / n + 1e-12) * 10) / 10 : null;
};

const words: Array<{ start: number; end: number; text: string }> = a.words ?? [];
const quotes: Array<any> = a.quotes ?? [];
const dur = Number(a.durationSeconds);
const inQ = (t: number) => quotes.some((q) => t >= q.start - 0.1 && t < q.start + q.seconds + 0.1);
// Speech as the bed's envelope holds it: each word with its lead and tail, joined across pauses under GAP_MIN_SECONDS.
const held: Array<[number, number]> = [];
for (const w of words) {
  const x = w.start - WORD_LEAD, y = w.end + WORD_TAIL;
  const l = held.at(-1);
  if (l && x - l[1] < GAP_MIN_SECONDS) l[1] = Math.max(l[1], y);
  else held.push([x, y]);
}
const gaps: Array<[number, number]> = [];
for (let i = 0; i + 1 < held.length; i++) {
  const x = held[i]![1], y = held[i + 1]![0];
  if (y - x >= GAP_MIN_SECONDS && !inQ(x + 0.01) && !inQ(y - 0.01)) gaps.push([x, y]);
}
const speech = held.filter(([x, y]) => !inQ(x) && !inQ(y));
const qspans = quotes.map((q) => [q.start, q.start + q.seconds] as [number, number]);
const res: any = { id: ID, duration: r3(dur), quotes: quotes.map((q) => ({ id: q.id, speaker: q.speaker, text: q.text, start: q.start, seconds: q.seconds })) };
res.narration_lufs_speech = lufs(voice, speech);
res.bed_lufs_under_voice = lufs(bed, speech);
res.bed_rms_under_voice_db = rmsDb(bed, speech);
res.bed_lufs_in_gaps = lufs(bed, gaps);
res.bed_rms_in_gaps_db = rmsDb(bed, gaps);
res.bed_rms_in_quotes_db = rmsDb(bed, qspans);
res.final_lufs = lufs(short, [[0, dur]]);
res.final_lufs_speech = lufs(short, speech);
res.final_lufs_quotes = lufs(short, qspans);
res.gaps = gaps.length;
res.gap_seconds = r3(gaps.reduce((n, [x, y]) => n + y - x, 0));
const ga = await (async () => {
  const d2 = await openDb("", SB!);
  const ev = await d2.query<any>("SELECT detail FROM events WHERE episode_id = $1 AND kind = 'game_audio' ORDER BY id DESC LIMIT 1", [ID]).catch(() => []);
  await d2.close();
  return ev[0]?.detail;
})();
res.game_audio_event = ga ?? null;
res.clips = (a.clips ?? []).map((c: any, i: number) => ({ i, kind: clipSoundKind(c), seconds: r3(c.durationSeconds), from: c.span?.from }));
const shots = (a.plan?.shots ?? []).filter((s: any) => s.media?.type === "clip");
const fps = a.plan?.fps ?? 30;
res.clip_screen_seconds = r3(shots.reduce((n: number, s: any) => n + (s.end - s.start) / fps, 0));
res.heard_screen_seconds = r3(shots.filter((s: any) => (ga?.heard ?? []).some((h: any) => h.index === s.media.index)).reduce((n: number, s: any) => n + (s.end - s.start) / fps, 0));

// ---------------------------------------------------------------- sync
const W = 64, H = 36, FPS = 25;
const gray = (f: string, ss: number | undefined, t: number, crop = "") =>
  ff(["-v", "error", ...(ss !== undefined ? ["-ss", ss.toFixed(3)] : []), "-i", f, "-t", t.toFixed(3), "-an", "-vf", `${crop}fps=${FPS},scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"]);
const frames = (b: Buffer) => { const n = W * H, out: Buffer[] = []; for (let i = 0; i + n <= b.length; i += n) out.push(b.subarray(i, i + n)); return out; };
/** Seconds into `ref` (from `at - span`) where the first `len` seconds of `clip` match best by picture. */
const pictureAt = (clip: string, clipFrom: number, ref: string, at: number, span = 2, len = 2, crop = "") => {
  const c = frames(gray(clip, clipFrom, len, crop));
  const start = Math.max(0, at - span);
  const r = frames(gray(ref, start, 2 * span + len + 0.5));
  let best = { k: -1, d: Infinity };
  const all: number[] = [];
  for (let k = 0; k + c.length <= r.length; k++) {
    let d = 0;
    for (let j = 0; j < c.length; j++) for (let p = 0; p < W * H; p += 2) d += Math.abs(c[j]![p]! - r[k + j]![p]!);
    d /= c.length * (W * H / 2);
    all.push(d);
    if (d < best.d) best = { k, d };
  }
  const med = [...all].sort((x, y) => x - y)[all.length >> 1] ?? 0;
  return { at: r3(start + best.k / FPS), diff: Math.round(best.d * 10) / 10, median: Math.round(med * 10) / 10 };
};
/** Where `clip`'s motion (frame-to-frame change, robust to its upright crop) best matches `ref` around `at`. */
const motionAt = (clip: string, ref: string, at: number, span = 2, len = 3) => {
  const sig = (fr: Buffer[]) => fr.slice(1).map((f, k) => { let d = 0; for (let p = 0; p < W * H; p++) d += Math.abs(f[p]! - fr[k]![p]!); return d / (W * H); });
  const c = sig(frames(gray(clip, 0, len)));
  const start = Math.max(0, at - span);
  const r = sig(frames(gray(ref, start, 2 * span + len + 0.5)));
  const mc = c.reduce((n, v) => n + v, 0) / Math.max(1, c.length);
  const cz = c.map((v) => v - mc);
  let cc = 0; for (const v of cz) cc += v * v;
  let best = { k: -1, s: -Infinity };
  for (let k = 0; k + cz.length <= r.length; k++) {
    let m = 0; for (let j = 0; j < cz.length; j++) m += r[k + j]!;
    m /= cz.length;
    let sxy = 0, rr = 0;
    for (let j = 0; j < cz.length; j++) { const d = r[k + j]! - m; sxy += cz[j]! * d; rr += d * d; }
    const n = sxy / Math.sqrt(cc * rr + 1e-9);
    if (n > best.s) best = { k, s: n };
  }
  return { at: r3(start + best.k / FPS), corr: Math.round(best.s * 100) / 100 };
};
const env = (f: string, ss: number | undefined, t: number) => {
  const b = ff(["-v", "error", ...(ss !== undefined ? ["-ss", ss.toFixed(3)] : []), "-i", f, "-t", t.toFixed(3), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
  const x = new Int16Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 2));
  const out: number[] = [];
  for (let i = 0; i + 8 <= x.length; i += 8) { let s = 0; for (let j = 0; j < 8; j++) s += Math.abs(x[i + j]!); out.push(s / 8); }
  return out; // 1 kHz
};
/** Seconds into `ref` (from `at - span`) where `clip`'s sound (its first `len` s) matches best. */
const soundAt = (clip: string, clipFrom: number, ref: string, at: number, span = 1, len = 2) => {
  const c0 = env(clip, clipFrom, len);
  const mc = c0.reduce((n, v) => n + v, 0) / Math.max(1, c0.length);
  const c = c0.map((v) => v - mc);
  const start = Math.max(0, at - span);
  const r = env(ref, start, 2 * span + len + 0.2);
  let best = { k: -1, s: -Infinity };
  let cc = 0; for (const v of c) cc += v * v;
  for (let k = 0; k + c.length <= r.length; k++) {
    let s = 0, m = 0, rr = 0;
    for (let j = 0; j < c.length; j++) m += r[k + j]!;
    m /= c.length;
    for (let j = 0; j < c.length; j++) { const d = r[k + j]! - m; s += c[j]! * d; rr += d * d; }
    const n = s / Math.sqrt(cc * rr + 1e-9);
    if (n > best.s) best = { k, s: n };
  }
  return { at: r3(start + best.k / 1000), corr: Math.round(best.s * 100) / 100 };
};
const proxyOf = (videoId: string): string | undefined => {
  const root = path.join(SB!, "sceneindex");
  for (const slug of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(root, slug, "index.json"), "utf8"));
      if (idx?.source?.videoId === videoId && idx.proxy?.file) return path.join(root, slug, idx.proxy.file);
    } catch { /* not an index */ }
  }
  return undefined;
};
res.lip_sync = [];
for (const q of quotes) {
  const file = path.join(dir, q.file);
  const placed = (ep.script_json.character_quotes ?? []).find((x: any) => x.id === q.id);
  const proxy = placed ? proxyOf(placed.videoId) : undefined;
  const out: any = { id: q.id, speaker: q.speaker, source_cut_in: q.cutIn };
  const src = Number(q.cutIn);
  if (proxy && Number.isFinite(src)) {
    // The clip file itself: its sound and its picture's motion found in the source; equal = in sync.
    const len = Math.min(3, Math.max(1, q.seconds - 0.2));
    const snd = soundAt(file, 0, proxy, src, 2, len);
    const mot = motionAt(file, proxy, src, 2, len);
    out.clip_sound_at = snd.at; out.clip_picture_at = mot.at; out.clip_av_offset = r3(snd.at - mot.at);
    out.sound_corr = snd.corr; out.motion_corr = mot.corr;
  }
  // Where the Short plays it: the clip's sound found in the final mix around the slot the plan gave it.
  const inShort = soundAt(file, 0, short, q.start, 1, Math.min(2, q.seconds));
  out.short_sound_at = inShort.at; out.short_sound_offset = r3(inShort.at - q.start); out.short_sound_corr = inShort.corr;
  // And its picture: the clip's centre found in the Short's frames around the slot (the Short frames it upright).
  const pic = pictureAt(file, 0.2, short, q.start + 0.2, 1, Math.min(1.6, q.seconds - 0.4));
  out.short_picture_offset = r3(pic.at - q.start - 0.2); out.short_picture_diff = pic.diff; out.short_picture_median = pic.median;
  res.lip_sync.push(out);
}
// The bed's cutscene pieces: each heard clip's picture and its sound against the proxy of the same upload.
res.bed_sync = [];
for (const h of ga?.heard ?? []) {
  const c = a.clips?.[h.index];
  if (!c || clipSoundKind(c) !== "cutscene") continue;
  const src = cutsceneSource(c);
  const proxy = src && proxyOf(src.videoId);
  const sound = path.join(dir, c.file.replace(/\.[a-z0-9]+$/i, "") + ".sound.m4a");
  if (!src || !proxy || !fs.existsSync(sound)) { res.bed_sync.push({ index: h.index, skipped: !proxy ? "no proxy of its upload" : "no sound file" }); continue; }
  const len = Math.min(2, c.durationSeconds - 0.1);
  const pic = pictureAt(path.join(dir, c.file), 0, proxy, src.from, 2, len);
  const snd = soundAt(sound, 0, proxy, src.from, 2, len);
  res.bed_sync.push({ index: h.index, from: src.from, picture_at: pic.at, sound_at: snd.at, av_offset: r3(snd.at - pic.at), picture_diff: pic.diff, picture_median: pic.median, sound_corr: snd.corr });
}

// ---------------------------------------------------------------- Whisper
const wav = path.join(OUT!, "asr.wav");
ff(["-y", "-v", "error", "-i", short, "-vn", "-ac", "1", "-ar", "16000", wav]);
const body = fs.readFileSync(wav);
const r = await fetch("http://127.0.0.1:8877/transcribe", { method: "POST", headers: { "content-type": "application/octet-stream", "x-pulse-audio-duration-seconds": dur.toFixed(2) }, body: new Uint8Array(body) });
const asr: any = await r.json().catch(() => ({}));
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const heardText = asr.text ?? (asr.words ?? []).map((w: any) => w.word ?? w.text).join(" ");
const heard = norm(heardText);
const align = (said: string[]) => {
  const L = Array.from({ length: said.length + 1 }, () => new Int32Array(heard.length + 1));
  for (let i = said.length - 1; i >= 0; i--) for (let j = heard.length - 1; j >= 0; j--) L[i]![j] = said[i] === heard[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const missing: string[] = [];
  for (let i = 0, j = 0; i < said.length; ) {
    if (j < heard.length && said[i] === heard[j]) { i++; j++; }
    else if (j < heard.length && L[i]![j + 1]! >= L[i + 1]![j]!) j++;
    else { missing.push(said[i]!); i++; }
  }
  return { words: said.length, matched: L[0]![0], missing };
};
const said = norm(narrationOf({ ...ep.script_json, voice_tags: undefined }).replace(/\[[^\]]*\]/g, " "));
res.whisper = { narration: align(said), quotes: quotes.map((q) => ({ id: q.id, ...align(norm(q.text)) })), heard: heardText.slice(0, 2000) };
fs.writeFileSync(path.join(OUT!, "transcript.txt"), heardText);

// ---------------------------------------------------------------- black flashes, contact sheet, excerpt
const st = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", short, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const yav = [...String(st.stdout).matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
const dark = yav.flatMap((y, i) => (y < 18 ? [i] : []));
res.frames = yav.length;
res.black_frames = dark;
res.black_flashes = dark.filter((f) => (yav[f - 1] ?? 0) > 40 || (yav[f + 1] ?? 0) > 40).length;
ff(["-y", "-v", "error", "-i", short, "-vf", "fps=1/2,scale=216:384,tile=8x4:padding=4", "-frames:v", "1", path.join(OUT!, "contact_sheet.jpg")]);
const q0 = quotes[0];
const from = Math.max(0, q0 ? q0.start - 4 : 3);
res.excerpt_from = r3(from);
ff(["-y", "-v", "error", "-ss", from.toFixed(2), "-t", "10", "-i", short, "-c:v", "libx264", "-crf", "20", "-preset", "fast", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", path.join(OUT!, "excerpt_10s.mp4")]);
fs.writeFileSync(path.join(OUT!, "measurements.json"), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ ...res, whisper: { ...res.whisper, heard: undefined } }, null, 1));
