// What counts as one game, however fans write it (pure): the canonical key ("GTA VI", "gta6" and "Grand Theft Auto
// VI" are one), the series names that are not one game, and the aliases a gameplay upload's title may use for a game
// ("GTA SA", "GTA:SA", "San Andreas", "GTA 5", "GTAV", "RDR2"). Moved out of ./gamefetch.ts (which re-exports them)
// on 13 Nov 2026 so the footage title rules (src/assets/footagefirst.ts, src/assets/gameplay.ts) can share them
// without importing the scene-index job: 41 of 75 San Andreas gameplay uploads were refused as "title does not name
// this game" because a retrospective's series is its own game and only the full title was accepted.

/** Fans' short forms, written out: "GTA6" and "GTA 6" are "grand theft auto 6". */
const SHORT_FORMS: Record<string, string> = {
  gta: "grand theft auto",
  cod: "call of duty",
  rdr: "red dead redemption",
  tlou: "the last of us",
  ff: "final fantasy",
  mgs: "metal gear solid",
  totk: "the legend of zelda tears of the kingdom",
  botw: "the legend of zelda breath of the wild",
};

const ONES: Record<string, number> = {
  "": 0,
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
};

/** A Roman numeral's value, II to XXXIX; "I" and "X" alone stay words ("I Am Bread", "Mega Man X"). */
function romanNumber(w: string): number | undefined {
  if (!w || w === "i" || w === "x") return undefined;
  const m = /^(x{0,3})(ix|iv|v?i{0,3})$/.exec(w);
  if (!m) return undefined;
  const n = m[1]!.length * 10 + (ONES[m[2]!] ?? 0);
  return n >= 2 ? n : undefined;
}

/**
 * The key one game has however it is written (pure): case, accents, punctuation, a leading "The", the fans' short
 * forms and Roman numerals all set aside. "GTA VI", "GTA 6", "gta6", "Grand Theft Auto 6" and "Grand Theft Auto
 * VI" are all "grand theft auto 6"; "Grand Theft Auto: San Andreas" and "GTA San Andreas" are one key.
 */
export function canonicalGame(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => {
      const m = /^([a-z]+?)(\d+|[ivx]+)?$/.exec(w);
      const short = m ? SHORT_FORMS[m[1]!] : undefined;
      if (
        short &&
        (m![2] === undefined ||
          /^\d+$/.test(m![2]) ||
          romanNumber(m![2]) !== undefined)
      )
        return [...short.split(" "), ...(m![2] ? [m![2]] : [])];
      return [w];
    })
    .map((w) => {
      const n = romanNumber(w);
      return n === undefined ? w : String(n);
    });
  if (words[0] === "the" && words.length > 1) words.shift();
  return words.join(" ");
}

/**
 * Series and franchise names that are not one game: a story or a video "about GTA" names a series. Names that
 * are also one current game (Doom, Minecraft, Fortnite, Hades, Starfield, Hollow Knight) are not here.
 */
const SERIES_NAMES = [
  "GTA",
  "Grand Theft Auto",
  "Zelda",
  "The Legend of Zelda",
  "Mario",
  "Super Mario",
  "Pokemon",
  "God of War",
  "The Elder Scrolls",
  "Red Dead",
  "Fallout",
  "The Witcher",
  "Cyberpunk",
  "Resident Evil",
  "Final Fantasy",
  "Assassin's Creed",
  "Halo",
  "Gears of War",
  "Spider-Man",
  "Battlefield",
  "Mass Effect",
  "Monster Hunter",
  "Street Fighter",
  "Metal Gear",
  "Metal Gear Solid",
  "Silent Hill",
  "Horizon",
  "Diablo",
  "Warcraft",
  "Persona",
  "Kingdom Hearts",
  "Destiny",
  "Call of Duty",
  "Forza",
  "Borderlands",
  "Half-Life",
  "Star Wars",
  "Sonic",
  "Sonic the Hedgehog",
  "Metroid",
  "Kirby",
  "Donkey Kong",
  "Mortal Kombat",
  "Tekken",
  "Tomb Raider",
  "Far Cry",
  "Need for Speed",
  "The Sims",
  "Batman",
  "Dark Souls",
  "Uncharted",
  "Crash Bandicoot",
  "Dragon Quest",
  "Yakuza",
  "Like a Dragon",
];
const SERIES_KEYS = new Set(SERIES_NAMES.map(canonicalGame));

/** True when a name is a series rather than one game (pure): "GTA", "Fallout", "Zelda". */
export function isSeriesName(name: string): boolean {
  return SERIES_KEYS.has(canonicalGame(name));
}

/** The series a game's name starts with, as a canonical key (pure): "grand theft auto" for "GTA: San Andreas". */
export function seriesOf(game: string): string | undefined {
  const key = canonicalGame(game);
  let best: string | undefined;
  for (const s of SERIES_KEYS)
    if (key.startsWith(`${s} `) && (!best || s.length > best.length)) best = s;
  return best;
}

const initials = (words: string) =>
  words
    .split(" ")
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w[0]))
    .join("");

/**
 * The ways fans write one game, as canonical keys (pure): its own key ("grand theft auto 5" covers "GTA 5", "GTA V",
 * "GTAV"), its subtitle alone when it is distinctive ("san andreas", "vice city"; two words or more, or one long
 * word), and the subtitle's initials after the series ("grand theft auto sa" for "GTA SA" and "GTA:SA", "gtasa").
 * A series name itself ("Grand Theft Auto", the first game) has only its own key: every sequel's title names it too.
 */
export function gameAliases(game: string): string[] {
  const key = canonicalGame(game);
  if (!key) return [];
  const out = new Set([key]);
  const series = seriesOf(game);
  if (!series) return [...out];
  const rest = key.slice(series.length + 1).trim();
  const words = rest.split(" ").filter(Boolean);
  if (!words.length) return [...out];
  if (words.length >= 2 || (words[0]!.length >= 5 && !/^\d+$/.test(words[0]!))) out.add(rest);
  if (words.length >= 2) {
    const sub = initials(rest);
    out.add(`${series} ${sub}`);
    out.add(`${initials(series)}${sub}`);
  }
  return [...out];
}

/**
 * True when a title names the game by any of its aliases (pure). A series name never matches by this rule (the
 * first game needs its year: src/assets/footagefirst.ts namesGame), and another numbered entry is the caller's to
 * refuse ("GTA 5 San Andreas map" names "san andreas" but is GTA V).
 */
export function titleNamesGame(title: string, game: string): boolean {
  if (isSeriesName(game)) return false;
  const t = ` ${canonicalGame(title)} `;
  return gameAliases(game).some((a) => a.length >= 3 && t.includes(` ${a} `));
}

/**
 * True when a title names another numbered entry of the game's series (pure): "GTA 4 walkthrough San Andreas" for
 * San Andreas, "GTA 6" for GTA V. A game with no number of its own is entry one of its numbering.
 */
export function namesOtherEntry(title: string, game: string): boolean {
  const series = seriesOf(game);
  if (!series) return false;
  const own = /^\d+$/.test(canonicalGame(game).slice(series.length + 1)) ? canonicalGame(game).slice(series.length + 1) : "1";
  const words = canonicalGame(title).split(" ");
  const s = series.split(" ");
  for (let i = 0; i + s.length < words.length; i++)
    if (s.every((w, j) => words[i + j] === w) && /^\d+$/.test(words[i + s.length]!) && words[i + s.length] !== own) return true;
  return false;
}
