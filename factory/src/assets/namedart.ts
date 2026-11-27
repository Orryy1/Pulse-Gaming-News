// A picture of the character a ranking sentence names (LONG_NAMED_ART, 25 Nov 2026). On the Mass Effect ranking
// the writer named Garrus, Saren, Miranda, Jacob Taylor and Sara Ryder on 17 sentences and not one of them was on
// screen: the character mentions read only the publisher's own site (Rockstar's), and the wiki art library has no
// Mass Effect pictures because Fandom's picture server turns automated clients away (src/wikiart/wikis.ts). IGDB
// files characters with an official mug shot on its own image server, matched here by the exact name and only
// when IGDB lists the character in a game of this franchise: no picture rather than the wrong person.
// The choices are pure; the fetch is in src/assets/igdb.ts fetchIgdbCharacter.

/** A title or name as plain words (the same as src/assets/igdb.ts normTitle, kept here so the two never import each other). */
const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Words a keyword can start with that are not a name. */
const NOT_NAME =
  /^(the|a|an|his|her|their|your|its|first|final|last|new|old|top|open|main|side|loyalty|combat|story|boss|gameplay|trailer|mission|level|dlc|update|patch|pc|ps\d|xbox|switch|ios|android)$/i;

/**
 * Who a sentence names, best first (pure): the writer's `person`, then a keyword that reads as a person's name (two
 * or three capitalised words, none of them the game's or the series' own words, no digits). At most `max`.
 */
export function namedSubjects(
  moment: { person?: string; keywords?: string[] },
  gameTitle: string,
  max = 2,
): string[] {
  const own = new Set(normTitle(gameTitle).split(" "));
  const out: string[] = [];
  const add = (n: string) => {
    const t = n.trim();
    if (t && !out.some((o) => normTitle(o) === normTitle(t))) out.push(t);
  };
  if (moment.person?.trim()) add(moment.person);
  for (const k of moment.keywords ?? []) {
    const words = k.trim().split(/\s+/);
    if (words.length < 2 || words.length > 3) continue;
    if (!words.every((w) => /^[A-Z][a-z'’-]+$/.test(w))) continue;
    if (words.some((w) => NOT_NAME.test(w) || own.has(normTitle(w)))) continue;
    add(k);
  }
  return out.slice(0, max);
}

export interface IgdbCharacterRow {
  name: string;
  akas?: string[];
  mugShot?: string;
  games: string[];
}

/** The series a game belongs to, as IGDB titles it: its title before any colon or number ("Mass Effect"). */
export function seriesOf(gameTitle: string): string {
  return normTitle(gameTitle.split(":")[0]!)
    .replace(/\s+(\d+|[ivx]{1,4})$/, "")
    .trim();
}

/**
 * The IGDB character that is this person (pure): its name (or an alias) is the asked name, or the asked name's own
 * words in order ("Commander Shepard (male)" for "Commander Shepard"); it has a mug shot; and one of its games is of
 * this series. Undefined when none is sure.
 */
export function pickIgdbCharacter(
  rows: IgdbCharacterRow[],
  name: string,
  gameTitle: string,
): IgdbCharacterRow | undefined {
  const want = normTitle(name);
  const series = seriesOf(gameTitle);
  if (!want || !series) return undefined;
  const sameName = (n: string) => {
    const t = normTitle(n.replace(/\([^)]*\)/g, " "));
    return t === want;
  };
  return rows.find(
    (r) =>
      !!r.mugShot &&
      [r.name, ...(r.akas ?? [])].some(sameName) &&
      r.games.some((g) => {
        const n = normTitle(g);
        return n === series || n.startsWith(`${series} `);
      }),
  );
}
