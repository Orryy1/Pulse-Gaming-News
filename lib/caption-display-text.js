"use strict";

const ONES = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const TEENS = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const MODERN_YEAR_RE =
  /\b(nineteen|twenty)\s+(?:(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)|(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(one|two|three|four|five|six|seven|eight|nine))?)\b/gi;

const TWO_THOUSAND_YEAR_RE =
  /\btwo\s+thousand(?:\s+and)?(?:\s+(?:(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)|(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(one|two|three|four|five|six|seven|eight|nine))?|(one|two|three|four|five|six|seven|eight|nine)))?\b/gi;

const PLAYSTATION_HARDWARE_RE = /\bplaystation\s+(four|five)\b/gi;
const GEARS_E_DAY_RE = /\bGears\s+of\s+War\s+E\s+Day\b/gi;
const E_DAY_STANDALONE_RE = /\bE\s+Day\b/g;
const GTA_SPOKEN_RE = /\bG\s*T\s*A\s+(five|six)\b/gi;
const GRAND_THEFT_AUTO_SPOKEN_RE = /\bGrand\s+Theft\s+Auto\s+(five|six)\b/gi;
const BEASTRO_SPOKEN_RE = /\bBeast\s*row\b/gi;
const RTX_2060_SPOKEN_RE = /\bRTX\s+twenty\s+sixty(?:\s+era)?\b/gi;

function modernYearFromParts(centuryWord, teenWord, tensWord, oneWord) {
  const base = centuryWord.toLowerCase() === "nineteen" ? 1900 : 2000;
  const tail =
    TEENS[String(teenWord || "").toLowerCase()] ??
    (TENS[String(tensWord || "").toLowerCase()] !== undefined
      ? TENS[String(tensWord || "").toLowerCase()] +
        (ONES[String(oneWord || "").toLowerCase()] || 0)
      : null);
  return tail === null ? null : base + tail;
}

function twoThousandYearFromParts(teenWord, tensWord, oneWord, singleWord) {
  const tail =
    TEENS[String(teenWord || "").toLowerCase()] ??
    (TENS[String(tensWord || "").toLowerCase()] !== undefined
      ? TENS[String(tensWord || "").toLowerCase()] +
        (ONES[String(oneWord || "").toLowerCase()] || 0)
      : ONES[String(singleWord || "").toLowerCase()] || 0);
  return 2000 + tail;
}

function normaliseCaptionDisplayText(text) {
  return String(text || "")
    .replace(GRAND_THEFT_AUTO_SPOKEN_RE, (_match, numberWord) => {
      const lower = String(numberWord || "").toLowerCase();
      if (lower === "five") return "Grand Theft Auto V";
      if (lower === "six") return "Grand Theft Auto VI";
      return _match;
    })
    .replace(GTA_SPOKEN_RE, (_match, numberWord) => {
      const digit = ONES[String(numberWord || "").toLowerCase()];
      return digit ? `GTA ${digit}` : _match;
    })
    .replace(BEASTRO_SPOKEN_RE, "Beastro")
    .replace(RTX_2060_SPOKEN_RE, (match) =>
      /\bera\b/i.test(match) ? "RTX 2060-era" : "RTX 2060",
    )
    .replace(PLAYSTATION_HARDWARE_RE, (_match, numberWord) => {
      const digit = ONES[String(numberWord || "").toLowerCase()];
      return digit ? `PlayStation ${digit}` : _match;
    })
    .replace(GEARS_E_DAY_RE, "Gears of War E-Day")
    .replace(E_DAY_STANDALONE_RE, "E-Day")
    .replace(
      TWO_THOUSAND_YEAR_RE,
      (_match, teenWord, tensWord, oneWord, singleWord) =>
        String(twoThousandYearFromParts(teenWord, tensWord, oneWord, singleWord)),
    )
    .replace(
      MODERN_YEAR_RE,
      (match, centuryWord, teenWord, tensWord, oneWord) => {
        const year = modernYearFromParts(centuryWord, teenWord, tensWord, oneWord);
        return year === null ? match : String(year);
      },
    );
}

module.exports = {
  normaliseCaptionDisplayText,
};
