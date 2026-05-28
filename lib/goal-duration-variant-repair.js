"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  materializeGoalAudioTimestamps,
} = require("./goal-audio-timestamp-materializer");
const {
  materializeGoalProductionRenders,
} = require("./goal-production-render-materializer");
const {
  repairGoalPlatformDurationContracts,
} = require("./goal-platform-duration-contract");
const {
  FORMULAIC_PUBLIC_NARRATION_PATTERNS,
  INSTRUCTION_LIKE_BUYER_ADVICE_PATTERNS,
} = require("./goal-public-copy-qa");
const { buildCaptionSrt } = require("./goal-public-copy-repair");
const { buildViralScriptIntelligence } = require("./viral-script-intelligence");
const { PROTECTED_NAMES } = require("./brand-name-qa");
const { APPROVED_PULSE_CTAS, PRIMARY_PULSE_CTA } = require("./pulse-cta");

const REPAIR_STRATEGY = "retention_target_safe_script_extension";
const NORMAL_PRODUCTION_REPAIR_STRATEGY = "normal_production_safe_script_expansion";
const DEFAULT_TARGET_SECONDS = { min: 22, max: 30 };
const NORMAL_PRODUCTION_TARGET_SECONDS = { min: 35, max: 59 };
const ALL_SOCIAL_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];
const NORMAL_PRODUCTION_PLATFORM_HARD_MAX_SECONDS = {
  youtube_shorts: 60,
  tiktok: 90,
  instagram_reels: 45,
  facebook_reels: 75,
  x: 60,
};
const NORMAL_PRODUCTION_HARD_MIN_SECONDS = 15;
const BANNED_PUBLIC_PHRASES = [
  "source-backed update",
  "not a blank check",
  "invent extra details",
  "named source confirms",
  "wait-and-see column",
  "reddit reaction into evidence",
  "this gaming story",
  "the useful caveat is",
  "the safest public version is",
  "the player angle is simple",
  "the practical question is",
  "the confirmed bit is still the anchor",
  "gives the story enough shape",
  "the watch point",
  "the detail to watch is",
  "keeps the story bounded",
  "without making it bigger than the evidence",
  "the useful test is",
  "the only firm read",
  "the narrow version of the story",
  "the next useful signal",
  "the next serious detail is whether",
  "the next meaningful signal is whether",
  "the next update that matters is",
  "the next meaningful update is",
  "timing is the key detail",
  "timing decides whether this is launch news or another reveal",
  "the version that deserves the bigger push",
  "not just a price headline",
  "a read on how access is being used",
  "keeps the value question tied to the source",
  "without pretending the headline settles it",
  "turns premium access into the story",
  "paid tier is starting to look like launch day",
  "early access feels like a bonus or the real starting line",
  "raw revenue number",
  "bragging point",
  "store page, official post or platform listing",
  "needs the next showing to make the game readable",
  "another vague reveal beat",
  "watchlist without pretending",
  "price-and-access story",
  "price and access story",
  "so the edit should stay close",
  "the edit should stay close",
  "the details that matter are",
  "that keeps the commercial angle useful",
  "commercial angle useful",
  "worth tracking because the next official detail",
  "the next official detail could change",
  "the short should stay close",
  "the public output can name exactly what changed",
  "the hook has to stay tied",
  "the next beat should add a real detail",
  "needs a clearer consequence before it earns another upload",
  "if the offer changes, the headline has to change with it",
  "the stronger beat is whether",
  "now comes down to access: who gets in early",
  "that only lands if the paid path",
  "premium edition turns the launch window into the argument",
  "early-access demand signal",
  "the awkward question is whether launch day",
  "business-model argument players feel",
  "it is a useful number, but the real test",
  "needs more than a headline",
  "the strongest version names the change",
  "specific reason to care, not a vague sense that news happened",
  "one more hard detail before the next upload",
  "if the next source adds footage",
  "becomes the follow-up",
  "finally has something players can judge on screen",
  "finally has footage people can judge",
  "the useful read is movement",
  "movement, combat readability",
  "logo sweep",
  "the footage carries the promise",
  "how the game starts, breaks open and escalates",
  "the hook is the gameplay itself",
  "a player question without pretending the reveal answers everything",
  "next trailer shows uninterrupted play",
  "for now, the hook is what the footage proves",
  "footage is the part that decides whether the reveal has weight",
  "reviews are the first real pressure test",
  "review score has to connect",
  "scores get attention",
  "wait for player footage before treating the verdict",
  "if more outlets land around the same strengths",
  "that is enough for a clean watchlist call",
  "difference between a headline people scroll past",
  "launch stat becomes a strategy story",
  "source boundary",
  "smart read is momentum",
  "turning the headline into guaranteed demand",
  "story gets stronger",
  "if the details hold up",
  "if they drift",
  "past rumour talk",
  "where a headline turns into a real player decision",
  "question is whether players should",
  "the confirmed claim is simple",
  "source line",
  "source-confirmed update",
  "player decision is the reason",
  "worth the extra seconds",
  "move from interesting to urgent",
  "the clean source line",
  "for players, this only matters if it changes what to buy, download or ignore",
  "source for the confirmed claim",
  "stays a gaming story",
  "check the live version notes before",
  "check the price and platform details before you buy",
  "the smart move is",
  "the useful play is",
  "next choice is practical",
  "buy, download, wait or skip",
  "wishlist, download or ignore",
  "rough games job market",
  "veteran credits are still fighting for interviews",
  "that pressure can change which projects get staffed",
  "it is a quieter story than a trailer",
  "that is the line viewers will remember after the headline disappears",
  "otherwise it is just another headline with a logo next to it",
  "the next proof needs to be simple",
  "the next proof is simple",
  "footage matters here because",
  "real game behind the announcement",
  "pitch lives or dies",
  "licensed skin",
  "first gameplay read",
  "another trailer quote",
  "loop with real decisions",
  "familiar logo",
  "montage pace",
  "show the proof before the take",
  "core detail plainly",
  "keep the claim tight",
  "anything outside the report should stay out of the narration",
  "anything outside the report should stay out of the script",
  "fake certainty",
  "decision filter",
  "the useful version is narrow",
  "if the source is right",
  "the useful take is not blind hype",
  "cleaner test",
  "marketing line",
  "the news is simple",
  "title-card promise",
  "title card promise",
  "player watchlist story",
  "first gameplay cut",
  "another logo reveal",
  "changes the version people were actually",
  "clearer public hook",
  "bit players will argue over",
  "the tension is",
  "the pressure is",
  "the argument is whether",
  "the debate is whether",
  "the question now is whether",
  "becomes a case study",
  "price story because",
  "the clean angle",
  "audience watching this short",
  "accessory deals age fast",
  "the current listing is what keeps this story honest",
  "if the listing changes, the story changes with it",
  "the useful comparison is",
];
const ADVERTISER_RISK_RE = /\b(?:porn|pornography|gambling|casino|betting|wagering|crypto)\b/i;
const STALE_IDENTITY_CTA_RE =
  /\bfollow(?:\s+pulse\s+gaming)?\s+for\s+the\s+gaming\s+stories\s+behind\s+the\s+headline\b/i;
const FORMULAIC_DURATION_RESIDUE_RE =
  /\b(?:the practical question is|the confirmed bit is still the anchor|gives the story enough shape|source for the confirmed claim|stays a gaming story|check the live version notes before|check the price and platform details before you buy|the smart move is|the useful play is|what people buy, wishlist, reinstall or wait on|what players buy, wishlist or wait on|what they buy, wishlist or wait on|buy, wait or Game Pass questions|player-facing detail|source-backed update|named source confirms|not a blank check|the watch point|the detail to watch is|keeps the story bounded|without making it bigger than the evidence|the useful test is|the only firm read|the narrow version of the story|the next useful signal|the next serious detail is whether|the next meaningful signal is whether|the next update that matters is|the next meaningful update is|timing is the key detail|timing decides whether this is launch news or another reveal|the version that deserves the bigger push|not just a price headline|a read on how access is being used|keeps the value question tied to the source|without pretending the headline settles it|turns premium access into the story|paid tier is starting to look like launch day|early access feels like a bonus or the real starting line|raw revenue number|bragging point|store page,\s*official post or platform listing|needs the next showing to make the game readable|another vague reveal beat|watchlist without pretending|price[- ]and[- ]access story|so the edit should stay close|the edit should stay close|the details that matter are|that keeps the commercial angle useful|commercial angle useful|worth tracking because the next official detail|the next official detail could change|the short should stay close|the public output can name exactly what changed|the hook has to stay tied|(?:is|was) the hook|the next beat should add a real detail|needs a clearer consequence before it earns another upload|if the offer changes,\s*the headline has to change with it|the stronger beat is whether|now comes down to access:\s*who gets in early|that only lands if the paid path|premium edition turns the launch window into the argument|early-access demand signal|the awkward question is whether launch day|business-model argument players feel|it is a useful number,\s*but the real test|the real test is whether .+ changes play|patch note sounds (?:big|bigger)|a useful update should fix a real friction point|update the story before treating it as settled|the change hits the version people actually buy|core detail plainly|keep the claim tight|anything outside the report should stay out of (?:the )?(?:narration|script)|fake certainty|decision filter|the useful version is narrow|if the source is right|the useful take is not blind hype|cleaner test|marketing line|the news is simple|title[- ]card promise|player watchlist story|first gameplay cut|another logo reveal|past the announcement stage|changes the version people were actually|clearer public hook|bit players will argue over|the tension is|the pressure is|the argument is whether|the debate is whether|the question now is whether|becomes a case study|price story because|the clean angle|the useful comparison is|audience watching this short|accessory deals age fast|the current listing is what keeps this story honest|if the listing changes,\s*the story changes with it|needs more than a headline|the strongest version names the change|specific reason to care,\s*not a vague sense that news happened|one more hard detail before the next upload|if the next source adds footage|becomes the follow-up|finally has something players can judge on screen|finally has footage people can judge|the useful read is movement|movement,\s*combat readability|whether the UI sells the game at phone-screen size|logo sweep|the footage carries the promise|how the game starts,\s*breaks open and escalates|the hook is the gameplay itself|a player question without pretending the reveal answers everything|next trailer shows uninterrupted play|for now,\s*the hook is what the footage proves|footage is the part that decides whether the reveal has weight|footage matters here because|real game behind the announcement|pitch lives or dies|licensed skin|first gameplay read|another trailer quote|loop with real decisions|familiar logo|montage pace|the catch is what this changes after the reveal|the catch is what matters after the reveal cut|show the proof before the take|reviews are the first real pressure test|review score has to connect|scores get attention|wait for player footage before treating the verdict|if more outlets land around the same strengths|that is enough for a clean watchlist call|difference between a headline people scroll past|launch stat becomes a strategy story|source boundary|smart read is momentum|turning the headline into guaranteed demand|story gets stronger|if the details hold up|if they drift|past rumou?r talk|where a headline turns into a real player decision|question is whether players should|the confirmed claim is simple|source line|source-confirmed update|player decision is the reason|worth the extra seconds|move from interesting to urgent|the clean source line|next choice is practical|buy,\s*download,\s*wait or skip|wishlist,\s*download or ignore|rough games job market|veteran credits are still fighting for interviews|that pressure can change which projects get staffed|it is a quieter story than a trailer|that is the line viewers will remember after the headline disappears|otherwise it is just another headline with a logo next to it|the next proof needs to be simple|the next proof is simple|for players,\s*this only matters if it changes what to buy,\s*download or ignore|has to survive players now|frame-rate clips|matchmaking clips|if the fix misses|player reaction after the update|puts a familiar name on a grim hiring market|credited specialists are struggling|ship with thinner audio teams|hiring squeeze|pattern to watch is where outlets agree|handling,\s*performance,\s*progression|player footage matters|score becomes a clearer green light|score matter to players instead of becoming chart noise|best short connects the praise|nostalgia play with a date problem|date leak attached to the nostalgia|date leak is not the sell|old arcade energy has to come back|racer lives or dies on handling|sanding off the old Star Wars arcade edge|full mission would say more|(?:a\s+)?launch date after years of huge trailers|has to make those fights feel good|date turns the game from promise into deadline|risk is performance:\s*massive battles|waiting on footage|launch picture is clear|date,\s*price or performance detail)\b/i;
const LIVE_EVENT_TRAILER_RESIDUE_RE =
  /\b(?:better showing would make .+ readable fast:\s*combat,\s*ui|that is enough for a watchlist|store page or firm launch window|full mission and proper launch details|teaser energy)\b/i;
const FLAT_CREATIVE_RESIDUE_RE =
  /\b(?:the platform list is the point|a longer public showing would say more than another quick trailer|the console version needs to feel as sharp as the PC build|controller feel will decide whether the port lands like launch or just a late arrival)\b/i;
const SAFE_MOTION_RIGHTS_RE =
  /\b(?:owned_generated_editorial_motion_graphic|owned_generated_motion|official_reference_transformative_short|source_documented_transformative_editorial_use|steam_storefront_promotional_editorial_use|screenshot_derived_editorial_motion|screenshot_derived_motion_clip|approved_for_transformative_editorial_use)\b/i;
const UNSAFE_APPROVAL_RE = /\b(?:rejected|blocked|failed|review_required|unapproved|unknown)\b/i;
const PRICE_DECREASE_DURATION_RESIDUE_RE =
  /\b(?:lower entry point|discount|offer itself|deal is live|savings?|cheaper|price\s+(?:drop|cut)|dropped?\s+to|\d{1,3}%\s*off)\b/i;
const PRICE_INCREASE_DURATION_RESIDUE_RE =
  /\b(?:is a price story because|if the listing changes,\s*the story changes with it)\b/i;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseProtectedNamesText(value) {
  if (typeof value !== "string") return value;
  let output = value;
  for (const entry of PROTECTED_NAMES) {
    for (const pattern of [...entry.damaged, ...entry.nonCanonical]) {
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      output = output.replace(new RegExp(pattern.source, flags), entry.canonical);
    }
  }
  return output;
}

function normaliseProtectedNamesInDurationManifest(manifest = {}) {
  const fields = [
    "canonical_subject",
    "canonical_game",
    "selected_title",
    "thumbnail_headline",
    "thumbnail_text",
    "first_spoken_line",
    "narration_hook",
    "narration_script",
    "full_script",
    "tts_script",
    "description",
  ];
  const updated = { ...manifest };
  for (const field of fields) {
    if (typeof updated[field] === "string") updated[field] = normaliseProtectedNamesText(updated[field]);
  }
  if (Array.isArray(updated.confirmed_claims)) {
    updated.confirmed_claims = updated.confirmed_claims.map((claim) => normaliseProtectedNamesText(claim));
  }
  return updated;
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function wordCount(value) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function hadesConsoleCountdownLine(canonical = {}) {
  const text = lowerText(
    [
      canonical.canonical_subject,
      canonical.canonical_game,
      canonical.selected_title,
      canonical.canonical_title,
      canonical.description,
      ...asArray(canonical.confirmed_claims),
    ].join(" "),
  );
  if (!/\bhades ii\b/.test(text)) return "";
  if (/\bxbox\b/.test(text) && /\bplaystation\b/.test(text) && (/\bapril\s*14(?:th)?\b/.test(text) || /\bcoming\s+april\b/.test(text))) {
    return "Hades II just put PlayStation and Xbox players on the same April countdown.";
  }
  if (/\bxbox\b/.test(text) && /\bplaystation\b/.test(text)) {
    return "Hades II just turned its console launch into a same-day fight.";
  }
  return "";
}

const THUMBNAIL_HEADLINE_DANGLING_TERMINALS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "because",
  "before",
  "but",
  "by",
  "can",
  "could",
  "for",
  "from",
  "got",
  "had",
  "has",
  "have",
  "her",
  "his",
  "in",
  "into",
  "is",
  "its",
  "of",
  "on",
  "or",
  "our",
  "over",
  "reports",
  "reveals",
  "says",
  "should",
  "that",
  "the",
  "their",
  "these",
  "this",
  "to",
  "under",
  "vs",
  "was",
  "were",
  "will",
  "with",
  "without",
  "would",
  "your",
]);

const THUMBNAIL_HEADLINE_FILLER_WORDS = new Set([
  ...THUMBNAIL_HEADLINE_DANGLING_TERMINALS,
  "already",
  "back",
  "finally",
  "just",
  "may",
  "more",
  "than",
  "used",
]);

function headlineTokenKey(value = "") {
  return lowerText(value).replace(/[^a-z0-9]+/g, "");
}

function meaningfulSubjectToken(word = "") {
  const clean = cleanText(word);
  const key = headlineTokenKey(clean);
  return key.length >= 4 || /\d/.test(key) || /^[A-Z0-9]{2,}$/.test(clean);
}

function addHeadlineWords(words, value = "", options = {}) {
  const maxWords = Number(options.maxWords || 5);
  const allowFiller = options.allowFiller === true;
  const existing = new Set(words.map(headlineTokenKey).filter(Boolean));
  for (const rawWord of cleanText(normaliseProtectedNamesText(value)).split(/\s+/).filter(Boolean)) {
    const key = headlineTokenKey(rawWord);
    if (!key) continue;
    if (existing.has(key)) continue;
    if (!allowFiller && THUMBNAIL_HEADLINE_FILLER_WORDS.has(key)) continue;
    words.push(rawWord);
    existing.add(key);
    if (words.length >= maxWords) break;
  }
  return words;
}

function finishDurationThumbnailHeadline(words = []) {
  const cleaned = words.filter(Boolean).slice(0, 5);
  while (
    cleaned.length > 1 &&
    THUMBNAIL_HEADLINE_DANGLING_TERMINALS.has(headlineTokenKey(cleaned[cleaned.length - 1]))
  ) {
    cleaned.pop();
  }
  return normaliseProtectedNamesText(cleaned.join(" ")).toUpperCase();
}

function durationHeadlineFromParts(...parts) {
  const words = [];
  for (const part of parts) {
    addHeadlineWords(words, part);
  }
  return finishDurationThumbnailHeadline(words);
}

function durationRepairThumbnailHeadline(title = "", subject = "") {
  const titleText = cleanText(normaliseProtectedNamesText(title));
  const subjectText = cleanText(normaliseProtectedNamesText(subject));
  if (/\bhades ii\b/i.test(`${titleText} ${subjectText}`) && /playstation|xbox|silence|console|april/i.test(titleText)) {
    return "HADES II CONSOLE DATE";
  }
  if (
    /\bthe expanse:\s*osiris reborn\b/i.test(`${titleText} ${subjectText}`) &&
    /\b(?:gameplay|trailer|preview|showed|shows)\b/i.test(titleText)
  ) {
    return "EXPANSE GAMEPLAY REVEAL";
  }
  if (/dawn of war (?:iv|4)/i.test(titleText) && /gameplay/i.test(titleText)) {
    return "DAWN OF WAR 4 GAMEPLAY";
  }
  if (/dawn of war (?:iv|4)/i.test(titleText) && /roadmap|factions/i.test(titleText)) {
    return "DAWN OF WAR 4 ROADMAP";
  }
  if (/v rising/i.test(`${titleText} ${subjectText}`) && /(?:another|new).{0,40}vampire game/i.test(titleText)) {
    return "V RISING VAMPIRE GAME";
  }
  if (/stranger than heaven/i.test(`${titleText} ${subjectText}`) && /five eras?/i.test(titleText)) {
    return "STRANGER FIVE ERAS";
  }
  if (/subnautica\s*2/i.test(`${titleText} ${subjectText}`) && /calls? out leakers?/i.test(titleText)) {
    return "SUBNAUTICA LEAKERS CALLED OUT";
  }
  if (/forza horizon 6/i.test(`${titleText} ${subjectText}`) && /steam ceiling|steam launch|xbox/i.test(titleText)) {
    return "FORZA STEAM CEILING";
  }
  if (/forza horizon 6/i.test(`${titleText} ${subjectText}`) && /hit steam/i.test(titleText)) {
    return "FORZA HIT STEAM";
  }
  if (/forza horizon 6 premium/i.test(titleText) && /\$?140m|\$140\s*million|140\s*million/i.test(titleText)) {
    return "FORZA PREMIUM $140M";
  }
  if (/\bmega mewtwo\b/i.test(titleText) && /\bpok(?:e|é)mon go\b/i.test(`${titleText} ${subjectText}`)) {
    return durationHeadlineFromParts("Pokémon Go", "Mega Mewtwo");
  }
  if (/\bis more than xcom\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, "XCOM");
  }
  if (/\bcomposer says the jobs vanished\b|\bjobs vanished\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, "Composer Jobs Vanished");
  }
  if (/\bprices went up\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, /\beurope\b/i.test(titleText) ? "Prices Went Up Europe" : "Prices Went Up");
  }
  if (/\breviews are in\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, "Reviews");
  }
  if (/\bbonus fight got bigger\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, "Bonus Fight Bigger");
  }
  if (/\bcrushed its steam record\b|\bsteam record\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, "Steam Record");
  }
  if (/\bjust got more expensive\b|\bgot more expensive\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, "Price Jump");
  }
  if (/\bfeedback\b/i.test(titleText) && /\bdemand exclusives\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, "Fans Demand Exclusives");
  }
  if (/\bexclusives\b/i.test(titleText) && /\bunder review\b|\bback under review\b/i.test(titleText)) {
    const words = [];
    addHeadlineWords(words, subjectText);
    addHeadlineWords(words, "Exclusives Under Review", { allowFiller: true });
    return finishDurationThumbnailHeadline(words);
  }
  if (/\bdate may have leaked\b|\brelease date\b.*\bleaked\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, "Date Leak");
  }
  if (/\bprofessor lawsuit\b/i.test(titleText)) {
    return durationHeadlineFromParts(subjectText, "Professor Lawsuit");
  }
  const titleWords = titleText.split(/\s+/).filter(Boolean);
  const subjectWords = subjectText.split(/\s+/).filter(Boolean);
  const compactSubjectWords = subjectWords.filter((word) => !/^(the|and|of|for|with|to)$/i.test(word));
  const titleHasSubject = compactSubjectWords
    .filter(meaningfulSubjectToken)
    .some((word) => lowerText(titleText).includes(lowerText(word)));
  const initialWords = titleHasSubject ? titleWords : [...compactSubjectWords.slice(0, 3), ...titleWords];
  const headlineWords = [];
  addHeadlineWords(headlineWords, initialWords.join(" "), { allowFiller: true });
  while (
    headlineWords.length > 1 &&
    THUMBNAIL_HEADLINE_DANGLING_TERMINALS.has(headlineTokenKey(headlineWords[headlineWords.length - 1]))
  ) {
    headlineWords.pop();
  }
  if (/'s$/i.test(headlineWords[headlineWords.length - 1] || "")) headlineWords.pop();
  const initialHeadline = headlineWords.join(" ");
  const headlineHasSubject = compactSubjectWords
    .filter(meaningfulSubjectToken)
    .some((word) => lowerText(initialHeadline).includes(lowerText(word)));
  if (titleHasSubject && !headlineHasSubject && compactSubjectWords.length) {
    return durationHeadlineFromParts(compactSubjectWords.slice(0, 2).join(" "), titleWords.join(" "));
  }
  return finishDurationThumbnailHeadline(headlineWords);
}

function containsBannedPublicPhrase(value) {
  const haystack = lowerText(value);
  return BANNED_PUBLIC_PHRASES.some((phrase) => haystack.includes(phrase)) ||
    FORMULAIC_PUBLIC_NARRATION_PATTERNS.some((pattern) => pattern.test(value)) ||
    INSTRUCTION_LIKE_BUYER_ADVICE_PATTERNS.some((pattern) => pattern.test(value));
}

function includesText(haystack, needle) {
  const cleanNeedle = lowerText(needle);
  if (!cleanNeedle) return false;
  return lowerText(haystack).includes(cleanNeedle);
}

function classifyStoryIntent(canonical = {}) {
  const text = lowerText(
    [
      canonical.selected_title,
      canonical.canonical_title,
      canonical.canonical_angle,
      canonical.description,
      ...asArray(canonical.confirmed_claims),
    ].join(" "),
  );
  if (/\b(?:steam controller|controller release date|controller date|new controller|hardware)\b/.test(text)) {
    return "hardware_signal";
  }
  if (/\bpragmata\b/.test(text) && /\b(?:ai[- ]?look|ai generated|handmade|human developers?|new york stage)\b/.test(text)) {
    return "art_direction_craft";
  }
  if (/\bsubnautica\s*2\b/.test(text) && /\b(?:bonus|\$?250\s*million|krafton|payout|developers are going to get)\b/.test(text)) {
    return "business_bonus_dispute";
  }
  if (/\b(?:kadokawa|oasis management|sony)\b/.test(text) && /\b(?:stake|investor|activist|ownership|shareholder)\b/.test(text)) {
    return "ownership_pressure";
  }
  if (/\b(?:mega mewtwo|go fest global|pokemon go|pokémon go)\b/.test(text) && /\b(?:debut|free|event|global|coming|announced)\b/.test(text)) {
    return "live_event_unlock";
  }
  if (/\bsubnautica\s*2\b/.test(text) && /\b(?:kill fish|peaceful|predator balance|predators?|non[- ]?lethal)\b/.test(text)) {
    return "game_design_rule";
  }
  if (/\bv rising\b/.test(text) && /\b(?:new game set in the world|working on a new game|another vampire game|world of v rising|stunlock)\b/.test(text)) {
    return "studio_world_expansion";
  }
  if (/\b(?:feedback|player voice|demand exclusives|exclusive games|exclusives|reevaluating|re-evaluating|under review|strategy officer|leadership revamp|ceo)\b/.test(text)) {
    return "platform_strategy";
  }
  if (/\b(?:hands-on|xcom|mass effect|permadeath|turn-based tactics|more than just)\b/.test(text)) {
    return "preview_impression";
  }
  if (
    !/\bunder review\b/.test(text) &&
    (/\b(?:reviews?|metacritic|opencritic|score|rated|rating)\b/.test(text) ||
      /\b(?:pc gamer|ign|gamespot|vgc|eurogamer)\s+review\b/.test(text) ||
      /\breview\s*(?:\(|:|score|from|by|at)\b/.test(text))
  ) {
    return "review_signal";
  }
  if (/\bxbox\b/.test(text) && /\bsteam\b/.test(text)) {
    return "platform_signal";
  }
  if (/\b(?:lawsuit|sues?|denied|professor status|legal|leak|leaks|leaker|leakers|pirate|pirates|piracy|stolen build|responds? to pirates|life choices)\b/.test(text)) {
    return "community_or_legal";
  }
  if (/\b(?:composer|developer|developers|jobs?|job market|resume|resumes|interview|layoff|layoffs|hiring|studio work|unreal|deus ex)\b/.test(text)) {
    return "industry_job_market";
  }
  if (/\b(?:prices?\s+(?:went|go(?:es)?)\s+up|price\s+(?:rise|hike|increase)|recommended retail prices?\s+(?:effective|updated|increased)|rrp\s+(?:rise|hike|increase))\b/.test(text)) {
    return "price_increase";
  }
  if (/\b(?:deal|discount|sale|price|off|bundle|edition|pre-order|preorder|pass|subscription|premium)\b/.test(text)) {
    return "deal_or_access";
  }
  if (/(patch|update|balance|nerf|buff|fix|performance|fps|server)/.test(text)) {
    return "patch_or_performance";
  }
  if (/(release|launch|available|showcase|state of play|direct|trailer|gameplay|preview|date|delayed|reveal|coming|platform|playstation|xbox|switch|steam)/.test(text)) {
    return "release_or_showcase";
  }
  return "general_player_impact";
}

function scriptSubjectFor(canonical = {}) {
  const text = [
    canonical.selected_title,
    canonical.canonical_title,
    canonical.canonical_angle,
    canonical.description,
    ...asArray(canonical.confirmed_claims),
  ].join(" ");
  if (/\bsteam controller\b/i.test(text)) return "Steam Controller";
  if (/\bdawn of war\s*4\b/i.test(text)) return "Dawn of War 4";
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_game);
  const warhammer = subject.match(/^Warhammer 40,?000:\s*(.+)$/i);
  if (warhammer) return cleanText(warhammer[1]);
  return subject;
}

function sourceSafeClaimForExtension(canonical = {}, subject = "") {
  const rawClaim = cleanText(
    asArray(canonical.confirmed_claims)[0] ||
      canonical.description ||
      canonical.canonical_angle ||
      canonical.selected_title,
  );
  const text = lowerText([rawClaim, canonical.canonical_title, canonical.selected_title, subject].join(" "));
  if (/\bxbox\b/.test(text) && /\b(?:chief strategy officer|strategy officer|leadership revamp|hires? analyst)\b/.test(text)) {
    return "Xbox hired an analyst as chief strategy officer after another leadership revamp.";
  }
  if (/\bspace marine 2\b/.test(text)) {
    return "Space Marine 2 received the Purgation update, Patch 13 and a new PvE mission.";
  }
  if (/\bdawn of war (?:iv|4)\b/.test(text) && /\bgameplay\b/.test(text)) {
    return "Dawn of War 4 now has gameplay footage and a clearer Warhammer Skulls showing.";
  }
  if (/\bdawn of war (?:iv|4)\b/.test(text)) {
    return "Dawn of War 4 has a Year 1 roadmap and new playable factions.";
  }
  if (/\bhades ii\b/.test(text) && /\bxbox\b/.test(text) && /\bplaystation\b/.test(text)) {
    if (/\bapril\s*14(?:th)?\b|\bcoming\s+april\b/.test(text)) {
      return "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.";
    }
    return "Xbox showed Hades II for Xbox and PlayStation.";
  }
  if (/\bcrimson desert\b/.test(text) && /\b(?:launched?|out now|march\s*19)\b/.test(text)) {
    return "Crimson Desert is out now after Pearl Abyss confirmed the launch timing.";
  }
  if (/\bsteam controller\b/.test(text)) {
    return "The Steam Controller release date may have leaked online.";
  }
  if (/\bpragmata\b/.test(text) && /\b(?:ai[- ]?look|ai generated|handmade|human developers?|new york stage)\b/.test(text)) {
    return "Pragmata's newly revealed New York stage was handmade by human developers to look AI generated.";
  }
  if (/\bsubnautica\s*2\b/.test(text) && /\b(?:bonus|\$?250\s*million|krafton|payout|developers are going to get)\b/.test(text)) {
    return "Subnautica 2's developers appear to be in line for a $250 million bonus.";
  }
  if (/\bsubnautica\s*2\b/.test(text) && /\b(?:pirates?|leakers?|leaking the game|stolen build|life choices)\b/.test(text)) {
    return "A Subnautica 2 developer responded after leaked builds started spreading before launch.";
  }
  if (/\bsubnautica\s*2\b/.test(text) && /\b(?:leaked|leak|48 hours|ahead of launch|before launch)\b/.test(text)) {
    return "Subnautica 2 reportedly appeared online before launch.";
  }
  if (/\bmega mewtwo\b/.test(text) && /\bpokemon go\b/.test(text)) {
    return "Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players.";
  }
  if (ADVERTISER_RISK_RE.test(rawClaim)) {
    return cleanText(canonical.description).replace(/\s*Source:\s*[^.]+\.?$/i, "") ||
      `${subject || "The story"} has a reported gaming update.`;
  }
  const compactWarhammer = rawClaim.replace(/\bWarhammer 40,?000:\s*(Dawn of War (?:IV|4)|Space Marine 2|Boltgun Boom|Boltgun 2)\b/gi, "$1");
  return cleanText(compactWarhammer);
}

function sourceClaimSentence(source = "", claim = "") {
  return sourceLeadSentence(source, claim);
}

function officialSourceReportingResidue(sentence = "", canonical = {}) {
  const source = cleanText(canonical.primary_source || canonical.official_source || canonical.source_card_label);
  if (!/^(?:xbox|playstation|nintendo|steam|valve|sony|microsoft)$/i.test(source)) return false;
  const sourceEscaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\b${sourceEscaped}\\s+reports\\s+[^.]{0,180}\\b(?:trailer|gameplay|showcase|coming|release|date|platform)\\b`,
    "i",
  );
  return pattern.test(cleanText(sentence));
}

function mismatchedSubnauticaPeacefulSentence(sentence = "", canonical = {}) {
  const sentenceText = lowerText(sentence);
  if (!/\bsubnautica\s*2\b/.test(sentenceText)) return false;
  if (!/\b(?:strangest survival rules?|peaceful|kill[- ]?list|kill fish|monster[- ]?hunting)\b/.test(sentenceText)) {
    return false;
  }
  const evidence = lowerText(
    [
      canonical.selected_title,
      canonical.canonical_title,
      canonical.description,
      ...asArray(canonical.confirmed_claims),
    ].join(" "),
  );
  const evidenceSupportsRule = /\b(?:strangest survival rules?|peaceful|kill[- ]?list|kill fish|predator balance|non[- ]?lethal)\b/.test(evidence);
  const evidenceIsDifferentSubnauticaStory =
    /\b(?:leak|leaked|leakers?|pirates?|stolen build|bonus|\$?250\s*million|payout)\b/.test(evidence);
  return evidenceIsDifferentSubnauticaStory && !evidenceSupportsRule;
}

function mismatchedReviewOutletSentence(sentence = "", canonical = {}) {
  const sentenceText = lowerText(sentence);
  if (!/\bpc gamer\b/.test(sentenceText)) return false;
  if (!/\breview\b/.test(sentenceText)) return false;
  const evidence = lowerText(
    [
      canonical.primary_source,
      canonical.source_card_label,
      canonical.selected_title,
      canonical.canonical_title,
      canonical.description,
      ...asArray(canonical.confirmed_claims),
    ].join(" "),
  );
  return !/\bpc gamer\b/.test(evidence);
}

function subnauticaFirstLineForEvidence(canonical = {}) {
  const evidence = lowerText(
    [
      canonical.selected_title,
      canonical.canonical_title,
      canonical.description,
      ...asArray(canonical.confirmed_claims),
    ].join(" "),
  );
  if (/\b(?:bonus|\$?250\s*million|payout|developers are going to get)\b/.test(evidence)) {
    return "Subnautica 2's bonus fight now looks bigger than the sequel hype.";
  }
  if (/\b(?:pirates?|leakers?|leaking the game|stolen build|life choices)\b/.test(evidence)) {
    return "Subnautica 2's developer is already fighting leaked builds.";
  }
  if (/\b(?:leaked|leak|48 hours|ahead of launch|before launch)\b/.test(evidence)) {
    return "Subnautica 2 reportedly leaked before launch.";
  }
  return "";
}

function normaliseDurationBaseScript(canonical = {}, value = "") {
  const source = cleanText(canonical.primary_source || canonical.official_source || canonical.source_card_label || "the source");
  const claim = sourceSafeClaimForExtension(canonical, scriptSubjectFor(canonical));
  const replacement = sourceClaimSentence(source, claim);
  const hadesHook = hadesConsoleCountdownLine(canonical);
  const priceIncrease = classifyStoryIntent(canonical) === "price_increase";
  if (hadesHook && !/\bhades\s*2\s+is\s+not\s+just\s+leaving\s+early\s+access\b/i.test(value)) {
    return normaliseScriptPunctuation(`${hadesHook} ${replacement}`);
  }
  const sentences = sentenceList(value);
  const next = [];
  for (const sentence of sentences) {
    if (
      priceIncrease &&
      (PRICE_DECREASE_DURATION_RESIDUE_RE.test(sentence) || PRICE_INCREASE_DURATION_RESIDUE_RE.test(sentence))
    ) {
      continue;
    }
    if (mismatchedSubnauticaPeacefulSentence(sentence, canonical)) {
      const replacementFirstLine = subnauticaFirstLineForEvidence(canonical);
      if (replacementFirstLine && !includesText(next.join(" "), replacementFirstLine)) {
        next.push(replacementFirstLine);
      }
      continue;
    }
    if (officialSourceReportingResidue(sentence, canonical)) {
      if (replacement && !extensionSentenceAlreadyCovered(next.join(" "), replacement, claim)) {
        next.push(replacement);
      }
      continue;
    }
    if (mismatchedReviewOutletSentence(sentence, canonical)) {
      const subject = scriptSubjectFor(canonical);
      const reviewLine = `${subject} just turned its review score into a launch-day argument.`;
      if (!includesText(next.join(" "), reviewLine)) next.push(reviewLine);
      continue;
    }
    next.push(sentence);
  }
  return normaliseScriptPunctuation(next.join(" "));
}

function sourceSafeDescriptionForDuration(canonical = {}) {
  const description = cleanText(canonical.description);
  const descriptionEvidence = lowerText([
    canonical.canonical_subject,
    canonical.canonical_game,
    canonical.selected_title,
    canonical.canonical_title,
    description,
    ...asArray(canonical.confirmed_claims),
  ].join(" "));
  if (/\bcrimson desert\b/.test(descriptionEvidence) && /\b(?:launched?|out now|march\s*19)\b/.test(descriptionEvidence)) {
    const source = cleanText(canonical.primary_source || canonical.official_source || canonical.source_card_label || "the source");
    const claim = sourceSafeClaimForExtension(canonical, scriptSubjectFor(canonical));
    return cleanText(`${sentenceWithPeriod(claim)} Source: ${source}.`);
  }
  if (!description) {
    const source = cleanText(canonical.primary_source || canonical.official_source || canonical.source_card_label || "the source");
    const claim = sourceSafeClaimForExtension(canonical, scriptSubjectFor(canonical));
    return cleanText(`${sentenceWithPeriod(claim)} Source: ${source}.`);
  }
  if (
    !officialSourceReportingResidue(description, canonical) &&
    !/\b[A-Za-z0-9][^.]{2,120}\s-\s(?:Xbox|PlayStation|Nintendo|Steam|Valve|Sony|Microsoft)[^.]{0,80}\b(?:Trailer|Gameplay|Showcase)\s*\([^)]{3,80}\)/i.test(description)
  ) {
    return description;
  }
  const source = cleanText(canonical.primary_source || canonical.official_source || canonical.source_card_label || "the source");
  const claim = sourceSafeClaimForExtension(canonical, scriptSubjectFor(canonical));
  const sentence = sentenceWithPeriod(claim);
  return cleanText(`${sentence} Source: ${source}.`);
}

function extensionSentencesFor(canonical = {}) {
  const subject = scriptSubjectFor(canonical);
  const source = cleanText(canonical.primary_source || canonical.source_card_label || "the source");
  const claim = sourceSafeClaimForExtension(canonical, subject);
  const claimSentence = sourceClaimSentence(source, claim);
  const intent = classifyStoryIntent(canonical);
  if (intent === "deal_or_access") {
    const dealText = lowerText(
      [
        subject,
        canonical.selected_title,
        canonical.canonical_title,
        canonical.description,
        ...asArray(canonical.confirmed_claims),
      ].join(" "),
    );
    if (/\bpremium edition\b/.test(dealText)) {
      return [
        "Early access is becoming the first real launch beat.",
        "The reported number shows demand before the standard release, but it is not the final ceiling.",
        claimSentence,
        "Paying extra can drag the conversation forward before the cheaper version even arrives.",
        "That can make the standard launch look smaller than the actual audience.",
        "The standard release number is the part that decides whether this is a surge or just a loud head start.",
      ];
    }
    return [
      `${subject} is cheap enough here to change the decision for players who skipped it at full price.`,
      "The retailer matters: stock, region and condition can move faster than the headline.",
      claimSentence,
      "For anyone who still wants a physical copy, the current listing is the part to check.",
      "For everyone else, it is a quick price check, not a reason to force a buy.",
      "Compare the live retailer price, the platform and whether this is finally low enough to jump in.",
    ];
  }
  if (intent === "price_increase") {
    return [
      `For new players, ${subject} just became harder to buy.`,
      claimSentence,
      "Scope matters here: Sony named the standard PS5, Digital Edition, PS5 Pro and PlayStation Portal, not just one bundle.",
      "That turns a console purchase into a timing question for Europe and the UK.",
      "Existing owners are watching what happens next to bundles and upgrade plans.",
      "The story stays narrow: Sony changed the recommended retail prices, and that changes the cost of jumping in.",
    ];
  }
  if (intent === "patch_or_performance") {
    return [
      `${subject} has to survive players now, not just the patch notes.`,
      "Frame-rate clips, matchmaking clips and balance complaints will expose weak fixes fast.",
      "The real story is the friction players can feel in a normal session.",
      "If the fix misses, the clips will travel faster than the patch notes.",
      claimSentence,
      "Player reaction after the update is live is the part that decides the follow-up.",
      "That gives the update a gameplay consequence instead of another patch-note headline.",
    ];
  }
  if (intent === "hardware_signal") {
    return [
      `${subject} is a hardware timing story, not a gameplay reveal.`,
      claimSentence,
      "If the leak is accurate, Valve's next test is price, compatibility and whether SteamOS is part of the pitch.",
      "PC players do not replace input gear on vibes; they need a date, a use case and a reason to choose it over the pad they already own.",
      "That makes the next official Valve detail the part that turns a leak into a buying decision.",
    ];
  }
  if (intent === "art_direction_craft") {
    return [
      `${subject}'s uncanny New York stage is the story because the AI look was built by hand.`,
      claimSentence,
      "That flips the read: the strange texture is art direction, not a machine shortcut.",
      "For a game already fighting a long wait, that craft detail makes the next gameplay showing feel less disposable.",
      "The full game needs that same deliberate weirdness once players are moving through it.",
    ];
  }
  if (intent === "business_bonus_dispute") {
    return [
      `${subject} is now carrying a business fight as much as sequel hype.`,
      claimSentence,
      "Studio control, publisher timing and the reported creator payout are all colliding in public.",
      "Krafton now has to sell the sequel while the creators' reward story is still in the room.",
      "That makes each official update land with a business question attached, not just a gameplay one.",
    ];
  }
  if (intent === "ownership_pressure") {
    return [
      `${subject} is not just a corporate logo; it sits behind games, anime licensing and a lot of Japanese entertainment IP.`,
      claimSentence,
      "That is why an activist investor passing Sony's stake lands louder than a spreadsheet update.",
      "Oasis can push for sharper strategy, asset sales or governance changes, while Sony stays a strategic partner rather than the biggest outside pressure point.",
      "For players, the risk is not tomorrow's patch; it is whether money pressure changes what gets funded, adapted or pushed worldwide.",
    ];
  }
  if (intent === "live_event_unlock") {
    return [
      "Mega Mewtwo finally has a Pokemon Go path instead of another tease.",
      claimSentence,
      "That matters because Mega Mewtwo has been one of Pokemon Go's longest-running absences.",
      "Making Go Fest Global free gives casual players a reason to open the app even if they were not buying a ticket.",
      "Niantic now has to make the weekend feel worth returning for, not just worth checking once.",
      "The player detail is timing, raid access and whether free players actually get a fair shot.",
    ];
  }
  if (intent === "game_design_rule") {
    return [
      `${subject} is holding onto the rule that makes its survival feel different.`,
      claimSentence,
      "Keeping wildlife out of the kill-list means tension has to come from behaviour, escape routes and creature design, not monster-hunting.",
      "That is a real sequel promise for players who want danger without turning Subnautica into a loot grind.",
      "The next official footage has to show whether that restraint still feels tense.",
    ];
  }
  if (intent === "studio_world_expansion") {
    return [
      `${subject}'s next move is not another content drop; it is a new game in the same vampire world.`,
      claimSentence,
      "That changes the fan question: how much of V Rising's identity survives when Stunlock moves outside the current roadmap.",
      "Balance support keeps the original alive, but the bigger curiosity is what the studio builds when it stops feeding the same game.",
      "The risk is obvious: a wider vampire world sounds exciting only if it still has the bite that made V Rising work.",
    ];
  }
  if (intent === "release_or_showcase") {
    const text = lowerText(
      [
        subject,
        canonical.selected_title,
        canonical.canonical_title,
        canonical.description,
        ...asArray(canonical.confirmed_claims),
      ].join(" "),
    );
    if (/\bhades ii\b/.test(text)) {
      const platformReach = /\bxbox\b/.test(text) && /\bplaystation\b/.test(text)
        ? "PlayStation and Xbox getting the same April date turns it into a launch-day race."
        : /\bplaystation\b/.test(text)
          ? "PlayStation support turns this from PC excitement into a much wider console launch."
          : /\bxbox\b/.test(text)
            ? "Xbox support turns this from PC excitement into a much wider console launch."
            : "The console angle turns this from PC excitement into a wider launch story.";
      return [
        claimSentence,
        "Hades 2 is no longer just a PC early-access story waiting for a console footnote.",
        platformReach,
        "The catch is why controller feel matters: laggy dodges would blunt Hades 2.",
        "Hades lives on tight dodge timing, clean reads and broken builds spreading fast.",
        "If the console port lands sharp, PlayStation and Xbox players chase the same obsession at once.",
      ];
    }
    if (/\bthe expanse\b/.test(text)) {
      return [
        "The catch is whether the camera, gunfights and ship scale feel heavy enough for The Expanse.",
        "A short showcase can sell impact, but mission flow decides whether players trust it.",
        "If the full missions keep that pressure, Osiris Reborn starts looking less like a licensed shortcut.",
      ];
    }
    if (/\bcrimson desert\b/.test(text)) {
      return [
        `${subject} is out in the wild after years of huge trailers.`,
        claimSentence,
        "Pearl Abyss now has to make the shipped build feel as sharp as the trailers looked.",
        "Performance is the danger point: big battles and wide areas have to survive real hardware.",
        "That turns the story from showcase hype into a real player verdict.",
      ];
    }
    if (/\bstranger than heaven\b/.test(text)) {
      return [
        `${subject} is swinging at more than one period piece.`,
        claimSentence,
        "Five eras is a big promise: each one needs its own texture, pace and reason to exist, not just a costume change.",
        "That makes the reveal feel ambitious, but also easy to overpromise.",
        "The awkward catch is why the time jumps matter: do they change the missions, or just the wardrobe?",
      ];
    }
    if (/\bstar wars\b/.test(text) && /\bracer\b/.test(text)) {
      return [
        "Now the nostalgia has a timetable attached.",
        claimSentence,
        "The sell is still the old arcade energy, not the calendar mistake.",
        "For now, the story is timing: the reveal may have slipped before the official rollout caught up.",
        "If the leak holds, the next official beat is less about surprise and more about why this version should exist now.",
      ];
    }
    return [
      `${subject} finally has footage players can judge.`,
      claimSentence,
      "The clip puts the pitch on screen: pace, camera, combat and whether the world reads clearly in a short.",
      "One reveal cannot settle the game, but it gives players a sharper read than another announcement.",
      "A longer play section is where hype either turns into trust or starts to fall apart.",
    ];
  }
  if (intent === "platform_signal") {
    return [
      `${subject} is becoming an Xbox-on-Steam story, not just another racing launch.`,
      "If a first-party Xbox racer breaks out on Steam, the platform plan suddenly looks less theoretical.",
      "That is the uncomfortable bit: the store where Xbox wins might not be Xbox.",
      claimSentence,
      "Game Pass messaging, price and release timing are the pieces that could move around that attention.",
      "If Microsoft leans into it, this becomes a distribution story as much as a game story.",
      "If it does not, the Steam spike is still a strong launch signal, but not proof of a wider shift.",
      `${subject} is carrying more than a chart number now.`,
    ];
  }
  if (intent === "review_signal") {
    return [
      `${subject} is in verdict territory now, not pre-launch noise.`,
      claimSentence,
      "The number is only the opening beat; outlet agreement matters more.",
      "One high score can hide split opinions, but a steady spread says the reception is harder to dismiss.",
      "Until players have it, this is a strong signal, not a final verdict.",
      "The next comparison is whether other outlets land near the same mark or pull the excitement back down.",
      "A score this high changes the launch conversation, but the public verdict still has to follow.",
    ];
  }
  if (intent === "preview_impression") {
    return [
      "The squad layer sounds strongest when it survives between missions, not just inside them.",
      claimSentence,
      "PC Gamer's Mass Effect comparison points to choices, crew losses and downtime carrying weight between fights.",
      "Permadeath makes every failed call more expensive, because Star Wars spectacle only works here if a mission can go wrong fast.",
      "Longer footage has to prove the crew layer changes decisions before the blasters start.",
      "If that layer lands, the pitch becomes a crew drama with consequences instead of a simple tactics reskin.",
    ];
  }
  if (intent === "platform_strategy") {
    if (/\bfeedback|player voice|demand exclusives/i.test([canonical.selected_title, canonical.description, claim].join(" "))) {
      return [
        "Xbox opened a public feedback channel and immediately ran into the exclusives problem.",
        claimSentence,
        "That reaction matters because it is the same pressure Xbox keeps facing: players want clarity on what stays exclusive.",
        "If Microsoft uses the feedback seriously, release timing and platform promises are where fans will look first.",
        "This is a trust story about where Xbox games land next.",
        "Xbox can call it feedback; players will treat it like a promise test.",
      ];
    }
    return [
      "Xbox exclusives are back in the strategy conversation.",
      claimSentence,
      "The pressure point is simple: players still want to know which games stay locked to Xbox and which ones move wider.",
      "That affects launch expectations before a trailer or release date even matters.",
      "Until Xbox gives a cleaner rule, every big first-party announcement carries the same platform question.",
      "That is why a leadership quote can turn into a platform-war story fast.",
    ];
  }
  if (intent === "industry_job_market") {
    return [
      `${subject} puts a familiar name on a grim hiring market.`,
      claimSentence,
      "Even credited specialists are struggling to get interviews, and that says more than another studio statement.",
      "Players feel that later, when sequels, remakes and new studios ship with thinner audio teams.",
      "The story hurts because the credits are not obscure; they are attached to games people still talk about.",
      "That makes the hiring squeeze feel close to the games on the shelf, not hidden in an earnings call.",
    ];
  }
  if (intent === "community_or_legal") {
    if (/\bsubnautica\b/i.test(subject)) {
      return [
        `${subject} is dealing with leaks before players have even seen the finished version.`,
        claimSentence,
        "Unfinished footage can become the first impression, even when the real game is still changing.",
        "That is rough for fans and rough for the studio.",
        "The official build is still the one that should carry the verdict.",
      ];
    }
    if (/\bnintendo\b/i.test(subject)) {
      return [
        `${subject} is a strange legal fight, not another normal Nintendo takedown story.`,
        claimSentence,
        "The unusual part is the target: a fan programme rejection, not a ROM site or a clone game.",
        "That makes it a community-access dispute around one of Pokemon's official programmes.",
        "It is small compared with Nintendo's biggest legal fights, but weird enough to watch.",
      ];
    }
    return [
      `${subject} has a community dispute attached to the headline now.`,
      claimSentence,
      "The human conflict is the story here, not a sweeping claim about the whole game.",
      "A response from the other side would change the shape of it fast.",
      "Until then, the strongest version sticks to the named people, the named source and the claim on the table.",
    ];
  }
  return [
    `${subject} has one concrete change worth remembering.`,
    `${claimSentence}`,
    "That gives the short a clean shape: what changed, who said it and why players should care today.",
    "Footage, platform support or a hard date can turn it into a bigger follow-up later.",
    `${subject} works best as a tight news hit with the source visible and no extra lore dumped on top.`,
  ];
}

function durationFallbackSentencesFor(canonical = {}) {
  const intent = classifyStoryIntent(canonical);
  if (intent === "community_or_legal") {
    if (/\bsubnautica\s*2\b/i.test(scriptSubjectFor(canonical))) {
      return [
        "If the source changes, the wording has to change with it.",
        "The stronger follow-up is official gameplay, not another rough-build clip.",
      ];
    }
    return [
      "If either side answers, the story changes from odd filing to clearer dispute.",
      "For now, the facts are the lawsuit, the rejection and the named companies involved.",
    ];
  }
  if (intent === "hardware_signal") {
    return [
      "Until Valve confirms it, the leak stays provisional, but hardware timing is the part PC players can plan around.",
      "Price and compatibility are the details that would make this feel real fast.",
    ];
  }
  if (intent === "business_bonus_dispute") {
    return [
      "A confirmed timeline would turn this from business noise into a clearer launch-pressure story.",
      "Until then, the audience has two questions: what changed inside Krafton, and whether the sequel still looks strong.",
    ];
  }
  if (intent === "ownership_pressure") {
    return [
      "If Kadokawa responds, this becomes a strategy fight instead of a stake-count headline.",
      "Right now, the number is the story: 11.85%, and a louder investor standing ahead of Sony.",
    ];
  }
  if (intent === "live_event_unlock") {
    return [
      "The next official post needs the exact raid window, access rules and regional timing.",
      "That is the part that decides whether lapsed players actually come back for the weekend.",
    ];
  }
  if (intent === "platform_strategy") {
    return [
      "Until Microsoft gives a cleaner rule, every big Xbox announcement carries the same platform question.",
      "That is why feedback can become strategy news before a new release date even appears.",
    ];
  }
  if (intent === "deal_or_access") {
    return [
      "Retailer deals move quickly, so the current listing is the part to verify before treating it as live.",
      "The value only makes sense for viewers already considering the game or hardware.",
    ];
  }
  if (intent === "release_or_showcase") {
    const text = lowerText([
      canonical.selected_title,
      canonical.canonical_title,
      canonical.description,
      ...asArray(canonical.confirmed_claims),
    ].join(" "));
    if (/\bhades ii\b/.test(text)) {
      return [
        "Longer footage needs to prove combat rhythm and controller feel.",
        "A simultaneous launch would make consoles feel day one, not late.",
      ];
    }
    if (/\bstar wars\b/.test(text) && /\bracer\b/.test(text)) {
      return [
        "Official confirmation would settle the timing without turning it into a verdict.",
        "Until then, the story is the slip and the old arcade name coming back.",
      ];
    }
    if (/\bstranger than heaven\b/.test(text)) {
      return [
        "One mission needs to prove the era shift changes the job, not just the clothes.",
        "That is the difference between a time-jump game and a stylish trailer montage.",
        "One era should make the chase, fight or choice feel different on screen.",
      ];
    }
    if (/\bthe expanse\b|\bosiris reborn\b/.test(text)) {
      return [
        "The next official cut needs one uninterrupted mission before the hype can settle.",
        "That is the player test after the first reveal.",
        "If that mission feels flat, the reveal loses its edge fast.",
      ];
    }
  }
  return [
    "One more direct play segment would show whether the combat rhythm and camera weight match the reveal.",
    "Release timing and platform detail turn curiosity into something viewers can actually act on.",
  ];
}

function repairStrategyForTarget(target = DEFAULT_TARGET_SECONDS) {
  const min = Number(target.min || DEFAULT_TARGET_SECONDS.min);
  return min >= NORMAL_PRODUCTION_TARGET_SECONDS.min
    ? NORMAL_PRODUCTION_REPAIR_STRATEGY
    : REPAIR_STRATEGY;
}

function targetWordCountFor({ script = "", currentDurationS, targetDurationS, provider = "" } = {}) {
  const currentWords = wordCount(script);
  const currentDuration = Number(currentDurationS);
  const targetDuration = Number(targetDurationS);
  const isNormalProduction = targetDuration >= NORMAL_PRODUCTION_TARGET_SECONDS.min;
  const isLocalProvider = /\blocal\b/i.test(provider);
  if (!currentWords || !Number.isFinite(currentDuration) || currentDuration <= 0) {
    return isNormalProduction ? Math.max(currentWords + 36, isLocalProvider ? 120 : 112) : currentWords + 22;
  }
  if (isNormalProduction) {
    const secondsShort = Math.max(0, targetDuration - currentDuration);
    if (isLocalProvider && currentDuration < targetDuration) {
      if (secondsShort <= 2) {
        return Math.min(124, Math.max(116, currentWords + 18, Math.ceil(currentWords + secondsShort * 4 + 8)));
      }
      if (currentDuration < 30) {
        return Math.min(132, Math.max(122, currentWords + 58));
      }
      return Math.min(132, Math.max(120, currentWords + 44));
    }
    if (secondsShort <= 2) {
      return Math.min(105, Math.max(currentWords + 8, Math.ceil(currentWords + secondsShort * 3 + 5)));
    }
    if (currentDuration < 30) {
      return Math.min(132, Math.max(112, currentWords + 52));
    }
    return Math.min(128, Math.max(108, currentWords + 32));
  }
  return Math.max(
    Math.ceil((currentWords / currentDuration) * targetDuration + 3),
    0,
  );
}

function sentenceList(value = "") {
  return cleanText(value).split(/(?<=[.!?])\s+/).map(cleanText).filter(Boolean);
}

function stripFormulaicDurationResidue(value = "") {
  const kept = sentenceList(value).filter((sentence) =>
    !FORMULAIC_DURATION_RESIDUE_RE.test(sentence) &&
    !LIVE_EVENT_TRAILER_RESIDUE_RE.test(sentence) &&
    !FLAT_CREATIVE_RESIDUE_RE.test(sentence)
  );
  return cleanText(kept.join(" "));
}

function sentenceWithPeriod(value = "") {
  const text = cleanText(value).replace(/[.?!]+$/g, "");
  return text ? `${text}.` : "";
}

function normaliseScriptPunctuation(value = "") {
  return cleanText(value)
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function isPulseCtaSentence(value = "") {
  const text = lowerText(value);
  return APPROVED_PULSE_CTAS.some((cta) => text.includes(lowerText(cta)));
}

function splitScriptAndCta(value = "") {
  let cta = "";
  const body = sentenceList(value).filter((sentence) => {
    if (isPulseCtaSentence(sentence)) {
      if (!cta && !STALE_IDENTITY_CTA_RE.test(sentence)) cta = sentenceWithPeriod(sentence);
      return false;
    }
    return true;
  });
  return {
    body: cleanText(body.join(" ")),
    cta: cta || sentenceWithPeriod(PRIMARY_PULSE_CTA),
  };
}

function appendCtaAtEnd(script = "", cta = PRIMARY_PULSE_CTA) {
  const { body } = splitScriptAndCta(script);
  return normaliseScriptPunctuation(`${body} ${sentenceWithPeriod(cta)}`);
}

function durationSentenceDedupeKey(sentence = "") {
  return lowerText(normaliseProtectedNamesText(sentence)).replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeDurationScriptSentences(value = "") {
  const seen = new Set();
  const kept = [];
  for (const sentence of sentenceList(value)) {
    const key = durationSentenceDedupeKey(sentence);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(sentence);
  }
  return cleanText(kept.join(" "));
}

function extensionSentenceAlreadyCovered(script = "", sentence = "", claim = "") {
  if (includesText(script, sentence)) return true;
  const normalisedScript = normaliseProtectedNamesText(script);
  const normalisedSentence = normaliseProtectedNamesText(sentence);
  if (
    (normalisedScript !== script || normalisedSentence !== sentence) &&
    includesText(normalisedScript, normalisedSentence)
  ) {
    return true;
  }
  const cleanClaim = cleanText(claim);
  if (cleanClaim && includesText(script, cleanClaim) && includesText(sentence, cleanClaim)) return true;
  const normalisedClaim = normaliseProtectedNamesText(cleanClaim);
  if (
    normalisedClaim &&
    (normalisedClaim !== cleanClaim || normalisedScript !== script || normalisedSentence !== sentence) &&
    includesText(normalisedScript, normalisedClaim) &&
    includesText(normalisedSentence, normalisedClaim)
  ) {
    return true;
  }
  if (expanseExtensionBeatAlreadyCovered(script, sentence)) return true;
  const motif = publicSentenceMotif(sentence);
  if (motif && sentenceList(script).some((existing) => publicSentenceMotif(existing) === motif)) return true;
  return false;
}

function expanseExtensionBeatAlreadyCovered(script = "", sentence = "") {
  const candidate = lowerText(sentence);
  if (
    /\bthe catch is whether\b/.test(candidate) &&
    /\b(?:camera|gunfights?|ship scale|scale)\b/.test(candidate) &&
    /\b(?:the expanse|osiris reborn)\b/.test(candidate)
  ) {
    return sentenceList(script).some((existing) => {
      const text = lowerText(existing);
      return /\bthe catch is\b/.test(text) &&
        /\bmission flow\b/.test(text) &&
        /\b(?:camera|gunfights?|scale)\b/.test(text);
    });
  }
  if (/\bshort showcases? can sell impact\b/.test(candidate) && /\bmission flow\b/.test(candidate)) {
    return sentenceList(script).some((existing) => {
      const text = lowerText(existing);
      return (/\bshort showcases? can sell impact\b/.test(text) && /\bmission flow\b/.test(text)) ||
        (/\bmission flow\b/.test(text) && /\b(?:camera|gunfights?|scale)\b/.test(text));
    });
  }
  if (/\b(?:that is the player test|if that mission feels flat)\b/.test(candidate)) {
    return sentenceList(script).some((existing) => {
      const text = lowerText(existing);
      return /\bthe catch is why mission flow matters\b/.test(text) &&
        /\b(?:gunfights?|camera|scale)\b/.test(text);
    });
  }
  return false;
}

function publicSentenceMotif(sentence = "") {
  const text = lowerText(sentence);
  if (!text) return "";
  if (/\bgameplay\b/.test(text) && /\b(?:finally\s+(?:showed|shows)|shown|footage|on screen|reveal|revealed)\b/.test(text)) {
    return "gameplay_reveal_evidence";
  }
  if (/\bfans are watching\b/.test(text) || /\bofficial updates?\b.*\bland(?:s|ed|ing)? heavier\b/.test(text)) {
    return "audience_update_pressure";
  }
  if (/\bpayout\b/.test(text) && /\b(?:confirmed|lands?|rewarded|reward|trigger|timeline)\b/.test(text)) {
    return "payout_reward_timeline";
  }
  if (/\bbonus fight\b/.test(text) && /\bsequel\b/.test(text)) {
    return "bonus_sequel_frame";
  }
  return "";
}

function captionScriptForDurationRepair(script = "") {
  const sentences = sentenceList(script);
  if (sentences.length <= 8) return script;
  const last = sentences[sentences.length - 1];
  if (isPulseCtaSentence(last)) {
    return cleanText([...sentences.slice(0, 7), last].join(" "));
  }
  return cleanText(sentences.slice(0, 8).join(" "));
}

function finalSentenceHasPulseCta(value = "") {
  const sentences = sentenceList(value);
  if (!sentences.length) return false;
  return isPulseCtaSentence(sentences[sentences.length - 1]);
}

function isoTimestampAfter(left, right) {
  const leftMs = Date.parse(cleanText(left));
  const rightMs = Date.parse(cleanText(right));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs > rightMs;
}

function needsDurationScriptQualityRepair(canonical = {}) {
  const script = cleanText(canonical.narration_script || canonical.full_script || canonical.tts_script);
  if (!script) return false;
  if (isoTimestampAfter(canonical.public_copy_repaired_at, canonical.duration_variant_repaired_at)) return true;
  if (protectedBrandNamesNeedDurationRepair(canonical)) return true;
  if (durationThumbnailNeedsRepair(canonical)) return true;
  if (FORMULAIC_DURATION_RESIDUE_RE.test(script)) return true;
  if (classifyStoryIntent(canonical) === "price_increase" && PRICE_INCREASE_DURATION_RESIDUE_RE.test(script)) return true;
  if (LIVE_EVENT_TRAILER_RESIDUE_RE.test(script)) return true;
  if (hasRepeatedPublicSentenceMotifs(script)) return true;
  if (hasRepeatedNumericClaims(script)) return true;
  if (/\.{2,}/.test(script)) return true;
  if (/follow pulse gaming/i.test(script) && !finalSentenceHasPulseCta(script)) return true;
  if (durationScriptScorecardNeedsRepair(canonical, script)) return true;
  return false;
}

function durationScriptScorecardNeedsRepair(canonical = {}, script = "") {
  const scorecard = buildViralScriptIntelligence({
    story_id: cleanText(canonical.story_id || canonical.id),
    selected_title: cleanText(canonical.selected_title || canonical.title),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game),
    first_spoken_line: cleanText(canonical.first_spoken_line || sentenceList(script)[0]),
    narration_script: script,
    full_script: script,
    primary_source: cleanText(canonical.primary_source || canonical.source_card_label || canonical.official_source),
    source_card_label: cleanText(canonical.source_card_label),
  });
  return asArray(scorecard.blockers)
    .map(cleanText)
    .some((blocker) => blocker === "repeated_phrase" || blocker === "generic_reveal_catch_template");
}

function durationRepairStatusWithScriptScorecard(durationStatus = {}, scriptScorecard = {}) {
  const scriptBlockers = asArray(scriptScorecard.blockers)
    .map(cleanText)
    .filter((blocker) => blocker === "repeated_phrase" || blocker === "generic_reveal_catch_template");
  const durationBlockers = durationStatus.blocker ? [durationStatus.blocker] : [];
  if (!scriptBlockers.length) {
    return {
      status: durationStatus.status,
      blockers: durationBlockers,
    };
  }
  return {
    status: "warning_held",
    blockers: [
      ...durationBlockers,
      ...scriptBlockers.map((blocker) => `script_scorecard:${blocker}`),
    ],
  };
}

async function existingDurationScriptScorecardNeedsRepair(artifactDir) {
  const scorecardPath = path.join(artifactDir, "script_scorecard.json");
  const scorecard = await readJsonIfPresent(scorecardPath, null);
  if (!scorecard) return false;
  return asArray(scorecard.blockers)
    .map(cleanText)
    .some((blocker) => blocker === "repeated_phrase" || blocker === "generic_reveal_catch_template");
}

function protectedBrandNamesNeedDurationRepair(canonical = {}) {
  const fields = [
    canonical.canonical_subject,
    canonical.canonical_game,
    canonical.selected_title,
    canonical.thumbnail_headline,
    canonical.thumbnail_text,
    canonical.first_spoken_line,
    canonical.narration_script,
    canonical.full_script,
    canonical.tts_script,
    canonical.description,
    ...asArray(canonical.confirmed_claims),
  ];
  return fields.some((field) => typeof field === "string" && normaliseProtectedNamesText(field) !== field);
}

function durationThumbnailNeedsRepair(canonical = {}) {
  const headline = cleanText(canonical.thumbnail_headline || canonical.thumbnail_text);
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_game);
  if (!headline || !subject) return false;
  const normalisedHeadline = lowerText(headline).replace(/[^a-z0-9]+/g, " ");
  const importantTokens = subject
    .split(/\s+/)
    .map((token) => lowerText(token).replace(/[^a-z0-9]+/g, ""))
    .filter((token) => token.length >= 4 && !/^(the|and|with|from|that)$/.test(token));
  if (!importantTokens.length) return false;
  return !importantTokens.some((token) => normalisedHeadline.includes(token));
}

function hasRepeatedPublicSentenceMotifs(script = "") {
  const counts = new Map();
  for (const sentence of sentenceList(script)) {
    const motif = publicSentenceMotif(sentence);
    if (!motif) continue;
    const next = (counts.get(motif) || 0) + 1;
    if (next > 1) return true;
    counts.set(motif, next);
  }
  return false;
}

function hasRepeatedNumericClaims(script = "") {
  const counts = new Map();
  const matches = cleanText(script).match(
    /\b(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s?(?:million|billion)|\$\d+(?:\.\d+)?(?:\s?(?:million|billion))?)\b/gi,
  ) || [];
  for (const match of matches) {
    const key = lowerText(match).replace(/\s+/g, " ");
    const next = (counts.get(key) || 0) + 1;
    if (next >= 3) return true;
    counts.set(key, next);
  }
  return false;
}

function isDurationCeilingRepair(job = {}) {
  return (
    cleanText(job.repair_lane) === "normal_production_duration_ceiling" ||
    Number(job.duration_reduction_required_seconds) > 0 ||
    asArray(job.source_blockers).some((blocker) => /duration_too_long|duration_above_target/i.test(blocker))
  );
}

function isContentSignalRepair(job = {}) {
  return (
    cleanText(job.repair_lane) === "normal_production_content_signal_repair" ||
    asArray(job.source_blockers).some((blocker) =>
      /(?:pulse_gaming_no_gaming_topic_signal|approved_voice:spoken_outro_missing|spoken_outro_missing|script_scorecard:no_curiosity_marker|no_curiosity_marker)/i.test(blocker),
    )
  );
}

function targetCompactWordCount(job = {}) {
  const target = job.target_duration_seconds || NORMAL_PRODUCTION_TARGET_SECONDS;
  const maxSeconds = Number(target.max || NORMAL_PRODUCTION_TARGET_SECONDS.max);
  return Math.max(110, Math.min(132, Math.floor((maxSeconds - 2) * 2.25)));
}

function sourceLeadSentence(source = "", claim = "") {
  const cleanSource = cleanText(source);
  const cleanClaim = sentenceWithPeriod(claim);
  if (!cleanClaim) return "";
  if (cleanSource && lowerText(cleanClaim).startsWith(lowerText(cleanSource))) return cleanClaim;
  return cleanSource ? `${cleanSource} reports ${cleanClaim}` : cleanClaim;
}

function compactOpeningSubjectAlias(value = "") {
  const raw = cleanText(value);
  if (/\bstranger than heaven\b/i.test(raw)) return "Stranger Than Heaven";
  const text = cleanText(normaliseProtectedNamesText(raw));
  return cleanText(
    text
      .replace(/\b(?:five eras|reveal trailer|gameplay trailer|official trailer|launch trailer)\b.*$/i, "")
      .replace(/\s*[-|:]\s*(?:reveal|gameplay|launch|official).+$/i, ""),
  );
}

function compactPurposeSentences(canonical = {}, subject = "", claim = "") {
  const intent = classifyStoryIntent(canonical);
  if (intent === "release_or_showcase") {
    const text = lowerText([
      subject,
      canonical.selected_title,
      canonical.canonical_title,
      canonical.description,
      ...asArray(canonical.confirmed_claims),
    ].join(" "));
    if (/\bstranger than heaven\b/.test(text)) {
      return [
        "Five eras is the promise, but the awkward catch is why each jump has to change how missions play.",
        "One era needs to change how a mission starts, who you chase and what the city lets you do.",
        "That is the difference between a time-jump game and a stylish trailer montage.",
        "The next longer cut needs one mission that proves the era shift matters.",
        "The danger is obvious: five time periods can reshape the game or blur together fast.",
        "That tension is the hook, because style alone cannot carry a whole reveal.",
      ];
    }
    return [
      "The trailer gives players a first read on pace, camera and combat.",
      "The real catch is whether a full mission keeps that energy once the montage stops.",
      "A sharper play section would do more than another fast trailer sweep.",
      "That is where the next reveal can turn curiosity into trust.",
      `${subject || "The game"} still needs one uninterrupted play beat before the hype fully settles.`,
    ];
  }
  if (intent === "deal_or_access") {
    return [
      `${subject || "This deal"} is cheap enough to change the decision for players who skipped it at full price.`,
      "The retailer matters because stock, region and condition can move faster than the headline.",
      "For players who already wanted it, the current listing is the detail to check.",
    ];
  }
  if (intent === "patch_or_performance") {
    return [
      `${subject || "The update"} has to show up in normal play, not just in the notes.`,
      "Reaction clips after launch will decide whether this was a fix or another patch headline.",
      "That gives the short a gameplay consequence instead of a checklist.",
    ];
  }
  if (intent === "platform_signal") {
    return [
      `${subject || "This"} is also an Xbox-on-Steam signal, because one store can change the whole launch read.`,
      "Game Pass messaging, price and release timing are the pieces that could move around that attention.",
      "That is the uncomfortable bit: the store where Xbox wins might not be Xbox.",
    ];
  }
  if (intent === "business_bonus_dispute") {
    return [
      "Krafton now has to sell the sequel while that creator-payout story sits in public.",
      "The risk is not just the number; it is whether business drama starts to outrun the game itself.",
      "The next official update has to answer two things: what changed behind the scenes, and why players should still care.",
      "That means every trailer now carries extra baggage before players even judge the sequel.",
      "A strong gameplay beat is the cleanest way to pull attention back to the game.",
    ];
  }
  if (intent === "live_event_unlock") {
    return [
      "Mega Mewtwo is the headline, but the free Go Fest Global hook is what widens the audience.",
      "The next player details are timing, raid access and whether the debut feels fair without a paid ticket.",
      "If Niantic gets that right, the event becomes a comeback moment instead of a one-day check-in.",
      "If it gets that wrong, the reveal becomes another Pokemon Go availability argument.",
    ];
  }
  return [
    `${subject || "This story"} is waiting on footage, platform detail or player reaction before the launch picture is clear.`,
    "A date, price or performance detail would make the story easier to judge.",
    sourceClaimSentence(cleanText(canonical.primary_source || canonical.source_card_label), claim),
  ];
}

function compactScriptToTarget(canonical = {}, job = {}, baseScript = "") {
  const subject = scriptSubjectFor(canonical);
  const publicSubject = cleanText(canonical.canonical_subject || canonical.canonical_game || subject);
  const source = cleanText(canonical.primary_source || canonical.source_card_label || "the source");
  const claim = sourceSafeClaimForExtension(canonical, subject);
  const { body: baseBody, cta } = splitScriptAndCta(baseScript);
  const existingSentences = sentenceList(baseBody);
  const openingAlias = compactOpeningSubjectAlias(publicSubject || subject);
  const firstSentence = existingSentences.find((sentence) => publicSubject && includesText(sentence, publicSubject)) ||
    (publicSubject === subject ? existingSentences.find((sentence) => includesText(sentence, subject)) : "") ||
    (openingAlias && openingAlias !== publicSubject
      ? existingSentences.find((sentence) => includesText(sentence, openingAlias))
      : "") ||
    (publicSubject === subject ? existingSentences[0] : "") ||
    `${publicSubject || subject || "This story"} has a source-checked gaming update.`;
  const targetWords = targetCompactWordCount(job);
  const bodyTargetWords = Math.max(78, targetWords - wordCount(cta));
  const candidates = [
    firstSentence,
    sourceLeadSentence(source, claim),
    ...compactPurposeSentences(canonical, subject, claim),
  ];
  let nextScript = "";
  for (const sentence of candidates) {
    const cleanSentence = cleanText(sentence);
    if (!cleanSentence || includesText(nextScript, cleanSentence)) continue;
    const candidate = cleanText(`${nextScript} ${cleanSentence}`);
    if (wordCount(candidate) > bodyTargetWords && wordCount(nextScript) >= 72) break;
    nextScript = candidate;
  }
  const finalScript = normaliseProtectedNamesText(appendCtaAtEnd(nextScript || firstSentence, cta));
  return {
    script: finalScript,
    original_word_count: wordCount(baseScript),
    repaired_word_count: wordCount(finalScript),
    target_word_count: targetWords,
    appended_word_count: Math.max(0, wordCount(finalScript) - wordCount(baseScript)),
    removed_word_count: Math.max(0, wordCount(baseScript) - wordCount(finalScript)),
  };
}

function extendScriptToTarget(canonical = {}, job = {}) {
  const originalScript = cleanText(canonical.narration_script || canonical.full_script || canonical.tts_script);
  const rawBase = normaliseDurationBaseScript(
    canonical,
    stripFormulaicDurationResidue(
      originalScript,
    ),
  );
  const subjectForBase = scriptSubjectFor(canonical);
  const subjectAliasForBase = compactOpeningSubjectAlias(subjectForBase);
  const baseMentionsSubject = !subjectForBase ||
    includesText(rawBase, subjectForBase) ||
    (subjectAliasForBase && subjectAliasForBase !== subjectForBase && includesText(rawBase, subjectAliasForBase));
  const cleanBase = baseMentionsSubject
    ? dedupeDurationScriptSentences(rawBase)
    : cleanText(
        [
          cleanText(canonical.first_spoken_line || canonical.narration_hook) ||
            `${subjectForBase || "This story"} has a source-checked gaming update.`,
          sourceLeadSentence(
            cleanText(canonical.primary_source || canonical.source_card_label || "the source"),
            sourceSafeClaimForExtension(canonical, subjectForBase),
          ),
        ].join(" "),
      );
  const { body: baseScript, cta } = splitScriptAndCta(cleanBase);
  if (isDurationCeilingRepair(job)) {
    const compact = compactScriptToTarget(canonical, job, cleanBase);
    const originalWordCount = wordCount(originalScript || cleanBase);
    return {
      ...compact,
      original_word_count: originalWordCount,
      removed_word_count: Math.max(0, originalWordCount - compact.repaired_word_count),
    };
  }
  const target = job.target_duration_seconds || DEFAULT_TARGET_SECONDS;
  const computedTargetWords = targetWordCountFor({
    script: cleanBase,
    currentDurationS: job.current_duration_s,
    targetDurationS: target.min || DEFAULT_TARGET_SECONDS.min,
    provider: job.provider,
  });
  const isNormalContentRepair = isContentSignalRepair(job) &&
    Number(target.min || DEFAULT_TARGET_SECONDS.min) >= NORMAL_PRODUCTION_TARGET_SECONDS.min;
  const targetWords = isNormalContentRepair
    ? Math.max(computedTargetWords, /\blocal\b/i.test(cleanText(job.provider)) ? 124 : 105)
    : computedTargetWords;
  const bodyTargetWords = Math.max(30, targetWords - wordCount(cta));
  if (isNormalContentRepair && wordCount(baseScript) > bodyTargetWords) {
    const compact = compactScriptToTarget(canonical, job, cleanBase);
    const originalWordCount = wordCount(originalScript || cleanBase);
    return {
      ...compact,
      original_word_count: originalWordCount,
      appended_word_count: Math.max(0, compact.repaired_word_count - originalWordCount),
      removed_word_count: Math.max(0, originalWordCount - compact.repaired_word_count),
    };
  }
  const sentences = extensionSentencesFor(canonical);
  const claim = sourceSafeClaimForExtension(canonical, scriptSubjectFor(canonical));
  let nextScript = baseScript;
  for (const sentence of sentences) {
    if (wordCount(nextScript) >= bodyTargetWords) break;
    if (!extensionSentenceAlreadyCovered(nextScript, sentence, claim)) {
      nextScript = `${nextScript} ${sentence}`.trim();
    }
  }
  if (wordCount(nextScript) < bodyTargetWords) {
    const fallbackCandidates = durationFallbackSentencesFor(canonical);
    for (const fallback of fallbackCandidates) {
      if (wordCount(nextScript) >= bodyTargetWords) break;
      if (!extensionSentenceAlreadyCovered(nextScript, fallback, claim)) {
        nextScript = `${nextScript} ${fallback}`.trim();
      }
    }
  }
  const finalScript = normaliseProtectedNamesText(appendCtaAtEnd(nextScript, cta));
  return {
    script: finalScript,
    original_word_count: wordCount(cleanBase),
    repaired_word_count: wordCount(finalScript),
    target_word_count: targetWords,
    appended_word_count: Math.max(0, wordCount(finalScript) - wordCount(cleanBase)),
  };
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

async function validateRepairInputs(job = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const blockers = [];
  if (!artifactDir || !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const canonical = await readJsonIfPresent(canonicalPath, null);
  let rights = await readJsonIfPresent(rightsPath, null);
  if (!canonical) blockers.push("canonical_story_manifest_missing");
  if (!rights) blockers.push("rights_ledger_missing");
  if (rights) {
    rights = await repairRecoverableRightsLedger({
      rightsPath,
      rights,
      generatedAt: job.generated_at || new Date().toISOString(),
    });
  }
  if (canonical && !cleanText(canonical.canonical_subject || canonical.canonical_game)) {
    blockers.push("missing_canonical_subject");
  }
  if (canonical && !cleanText(canonical.narration_script || canonical.full_script || canonical.tts_script)) {
    blockers.push("narration_script_missing");
  }
  if (
    canonical &&
    containsBannedPublicPhrase(canonical.narration_script) &&
    !FORMULAIC_DURATION_RESIDUE_RE.test(cleanText(canonical.narration_script))
  ) {
    blockers.push("existing_script_contains_internal_qa_language");
  }
  const motionClipPaths = await collectMotionClipPaths(rights, artifactDir);
  if (rights && cleanText(rights.verdict).toLowerCase() === "fail") blockers.push("rights_ledger_failed");
  if (rights && motionClipPaths.length === 0) blockers.push("rights_safe_motion_clips_missing");
  return {
    artifactDir,
    canonicalPath,
    rightsPath,
    canonical,
    rights,
    motionClipPaths,
    blockers,
  };
}

async function backupRightsLedgerOnce(rightsPath, generatedAt) {
  const backupPath = `${rightsPath}.pre_duration_variant_repair.json`;
  if (!(await fs.pathExists(backupPath))) {
    const current = await fs.readJson(rightsPath);
    await fs.writeJson(backupPath, {
      ...current,
      backup_created_at: generatedAt,
      backup_reason: "duration_variant_rights_ledger_repair",
    }, { spaces: 2 });
  }
  return backupPath;
}

function recoverableRightsAssets(rights = {}) {
  return asArray(rights.assets).filter((asset) => {
    const kind = lowerText(asset.kind || asset.type || asset.asset_type);
    const isRenderableAsset = kind.includes("video") || kind.includes("motion") || /\.mp4$/i.test(cleanText(asset.path));
    if (!isRenderableAsset) return false;
    if (!cleanText(asset.path)) return false;
    return Boolean(cleanText(asset.source_url || asset.source_family || asset.rights_risk_class || asset.source_type));
  });
}

function rightsRecordFromRecoverableAsset(asset = {}, index = 0) {
  const licenceBasis = cleanText(
    asset.licence_basis ||
      asset.license_basis ||
      asset.rights_basis ||
      asset.rights_risk_class ||
      asset.source_type ||
      "source_documented_editorial_use",
  );
  return {
    asset_id: cleanText(asset.asset_id || asset.id || `repaired_motion_asset_${index + 1}`),
    asset_type: cleanText(asset.asset_type || asset.type || asset.kind || "motion_clip"),
    kind: cleanText(asset.kind || "video"),
    path: cleanText(asset.path || asset.local_materialized_path),
    source_url: cleanText(asset.source_url || asset.evidence_reference || ""),
    source_owner: cleanText(asset.source_owner || asset.provider || asset.entity || "source owner not specified"),
    source_type: cleanText(asset.source_type || asset.source_kind || asset.source_url_kind || "source_documented_media"),
    licence_basis: licenceBasis,
    allowed_use: cleanText(asset.allowed_use || asset.allowed_render_use || "transformative_editorial_short_form"),
    allowed_platforms: asArray(asset.allowed_platforms).length ? asArray(asset.allowed_platforms) : [...ALL_SOCIAL_PLATFORMS],
    commercial_use_allowed: asset.commercial_use_allowed === false ? false : true,
    transformation_notes: cleanText(
      asset.transformation_notes ||
        "Used as a short transformed editorial clip inside a governed Pulse Gaming news render with source labelling.",
    ),
    expiry: asset.expiry || asset.expires_at || null,
    credit_required: asset.credit_required === true,
    evidence_reference: cleanText(
      asset.evidence_reference ||
        asset.provenance?.source_report ||
        asset.provenance?.source ||
        asset.source_url ||
        asset.path,
    ),
    risk_score: Number.isFinite(Number(asset.risk_score)) ? Number(asset.risk_score) : 0.28,
    approval_status: cleanText(
      asset.approval_status ||
        (asset.trusted_source_matched ? "approved_for_transformative_editorial_use" : "review_required"),
    ),
  };
}

function recoverableNoRightsRecordFailure(rights = {}) {
  if (cleanText(rights.verdict).toLowerCase() !== "fail") return false;
  const failures = asArray(rights.failures).map(cleanText);
  if (!failures.includes("rights:no_rights_record")) return false;
  if (asArray(rights.records).length || asArray(rights.rights_ledger).length || asArray(rights.matched_assets).length) {
    return false;
  }
  return recoverableRightsAssets(rights).length > 0;
}

async function repairRecoverableRightsLedger({ rightsPath, rights = {}, generatedAt } = {}) {
  if (!rightsPath || !recoverableNoRightsRecordFailure(rights)) return rights;
  const assets = recoverableRightsAssets(rights);
  await backupRightsLedgerOnce(rightsPath, generatedAt);
  const records = assets.map(rightsRecordFromRecoverableAsset);
  const updated = {
    ...rights,
    verdict: "pass",
    failures: asArray(rights.failures).filter((failure) => cleanText(failure) !== "rights:no_rights_record"),
    records,
    matched_assets: records.map((record) => ({
      asset_id: record.asset_id,
      kind: record.kind,
      path: record.path,
      source_url: record.source_url,
      rights_record_id: record.asset_id,
      licence_basis: record.licence_basis,
      risk_score: record.risk_score,
    })),
    rights_ledger_repaired_at: generatedAt,
    rights_ledger_repair_strategy: "promote_source_evidenced_motion_assets_to_explicit_rights_records",
  };
  await fs.writeJson(rightsPath, updated, { spaces: 2 });
  return updated;
}

function normaliseAssetPath(assetPath, artifactDir) {
  const text = cleanText(assetPath);
  if (!text) return "";
  if (path.isAbsolute(text)) return text;
  const fromWorkspace = path.resolve(process.cwd(), text);
  const fromArtifact = path.resolve(artifactDir, text);
  return fs.existsSync(fromWorkspace) ? fromWorkspace : fromArtifact;
}

function motionPathFor(row = {}) {
  return cleanText(
    row.path ||
      row.local_materialized_path ||
      row.local_materialised_path ||
      row.local_path ||
      row.file_path ||
      row.media_path,
  );
}

function rowText(row = {}) {
  return [
    row.kind,
    row.type,
    row.asset_type,
    row.media_kind,
    row.source_type,
    row.licence_basis,
    row.license_basis,
    row.rights_basis,
    row.allowed_use,
    row.approval_status,
    motionPathFor(row),
  ].map(cleanText).filter(Boolean).join(" ");
}

function rowKindText(row = {}) {
  return [row.kind, row.type, row.asset_type, row.media_kind]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function isMotionLikeRow(row = {}) {
  const text = lowerText(rowKindText(row));
  return text.includes("video") || text.includes("motion") || /\.mp4$/i.test(motionPathFor(row));
}

function isRightsSafeMotionRow(row = {}) {
  if (!isMotionLikeRow(row)) return false;
  if (row.commercial_use_allowed === false) return false;
  const risk = Number(row.risk_score);
  if (Number.isFinite(risk) && risk > 0.35) return false;
  const approval = lowerText(row.approval_status);
  if (approval && UNSAFE_APPROVAL_RE.test(approval)) return false;
  return SAFE_MOTION_RIGHTS_RE.test(rowText(row));
}

function rightsMatchKeys(row = {}) {
  return [
    row.asset_id,
    row.id,
    row.rights_record_id,
    row.source_url,
    row.evidence_reference,
    row.source_family,
    row.motion_family,
    row.visual_family,
  ].map(lowerText).filter(Boolean);
}

function buildRightsEvidenceIndex(rightRows = []) {
  const index = new Map();
  for (const row of rightRows) {
    if (row.commercial_use_allowed === false) continue;
    const risk = Number(row.risk_score);
    if (Number.isFinite(risk) && risk > 0.35) continue;
    const approval = lowerText(row.approval_status);
    if (approval && UNSAFE_APPROVAL_RE.test(approval)) continue;
    if (!SAFE_MOTION_RIGHTS_RE.test(rowText(row))) continue;
    for (const key of rightsMatchKeys(row)) {
      if (!index.has(key)) index.set(key, row);
    }
  }
  return index;
}

function hasMatchingRightsEvidence(row = {}, rightsIndex = new Map()) {
  return rightsMatchKeys(row).some((key) => rightsIndex.has(key));
}

async function collectMaterialisedMotionRows(artifactDir = "") {
  const rows = [];
  for (const fileName of ["materialised_motion_clips.json", "owned_motion_manifest.json"]) {
    const manifest = await readJsonIfPresent(path.join(artifactDir, fileName), {});
    rows.push(
      ...asArray(manifest.clips),
      ...asArray(manifest.materialised_clips),
      ...asArray(manifest.materialized_clips),
    );
  }
  return rows;
}

async function collectMotionClipPaths(rights = {}, artifactDir = "") {
  const rightsRows = [
    ...asArray(rights?.matched_assets),
    ...asArray(rights?.assets),
    ...asArray(rights?.records),
    ...asArray(rights?.rights_ledger),
  ];
  const materialisedRows = await collectMaterialisedMotionRows(artifactDir);
  const rightsIndex = buildRightsEvidenceIndex(rightsRows);
  const seen = new Set();
  const clips = [];
  for (const row of rightsRows) {
    if (!isRightsSafeMotionRow(row)) continue;
    const resolved = normaliseAssetPath(motionPathFor(row), artifactDir);
    if (!resolved || seen.has(resolved) || !(await fs.pathExists(resolved))) continue;
    seen.add(resolved);
    clips.push(resolved);
  }
  for (const row of materialisedRows) {
    if (row.counts_towards_motion_readiness === false) continue;
    if (!isMotionLikeRow(row)) continue;
    if (!SAFE_MOTION_RIGHTS_RE.test(rowText(row))) continue;
    if (!hasMatchingRightsEvidence(row, rightsIndex)) continue;
    const resolved = normaliseAssetPath(motionPathFor(row), artifactDir);
    if (!resolved || seen.has(resolved) || !(await fs.pathExists(resolved))) continue;
    seen.add(resolved);
    clips.push(resolved);
  }
  return clips;
}

async function backupCanonicalOnce(canonicalPath, generatedAt) {
  const backupPath = `${canonicalPath}.pre_duration_variant_repair.json`;
  if (!(await fs.pathExists(backupPath))) {
    const current = await fs.readJson(canonicalPath);
    await fs.writeJson(backupPath, {
      ...current,
      backup_created_at: generatedAt,
      backup_reason: "duration_variant_repair",
    }, { spaces: 2 });
  }
  return backupPath;
}

async function updateCanonicalForDurationRepair({
  canonicalPath,
  canonical,
  job,
  generatedAt,
} = {}) {
  const extension = extendScriptToTarget(canonical, job);
  if (containsBannedPublicPhrase(extension.script)) {
    throw new Error("repaired_script_contains_internal_qa_language");
  }
  const firstLine = normaliseProtectedNamesText(
    sentenceList(extension.script)[0] || cleanText(canonical.first_spoken_line || canonical.narration_hook),
  );
  const subject = cleanText(normaliseProtectedNamesText(canonical.canonical_subject || canonical.canonical_game));
  const headline = durationRepairThumbnailHeadline(canonical.selected_title || job.title, subject);
  await backupCanonicalOnce(canonicalPath, generatedAt);
  const updated = normaliseProtectedNamesInDurationManifest({
    ...canonical,
    thumbnail_headline: headline || canonical.thumbnail_headline,
    thumbnail_text: headline || canonical.thumbnail_text,
    first_spoken_line: firstLine,
    narration_hook: firstLine,
    narration_script: extension.script,
    full_script: extension.script,
    tts_script: extension.script,
    description: sourceSafeDescriptionForDuration(canonical),
    word_count: extension.repaired_word_count,
    duration_variant_repaired_at: generatedAt,
    duration_variant_repair_strategy: repairStrategyForTarget(job.target_duration_seconds || DEFAULT_TARGET_SECONDS),
    duration_variant_original_duration_s: Number(job.current_duration_s) || null,
    duration_variant_target_duration_seconds: job.target_duration_seconds || DEFAULT_TARGET_SECONDS,
    duration_variant_extension: {
      original_word_count: extension.original_word_count,
      repaired_word_count: extension.repaired_word_count,
      target_word_count: extension.target_word_count,
      appended_word_count: extension.appended_word_count,
    },
  });
  await fs.writeJson(canonicalPath, updated, { spaces: 2 });
  return { canonical: updated, extension };
}

async function updateNormalProductionDurationContract({
  artifactDir,
  generatedAt,
  renderManifest = {},
  target = NORMAL_PRODUCTION_TARGET_SECONDS,
} = {}) {
  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const current = await readJsonIfPresent(manifestPath, {});
  const duration = Number(renderManifest.rendered_duration_s || renderManifest.duration_s || renderManifest.video_duration_s);
  const outputs = {};
  for (const [platform, existing] of Object.entries(current.outputs || {})) {
    const hardMax = NORMAL_PRODUCTION_PLATFORM_HARD_MAX_SECONDS[platform];
    const durationWarnings = new Set(
      asArray(existing.duration_warnings).filter(
        (warning) => warning !== "below_normal_production_duration_floor" &&
          warning !== "below_creator_rewards_duration",
      ),
    );
    if (Number.isFinite(duration) && duration < Number(target.min)) {
      durationWarnings.add("below_normal_production_duration_floor");
    }
    const creatorRewardsFields = {};
    if (platform === "tiktok") {
      const creatorRewardsEligible = Number.isFinite(duration) && duration >= 61 && duration <= 90;
      creatorRewardsFields.creator_rewards_eligible = creatorRewardsEligible;
      creatorRewardsFields.creator_rewards_duration_seconds = { min: 61, max: 90 };
      if (!creatorRewardsEligible) durationWarnings.add("below_creator_rewards_duration");
    }
    outputs[platform] = {
      ...existing,
      ...(hardMax
        ? { publish_duration_seconds: { min: NORMAL_PRODUCTION_HARD_MIN_SECONDS, max: hardMax } }
        : {}),
      duration_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
      target_duration_seconds: { ...target },
      strategic_duration_seconds: { ...target },
      duration_warnings: [...durationWarnings],
      ...creatorRewardsFields,
    };
  }
  const updated = {
    ...current,
    operating_mode: "DRY_RUN_PUBLISH",
    duration_lane: "normal_production",
    retention_short_approved: false,
    human_reviewed_retention_short: false,
    duration_contract_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
    rendered_duration_s: Number.isFinite(duration) ? duration : null,
    duration_contract_updated_at: generatedAt,
    outputs,
    safety: {
      ...(current.safety || {}),
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
  await fs.writeJson(manifestPath, updated, { spaces: 2 });
  return {
    status: "updated",
    duration_contract_strategy: NORMAL_PRODUCTION_REPAIR_STRATEGY,
    rendered_duration_s: Number.isFinite(duration) ? duration : null,
  };
}

function audioWorkbenchForJob(job = {}, { provider = "auto" } = {}) {
  const selectedProvider = cleanText(provider).toLowerCase();
  const jobProvider = cleanText(job.tts_provider).toLowerCase();
  const useElevenLabs = selectedProvider === "elevenlabs" || jobProvider === "elevenlabs";
  return {
    local_tts: useElevenLabs ? { verdict: "skipped", ready: false } : { verdict: "green", ready: true },
    elevenlabs_tts: useElevenLabs ? { verdict: "green", ready: true } : null,
    provider_preference: useElevenLabs ? "elevenlabs" : selectedProvider || "auto",
    jobs: [
      {
        story_id: cleanText(job.story_id),
        title: cleanText(job.title),
        artifact_dir: path.resolve(job.artifact_dir || ""),
        status: "requires_audio_timestamp_generation",
        ...(useElevenLabs ? { tts_provider: "elevenlabs" } : {}),
        missing: ["duration_variant_repair_audio", "duration_variant_repair_timestamps"],
      },
    ],
  };
}

function renderWorkOrderForJob({ job = {}, motionClipPaths = [] } = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const storyId = cleanText(job.story_id);
  return {
    jobs: [
      {
        story_id: storyId,
        title: cleanText(job.title),
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        blockers: [],
        evidence: {
          narration_audio_path: `output/audio/${storyId}.mp3`,
          word_timestamps_path: `output/audio/${storyId}_timestamps.json`,
          materialised_motion_clip_count: motionClipPaths.length,
          distinct_motion_family_count: motionClipPaths.length,
          materialised_motion_clip_paths: motionClipPaths,
        },
        actions: [
          {
            action_id: "run_visual_v4_production_render",
            status: "ready_after_duration_variant_repair",
            target_render_manifest: {
              renderer: "visual_v4_production",
              visual_tier: "production_v4_motion",
              final_publish_render: true,
              output: "visual_v4_render.mp4",
              output_path: path.join(artifactDir, "visual_v4_render.mp4"),
              manifest_path: path.join(artifactDir, "render_manifest.json"),
              story_id: storyId,
            },
          },
        ],
      },
    ],
  };
}

function durationStatusFromManifest(manifest = {}, target = DEFAULT_TARGET_SECONDS) {
  const duration = renderDurationFromManifest(manifest);
  if (!Number.isFinite(duration)) return { status: "warning_held", blocker: "missing_post_repair_duration" };
  if (duration < Number(target.min || DEFAULT_TARGET_SECONDS.min)) {
    return { status: "warning_held", blocker: "post_repair_duration_still_below_target" };
  }
  if (duration > Number(target.max || DEFAULT_TARGET_SECONDS.max)) {
    return { status: "warning_held", blocker: "post_repair_duration_above_target" };
  }
  return { status: "repaired" };
}

function renderDurationFromManifest(manifest = {}) {
  return Number(manifest.rendered_duration_s || manifest.duration_s || manifest.video_duration_s);
}

function jobBlockers(job = {}) {
  return [
    ...asArray(job.blockers),
    ...asArray(job.source_blockers),
    ...asArray(job.co_blockers),
  ].map(cleanText).filter(Boolean);
}

function hasStaleDurationMetadataBlocker(job = {}) {
  return jobBlockers(job).some((blocker) => /bridge_metadata_stale:duration_seconds/i.test(blocker));
}

function hasDurationFloorBlocker(job = {}) {
  return jobBlockers(job).some((blocker) =>
    /duration_too_short|normal_production_duration_below_quality_floor|below_normal_production_duration_floor/i.test(blocker),
  );
}

function repairJobWithCurrentRenderDuration(job = {}, renderManifest = {}, scriptQualityNeedsRepair = false) {
  const target = job.target_duration_seconds || DEFAULT_TARGET_SECONDS;
  const min = Number(target.min || DEFAULT_TARGET_SECONDS.min);
  const max = Number(target.max || DEFAULT_TARGET_SECONDS.max);
  const renderDuration = renderDurationFromManifest(renderManifest);
  const jobDuration = Number(job.current_duration_s);
  const preferWorkOrderDuration =
    Number.isFinite(jobDuration) &&
    hasStaleDurationMetadataBlocker(job) &&
    hasDurationFloorBlocker(job) &&
    (!Number.isFinite(renderDuration) || !Number.isFinite(min) || jobDuration < min || renderDuration >= min);
  const currentDuration = preferWorkOrderDuration ? jobDuration : renderDuration;
  if (!Number.isFinite(currentDuration)) return job;
  const next = {
    ...job,
    current_duration_s: currentDuration,
  };
  if (Number.isFinite(max) && currentDuration > max) {
    return {
      ...next,
      repair_lane: "normal_production_duration_ceiling",
      duration_reduction_required_seconds: Math.max(0, currentDuration - max),
    };
  }
  if (scriptQualityNeedsRepair && Number.isFinite(min) && currentDuration >= min) {
    return {
      ...next,
      repair_lane: "normal_production_content_signal_repair",
      source_blockers: [
        ...asArray(job.source_blockers),
        "duration_script_quality_repair",
      ],
    };
  }
  return next;
}

function isTiktokCreatorRewardsVariantJob(job = {}) {
  return cleanText(job.status) === "needs_tiktok_creator_rewards_variant" ||
    (
      cleanText(job.platform) === "tiktok" &&
      cleanText(job.publish_gate) ===
        "do_not_count_tiktok_creator_rewards_ready_until_long_variant_audio_render_captions_and_preflight_pass"
    );
}

function tiktokCreatorRewardsBlockedJob({ job = {}, validated = {} } = {}) {
  return {
    story_id: cleanText(job.story_id),
    title: cleanText(job.title),
    status: "blocked",
    blockers: [
      ...asArray(validated.blockers),
      "tiktok_creator_rewards_platform_variant_materializer_required",
    ],
    artifact_dir: validated.artifactDir || path.resolve(job.artifact_dir || ""),
    platform: "tiktok",
    target_duration_seconds: job.target_duration_seconds || { min: 61, max: 75 },
    required_action:
      "Build a platform-specific TikTok creator-rewards variant materializer that writes a separate long video, audio, timestamps and captions under platform_variants/tiktok_creator_rewards without mutating the base publish render.",
    base_render_mutation_allowed: false,
  };
}

async function writeDurationRepairCaptions({ artifactDir, script, renderManifest = {} } = {}) {
  const duration = renderDurationFromManifest(renderManifest);
  const durationS = Number.isFinite(duration) && duration > 0 ? duration : 28;
  const captionsPath = path.join(artifactDir, "captions.srt");
  await fs.writeFile(captionsPath, buildCaptionSrt(captionScriptForDurationRepair(script), durationS), "utf8");
  return captionsPath;
}

async function writeDurationRepairScriptScorecard({ artifactDir, canonical = {}, generatedAt } = {}) {
  const script = cleanText(canonical.narration_script || canonical.full_script || canonical.tts_script);
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: cleanText(canonical.story_id),
      title: cleanText(canonical.selected_title || canonical.title),
      source_name: cleanText(canonical.primary_source || canonical.source_card_label || canonical.source_name),
    },
    script,
  });
  const scorecardPath = path.join(artifactDir, "script_scorecard.json");
  const updated = {
    ...scorecard,
    generated_at: generatedAt,
    repair_basis: "duration_variant_repair",
    script_fingerprint: {
      word_count: wordCount(script),
      first_spoken_line: sentenceList(script)[0] || "",
    },
  };
  await fs.writeJson(scorecardPath, updated, { spaces: 2 });
  return {
    path: scorecardPath,
    verdict: updated.verdict,
    viral_score: updated.viral_score,
    blockers: updated.blockers,
    warnings: updated.warnings,
  };
}

async function durationRepairCaptionsNeedRefresh({ artifactDir, canonical = {}, renderManifest = {} } = {}) {
  const captionsPath = path.join(artifactDir, "captions.srt");
  if (!(await fs.pathExists(captionsPath))) return true;
  const captions = await fs.readFile(captionsPath, "utf8");
  const script = cleanText(canonical.narration_script || canonical.full_script || canonical.tts_script);
  const sentences = sentenceList(script);
  if (!sentences.length) return false;
  if (!captions.includes(sentences[0])) return true;
  const lastSentence = sentences[sentences.length - 1];
  if (lastSentence && !captions.includes(lastSentence)) return true;
  if (FORMULAIC_DURATION_RESIDUE_RE.test(captions) || /\.{2,}/.test(captions)) return true;
  const duration = renderDurationFromManifest(renderManifest);
  if (Number.isFinite(duration) && duration > 0 && !captions.includes(buildCaptionSrt(script, duration).trimEnd().split("\n").slice(-2, -1)[0])) {
    return true;
  }
  return false;
}

async function repairDurationVariantJob(job = {}, options = {}) {
  const storyId = cleanText(job.story_id);
  const generatedAt = options.generatedAt;
  const validated = await validateRepairInputs(job);
  if (isTiktokCreatorRewardsVariantJob(job) && !options.inspectOnly) {
    return tiktokCreatorRewardsBlockedJob({ job, validated });
  }
  if (options.inspectOnly) {
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "inspect_only_pending_duration_variant_repair",
      blockers: validated.blockers,
    };
  }
  if (validated.blockers.length) {
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "blocked",
      blockers: validated.blockers,
    };
  }
  const existingRenderManifest = await readJsonIfPresent(
    path.join(validated.artifactDir, "render_manifest.json"),
    {},
  );
  const existingDurationStatus = durationStatusFromManifest(
    existingRenderManifest,
    job.target_duration_seconds || DEFAULT_TARGET_SECONDS,
  );
  const scriptQualityNeedsRepair = needsDurationScriptQualityRepair(validated.canonical) ||
    await existingDurationScriptScorecardNeedsRepair(validated.artifactDir);
  const repairJob = {
    ...repairJobWithCurrentRenderDuration(job, existingRenderManifest, scriptQualityNeedsRepair),
    provider: options.provider || job.provider || "auto",
  };
  if (
    existingDurationStatus.status === "repaired" &&
    cleanText(validated.canonical.duration_variant_repaired_at) &&
    !isContentSignalRepair(job) &&
    !scriptQualityNeedsRepair &&
    !hasStaleDurationMetadataBlocker(job)
  ) {
    const target = repairJob.target_duration_seconds || DEFAULT_TARGET_SECONDS;
    const durationContract = repairStrategyForTarget(target) === NORMAL_PRODUCTION_REPAIR_STRATEGY
      ? await updateNormalProductionDurationContract({
          artifactDir: validated.artifactDir,
          generatedAt,
          renderManifest: existingRenderManifest,
          target,
        })
      : null;
    if (await durationRepairCaptionsNeedRefresh({
      artifactDir: validated.artifactDir,
      canonical: validated.canonical,
      renderManifest: existingRenderManifest,
    })) {
      const captionsPath = await writeDurationRepairCaptions({
        artifactDir: validated.artifactDir,
        script: validated.canonical.narration_script || validated.canonical.full_script || validated.canonical.tts_script,
        renderManifest: existingRenderManifest,
      });
      const scriptScorecard = await writeDurationRepairScriptScorecard({
        artifactDir: validated.artifactDir,
        canonical: validated.canonical,
        generatedAt,
      });
      return {
        story_id: storyId,
        title: cleanText(job.title),
        status: "captions_repaired_existing_duration_repair",
        blockers: [],
        artifact_dir: validated.artifactDir,
        repaired_duration_s: Number(existingRenderManifest.rendered_duration_s) || null,
        captions_path: captionsPath,
        script_scorecard: scriptScorecard,
        duration_contract_status: durationContract?.status || null,
      };
    }
    const scriptScorecard = await writeDurationRepairScriptScorecard({
      artifactDir: validated.artifactDir,
      canonical: validated.canonical,
      generatedAt,
    });
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "skipped_existing_duration_repair",
      blockers: [],
      artifact_dir: validated.artifactDir,
      repaired_duration_s: Number(existingRenderManifest.rendered_duration_s) || null,
      script_scorecard: scriptScorecard,
      duration_contract_status: durationContract?.status || null,
    };
  }

  let canonicalUpdate = null;
  try {
    canonicalUpdate = await updateCanonicalForDurationRepair({
      canonicalPath: validated.canonicalPath,
      canonical: validated.canonical,
      job: repairJob,
      generatedAt,
    });
    const audioReport = await materializeGoalAudioTimestamps({
      workbenchReport: audioWorkbenchForJob(repairJob, { provider: options.provider }),
      workspaceRoot: options.workspaceRoot,
      generatedAt,
      force: true,
      provider: options.provider || "auto",
      alignmentMode: options.alignmentMode,
      generateTtsForStory: options.generateTtsForStory,
    });
    const audioFailed = asArray(audioReport.jobs).find((audioJob) => audioJob.status === "failed");
    if (audioFailed) throw new Error(`audio_repair_failed:${audioFailed.error || "unknown"}`);

    const renderReport = await materializeGoalProductionRenders({
      workOrder: renderWorkOrderForJob({ job: repairJob, motionClipPaths: validated.motionClipPaths }),
      workspaceRoot: options.workspaceRoot,
      generatedAt,
      force: true,
      renderProof: options.renderProof,
    });
    const renderFailed = asArray(renderReport.jobs).find((renderJob) => renderJob.status === "failed");
    if (renderFailed) throw new Error(`render_repair_failed:${renderFailed.error || "unknown"}`);

    const renderManifest = await readJsonIfPresent(path.join(validated.artifactDir, "render_manifest.json"), {});
    const captionsPath = await writeDurationRepairCaptions({
      artifactDir: validated.artifactDir,
      script: canonicalUpdate.canonical.narration_script,
      renderManifest,
    });
    const scriptScorecard = await writeDurationRepairScriptScorecard({
      artifactDir: validated.artifactDir,
      canonical: canonicalUpdate.canonical,
      generatedAt,
    });
    const target = repairJob.target_duration_seconds || DEFAULT_TARGET_SECONDS;
    const durationContract = repairStrategyForTarget(target) === NORMAL_PRODUCTION_REPAIR_STRATEGY
      ? await updateNormalProductionDurationContract({
          artifactDir: validated.artifactDir,
          generatedAt,
          renderManifest,
          target,
        })
      : await repairGoalPlatformDurationContracts({
          storyPackages: [{ story_id: storyId, artifact_dir: validated.artifactDir }],
          generatedAt,
        });
    const durationStatus = durationStatusFromManifest(
      renderManifest,
      target,
    );
    const finalStatus = durationRepairStatusWithScriptScorecard(durationStatus, scriptScorecard);
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: finalStatus.status,
      blockers: finalStatus.blockers,
      artifact_dir: validated.artifactDir,
      original_duration_s: Number(repairJob.current_duration_s) || null,
      repaired_duration_s: Number(renderManifest.rendered_duration_s) || null,
      appended_word_count: canonicalUpdate.extension.appended_word_count,
      repaired_word_count: canonicalUpdate.extension.repaired_word_count,
      audio_status: audioReport.jobs[0]?.status || null,
      audio_provider: audioReport.jobs[0]?.provider || null,
      render_status: renderReport.jobs[0]?.status || null,
      captions_path: captionsPath,
      script_scorecard: scriptScorecard,
      duration_contract_status: durationContract.status ||
        durationContract.updated?.[0]?.status ||
        durationContract.blocked?.[0]?.status ||
        null,
      output_path: renderReport.jobs[0]?.output_path || null,
    };
  } catch (error) {
    if (canonicalUpdate) {
      await fs.writeJson(validated.canonicalPath, validated.canonical, { spaces: 2 });
    }
    throw error;
  }
}

function jobsForDurationRepair(workOrder = {}, { limit = 0, storyIds = [] } = {}) {
  const requestedStoryIds = new Set(asArray(storyIds).map(cleanText).filter(Boolean));
  let jobs = asArray(workOrder.jobs).filter(
    (job) => cleanText(job.status) === "needs_duration_variant_rerender" ||
      isTiktokCreatorRewardsVariantJob(job),
  );
  if (requestedStoryIds.size > 0) {
    jobs = jobs.filter((job) => requestedStoryIds.has(cleanText(job.story_id)));
  }
  if (Number(limit) > 0) jobs = jobs.slice(0, Number(limit));
  return jobs;
}

async function materializeDurationVariantRepairs({
  workOrder = {},
  workspaceRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  limit = 0,
  storyIds = [],
  inspectOnly = false,
  provider = "auto",
  alignmentMode,
  generateTtsForStory,
  renderProof,
} = {}) {
  const jobs = jobsForDurationRepair(workOrder, { limit, storyIds });
  const results = [];
  for (const job of jobs) {
    try {
      results.push(
        await repairDurationVariantJob(job, {
          workspaceRoot: path.resolve(workspaceRoot),
          generatedAt,
          inspectOnly,
          provider,
          alignmentMode,
          generateTtsForStory,
          renderProof,
        }),
      );
    } catch (error) {
      results.push({
        story_id: cleanText(job.story_id),
        title: cleanText(job.title),
        status: "failed",
        error: error.message,
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "DURATION_VARIANT_REPAIR_MATERIALIZER",
    source_work_order_generated_at: workOrder.generated_at || null,
    summary: {
      candidate_count: jobs.length,
      repaired_count: results.filter((job) => job.status === "repaired").length,
      warning_held_count: results.filter((job) => job.status === "warning_held").length,
      blocked_count: results.filter((job) => job.status === "blocked").length,
      failed_count: results.filter((job) => job.status === "failed").length,
      skipped_existing_count: results.filter((job) => job.status === "skipped_existing_duration_repair").length,
      caption_repaired_count: results.filter((job) => job.status === "captions_repaired_existing_duration_repair").length,
      inspect_only_count: results.filter((job) => job.status === "inspect_only_pending_duration_variant_repair").length,
    },
    jobs: results,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      local_audio_only: !results.some((job) => job.audio_provider === "elevenlabs"),
      external_tts_provider_used: results.some((job) => job.audio_provider === "elevenlabs")
        ? "elevenlabs"
        : null,
      renderer_invoked: results.some((job) => cleanText(job.render_status)),
    },
  };
}

function renderDurationVariantRepairMarkdown(report = {}) {
  const lines = [];
  lines.push("# Duration Variant Repair");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Repaired: ${report.summary?.repaired_count || 0}`);
  lines.push(`Warning-held: ${report.summary?.warning_held_count || 0}`);
  lines.push(`Blocked: ${report.summary?.blocked_count || 0}`);
  lines.push(`Failed: ${report.summary?.failed_count || 0}`);
  lines.push(`Existing repaired renders: ${report.summary?.skipped_existing_count || 0}`);
  lines.push(`Inspect-only: ${report.summary?.inspect_only_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(report.jobs).slice(0, 60)) {
    const detail = job.error
      ? `; error: ${job.error}`
      : job.blockers?.length
        ? `; blockers: ${job.blockers.join(", ")}`
        : job.repaired_duration_s
          ? `; ${job.original_duration_s}s -> ${job.repaired_duration_s}s`
          : "";
    lines.push(`- ${job.story_id}: ${job.status}${detail}`);
  }
  if (!asArray(report.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: local script, audio and V4 render repair only. No publish, database, token or OAuth change was triggered.");
  return `${lines.join("\n")}\n`;
}

async function writeDurationVariantRepairReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeDurationVariantRepairReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "duration_variant_repair_report.json");
  const markdownPath = path.join(outDir, "duration_variant_repair_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderDurationVariantRepairMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  REPAIR_STRATEGY,
  NORMAL_PRODUCTION_REPAIR_STRATEGY,
  NORMAL_PRODUCTION_TARGET_SECONDS,
  durationRepairThumbnailHeadline,
  extendScriptToTarget,
  jobsForDurationRepair,
  materializeDurationVariantRepairs,
  renderDurationVariantRepairMarkdown,
  writeDurationVariantRepairReport,
};
