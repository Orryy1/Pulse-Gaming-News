// FRAME_FOCUS (19 Nov 2026): after a Short renders, one frame from the middle of each spoken line goes to the free local
// vision model (src/assets/localvision.ts, Ollama on the PC; never a paid API) with the line and the game's name. The
// model says what the line is about and whether that thing is visible, how large, whether it is centred in the 9:16
// frame and whether text or captions hide it, with a mark from 0 to 3. Record first: "check" changes nothing in the
// video, and "fix" is scaffolding that does the same as "check" for now (see fixCandidates). Split by episode id so the
// arm's focus marks can be set against retention; the control arm records only its arm.
//
// Everything here is pure except runFrameFocus, which takes its frame extraction and its model call as arguments.

import { createHash } from "node:crypto";

export type FocusMode = "off" | "check" | "fix";
export type FocusArm = "check" | "control";

export const FOCUS = {
  /** Lines shorter than this (seconds) are not sampled: a mid-line frame would sit on a cut or a card's entrance. */
  minLineSeconds: 0.8,
  /** The whole check's time box: past it the remaining lines are recorded as not checked and the episode goes on. */
  budgetMs: 150_000,
  /** One frame's answer at most. */
  frameTimeoutMs: 45_000,
  /** At most this many lines are checked (a long ranking Short keeps the first ones). */
  maxLines: 24,
  /** A line scoring this or less is weak. */
  weakAt: 1,
  /** Shorts a side before the weekly report gives a verdict. */
  verdictMin: 20,
} as const;

/** FRAME_FOCUS's arm for an episode (pure): a stable hash of the id against the share. */
export function frameFocusArm(episodeId: string, share: number): FocusArm {
  if (!(share > 0)) return "control";
  if (share >= 1) return "check";
  const n = createHash("sha1")
    .update(`frame-focus:${episodeId}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share ? "check" : "control";
}

/** FRAME_FOCUS as a mode (pure): anything but "check" or "fix" is off. */
export function parseFocusMode(v: string | undefined): FocusMode {
  const m = (v ?? "").trim().toLowerCase();
  return m === "check" || m === "fix" ? m : "off";
}

/** FRAME_FOCUS_SHARE (pure): 0 to 1, 0.5 when unset or unreadable. */
export function parseFocusShare(v: string | undefined): number {
  const n = Number(v ?? "0.5");
  return Math.min(
    1,
    Math.max(0, Number.isFinite(n) && (v ?? "").trim() !== "" ? n : 0.5),
  );
}

export interface FocusVerdict {
  /** What the line is about, in a few words. */
  subject: string;
  visible: "yes" | "partly" | "no";
  size: "large" | "medium" | "small";
  centred: boolean;
  blocked_by_text: boolean;
  /** 0 (not there) to 3 (clearly there, large, centred, clear of text). */
  score: number;
}

export interface FocusLine {
  /** The line's index among the Short's segments. */
  line: number;
  /** Where the frame was taken, in seconds. */
  t?: number;
  text: string;
  verdict?: FocusVerdict;
  /** Why the line has no verdict: too short, the model's answer unreadable, a failure or the time box. */
  skipped?: string;
}

export interface FocusSummary {
  lines: number;
  checked: number;
  /** Mean score over the checked lines, two decimals; absent when none were checked. */
  mean?: number;
  /** Share of checked lines scoring 0 or 1, two decimals. */
  weak_share?: number;
  weak: number[];
}

export interface FrameFocusRecord {
  at: string;
  arm: FocusArm;
  mode: FocusMode;
  game?: string;
  lines?: FocusLine[];
  summary?: FocusSummary;
  /** FRAME_FOCUS=fix: the lines a fix would act on (nothing is done to them yet). */
  would_fix?: number[];
  ms?: number;
  note?: string;
  error?: string;
}

/** The question for one frame (pure). Kept short: the local model reads it once per spoken line. */
export function focusPrompt(o: { game: string; line: string }): string {
  const game = o.game.trim() || "a video game";
  return `This is one frame of a vertical 9:16 gaming news Short about ${game}. The narrator is saying: "${o.line.trim()}"
Decide what this line is about: the game, a character, a vehicle, a place or an object. Then judge the frame.
Ignore the word-by-word captions, the small PULSE mark and any footage credit when judging the picture, but count them if they cover the subject.
Answer in JSON:
subject: what the line is about, in under 6 words.
visible: "yes" if it is clearly in the frame, "partly" if cut off at an edge or only partly shown, "no" if it is not there.
size: "large" if it fills a good part of the frame, "medium", or "small" if tiny or far away.
centred: true if it sits near the middle of the frame, false if pushed to an edge.
blocked_by_text: true if captions, a card or other text cover a real part of it.
score: 0 not there, 1 hard to make out, 2 there but small, off-centre or partly hidden, 3 clearly there, large and clear.`;
}

/** The JSON schema the local model answers in (Ollama's "format"). */
export const FOCUS_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    visible: { type: "string", enum: ["yes", "partly", "no"] },
    size: { type: "string", enum: ["large", "medium", "small"] },
    centred: { type: "boolean" },
    blocked_by_text: { type: "boolean" },
    score: { type: "integer" },
  },
  required: [
    "subject",
    "visible",
    "size",
    "centred",
    "blocked_by_text",
    "score",
  ],
} as const;

const asBool = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(s)) return true;
    if (["false", "no", "n", "0"].includes(s)) return false;
  }
  return undefined;
};

/**
 * The model's answer as a verdict (pure); undefined when it says nothing usable. Lenient about shape (a JSON string,
 * booleans for visible, "centered", a score as text or out of range) because the local model is not always tidy.
 */
export function parseFocusVerdict(raw: unknown): FocusVerdict | undefined {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return undefined;
      try {
        o = JSON.parse(m[0]);
      } catch {
        return undefined;
      }
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  const r = o as Record<string, unknown>;
  const vb = asBool(r.visible);
  const vs =
    typeof r.visible === "string" ? r.visible.trim().toLowerCase() : "";
  const visible: FocusVerdict["visible"] | undefined =
    vs === "yes" || vs === "partly" || vs === "no"
      ? vs
      : vs === "partial" || vs === "partially"
        ? "partly"
        : vb === undefined
          ? undefined
          : vb
            ? "yes"
            : "no";
  if (!visible) return undefined;
  const ss = typeof r.size === "string" ? r.size.trim().toLowerCase() : "";
  const size: FocusVerdict["size"] =
    ss === "large" || ss === "medium" || ss === "small"
      ? ss
      : ss === "big"
        ? "large"
        : ss === "tiny"
          ? "small"
          : "medium";
  const centred = asBool(r.centred ?? r.centered) ?? false;
  const blocked = asBool(r.blocked_by_text) ?? false;
  const n = Number(typeof r.score === "string" ? r.score.trim() : r.score);
  let score: number;
  if (
    r.score !== undefined &&
    r.score !== null &&
    r.score !== "" &&
    Number.isFinite(n)
  )
    score = Math.min(3, Math.max(0, Math.round(n)));
  else if (visible === "no") score = 0;
  else
    score = Math.max(
      0,
      (visible === "yes" ? 3 : 2) -
        (size === "small" ? 1 : 0) -
        (centred ? 0 : 1) -
        (blocked ? 1 : 0),
    );
  // A subject the model says is not there cannot score: the mark follows its own answer.
  if (visible === "no") score = 0;
  return {
    subject: typeof r.subject === "string" ? r.subject.trim().slice(0, 60) : "",
    visible,
    size,
    centred,
    blocked_by_text: blocked,
    score,
  };
}

/**
 * One sample time per spoken line (pure): the middle of the line, inside the video. Lines with no words, shorter than
 * FOCUS.minLineSeconds or past FOCUS.maxLines are returned without a time and a reason instead.
 */
export function focusSamples(
  segments: Array<{ text: string; start: number; end: number }>,
  duration: number,
): FocusLine[] {
  let sampled = 0;
  return segments.map((g, line) => {
    const text = (g.text ?? "").trim();
    if (!text) return { line, text, skipped: "no words" };
    if (!(g.end - g.start >= FOCUS.minLineSeconds))
      return { line, text, skipped: "too short to sample" };
    if (sampled >= FOCUS.maxLines)
      return { line, text, skipped: "past the line limit" };
    const mid = (g.start + g.end) / 2;
    const t = Math.max(0, Math.min(mid, duration - 0.1));
    sampled++;
    return { line, text, t: Math.round(t * 100) / 100 };
  });
}

/** The record's summary (pure): checked lines, the mean score and the share of weak lines. */
export function focusSummary(lines: FocusLine[]): FocusSummary {
  const scored = lines.filter((l) => l.verdict);
  const weak = scored
    .filter((l) => l.verdict!.score <= FOCUS.weakAt)
    .map((l) => l.line);
  const round2 = (x: number) => Math.round(x * 100) / 100;
  return {
    lines: lines.length,
    checked: scored.length,
    ...(scored.length
      ? {
          mean: round2(
            scored.reduce((a, l) => a + l.verdict!.score, 0) / scored.length,
          ),
          weak_share: round2(weak.length / scored.length),
        }
      : {}),
    weak,
  };
}

/**
 * FRAME_FOCUS=fix's decision point (pure): the lines a fix would act on, weakest first. TODO(frame focus fix): for
 * each line here, re-crop the shot on screen at that time towards the subject (the plan's crop for a clip or still),
 * or swap the clip for one whose tags name the subject, then re-render once. Not built: today "fix" only records
 * these line numbers in would_fix and leaves the video exactly as "check" does.
 */
export function fixCandidates(lines: FocusLine[]): number[] {
  return lines
    .filter((l) => l.verdict && l.verdict.score <= FOCUS.weakAt)
    .sort((a, b) => a.verdict!.score - b.verdict!.score || a.line - b.line)
    .map((l) => l.line);
}

/** The event's payload (pure): the arm, every line's verdict in short and the summary. */
export function focusEvent(rec: FrameFocusRecord): Record<string, unknown> {
  return {
    arm: rec.arm,
    mode: rec.mode,
    ...(rec.lines
      ? {
          lines: rec.lines.map((l) => ({
            line: l.line,
            t: l.t,
            ...(l.verdict
              ? {
                  subject: l.verdict.subject,
                  visible: l.verdict.visible,
                  size: l.verdict.size,
                  centred: l.verdict.centred,
                  blocked: l.verdict.blocked_by_text,
                  score: l.verdict.score,
                }
              : { skipped: l.skipped }),
          })),
        }
      : {}),
    ...(rec.summary ? { summary: rec.summary } : {}),
    ...(rec.would_fix ? { would_fix: rec.would_fix } : {}),
    ...(rec.ms !== undefined ? { ms: rec.ms } : {}),
    ...(rec.note ? { note: rec.note } : {}),
    ...(rec.error ? { error: rec.error } : {}),
  };
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms} ms`)),
      Math.max(1, ms),
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 200);

/**
 * The check itself. Never throws: a failure to pull frames, a model that is down or slow, or an unreadable answer is
 * recorded on the line or the record and the episode carries on. Lines are asked one at a time (the PC's GPU is shared)
 * until FOCUS.budgetMs runs out.
 */
export async function runFrameFocus(o: {
  mode: FocusMode;
  arm: FocusArm;
  game: string;
  segments: Array<{ text: string; start: number; end: number }>;
  duration: number;
  /** Pulls frames at the given times from the final render, one file per time, in order. */
  extract: (times: number[]) => Promise<string[]>;
  /** False when the local model cannot be asked now (down, off or under test): nothing is asked. */
  ready: () => Promise<boolean>;
  /** One frame and its prompt to the local model; its raw JSON answer. */
  ask: (file: string, prompt: string) => Promise<unknown>;
  now: () => Date;
  budgetMs?: number;
  frameTimeoutMs?: number;
  clock?: () => number;
}): Promise<FrameFocusRecord> {
  const clock = o.clock ?? Date.now;
  const started = clock();
  const budget = o.budgetMs ?? FOCUS.budgetMs;
  const rec: FrameFocusRecord = {
    at: o.now().toISOString(),
    arm: o.arm,
    mode: o.mode,
  };
  if (o.mode === "off" || o.arm === "control") return rec;
  rec.game = o.game;
  try {
    const lines = focusSamples(o.segments, o.duration);
    rec.lines = lines;
    const due = lines.filter((l) => l.t !== undefined);
    if (!due.length) {
      rec.note = "no line long enough to sample";
    } else if (!(await withTimeout(o.ready(), 10_000).catch(() => false))) {
      for (const l of due) l.skipped = "local model not available";
      rec.note = "the local vision model was not available";
    } else {
      const files = await withTimeout(
        o.extract(due.map((l) => l.t!)),
        Math.max(1, budget - (clock() - started)),
      );
      for (const [k, l] of due.entries()) {
        const file = files[k];
        if (!file) {
          l.skipped = "no frame";
          continue;
        }
        const left = budget - (clock() - started);
        if (left <= 0) {
          l.skipped = "time box";
          continue;
        }
        try {
          const raw = await withTimeout(
            o.ask(file, focusPrompt({ game: o.game, line: l.text })),
            Math.min(left, o.frameTimeoutMs ?? FOCUS.frameTimeoutMs),
          );
          const v = parseFocusVerdict(raw);
          if (v) l.verdict = v;
          else l.skipped = "unreadable answer";
        } catch (err) {
          l.skipped = `failed: ${message(err)}`;
        }
      }
    }
    rec.summary = focusSummary(lines);
    if (o.mode === "fix") rec.would_fix = fixCandidates(lines);
  } catch (err) {
    rec.error = message(err);
    if (rec.lines) rec.summary = focusSummary(rec.lines);
  }
  rec.ms = clock() - started;
  return rec;
}

// ---------------------------------------------------------------- the weekly report

/** What the weekly report reads from a record (pure). */
export function focusReportRow(
  rec: FrameFocusRecord | undefined,
): { arm: FocusArm; mean?: number; weak_share?: number } | undefined {
  if (!rec?.arm) return undefined;
  return {
    arm: rec.arm,
    ...(typeof rec.summary?.mean === "number"
      ? { mean: rec.summary.mean }
      : {}),
    ...(typeof rec.summary?.weak_share === "number"
      ? { weak_share: rec.summary.weak_share }
      : {}),
  };
}

/**
 * The weekly report's two lines (pure): each side's Shorts and average viewed with the check arm's mean focus score and
 * weak-line share; then, from FOCUS.verdictMin Shorts a side, the difference in average viewed and, inside the check
 * arm, the focus score and the weak share against average viewed (rank correlation, `corr`).
 */
export function focusLinesForReport(
  rows: Array<{
    arm?: FocusArm;
    mean?: number;
    weak_share?: number;
    viewed_pct?: number;
  }>,
  corr: (xs: number[], ys: number[]) => number | undefined,
): string[] {
  const all = rows.filter((r) => r.arm);
  if (!all.length) return [];
  const has = (r: (typeof all)[number]) =>
    typeof r.viewed_pct === "number" && Number.isFinite(r.viewed_pct);
  const avg = (xs: number[]) =>
    xs.reduce((a, v) => a + v, 0) / (xs.length || 1);
  const check = all.filter((r) => r.arm === "check");
  const control = all.filter((r) => r.arm === "control");
  const vk = check.filter(has).map((r) => r.viewed_pct!);
  const vc = control.filter(has).map((r) => r.viewed_pct!);
  const scored = check.filter((r) => typeof r.mean === "number");
  const means = scored.map((r) => r.mean!);
  const weaks = check
    .filter((r) => typeof r.weak_share === "number")
    .map((r) => r.weak_share!);
  const pct = (v: number[]) => (v.length ? `${avg(v).toFixed(1)}%` : "n/a");
  const first = `Frame focus (FRAME_FOCUS), by side: check arm ${check.length} Shorts (${scored.length} scored), mean focus score ${means.length ? avg(means).toFixed(2) : "n/a"} of 3, weak lines ${weaks.length ? `${(100 * avg(weaks)).toFixed(0)}%` : "n/a"}, average viewed ${pct(vk)}; control arm ${control.length} Shorts, average viewed ${pct(vc)}.`;
  if (vk.length < FOCUS.verdictMin || vc.length < FOCUS.verdictMin)
    return [
      first,
      `Frame focus verdict: ${vk.length} check and ${vc.length} control Shorts with retention data; no verdict before ${FOCUS.verdictMin} a side.`,
    ];
  const rho = (pick: (r: (typeof all)[number]) => number | undefined) => {
    const xs = check
      .filter((r) => has(r) && typeof pick(r) === "number")
      .map((r) => ({ x: pick(r)!, v: r.viewed_pct! }));
    const c =
      xs.length >= FOCUS.verdictMin
        ? corr(
            xs.map((a) => a.x),
            xs.map((a) => a.v),
          )
        : undefined;
    return c === undefined
      ? `n/a (${xs.length} Shorts)`
      : `${c.toFixed(2)} over ${xs.length}`;
  };
  return [
    first,
    `Frame focus verdict: average viewed ${avg(vk).toFixed(1)}% in the check arm against ${avg(vc).toFixed(1)}% in the control arm (${(avg(vk) - avg(vc)).toFixed(1)} points, ${vk.length} against ${vc.length} Shorts); inside the check arm, rank correlation with average viewed: mean focus score ${rho((r) => r.mean)}, weak-line share ${rho((r) => r.weak_share)}.`,
  ];
}
