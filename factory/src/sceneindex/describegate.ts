// When the scene index may describe shots on the PC's vision model (12-13 Nov 2026): the bulk looking reloads
// qwen3-vl on the 4090 (about 11 GB of RAM for its keep-alive) and sank an Orryy render to a tenth of its speed, so it
// was switched off (SCENE_INDEX_DESCRIBE=false). With DESCRIBE_HOURS it runs only in a quiet window ("01-07", local
// time in TIMEZONE) and only while the PC orchestrator shows no Orryy render or other heavy turn: on the PC that is
// read from the orchestrator's own lease file; on the Mac, which has no orchestrator, from the PC's LAN relay, which
// refuses the vision model's port while an Orryy render holds a turn (C:\Claude\orchestrator\lan_relay.py). The gate is
// asked before a batch and again every DESCRIBE_RECHECK shots, so a render that starts mid-batch stops it. Each look
// keeps the model loaded only 20 s after it (LOCAL_VISION_KEEP_ALIVE, default "20s").

import fs from "node:fs/promises";
import path from "node:path";
import { visionUp } from "./describe.ts";

/** Shots described between two looks at the gate. */
export const DESCRIBE_RECHECK = 40;

/**
 * Whether `now` falls in a DESCRIBE_HOURS window (pure): "01-07" is 01:00 to 06:59, "22-06" wraps past midnight,
 * several windows separate with commas. Empty: any time. A window that does not parse never opens.
 */
export function inDescribeHours(
  spec: string,
  now: Date,
  timezone = "Europe/London",
): boolean {
  const parts = spec
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return true;
  const hour =
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        hour12: false,
      }).format(now),
    ) % 24;
  return parts.some((p) => {
    const m = p.match(/^(\d{1,2})(?::00)?\s*-\s*(\d{1,2})(?::00)?$/);
    if (!m) return false;
    const a = Number(m[1]) % 24;
    const b = Number(m[2]) % 24;
    if (a === b) return true;
    return a < b ? hour >= a && hour < b : hour >= a || hour < b;
  });
}

export interface OrchLease {
  project?: string;
  class?: string;
  kind?: string;
  job?: string;
}

/**
 * The turn in the orchestrator's lease list that bars describing (pure): an Orryy render or build, or any heavy or GPU
 * turn of another project. Pulse's own turns do not count (they are this factory's). Undefined when none.
 */
export function blockingLease(
  leases: readonly OrchLease[],
): OrchLease | undefined {
  return leases.find(
    (l) =>
      String(l.kind ?? "").startsWith("orryy:") ||
      (l.project !== "pulse" && (l.class === "heavy" || l.class === "gpu")),
  );
}

/** The orchestrator's lease file on this machine, or undefined where there is none (the Mac). */
export function orchLeaseFile(
  env: Record<string, string | undefined> = process.env,
): string {
  return path.join(
    env.ORCH_STATE || "C:/Claude/orchestrator/state",
    "leases.json",
  );
}

export interface DescribeGateDeps {
  now?: () => Date;
  readLeases?: () => Promise<OrchLease[] | undefined>;
  relayUp?: () => Promise<boolean>;
}

/**
 * Whether shot describing may run now: the quiet window first, then the PC. Answers with the reason when it may not.
 * With DESCRIBE_HOURS unset the gate stays open (the behaviour before it), apart from the PC check, which always runs.
 */
export async function describeGate(
  env: Record<string, string | undefined> = process.env,
  deps: DescribeGateDeps = {},
): Promise<{ ok: boolean; why?: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const hours = env.DESCRIBE_HOURS ?? "";
  if (!inDescribeHours(hours, now, env.TIMEZONE || "Europe/London"))
    return { ok: false, why: `outside DESCRIBE_HOURS ${hours}` };
  const leases = await (
    deps.readLeases ??
    (async () => {
      try {
        const raw = JSON.parse(
          await fs.readFile(orchLeaseFile(env), "utf8"),
        ) as { leases?: OrchLease[] };
        return Array.isArray(raw.leases) ? raw.leases : [];
      } catch {
        return undefined;
      }
    })
  )();
  if (leases) {
    const bar = blockingLease(leases);
    return bar
      ? {
          ok: false,
          why: `the PC orchestrator shows ${bar.project ?? "a"} turn "${bar.job ?? bar.kind ?? "heavy work"}"`,
        }
      : { ok: true };
  }
  // No orchestrator here (the Mac): the PC's relay closes the vision port while an Orryy render holds a turn.
  return (await (deps.relayUp ?? visionUp)())
    ? { ok: true }
    : {
        ok: false,
        why: "the PC vision relay is not answering (it refuses while an Orryy render runs)",
      };
}
