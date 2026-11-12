// The near-live moment detector (LIVE_CLIPS), pure: it is fed what arrives while the owner is live and says when a
// moment is worth a Short. It only ever looks backwards (a live stream has no future to peek at), so the same code
// runs live (src/liveclips/job.ts) and on a past VOD replayed second by second (src/tools/liveclips-sim.ts).
//
// Three signals, each worth about 1 when it is clear on its own:
//   loudness  the stream's own sound and picture: a loudness spike over the last two minutes' median plus on-screen
//             action, scored like the nightly highlight finder (mac/gameplay/find-highlights.mjs), judged against the
//             stream's own recent best so a loud game and a quiet one are each held to their own bar.
//   chat      a burst of messages over the last five minutes' usual rate, from more than one person, and "clip it".
//   clip      a viewer made a Twitch clip: someone already thought this was worth keeping.
// Signals that land within MERGE_SECONDS of each other are one moment and their scores add up. The open stream asks
// (src/streamasks) that the chat or the stream title name are attached, and add a little.

import { overlap } from "../streamasks/asks.ts";

export interface SecondSample {
  /** The second's start (ms since 1970). */
  at: number;
  /** RMS loudness in dB (-90 for silence). */
  loud: number;
  /** Scene-change score 0-1. */
  motion: number;
}

export interface ChatLine {
  at: number;
  user: string;
  text: string;
}

export interface ViewerClip {
  id: string;
  /** When the viewer made it. */
  at: number;
  url: string;
  title: string;
  creator: string;
}

export interface AskRef {
  id: string;
  question: string;
}

export type SignalKind = "loudness" | "chat" | "clip";

export interface Signal {
  kind: SignalKind;
  /** The estimated time of the moment itself (ms), the reaction lag taken off. */
  at: number;
  score: number;
  detail: string;
}

export interface Moment {
  /** The moment itself (ms). */
  at: number;
  score: number;
  signals: Signal[];
  /** The 40-second window to cut (ms). */
  start: number;
  end: number;
  /** Seconds into the cut where the moment is. */
  peakInClip: number;
  ask?: AskRef;
  /** When the detector made up its mind (ms). */
  decidedAt: number;
}

export interface Skipped {
  moment: Moment;
  why: string;
}

export interface DetectOptions {
  minScore: number;
  perHour: number;
  perDay: number;
  gapMinutes: number;
  /** Loudness alone may pick a moment only after this much stream (it needs a baseline). */
  warmupMinutes: number;
  /** Seconds from a moment on screen to chat reacting to it (Twitch's delay plus typing). */
  chatLagSeconds: number;
  /** Seconds from a moment to a viewer pressing Clip (a clip keeps the 30 seconds before the press). */
  clipLagSeconds: number;
  /** The start of the owner's local day for a given time (ms), for the daily cap. */
  dayStart: (at: number) => number;
}

export const CLIP_SECONDS = 40;
export const MERGE_SECONDS = 45;
const CHAT_BUCKET_SECONDS = 10;
const BASELINE_SECONDS = 120;
const HISTORY_MINUTES = 30;
const LOUD_FLOOR = 0.6; // the finder's "nothing exciting left" bar
const LOUD_PERCENTILE = 0.97;
const HYPE =
  /\b(o+m+g+|wtf|lol+|lmao+|kekw|lul|pog+(gers|champ)?|no+ ?way|holy|insane|clip(ped)?|let'?s go+|w+ ?(play|moment)?|gg|bro+|what+)\b|[!?]{3,}|😂|🤣|💀|😱|🔥/i;
const CLIP_ASK = /(^!clip\b)|\bclip (it|that|this)\b/i;

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
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The best open ask the words name, or none (pure). */
export function matchAsk(texts: string[], asks: AskRef[]): AskRef | undefined {
  const said = texts.join(" ");
  if (!said.trim()) return undefined;
  let best: { ask: AskRef; v: number } | undefined;
  for (const a of asks) {
    const v = overlap(a.question, said);
    if (v >= 0.34 && (!best || v > best.v)) best = { ask: a, v };
  }
  return best?.ask;
}

/** The cut around a moment (pure): loudness knows the peak, so the build-up gets 14 s; a reaction-timed moment 24 s. */
export function momentWindow(
  at: number,
  peakKnown: boolean,
): { start: number; end: number; peakInClip: number } {
  const before = peakKnown ? 14 : 24;
  const start = at - before * 1000;
  return { start, end: start + CLIP_SECONDS * 1000, peakInClip: before };
}

/** Whether a moment may go out under the caps (pure); the reason when it may not. */
export function rateCheck(
  at: number,
  sent: number[],
  o: Pick<DetectOptions, "perHour" | "perDay" | "gapMinutes" | "dayStart">,
): string | undefined {
  const last = Math.max(-Infinity, ...sent);
  if (at - last < o.gapMinutes * 60_000)
    return `within ${o.gapMinutes} min of the last one`;
  if (sent.filter((t) => at - t < 3_600_000).length >= o.perHour)
    return `${o.perHour} already this hour`;
  const day = o.dayStart(at);
  if (sent.filter((t) => t >= day).length >= o.perDay)
    return `${o.perDay} already today`;
  return undefined;
}

export class LiveDetector {
  private samples: SecondSample[] = [];
  private excite: number[] = [];
  /** Window values of the last HISTORY_MINUTES, the bar loudness is judged against. */
  private history: number[] = [];
  private firstAt: number | undefined;
  private chat: ChatLine[] = [];
  private bucketsDone = new Set<number>();
  private bucketCounts: number[] = [];
  private signals: Signal[] = [];
  private pending: Moment[] = [];
  /** Times of moments already sent (restored across restarts by the job). */
  sent: number[] = [];
  readonly skipped: Skipped[] = [];
  title = "";
  asks: AskRef[] = [];

  constructor(private o: DetectOptions) {}

  /** One second of the stream's sound and picture, in order. */
  addSecond(s: SecondSample): void {
    this.firstAt ??= s.at;
    this.samples.push(s);
    const recent = this.samples
      .slice(-BASELINE_SECONDS - 1, -1)
      .map((x) => x.loud);
    const base = recent.length >= 20 ? median(recent) : s.loud;
    const spike = Math.max(0, s.loud - base);
    this.excite.push(s.loud < -55 ? 0 : spike * 0.12 + s.motion * 3);
    // Only the last 40 minutes are kept.
    if (this.samples.length > 2400) {
      this.samples.splice(0, this.samples.length - 2400);
      this.excite.splice(0, this.excite.length - 2400);
    }
    this.judgeLoudness();
  }

  /**
   * The second 15 s back is judged once its aftermath is in: a local peak whose 40-second window beats the stream's
   * own recent best (top 3% of the last half hour) and the finder's floor.
   */
  private judgeLoudness(): void {
    const n = this.excite.length;
    const p = n - 16;
    if (p < 25) return;
    const ex = this.excite;
    const around = ex.slice(Math.max(0, p - 20), p + 16);
    const peak = ex[p]!;
    if (peak <= 0) {
      this.history.push(0);
      return this.trimHistory();
    }
    const win = ex.slice(p - 14, p + 26 > n ? n : p + 26);
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const value = peak * 0.6 + mean * 0.4;
    const bar = Math.max(LOUD_FLOOR, quantile(this.history, LOUD_PERCENTILE));
    const warm =
      this.samples[p]!.at - (this.firstAt ?? 0) >=
      this.o.warmupMinutes * 60_000;
    this.history.push(value);
    this.trimHistory();
    if (peak < Math.max(...around) || !warm || value < bar) return;
    this.signals.push({
      kind: "loudness",
      at: this.samples[p]!.at,
      score: round2(Math.min(3, value / bar)),
      detail: `sound and action ${round2(value)} against the stream's recent best ${round2(bar)}`,
    });
  }

  private trimHistory(): void {
    if (this.history.length > HISTORY_MINUTES * 60)
      this.history.splice(0, this.history.length - HISTORY_MINUTES * 60);
  }

  addChat(line: ChatLine): void {
    this.chat.push(line);
    if (this.chat.length > 5000) this.chat.splice(0, this.chat.length - 5000);
  }

  addClip(c: ViewerClip): void {
    if (this.signals.some((s) => s.kind === "clip" && s.detail.includes(c.id)))
      return;
    this.signals.push({
      kind: "clip",
      at: c.at - this.o.clipLagSeconds * 1000,
      score: 1.5,
      detail: `${c.creator || "a viewer"} clipped it ("${c.title}", ${c.id})`,
    });
  }

  /** Chat buckets that have closed by now, each judged once against the five minutes before it. */
  private judgeChat(now: number): void {
    const size = CHAT_BUCKET_SECONDS * 1000;
    const first = this.chat[0]?.at;
    if (first === undefined) return;
    for (let b = Math.floor(first / size) * size; b + size <= now; b += size) {
      if (this.bucketsDone.has(b)) continue;
      this.bucketsDone.add(b);
      const lines = this.chat.filter((l) => l.at >= b && l.at < b + size);
      const users = new Set(lines.map((l) => l.user.toLowerCase()));
      const hype = lines.filter((l) => HYPE.test(l.text)).length;
      const clipAsks = new Set(
        lines.filter((l) => CLIP_ASK.test(l.text)).map((l) => l.user),
      ).size;
      const before = this.bucketCounts.slice(-30);
      const baseline = before.length >= 6 ? median(before) : 0.5;
      this.bucketCounts.push(lines.length);
      const bar = Math.max(4, baseline * 3);
      const burst = lines.length >= bar && users.size >= 2;
      if (!burst && clipAsks < 2) continue;
      const score =
        (burst ? Math.min(2.5, lines.length / bar) : 1) +
        (hype >= 2 ? 0.5 : 0) +
        (clipAsks ? 0.5 : 0);
      this.signals.push({
        kind: "chat",
        at: b - this.o.chatLagSeconds * 1000,
        score: round2(Math.min(3, score)),
        detail: `${lines.length} messages from ${users.size} people in 10 s (usually ${round2(baseline)})${clipAsks ? `, ${clipAsks} asked for a clip` : ""}`,
      });
    }
    if (this.bucketsDone.size > 2000) {
      const keep = [...this.bucketsDone].sort((a, b) => a - b).slice(-500);
      this.bucketsDone = new Set(keep);
    }
  }

  /**
   * Folds new signals into moments and returns the ones ready to cut: everything about them known (no new signal
   * for MERGE_SECONDS) and the window's end recorded. A moment under the bar or over the caps is set aside with why.
   */
  poll(now: number): Moment[] {
    this.judgeChat(now);
    for (const s of this.signals.splice(0)) {
      const m = this.pending.find(
        (p) => Math.abs(p.at - s.at) <= MERGE_SECONDS * 1000,
      );
      if (m) {
        m.signals.push(s);
        m.score = round2(m.score + s.score);
        // Loudness knows when it happened; a reaction only roughly.
        const loud = m.signals.filter((x) => x.kind === "loudness");
        const at = loud.length
          ? loud.sort((a, b) => b.score - a.score)[0]!.at
          : Math.min(...m.signals.map((x) => x.at));
        Object.assign(m, { at, ...momentWindow(at, loud.length > 0) });
      } else
        this.pending.push({
          at: s.at,
          score: s.score,
          signals: [s],
          ...momentWindow(s.at, s.kind === "loudness"),
          decidedAt: 0,
        });
    }
    const ready: Moment[] = [];
    for (const m of [...this.pending]) {
      const lastSeen = Math.max(...m.signals.map((s) => s.at));
      if (now < Math.max(m.end, lastSeen + MERGE_SECONDS * 1000)) continue;
      this.pending.splice(this.pending.indexOf(m), 1);
      m.decidedAt = now;
      const words = this.chat
        .filter((l) => l.at >= m.start && l.at <= m.end + 30_000)
        .map((l) => l.text);
      const ask = matchAsk([...words, this.title], this.asks);
      if (ask) {
        m.ask = ask;
        m.score = round2(m.score + 0.5);
      }
      if (m.score < this.o.minScore) {
        this.skipped.push({
          moment: m,
          why: `score ${m.score} under ${this.o.minScore}`,
        });
        continue;
      }
      const why = rateCheck(m.at, this.sent, this.o);
      if (why) {
        this.skipped.push({ moment: m, why });
        continue;
      }
      this.sent.push(m.at);
      ready.push(m);
    }
    // Chat older than the longest look back is not needed.
    const keepFrom = now - 10 * 60_000;
    if (this.chat.length && this.chat[0]!.at < keepFrom)
      this.chat = this.chat.filter((l) => l.at >= keepFrom);
    return ready;
  }
}
