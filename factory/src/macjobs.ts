// What the PC and the Mac worker agree on (pure, imported from both sides, unit tested): which of an episode's
// files travel, how a finished render is judged, where a PC path lands on the Mac, and when the Mac's disk and
// memory leave room for a job. Owner, 1 Nov 2026: the factory stays on the PC, the jobs that don't need the
// PC's GPU go to the Mac mini. The orchestrator's budget for Pulse on the Mac: about 12 GB of its 16 GB of
// memory (so a quarter stays free) and never under 40 GB of free disk.

/** A heavy job starts only while at least this share of the Mac's memory is free (12 of 16 GB for Pulse). */
export const MIN_FREE_MEM_PCT = 25;

/** Exit codes of mac/worker.mts that mean "no turn" rather than "the job failed". */
export const EXIT_NO_TURN = 75;
export const EXIT_NO_ROOM = 76;

export interface RenderStats {
  durationSeconds: number;
  hasAudio: boolean;
  width: number;
  height: number;
  lufs: number;
  blackSeconds: number;
  flashes: number;
}

/**
 * Whether a render off the Mac may stand in for one made here; the reasons when not (the PC then renders).
 * The loudness is only checked for silence: the mastering to -16 LUFS comes after, in the pipeline.
 */
export function renderProblems(
  s: RenderStats,
  want: { seconds: number; width: number; height: number },
): string[] {
  const out: string[] = [];
  if (s.width !== want.width || s.height !== want.height)
    out.push(`resolution ${s.width}x${s.height}`);
  if (Math.abs(s.durationSeconds - want.seconds) > 1.5)
    out.push(
      `duration ${s.durationSeconds.toFixed(1)}s, wanted ${want.seconds.toFixed(1)}s`,
    );
  if (!s.hasAudio) out.push("no audio");
  else if (!Number.isFinite(s.lufs) || s.lufs < -40)
    out.push(`silent (${s.lufs} LUFS)`);
  if (s.blackSeconds > 0.8) out.push(`${s.blackSeconds.toFixed(1)}s of black`);
  if (s.flashes > 0) out.push(`${s.flashes} black flashes`);
  return out;
}

/** An episode file that is an output or scratch, so it does not travel to a render: the rest does (pure). */
export function skipForRender(rel: string): boolean {
  const r = rel.replace(/\\/g, "/");
  return (
    /^[^/]+\.mp4$/i.test(r) || // the finished videos at the top of the folder
    /^qa\//.test(r) ||
    /(^|\/)ff_work\//.test(r) ||
    /\.(part|tmp|ytdl)$/i.test(r) ||
    /^\.mac_out\//.test(r)
  );
}

/** Where a PC file lands inside a Mac job folder: the whole path kept, so two chapters cannot collide (pure). */
export function macPath(jobDir: string, pcFile: string): string {
  const p = pcFile
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, "$1")
    .replace(/^\/+/, "");
  return `${jobDir}/${p}`;
}

/** Room for a heavy job: the reason it must wait or go elsewhere, or undefined (pure). */
export function roomProblem(
  o: { freeGb: number; memFreePct: number },
  floorGb: number,
  needGb = 0,
): string | undefined {
  if (o.freeGb < floorGb + needGb)
    return `only ${Math.round(o.freeGb)} GB free on the Mac (floor ${floorGb} GB, job ${needGb} GB)`;
  if (o.memFreePct < MIN_FREE_MEM_PCT)
    return `only ${o.memFreePct}% of the Mac's memory free`;
  return undefined;
}

/** Job folders the sweep removes (pure): older than a day, or oldest first while the disk is under the floor. */
export function sweepPlan(
  jobs: Array<{ name: string; mtimeMs: number; bytes: number }>,
  freeBytes: number,
  floorGb: number,
  now: number,
): string[] {
  const out: string[] = [];
  let free = freeBytes;
  for (const j of [...jobs].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    const old = now - j.mtimeMs > 86_400_000;
    if (old || free < floorGb * 1e9) {
      out.push(j.name);
      free += j.bytes;
    }
  }
  return out;
}

/**
 * Whether the gameplay pass is due (pure): the highlight finder once per clock hour, the VOD download once a
 * day from 04:30 local, as the two PC tasks did.
 */
export function gameplayDue(
  last: { hour?: string; day?: string },
  local: { day: string; hour: number; minute: number },
): { finder: boolean; vods: boolean; hourKey: string } {
  const hourKey = `${local.day}T${String(local.hour).padStart(2, "0")}`;
  return {
    hourKey,
    finder: last.hour !== hourKey,
    vods:
      last.day !== local.day &&
      (local.hour > 4 || (local.hour === 4 && local.minute >= 30)),
  };
}
