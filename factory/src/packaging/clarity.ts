// The Packaging Lab's clarity check (pure): a candidate title or hook line must say one plain thing a casual US viewer
// understands on a cold read, honestly. Hard problems refuse the candidate whatever it scores; soft ones cost it score.
// It is a gate on the model, never the other way round: a high-scoring title that misleads never ships.
import { advertiserProblems } from "../editorial/voice.ts";
import { cleanTitle, namesOwnGame } from "./features.ts";
import {
  CERTAINTY,
  CLICKBAIT,
  EMOJI,
  HYPE,
  JARGON,
  LONG_DASH,
  RUMOUR_LABEL,
  SPELLED_ORDINAL,
} from "./patterns.ts";

export interface ClarityContext {
  /** The episode's game, when it has one: a title must name it. */
  game?: string;
  /** A rumour's packaging must say so and never claim certainty. */
  rumour?: boolean;
  /** Everything the video actually says (script, description): every figure in the title must appear in it. */
  source?: string;
  /** "title" (up to 70 characters) or "hook" (the words on a Short's first frame: up to 5 words). */
  kind?: "title" | "hook";
}

export interface ClarityResult {
  ok: boolean;
  /** Reasons the candidate is refused. */
  hard: string[];
  /** Costs, each worth `penalty` points off the model score in total. */
  soft: string[];
  penalty: number;
}

/** Figures in a text, normalised ("$99.99" and "99.99" are the same figure; "5.2 million" keeps its number). */
export function figures(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(\.\d+)?/g)]
    .map((m) => m[0].replace(/,/g, ""))
    .filter((f) => f.length);
}

// All-caps words that are names, not shouting.
const ACRONYM_OK =
  /^(GTA|PS\d|PS|PC|USA|US|UK|EA|DLC|RPG|FPS|MMO|CEO|AI|VR|TV|NBA|NFL|FIFA|WWE|II|III|IV|VI|VII|VIII|IX|XI|XII|XIV|XV|XVI|HD|4K|OK|CD|DS|3DS|GOTY|COD|BO\d|MW\d|RE\d?|FF\d*|DOOM|IGN|PSN|XBOX)$/;

export function clarity(raw: string, ctx: ClarityContext = {}): ClarityResult {
  const t = cleanTitle(raw);
  const kind = ctx.kind ?? "title";
  const hard: string[] = [];
  const soft: string[] = [];
  const words = t.split(/\s+/).filter(Boolean);
  if (!t) hard.push("empty");
  if (LONG_DASH.test(raw)) hard.push("long dash");
  if (CLICKBAIT.test(t)) hard.push("clickbait phrase");
  if (EMOJI.test(raw)) hard.push("emoji");
  if (/!/.test(t)) hard.push("exclamation mark");
  if (SPELLED_ORDINAL.test(t)) hard.push("ordinal spelled out (write 14th)");
  for (const p of advertiserProblems(t)) hard.push(p);
  if (kind === "title") {
    if (t.length > 70) hard.push("over 70 characters");
    if (t.length < 18) hard.push("under 18 characters");
    if (t.length > 62)
      soft.push("cut off on a phone after about 60 characters");
  } else if (words.length > 5 || t.length > 30)
    hard.push("hook words longer than 5 words");
  const shouting = words.filter((w) => {
    const bare = w.replace(/[^A-Za-z0-9]/g, "");
    return (
      bare.length >= 3 &&
      /[A-Z]/.test(bare) &&
      bare === bare.toUpperCase() &&
      !ACRONYM_OK.test(bare) &&
      // A name written in capitals in the video itself (an app, a studio) twice or more is a name, not shouting.
      (ctx.source ?? "").split(/[^A-Za-z0-9]+/).filter((x) => x === bare).length < 2
    );
  });
  if (kind === "title" && shouting.length)
    hard.push(`all-caps word: ${shouting[0]}`);
  if (ctx.game && kind === "title" && !namesOwnGame(t, ctx.game))
    hard.push("does not name the game");
  if (ctx.rumour) {
    if (CERTAINTY.test(t)) hard.push("a rumour presented as confirmed");
    if (kind === "title" && !RUMOUR_LABEL.test(t))
      hard.push("a rumour without a label (reportedly, leak, could, ?)");
  }
  if (ctx.source !== undefined) {
    const have = new Set(figures(ctx.source));
    const missing = figures(t).filter((f) => !have.has(f));
    if (missing.length) hard.push(`figure not in the video: ${missing[0]}`);
  }
  if (HYPE.test(t)) soft.push("hype word");
  if (JARGON.test(t)) soft.push("jargon a casual viewer may not know");
  if ((t.match(/[:|]/g) ?? []).length > 1)
    soft.push("more than one break: two points, not one");
  if (kind === "title" && words.length > 12) soft.push("more than 12 words");
  if (/\b(and|plus)\b.*\b(and|plus)\b/i.test(t))
    soft.push("a list of things, not one point");
  return { ok: hard.length === 0, hard, soft, penalty: soft.length * 0.25 };
}
