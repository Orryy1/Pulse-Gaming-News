// Puts the back catalogue's repackaging (src/backcatalogue.ts, prepared by data/smoke/docpick/proof.mts and its
// thumbnails rendered by data/smoke/docpick/render.mts) into a factory's Test & compare queue: each new thumbnail
// is copied beside its episode's current one (as thumb_ab_b.jpg / thumb_ab_c.jpg; nothing is overwritten), the
// paths are rewritten to that copy, and the entry replaces an untested one for the same video in
// <data>/abtests/pending.json. A video already in done.json (its test is set up) is left alone. The
// pulse-studio-abtest routine then sets the tests up in Studio; this never touches YouTube.
// Usage (from factory\): node --import tsx src/tools/backcatalogue-apply.ts <proof out dir> <data dir> [--dry]
import fs from "node:fs";
import path from "node:path";
import { upsertAbQueue, type AbQueueEntry } from "../backcatalogue.ts";

const [from, data] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
if (!from || !data)
  throw new Error(
    "usage: backcatalogue-apply.ts <proof out dir> <data dir> [--dry]",
  );
const prepared = JSON.parse(
  fs.readFileSync(path.join(from, "abtests", "pending.json"), "utf8"),
) as AbQueueEntry[];
const queueFile = path.join(data, "abtests", "pending.json");
const doneFile = path.join(data, "abtests", "done.json");
let queue = JSON.parse(
  fs.existsSync(queueFile) ? fs.readFileSync(queueFile, "utf8") : "[]",
) as AbQueueEntry[];
const done = new Set<string>(
  fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, "utf8")) : [],
);
for (const e of prepared.filter((x) => x.repackage)) {
  // The current thumbnail's folder is where the episode lives on this install.
  const home = path.dirname(e.thumbs[0]!);
  const thumbs = [e.thumbs[0]!];
  for (const t of e.thumbs.slice(1)) {
    const dest = path.join(home, path.basename(t));
    if (!fs.existsSync(t)) {
      console.log(`${e.videoId}: missing rendered thumbnail ${t}, left out`);
      continue;
    }
    if (!dry && !fs.existsSync(dest)) fs.copyFileSync(t, dest);
    thumbs.push(dest);
  }
  const r = upsertAbQueue(queue, { ...e, thumbs }, done);
  queue = r.list;
  console.log(
    `${e.videoId} (${e.titles[0]}): ${r.action}; titles ${e.titles.length}, thumbnails ${thumbs.length}`,
  );
}
if (!dry) {
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2), "utf8");
}
console.log(dry ? "dry run: nothing written" : `written ${queueFile}`);
