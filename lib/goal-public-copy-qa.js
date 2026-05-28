"use strict";

const { normaliseText, classifyTextHygiene } = require("./text-hygiene");

const WEAK_TITLE_PATTERNS = [
  /\balready feels\b/i,
  /\bhas one player question\b/i,
  /\bjust got a content push\b/i,
  /\bjust got a new signal\b/i,
  /\bjust got a new reason to watch\b/i,
  /\bjust got a real reveal\b/i,
  /\bjust changed the watchlist\b/i,
  /\bnow has a player-facing catch\b/i,
  /\bjust became official\b/i,
  /\bjust gave players the update they needed\b/i,
  /\bsecret problem\b/i,
  /\bwon'?t admit\b/i,
];

const GENERIC_SUBJECT_PATTERNS = [
  /^\s*this (?:story|gaming story)\s*$/i,
  /^\s*(?:rumou?r|gaming story|game story|story|news|update)\s*$/i,
];

const LAZY_PLAYER_ANGLE_RE =
  /\bthe player angle is simple:\s*check the price,\s*access or platform details\b/i;

const OFFICIAL_SOURCE_REPORTING_RE =
  /\b(?:xbox|playstation|nintendo|steam|valve|sony|microsoft)\s+reports\s+[^.]{0,180}\b(?:trailer|gameplay|showcase|coming|release|date|platform)\b/i;

const STALE_IDENTITY_CTA_RE =
  /\bfollow(?:\s+pulse\s+gaming)?\s+for\s+the\s+gaming\s+stories\s+behind\s+the\s+headline\b/i;

const FORMULAIC_PUBLIC_NARRATION_PATTERNS = [
  /\bfor players,\s*the question is what changes before the next purchase,\s*download or watchlist decision\b/i,
  /\bfor players,\s*the key detail is whether .+ actually changes how the game plays,\s*not just how the patch note sounds\b/i,
  /\bthe better test is simple:\s*does it fix a real friction point,\s*or does it just sound bigger in the headline\b/i,
  /\bif the next patch notes move the detail again,\s*this story should be updated before anyone treats it as settled\b/i,
  /\bthe real test is whether .+ changes play,\s*not whether (?:the )?patch note sounds (?:big|bigger)\b/i,
  /\ba useful update should fix a real friction point,\s*not just add a louder headline\b/i,
  /\bif the next patch moves the detail again,\s*update the story before treating it as settled\b/i,
  /\bthe change hits the version people actually buy\b/i,
  /\bthe practical question is whether .+ changes what people (?:play,\s*)?buy,\s*wishlist(?:,\s*reinstall)? or wait on\b/i,
  /\bgives the story enough shape to act on without turning it into a bigger claim than it is\b/i,
  /\bthe confirmed bit(?: from [^.]+)? is still the anchor\b/i,
  /\bthe confirmed claim is simple\b/i,
  /\bis the source for the confirmed claim\b/i,
  /\bis the source for this story\b/i,
  /\bis the source;\s*the next question is whether players should act\b/i,
  /\bstays a gaming story\b/i,
  /\bchanges what players check around the game,\s*platform or launch window\b/i,
  /\bthe headline gets attention,\s*but the follow-through decides whether this becomes a real player problem\b/i,
  /\bthe practical question is whether\b/i,
  /\bthe watch point\b/i,
  /\bthe detail to watch is\b/i,
  /\bthe real question is brutal\b/i,
  /\binstant inputs\b/i,
  /\bthat is the part to watch\b/i,
  /\bkeeps the story bounded\b/i,
  /\bwithout making it bigger than the evidence\b/i,
  /\bthe useful test is\b/i,
  /\bthe only firm read\b/i,
  /\bthe narrow version of the story\b/i,
  /\bthe next useful signal\b/i,
  /\bthe next serious detail is whether\b/i,
  /\bthe next meaningful signal is whether\b/i,
  /\bthe next update that matters is\b/i,
  /\bthe next meaningful update is\b/i,
  /\btiming is the key detail\b/i,
  /\btiming decides whether this is launch news or another reveal\b/i,
  /\bthe version that deserves the bigger push\b/i,
  /\bnot just a price headline\b/i,
  /\ba read on how access is being used\b/i,
  /\bkeeps the value question tied to the source\b/i,
  /\bwithout pretending the headline settles it\b/i,
  /\bturns premium access into the story\b/i,
  /\bpaid tier is starting to look like launch day\b/i,
  /\bearly access feels like a bonus or the real starting line\b/i,
  /\braw revenue number\b/i,
  /\bbragging point\b/i,
  /\bstore page,\s*official post or platform listing\b/i,
  /\bneeds the next showing to make the game readable\b/i,
  /\banother vague reveal beat\b/i,
  /\bwatchlist without pretending\b/i,
  /\bthe sharper angle is what changes once players see footage,\s*price,\s*platform details or real reaction\b/i,
  /\bhas a concrete gaming hook,\s*but the follow-up still needs footage,\s*platform detail or player reaction\b/i,
  /\bthe angle is what changes when people actually touch the game,\s*not how big the headline sounds\b/i,
  /\ba date,\s*price or performance detail would sharpen the story fast\b/i,
  /\bthe named game and source give viewers something specific to argue about\b/i,
  /\bprice[- ]and[- ]access story\b/i,
  /\bso the edit should stay close\b/i,
  /\bthe edit should stay close\b/i,
  /\bthe details that matter are\b/i,
  /\bthat keeps the commercial angle useful\b/i,
  /\bcommercial angle useful\b/i,
  /\bworth tracking because the next official detail\b/i,
  /\bthe next official detail could change\b/i,
  /\bthe short should stay close\b/i,
  /\bthe public output can name exactly what changed\b/i,
  /\bthe hook has to stay tied\b/i,
  /\bthe next beat should add a real detail\b/i,
  /\bneeds a clearer consequence before it earns another upload\b/i,
  /\bif the offer changes,\s*the headline has to change with it\b/i,
  /\bthe stronger beat is whether\b/i,
  /\bnow comes down to access:\s*who gets in early\b/i,
  /\bthat only lands if the paid path\b/i,
  /\bthe awkward question is whether launch day\b/i,
  /\bbusiness-model argument players feel\b/i,
  /\bit is a useful number,\s*but the real test\b/i,
  /\bneeds more than a headline\b/i,
  /\bthe strongest version names the change\b/i,
  /\bspecific reason to care,\s*not a vague sense that news happened\b/i,
  /\bone more hard detail before the next upload\b/i,
  /\bif the next source adds footage,\s*platform support or a hard date\b/i,
  /\bbecomes the follow-up\b/i,
  /\bfinally has footage people can judge\b/i,
  /\bfinally has something players can judge on screen\b/i,
  /\bnow players can read the camera,\s*gunfights and scale\b/i,
  /\ba fast showcase cut can still flatter a rough game\b/i,
  /\ba second gameplay cut would help players judge\b/i,
  /\bclear platforms and timing decide whether viewers can act\b/i,
  /\bthe useful read is movement\b/i,
  /\bwhether the UI sells the game at phone-screen size\b/i,
  /\bthe footage carries the promise\b/i,
  /\bhow the game starts,\s*breaks open and escalates\b/i,
  /\bthe hook is the gameplay itself\b/i,
  /\ba player question without pretending the reveal answers everything\b/i,
  /\bfootage is the part that decides whether the reveal has weight\b/i,
  /\bif more outlets land around the same strengths\b/i,
  /\bthat is enough for a clean watchlist call\b/i,
  /\bdifference between a headline people scroll past\b/i,
  /\bthat is where a launch stat becomes a strategy story\b/i,
  /\bthis stops being a launch-stat headline and becomes a strategy story\b/i,
  /\bthe smart read is momentum\b/i,
  /\bsource boundary\b/i,
  /\bturning the headline into guaranteed demand\b/i,
  /\bthe launch story gets stronger\b/i,
  /\bthe story gets stronger\b/i,
  /\bif the details hold up\b/i,
  /\bif they drift\b/i,
  /\bpast rumou?r talk\b/i,
  /\bbefore the next buy,\s*install or wishlist decision\b/i,
  /\bfor players,\s*this only matters if it changes what to buy,\s*download or ignore\b/i,
  /\bthe useful play is\b/i,
  /\bcheck the live version notes before\b/i,
  /\bthe smart move is\b/i,
  /\brough games job market\b/i,
  /\bveteran credits are still fighting for interviews\b/i,
  /\bthat pressure can change which projects get staffed\b/i,
  /\bit is a quieter story than a trailer\b/i,
  /\bthat is the line viewers will remember after the headline disappears\b/i,
  /\botherwise it is just another headline with a logo next to it\b/i,
  /\bthe next proof needs to be simple\b/i,
  /\bthe next proof is simple\b/i,
  /\bfootage matters here because\b/i,
  /\breal game behind the announcement\b/i,
  /\bpitch lives or dies\b/i,
  /\blicensed skin\b/i,
  /\bfirst gameplay read\b/i,
  /\banother trailer quote\b/i,
  /\bloop with real decisions\b/i,
  /\bfamiliar logo\b/i,
  /\bmontage pace\b/i,
  /\bshow the proof before the take\b/i,
  /\bthe important part is the named change,\s*the source behind it and why it matters now\b/i,
  /\bthe important part is the named change\b/i,
  /\bthe source behind it and why it matters now\b/i,
  /\bthe number only matters if it hits the version people actually buy\b/i,
  /\bthat detail should do the work:\s*what changed,\s*who confirmed it and why players should notice now\b/i,
  /\bdoes not need padding;\s*it needs the proof on screen\b/i,
  /\bcore detail plainly\b/i,
  /\bkeep the claim tight\b/i,
  /\banything outside the report should stay out of (?:the )?(?:narration|script)\b/i,
  /\bfake certainty\b/i,
  /\bfor players,\s*that is the difference between a news recap and a decision filter\b/i,
  /\bdecision filter\b/i,
  /\bthe useful version is narrow\b/i,
  /\bif the source is right\b/i,
  /\bthe useful take is not blind hype\b/i,
  /\bcleaner test\b/i,
  /\bmarketing line\b/i,
  /\bthe launch pressure is simple\b/i,
  /\bhas to prove the spectacle\b/i,
  /\bdate attached to years of spectacle\b/i,
  /\bturns a beautiful demo reel into a delivery test\b/i,
  /\bthe next thing players need is performance footage\b/i,
  /\bperfect showcase shot\b/i,
  /\bworth compressing into a short\b/i,
  /\bthe useful read is where outlets agree\b/i,
  /\bthat is the angle to watch\b/i,
  /\bthe angle to watch\b/i,
  /\bkeep the edit\b/i,
  /\ba longer gameplay cut can show\b/i,
  /\bnow has a real detail on the table\b/i,
  /\bbetter than another vague tease\b/i,
  /\bconcrete detail people can argue about\b/i,
  /\binstead of another vague feed post\b/i,
  /\bthe news is simple\b/i,
  /\btitle[- ]card promise\b/i,
  /\bplayer watchlist story\b/i,
  /\bthe first gameplay cut gives players something firmer than another logo reveal\b/i,
  /\bthe pressure is whether this changes the version people were actually about to pick up\b/i,
  /\bhas a clearer public hook now\b/i,
  /\bthat is the bit players will argue over\b/i,
  /\binstead of another logo reveal\b/i,
  /\bthe tension is\b/i,
  /\bthe pressure is\b/i,
  /\bthe argument is whether\b/i,
  /\bthe debate is whether\b/i,
  /\bthe question now is whether\b/i,
  /\bthe platform list is the point\b/i,
  /\ba longer public showing would say more than another quick trailer\b/i,
  /\bthe console version needs to feel as sharp as the PC build\b/i,
  /\bcontroller feel will decide whether the port lands like launch or just a late arrival\b/i,
  /\bbecomes a case study\b/i,
  /\bthe headline is only useful if\b/i,
  /\bthe useful part is the confirmed offer\b/i,
  /\bnot pressure to buy\b/i,
  /\bone concrete change worth remembering\b/i,
  /\bclean shape:\s*what changed,\s*who said it and why players should care\b/i,
  /\bsource visible and no extra lore\b/i,
];

const INSTRUCTION_LIKE_BUYER_ADVICE_PATTERNS = [
  /\bbefore you spend,\s*check the live price\b/i,
  /\bcheck the live price,\s*the platform listing\b/i,
  /\bcheck the price and platform details before you buy\b/i,
  /\bbuy now,\s*wait or skip\b/i,
  /\bbuy,\s*download,\s*wait or skip\b/i,
  /\bwishlist,\s*download or ignore\b/i,
  /\bwhat to wishlist,\s*download or ignore\b/i,
  /\bwhat (?:players|people|they) buy,\s*wishlist(?:,\s*reinstall)? or wait on\b/i,
  /\bbuy,\s*wait or Game Pass questions\b/i,
  /\bnext choice is practical\b/i,
  /\bthe recommendation moves with it\b/i,
  /\bchanging the practical call\b/i,
  /\btreat the headline as a price check\b/i,
  /\bwhere a headline turns into a real player decision\b/i,
  /\bquestion is whether players should\b/i,
  /\bnext question is whether players should act\b/i,
  /\bthe decision is simpler:\s*buy\b/i,
];

const ARTICLE_RESIDUE_PATTERNS = [
  /\bread more\b/i,
  /https?:\/\//i,
  /&(?:nbsp|amp|quot|#[0-9]+|#x[0-9a-f]+);/i,
  /\bview images\b/i,
  /\blet us know\b/i,
  /\bcheck out this trailer\b/i,
  /\bsee at\b/i,
];

const MALFORMED_PRIMARY_SOURCE_LABEL_RE =
  /^(?:store|image|i|source|unknown|unknown source|reddit image|imgur|youtu|youtube|the phrasemaker|the shortmaker)$/i;

const RAW_ARTICLE_HEADLINE_RESIDUE_RE =
  /\b(?:reports?|Reports?|says|Says|writes|Writes)\s+[^.?!]{24,260}?(?:\s+-\s+(?:AUTOMATON WEST|[A-Z0-9][A-Z0-9 &]{4,})(?=[.?!]|$)|\s+\|\s+(?:IGN|GameSpot|PC Gamer|Eurogamer|AUTOMATON WEST|[A-Z0-9][A-Z0-9 &]{4,})(?=[.?!]|$))/;

const UNSUPPORTED_DETAIL_TERMS = [
  {
    publicPattern: /\bframe[- ]?rate(?:\s+clips?)?\b|\b\d{2,3}\s*fps\b/i,
    evidencePattern: /\bframe[- ]?rate\b|\bfps\b|\bperformance mode\b/i,
  },
  {
    publicPattern: /\bmatchmaking(?:\s+clips?)?\b/i,
    evidencePattern: /\bmatchmaking\b|\bserver queue\b|\blobby\b/i,
  },
  {
    publicPattern: /\bbalance complaints?\b/i,
    evidencePattern: /\bbalance complaints?\b|\bplayer complaints?\b|\bcommunity complaints?\b/i,
  },
  {
    publicPattern: /\bhandling\b/i,
    evidencePattern: /\bhandling\b|\bdriving model\b|\bvehicle feel\b/i,
  },
  {
    publicPattern: /\bprogression\b/i,
    evidencePattern: /\bprogression\b|\bcareer mode\b|\bunlock\b/i,
  },
  {
    publicPattern: /\bground combat\b/i,
    evidencePattern: /\bground combat\b|\bcombat system\b|\bcombat\b/i,
  },
  {
    publicPattern: /\bdialogue choices\b/i,
    evidencePattern: /\bdialogue choices\b|\bbranching dialogue\b|\bchoice-driven\b/i,
  },
  {
    publicPattern: /\bship pressure\b/i,
    evidencePattern: /\bship pressure\b|\bspace combat\b|\bship combat\b/i,
  },
];

function clean(value) {
  return normaliseText(value).replace(/\s+/g, " ").trim();
}

function sourceLabel(value) {
  if (!value) return "";
  if (typeof value === "string") return clean(value);
  return clean(value.name || value.source_name || value.label || value.title || value.url);
}

function sourceUrl(value) {
  if (!value || typeof value === "string") return "";
  return clean(value.url || value.source_url || value.href);
}

function wordCount(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function firstSentence(value = "") {
  const text = clean(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return clean(match ? match[1] : text.split(/\s+/).slice(0, 16).join(" "));
}

function normaliseKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function importantSubjectTokens(value) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "game",
    "games",
    "gaming",
    "story",
    "update",
  ]);
  return normaliseKey(value)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stop.has(token));
}

function textContainsSubject(value, subject) {
  const haystack = normaliseKey(value);
  const needle = normaliseKey(subject);
  if (!haystack || !needle) return false;
  if (haystack.includes(needle)) return true;
  const tokens = importantSubjectTokens(subject);
  return tokens.length > 0 && tokens.some((token) => haystack.includes(token));
}

function sourceKey(value) {
  return normaliseKey(sourceLabel(value) || value).replace(/\s+/g, "");
}

function flattenPublicStrings(value, prefix = "", out = []) {
  if (typeof value === "string") {
    out.push({ path: prefix, value: clean(value) });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenPublicStrings(item, `${prefix}.${index}`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenPublicStrings(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function isPlatformSubjectCriticalPath(fieldPath = "") {
  const pathKey = String(fieldPath || "").toLowerCase();
  return (
    /\.(?:title|caption|description|conversational_hook|hot_take_post|source_safe_post|concise_news_post|discussion_post|poll_candidate|page_caption|explanatory_framing|pin_title|pin_description)$/.test(pathKey) ||
    /\.thread_posts\.0$/.test(pathKey) ||
    /\.cover_frame\.(?:headline|subject)$/.test(pathKey)
  );
}

function isPlatformBoilerplate(value = "") {
  const text = clean(value);
  return (
    !text ||
    /^source\s*:/i.test(text) ||
    /^#\w+(?:\s+#\w+)*$/.test(text) ||
    /affiliate links may earn us a commission/i.test(text) ||
    /no commercial link attached/i.test(text) ||
    /sources and (?:related )?links/i.test(text) ||
    /story page in bio/i.test(text)
  );
}

function sourceLabelsInPublicText(value = "") {
  const labels = [];
  const text = clean(value);
  const sourceRe = /\bsource\s*:\s*([A-Za-z0-9 .+&/-]{2,42})/gi;
  for (const match of text.matchAll(sourceRe)) {
    labels.push(clean(match[1]).replace(/[.。,:;|].*$/g, ""));
  }
  return labels.filter(Boolean);
}

function platformPublicCopyFailures(manifest = {}) {
  const platformManifest = manifest.platform_publish_manifest || manifest.platform_manifest || {};
  const outputs = platformManifest.outputs || {};
  if (!outputs || typeof outputs !== "object" || Object.keys(outputs).length === 0) {
    return [];
  }

  const failures = [];
  const subject = clean(manifest.canonical_subject || manifest.canonical_game);
  if (subject && !hasGenericSubject(subject)) {
    const subjectMisses = flattenPublicStrings(outputs)
      .filter(({ path }) => isPlatformSubjectCriticalPath(path))
      .filter(({ value }) => wordCount(value) >= 3 && !isPlatformBoilerplate(value))
      .filter(({ value }) => !textContainsSubject(value, subject));
    if (subjectMisses.length > 0) {
      failures.push("public_copy:platform_copy_missing_canonical_subject");
    }
  }

  const allowedSourceKeys = new Set(
    [
      manifest.primary_source,
      manifest.source_card_label,
      manifest.official_source,
      manifest.official_confirmation_source,
      ...(Array.isArray(manifest.secondary_sources) ? manifest.secondary_sources : []),
    ]
      .map(sourceKey)
      .filter(Boolean),
  );
  if (allowedSourceKeys.size > 0) {
    const sourceLabels = flattenPublicStrings(outputs).flatMap(({ value }) =>
      sourceLabelsInPublicText(value),
    );
    if (sourceLabels.some((label) => !allowedSourceKeys.has(sourceKey(label)))) {
      failures.push("public_copy:platform_source_label_mismatch");
    }
  }

  return failures;
}

function quoteCount(value) {
  const text = clean(value);
  return (text.match(/"/g) || []).length;
}

function hasMalformedQuote(value) {
  return quoteCount(value) % 2 === 1;
}

function looksLikeQuoteFragment(value) {
  const text = clean(value);
  if (!text) return false;
  if (hasMalformedQuote(text)) return true;
  if (/^["']/.test(text)) return true;
  if (/\bwe\s+botched\s+it["']?$/i.test(text)) return true;
  return wordCount(text) <= 4 && /[?!]/.test(text);
}

function hasWeakTitlePattern(title) {
  return WEAK_TITLE_PATTERNS.some((pattern) => pattern.test(clean(title)));
}

function hasGenericSubject(subject) {
  return GENERIC_SUBJECT_PATTERNS.some((pattern) => pattern.test(clean(subject)));
}

function subjectCapitalisationRequired(subject) {
  const text = clean(subject);
  return /^(?:xbox|playstation|nintendo|steam|valve|sony|microsoft|forza|pokemon|pokémon)$/i.test(text) &&
    /^[a-z]/.test(text);
}

function titleCapitalisationRequired(title) {
  const text = clean(title);
  return /^[a-z][a-z0-9]*(?:\s|$)/.test(text);
}

function descriptionHasArticleResidue(description) {
  const text = String(description || "");
  return ARTICLE_RESIDUE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasMalformedPrimarySourceLabel(manifest = {}, publicText = "") {
  const label = sourceLabel(manifest.primary_source || manifest.source_card_label);
  if (!label || !MALFORMED_PRIMARY_SOURCE_LABEL_RE.test(label)) return false;
  const labelPattern = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${labelPattern}\\s+(?:reports?|says|writes|confirms|reveals)\\b|\\bsource\\s*:\\s*${labelPattern}\\b`, "i").test(
    clean(publicText),
  );
}

function hasSourceUrlLabelMismatch(manifest = {}) {
  const primaryLabel = sourceLabel(manifest.primary_source || manifest.source_card_label);
  const sourceCardLabel = sourceLabel(manifest.source_card_label || manifest.primary_source);
  const url = clean(
    manifest.primary_source_url ||
      manifest.source_url ||
      manifest.article_url ||
      sourceUrl(manifest.primary_source),
  );
  const host = hostFromUrl(url);
  if (!host || (!primaryLabel && !sourceCardLabel)) return false;
  const labels = [primaryLabel, sourceCardLabel].filter(Boolean).map(sourceKey);
  const hasAllowed = (allowed) => labels.some((label) => allowed.includes(label));
  if (/store\.steampowered\.com|steamcommunity\.com/.test(host)) {
    return !hasAllowed(["steam", "valve"]);
  }
  if (/store\.playstation\.com|playstation\.com/.test(host)) {
    return !hasAllowed(["playstation", "sony", "playstationblog"]);
  }
  if (/nintendo\.com/.test(host)) {
    return !hasAllowed(["nintendo"]);
  }
  if (/xbox\.com|news\.xbox\.com/.test(host)) {
    return !hasAllowed(["xbox", "microsoft", "xboxwire"]);
  }
  return false;
}

function hasRawArticleHeadlineInNarration(script = "") {
  const text = clean(script);
  return RAW_ARTICLE_HEADLINE_RESIDUE_RE.test(text);
}

function hasFormulaicPublicNarration(script) {
  const text = clean(script);
  return FORMULAIC_PUBLIC_NARRATION_PATTERNS.some((pattern) => pattern.test(text));
}

function hasInstructionLikeBuyerAdviceNarration(script) {
  const text = clean(script);
  return INSTRUCTION_LIKE_BUYER_ADVICE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasUnanchoredPremiumEditionClaim(manifest = {}, script = "") {
  if (!/\bpremium edition\b/i.test(clean(script))) return false;
  const evidenceText = clean(
    [
      manifest.canonical_subject,
      manifest.canonical_game,
      manifest.selected_title,
      manifest.canonical_title,
      manifest.description,
      ...Array.isArray(manifest.confirmed_claims) ? manifest.confirmed_claims : [],
    ].join(" "),
  );
  return !/\bpremium edition\b/i.test(evidenceText);
}

function hasPlatformStrategyMisclassifiedAsGameplay(manifest = {}, script = "") {
  const subject = normaliseKey(manifest.canonical_subject || manifest.canonical_game);
  const isPlatformSubject = /^(?:xbox|playstation|nintendo|steam|valve|sony|microsoft)$/.test(subject);
  if (!isPlatformSubject) return false;
  return /\b(?:movement,\s*combat readability|whether the UI looks like a real game|logo sweep|how the game starts|next trailer shows uninterrupted play)\b/i.test(clean(script));
}

function hasUnanchoredReviewScoreLanguage(manifest = {}, script = "") {
  const text = clean(script);
  if (!/\b(?:reviews are the first real pressure test|review score|scores get attention|wait for player footage before treating the verdict)\b/i.test(text)) {
    return false;
  }
  const evidenceText = clean(
    [
      manifest.canonical_subject,
      manifest.canonical_game,
      manifest.selected_title,
      manifest.canonical_title,
      manifest.description,
      ...Array.isArray(manifest.confirmed_claims) ? manifest.confirmed_claims : [],
    ].join(" "),
  );
  const evidenceWithoutUnderReview = evidenceText.replace(/\bunder review\b/gi, "");
  return !/\b(?:reviews?|metacritic|opencritic|rated|rating|score|\d{2,3}\s*\/\s*100|pc gamer\s+review|ign\s+review|gamespot\s+review|vgc\s+review|eurogamer\s+review|review\s*(?:\(|:|score|from|by|at))\b/i.test(evidenceWithoutUnderReview);
}

function hasSourceClaimScopeMismatch(manifest = {}, script = "") {
  const publicText = clean(
    [
      manifest.selected_title,
      manifest.thumbnail_headline,
      manifest.first_spoken_line,
      script,
      manifest.description,
    ].join(" "),
  );
  const evidenceText = clean(
    [
      manifest.canonical_angle,
      manifest.discovery_source,
      manifest.official_source,
      manifest.primary_source,
      manifest.description,
      ...Array.isArray(manifest.confirmed_claims) ? manifest.confirmed_claims : [],
      ...Array.isArray(manifest.secondary_sources) ? manifest.secondary_sources.map(sourceLabel) : [],
    ].join(" "),
  );

  const publicPromisesPeacefulSubnautica =
    /\bsubnautica\s*2\b/i.test(publicText) &&
    /\b(?:peaceful|strangest survival rules?|kill[- ]?list|kill fish|wildlife|monster[- ]?hunting|creature design|predator balance|non[- ]?lethal)\b/i.test(publicText);
  if (publicPromisesPeacefulSubnautica) {
    const evidenceSupportsPeacefulRule =
      /\b(?:peaceful|kill[- ]?list|kill fish|wildlife|monster[- ]?hunting|creature design|predator balance|non[- ]?lethal)\b/i.test(evidenceText);
    const evidenceOnlyLeakScope = /\b(?:leak|leaked|leakers?|pirates?|piracy|stolen build|bonus|\$?250\s*million|payout)\b/i.test(evidenceText);
    if (!evidenceSupportsPeacefulRule && evidenceOnlyLeakScope) return true;
  }

  return false;
}

function hasUnsupportedSpecificDetailNarration(manifest = {}, script = "") {
  const text = clean(script);
  if (!text) return false;
  const evidenceText = clean(
    [
      manifest.canonical_subject,
      manifest.canonical_game,
      manifest.selected_title,
      manifest.canonical_title,
      manifest.description,
      ...Array.isArray(manifest.confirmed_claims) ? manifest.confirmed_claims : [],
      ...Array.isArray(manifest.claim_inventory?.confirmed) ? manifest.claim_inventory.confirmed : [],
    ].join(" "),
  );
  const unsupported = UNSUPPORTED_DETAIL_TERMS.filter(
    ({ publicPattern, evidencePattern }) => publicPattern.test(text) && !evidencePattern.test(evidenceText),
  );
  return unsupported.length > 0;
}

function hostFromUrl(value = "") {
  const text = clean(value);
  try {
    return new URL(text).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hasExternalSourceEvidence(manifest = {}) {
  const secondarySources = Array.isArray(manifest.secondary_sources) ? manifest.secondary_sources : [];
  return (
    hasNonRedditSource(manifest.official_source) ||
    hasNonRedditSource(manifest.official_confirmation_source) ||
    secondarySources.some(hasNonRedditSource)
  );
}

function nonNewsImagePostSourceFailure(manifest = {}) {
  if (hasExternalSourceEvidence(manifest)) return false;
  const label = sourceLabel(manifest.primary_source || manifest.source_card_label);
  const url = clean(
    manifest.primary_source_url ||
      manifest.source_url ||
      manifest.article_url ||
      sourceUrl(manifest.primary_source),
  );
  const host = hostFromUrl(url);
  return (
    /^(?:i|image|imgur|i\.redd\.it|reddit image)$/i.test(label) ||
    /^(?:i\.redd\.it|i\.imgur\.com|imgur\.com|preview\.redd\.it)$/.test(host) ||
    /\.(?:jpe?g|png|gif|webp)(?:\?|$)/i.test(url)
  );
}

function hasCrossStoryResidue(manifest = {}, script = "") {
  const text = clean(script);
  const evidenceText = clean(
    [
      manifest.selected_title,
      manifest.canonical_title,
      manifest.description,
      ...Array.isArray(manifest.confirmed_claims) ? manifest.confirmed_claims : [],
    ].join(" "),
  );
  const hasLegalResidue =
    /\b(?:odd filing|clearer dispute|the facts are the lawsuit,\s*the rejection and the named companies involved|fan programme rejection|community-access dispute)\b/i.test(text);
  if (hasLegalResidue && !/\b(?:lawsuit|sues?|denied|professor status|legal filing|named companies)\b/i.test(evidenceText)) {
    return true;
  }
  const hasJobsMarketResidue =
    /\b(?:deus ex|unreal|composer|resumes?|interviews?|brutal jobs story|talent squeeze|market problem)\b/i.test(text);
  if (hasJobsMarketResidue && !/\b(?:deus ex|unreal|composer|resumes?|interviews?|job market|jobs vanished)\b/i.test(evidenceText)) {
    return true;
  }
  return false;
}

function hasRepeatedPublicSentence(script = "") {
  const counts = new Map();
  const sentences = clean(script)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) =>
      sentence
        .toLowerCase()
        .replace(/["'`]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((sentence) => sentence && sentence.split(/\s+/).length >= 7)
    .filter((sentence) => !/^follow pulse gaming\b/.test(sentence));
  for (const sentence of sentences) {
    counts.set(sentence, (counts.get(sentence) || 0) + 1);
    if (counts.get(sentence) > 1) return true;
  }
  return false;
}

function hasSemanticallyTruncatedThumbnail(manifest = {}, title = "") {
  const headline = clean(manifest.thumbnail_headline || manifest.thumbnail_text || manifest.suggested_thumbnail_text);
  const titleText = clean(title);
  if (!headline || !titleText || /(?:\.{3}|…)$/.test(headline)) return false;
  const headlineWords = normaliseKey(headline).split(/\s+/).filter(Boolean);
  const titleWords = normaliseKey(titleText).split(/\s+/).filter(Boolean);
  if (headlineWords.length < 3 || titleWords.length <= headlineWords.length) return false;
  const isPrefix = headlineWords.every((word, index) => word === titleWords[index]);
  if (!isPrefix) return false;
  if (/(?:['’]s)$/i.test(headline)) return true;
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "just",
    "got",
    "has",
    "have",
    "had",
    "a",
    "an",
    "in",
    "now",
    "early",
    "again",
    "today",
  ]);
  const missingMeaningfulWords = titleWords
    .slice(headlineWords.length)
    .filter((word) => word.length >= 4 && !stop.has(word));
  const terminal = headlineWords[headlineWords.length - 1] || "";
  const semanticTerminal = new Set([
    "already",
    "another",
    "calls",
    "finally",
    "five",
    "hit",
    "hits",
    "made",
    "making",
    "out",
    "premium",
    "shows",
    "showed",
  ]);
  if (missingMeaningfulWords.length > 0 && semanticTerminal.has(terminal)) return true;
  return missingMeaningfulWords.length === 1 && /^(?:silence|problem|question)$/i.test(missingMeaningfulWords[0]);
}

const DANGLING_THUMBNAIL_TERMINALS = new Set([
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

function thumbnailHeadline(manifest = {}) {
  return clean(manifest.thumbnail_headline || manifest.thumbnail_text || manifest.suggested_thumbnail_text);
}

function thumbnailHeadlineWords(manifest = {}) {
  return normaliseKey(thumbnailHeadline(manifest)).split(/\s+/).filter(Boolean);
}

function hasDanglingThumbnailHeadline(manifest = {}) {
  const headline = thumbnailHeadline(manifest);
  if (!headline) return false;
  if (/(?:\.{3}|â€¦)$/.test(headline)) return true;
  const words = thumbnailHeadlineWords(manifest);
  if (words.length < 2) return false;
  return DANGLING_THUMBNAIL_TERMINALS.has(words[words.length - 1]);
}

function hasRepeatedThumbnailToken(manifest = {}) {
  const words = thumbnailHeadlineWords(manifest);
  for (let index = 1; index < words.length; index += 1) {
    if (words[index].length >= 2 && words[index] === words[index - 1]) return true;
  }
  return false;
}

function hasStaleLaunchDateFraming(manifest = {}, script = "") {
  const publicText = clean(
    [
      manifest.selected_title,
      manifest.short_title,
      manifest.thumbnail_headline,
      manifest.first_spoken_line,
      script,
      manifest.description,
    ].join(" "),
  );
  const evidenceText = clean(
    [
      manifest.selected_title,
      manifest.canonical_title,
      manifest.description,
      ...Array.isArray(manifest.confirmed_claims) ? manifest.confirmed_claims : [],
    ].join(" "),
  );
  const storyIsAlreadyLive =
    /\b(?:already live|out now|has been out|launched|released)\b/i.test(evidenceText);
  const stillTeasingDate =
    /\b(?:finally has (?:a )?(?:launch )?date|has a launch date|launch date after years|date attached to years)\b/i.test(
      publicText,
    );
  return storyIsAlreadyLive && stillTeasingDate;
}

function scriptFieldDiverges(primaryScript = "", alternateScript = "") {
  const primary = clean(primaryScript);
  const alternate = clean(alternateScript);
  return Boolean(primary && alternate && primary !== alternate);
}

function descriptionTooThin(description) {
  const text = clean(description);
  if (!text) return true;
  const sourceOnly = /^source\s*:/i.test(text) || /^source\s+[a-z0-9 .-]+$/i.test(text);
  return sourceOnly || wordCount(text) < 6;
}

function isYouTubeHostLabel(label = "") {
  return /^(?:youtube|youtu|youtu\.be)$/i.test(clean(label));
}

function isRedditLabel(label = "") {
  return /^(?:reddit|r\/[a-z0-9_]+)$/i.test(clean(label));
}

function isRedditUrl(url = "") {
  return /(?:^|\/\/)(?:www\.)?reddit\.com\//i.test(clean(url));
}

function hasNonRedditSource(value) {
  const label = sourceLabel(value);
  const url = sourceUrl(value) || clean(typeof value === "string" ? value : "");
  if (!label && !url) return false;
  return !isRedditLabel(label) && !isRedditUrl(url);
}

function isRumourFramed(manifest = {}) {
  const text = [
    manifest.canonical_angle,
    manifest.story_type,
    manifest.content_pillar,
    manifest.flair,
    manifest.source_confidence_label,
  ].join(" ");
  return /\b(?:rumou?r|reported|unconfirmed|claim|discussion)\b/i.test(text);
}

function redditDiscoveryPrimarySourceFailure(manifest = {}) {
  const primaryLabel = sourceLabel(manifest.primary_source || manifest.source_card_label);
  const primaryUrl = clean(
    manifest.primary_source_url ||
      manifest.source_url ||
      manifest.article_url ||
      sourceUrl(manifest.primary_source),
  );
  const discoveryText = [
    manifest.discovery_source,
    manifest.source_type,
    manifest.subreddit,
    primaryUrl,
  ].join(" ");
  const secondarySources = Array.isArray(manifest.secondary_sources) ? manifest.secondary_sources : [];
  const hasExternalSource =
    hasNonRedditSource(manifest.primary_source) ||
    (primaryUrl && !isRedditUrl(primaryUrl)) ||
    hasNonRedditSource(manifest.official_source) ||
    hasNonRedditSource(manifest.official_confirmation_source) ||
    secondarySources.some(hasNonRedditSource);
  const publicText = [
    manifest.canonical_angle,
    manifest.narration_script,
    manifest.full_script,
    manifest.description,
  ].join(" ");
  return (
    (isRedditLabel(primaryLabel) || isRedditUrl(primaryUrl)) &&
    /\breddit\b|r\/[a-z0-9_]+/i.test(discoveryText) &&
    !hasExternalSource &&
    !isRumourFramed(manifest) &&
    /\b(?:confirmed|drop|official|reports?|says|announced|revealed|showed)\b/i.test(publicText)
  );
}

function redditDiscoveryLabelUsedDespiteExternalSource(manifest = {}) {
  const primaryLabel = sourceLabel(manifest.primary_source || manifest.source_card_label);
  const primaryUrl = clean(
    manifest.primary_source_url ||
      manifest.source_url ||
      manifest.article_url ||
      sourceUrl(manifest.primary_source),
  );
  const sourceCardLabel = sourceLabel(manifest.source_card_label || manifest.thumbnail_source_label);
  const sourceCardUrl = sourceUrl(manifest.source_card_label || manifest.thumbnail_source_label);
  const secondarySources = Array.isArray(manifest.secondary_sources) ? manifest.secondary_sources : [];
  const hasExternalSource =
    hasNonRedditSource(manifest.official_source) ||
    hasNonRedditSource(manifest.official_confirmation_source) ||
    secondarySources.some(hasNonRedditSource);
  if (!hasExternalSource || isRumourFramed(manifest)) return false;
  return (
    isRedditLabel(primaryLabel) ||
    isRedditUrl(primaryUrl) ||
    isRedditLabel(sourceCardLabel) ||
    isRedditUrl(sourceCardUrl)
  );
}

function redditOnlyRumourWithoutExternalSource(manifest = {}) {
  const primaryLabel = sourceLabel(manifest.primary_source || manifest.source_card_label);
  const primaryUrl = clean(
    manifest.primary_source_url ||
      manifest.source_url ||
      manifest.article_url ||
      sourceUrl(manifest.primary_source),
  );
  const discoveryText = [
    manifest.discovery_source,
    manifest.source_type,
    manifest.subreddit,
    primaryUrl,
  ].join(" ");
  const secondarySources = Array.isArray(manifest.secondary_sources) ? manifest.secondary_sources : [];
  const hasExternalSource =
    hasNonRedditSource(manifest.primary_source) ||
    (primaryUrl && !isRedditUrl(primaryUrl)) ||
    hasNonRedditSource(manifest.official_source) ||
    hasNonRedditSource(manifest.official_confirmation_source) ||
    secondarySources.some(hasNonRedditSource);
  return (
    isRumourFramed(manifest) &&
    !hasExternalSource &&
    (
      isRedditLabel(primaryLabel) ||
      isRedditUrl(primaryUrl) ||
      /\breddit\b|r\/[a-z0-9_]+/i.test(discoveryText)
    )
  );
}

function hasOfficialSourceHint(manifest = {}) {
  const text = [
    manifest.canonical_company,
    manifest.official_source,
    manifest.official_confirmation_source,
    manifest.canonical_title,
    manifest.description,
    ...Array.isArray(manifest.confirmed_claims) ? manifest.confirmed_claims : [],
  ].join(" ");
  return /\b(?:xbox|playstation|nintendo|steam|valve|sony|microsoft|official|publisher|partner preview|direct|state of play)\b/i.test(text);
}

function platformHostSourceLabelFailure(manifest = {}) {
  const label = sourceLabel(manifest.primary_source || manifest.source_card_label);
  const url = clean(
    manifest.primary_source_url ||
      manifest.source_url ||
      manifest.article_url ||
      sourceUrl(manifest.primary_source),
  );
  return isYouTubeHostLabel(label) && /(?:youtube\.com|youtu\.be)/i.test(url) && hasOfficialSourceHint(manifest);
}

function platformHostReportingLanguage(value = "") {
  return /\b(?:youtube|youtu|youtu\.be)\s+(?:reports?|says|confirms|claims|reveals|notes|writes)\b/i.test(clean(value));
}

function officialSourceReportingLanguage(value = "") {
  return OFFICIAL_SOURCE_REPORTING_RE.test(clean(value));
}

function hasStaleIdentityCta(value = "") {
  return STALE_IDENTITY_CTA_RE.test(clean(value));
}

function staleIdentityCtaPayload(manifest = {}, scriptText = "") {
  const platform = manifest.platform_publish_manifest || manifest.platform_manifest || {};
  const platformText = JSON.stringify(platform);
  return [
    scriptText,
    manifest.description,
    manifest.pinned_comment,
    platformText,
    manifest.youtube_publish_pack,
    manifest.tiktok_publish_pack,
    manifest.instagram_publish_pack,
    manifest.facebook_publish_pack,
    manifest.x_publish_pack,
    manifest.threads_publish_pack,
    manifest.pinterest_publish_pack,
  ]
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value || "")))
    .join(" ");
}

function firstLineTooWeak(firstLine, subject) {
  const line = clean(firstLine);
  if (!line) return true;
  if (wordCount(line) < 5) return true;
  const subjectText = clean(subject);
  if (subjectText && !textContainsSubject(line, subjectText)) {
    return true;
  }
  return /\b(?:this gaming story|gave players the update they needed|source-backed update)\b/i.test(line);
}

const PRICE_UP_RE =
  /\b(?:price(?:s)?\s+(?:went|go(?:es)?|going)\s+up|price\s+(?:hike|increase|jump|rise)|prices?\s+(?:are\s+)?rising|more expensive|costs?\s+more|raised?\s+prices?)\b/i;
const PRICE_DOWN_RE =
  /\b(?:\d{1,3}%\s*off|discount|sale|deal|lowest price|price\s+(?:drop|cut)|dropped?\s+to|down\s+to|cheaper|costs?\s+less|save\s+\$?\d+)\b/i;

function priceEvidencePayload(manifest = {}) {
  const claimInventory = manifest.claim_inventory && typeof manifest.claim_inventory === "object"
    ? manifest.claim_inventory
    : {};
  return clean(
    [
      manifest.canonical_title,
      manifest.description,
      ...Array.isArray(manifest.confirmed_claims) ? manifest.confirmed_claims : [],
      ...Array.isArray(claimInventory.confirmed) ? claimInventory.confirmed : [],
    ].join(" "),
  );
}

function pricePublicPayload(manifest = {}, scriptPayload = "") {
  return clean(
    [
      manifest.selected_title,
      manifest.short_title,
      manifest.thumbnail_headline,
      manifest.thumbnail_text,
      manifest.first_spoken_line,
      manifest.narration_hook,
      scriptPayload,
    ].join(" "),
  );
}

function hasPriceDirectionMismatch(manifest = {}, scriptPayload = "") {
  const evidence = priceEvidencePayload(manifest);
  const publicText = pricePublicPayload(manifest, scriptPayload);
  if (!evidence || !publicText) return false;
  const evidenceSaysDown = PRICE_DOWN_RE.test(evidence) && !PRICE_UP_RE.test(evidence);
  const evidenceSaysUp = PRICE_UP_RE.test(evidence) && !PRICE_DOWN_RE.test(evidence);
  const publicSaysDown = PRICE_DOWN_RE.test(publicText);
  const publicSaysUp = PRICE_UP_RE.test(publicText);
  return (evidenceSaysDown && publicSaysUp) || (evidenceSaysUp && publicSaysDown);
}

function evaluateGoalPublicCopy(manifest = {}) {
  const canonicalSubject = clean(manifest.canonical_subject || manifest.canonical_game);
  const title = clean(manifest.selected_title || manifest.short_title || manifest.canonical_title || manifest.title);
  const script = clean(manifest.narration_script || manifest.full_script);
  const firstLine = clean(manifest.first_spoken_line || manifest.narration_hook || firstSentence(script));
  const fullScript = clean(manifest.full_script);
  const ttsScript = clean(manifest.tts_script);
  const description = clean(manifest.description);
  const failures = [];
  const warnings = [];

  if (!canonicalSubject) failures.push("public_copy:missing_canonical_subject");
  if (hasGenericSubject(canonicalSubject)) failures.push("public_copy:generic_canonical_subject");
  if (subjectCapitalisationRequired(canonicalSubject)) failures.push("public_copy:subject_capitalisation_required");
  if (looksLikeQuoteFragment(canonicalSubject)) failures.push("public_copy:canonical_subject_is_quote_fragment");
  if (!title) failures.push("public_copy:missing_title");
  if (titleCapitalisationRequired(title)) failures.push("public_copy:title_capitalisation_required");
  if (hasMalformedQuote(title)) failures.push("public_copy:malformed_quote_title");
  if (hasWeakTitlePattern(title)) failures.push("public_copy:weak_title_pattern");
  if (wordCount(title) > 12) failures.push("public_copy:title_too_long");
  if (hasSemanticallyTruncatedThumbnail(manifest, title)) {
    failures.push("public_copy:thumbnail_semantically_truncated");
  }
  if (hasDanglingThumbnailHeadline(manifest)) {
    failures.push("public_copy:thumbnail_headline_dangles");
  }
  if (hasRepeatedThumbnailToken(manifest)) {
    failures.push("public_copy:thumbnail_headline_repeated_token");
  }
  if (firstLineTooWeak(firstLine, canonicalSubject)) failures.push("public_copy:first_line_too_weak");
  if (description.length > 420) failures.push("public_copy:description_too_long");
  if (hasMalformedQuote(description) || looksLikeQuoteFragment(description)) {
    failures.push("public_copy:malformed_quote_description");
  }
  if (descriptionTooThin(description)) failures.push("public_copy:description_too_thin");
  if (descriptionHasArticleResidue(description)) failures.push("public_copy:description_contains_article_residue");
  if (hasMalformedPrimarySourceLabel(manifest, `${script} ${fullScript} ${ttsScript} ${description}`)) {
    failures.push("public_copy:malformed_primary_source_label");
  }
  if (hasSourceUrlLabelMismatch(manifest)) {
    failures.push("public_copy:source_url_label_mismatch");
  }
  if (hasRawArticleHeadlineInNarration([script, fullScript, ttsScript].join(" "))) {
    failures.push("public_copy:raw_article_headline_in_narration");
  }
  if (redditDiscoveryPrimarySourceFailure(manifest) || redditDiscoveryLabelUsedDespiteExternalSource(manifest)) {
    failures.push("public_copy:reddit_discovery_label_used_as_primary_source");
  }
  if (redditOnlyRumourWithoutExternalSource(manifest)) {
    failures.push("public_copy:reddit_only_rumour_without_external_source");
  }
  if (nonNewsImagePostSourceFailure(manifest)) failures.push("public_copy:non_news_image_post_source");
  if (platformHostSourceLabelFailure(manifest)) failures.push("public_copy:platform_host_source_label");
  if (platformHostReportingLanguage(`${script} ${description}`)) {
    failures.push("public_copy:platform_host_reporting_language");
  }
  if (officialSourceReportingLanguage(`${script} ${description}`)) {
    failures.push("public_copy:official_source_reporting_language");
  }
  if (LAZY_PLAYER_ANGLE_RE.test(script) || LAZY_PLAYER_ANGLE_RE.test(description)) {
    failures.push("public_copy:lazy_player_angle_sentence");
  }
  const scriptPayload = [script, fullScript, ttsScript].join(" ");
  if (hasStaleIdentityCta(staleIdentityCtaPayload(manifest, scriptPayload))) {
    failures.push("public_copy:stale_identity_cta");
  }
  if (scriptFieldDiverges(script, fullScript)) failures.push("public_copy:full_script_diverges_from_narration");
  if (scriptFieldDiverges(script, ttsScript)) failures.push("public_copy:tts_script_diverges_from_narration");
  if (hasFormulaicPublicNarration(scriptPayload)) {
    failures.push("public_copy:formulaic_public_narration");
  }
  if (hasInstructionLikeBuyerAdviceNarration(scriptPayload)) {
    failures.push("public_copy:instruction_like_buyer_advice_narration");
  }
  if (hasPriceDirectionMismatch(manifest, scriptPayload)) {
    failures.push("public_copy:price_direction_mismatch");
  }
  if (hasUnanchoredPremiumEditionClaim(manifest, scriptPayload)) {
    failures.push("public_copy:unanchored_premium_edition_claim");
  }
  if (hasPlatformStrategyMisclassifiedAsGameplay(manifest, scriptPayload)) {
    failures.push("public_copy:platform_strategy_misclassified_as_gameplay_showcase");
  }
  if (hasUnanchoredReviewScoreLanguage(manifest, scriptPayload)) {
    failures.push("public_copy:unanchored_review_score_language");
  }
  if (hasSourceClaimScopeMismatch(manifest, scriptPayload)) {
    failures.push("public_copy:source_claim_scope_mismatch");
  }
  if (hasUnsupportedSpecificDetailNarration(manifest, scriptPayload)) {
    failures.push("public_copy:unsupported_specific_detail_narration");
  }
  if (hasStaleLaunchDateFraming(manifest, scriptPayload)) {
    failures.push("public_copy:stale_launch_date_framing");
  }
  if (hasCrossStoryResidue(manifest, scriptPayload)) {
    failures.push("public_copy:cross_story_residue");
  }
  if ([script, fullScript, ttsScript].some(hasRepeatedPublicSentence)) {
    failures.push("public_copy:repeated_sentence");
  }
  failures.push(...platformPublicCopyFailures(manifest));

  const hygieneFields = [
    ["subject", canonicalSubject],
    ["title", title],
    ["first_line", firstLine],
    ["script", script],
    ["full_script", fullScript],
    ["tts_script", ttsScript],
    ["description", description],
  ];
  for (const [field, value] of hygieneFields) {
    const hygiene = classifyTextHygiene(value);
    if (hygiene.severity === "fail") failures.push(`public_copy:${field}_text_hygiene_failed`);
    else if (hygiene.severity === "warn") warnings.push(`public_copy:${field}_text_hygiene_repaired`);
  }

  return {
    schema_version: 1,
    verdict: failures.length ? "fail" : "pass",
    failures,
    warnings,
    metrics: {
      title_words: wordCount(title),
      description_chars: description.length,
      first_line_words: wordCount(firstLine),
    },
  };
}

module.exports = {
  WEAK_TITLE_PATTERNS,
  GENERIC_SUBJECT_PATTERNS,
  ARTICLE_RESIDUE_PATTERNS,
  LAZY_PLAYER_ANGLE_RE,
  OFFICIAL_SOURCE_REPORTING_RE,
  STALE_IDENTITY_CTA_RE,
  FORMULAIC_PUBLIC_NARRATION_PATTERNS,
  INSTRUCTION_LIKE_BUYER_ADVICE_PATTERNS,
  hasStaleIdentityCta,
  hasMalformedPrimarySourceLabel,
  hasSourceUrlLabelMismatch,
  hasRawArticleHeadlineInNarration,
  hasUnanchoredPremiumEditionClaim,
  hasPlatformStrategyMisclassifiedAsGameplay,
  hasUnanchoredReviewScoreLanguage,
  hasSourceClaimScopeMismatch,
  hasUnsupportedSpecificDetailNarration,
  hasStaleLaunchDateFraming,
  evaluateGoalPublicCopy,
};
