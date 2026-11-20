// The flight simulator's plain-English report (src/flightsim).

import { FAULTS } from "./faults.ts";
import type { SimResult } from "./run.ts";

export function reportMarkdown(
  r: SimResult,
  o: { days: number; faults: string[] },
): string {
  const lines: string[] = [];
  lines.push(`# Flight simulator: ${o.days} simulated days`, "");
  lines.push(
    `${r.ok ? "Every invariant held." : "At least one invariant broke."} Real time ${r.stats.realSeconds} s.`,
    "",
  );
  lines.push(
    `- Passes: ${r.stats.ticks} Shorts ticks and ${r.stats.longTicks} long-lane ticks; ${r.stats.restarts} restarts`,
    `- Episodes by status: ${
      Object.entries(r.stats.episodes)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") || "none"
    }`,
    `- Videos on the fake channel: ${r.record.videos.length}; Discord notices: ${r.stats.notices}`,
    `- Voices used: ${
      Object.entries(r.stats.voices)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") || "none"
    }; Codex timeouts that fell back to Claude: ${r.stats.codexFallbacks}`,
    `- Model calls ${r.stats.llmCalls}, database queries ${r.stats.queries}`,
    `- Outbound requests the stubs refused: ${
      Object.entries(r.stats.strayHosts)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") || "none"
    }`,
    "",
  );
  lines.push("## Invariants", "");
  for (const x of r.results) {
    lines.push(`- ${x.ok ? "PASS" : "FAIL"} **${x.id}**: ${x.what}`);
    for (const p of x.problems.slice(0, 12)) lines.push(`  - ${p}`);
    if (x.problems.length > 12)
      lines.push(`  - and ${x.problems.length - 12} more`);
  }
  lines.push("", "## Faults injected", "");
  for (const w of r.record.faults) {
    const spec = FAULTS.find((f) => f.id === w.id);
    lines.push(
      `- ${w.from.toISOString().slice(0, 16)}Z to ${w.to.toISOString().slice(11, 16)}Z **${w.id}**: ${spec?.what ?? ""}`,
    );
  }
  if (r.record.crashes.length) {
    lines.push("", "## Restarts", "");
    for (const c of r.record.crashes)
      lines.push(
        `- ${c.at.slice(0, 16)}Z during ${c.where}; in flight: ${c.inFlight.length}`,
      );
  }
  return `${lines.join("\n")}\n`;
}
