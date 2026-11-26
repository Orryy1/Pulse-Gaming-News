// The GTA guide's writer (GTA_GUIDES, src/gtaguide.ts): the plan in one call (the items in order, the intro that
// delivers item 1 in its first sentence, the outro, the thumbnail words and the packaging), then the items in batches
// of three, each with its narration, its labelled claims and its shot list (one moment per sentence, the long ranking's
// moment schema, so the render's per-sentence footage targets work unchanged). Every fact comes from the fact pack;
// the owner's play only from the play evidence. A plan that misses the list shape is sent back once with the problems
// named, as the ranking's writer does.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import { FootageSchema } from "./schema.ts";
import { voiceFor } from "./voice.ts";
import { REHOOK_RULE } from "./rehooks.ts";
import { MomentSchema, sentencesOf, type Moment } from "./longform.ts";
import { OPENING_WORDS_MAX } from "./longcontract.ts";
import {
  GTA_GAME,
  GUIDE_INTRO_WORDS,
  GUIDE_ITEM_WORDS,
  GUIDE_OUTRO_WORDS,
  GUIDE_WORDS,
  dropThinItems,
  scrubAll,
  type GuideDraft,
  type GuideItem,
  type GuideKind,
} from "../gtaguide.ts";

const LABEL = z.enum(["confirmed", "reported", "rumour"]);
const SOURCE = z.enum(["fact pack", "my playthrough"]);

export const GuidePlanSchema = z.object({
  intro: z.object({
    narration: z
      .string()
      .describe(
        "The opening. Its FIRST sentence is item 1 itself, said as advice or a fact (never a greeting, a premise or 'here are'); then one line promising the full list with the count, and that there are no story spoilers",
      ),
    on_screen: z.string().describe("3-8 word kicker under the title"),
  }),
  items: z
    .array(
      z.object({
        number: z.number().int().min(1),
        title: z
          .string()
          .describe(
            "The item as a 2-8 word on-screen line, an instruction or a fact: 'Don't swim in the swamps at night'",
          ),
        label: LABEL.describe(
          "confirmed: the fact pack's confirmed part or my own footage; reported: the fact pack's reported part; rumour: a rumour people repeat, said as one",
        ),
        basis: SOURCE.describe(
          "Where the item comes from: the fact pack, or what my own recordings show (only when the play evidence holds it)",
        ),
        chip: z.string().describe("1-4 words of punch for the card"),
        how: z
          .string()
          .describe(
            "Exactly what to do: the button or input, the menu or app screen, the place, or the steps ('Hold left on the d-pad, then Radio in the phone')",
          ),
        payoff: z
          .string()
          .describe(
            "What the player gets for it, concretely: money, time saved, a way out of trouble, an item or vehicle kept, an unlock ('You keep your music and the cops never hear you coming')",
          ),
        notes: z
          .string()
          .describe(
            "1-2 sentences of notes: what to say and which source line it rests on (not narration)",
          ),
      }),
    )
    .describe("Numbered 1..N in the order spoken; fewer real items beat a padded list"),
  outro: z.object({
    narration: z
      .string()
      .describe(
        "The ending: the two items that matter most in one line, and a last practical line; no request to comment or subscribe",
      ),
    on_screen: z.string().describe("3-8 word summary"),
  }),
  thumb_words: z
    .string()
    .describe(
      "2-3 huge words in capitals for the thumbnail: a warning drawn from one item ('DON'T SWIM') or the count ('16 THINGS'); optionally ' / ' and a 1-3 word second line ('NO SPOILERS')",
    ),
  description: z.string().describe("3-5 sentences, no hashtags, no timestamps"),
  tags: z.array(z.string()).max(15),
});
export type GuidePlan = z.infer<typeof GuidePlanSchema>;

const ItemBodySchema = z.object({
  number: z.number().int().min(1),
  narration: z.string(),
  footage: FootageSchema,
  claims: z
    .array(z.object({ claim: z.string(), label: LABEL, source: SOURCE }))
    .describe(
      "Every factual claim in this item, each with its label and source",
    ),
  moments: z
    .array(MomentSchema)
    .describe("Exactly one per sentence of this item's narration, in order"),
});
const BatchSchema = z.object({ items: z.array(ItemBodySchema) });

export interface GuideBrief {
  kind: GuideKind;
  /** The fact pack: the confirmed part and the reported part. */
  facts: { confirmed: string; reported: string };
  /** What the owner's own recordings show (src/gtaguide.ts playEvidence); empty: no first-hand lines at all. */
  evidence: string[];
  /** Viewers' questions to answer where the facts allow (never facts in themselves). */
  asks: string[];
  /** Rumours people repeat, from the stream asks list: only ever said as rumours. */
  rumours: string[];
}

export interface GuideWriterOptions {
  /** LONG_OPENING_CONTRACT or LONG_ARGUES on "fix": the opening's 90-word cap. */
  openingCap?: boolean;
  /** LONG_FACT_DISCIPLINE: no sourceless absolutes, firsts or card figures. */
  discipline?: boolean;
}

const FACT_RULE = `Facts: use ONLY the fact pack and the play evidence below. Never a leak, datamine, insider claim or a "fact" from memory. A line from the fact pack's Confirmed part is "confirmed"; from its Reported part it is "reported" and the narration says so ("reportedly", "according to GamesBeat"); a rumour from the viewers' list is "rumour" and is said as a rumour, never as fact. Every claim is listed in "claims" with its label and source.
My own play counts as a source ("in my playthrough", "on my stream", "I found"), but ONLY for what the play evidence lines show. Nothing else may be said first-hand: no invented tests, prices, timings or places. With no play evidence, never speak first-hand.
No story spoilers, at all: GTA VI's story is held until December 18. Nothing past the opening hours: no mission names past the start, no plot turns, no characters beyond Jason and Lucia, no endings. Systems, settings, the map, money, vehicles, the phone and the world are fine.`;

const DISCIPLINE_RULE = `Fact discipline: no absolute or superlative the facts don't state (never, always, only, every other, no other): say "rarely", "one of the few", "most". No "first" in the series unless the facts say so. A card shows only figures the item's narration says.`;

// The guide's own voice: the long ranking's ("the ranking rule", "the hardest call") made the 26 Nov proof say
// "I'm ranking everyday usefulness first" in a list that ranks nothing.
function housePrompt(): string {
  return `You write for Pulse Gaming News, a YouTube channel about video games.

${voiceFor("guide")}`;
}

/** The bar every item meets (owner, 26 Nov 2026: GameSight-style guides, not a list of scenery and trailer shots). */
export const ITEM_BAR = `The bar for every item, the one the best GTA guide channels set: a concrete, non-obvious mechanic, setting, trick or system that most players have not worked out, with exactly how or where to do it (how) and what the player gets for it (payoff). A viewer should be able to pause the video and do it.
Never an item that is:
- scenery or sightseeing: "Look for alligators", "Notice the art deco streets", "Look for a forest path", "Watch for tropical storms", "Take a jet ski ride";
- a console, controller or display feature: DualSense haptics, 3D audio, frame rate, PS5 performance (allowed only in the edition guide);
- a headline everyone saw in the trailers or previews (the radio hosts, the wildlife, the weather, Jason and Lucia, the beaches), unless the item is a specific mechanic about it with a real gain;
- a feeling for a payoff ("it's fun", "a change of scenery", "a nice touch").
If the sources hold fewer items that meet the bar, plan fewer (as few as the minimum): never pad the list. The title's count is set from the items you plan.`;

/** What a graphic must carry. */
const GRAPHIC_RULE = `A graphic only where it carries something the viewer can use: a figure the sentence says, a button or input, a place, a price, a requirement, a short list of things the sentence names, a two-row compare. Never the item's own number (the card already shows it), never where the footage came from ("Stream footage", "On my stream"), and a date only when the date itself matters (an update, a deadline, when something unlocks or ends). Most sentences have no graphic.`;

export function planPrompt(
  kind: GuideKind,
  opts: GuideWriterOptions = {},
): string {
  const introMax = opts.openingCap
    ? Math.min(OPENING_WORDS_MAX, GUIDE_INTRO_WORDS[1])
    : GUIDE_INTRO_WORDS[1];
  return `${housePrompt()}

You are planning a long GTA 6 guide list video, ${GUIDE_WORDS[0]}-${GUIDE_WORDS[1]} spoken words in total (twelve to twenty-five minutes), in the shape the biggest GTA 6 guide channels grew on ("Beginner's Guide: 25 Things I Wish I Knew (No Spoilers)", "GTA 6 Won't Let You Do These 20 GTA 5 Things", "Don't Buy the Wrong GTA 6 Edition").
This guide: ${kind.name}. ${kind.angle}
Structure:
1. intro.narration: ${GUIDE_INTRO_WORDS[0]}-${introMax} words. The FIRST sentence is item 1 itself, the most useful item, said as advice ("Never leave your car on the hard shoulder with the engine running.") so the viewer gets value in the first five seconds. Then one line that promises the complete list, with the count, and no story spoilers. No greeting, no channel name, no "welcome", no "in this video".
2. items: ${kind.items[0]}-${kind.items[1]}, numbered 1..N in the order spoken (the on-screen numbers count up the same way), the most useful first, then alternating big and small so the middle never sags. Each is one practical thing, not a category. Its title is the on-screen line (2-8 words), an instruction or a fact, never "Look for X". Each names how (what to do, where) and payoff (what you get).
${ITEM_BAR}
3. outro.narration: ${GUIDE_OUTRO_WORDS[0]}-${GUIDE_OUTRO_WORDS[1]} words: items 1 and 2 again as things to do, in one line, and a last practical line. It asks nothing of the viewer.
This is a guide, not a ranking: never say "ranking", "I'd put X ahead of Y", "the hardest call" or "the surprise is". The title is set from the item count; you write the thumbnail words, the description and the tags. No em dashes anywhere.
${FACT_RULE}${opts.discipline ? `\n${DISCIPLINE_RULE}` : ""}

This step plans only: the order, the item lines, labels, bases and notes, the intro, the outro and the packaging. The item narration is written next from your plan.`;
}

export function batchPrompt(opts: GuideWriterOptions = {}): string {
  return `${housePrompt()}

You are writing items of a long GTA 6 guide list video, from the plan you are given. Each item's narration is ${GUIDE_ITEM_WORDS[0]}-${GUIDE_ITEM_WORDS[1]} spoken words, five to twelve short sentences: it starts by saying the item's number (the plan's number, counting up from 1) and the thing in a fresh way (never open two items the same way; the earlier openings are listed), says exactly what to do and where (the plan's how), what the player gets for it (the plan's payoff), gives one concrete detail from the sources, and hands over to the next item in its last line. A guide, not a ranking: never compare an item's place in the list with another's. No em dashes. Speak to the viewer ("you"); "I" only for my own play, and only what the play evidence shows.
${REHOOK_RULE} In a guide that means about one in every second item, often the hand-over line.
footage names what the picture should show (the place, vehicle, menu-free moment of play) with 1-4 keywords.
moments: exactly one per sentence of the narration, in order. "show" names the precise in-game thing on screen while that sentence is spoken (never a menu, store page, logo or text screen); keywords 1-4 short search terms. ${GRAPHIC_RULE} Every figure in a graphic is in that sentence. "emphasis" lands a name or phrase from the sentence in about a third; empty when there is a graphic.
${FACT_RULE}${opts.discipline ? `\n${DISCIPLINE_RULE}` : ""}`;
}

/** The sources block every call reads. */
export function sourceBlock(b: GuideBrief): string {
  return [
    `FACT PACK, CONFIRMED (label "confirmed"):\n${b.facts.confirmed || "(none)"}`,
    `FACT PACK, REPORTED (label "reported", and say so aloud):\n${b.facts.reported || "(none)"}`,
    `PLAY EVIDENCE, what my own recordings show (the only first-hand source):\n${b.evidence.length ? b.evidence.map((x) => `- ${x}`).join("\n") : "(none this time: never speak first-hand)"}`,
    `RUMOURS people repeat (only ever "rumour", said as one):\n${b.rumours.length ? b.rumours.map((x) => `- ${x}`).join("\n") : "(none)"}`,
    `VIEWERS' QUESTIONS to answer where the sources allow (questions, not facts):\n${b.asks.length ? b.asks.map((x) => `- ${x}`).join("\n") : "(none)"}`,
  ].join("\n\n");
}

/** One moment per sentence: a short list is padded from the sentence, a long one cut (pure). */
export function fitMoments(narration: string, got: Moment[]): Moment[] {
  const s = sentencesOf(narration);
  const n = Math.max(1, s.length);
  return Array.from(
    { length: n },
    (_, i) =>
      got[i] ?? {
        show: `${GTA_GAME}: ${s[i] ?? ""}`.slice(0, 120),
        keywords: [GTA_GAME],
        graphic: { kind: "none", primary: "", secondary: "", items: [] },
        emphasis: "",
        person: "",
      },
  );
}

/** The batches the items are written in (pure). */
// Three items a call: five with their shot lists ran past Codex's 705 s limit on the 26 Nov proof.
export function batchesOf<T>(xs: T[], size = 3): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Writes the guide: the plan, then the items in batches (each batch sees how the earlier items opened). `feedback` is
 * the previous draft's problems, sent with every call of a rewrite. `planCheck` names the plan's own misses (the
 * first-line rule, the count) so they go back once before any item is paid for.
 */
export async function writeGtaGuide(
  llm: Llm,
  brief: GuideBrief,
  feedback: string[] = [],
  opts: GuideWriterOptions = {},
  planCheck?: (plan: GuidePlan) => string[],
): Promise<GuideDraft> {
  const fb = feedback.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  const sources = sourceBlock(brief);
  let plan = await llm.structured({
    site: "gtaguide.plan",
    system: planPrompt(brief.kind, opts),
    content: `${sources}${fb}`,
    schema: GuidePlanSchema,
    effort: "medium",
    maxTokens: 12000,
  });
  const misses = planCheck?.(plan) ?? [];
  if (misses.length)
    plan = await llm.structured({
      site: "gtaguide.plan",
      system: planPrompt(brief.kind, opts),
      content: `${sources}\n\nYour plan:\n${JSON.stringify(plan)}\n\nFix these problems and return the whole plan again:\n${misses.map((m) => `- ${m}`).join("\n")}`,
      schema: GuidePlanSchema,
      effort: "medium",
      maxTokens: 12000,
    });
  // Items still under the bar after the send-back are dropped (never below the kind's minimum): the count, and with it
  // the title and the intro's "these N", follow what is left.
  plan = dropThinItems(plan, brief.kind).plan;
  const items = plan.items.map((x, i) => ({ ...x, number: i + 1 }));
  // The whole video's floor holds with fewer items: each runs longer (7 items is about 190 words each).
  const introOutro =
    plan.intro.narration.split(/\s+/).length + plan.outro.narration.split(/\s+/).length;
  const perItem = Math.min(
    GUIDE_ITEM_WORDS[1] - 10,
    Math.max(110, Math.ceil((GUIDE_WORDS[0] + 100 - introOutro) / Math.max(1, items.length))),
  );
  const outline = items
    .map(
      (x) =>
        `${x.number}. ${x.title} [${x.label}, ${x.basis}]: how: ${x.how}; payoff: ${x.payoff}; ${x.notes}`,
    )
    .join("\n");
  const written: GuideItem[] = [];
  for (const batch of batchesOf(items)) {
    const before = written
      .map((w) => `${w.number}: "${sentencesOf(w.narration)[0] ?? ""}"`)
      .join("\n");
    const r = await llm.structured({
      site: "gtaguide.items",
      system: batchPrompt(opts),
      content: `${sources}\n\nThe intro (already written): ${plan.intro.narration}\n\nThe full list:\n${outline}\n\nWrite items ${batch.map((x) => x.number).join(", ")}, about ${perItem} spoken words each (there are ${items.length} items, so each needs its full how-to).${before ? `\n\nHow the earlier items opened (never repeat these openings):\n${before}` : ""}${fb}`,
      schema: BatchSchema,
      effort: "medium",
      maxTokens: 16000,
    });
    for (const x of batch) {
      const body =
        r.items.find((b) => b.number === x.number) ?? r.items[batch.indexOf(x)];
      const narration = body?.narration?.trim() ?? "";
      written.push({
        number: x.number,
        title: x.title.trim(),
        label: x.label,
        basis: x.basis,
        chip: x.chip.trim(),
        how: x.how.trim(),
        payoff: x.payoff.trim(),
        narration,
        footage: body?.footage ?? { want: "gameplay", keywords: [GTA_GAME] },
        claims: body?.claims ?? [],
        moments: fitMoments(narration, body?.moments ?? []),
      });
    }
  }
  // The channel never uses em dashes; the writer still slips them in (26 Nov proof's hook), so they go here.
  return scrubAll({
    kind: brief.kind.key,
    intro: plan.intro,
    items: written,
    outro: plan.outro,
    thumb_words: plan.thumb_words,
    description: plan.description,
    tags: plan.tags,
  });
}
