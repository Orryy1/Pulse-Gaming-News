// Real stills of the Shorts search thumbnail from real episodes' pictures and hook words. Reads the episode folders, writes
// only to the folder given. Run through the orchestrator.
// Usage: node --import tsx data/smoke/shortsearchthumb.mts <episodes dir> <rows.json: [{id, words, image, label?}]> <out dir>
import fs from "node:fs";
import path from "node:path";
import { renderShortThumb } from "../../src/render/render.ts";

const [episodes, rowsFile, out] = process.argv.slice(2) as [string, string, string];
const rows: Array<{ id: string; words: string; image: string; label?: string }> =
  JSON.parse(fs.readFileSync(rowsFile, "utf8"));
fs.mkdirSync(out, { recursive: true });
for (const r of rows) {
  const t = Date.now();
  await renderShortThumb({
    episodeDir: path.join(episodes, r.id),
    outFile: path.join(out, `${r.id}.jpg`),
    imageFile: r.image,
    words: r.words,
    label: r.label,
    gl: "swangle",
  });
  console.log(r.id, r.words, Date.now() - t, "ms", fs.statSync(path.join(out, `${r.id}.jpg`)).size, "bytes");
}
process.exit(0);
