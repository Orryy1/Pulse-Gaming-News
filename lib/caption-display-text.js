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
  /\b(nineteen|twenty)[\s-]+(?:(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)|(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(one|two|three|four|five|six|seven|eight|nine))?)\b/gi;

const TWO_THOUSAND_YEAR_RE =
  /\btwo\s+thousand(?:\s+and)?(?:\s+(?:(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)|(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(one|two|three|four|five|six|seven|eight|nine))?|(one|two|three|four|five|six|seven|eight|nine)))?\b/gi;

const PLAYSTATION_HARDWARE_RE = /\bplaystation\s+(four|five)\b/gi;
const GEARS_E_DAY_RE = /\bGears\s+of\s+War\s+E\s+Day\b/gi;
const E_DAY_STANDALONE_RE = /\bE\s+Day\b/g;
const POSSESSIVE_SUFFIX = "((?:'|\\u2019)s)";
const GTA_SPOKEN_RE = new RegExp(
  `\\bG\\.?\\s*T\\.?\\s*A\\.?\\s+(five|six)${POSSESSIVE_SUFFIX}?\\b`,
  "gi",
);
const GRAND_THEFT_AUTO_SPOKEN_RE = /\bGrand\s+Theft\s+Auto\s+(five|six)\b/gi;
const CYBERPUNK_2077_ASR_RE = new RegExp(
  `\\bCyberpunk\\s+2070\\s+seven${POSSESSIVE_SUFFIX}?\\b`,
  "gi",
);
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
    .replace(CYBERPUNK_2077_ASR_RE, (_match, possessive = "") => `Cyberpunk 2077${String(possessive || "").toLowerCase()}`)
    .replace(GRAND_THEFT_AUTO_SPOKEN_RE, (_match, numberWord) => {
      const lower = String(numberWord || "").toLowerCase();
      if (lower === "five") return "Grand Theft Auto V";
      if (lower === "six") return "Grand Theft Auto VI";
      return _match;
    })
    .replace(GTA_SPOKEN_RE, (_match, numberWord, possessive = "") => {
      const digit = ONES[String(numberWord || "").toLowerCase()];
      return digit ? `GTA ${digit}${String(possessive || "").toLowerCase()}` : _match;
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

function displayWordText(word) {
  return String(word?.text ?? word?.word ?? "");
}

function cleanDisplayToken(word) {
  return displayWordText(word)
    .replace(/(?:'|\u2019)s\b/gi, "s")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase();
}

function captionTrailingPunctuation(word = {}) {
  const raw = displayWordText(word);
  const possessive = raw.match(/((?:'|\u2019)s)([.!?,;:]*)$/i);
  if (possessive) return `${possessive[1].toLowerCase()}${possessive[2] || ""}`;
  const punctuation = raw.match(/([.!?,;:]+)$/);
  return punctuation ? punctuation[1] : "";
}

function captionNumberWord(value) {
  const token = String(value || "").toLowerCase();
  if (/^\d+$/.test(token)) return Number(token);
  if (ONES[token] !== undefined) return ONES[token];
  if (token.endsWith("s") && ONES[token.slice(0, -1)] !== undefined) {
    return ONES[token.slice(0, -1)];
  }
  return null;
}

function captionYearTail(tensToken, oneToken) {
  const compact = String(tensToken || "").toLowerCase();
  if (ONES[compact] !== undefined) return ONES[compact];
  if (compact.includes("-")) {
    const [tens, one] = compact.split("-");
    if (TENS[tens] !== undefined) {
      return TENS[tens] + (ONES[one] || 0);
    }
  }
  if (TENS[compact] !== undefined) {
    return TENS[compact] + (ONES[String(oneToken || "").toLowerCase()] || 0);
  }
  return null;
}

function cloneDisplayWordRange(words, startIndex, endIndex, text, textKey) {
  const first = words[startIndex] || {};
  const last = words[endIndex] || first;
  const key = textKey || (Object.prototype.hasOwnProperty.call(first, "text") ? "text" : "word");
  return {
    ...first,
    [key]: `${text}${captionTrailingPunctuation(last)}`,
    start: first.start,
    end: last.end,
  };
}

function normaliseCaptionDisplayWords(words = [], options = {}) {
  const source = Array.isArray(words) ? words : [];
  const merged = [];
  for (let i = 0; i < source.length; i += 1) {
    const token = cleanDisplayToken(source[i]);
    const next = i + 1 < source.length ? cleanDisplayToken(source[i + 1]) : "";
    const third = i + 2 < source.length ? cleanDisplayToken(source[i + 2]) : "";
    const fourth = i + 3 < source.length ? cleanDisplayToken(source[i + 3]) : "";

    if (token === "g" && next === "t" && third === "a") {
      const version = captionNumberWord(fourth);
      if (version === 5 || version === 6) {
        merged.push(cloneDisplayWordRange(source, i, i + 3, `GTA ${version}`, options.textKey));
        i += 3;
      } else {
        merged.push(cloneDisplayWordRange(source, i, i + 2, "GTA", options.textKey));
        i += 2;
      }
      continue;
    }

    if (token === "gta") {
      const version = captionNumberWord(next);
      if (version === 5 || version === 6) {
        merged.push(cloneDisplayWordRange(source, i, i + 1, `GTA ${version}`, options.textKey));
        i += 1;
        continue;
      }
    }

    if (token === "cyberpunk" && next === "2070") {
      const versionTail = captionNumberWord(third);
      if (versionTail === 7) {
        merged.push(cloneDisplayWordRange(source, i, i + 2, "Cyberpunk 2077", options.textKey));
        i += 2;
        continue;
      }
    }

    if (token === "playstation") {
      const version = captionNumberWord(next);
      if (version === 4 || version === 5) {
        merged.push(cloneDisplayWordRange(source, i, i + 1, `PlayStation ${version}`, options.textKey));
        i += 1;
        continue;
      }
    }

    if (token === "twenty") {
      let yearTail = null;
      let endOffset = 0;
      if (next === "twenty") {
        yearTail =
          ONES[third] !== undefined ? 20 + ONES[third] : captionYearTail(third, fourth);
        endOffset = TENS[third] !== undefined && ONES[fourth] !== undefined ? 3 : 2;
      } else if (/^twenty-/.test(next)) {
        yearTail = captionYearTail(next);
        endOffset = 1;
      } else if (/^\d{1,2}$/.test(next)) {
        yearTail = Number(next);
        endOffset = 1;
      }
      if (yearTail !== null && yearTail >= 0 && yearTail <= 99) {
        merged.push(cloneDisplayWordRange(source, i, i + endOffset, String(2000 + yearTail), options.textKey));
        i += endOffset;
        continue;
      }
    }

    const key = options.textKey || (Object.prototype.hasOwnProperty.call(source[i] || {}, "text") ? "text" : "word");
    const normalised = normaliseCaptionDisplayText(displayWordText(source[i]));
    merged.push({ ...source[i], [key]: normalised });
  }
  return merged;
}

module.exports = {
  normaliseCaptionDisplayText,
  normaliseCaptionDisplayWords,
};
