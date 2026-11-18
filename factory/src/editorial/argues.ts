// Rankings and commentary as arguments (Top creator gap plan, gap 4, 18 Nov 2026). Ranking hits say "I" 19 to 40 times
// per 1,000 words (an encyclopaedic history says 1.8), end every entry on a spoken verdict, invite the fight inside 30
// seconds, give filler entries well under a minute and the top ones two or three times the rest, and put the verdict
// on the thumbnail (BEST and WORST). Commentary that holds states its verdict by 2:15 and then tests three to six
// numbered claims, ruling each one true, half true or wrong. Pulse's "Every Mainline GTA Game, Ranked" got 2 views: no
// "I", equal 200-word entries and a thumbnail that restated the title. A franchise history works only with a thesis,
// something exclusive and a finish line (the Army Men study).
//
// LONG_ARGUES=off|check|fix (default off), the same modes as LONG_OPENING_CONTRACT (src/editorial/longcontract.ts):
// "check" records the counts and reasons on the episode and changes nothing; "fix" gives the writers these rules and
// sends a miss back once, then accepts it with a note. Every count here is pure.

import { sentencesOf } from "./longform.ts";
import { loopTokens, nameTokens } from "./openloops.ts";
import { outsideQuotes } from "./voice.ts";
import {
  LONG_WPM,
  docWords,
  partStart,
  secondsAt,
  type LongDoc,
} from "./longcontract.ts";

const wc = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** "I" a ranking should reach per 1,000 spoken words. */
export const RANKING_I_PER_1000 = 20;
/** The fight is invited inside this many seconds. */
export const INVITE_WITHIN_SECONDS = 30;
/** Bottom-third entries run under this many seconds each. */
export const FILLER_SECONDS_MAX = 60;
/** The top three run at least this many times the median of the rest. */
export const TOP_TIMES_MEDIAN = 2;
/** Thumbnail words, at most. */
export const THUMB_WORDS_MAX = 4;
/** A commentary's verdict is said by this second (2:15). */
export const VERDICT_BY_SECONDS = 135;
/** The other side is given fairly inside this many seconds. */
export const STEELMAN_WITHIN_SECONDS = 120;
export const CLAIMS_MIN = 3;
export const CLAIMS_MAX = 6;

// ---------------------------------------------------------------- the narrator's "I"

const I_WORD = /(?:^|[^A-Za-z’'])I(?:['’](?:m|d|ve|ll))?(?=[^A-Za-z’']|$)/g;

/** The narrator's "I" per 1,000 words, outside quotations (pure). */
export function iPer1000(text: string): number {
  const t = outsideQuotes(text);
  const n = wc(t);
  return n ? (1000 * (t.match(I_WORD) ?? []).length) / n : 0;
}

const hasI = (s: string) => new RegExp(I_WORD.source).test(outsideQuotes(s));

/**
 * Whether an entry ends on the narrator's own verdict (pure): its last sentence, or the one before a short hand-over
 * line, is said in the first person.
 */
export function endsOnVerdict(text: string): boolean {
  const s = sentencesOf(text);
  const last = s.at(-1) ?? "";
  if (hasI(last)) return true;
  return s.length > 1 && wc(last) <= 22 && hasI(s.at(-2)!);
}

export function verdictLineProblems(text: string, title: string): string[] {
  return endsOnVerdict(text)
    ? []
    : [
        `"${title}" doesn't end on a verdict. Close it on one line in your own voice that says where you'd put it and why ("I'd still play this over GTA 3 tonight, and that's the whole case"), before any hand-over to the next entry.`,
      ];
}

// ---------------------------------------------------------------- unequal time

/** The word range an entry is written to under LONG_ARGUES fix, by where it sits (pure). `index` counts from the bottom. */
export function entryWordRange(index: number, count: number): [number, number] {
  const fromTop = count - 1 - index;
  if (fromTop < 3) return [300, 460];
  if (index < Math.floor(count / 3)) return [70, 140];
  return [130, 240];
}

/** The median of a list (pure). */
export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Unequal time (pure). `seconds` are the entries in spoken order (lowest rank first). The bottom third run under
 * FILLER_SECONDS_MAX each; each of the top three (the last three spoken) at least TOP_TIMES_MEDIAN times the median of
 * the other entries, so a six-entry list is not measured against itself.
 */
export function unequalTimeProblems(
  seconds: readonly number[],
  titles: readonly string[] = [],
): string[] {
  const n = seconds.length;
  if (n < 4) return [];
  const p: string[] = [];
  const name = (i: number) => titles[i] ?? `entry ${i + 1}`;
  const bottom = Math.floor(n / 3);
  for (let i = 0; i < bottom; i++)
    if (seconds[i]! >= FILLER_SECONDS_MAX)
      p.push(
        `"${name(i)}" runs ${Math.round(seconds[i]!)} s; a bottom-third entry stays under ${FILLER_SECONDS_MAX} s.`,
      );
  const rest = median(seconds.slice(0, n - 3));
  for (let i = n - 3; i < n; i++)
    if (seconds[i]! < TOP_TIMES_MEDIAN * rest)
      p.push(
        `"${name(i)}" runs ${Math.round(seconds[i]!)} s; a top-three entry runs at least ${TOP_TIMES_MEDIAN} times the others' median (${Math.round(TOP_TIMES_MEDIAN * rest)} s).`,
      );
  return p;
}

// ---------------------------------------------------------------- the fight, invited early

const INVITE =
  /\b(disagree\w*|argu\w*|fight|you'?ll hate|you won'?t like|controvers\w*|hot take|wrong|tell me|angry|upset|outrage\w*|bold call|i know,|i know\.|hear me out|come at me|hardest call|contested|divisive)\b/i;

/** Whether a line names one of the entries (pure): a name or telling word of the title. */
function namesEntry(text: string, titles: readonly string[]): boolean {
  const said = new Set([...nameTokens(` ${text}`), ...loopTokens(text)]);
  return titles.some((t) => {
    const own = [...nameTokens(` ${t}`), ...loopTokens(t)].filter(
      (x) => !["grand", "theft", "auto"].includes(x),
    );
    return own.some((x) => said.has(x));
  });
}

/** Within the first INVITE_WITHIN_SECONDS the intro names a contested placement and invites disagreement (pure). */
export function inviteProblems(
  intro: string,
  titles: readonly string[],
): string[] {
  const head = intro
    .split(/\s+/)
    .slice(0, Math.round((INVITE_WITHIN_SECONDS * LONG_WPM) / 60))
    .join(" ");
  const p: string[] = [];
  if (!INVITE.test(head))
    p.push(
      `Invite the disagreement inside ${INVITE_WITHIN_SECONDS} seconds: say plainly that one placement will start a fight.`,
    );
  if (!namesEntry(head, titles))
    p.push(
      `Name the most contested placement inside ${INVITE_WITHIN_SECONDS} seconds (which game, and roughly where), without giving away number one.`,
    );
  return p;
}

// ---------------------------------------------------------------- the thumbnail shows the verdict

const VERDICT_WORD =
  /\b(best|worst|overrated|underrated|robbed|mistake|wrong|flop|goat|trash|peak|last|first|no\.? ?1|#1|number one|top|bottom|not)\b/i;

/** The thumbnail's words show the verdict, not the title restated, in THUMB_WORDS_MAX words or fewer (pure). */
export function thumbVerdictProblems(
  thumb: string | undefined,
  title: string,
  titles: readonly string[] = [],
): string[] {
  const t = (thumb ?? "").trim();
  if (!t)
    return [
      `The thumbnail has no words; show the verdict in ${THUMB_WORDS_MAX} words or fewer ("BEST: V / WORST: 2").`,
    ];
  const p: string[] = [];
  const n = t.split(/[\s/]+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  if (n > THUMB_WORDS_MAX)
    p.push(`The thumbnail says ${n} words; ${THUMB_WORDS_MAX} at most.`);
  // Verdict words are the point even when the title has them too ("Worst to Best"): only the rest can restate it.
  const plain = (xs: Set<string>) => new Set([...xs].filter((x) => !VERDICT_WORD.test(x)));
  const own = plain(loopTokens(t));
  const titleTokens = plain(loopTokens(title));
  const restated =
    own.size > 0 &&
    [...own].filter((x) => titleTokens.has(x)).length >=
      Math.max(2, Math.ceil(own.size * 0.6));
  if (restated)
    p.push(
      `The thumbnail ("${t}") restates the title; show the verdict instead (best and worst, or the call people will argue with).`,
    );
  else if (!VERDICT_WORD.test(t) && !namesEntry(t, titles))
    p.push(
      `The thumbnail ("${t}") carries no verdict; name the best, the worst or the contested pick.`,
    );
  return p;
}

// ---------------------------------------------------------------- a ranking's report

export interface RankingReport {
  pass: boolean;
  problems: string[];
  measures: {
    iPer1000: number;
    entrySeconds: number[];
    verdictEntries: number;
    entries: number;
    inviteAtStart: boolean;
    thumb?: string;
  };
}

/** Everything LONG_ARGUES measures on a finished ranking (pure). Its chapters are the entries, lowest rank first. */
export function rankingReport(d: LongDoc): RankingReport {
  const titles = d.chapters.map((c) => c.title);
  const all = [d.hook, ...d.chapters.map((c) => c.text), d.outro].join(" ");
  const seconds = d.chapters.map(
    (_, i) =>
      secondsAt(d, partStart(d, i + 2)) - secondsAt(d, partStart(d, i + 1)),
  );
  const verdicts = d.chapters.map((c) => endsOnVerdict(c.text));
  const i = iPer1000(all);
  const invite = inviteProblems(d.hook, titles);
  const problems = [
    ...(i < RANKING_I_PER_1000
      ? [
          `"I" ${i.toFixed(1)} per 1,000 words; a ranking reaches ${RANKING_I_PER_1000}.`,
        ]
      : []),
    ...d.chapters.flatMap((c, k) =>
      verdicts[k]
        ? []
        : [`"${c.title}" doesn't end on a first-person verdict.`],
    ),
    ...invite,
    ...unequalTimeProblems(seconds, titles),
    ...thumbVerdictProblems(d.thumbText, d.title, titles),
  ];
  return {
    pass: problems.length === 0,
    problems,
    measures: {
      iPer1000: Math.round(i * 10) / 10,
      entrySeconds: seconds.map((s) => Math.round(s)),
      verdictEntries: verdicts.filter(Boolean).length,
      entries: d.chapters.length,
      inviteAtStart: invite.length === 0,
      ...(d.thumbText ? { thumb: d.thumbText } : {}),
    },
  };
}

// ---------------------------------------------------------------- the writers' rules for rankings (fix)

/** The ranking plan's rules (fix): the fight inside 30 s, verdict packaging, unequal time. */
export const ARGUES_PLAN_RULE = `This ranking is an argument, told by one person:
- Inside the first ${INVITE_WITHIN_SECONDS} seconds of the intro (about the first 75 words), name the most contested placement (which game, roughly where) and say plainly that people will disagree with it. Never give away number one.
- thumb_text shows the verdict in ${THUMB_WORDS_MAX} words or fewer, never the title restated: the best and the worst ("BEST: V / WORST: 2"), or the call people will argue with ("SAN ANDREAS ISN'T #1").
- Time follows interest: the bottom third of entries are short (under a minute each), the middle ones are standard, and the top three get at least twice the time of the rest, with their own story.
- Each entry's "angle" notes include the one-line verdict the narrator gives it.`;

/** The entry rules (fix): its own word range, a closing verdict and the narrator's "I". */
export function arguesEntryRule(range: [number, number]): string {
  return `This ranking is one person's argument. This entry is ${range[0]}-${range[1]} spoken words (this overrides the usual entry length). It ends on a one-line verdict in your own first person ("I'd still play this over GTA 3 tonight", "I put it here, and I'll defend it"); a short hand-over line to the next entry may follow it. Say "I" where you are judging, about ${RANKING_I_PER_1000 / 10} times in every 100 words across the video, always as opinion, never as a claim to have played, owned or been there.`;
}

// ---------------------------------------------------------------- claims, tested (commentary)

/** The outline shape "claims tested": each chapter is one numbered claim with its ruling. */
export const CLAIMS_OUTLINE_RULE = `Plan a commentary in the shape "claims tested", ${CLAIMS_MIN}-${CLAIMS_MAX} chapters, one per claim people are making about the subject. Each chapter title names the claim as a viewer would search it ("Is the Map Really Twice the Size?"). Its "focus" names the claim, who makes it, the evidence the sources hold and the ruling it earns: true, half true or wrong. Order them so the strongest case comes last. The "question" is the verdict the video defends, stated as a question. Claims built on leaks, insiders or datamined files are tested only on what the publisher has confirmed, and are called unconfirmed in the sentence that states them.`;

/** A claim chapter's shape, in place of the documentary chapter's (the brief says which number it is). */
export const CLAIMS_CHAPTER_SHAPE = `This is one claim of a commentary that tests claims; the brief gives its number. Open with a spoken signpost that numbers it ("Claim number two: ..." or "The second claim is ..."), then who makes it and why it sounds right, then the evidence from the SOURCE. Close with the ruling in one plain line in your own voice: "So that one is true", "so I'd call that half true" or "so that one is wrong". Anything leaked or reported but not confirmed is called unconfirmed in the same sentence that states it.`;

/** The commentary's opening (fix): a verdict by 2:15 and the other side given fairly first. */
export const CLAIMS_OPENING_RULE = `This commentary takes a side early: give your verdict in the first person by about 2 minutes 15 seconds ("I think most of it holds up, and here's where it doesn't"). Before that, give the other side its best case fairly in a few sentences ("to be fair, the case for it is..."). Then say how many claims you'll test.`;

const SIGNPOST =
  /\b(?:claim|number|point)\s+(?:one|two|three|four|five|six|[1-6])\b|\b(?:first|second|third|fourth|fifth|sixth|next|last|final)\s+(?:claim|one up|point)\b/i;
const RULING = /\b(?:half[- ]true|true|wrong|false|mostly true|not true)\b/i;
const VERDICT_EARLY =
  /\b(?:my verdict|my answer|i think|i'd say|i reckon|i believe|here's where i land|bottom line|the short answer)\b/i;
const STEELMAN =
  /\b(?:to be fair|in fairness|the case for|the best case|the other side|supporters|defenders|sceptics|skeptics|critics|in its defen[cs]e|credit where|fair enough|granted)\b/i;
const RUMOUR =
  /\b(?:leak\w*|insiders?|datamin\w*|rumou?r\w*|reportedly|supposedly|allegedly|unverified)\b/i;
const FLAGGED =
  /\b(?:unconfirmed|not confirmed|hasn['’]t (?:been )?confirmed|unverified|rumou?r\w*|hasn['’]t said|unofficial|not official)\b/i;

export interface ClaimsReport {
  pass: boolean;
  problems: string[];
  measures: {
    verdictAtSeconds?: number;
    steelmanAtSeconds?: number;
    claims: number;
    signposted: number;
    ruled: number;
    unflaggedRumours: number;
  };
}

/** The "claims tested" checks on a finished commentary (pure): its chapters are the claims. */
export function claimsReport(d: LongDoc): ClaimsReport {
  const all = [d.hook, ...d.chapters.map((c) => c.text), d.outro];
  const firstAt = (re: RegExp): number | undefined => {
    let at = 0;
    for (const s of sentencesOf(outsideQuotes(all.join(" ")))) {
      if (re.test(s)) return secondsAt(d, at);
      at += wc(s);
    }
    return undefined;
  };
  const verdictAt = firstAt(VERDICT_EARLY);
  const steelAt = firstAt(STEELMAN);
  const signposted = d.chapters.filter((c) =>
    SIGNPOST.test(sentencesOf(c.text).slice(0, 2).join(" ")),
  ).length;
  const ruled = d.chapters.filter((c) =>
    RULING.test(sentencesOf(c.text).slice(-2).join(" ")),
  ).length;
  const unflagged = sentencesOf(outsideQuotes(all.join(" "))).filter(
    (s) => RUMOUR.test(s) && !FLAGGED.test(s),
  );
  const n = d.chapters.length;
  const problems = [
    ...(verdictAt === undefined || verdictAt > VERDICT_BY_SECONDS
      ? [
          `The verdict ${verdictAt === undefined ? "is never said in the first person" : `arrives at ${Math.round(verdictAt)} s`}; say it by ${VERDICT_BY_SECONDS} s (2:15).`,
        ]
      : []),
    ...(steelAt === undefined || steelAt > STEELMAN_WITHIN_SECONDS
      ? [
          `Give the other side its best case fairly inside ${STEELMAN_WITHIN_SECONDS} s.`,
        ]
      : []),
    ...(n < CLAIMS_MIN || n > CLAIMS_MAX
      ? [`${n} claims; test ${CLAIMS_MIN} to ${CLAIMS_MAX}.`]
      : []),
    ...(signposted < n
      ? [
          `${n - signposted} claim${n - signposted === 1 ? "" : "s"} open without a spoken signpost ("Claim number two: ...").`,
        ]
      : []),
    ...(ruled < n
      ? [
          `${n - ruled} claim${n - ruled === 1 ? "" : "s"} close without a ruling (true, half true or wrong).`,
        ]
      : []),
    ...unflagged
      .slice(0, 3)
      .map(
        (s) =>
          `An unconfirmed claim isn't called unconfirmed in its own sentence: "${s.slice(0, 120)}"`,
      ),
  ];
  return {
    pass: problems.length === 0,
    problems,
    measures: {
      ...(verdictAt !== undefined
        ? { verdictAtSeconds: Math.round(verdictAt) }
        : {}),
      ...(steelAt !== undefined
        ? { steelmanAtSeconds: Math.round(steelAt) }
        : {}),
      claims: n,
      signposted,
      ruled,
      unflaggedRumours: unflagged.length,
    },
  };
}

// ---------------------------------------------------------------- the franchise-history guard

export interface FranchiseBrief {
  thesis?: string;
  exclusive?: string;
  finish_line?: string;
}

/**
 * A franchise history or "every game" piece is allowed only when its brief names a thesis, something exclusive and a
 * finish line (pure). Empty: allowed. Anything else is a story documentary and isn't held to this.
 */
export function franchiseGuardProblems(t: {
  kind?: string;
  format?: string;
  brief?: FranchiseBrief;
}): string[] {
  const history = t.kind === "franchise" || t.format === "everygame";
  if (!history) return [];
  const missing = (["thesis", "exclusive", "finish_line"] as const).filter(
    (k) => !t.brief?.[k]?.trim(),
  );
  return missing.length
    ? [
        `A franchise history needs a brief with a thesis, something exclusive and a finish line; missing: ${missing.join(", ").replace("finish_line", "finish line")}.`,
      ]
    : [];
}

/** Spoken words of a doc, for tools that print it. */
export const wordsOfDoc = docWords;
