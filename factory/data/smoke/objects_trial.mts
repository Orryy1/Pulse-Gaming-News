// 31 Oct 2026: the objects and silhouettes choosers over a documentary's bare sentences (from objects_bare.mts).
// Usage: node --import tsx data/smoke/objects_trial.mts <bare.json>
import fs from "node:fs";
import { objectsDecision, silhouetteDecision } from "../../src/render/components/objects/choose.ts";

const rows = JSON.parse(fs.readFileSync(process.argv[2]!, "utf8")).filter((r: any) => r.bare);
let took = 0;
const declines: Record<string, number> = {};
for (const r of rows) {
  const ch = { game: r.game, year: r.year };
  const o = objectsDecision(r.sentence, r.moment, ch);
  const s = silhouetteDecision(r.sentence, r.moment, ch);
  const best = [o.candidate, s.candidate].filter(Boolean).sort((a: any, b: any) => b.confidence - a.confidence)[0];
  if (best) took++;
  else {
    const why = o.declined === s.declined ? o.declined! : `${o.declined} / ${s.declined}`;
    declines[why] = (declines[why] ?? 0) + 1;
  }
  console.log(`${r.entry}:${r.k} ${r.stock ? "[stock]" : "[bare] "} ${r.sentence}\n    show: ${r.moment.show} | broll: ${r.moment.broll}\n    O: ${o.candidate ? `${o.candidate.style} ${o.candidate.confidence} (${o.candidate.reason})` : `- ${o.declined}`}\n    S: ${s.candidate ? `${s.candidate.style} ${s.candidate.confidence} (${s.candidate.reason})` : `- ${s.declined}`}`);
}
console.log(`\ntook ${took} of ${rows.length}; declined:`, declines);
