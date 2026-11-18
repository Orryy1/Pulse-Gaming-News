// Finding and ranking the week's moments (pure). Every signal the factory already has about the owner's streams is
// read, each where it is strongest, and they are added up per moment:
//   energy   the stream's own sound and picture, second by second (the live detector's measure: a loudness spike
//            over the last two minutes' median plus on-screen action), judged against the stream's own best;
//   voice    what the owner said (the stream index's Whisper lines): reactions, laughter, "let's test", "they said",
//            "never seen that";
//   asks     stream asks the miner settled on this stream (proved or disproved, data/streamasks/tested.json);
//   chat     a burst of chat over its usual rate, and viewers' Twitch clips (the live clips job's logs), when kept;
//   live     moments the live-clips detector already sent while he was live;
//   seen     the scene index's shot descriptions and tags, when the vision model has looked (never required).
// A moment is a 15 to 50 second window snapped to whole sentences and to the shot cuts, so a cut never starts or
// ends in the middle of a word. Blank and menu shots, dark stretches and story cutscenes inside the spoiler window
// are never used. The result is ranked by how interesting it is, with the reasons kept for the plan's report.

import type { VodIndex } from "../vodindex/schema.ts";
import type { SceneShot, DialogueLine } from "../sceneindex/schema.ts";
import {
  CHAT_HYPE,
  GAME_EVENT,
  HALLUCINATION,
  HIDDEN_SAY,
  MENU_TEXT,
  LAUGH,
  MYTH_SAY,
  REACTION,
  SWEAR,
  TEST_SAY,
} from "./patterns.ts";

/** One second of the recording (seconds from its start; the live measure's dB and 0-1 scene score). */
export interface StreamSecond {
  t: number;
  loud: number;
  motion: number;
}

export interface StreamChat {
  /** Seconds from the recording's start. */
  t: number;
  user: string;
  text: string;
}

/** An ask the miner settled on this recording. */
export interface SettledAsk {
  id: string;
  question: string;
  result: "proved" | "disproved";
  confidence: number;
  /** Seconds into the recording. */
  at: number;
  kind?: "question" | "claim" | "myth" | "request";
  rumour?: boolean;
}

/** Everything known about one recording of the week. */
export interface WeekStream {
  index: VodIndex;
  seconds: StreamSecond[];
  chat?: StreamChat[];
  /** Viewers' Twitch clips: seconds from the start (the moment, the clip lag already taken off) and the title. */
  clips?: Array<{ t: number; title: string }>;
  asks?: SettledAsk[];
  /** Live-clip moments sent while live: seconds from the start. */
  live?: Array<{ t: number; score: number }>;
  /** Share of frames with cinema bars per moment window, when measured ("start-end" rounded seconds). */
  letterbox?: Record<string, number>;
}

export type MomentKind = "test" | "myth" | "challenge" | "hidden" | "funny" | "action";

export interface WeekMoment {
  vodId: string;
  file: string;
  recordedOn: string;
  start: number;
  end: number;
  /** The heart of the moment (seconds into the recording). */
  peak: number;
  kind: MomentKind;
  score: number;
  /** Each signal's part of the score. */
  parts: Partial<
    Record<
      "energy" | "voice" | "ask" | "chat" | "clip" | "live" | "seen" | "event",
      number
    >
  >;
  /** Plain-English reasons, best first. */
  why: string[];
  /** What the owner said in the window. */
  transcript: string;
  /** The line that carries it (a reaction or the test said out loud). */
  quote: string;
  ask?: SettledAsk;
  /** True when strong language leads the moment (ranked down; the cut keeps the game's audio low there). */
  language: boolean;
  /** Seconds of strong language inside the window, from its start: muted in the cut. */
  bleeps: Array<{ from: number; to: number }>;
  /** What the vision model saw in the window's shots, when it has looked (writer material). */
  seen?: string;
  /** The end of the last menu, map, loading or dark shot in the 40 s before the window: a lead-in starts after it. */
  leadFloor?: number;
  /** Why it may not be used (spoiler window, blank picture); absent when it may. */
  blocked?: string;
}

export const MIN_MOMENT = 15;
export const MAX_MOMENT = 50;
const BASELINE = 120;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The stream's excitement second by second, 0 to 3 (pure): a loudness spike over the last two minutes' median plus
 * on-screen action, smoothed over five seconds and divided by the stream's own top 3%, so a loud game and a quiet one
 * are each held to their own bar.
 */
export function energyCurve(seconds: StreamSecond[]): number[] {
  const loud = seconds.map((s) => s.loud);
  const raw = seconds.map((s, i) => {
    const before = loud.slice(Math.max(0, i - BASELINE), i);
    const base = before.length >= 20 ? median(before) : s.loud;
    return s.loud < -55 ? 0 : Math.max(0, s.loud - base) * 0.12 + s.motion * 3;
  });
  const smooth = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - 2), i + 3);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const bar = Math.max(0.3, quantile(smooth, 0.97));
  return smooth.map((v) => Math.min(3, v / bar));
}

/** The second-by-second values' local peaks, strongest first, at least `spacing` seconds apart (pure). */
export function peaks(
  curve: number[],
  spacing: number,
  max: number,
  floor = 0.8,
): number[] {
  const order = curve
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v >= floor)
    .sort((a, b) => b.v - a.v);
  const out: number[] = [];
  for (const x of order) {
    if (out.length >= max) break;
    if (out.some((p) => Math.abs(p - x.i) < spacing)) continue;
    out.push(x.i);
  }
  return out;
}

/**
 * The window around a peak, snapped to whole lines and shot cuts (pure): the build-up before (`before` seconds) and
 * the aftermath after (`after`), the start moved back to the start of a line that would be cut in half, the end on
 * to the end of a line still being said, each by at most 8 seconds; then held to MIN_MOMENT to MAX_MOMENT.
 */
export function snapWindow(
  peak: number,
  lines: Pick<DialogueLine, "start" | "end">[],
  shots: Pick<SceneShot, "start" | "end">[],
  duration: number,
  before = 18,
  after = 14,
): { start: number; end: number } {
  let start = Math.max(0, peak - before);
  let end = Math.min(duration, peak + after);
  const cutting = lines.find((l) => l.start < start && l.end > start);
  if (cutting && start - cutting.start <= 8) start = cutting.start;
  else {
    // No line to keep whole: start on a shot cut close by, so the picture does not open mid-move.
    const cut = shots.find((s) => Math.abs(s.start - start) <= 3);
    if (cut) start = cut.start;
  }
  const trailing = lines.find((l) => l.start < end && l.end > end);
  if (trailing && trailing.end - end <= 8) end = trailing.end;
  if (end - start < MIN_MOMENT) end = Math.min(duration, start + MIN_MOMENT);
  if (end - start < MIN_MOMENT) start = Math.max(0, end - MIN_MOMENT);
  if (end - start > MAX_MOMENT) {
    // Keep the peak inside, nearer the end than the start (the payoff matters more than the walk up).
    start = Math.max(start, peak - MAX_MOMENT * 0.6);
    end = Math.min(end, start + MAX_MOMENT);
  }
  return { start: r2(Math.max(0, start)), end: r2(Math.min(duration, end)) };
}

/** Which kind of moment the words and the ask say it is (pure); the loudest category wins in this order. */
export function kindOf(
  transcript: string,
  ask: SettledAsk | undefined,
  laughs: number,
  energy: number,
  /** The game announced a stunt, a challenge or a collectable on screen. */
  event = false,
): MomentKind {
  if (ask)
    return ask.kind === "myth" ||
      ask.kind === "claim" ||
      MYTH_SAY.test(ask.question)
      ? "myth"
      : "test";
  if (MYTH_SAY.test(transcript)) return "myth";
  if (TEST_SAY.test(transcript)) return "test";
  if (event) return "challenge";
  if (HIDDEN_SAY.test(transcript)) return "hidden";
  if (laughs >= 1) return "funny";
  return energy >= 1.4
    ? "action"
    : REACTION.test(transcript)
      ? "funny"
      : "action";
}

const countIn = (re: RegExp, lines: string[]) =>
  lines.filter((l) => re.test(l)).length;

/** The windows of strong language inside a moment, relative to its start, with a little air either side (pure). */
export function bleepsIn(
  lines: Pick<DialogueLine, "start" | "end" | "text">[],
  start: number,
  end: number,
): Array<{ from: number; to: number }> {
  return lines
    .filter((l) => l.end > start && l.start < end && SWEAR.test(l.text))
    .map((l) => ({
      from: r2(Math.max(0, l.start - start - 0.1)),
      to: r2(Math.min(end, l.end) - start + 0.1),
    }));
}

export interface FindOptions {
  /** Energy peaks taken per recording (more are found; the ranking decides). */
  peaksPerStream?: number;
  /** True while the game's spoiler window is open (the job reads SPOILER_GUARD and the windows). */
  spoilerWindowOpen?: boolean;
  /** Extra story check on a moment's words (the spoiler guard's phrases), returning the reason to hold it. */
  storyCheck?: (
    transcript: string,
    m: { start: number; end: number },
  ) => string | undefined;
}

/**
 * One recording's candidate moments, scored (pure). Candidates come from every signal: energy peaks, a reaction or a
 * test said out loud, a settled ask, a chat burst, a viewer's clip, a live moment. Overlapping candidates become one,
 * keeping every reason.
 */
export function findWeekMoments(
  w: WeekStream,
  o: FindOptions = {},
): WeekMoment[] {
  const v = w.index;
  const curve = energyCurve(w.seconds);
  const at = (t: number) =>
    curve[Math.max(0, Math.min(curve.length - 1, Math.round(t)))] ?? 0;
  const seeds: Array<{ t: number; why: string }> = [];
  for (const p of peaks(curve, 45, o.peaksPerStream ?? 40))
    seeds.push({ t: p, why: "energy" });
  for (const l of v.lines)
    if (
      REACTION.test(l.text) ||
      LAUGH.test(l.text) ||
      TEST_SAY.test(l.text) ||
      MYTH_SAY.test(l.text) ||
      HIDDEN_SAY.test(l.text)
    )
      seeds.push({ t: (l.start + l.end) / 2, why: "voice" });
  for (const s of v.shots) if (GAME_EVENT.test(s.text) && !MENU_TEXT.test(s.text)) seeds.push({ t: s.start + 1, why: "event" });
  for (const a of w.asks ?? []) seeds.push({ t: a.at, why: "ask" });
  for (const c of w.clips ?? []) seeds.push({ t: c.t, why: "clip" });
  for (const m of w.live ?? []) seeds.push({ t: m.t, why: "live" });
  for (const t of chatBursts(w.chat ?? [])) seeds.push({ t, why: "chat" });

  const out: WeekMoment[] = [];
  for (const seed of seeds.sort((a, b) => a.t - b.t)) {
    // The loudest second near a voice or reaction seed is its peak: reactions come a beat after what caused them.
    let peak = seed.t;
    if (seed.why !== "energy") {
      let best = at(peak);
      for (let t = Math.max(0, seed.t - 8); t <= seed.t + 3; t++)
        if (at(t) > best) [best, peak] = [at(t), t];
    }
    const win = snapWindow(peak, v.lines, v.shots, v.duration);
    out.push(scoreMoment(w, curve, peak, win, o));
  }
  return mergeMoments(out);
}

/**
 * The index with Whisper's inventions taken out (pure): lines that are only "you" or "thanks for watching", and a
 * phrase said word for word three or more times in a stream (Whisper looping over music), are not the owner speaking.
 */
export function realSpeech(v: VodIndex): VodIndex {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  const seen = new Map<string, number>();
  for (const l of v.lines) seen.set(norm(l.text), (seen.get(norm(l.text)) ?? 0) + 1);
  const lines = v.lines.filter((l) => !HALLUCINATION.test(l.text) && !(norm(l.text).split(" ").length >= 3 && (seen.get(norm(l.text)) ?? 0) >= 3));
  return lines.length === v.lines.length ? v : { ...v, lines };
}

/** True when a shot is a menu, map, save or loading screen by its writing, or by the vision model's word. */
export const isMenuShot = (s: Pick<SceneShot, "text" | "menu" | "blank">): boolean => Boolean(s.menu || s.blank || MENU_TEXT.test(s.text));

/** Ten-second chat buckets busier than three times the usual rate, from two or more people (pure): seconds, lag taken off. */
export function chatBursts(chat: StreamChat[], lag = 6): number[] {
  if (!chat.length) return [];
  const buckets = new Map<number, StreamChat[]>();
  for (const c of chat) {
    const b = Math.floor(c.t / 10);
    buckets.set(b, [...(buckets.get(b) ?? []), c]);
  }
  const counts = [...buckets.values()].map((x) => x.length);
  const usual = Math.max(1, median(counts));
  const out: number[] = [];
  for (const [b, lines] of buckets) {
    const users = new Set(lines.map((l) => l.user.toLowerCase()));
    if (lines.length >= Math.max(4, usual * 3) && users.size >= 2)
      out.push(Math.max(0, b * 10 - lag));
  }
  return out;
}

function scoreMoment(
  w: WeekStream,
  curve: number[],
  peak: number,
  win: { start: number; end: number },
  o: FindOptions,
): WeekMoment {
  const v = w.index;
  const inside = <T extends { start: number; end: number }>(xs: T[]) =>
    xs.filter((x) => x.end > win.start && x.start < win.end);
  const lines = inside(v.lines);
  const texts = lines.map((l) => l.text);
  const transcript = texts.join(" ");
  const shots = inside(v.shots);
  const slice = curve.slice(Math.floor(win.start), Math.ceil(win.end) + 1);
  const eMax = slice.length ? Math.max(...slice) : 0;
  const eMean = slice.length
    ? slice.reduce((a, b) => a + b, 0) / slice.length
    : 0;
  const reactions = countIn(REACTION, texts);
  const laughs = countIn(LAUGH, texts);
  const swears = countIn(SWEAR, texts);
  const said = lines.reduce(
    (n, l) => n + (Math.min(l.end, win.end) - Math.max(l.start, win.start)),
    0,
  );
  const speech = said / Math.max(1, win.end - win.start);
  const ask = (w.asks ?? [])
    .filter((a) => a.at >= win.start - 10 && a.at <= win.end + 10)
    .sort((a, b) => b.confidence - a.confidence)[0];
  const chat = (w.chat ?? []).filter(
    (c) => c.t >= win.start && c.t <= win.end + 20,
  );
  const chatHype = chat.filter((c) => CHAT_HYPE.test(c.text)).length;
  const bursts = chatBursts(w.chat ?? []).filter(
    (t) => t >= win.start - 10 && t <= win.end,
  );
  const clips = (w.clips ?? []).filter(
    (c) => c.t >= win.start - 10 && c.t <= win.end + 5,
  );
  const live = (w.live ?? []).filter(
    (m) => m.t >= win.start - 10 && m.t <= win.end + 5,
  );
  const described = shots.filter((s) => s.desc && s.desc !== "-");
  const events = shots.filter((s) => GAME_EVENT.test(s.text) && !isMenuShot(s));
  const seenWords = described
    .map((s) => `${s.desc} ${s.tags.join(" ")}`)
    .join(" ");

  const parts: WeekMoment["parts"] = {};
  const why: string[] = [];
  parts.energy = r2(eMax * 0.6 + eMean * 0.6);
  if (eMax >= 1)
    why.push(`sound and action at ${r2(eMax)}x the stream's usual best`);
  const voice = Math.min(
    2.5,
    reactions * 0.45 +
      laughs * 0.6 +
      (TEST_SAY.test(transcript) ? 0.5 : 0) +
      (MYTH_SAY.test(transcript) ? 0.5 : 0) +
      (HIDDEN_SAY.test(transcript) ? 0.4 : 0),
  );
  parts.voice = r2(voice + Math.min(0.4, speech * 0.4));
  if (laughs) why.push(`he laughs (${laughs})`);
  if (reactions)
    why.push(`${reactions} reaction${reactions > 1 ? "s" : ""} out loud`);
  if (ask) {
    parts.ask = r2(1.5 + ask.confidence);
    why.unshift(`settles a stream ask: ${ask.question} (${ask.result})`);
  }
  if (bursts.length || chatHype >= 3) {
    parts.chat = r2(Math.min(2, bursts.length * 1 + chatHype * 0.1));
    why.push(`chat lit up (${chat.length} messages)`);
  }
  if (clips.length) {
    parts.clip = r2(Math.min(2.5, 1.5 * clips.length));
    why.unshift(`a viewer clipped it ("${clips[0]!.title}")`);
  }
  if (live.length) {
    parts.live = r2(Math.min(2, Math.max(...live.map((m) => m.score)) * 0.5));
    why.push("the live detector caught it");
  }
  if (described.length) parts.seen = r2(Math.min(0.5, described.length * 0.05));
  if (events.length) {
    parts.event = r2(Math.min(2, 1.2 + 0.3 * (events.length - 1)));
    why.unshift(`the game says "${events[0]!.text.replace(/\s+/g, " ").slice(0, 60)}"`);
  }
  let score = Object.values(parts).reduce((a, b) => a + (b ?? 0), 0);
  const language = swears >= 2 || (swears >= 1 && texts.length <= 2);
  if (language) score -= 0.6;
  if (speech < 0.05 && eMax < 1) score -= 0.5;

  let blocked: string | undefined;
  const bad = shots.filter((s) => isMenuShot(s) || s.luma < 18);
  const span = shots.reduce(
    (n, s) => n + Math.min(s.end, win.end) - Math.max(s.start, win.start),
    0,
  );
  const badSpan = bad.reduce(
    (n, s) => n + Math.min(s.end, win.end) - Math.max(s.start, win.start),
    0,
  );
  if (span > 0 && badSpan / span > 0.35)
    blocked = "mostly menus, loading or dark picture";
  if (o.spoilerWindowOpen) {
    const bars =
      w.letterbox?.[`${Math.round(win.start)}-${Math.round(win.end)}`] ?? 0;
    if (bars >= 0.5 || (bars >= 0.2 && speech >= 0.5))
      blocked = "looks like a story cutscene during the spoiler window";
    const story = o.storyCheck?.(`${transcript} ${seenWords}`, win);
    if (story) blocked = story;
  }
  const quoteLine =
    lines.find((l) => LAUGH.test(l.text) || REACTION.test(l.text)) ??
    lines.find(
      (l) =>
        TEST_SAY.test(l.text) ||
        MYTH_SAY.test(l.text) ||
        HIDDEN_SAY.test(l.text),
    ) ??
    lines.find((l) => l.start <= peak && l.end >= peak) ??
    lines[0];
  return {
    vodId: v.vodId,
    file: v.file,
    recordedOn: v.recordedOn,
    start: win.start,
    end: win.end,
    peak: r2(peak),
    kind: kindOf(`${transcript} ${seenWords}`, ask, laughs, eMax, events.length > 0),
    score: r2(score),
    parts,
    why: why.slice(0, 5),
    transcript,
    quote: quoteLine?.text ?? "",
    ...(ask ? { ask } : {}),
    language,
    bleeps: language || swears ? bleepsIn(lines, win.start, win.end) : [],
    ...(described.length ? { seen: [...new Set(described.map((s) => s.desc))].slice(0, 3).join(" | ").slice(0, 300) } : {}),
    ...leadFloorOf(v.shots, win.start),
    ...(blocked ? { blocked } : {}),
  };
}

/** Where a lead-in may start at the earliest (pure): after the last unusable shot in the 40 s before the window. */
export function leadFloorOf(shots: Pick<SceneShot, "start" | "end" | "text" | "menu" | "blank" | "luma">[], start: number): { leadFloor?: number } {
  const bad = shots.filter((s) => s.end <= start + 0.5 && s.end > start - 40 && (isMenuShot(s) || s.luma < 18));
  if (!bad.length) return {};
  return { leadFloor: r2(Math.min(start, Math.max(...bad.map((s) => s.end)))) };
}

/** Overlapping candidates as one: the best score's window, every reason kept once (pure). */
export function mergeMoments(ms: WeekMoment[]): WeekMoment[] {
  const sorted = [...ms].sort((a, b) => b.score - a.score);
  const kept: WeekMoment[] = [];
  for (const m of sorted) {
    const twin = kept.find(
      (k) => k.vodId === m.vodId && overlapShare(k, m) > 0.4,
    );
    if (twin) {
      twin.why = [...new Set([...twin.why, ...m.why])].slice(0, 6);
      twin.ask ??= m.ask;
      continue;
    }
    kept.push({ ...m, why: [...m.why] });
  }
  return kept;
}

const overlapShare = (
  a: { start: number; end: number },
  b: { start: number; end: number },
) => {
  const o = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  return o / Math.max(1, Math.min(a.end - a.start, b.end - b.start));
};

/** Every stream's moments together, usable ones first, best first (pure). */
export function rankWeek(
  streams: WeekStream[],
  o: FindOptions = {},
): WeekMoment[] {
  return streams
    .flatMap((w) => findWeekMoments(w, o))
    .sort(
      (a, b) =>
        Number(Boolean(a.blocked)) - Number(Boolean(b.blocked)) ||
        b.score - a.score,
    );
}
