// Dry run for DEMAND_STALE_DAYS on real readings (improvement engine, 20 Nov 2026). Reads a JSON dump of the
// factory's cached demand readings, replays the topics that went out with "demand not checked" between 15 and
// 19 Nov with YouTube searching paused, and prints what the pick would have seen with the setting off and on.
// Usage: node --import tsx src/tools/staledemand-proof.ts <readings.json>
import fs from "node:fs";
import {
  demandFor,
  demandLine,
  rankByDemand,
  type Demand,
  type DemandCache,
} from "../discovery/searchdemand.ts";

const rows = JSON.parse(fs.readFileSync(process.argv[2]!, "utf8")) as Demand[];

/** A cache over the dump as it stood at `at`: readings taken later than that are not visible. */
function cacheAt(at: Date): DemandCache {
  const visible = (q: string, hours: number) => {
    const d = rows.find((r) => r.query.toLowerCase() === q.toLowerCase());
    if (!d) return undefined;
    const age = at.getTime() - Date.parse(d.at);
    return age >= 0 && age < hours * 3600_000 ? d : undefined;
  };
  return {
    get: async (q) => visible(q, 24),
    set: async () => undefined,
    getAged: async (q, h) => visible(q, h),
  };
}

const paused = async (): Promise<never> => {
  throw new Error("YouTube fetch skipped: YouTube asked for a bot check");
};

// The blind picks from the alerts channel (time UK, lane, the picked topic) plus each pick's likely rivals.
const picks: Array<[string, string, string]> = [
  ["2026-11-17T10:23:00Z", "Why Short at 12:00", "Grand Theft Auto III"],
  ["2026-11-17T16:53:00Z", "Why Short at 18:30", "Grand Theft Auto IV"],
  ["2026-11-17T17:44:00Z", "Why Short at 18:30", "Grand Theft Auto Online"],
  ["2026-11-18T10:18:00Z", "Why Short at 12:00", "Grand Theft Auto V"],
  ["2026-11-18T18:06:00Z", "Why Short at 18:30", "Grand Theft Auto IV"],
  [
    "2026-11-15T21:05:00Z",
    "Why Short at 22:00",
    "Grand Theft Auto: San Andreas",
  ],
  ["2026-11-15T19:00:00Z", "Why Short at 18:30", "Bully"],
];
let before = 0;
let after = 0;
for (const [at, lane, topic] of picks) {
  const now = new Date(at);
  const cands = [{ name: topic, source: "seed" }];
  const off = await demandFor(cands, {
    search: paused,
    cache: cacheAt(now),
    lookups: 12,
    minViews: 20_000,
    now,
  });
  const on = await demandFor(cands, {
    search: paused,
    cache: cacheAt(now),
    lookups: 12,
    minViews: 20_000,
    now,
    staleDays: 10,
  });
  if (off.get(topic)) before++;
  if (on.get(topic)) after++;
  console.log(
    `${at.slice(0, 16)}  OFF: ${demandLine(lane, topic, off.get(topic), 0, now)}`,
  );
  console.log(
    `${" ".repeat(16)}  ON:  ${demandLine(lane, topic, on.get(topic), 0, now)}`,
  );
}
console.log(
  `\nPicks with a figure: ${before} of ${picks.length} with the setting off, ${after} of ${picks.length} with it on.`,
);

// A ranking-style candidate list on 19 Nov 20:19 with searching paused: the order the editor would see.
const now = new Date("2026-11-19T20:19:00Z");
const list = [
  "Steam Controller",
  "Grand Theft Auto V Enhanced",
  "remakes that beat the originals",
  "Grand Theft Auto",
  "The Legend of Zelda",
  "Resident Evil",
  "Call of Duty",
].map((name) => ({ name, source: "seed" }));
for (const staleDays of [0, 10]) {
  const demand = await demandFor(list, {
    search: paused,
    cache: cacheAt(now),
    lookups: 12,
    minViews: 20_000,
    now,
    staleDays,
  });
  const { kept } = rankByDemand(list, demand, 20_000);
  console.log(
    `\n19 Nov 20:19 ranking candidates, DEMAND_STALE_DAYS=${staleDays}:`,
  );
  for (const c of kept)
    console.log(`  ${c.name}${c.note ? `  [${c.note}]` : "  [no figure]"}`);
}
