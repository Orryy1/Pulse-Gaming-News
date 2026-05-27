"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DEFAULT_WORKBOOK_PATH =
  "C:\\Users\\MORR\\Downloads\\gold_standards_reference_library.xlsx";

const REQUIRED_REFERENCE_PACKS = [
  "Gaming News Core",
  "Official Publisher Motion",
  "Social-First News",
  "Explainer / Data Graphics",
  "Pacing / Retention / Impact",
  "Premium Visual Texture",
  "Commercial and Affiliate Mechanics",
  "X Hot Take and Thread Mechanics",
  "Instagram Carousel Mechanics",
];

const SUPPLEMENTAL_REFERENCE_PACKS = {
  "Commercial and Affiliate Mechanics": {
    primary_references: "Derived from the full 50-reference library, with emphasis on creator CTAs, disclosure timing and sponsor-safe integration patterns.",
    use_this_when: "A story has affiliate, sponsor, product, store, landing-page or commercial routing.",
    main_extraction_targets:
      "Commercial integration style, disclosure placement, CTA timing, landing-page handoff, sponsor-safe wording, product-card density, trust cues and repetition risk",
  },
  "X Hot Take and Thread Mechanics": {
    primary_references: "Derived from the full 50-reference library, with emphasis on social-first news accounts and fast editorial framing.",
    use_this_when: "A canonical story needs an X post, source-safe thread, hot-take variant, poll or quote-post candidate.",
    main_extraction_targets:
      "Argument structure, source-safe compression, first-post tension, thread rhythm, quote-post framing, poll mechanics, link placement and automation/spam risk",
  },
  "Instagram Carousel Mechanics": {
    primary_references: "Derived from the full 50-reference library, with emphasis on mobile-first visual pacing, source cards and companion posts.",
    use_this_when: "A story needs an Instagram carousel, quote card, stat card, Reel companion or Story poll.",
    main_extraction_targets:
      "Cover-card clarity, slide-to-slide rhythm, headline length, source-card hierarchy, save-worthy utility, CTA placement, disclosure handling and caption parity",
  },
};

const HEADER_MAP = {
  "source / channel": "source_channel",
  "best used for": "best_used_for",
  "what to study": "what_to_study",
  "codex features to extract": "codex_features_to_extract",
  "rights / usage note": "rights_usage_note",
  "source url": "source_url",
  "rule id": "rule_id",
  "gate / rule": "gate_rule",
  "why it matters": "why_it_matters",
  "suggested implementation": "suggested_implementation",
  "primary references": "primary_references",
  "use this when": "use_this_when",
  "main extraction targets": "main_extraction_targets",
};

const SUMMARY_KEY_MAP = {
  "research date": "research_date",
  purpose: "purpose",
  "total references": "total_references",
  "tier a references": "tier_a_references",
  "tier b references": "tier_b_references",
  "highest-value benchmark clusters": "highest_value_benchmark_clusters",
  "core legal rule": "core_legal_rule",
};

const cache = new Map();

function resolveGoldStandardWorkbookPath(options = {}) {
  return path.resolve(
    options.workbookPath ||
      process.env.GOLD_STANDARDS_REFERENCE_LIBRARY ||
      DEFAULT_WORKBOOK_PATH,
  );
}

function decodeXml(value = "") {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function attrMap(fragment = "") {
  const attrs = {};
  const re = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match;
  while ((match = re.exec(fragment))) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function normaliseHeader(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return HEADER_MAP[key] || key.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function cleanValue(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw new Error("Invalid XLSX: central directory not found");
}

function readZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid XLSX: bad central directory header");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8")
      .replace(/\\/g, "/");

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid XLSX: bad local header for ${fileName}`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported XLSX compression method ${method}`);
    entries.set(fileName, data);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function parseSharedStrings(xml = "") {
  const strings = [];
  const siRe = /<si\b[\s\S]*?<\/si>/g;
  let siMatch;
  while ((siMatch = siRe.exec(xml))) {
    const si = siMatch[0];
    const parts = [];
    const tRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let tMatch;
    while ((tMatch = tRe.exec(si))) parts.push(decodeXml(tMatch[1]));
    strings.push(parts.join(""));
  }
  return strings;
}

function columnIndex(cellRef = "") {
  const letters = String(cellRef).match(/^[A-Z]+/i)?.[0] || "";
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

function cellValue(cellXml, attrs, sharedStrings) {
  if (attrs.t === "inlineStr") {
    const parts = [];
    const tRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let match;
    while ((match = tRe.exec(cellXml))) parts.push(decodeXml(match[1]));
    return cleanValue(parts.join(""));
  }
  const v = (cellXml.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1];
  if (v === undefined) return null;
  if (attrs.t === "s") return cleanValue(sharedStrings[Number(v)] || "");
  return cleanValue(decodeXml(v));
}

function parseSheetRows(xml = "", sharedStrings = []) {
  const rows = [];
  const rowRe = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const row = [];
    const cellRe = /<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = attrMap(cellMatch[1]);
      row[columnIndex(attrs.r)] = cellValue(cellMatch[0], attrs, sharedStrings);
    }
    rows.push(row.map((value) => (value === undefined ? null : value)));
  }
  return rows;
}

function parseWorkbook(entries) {
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8") || "";
  const relsXml =
    entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";
  const sharedStrings = parseSharedStrings(
    entries.get("xl/sharedStrings.xml")?.toString("utf8") || "",
  );

  const rels = {};
  const relRe = /<Relationship\b([^>]*)\/>/g;
  let relMatch;
  while ((relMatch = relRe.exec(relsXml))) {
    const attrs = attrMap(relMatch[1]);
    if (attrs.Id && attrs.Target) rels[attrs.Id] = attrs.Target.replace(/^\//, "");
  }

  const sheets = {};
  const sheetRe = /<(?:\w+:)?sheet\b([^>]*)\/>/g;
  let sheetMatch;
  while ((sheetMatch = sheetRe.exec(workbookXml))) {
    const attrs = attrMap(sheetMatch[1]);
    const relId = attrs["r:id"];
    const target = rels[relId];
    if (!attrs.name || !target) continue;
    const targetPath = target.startsWith("xl/")
      ? target
      : path.posix.join("xl", target).replace(/\\/g, "/");
    sheets[attrs.name] = parseSheetRows(
      entries.get(targetPath)?.toString("utf8") || "",
      sharedStrings,
    );
  }

  return sheets;
}

function rowsToObjects(rows = []) {
  const [headerRow, ...bodyRows] = rows;
  const headers = (headerRow || []).map(normaliseHeader);
  return bodyRows
    .map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        if (!header) return;
        const value = row[index];
        if (value !== null && value !== undefined && value !== "") obj[header] = value;
      });
      return obj;
    })
    .filter((obj) => Object.keys(obj).length > 0);
}

function summaryFromRows(rows = []) {
  const summary = {};
  for (const row of rows.slice(1)) {
    const label = String(row[0] || "").trim().toLowerCase();
    const key = SUMMARY_KEY_MAP[label];
    if (!key) continue;
    summary[key] = cleanValue(row[1]);
  }
  return summary;
}

function buildSupplementalPack(pack, libraryContext = {}) {
  const blueprint = SUPPLEMENTAL_REFERENCE_PACKS[pack];
  if (!blueprint) return null;
  const referenceCount = libraryContext.referenceCount || 0;
  const ruleCount = libraryContext.ruleCount || 0;
  if (referenceCount < 50 || ruleCount < 12) return null;
  return {
    pack,
    ...blueprint,
    source: "derived_from_gold_standard_library",
    source_reference_count: referenceCount,
    source_rule_count: ruleCount,
    rights_usage_note:
      "Pattern grammar only. Reference-only. Do not copy footage, music, graphics, transcripts or templates.",
  };
}

function normalisePackOrder(packs = [], libraryContext = {}) {
  const byName = new Map(packs.map((pack) => [pack.pack, pack]));
  return REQUIRED_REFERENCE_PACKS
    .map((pack) => byName.get(pack) || buildSupplementalPack(pack, libraryContext))
    .filter(Boolean);
}

function loadGoldStandardReferenceLibrary(options = {}) {
  const workbookPath = resolveGoldStandardWorkbookPath(options);
  const stat = fs.statSync(workbookPath);
  const cacheKey = `${workbookPath}:${stat.mtimeMs}:${stat.size}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const entries = readZipEntries(fs.readFileSync(workbookPath));
  const sheets = parseWorkbook(entries);
  const references = rowsToObjects(sheets["Gold Standards"] || []);
  const codexRules = rowsToObjects(sheets["Codex Rules"] || []);
  const library = {
    workbook_path: workbookPath,
    summary: summaryFromRows(sheets.Summary || []),
    references,
    codex_rules: codexRules,
    reference_packs: normalisePackOrder(rowsToObjects(sheets["Reference Packs"] || []), {
      referenceCount: references.length,
      ruleCount: codexRules.length,
    }),
  };

  cache.clear();
  cache.set(cacheKey, library);
  return library;
}

module.exports = {
  DEFAULT_WORKBOOK_PATH,
  REQUIRED_REFERENCE_PACKS,
  loadGoldStandardReferenceLibrary,
  resolveGoldStandardWorkbookPath,
  _private: {
    parseWorkbook,
    readZipEntries,
  },
};
