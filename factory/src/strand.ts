// The named daily Shorts strand (upgrade queue item 8; niche research, 11 Nov 2026, changes 1 and 5). Pulse earns
// 0.39 subscribers per 1,000 Shorts views, the going rate for a faceless multi-game channel; single-franchise
// channels that fill the frame with their own gameplay earn 1.2 to 1.6. On lukogta the top Shorts are how-tos and a
// verdict and the weakest are plain news recaps; Endycon's weakest are sales, revenue and pre-order facts.
//
// So one news slot a day (the plan's verdict slot, STRAND_SLOT, which must already be one of NEWS_SLOTS: no slot is
// added) becomes a strand with a name (STRAND_NAME) and a franchise (STRAND_FRANCHISE). Every Short in it is one
// test, how-to or "is it true" check about the franchise, framed as what the player can do or why the studio did it,
// never as an announcement. Player-facing stories rank first and company numbers last. When the gameplay inbox holds
// a clip of the franchise, the Short opens on the owner's own footage. Off until all three settings are set.

import type { Config } from "./config.ts";
import type { Script } from "./editorial/schema.ts";

export interface Strand {
  name: string;
  /** "HH:MM" local: one of the news slots. */
  slot: string;
  /** The franchise as said on screen: the first of STRAND_FRANCHISE's names. */
  franchise: string;
  /** Every name the franchise goes by, matched as whole words. */
  aliases: string[];
}

type StrandConfig = Pick<
  Config,
  "strandName" | "strandSlot" | "strandFranchise" | "newsSlots"
>;

const aliasesOf = (raw: string) =>
  raw
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean);

/** Why a strand that was asked for cannot run; undefined when it runs or was never asked for. */
export function strandProblem(cfg: StrandConfig): string | undefined {
  const asked = [cfg.strandName, cfg.strandSlot, cfg.strandFranchise].some(
    (v) => v.trim(),
  );
  if (!asked) return undefined;
  if (!cfg.strandName.trim()) return "STRAND_NAME is empty";
  if (!aliasesOf(cfg.strandFranchise).length)
    return "STRAND_FRANCHISE is empty";
  const slot = cfg.strandSlot.trim();
  if (!/^\d\d:\d\d$/.test(slot)) return `STRAND_SLOT "${slot}" is not HH:MM`;
  if (!cfg.newsSlots.includes(slot))
    return `STRAND_SLOT ${slot} is not one of NEWS_SLOTS (${cfg.newsSlots.join(",")}), and the strand never adds a slot`;
  return undefined;
}

/** The strand when its three settings are set and its slot is a news slot; otherwise undefined (off). */
export function strandFrom(cfg: StrandConfig): Strand | undefined {
  if (!cfg.strandName.trim() || strandProblem(cfg)) return undefined;
  const aliases = aliasesOf(cfg.strandFranchise);
  return {
    name: cfg.strandName.trim(),
    slot: cfg.strandSlot.trim(),
    franchise: aliases[0]!,
    aliases,
  };
}

/** One line for the start-up summary. */
export function strandSummary(cfg: StrandConfig): string {
  const s = strandFrom(cfg);
  if (s) return `"${s.name}" at ${s.slot} on ${s.franchise}`;
  const why = strandProblem(cfg);
  return why ? `off: ${why}` : "off";
}

/** Whether a news slot is the strand's: its local wall-clock time is STRAND_SLOT. */
export function isStrandSlot(
  strand: Pick<Strand, "slot">,
  slot: Date,
  timeZone: string,
): boolean {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(slot);
  return hhmm === strand.slot;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the text names the franchise by any of its names (whole words, any case, any spacing). */
export function aboutFranchise(
  strand: Pick<Strand, "aliases">,
  text: string,
): boolean {
  return strand.aliases.some((a) =>
    new RegExp(
      `(?<![a-z0-9])${a.split(/\s+/).map(escape).join("\\s*")}(?![a-z0-9])`,
      "i",
    ).test(text),
  );
}

/** A question a player asks, which a company number may still answer. */
const PLAYER_QUESTION =
  /\b(how (to|do|does|can)|can you|you can|is it true|true or false|does it|do you|should you|why (did|does|is|are|has|won't|can't))\b/i;
/** What the player can do, see or feel. */
const PLAYER =
  /\b(how to|can you|you can|you'll|is it true|true or false|checked|tested|tests?|myths?|feature|features|mechanics?|map|police|cops|wanted|cars?|vehicles?|weapons?|heists?|online|multiplayer|co-?op|performance|fps|frame ?rate|resolution|patch|update|bug|glitch|settings?|controls?|editions?|pre-?load|download|file size|install|accessibility|characters?|customi[sz]ation|missions?)\b/i;
/** The company's numbers: sales, forecasts, revenue. */
const CORPORATE =
  /\b(sales|sold|units|copies|revenue|earnings|forecasts?|guidance|fiscal|quarter(ly)?|investors?|shares?|stock price|market cap|analysts?|bookings|profits?|financial results|pre-?order (record|numbers|sales)|sensor tower|circana)\b/i;

export type StrandAngle = "player" | "neutral" | "corporate";

/** How a story sits in the strand: company numbers rank last unless they answer a player's question. */
export function strandAngle(text: string): StrandAngle {
  if (CORPORATE.test(text) && !PLAYER_QUESTION.test(text)) return "corporate";
  return PLAYER.test(text) ? "player" : "neutral";
}

const ANGLE_RANK: Record<StrandAngle, number> = {
  player: 0,
  neutral: 1,
  corporate: 2,
};

/**
 * The strand slot's candidates: the franchise's stories only, player-facing first, company numbers last, each group
 * in the order it came (best score first).
 */
export function rankForStrand<T>(
  strand: Pick<Strand, "aliases">,
  candidates: T[],
  text: (c: T) => string,
): T[] {
  return candidates
    .map((c, i) => ({ c, i, t: text(c) }))
    .filter((x) => aboutFranchise(strand, x.t))
    .sort(
      (a, b) =>
        ANGLE_RANK[strandAngle(a.t)] - ANGLE_RANK[strandAngle(b.t)] ||
        a.i - b.i,
    )
    .map((x) => x.c);
}

/** What the editor is told in the strand slot. */
export function strandEditorNote(
  strand: Pick<Strand, "name" | "franchise">,
): string {
  return `This is the "${strand.name}" slot, Pulse's daily ${strand.franchise} strand. Every candidate is a ${strand.franchise} story, listed with what a player can do or check first and sales, forecast and revenue stories last. Pick the one that makes the best test, how-to or "is it true" check for a player; take a company-numbers story only when nothing player-facing is worth a Short, and only for the player's question it answers.`;
}

/** The writer's brief for a strand Short, after the sources. */
export function strandBrief(o: {
  name: string;
  franchise: string;
  ownFootage: boolean;
  /** The 60-75 second lane for strand pieces on own footage (SHORT_LENGTHS strand=...). */
  longLane?: boolean;
}): string {
  return [
    `This Short belongs to "${o.name}", Pulse's daily ${o.franchise} strand. Every Short in it is recognizably the same thing: one test, one how-to or one "is it true" check about ${o.franchise}.`,
    `- Pick exactly one of the three and build the whole Short on it: a test (what happens when you try it), a how-to (the steps, in order) or an "is it true" check that ends on a plain verdict (true, false or not confirmed yet), with the sources named.`,
    `- Frame it as what the player can do, or why the studio did it. Never as an announcement: the hook never opens on who announced, revealed or unveiled something; it opens on the player's question, the thing you can do, or the claim being checked.`,
    `- Sales, forecasts, revenue and other company numbers only when they answer a player's question, never as the point of the Short.`,
    `- Mechanics only: no story events, characters' fates, missions by name or endings.`,
    o.ownFootage
      ? `- The Short opens on the owner's own gameplay of ${o.franchise}: the hook speaks to what a player is doing on screen, and the first beat says what that footage tests or shows. Never claim a result the sources do not give.`
      : "",
    o.longLane
      ? `- This one runs 60 to 75 seconds: walk the viewer through the steps or the evidence one at a time, one beat each, so every second is earned.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const ANNOUNCED =
  /\b(announc(e|es|ed|ing)|reveal(s|ed)|unveil(s|ed)|just dropped|is out now|officially)\b/i;

/** House rules for a strand Short: neither the hook nor the title reads as an announcement. */
export function strandProblems(
  script: Pick<Script, "hook"> & { youtube: Pick<Script["youtube"], "title"> },
): string[] {
  const out: string[] = [];
  const hook = script.hook.match(ANNOUNCED);
  if (hook)
    out.push(
      `The strand's hook reads as an announcement ("${hook[0]}"); open on what the player can do, the question being tested or the claim being checked.`,
    );
  const title = script.youtube.title.match(ANNOUNCED);
  if (title)
    out.push(
      `The strand's title reads as an announcement ("${title[0]}"); title it as the test, the how-to or the claim being checked.`,
    );
  return out;
}

/** A gameplay clip of the franchise, from the inbox files the library reads (src/assets/library.ts inboxFiles). */
export function strandClip<T extends { game: string }>(
  strand: Pick<Strand, "aliases">,
  files: T[],
): T | undefined {
  return files.find((f) => aboutFranchise(strand, f.game));
}

/**
 * The strand Short's clips with the owner's own clip opening it: that clip takes the hook (the planner opens on the
 * clip tagged for the hook), and a trailer moment picked for the hook goes back into the pool as an untagged clip.
 */
export function openOnOwnClip<T extends { role?: "hook"; beatIndex?: number }>(
  clips: T[],
  own: T,
): T[] {
  return [
    { ...own, role: "hook" as const, beatIndex: undefined },
    ...clips.map((c) => (c.role === "hook" ? { ...c, role: undefined } : c)),
  ];
}

/** The playlist every strand Short joins, named as the strand. */
export function strandSeries(s: Pick<Strand, "name" | "franchise">): {
  title: string;
  description: string;
} {
  return {
    title: s.name,
    description: `One ${s.franchise} test, how-to or "is it true" check a day, from Pulse Gaming.`,
  };
}
