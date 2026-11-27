// The flight simulator's clock (src/flightsim): one simulated instant that every part of the factory reads, so a
// week passes in minutes. While a run is going, the global Date answers with the simulated time (code that calls
// new Date() or Date.now() instead of s.now() sees it too) and long real waits (retry back-offs) are cut short.
// Everything is put back when the run ends.

const RealDate = Date;
const realSetTimeout = globalThis.setTimeout;

export class SimClock {
  private ms: number;
  constructor(start: Date) {
    this.ms = start.getTime();
  }
  now(): Date {
    // The global Date, so values made here pass instanceof checks while the clock is installed.
    return new globalThis.Date(this.ms);
  }
  get millis(): number {
    return this.ms;
  }
  /** Moves forward (never back): a step that takes time, or the scheduler going to its next event. */
  advance(ms: number): void {
    if (ms > 0) this.ms += ms;
  }
  set(at: Date): void {
    if (at.getTime() > this.ms) this.ms = at.getTime();
  }
}

let installed: SimClock | undefined;

/** Points the global Date at the clock and cuts real waits of a second or more to nothing (pure undo: uninstall). */
export function installClock(clock: SimClock): void {
  if (installed) throw new Error("a simulated clock is already installed");
  installed = clock;
  class SimDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(clock.millis);
      else super(...(args as [string | number | Date]));
    }
    static override now(): number {
      return clock.millis;
    }
  }
  (globalThis as { Date: DateConstructor }).Date =
    SimDate as unknown as DateConstructor;
  (globalThis as { setTimeout: unknown }).setTimeout = ((
    fn: (...a: unknown[]) => void,
    ms?: number,
    ...rest: unknown[]
  ) =>
    realSetTimeout(
      fn,
      typeof ms === "number" && ms >= 1000 ? 0 : ms,
      ...rest,
    )) as typeof setTimeout;
}

export function uninstallClock(): void {
  (globalThis as { Date: DateConstructor }).Date = RealDate;
  (globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout;
  installed = undefined;
}

export const REAL_DATE = RealDate;
