// Runs the explainer pass (src/editorial/explainers.ts) on real scripts from an admin export, without touching any
// episode: one Claude call per script, then the guard, and writes what was kept and what was dropped and why.
//   node --env-file=<factory .env> --import tsx src/tools/explainers-proof.ts --export <export.json> --ids a,b --out <dir>
import fs from "node:fs";
import path from "node:path";
import { createClaude, tapUsage, usageCost } from "../editorial/llm.ts";
import {
  explainersNote,
  markShortExplainers,
} from "../editorial/explainers.ts";
import type { Script } from "../editorial/schema.ts";

const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = flag("--export");
const out = flag("--out") ?? ".";
const ids = (flag("--ids") ?? "").split(",").filter(Boolean);
if (!file || !ids.length) {
  console.error("usage: --export <export.json> --ids a,b --out <dir>");
  process.exit(2);
}
const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
  id: string;
  script_json: Script;
}>;
const llm = createClaude({
  top: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  mid: process.env.CLAUDE_MODEL_MID || "claude-sonnet-5-5",
  low: process.env.CLAUDE_MODEL_LOW || "claude-haiku-5-5",
});
let cost = 0;
tapUsage((line) => {
  cost += usageCost(line);
});
fs.mkdirSync(out, { recursive: true });
for (const id of ids) {
  const row = rows.find((r) => r.id === id);
  if (!row) {
    console.log(id, "not in the export");
    continue;
  }
  const r = await markShortExplainers(llm, row.script_json);
  fs.writeFileSync(
    path.join(out, `${id}.marks.json`),
    JSON.stringify(r, null, 2),
  );
  console.log(
    `${id}: kept ${r.explainers.length}: ${explainersNote(r.explainers) || "none"}`,
  );
  for (const d of r.dropped) console.log(`   dropped: ${d}`);
}
console.log("cost", cost.toFixed(4));
