// Pip, the Pulse mascot (MASCOT_SHARE test, 14 Nov 2026): a small code-drawn amber character who reacts in the top
// right corner of a Short at two or three of its moments and is otherwise not on screen. He never talks, has no
// voice and no mouth movement tied to the narration; each reaction is a short pose with a face that says how the
// story lands (the owner ended the desk-voice test on 5 Nov because a second voice grated, so Pip stays silent).
//
// This module is pure: which moments of a Short Pip reacts to, with which face, and whether the reactions pass the
// graphics audit (owner, 12 Nov: every element sensible, aligned, readable and adding meaning). The drawing is
// src/render/components/Pip.tsx; the per-episode choice is mascotFor in src/experiments.ts.

import type { Segment } from "./timeline.ts";
import { BANDS, SAFE } from "./layout.ts";

export type PipMood =
  | "shocked"
  | "laughing"
  | "thinking"
  | "smug"
  | "facepalm"
  | "hype"
  | "sceptical"
  | "receipt";

export const PIP_MOODS: PipMood[] = [
  "shocked",
  "laughing",
  "thinking",
  "smug",
  "facepalm",
  "hype",
  "sceptical",
  "receipt",
];

/** What each face means, for the character sheet and the reports. */
export const PIP_MOOD_LABEL: Record<PipMood, string> = {
  shocked: "Shocked",
  laughing: "Laughing",
  thinking: "Thinking",
  smug: "Smug",
  facepalm: "Facepalm",
  hype: "Hype",
  sceptical: "Sceptical",
  receipt: "Receipt checked",
};

/** The three story beats Pip reacts to. */
export type PipBeat = "reveal" | "joke" | "verdict";

export interface PipMoment {
  beat: PipBeat;
  mood: PipMood;
  /** Seconds into the Short the reaction starts. */
  at: number;
  /** How long it stays on screen, seconds. */
  seconds: number;
  /** The segment it reacts to (index into the Short's segments). */
  segment: number;
}

/** Where Pip sits on a Short: the brand band's right end, beside the logo row, clear of everything else. */
export const PIP_SHORT = { left: 870, top: 154, size: 146 } as const;
/** The most a reaction moves Pip above or below his box, pixels (src/render/components/Pip.tsx keeps to it). */
export const PIP_BOB = 8;
/** One reaction: pop in, hold the face, pop out. Long enough to read a face, short enough to stay a reaction. */
export const PIP_REACT_SECONDS = 2.4;
/** Never in the hook: the first seconds belong to the headline. */
export const PIP_FIRST_SECOND = 3;
/** At least this long between two reactions, so they read as moments, not a presence. */
export const PIP_GAP_SECONDS = 4;
export const PIP_MAX_MOMENTS = 3;
export const PIP_MIN_MOMENTS = 2;

interface StampLike {
  at: number;
  text: string;
  sub?: string;
  tone?: string;
}

/**
 * Stories Pip stays out of altogether: people losing jobs, deaths, legal and safety stories. A cartoon reaction on
 * those would be in poor taste, so they carry no mascot on either side of the test (src/experiments.ts mascotFits).
 */
export const SERIOUS =
  // Game names are full of hard words (God of War, Death Stranding, Dead Space), so only plain news phrasings count.
  /\b(lay ?offs?|laid off|redundanc(y|ies)|job cuts?|cuts? \d+ jobs|(has|have|had) died|passed away|death of|funeral|lawsuits?|sued|suing|harass\w*|abuse\w*|sexual assault|mass shooting|cancer|hospital(ised|ized)|tragedy|tragic|studio clos(es|ed|ure|ing)|shut(s|ting)? down the studio)\b/i;

const DELAY =
  /\b(delay(s|ed)?|slip(s|ped)?|pushed back|moves? to|postpone\w*|lost \w+ months?|later than)\b/i;
const NEGATIVE =
  /\b(broken|bugs?|buggy|crash(es|ed)?|refunds?|pulled|backlash|input lag|downgrade\w*|price (rise|hike)s?|more expensive|offline|stuck|missed|cut it|cuts it|removed)\b/i;
const POSITIVE =
  /\b(free|finally|record|best[- ]\w+|biggest|out now|surprise|shadow.?drop|announced|returns?|back|sells?|sold|million|discount\w*|on sale|cheaper|price drop|leads)\b/i;
const RUMOUR =
  /\b(rumou?rs?|reportedly|allegedly|claims?|unconfirmed|leak(s|ed)?|insiders?|sources? (say|said|suggest))\b/i;
const CONFIRMED =
  /\b(confirm(s|ed)?|official(ly)?|verified|on record|in writing|announced|credited|it was, and)\b/i;
/** A line that turns the story: the catch, the exception, the other side. */
const TWIST =
  /^(here's the catch|the catch|except|but|that's not the whole story|turns out|granted|plot twist|still,|yet)\b/i;
const SARCASM =
  /\b(of course|naturally|classic|bold move|brave|good luck|no pressure|because why not|shocking(ly)?, no)\b/i;
const JOKE =
  /\b(apparently|somehow|yes, really|imagine|joke|meme|funny|hilarious|lol)\b|!/i;
const CALLED_IT =
  /\b(called it|told you|as expected|predictabl\w*|we'd still call it|right call|smart)\b/i;

/** The Pulse Check reading a take carries: on its card ("STEADY: ..."), else said in an older take. */
export function takeReading(
  seg: Segment,
): "strong" | "steady" | "weak" | "faint" | undefined {
  const m =
    seg.visual?.primary?.trim().match(/^(strong|steady|weak|faint)\b/i) ??
    seg.text.match(/pulse check:\s*(strong|steady|weak|faint)\b/i);
  return m
    ? (m[1]!.toLowerCase() as "strong" | "steady" | "weak" | "faint")
    : undefined;
}

/** The face for the reveal: from the stamp's tone when a stamp carries the reveal, else from the line. */
export function revealMood(
  text: string,
  isRumour: boolean,
  stamp?: StampLike,
): PipMood {
  const all = `${stamp?.text ?? ""} ${stamp?.sub ?? ""} ${text}`;
  if (stamp?.tone === "confirm" && !isRumour) return "receipt";
  if (DELAY.test(all) || (stamp?.tone === "alert" && NEGATIVE.test(all)))
    return "facepalm";
  if (stamp?.tone === "price") return "hype";
  if (isRumour || RUMOUR.test(all)) return "sceptical";
  if (NEGATIVE.test(all)) return "facepalm";
  if (POSITIVE.test(all) && stamp?.tone !== "alert") return "hype";
  return "shocked";
}

/** The face for the joke or the twist. */
export function jokeMood(text: string): PipMood {
  if (SARCASM.test(text)) return "smug";
  if (NEGATIVE.test(text) || DELAY.test(text)) return "facepalm";
  // "Here's the catch", "except" and "not the whole story" raise an eyebrow; "turns out" or "granted" make him think.
  if (TWIST.test(text.trim()))
    return RUMOUR.test(text) ||
      /^(here's the catch|the catch|except|that's not the whole story)\b/i.test(
        text.trim(),
      )
      ? "sceptical"
      : "thinking";
  return "laughing";
}

/** The face for the verdict: the Pulse Check reading first, then what the take says. */
export function verdictMood(seg: Segment, isRumour: boolean): PipMood {
  const reading = takeReading(seg);
  if (reading === "strong") return "hype";
  if (reading === "weak") return "facepalm";
  if (reading === "faint" || isRumour) return "sceptical";
  if (CALLED_IT.test(seg.text)) return "smug";
  if (CONFIRMED.test(seg.text) || /\btheory, not\b/i.test(seg.text))
    return "receipt";
  if (reading === "steady") return "thinking";
  if (NEGATIVE.test(seg.text)) return "facepalm";
  return "thinking";
}

const FIGURE_KINDS = new Set([
  "stat",
  "price",
  "score",
  "date",
  "countdown",
  "compare",
  "rank",
  "timeline",
  "versus",
  "specs",
  "milestones",
  "platforms",
]);

/**
 * Pip's moments on a Short (pure): the reveal (the word stamp when it lands after the hook, else the first beat
 * with a figure, else the first beat), the joke or twist (a beat that turns the story or jokes), and the verdict
 * (the take, on its "My verdict" or Pulse Check words when they are spoken). Never in the first PIP_FIRST_SECOND
 * seconds, never in the loop, at least PIP_GAP_SECONDS apart (the verdict first, then the reveal, then the joke),
 * at most three. Fewer than two means Pip sits this Short out.
 */
export function pipMoments(input: {
  segments: Segment[];
  stamps?: StampLike[];
  isRumour: boolean;
  /** Word timings, for the verdict's own words. */
  words?: Array<{ text: string; start: number }>;
  durationSeconds: number;
}): PipMoment[] {
  const { segments, isRumour } = input;
  const all = segments.map((s) => s.text).join(" ");
  if (SERIOUS.test(all)) return [];
  const loop = segments.find((s) => s.kind === "loop");
  const lastStart =
    Math.min(
      loop ? loop.start : input.durationSeconds,
      input.durationSeconds - 1.5,
    ) - PIP_REACT_SECONDS;
  const ok = (at: number) => at >= PIP_FIRST_SECOND && at <= lastStart;
  const segAt = (t: number) => {
    const i = segments.findIndex((s) => t >= s.start && t < s.end);
    return i < 0 ? segments.length - 1 : i;
  };
  const candidates: PipMoment[] = [];
  const add = (beat: PipBeat, mood: PipMood, at: number, segment: number) => {
    const t = Math.round(at * 100) / 100;
    if (ok(t))
      candidates.push({
        beat,
        mood,
        at: t,
        seconds: PIP_REACT_SECONDS,
        segment,
      });
  };

  // The verdict.
  const ti = segments.findIndex((s) => s.kind === "take");
  if (ti >= 0) {
    const take = segments[ti]!;
    const words = (input.words ?? []).filter(
      (w) => w.start >= take.start && w.start < take.end,
    );
    const lead = words.findIndex(
      (w, i) =>
        /^(verdict|check)[:?,.]?$/i.test(w.text) &&
        /^(my|pulse)$/i.test(words[i - 1]?.text ?? ""),
    );
    const at = lead >= 0 ? words[lead]!.start + 0.25 : take.start + 0.4;
    add("verdict", verdictMood(take, isRumour), at, ti);
  }

  // The reveal.
  const beats = segments
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind === "beat");
  const stamp = (input.stamps ?? []).find((st) => ok(st.at + 0.1));
  if (stamp) {
    const i = segAt(stamp.at);
    add(
      "reveal",
      revealMood(segments[i]!.text, isRumour, stamp),
      stamp.at + 0.1,
      i,
    );
  } else {
    const fig = beats.find(
      ({ s }) =>
        s.visual && FIGURE_KINDS.has(s.visual.kind) && ok(s.start + 0.6),
    );
    const first = fig ?? beats.find(({ s }) => ok(s.start + 0.6));
    if (first)
      add(
        "reveal",
        revealMood(first.s.text, isRumour),
        first.s.start + 0.6,
        first.i,
      );
  }

  // The joke or twist: on the line's last second, where the punchline lands, or at a twist's first words.
  const turn = beats.find(
    ({ s }) =>
      TWIST.test(s.text.trim()) || SARCASM.test(s.text) || JOKE.test(s.text),
  );
  if (turn) {
    const twist = TWIST.test(turn.s.text.trim());
    add(
      "joke",
      jokeMood(turn.s.text),
      twist
        ? turn.s.start + 0.3
        : Math.max(turn.s.start + 0.3, turn.s.end - 1.2),
      turn.i,
    );
  }

  // Keep the verdict, then the reveal, then the joke, each clear of the ones kept.
  const order: PipBeat[] = ["verdict", "reveal", "joke"];
  const kept: PipMoment[] = [];
  for (const beat of order)
    for (const c of candidates.filter((x) => x.beat === beat))
      if (
        kept.length < PIP_MAX_MOMENTS &&
        kept.every((k) => Math.abs(k.at - c.at) >= PIP_GAP_SECONDS)
      )
        kept.push(c);
  // Two moments may not share a face. The verdict keeps its face (it carries the Pulse Check reading); the reveal,
  // then the joke, take the next sensible one that is free.
  const used = new Set<PipMood>();
  for (const beat of order) {
    const i = kept.findIndex((k) => k.beat === beat);
    if (i < 0) continue;
    const k = kept[i]!;
    if (used.has(k.mood)) {
      const free = ALTERNATIVES[beat].find((m) => !used.has(m));
      if (free) kept[i] = { ...k, mood: free };
    }
    used.add(kept[i]!.mood);
  }
  kept.sort((a, b) => a.at - b.at);
  return kept.length >= PIP_MIN_MOMENTS ? kept : [];
}

/** A second choice of face per beat, when the first is already taken by another moment of the same Short. */
const ALTERNATIVES: Record<PipBeat, PipMood[]> = {
  verdict: ["thinking", "smug"],
  reveal: ["shocked", "thinking", "hype"],
  joke: ["thinking", "laughing", "smug", "shocked"],
};

/** The moment showing at a time (seconds), if any. */
export function momentAt(
  moments: PipMoment[],
  t: number,
): PipMoment | undefined {
  return moments.find((m) => t >= m.at && t < m.at + m.seconds);
}

export interface PipAuditFinding {
  at: number;
  problem: string;
}

/**
 * The graphics audit for Pip (pure): inside the brand band and the safe area (never over the hero picture, the
 * captions or the right-hand rail), out of the hook and the loop, two or three moments far enough apart, each held
 * long enough to read a face and each tied to the line it reacts to. Empty when all is well.
 */
export function auditPip(
  moments: PipMoment[],
  segments: Segment[],
  box: { left: number; top: number; size: number } = PIP_SHORT,
): PipAuditFinding[] {
  const out: PipAuditFinding[] = [];
  const bob = PIP_BOB;
  if (
    box.top - bob < BANDS.brand[0] - 6 ||
    box.top + box.size > BANDS.brand[1] + 6
  )
    out.push({
      at: 0,
      problem: `outside the brand band (y ${box.top} to ${box.top + box.size})`,
    });
  if (box.left < SAFE.left || box.left + box.size > SAFE.right)
    out.push({
      at: 0,
      problem: `outside the safe width (x ${box.left} to ${box.left + box.size})`,
    });
  if (
    moments.length &&
    (moments.length < PIP_MIN_MOMENTS || moments.length > PIP_MAX_MOMENTS)
  )
    out.push({ at: 0, problem: `${moments.length} moments (2 or 3 allowed)` });
  const loop = segments.find((s) => s.kind === "loop");
  moments.forEach((m, i) => {
    if (m.at < PIP_FIRST_SECOND) out.push({ at: m.at, problem: "in the hook" });
    if (loop && m.at + m.seconds > loop.start + 0.01)
      out.push({ at: m.at, problem: "runs into the loop" });
    if (m.seconds < 1.8)
      out.push({ at: m.at, problem: `only ${m.seconds} s on screen` });
    const prev = moments[i - 1];
    if (prev && m.at - prev.at < PIP_GAP_SECONDS)
      out.push({
        at: m.at,
        problem: `${(m.at - prev.at).toFixed(1)} s after the last`,
      });
    const seg = segments[m.segment];
    if (!seg || m.at < seg.start - 0.05 || m.at > seg.end + 0.05)
      out.push({ at: m.at, problem: "not on the line it reacts to" });
  });
  return out;
}
