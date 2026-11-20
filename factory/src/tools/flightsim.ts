// The flight simulator from the command line (src/flightsim): a simulated week of the whole factory in minutes.
//   node --import tsx src/tools/flightsim.ts --days 7 --faults all
//   --faults none | all | factcheck,token_expired,...   which faults to inject (see src/flightsim/faults.ts)
//   --seed N            repeatable runs (default 1)
//   --start ISO         the first simulated midnight (default 2026-11-16T00:00:00Z)
//   --json FILE         the whole record and results as JSON
//   --report FILE       a plain-English report (markdown)
//   --silent-hours N    hours without a Short before it counts as silent (default 30)
// Exit code 0 when every invariant holds, 1 when one breaks, 2 on a bad argument. Nothing reaches the network.

import fs from "node:fs/promises";
import path from "node:path";
import { parseFaults, FAULTS } from "../flightsim/faults.ts";
import { runFlightSim } from "../flightsim/run.ts";
import { reportMarkdown } from "../flightsim/report.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  if (process.argv.includes("--help")) {
    console.log(
      `flightsim --days N --faults all|none|ids [--seed N] [--start ISO] [--json FILE] [--report FILE]\nfaults: ${FAULTS.map((f) => f.id).join(", ")}`,
    );
    return 0;
  }
  const days = Number(arg("days") ?? 7);
  if (!Number.isFinite(days) || days < 1 || days > 60) {
    console.error("--days must be 1 to 60");
    return 2;
  }
  let faults: string[];
  try {
    faults = parseFaults(arg("faults") ?? "all");
  } catch (err) {
    console.error(String((err as Error).message));
    return 2;
  }
  const start = arg("start") ? new Date(arg("start")!) : undefined;
  const out = console.log.bind(console);
  out(`flight simulator: ${days} days, faults: ${faults.join(", ") || "none"}`);
  const r = await runFlightSim({
    days,
    faults,
    start,
    seed: Number(arg("seed") ?? 1),
    maxSilentHours: arg("silent-hours")
      ? Number(arg("silent-hours"))
      : undefined,
    onDay: (line) => out(`  ${line}`),
  });
  out(
    `done in ${r.stats.realSeconds}s real time: ${r.stats.ticks} ticks, ${r.stats.restarts} restarts, ${r.stats.published} published, ${r.stats.notices} notices`,
  );
  for (const x of r.results) {
    out(`${x.ok ? "PASS" : "FAIL"} ${x.id}: ${x.what}`);
    for (const p of x.problems.slice(0, 8)) out(`     - ${p}`);
    if (x.problems.length > 8)
      out(`     ... and ${x.problems.length - 8} more`);
  }
  const json = arg("json");
  if (json) {
    await fs.mkdir(path.dirname(path.resolve(json)), { recursive: true });
    await fs.writeFile(
      json,
      JSON.stringify(
        { results: r.results, stats: r.stats, record: r.record },
        null,
        1,
      ),
    );
  }
  const report = arg("report");
  if (report) {
    await fs.mkdir(path.dirname(path.resolve(report)), { recursive: true });
    await fs.writeFile(report, reportMarkdown(r, { days, faults }));
  }
  out(r.ok ? "every invariant held" : "AN INVARIANT BROKE");
  return r.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
