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
  const unit = n === 1 && !minor ? one : many;
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

/**
 * Game titles the way people say them: "Modern Warfare III" is "Modern Warfare
 * 3", "Call of Duty: WWII" is "World War Two", "Final Fantasy XIV" is "14". A
 * lone V or X stays a letter ("Mega Man X") unless the series numbers it
 * (Grand Theft Auto V, The Elder Scrolls V, Final Fantasy X).
 */
export function speakTitles(text: string): string {
  return text
    .replace(/\bWWII\b/g, "World War Two")
    .replace(/\bWWI\b/g, "World War One")
    .replace(
      /\b(Grand Theft Auto|GTA|Elder Scrolls|Final Fantasy|Civilization|Rocky|Halo|Gears of War) (V|X)\b/g,
      (_m, series: string, n: string) => `${series} ${romanValue(n)}`,
    )
    .replace(
      /(?<![A-Za-z'’-])([IVX]{2,6})(?![A-Za-z'’-])/g,
      (m: string, t: string) => {
        const n = romanValue(t);
        return n === undefined ? m : String(n);
      },
    );
}

/**
 * Years the way people say them, so the voice never improvises: 2016 is
 * "twenty sixteen", 2007 "two thousand seven", 1997 "nineteen ninety-seven".
 * Only plain four-digit years from 1950 to 2099 (not prices, counts or ids).
 */
export function speakYears(text: string): string {
  return text.replace(/(?<![\d$£€.,:/-])\b(19[5-9]\d|20\d\d)\b(?![\d%,.]\d|\s?(?:percent|%))/g, (_m, y: string) => {
    const n = Number(y);
    if (n >= 2000 && n <= 2009) return n === 2000 ? "two thousand" : `two thousand ${numberWords(n - 2000)}`;
    const hi = Math.floor(n / 100);
    const lo = n % 100;
    return `${numberWords(hi)} ${lo < 10 ? `oh ${numberWords(lo)}` : numberWords(lo)}`;
  });
}

export function speakable(text: string): string {
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
