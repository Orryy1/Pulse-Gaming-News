// Whether the PC's vision relay (Ollama behind the PulseGaming-Ollama service) is answering, and the guard that
// keeps picture work off the paid Claude API while it is not. 7-11 Nov 2026: the relay's service host died on a
// log folder it could not write and stayed down for four days, and every frame check it would have screened went
// to Claude instead. The owner's rule since: no extra paid spend. With VISION_PAID_FALLBACK off (the default) a
// call carrying images is never sent to Claude while the relay is down. Codex takes it where CODEX_VISION allows
// (src/editorial/codex.ts); otherwise the call fails with VisionPausedError and each caller falls back to what it
// does without a model (the motion rule for clips, no picks for stills, the check skipped), so no slot waits.
// One alert when the relay goes down and one when it is back, never one per call.

import type { Llm, LlmContent } from "../editorial/llm.ts";
import { log } from "../lib/util.ts";

export const PAUSED_ALERT =
  "Picture checks paused: the PC vision relay is down";
export const BACK_ALERT =
  "Picture checks back on: the PC vision relay is answering again";

/** A picture call refused because the relay is down and the paid fallback is off. */
export class VisionPausedError extends Error {
  constructor() {
    super(
      "picture check skipped: the PC vision relay is down and VISION_PAID_FALLBACK is off",
    );
    this.name = "VisionPausedError";
  }
}

export function isVisionPaused(err: unknown): boolean {
  return (
    err instanceof VisionPausedError ||
    (err as Error | undefined)?.name === "VisionPausedError"
  );
}

/** `value` for a refused picture call, anything else thrown on: `.catch(whenVisionPaused(fallback))`. */
export function whenVisionPaused<T>(value: T): (err: unknown) => T {
  return (err) => {
    if (isVisionPaused(err)) return value;
    throw err;
  };
}

/** True when a call's content carries at least one image. */
export function hasImages(content: string | LlmContent): boolean {
  return typeof content !== "string" && content.some((p) => p.type === "image");
}

export type RelayState = "unknown" | "up" | "down";

export interface VisionRelay {
  /** True while the relay is down. Probes it when the last word on it is older than `probeEveryMs`. */
  down(): Promise<boolean>;
  /**
   * A real vision call's outcome. A failed call marks the relay down until a call succeeds: a server that answers
   * the probe but cannot run the model is still down for picture work.
   */
  report(up: boolean, error?: string): void;
  state(): RelayState;
}

export interface RelayOptions {
  /** True when the relay answers (a cheap request, no model run). */
  probe: () => Promise<boolean>;
  /** The owner's alert: called once when the relay goes down and once when it is back. */
  alert: (text: string) => unknown;
  /** Called when the relay comes back, so local screening resumes at once. */
  onUp?: () => void;
  now?: () => number;
  /** How long a probe's answer stands (default one minute). */
  probeEveryMs?: number;
}

export function createVisionRelay(opts: RelayOptions): VisionRelay {
  const now = opts.now ?? Date.now;
  const every = opts.probeEveryMs ?? 60_000;
  let state: RelayState = "unknown";
  // A down set by a failed call is lifted only by a call that works, never by the probe alone.
  let sticky = false;
  let heardAt = 0;
  let probing: Promise<boolean> | undefined;
  const say = (text: string) => {
    try {
      Promise.resolve(opts.alert(text)).catch(() => undefined);
    } catch {
      // an alert that cannot be sent never stops the work
    }
  };
  const set = (up: boolean, fromCall: boolean, error?: string) => {
    heardAt = now();
    if (up) {
      if (state === "down" && sticky && !fromCall) return;
      const was = state;
      state = "up";
      sticky = false;
      if (was === "down") {
        log("info", "PC vision relay is back; picture checks on again");
        say(BACK_ALERT);
        opts.onUp?.();
      }
      return;
    }
    if (fromCall) sticky = true;
    if (state === "down") return;
    state = "down";
    log(
      "warn",
      "PC vision relay is down; picture checks paused, nothing goes to the paid API",
      { error },
    );
    say(PAUSED_ALERT);
  };
  return {
    async down() {
      if (state !== "unknown" && now() - heardAt < every)
        return state === "down";
      if (state === "down" && sticky) {
        // A failed real call keeps it down until a call works: a probe alone cannot lift it, so none is sent.
        heardAt = now();
        return true;
      }
      probing ??= opts
        .probe()
        .catch(() => false)
        .then((up) => {
          set(up, false, up ? undefined : "no answer to the probe");
          return !up;
        })
        .finally(() => {
          probing = undefined;
        });
      return probing;
    },
    report(up, error) {
      set(up, true, error);
    },
    state: () => state,
  };
}

/**
 * Claude with picture calls refused while the relay is down (VISION_PAID_FALLBACK off). Text calls, and every
 * call while the relay answers, go through untouched. With the paid fallback on this is Claude as before.
 */
export function withVisionGuard(
  llm: Llm,
  opts: { paidFallback: boolean; relayDown: () => Promise<boolean> },
): Llm {
  if (opts.paidFallback) return llm;
  return {
    async structured(o) {
      // Not knowing is not a licence to spend: a relay check that throws counts as down.
      if (hasImages(o.content) && (await opts.relayDown().catch(() => true)))
        throw new VisionPausedError();
      return llm.structured(o);
    },
  };
}
