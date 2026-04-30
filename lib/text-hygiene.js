"use strict";

/**
 * lib/text-hygiene.js — public-facing text normalisation + mojibake gate.
 *
 * 2026-04-29 forensic audit: report files contain mojibake such as
 * `â€"`, `Â·`, `PokÃ©mon`, `â‰¥`, plus stray HTML entities like
 * `&amp;` and `&pound;`. Public-facing strings (titles, captions,
 * descriptions, story cards, social copy) carrying broken encoding
 * make the channel look amateur. This module is the single
 * normalisation surface every public-facing string should pass
 * through before render/upload.
 *
 * Two levels:
 *   1. normaliseText(input)  — return a cleaned string
 *      - decode HTML entities (named/decimal/hex)
 *      - decode common Latin-1 → UTF-8 mojibake patterns
 *      - normalise Unicode (NFC)
 *      - collapse whitespace
 *
 *   2. classifyTextHygiene(input) — return a verdict
 *      - { ok, severity: "clean"|"warn"|"fail", issues: string[] }
 *      - WARNs surface to render-time logs but don't block.
 *      - FAILs (raw HTML entity, unrepaired mojibake, control char)
 *        block public-facing rendering.
 *
 * Keep this module pure and synchronous. Callers decide whether to
 * upgrade a warn to a hard skip.
 *
 * Companion to assemble.js's `decodeHtmlEntities` + `asciiFallback`
 * helpers (those are drawtext-specific). This module is the upstream
 * one used at script-acceptance / produce-time.
 */

// ── HTML entity decode (subset) ─────────────────────────────────────

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  pound: "£",
  euro: "€",
  yen: "¥",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  deg: "°",
  plusmn: "±",
};

function decodeNumericEntity(match, body) {
  // body captured includes the leading "#": "#NNN" or "#xHH" / "#XHH".
  // Strip "#" first, then choose hex vs decimal by leading x/X.
  const inner = body.slice(1);
  const code =
    inner.startsWith("x") || inner.startsWith("X")
      ? parseInt(inner.slice(1), 16)
      : parseInt(inner, 10);
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
  try {
    return String.fromCodePoint(code);
  } catch {
    return match;
  }
}

function decodeHtmlEntities(input) {
  if (!input || typeof input !== "string") return input;
  return input
    .replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+);/g, (m, body) =>
      decodeNumericEntity(m, body),
    )
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
        ? NAMED_ENTITIES[name]
        : m,
    );
}

// ── Mojibake repair ─────────────────────────────────────────────────
//
// The classic case: UTF-8 bytes were re-decoded as Latin-1, producing
// garbled sequences. Common signatures:
//   â€"  →  — (em dash)
//   â€"  →  – (en dash)
//   â€™  →  ’ (right single quote)
//   â€œ  →  “
//   â€  →  ”
//   Â·   →  · (middle dot)
//   Â©   →  ©
//   Â£   →  £
//   PokÃ©mon → Pokémon
//   â‰¥  →  ≥
//
// We do a targeted replacement table for the highest-frequency cases.
// Full re-decode (re-encode as Latin-1, decode as UTF-8) would be more
// general but risks corrupting strings that are correctly encoded —
// the targeted table is conservative.

const MOJIBAKE_FIXES = [
  ["â€”", "—"],
  ["â€“", "–"],
  ["â€™", "’"],
  ["â€˜", "‘"],
  ["â€œ", "“"],
  ['â€"', "—"],
  ["â€", "”"],
  ["â€¦", "…"],
  ["Â·", "·"],
  ["Â©", "©"],
  ["Â®", "®"],
  ["Â£", "£"],
  ["Â¥", "¥"],
  ["Â°", "°"],
  ["Â±", "±"],
  ["Â§", "§"],
  ["â‰¥", "≥"],
  ["â‰¤", "≤"],
  ["â‰ˆ", "≈"],
  ["Ã©", "é"],
  ["Ã¨", "è"],
  ["Ã«", "ë"],
  ["Ãª", "ê"],
  ["Ã¡", "á"],
  ["Ã ", "à"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ã²", "ò"],
  ["Ã´", "ô"],
  ["Ã¶", "ö"],
  ["Ã¼", "ü"],
  ["Ã±", "ñ"],
  ["Ã§", "ç"],
];

function repairMojibake(input) {
  if (!input || typeof input !== "string") return input;
  let out = input;
  for (const [bad, good] of MOJIBAKE_FIXES) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  return out;
}

// ── Public surface ─────────────────────────────────────────────────

function normaliseText(input) {
  if (input == null) return "";
  if (typeof input !== "string") return String(input);
  let out = decodeHtmlEntities(input);
  out = repairMojibake(out);
  // NFC normalisation so e + combining acute → é (single code point).
  try {
    out = out.normalize("NFC");
  } catch {
    /* String doesn't expose normalize? Skip. */
  }
  // Collapse runs of whitespace except newlines, trim ends.
  out = out
    .replace(/[ \t ]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return out;
}

const RAW_ENTITY_RE = /&(?:[a-zA-Z][a-zA-Z0-9]+|#[0-9]+|#[xX][0-9a-fA-F]+);/;
const MOJIBAKE_DETECT_RE = /Ã[©¨ªê¡íóòôöüñç]|â€[—""''¦"]|Â[·©®£¥°±§]|â‰[¥¤ˆ]/;
// Match C0/C1 control chars (0x00..0x1F, 0x7F..0x9F) excluding
// tab/LF/CR. Explicit \u escapes so the literal survives formatters.
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

function classifyTextHygiene(input) {
  const issues = [];
  const text = typeof input === "string" ? input : String(input || "");

  if (text.length === 0) {
    return { ok: true, severity: "clean", issues, normalised: "" };
  }

  if (RAW_ENTITY_RE.test(text)) {
    // Distinguish "decodable" entities from "stale".  &amp; / &pound;
    // can be auto-decoded so we WARN and let the normaliser fix.
    issues.push("raw_html_entity");
  }
  if (MOJIBAKE_DETECT_RE.test(text)) {
    issues.push("mojibake_detected");
  }
  if (CONTROL_CHAR_RE.test(text)) {
    issues.push("control_char");
  }

  const normalised = normaliseText(text);

  // After normalisation, do the issues persist? If the entity was
  // auto-decoded and the mojibake fix ran cleanly, demote severity.
  let severity;
  let stillBad = false;
  if (RAW_ENTITY_RE.test(normalised)) {
    issues.push("raw_html_entity_after_normalise");
    stillBad = true;
  }
  if (MOJIBAKE_DETECT_RE.test(normalised)) {
    issues.push("mojibake_after_normalise");
    stillBad = true;
  }
  if (CONTROL_CHAR_RE.test(normalised)) {
    issues.push("control_char_after_normalise");
    stillBad = true;
  }

  if (stillBad) {
    severity = "fail";
  } else if (issues.length > 0) {
    severity = "warn"; // detected but cleanly repaired
  } else {
    severity = "clean";
  }

  return { ok: severity !== "fail", severity, issues, normalised };
}

module.exports = {
  normaliseText,
  classifyTextHygiene,
  decodeHtmlEntities,
  repairMojibake,
  MOJIBAKE_FIXES,
  NAMED_ENTITIES,
};
