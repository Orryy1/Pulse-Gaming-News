// The cut itself (pure): the plan, the script and the measured narration become a timeline the renderer draws, the
// YouTube chapter list, the description with its Day N links, the pinned comment and the graphics audit.
//
//   0:00   the teaser: the week's best moment, nine seconds of it at full sound, "Coming up"
//   0:09   the intro: the week's title over three glimpses of the week, the narrator's intro, the game's sound low
//   then   each chapter: the chapter card (the long videos' own card, identical every time) over the footage leading
//          into its first moment; then for every moment the narrator's setup over the lead-in, the game's sound low
//          under the voice, and the moment itself at full sound with its label (Day N and what it is) on screen
//   last   the outro over the footage after the last moment, then the end card for 20 seconds (the playlist of the
//          daily Shorts and the channel), the game's sound fading out under it
// The narrator never talks over a moment: his lines sit on the footage before it. Strong language inside a moment
// is muted for its words. Every time is in seconds; the renderer turns them into frames.

import {
  auditLongGraphics,
  readNeed,
  type GfxAudit,
  type LongGfxMoment,
} from "../qa/gfxaudit.ts";
import { finishChapters, stamp } from "../youtube/chapters.ts";
import { GTA_DAILY_PLAYLIST, playlistUrl, videoUrl } from "../gtadaily.ts";
import { END_CARD_SECONDS } from "../render/bookends.ts";
import type { PlannedMoment, WeekPlan } from "./chapters.ts";
import { shortGameName } from "./chapters.ts";
import { playOrder, type WeekScript } from "./script.ts";

export const TEASER_BEFORE = 5;
export const TEASER_AFTER = 4;
export const CARD_SECONDS = 3;
/** Air between the end of a setup line and the moment's own sound coming up. */
export const VOICE_AIR = 0.6;
/** The shortest a label stays up (owner, 5 Nov 2026: graphics "disappear WAYYYY too quick to digest"). */
export const LABEL_MIN = 4.5;
/** The game's sound under the narrator, and under the end card at its start. */
export const DUCK = 0.16;

export interface Voice {
  key: string;
  /** Relative to the episode folder. */
  file: string;
  seconds: number;
  text: string;
  words?: Array<{ text: string; start: number; end: number }>;
}

export interface TlClip {
  key: string;
  /** The recording and the stretch of it (seconds). */
  source: string;
  srcFrom: number;
  srcTo: number;
  /** Where it sits on the timeline. */
  at: number;
  len: number;
  /** Stretches (relative to the clip) where the game's sound sits under the narrator. */
  ducked: Array<{ from: number; to: number }>;
  /** Stretches (relative to the clip) muted for strong language. */
  muted: Array<{ from: number; to: number }>;
  /** The sound fades out over the clip (the end card). */
  fadeOut?: boolean;
}

export interface TlVoice {
  key: string;
  file: string;
  at: number;
  len: number;
  text: string;
}

export interface TlCard {
  number: number;
  title: string;
  at: number;
  len: number;
}

export interface TlLabel {
  key: string;
  /** The small line above ("DAY 3 · TESTED"). */
  tag: string;
  text: string;
  at: number;
  len: number;
}

export interface Timeline {
  seconds: number;
  clips: TlClip[];
  voices: TlVoice[];
  cards: TlCard[];
  labels: TlLabel[];
  title: { text: string; sub: string; at: number; len: number };
  teaser: { at: number; len: number };
  endCard: { at: number; len: number };
  /** YouTube chapter marks: seconds and title. */
  marks: Array<{ t: number; title: string }>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const TAG: Record<PlannedMoment["kind"], string> = {
  test: "TESTED",
  myth: "MYTH CHECK",
  challenge: "CHALLENGE",
  hidden: "HIDDEN DETAIL",
  funny: "FUNNY MOMENT",
  action: "BEST MOMENT",
};

/** A moment's small label line: its day and what it is, with the ask's verdict when it settled one (pure). */
export function labelTag(m: PlannedMoment): string {
  const kind = m.ask
    ? m.ask.result === "proved"
      ? "TESTED: TRUE"
      : "TESTED: FALSE"
    : TAG[m.kind];
  return [m.day ? `DAY ${m.day}` : "", kind].filter(Boolean).join(" · ");
}

/** Builds the timeline (pure). `voices` must hold intro, every moment key and outro. */
export function buildTimeline(
  p: WeekPlan,
  s: WeekScript,
  voices: Map<string, Voice>,
  o: { duration: (vodFile: string) => number },
): Timeline {
  const need = (k: string) => {
    const v = voices.get(k);
    if (!v) throw new Error(`no narration for ${k}`);
    return v;
  };
  const clips: TlClip[] = [];
  const tlVoices: TlVoice[] = [];
  const cards: TlCard[] = [];
  const labels: TlLabel[] = [];
  const marks: Timeline["marks"] = [];
  const order = playOrder(p);
  if (!order.length) throw new Error("the plan has no moments");
  const teaserM = p.teaser ?? order[0]!.m;
  let t = 0;

  // The teaser: the week's best moment, at full sound.
  const tFrom = Math.max(0, teaserM.peak - TEASER_BEFORE);
  const tLen = TEASER_BEFORE + TEASER_AFTER;
  clips.push({
    key: "teaser",
    source: teaserM.file,
    srcFrom: r2(tFrom),
    srcTo: r2(tFrom + tLen),
    at: 0,
    len: tLen,
    ducked: [],
    muted: inside(teaserM, tFrom, tLen),
  });
  t = tLen;
  marks.push({ t: 0, title: `${shortGameName(p.game)} Week ${p.week} Intro` });

  // The intro: three glimpses of the week under the narrator, the title on screen.
  const intro = need("intro");
  const introLen = r2(intro.seconds + 0.4 + VOICE_AIR);
  const glimpses = order.filter((x) => x.m !== teaserM).slice(0, 3);
  const pieces = glimpses.length ? glimpses : [{ key: "teaser", m: teaserM }];
  const each = introLen / pieces.length;
  pieces.forEach((g, i) => {
    // From before the moment's own lead-in, so no picture is shown twice.
    const lead = need(g.key).seconds + VOICE_AIR + 0.2 + CARD_SECONDS;
    const srcTo = Math.max(each, g.m.start - lead);
    const srcFrom = Math.max(0, srcTo - each);
    clips.push({
      key: `intro${i + 1}`,
      source: g.m.file,
      srcFrom: r2(srcFrom),
      srcTo: r2(srcFrom + each),
      at: r2(t + i * each),
      len: r2(each),
      ducked: [{ from: 0, to: r2(each) }],
      muted: [],
    });
  });
  tlVoices.push({
    key: "intro",
    file: intro.file,
    at: r2(t + 0.4),
    len: intro.seconds,
    text: intro.text,
  });
  const title = {
    text: s.title.split(":")[0]!.toUpperCase(),
    sub: "BEST MOMENTS, TESTS AND DISCOVERIES",
    at: r2(t),
    len: Math.min(introLen, 5),
  };
  t = r2(t + introLen);

  // The chapters. A lead-in never re-shows footage another moment already used: it starts where that one ended,
  // and when that leaves too little room the setup line runs on into the moment's first seconds, the sound under it.
  const used = order.map((x) => ({ file: x.m.file, from: x.m.start, to: x.m.end }));
  let n = 0;
  let k = 0;
  for (const c of p.chapters) {
    cards.push({ number: ++n, title: c.title, at: t, len: CARD_SECONDS });
    marks.push({ t, title: c.title });
    c.moments.forEach((m, i) => {
      const key = order[k++]!.key;
      const v = need(key);
      const card = i === 0 ? CARD_SECONDS : 0;
      const voiceAt = card + 0.2;
      const lead = r2(voiceAt + v.seconds + VOICE_AIR);
      let srcFrom = Math.max(0, m.start - lead);
      for (const u of used)
        if (u.file === m.file && u.from < m.start && u.to > srcFrom) srcFrom = Math.min(m.start, u.to);
      const realLead = r2(m.start - srcFrom);
      const len = r2(realLead + (m.end - m.start));
      const voiceStart = Math.max(Math.min(voiceAt, realLead), realLead - v.seconds - VOICE_AIR);
      const voiceEnd = voiceStart + v.seconds;
      clips.push({
        key,
        source: m.file,
        srcFrom: r2(srcFrom),
        srcTo: r2(m.end),
        at: t,
        len,
        ducked: [{ from: 0, to: r2(Math.max(realLead - 0.3, voiceEnd + 0.2)) }],
        muted: inside(m, srcFrom, len),
      });
      tlVoices.push({
        key,
        file: v.file,
        at: r2(t + voiceStart),
        len: v.seconds,
        text: v.text,
      });
      const line = s.moments.find((x) => x.key === key)!;
      labels.push({
        key,
        tag: labelTag(m),
        text: line.label,
        at: r2(t + Math.max(realLead, voiceEnd) + 0.4),
        len: Math.max(LABEL_MIN, readNeed(line.label.split(/\s+/).length)),
      });
      t = r2(t + len);
    });
  }

  // The outro over what came after the last moment, then the end card.
  const last = order[order.length - 1]!.m;
  const outro = need("outro");
  const outroLen = r2(outro.seconds + 0.4 + 1);
  const dur = o.duration(last.file);
  let after = last.end;
  if (after + outroLen + END_CARD_SECONDS > dur)
    after = Math.max(0, dur - outroLen - END_CARD_SECONDS);
  clips.push({
    key: "outro",
    source: last.file,
    srcFrom: r2(after),
    srcTo: r2(after + outroLen),
    at: t,
    len: outroLen,
    ducked: [{ from: 0, to: outroLen }],
    muted: [],
  });
  tlVoices.push({
    key: "outro",
    file: outro.file,
    at: r2(t + 0.4),
    len: outro.seconds,
    text: outro.text,
  });
  marks.push({ t, title: `Week ${p.week} Wrap-Up` });
  t = r2(t + outroLen);
  clips.push({
    key: "end",
    source: last.file,
    srcFrom: r2(after + outroLen),
    srcTo: r2(after + outroLen + END_CARD_SECONDS),
    at: t,
    len: END_CARD_SECONDS,
    ducked: [{ from: 0, to: END_CARD_SECONDS }],
    muted: [],
    fadeOut: true,
  });
  const endCard = { at: t, len: END_CARD_SECONDS };
  t = r2(t + END_CARD_SECONDS);
  return {
    seconds: t,
    clips,
    voices: tlVoices,
    cards,
    labels: clampLabels(labels),
    title,
    teaser: { at: 0, len: tLen },
    endCard,
    marks,
  };
}

/** A moment's muted stretches moved onto a clip that starts at `from` in the recording (pure). */
function inside(
  m: PlannedMoment,
  from: number,
  len: number,
): Array<{ from: number; to: number }> {
  return m.bleeps
    .map((b) => ({
      from: r2(m.start + b.from - from),
      to: r2(m.start + b.to - from),
    }))
    .filter((b) => b.to > 0 && b.from < len)
    .map((b) => ({ from: Math.max(0, b.from), to: Math.min(len, b.to) }));
}

/** A label never runs into the next one (pure). */
function clampLabels(ls: TlLabel[]): TlLabel[] {
  return ls.map((l, i) => {
    const next = ls[i + 1];
    return next && l.at + l.len > next.at - 0.5
      ? { ...l, len: r2(Math.max(0, next.at - 0.5 - l.at)) }
      : l;
  });
}

/**
 * The graphics audit on the cut (src/qa/gfxaudit.ts auditLongGraphics): every label and card held long enough to
 * read, and every figure on it said or shown by the stream. Labels the audit marks for fixing are dropped by
 * `fixLabels`; nothing on screen may be misleading.
 */
export function auditTimeline(
  tl: Timeline,
  s: WeekScript,
  plan: WeekPlan,
): GfxAudit {
  const narration = [s.intro, ...s.moments.map((m) => m.setup), s.outro].join(
    " ",
  );
  const sources = playOrder(plan)
    .map((x) => `${x.m.transcript} ${x.m.ask?.question ?? ""}`)
    .join(" ");
  const items: LongGfxMoment[] = [
    ...tl.labels.map((l) => ({
      key: l.key,
      kind: "label",
      text: `${l.tag} ${l.text}`,
      from: l.at,
      len: l.len,
      short: false,
      sentence: s.moments.find((m) => m.key === l.key)?.setup ?? "",
      at: l.at,
      start: l.at,
      end: l.at + l.len,
    })),
    ...tl.cards.map((c) => ({
      key: `card${c.number}`,
      kind: "card",
      text: `Chapter ${c.number} ${c.title}`,
      checked: c.title,
      from: c.at,
      len: c.len,
      short: false,
      sentence: "",
      at: c.at,
      start: c.at,
      end: c.at + c.len,
    })),
    {
      key: "title",
      kind: "title",
      text: `${tl.title.text} ${tl.title.sub}`,
      from: tl.title.at,
      len: tl.title.len,
      short: false,
      sentence: s.intro,
      at: tl.title.at,
      start: tl.title.at,
      end: tl.title.at + tl.title.len,
    },
  ];
  return auditLongGraphics(
    items,
    narration,
    `${sources} ${plan.game} week ${plan.week}`,
    narration.split(/\s+/),
  );
}

/** The labels with every one the audit could not pass removed (pure). */
export function fixLabels(tl: Timeline, audit: GfxAudit): Timeline {
  const drop = new Set(
    audit.findings.filter((f) => f.level !== "warn").map((f) => f.key),
  );
  return { ...tl, labels: tl.labels.filter((l) => !drop.has(l.key)) };
}

// ---------------------------------------------------------------- the package

export interface DayLink {
  day: number;
  videoId: string;
  title: string;
}

export interface WeekPackage {
  title: string;
  description: string;
  tags: string[];
  chapters: string[];
  pinnedComment: string;
}

/** Title, description (keywords first, the playlist on line two, chapters, the week's Day N Shorts), tags, comment (pure). */
export function weekPackage(
  p: WeekPlan,
  s: WeekScript,
  tl: Timeline,
  o: { days?: DayLink[]; playlistId?: string } = {},
): WeekPackage {
  const g = shortGameName(p.game);
  const chapters = finishChapters(
    tl.marks.map((m) => `${stamp(m.t)} ${m.title}`),
  );
  const days = (o.days ?? [])
    .filter((d) => d.day >= (p.week - 1) * 7 + 1 && d.day <= p.week * 7)
    .sort((a, b) => a.day - b.day);
  const lines = [
    `${g} Week ${p.week}: the best moments, tests and discoveries from a week of our own ${g} gameplay, ${p.dates.from} to ${p.dates.to}. ${s.point}`,
    o.playlistId
      ? `Every day as its own Short, in order: ${playlistUrl(o.playlistId)}`
      : `Every day is its own Short in the "${GTA_DAILY_PLAYLIST}" playlist on our channel.`,
    "",
    ...(chapters.length ? ["Chapters", ...chapters, ""] : []),
    ...(days.length
      ? [
          "This week day by day",
          ...days.map((d) => `Day ${d.day}: ${d.title} ${videoUrl(d.videoId)}`),
          "",
        ]
      : []),
    "Gameplay recorded on our own streams. No story spoilers. Narration voiced with AI.",
    `#${g.replace(/\s+/g, "")} #${g.replace(/\s+/g, "")}Gameplay #PulseGaming`,
  ];
  const top = playOrder(p).find((x) => x.m === p.teaser) ?? playOrder(p)[0];
  const topClip = top ? tl.clips.find((c) => c.key === top.key) : undefined;
  const topLabel = top
    ? s.moments.find((m) => m.key === top.key)?.label
    : undefined;
  return {
    title: s.title,
    description: lines.join("\n"),
    tags: [
      `${g} week ${p.week}`,
      `${g} gameplay`,
      `${g} best moments`,
      `${g} tests`,
      `${g} myths`,
      `${g} hidden details`,
      `${g} funny moments`,
      p.game,
    ],
    chapters,
    pinnedComment: `What should we test in Week ${p.week + 1}? Our pick from this week is at ${topClip ? stamp(topClip.at + (topClip.len - (top!.m.end - top!.m.start))) : "0:00"}${topLabel ? `: ${topLabel}` : ""}.`,
  };
}
