"use strict";

const fs = require("fs-extra");
const { normaliseText } = require("./text-hygiene");

const PROTECTED_NAMES = [
  {
    canonical: "Pok\u00e9mon",
    damaged: [/\bPokmon\b/gi],
    nonCanonical: [/\bPokemon\b/g],
  },
  {
    canonical: "NVIDIA",
    damaged: [/\bNVIDA\b/gi, /\bNividia\b/gi],
    nonCanonical: [/\bNvidia\b/g],
  },
  {
    canonical: "Bethesda",
    damaged: [/\bBethsda\b/gi, /\bBthesda\b/gi],
    nonCanonical: [],
  },
  {
    canonical: "HoYoverse",
    damaged: [/\bHoYovrse\b/gi, /\bHoyovrse\b/gi],
    nonCanonical: [/\bHoyoverse\b/g],
  },
  {
    canonical: "PlayStation",
    damaged: [/\bPlaystaion\b/gi, /\bPlayStaton\b/gi],
    nonCanonical: [/\bPlaystation\b/g],
  },
];

function uniqueMatches(text, regexes = []) {
  const out = [];
  const seen = new Set();
  for (const re of regexes) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const global = new RegExp(re.source, flags);
    let match;
    while ((match = global.exec(text)) !== null) {
      const value = match[0];
      const key = value.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(value);
      }
      if (match[0] === "") global.lastIndex++;
    }
  }
  return out;
}

function normaliseFieldText(value) {
  return normaliseText(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function runBrandNameQa(fields = {}) {
  const failures = [];
  const warnings = [];
  const matches = [];

  for (const [fieldName, value] of Object.entries(fields || {})) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const text = normaliseFieldText(value);
    if (!text) continue;

    for (const entry of PROTECTED_NAMES) {
      for (const damaged of uniqueMatches(text, entry.damaged)) {
        failures.push(
          `protected_name_damaged:${entry.canonical}:${fieldName}:${damaged}`,
        );
        matches.push({
          severity: "fail",
          canonical: entry.canonical,
          field: fieldName,
          value: damaged,
        });
      }

      for (const nonCanonical of uniqueMatches(text, entry.nonCanonical)) {
        warnings.push(
          `protected_name_noncanonical:${entry.canonical}:${fieldName}:${nonCanonical}`,
        );
        matches.push({
          severity: "warn",
          canonical: entry.canonical,
          field: fieldName,
          value: nonCanonical,
        });
      }
    }
  }

  const result =
    failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  return { result, failures, warnings, matches };
}

function extractAssPlainText(assContent) {
  const chunks = [];
  for (const line of String(assContent || "").split(/\r?\n/)) {
    if (!line.startsWith("Dialogue:")) continue;
    const fields = line.split(",");
    if (fields.length < 10) continue;
    chunks.push(fields.slice(9).join(","));
  }
  return normaliseFieldText(
    chunks
      .join(" ")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[Nn]/g, " ")
      .replace(/\\h/g, " "),
  );
}

async function readAssPlainText(assPath) {
  if (!assPath || !(await fs.pathExists(assPath))) return "";
  return extractAssPlainText(await fs.readFile(assPath, "utf8"));
}

module.exports = {
  runBrandNameQa,
  extractAssPlainText,
  readAssPlainText,
  PROTECTED_NAMES,
};
