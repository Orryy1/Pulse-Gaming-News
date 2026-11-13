// The story chapter's planned scenes (sandbox only, no download, no voice): each sentence of the written story chapter
// looked up in the scene index inside its act, the way the cutscene step plans it, one frame per pick from the index's
// own proxy, tiled with the sentence it shows.
//   node --import tsx data/smoke/retro_storysheet.mts <sandbox data dir> <out dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const [SB, OUT] = process.argv.slice(2);
const ID = fs.readFileSync(path.join(OUT!, "episode.txt"), "utf8").trim();
const { openDb } = await import("../../src/db.ts");
const { docShotTargets, chapterSentences } = await import("../../src/pipeline.ts");
const { planIndexedClips } = await import("../../src/sceneindex/footage.ts");
const { loadSceneIndex } = await import("../../src/sceneindex/schema.ts");
const { retroChapterSpans } = await import("../../src/retrostep.ts");
const { clock } = await import("../../src/editorial/retrospective.ts");
const { FFMPEG } = await import("../../src/lib/bin.ts");
const script = JSON.parse(fs.readFileSync(path.join(OUT!, "script_full.json"), "utf8"));
const fc = JSON.parse(fs.readFileSync(path.join(OUT!, "factcheck_full.json"), "utf8"));
const retro = fc.topic.retro;
const written: number[] = retro.written ?? [];
const k = written.findIndex((i) => retro.chapters?.[i]?.section === "story");
if (k < 0) throw new Error("no story chapter written");
const span = retroChapterSpans(retro, written)[k]!;
const index = (await loadSceneIndex(SB!, fc.topic.franchise))!;
const entry = [...script.entries].sort((a: any, b: any) => b.rank - a.rank)[k];
const sentences = chapterSentences(script, k);
const targets = docShotTargets(entry, sentences, k).map((t: any, j: number, all: any[]) => ({ ...t, within: { ...span, at: all.length > 1 ? j / (all.length - 1) : 0.5 } }));
const picks = planIndexedClips(index, targets, { maxClips: 40, maxSeconds: 600, minConfidence: 0.35 });
const proxy = path.join(SB!, "sceneindex", index.slug, index.proxy?.file ?? "proxy.mp4");
const tmp = fs.mkdtempSync(path.join(OUT!, "sheet_"));
const rows: any[] = [];
for (const [j, p] of picks.entries()) {
  const t = targets.find((x: any) => x.key === p.key);
  const sentence = t?.text.replace(/ \(show:.*$/, "") ?? "";
  const frame = path.join(tmp, `${String(j).padStart(3, "0")}.jpg`);
  const label = `${clock(p.from)}  conf ${p.confidence}  ${sentence.slice(0, 70)}`.replace(/[:'\\%]/g, (c) => `\\${c}`);
  execFileSync(FFMPEG, ["-v", "error", "-y", "-ss", (p.from + Math.min(1, p.seconds / 2)).toFixed(2), "-i", proxy, "-frames:v", "1", "-vf", `scale=480:270,drawbox=y=ih-28:w=iw:h=28:color=black@0.7:t=fill,drawtext=text='${label}':x=6:y=h-21:fontsize=13:fontcolor=white`, frame]);
  rows.push({ key: p.key, at: clock(p.from), from: p.from, seconds: p.seconds, confidence: p.confidence, sentence });
}
execFileSync(FFMPEG, ["-v", "error", "-y", "-pattern_type", "glob", "-i", path.join(tmp, "*.jpg"), "-vf", "tile=4x8:padding=4", "-frames:v", "1", path.join(OUT!, "story_chapter_scenes.jpg")]);
fs.rmSync(tmp, { recursive: true, force: true });
const res = { chapter: k + 1, act: retro.chapters[written[k]!].act, span: { from: clock(span.from), to: clock(span.to) }, sentences: sentences.length, targets: targets.length, picked: picks.length, inside_act: picks.filter((p) => p.from >= span.from - 2 && p.from <= span.to + 2).length, in_order: picks.every((p, j) => j === 0 || p.from >= picks[j - 1]!.from - 120), picks: rows };
fs.writeFileSync(path.join(OUT!, "story_chapter_scenes.json"), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ ...res, picks: rows.slice(0, 8) }, null, 1));
void openDb;
