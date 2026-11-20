// A circuit breaker for the outside picture libraries: some days a library answers slowly or not at all
// (Openverse and the Internet Archive both timed out on 1 Nov 2026), and a gather that asks it a hundred times
// would wait on every one. After `failures` failures in a row the library is skipped for `coolMs`, answering
// with the fallback; one success resets the count.

import { errorMessage, log } from "./util.ts";

export interface Breaker {
  call<T>(fn: () => Promise<T>, fallback: T): Promise<T>;
  /** True while the library is being skipped. */
  open(): boolean;
}

export function breaker(
  name: string,
  failures = 2,
  coolMs = 10 * 60_000,
  now: () => number = Date.now,
): Breaker {
  let inRow = 0;
  let until = 0;
  return {
    open: () => now() < until,
    async call(fn, fallback) {
      if (now() < until) return fallback;
      try {
        const r = await fn();
        inRow = 0;
        return r;
      } catch (err) {
        inRow++;
        if (inRow >= failures) {
          until = now() + coolMs;
          inRow = 0;
          log(
            "warn",
            `${name} unavailable; skipped for ${Math.round(coolMs / 60_000)} minutes`,
            {
              error: errorMessage(err),
            },
          );
        }
        return fallback;
      }
    },
  };
}
