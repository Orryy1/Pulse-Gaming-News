"use strict";

const { inferHeadlineGameCandidates } = require("./game-title-inference");

const PLACEHOLDER_PUBLIC_TITLE_RE =
  /^(?:this\s+gaming\s+story|gaming\s+story|gaming\s+news\s+update|this\s+story|new\s+gaming\s+update)$/i;

const RAW_ARTICLE_TITLE_RE = [
  /\bwill be safe from a music licen[cs]ing related de-?listing\b/i,
  /\bdecrees\s+['"]?bullet heaven['"]?\s+the name of\b/i,
  /^it'?s official:\s+/i,
  /,\s*(?:ensured|according|after|while|because|amid|with|as)\b/i,
  /\b(?:reports?|says?|claims?)\s+.+\b(?:but|while|after|because)\b/i,
];

function cleanPublicTitle(value) {
  return String(value || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function titleWordCount(value) {
  return cleanPublicTitle(value).split(/\s+/).filter(Boolean).length;
}

function isPlaceholderPublicTitle(value) {
  const title = cleanPublicTitle(value).replace(/[.!?]+$/g, "");
  return !title || PLACEHOLDER_PUBLIC_TITLE_RE.test(title);
}

function isRawArticleTitleShape(value) {
  const title = cleanPublicTitle(value);
  if (!title) return false;
  if (title.length > 80) return true;
  if (titleWordCount(title) > 12 && RAW_ARTICLE_TITLE_RE.some((re) => re.test(title))) {
    return true;
  }
  return RAW_ARTICLE_TITLE_RE.some((re) => re.test(title)) && titleWordCount(title) > 8;
}

function titleKey(value) {
  return cleanPublicTitle(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function storyText(story = {}) {
  return [
    story.public_title,
    story.upload_title,
    story.suggested_title,
    story.canonical_title,
    story.title,
    story.suggested_thumbnail_text,
    story.full_script,
    story.tts_script,
    story.body,
  ]
    .filter(Boolean)
    .join("\n");
}

function subjectFromStory(story = {}) {
  const explicit = cleanPublicTitle(
    story.canonical_subject ||
      story.canonical_game ||
      story.game_title ||
      story.game ||
      story.primary_entity ||
      story.company_name,
  );
  if (explicit) return explicit;
  const inferred = inferHeadlineGameCandidates(story.title || story.suggested_title || "");
  return inferred[0] || "";
}

function knownRepairTitle(story = {}) {
  const text = storyText(story);
  if (/\bmixtape\b/i.test(text) && /\b(?:music|licen[cs]|delist|vanish)\b/i.test(text)) {
    return "Mixtape Dodged Gaming's Delisting Trap";
  }
  if (/\bbullet heaven\b/i.test(text) && /\bvampire survivors\b/i.test(text)) {
    return "Steam Named Vampire Survivors' Genre";
  }
  if (/\bforza horizon 6\b/i.test(text) && /\b(?:steam|record|130,?000|concurrent)\b/i.test(text)) {
    return "Forza 6 Just Beat Horizon 5";
  }
  if (/\bplaystation plus\b/i.test(text) && /\bprice/i.test(text)) {
    return "PlayStation Plus Prices Are Rising";
  }
  if (/\bsubnautica 2\b/i.test(text) && /\b(?:fish|kill)\b/i.test(text)) {
    return "Subnautica 2 Is Keeping Its Peaceful Rule";
  }
  if (/\bstar wars\b/i.test(text) && /\bold republic\b/i.test(text) && /\breboot\b/i.test(text)) {
    return "SWTOR Almost Got A Reboot";
  }
  return "";
}

function isSafePublicTitle(value) {
  const title = cleanPublicTitle(value);
  return Boolean(
    title &&
      !isPlaceholderPublicTitle(title) &&
      !isRawArticleTitleShape(title) &&
      title.length <= 80,
  );
}

function fallbackRepairTitle(story = {}) {
  const subject = subjectFromStory(story);
  const text = storyText(story);
  if (subject) {
    if (/\bprice/i.test(text)) return `${subject} Prices Are Changing`;
    if (/\b(?:record|steam|concurrent|players)\b/i.test(text)) return `${subject} Hit A Clear Steam Signal`;
    if (/\b(?:delay|delayed)\b/i.test(text)) return `${subject} Just Got Delayed`;
    if (/\b(?:launch|release)\b/i.test(text)) return `${subject} Just Got A Launch Update`;
    if (/\b(?:reboot|remake|revival|revived)\b/i.test(text)) return `${subject} Almost Got A Revival`;
    return `${subject} Has One Big Player Question`;
  }

  const base = cleanPublicTitle(story.title || story.suggested_title || "");
  const words = base.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  return words || "Gaming Story Needs Review";
}

function repairPublicTitle(story = {}) {
  const repaired = cleanPublicTitle(knownRepairTitle(story) || fallbackRepairTitle(story));
  if (isSafePublicTitle(repaired)) return repaired;
  return cleanPublicTitle(repaired).slice(0, 80).replace(/\s+\S*$/, "").trim();
}

function resolvePublicTitle(story = {}) {
  const variants = Array.isArray(story.title_variants) ? story.title_variants : [];
  const activeIndex = Number.isInteger(story.active_title_index)
    ? story.active_title_index
    : 0;
  const orderedVariants = [
    variants[activeIndex],
    ...variants.filter((_, index) => index !== activeIndex),
  ];
  const candidates = [
    story.public_title,
    story.upload_title,
    ...orderedVariants,
    story.suggested_title,
    story.canonical_title,
    story.suggested_thumbnail_text,
  ];

  const seen = new Set();
  for (const candidate of candidates) {
    const title = cleanPublicTitle(candidate);
    const key = titleKey(title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    if (isSafePublicTitle(title)) return title;
  }

  return repairPublicTitle(story);
}

module.exports = {
  cleanPublicTitle,
  isPlaceholderPublicTitle,
  isRawArticleTitleShape,
  isSafePublicTitle,
  repairPublicTitle,
  resolvePublicTitle,
  titleWordCount,
};
