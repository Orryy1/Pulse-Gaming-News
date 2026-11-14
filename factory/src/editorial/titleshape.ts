// Title shapes for long videos and ranking Shorts (owner's growth plan, moves 3 to 5, 1 Nov 2026). Pulse's study
// of 1,573 long gaming videos found the winning titles name one subject plus its downfall, hidden side or comeback
// ("How Cyberpunk 2077 Saved Itself From Dying", 2.55M views for a six-video faceless channel; "60 Minutes That
// Destroyed Xbox's Empire"), while "Top N" titles (2 in the top quarter against 12 in the bottom), calendar titles
// ("2026", "so far": 0 against 11) and "History of" or "Evolution" titles (3 against 11) sat with the weakest.
// This module names a title's shape (its angle) and lists what breaks the rule, so the writers can be sent back,
// the title-test angles can be told apart and a failing title can give way to a passing alternative. A shape a
// running test has shown to work can be let back in (TITLE_SHAPE_ALLOW).

/** The angles a title can take; the first five are the winning shapes. */
export const TITLE_ANGLES = [
  "downfall",
  "hidden",
  "comeback",
  "why",
  "how",
  "claim",
  "list",
  "history",
  "plain",
] as const;
export type TitleAngle = (typeof TITLE_ANGLES)[number];

/** The shapes a test may let back in: TITLE_SHAPE_ALLOW=year,count,top,history. */
export type TitleShapeRule = "top" | "year" | "count" | "history";

const DOWNFALL =
  /\b(died|dying|dies|fell|fall of|fallen|failed|failure|flopped|flop|collapse[ds]?|crash(ed)?|ruined|destroyed|lost|losing|killed off|shut ?down|shuttered|closed|cancel(l)?ed|downfall|disaster|mistake|went wrong|broke|nearly (ended|sank|lost)|sank|doomed|betrayed|abandoned|backfired|ended up|ended|ending)\b/i;
const HIDDEN =
  /\b(what really happened|the truth|hidden|secret(ly)?|never released|never was|never came|unreleased|lost (game|version|build)|nobody (knew|saw|talks)|behind the|real reason|untold|buried|leaked|you never saw|quietly)\b/i;
const COMEBACK =
  /\b(saved|saving|comeback|came back|back from|redemption|redeemed|rescued|recovered|returned|revived|rebuilt|turned (it )?around|fixed|second chance|rose again|bounced back|won back)\b/i;
const LIST =
  /\b(ranked|ranking|every\b.*\b(game|campaign|entry)|tier list|worst to best|best to worst)\b/i;

const TOP_N = /\btop\s*(\d+|ten|five|twenty|fifteen)\b/i;
const YEAR = /\b(19[7-9]\d|20[0-4]\d)\b|\b(so far|this year|in \d{4})\b/i;
// A count at the front ("15 Halo Campaigns", "All 15 ...") or "N Best/Worst": a list promise.
const COUNT =
  /^(all |the )?\d+\s+(best|worst|great|big|biggest|most|games?|campaigns?|things|reasons|times|ways)\b|\ball \d+\b/i;
const HISTORY =
  /\b(the (complete |full |entire )?history of|a history of|evolution of|the evolution|history of)\b/i;

/** The title's angle: the strongest shape it carries, a plain list or history last. */
export function titleAngle(title: string): TitleAngle {
  const t = title.trim();
  if (HISTORY.test(t)) return "history";
  if (HIDDEN.test(t)) return "hidden";
  if (COMEBACK.test(t)) return "comeback";
  if (DOWNFALL.test(t)) return "downfall";
  if (/^why\b/i.test(t)) return "why";
  if (/^how\b/i.test(t)) return "how";
  // "The X That ..." and a contested claim ("..., and Halo 3 Isn't Number One") argue something.
  if (/^the\b.+\b(that|which|who)\b/i.test(t)) return "claim";
  if (
    /\b(isn't|is not|wasn't|was not|aren't|never|still|actually|wrong|overrated|underrated|beats?|better than)\b/i.test(
      t,
    )
  )
    return "claim";
  if (LIST.test(t) || TOP_N.test(t) || COUNT.test(t)) return "list";
  return "plain";
}

/** True for the winning shapes: a subject plus a downfall, hidden side or comeback, a "Why" or "How", or a claim. */
export function winningAngle(angle: TitleAngle): boolean {
  return !["list", "history", "plain"].includes(angle);
}

/**
 * What breaks the rule in a title, as feedback the writer can act on; empty when it passes. `allow` lets back in a
 * shape a test has shown to work; `count` (a list count) is the point of some formats, so the caller may allow it.
 */
export function titleShapeProblems(
  title: string,
  allow: readonly string[] = [],
): string[] {
  const t = title.trim();
  const out: string[] = [];
  const ok = (r: TitleShapeRule) => allow.includes(r);
  if (!ok("top") && TOP_N.test(t))
    out.push(
      `The title "${t}" is a "Top N" title; in Pulse's study those sat with the weakest videos. Name one subject and what happened to it instead.`,
    );
  if (!ok("year") && YEAR.test(t))
    out.push(
      `The title "${t}" carries a year or "so far"; calendar titles never reached the strongest quarter in Pulse's study. Leave the year out.`,
    );
  if (!ok("count") && COUNT.test(t))
    out.push(
      `The title "${t}" leads with a count; make it an argument instead (a named subject and a contested claim).`,
    );
  if (!ok("history") && HISTORY.test(t))
    out.push(
      `The title "${t}" is a "History of" or "Evolution" title; name one subject plus its downfall, hidden side or comeback instead ("How X Saved Itself", "Why X Fell", "The X That Never Was").`,
    );
  return out;
}

/** The title rule in one paragraph, for a writer's prompt. */
export const TITLE_SHAPE_RULE = `Title shape: one named subject plus its downfall, hidden side or comeback, or an argument about it: "Why X...", "How X...", "The X That...", "What Really Happened to X", "X Isn't Number One". In Pulse's study of 1,573 long gaming videos those won, while "Top N" titles, years ("2026", "so far"), leading counts and "History of" or "Evolution" titles sat with the weakest. Never those unless told otherwise.`;

/**
 * The best title to publish: the current one when it passes, else the first alternative that passes (and the
 * current one becomes an alternative). Returns undefined when nothing needs to change.
 */
export function shapedTitleSwap(
  current: string,
  alternatives: readonly string[],
  allow: readonly string[] = [],
): { title: string; alternatives: string[]; reason: string } | undefined {
  const problems = titleShapeProblems(current, allow);
  if (!problems.length) return undefined;
  const pick = alternatives.find(
    (a) => !titleShapeProblems(a, allow).length && winningAngle(titleAngle(a)),
  );
  if (!pick) return undefined;
  return {
    title: pick,
    alternatives: [current, ...alternatives.filter((a) => a !== pick)],
    reason: problems[0]!,
  };
}

/**
 * Two alternatives for a three-way title test, each a different angle from the current title and from each
 * other, best shapes first; titles that break the rule are left out.
 */
export function distinctAngles(
  current: string,
  candidates: ReadonlyArray<{ title: string; angle?: TitleAngle }>,
  allow: readonly string[] = [],
  max = 2,
): Array<{ title: string; angle: TitleAngle }> {
  const used = new Set<TitleAngle>([titleAngle(current)]);
  const seen = new Set([current.toLowerCase().trim()]);
  const out: Array<{ title: string; angle: TitleAngle }> = [];
  for (const c of candidates) {
    const key = c.title.toLowerCase().trim();
    if (seen.has(key) || titleShapeProblems(c.title, allow).length) continue;
    // The writer's label is a hint; the words decide (a "comeback" title with no comeback in it is plain).
    const own = titleAngle(c.title);
    const angle = own === "plain" && c.angle ? c.angle : own;
    if (used.has(angle)) continue;
    used.add(angle);
    seen.add(key);
    out.push({ title: c.title, angle });
    if (out.length >= max) break;
  }
  return out;
}
