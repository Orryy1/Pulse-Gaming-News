"use strict";

const LEAKER_PREFIX_RE =
  /^(tom\s+henderson|billbil-kun|billbilkun|billbil\s+kun|jason\s+schreier|jeff\s+grubb|nate\s+the\s+hate|nibellion)\s+(?:on|says|reports|claims|leaks|hints)\s+/i;

const SUBJECT_VERB_RE =
  /\b(?:drops?|dropped|falls?|fell|exits?|exited|hits?|hit|reaches?|reached|passes?|passed|beats?|beaten|slips?|slipped|loses?|lost|gets?|got|receives?|received|launches?|launched|returns?|returned|revives?|revived|reveals?|revealed|announces?|announced|confirms?|confirmed|delays?|delayed|adds?|added|becomes?|became|becoming|is|are|was|were|will|has|have|had|won't|can't|isn't|aren't|doesn't|don't|didn't|couldn't|wouldn't|shouldn't)\b/i;

const SENTENCE_FRAGMENT_PREFIX_RE =
  /^(?:it'?s|it\s+is|this\s+is|that\s+is|there'?s|there\s+is|here'?s|here\s+is|what\s+we\s+know|why\s+it\s+matters)\b/i;

const NON_GAME_NORMALISED = new Set([
  "steam",
  "playstation",
  "ps5",
  "ps4",
  "xbox",
  "nintendo",
  "switch",
  "pc",
  "game pass",
  "playstation plus",
  "ps plus",
  "amazon",
  "youtube",
  "tiktok",
  "facebook",
  "instagram",
  "digital foundry",
  "ign",
  "gamespot",
  "eurogamer",
  "pc gamer",
  "kotaku",
  "polygon",
  "take two",
  "take-two",
  "rockstar",
  "rockstar games",
  "niantic",
  "microsoft",
  "sony",
]);

function normalise(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&amp;/gi, "and")
    .replace(/[\u2019`]/g, "'")
    .replace(/[^a-zA-Z0-9:+'.& -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function key(value) {
  return normalise(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isLikelyGameTitleCandidate(value) {
  if (/^\s*["'\u2018\u2019\u201c\u201d]/.test(String(value || ""))) return false;
  const cleaned = normalise(value);
  if (!cleaned || cleaned.length <= 3) return false;
  if (SENTENCE_FRAGMENT_PREFIX_RE.test(cleaned)) return false;
  if (/[.!?]\s+\S/.test(cleaned)) return false;
  const normalised = key(cleaned);
  if (!normalised || NON_GAME_NORMALISED.has(normalised)) return false;
  if (/\b(?:steam|playstation|xbox|nintendo|switch|ps5|ps4|game pass|ccu|best sellers?)\b/i.test(cleaned)) {
    return false;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  if (!/[A-Z0-9]/.test(cleaned)) return false;
  if (/^(?:the|a|an)$/i.test(cleaned)) return false;
  return true;
}

function cleanCandidate(value) {
  return normalise(value)
    .replace(/^(?:yup|yeah|yes|no|actually|well|even tho|even though)\b[,\s-]*/i, "")
    .replace(/^(?:the\s+next|a\s+new|new)\b[,\s-]*/i, "")
    .replace(/^(.+?)'s\s+(?:newly|just|finally|officially|reportedly)\b.*$/i, "$1")
    .replace(/\b(?:won't|can't|isn't|aren't|doesn't|don't|didn't|couldn't|wouldn't|shouldn't)$/i, "")
    .replace(
      /\b(?:pc\s+game|pc specs?|system requirements|global release times?|release times?|launch times?|review scores?|mixed reviews?|sequel launches?|sequel|remake|remaster|remastered|update|trailer|leak)\b.*$/i,
      "",
    )
    .trim();
}

function creatorCreditCandidates(value) {
  const match = String(value || "").match(
    /^\s*([A-Z][A-Za-z0-9:+'.& -]{2,40}?)\s+and\s+([A-Z][A-Za-z0-9:+'.& -]{2,40}?)\s+(?:composer|creator|director|developer|dev|writer|producer)\b/i,
  );
  return match ? [match[1], match[2]] : [];
}

function directColonCandidates(base) {
  const colonIdx = base.indexOf(":");
  if (colonIdx === -1) return [];
  const left = base.slice(0, colonIdx);
  const right = base.slice(colonIdx + 1);
  return [left, ...creatorCreditCandidates(right), right]
    .map(cleanCandidate)
    .filter(isLikelyGameTitleCandidate);
}

function leadingSubjectCandidate(base) {
  const match = String(base || "").match(new RegExp(`^(.{2,80}?)\\s+${SUBJECT_VERB_RE.source}`, "i"));
  if (!match) return null;
  if (match[1].includes(":")) return null;
  const candidate = cleanCandidate(match[1])
    .replace(/\b(?:just|finally|immediately|already|officially|reportedly)$/i, "")
    .trim();
  return isLikelyGameTitleCandidate(candidate) ? candidate : null;
}

function midSentenceSubjectCandidates(base) {
  const patterns = [
    /\bsince\s+release\s+and\s+([A-Z][A-Za-z0-9:+'.& -]{2,60}?)\s+(?:is|are|was|were|has|have|will)\b/gi,
    /\byear\s+since\s+release\s+and\s+([A-Z][A-Za-z0-9:+'.& -]{2,60}?)\s+(?:is|are|was|were|has|have|will)\b/gi,
  ];
  const candidates = [];
  for (const pattern of patterns) {
    for (const match of String(base || "").matchAll(pattern)) {
      const candidate = cleanCandidate(match[1]).trim();
      if (isLikelyGameTitleCandidate(candidate)) candidates.push(candidate);
    }
  }
  return candidates;
}

function inferHeadlineGameCandidates(rawTitle) {
  const base = normalise(rawTitle).replace(LEAKER_PREFIX_RE, "").trim();
  if (!base) return [];

  const candidates = [
    leadingSubjectCandidate(base),
    ...directColonCandidates(base),
    ...midSentenceSubjectCandidates(base),
  ];

  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    const cleaned = normalise(candidate);
    const candidateKey = key(cleaned);
    if (!cleaned || !candidateKey || seen.has(candidateKey)) continue;
    seen.add(candidateKey);
    out.push(cleaned);
  }
  return out;
}

module.exports = {
  inferHeadlineGameCandidates,
  isLikelyGameTitleCandidate,
};
