"use strict";

const GOAL_ID = "pulse_media_house_score_v1";
const {
  SOURCE_CARD_TIMING,
} = require("./studio/v4/premium-card-timing-policy");

const SCORE_KEYS = [
  "title_strength_score",
  "first_frame_score",
  "first_3_seconds_score",
  "script_punch_score",
  "narration_quality_score",
  "motion_density_score",
  "transition_energy_score",
  "sound_design_score",
  "mobile_readability_score",
  "brand_recognition_score",
  "source_lock_score",
  "source_trust_score",
  "commercial_trust_score",
  "ending_payoff_score",
  "competitor_parity_score",
  "competitor_surpass_score",
  "overall_media_house_score",
];

const THRESHOLDS = {
  overall_media_house_score: 78,
  competitor_parity_score: 72,
  competitor_surpass_score: 68,
  first_3_seconds_score: 70,
  title_strength_score: 70,
  script_punch_score: 70,
  motion_density_score: 70,
  sound_design_score: 65,
  mobile_readability_score: 70,
  source_lock_score: 70,
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function objectText(value) {
  return cleanText(collectStrings(value).join(" "));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function average(values = []) {
  const finite = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!finite.length) return 0;
  return clampScore(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function scoreFrom(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? clampScore(number) : fallback;
}

function words(value) {
  return cleanText(value).split(/\s+/).filter(Boolean);
}

function normalise(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function subjectAliasKeys(subject) {
  const key = normalise(subject);
  const aliases = new Set([key]);
  if (/\bgrand theft auto vi\b|\bgta vi\b|\bgta 6\b/.test(key)) {
    aliases.add("grand theft auto vi");
    aliases.add("grand theft auto 6");
    aliases.add("gta vi");
    aliases.add("gta 6");
  }
  if (/\bgrand theft auto v\b|\bgta v\b|\bgta 5\b/.test(key)) {
    aliases.add("grand theft auto v");
    aliases.add("grand theft auto 5");
    aliases.add("gta v");
    aliases.add("gta 5");
  }
  return Array.from(aliases).filter(Boolean);
}

function titleText(canonical = {}) {
  return cleanText(canonical.selected_title || canonical.public_title || canonical.canonical_title || canonical.title);
}

function platformTitles(platformManifest = {}) {
  return unique(platformOutputs(platformManifest)
    .map(platformTitle)
    .filter(Boolean));
}

function displayTitleText(canonical = {}, platformManifest = {}) {
  return platformTitles(platformManifest)[0] || titleText(canonical);
}

function canonicalWithDisplayTitle(canonical = {}, platformManifest = {}) {
  const title = displayTitleText(canonical, platformManifest);
  return title ? { ...canonical, selected_title: title, public_title: title, title } : canonical;
}

function subjectText(canonical = {}) {
  return cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.subject || canonical.game || "");
}

function firstLine(canonical = {}) {
  const explicit = cleanText(canonical.first_spoken_line || canonical.hook);
  if (explicit) return explicit;
  const script = cleanText(canonical.narration_script || canonical.full_script || "");
  return script.split(/(?<=[.!?])\s+/)[0] || script;
}

function hasSubject(text = "", subject = "") {
  const haystack = normalise(text);
  const needle = normalise(subject);
  if (!haystack || !needle || needle === "this story") return false;
  if (subjectAliasKeys(subject).some((alias) => haystack.includes(alias))) return true;
  const tokens = needle.split(/\s+/).filter((token) => token.length >= 4 && !["game", "news", "story", "the", "and", "for"].includes(token));
  return tokens.some((token) => haystack.includes(token));
}

function genericTitle(title = "") {
  const text = cleanText(title);
  return (
    /^(?:gaming news update|new gaming update|this gaming story|this story|this game|gaming update|source-backed update)$/i.test(text) ||
    /\b(?:just got a new signal|now has a real question|new reason to watch|changed the watchlist|is worth watching again)\b/i.test(text) ||
    /^this game\b/i.test(text) ||
    /\bdevelopment team included group\b/i.test(text)
  );
}

function slowOpening(text = "") {
  return /^(?:here'?s|here is|today|so|welcome|in this video|let'?s talk about)\b/i.test(cleanText(text));
}

function internalLanguage(text = "") {
  return /\b(?:source-backed update|not a blank check|invent extra details|named source confirms|wait-and-see column|reddit reaction into evidence|the useful caveat is|the safest public version is|internal qa|qa language)\b/i.test(text);
}

function consequenceLanguage(text = "") {
  return /\b(?:problem|risk|catch|warning|changed|broke|broken|revealed|confirmed|finally|pushback|why|before|after|ceiling|impact|cost|deal|launch|lands?|hits?|date|proof|payoff|trust|pressure|fight|trial|argument|balance|balanced|polish|half[- ]finished|split|splits|splitting|bloat|dangerous|delete|wins?|test|reinstall|lapsed|returning|progression|prestige|weapon prestige|zombies?|endgame|spike|peak|demand|momentum|exposes?|early[- ]access|comeback|second wave|ea\s+play|game pass|ps5|default\s+version|platform comparisons?|performance proof|jungle|combat|discovery|readability|readable|lab[- ]worthy|roster|meta|matchups?|team building|screen control|wishlist|map|jump[- ]?scares?|choices?|atmosphere|horror|ruins?|replayable|chaos|game night|family night|force powers?)\b/i.test(text);
}

function pulseHardDetail(text = "") {
  return /\b(?:chain\s+spear|dlc|arena|arenas|effects\s+spam|faster\s+fights|cleaner\s+arenas)\b/i.test(cleanText(text));
}

function audiencePullLanguage(text = "") {
  const value = cleanText(text);
  if (!value) return false;
  const hasSpecificity =
    /\b(?:\d+|[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|one|only|first|last|free|paid|delay(?:ed)?|release calendar|release window|leak(?:ed)?|launch|ending|before|after|steam peak|peak|early[- ]access|comeback|second wave|game pass|subscription|ea\s+play|ps5|footage|performance proof|platform comparisons?|default\s+version|jungle|combat|discovery|readability|readable|lab[- ]worthy|balanced|polish|roster|meta|matchups?|team building|screen control|tag fighters?|wishlist|map|custom seas|private seas|private sessions?|private mode|rule controls?|set (?:their own )?rules|jump[- ]?scares?|choices?|atmosphere|horror|force powers?|heroes?|villains?|board game|family night|game night|replayable|licensed board)\b/i.test(value) ||
    pulseHardDetail(value);
  const hasCuriosity =
    /\b(?:why|how|what|secret|hidden|real|catch|risk|problem|fight|trial|pressure|warning|trust|ceiling|broke|turns?|changed|into|test|exposes?|bet|prove|proves|wait|decid(?:e|ing|es)|argument|balance|polish|sharp|sharper|comeback|second wave)\b/i.test(value);
  return consequenceLanguage(value) && (hasSpecificity || hasCuriosity);
}

function plainNewsTitlePattern(title = "") {
  return /\b(?:scores?\s+\d+\s+on|everything we know|gets?\s+(?:a\s+)?(?:new|huge|big)\s+(?:update|trailer|date|score)|new trailer|review score|announced for)\b/i.test(
    cleanText(title),
  );
}

function titleLacksCuriosityGap(canonical = {}, platformManifest = {}) {
  const title = displayTitleText(canonical, platformManifest);
  if (!title || genericTitle(title)) return false;
  if (plainNewsTitlePattern(title)) return true;
  return !audiencePullLanguage(title);
}

function repeatedSentenceRisk(canonical = {}) {
  const sentences = cleanText(canonical.narration_script || canonical.full_script || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalise(sentence))
    .filter(Boolean);
  return new Set(sentences).size < sentences.length;
}

function platformOutputs(platformManifest = {}) {
  const outputs = platformManifest.outputs || platformManifest.platforms || {};
  if (Array.isArray(outputs)) return outputs.filter(Boolean);
  if (outputs && typeof outputs === "object") return Object.values(outputs).filter((output) => output && typeof output === "object");
  return [];
}

function platformDescription(output = {}) {
  return cleanText(output.description || output.caption || output.metadata?.description || output.metadata?.caption);
}

function articleBoilerplateCopy(text = "") {
  return /\b(?:appeared first on|advertisement|read our|read more|see at amazon|see on steam|we had the chance|at a recent press event)\b|https?:\/\/|&#\d+;|&nbsp;|\[&#\d+;\]/i.test(
    cleanText(text),
  );
}

function weakSourceHousekeepingCopy(text = "") {
  const value = cleanText(text);
  if (!value) return false;
  const housekeeping =
    /\b(?:confirmed drop|source-backed update|full source list|sources and related links|useful question|useful angle)\b|source\s*:/i.test(value);
  if (!housekeeping) return false;
  const withoutSourceAdmin = cleanText(value
    .replace(/\b(?:confirmed drop|source-backed update)\b/gi, "")
    .replace(/\b(?:the\s+)?useful\s+(?:question|angle)\s+is\b/gi, "")
    .replace(/\bsource\s*:\s*[^.]+\.?/gi, "")
    .replace(/\bsources and related links:\s*\S+/gi, "")
    .replace(/\bfull source list is on the story page\.?/gi, ""));
  const sentences = withoutSourceAdmin.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (words(withoutSourceAdmin).length < 18) return true;
  if (
    sentences.length <= 1 &&
    /\b(?:requirements?|lists?|announced|revealed|gets?|got|coming|reported|confirmed|scores?)\b/i.test(withoutSourceAdmin)
  ) {
    return true;
  }
  return !consequenceLanguage(withoutSourceAdmin) || words(withoutSourceAdmin).length < 8;
}

function descriptionAttentionBody(text = "") {
  return cleanText(text
    .replace(/\b(?:confirmed drop|source-backed update)\b/gi, "")
    .replace(/\b(?:the\s+)?useful\s+(?:question|angle)\s+is\b/gi, "")
    .replace(/\bsource\s*:\s*[^.]+\.?/gi, "")
    .replace(/\bsources and related links:\s*\S+/gi, "")
    .replace(/\bfull source list is on the story page\.?/gi, ""));
}

function viewerStakeLanguage(text = "") {
  const value = cleanText(text);
  if (!value) return false;
  const hasAudienceStake =
    /\b(?:players?|fans?|you|your|owners?|buyers?|subscribers?|pc games?|pc players?|xbox|playstation|nintendo|switch|steam|game pass|console|wishlist|demos?|campaign|storage|ssd|launch|reviews?|scores?|price|subscription|free|paid|famil(?:y|ies)|kids?|parents?|game night|motorfest|grand tour|ferrari|road trip|live service)\b/i.test(value);
  const hasConcreteHook =
    /\b(?:\d+|[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|one[- ]hour|grand tour|ferrari\s+250\s+gto|demo|trailer|campaign|storage|ssd|pc specs?|release date|review score|free trial|subscription|boss|footage|performance proof|platform comparisons?|default\s+version|map|mode|custom seas|private seas|private sessions?|private mode|rule controls?|set (?:their own )?rules|launch|delay|score|roster|meta|matchups?|team building|screen control|tag fighters?|jump[- ]?scares?|choices?|atmosphere|horror|force powers?|heroes?|villains?|board game|family night|game night|replayable|licensed board)\b/i.test(value) ||
    pulseHardDetail(value) ||
    consequenceLanguage(value);
  const hasPayoffTurn =
    /\b(?:because|so|means|turns?|turned|turning|changes?|changed|changing|wins?|loses?|exposes?|proves?|before launch|after|instead|but|whether|why|asks?|remember|judge|question|reason|wait|decid(?:e|ing|es)|argument)\b/i.test(value);
  return hasAudienceStake && hasConcreteHook && hasPayoffTurn;
}

function platformCopyTooPlain(platformManifest = {}) {
  const descriptions = platformOutputs(platformManifest)
    .map(platformDescription)
    .filter(Boolean);
  if (!descriptions.length) return false;
  return descriptions.some((description) => {
    if (articleBoilerplateCopy(description)) return true;
    if (words(description).length > 55) return true;
    if (weakSourceHousekeepingCopy(description)) return true;
    const attentionBody = descriptionAttentionBody(description);
    if (!audiencePullLanguage(attentionBody)) return true;
    if (!viewerStakeLanguage(attentionBody)) return true;
    if (words(description).length < 9 && !consequenceLanguage(description)) return true;
    return false;
  });
}

function platformTitle(output = {}) {
  return cleanText(output.title || output.metadata?.title || output.upload_title || output.short_title);
}

function platformTitlesTooPlain(platformManifest = {}, canonical = {}) {
  const titles = platformTitles(platformManifest);
  if (!titles.length) return false;
  const subject = subjectText(canonical);
  return titles.some((title) => {
    if (genericTitle(title) || plainNewsTitlePattern(title)) return true;
    if (subject && !hasSubject(title, subject)) return true;
    return !audiencePullLanguage(title);
  });
}

function firstFrameCopyCandidates(canonical = {}, platformManifest = {}) {
  const outputs = platformOutputs(platformManifest);
  const platformCovers = unique(outputs.map((output) => output.cover_frame?.headline || output.thumbnail_headline || output.cover_headline).map(cleanText));
  if (platformCovers.length) return platformCovers;
  return unique([
    canonical.first_frame_text,
    canonical.thumbnail_headline,
    canonical.suggested_thumbnail_text,
  ].map(cleanText));
}

function danglingHeadline(text = "") {
  const tokens = words(text.toLowerCase());
  const last = tokens[tokens.length - 1] || "";
  return [
    "a",
    "an",
    "the",
    "of",
    "for",
    "to",
    "into",
    "with",
    "without",
    "has",
    "have",
    "had",
    "is",
    "are",
    "was",
    "were",
    "make",
    "makes",
    "made",
    "turns",
    "turned",
    "gets",
    "get",
    "got",
    "why",
    "you",
    "your",
    "their",
    "our",
  ].includes(last);
}

function concreteThumbnailStake(text = "") {
  const value = cleanText(text);
  return pulseHardDetail(value) || /\b(?:\d+|[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|one[- ]hour|grand tour|ferrari\s+250\s+gto|problem|risk|catch|warning|pressure|fight|broke|broken|why|before|after|free|paid|delay|leak|deal|price|storage|ssd|launch|spike|demand|momentum|ea\s+play|ps5|jungle|combat|discovery|readability|roster|meta|matchups?|team building|screen control|tag fighters?|map|custom seas|private seas|private sessions?|private mode|rule controls?|diddy\s+kong|mascot\s+kart|handling|wishlist|nostalgia|roguelite|podracing|repeat[- ]run|wipeout|force powers?|heroes?|villains?|board game|family night|game night|replayable|licensed board|kids?|parents?|families|chaos|ruins?)\b/i.test(value);
}

function abstractProofCardHeadline(text = "") {
  const value = cleanText(text);
  if (!value) return false;
  return /\b(?:trust test|demo test|source lock|story guide|gameplay check|review score|update check)\b/i.test(value) && !concreteThumbnailStake(value);
}

function concreteThumbnailHardDetail(text = "") {
  const value = cleanText(text);
  return pulseHardDetail(value) || /\b(?:[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|one[- ]hour|grand tour|ferrari\s+250\s+gto|demo|demos|storage|ssd|pc port|pc specs?|free access|free trial|free weekend|price|subscription|game pass|review score|release date|launch date|delay(?:ed)?|gameplay|early access|wait[- ]?list|pre[- ]?order|reservation|hollywood|movie|film|steam ceiling|spike|demand|momentum|ea\s+play|ps5|jungle|combat|discovery|readability|roster|meta|matchups?|team building|screen control|tag fighters?|map|custom seas|private seas|private sessions?|private mode|rule controls?|diddy\s+kong|mascot\s+kart|handling|wishlist|nostalgia|roguelite|podracing|repeat[- ]run|wipeout|force powers?|heroes?|villains?|board game|family night|game night|replayable|licensed board|kids?|parents?|families|chaos|ruins?)\b/i.test(value);
}

function weakFirstFrameOrThumbnailCopy(canonical = {}, platformManifest = {}) {
  const subject = subjectText(canonical);
  const candidates = firstFrameCopyCandidates(canonical, platformManifest);
  if (!candidates.length) return false;
  return candidates.some((candidate) => {
    const normalised = normalise(candidate);
    if (!normalised) return false;
    if (/\b(?:story test|just got a new signal|now has a real question|new reason to watch|changed the watchlist)\b/i.test(candidate)) return true;
    if (/^if you haven'?t\b/i.test(cleanText(candidate))) return true;
    if (subject && normalised === normalise(subject)) return true;
    if (danglingHeadline(candidate)) return true;
    if (abstractProofCardHeadline(candidate)) return true;
    if (feedCoverTooAbstract(candidate)) return true;
    if (words(candidate).length > 7) return true;
    if (
      /\b(?:update|news|story|trailer|review|score|gameplay reveal)\b/i.test(candidate) &&
      !/\b(?:problem|risk|catch|warning|pressure|fight|trust|broke|broken|why|before|after|\d+|[0-9]+ ?gb)\b/i.test(candidate)
    ) return true;
    if (words(candidate).length <= 3 && !consequenceLanguage(candidate) && !concreteThumbnailHardDetail(candidate)) return true;
    return false;
  });
}

function feedConcreteDetail(text = "") {
  const value = cleanText(text);
  return pulseHardDetail(value) || /\b(?:\d+|[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|one[- ]hour|grand tour|ferrari\s+250\s+gto|demo|demos|storage|ssd|pc specs?|free|price|subscription|game pass|review|score|launch|release date|delay(?:ed)?|trailer|gameplay|campaign|ending|boss|footage|performance proof|platform comparisons?|default\s+version|roster|meta|matchups?|team building|screen control|tag fighters?|map|mode|custom seas|private seas|private sessions?|private mode|rule controls?|steam|xbox|playstation|ps5|switch|diddy\s+kong|mascot\s+kart|handling|wishlist|nostalgia|choices?|empathy|atmosphere|horror|jump[- ]?scares?|roguelite|podracing|repeat[- ]run|wipeout|force powers?|heroes?|villains?|board game|family night|game night|replayable|licensed board|kids?|parents?|families|chaos|ruins?)\b/i.test(value);
}

function feedTitleHardDetail(text = "") {
  const value = cleanText(text);
  return pulseHardDetail(value) || /\b(?:[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|one[- ]hour|grand tour|ferrari\s+250\s+gto|demo|demos|storage|ssd|pc specs?|pc port|free access|free trial|free weekend|price|subscription|game pass|review score|release date|launch date|delay(?:ed)?|gameplay|early access|wait[- ]?list|pre[- ]?order|reservation|hollywood|movie|film|roster|meta|matchups?|team building|screen control|tag fighters?|custom seas|private seas|private sessions?|private mode|rule controls?|diddy\s+kong|mascot\s+kart|handling|wishlist|nostalgia|roguelite|podracing|repeat[- ]run|wipeout|force powers?|heroes?|villains?|board game|family night|game night|replayable|licensed board|kids?|parents?|families|chaos|ruins?)\b/i.test(value);
}

function templateFatigueTitle(title = "") {
  const text = cleanText(title);
  if (!text) return false;
  const tiredShape = /\bhas (?:a|an|one|the) [a-z0-9' -]{0,44}(?:player trust test|trust test|risk|problem|test)\b/i.test(text);
  if (!tiredShape) return false;
  return !feedTitleHardDetail(text);
}

function feedCoverTooAbstract(text = "") {
  const value = cleanText(text);
  if (!value) return true;
  if (abstractProofCardHeadline(value)) return true;
  if (/\b(?:player\s+)?trust\s+(?:test|problem)|player test\b/i.test(value) && !concreteThumbnailHardDetail(value)) {
    return true;
  }
  if (/\b(?:player test|trust test|story test|gameplay check|source lock)\b/i.test(value) && !concreteThumbnailStake(value)) {
    return true;
  }
  return false;
}

function feedDescriptionHasSpecificPayoff(text = "") {
  const value = descriptionAttentionBody(text);
  if (!value) return false;
  if (!viewerStakeLanguage(value)) return false;
  return feedConcreteDetail(value) || /\b(?:campaign|remake|storage|wishlist|players remember|wins? the week|worth keeping installed|identity|filler|road trip|grand tour|ferrari prize|force powers?|family night|game night|replayable|board game|kids?|parents?|families)\b/i.test(value);
}

function feedCompetitionScore({ canonical = {}, platformManifest = {} } = {}) {
  const displayCanonical = canonicalWithDisplayTitle(canonical, platformManifest);
  const title = titleText(displayCanonical);
  const subject = subjectText(canonical);
  const platformTitleList = platformTitles(platformManifest);
  const firstFrames = firstFrameCopyCandidates(canonical, platformManifest);
  const descriptions = platformOutputs(platformManifest).map(platformDescription).filter(Boolean);
  const coverSet = unique(firstFrames);
  const descriptionSet = unique(descriptions);
  const blockers = [];
  let score = 0;

  if (title && hasSubject(title, subject)) score += 15;
  if (words(title).length >= 5 && words(title).length <= 11) score += 8;
  if (consequenceLanguage(title)) score += 12;
  if (audiencePullLanguage(title)) score += 8;
  if (feedConcreteDetail(title)) score += 20;
  if (templateFatigueTitle(title)) {
    score -= 28;
    blockers.push("feed_title_template_fatigue");
  }

  if (coverSet.length) {
    const weakCovers = coverSet.filter((cover) => feedCoverTooAbstract(cover) || weakFirstFrameOrThumbnailCopy(displayCanonical, { outputs: { probe: { cover_frame: { headline: cover } } } }));
    if (weakCovers.length) {
      score -= 22;
      blockers.push("feed_cover_too_abstract");
    } else {
      score += 10;
      if (coverSet.some(concreteThumbnailStake)) score += 15;
    }
  } else {
    blockers.push("feed_cover_missing");
  }

  if (descriptionSet.length) {
    const strongDescriptions = descriptionSet.filter(feedDescriptionHasSpecificPayoff);
    if (strongDescriptions.length === descriptionSet.length) score += 12;
    else blockers.push("feed_description_lacks_specific_payoff");
    if (descriptionSet.some(feedConcreteDetail)) score += 8;
    if (descriptionSet.some((description) => /\bsource\s*:/i.test(description))) score += 5;
    const badLength = descriptionSet.some((description) => {
      const count = words(description).length;
      return count < 16 || count > 48;
    });
    if (badLength) score -= 8;
  } else {
    blockers.push("feed_description_missing");
  }

  const finalScore = clampScore(score);
  const hardBlocked = finalScore < 72 || blockers.length > 0;
  return {
    schema_version: 1,
    status: hardBlocked ? "blocked" : finalScore >= 82 ? "standout" : "pass",
    score: finalScore,
    threshold: 72,
    standout_threshold: 82,
    blockers: hardBlocked ? unique(blockers.length ? blockers : ["feed_competition_score_below_threshold"]) : [],
    signals: {
      title_has_subject: title ? hasSubject(title, subject) : false,
      title_has_consequence: consequenceLanguage(title),
      title_has_concrete_detail: feedConcreteDetail(title),
      title_template_fatigue: templateFatigueTitle(title),
      cover_count: coverSet.length,
      description_count: descriptionSet.length,
    },
    title,
    platform_titles: platformTitleList,
    first_frame_or_thumbnail_copy: coverSet,
  };
}

function titleStrengthScore(canonical = {}, uniqueness = {}, platformManifest = {}) {
  const displayCanonical = canonicalWithDisplayTitle(canonical, platformManifest);
  const title = titleText(displayCanonical);
  const subject = subjectText(canonical);
  let score = 35;
  if (title && !genericTitle(title)) score += 18;
  if (hasSubject(title, subject)) score += 24;
  if (consequenceLanguage(title)) score += 18;
  if (audiencePullLanguage(title)) score += 10;
  if (titleLacksCuriosityGap(canonical, platformManifest)) score -= 26;
  if (words(title).length >= 5 && words(title).length <= 12) score += 8;
  if (asArray(uniqueness.failures).length || asArray(uniqueness.matches).length > 3) score -= 18;
  return clampScore(score);
}

function shotPlan(director = {}) {
  return asArray(director.shot_plan || director.shots || director.beats);
}

function shotStart(shot = {}) {
  const number = Number(shot.startS ?? shot.start_s ?? shot.start ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function transitionPlan(director = {}) {
  return director.transition_plan || director.sound_transition_plan?.transitions || {};
}

function sfxPlan(director = {}) {
  return director.sound_transition_plan?.sfx || director.sfx_plan || {};
}

function firstFrameScore({ visualQuality = {}, director = {} } = {}) {
  const shots = shotPlan(director);
  const visualScore = scoreFrom(visualQuality.scores?.first_3_seconds_hook_score, 55);
  const sourceScore = scoreFrom(visualQuality.scores?.source_lock_quality_score, 55);
  const startsFast = shots.some((shot) => shotStart(shot) <= 0.35);
  const motionBeforeThree = shots.some((shot) => /motion|hook|slam|proof/i.test(cleanText(shot.kind || shot.visual_treatment)) && shotStart(shot) < 3);
  return clampScore(visualScore * 0.45 + sourceScore * 0.2 + (startsFast ? 18 : 0) + (motionBeforeThree ? 17 : 0));
}

function firstThreeScore({ canonical = {}, visualQuality = {}, director = {} } = {}) {
  const subject = subjectText(canonical);
  const line = firstLine(canonical);
  let score = average([
    scoreFrom(visualQuality.scores?.first_3_seconds_hook_score, 55),
    firstFrameScore({ visualQuality, director }),
  ]);
  if (hasSubject(line, subject)) score += 12;
  if (slowOpening(line)) score -= 35;
  if (consequenceLanguage(line)) score += 8;
  if (internalLanguage(line)) score -= 25;
  return clampScore(score);
}

function scriptPunchScore({ canonical = {}, scriptScorecard = {} } = {}) {
  const script = cleanText(canonical.narration_script || canonical.full_script || "");
  let score = scoreFrom(scriptScorecard.viral_score, 72);
  if (cleanText(scriptScorecard.verdict) === "viral_ready") score += 8;
  if (cleanText(scriptScorecard.verdict) === "rewrite_required") score -= 35;
  if (asArray(scriptScorecard.blockers).length) score -= Math.min(32, asArray(scriptScorecard.blockers).length * 8);
  if (slowOpening(firstLine(canonical))) score -= 28;
  if (internalLanguage(script)) score -= 35;
  if (repeatedSentenceRisk(canonical)) score -= 20;
  if (!consequenceLanguage(script)) score -= 12;
  return clampScore(score);
}

function narrationQualityScore({ canonical = {}, audio = {} } = {}) {
  const script = cleanText(canonical.narration_script || canonical.full_script || "");
  const wordCount = words(script).length;
  let score = 45;
  if (cleanText(audio.voice_status) === "materialized") score += 18;
  if (Number(audio.word_timestamp_count || 0) > 0) score += 18;
  if (audio.mix_rules?.narration_priority === true) score += 8;
  if (wordCount >= 75 && wordCount <= 155) score += 9;
  else if (wordCount >= 35 && wordCount <= 190) score += 4;
  if (internalLanguage(script)) score -= 25;
  return clampScore(score);
}

function transitionEnergyScore({ visualQuality = {}, director = {} } = {}) {
  const plan = transitionPlan(director);
  const transitions = asArray(plan.planned);
  const families = transitions.map((entry) => cleanText(entry.family || entry.transition_family)).filter(Boolean);
  let score = scoreFrom(visualQuality.scores?.transition_energy_score, 55);
  score += Math.min(12, new Set(families).size * 3);
  if (Number(plan.max_same_family_run || plan.max_same_transition_run || 1) <= 2) score += 6;
  return clampScore(score);
}

function soundDesignScore({ visualQuality = {}, director = {}, loudness = {} } = {}) {
  const sfx = sfxPlan(director);
  const cues = asArray(sfx.cues);
  let score = scoreFrom(visualQuality.scores?.sfx_impact_score, 55);
  score += Math.min(16, Number(sfx.cue_count || cues.length || 0) * 2);
  if (cues.some((cue) => /impact|hit|whoosh|riser|slam/i.test(cleanText(cue.family || cue.role)))) score += 8;
  if (Number(sfx.max_same_family_run || 1) > 2) score -= 24;
  if (sfx.mastering?.duck_under_narration === false || sfx.mastering?.narration_priority === false) score -= 24;
  if (!["pass", "passed", "green", "ready", ""].includes(cleanText(loudness.verdict || loudness.status).toLowerCase())) score -= 22;
  if (Number(loudness.metrics?.valid_segment_count || 0) > 0 && Number(loudness.metrics?.valid_segment_count || 0) < 3) score -= 14;
  if (Number(loudness.metrics?.max_peak_db || -99) > -0.8) score -= 14;
  return clampScore(score);
}

function mobileReadabilityScore({ visualQuality = {}, director = {} } = {}) {
  const caption = scoreFrom(visualQuality.scores?.caption_legibility_score, 55);
  const source = scoreFrom(visualQuality.scores?.source_lock_quality_score, 55);
  const card = scoreFrom(visualQuality.scores?.card_hierarchy_score, 55);
  const policy = director.caption_policy || {};
  let score = average([caption, source, card]);
  if (policy.avoid_lower_third_collisions === true) score += 5;
  if (policy.avoid_lower_third_collisions === false) score -= 18;
  return clampScore(score);
}

function commercialTrustScore({ affiliate = {} } = {}) {
  const hasOffer = Boolean(affiliate.primary_link || asArray(affiliate.fallback_links).length);
  if (!hasOffer) return 82;
  const relevance = scoreFrom(affiliate.primary_link?.story_relevance ?? affiliate.relevance_score, 50);
  const disclosureRequired = affiliate.disclosure_required === true;
  const disclosurePresent = objectText(affiliate.disclosure_copy || affiliate.platform_disclosure).length > 0;
  let score = relevance;
  if (!disclosureRequired || disclosurePresent) score += 15;
  else score -= 35;
  if (/\b(?:buy now|must buy|use my link|limited time|grab yours)\b/i.test(objectText(affiliate))) score -= 30;
  if (/\b(?:crypto|forex|casino|betting|adult)\b/i.test(objectText(affiliate.primary_link))) score -= 35;
  return clampScore(score);
}

function endingPayoffScore({ canonical = {} } = {}) {
  const script = cleanText(canonical.narration_script || canonical.full_script || "");
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
  const beforeCta = sentences.filter((sentence) => !/\b(follow|subscribe|comment|like)\b/i.test(sentence)).join(" ");
  let score = 48;
  if (/\b(payoff|means|because|so |that gives|that makes|what matters|players|viewer|before launch|now has to)\b/i.test(beforeCta)) score += 28;
  if (/\b(follow pulse gaming|follow)\b/i.test(script)) score += 10;
  if (/\blet me know in the comments\b/i.test(script)) score -= 26;
  if (sentences.length >= 3) score += 8;
  return clampScore(score);
}

function brandRecognitionScore({ canonical = {}, competitorSimilarity = {} } = {}) {
  let score = 76;
  const text = cleanText(`${canonical.narration_script || ""} ${canonical.branding || ""}`);
  if (/\bpulse gaming\b/i.test(text)) score += 14;
  if (competitorSimilarity.copied_template_risk === true || Number(competitorSimilarity.max_similarity_score || 0) >= 0.88) score -= 45;
  if (competitorSimilarity.photorealistic_fake_presenter_uncertainty === true) score -= 35;
  return clampScore(score);
}

function sourceTrustScore({ canonical = {}, visualQuality = {}, benchmark = {} } = {}) {
  let score = average([
    scoreFrom(visualQuality.scores?.source_lock_quality_score, 65),
    scoreFrom(visualQuality.scores?.rights_risk_score, 70),
  ]);
  if (cleanText(canonical.primary_source || canonical.source_name)) score += 8;
  if (!["pass", "green", "ready", ""].includes(cleanText(benchmark.result || benchmark.verdict || benchmark.status).toLowerCase())) score -= 18;
  return clampScore(score);
}

function verdictFails(value) {
  return ["red", "fail", "failed", "blocked", "missing"].includes(cleanText(value).toLowerCase());
}

function hasObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}

function footageEmpireVerdict(footageEmpireV2 = {}) {
  return cleanText(
    footageEmpireV2.verdict ||
      footageEmpireV2.status ||
      footageEmpireV2.result ||
      footageEmpireV2.readiness?.status,
  );
}

function materialisedMotionReport(input = {}) {
  const report = input.materialisedMotionClips ||
    input.materializedMotionClips ||
    input.materialised_motion_clips ||
    input.materialized_motion_clips ||
    input.footageEmpireV2?.materialised_motion_clips ||
    input.footageEmpireV2?.materialized_motion_clips ||
    input.footageEmpire?.materialised_motion_clips ||
    input.footageEmpire?.materialized_motion_clips ||
    {};
  const rawClips = [
    ...asArray(report.clips),
    ...asArray(report.materialised_clips),
    ...asArray(report.materialized_clips),
    ...asArray(report.materialised_motion_clips),
    ...asArray(report.materialized_motion_clips),
  ].filter((clip) => clip && clip.counts_towards_motion_readiness !== false);
  const seenClipIds = new Set();
  const clips = [];
  for (const clip of rawClips) {
    const clipId = cleanText(clip.id || clip.clip_id || clip.asset_id);
    if (clipId) {
      if (seenClipIds.has(clipId)) continue;
      seenClipIds.add(clipId);
    }
    clips.push(clip);
  }
  const families = unique([
    ...asArray(report.distinct_motion_families),
    ...asArray(report.families),
    ...clips.map((clip) => cleanText(clip.source_family || clip.motion_family || clip.family)),
  ]);
  const directFamilies = unique(clips
    .filter((clip) => {
      const mediaKind = cleanText(clip.media_kind || clip.kind || clip.type).toLowerCase();
      const source = cleanText(clip.source_url || clip.source || clip.path);
      return (
        /direct|video|motion|trailer|gameplay/i.test(mediaKind) ||
        /\.(?:mp4|mov|m4v|webm|m3u8)(?:[?#]|$)/i.test(source) ||
        /^https?:/i.test(source)
      );
    })
    .map((clip) => cleanText(clip.source_family || clip.motion_family || clip.family))
    .filter(Boolean));
  return {
    report,
    clips,
    families,
    directFamilies,
  };
}

function clipSegmentKey(clip = {}) {
  const source = cleanText(clip.clip_hash || clip.segment_hash || clip.asset_hash || clip.path || clip.local_path || clip.source_url || clip.source);
  const start = Number(clip.start_s ?? clip.startS ?? clip.start ?? clip.in_s ?? clip.in);
  const end = Number(clip.end_s ?? clip.endS ?? clip.end ?? clip.out_s ?? clip.out);
  const roundedStart = Number.isFinite(start) ? start.toFixed(1) : "";
  const roundedEnd = Number.isFinite(end) ? end.toFixed(1) : "";
  return normalise(`${source} ${roundedStart} ${roundedEnd}`);
}

function sourceFamilyKey(clip = {}) {
  return normalise(clip.source_family || clip.motion_family || clip.family || clip.source_url || clip.path || clip.source);
}

function directMotionRepeatReport(input = {}) {
  const materialised = materialisedMotionReport(input);
  const clips = materialised.clips;
  const segmentKeys = clips.map(clipSegmentKey).filter(Boolean);
  const uniqueSegments = unique(segmentKeys);
  const familyKeys = clips.map(sourceFamilyKey).filter(Boolean);
  const familyCounts = new Map();
  for (const family of familyKeys) familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  const topFamilyCount = familyCounts.size ? Math.max(...familyCounts.values()) : 0;
  const topFamilyShare = clips.length ? topFamilyCount / clips.length : 0;
  const blockers = [];
  if (clips.length >= 4 && uniqueSegments.length < segmentKeys.length) {
    blockers.push("premium_output:repeated_motion_segments");
  }
  if (clips.length >= 6 && uniqueSegments.length / clips.length < 0.72) {
    blockers.push("premium_output:motion_segment_diversity_too_low");
  }
  if (clips.length >= 6 && topFamilyShare > 0.6 && unique(familyKeys).length < 3 && uniqueSegments.length / clips.length < 0.85) {
    blockers.push("premium_output:motion_family_dominance");
  }
  return {
    status: blockers.length ? "blocked" : "pass",
    blockers,
    evidence: {
      clip_count: clips.length,
      unique_segment_count: uniqueSegments.length,
      distinct_family_count: unique(familyKeys).length,
      top_family_share: Number(topFamilyShare.toFixed(3)),
    },
  };
}

function steamAppIdForMotionClip(clip = {}) {
  const text = [
    clip.store_app_id,
    clip.steam_app_id,
    clip.source_family,
    clip.motion_family,
    clip.source_url,
    clip.url,
    clip.path,
  ].map(cleanText).join(" ").replace(/\\/g, "/");
  const match =
    text.match(/store_trailers\/(\d{3,})(?:\/|\b)/i) ||
    text.match(/\bsteam[_:-](\d{3,})(?:[_:/-]|\b)/i);
  return match ? match[1] : "";
}

function multiEntityMotionCoverageReport(input = {}) {
  const canonical = input.canonical || {};
  const declaredEntities = unique([
    ...asArray(canonical.visual_entities),
    ...asArray(canonical.game_entities),
    ...asArray(canonical.mentioned_games),
  ].map(cleanText).filter(Boolean));
  const angle = cleanText(canonical.canonical_angle);
  const required = declaredEntities.length >= 2 ||
    /\bmultiple(?:\s+[a-z0-9-]+){0,4}\s+(?:games?|drops?|titles?|releases?)\b/i.test(angle) ||
    /\b(?:three|four|five|six|\d+)\s+(?:games?|titles?|releases?)\b/i.test(angle);
  const clips = materialisedMotionReport(input).clips;
  const entities = new Set();
  for (const clip of clips) {
    const namedEntity = cleanText(
      clip.game_title ||
        clip.product_title ||
        clip.app_title ||
        clip.subject ||
        clip.entity,
    ).toLowerCase();
    if (namedEntity) {
      entities.add(`title:${namedEntity}`);
      continue;
    }
    const appId = steamAppIdForMotionClip(clip);
    if (appId) entities.add(`steam:${appId}`);
  }
  const blockers = required && entities.size < 2
    ? ["premium_output:multi_entity_motion_coverage_missing"]
    : [];
  return {
    status: blockers.length ? "blocked" : "pass",
    blockers,
    required,
    minimum_visual_entities: required ? 2 : 1,
    declared_visual_entities: declaredEntities,
    distinct_visual_entities: entities.size,
    visual_entities: [...entities].sort(),
  };
}

function distinctMotionFamilyProof(input = {}) {
  const report = input.distinctMotionFamily ||
    input.distinctMotionFamilyReport ||
    input.distinct_motion_family_report ||
    input.footageEmpireV2?.distinct_motion_family_report ||
    input.footageEmpire?.distinct_motion_family_report ||
    {};
  const materialised = materialisedMotionReport(input);
  const summary = report.summary || {};
  const status = cleanText(report.status || report.verdict || report.result).toLowerCase();
  const minimum = Number(
    summary.minimum_required_distinct_motion_families ||
      report.minimum_required_distinct_motion_families ||
      4,
  );
  const families = Number(
    summary.distinct_motion_family_count ||
      report.distinct_motion_family_count ||
      asArray(report.distinct_motion_families).length ||
      asArray(report.families).length ||
      materialised.families.length ||
      0,
  );
  const directFamilies = Number(
    summary.direct_video_motion_family_count ||
      report.direct_video_motion_family_count ||
      materialised.directFamilies.length ||
      0,
  );
  const clips = Number(
    summary.clip_count ||
      report.clip_count ||
      summary.motion_clip_count ||
      report.motion_clip_count ||
      materialised.clips.length ||
      0,
  );
  const materialisedStatus = cleanText(materialised.report.status || materialised.report.verdict || materialised.report.result).toLowerCase();
  const readyStatus = ["ready", "pass", "green"].includes(status) ||
    ["ready", "pass", "green"].includes(materialisedStatus) ||
    (materialised.clips.length >= minimum && materialised.families.length >= minimum && materialised.directFamilies.length >= minimum);
  return {
    present: hasObject(report) || hasObject(materialised.report),
    ready: readyStatus && families >= minimum && directFamilies >= minimum && clips >= minimum,
    status: status || materialisedStatus,
    minimum,
    families,
    directFamilies,
    clips,
  };
}

function shotDuration(shot = {}) {
  const number = Number(shot.durationS ?? shot.duration_s ?? shot.duration ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function shotKind(shot = {}) {
  return cleanText(`${shot.kind || ""} ${shot.type || ""} ${shot.label || ""} ${shot.source_family || ""} ${shot.visual_treatment || ""}`);
}

function isSourceCardShot(shot = {}) {
  const explicitKind = cleanText(shot.kind || shot.type).toLowerCase();
  if (explicitKind) {
    return /^(?:source|source[_\s-]?(?:lock|card))$/.test(explicitKind);
  }
  return /\bsource[_\s-]?(?:lock|card)\b/i.test(shotKind(shot));
}

function cardTimingReport(input = {}) {
  const shots = shotPlan(input.director || {});
  const cardShots = shots.filter((shot) =>
    !/motion_clip/i.test(cleanText(shot.kind || shot.type)) &&
    /card|source_lock|proof|hyperframes/i.test(shotKind(shot)));
  const sourceCards = cardShots.filter(isSourceCardShot);
  const readableCards = cardShots.filter((shot) => !sourceCards.includes(shot));
  const blockers = [];
  const sourceCardDwell = sourceCards.map((shot) => shotDuration(shot)).filter((duration) => duration > 0);
  const cardDwell = cardShots.map((shot) => shotDuration(shot)).filter((duration) => duration > 0);
  const readableCardDwell = readableCards.map((shot) => shotDuration(shot)).filter((duration) => duration > 0);
  if (sourceCardDwell.some((duration) => duration > SOURCE_CARD_TIMING.maximum_visible_duration_s)) {
    blockers.push("premium_output:source_card_dwell_too_long");
  }
  if (readableCardDwell.some((duration) => duration > 0 && duration < 1.6)) {
    blockers.push("premium_output:hyperframe_card_too_fast_to_read");
  }
  if (sourceCards.some((shot) =>
    shotStart(shot) <= 0.5 &&
    shotDuration(shot) > SOURCE_CARD_TIMING.maximum_visible_duration_s
  )) {
    blockers.push("premium_output:source_card_steals_first_three_seconds");
  }
  return {
    status: blockers.length ? "blocked" : "pass",
    blockers,
    evidence: {
      card_count: cardShots.length,
      source_card_count: sourceCards.length,
      max_source_card_dwell_s: sourceCardDwell.length ? Math.max(...sourceCardDwell) : null,
      min_card_dwell_s: cardDwell.length ? Math.min(...cardDwell) : null,
    },
  };
}

function renderManifestReport(input = {}) {
  const manifest = input.renderManifest || input.render_manifest || input.visualRenderManifest || input.visual_render_manifest || {};
  const finalFlag = manifest.final_publish_render ?? manifest.finalPublishRender ?? input.canonical?.final_publish_render;
  const bytes = Number(manifest.output_bytes ?? manifest.bytes ?? manifest.file_size_bytes ?? input.canonical?.final_render_bytes);
  const blockers = [];
  if (finalFlag === false) blockers.push("premium_output:final_publish_render_not_proven");
  return {
    status: blockers.length ? "blocked" : "pass",
    blockers,
    evidence: {
      final_publish_render: finalFlag ?? null,
      output_bytes: Number.isFinite(bytes) ? bytes : null,
      output_path: cleanText(manifest.output_path || manifest.path || input.canonical?.final_render_path) || null,
    },
  };
}

function captionDisplayText(input = {}) {
  return objectText([
    input.captionQa,
    input.captionQA,
    input.caption_qa,
    input.captions,
    input.captionManifest,
    input.caption_manifest,
  ]);
}

function captionDisplayReport(input = {}) {
  const text = captionDisplayText(input);
  const blockers = [];
  if (/\bG\s*T\s*A\s+(?:six|6|SIX)\b/i.test(text)) blockers.push("premium_output:caption_display_not_platform_native");
  if (/\bGTA\s+s(?:i|ee|uh|ize)[-\s,]*(?:six|6)\b/i.test(text)) blockers.push("premium_output:caption_display_not_platform_native");
  if (/\btwenty\s+twenty\s+(?:six|seven|eight|nine)\b/i.test(text)) blockers.push("premium_output:caption_display_not_platform_native");
  if (/\bPlayStation\s+Five\b/i.test(text)) blockers.push("premium_output:caption_display_not_platform_native");
  return {
    status: blockers.length ? "blocked" : "pass",
    blockers: unique(blockers),
    evidence: {
      checked: Boolean(text),
      sample: text ? text.slice(0, 180) : "",
    },
  };
}

function buildPremiumOutputContract(input = {}) {
  const cardTiming = cardTimingReport(input);
  const motionRepeats = directMotionRepeatReport(input);
  const multiEntityMotionCoverage = multiEntityMotionCoverageReport(input);
  const render = renderManifestReport(input);
  const captions = captionDisplayReport(input);
  const blockers = unique([
    ...cardTiming.blockers,
    ...motionRepeats.blockers,
    ...multiEntityMotionCoverage.blockers,
    ...render.blockers,
    ...captions.blockers,
  ]);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    status: blockers.length ? "blocked" : "pass",
    blockers,
    checks: {
      card_timing: cardTiming,
      direct_motion_repeats: motionRepeats,
      multi_entity_motion_coverage: multiEntityMotionCoverage,
      final_render: render,
      caption_display: captions,
    },
    operating_rule:
      "Premium Pulse output must open fast, avoid repeated footage, keep proof/source cards brief and readable, prove a final publish render and display platform-native captions.",
  };
}

function premiumOutputHardFailures(input = {}) {
  const contract = buildPremiumOutputContract(input);
  const failures = [];
  if (contract.blockers.includes("premium_output:source_card_dwell_too_long") ||
    contract.blockers.includes("premium_output:source_card_steals_first_three_seconds")) {
    failures.push("media_house:source_card_kills_momentum");
  }
  if (contract.blockers.includes("premium_output:hyperframe_card_too_fast_to_read")) {
    failures.push("media_house:hyperframe_card_too_fast_to_read");
  }
  if (contract.blockers.includes("premium_output:repeated_motion_segments") ||
    contract.blockers.includes("premium_output:motion_segment_diversity_too_low") ||
    contract.blockers.includes("premium_output:motion_family_dominance")) {
    failures.push("media_house:direct_motion_repeats_too_much");
  }
  if (contract.blockers.includes("premium_output:multi_entity_motion_coverage_missing")) {
    failures.push("media_house:multi_entity_motion_coverage_missing");
  }
  if (contract.blockers.includes("premium_output:final_publish_render_not_proven")) {
    failures.push("media_house:final_publish_render_not_proven");
  }
  if (contract.blockers.includes("premium_output:caption_display_not_platform_native")) {
    failures.push("media_house:caption_display_not_platform_native");
  }
  return failures;
}

function isStaleDistinctSourceBlocker(blocker) {
  return cleanText(blocker) === "distinct_motion_source_assets_minimum_not_met";
}

function footageEmpireBlockers(footageEmpireV2 = {}, input = {}) {
  const rights = footageEmpireV2.rights_coverage || {};
  const distinctProof = input.distinctProof || distinctMotionFamilyProof(input);
  let blockers = [
    ...asArray(footageEmpireV2.blockers),
    ...asArray(footageEmpireV2.hard_failures),
    ...asArray(footageEmpireV2.readiness?.blockers),
    ...asArray(rights.blockers),
  ];
  if (distinctProof.ready) {
    blockers = blockers.filter((blocker) => !isStaleDistinctSourceBlocker(blocker));
  }
  return unique(blockers);
}

function sourceLockScore({
  canonical = {},
  visualQuality = {},
  benchmark = {},
  footageEmpireV2 = {},
  distinctMotionFamily = {},
  distinctMotionFamilyReport = {},
  distinct_motion_family_report = {},
  materialisedMotionClips = {},
  materializedMotionClips = {},
  materialised_motion_clips = {},
  materialized_motion_clips = {},
} = {}) {
  let score = average([
    scoreFrom(visualQuality.scores?.source_lock_quality_score, 65),
    scoreFrom(visualQuality.scores?.rights_risk_score, 70),
    scoreFrom(benchmark.scores?.source_lock_quality_score, visualQuality.scores?.source_lock_quality_score ?? 65),
  ]);
  if (cleanText(canonical.primary_source || canonical.source_name)) score += 6;

  if (hasObject(footageEmpireV2)) {
    const distinctProof = distinctMotionFamilyProof({
      distinctMotionFamily,
      distinctMotionFamilyReport,
      distinct_motion_family_report,
      materialisedMotionClips,
      materializedMotionClips,
      materialised_motion_clips,
      materialized_motion_clips,
      footageEmpireV2,
    });
    const motion = footageEmpireV2.motion || footageEmpireV2.motion_budget || {};
    const trustedSources = footageEmpireV2.trusted_sources || footageEmpireV2.trusted_source_pipeline || {};
    const rights = footageEmpireV2.rights_coverage || {};
    const verdict = footageEmpireVerdict(footageEmpireV2);
    const blockers = footageEmpireBlockers(footageEmpireV2, { distinctProof });
    const rawReadiness = cleanText(footageEmpireV2.readiness?.status || verdict).toLowerCase();
    const readiness = distinctProof.ready && !blockers.length && verdictFails(rawReadiness)
      ? "v4_motion_ready"
      : rawReadiness;
    const motionClips = Number(
      motion.available_motion_clips ||
        motion.available_official_product_motion_clips ||
        motion.availableMotionClips ||
        distinctProof.clips ||
        0,
    );
    const motionFamilies = Number(
      motion.available_distinct_families ||
        motion.available_official_product_motion_families ||
        motion.availableDistinctFamilies ||
        distinctProof.families ||
        0,
    );
    const trustedRefs = Number(
      trustedSources.references_found ||
        trustedSources.story_candidate_count ||
        trustedSources.validated_local_motion_trust_references ||
        trustedSources.registry_references_found ||
        distinctProof.directFamilies ||
        0,
    );
    const rightsPass = ["pass", "green", "ready"].includes(cleanText(rights.verdict || rights.status).toLowerCase()) ||
      readiness === "v4_motion_ready" ||
      distinctProof.ready;

    if (motionClips >= 3) score += 8;
    else if (motionClips > 0) score += 3;
    else score -= 24;

    if (motionFamilies >= 2) score += 5;
    else if (motionFamilies === 0) score -= 12;

    if (trustedRefs > 0) score += 8;
    else score -= 22;

    if (rightsPass) score += 5;
    if (blockers.length) score -= Math.min(35, blockers.length * 14);
    if (readiness === "v4_motion_ready" && !blockers.length && motionClips >= 3 && trustedRefs > 0) {
      score += 10;
    }
    if ((verdictFails(verdict) || readiness === "v4_motion_blocked") && (!distinctProof.ready || blockers.length)) {
      score = Math.min(score, 45);
    }
  }

  return clampScore(score);
}

function buildScores(input = {}) {
  const canonical = input.canonical || {};
  const displayCanonical = canonicalWithDisplayTitle(canonical, input.platformManifest || {});
  const visualQuality = input.visualQuality || {};
  const director = input.director || {};
  const platformManifest = input.platformManifest || {};
  const scores = {
    title_strength_score: titleStrengthScore(canonical, input.uniqueness || {}, platformManifest),
    first_frame_score: firstFrameScore({ visualQuality, director }),
    first_3_seconds_score: firstThreeScore({ canonical, visualQuality, director }),
    script_punch_score: scriptPunchScore({ canonical, scriptScorecard: input.scriptScorecard || {} }),
    narration_quality_score: narrationQualityScore({ canonical, audio: input.audio || {} }),
    motion_density_score: scoreFrom(visualQuality.scores?.motion_density_score, 55),
    transition_energy_score: transitionEnergyScore({ visualQuality, director }),
    sound_design_score: soundDesignScore({ visualQuality, director, loudness: input.loudness || {} }),
    mobile_readability_score: mobileReadabilityScore({ visualQuality, director }),
    brand_recognition_score: brandRecognitionScore({ canonical, competitorSimilarity: input.competitorSimilarity || {} }),
    source_lock_score: sourceLockScore({
      canonical,
      visualQuality,
      benchmark: input.benchmark || {},
      footageEmpireV2: input.footageEmpireV2 || input.footageEmpire || {},
      distinctMotionFamily: input.distinctMotionFamily,
      distinctMotionFamilyReport: input.distinctMotionFamilyReport,
      distinct_motion_family_report: input.distinct_motion_family_report,
      materialisedMotionClips: input.materialisedMotionClips,
      materializedMotionClips: input.materializedMotionClips,
      materialised_motion_clips: input.materialised_motion_clips,
      materialized_motion_clips: input.materialized_motion_clips,
    }),
    source_trust_score: sourceTrustScore({ canonical, visualQuality, benchmark: input.benchmark || {} }),
    commercial_trust_score: commercialTrustScore({ affiliate: input.affiliate || {} }),
    ending_payoff_score: endingPayoffScore({ canonical }),
  };
  if (platformCopyTooPlain(platformManifest)) {
    scores.title_strength_score = Math.min(scores.title_strength_score, 62);
  }
  if (titleLacksCuriosityGap(canonical, platformManifest) || platformTitlesTooPlain(platformManifest, canonical)) {
    scores.title_strength_score = Math.min(scores.title_strength_score, 64);
  }
  if (weakFirstFrameOrThumbnailCopy(displayCanonical, platformManifest)) {
    scores.first_frame_score = Math.min(scores.first_frame_score, 52);
  }
  scores.competitor_parity_score = average([
    scores.title_strength_score,
    scores.first_frame_score,
    scores.first_3_seconds_score,
    scores.script_punch_score,
    scores.motion_density_score,
    scores.transition_energy_score,
    scores.sound_design_score,
    scores.mobile_readability_score,
    scores.source_lock_score,
    scores.source_trust_score,
  ]);
  scores.competitor_surpass_score = average([
    scores.competitor_parity_score,
    scores.brand_recognition_score,
    scores.source_lock_score,
    scores.ending_payoff_score,
    scores.commercial_trust_score,
  ]);
  scores.overall_media_house_score = average([
    scores.title_strength_score,
    scores.first_frame_score,
    scores.first_3_seconds_score,
    scores.script_punch_score,
    scores.narration_quality_score,
    scores.motion_density_score,
    scores.transition_energy_score,
    scores.sound_design_score,
    scores.mobile_readability_score,
    scores.brand_recognition_score,
    scores.source_lock_score,
    scores.source_trust_score,
    scores.commercial_trust_score,
    scores.ending_payoff_score,
    scores.competitor_parity_score,
    scores.competitor_surpass_score,
  ]);
  return scores;
}

function commercialRouteBad(affiliate = {}) {
  const hasOffer = Boolean(affiliate.primary_link || asArray(affiliate.fallback_links).length);
  if (!hasOffer) return false;
  const relevanceScores = [
    affiliate.primary_link?.story_relevance,
    affiliate.primary_link?.relevance_score,
    affiliate.relevance_score,
    ...asArray(affiliate.fallback_links).flatMap((link) => [
      link.story_relevance,
      link.relevance_score,
      link.affiliate_score,
    ]),
  ].map((value) => scoreFrom(value, null)).filter((value) => value != null);
  const bestRelevance = relevanceScores.length ? Math.max(...relevanceScores) : 0;
  if (bestRelevance < 40) return true;
  if (affiliate.disclosure_required === true && !objectText(affiliate.disclosure_copy || affiliate.platform_disclosure)) return true;
  return /\b(?:buy now|must buy|use my link|limited time|grab yours)\b/i.test(objectText(affiliate));
}

function hardFailures(input = {}, scores = {}) {
  const canonical = input.canonical || {};
  const platformManifest = input.platformManifest || {};
  const displayCanonical = canonicalWithDisplayTitle(canonical, platformManifest);
  const visualQuality = input.visualQuality || {};
  const competitorSimilarity = input.competitorSimilarity || {};
  const feedCompetition = buildShortsFeedCompetitionReport(input);
  const failures = [];
  const canonicalTitle = titleText(canonical);
  const title = titleText(displayCanonical);
  const subject = subjectText(canonical);
  const line = firstLine(canonical);
  const visualProfile = visualQuality.visual_evidence_profile || {};
  if (genericTitle(canonicalTitle) || genericTitle(title)) failures.push("media_house:generic_title");
  if (titleLacksCuriosityGap(canonical) || titleLacksCuriosityGap(canonical, platformManifest)) {
    failures.push("media_house:title_lacks_curiosity_gap");
  }
  if (subject && title && !hasSubject(title, subject)) failures.push("media_house:source_title_mismatch");
  if (platformTitlesTooPlain(platformManifest, canonical)) failures.push("media_house:platform_title_too_plain");
  if (platformCopyTooPlain(platformManifest)) failures.push("media_house:platform_copy_too_plain");
  if (weakFirstFrameOrThumbnailCopy(displayCanonical, platformManifest)) failures.push("media_house:first_frame_or_thumbnail_not_attention_led");
  if (feedCompetition.status === "blocked") failures.push("media_house:shorts_feed_competition_weak");
  if (scores.overall_media_house_score < THRESHOLDS.overall_media_house_score) failures.push("media_house:overall_score_below_threshold");
  if (scores.competitor_parity_score < THRESHOLDS.competitor_parity_score) failures.push("media_house:competitor_parity_below_threshold");
  if (scores.first_3_seconds_score < THRESHOLDS.first_3_seconds_score || slowOpening(line)) failures.push("media_house:first_3_seconds_weak");
  if (
    visualProfile.generated_only_motion_deck === true ||
    scores.motion_density_score < THRESHOLDS.motion_density_score ||
    scoreFrom(visualQuality.scores?.media_house_polish_score, 80) < 65
  ) failures.push("media_house:visuals_look_templated");
  if (scores.script_punch_score < THRESHOLDS.script_punch_score || slowOpening(line) || internalLanguage(objectText(canonical))) {
    failures.push("media_house:script_sounds_ai_generic");
  }
  if (scores.mobile_readability_score < THRESHOLDS.mobile_readability_score) failures.push("media_house:mobile_text_unreadable");
  if (scores.source_lock_score < THRESHOLDS.source_lock_score || footageEmpireBlockers(input.footageEmpireV2 || input.footageEmpire || {}, input).length) {
    failures.push("media_house:source_lock_not_verified");
  }
  if (scores.sound_design_score < THRESHOLDS.sound_design_score) failures.push("media_house:poor_sfx_audio");
  if (scores.transition_energy_score < 55) failures.push("media_house:bad_visual_rhythm");
  failures.push(...premiumOutputHardFailures(input));
  if (competitorSimilarity.copied_template_risk === true || Number(competitorSimilarity.max_similarity_score || 0) >= 0.88) {
    failures.push("media_house:competitor_mimicry_risk");
  }
  if (commercialRouteBad(input.affiliate || {})) failures.push("media_house:commercial_route_not_trustworthy");
  return unique(failures);
}

function buildSourceLockReport(input = {}, score = {}) {
  const footageEmpireV2 = input.footageEmpireV2 || input.footageEmpire || {};
  const distinctProof = distinctMotionFamilyProof(input);
  const blockers = footageEmpireBlockers(footageEmpireV2, { distinctProof });
  const verdict = footageEmpireVerdict(footageEmpireV2);
  const scoreValue = score.scores?.source_lock_score || 0;
  const blocked = scoreValue < THRESHOLDS.source_lock_score ||
    blockers.length > 0 ||
    (verdictFails(verdict) && !distinctProof.ready);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    status: blocked ? "blocked" : "pass",
    threshold: THRESHOLDS.source_lock_score,
    score: scoreValue,
    blockers,
    warnings: asArray(footageEmpireV2.warnings),
    evidence: {
      visual_source_lock_score: scoreFrom(input.visualQuality?.scores?.source_lock_quality_score, null),
      visual_rights_risk_score: scoreFrom(input.visualQuality?.scores?.rights_risk_score, null),
      footage_empire_v2_present: hasObject(footageEmpireV2),
      footage_empire_v2_verdict: verdict || null,
      motion_ready: footageEmpireV2.motion?.ready ?? null,
      trusted_reference_count: Number(footageEmpireV2.trusted_sources?.references_found || 0),
      rights_coverage_verdict: cleanText(footageEmpireV2.rights_coverage?.verdict || footageEmpireV2.rights_coverage?.status) || null,
      distinct_motion_family_proof_ready: distinctProof.ready,
      distinct_motion_family_count: distinctProof.families,
      direct_video_motion_family_count: distinctProof.directFamilies,
    },
  };
}

function productionGrammarCategories(input = {}) {
  const grammarCategories = asArray(input.productionGrammar?.categories || input.production_grammar_patterns?.categories);
  if (grammarCategories.length) return grammarCategories;
  const ruleCategories = asArray(input.rulebook?.rules).map((rule) => ({
    category: cleanText(rule.category),
    quality_signal: cleanText(rule.score_key),
    copied_asset_storage: false,
    original_pulse_rule_required: true,
  })).filter((rule) => rule.category && rule.quality_signal);
  if (ruleCategories.length) return ruleCategories;
  return [
    { category: "title", quality_signal: "title_strength_score" },
    { category: "hook", quality_signal: "first_3_seconds_score" },
    { category: "first_frame", quality_signal: "first_frame_score" },
    { category: "script", quality_signal: "script_punch_score" },
    { category: "motion", quality_signal: "motion_density_score" },
    { category: "sfx_transition", quality_signal: "sound_design_score" },
    { category: "source_lock", quality_signal: "source_lock_score" },
    { category: "caption_style", quality_signal: "mobile_readability_score" },
    { category: "brand", quality_signal: "brand_recognition_score" },
    { category: "payoff", quality_signal: "ending_payoff_score" },
    { category: "competitor_parity", quality_signal: "competitor_parity_score" },
    { category: "competitor_surpass", quality_signal: "competitor_surpass_score" },
  ];
}

function buildProductionGrammarAlignmentReport(input = {}, score = {}) {
  const scores = score.scores || {};
  const categories = productionGrammarCategories(input).map((category) => {
    const key = cleanText(category.quality_signal || category.score_key);
    const supported = SCORE_KEYS.includes(key);
    return {
      category: cleanText(category.category),
      quality_signal: key,
      score: supported ? scores[key] ?? null : null,
      status: supported ? "scored" : "external_signal",
      copied_asset_storage: category.copied_asset_storage === true ? true : false,
      original_pulse_rule_required: category.original_pulse_rule_required !== false,
    };
  });
  const blockers = [];
  if (categories.some((category) => category.copied_asset_storage === true)) blockers.push("production_grammar:copied_asset_storage_not_allowed");
  const requiredSignals = [
    "title_strength_score",
    "first_frame_score",
    "first_3_seconds_score",
    "script_punch_score",
    "motion_density_score",
    "sound_design_score",
    "source_lock_score",
    "mobile_readability_score",
    "brand_recognition_score",
    "ending_payoff_score",
    "competitor_parity_score",
    "competitor_surpass_score",
  ];
  const missing = requiredSignals.filter((key) => !Object.prototype.hasOwnProperty.call(scores, key));
  if (missing.length) blockers.push("production_grammar:required_score_signal_missing");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    status: blockers.length ? "blocked" : "pass",
    categories,
    scored_signal_count: categories.filter((category) => category.status === "scored").length,
    external_signal_count: categories.filter((category) => category.status === "external_signal").length,
    missing_required_signals: missing,
    blockers,
    extraction_policy: "production_grammar_only_no_competitor_assets_or_transcripts",
  };
}

function buildCompetitorParityReport(score = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    status: score.scores?.competitor_parity_score >= THRESHOLDS.competitor_parity_score ? "pass" : "blocked",
    threshold: THRESHOLDS.competitor_parity_score,
    score: score.scores?.competitor_parity_score || 0,
    blockers: asArray(score.hard_failures).filter((failure) => /parity|first_3_seconds|templated|generic|readable|rhythm/.test(failure)),
  };
}

function buildCompetitorSurpassReport(score = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    status: score.scores?.competitor_surpass_score >= THRESHOLDS.competitor_surpass_score ? "pass" : "needs_lift",
    threshold: THRESHOLDS.competitor_surpass_score,
    score: score.scores?.competitor_surpass_score || 0,
    lift_targets: SCORE_KEYS.filter((key) => key.endsWith("_score") && (score.scores?.[key] || 0) < 75),
  };
}

function buildShortsAttentionReport(input = {}, score = {}) {
  const canonical = input.canonical || {};
  const platformManifest = input.platformManifest || {};
  const displayCanonical = canonicalWithDisplayTitle(canonical, platformManifest);
  const title = titleText(displayCanonical);
  const platformTitleList = platformTitles(platformManifest);
  const firstFrames = firstFrameCopyCandidates(displayCanonical, platformManifest);
  const descriptions = platformOutputs(platformManifest).map(platformDescription).filter(Boolean);
  const blockers = [];
  if (genericTitle(title)) blockers.push("generic_title");
  if (titleLacksCuriosityGap(canonical, platformManifest)) blockers.push("title_lacks_curiosity_gap");
  if (platformTitlesTooPlain(platformManifest, canonical)) blockers.push("platform_title_too_plain");
  if (platformCopyTooPlain(platformManifest)) blockers.push("platform_copy_too_plain");
  if (weakFirstFrameOrThumbnailCopy(displayCanonical, platformManifest)) {
    blockers.push("first_frame_or_thumbnail_not_attention_led");
  }
  return {
    schema_version: 1,
    status: blockers.length ? "blocked" : "pass",
    blockers: unique(blockers),
    title,
    platform_titles: platformTitleList,
    first_frame_or_thumbnail_copy: firstFrames,
    description_count: descriptions.length,
    title_attention_led: title ? audiencePullLanguage(title) && !titleLacksCuriosityGap(canonical, platformManifest) : false,
    platform_titles_attention_led:
      platformTitleList.length > 0 && !platformTitlesTooPlain(platformManifest, canonical),
    first_frame_attention_led:
      firstFrames.length > 0 && !weakFirstFrameOrThumbnailCopy(displayCanonical, platformManifest),
    scores: {
      title_strength_score: score.scores?.title_strength_score || 0,
      first_frame_score: score.scores?.first_frame_score || 0,
      first_3_seconds_score: score.scores?.first_3_seconds_score || 0,
    },
  };
}

function buildShortsFeedCompetitionReport(input = {}) {
  return feedCompetitionScore({
    canonical: input.canonical || {},
    platformManifest: input.platformManifest || {},
  });
}

function buildUpdatedControlTowerRules() {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    ruleset: "pulse_media_house_control_tower_rules_v1",
    required_artifact: "pulse_media_house_score.json",
    hard_fail_inputs: [
      "overall_media_house_score below threshold",
      "competitor_parity_score below threshold",
      "first 3 seconds weak",
      "visuals look templated",
      "script sounds AI or generic",
      "mobile text unreadable",
      "source lock not verified",
      "source/title mismatch",
      "title lacks curiosity gap or platform-native stakes",
      "plain platform title/description copy",
      "subject-only or dangling thumbnail/first-frame text",
      "weak Shorts feed-competition title/cover/description package",
      "source/proof cards that dwell too long or steal opening momentum",
      "HyperFrames cards too quick to read",
      "repeated direct-motion segments or over-dominant clip families",
      "missing final publish-render proof",
      "caption display text such as G T A SIX, twenty twenty six or PlayStation Five",
      "competitor mimicry risk",
    ],
    no_publish_side_effects: true,
  };
}

function buildUpgradedQualityGateReport(score = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    verdict: score.verdict,
    status: score.status,
    hard_failures: score.hard_failures,
    score_summary: score.scores,
    gate_thresholds: score.thresholds,
  };
}

function buildPulseMediaHouseScore(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const scores = buildScores(input);
  const failures = hardFailures(input, scores);
  const verdict = failures.length ? "RED" : scores.overall_media_house_score >= 86 ? "GREEN" : "AMBER";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    story_id: cleanText(input.story_id || input.canonical?.story_id || input.canonical?.id || null) || null,
    verdict,
    status: verdict === "RED" ? "fail" : "pass",
    scores,
    thresholds: THRESHOLDS,
    hard_failures: failures,
    warnings: [],
    source_method: "competitor_informed_pulse_original_quality_rules",
    competitor_similarity: input.competitorSimilarity || {},
    safety: {
      no_live_publish: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_competitor_assets_copied: true,
      internal_research_only: true,
    },
  };
  report.source_lock_report = buildSourceLockReport(input, report);
  report.production_grammar_alignment_report = buildProductionGrammarAlignmentReport(input, report);
  report.competitor_parity_report = buildCompetitorParityReport(report);
  report.competitor_surpass_report = buildCompetitorSurpassReport(report);
  report.shorts_attention_report = buildShortsAttentionReport(input, report);
  report.shorts_feed_competition_report = buildShortsFeedCompetitionReport(input);
  report.premium_output_contract = buildPremiumOutputContract(input);
  report.upgraded_quality_gate_report = buildUpgradedQualityGateReport(report);
  report.updated_control_tower_rules = buildUpdatedControlTowerRules();
  return report;
}

module.exports = {
  GOAL_ID,
  SCORE_KEYS,
  THRESHOLDS,
  buildCompetitorParityReport,
  buildCompetitorSurpassReport,
  buildPulseMediaHouseScore,
  buildUpdatedControlTowerRules,
  buildUpgradedQualityGateReport,
  _private: {
    genericTitle,
    hasSubject,
    slowOpening,
    titleStrengthScore,
    platformCopyTooPlain,
    platformTitlesTooPlain,
    titleLacksCuriosityGap,
    weakFirstFrameOrThumbnailCopy,
    buildShortsFeedCompetitionReport,
    buildPremiumOutputContract,
  },
};
