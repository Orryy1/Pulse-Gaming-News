// The ranked challenge ideas (src/challenge.ts) from a data folder's stream asks, without the database: for a copy of
// the Mac's data on the PC, or a quick look. The factory itself rewrites the report every three hours with the
// comments added (src/challengestep.ts challengeHousekeeping, CHALLENGE_SERIES on).
// Usage: node --import tsx src/tools/challenge-ideas.ts <dataDir> <out.md>

import fs from "node:fs/promises";
import path from "node:path";
import { ideasReport, rankChallengeIdeas, readRegistry } from "../challenge.ts";
import { readAsks } from "../streamasks/job.ts";

const [
  dataDir = "./data",
  out = path.join(dataDir, "reports", "Challenge ideas.md"),
] = process.argv.slice(2);
const store = await readAsks(dataDir);
const texts: Array<{ text: string; weight?: number }> = [];
for (const a of store.asks) {
  texts.push({
    text: `${a.question} ${a.claim}`,
    weight: Math.max(1, a.mentionCount),
  });
  for (const m of a.mentions ?? []) texts.push({ text: m.text });
}
const done = readRegistry(dataDir).challenges.map((c) => c.rule);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(
  out,
  ideasReport(rankChallengeIdeas(texts, done), new Date()),
);
console.log(`wrote ${out} from ${store.asks.length} stream asks`);
