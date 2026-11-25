// ENDING_FORMS (frontier check 25 Nov 2026, queue item 46): "sounds human" is Pulse's widest gap against human
// breakout Shorts (2.9 against 6.6 in the blind marks), and the spoken "My verdict:" line closed 14 of 31 Shorts that
// week because the Pulse Check rule and the friend and clarity passes require it. The blind judges named it in about
// half their notes; the desk already lists it as a tell. Half of the Shorts that would end on the Pulse Check (chosen
// by episode, so a retry keeps its side) drop the spoken segment instead: the take ends on one of four closing forms,
// none used more than twice in a day, and never on a "My verdict:" style lead-in. The other half are unchanged.
// ENDING_FORMS_SHARE sets the share; 0 (the default) changes nothing.
import type { Script } from "./schema.ts";

export const ENDING_FORMS = [
  "callback",
  "consequence",
  "punchline",
  "fact",
] as const;
export type EndingForm = (typeof ENDING_FORMS)[number];
export type EndingArm = "forms" | "verdict";

/** A form is not given out again once this many Shorts were handed it in the last day (handed, not delivered: a Short
 * dropped later still counts, and two written at once can share one). */
export const ENDING_FORM_DAILY_MAX = 2;

const FORM_RULE: Record<EndingForm, string> = {
  callback:
    "a callback: the take's last sentence returns to the hook's own image, word or question and settles it, so the end answers the start.",
  consequence:
    "a consequence: the take's last sentence says the one thing this changes for the viewer next (a date, a cost, a choice, what to watch for), as a plain statement.",
  punchline:
    "a punchline: the take's last sentence is a dry, earned joke that lands the take's point; it must still make sense to someone who heard nothing else, and it never mocks a person.",
  fact: "a closing fact: the take's last sentence is one plain, sourced fact that settles the point on its own, said without comment.",
};

/** The side of the test this episode is on (pure): "forms" for a hash under the share. */
export function endingArmFor(hash: number, share: number): EndingArm {
  return share > 0 && hash < share ? "forms" : "verdict";
}

/**
 * The closing form for a Short on the "forms" side (pure). A retry keeps the form it had; otherwise the form the
 * last day used least, never one already used ENDING_FORM_DAILY_MAX times while another is free, ties broken by the
 * episode's own hash so the order is not always the same.
 */
export function pickEndingForm(
  hash: number,
  usedToday: string[],
  kept?: string,
): EndingForm {
  if (kept && (ENDING_FORMS as readonly string[]).includes(kept))
    return kept as EndingForm;
  const count = (f: EndingForm) => usedToday.filter((u) => u === f).length;
  const start = Math.floor(hash * ENDING_FORMS.length) % ENDING_FORMS.length;
  const order = ENDING_FORMS.map(
    (_, i) => ENDING_FORMS[(start + i) % ENDING_FORMS.length]!,
  );
  const free = order.filter((f) => count(f) < ENDING_FORM_DAILY_MAX);
  const pool = free.length ? free : order;
  return pool.reduce(
    (best, f) => (count(f) < count(best) ? f : best),
    pool[0]!,
  );
}

/** The writer's note for a Short on the "forms" side: how its take ends, and what it never says. */
export function endingFormRule(form: EndingForm): string {
  return `How this Short's take ends: on ${FORM_RULE[form]}
Never close on a label or a lead-in: no "My verdict", "My call", "The verdict", "Bottom line", "Final verdict", "Pulse check" or "Here's my take", with or without a colon. A friend just says the thing. The take still gives its one reason first, and the loop_line still follows and closes the Short.`;
}

// A spoken lead-in that names the verdict instead of just saying it. Kept in a file, not inline, per house rule.
// Only at the start of a sentence, so "On the call, Take-Two said" or "Sony made the call." are ordinary narration.
const SENTENCE = String.raw`(?:^|[.!?]["”]?\s+)(?:(?:so|okay|right|look|and|honestly),?\s+)?`;
const VERDICT_LEADS: RegExp[] = [
  new RegExp(
    `${SENTENCE}(?:my|our|the|final)\\s+(?:verdict|call|take)(?:\\s+on (?:this|that)(?: one)?|\\s+here)?(?:\\s+is(?:\\s+simple)?)?\\s*[:?]`,
    "i",
  ),
  new RegExp(`${SENTENCE}(?:my|our|the final)\\s+verdict\\s*[,.]`, "i"),
  new RegExp(`${SENTENCE}(?:the\\s+)?bottom line(?:\\s*[:?,.]|\\s+is\\b)`, "i"),
  /\bpulse check\b/i,
  /\bhere['’]?s my (?:take|verdict)\b/i,
  new RegExp(`${SENTENCE}verdict\\s*[:?]`, "i"),
];

/** The spoken verdict lead-ins in a take or loop line (pure); empty when there are none. */
export function verdictLeadsIn(text: string): string[] {
  const out: string[] = [];
  for (const re of VERDICT_LEADS) {
    const m = text.match(re);
    if (m) out.push(m[0].trim());
  }
  return out;
}

/** What is wrong with a "forms" side Short's ending (pure); empty when its take and loop line say no lead-in. */
export function endingFormProblems(
  s: Pick<Script, "pulse_take" | "loop_line">,
): string[] {
  const found = [
    ...verdictLeadsIn(s.pulse_take.narration),
    ...verdictLeadsIn(s.loop_line),
  ];
  return found.length
    ? [
        `The take or loop line says "${found[0]}" aloud. Drop the lead-in and just say the point, ending the take on the closing form asked for.`,
      ]
    : [];
}

/** What goes on the script for the weekly report: the side, the form the writer was asked for (not checked as delivered:
 * later rewrites may change the last sentence) and whether a lead-in slipped through. */
export type EndingRecord = {
  arm: EndingArm;
  form_asked?: EndingForm;
  lead_in: boolean;
};

export function endingRecord(
  arm: EndingArm,
  form: EndingForm | undefined,
  s: Pick<Script, "pulse_take" | "loop_line">,
): EndingRecord {
  return {
    arm,
    ...(form ? { form_asked: form } : {}),
    lead_in: endingFormProblems(s).length > 0,
  };
}

/**
 * The forms given out in the last day (from the "ending_forms" events) and the one this episode already had, if a
 * retry (looked up with no time window, so a late retry keeps it too). Events, not saved scripts, so a Short still in
 * production counts.
 */
export async function recentEndingForms(
  db: import("../db.ts").Db,
  episodeId: string,
  now: Date,
): Promise<{ used: string[]; kept?: string }> {
  const rows = await db.query<{
    episode_id: string | null;
    form: string | null;
  }>(
    `SELECT episode_id, detail->>'form' AS form FROM events
      WHERE kind = 'ending_forms' AND detail->>'arm' = 'forms'
        AND created_at > $1::timestamptz - interval '24 hours'
      ORDER BY id DESC`,
    [now],
  );
  const own = await db.query<{ form: string | null }>(
    `SELECT detail->>'form' AS form FROM events
      WHERE kind = 'ending_forms' AND detail->>'arm' = 'forms' AND episode_id = $1
      ORDER BY id DESC LIMIT 1`,
    [episodeId],
  );
  const kept = own[0]?.form ?? undefined;
  const seen = new Set<string>();
  const used: string[] = [];
  for (const r of rows) {
    if (!r.form || r.episode_id === episodeId) continue;
    // One count per episode: a Short retried twice is still one Short.
    const key = r.episode_id ?? `${used.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    used.push(r.form);
  }
  return { used, ...(kept ? { kept } : {}) };
}
