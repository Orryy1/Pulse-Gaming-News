// The Pulse Lab's settings (owner, 14 Nov 2026): a set of formats made from the owner's own GTA 6 footage, read in one
// place (pure: the environment is passed in) so the rest of the config stays untouched. Everything is off by default,
// and nothing here adds a slot: a Lab format only dresses a gameplay-lane Short that was already going out (the same
// inbox, reviewer, cut and owner's tap in Discord), and GTA 6 Day N keeps its own daily slot and number.
//
//   PULSE_LAB             the master switch: nothing below runs without it
//   PULSE_LAB_RECEIPTS    "Receipts": a leak, rumour or preview claim graded TRUE, FALSE or PARTLY on the owner's footage
//   PULSE_LAB_MEASURED    "I measured it": a number measured on stream, the method on screen, the answer last
//   PULSE_LAB_TALLY       the running season tally on every series Short ("Receipts: 14 graded", "Day 12")
//   PULSE_LAB_ASKED       "You asked, I tested": viewers' asks and the poll feed tonight's test list, credited by handle
//   PULSE_LAB_VERSUS      "GTA 6 vs GTA 5": a split-screen test when the library has the same test in both games
//   PULSE_LAB_IDENTITY    the segment's sting, look and title shape (on with the master switch unless set false)

export interface PulseLabSettings {
  enabled: boolean;
  receipts: boolean;
  measured: boolean;
  tally: boolean;
  asked: boolean;
  versus: boolean;
  identity: boolean;
  /** PULSE_LAB_GAME: the game the Lab tests (GTA VI by any of its names). */
  game: string;
  /** PULSE_LAB_COMPARE_GAME: the older game a split-screen test compares with. */
  compareGame: string;
  /** PULSE_LAB_MIN_CONFIDENCE: how sure the miner's verdict must be before a claim is graded on screen. */
  minConfidence: number;
  /** PULSE_LAB_TONIGHT: viewer asks put at the top of tonight's stream test list (the daily stream-asks message). */
  tonight: number;
  /** PULSE_LAB_SEASON: the season the tallies count in ("1"); a new season starts every count again. */
  season: string;
  /** PULSE_LAB_TELEMETRY_DIR: where the HUD reader (claude/hudreader) writes its readings; empty: DATA_DIR/hudreader. */
  telemetryDir: string;
}

const bool = (env: NodeJS.ProcessEnv, name: string, fallback: boolean) => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
};

const num = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  lo: number,
  hi: number,
) => {
  const raw = env[name];
  const n = Number(raw);
  return raw === undefined || raw.trim() === "" || !Number.isFinite(n)
    ? fallback
    : Math.min(hi, Math.max(lo, n));
};

const SEASON_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,15}$/;

export function pulseLabSettings(env: NodeJS.ProcessEnv): PulseLabSettings {
  const enabled = bool(env, "PULSE_LAB", false);
  const sub = (name: string) => enabled && bool(env, name, false);
  const season = (env.PULSE_LAB_SEASON ?? "").trim();
  return {
    enabled,
    receipts: sub("PULSE_LAB_RECEIPTS"),
    measured: sub("PULSE_LAB_MEASURED"),
    tally: sub("PULSE_LAB_TALLY"),
    asked: sub("PULSE_LAB_ASKED"),
    versus: sub("PULSE_LAB_VERSUS"),
    identity: enabled && bool(env, "PULSE_LAB_IDENTITY", true),
    game: (env.PULSE_LAB_GAME ?? "").trim() || "Grand Theft Auto VI",
    compareGame:
      (env.PULSE_LAB_COMPARE_GAME ?? "").trim() || "Grand Theft Auto V",
    minConfidence: num(env, "PULSE_LAB_MIN_CONFIDENCE", 0.8, 0.5, 0.99),
    tonight: Math.round(num(env, "PULSE_LAB_TONIGHT", 2, 0, 5)),
    season: SEASON_SHAPE.test(season) ? season : "1",
    telemetryDir: (env.PULSE_LAB_TELEMETRY_DIR ?? "").trim(),
  };
}

/** The formats switched on, in the order the planner tries them. */
export function labFormatsOn(
  s: PulseLabSettings,
): Array<"versus" | "receipts" | "measured" | "asked"> {
  if (!s.enabled) return [];
  return [
    ...(s.versus ? (["versus"] as const) : []),
    ...(s.receipts ? (["receipts"] as const) : []),
    ...(s.measured ? (["measured"] as const) : []),
    ...(s.asked ? (["asked"] as const) : []),
  ];
}

/** Why the Lab cannot dress anything although it was switched on; undefined when it can (or is off). */
export function pulseLabProblem(
  s: PulseLabSettings,
  cfg: { gameplayEnabled: boolean; gameplayDirect: boolean },
): string | undefined {
  if (!s.enabled) return undefined;
  if (!cfg.gameplayEnabled)
    return "GAMEPLAY_ENABLED is off, and every Lab format is a gameplay-lane Short";
  if (!cfg.gameplayDirect)
    return "GAMEPLAY_DIRECT is off, and the Lab's graphics ride on the rebuilt gameplay Short";
  if (!labFormatsOn(s).length && !s.tally)
    return "PULSE_LAB is on but no format is (PULSE_LAB_RECEIPTS, _MEASURED, _ASKED, _VERSUS or _TALLY)";
  return undefined;
}

/** One line for the start-up summary. */
export function pulseLabSummary(
  s: PulseLabSettings,
  cfg: { gameplayEnabled: boolean; gameplayDirect: boolean },
): string {
  if (!s.enabled) return "off";
  const why = pulseLabProblem(s, cfg);
  const on = [
    ...labFormatsOn(s),
    ...(s.tally ? ["tally"] : []),
    ...(s.identity ? ["identity"] : []),
  ];
  return `${why ? `off: ${why}` : "on"} (${on.join(", ") || "nothing"}; ${s.game} vs ${s.compareGame}; season ${s.season}; grade at ${s.minConfidence})`;
}
