// The humaniser proof (14 Nov 2026): runs HUMANISE in check mode and in fix mode over published scripts and reports
// the counts per rule before and after, the "sounds human" score, the fact guard's verdict on every fixed script and
// a handful of before-and-after scripts. Deterministic only: no model call, nothing written to the database, no voice.
//
//   node --import tsx src/tools/humanise-proof.ts <episodes.json> <out-dir> [count=40] [ids-to-show,...]
//
// episodes.json: rows of { id, lane, live_at, script_json } (the /routine/export or /admin/export rows).

import fs from "node:fs";
import path from "node:path";
import type { Script } from "../editorial/schema.ts";
import {
  humaniseShort,
  humaniseShortProblems,
  shortSegments,
  type HumaniseResult,
  type RuleCounts,
} from "../editorial/humanise/humanise.ts";

const [, , inFile, outArg, countArg, showArg] = process.argv;
if (!inFile || !outArg) {
  console.error(
    "usage: humanise-proof.ts <episodes.json> <out-dir> [count] [ids]",
  );
  process.exit(2);
}
const outDir = path.resolve(outArg);
fs.mkdirSync(outDir, { recursive: true });
const rows = (
  JSON.parse(fs.readFileSync(inFile, "utf8")) as Array<{
    id: string;
    lane: string;
    live_at: string;
    script_json: Script;
  }>
)
  .filter((r) => r.script_json?.hook && Array.isArray(r.script_json.beats))
  .sort((a, b) => b.live_at.localeCompare(a.live_at))
  .slice(0, Number(countArg ?? 40));

const sum = (a: RuleCounts, b: RuleCounts) => {
  for (const k of Object.keys(b) as Array<keyof RuleCounts>)
    a[k] = (a[k] ?? 0) + b[k];
  return a;
};
const totals = { check: {} as RuleCounts, after: {} as RuleCounts };
const results: Array<{
  id: string;
  lane: string;
  title: string;
  r: HumaniseResult;
  drift: string[];
  before: string[];
  after: string[];
}> = [];
let driftCount = 0;
for (const row of rows) {
  const s = row.script_json;
  const publishAt = new Date(row.live_at);
  const check = humaniseShort(s, { mode: "check", publishAt });
  const fix = humaniseShort(s, { mode: "fix", publishAt });
  const drift = humaniseShortProblems(s, fix.script, fix.result.removedFigures);
  if (drift.length) driftCount++;
  sum(totals.check, check.result.before.counts);
  sum(totals.after, fix.result.after.counts);
  results.push({
    id: row.id,
    lane: row.lane,
    title: s.youtube?.title ?? s.game_title,
    r: fix.result,
    drift,
    before: shortSegments(s),
    after: shortSegments(fix.script),
  });
}

const headline: Array<[string, (c: RuleCounts) => number]> = [
  ["Repeated full titles", (c) => c.naming],
  ["Repeated sentence openings", (c) => c["repetition.opening"]],
  ["AI-tell words and patterns", (c) => c.aitell],
  ["Em dashes", (c) => c.emdash],
  ["Uncontracted forms", (c) => c["register.contraction"]],
  ["Formal connectives", (c) => c["register.formal"]],
  ["Connective over the cap", (c) => c["repetition.connective"]],
  ["Same word within 15 words", (c) => c["repetition.near"]],
  ["Same sentence shape x3", (c) => c["repetition.shape"]],
  ["Flat rhythm", (c) => c["register.rhythm"]],
  ["Filler over the cap", (c) => c.filler],
  ["Repeated credit frames", (c) => c.attribution],
];
const avg = (xs: number[]) =>
  Math.round((xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)) * 10) /
  10;
const lines: string[] = [];
lines.push(`# Humaniser proof, ${new Date().toISOString().slice(0, 10)}`, "");
lines.push(
  `${rows.length} most recent published scripts (${rows.filter((r) => r.lane === "longform").length} long videos), HUMANISE=check then HUMANISE=fix. Deterministic fixes only; the writer rewrite and the fact check run in the pipeline, not here.`,
  "",
);
lines.push(`| Rule | Check (before) | After fix |`, `| --- | ---: | ---: |`);
for (const [label, f] of headline)
  lines.push(`| ${label} | ${f(totals.check)} | ${f(totals.after)} |`);
lines.push(
  "",
  `Sounds-human score (0-10), average: ${avg(results.map((r) => r.r.before.score))} before, ${avg(results.map((r) => r.r.after.score))} after.`,
);
lines.push(
  `Opportunities taken in fix mode: ${totals.check.numbers} exact spoken numbers, ${totals.check.dates} relative dates, ${totals.check.callback} callbacks.`,
);
lines.push(
  `Fact guard (figures, names, quotations): ${driftCount} of ${rows.length} fixed scripts moved a fact${driftCount ? " (listed below; those versions would be refused and the original kept)" : ""}.`,
  "",
);
const shown = (showArg ?? "").split(",").filter(Boolean);
const pick = shown.length
  ? results.filter((r) => shown.includes(r.id))
  : results.filter((r) => r.r.changed).slice(0, 5);
lines.push(`## Before and after`, "");
for (const r of pick) {
  lines.push(
    `### ${r.title} (${r.id}, ${r.lane})`,
    "",
    `Score ${r.r.before.score} to ${r.r.after.score}.`,
    "",
  );
  const long = r.lane === "longform";
  r.before.forEach((b, i) => {
    const a = r.after[i]!;
    if (long && a === b) return;
    lines.push(a === b ? `- ${b}` : `- ~~${b}~~\n  **${a}**`);
  });
  if (r.r.after.notes.length)
    lines.push(
      "",
      "Notes left for the writer:",
      ...r.r.after.notes.slice(0, 6).map((n) => `- ${n}`),
    );
  lines.push("");
}
if (driftCount) {
  lines.push(`## Fact guard refusals`, "");
  for (const r of results.filter((x) => x.drift.length))
    lines.push(`- ${r.id}: ${r.drift.join(" ")}`);
}
fs.writeFileSync(
  path.join(outDir, "humanise-proof.md"),
  `${lines.join("\n")}\n`,
);
fs.writeFileSync(
  path.join(outDir, "humanise-proof.json"),
  JSON.stringify(
    {
      totals,
      results: results.map((r) => ({
        id: r.id,
        lane: r.lane,
        title: r.title,
        before: r.r.before.counts,
        after: r.r.after.counts,
        score: [r.r.before.score, r.r.after.score],
        drift: r.drift,
        notes: r.r.after.notes,
        segments: { before: r.before, after: r.after },
      })),
    },
    null,
    1,
  ),
);
console.log(lines.slice(0, 22).join("\n"));
