// The sound craft's proof (31 Oct 2026): the audio of a stretch of a real documentary rendered through the real
// PulseLong composition (Remotion renderMedia, frameRange, audio only, two browser tabs) with the sound craft
// off ("before": the old mix) and on ("after"), each twice: the full mix, and everything but the narration (the
// same props with no narration), so data/smoke/soundfx_measure.mts can measure the voice against the rest per
// sentence. Every sound the composition places in the stretch is logged by the composition itself (soundLog).
//
// Reads a database COPY and the episode's files read-only; the episode folder it renders from is a scratch
// folder of junctions to them (data/smoke/soundfx_out/ep), so nothing in the live install is written. Run it
// through the PC orchestrator (it is a render):
//   set PROOF_ONLY=before   (then before_rest, after_rest, after_demo: one render, about 17 minutes, per PC turn)
//   C:\Claude\orchestrator\orch.cmd run --class cpu --project pulse --job "soundfx audio" --priority 20 --est 18 --
//     node --import tsx data/smoke/soundfx_proof.mts <dbcopy> <episode> <fromSeconds> <toSeconds>
// The renders are audio only (LongProps.audioOnly: no pictures loaded, the clips' sound kept), six tabs. The
// "after" full mix is not rendered: Remotion's mix is a plain sum (before.wav equals before_rest.wav plus the
// narration to -75 dB), so data/smoke/soundfx_measure.mts makes after.wav from after_rest.wav and the narration.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { renderMedia, selectComposition } from "@remotion/renderer";

const { getBundle, serveDir, longProps } = await import("../../src/render/render.ts");
const { buildSegments } = await import("../../src/render/timeline.ts");
const { openChaptersAtBreaks, LONG_TAIL_SECONDS, LONG_FPS } = await import("../../src/render/longplan.ts");
const { segmentInputs, photoCredit, variantOf } = await import("../../src/pipeline.ts");
const { bedFor } = await import("../../src/render/soundscape.ts");
const { prepareSoundCraft } = await import("../../src/render/voicefx.ts");
const { coldOpenLine, END_CARD_SECONDS } = await import("../../src/render/bookends.ts");

const [dbDir, id, fromS, toS] = process.argv.slice(2) as [string, string, string, string];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "data", "smoke", "soundfx_out");
const LIVE = `C:/PulseFactory/factory/data/episodes/${id}`;
const EP = path.join(OUT, "ep");

const db = new PGlite(dbDir);
const [ep] = (await db.query<any>(`SELECT * FROM episodes WHERE id = $1`, [id])).rows;
await db.close();
const script = ep.script_json;
const assets = ep.assets_json;

// The scratch episode folder: junctions to the live folder's media, a copy of the narration.
fs.mkdirSync(EP, { recursive: true });
for (const name of fs.readdirSync(LIVE)) {
  const src = path.join(LIVE, name);
  const dst = path.join(EP, name);
  if (fs.existsSync(dst)) continue;
  if (fs.statSync(src).isDirectory()) execFileSync("cmd", ["/c", "mklink", "/J", dst, src.replace(/\//g, "\\")]);
  else if (name === assets.audio) fs.copyFileSync(src, dst);
}

// The composition's props, as src/pipeline.ts stepRenderLong builds them.
const doc = script.evergreen_format === "documentary";
const words = assets.words ?? [];
const duration = (assets.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
const segments = openChaptersAtBreaks(
  buildSegments(segmentInputs(script, Boolean(assets.desk)), words, duration),
  assets.breaks,
);
const variant = variantOf(ep.id);
const moments = [...(script.entries ?? [])].sort((a: any, b: any) => b.rank - a.rank).map((e: any) => e.moments ?? []);
const images = (assets.images ?? []).map((i: any) => ({
  file: i.file, kind: i.kind, aspect: i.aspect, beatIndex: i.beatIndex, credit: photoCredit(i), moment: i.moment, label: i.label, layers: i.layers,
}));
const clips = (assets.clips ?? []).map((c: any) => ({
  file: c.file, durationSeconds: c.durationSeconds, beatIndex: c.beatIndex, role: c.role, moment: c.moment, credit: c.credit, audio: c.audio,
}));
const plan = assets.longPlan;
const craftOn = {
  jl: true, pockets: true, foley: true, risers: true, buttons: true, phrase: true, voicePocket: true, voiceFx: true,
};
const prep = await prepareSoundCraft({
  episodeDir: EP,
  voiceFile: assets.audio,
  craft: craftOn,
  segments,
  words,
  moments,
  breaks: assets.breaks,
  shots: plan.shots,
  clips,
  fps: LONG_FPS,
});
console.log("sound craft prep", JSON.stringify(prep.counts), "slices", prep.voiceFxFiles.length, "failed", prep.failed);
// A demonstration only (never the episode as written): this documentary predates the writer's beats and has no
// message quotes, so a copy of its shot list marks two sentences of the stretch as reveals and reads one quote
// as a message, to let the riser, the reverb swell and the telephone band be heard ("after_demo").
const { momentWindows, momentKeys } = await import("../../src/render/longplan.ts");
const fromSec = Number(fromS);
const toSec = Number(toS);
const wins = momentWindows(segments, words, moments.map((m: any[]) => m.length), moments.map((e: any[]) => e.map(momentKeys)))
  .filter((w) => w.moment > 0 && w.start > fromSec + 15 && w.end < toSec - 10);
const demo = moments.map((ms: any[]) => ms.map((m: any) => ({ ...m })));
const quote = wins.find((w) => demo[w.entry][w.moment]?.graphic?.kind === "quote");
if (quote) demo[quote.entry][quote.moment].show = `${demo[quote.entry][quote.moment].show} (text message)`;
const reveals = wins.filter((w) => w !== quote && w.end - w.start >= 2.5);
const picked = [reveals[0], reveals.find((w) => reveals[0] && w.start - reveals[0].start > 40)].filter(Boolean) as typeof wins;
for (const w of picked) demo[w.entry][w.moment].beat = "reveal";
console.log("demo: message quote", quote && `${quote.start.toFixed(1)}-${quote.end.toFixed(1)} s`, "reveals", picked.map((w) => `${w.start.toFixed(1)}-${w.end.toFixed(1)} s`).join(", "));
const demoPrep = await prepareSoundCraft({
  episodeDir: EP, voiceFile: assets.audio, craft: craftOn, segments, words, moments: demo,
  breaks: assets.breaks, shots: plan.shots, clips, fps: LONG_FPS,
});
console.log("demo prep", JSON.stringify(demoPrep.counts), "slices", demoPrep.voiceFxFiles.length, "failed", demoPrep.failed);
// PROOF_DRY=1: check the inputs and the plan only, no bundle and no render.
if (process.env.PROOF_DRY) process.exit(0);
function propMoments(list: any[][]) {
  return list.map((ms: any[], ei: number) =>
    ms.map((m: any, mi: number) => ({
      show: m.show,
      graphic: (assets.quietMoments ?? []).includes(`${ei}:${mi}`) ? { kind: "none", primary: "", secondary: "", items: [] } : m.graphic,
      emphasis: m.emphasis, person: m.person || undefined, beat: m.beat,
    })),
  );
}
const base = {
  title: script.headline, kicker: script.kicker ?? "", criterion: script.criterion ?? "", spoilers: false, recap: !!script.recap,
  theme: script.game_title, footageCredit: clips.length ? "FOOTAGE: OFFICIAL TRAILERS · STEAM" : "",
  endLine: "A new documentary every month · Shorts every day",
  moments: propMoments(moments),
  segments, words, durationSeconds: duration + (assets.nextDoc ? END_CARD_SECONDS : 0),
  coldOpenLine: doc ? coldOpenLine(script.hook) : undefined,
  next: assets.nextDoc ? { title: assets.nextDoc.title, thumbFile: null } : undefined,
  variant, audioFile: assets.audio, musicFile: assets.musicFile ?? bedFor(variant), imageFiles: images, clipFiles: clips, plan,
  renderDate: "2026-10-31", breaks: assets.breaks, quietBreaks: assets.quietBreaks, palette: assets.palette, annotations: assets.annotations,
  eraBeds: doc, sketchAnimation: true, photoTreatments: true, audioOnly: true,
};
const from = Math.round(Number(fromS) * LONG_FPS);
const to = Math.round(Number(toS) * LONG_FPS) - 1;
let lastP = -1;
console.log("bundling");
const serveUrl = await getBundle();
console.log("bundled");
const files = await serveDir(EP);
const events: Record<string, unknown> = {};
try {
  for (const [name, extra, voice] of [
    ["before", {}, true],
    ["before_rest", {}, false],
    ["after", { soundCraft: craftOn, voiceFxFiles: prep.voiceFxFiles }, true],
    ["after_rest", { soundCraft: craftOn, voiceFxFiles: [] }, false],
    ["after_demo", { soundCraft: craftOn, voiceFxFiles: demoPrep.voiceFxFiles, moments: propMoments(demo) }, true],
  ] as const) {
    // PROOF_ONLY=before,after: just those renders (each its own short PC turn); the rest are kept or skipped.
    if (process.env.PROOF_ONLY && !process.env.PROOF_ONLY.split(",").includes(name)) {
      const f = path.join(OUT, `events_${name}.json`);
      if (fs.existsSync(f)) events[name] = JSON.parse(fs.readFileSync(f, "utf8"));
      continue;
    }
    const props = longProps(files.url, serveUrl, { ...base, ...extra, ...(voice ? {} : { audioFile: null }), soundLog: from } as never);
    const composition = await selectComposition({ serveUrl, id: "PulseLong", inputProps: props });
    const outputLocation = path.join(OUT, `${name}.wav`);
    const evFile = path.join(OUT, `events_${name}.json`);
    // A WAV already made (an earlier run stopped part way) is kept, so a rerun takes the PC for less time.
    if (fs.existsSync(outputLocation) && fs.existsSync(evFile)) {
      events[name] = JSON.parse(fs.readFileSync(evFile, "utf8"));
      console.log(`${name}: kept from an earlier run`);
      continue;
    }
    const t0 = Date.now();
    lastP = -1;
    await renderMedia({
      composition, serveUrl, codec: "wav", outputLocation, inputProps: props, concurrency: 6,
      frameRange: [from, to], timeoutInMilliseconds: 180_000, chromiumOptions: { gl: "swangle" },
      onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== lastP) { lastP = p; console.log(`${name} ${p * 10}%`); } },
      onBrowserLog: (l) => {
        if (l.text.startsWith("SOUNDLOG ")) events[name] = JSON.parse(l.text.slice(9));
      },
    });
    fs.writeFileSync(evFile, JSON.stringify(events[name] ?? []));
    console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outputLocation}`);
  }
} finally {
  await files.close();
}
const inRange = (list: unknown) =>
  ((list as Array<{ frame: number; sound: string }>) ?? []).filter((e) => e.frame >= from - 60 && e.frame <= to);
fs.writeFileSync(
  path.join(OUT, "events.json"),
  JSON.stringify({ episode: id, from, to, fps: LONG_FPS, prep: prep.counts, demoPrep: demoPrep.counts, before: inRange(events.before), after: inRange(events.after), after_demo: inRange(events.after_demo) }, null, 1),
);
console.log("events written");
