// Buy, Wait or Skip (format plan, 11 Nov 2026, item 7): "before you spend, one clear answer on one game". One game,
// one price, one verdict, three times a week in the deals slot. The verdict is not the writer's: it comes from the
// data by a fixed rule (decideVerdict), so it can never be shaped by the affiliate link or by a model's mood. Prices
// are Steam's own (dollars first, pounds and euros beside on screen), scores are Steam's review share and the
// store's Metacritic figure, and "it has been cheaper" comes from CheapShark's price history. The writer only words
// it: what you get, the numbers, who should buy and who should pass, one "I" line on the verdict and the loop line.
// The script it makes is a plain Short (price card, score ring, a two-column card and the verdict stamp), so voice,
// render, QA and upload stay as they are.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import { voiceFor, voiceProblems } from "./voice.ts";
import type { Script } from "./schema.ts";
import { wordCount } from "./schema.ts";

export type Verdict = "BUY" | "WAIT" | "SKIP";

/** One game's facts, every figure read from a source the same hour. */
export interface VerdictData {
  appId: number;
  name: string;
  year?: number;
  /** Steam's US price now and before the cut ("$9.99"), and the cut in percent (0 when not on sale). */
  usd: { final: string; initial: string; pct: number };
  /** Steam's UK and German store prices as Steam formats them ("£7.49", "8,99€"). */
  gbp?: string;
  eur?: string;
  /** Steam's review share (percent positive) and how many reviews it rests on. */
  rating: number;
  reviews: number;
  /** The Metacritic score Steam's store page shows, when it shows one. */
  metacritic?: number;
  /** The lowest US price CheapShark has tracked for the game, any store ("$4.99"), and when. */
  lowest?: string;
  lowestDate?: string;
  /** When the prices were read. */
  checkedAt: string;
}

/** Dollars as a number (pure): "$9.99" is 9.99; anything else is NaN. */
export function dollars(price: string | undefined): number {
  const m = price?.replace(/,/g, "").match(/\$\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : Number.NaN;
}

/** Euro prices the English way (pure): "8,99€" reads "€8.99". */
export function euroPrice(v: string): string {
  const m = v.replace(/\s/g, "").match(/^([\d.,]+)€$/);
  return m ? `€${m[1]!.replace(/\.(?=\d{3})/g, "").replace(",", ".")}` : v;
}

/** True when today's US price is at (or within a cent of) the lowest tracked price. */
export function atLowest(d: Pick<VerdictData, "usd" | "lowest">): boolean {
  const now = dollars(d.usd.final);
  const low = dollars(d.lowest);
  return Number.isFinite(now) && Number.isFinite(low) && now <= low + 0.01;
}

/**
 * The verdict (pure), by one stated rule, so the same facts always give the same answer:
 * - SKIP when players are split: under 70% positive on Steam.
 * - BUY when players love it (80%+) and the price is a real one: half off or more, or the lowest ever tracked.
 *   A game players only like (70-79%) needs both: 75% off or more and the lowest ever.
 * - WAIT otherwise: a good game, but it has been cheaper, so the next sale is the better bet.
 */
export function decideVerdict(
  d: Pick<VerdictData, "usd" | "lowest" | "rating">,
): {
  verdict: Verdict;
  reason: string;
} {
  const low = atLowest(d);
  if (d.rating < 70)
    return {
      verdict: "SKIP",
      reason: `only ${d.rating}% of Steam reviews are positive, so players are split`,
    };
  if (d.rating >= 80 && (d.usd.pct >= 50 || low))
    return {
      verdict: "BUY",
      reason: low
        ? `${d.rating}% positive and ${d.usd.final} is the lowest price tracked`
        : `${d.rating}% positive and ${d.usd.pct}% off`,
    };
  if (d.rating >= 70 && d.usd.pct >= 75 && low)
    return {
      verdict: "BUY",
      reason: `${d.usd.pct}% off and the lowest price tracked outweigh mixed-positive reviews`,
    };
  return {
    verdict: "WAIT",
    reason: d.lowest
      ? `a good game, but it has been ${d.lowest} before`
      : `a good game, but ${d.usd.pct}% off is not a deep cut`,
  };
}

/** The stamp's words and colour by verdict. */
export const VERDICT_STAMP: Record<
  Verdict,
  { text: string; tone: "confirm" | "price" | "alert" }
> = {
  BUY: { text: "BUY IT", tone: "confirm" },
  WAIT: { text: "WAIT", tone: "price" },
  SKIP: { text: "SKIP IT", tone: "alert" },
};

/** The series title pattern (pure): "[Game] at [price]: buy, wait or skip?", under YouTube's 100 characters. */
export function verdictTitle(d: Pick<VerdictData, "name" | "usd">): string {
  const tail = ` at ${d.usd.final}: buy, wait or skip?`;
  const name = d.name.replace(/[®™©]/g, "").trim();
  const room = 90 - tail.length;
  const short =
    name.length > room ? `${name.slice(0, room - 1).trim()}…` : name;
  return `${short}${tail}`;
}

/** How the data reads to the writer and the fact check: every figure the Short may say, and where it came from. */
export function verdictBrief(
  d: VerdictData,
  verdict: Verdict,
  reason: string,
): string {
  const lines = [
    `Game: ${d.name}${d.year ? ` (released ${d.year})` : ""}`,
    `Steam US price now: ${d.usd.final}${d.usd.pct > 0 ? `, down from ${d.usd.initial} (${d.usd.pct}% off)` : " (not on sale)"}`,
    d.gbp || d.eur
      ? `Same game in the UK and EU stores (shown on screen, not spoken): ${[d.gbp, d.eur ? euroPrice(d.eur) : ""].filter(Boolean).join(", ")}`
      : "",
    `Steam reviews: ${d.rating}% positive from ${d.reviews.toLocaleString("en-US")} reviews`,
    typeof d.metacritic === "number"
      ? `Metacritic score on the Steam store page: ${d.metacritic}`
      : "",
    d.lowest
      ? `Lowest US price ever tracked by CheapShark, across stores: ${d.lowest}${d.lowestDate ? ` (${d.lowestDate})` : ""}`
      : "",
    `Prices read: ${d.checkedAt.slice(0, 16).replace("T", " ")} UTC. Prices change.`,
    `Our verdict, by the series' fixed rule: ${verdict} (${reason}).`,
  ];
  return lines.filter(Boolean).join("\n");
}

export const VerdictDraftSchema = z.object({
  hook: z
    .string()
    .describe(
      "First spoken line, 8-14 words: the game, its US price and the question, e.g. 'Hades is $9.99 right now. Buy it, wait, or skip it?'",
    ),
  what_you_get: z
    .string()
    .describe(
      "What the game is and what you get for the money, 1-2 sentences, 18-32 words, no figures that are not in the data",
    ),
  price_line: z
    .string()
    .describe(
      "The price beat, one sentence: the US price exactly as in the data with digits and the cut, or that it is not on sale",
    ),
  score_line: z
    .string()
    .describe(
      "The score beat, 1-2 sentences: the Steam review share and how many reviews, and the Metacritic score if the data has one",
    ),
  buy_if: z
    .string()
    .describe(
      "Who should buy: 3-7 words for the card, e.g. 'You love tight co-op runs'",
    ),
  pass_if: z
    .string()
    .describe(
      "Who should pass: 3-7 words for the card, e.g. 'You need a long story'",
    ),
  buy_pass_line: z
    .string()
    .describe(
      "Spoken: who should buy and who should pass, 1-2 sentences, 16-30 words",
    ),
  verdict_line: z
    .string()
    .describe(
      "The verdict in one or two sentences with exactly one 'I', saying the verdict word given (buy, wait or skip) and why, from the data",
    ),
  loop_line: z
    .string()
    .describe(
      "One complete closing sentence that ties back to the hook, at most 14 words",
    ),
  description: z
    .string()
    .describe(
      "YouTube description, 2-3 sentences, prices in US dollars as in the data. No hashtags",
    ),
  tags: z.array(z.string()).max(12),
});
export type VerdictDraft = z.infer<typeof VerdictDraftSchema>;

export function verdictPrompt(): string {
  return `You write for Pulse Gaming, a YouTube Shorts channel about video games.

${voiceFor("news")}

This is "Buy, Wait or Skip?": one game, one price, one straight answer before the viewer spends. About 45 seconds, 95-135 spoken words in total.
The verdict is already decided by the series' fixed rule and given in the data. You never change it, soften it or argue with it: you say it plainly, once, in verdict_line, with one "I" ("I'd buy it at this price", "I'd wait for the next sale", "I'd skip it"), and give the data's reason in your own words.
Every number comes from the data, exactly: the US price with digits ("$9.99", never "ten dollars"), the cut, the Steam review share and count (rounded is fine: "almost 120,000 reviews"), the Metacritic score if given and the lowest tracked price if given. Say prices in US dollars only; pounds and euros are on screen. Never invent a price, a discount, an end date, a player count or a score, and never say a sale ends soon. Prices change: never promise a price will last.
No affiliate talk and no "link in the description". No calls to like, subscribe or comment.`;
}

export async function writeVerdict(
  llm: Llm,
  brief: string,
  feedback: string[] = [],
): Promise<VerdictDraft> {
  const fb = feedback.length
    ? `\n\nA previous draft was rejected. Fix every one of these problems:\n${feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return llm.structured({
    site: "verdict.write",
    system: verdictPrompt(),
    content: `The data (use these and nothing else):\n${brief}${fb}`,
    schema: VerdictDraftSchema,
    effort: "medium",
  });
}

const VERDICT_WORDS: Record<Verdict, RegExp> = {
  BUY: /\bbuy(ing)?\b/i,
  WAIT: /\bwait(ing)?\b/i,
  SKIP: /\bskip(ping)?\b/i,
};

/** The spoken words, in order. */
export function narrationOfVerdict(v: VerdictDraft): string {
  return [
    v.hook,
    v.what_you_get,
    v.price_line,
    v.score_line,
    v.buy_pass_line,
    v.verdict_line,
    v.loop_line,
  ]
    .map((t) => t.trim())
    .join(" ");
}

/** House rules (pure): length, the verdict said once and right, one "I", and no figure the data does not hold. */
export function validateVerdict(
  v: VerdictDraft,
  d: VerdictData,
  verdict: Verdict,
): string[] {
  const p: string[] = [];
  const spoken = narrationOfVerdict(v);
  p.push(...voiceProblems(spoken));
  const words = wordCount(spoken);
  if (words < 95 || words > 135)
    p.push(`Spoken word count is ${words}; it must be 95-135.`);
  if (wordCount(v.hook) > 14) p.push("The hook is longer than 14 words.");
  if (!v.hook.includes(d.usd.final))
    p.push(
      `The hook must say the US price exactly as in the data (${d.usd.final}).`,
    );
  if (!v.price_line.includes(d.usd.final))
    p.push(
      `price_line must say the US price exactly as in the data (${d.usd.final}).`,
    );
  for (const [field, text] of [
    ["buy_if", v.buy_if],
    ["pass_if", v.pass_if],
  ] as const) {
    const n = wordCount(text);
    if (n < 2 || n > 7) p.push(`${field} must be 3-7 words for the card.`);
  }
  if (!VERDICT_WORDS[verdict].test(v.verdict_line))
    p.push(
      `verdict_line must say the verdict "${verdict.toLowerCase()}" plainly.`,
    );
  for (const other of Object.keys(VERDICT_WORDS) as Verdict[])
    if (other !== verdict && VERDICT_WORDS[other].test(v.verdict_line))
      p.push(
        `verdict_line says "${other.toLowerCase()}" but the verdict is ${verdict}; say only the verdict.`,
      );
  const eyes = (v.verdict_line.match(/\bI('d|'m|'ll)?\b/g) ?? []).length;
  if (eyes !== 1)
    p.push(
      `verdict_line must say "I" exactly once (it says it ${eyes} times).`,
    );
  const otherEyes = (
    [
      v.hook,
      v.what_you_get,
      v.price_line,
      v.score_line,
      v.buy_pass_line,
      v.loop_line,
    ]
      .join(" ")
      .match(/\bI('d|'m|'ll|'ve)?\b/g) ?? []
  ).length;
  if (otherEyes)
    p.push(`Say "I" only in the verdict line (found ${otherEyes} more).`);
  if (/[£€]/.test(spoken))
    p.push(
      "Say prices in US dollars only; pounds and euros are shown on screen.",
    );
  // Every dollar figure must be one of the data's.
  const known = new Set(
    [d.usd.final, d.usd.initial, d.lowest]
      .filter(Boolean)
      .map((x) => dollars(x).toFixed(2)),
  );
  for (const m of spoken.match(/\$\s*\d[\d,]*(?:\.\d+)?/g) ?? [])
    if (!known.has(dollars(m).toFixed(2)))
      p.push(
        `"${m.trim()}" is not a price in the data; use only ${[...known].map((x) => `$${x}`).join(", ")}.`,
      );
  const pcts = new Set([d.usd.pct, d.rating].map(String));
  for (const m of spoken.match(/\b(\d{1,3})\s?(%|percent)/gi) ?? []) {
    const n = m.match(/\d+/)![0];
    if (!pcts.has(n)) p.push(`"${m}" is not a figure in the data.`);
  }
  if (
    /\b(ends? (soon|tonight|tomorrow)|last chance|hurry|won't last)\b/i.test(
      spoken,
    )
  )
    p.push("Never say a sale ends soon or hurry the viewer.");
  if (/link in (the )?description|affiliate/i.test(spoken))
    p.push("No affiliate or link talk in the narration.");
  if (wordCount(v.loop_line) > 14)
    p.push("The loop line is longer than 14 words.");
  return p;
}

/** The exact word in the verdict line the stamp lands on (pure): "buy" in "I'd buy it", or the verdict itself. */
export function stampWord(line: string, verdict: Verdict): string {
  return line.match(VERDICT_WORDS[verdict])?.[0] ?? verdict.toLowerCase();
}

/** Short reviews count for a card ("118K"), never a made-up precision (pure). */
export function reviewsShort(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/**
 * The Short (pure): hook; what you get over the game's footage; the price card (dollars big, the old price, pounds
 * and euros beside); the score ring; the two-column buy/pass card; the verdict as the take with its stamp; the loop.
 * Every figure on screen is the data's, never the writer's.
 */
export function verdictToScript(
  d: VerdictData,
  v: VerdictDraft,
  verdict: Verdict,
): Script {
  const name = d.name.replace(/[®™©]/g, "").trim();
  const others = [d.gbp, d.eur ? euroPrice(d.eur) : undefined].filter(
    (x): x is string => Boolean(x),
  );
  const stamp = VERDICT_STAMP[verdict];
  const meta =
    typeof d.metacritic === "number" ? [`Metacritic ${d.metacritic}`] : [];
  return {
    story_type: "price",
    game_title: name,
    steam_search_term: name,
    headline: `${name} at ${d.usd.final}`,
    hook: v.hook,
    hook_footage: { want: "gameplay", keywords: [name] },
    beats: [
      {
        narration: v.what_you_get,
        footage: { want: "gameplay", keywords: [name] },
        visual: { kind: "none", primary: "", secondary: "" },
      },
      {
        narration: v.price_line,
        footage: { want: "world", keywords: [name] },
        visual: {
          kind: "price",
          primary: d.usd.final,
          secondary: d.usd.pct > 0 ? `${d.usd.pct}% off on Steam` : "on Steam",
          ...(d.usd.pct > 0 ? { was: d.usd.initial } : {}),
          region: "US",
          items: others,
        },
      },
      {
        narration: v.score_line,
        footage: { want: "gameplay", keywords: [name] },
        visual: {
          kind: "score",
          primary: `${d.rating}%`,
          secondary: `positive of ${reviewsShort(d.reviews)} Steam reviews`,
          value_a: d.rating,
          items: meta,
        },
      },
      {
        narration: v.buy_pass_line,
        footage: { want: "character", keywords: [name] },
        visual: {
          kind: "versus",
          primary: "WHO IT'S FOR",
          secondary: "",
          items: [`*Buy if:${v.buy_if.trim()}`, `Pass if:${v.pass_if.trim()}`],
        },
      },
    ],
    pulse_take: {
      label: "OUR VERDICT",
      narration: v.verdict_line,
      on_screen: `${stamp.text} AT ${d.usd.final}`,
    },
    loop_line: v.loop_line,
    stamp: {
      word: stampWord(v.verdict_line, verdict),
      text: stamp.text,
      sub: "OUR VERDICT",
      tone: stamp.tone,
    },
    is_rumour: false,
    attribution: d.lowest
      ? "Prices: Steam · Price history: CheapShark"
      : "Prices: Steam",
    youtube: {
      title: verdictTitle(d),
      description: v.description,
      tags: [
        ...new Set([name, "buy wait or skip", "steam sale", ...v.tags]),
      ].slice(0, 15),
    },
    evergreen_format: "buy_wait_skip",
    claims: [
      {
        claim: `${name} costs ${d.usd.final} on Steam in the US`,
        source_url: `https://store.steampowered.com/app/${d.appId}`,
      },
      {
        claim: `${d.rating}% of ${d.reviews} Steam reviews are positive`,
        source_url: `https://store.steampowered.com/app/${d.appId}`,
      },
      ...(d.lowest
        ? [
            {
              claim: `Lowest tracked price ${d.lowest}`,
              source_url: "https://www.cheapshark.com",
            },
          ]
        : []),
    ],
  };
}
