// The faults the flight simulator injects (src/flightsim): each is a real failure the factory has met or will meet,
// with the words the real service uses, switched on for a stretch of simulated time. The schedule is fixed by the
// run's start and seed, so a run is repeatable.

export type FaultKind = "content" | "auth" | "quota" | "infra" | "restart";

export interface FaultSpec {
  id: string;
  kind: FaultKind;
  /** How long one occurrence lasts (simulated minutes). */
  minutes: number;
  /** Local hour of day it starts (Europe/London is close enough: the schedule only needs to be repeatable). */
  hourUtc: number;
  /** A fault tied to a lane's day (0 Sunday to 6 Saturday, UTC): the ranking's fact check falls on the long video's Saturday. */
  weekday?: number;
  what: string;
}

export const FAULTS: readonly FaultSpec[] = [
  {
    id: "factcheck",
    kind: "content",
    minutes: 720,
    hourUtc: 5,
    weekday: 6,
    what: 'a ranking whose fact check fails twice, worded as on 14 Nov (its summary says "quotation")',
  },
  {
    id: "writer_refusal",
    kind: "content",
    minutes: 240,
    hourUtc: 13,
    what: 'the writer refuses for missing evidence, as on 6 Nov ("refused")',
  },
  {
    id: "forbidden_west",
    kind: "content",
    minutes: 240,
    hourUtc: 13,
    what: "writer's notes in a Horizon Forbidden West Short (the game's name says \"Forbidden\")",
  },
  {
    id: "spoiler",
    kind: "content",
    minutes: 300,
    hourUtc: 12,
    what: "the writer puts a story spoiler of a game in its spoiler window in the script",
  },
  {
    id: "token_expired",
    kind: "auth",
    minutes: 180,
    hourUtc: 14,
    what: "the YouTube login expired (invalid_grant)",
  },
  {
    id: "quota",
    kind: "quota",
    minutes: 240,
    hourUtc: 15,
    what: "YouTube says quotaExceeded on uploads",
  },
  {
    id: "elevenlabs_credit",
    kind: "infra",
    minutes: 1440,
    hourUtc: 0,
    what: "ElevenLabs is out of characters (the local voice must take over)",
  },
  {
    id: "vision_down",
    kind: "infra",
    minutes: 360,
    hourUtc: 10,
    what: "the PC vision relay (Ollama) is down",
  },
  {
    id: "disk_full",
    kind: "infra",
    minutes: 60,
    hourUtc: 15,
    what: "the disk is full while rendering (ENOSPC)",
  },
  {
    id: "codex_timeout",
    kind: "infra",
    minutes: 300,
    hourUtc: 9,
    what: "Codex times out (20 minutes) on its routed steps, then Claude answers",
  },
  {
    id: "render_crash",
    kind: "infra",
    minutes: 120,
    hourUtc: 14,
    what: "the renderer's Chrome crashes",
  },
  {
    id: "network",
    kind: "infra",
    minutes: 90,
    hourUtc: 8,
    what: "the news feeds are unreachable (ECONNRESET)",
  },
  {
    id: "reboot_mid_upload",
    kind: "restart",
    minutes: 480,
    hourUtc: 9,
    what: "the Mac reboots while an upload is half sent",
  },
  {
    id: "restart_mid_step",
    kind: "restart",
    minutes: 480,
    hourUtc: 9,
    what: "the factory restarts during a render",
  },
  {
    id: "duplicate_upload",
    kind: "infra",
    minutes: 480,
    hourUtc: 9,
    what: "YouTube keeps the bytes but the answer is lost (duplicate upload risk)",
  },
  {
    id: "bad_metadata",
    kind: "content",
    minutes: 480,
    hourUtc: 9,
    what: "YouTube refuses one upload's title (HTTP 400 invalidTitle): that video's own metadata",
  },
];

export interface FaultWindow {
  id: string;
  kind: FaultKind;
  from: Date;
  to: Date;
}

/** The ids asked for: "all", "none" or a comma list (unknown ids are an error). */
export function parseFaults(raw: string): string[] {
  const v = raw.trim().toLowerCase();
  if (!v || v === "none") return [];
  if (v === "all") return FAULTS.map((f) => f.id);
  const ids = v.split(/[\s,]+/).filter(Boolean);
  const unknown = ids.filter((id) => !FAULTS.some((f) => f.id === id));
  if (unknown.length)
    throw new Error(
      `unknown fault(s): ${unknown.join(", ")}; known: ${FAULTS.map((f) => f.id).join(", ")}`,
    );
  return ids;
}

/**
 * When each fault happens (pure): one a day in turn from the second day, so day one is a clean baseline, and again
 * a week later in a run longer than a week. Every fault happens at least once when days >= faults + 1.
 */
export function faultSchedule(
  ids: readonly string[],
  start: Date,
  days: number,
): FaultWindow[] {
  const out: FaultWindow[] = [];
  const specs = FAULTS.filter((f) => ids.includes(f.id));
  const day0 = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  );
  const usable = Math.max(1, days - 1);
  specs.forEach((f, i) => {
    let first = 1 + (i % usable);
    if (f.weekday !== undefined)
      for (first = 1; first < days && new Date(day0 + first * 86_400_000).getUTCDay() !== f.weekday; ) first++;
    for (let d = first; d < days; d += Math.max(7, usable)) {
      const from = new Date(day0 + d * 86_400_000 + f.hourUtc * 3_600_000);
      out.push({
        id: f.id,
        kind: f.kind,
        from,
        to: new Date(from.getTime() + f.minutes * 60_000),
      });
    }
  });
  return out.sort((a, b) => a.from.getTime() - b.from.getTime());
}

export function activeAt(
  windows: readonly FaultWindow[],
  at: Date,
): FaultWindow[] {
  const t = at.getTime();
  return windows.filter((w) => w.from.getTime() <= t && t < w.to.getTime());
}
