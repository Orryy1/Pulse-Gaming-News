// FFXIV repair, step 2: speaks only the two rewritten chapters, the way the factory speaks a narration, and measures
// them against the rest. Real ElevenLabs credit. Usage: node --import tsx data/smoke/ffxiv_voice.mts <new_chapters.json> <ep.json> <outdir>
process.env.PULSE_ENV_FILE = "C:/PulseFactory/factory/.env";
const [file, epFile, out] = process.argv.slice(2);
Object.assign(process.env, { CODEX_LLM: "false", DATA_DIR: out });
import fs from "node:fs";
import path from "node:path";
const { loadConfig } = await import("../../src/config.ts");
const { narrate, elevenLabsCreditsLeft } = await import("../../src/voice/index.ts");
const { speakable, speakContext } = await import("../../src/voice/speakable.ts");
const { tightenPauses } = await import("../../src/voice/pauses.ts");
const { measureTake } = await import("../../src/voice/takecheck.ts");
const { writerNoteHits } = await import("../../src/editorial/writernotes.ts");
const fresh = JSON.parse(fs.readFileSync(file!, "utf8"));
const ep = JSON.parse(fs.readFileSync(epFile!, "utf8"));
const s = ep.script_json;
const cfg = loadConfig();
const starts = s.beats.flatMap((b: any, i: number) => (b.visual?.kind === "chapter" ? [i] : []));
// Spoken in order with one context, as narrationOf does, so the numbers come out as they do in the full narration.
const ctx = speakContext();
speakable(s.hook.trim(), ctx);
const textOf: Record<string, string[]> = {};
for (let c = 0; c < starts.length; c++) {
  const paras = fresh[String(c)]?.paragraphs?.map((p: any) => p.narration) ?? s.beats.slice(starts[c], starts[c + 1] ?? s.beats.length).map((b: any) => b.narration);
  textOf[c] = paras.map((t: string) => speakable(t.trim(), ctx));
}
fs.mkdirSync(out!, { recursive: true });
const before = await elevenLabsCreditsLeft(cfg.elevenLabsApiKey);
console.log("credits before", before);
const report: any = {};
for (const c of ["4", "5"]) {
  const text = textOf[c]!.join(" ");
  console.log(`chapter ${c}: ${text.length} characters\n${text}\n`);
  if (writerNoteHits(text).length) throw new Error("writer's notes in the new text");
  if (process.argv.includes("--dry")) continue;
  const mp3 = path.join(out!, `ch${c}.mp3`);
  const n = await narrate(cfg, text, mp3, ep.assets_json.voice);
  const tight = await tightenPauses(mp3, n.words, n.durationSeconds).catch(() => undefined);
  const words = tight && tight.removedSeconds > 0 ? tight.words : n.words;
  const seconds = tight && tight.removedSeconds > 0 ? tight.durationSeconds : n.durationSeconds;
  fs.writeFileSync(path.join(out!, `ch${c}.json`), JSON.stringify({ words, durationSeconds: seconds, voice: n.voice, chars: text.length }));
  const m = await measureTake(mp3);
  report[c] = { seconds, words: words.length, removed: tight?.removedSeconds ?? 0, voice: n.voice, ...m };
  console.log(`chapter ${c}:`, JSON.stringify(report[c]));
}
const after = await elevenLabsCreditsLeft(cfg.elevenLabsApiKey);
console.log("credits after", after, "used", before !== undefined && after !== undefined ? before - after : "?");
