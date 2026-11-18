// Credits the writer was never given (CREDIT_SCRUB, default on). The fact check drops a Short whose narration credits
// an outlet or document that is not among its sources ("GameSpot's 2021 coverage says...", "Bethesda's update notes
// say...", "GameSpot's review said..."): on 12-14 Nov 2026 that was most of the fact-check failures. Two fixes:
//   - CREDIT_RULE goes to every Short writer, not only when the Fact Vault had facts for the game (the rule lived in the
//     vault's brief, and a game the vault knew nothing about got no rule at all);
//   - scrubCredits takes such a credit off before the fact check runs: the fact stays, the invented credit goes.

/** The writer's rule, word for word as the Fact Vault's brief carries it (src/factvault/vault.ts). */
export const CREDIT_RULE = `Credit rule: name only sources you were actually given (the facts above and the story's own sources). Never credit a guide, walkthrough, manual, wiki, panel, update notes or an outlet you were not given; say the fact plainly instead. In our fact checks, invented credits like these are a common reason a video is dropped.`;

export function creditScrubOn(): boolean {
  return process.env.CREDIT_SCRUB !== "off";
}

/** Outlets a writer reaches for from memory. A credit to one is kept only when it is among the story's sources. */
export const OUTLETS = [
  "IGN",
  "GameSpot",
  "Eurogamer",
  "Kotaku",
  "Polygon",
  "PC Gamer",
  "Digital Foundry",
  "The Verge",
  "Verge",
  "Bloomberg",
  "VGC",
  "Video Games Chronicle",
  "GamesRadar",
  "GamesRadar+",
  "Edge",
  "Famitsu",
  "Game Informer",
  "Insider Gaming",
  "Push Square",
  "Nintendo Life",
  "Pure Xbox",
  "Rock Paper Shotgun",
  "Destructoid",
  "Metacritic",
  "OpenCritic",
  "Gamesindustry.biz",
  "GamesIndustry.biz",
  "Variety",
  "Forbes",
  "The Guardian",
  "Guardian",
  "Reuters",
  "Axios",
  "Wired",
  "Ars Technica",
  "USA Today",
  "Windows Central",
  "Gematsu",
  "Siliconera",
  "VentureBeat",
  "Game Rant",
  "Screen Rant",
  "TheGamer",
  "Dexerto",
  "Gamesradar",
  "Electronic Gaming Monthly",
  "EGM",
  "Official PlayStation Magazine",
  "Official Xbox Magazine",
  "Nintendo Power",
];

/** The documents a credit names ("X's update notes", "X's 2021 coverage"). */
const DOC =
  "(?:review|reviews|coverage|report|reporting|article|preview|interview|feature|piece|retrospective|update notes|patch notes|release notes|notes|guide|walkthrough|manual|wiki|panel|documentary|video|investigation|analysis|breakdown|post|blog post|blog|write-up|story)";
const SAY =
  "(?:said|says|say|notes|noted|note|reported|reports|wrote|writes|put it|puts it|called it|calls it|claims|claimed|found|finds|revealed|reveals|confirmed|confirms|explained|explains|described|describes|added|adds|states|stated|argued|argues|pointed out|points out)";
const NAME = "[A-Z][\\w.+&]*(?:[ -](?:[A-Z][\\w.+&]*|of|the))*";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** True when `name` is one of the sources the writer was given (pure). */
export function creditAllowed(name: string, allowed: string[]): boolean {
  const n = norm(name.replace(/^the\s+/i, ""));
  if (!n) return true;
  return allowed.some((a) => {
    const m = norm(a.replace(/^the\s+/i, ""));
    return m.length > 1 && (m.includes(n) || (n.length > 3 && n.includes(m)));
  });
}

const isOutlet = (name: string) =>
  OUTLETS.some((o) => norm(o) === norm(name.replace(/^the\s+/i, "")));

const capitalise = (t: string) =>
  t.replace(
    /(^|[.!?]["”’]?\s+)([a-z])/g,
    (_, a: string, b: string) => `${a}${b.toUpperCase()}`,
  );

export interface Scrubbed {
  text: string;
  removed: string[];
}

/**
 * Takes off every credit to an outlet or document the writer was not given (pure). "GameSpot's 2021 coverage of the
 * documentary says executives doubted..." becomes "Executives doubted..."; "According to IGN, X" becomes "X";
 * "Bethesda's update notes say the patch..." becomes "The patch...". A credit to a given source stays as it is.
 * `allowed` is the story's own sources (their outlet names) and the Fact Vault's brief.
 */
export function scrubCredits(text: string, allowed: string[]): Scrubbed {
  const removed: string[] = [];
  let t = text;
  // "X's [up to 8 words] DOC [of/on/about ...] says (that)": any named owner of a document.
  const docCredit = new RegExp(
    `(^|[.!?]["”’]?\\s+|,\\s*|\\b(?:and|but|so)\\s+)(?:[Aa]s\\s+)?(${NAME})['’]s\\s+((?:[\\w-]+\\s+){0,8}?${DOC})(?:\\s+(?:of|on|about|for)\\s+[^,.;!?]{1,70}?)?\\s+${SAY}(?:\\s+that)?,?\\s+`,
    "g",
  );
  t = t.replace(docCredit, (all, lead: string, name: string) => {
    if (creditAllowed(name, allowed)) return all;
    removed.push(all.trim());
    return lead;
  });
  // "According to X('s DOC)," at a sentence's start, or ", according to X" inside it.
  t = t.replace(
    new RegExp(
      `(^|[.!?]["”’]?\\s+)[Aa]ccording to (${NAME})(?:['’]s\\s+(?:[\\w-]+\\s+){0,6}?${DOC})?,?\\s+`,
      "g",
    ),
    (all, lead: string, name: string) => {
      if (!isOutlet(name) && !/['’]s\s/.test(all)) return all;
      if (creditAllowed(name, allowed)) return all;
      removed.push(all.trim());
      return lead;
    },
  );
  t = t.replace(
    new RegExp(
      `,?\\s+according to (${NAME})(?:['’]s\\s+(?:[\\w-]+\\s+){0,6}?${DOC})?(?=[,.;!?])`,
      "g",
    ),
    (all, name: string) => {
      if (!isOutlet(name) && !/['’]s\s/.test(all)) return all;
      if (creditAllowed(name, allowed)) return all;
      removed.push(all.trim());
      return "";
    },
  );
  // "IGN reported that X" / "As Kotaku noted, X": outlets only (a studio saying something is its own news).
  t = t.replace(
    new RegExp(
      `(^|[.!?]["”’]?\\s+)(?:[Aa]s\\s+)?(${NAME})\\s+${SAY}(?:\\s+that)?,?\\s+`,
      "g",
    ),
    (all, lead: string, name: string) => {
      if (!isOutlet(name) || creditAllowed(name, allowed)) return all;
      removed.push(all.trim());
      return lead;
    },
  );
  // ", in IGN's review," / "in GameSpot's 2021 coverage": the aside goes.
  t = t.replace(
    new RegExp(
      `,?\\s+in (${NAME})['’]s\\s+(?:[\\w-]+\\s+){0,5}?${DOC}(?=[,.;!?])`,
      "g",
    ),
    (all, name: string) => {
      if (creditAllowed(name, allowed)) return all;
      removed.push(all.trim());
      return "";
    },
  );
  if (!removed.length) return { text, removed };
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.;!?])/g, "$1");
  return { text: capitalise(t.trim()), removed };
}

/** The names a Short's writer was given: its sources' outlets and the Fact Vault's brief (pure). */
export function givenSources(o: {
  outlets: Array<string | undefined>;
  vault?: string;
  extra?: string[];
}): string[] {
  return [
    ...o.outlets.filter((x): x is string => !!x),
    ...(o.extra ?? []),
    ...(o.vault ? [o.vault] : []),
  ];
}

/** Every spoken line of a Short scrubbed; returns the new script and what was taken off. */
export function scrubScriptCredits<
  S extends {
    hook: string;
    beats: Array<{ narration: string }>;
    pulse_take: { narration: string };
    loop_line: string;
  },
>(script: S, allowed: string[]): { script: S; removed: string[] } {
  const removed: string[] = [];
  const fix = (t: string) => {
    const r = scrubCredits(t, allowed);
    removed.push(...r.removed);
    return r.text;
  };
  const out = {
    ...script,
    hook: fix(script.hook),
    beats: script.beats.map((b) => ({ ...b, narration: fix(b.narration) })),
    pulse_take: {
      ...script.pulse_take,
      narration: fix(script.pulse_take.narration),
    },
    loop_line: fix(script.loop_line),
  };
  return removed.length ? { script: out, removed } : { script, removed };
}
