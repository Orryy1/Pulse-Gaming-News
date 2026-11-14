// The rebuilt gameplay Short (GAMEPLAY_DIRECT, world-class audit fix 11, 5 Nov 2026). The old form started on the
// reviewer's window, played 18 s of nothing, stopped as the fall began and sat in a band between blur with no voice.
// This one: picture full screen from frame one, already in the attempt; a spoken question or dare on that frame; a
// line of stake; the voice steps aside so the game's own sound carries the payoff; the answer, then a last line that
// runs back into the first. Rival pattern studied: TBAG (15-20M a Short) starts mid-action with the voice already
// talking and ends on the reveal. No copying of any video.
//
// The reviewer judges from frames 5 s apart, so it cannot time a payoff. A second look (one vision call, only for a
// clip already kept) sees a frame every second and says where the attempt starts, where the outcome lands and what
// is dead air. Everything after that is arithmetic and is tested here without a model.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Llm, LlmContent } from "./editorial/llm.ts";
import { FFMPEG } from "./lib/bin.ts";
import { parseBlackSpans, type GameplayReview } from "./gameplay.ts";

/** Spoken pace the budgets assume: 192 words a minute, inside the audit's target once sped to the floor. */
export const DIRECT_WORDS_PER_SECOND = 3.2;
export const DIRECT_MIN_WPM = 185;
export const DIRECT_MIN_SECONDS = 8;
export const DIRECT_MAX_SECONDS = 30;
/** The longest run-up before the outcome: past this a viewer is waiting, not watching (the train clip's 18 s of descent). */
export const DIRECT_MAX_RUNUP = 12;
/** Game sound alone between the outcome landing and the voice coming back. */
export const DIRECT_PAYOFF_BREATH = 0.9;
/** The most of the ending a replay may repeat, at DIRECT_REPLAY_SPEED, when the answer needs more time than is left. */
export const DIRECT_REPLAY_SECONDS = 3;
export const DIRECT_REPLAY_SPEED = 0.7;

export const GameplayDirectionSchema = z.object({
  payoff_visible: z
    .boolean()
    .describe(
      "True when the frames show the outcome itself: the landing, the escape, the crash, the fall under way. False when the clip stops before anything is answered",
    ),
  action_start_seconds: z
    .number()
    .describe(
      "The first frame where the attempt is visibly under way: moving, falling, being chased. Never a walk-up, a menu or a pause before it",
    ),
  payoff_seconds: z.number().describe("The second the outcome lands"),
  payoff_end_seconds: z
    .number()
    .describe(
      "Where to stop: just after the reaction to the outcome, before anything ordinary starts and before any result screen, mission text or menu appears",
    ),
  dead_spans: z
    .array(z.object({ start: z.number(), end: z.number() }))
    .describe(
      "Stretches between the start and the payoff to cut because nothing happens: empty road, a load, a map. Empty when the attempt runs unbroken",
    ),
  focus_start: z
    .number()
    .describe(
      "Across the frame at the start, 0 left to 1 right: the centre of what to watch (usually the player)",
    ),
  focus_payoff: z.number().describe("The same at the payoff"),
  hook: z
    .string()
    .describe(
      "The first thing said and shown, 3 to 9 words, American English: the question or dare a viewer wants answered, ideally with 'you'. Never a greeting, the channel, or the game's name alone",
    ),
  setup: z
    .string()
    .describe(
      "One or two short spoken sentences of stake while the attempt runs: why this might not work, or what most players assume. Empty when the attempt is too short",
    ),
  payoff_line: z
    .string()
    .describe(
      "Spoken just after the outcome, under 10 words, says what happened in words the result card does not use. Only what the frames show",
    ),
  loop_line: z
    .string()
    .describe(
      "The last words, under 10, a lead-in that the hook finishes when the Short replays. Never repeats the hook's own words and never ends mid-word. No request to like, subscribe or comment",
    ),
});
export type GameplayDirection = z.infer<typeof GameplayDirectionSchema>;

export const GAMEPLAY_DIRECT_PROMPT = `You cut the owner's own gameplay recording into a Short for Pulse Gaming. A reviewer already kept this clip. You see one frame a second, each labelled with its time, plus what the reviewer decided. Your job is timing and four short lines of narration.
The Short starts on frame one already inside the attempt, full screen, with the voice talking. There is no intro, walk-up or logo. It ends right after the outcome. The narrator stops while the outcome lands so the game's sound carries it, then says what happened, then a last line that runs back into the first line, so a replay sounds like one sentence continuing.
Timing: read the frames. action_start_seconds is when the attempt is visibly happening, not when the player is getting ready. Cut dead stretches between the start and the payoff (empty road, loading, a map). Black frames are cut for you.
Lines: American English. Say "you" to the viewer. Short declarative sentences, a calm dry voice, no hype words, no em dashes. The narrator did not play it, so no "I". "We tested" is fine only when it really is a test.
The answer has to be true to the frames: never claim a landing, an escape or a win the last frames do not show. A jump made and a fall under way is an honest answer to "can you jump off it?". When nothing is answered, payoff_visible is false.
The loop line is a complete lead-in that hands over to the hook when the video starts again, and it must not repeat the hook's words. Fit it to what just happened: a consequence, a dare or the next person who will try it. Do not reuse a stock phrase. Check it by reading loop line then hook aloud as one sentence.
The setup is real stake or a real obstacle the viewer can see, not a description of the scenery. When the attempt is short, leave it empty.
Mechanics only: no story, characters' fates, missions or endings; do not name a mission. Avoid the words death, kill, war, attack and crisis. No affiliate talk, no prices, no request to subscribe.
Word limits are hard, because each word costs a third of a second of picture: hook plus setup must fit in the time from the start to the payoff at ${DIRECT_WORDS_PER_SECOND} words a second.`;

/** A line as it should be spoken: model artefacts (a stray tag) gone. 5 Nov 2026: a loop line came back ending "</parameter>". */
export function cleanLine(s: string): string {
  return s.replace(/<\/?[a-z_]+>/gi, "").replace(/\s+/g, " ").trim();
}

/** A loop that stops on a joining word cannot hand over to a hook that is its own sentence ("...when you ask whether"). */
export function loopDangles(loop: string): boolean {
  return /\b(whether|if|that|which|is|are|was|the|a|an|of|to|on|and|or|when|how|why|what|you|can)[.!?]?$/i.test(
    loop.trim(),
  );
}

/** Stand-ins for a loop that fails either check, by clip so a run of Shorts does not all end on one line. */
export const LOOP_LEAD_INS = [
  "So the next time someone asks you,",
  "Which leaves the one thing your friends will ask:",
  "Now you know what to say when they ask,",
  "And all of that started with one question:",
  "So when this comes up again, and it will,",
];
export function loopLeadIn(clipId: string): string {
  let h = 0;
  for (const c of clipId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LOOP_LEAD_INS[h % LOOP_LEAD_INS.length]!;
}

/** The loop repeats the hook when most of the hook's real words are in it: on a replay that sounds like a stutter. */
export function loopRepeatsHook(loop: string, hook: string): boolean {
  const key = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter((w) => w.length > 3),
    );
  const h = key(hook);
  const l = key(loop);
  if (!h.size) return false;
  return [...h].filter((w) => l.has(w)).length / h.size >= 0.6;
}

export const countWords = (s: string): number =>
  s.trim().split(/\s+/).filter(Boolean).length;

const round = (n: number) => Math.round(n * 100) / 100;

export interface DirectCut {
  /** The stretches of the clip to keep, in order. */
  segments: Array<{ start: number; end: number }>;
  /** The kept length. */
  seconds: number;
  /** When the outcome lands, on the Short's own clock. */
  payoffAt: number;
}

/** A clip time on the cut's own clock. */
export function onCutClock(t: number, segments: DirectCut["segments"]): number {
  let at = 0;
  for (const s of segments) {
    if (t <= s.start) return at;
    if (t <= s.end) return at + (t - s.start);
    at += s.end - s.start;
  }
  return at;
}

/**
 * The stretches to keep: from the attempt to just past the outcome, with dead air and black gone, the outcome never
 * cut, 8-30 s long. Too long loses the start, never the end. Too short takes back what comes before the attempt,
 * unless that is black. The run-up to the outcome stays under DIRECT_MAX_RUNUP.
 */
export function directCut(
  d: Pick<
    GameplayDirection,
    | "action_start_seconds"
    | "payoff_seconds"
    | "payoff_end_seconds"
    | "dead_spans"
  >,
  blacks: Array<{ start: number; end: number }>,
  clipSeconds: number,
): DirectCut {
  const payoff = Math.max(0, Math.min(clipSeconds, d.payoff_seconds));
  const stop = Math.min(
    clipSeconds,
    Math.max(d.payoff_end_seconds, payoff + 1.5),
  );
  const end = clipSeconds - stop <= 1 ? clipSeconds : stop;
  const start = Math.max(0, Math.min(d.action_start_seconds, payoff) - 0.2);
  // Black always goes; a "dead" span cannot swallow the moment of the outcome.
  const cuts = [
    ...blacks,
    ...d.dead_spans.filter((s) => s.end > s.start && s.end <= payoff - 0.5),
  ]
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start);
  const keep = (from: number, to: number) => {
    const out: Array<{ start: number; end: number }> = [];
    let at = from;
    for (const c of cuts) {
      if (c.end <= at) continue;
      if (c.start >= to) break;
      if (c.start > at) out.push({ start: at, end: c.start });
      at = Math.max(at, c.end);
    }
    if (at < to) out.push({ start: at, end: to });
    // A sliver between two cuts reads as a flash.
    return out.filter((s) => s.end - s.start >= 0.6);
  };
  const total = (segs: Array<{ start: number; end: number }>) =>
    segs.reduce((n, s) => n + (s.end - s.start), 0);
  let from = start;
  let segments = keep(from, end);
  // Too short: reach back before the attempt, a second at a time.
  while (total(segments) < DIRECT_MIN_SECONDS && from > 0) {
    from = Math.max(0, from - 1);
    segments = keep(from, end);
  }
  // Too long: the start goes first; the outcome is what the Short is for.
  while (total(segments) > DIRECT_MAX_SECONDS && segments.length) {
    const over = total(segments) - DIRECT_MAX_SECONDS;
    const first = segments[0]!;
    segments =
      first.end - first.start <= over + 0.6
        ? segments.slice(1)
        : [{ start: first.start + over, end: first.end }, ...segments.slice(1)];
  }
  // A long run-up loses its start too, down to what the Short needs at least.
  const payoffOn = () => onCutClock(payoff, segments);
  while (payoffOn() > DIRECT_MAX_RUNUP && segments.length) {
    const room = Math.min(
      payoffOn() - DIRECT_MAX_RUNUP,
      total(segments) - DIRECT_MIN_SECONDS,
    );
    if (room <= 0.01) break;
    const first = segments[0]!;
    segments =
      first.end - first.start <= room + 0.6
        ? segments.slice(1)
        : [{ start: first.start + room, end: first.end }, ...segments.slice(1)];
  }
  const rounded = segments.map((s) => ({
    start: round(s.start),
    end: round(s.end),
  }));
  return {
    segments: rounded,
    seconds: round(total(rounded)),
    payoffAt: round(onCutClock(payoff, rounded)),
  };
}

/** The setup goes, whole sentences at a time, when hook and setup would still be talking as the outcome lands. */
export function fitLines(
  d: Pick<GameplayDirection, "hook" | "setup">,
  payoffAt: number,
): { hook: string; setup: string } {
  const room = Math.max(0, payoffAt - 0.2) * DIRECT_WORDS_PER_SECOND;
  if (countWords(d.hook) + countWords(d.setup) <= room)
    return { hook: d.hook.trim(), setup: d.setup.trim() };
  const kept: string[] = [];
  let used = countWords(d.hook);
  for (const s of d.setup.match(/[^.!?]+[.!?]*/g) ?? []) {
    if (used + countWords(s) > room) break;
    kept.push(s.trim());
    used += countWords(s);
  }
  return { hook: d.hook.trim(), setup: kept.join(" ") };
}

export interface DirectTiming {
  /** The answer take starts here. */
  answerAt: number;
  /** The Short's whole length, a replay included. */
  seconds: number;
  /** Seconds of the cut's ending shown again slowed, when the answer needs more time than the footage has. */
  replaySource: number;
}

/**
 * Where the answer sits. It waits for the outcome to land plus a breath of game sound, then ends with the film. When
 * the footage runs out first, the ending plays again slowed (at most DIRECT_REPLAY_SECONDS of it), which also shows
 * the payoff twice instead of stopping on it.
 */
export function directTiming(
  cutSeconds: number,
  payoffAt: number,
  questionSeconds: number,
  answerSeconds: number,
): DirectTiming {
  const earliest = Math.max(
    payoffAt + DIRECT_PAYOFF_BREATH,
    questionSeconds + 0.1,
  );
  const short = earliest + answerSeconds + 0.1 - cutSeconds;
  if (short <= 0)
    return {
      answerAt: round(cutSeconds - answerSeconds - 0.1),
      seconds: round(cutSeconds),
      replaySource: 0,
    };
  const replaySource = round(
    Math.min(
      DIRECT_REPLAY_SECONDS,
      Math.max(0.5, cutSeconds),
      short * DIRECT_REPLAY_SPEED + 0.05,
    ),
  );
  const seconds = cutSeconds + replaySource / DIRECT_REPLAY_SPEED;
  return {
    answerAt: round(Math.max(earliest, seconds - answerSeconds - 0.1)),
    seconds: round(seconds),
    replaySource,
  };
}

/** ffmpeg's crop x for a full-screen 9:16 picture from a 16:9 one, gliding from the start's subject to the payoff's. */
export function cropX(
  focusStart: number,
  focusPayoff: number,
  payoffAt: number,
): string {
  const at = (f: number) => Math.max(0, Math.min(1, f)).toFixed(3);
  const move = Math.max(0.1, payoffAt).toFixed(2);
  return `max(0,min(iw-ow,iw*(${at(focusStart)}+(${at(focusPayoff)}-${at(focusStart)})*min(1,t/${move}))-ow/2))`;
}

/** The whole filter for the cut: segments joined, cropped to fill the phone, with an optional slowed replay of the end. */
export function directFilter(
  cut: DirectCut,
  o: {
    tone: string;
    focusStart: number;
    focusPayoff: number;
    replaySource: number;
  },
): string {
  const parts: string[] = [];
  const labels: string[] = [];
  cut.segments.forEach((s, i) => {
    parts.push(
      `[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`,
      `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, round(s.end - s.start - 0.02))}:d=0.02[a${i}]`,
    );
    labels.push(`[v${i}][a${i}]`);
  });
  parts.push(
    `${labels.join("")}concat=n=${cut.segments.length}:v=1:a=1[jv][ja]`,
  );
  let v = "[jv]";
  let a = "[ja]";
  let total = cut.seconds;
  if (o.replaySource > 0) {
    // The replay shows the outcome itself again, not whatever came last.
    const from = round(
      Math.max(0, Math.min(cut.payoffAt - 0.7, cut.seconds - o.replaySource)),
    );
    const to = round(from + o.replaySource);
    parts.push(
      "[jv]split[jv1][jv2]",
      "[ja]asplit[ja1][ja2]",
      `[jv2]trim=start=${from}:end=${to},setpts=(PTS-STARTPTS)/${DIRECT_REPLAY_SPEED}[rv]`,
      `[ja2]atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS,atempo=${DIRECT_REPLAY_SPEED}[ra]`,
      "[jv1][rv]concat=n=2:v=1:a=0[jr]",
      "[ja1][ra]concat=n=2:v=0:a=1[ar]",
    );
    v = "[jr]";
    a = "[ar]";
    total += o.replaySource / DIRECT_REPLAY_SPEED;
  }
  parts.push(
    `${v}${o.tone}scale=-2:1920,crop=1080:1920:x='${cropX(o.focusStart, o.focusPayoff, cut.payoffAt)}':y=0,fps=30,format=yuv420p[vout]`,
    `${a}afade=t=out:st=${Math.max(0, round(total - 0.08))}:d=0.08[aout]`,
  );
  return parts.join(";");
}

/** One frame a second for the second look, at most 45 (a clip can run to 75 s). */
export async function directFrames(
  clip: string,
  clipSeconds: number,
  outDir: string,
): Promise<Array<{ at: number; file: string }>> {
  await fs.mkdir(outDir, { recursive: true });
  const step = Math.max(1, Math.ceil(clipSeconds / 45));
  await promisify(execFile)(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      clip,
      "-vf",
      `fps=1/${step},scale=384:-2`,
      "-q:v",
      "5",
      path.join(outDir, "%03d.jpg"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const names = (await fs.readdir(outDir))
    .filter((n) => n.endsWith(".jpg"))
    .sort();
  return names.map((n, i) => ({ at: i * step, file: path.join(outDir, n) }));
}

/** The second look: where the attempt and the outcome are, and the four lines. */
export async function directClip(
  llm: Llm,
  frames: Array<{ at: number; file: string }>,
  review: Pick<
    GameplayReview,
    "question" | "result" | "result_line" | "real_test" | "game_title"
  >,
  blacks: Array<{ start: number; end: number }>,
): Promise<GameplayDirection> {
  const content: LlmContent = [];
  for (const f of frames) {
    const data = await fs.readFile(f.file).catch(() => undefined);
    if (!data) continue;
    content.push({ type: "text", text: `t=${f.at} s` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: data.toString("base64"),
      },
    });
  }
  content.push({
    type: "text",
    text: [
      `Game: ${review.game_title}`,
      `The reviewer's question: ${review.question}`,
      `What the reviewer says happened: ${review.result}`,
      `The result card (do not repeat its words in the payoff line): ${review.result_line}`,
      `A real test of the question: ${review.real_test ? "yes" : "no, a striking moment"}`,
      blacks.length
        ? `Black stretches, cut for you: ${blacks.map((b) => `${b.start.toFixed(1)}-${b.end.toFixed(1)} s`).join(", ")}`
        : "No black stretches.",
    ].join("\n"),
  });
  return llm.structured({
    system: GAMEPLAY_DIRECT_PROMPT,
    content,
    schema: GameplayDirectionSchema,
    effort: "medium",
    tier: "mid",
    cache: "1h",
  });
}

/** Black stretches over 0.2 s anywhere in a video. */
export async function blackSpans(
  file: string,
): Promise<Array<{ start: number; end: number }>> {
  const r = await promisify(execFile)(
    FFMPEG,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-vf",
      "blackdetect=d=0.2:pix_th=0.08",
      "-an",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return parseBlackSpans(r.stderr);
}

/** What stops a finished Short reaching the owner: the faults the audit found in every earlier attempt. */
export function directProblems(m: {
  blacks: Array<{ start: number; end: number }>;
  firstWordAt?: number;
  payoffAt: number;
  seconds: number;
  answerAt: number;
  loopLine: string;
}): string[] {
  const out: string[] = [];
  if (m.blacks.length)
    out.push(
      `black picture at ${m.blacks.map((b) => `${b.start.toFixed(1)} s`).join(", ")}`,
    );
  if (m.firstWordAt === undefined || m.firstWordAt > 0.4)
    out.push("the voice does not start on the first frame");
  if (m.payoffAt > m.seconds - 0.5)
    out.push("the outcome lands at the very end, with nothing after it");
  if (m.answerAt < m.payoffAt)
    out.push("the answer talks over the outcome landing");
  if (!m.loopLine.trim()) out.push("no loop line");
  return out;
}
