// First step of each Studio browser routine (src/handsoff/studiogate.ts): is there anything to do?
//   node --import tsx src/tools/studio-gate.ts related|abtest|premieres|community
// Prints one line: "NONE <why>" (the routine ends there), "WORK <what>" (the routine carries on), or
// "ERROR <why>" when the factory's routine pages do not answer (the routine stops and reports, as before).
// Reads the factory's routine pages on the Mac (http://pulse-mac.local:8081, allowed for this PC); changes nothing
// there. Its own memory is D:\pulse-data\handsoff\studio-gate\state.json; each call is a line in decisions.jsonl.
import fs from "node:fs";
import path from "node:path";
import {
  abtestWork,
  communityWork,
  premiereWork,
  relatedWork,
  throttle,
  type GateMemo,
  type RoutineKind,
  type Verdict,
} from "../handsoff/studiogate.ts";

const BASE = process.env.PULSE_ROUTINE_BASE ?? "http://pulse-mac.local:8081";
const DIR =
  process.env.STUDIO_GATE_DIR ?? "D:\\pulse-data\\handsoff\\studio-gate";
const kind = process.argv[2] as RoutineKind;

async function page(p: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  if (!["related", "abtest", "premieres", "community"].includes(kind)) {
    console.log(
      "ERROR usage: studio-gate.ts related|abtest|premieres|community",
    );
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const stateFile = path.join(DIR, "state.json");
  let state: Record<string, GateMemo> = {};
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<
      string,
      GateMemo
    >;
  } catch {
    /* first run */
  }
  const now = new Date();
  const memo = state[kind];
  let v: Verdict;
  try {
    if (kind === "related") {
      const [related, viewers, exp] = await Promise.all([
        page("/routine/related?max=15").catch((e: Error) => ({
          ok: false,
          error: e.message,
        })),
        page("/routine/viewers"),
        fetch(`${BASE}/routine/export?days=3`, {
          signal: AbortSignal.timeout(90_000),
        })
          .then((r) =>
            r.ok ? (r.json() as Promise<Record<string, unknown>[]>) : [],
          )
          .catch(() => []),
      ]);
      v = relatedWork(
        related,
        viewers,
        Array.isArray(exp) ? exp : [],
        memo?.lastAllowedAt,
        now,
      );
    } else if (kind === "abtest") v = abtestWork(await page("/routine/abtest"));
    else if (kind === "premieres")
      v = premiereWork(await page("/routine/premieres"));
    else v = communityWork(await page("/routine/community"), now);
  } catch (err) {
    console.log(
      `ERROR the factory's routine pages did not answer (${(err as Error).message})`,
    );
    fs.appendFileSync(
      path.join(DIR, "decisions.jsonl"),
      `${JSON.stringify({ at: now.toISOString(), kind, error: (err as Error).message })}\n`,
    );
    return;
  }
  const t = throttle(v, memo, now);
  state[kind] = t.memo;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  fs.appendFileSync(
    path.join(DIR, "decisions.jsonl"),
    `${JSON.stringify({ at: now.toISOString(), kind, work: t.verdict.work, why: t.verdict.why, keys: t.verdict.keys.slice(0, 30) })}\n`,
  );
  console.log(`${t.verdict.work ? "WORK" : "NONE"} ${t.verdict.why}`);
}

void main();
