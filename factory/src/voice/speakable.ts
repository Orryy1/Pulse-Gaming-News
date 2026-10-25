// Narration says what the screen shows. Prices are written out in words
// before the script is voiced ("$69.99" becomes "sixty-nine dollars
// ninety-nine"), so the voice never guesses the currency, and the captions,
// which come from the same text, read the same. Cards keep the figures.

const ONES = [
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
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) {
    const words =
      r < 20
        ? ONES[r]!
        : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ""}`;
    parts.push(words);
  }
  return parts.join(" ");
}

/** Whole numbers in words, American style ("one hundred five"), up to the trillions. */
export function numberWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  n = Math.floor(n);
  if (n === 0) return "zero";
  const scales: Array<[number, string]> = [
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of scales) {
    if (rest >= size) {
      parts.push(`${under1000(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest) parts.push(under1000(rest));
  return parts.join(" ");
}

const NAMES: Record<string, [string, string, string]> = {
  // symbol: [singular, plural, minor unit plural]
  $: ["dollar", "dollars", "cents"],
  "£": ["pound", "pounds", "pence"],
  "€": ["euro", "euros", "cents"],
  "¥": ["yen", "yen", ""],
};

const SCALE_WORDS: Record<string, string> = {
  k: "thousand",
  m: "million",
  mn: "million",
  million: "million",
  b: "billion",
  bn: "billion",
  billion: "billion",
};

function moneyWords(
  symbol: string,
  whole: string,
  minor: string | undefined,
  scale: string | undefined,
): string {
  const [one, many] = NAMES[symbol] ?? ["", "", ""];
  const n = Number(whole.replace(/,/g, ""));
  const s = scale ? SCALE_WORDS[scale.toLowerCase()] : undefined;
  if (s) {
    // "$1.5 billion" reads "one point five billion dollars".
    const decimal = minor
      ? ` point ${minor
          .replace(/0+$/, "")
          .split("")
          .map((d) => ONES[Number(d)])
          .join(" ")}`
      : "";
    return `${numberWords(n)}${decimal} ${s} ${many}`
      .replace(/\s+/g, " ")
      .trim();
  }
  const unit = n === 1 ? one : many; // "one dollar nineteen", not "one dollars nineteen"
  const cents =
    minor && Number(minor) > 0
      ? ` ${numberWords(Number(minor.padEnd(2, "0")))}`
      : "";
  return `${numberWords(n)} ${unit}${cents}`;
}

/** Writes prices out in words: "$69.99" "£59.99" "€79.99" "69,99€" "$1.5bn" "$70". */
const ROMAN_VALUE: Record<string, number> = { I: 1, V: 5, X: 10 };

/** "XIV" as 14, or undefined when it is not a well-formed numeral from 2 to 39. */
export function romanValue(t: string): number | undefined {
  if (!/^(X{0,3})(IX|IV|V?I{0,3})$/.test(t) || t.length < 1) return undefined;
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN_VALUE[t[i]!]!;
    const next = ROMAN_VALUE[t[i + 1] ?? ""] ?? 0;
    n += v < next ? -v : v;
  }
  return n >= 2 && n <= 39 ? n : undefined;
}

/** Franchises often written with a one-word name before the colon ("Halo: Reach"). */
const ONE_WORD_SERIES =
  /^(Halo|Doom|Destiny|Diablo|Fallout|Borderlands|Battlefield|Bioshock|Starcraft|Warcraft|Overwatch|Titanfall|Wolfenstein|Prey|Dishonored|Hitman|Persona|Tekken|Bayonetta|Crysis|Metroid|Kirby|Pikmin|Splatoon|Sonic|Spyro|Crash|Quake|Fable|Forza|Gears|Mafia|Watch Dogs|Xenoblade)$/i;

/**
 * People say "Call of Duty Ghosts", not "Call of Duty… Ghosts": the colon in a
 * game title gets no pause. A colon counts as part of a title when the words
 * before it are a run of capitalised words (small joiners like "of" and "the"
 * allowed) at least two long, or a known one-word series, and a capital
 * follows. "Here's the thing: Ghosts" and "Our pick: Halo" keep their pause.
 */
export function smoothTitleColons(text: string): string {
  return text.replace(
    /((?:\b[A-Z0-9][\w'’.&-]*)(?:\s+(?:of|the|and|&|[A-Z0-9][\w'’.&-]*))*):\s+(?=[A-Z0-9])/g,
    (m: string, left: string) => {
      const words = left.split(/\s+/);
      // Keep only the capitalised run that ends at the colon.
      const run: string[] = [];
      for (let k = words.length - 1; k >= 0; k--) {
        const w = words[k]!;
        if (/^[A-Z0-9]/.test(w) || /^(of|the|and|&)$/.test(w)) run.unshift(w);
        else break;
      }
      const capitals = run.filter((w) => /^[A-Z0-9]/.test(w)).length;
      return capitals >= 2 || ONE_WORD_SERIES.test(run.join(" "))
        ? `${left} `
        : m;
    },
  );
}

/**
 * Game titles the way people say them: "Modern Warfare III" is "Modern Warfare
 * 3", "Call of Duty: WWII" is "World War Two", "Final Fantasy XIV" is "14". A
 * lone V or X stays a letter ("Mega Man X") unless the series numbers it
 * (Grand Theft Auto V, The Elder Scrolls V, Final Fantasy X).
 */
export function speakTitles(text: string): string {
  return (
    smoothTitleColons(text)
      // "Series X|S" came out as "Series XXS": the console is said "Series X and S" (captions show X|S).
      .replace(/\bSeries X\s?[|/]\s?S\b/g, "Series X and S")
      .replace(/\bWWII\b/g, "World War Two")
      .replace(/\bWWI\b/g, "World War One")
      .replace(
        // A lone V or X is a numeral only after a series that numbers its games ("Metal Gear Solid V" came
        // out as "Vai", 25 Oct 2026); "Mega Man X" and "Xbox Series X" keep their letters.
        /\b(Grand Theft Auto|GTA|Elder Scrolls|Final Fantasy|Civilization|Rocky|Halo|Gears of War|Metal Gear Solid|Resident Evil|Dragon Quest|Kingdom Hearts|Street Fighter|Tekken|Far Cry|Fallout|Diablo|Persona|Battlefield|Dark Souls|Borderlands|Hitman) (V|X)\b/g,
        (_m, series: string, n: string) => `${series} ${romanValue(n)}`,
      )
      // A possessive or a hyphen after the numeral still counts ("GTA VI's trailer" came out as "viy's",
      // 25 Oct 2026); a letter after it does not ("VIP", "XIV-ish" stays a word only when it is one).
      .replace(
        /(?<![A-Za-z'’-])([IVX]{2,6})(?=['’]s\b|-|(?![A-Za-z'’]))/g,
        (m: string, t: string) => {
          const n = romanValue(t);
          return n === undefined ? m : String(n);
        },
      )
  );
}

/**
 * Years the way people say them, so the voice never improvises: 2016 is
 * "twenty sixteen", 2007 "two thousand seven", 1997 "nineteen ninety-seven".
 * Only plain four-digit years from 1950 to 2099 (not prices, counts or ids).
 */
export function speakYears(text: string): string {
  return text.replace(
    /(?<![\d$£€.,:/-])\b(19[5-9]\d|20\d\d)\b(?![\d%,.]\d|\s?(?:percent|%))/g,
    (_m, y: string) => {
      const n = Number(y);
      if (n >= 2000 && n <= 2009)
        return n === 2000
          ? "two thousand"
          : `two thousand ${numberWords(n - 2000)}`;
      const hi = Math.floor(n / 100);
      const lo = n % 100;
      return `${numberWords(hi)} ${lo < 10 ? `oh ${numberWords(lo)}` : numberWords(lo)}`;
    },
  );
}

const digitWords = (d: string) =>
  d
    .split("")
    .map((c) => ONES[Number(c)])
    .join(" ");

/**
 * Counts and decimals in words, which the voice otherwise misreads: "32,619" is "thirty-two thousand six
 * hundred nineteen", "4.5" is "four point five", "47.5%" is "forty-seven point five percent". Only numbers
 * with a separator or a decimal point: a bare number is usually a name ("Xbox 360", "RTX 4090"), and
 * prices and years are already words by now. Captions turn these back into figures (timeline.ts
 * displayWords).
 */
export function speakNumbers(text: string): string {
  return text
    .replace(
      /(?<![\w$£€¥.,#:/-])(\d{1,3}(?:,\d{3})+|\d+)\.(\d+)(\s?%)?(?![\w/]|[.,]\d)/g,
      (_m, whole: string, frac: string, pct: string | undefined) =>
        `${numberWords(Number(whole.replace(/,/g, "")))} point ${digitWords(frac)}${pct ? " percent" : ""}`,
    )
    .replace(
      /(?<![\w$£€¥.,#:/-])(\d{1,3}(?:,\d{3})+)(\s?%)?(?![\w/]|[.,]\d)/g,
      (_m, whole: string, pct: string | undefined) =>
        `${numberWords(Number(whole.replace(/,/g, "")))}${pct ? " percent" : ""}`,
    );
}

/** A count as people say it: "almost 350,000" for 346,258, "over 230,000" for 233,409, "over 8,000" for 8,049. */
export function roundCount(n: number): string {
  const fmt = (r: number) =>
    r >= 1_000_000
      ? `${Number((r / 1_000_000).toFixed(2))} million`
      : r.toLocaleString("en-US");
  const at = (sig: number) => {
    const step = 10 ** (Math.floor(Math.log10(n)) - sig + 1);
    return Math.round(n / step) * step;
  };
  // One significant figure when it is within 3% ("almost 10,000" for 9,799), else two.
  const one = at(1);
  const r = Math.abs(n - one) / n <= 0.03 ? one : at(2);
  return r === n ? fmt(n) : `${n < r ? "almost" : "over"} ${fmt(r)}`;
}

const QUALIFIED =
  /\b(about|around|almost|nearly|over|than|roughly|under|some|approximately|to|of exactly|exactly)\s*$/i;

/**
 * Exact counts rounded for the ear ("from 346,258 reviews" is "from almost 350,000 reviews"): only
 * comma-grouped whole numbers, never money, percentages or decimals, and a number that already has a
 * qualifier ("more than 346,258") is left as written.
 */
export function roundCounts(text: string): string {
  return text.replace(
    /(?<![\w$£€¥.,#:/-])(\d{1,3}(?:,\d{3})+)(?![\d%]|[.,]\d|\s?(?:percent|%|€))/g,
    (m: string, num: string, offset: number, all: string) =>
      QUALIFIED.test(all.slice(Math.max(0, offset - 20), offset))
        ? m
        : roundCount(Number(num.replace(/,/g, ""))),
  );
}

/** Units the voice spells out (it said "134 gee bye" for 134GB, 24 Oct 2026); captions turn them back. */
export const UNIT_WORDS: Record<string, [string, string]> = {
  TB: ["terabyte", "terabytes"],
  GB: ["gigabyte", "gigabytes"],
  MB: ["megabyte", "megabytes"],
  KB: ["kilobyte", "kilobytes"],
  GHz: ["gigahertz", "gigahertz"],
  MHz: ["megahertz", "megahertz"],
  Hz: ["hertz", "hertz"],
};

/** "134GB" and "134 GB" as "134 gigabytes", "1GB" as "1 gigabyte". */
export function speakUnits(text: string): string {
  return text.replace(
    /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?(TB|GB|MB|KB|GHz|MHz|Hz)\b/g,
    (_m, n: string, unit: string) => {
      const [one, many] = UNIT_WORDS[unit]!;
      return `${n} ${Number(n.replace(/,/g, "")) === 1 ? one : many}`;
    },
  );
}

export function speakable(text: string): string {
  return speakNumbers(speakYearsAndMoney(roundPrices(roundCounts(speakUnits(text)))));
}

/**
 * Prices said the quick way (the owner's ask, 25 Oct 2026): "$29.99" is "thirty dollars", "$4.99" is
 * "five dollars", "$24.50" is "twenty-four dollars" rounded to "twenty-five". Under $10 a price that
 * does not end in .9x keeps its cents ("$1.19"), where rounding would change the deal. The screen still
 * shows the exact price.
 */
export function roundPrices(text: string): string {
  const round = (whole: string, cents: string): string | undefined => {
    const w = Number(whole.replace(/,/g, ""));
    const c = Number(cents);
    if (c === 0) return String(w);
    if (c >= 90) return String(w + 1);
    if (w >= 10) return String(Math.round(w + c / 100));
    return undefined;
  };
  return text
    .replace(
      /([$£€])(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?![\d.,]\d|\s?(?:bn|billion|million|m\b|k\b))/gi,
      (m, sym: string, whole: string, cents: string) => {
        const r = round(whole, cents);
        return r === undefined ? m : `${sym}${Number(r).toLocaleString("en-US")}`;
      },
    )
    .replace(/(?<![\d.,])(\d+),(\d{2})\s?€/g, (m, whole: string, cents: string) => {
      const r = round(whole, cents);
      return r === undefined ? m : `${r}€`;
    });
}

/** Figures in words exactly as written, without rounding: for comparing a transcript with a script. */
export function speakExact(text: string): string {
  return speakNumbers(speakYearsAndMoney(speakUnits(text)));
}

function speakYearsAndMoney(text: string): string {
  return speakYears(speakTitles(text))
    .replace(
      /([$£€¥])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s?(billion|million|bn|mn|[kmb])\b)?/gi,
      (
        _m,
        sym: string,
        whole: string,
        minor: string | undefined,
        scale: string | undefined,
      ) => moneyWords(sym, whole, minor, scale),
    )
    .replace(/\b(\d+)[.,](\d{2})\s?€/g, (_m, whole: string, minor: string) =>
      moneyWords("€", whole, minor, undefined),
    )
    .replace(/\b(\d+)\s?€/g, (_m, whole: string) =>
      moneyWords("€", whole, undefined, undefined),
    );
}
