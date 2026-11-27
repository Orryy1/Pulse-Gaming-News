// The GTA File (format redesign plan, 11 Nov 2026, section 4.2 and build item 4): a numbered daily serial on GTA VI
// after launch, confirmed facts only, each part picking up from the last. "The one GTA VI thing worth knowing today,
// and what it means for you as a player." It runs in the second Why slot (SERIES_GTA_FILE_SLOT, 18:30 London), which
// must already be one of WHY_SLOTS, so no slot is added; each part comes from a planned run file
// (SERIES_GTA_FILE_RUN_FILE, read by src/shortrun.ts as "file" entries) and goes through the Why writer and the fact
// check like any planned Why. A day with no planned part goes back to the Why editor, so a missing part never makes
// an unchecked Short. Off until SERIES_GTA_FILE_ENABLED.
//
// It replaces the GTA VI strand (upgrade queue item 8, the claude/strand-lengths branch), which turned one news slot
// into a named daily franchise slot. One mechanism is kept, and the strand's code lives on here:
//   STRAND_NAME        -> the series name, fixed as "The GTA File" (GTA_FILE_NAME)
//   STRAND_SLOT        -> SERIES_GTA_FILE_SLOT, now one of WHY_SLOTS (the plan's 18:30) instead of NEWS_SLOTS
//   STRAND_FRANCHISE   -> the GTA VI names, fixed (GTA_FILE_ALIASES), matched by aboutFranchise as before
//   news picks ranked player-first -> parts planned by hand from confirmed facts (the plan: no leaks, no rumours)
//   strandBrief        -> gtaFileBrief: player framing, never an announcement, company numbers only for a player's
//                         question, mechanics only, opening on the owner's footage when the inbox has a GTA VI clip
//   strandProblems     -> gtaFileProblems: the same announcement guard, plus the part number in the hook
//   strand playlist    -> the GTA File playlist (gtaFileSeries)
//   SHORT_LENGTHS strand=... -> gta_file=... (src/shortlengths.ts; the old key still reads)

import type { Config } from "./config.ts";
import type { Script } from "./editorial/schema.ts";
import type { RunEntry, RunFile } from "./shortrun.ts";
import { localTime } from "./lanes.ts";

/** The series as it is said and shown. */
export const GTA_FILE_NAME = "The GTA File";
/** The game's names, the on-screen one first: whole words, any spacing (the strand's STRAND_FRANCHISE). */
export const GTA_FILE_ALIASES = ["GTA VI", "GTA 6", "Grand Theft Auto VI"];
/** The game's official title, for Steam, footage and the repeat guard. */
export const GTA_FILE_GAME = "Grand Theft Auto VI";
/** Three weeks of daily parts (the plan's run file of 21). */
export const GTA_FILE_PARTS = 21;

export interface GtaFile {
  name: string;
  /** "HH:MM" local: one of the Why slots. */
  slot: string;
  franchise: string;
  aliases: string[];
  runFile: string;
}

type GtaFileConfig = Pick<
  Config,
  | "seriesGtaFileEnabled"
  | "seriesGtaFileSlot"
  | "seriesGtaFileRunFile"
  | "whySlots"
  | "whyEnabled"
>;

/** Why The GTA File cannot run although it was switched on; undefined when it runs or is off. */
export function gtaFileProblem(cfg: GtaFileConfig): string | undefined {
  if (!cfg.seriesGtaFileEnabled) return undefined;
  const slot = cfg.seriesGtaFileSlot.trim();
  if (!/^\d\d:\d\d$/.test(slot))
    return `SERIES_GTA_FILE_SLOT "${slot}" is not HH:MM`;
  if (!cfg.whyEnabled)
    return "WHY_ENABLED is off, and the GTA File runs in a Why slot";
  if (!cfg.whySlots.includes(slot))
    return `SERIES_GTA_FILE_SLOT ${slot} is not one of WHY_SLOTS (${cfg.whySlots.join(",")}), and the GTA File never adds a slot`;
  if (!cfg.seriesGtaFileRunFile.trim())
    return "SERIES_GTA_FILE_RUN_FILE is empty";
  return undefined;
}

/** The GTA File when it is on and its slot is a Why slot; otherwise undefined (off). */
export function gtaFileFrom(cfg: GtaFileConfig): GtaFile | undefined {
  if (!cfg.seriesGtaFileEnabled || gtaFileProblem(cfg)) return undefined;
  return {
    name: GTA_FILE_NAME,
    slot: cfg.seriesGtaFileSlot.trim(),
    franchise: GTA_FILE_ALIASES[0]!,
    aliases: GTA_FILE_ALIASES,
    runFile: cfg.seriesGtaFileRunFile.trim(),
  };
}

/** One line for the start-up summary. */
export function gtaFileSummary(cfg: GtaFileConfig): string {
  const f = gtaFileFrom(cfg);
  if (f) return `"${f.name}" at ${f.slot} from ${f.runFile}`;
  const why = gtaFileProblem(cfg);
  return why ? `off: ${why}` : "off";
}

/** Whether a slot is the GTA File's: its local wall-clock time is the series slot. */
export function isGtaFileSlot(
  file: Pick<GtaFile, "slot">,
  slot: Date,
  timeZone: string,
): boolean {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(slot);
  return hhmm === file.slot;
}

/** The part planned for this slot: its date, and its own slot or else the series slot. */
export function gtaFileEntry(
  run: RunEntry[],
  due: Date,
  file: Pick<GtaFile, "slot">,
  timeZone: string,
): RunFile | undefined {
  return run.find(
    (e): e is RunFile =>
      e.kind === "file" &&
      localTime(e.date, e.slot ?? file.slot, timeZone).getTime() ===
        due.getTime(),
  );
}

/** What is wrong with a run file as a plan: run by the tests against the real file, and at selection. */
export function gtaFileRunProblems(run: RunEntry[]): string[] {
  const parts = run.filter((e): e is RunFile => e.kind === "file");
  const out: string[] = [];
  const seen = new Set<number>();
  for (const p of parts) {
    if (seen.has(p.part)) out.push(`Part ${p.part} is planned twice.`);
    seen.add(p.part);
    if (p.part > GTA_FILE_PARTS)
      out.push(`Part ${p.part} is past the ${GTA_FILE_PARTS}-part run.`);
    if (!p.sources.some((s) => s.official))
      out.push(
        `Part ${p.part} has no official source (Rockstar, Take-Two or a platform holder).`,
      );
    if (p.part > 1 && !p.recap.trim())
      out.push(`Part ${p.part} does not say what the last part established.`);
    for (const f of p.facts)
      if (
        /\b(leak|leaked|datamin|insider|rumou?r)/i.test(f) &&
        !/\breported\b/i.test(f)
      )
        out.push(
          `Part ${p.part} fact "${f}" reads as a leak or rumour; confirmed facts only, or label it reported.`,
        );
  }
  const sorted = [...parts].sort((a, b) => a.part - b.part);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i]!.date <= sorted[i - 1]!.date)
      out.push(
        `Part ${sorted[i]!.part} is not dated after part ${sorted[i - 1]!.part}.`,
      );
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the text names the franchise by any of its names (whole words, any case, any spacing). */
export function aboutFranchise(
  file: Pick<GtaFile, "aliases">,
  text: string,
): boolean {
  return file.aliases.some((a) =>
    new RegExp(
      `(?<![a-z0-9])${a.split(/\s+/).map(escape).join("\\s*")}(?![a-z0-9])`,
      "i",
    ).test(text),
  );
}

/** What the GTA File carries on the story: its part, what came before, and whether it opens on the owner's footage. */
export interface GtaFileStory {
  name: string;
  franchise: string;
  part: number;
  /** What the last part established, said in the 2-6 s callback. */
  recap: string;
  /** The last part's own words when it went out (its title and verdict), so the callback quotes what was said. */
  previous?: string;
  /** The confirmed facts this part stands on. */
  facts: string[];
  ownFootage: boolean;
}

/** The writer's brief for a part, after the Why brief. */
export function gtaFileBrief(
  o: GtaFileStory & { seconds?: { min: number; max: number } },
): string {
  const seconds = o.seconds
    ? `${o.seconds.min} to ${o.seconds.max}`
    : "45 to 55";
  return [
    `This Short is part ${o.part} of "${o.name}", Pulse's numbered daily serial on ${o.franchise} after launch: the one ${o.franchise} thing worth knowing today, and what it means for you as a player. It runs ${seconds} seconds.`,
    `- Confirmed facts only: the facts below and the sources. Anything a named person told a magazine is "said" with their name; anything only reported is labelled reported. No leaks, datamines or insider claims, ever.`,
    `Confirmed facts for this part:\n${o.facts.map((f) => `  - ${f}`).join("\n")}`,
    `- hook: open with "GTA File, part ${o.part}." and then the claim in a few words, game named. Never an announcement: never who announced, revealed or unveiled something.`,
    o.part > 1
      ? `- first beat (seconds 2 to 6): a one-line callback to part ${o.part - 1}: ${o.recap}${o.previous ? ` (it went out as: ${o.previous})` : ""}. Then pick up from there.`
      : `- This is the first part: no callback. The first beat sets up the file: what the next three weeks will check, one confirmed thing a day.`,
    `- then three proofs from the sources, each with a hard specific (a date, a price, a size, a named person), framed as what you can do, see or decide, or why Rockstar did it. Sales, prices and other company numbers only when they answer a player's question.`,
    `- then what it means for you, in plain words; then the verdict in one owned "I" line.`,
    `- loop_line: one open question for viewers about this part's claim, answerable in a word or two. Never a subscribe or follow ask.`,
    `- Mechanics, systems, prices and dates only: no story events, characters' fates, missions by name or endings.`,
    o.ownFootage
      ? `- The Short opens on the owner's own ${o.franchise} gameplay: the hook speaks to what a player is doing on screen. Never claim a result the sources do not give.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const ANNOUNCED =
  /\b(announc(e|es|ed|ing)|reveal(s|ed)|unveil(s|ed)|just dropped|is out now|officially)\b/i;

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "twenty-one",
];
const numberWord = (n: number) => WORDS[n] ?? String(n);

/** House rules for a part: no announcement hook or title (the strand's guard), and the part number spoken first. */
export function gtaFileProblems(
  script: Pick<Script, "hook"> & { youtube: Pick<Script["youtube"], "title"> },
  part?: number,
): string[] {
  const out: string[] = [];
  const hook = script.hook.match(ANNOUNCED);
  if (hook)
    out.push(
      `The GTA File's hook reads as an announcement ("${hook[0]}"); open on the claim and what it means for the player.`,
    );
  const title = script.youtube.title
    .replace(/^GTA VI File #\d+:\s*/i, "")
    .match(ANNOUNCED);
  if (title)
    out.push(
      `The GTA File's title reads as an announcement ("${title[0]}"); title it as the claim.`,
    );
  if (
    part !== undefined &&
    !new RegExp(
      `^\\W*(the\\s+)?gta\\s+(vi\\s+|6\\s+)?file,?\\s+part\\s+(${part}|${numberWord(part)})\\b`,
      "i",
    ).test(script.hook)
  )
    out.push(`The hook must open "GTA File, part ${part}." before the claim.`);
  return out;
}

/** The plan's title pattern, "GTA VI File #[n]: [claim]", whatever prefix the writer gave. */
export function gtaFileTitle(part: number, title: string): string {
  const claim = title
    .replace(
      /^\s*(the\s+)?gta\s*(vi|6)?\s*file\s*(#|part\s*)?\d*\s*[:,.-]?\s*/i,
      "",
    )
    .trim();
  const c = claim ? claim[0]!.toUpperCase() + claim.slice(1) : claim;
  return `GTA VI File #${part}: ${c}`;
}

/** A gameplay clip of the franchise, from the inbox files the library reads (src/assets/library.ts inboxFiles). */
export function franchiseClip<T extends { game: string }>(
  file: Pick<GtaFile, "aliases">,
  files: T[],
): T | undefined {
  return files.find((f) => aboutFranchise(file, f.game));
}

/**
 * The part's clips with the owner's own clip opening it: that clip takes the hook (the planner opens on the clip
 * tagged for the hook), and a trailer moment picked for the hook goes back into the pool as an untagged clip.
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

/** The playlist every part joins. */
export function gtaFileSeries(name: string = GTA_FILE_NAME): {
  title: string;
  description: string;
} {
  return {
    title: name,
    description:
      "One confirmed GTA VI thing a day after launch, and what it means for you. Numbered, in order, from Pulse Gaming.",
  };
}

/**
 * The serial a story belongs to, in the series tag's own values ("why", "gta_file"). The tag itself is the series
 * core's field (claude/series-core); this is for the tagger to read, so the two serials are told apart in one place.
 */
export function serialOf(story: {
  gtaFile?: unknown;
  why?: unknown;
}): "gta_file" | "why" | undefined {
  if (story.gtaFile) return "gta_file";
  if (story.why) return "why";
  return undefined;
}
