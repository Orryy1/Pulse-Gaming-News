// ENDING_FORMS proof (src/editorial/endingforms.ts): reads an /admin/export JSON of published episodes and shows how
// many Shorts' takes said a verdict lead-in aloud, which ones the detector catches, and how the episodes would split
// between the two sides and the four closing forms. Read-only: no model calls, no database.
// Usage: node --import tsx src/tools/ending-forms-proof.ts export.json [share]
import { readFileSync } from "node:fs";
import {
  endingArmFor,
  pickEndingForm,
  verdictLeadsIn,
  type EndingForm,
} from "../editorial/endingforms.ts";
import { unitHash } from "../pipeline.ts";

type Row = {
  id: string;
  lane: string;
  live_at: string;
  script_json?: {
    series?: string;
    pulse_take?: { label?: string; narration?: string };
    loop_line?: string;
    room?: { arm?: string };
  };
};

const [file, shareArg] = process.argv.slice(2);
if (!file) throw new Error("usage: ending-forms-proof.ts export.json [share]");
const share = Number(shareArg ?? "0.5");
const rows = (JSON.parse(readFileSync(file, "utf8")) as Row[])
  .filter(
    (r) => !r.lane.startsWith("long") && r.script_json?.pulse_take?.narration,
  )
  .sort((a, b) => a.live_at.localeCompare(b.live_at));

let said = 0;
let segment = 0;
const samples: string[] = [];
const byDay = new Map<string, EndingForm[]>();
let forms = 0;
for (const r of rows) {
  const s = r.script_json!;
  const take = s.pulse_take!.narration!;
  const leads = [...verdictLeadsIn(take), ...verdictLeadsIn(s.loop_line ?? "")];
  const isSegment = (s.pulse_take?.label ?? "").toUpperCase() === "PULSE CHECK";
  if (isSegment) segment++;
  if (leads.length) {
    said++;
    if (samples.length < 6)
      samples.push(
        `  ${r.id} [${r.lane}${s.series ? "/" + s.series : ""}] "${leads[0]}" in: ${take.slice(-90)}`,
      );
  }
  // Who the test would have touched: Shorts that ended on the Pulse Check.
  if (!isSegment) continue;
  const arm = endingArmFor(unitHash(`endings:${r.id}`), share);
  if (arm !== "forms") continue;
  forms++;
  const day = r.live_at.slice(0, 10);
  // The real pick looks back 24 hours; the proof groups by publish day, which is close enough to show the spread.
  const used = byDay.get(day) ?? [];
  used.push(pickEndingForm(unitHash(`endform:${r.id}`), used));
  byDay.set(day, used);
}

console.log(`Published Shorts with a take in the export: ${rows.length}`);
console.log(`Ended on the PULSE CHECK card: ${segment}`);
console.log(`Said a verdict lead-in aloud (take or loop line): ${said}`);
console.log(samples.join("\n"));
console.log(
  `\nAt ENDING_FORMS_SHARE=${share}: ${forms} of ${segment} Pulse Check Shorts would have dropped the spoken verdict.`,
);
for (const [day, used] of [...byDay].sort()) {
  const counts = used.reduce<Record<string, number>>(
    (m, f) => ((m[f] = (m[f] ?? 0) + 1), m),
    {},
  );
  const max = Math.max(...Object.values(counts));
  console.log(`  ${day}: ${used.join(", ")}  (most uses of one form: ${max})`);
}
