// The graphics audit over published videos (src/qa/gfxaudit.ts), from a dump of their episode rows (spends nothing).
//   node --import tsx data/smoke/gfxaudit.mts <dump.json> <out.json> [--fix]
// The dump is { shorts: [...], longs: [...] } of episodes rows (id, lane, youtube_video_id, script_json, assets_json).
// --fix also runs the gate's fixer on each Short and reports before and after.
import fs from "node:fs";
import { buildSegments } from "../../src/render/timeline.ts";
import { segmentInputs, stampsFor } from "../../src/pipeline.ts";
import { eraStampsFor } from "../../src/editorial/everygame.ts";
import { stampColour } from "../../src/render/brand.ts";
import { TAIL_SECONDS } from "../../src/render/plan.ts";
import { gfxInputOf, longMoments } from "../../src/qa/gfxgate.ts";
import { auditLongGraphics, auditShortGraphics, fixShortGraphics, gfxSummary } from "../../src/qa/gfxaudit.ts";

const [DUMP, OUT] = process.argv.slice(2);
if (!DUMP || !OUT) throw new Error("usage: gfxaudit.mts <dump.json> <out.json> [--fix]");
const FIX = process.argv.includes("--fix");
const dump = JSON.parse(fs.readFileSync(DUMP, "utf8"));
const out: unknown[] = [];
for (const row of dump.shorts ?? []) {
  const script = row.script_json;
  const assets = row.assets_json;
  const words = assets.words ?? [];
  const duration = (assets.durationSeconds ?? 30) + TAIL_SECONDS;
  const segments = buildSegments(segmentInputs(script, Boolean(assets.desk)), words, duration);
  // The argument test's arm: the take is spoken, not labelled, so it had no card (src/pipeline.ts argumentArm).
  if ((dump.events ?? []).some((e: { episode_id: string; kind: string; detail?: { arm?: string } }) => e.episode_id === row.id && e.kind === "short_argument" && e.detail?.arm === "argument"))
    for (const g of segments) if (g.kind === "take") g.visual = undefined;
  const stamps = [
    ...stampsFor(script, words),
    ...eraStampsFor(script, segments.filter((g) => g.kind === "beat").map((g) => g.start), stampColour("neutral")),
  ];
  const input = gfxInputOf({ script, assets, segments, words, plan: assets.plan, stamps, clean: true });
  const audit = auditShortGraphics(input);
  const fixed = FIX ? fixShortGraphics(input) : undefined;
  out.push({
    id: row.id,
    lane: row.lane,
    video: row.youtube_video_id,
    headline: script.headline,
    seconds: Math.round(duration * 10) / 10,
    audit,
    ...(fixed ? { fixed: { fixes: fixed.fixes, after: fixed.after, wrong: fixed.wrong, summary: gfxSummary(fixed) } } : {}),
  });
  console.log(`${row.id} ${script.headline}: ${audit.findings.filter((f) => f.level !== "warn").length} faults, ${audit.findings.length} findings${fixed ? ` | ${gfxSummary(fixed)}` : ""}`);
}
for (const row of dump.longs ?? []) {
  const { moments, narration, sources, spoken } = longMoments(row.script_json, row.assets_json, segmentInputs);
  const audit = auditLongGraphics(moments, narration, sources, spoken);
  out.push({ id: row.id, lane: row.lane, video: row.youtube_video_id, headline: row.script_json.headline, long: true, audit });
  console.log(`${row.id} ${row.script_json.headline}: ${audit.findings.filter((f) => f.level !== "warn").length} faults over ${moments.length} graphics`);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
