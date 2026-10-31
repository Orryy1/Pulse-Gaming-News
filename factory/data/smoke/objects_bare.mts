// 31 Oct 2026: the bare sentences of a documentary (no picture or clip of their own, graphic "none") from a
// database COPY, as JSON for the objects and silhouettes chooser trial.
// Usage: node --import tsx data/smoke/objects_bare.mts <db dir> <episode id> <out.json>
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sentencesOf } from "../../src/editorial/longform.ts";

const [dbDir, id, out] = process.argv.slice(2) as [string, string, string];
const db = new PGlite(dbDir);
const [ep] = (
  await db.query<any>(
    `SELECT script_json, assets_json FROM episodes WHERE id = $1`,
    [id],
  )
).rows;
await db.close();
const script = ep.script_json;
const assets = ep.assets_json ?? {};
const images: any[] = assets.images ?? [];
const clips: any[] = assets.clips ?? [];
const beats: any[] = script.beats ?? [];
const rows: any[] = [];
(script.entries ?? []).forEach((e: any, ei: number) => {
  const moments: any[] = e.moments ?? [];
  // The chapter's sentences: the narration of its paragraphs, split as the writer split them.
  const chapterBeats = beats.filter((_: any, bi: number) => {
    const starts = beats
      .map((b: any, i: number) => (b.visual?.kind === "chapter" ? i : -1))
      .filter((i: number) => i >= 0);
    const s = starts[ei];
    const next = starts[ei + 1] ?? beats.length;
    return s !== undefined && bi >= s && bi < next;
  });
  const sentences: string[] = chapterBeats.flatMap((b: any) =>
    sentencesOf(b.narration as string),
  );
  // Stock clips do not count as the sentence's own picture (fill.ts treats them the same way): a drawn scene
  // may replace illustrative stock.
  const pinned = new Set<number>();
  const stocked = new Set<number>();
  for (const x of [...images, ...clips])
    if (x.beatIndex === ei && x.moment !== undefined)
      (x.stock ? stocked : pinned).add(x.moment);
  moments.forEach((m: any, k: number) => {
    const bare = !pinned.has(k) && (!m.graphic || m.graphic.kind === "none");
    rows.push({
      entry: ei,
      k,
      bare,
      stock: stocked.has(k),
      game: e.game_title,
      year: e.year,
      sentence: sentences[k] ?? "",
      moment: m,
    });
  });
});
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(
  "moments",
  rows.length,
  "bare",
  rows.filter((r) => r.bare).length,
  "sentences matched",
  rows.filter((r) => r.sentence).length,
);
