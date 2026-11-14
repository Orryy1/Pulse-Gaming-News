// A funny clip in the gameplay lane (FUNNY_SHORTS), pure parts. The finder (src/funny/finder.ts) already knows the
// payoff, why it is funny and what the local vision relay saw, so the lane's paid reviewer and second look are not
// asked: the review below is built from the clip's own "funny" block and the lane's Whisper words. Everything else is
// the lane as ever: the spoiler guard, the owner's tap in Discord, the gameplay slot.
//
// The rules that make it a funny Short and keep it safe:
//   - one a day, in FUNNY_SLOT (one of GAMEPLAY_SLOTS, never GTA_DAILY_SLOT): no extra volume;
//   - nothing before FUNNY_START (GTA VI's launch day, so the first ones come from the owner's GTA VI streams);
//   - advertiser-safe: no swearing anywhere in the cut, no gore, a clean caption, and the first AD_SAFE_SECONDS are
//     held to the same bar (the cut starts right on the action, so those seconds are the build-up);
//   - no story: inside the spoiler window a clip the vision check saw as a cutscene is not used;
//   - licensed music: the finder sets aside moments with music likely in them unless a radio-free copy exists.

import type { GameplayMeta, GameplayReview } from "../gameplay.ts";
import type { Script } from "../editorial/schema.ts";
import { addDays, dayKey, localTime } from "../lanes.ts";
import {
  AD_SAFE_SECONDS,
  captionProblems,
  strongLanguage,
  type FunnyPlan,
} from "./edit.ts";
import type { FunnyMeta } from "./finder.ts";
import type { FunnySettings } from "./settings.ts";

/** Inbox ids of funny clips start with this, so the story hash ("gameplay:funny_...") marks the format for good. */
export const FUNNY_ID_PREFIX = "funny_";

export type FunnyClipMeta = GameplayMeta & { funny: FunnyMeta };

/** The clip's funny block, when it is a funny clip (pure). */
export function funnyOf(meta: GameplayMeta | undefined): FunnyMeta | undefined {
  const f = (meta as Partial<FunnyClipMeta> | undefined)?.funny;
  return f && typeof f.payoff_in_clip === "number" && f.plan ? f : undefined;
}

/** Whether an episode's story hash is a funny Short's (pure). */
export const isFunnyHash = (hash: string | null | undefined): boolean =>
  (hash ?? "").startsWith(`gameplay:${FUNNY_ID_PREFIX}`);

/** The game's name fans search, from the stream title (pure). */
export function funnyGame(title: string): {
  name: string;
  short: string;
  tags: string[];
} {
  if (/\b(gta\s*(vi|6)|grand theft auto\s*(vi|6))\b/i.test(title))
    return {
      name: "Grand Theft Auto VI",
      short: "GTA 6",
      tags: ["#GTA6", "#GTAVI", "#GTA6FunnyMoments"],
    };
  if (/\b(gta\s*(v|5)|grand theft auto\s*(v|5))\b/i.test(title))
    return {
      name: "Grand Theft Auto V",
      short: "GTA 5",
      tags: ["#GTA5", "#GTAV", "#GTAFunnyMoments"],
    };
  const name = title.replace(/\s*[|:].*$/, "").trim() || "the game";
  return {
    name,
    short: name,
    tags: [`#${name.replace(/[^\p{L}\p{N}]/gu, "")}`],
  };
}

/** Whisper words that fall in a stretch of the clip, as one string (pure). */
export function wordsBetween(
  words: Array<{ text: string; start: number; end: number }>,
  from: number,
  to: number,
): string {
  return words
    .filter((w) => w.end > from && w.start < to)
    .map((w) => w.text)
    .join(" ");
}

/** Why a funny clip may not be used, empty when it may (pure). */
export function funnyProblemsFor(
  f: FunnyMeta,
  words: Array<{ text: string; start: number; end: number }>,
  o: { minScore: number; inSpoilerWindow: boolean },
): string[] {
  const out: string[] = [];
  const p = f.plan;
  if (f.score < o.minScore) out.push(`score ${f.score} under ${o.minScore}`);
  if (strongLanguage(wordsBetween(words, p.cutIn, p.cutOut)))
    out.push("swearing in the cut");
  if (strongLanguage(wordsBetween(words, p.cutIn, p.cutIn + AD_SAFE_SECONDS)))
    out.push(`swearing in the first ${AD_SAFE_SECONDS} s`);
  if (f.vision?.gore) out.push("gore on screen");
  if (f.vision?.menu) out.push("a menu or loading screen");
  if (f.vision?.cutscene && o.inSpoilerWindow)
    out.push("a story cutscene inside the spoiler window");
  for (const t of [f.caption.hook, f.caption.punch])
    for (const why of captionProblems(t)) out.push(`caption "${t}": ${why}`);
  return out;
}

/** The lane's review for a funny clip, built with no model call (pure). */
export function funnyReview(
  meta: FunnyClipMeta,
  words: Array<{ text: string; start: number; end: number }>,
  o: { minScore: number; inSpoilerWindow: boolean },
): GameplayReview {
  const f = meta.funny;
  const game = funnyGame(`${meta.source.title} ${meta.review?.game ?? ""}`);
  const problems = funnyProblemsFor(f, words, o);
  const why =
    f.vision?.why?.trim() || f.reasons[0] || "a funny moment from the stream";
  const title = `${f.caption.hook} | ${game.short} funny moment`;
  return {
    keep: problems.length === 0,
    score: Math.max(1, Math.min(10, Math.round(f.vision?.funny ?? f.score))),
    reason: problems.length
      ? `funny clip set aside: ${problems.join("; ")}`
      : `funny moment: ${f.reasons.slice(0, 2).join("; ")}`,
    game_title: game.name,
    real_test: false,
    experiment_number: 0,
    question: f.caption.hook,
    result_line: f.caption.punch,
    result: why.replace(/\.?$/, "."),
    start_seconds: f.plan.cutIn,
    end_seconds: f.plan.cutOut,
    youtube_title:
      title.length <= 70 ? title : `${f.caption.hook}`.slice(0, 70),
    description: `Caught live on stream: ${why.replace(/\.$/, "")}. No narration, just the moment.`,
    hashtags: [...game.tags, "#Shorts"].slice(0, 5),
    radio_audible: false,
    spoiler: Boolean(f.vision?.cutscene && o.inSpoilerWindow),
    strong_language: problems.some((p) => p.startsWith("swearing")),
    captions_ok: false,
  };
}

/** The script fields a funny Short changes after the lane's gameplayScript (pure, in place). */
export function funnyScript(
  script: Script,
  f: FunnyMeta,
  game: string,
): Script {
  script.headline = f.caption.hook;
  script.hook = f.caption.hook;
  script.pulse_take = {
    label: "THE MOMENT",
    narration: "",
    on_screen: f.caption.punch,
  };
  script.beats = [
    { narration: "", visual: { kind: "none", primary: "", secondary: "" } },
  ];
  script.loop_line = "";
  script.youtube.tags = [
    ...new Set([game, "funny moments", "gameplay", ...script.youtube.tags]),
  ].slice(0, 15);
  script.gameplay!.direct = {
    hook: f.caption.hook,
    setup: "",
    payoff_line: "",
    loop_line: "",
    segments: [{ start: f.plan.cutIn, end: f.plan.cutOut }],
    seconds: f.plan.seconds,
    payoff_at: f.plan.payoffAt,
    focus_start: 0.5,
    focus_payoff: 0.5,
    funny: { ...f.plan, punch: f.caption.punch },
  };
  return script;
}

/** The PulseGameplayShort props for a funny Short (pure): caption up to the payoff, the punchline stamp, a REPLAY tag. */
export function funnyShortProps(f: Pick<FunnyMeta, "plan" | "caption">) {
  const p: FunnyPlan = f.plan;
  return {
    words: [],
    durationSeconds: p.seconds,
    hook: f.caption.hook,
    hookEnd: p.payoffAt,
    resultLine: f.caption.punch,
    payoffAt: p.payoffAt,
    voiced: [] as Array<{ start: number; end: number }>,
    accent: "#FF6B1A",
    tag: { text: "REPLAY", from: p.replayAt, to: p.seconds },
  };
}

/** The finished Short's faults (pure): black picture, or the payoff landing with nothing after it. */
export function funnyRenderProblems(m: {
  blacks: Array<{ start: number; end: number }>;
  payoffAt: number;
  seconds: number;
}): string[] {
  const out: string[] = [];
  if (m.blacks.length)
    out.push(
      `black picture at ${m.blacks.map((b) => `${b.start.toFixed(1)} s`).join(", ")}`,
    );
  if (m.payoffAt > m.seconds - 2)
    out.push(
      "the payoff lands at the very end, with no reaction or replay after it",
    );
  if (m.seconds < 8 || m.seconds > 30)
    out.push(`${m.seconds.toFixed(1)} s long (funny Shorts run 8-30 s)`);
  return out;
}

/** Whether funny Shorts may go out on a day (pure): on, not dropped by the learner, on or after FUNNY_START. */
export function funnyDayOpen(
  s: Pick<FunnySettings, "shorts" | "start">,
  day: string,
  dropped: boolean,
): boolean {
  return s.shorts && !dropped && day >= s.start;
}

/**
 * The slot for an approved funny Short (pure): FUNNY_SLOT on the first open day (today and the next six) that is at
 * least 20 minutes away, holds no other funny Short and is a full upload gap from everything else scheduled. Slots kept
 * for something else (GTA 6 Day N's) are never used.
 */
export function funnySlot(
  s: Pick<FunnySettings, "shorts" | "start" | "slot">,
  o: {
    now: Date;
    timeZone: string;
    dropped: boolean;
    funnyTaken: Date[];
    scheduled: Date[];
    gapMinutes: number;
    kept?: (at: Date) => boolean;
  },
): Date | undefined {
  const today = dayKey(o.now, o.timeZone);
  for (let d = 0; d < 7; d++) {
    const day = addDays(today, d);
    if (!funnyDayOpen(s, day, o.dropped)) continue;
    const at = localTime(day, s.slot, o.timeZone);
    if (at.getTime() - o.now.getTime() < 20 * 60_000) continue;
    if (o.kept?.(at)) continue;
    if (o.funnyTaken.some((t) => dayKey(t, o.timeZone) === day)) continue;
    if (
      o.scheduled.some(
        (t) => Math.abs(t.getTime() - at.getTime()) < o.gapMinutes * 60_000,
      )
    )
      continue;
    return at;
  }
  return undefined;
}

/** On open days FUNNY_SLOT is kept for the funny Short: other gameplay Shorts go to the other slots (pure). */
export function funnyKept(
  s: Pick<FunnySettings, "shorts" | "start" | "slot">,
  timeZone: string,
  dropped: boolean,
): (at: Date) => boolean {
  if (!s.shorts || dropped) return () => false;
  return (at) => {
    const day = dayKey(at, timeZone);
    return (
      funnyDayOpen(s, day, dropped) &&
      localTime(day, s.slot, timeZone).getTime() === at.getTime()
    );
  };
}
