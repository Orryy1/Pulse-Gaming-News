// Puts the back catalogue's repackaging (src/backcatalogue.ts; its thumbnails rendered and checked by
// src/tools/backcatalogue-thumbs.ts) into a factory's Test & compare queue: each thumbnail, the current one included,
// is copied to <data>/abtests/thumbs/<video>/ (nothing is overwritten; an episode's own folder can be pruned for
// space before the routine gets to it, as the Call of Duty ranking's was), the paths are rewritten to that copy, and
// the entry replaces an untested one for the same video in <data>/abtests/pending.json. A video already in done.json
// (its test is set up) is left alone, and so is a hand-approved one (HAND_APPROVED) whatever the prepared file says.
// A thumbnail whose words break the hero rule stays out. The pulse-studio-abtest routine then sets the tests up in
// Studio; this never touches YouTube.
// Usage (from factory\): node --import tsx src/tools/backcatalogue-apply.ts <prepared out dir> <data dir> [--dry]
import fs from "node:fs";
import path from "node:path";
import {
  HAND_APPROVED,
  upsertAbQueue,
  type AbQueueEntry,
} from "../backcatalogue.ts";
import { thumbWordProblems } from "../qa/thumbrule.ts";

const [from, data] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
if (!from || !data)
  throw new Error(
    "usage: backcatalogue-apply.ts <prepared out dir> <data dir> [--dry]",
  );
const prepared = JSON.parse(
  fs.readFileSync(path.join(from, "abtests", "pending.json"), "utf8"),
) as AbQueueEntry[];
const queueFile = path.join(data, "abtests", "pending.json");
const doneFile = path.join(data, "abtests", "done.json");
let queue = JSON.parse(
  fs.existsSync(queueFile) ? fs.readFileSync(queueFile, "utf8") : "[]",
) as AbQueueEntry[];
const before = queue.length;
const done = new Set<string>(
  fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, "utf8")) : [],
);
for (const e of prepared.filter((x) => x.repackage)) {
  if (HAND_APPROVED.has(e.videoId)) {
    console.log(`${e.videoId}: hand-approved, left alone`);
    continue;
  }
  const store = path.join(data, "abtests", "thumbs", e.videoId);
  const copy = (src: string, name: string): string => {
    const dest = path.join(store, name);
    if (!dry && !fs.existsSync(dest)) {
      fs.mkdirSync(store, { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return dest;
  };
  const current = e.thumbs[0]!;
  if (!fs.existsSync(current)) {
    console.log(
      `${e.videoId}: current thumbnail ${current} is missing, skipped`,
    );
    continue;
  }
  const thumbs = [copy(current, "thumb_current.jpg")];
  for (const [k, t] of e.thumbs.slice(1).entries()) {
    const problems = thumbWordProblems(e.thumbWords?.[k] ?? "SOME WORDS");
    if (problems.length) {
      console.log(
        `${e.videoId}: "${e.thumbWords?.[k]}" left out: ${problems.join(", ")}`,
      );
      continue;
    }
    if (!fs.existsSync(t)) {
      console.log(`${e.videoId}: missing rendered thumbnail ${t}, left out`);
      continue;
    }
    thumbs.push(copy(t, `thumb_ab_${"bc"[k] ?? k}.jpg`));
  }
  if (thumbs.length < 2) {
    console.log(`${e.videoId}: no new thumbnail left, skipped`);
    continue;
  }
  const r = upsertAbQueue(queue, { ...e, thumbs }, done);
  queue = r.list;
  console.log(
    `${e.videoId} (${e.titles[0]}): ${r.action}; titles ${e.titles.length}, thumbnails ${thumbs.length}${e.thumbWords?.length ? `, words ${e.thumbWords.map((w) => `"${w}"`).join(" and ")}` : ""}`,
  );
}
if (!dry) {
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2), "utf8");
}
console.log(`queue: ${before} entries before, ${queue.length} after`);
console.log(dry ? "dry run: nothing written" : `written ${queueFile}`);
