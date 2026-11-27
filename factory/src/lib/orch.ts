// The PC orchestrator's client (C:\Claude\orchestrator\orch.mjs), loaded where there is one. On the Mac
// there is none (src/platform.ts orchClientUrl): callers then go ahead without a turn and say so once in
// the log, instead of each render failing an import of "file:///C:/..." and logging it as a warning.
import { orchClientUrl } from "../platform.ts";

export interface OrchClient {
  lease(cls: string, opts: Record<string, unknown>): Promise<() => void>;
}

/** Thrown when this machine has no orchestrator client at all (not when the orchestrator says no). */
export class NoOrchestrator extends Error {
  constructor() {
    super("no PC orchestrator on this machine");
  }
}

/** The orchestrator client, or a NoOrchestrator error where none is installed (the Mac). */
export async function loadOrch(
  platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): Promise<OrchClient> {
  const url = orchClientUrl(platform, env);
  if (!url) throw new NoOrchestrator();
  return (await import(url)) as OrchClient;
}

/** A lease that came back only after its maxWait ran out: the orchestrator never granted it (see leaseStrict). */
export class LeaseWaitRanOut extends Error {}

/**
 * A lease that counts only a real grant. 26 Nov 2026: the PC's picture upscale started ComfyUI at about 13:16 without
 * a grant and held the Explainer's p50 job for 57 minutes. The shared client (orch.mjs) resolved with a no-op release
 * when the hold process exited before its buffered TIMEOUT line was read (it fails open). So a lease that resolves at
 * or after its maxWait is taken as refused: whatever came back is released and this throws, so no GPU work starts.
 * The message starts "orchestrator:", as the client's own refusal does. A lease with no maxWait is passed through.
 * NoOrchestrator (the Mac) is not caught here: callers still go ahead without a turn there, as before.
 * The clock starts before the client spawns Python, so a real grant in the last seconds of maxWait is thrown away too:
 * that errs safe (a turn lost, nothing run ungranted). It cannot catch a client that fails open quickly (Python
 * missing, or dying at once); orch.mjs reads the whole output before failing open since 26 Nov for the TIMEOUT race.
 */
export async function leaseStrict(
  orch: OrchClient,
  cls: string,
  opts: Record<string, unknown>,
  now: () => number = Date.now,
): Promise<() => void> {
  const t0 = now();
  const release = await orch.lease(cls, opts);
  const maxWait = Number(opts.maxWait);
  if (
    opts.maxWait !== undefined &&
    opts.maxWait !== null &&
    Number.isFinite(maxWait) &&
    maxWait > 0 &&
    now() - t0 >= maxWait * 60_000
  ) {
    try {
      release();
    } catch {
      // a release that fails has nothing to give back
    }
    const what = cls === "gpu" ? "GPU" : cls;
    throw new LeaseWaitRanOut(
      `orchestrator: no ${what} turn (wait ran out after ${maxWait} min)${opts.job ? `: ${String(opts.job)}` : ""}`,
    );
  }
  return release;
}
