// The documentary evidence board style (EVIDENCE_STYLE, off by default; EVIDENCE_STYLE_SHARE splits by episode; owner,
// 26 Nov 2026: "Go for it"). Planned here, drawn by src/render/components/EvidenceStyle.tsx, its shape and geometry in
// src/render/evidenceboard.ts.
//
// What it adds, and the rules each part keeps:
//   - a big date card when a spoken line carries a date or a year: the figure and the rest of the date are the words
//     the narrator says (as the captions write them), never a date from elsewhere;
//   - a typed case card ("CASE: <topic>") where the Short's body or a long video's chapter starts: the topic is the
//     script's own headline or chapter title;
//   - red rubber stamps on words of the spoken line from a short neutral vocabulary (CONFIRMED, LEAKED, UNSOLVED and
//     the like), each landing with a small shake and the stamp's sound from Pulse's own SFX set (public/sfx/v3/land).
//     A negated word ("not confirmed") is never stamped; "never confirmed" is stamped whole. Every stamp, date and
//     case card is checked against the factory's advertiser word lists (src/streamweekly/patterns.ts ADVERTISER,
//     src/editorial/voice.ts ADVERTISER_SOFTER) and a crime-word guard, and dropped if any matches: no "murder" and
//     nothing like it, ever;
//   - board mode, for mystery and lore episodes only (GTA lore, conspiracies, timelines, crime stories; boardModeFor):
//     the stills play pinned to a cork board, the camera moving pin to pin while red string draws on between them as
//     the narration links them. Only Pulse's own pictures are pinned (game stills and footage frames, official art,
//     the owner's stream frames, licensed wiki art); never a photo of a real person, and on the Mac every picture goes
//     through Apple Vision's face finder first: one with a face big enough to be a likeness is never pinned.
//
// THE PASS MARK (EVIDENCE_PASS_MARK below; logged with every episode's arm as the "evidence_style" event): over at
// least 10 eligible episodes in each arm, matched by format (Shorts with Shorts, long videos with long videos, both
// arms mystery or lore episodes chosen the same way), the board arm passes when its mean average viewed percentage is
// at least 1 point above the plain arm's AND its median views are no lower. Fewer than 10 a side: no verdict yet.
// Switching EVIDENCE_STYLE_SHARE to 1 is for after a pass; a fail switches EVIDENCE_STYLE off.

import { createHash } from "node:crypto";
import type { Word } from "./voice/elevenlabs.ts";
import { displayWords, type Segment } from "./render/timeline.ts";
import { ADVERTISER } from "./streamweekly/patterns.ts";
import { ADVERTISER_SOFTER } from "./editorial/voice.ts";
import {
  CASE_FRAMES,
  DATE_FRAMES,
  STAMP_HOLD,
  type BoardCase,
  type BoardDate,
  type BoardFrame,
  type BoardPin,
  type BoardStamp,
  type BoardWindow,
  type EvidenceBoardPlan,
} from "./render/evidenceboard.ts";

export type EvidenceArm = "board" | "plain";

/** The pass mark, as the code comment above states it. */
export const EVIDENCE_PASS_MARK = {
  minPerArm: 10,
  viewedPointsAbove: 1,
  text: "board arm passes over >=10 matched eligible episodes a side when its mean average viewed % is >=1 point above the plain arm's and its median views are no lower",
} as const;

/**
 * The episode's arm (pure): the same episode always lands the same way. Share 0 (or the style off) is never
 * "board"; 1 is always.
 */
export function evidenceArm(episodeId: string, share: number): EvidenceArm {
  if (share >= 1) return "board";
  if (share <= 0) return "plain";
  const n = createHash("sha1")
    .update(`evidence:${episodeId}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share ? "board" : "plain";
}

/** What decides board mode: the script's own words about itself. */
export interface BoardModeInput {
  headline: string;
  title?: string;
  game?: string;
  /** Chapter titles of a long video, or a Short's beat cards. */
  chapters?: string[];
  /** A series tag or format name ("gta file", "documentary"). */
  kind?: string;
}

const GTA = /\b(grand theft auto|gta)\b/i;
const GTA_LORE =
  /\b(lore|backstory|history|secrets|myths?|legends?|myster\w*|timeline|origins?|behind the scenes|real[- ]life|inspired by|cut content|easter eggs?|took \w+ years|the making of)\b/i;
const MYSTERY =
  /\b(conspirac\w*|theor(?:y|ies)|myster\w*|unsolved|cover[- ]?ups?|secrets|cut content|easter eggs?|lore|legends?|myths?|cults?|lost media|unexplained)\b/i;
const TIMELINE =
  /\b(timeline|history of|the story of|rise and fall|what happened|took \w+ years|decades?|years later|every \w+ game)\b/i;
const CRIME =
  /\b(heists?|crimes?|criminal|cold case|hackers?|hacked|lawsuits?|scandal|investigat\w*|stolen|smuggl\w*|fraud|arrests?)\b/i;

/**
 * Whether an episode is a mystery or lore story the board suits (pure): GTA lore, conspiracies, timelines and crime
 * stories, read from the headline, title, chapter titles and format. A patch note or a price is never one.
 */
export function boardModeFor(t: BoardModeInput): {
  on: boolean;
  reason: string;
} {
  const text = [
    t.headline,
    t.title ?? "",
    ...(t.chapters ?? []),
    t.kind ?? "",
  ].join(" · ");
  if (GTA.test(`${t.game ?? ""} ${text}`) && GTA_LORE.test(text))
    return { on: true, reason: "gta lore" };
  if (MYSTERY.test(text)) return { on: true, reason: "mystery" };
  if (TIMELINE.test(text)) return { on: true, reason: "timeline" };
  if (CRIME.test(text)) return { on: true, reason: "crime story" };
  return { on: false, reason: "not a mystery or lore story" };
}

/** Crime and harm words the board never puts on screen, on top of the advertiser lists. */
const CRIME_GUARD =
  /\b(arrest\w*|crim\w*|gangs?|guns?|police|prison|jail\w*|drugs?|shoot\w*|shot|steal\w*|stolen|blood\w*|dead|die[sd]?|dying|kill\w*|murder\w*|weapons?|violen\w*|terror\w*|bomb\w*|hostages?|assault\w*|abuse\w*|victims?|corpse|suicid\w*)\b/i;

/** Whether on-screen text clears every advertiser list (pure). */
export function boardSafe(text: string): boolean {
  if (!text.trim()) return false;
  if (ADVERTISER.test(text) || CRIME_GUARD.test(text)) return false;
  return !ADVERTISER_SOFTER.some(([re]) => re.test(text));
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const bareOf = (t: string | undefined) =>
  (t ?? "").toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9']+$/g, "");
const YEAR = /^(19[5-9]\d|20[0-3]\d)(?:'s)?$/;
const DECADE = /^(19[5-9]0|20[0-3]0)s$/;
const DAY = /^([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?$/;
/** A figure followed by one of these is a count, not a year ("2,013 players", "2000 copies"). */
const UNIT =
  /^(dollars?|pounds?|euros?|players?|people|copies|units|gigabytes?|gb|hours?|minutes?|seconds?|frames?|percent|reviews?|votes?|times|points?|miles?|km|metres?|meters?|feet)$/;

/** Words that set a time before a bare year. */
const TIME_WORD =
  /^(in|since|by|of|from|until|till|before|after|around|early|late|mid|circa|back|spring|summer|autumn|fall|winter|year)$/;

const fr = (seconds: number, fps: number) => Math.round(seconds * fps);
const clash = (from: number, to: number, spans: Array<[number, number]>) =>
  spans.some(([a, b]) => from < b && to > a);

/** A spoken date or year: where it starts and what the card shows. */
export interface SpokenDate {
  at: number;
  big: string;
  sub?: string;
}

/**
 * The dates and years the narrator says, as the captions write them (pure): "September 17, twenty thirteen" is a
 * card "17" over "SEPTEMBER 2013"; "in two thousand four" is "2004"; a figure before a unit is a count, not a year.
 */
export function spokenDates(spoken: Word[]): SpokenDate[] {
  const w = displayWords(spoken);
  const out: SpokenDate[] = [];
  for (let i = 0; i < w.length; i++) {
    const b = bareOf(w[i]!.text);
    const month = MONTHS.indexOf(b);
    if (month >= 0) {
      // "September 17[, 2013]"; "may" and "march" are also everyday words, so they need a year after the day or a
      // time word before them ("on May 5").
      const d = bareOf(w[i + 1]?.text).match(DAY);
      const y = d ? bareOf(w[i + 2]?.text).match(YEAR) : null;
      const plainWord =
        (b === "may" || b === "march") &&
        !y &&
        !/^(on|in|by|since|from|until|till|of|before|after|early|late|mid)$/.test(
          bareOf(w[i - 1]?.text),
        );
      if (d && !plainWord) {
        out.push({
          at: w[i]!.start,
          big: d[1]!,
          sub: [MONTHS[month]!.toUpperCase(), y?.[1]].filter(Boolean).join(" "),
        });
        i += y ? 2 : 1;
        continue;
      }
      // "September 2013"
      const yr = bareOf(w[i + 1]?.text).match(YEAR);
      if (yr && !UNIT.test(bareOf(w[i + 2]?.text))) {
        out.push({
          at: w[i]!.start,
          big: yr[1]!,
          sub: MONTHS[month]!.toUpperCase(),
        });
        i += 1;
      }
      continue;
    }
    // "17[th] [of] September [2013]"
    const d = b.match(DAY);
    if (d) {
      const of = bareOf(w[i + 1]?.text) === "of" ? 1 : 0;
      const m = MONTHS.indexOf(bareOf(w[i + 1 + of]?.text));
      // Only "17th September" or "17 of September": a bare figure before a month word is a count ("the top 3 may").
      if (m >= 0 && (of || /(st|nd|rd|th)$/.test(b))) {
        const y = bareOf(w[i + 2 + of]?.text).match(YEAR);
        out.push({
          at: w[i]!.start,
          big: d[1]!,
          sub: [MONTHS[m]!.toUpperCase(), y?.[1]].filter(Boolean).join(" "),
        });
        i += 1 + of + (y ? 1 : 0);
        continue;
      }
    }
    const y = b.match(YEAR) ?? b.match(DECADE);
    // A bare year only after a word that sets a time ("in 2004", "since 1997") or closing its clause ("was 2013.").
    if (
      y &&
      !UNIT.test(bareOf(w[i + 1]?.text)) &&
      !/[\d,]\d{4}/.test(w[i]!.text) &&
      (TIME_WORD.test(bareOf(w[i - 1]?.text)) || /[.,;:!?]$/.test(w[i]!.text))
    ) {
      out.push({ at: w[i]!.start, big: DECADE.test(b) ? b : y[1]! });
    }
  }
  return out;
}

/**
 * The stamp vocabulary: words that read as a verdict on a file. Neutral and monetisation-safe by construction (no
 * crime, harm or violence word is in it); a stamp is the spoken word itself, never a synonym.
 */
const STAMP_WORD =
  /^(confirmed|unconfirmed|denied|leaked|unsolved|solved|classified|redacted|missing|rumou?red|delayed|cancell?ed|verified|debunked|spotted|hidden|secret|secretly|sealed|revealed|cracked|scrapped|abandoned|restarted|rebooted|reportedly|unreleased|unannounced|recast)$/;
/** An adverb the stamp keeps in front of its word ("QUIETLY CANCELLED", "NEVER CONFIRMED"). */
const STAMP_LEAD = /^(quietly|officially|finally|never|partly|still|mass)$/;
/** Words that turn the stamp word round or leave it open: never stamped after one of these. */
const NEGATES =
  /^(not|no|without|nor|if|whether|could|might|may|would|should|maybe|possibly|un)$|n't$/;

/** A stamp-worthy word of the spoken line (pure). */
export interface SpokenStamp {
  at: number;
  text: string;
}

/** The words of the spoken line the board may stamp, as the captions write them (pure). */
export function spokenStamps(spoken: Word[]): SpokenStamp[] {
  const w = displayWords(spoken);
  const out: SpokenStamp[] = [];
  for (let i = 0; i < w.length; i++) {
    const b = bareOf(w[i]!.text);
    if (!STAMP_WORD.test(b)) continue;
    const prev = bareOf(w[i - 1]?.text);
    const prev2 = bareOf(w[i - 2]?.text);
    if (NEGATES.test(prev) || NEGATES.test(prev2)) continue;
    const lead = STAMP_LEAD.test(prev) && !/[.,;:!?]$/.test(w[i - 1]!.text);
    const text = (lead ? `${prev} ${b}` : b).toUpperCase();
    if (!boardSafe(text)) continue;
    out.push({ at: lead ? w[i - 1]!.start : w[i]!.start, text });
  }
  return out;
}

/** A word that links one pin to the next: the string draws on as it is said. */
const LINK_WORD =
  /^(same|links?|linked|linking|connects?|connected|connection|ties?|tied|because|meant|led|behind|back)$/;

/** A picture the planner may pin: what the factory knows of where it came from. */
export interface PinCandidate {
  kind: string;
  provenance?: string;
  /** The biggest face Apple Vision found, as a share of the picture's area; absent when not checked. */
  faceShare?: number;
}

/** A face this big (share of the picture) is a likeness: the picture is never pinned. */
export const FACE_LIKENESS_SHARE = 0.04;
const PERSON_KINDS = new Set([
  "photo",
  "portrait",
  "person",
  "people",
  "stock",
  "headshot",
  "avatar",
]);
/** Provenance of a real person's picture or of anything not Pulse's own to show. */
const NOT_OURS =
  /\b(photo of|portrait|wikidata photo|P18|headshot|getty|reuters|associated press|afp|alamy|shutterstock|pexels|unsplash|stock|cut from|webcam|facecam|selfie|paparazzi)\b/i;
/** Provenance of Pulse's own sources: game stills and frames, official art, the owner's streams, licensed wiki art. */
const OURS =
  /\b(official|igdb|steam|in-game|gameplay|trailer|cutscene|scene index|pulse's own|capture|stream|vod|wiki|fandom|library|gallery|press (?:image|kit)|key art|screenshot|frame)\b/i;

/** Whether a picture may go on the board (pure): Pulse's own, never a real person, never a likeness. */
export function pinnable(c: PinCandidate): boolean {
  if (PERSON_KINDS.has(c.kind)) return false;
  const prov = c.provenance ?? "";
  if (NOT_OURS.test(prov)) return false;
  // An article's picture only when it is the publisher's own press art.
  if (
    c.kind === "article" &&
    !/\b(official|press (?:image|kit)|press image from)\b/i.test(prov)
  )
    return false;
  // No provenance, no pin: where a picture came from must be known to pin it.
  if (!OURS.test(prov)) return false;
  if ((c.faceShare ?? 0) >= FACE_LIKENESS_SHARE) return false;
  return true;
}

/** A shot of the plan (the Short's or the long video's). */
export interface PlanShotLike {
  start: number;
  end: number;
  segment: number;
  media: { type: string; index: number };
}

export interface BoardPlanInput {
  frame: BoardFrame;
  fps: number;
  totalFrames: number;
  episodeId: string;
  /** Board mode: the stills go on the board. Off: only the cards and stamps. */
  mode: boolean;
  words: Word[];
  segments: Segment[];
  /** The Short's case topic: its headline. A long video takes each chapter's title instead. */
  headline: string;
  shots: PlanShotLike[];
  images: PinCandidate[];
  /** Frames where nothing new lands: the opening poster, chapter breathers, the Short's own word stamp. */
  avoid?: Array<[number, number]>;
  /** A long video's breathers (seconds), where its chapters open. */
  breaks?: Array<{ start: number; end: number }>;
}

/** The most of each element, and the gaps between them. */
const LIMITS = {
  short: {
    dates: 3,
    stamps: 3,
    stampGap: 6,
    dateGap: 4,
    windowGap: 0,
    windowMax: 99999,
  },
  long: {
    dates: 40,
    stamps: 14,
    stampGap: 40,
    dateGap: 20,
    windowGap: 45,
    windowMax: 10,
  },
} as const;

/** The case topic, cut at a word boundary to what a card holds (pure). */
export function caseTopic(text: string, max = 34): string {
  const t = text.replace(/\s+/g, " ").trim().toUpperCase();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1).replace(/\s+\S*$/, "");
  return cut.replace(/[\s,:;.\-]+$/, "");
}

/**
 * The evidence board for one video (pure). Off (no plan) is the caller's choice; this always returns a plan, which
 * may be empty.
 */
export function planEvidenceBoard(input: BoardPlanInput): EvidenceBoardPlan {
  const { fps, frame } = input;
  const lim = LIMITS[frame];
  const avoid: Array<[number, number]> = [...(input.avoid ?? [])];
  const end = input.totalFrames;
  const fits = (from: number, frames: number) =>
    from >= 0 && from + frames <= end;

  // Case cards: the Short's body opens on its headline; a long video's first chapter on the video's headline (each
  // chapter's own title is already on its breather and its lower third, so a card repeating it would say it twice).
  const cases: BoardCase[] = [];
  if (frame === "short") {
    const body = input.segments[1];
    const topic = caseTopic(input.headline);
    const from = body ? fr(body.start, fps) + 6 : -1;
    if (
      body &&
      boardSafe(topic) &&
      fits(from, CASE_FRAMES) &&
      !clash(from, from + CASE_FRAMES, avoid)
    )
      cases.push({ from, frames: CASE_FRAMES, topic });
  } else {
    const s = input.segments.find(
      (x) =>
        x.kind === "beat" &&
        (x.visual?.kind === "chapter" || x.visual?.kind === "rank"),
    );
    const topic = caseTopic(input.headline);
    if (s && boardSafe(topic)) {
      // After the chapter's breather and clear of its lower third, as the narration runs on.
      const brk = (input.breaks ?? []).find(
        (b) => Math.abs(b.start - s.start) < 0.5,
      );
      const from = fr(brk ? brk.end : s.start, fps) + 6 * fps;
      if (fits(from, CASE_FRAMES) && !clash(from, from + CASE_FRAMES, avoid))
        cases.push({ from, frames: CASE_FRAMES, topic });
    }
  }
  for (const c of cases) avoid.push([c.from - 15, c.from + c.frames]);
  const breakSpans: Array<[number, number]> = (input.breaks ?? []).map((b) => [
    fr(b.start, fps),
    fr(b.end, fps),
  ]);
  avoid.push(...breakSpans);

  // Date cards: on the spoken date, one at a time, spaced.
  const dates: BoardDate[] = [];
  let lastDate = -1e9;
  for (const d of spokenDates(input.words)) {
    const from = fr(d.at, fps);
    if (dates.length >= lim.dates) break;
    if (from - lastDate < lim.dateGap * fps) continue;
    if (!fits(from, DATE_FRAMES) || clash(from, from + DATE_FRAMES, avoid))
      continue;
    if (!boardSafe(`${d.big} ${d.sub ?? ""}`)) continue;
    dates.push({
      from,
      frames: DATE_FRAMES,
      big: d.big,
      ...(d.sub ? { sub: d.sub } : {}),
    });
    lastDate = from;
  }
  const dateSpans: Array<[number, number]> = dates.map((d) => [
    d.from - 30,
    d.from + d.frames + 15,
  ]);

  // Stamps: on their words, spaced, clear of the dates, the cases and the Short's own word stamp.
  const stamps: BoardStamp[] = [];
  let lastStamp = -1e9;
  for (const s of spokenStamps(input.words)) {
    const from = fr(s.at, fps);
    if (stamps.length >= lim.stamps) break;
    if (from - lastStamp < lim.stampGap * fps) continue;
    if (
      !fits(from, STAMP_HOLD) ||
      clash(from, from + STAMP_HOLD, [...avoid, ...dateSpans])
    )
      continue;
    stamps.push({ from, frames: STAMP_HOLD, text: s.text });
    lastStamp = from;
  }

  // Board mode: runs of still shots on Pulse's own pictures become windows on the board.
  const pins: BoardPin[] = [];
  const windows: BoardWindow[] = [];
  if (input.mode) {
    const minShot = frame === "short" ? 24 : 45;
    const ok = input.shots.filter(
      (s) =>
        s.media.type === "image" &&
        s.end - s.start >= minShot &&
        !!input.images[s.media.index] &&
        pinnable(input.images[s.media.index]!) &&
        !clash(s.start, s.end, [...(input.avoid ?? []), ...breakSpans]),
    );
    const linkAt = (from: number, to: number): number | undefined => {
      const w = input.words.find(
        (x) =>
          fr(x.start, fps) >= from &&
          fr(x.start, fps) < to &&
          LINK_WORD.test(bareOf(x.text)),
      );
      return w ? fr(w.start, fps) : undefined;
    };
    let lastEnd = -1e9;
    for (let i = 0; i < ok.length; ) {
      // A run: shots that follow on (within a frame) from one another.
      let j = i;
      while (j + 1 < ok.length && ok[j + 1]!.start - ok[j]!.end <= 1) j++;
      const run = ok.slice(i, j + 1);
      i = j + 1;
      if (run[0]!.start - lastEnd < lim.windowGap * fps) continue;
      const cap = run[0]!.start + lim.windowMax * fps;
      const kept = run.filter((s) => s.start < cap);
      const win: BoardWindow = {
        from: kept[0]!.start,
        to: Math.min(cap, kept.at(-1)!.end),
        pins: [],
      };
      for (const s of kept) {
        const from = s.start;
        const to = Math.min(s.end, win.to);
        win.pins.push(pins.length);
        pins.push({
          image: s.media.index,
          from,
          to,
          stringAt: linkAt(from, to) ?? from + 10,
        });
      }
      windows.push(win);
      lastEnd = win.to;
    }
  }

  const seed = createHash("sha1")
    .update(`board:${input.episodeId}`)
    .digest()
    .readUInt32BE(0);
  return {
    version: 1,
    frame,
    mode: input.mode,
    dates,
    cases,
    stamps,
    pins,
    windows,
    allowed: input.mode
      ? input.images.flatMap((c, i) => (pinnable(c) ? [i] : []))
      : [],
    seed,
  };
}

/** Whether a plan draws anything at all. */
export function boardDrawsAnything(p: EvidenceBoardPlan): boolean {
  return (
    p.dates.length + p.cases.length + p.stamps.length + p.windows.length > 0
  );
}

/**
 * The biggest face in each picture as a share of its area, from Apple Vision on the Mac (src/assets/applevision.ts).
 * Off the Mac, or on any failure, the map is empty and `checked` is false: the kind and provenance rules still hold.
 */
export async function faceShares(
  files: string[],
): Promise<{ checked: boolean; shares: Map<string, number> }> {
  const { readBoxes } = await import("./assets/applevision.ts");
  const boxes = await readBoxes(files).catch(() => new Map());
  const shares = new Map<string, number>();
  for (const [file, b] of boxes) {
    const norm = (v: number, d: number) => (v > 1.0001 && d > 0 ? v / d : v);
    const biggest = (b.faces ?? []).reduce(
      (m: number, f: { w: number; h: number }) =>
        Math.max(m, norm(f.w, b.width) * norm(f.h, b.height)),
      0,
    );
    shares.set(file, biggest);
  }
  return { checked: boxes.size > 0, shares };
}

/** One episode's numbers for the verdict. */
export interface EvidenceRow {
  arm: EvidenceArm;
  /** YouTube's average viewed percentage, 0-100. */
  avgViewedPct: number;
  views: number;
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The pass mark applied to matched eligible episodes (pure); the caller matches them by format. */
export function evidenceVerdict(rows: EvidenceRow[]): {
  ready: boolean;
  pass?: boolean;
  board: { n: number; avgViewedPct: number; medianViews: number };
  plain: { n: number; avgViewedPct: number; medianViews: number };
} {
  const side = (arm: EvidenceArm) => {
    const r = rows.filter((x) => x.arm === arm);
    return {
      n: r.length,
      avgViewedPct: mean(r.map((x) => x.avgViewedPct)),
      medianViews: median(r.map((x) => x.views)),
    };
  };
  const board = side("board");
  const plain = side("plain");
  const ready =
    board.n >= EVIDENCE_PASS_MARK.minPerArm &&
    plain.n >= EVIDENCE_PASS_MARK.minPerArm;
  if (!ready) return { ready, board, plain };
  const pass =
    board.avgViewedPct >=
      plain.avgViewedPct + EVIDENCE_PASS_MARK.viewedPointsAbove &&
    board.medianViews >= plain.medianViews;
  return { ready, pass, board, plain };
}
