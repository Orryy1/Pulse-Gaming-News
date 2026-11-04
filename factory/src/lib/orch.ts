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
