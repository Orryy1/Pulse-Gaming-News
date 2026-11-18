// The alias dictionary for progressive naming (owner, 14 Nov 2026: the Civilization Short said "Sid Meier's" every
// single time; "a human would say the full name only the first time, then maybe shorten to Civ"). Each entity knows
// the written forms that refer to it, the short form people say once it has been named, an optional fan nickname,
// and which of those the audience knows cold (on first use, with no introduction). Curated entries cover the names
// the factory says most; IGDB alternative names can add more, but they are written-only until a person marks one
// as spoken (abbreviations like "BG3" are typed by fans, not said).
//
// Pure data and pure functions. British English in the comments; the narration itself stays American.

import { romanValue } from "../../voice/speakable.ts";

export type EntityKind = "game" | "series" | "company" | "person" | "hardware";

export interface Alias {
  text: string;
  /** Fans say it out loud (not only type it). Only spoken aliases ever reach the narration. */
  spoken: boolean;
  /** The audience knows it with no introduction, so it may stand in even on the first mention. */
  cold: boolean;
}

export interface Entity {
  id: string;
  kind: EntityKind;
  /** The full common name, as a first mention says it. */
  full: string;
  /** Every written form that refers to this entity (the full name is added automatically). */
  forms: string[];
  /** Written forms nobody says aloud: replaced by the full name on a first mention. */
  writtenOnly?: string[];
  /** The short form after the first mention. */
  short?: Alias;
  /** A fan nickname for later mentions, only where fans really use it. */
  nick?: Alias;
  /** The pronoun a later mention close by may use; undefined means never a pronoun. */
  pronoun?: "it" | "he" | "she" | "they";
  /** The series a numbered entry belongs to, for "Civ 2" once "Civilization" has been named. */
  series?: string;
  /** The entry's number in its series. */
  number?: number;
  /** A brand prefix that later mentions drop ("Sid Meier's", "Tom Clancy's", "Marvel's"). */
  prefix?: string;
}

const spoken = (text: string, cold = true): Alias => ({
  text,
  spoken: true,
  cold,
});

const ROMAN = [
  "",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
];

interface SeriesSpec {
  id: string;
  /** The series' names as written, longest first ("Sid Meier's Civilization", "Civilization"). */
  names: string[];
  /** The short people say for numbered entries ("Civ" gives "Civ 7"); empty keeps the full name with a figure. */
  short?: string;
  /** The short form is known cold ("GTA", "Civ"). */
  shortCold?: boolean;
  /** Written-only short forms, run together with the number ("GTA6", "FF7"). */
  joined?: string[];
  /** Highest numbered entry to generate. */
  upTo: number;
  prefix?: string;
  /** Numbers that never exist or are other things: skipped. */
  skip?: number[];
  /** The series' own short for its bare name ("Civ" for the series as a whole); omitted where the bare name is ambiguous. */
  bareShort?: Alias;
}

/** A series' numbered entries as entities, plus the series itself. */
function seriesEntities(spec: SeriesSpec): Entity[] {
  const out: Entity[] = [
    {
      id: spec.id,
      kind: "series",
      full: spec.names[spec.names.length - 1]!,
      forms: [...spec.names],
      ...(spec.bareShort ? { short: spec.bareShort } : {}),
      pronoun: "it",
      ...(spec.prefix ? { prefix: spec.prefix } : {}),
    },
  ];
  for (let n = 2; n <= spec.upTo; n++) {
    if (spec.skip?.includes(n)) continue;
    const r = ROMAN[n]!;
    const forms: string[] = [];
    for (const name of spec.names) forms.push(`${name} ${r}`, `${name} ${n}`);
    const shortText = spec.short
      ? `${spec.short} ${n}`
      : `${spec.names[spec.names.length - 1]} ${n}`;
    if (spec.short) forms.push(`${spec.short} ${r}`, `${spec.short} ${n}`);
    const writtenOnly = (spec.joined ?? []).flatMap((j) => [
      `${j}${n}`,
      `${j}${r}`,
    ]);
    out.push({
      id: `${spec.id}-${n}`,
      kind: "game",
      full: `${spec.names[spec.names.length - 1]} ${r}`,
      forms,
      writtenOnly,
      short: spoken(shortText, spec.shortCold ?? false),
      pronoun: "it",
      series: spec.id,
      number: n,
      ...(spec.prefix ? { prefix: spec.prefix } : {}),
    });
  }
  return out;
}

const game = (
  id: string,
  full: string,
  forms: string[],
  short?: Alias,
  extra: Partial<Entity> = {},
): Entity => ({
  id,
  kind: "game",
  full,
  forms,
  ...(short ? { short } : {}),
  pronoun: "it",
  ...extra,
});
const company = (
  id: string,
  full: string,
  forms: string[],
  short?: Alias,
  extra: Partial<Entity> = {},
): Entity => ({
  id,
  kind: "company",
  full,
  forms,
  ...(short ? { short } : {}),
  pronoun: "it",
  ...extra,
});
const person = (
  id: string,
  full: string,
  short: string,
  extra: Partial<Entity> = {},
): Entity => ({
  id,
  kind: "person",
  full,
  forms: [],
  // A surname is how the press writes a person after the first mention; it is said, and only after an introduction.
  short: spoken(short, false),
  ...extra,
});
const hardware = (
  id: string,
  full: string,
  forms: string[],
  short?: Alias,
  extra: Partial<Entity> = {},
): Entity => ({
  id,
  kind: "hardware",
  full,
  forms,
  ...(short ? { short } : {}),
  pronoun: "it",
  ...extra,
});

/**
 * The curated dictionary. A short form is only listed where fans and the press really say it; anything doubtful
 * keeps its full name. People get their surname (press style), game characters their first name (how players and
 * the press talk about Jason and Lucia).
 */
export const CURATED: Entity[] = [
  // Numbered series.
  ...seriesEntities({
    id: "civ",
    names: ["Sid Meier's Civilization", "Civilization"],
    short: "Civ",
    shortCold: true,
    upTo: 8,
    prefix: "Sid Meier's",
  }),
  ...seriesEntities({
    id: "gta",
    names: ["Grand Theft Auto"],
    short: "GTA",
    shortCold: true,
    joined: ["GTA"],
    upTo: 6,
  }),
  ...seriesEntities({
    id: "ff",
    names: ["Final Fantasy"],
    joined: ["FF"],
    upTo: 16,
  }),
  ...seriesEntities({
    id: "re",
    names: ["Resident Evil"],
    joined: ["RE"],
    upTo: 9,
  }),
  ...seriesEntities({
    id: "witcher",
    names: ["The Witcher"],
    short: "Witcher",
    shortCold: false,
    upTo: 4,
  }),
  ...seriesEntities({
    id: "elder-scrolls",
    names: ["The Elder Scrolls"],
    short: "Elder Scrolls",
    shortCold: false,
    upTo: 6,
    skip: [2, 3, 4, 5],
  }),
  ...seriesEntities({
    id: "bg",
    names: ["Baldur's Gate"],
    joined: ["BG"],
    upTo: 3,
  }),
  ...seriesEntities({
    id: "kcd",
    names: ["Kingdom Come: Deliverance"],
    short: "Kingdom Come",
    shortCold: false,
    joined: ["KCD"],
    upTo: 2,
  }),
  ...seriesEntities({
    id: "rdr",
    names: ["Red Dead Redemption"],
    short: "Red Dead",
    shortCold: true,
    joined: ["RDR"],
    upTo: 2,
  }),
  ...seriesEntities({
    id: "spiderman",
    names: ["Marvel's Spider-Man", "Spider-Man"],
    upTo: 2,
    prefix: "Marvel's",
  }),
  // Games with a subtitle people use on its own.
  game(
    "gta-sa",
    "Grand Theft Auto: San Andreas",
    ["Grand Theft Auto San Andreas", "GTA: San Andreas", "GTA San Andreas"],
    spoken("San Andreas", false),
  ),
  game(
    "gta-vc",
    "Grand Theft Auto: Vice City",
    ["Grand Theft Auto Vice City", "GTA: Vice City", "GTA Vice City"],
    // No short form: since GTA 6, "Vice City" on its own is the new game's city.
  ),
  game(
    "gta-online",
    "Grand Theft Auto Online",
    ["GTA Online"],
    spoken("GTA Online"),
  ),
  game(
    "totk",
    "The Legend of Zelda: Tears of the Kingdom",
    [
      "Legend of Zelda: Tears of the Kingdom",
      "Zelda: Tears of the Kingdom",
      "Tears of the Kingdom",
    ],
    spoken("Tears of the Kingdom", false),
    { writtenOnly: ["TotK", "TOTK"] },
  ),
  game(
    "botw",
    "The Legend of Zelda: Breath of the Wild",
    [
      "Legend of Zelda: Breath of the Wild",
      "Zelda: Breath of the Wild",
      "Breath of the Wild",
    ],
    spoken("Breath of the Wild", false),
    { writtenOnly: ["BotW", "BOTW"] },
  ),
  game(
    "oot",
    "The Legend of Zelda: Ocarina of Time",
    [
      "Legend of Zelda: Ocarina of Time",
      "Zelda: Ocarina of Time",
      "Ocarina of Time",
    ],
    spoken("Ocarina of Time", false),
    { nick: spoken("Ocarina", false), writtenOnly: ["OoT", "OOT"] },
  ),
  game(
    "skyrim",
    "The Elder Scrolls V: Skyrim",
    ["Elder Scrolls V: Skyrim", "Skyrim"],
    spoken("Skyrim"),
  ),
  game(
    "oblivion-rem",
    "The Elder Scrolls IV: Oblivion Remastered",
    ["Elder Scrolls IV: Oblivion Remastered", "Oblivion Remastered"],
    spoken("Oblivion Remastered", false),
  ),
  game("cyberpunk", "Cyberpunk 2077", [], spoken("Cyberpunk"), {
    writtenOnly: ["CP2077"],
  }),
  game(
    "silksong",
    "Hollow Knight: Silksong",
    ["Hollow Knight Silksong"],
    spoken("Silksong"),
  ),
  game(
    "mgs-delta",
    "Metal Gear Solid Delta: Snake Eater",
    ["Metal Gear Solid Delta"],
    spoken("Snake Eater", false),
  ),
  game("wolverine", "Marvel's Wolverine", ["Wolverine"], undefined, {
    prefix: "Marvel's",
  }),
  game(
    "gow-sparta",
    "God of War: Sons of Sparta",
    ["God of War Sons of Sparta"],
    spoken("Sons of Sparta", false),
  ),
  game(
    "gow-ragnarok",
    "God of War Ragnarök",
    ["God of War Ragnarok", "God of War: Ragnarök", "God of War: Ragnarok"],
    spoken("Ragnarök", false),
  ),
  game(
    "halo-ce",
    "Halo: Campaign Evolved",
    ["Halo Campaign Evolved"],
    spoken("Campaign Evolved", false),
  ),
  game(
    "gears-eday",
    "Gears of War: E-Day",
    ["Gears of War E-Day", "Gears: E-Day"],
    spoken("E-Day", false),
  ),
  game(
    "re-requiem",
    "Resident Evil Requiem",
    ["Resident Evil: Requiem"],
    spoken("Requiem", false),
  ),
  game(
    "r6-siege",
    "Rainbow Six Siege",
    ["Tom Clancy's Rainbow Six Siege", "Rainbow Six: Siege"],
    spoken("Siege", false),
    { prefix: "Tom Clancy's" },
  ),
  game(
    "r6-vegas",
    "Rainbow Six: Vegas",
    ["Tom Clancy's Rainbow Six: Vegas", "Rainbow Six Vegas"],
    spoken("Vegas", false),
    { prefix: "Tom Clancy's" },
  ),
  game(
    "nightreign",
    "Elden Ring Nightreign",
    ["Elden Ring: Nightreign"],
    spoken("Nightreign", false),
  ),
  game("mh-wilds", "Monster Hunter Wilds", [], spoken("Wilds", false)),
  game(
    "ds2",
    "Death Stranding 2: On the Beach",
    ["Death Stranding 2"],
    spoken("Death Stranding 2"),
  ),
  game(
    "sw-zero",
    "Star Wars Zero Company",
    ["Star Wars: Zero Company"],
    spoken("Zero Company", false),
  ),
  game(
    "doom-tda",
    "Doom: The Dark Ages",
    ["Doom The Dark Ages"],
    spoken("The Dark Ages", false),
  ),
  game("dk-bananza", "Donkey Kong Bananza", [], spoken("Bananza", false)),
  game(
    "pkmn-za",
    "Pokémon Legends: Z-A",
    ["Pokemon Legends: Z-A", "Pokémon Legends Z-A", "Pokemon Legends Z-A"],
    spoken("Legends Z-A", false),
  ),
  game(
    "ac-shadows",
    "Assassin's Creed Shadows",
    ["Assassin's Creed: Shadows"],
    spoken("AC Shadows"),
  ),
  game(
    "nier-automata",
    "NieR:Automata",
    ["NieR: Automata", "Nier: Automata", "Nier Automata"],
    spoken("Automata", false),
  ),
  game(
    "pop-sot",
    "Prince of Persia: The Sands of Time",
    ["Prince of Persia The Sands of Time"],
    spoken("Sands of Time", false),
  ),
  // Companies.
  company(
    "take-two",
    "Take-Two Interactive",
    ["Take-Two Interactive Software"],
    spoken("Take-Two"),
  ),
  // Rockstar North is its own studio, never shortened to "Rockstar".
  company("rockstar", "Rockstar Games", [], spoken("Rockstar")),
  company("ea", "Electronic Arts", [], spoken("EA")),
  company("sie", "Sony Interactive Entertainment", [], spoken("Sony")),
  company("noa", "Nintendo of America", [], spoken("Nintendo")),
  company("ubisoft", "Ubisoft Entertainment", [], spoken("Ubisoft")),
  company("bandai", "Bandai Namco Entertainment", [], spoken("Bandai Namco")),
  company("square", "Square Enix Holdings", [], spoken("Square Enix")),
  company("cdpr", "CD Projekt Red", ["CD Projekt RED"], spoken("CD Projekt")),
  company(
    "bgs",
    "Bethesda Game Studios",
    ["Bethesda Softworks"],
    spoken("Bethesda"),
  ),
  company("valve", "Valve Corporation", [], spoken("Valve")),
  company("epic", "Epic Games", [], spoken("Epic")),
  company("insomniac", "Insomniac Games", [], spoken("Insomniac")),
  company("smm", "Santa Monica Studio", [], spoken("Santa Monica", false)),
  company("firaxis", "Firaxis Games", [], spoken("Firaxis")),
  company("blizzard", "Blizzard Entertainment", [], spoken("Blizzard")),
  company("riot", "Riot Games", [], spoken("Riot")),
  company("respawn", "Respawn Entertainment", [], spoken("Respawn")),
  company("remedy", "Remedy Entertainment", [], spoken("Remedy")),
  company("larian", "Larian Studios", [], spoken("Larian")),
  company("obsidian", "Obsidian Entertainment", [], spoken("Obsidian")),
  company("guerrilla", "Guerrilla Games", [], spoken("Guerrilla")),
  company(
    "sucker-punch",
    "Sucker Punch Productions",
    [],
    spoken("Sucker Punch"),
  ),
  company("embracer", "Embracer Group", [], spoken("Embracer")),
  company("krafton", "Krafton Inc.", [], spoken("Krafton")),
  company("wb-games", "Warner Bros. Games", [], spoken("Warner Bros.")),
  company("nvidia", "Nvidia Corporation", [], spoken("Nvidia")),
  company("fromsoft", "FromSoftware", [], undefined, {
    nick: spoken("FromSoft"),
  }),
  // Hardware.
  hardware("ps5", "PlayStation 5", [], spoken("PS5")),
  hardware("ps5-pro", "PlayStation 5 Pro", [], spoken("PS5 Pro")),
  hardware("ps4", "PlayStation 4", [], spoken("PS4")),
  hardware("switch2", "Nintendo Switch 2", [], spoken("Switch 2")),
  hardware("switch", "Nintendo Switch", [], spoken("Switch")),
  hardware(
    "xsx",
    "Xbox Series X|S",
    ["Xbox Series X and S", "Xbox Series X/S"],
    spoken("Xbox"),
  ),
  // People: surname after the first mention, as the press writes them.
  person("kojima", "Hideo Kojima", "Kojima"),
  person("spencer", "Phil Spencer", "Spencer"),
  person("zelnick", "Strauss Zelnick", "Zelnick"),
  person("howard", "Todd Howard", "Howard"),
  person("druckmann", "Neil Druckmann", "Druckmann"),
  person("hulst", "Hermen Hulst", "Hulst"),
  person("yoshida", "Shuhei Yoshida", "Yoshida"),
  person("miyamoto", "Shigeru Miyamoto", "Miyamoto"),
  person("miyazaki", "Hidetaka Miyazaki", "Miyazaki"),
  person("sakurai", "Masahiro Sakurai", "Sakurai"),
  person("barlog", "Cory Barlog", "Barlog"),
  person("keighley", "Geoff Keighley", "Keighley"),
  person("schreier", "Jason Schreier", "Schreier"),
  person("henderson", "Tom Henderson", "Henderson"),
  person("bowser", "Doug Bowser", "Bowser"),
  person("vermeij", "Obbe Vermeij", "Vermeij"),
  person("benzies", "Leslie Benzies", "Benzies"),
  // Game characters go by their first name.
  person("jason-duval", "Jason Duval", "Jason"),
  person("lucia-caminos", "Lucia Caminos", "Lucia"),
];

/**
 * An IGDB alternative name as an alias of `full` (pure), or undefined when it should never be used: a translation, a
 * working title or anything that isn't plainly the same name. Initials ("TotK") are written-only; a part of the name
 * people can say on its own ("Tears of the Kingdom") is a spoken short form, never known cold.
 */
export function aliasFromAlternativeName(
  full: string,
  alt: string,
): { kind: "short" | "written"; text: string } | undefined {
  const a = alt.trim();
  if (!a || a === full) return undefined;
  // Non-Latin script or accented translations, and anything in brackets ("(working title)"), are not aliases.
  if (/[^\u0000-ɏ]/.test(a) || /[()[\]]/.test(a)) return undefined;
  const words = full
    .replace(/[:–—-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const initials = words
    .filter((w) => !/^(of|the|and|a|an)$/i.test(w))
    .map((w) =>
      /^\d+$/.test(w)
        ? w
        : romanValue(w) !== undefined
          ? String(romanValue(w))
          : w[0]!.toUpperCase(),
    )
    .join("");
  const flat = a.replace(/\s+/g, "");
  if (
    /^[A-Za-z0-9]{2,8}$/.test(flat) &&
    flat.toUpperCase() === initials.toUpperCase()
  )
    return { kind: "written", text: a };
  // A run of the full name's own words, at least two of them, is a short form people say.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const nf = ` ${norm(full)} `;
  const na = norm(a);
  if (na.split(" ").length >= 2 && nf.includes(` ${na} `))
    return { kind: "short", text: a };
  return undefined;
}

/** Entities built from IGDB alternative names for one game (pure): written-only forms and, at most, one short form. */
export function entityFromIgdb(
  id: string,
  full: string,
  alternatives: string[],
): Entity | undefined {
  const written: string[] = [];
  let short: Alias | undefined;
  for (const alt of alternatives) {
    const a = aliasFromAlternativeName(full, alt);
    if (!a) continue;
    if (a.kind === "written") written.push(a.text);
    else if (!short) short = { text: a.text, spoken: true, cold: false };
  }
  if (!written.length && !short) return undefined;
  return game(
    id,
    full,
    [],
    short,
    written.length ? { writtenOnly: written } : {},
  );
}

/** The dictionary for one script: curated entries plus any extras the caller has (IGDB), extras never overriding. */
export function dictionary(extra: Entity[] = []): Entity[] {
  const ids = new Set(CURATED.map((e) => e.id));
  const fulls = new Set(CURATED.map((e) => e.full.toLowerCase()));
  return [
    ...CURATED,
    ...extra.filter((e) => !ids.has(e.id) && !fulls.has(e.full.toLowerCase())),
  ];
}

/** Every alias word a dictionary can introduce, lower case, so the fact guard knows "Civ" is not a new name. */
export function aliasWords(entities: Entity[]): Set<string> {
  const out = new Set<string>();
  for (const e of entities)
    for (const a of [e.short, e.nick])
      if (a)
        for (const w of a.text.split(/\s+/))
          out.add(w.toLowerCase().replace(/[^a-z0-9'-]/g, ""));
  return out;
}
