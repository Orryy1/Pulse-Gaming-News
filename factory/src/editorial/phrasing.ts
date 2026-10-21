// House phrasing that must not turn into a tic. "Our read:" opened the opinion line in most
// Shorts and every pinned comment; viewers notice a stock phrase repeated across a channel.
// These helpers vary the frame by a stable seed (the same story always gets the same words).
import type { Script } from "./schema.ts";

const STOCK_OPENER = /^\s*our read\s*[:,-]?\s*/i;

/** Ways to introduce the channel's opinion in speech, each followed by the opinion itself. */
const SPOKEN = [
  "For us, ",
  "Honestly, ",
  "Here's our take: ",
  "The way we see it, ",
  "We think ",
];

/** Ways to introduce the opinion in a pinned comment, each followed by the on-screen take. */
const WRITTEN = [
  "Our take:",
  "Where we land:",
  "The short version:",
  "Bottom line:",
  "Our verdict:",
];

function pick<T>(list: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length]!;
}

/** A spoken opinion that opened with "Our read:" gets a different frame (lowercasing only a plain first word). */
export function varySpokenOpinion(text: string, seed: string): string {
  if (!STOCK_OPENER.test(text)) return text;
  const rest = text.replace(STOCK_OPENER, "");
  const lead = pick(SPOKEN, seed);
  const ends = lead.endsWith(": ");
  // "Bethesda has..." keeps its capital; "a slip this small..." / "This is..." read on naturally.
  const body =
    !ends && /^(This|That|It|The|A|An|We|Our|There|Nothing|No)\b/.test(rest)
      ? rest[0]!.toLowerCase() + rest.slice(1)
      : rest;
  return lead + body;
}

/** The pinned comment's frame for the take, varied by story. */
export function writtenOpinionLead(seed: string): string {
  return pick(WRITTEN, seed);
}

/** Applies the spoken variation to a script's take and anything else that opened with the stock phrase. */
export function varyOpinion(script: Script, seed: string): Script {
  return {
    ...script,
    pulse_take: {
      ...script.pulse_take,
      narration: varySpokenOpinion(script.pulse_take.narration, seed),
      on_screen: script.pulse_take.on_screen.replace(STOCK_OPENER, ""),
      ...(script.pulse_take.label &&
      /^our read$/i.test(script.pulse_take.label.trim())
        ? { label: "THE TAKEAWAY" }
        : {}),
    },
  };
}
