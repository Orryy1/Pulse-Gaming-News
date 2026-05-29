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
  extendScriptToTarget,
} = require("./goal-duration-variant-repair");
const { buildCaptionSrt } = require("./goal-public-copy-repair");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const mediaPaths = require("./media-paths");

const TARGET_SECONDS = { min: 61, max: 75 };
const HARD_WINDOW_SECONDS = { min: 15, max: 90 };
const SUPPORT_FILES = [
  "director_beat_map.json",
  "footage_inventory.json",
  "materialised_motion_clips.json",
  "owned_motion_manifest.json",
  "rights_ledger.json",
  "sfx_manifest.json",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeId(value) {
  return cleanText(value)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function wordCount(value = "") {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function round(value, places = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

async function readJsonIfPresent(filePath, fallback = null) {
  try {
    if (filePath && (await fs.pathExists(filePath))) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function variantStoryIdFor(storyId = "") {
  return `${safeId(storyId) || "story"}__tiktok_creator_rewards`;
}

function variantDirFor(job = {}, artifactDir = "") {
  const explicit = cleanText(job.output_variant_dir || job.variant_artifact_dir);
  if (explicit) return path.resolve(explicit);
  return path.join(path.resolve(artifactDir || job.artifact_dir || ""), "platform_variants", "tiktok_creator_rewards");
}

function relAudioPath(storyId = "") {
  return `output/audio/${safeId(storyId)}.mp3`;
}

function relTimestampPath(storyId = "") {
  return `output/audio/${safeId(storyId)}_timestamps.json`;
}

function sentenceList(value = "") {
  return cleanText(value)
    .split(/(?<=[.!?])\s+/)
    .map(cleanText)
    .filter(Boolean);
}

function sentenceWithPeriod(value = "") {
  const text = cleanText(value).replace(/[.?!]+$/g, "");
  return text ? `${text}.` : "";
}

function tidyStorySubject(value = "") {
  return cleanText(value).replace(/\bSTRANGER THAN HEAVEN\b/g, "Stranger Than Heaven");
}

function isPulseCtaSentence(value = "") {
  return /\bfollow\s+pulse\s+gaming\b/i.test(cleanText(value));
}

function splitBodyAndCta(value = "") {
  let cta = "";
  const body = [];
  for (const sentence of sentenceList(value)) {
    if (isPulseCtaSentence(sentence)) {
      if (!cta) cta = sentenceWithPeriod(sentence);
      continue;
    }
    body.push(sentenceWithPeriod(sentence));
  }
  return {
    body: cleanText(body.join(" ")),
    cta: cta || "Follow Pulse Gaming so you never miss a beat.",
  };
}

function cleanSpokenText(value = "") {
  try {
    const audio = require("../audio");
    return cleanText(audio.cleanForTTS(value));
  } catch {
    return cleanText(value);
  }
}

function uppercaseHeadline(value = "") {
  return cleanText(value).toUpperCase();
}

function thumbnailCopyFailures(canonical = {}, headline = "") {
  const result = evaluateGoalPublicCopy({
    ...canonical,
    thumbnail_headline: headline,
    thumbnail_text: headline,
  });
  return asArray(result.failures).filter((failure) =>
    /^public_copy:thumbnail_(?:semantically_truncated|headline_dangles|headline_repeated_token)$/.test(cleanText(failure)),
  );
}

function subjectPossessive(subject = "") {
  const text = cleanText(subject);
  if (!text) return "";
  return /s$/i.test(text) ? `${text}'` : `${text}'s`;
}

function repairVariantThumbnailHeadline(canonical = {}) {
  const current = cleanText(canonical.thumbnail_headline || canonical.thumbnail_text || canonical.suggested_thumbnail_text);
  if (current && !thumbnailCopyFailures(canonical, current).length) return current;
  const subject = tidyStorySubject(canonical.canonical_subject || canonical.canonical_game || canonical.selected_title);
  const candidates = [];
  if (isSameWorldNewGameStory(canonical)) {
    candidates.push(`${subjectPossessive(subject)} Next Game`);
  }
  if (isConsoleDateStory(canonical)) candidates.push(`${subject} Console Date`);
  if (isRetailDiscountStory(canonical)) candidates.push(`${subject} $15 Deal`);
  if (isOfficialAccessoryListingStory(canonical)) candidates.push(`${subject} Gear Catch`);
  if (isPlatformFeedbackStory(canonical)) candidates.push(`${subject} Exclusives Fight`);
  candidates.push(subject);
  for (const candidate of candidates.map(uppercaseHeadline).filter(Boolean)) {
    if (!thumbnailCopyFailures(canonical, candidate).length) return candidate;
  }
  return current;
}

function includesSentence(script = "", sentence = "") {
  const normalise = (value) => cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const haystack = normalise(script);
  const needle = normalise(sentence);
  return needle && haystack.includes(needle);
}

const PRICE_UP_RE =
  /\b(?:price(?:s)?\s+(?:went|go(?:es)?|going)\s+up|price\s+(?:hike|increase|jump|rise)|prices?\s+(?:are\s+)?rising|more expensive|costs?\s+more|raised?\s+prices?)\b/i;
const PRICE_DOWN_RE =
  /\b(?:cheap enough|timed discount|discount|sale|deal is live|lowest price|lower entry point|offer itself|price\s+(?:drop|cut)|dropped?\s+to|down\s+to|cheaper|costs?\s+less|savings?|save\s+\$?\d+|\d{1,3}%\s*off)\b/i;

function canonicalEvidenceText(canonical = {}) {
  const claimInventory = canonical.claim_inventory && typeof canonical.claim_inventory === "object"
    ? canonical.claim_inventory
    : {};
  return cleanText([
    canonical.canonical_subject,
    canonical.canonical_game,
    canonical.selected_title,
    canonical.canonical_title,
    canonical.description,
    canonical.narration_script,
    ...asArray(canonical.confirmed_claims),
    ...asArray(claimInventory.confirmed),
  ].join(" "));
}

function isPriceIncreaseStory(canonical = {}) {
  const text = canonicalEvidenceText(canonical);
  return PRICE_UP_RE.test(text) && !PRICE_DOWN_RE.test(text);
}

function isPriceDecreaseResidueForStory(sentence = "", canonical = {}) {
  return isPriceIncreaseStory(canonical) && PRICE_DOWN_RE.test(cleanText(sentence));
}

function isLaunchResidueForStory(sentence = "", canonical = {}) {
  if (!isLaunchOrLiveStory(canonical)) return false;
  return /\breports\b.+\bout now\b.+\bconfirmed the launch timing\b|now has to make the shipped build feel as sharp|showcase hype into a real player verdict/i
    .test(cleanText(sentence));
}

function isLaunchOrLiveStory(canonical = {}) {
  return /\b(?:already live|out now|launched|launch(?:ed|es)? on|release(?:d)? now|shipped build|launch build)\b/i
    .test(canonicalEvidenceText(canonical));
}

function isConsoleDateStory(canonical = {}) {
  const text = canonicalEvidenceText(canonical);
  return /\b(?:xbox|playstation|ps5|console)\b/i.test(text) &&
    /\b(?:date|countdown|coming|april\s+\d{1,2}|same\s+april|launch[-\s]?day|console\s+port)\b/i.test(text);
}

function isJobMarketStory(canonical = {}) {
  return /\b(?:job market|composer|resumes?|interviews?|hiring|layoffs?|credited specialists|audio talent|talent squeeze)\b/i
    .test(canonicalEvidenceText(canonical));
}

function isMultiEraRevealStory(canonical = {}) {
  return /\b(?:five[-\s]?era|five\s+eras|time jumps?|period piece|xbox partner preview)\b/i
    .test(canonicalEvidenceText(canonical));
}

function isSameWorldNewGameStory(canonical = {}) {
  return /\b(?:new game set in the world|same .* world|current roadmap|balance and bug[-\s]?fix support|new content update)\b/i
    .test(canonicalEvidenceText(canonical));
}

function isLeakLedStory(canonical = {}) {
  return /\b(?:reportedly\s+leak(?:ed|s)?|leaked\s+early|appeared\s+online|leaked\s+before\s+launch|rough\s+leaked|pre[-\s]?launch\s+leak)\b/i
    .test(canonicalEvidenceText(canonical));
}

function isDateLeakStory(canonical = {}) {
  return /\b(?:date leak|release date .* leaked|leaked .* release date|release date .* accidentally revealed|date .* revealed early|may have leaked its own release date)\b/i
    .test(canonicalEvidenceText(canonical));
}

function isBusinessBonusDisputeStory(canonical = {}) {
  return /\bsubnautica\s*2\b/i.test(canonicalEvidenceText(canonical)) &&
    /\b(?:bonus|\$?\s*250\s*million|payout|creator\s+reward|developers appear to be in line|krafton|publisher timing)\b/i
      .test(canonicalEvidenceText(canonical));
}

function isPremiumEditionRevenueStory(canonical = {}) {
  const text = canonicalEvidenceText(canonical);
  return /\bpremium\s+edition\b/i.test(text) &&
    /\b(?:early access|\$?\s*140\s*million|made more than|revenue|standard release|paid head start)\b/i.test(text);
}

function isSteamLaunchAccessStory(canonical = {}) {
  const text = canonicalEvidenceText(canonical);
  return /\bsteam\b/i.test(text) &&
    /\b(?:available now|available on steam|hit steam|finally hit steam)\b/i.test(text);
}

function isSteamPerformanceStory(canonical = {}) {
  const text = canonicalEvidenceText(canonical);
  return /\bsteam\b/i.test(text) &&
    /\b(?:steam success|steam ceiling|steam spike|steam plan|steam bet|xbox signal|platform plan|distribution story|pc story|pc push|concurrent players)\b/i.test(text);
}

function isCorporateStakeStory(canonical = {}) {
  const text = canonicalEvidenceText(canonical);
  return /\bstake\b/i.test(text) &&
    /\b(?:activist investor|oasis management|sony(?:'s|s)? stake|kadokawa)\b/i.test(text);
}

function isOfficialAccessoryListingStory(canonical = {}) {
  const text = canonicalEvidenceText(canonical);
  return /\b(?:controller|headset|accessor(?:y|ies)|limited[-\s]?edition)\b/i.test(text) &&
    /\b(?:xbox|forza)\b/i.test(text) &&
    /\b(?:lists?|official|wireless)\b/i.test(text);
}

function isRetailDiscountStory(canonical = {}) {
  const text = canonicalEvidenceText(canonical);
  return /\b(?:dropped?\s+to|discount|sale|deal|% off|off its listed price|gamestop|retailer price)\b/i.test(text) &&
    !isPremiumEditionRevenueStory(canonical);
}

function isPlatformFeedbackStory(canonical = {}) {
  return /\b(?:player voice|feedback|demand exclusives|exclusives argument|platform promises?|promise test)\b/i
    .test(canonicalEvidenceText(canonical));
}

function isPokemonGoEventStory(canonical = {}) {
  return /\b(?:pok(?:e|é|ã©)mon\s+go|mega\s+mewtwo|go\s+fest|free for all players|niantic)\b/i
    .test(canonicalEvidenceText(canonical));
}

function isReviewScoreStory(canonical = {}) {
  return /\b(?:review|reviews|reviewed|metacritic|opencritic|rated|score|\b\d{2,3}\s*(?:\/|out of)\s*100\b)\b/i
    .test(canonicalEvidenceText(canonical));
}

function minimumWordsForTiktokCreatorRewards(canonical = {}, script = "") {
  if (isJobMarketStory(canonical)) return 190;
  if (isConsoleDateStory(canonical)) return 180;
  if (isMultiEraRevealStory(canonical)) return 185;
  if (isSameWorldNewGameStory(canonical)) return 185;
  if (isDateLeakStory(canonical)) return 212;
  if (isLeakLedStory(canonical)) return 190;
  if (isBusinessBonusDisputeStory(canonical)) return 190;
  if (isPremiumEditionRevenueStory(canonical)) return 190;
  if (isSteamLaunchAccessStory(canonical)) return 190;
  if (isSteamPerformanceStory(canonical)) return 190;
  if (isCorporateStakeStory(canonical)) return 190;
  if (isOfficialAccessoryListingStory(canonical)) return 190;
  if (isRetailDiscountStory(canonical)) return 195;
  if (isPlatformFeedbackStory(canonical)) return 190;
  if (isPokemonGoEventStory(canonical)) return 210;
  if (isReviewScoreStory(canonical)) return 185;
  return Math.min(160, Math.max(115, wordCount(script) - 15));
}

function tiktokLongContextSentences(canonical = {}) {
  const subject = tidyStorySubject(canonical.canonical_subject || canonical.canonical_game || canonical.selected_title || "this game");
  const source = cleanText(canonical.primary_source || canonical.source_card_label || canonical.official_source);
  const claim = cleanText(asArray(canonical.confirmed_claims)[0]);
  const text = cleanText([
    subject,
    canonical.selected_title,
    canonical.narration_script,
    claim,
  ].join(" ")).toLowerCase();
  if (isPriceIncreaseStory(canonical)) {
    return [
      `${subject} hits harder here because the console now costs more before a single game is added.`,
      "That puts more attention on bundles, used hardware and whether waiting changes the full setup cost.",
      "For anyone still outside PlayStation's ecosystem, the entry price moved up before accessories, subscriptions or games.",
      source ? `${source} names the products and regions, so the claim stays on the price rise instead of vague console panic.` : "",
    ];
  }
  if (isConsoleDateStory(canonical)) {
    return [
      `The console version angle is not just access; it is whether ${subject} feels current on PlayStation and Xbox instead of late.`,
      `${subject} is built on repeat attempts, quick failures and tiny build changes, not one slow cinematic reveal.`,
      "The strongest version of this story is simple: the date is set, but the port still has to feel immediate on a controller.",
      "That makes input response and readable combat more important than another logo card.",
      source ? `${source} anchors the date, so the extra seconds should sharpen the player stakes rather than stretch the reveal.` : "",
    ];
  }
  if (isLaunchOrLiveStory(canonical)) {
    return [
      `${subject} is past the trailer phase now; the launch build has to make those big battles feel good on real hardware.`,
      "That means performance, combat readability and mission flow matter more than another cinematic shot.",
      "If player clips keep the spectacle intact, the long wait starts looking justified.",
      "If they do not, this becomes a launch-week performance story fast.",
      "Ordinary fights have to stay readable when the camera, effects and enemies all crowd the screen.",
      "Launch-week clips will tell that story faster than another preview quote.",
    ];
  }
  if (isJobMarketStory(canonical)) {
    return [
      `The sharp part is who is saying it: someone attached to games players still recognise.`,
      "When that kind of specialist is struggling for interviews, the labour story moves closer to the games on the shelf.",
      "Players may feel it later in thinner audio teams, safer projects and sequels that lose texture.",
      "That is why this lands harder than another dry studio jobs post.",
      "It can change what gets made, which teams take risks and how much craft survives before a game reaches players.",
      "That makes the hiring squeeze more than background noise for people who care how games actually feel.",
    ];
  }
  if (isMultiEraRevealStory(canonical)) {
    return [
      `${subject} works only if different time periods change how the game plays, not just what the streets and clothes look like.`,
      "That is a much harder promise than a normal reveal trailer.",
      "Players need to see whether each era changes missions, weapons and traversal.",
      "That keeps the story on design pressure, not empty trailer hype.",
      "The pitch gets sharper when an era changes the job, the tools or the risk.",
      source ? `${source} anchors the reveal, so the longer cut should make the ambition easier to read while staying inside what is confirmed.` : "",
    ];
  }
  if (isSameWorldNewGameStory(canonical)) {
    return [
      `The sharper question is not a patch list; it is whether ${subject} can turn into a second vampire pitch without feeling recycled.`,
      `${subject} keeps support, while the bigger creative swing moves somewhere else.`,
      "For players, that changes expectations: less roadmap watching and more pressure on the next world to prove its own hook.",
      "That is why the official blog matters even without a full gameplay blowout.",
      source ? `${source} keeps the claim official, so the tension stays on what changes when the studio leaves the current update cycle.` : "",
    ];
  }
  if (isDateLeakStory(canonical)) {
    return [
      "A date leak is different from leaked gameplay: it gives fans timing, not a real read on the game itself.",
      "For a Star Wars racing story, the early slip matters because it moves attention from surprise to launch timing.",
      "The official listing becomes the thing to watch because it can lock the date after the early reveal.",
      "That keeps the story on the release window instead of making gameplay claims the leak does not support.",
      source ? `${source} anchors the date claim, so the longer cut can stay on timing and the early listing.` : "",
    ];
  }
  if (isLeakLedStory(canonical)) {
    return [
      `${subject} needs extra care because a leak can be an unfinished build, a compressed repost or the wrong slice of the game.`,
      "The player move is simple: do not treat rough footage like a final verdict before the official launch build lands.",
      "That keeps the tension on timing, trust and whether the leak changes what fans should watch next.",
      "There is also spoiler risk, because early footage can burn surprises before the studio gets to frame the reveal.",
      "If the clip is real, the story is speed: the internet is already ahead of the official rollout.",
      "If it is messy, the risk is judging a sequel by the worst possible version of itself.",
      "That is why reportedly matters here: the leak can show momentum without proving the final game is good.",
      source ? `${source} anchors the report, so the longer cut should stay on what players can judge and what they should wait on.` : "",
    ];
  }
  if (isBusinessBonusDisputeStory(canonical)) {
    return [
      "That business angle is not background noise; it changes how players read every Subnautica 2 update.",
      "The corporate fight can drown out the game if the next trailer does not look confident fast.",
      "Players need one clean answer: does the sequel still look strong while the payout story gets louder?",
      "The clean tension is simple: the bonus report raises the stakes around trust, timing and who controls the sequel.",
      "That gives the TikTok cut a real arc instead of stretching gameplay filler.",
      source ? `${source} anchors the bonus claim, so the longer cut can stay on what the dispute changes for the game.` : "",
    ];
  }
  if (isPremiumEditionRevenueStory(canonical)) {
    return [
      "The paid head start shows how many players are willing to move launch day forward.",
      "That matters because Game Pass, standard edition and early access now feel like separate release moments.",
      "The player question is whether the paid head start changes the social conversation before everyone else arrives.",
      "If the standard release catches up, the number looks like momentum.",
      "If it does not, it looks like front-loaded demand.",
      source ? `${source} anchors the revenue claim, so the longer cut should stay on access, timing and what the number can prove.` : "",
    ];
  }
  if (isSteamLaunchAccessStory(canonical)) {
    return [
      `${subject} matters on Steam because it moves the game outside the Xbox-store bubble.`,
      "For PC players, the question is not just availability; it is where friends, saves and updates actually live.",
      "A Steam launch can change wishlists, reviews and discovery faster than another storefront badge.",
      "If Forza grows there, Xbox gets a cleaner PC story than a closed launcher ever gave it.",
      "If it stalls, the platform push looks thinner.",
      "That changes how the game finds casual PC buyers who never open the Xbox app.",
      "It also makes user reviews part of the launch story almost immediately.",
      "The pressure point is whether Steam players treat it like a late port or a proper day-one PC release.",
      source ? `${source} anchors the listing, so the longer cut should stay on access, timing and how PC players find the game.` : "",
    ];
  }
  if (isSteamPerformanceStory(canonical)) {
    return [
      "The Steam spike matters because it tests whether Xbox can win attention away from its own storefront.",
      "That changes the PC story from availability to momentum.",
      "Wishlists, user reviews and concurrent players can make the launch feel bigger than a store badge.",
      "The player angle is simple: if friends are on Steam, the game gets easier to recommend.",
      "If the spike fades, it is still a strong opening, not proof of a permanent platform shift.",
      "If it holds, Xbox has a cleaner PC story than a closed launcher ever gave it.",
      source ? `${source} anchors the platform claim, so the longer cut should stay on Steam momentum and what it means for players.` : "",
    ];
  }
  if (isCorporateStakeStory(canonical)) {
    return [
      "This is not a trailer, but the stake change shifts leverage around a company players know.",
      "A larger investor position does not announce a game; it changes who can push harder inside the business story.",
      "Sony being passed is the hook because it makes the ownership picture less settled than it looked.",
      "For players, the practical read is future pressure around deals, licences and how loudly investors can argue for change.",
      "The clean tension is whether that pressure stays financial or starts shaping the strategy around the company.",
      "That is why the story deserves more than a stock-market caption: it changes the power map around a gaming name.",
      source ? `${source} anchors the percentage, so the longer cut should stay on the stake change and avoid pretending a game was announced.` : "",
    ];
  }
  if (isOfficialAccessoryListingStory(canonical)) {
    return [
      "This is a gear-listing story, not a discount story, so the clean player angle is what Xbox is actually putting on sale.",
      "The controller and headset matter because Forza fans buy into the launch ritual around the game, not just the game itself.",
      "That makes availability, official branding and whether the accessories feel worth chasing the real point.",
      "If the listing changes, the story changes with it, because this is about official accessories rather than a leaked gameplay beat.",
      "The useful catch is the gap between collector appeal and practical value for people who already own a working pad.",
      "That gives the longer cut a cleaner argument than pretending every branded controller is automatically a must-buy.",
      source ? `${source} anchors the accessory listing, so the longer cut should stay on the controller, headset and Forza tie-in.` : "",
    ];
  }
  if (isRetailDiscountStory(canonical)) {
    return [
      "A retailer discount story has to stay practical: price, platform, stock and how long the listing holds.",
      "At this price, a physical Switch RPG reaches players who ignored it at full price.",
      "The live listing has to match the headline when viewers check it.",
      "That keeps the TikTok version useful without turning a sale into pressure to buy.",
      "Collectors and late Switch buyers are the obvious audience.",
      "Retailer limits still matter because a sold-out listing ages fast.",
      "Even viewers who skip it still learn the real floor price.",
      "Players who already own it can still use the number as a better price floor.",
      "For Switch owners, the value is knowing when a remake finally hits budget territory.",
      "The price drop is the story. The discount does not change the game itself.",
      source ? `${source} anchors the discount, so the longer cut should stay on the listed price and retailer limits.` : "",
    ];
  }
  if (isPlatformFeedbackStory(canonical)) {
    return [
      "A feedback portal only matters if fans believe it can change decisions, and Xbox fans went straight to the sore point.",
      "The exclusives demand is not subtle: players want clearer rules before more Xbox games jump platforms.",
      "That makes this less about a survey form and more about trust after months of mixed platform signals.",
      "If Microsoft answers with vague language, the same argument comes back on the next showcase.",
      "The player stake is simple: buying into Xbox feels different when the boundary around first-party games keeps moving.",
      "That is why feedback becomes content fast; fans are using the official channel to ask for a clearer platform promise.",
      source ? `${source} anchors the feedback launch, so the longer cut should stay on the exclusives reaction and platform clarity.` : "",
    ];
  }
  if (isPokemonGoEventStory(canonical)) {
    return [
      "Mega Mewtwo is an access story, not just a monster reveal.",
      "The free Go Fest detail widens the hook because lapsed players can care without first checking a paid-ticket wall.",
      "That means the rollout has to make timing and event access easy to understand before the hype gets messy.",
      "If Niantic lands that cleanly, this becomes a real comeback weekend instead of another headline for current players only.",
      "If it fumbles, the biggest reveal in the world will still feel smaller than the access problem around it.",
      source ? `${source} anchors the Go Fest detail, so the longer cut should stay on Mega Mewtwo, free access and timing.` : "",
    ];
  }
  if (/\b(?:deal|discount|price|sale|subscription|premium edition|early access)\b/.test(text)) {
    return [
      `${subject} now has a clean player-impact angle: the same hardware costs more before a single game is added.`,
      "That pushes more attention onto bundles, used hardware and whether waiting for a timed discount makes sense.",
      "For anyone still outside the ecosystem, this is not abstract inflation; it is the real entry price moving up.",
      source ? `${source} anchors the claim, but players still need the practical shape before the headline becomes useful.` : "",
    ];
  }
  if (isReviewScoreStory(canonical)) {
    return [
      `${subject} needs the extra context because a score only lands when players can see what the praise is pointing at.`,
      "One number starts the argument. Players still judge how it feels, how it runs and whether the praise holds up.",
      "The longer cut gives the verdict room to breathe without turning the review into a victory lap.",
      "That makes the player question sharper: is this just another polished sequel, or the rare annualised racer that still feels necessary?",
      "The score starts the conversation, but consistency across outlets is what turns it from a headline into a real signal.",
      "That gives the TikTok cut room for platform context without padding the verdict.",
      source ? `${source} anchors the claim, and the footage has to make that claim feel readable fast.` : "",
    ];
  }
  return [
    `${subject} needs the extra context because players have to judge the footage, not just the announcement.`,
    "At phone speed, the details are simple: movement, interface pressure and whether the action reads instantly.",
    "If those details keep showing up, the reveal earns attention beyond the brand name.",
    source ? `${source} gives the claim; the footage has to make it clear without slowing the story down.` : "",
  ];
}

function expandScriptForLocalTiktokCreatorRewards(script = "", canonical = {}, { minWords = 165 } = {}) {
  const { body, cta } = splitBodyAndCta(script);
  let nextBody = body;
  for (const sentence of tiktokLongContextSentences(canonical)) {
    if (wordCount(`${nextBody} ${cta}`) >= minWords) break;
    const cleanSentence = sentenceWithPeriod(sentence);
    if (!cleanSentence || includesSentence(nextBody, cleanSentence)) continue;
    nextBody = cleanText(`${nextBody} ${cleanSentence}`);
  }
  return cleanText(`${nextBody} ${sentenceWithPeriod(cta)}`);
}

function unsafeTiktokVariantPublicSentence(sentence = "", canonical = {}) {
  const text = cleanText(sentence);
  if (/\b(?:one concrete change worth remembering|clean shape:\s*what changed|source visible and no extra lore|players have to judge the footage|at phone speed|movement,\s*interface pressure|details keep showing up|footage has to make it clear|direct play segment|combat rhythm|camera weight)\b/i.test(text)) {
    return true;
  }
  if (isDateLeakStory(canonical) && /\b(?:pace,\s*camera and combat|rough footage like a final verdict|wrong slice of the game|spoiler risk|unfinished build|compressed repost|players can see the pace)\b/i.test(text)) {
    return true;
  }
  if (isLeakLedStory(canonical) && /\b(?:finally has footage players can judge|clip puts the pitch|one reveal cannot settle|longer play section|at phone speed|details keep showing up|footage has to make it clear)\b/i.test(text)) {
    return true;
  }
  if (isReviewScoreStory(canonical) && /\b(?:the number is only the opening beat|the next comparison is whether other outlets|reception is harder to dismiss)\b/i.test(text)) {
    return true;
  }
  if (isMultiEraRevealStory(canonical) && /\b(?:time jumps|colo(?:u)?r grade|pretending the game is proven)\b/i.test(text)) {
    return true;
  }
  if (isBusinessBonusDisputeStory(canonical) && /\b(?:business noise|audience has two questions|players have to judge the footage|at phone speed|details keep showing up|movement,\s*interface pressure|footage has to make it clear|krafton now has to sell|legal lecture)\b/i.test(text)) {
    return true;
  }
  if (isPremiumEditionRevenueStory(canonical) && /\b(?:same hardware costs more|retailer deals|bundles,\s*used hardware|timed discount|abstract inflation|real entry price moving up)\b/i.test(text)) {
    return true;
  }
  if ((isRetailDiscountStory(canonical) || isOfficialAccessoryListingStory(canonical)) && /\b(?:same hardware costs more|lower entry point|cheap enough|physical copy|quick price check|force a buy|compare the live retailer price|abstract inflation|entry price moving up|the catch is not drama|a good deal cut should)\b/i.test(text)) {
    return true;
  }
  if (isSteamLaunchAccessStory(canonical) && /\b(?:finally has footage players can judge|clip puts the pitch|one reveal cannot settle|longer play section|players have to judge the footage|at phone speed|details keep showing up|footage has to make it clear|direct play segment|combat rhythm|camera weight)\b/i.test(text)) {
    return true;
  }
  if (isSteamPerformanceStory(canonical) && /\b(?:second vampire pitch|bigger creative swing|patch list|roadmap watching|new content update)\b/i.test(text)) {
    return true;
  }
  return /direct play segment|combat rhythm|camera weight|stronger cut|stronger video cut/i.test(text) ||
    isPriceDecreaseResidueForStory(text, canonical) ||
    isLaunchResidueForStory(text, canonical);
}

function repairTiktokCreatorRewardsSentence(sentence = "", canonical = {}) {
  let text = sentenceWithPeriod(sentence);
  if (isMultiEraRevealStory(canonical)) {
    text = text
      .replace(/\bSTRANGER THAN HEAVEN\b/g, "Stranger Than Heaven")
      .replace(
        /\bGameplay will decide whether the time jumps change the missions or just the wardrobe\.?/i,
        "Gameplay will decide whether each era changes missions or just the wardrobe.",
      )
      .replace(
        /\bPlayers need to see whether each era affects missions, weapons and traversal, not just the colo(?:u)?r grade\.?/i,
        "Players need to see whether each era changes missions, weapons and traversal.",
      )
      .replace(
        /\bXbox anchors the reveal, so the longer cut should make the ambition easier to read without pretending the game is proven\.?/i,
        "Xbox anchors the reveal, so the longer cut should make the ambition easier to read while staying inside what is confirmed.",
      );
  }
  return sentenceWithPeriod(text);
}

function repairTiktokCreatorRewardsPublicScript(script = "", canonical = {}) {
  const { body, cta } = splitBodyAndCta(script);
  let nextBody = sentenceList(body)
    .filter((sentence) => !unsafeTiktokVariantPublicSentence(sentence, canonical))
    .map((sentence) => repairTiktokCreatorRewardsSentence(sentence, canonical))
    .join(" ");
  const minimum = minimumWordsForTiktokCreatorRewards(canonical, script);
  for (const sentence of tiktokLongContextSentences(canonical)) {
    if (wordCount(`${nextBody} ${cta}`) >= minimum) break;
    const cleanSentence = sentenceWithPeriod(sentence);
    if (!cleanSentence || unsafeTiktokVariantPublicSentence(cleanSentence, canonical) || includesSentence(nextBody, cleanSentence)) {
      continue;
    }
    nextBody = cleanText(`${nextBody} ${cleanSentence}`);
  }
  return cleanText(`${nextBody} ${sentenceWithPeriod(cta)}`);
}

function normaliseTimestampWordList(words = []) {
  return asArray(words)
    .map((word) => ({
      word: cleanText(word.word || word.text),
      start: Number(word.start),
      end: Number(word.end),
    }))
    .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start);
}

function timestampWordQuality(words = []) {
  const usable = normaliseTimestampWordList(words);
  if (!usable.length) return { words: usable, score: Number.NEGATIVE_INFINITY };
  const end = Math.max(...usable.map((word) => word.end));
  const tinyCount = usable.filter((word) => word.end - word.start < 0.08).length;
  const tinyRatio = tinyCount / usable.length;
  const repeatedWindowCount = usable.filter((word, index) => {
    if (index === 0) return false;
    const previous = usable[index - 1];
    return Math.abs(word.start - previous.start) < 0.005 && Math.abs(word.end - previous.end) < 0.005;
  }).length;
  const repeatedRatio = repeatedWindowCount / usable.length;
  return {
    words: usable,
    score: end + Math.min(usable.length, 300) / 1000 - tinyRatio * 30 - repeatedRatio * 30,
  };
}

function timestampWords(payload = {}) {
  const candidates = [
    timestampWordQuality(payload.words),
    timestampWordQuality(payload.alignment?.words),
  ].filter((candidate) => candidate.words.length);
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].words;
}

async function resolveArtifactPath(reference = "", workspaceRoot = process.cwd()) {
  const raw = cleanText(reference);
  if (!raw) return "";
  if (path.isAbsolute(raw)) return raw;
  const workspacePath = path.resolve(workspaceRoot, raw);
  if (await fs.pathExists(workspacePath)) return workspacePath;
  try {
    const resolved = await mediaPaths.resolveExisting(raw);
    if (resolved && (await fs.pathExists(resolved))) return resolved;
  } catch {}
  return workspacePath;
}

async function validateJobInputs(job = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const blockers = [];
  if (!artifactDir || !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const platformManifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const renderManifestPath = path.join(artifactDir, "render_manifest.json");
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const canonical = await readJsonIfPresent(canonicalPath, null);
  const platformManifest = await readJsonIfPresent(platformManifestPath, null);
  const renderManifest = await readJsonIfPresent(renderManifestPath, null);
  const rightsLedger = await readJsonIfPresent(rightsPath, null);
  if (!canonical) blockers.push("canonical_story_manifest_missing");
  if (!platformManifest) blockers.push("platform_publish_manifest_missing");
  if (!renderManifest) blockers.push("render_manifest_missing");
  if (!rightsLedger) blockers.push("rights_ledger_missing");
  if (canonical && !cleanText(canonical.canonical_subject || canonical.canonical_game)) {
    blockers.push("missing_canonical_subject");
  }
  if (canonical && !cleanText(canonical.narration_script || canonical.full_script || canonical.tts_script)) {
    blockers.push("narration_script_missing");
  }
  if (rightsLedger && cleanText(rightsLedger.verdict).toLowerCase() === "fail") {
    blockers.push("rights_ledger_failed");
  }
  return {
    artifactDir,
    canonicalPath,
    platformManifestPath,
    renderManifestPath,
    rightsPath,
    canonical,
    platformManifest,
    renderManifest,
    rightsLedger,
    blockers,
  };
}

async function copySupportFiles(artifactDir, variantDir) {
  const copied = [];
  for (const fileName of SUPPORT_FILES) {
    const from = path.join(artifactDir, fileName);
    if (!(await fs.pathExists(from))) continue;
    const to = path.join(variantDir, fileName);
    await fs.copy(from, to, { overwrite: true });
    copied.push(fileName);
  }
  return copied;
}

function buildVariantCanonical({ canonical = {}, job = {}, variantStoryId = "", generatedAt } = {}) {
  const extension = extendScriptToTarget(canonical, {
    ...job,
    target_duration_seconds: job.target_duration_seconds || TARGET_SECONDS,
    provider: job.provider || "local",
  });
  const publicScript = repairTiktokCreatorRewardsPublicScript(
    expandScriptForLocalTiktokCreatorRewards(extension.script, canonical),
    canonical,
  );
  const spokenScript = cleanSpokenText(publicScript);
  const firstSentence = sentenceList(publicScript)[0] ||
    cleanText(canonical.first_spoken_line || canonical.narration_hook);
  const claim = cleanText(asArray(canonical.confirmed_claims)[0] || canonical.primary_claim || firstSentence);
  const source = cleanText(canonical.primary_source || canonical.source_card_label || canonical.official_source);
  const description = cleanText(canonical.description) ||
    cleanText(`${claim}${source ? ` Source: ${source}.` : ""}`);
  const thumbnailHeadline = repairVariantThumbnailHeadline(canonical);
  const updated = {
    ...canonical,
    story_id: variantStoryId,
    base_story_id: cleanText(canonical.story_id || job.story_id),
    platform_variant_type: "tiktok_creator_rewards",
    platform_variant_for: "tiktok",
    first_spoken_line: firstSentence,
    narration_hook: firstSentence,
    narration_script: publicScript,
    full_script: publicScript,
    tts_script: publicScript,
    local_tts_spoken_script: spokenScript,
    thumbnail_headline: thumbnailHeadline || canonical.thumbnail_headline,
    thumbnail_text: thumbnailHeadline || canonical.thumbnail_text,
    description,
    word_count: wordCount(publicScript),
    duration_variant_repaired_at: generatedAt,
    duration_variant_repair_strategy: "tiktok_creator_rewards_platform_variant",
    duration_variant_original_duration_s: Number(job.current_duration_s) || null,
    duration_variant_target_duration_seconds: job.target_duration_seconds || TARGET_SECONDS,
    tiktok_creator_rewards_variant: {
      base_story_id: cleanText(canonical.story_id || job.story_id),
      target_duration_seconds: job.target_duration_seconds || TARGET_SECONDS,
      generated_at: generatedAt,
      base_render_mutated: false,
    },
  };
  return { canonical: updated, extension };
}

function audioWorkbenchForVariant({ job = {}, variantStoryId = "", variantDir = "", provider = "local" } = {}) {
  const useElevenLabs = cleanText(provider).toLowerCase() === "elevenlabs" || cleanText(job.tts_provider).toLowerCase() === "elevenlabs";
  return {
    local_tts: useElevenLabs ? { verdict: "skipped", ready: false } : { verdict: "green", ready: true },
    elevenlabs_tts: useElevenLabs ? { verdict: "green", ready: true } : null,
    provider_preference: useElevenLabs ? "elevenlabs" : "local",
    jobs: [
      {
        story_id: variantStoryId,
        title: cleanText(job.title),
        artifact_dir: variantDir,
        status: "requires_audio_timestamp_generation",
        ...(useElevenLabs ? { tts_provider: "elevenlabs" } : {}),
        missing: ["tiktok_creator_rewards_variant_audio", "tiktok_creator_rewards_variant_timestamps"],
      },
    ],
  };
}

function renderWorkOrderForVariant({ job = {}, variantStoryId = "", variantDir = "" } = {}) {
  const outputPath = path.join(variantDir, "visual_v4_render_tiktok_creator_rewards.mp4");
  const manifestPath = path.join(variantDir, "render_manifest.json");
  return {
    jobs: [
      {
        story_id: variantStoryId,
        title: cleanText(job.title),
        artifact_dir: variantDir,
        status: "ready_for_final_render_job",
        force_final_render: true,
        evidence: {
          narration_audio_path: relAudioPath(variantStoryId),
          word_timestamps_path: relTimestampPath(variantStoryId),
        },
        actions: [
          {
            action_id: "run_visual_v4_production_render",
            status: "ready_for_tiktok_creator_rewards_variant_render",
            force: true,
            target_render_manifest: {
              renderer: "visual_v4_production",
              visual_tier: "production_v4_motion",
              final_publish_render: true,
              output: "visual_v4_render_tiktok_creator_rewards.mp4",
              output_path: outputPath,
              manifest_path: manifestPath,
              story_id: variantStoryId,
            },
          },
        ],
      },
    ],
  };
}

async function writeVariantCaptions({
  variantDir,
  variantStoryId,
  script,
  durationS,
  workspaceRoot,
  generatedAt,
} = {}) {
  const timestampsPath = await resolveArtifactPath(relTimestampPath(variantStoryId), workspaceRoot);
  const timestamps = await readJsonIfPresent(timestampsPath, {});
  const words = timestampWords(timestamps);
  const captions = buildCaptionSrt(script, durationS, {
    words,
    maxWordsPerPhrase: 3,
    maxPhraseChars: 24,
    maxPhraseDurationS: 1.25,
    danglingMergeMaxWords: 3,
  });
  if (!cleanText(captions)) throw new Error("tiktok_creator_rewards_variant_captions_empty");
  const captionsPath = path.join(variantDir, "captions_tiktok_creator_rewards.srt");
  await fs.writeFile(captionsPath, captions, "utf8");
  await fs.writeJson(path.join(variantDir, "caption_manifest.json"), {
    schema_version: 1,
    story_id: variantStoryId,
    generated_at: generatedAt,
    caption_srt_path: captionsPath,
    word_timestamps_path: timestampsPath,
    timing_source: words.length ? "word_timestamps" : "script_duration_fallback",
    caption_generator: "tiktok_creator_rewards_variant_word_timed_srt",
    word_count: words.length,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  }, { spaces: 2 });
  return { captionsPath, timestampsPath, words };
}

async function backupPlatformManifestOnce(platformManifestPath, generatedAt) {
  const backupPath = `${platformManifestPath}.pre_tiktok_creator_rewards_variant.json`;
  if (!(await fs.pathExists(backupPath))) {
    const current = await fs.readJson(platformManifestPath);
    await fs.writeJson(backupPath, {
      ...current,
      backup_created_at: generatedAt,
      backup_reason: "tiktok_creator_rewards_variant_materialization",
    }, { spaces: 2 });
  }
  return backupPath;
}

async function updateBasePlatformManifest({
  platformManifestPath,
  platformManifest = {},
  generatedAt,
  storyId,
  variantStoryId,
  variantDir,
  outputPath,
  captionsPath,
  durationS,
} = {}) {
  const backupPath = await backupPlatformManifestOnce(platformManifestPath, generatedAt);
  const outputs = { ...(platformManifest.outputs || {}) };
  const existing = outputs.tiktok || {};
  const warnings = asArray(existing.duration_warnings || existing.warnings)
    .filter((warning) => cleanText(warning) !== "below_creator_rewards_duration");
  const variantEvidence = {
    status: "ready",
    platform: "tiktok",
    variant_type: "tiktok_creator_rewards",
    base_story_id: storyId,
    variant_story_id: variantStoryId,
    variant_artifact_dir: variantDir,
    output_path: outputPath,
    captions_path: captionsPath,
    duration_s: durationS,
    publish_duration_seconds: { ...HARD_WINDOW_SECONDS },
    creator_rewards_duration_seconds: { min: 61, max: 90 },
    generated_at: generatedAt,
    base_render_mutated: false,
  };
  outputs.tiktok = {
    ...existing,
    publish_duration_seconds: existing.publish_duration_seconds || { ...HARD_WINDOW_SECONDS },
    creator_rewards_eligible: true,
    creator_rewards_duration_seconds: { min: 61, max: 90 },
    duration_warnings: warnings,
    technical_duration_seconds: durationS,
    variant_video_path: outputPath,
    variant_captions_path: captionsPath,
    platform_variant_render: variantEvidence,
  };
  await fs.writeJson(platformManifestPath, {
    ...platformManifest,
    outputs,
    tiktok_creator_rewards_variant_materialized_at: generatedAt,
    no_publish_triggered: true,
    safety: {
      ...(platformManifest.safety || {}),
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  }, { spaces: 2 });
  return { backupPath, variantEvidence };
}

async function updatePlatformVariantScorecard({
  artifactDir,
  storyId,
  variantEvidence,
  generatedAt,
} = {}) {
  const scorecardPath = path.join(artifactDir, "platform_variant_scorecard.json");
  const current = await readJsonIfPresent(scorecardPath, {});
  await fs.writeJson(scorecardPath, {
    ...current,
    story_id: storyId,
    variants: {
      ...(current.variants || {}),
      tiktok_creator_rewards: variantEvidence,
      tiktok: {
        ...(current.variants?.tiktok || {}),
        creator_rewards_variant: variantEvidence,
      },
    },
    tiktok_creator_rewards_variant_materialized_at: generatedAt,
  }, { spaces: 2 });
  return scorecardPath;
}

async function materializeTiktokCreatorRewardsJob(job = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const storyId = cleanText(job.story_id);
  const validated = await validateJobInputs(job);
  const variantStoryId = variantStoryIdFor(storyId);
  const variantDir = variantDirFor(job, validated.artifactDir || job.artifact_dir);
  if (options.inspectOnly) {
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "inspect_only_pending_tiktok_creator_rewards_variant",
      variant_story_id: variantStoryId,
      variant_artifact_dir: variantDir,
    };
  }
  if (validated.blockers.length) {
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "blocked",
      blockers: validated.blockers,
      artifact_dir: validated.artifactDir || path.resolve(job.artifact_dir || ""),
      variant_artifact_dir: variantDir,
    };
  }

  await fs.ensureDir(variantDir);
  const copiedSupportFiles = await copySupportFiles(validated.artifactDir, variantDir);
  const variantCanonical = buildVariantCanonical({
    canonical: validated.canonical,
    job,
    variantStoryId,
    generatedAt,
  });
  await fs.writeJson(path.join(variantDir, "canonical_story_manifest.json"), variantCanonical.canonical, { spaces: 2 });

  const audioReport = await materializeGoalAudioTimestamps({
    workbenchReport: audioWorkbenchForVariant({
      job,
      variantStoryId,
      variantDir,
      provider: options.provider || "local",
    }),
    workspaceRoot,
    generatedAt,
    force: true,
    provider: options.provider || "local",
    alignmentMode: options.alignmentMode,
    generateTtsForStory: options.generateTtsForStory,
  });
  const audioJob = asArray(audioReport.jobs)[0] || {};
  if (audioJob.status === "failed") {
    const error = new Error(`tiktok_creator_rewards_audio_failed:${audioJob.error || "unknown"}`);
    error.audio_job = audioJob;
    throw error;
  }

  const renderReport = await materializeGoalProductionRenders({
    workOrder: renderWorkOrderForVariant({ job, variantStoryId, variantDir }),
    workspaceRoot,
    generatedAt,
    force: true,
    renderProof: options.renderProof,
  });
  const renderJob = asArray(renderReport.jobs)[0] || {};
  if (renderJob.status === "failed") {
    throw new Error(`tiktok_creator_rewards_render_failed:${renderJob.error || "unknown"}`);
  }
  const durationS = round(renderJob.rendered_duration_s);
  if (!Number.isFinite(durationS) || durationS < 61 || durationS > 90) {
    throw new Error(`tiktok_creator_rewards_duration_out_of_window:${durationS || "unknown"}`);
  }
  const captions = await writeVariantCaptions({
    variantDir,
    variantStoryId,
    script: variantCanonical.canonical.narration_script,
    durationS,
    workspaceRoot,
    generatedAt,
  });
  const platformUpdate = await updateBasePlatformManifest({
    platformManifestPath: validated.platformManifestPath,
    platformManifest: validated.platformManifest,
    generatedAt,
    storyId,
    variantStoryId,
    variantDir,
    outputPath: renderJob.output_path,
    captionsPath: captions.captionsPath,
    durationS,
  });
  const scorecardPath = await updatePlatformVariantScorecard({
    artifactDir: validated.artifactDir,
    storyId,
    variantEvidence: platformUpdate.variantEvidence,
    generatedAt,
  });

  return {
    story_id: storyId,
    title: cleanText(job.title),
    status: "materialized",
    artifact_dir: validated.artifactDir,
    variant_story_id: variantStoryId,
    variant_artifact_dir: variantDir,
    output_path: renderJob.output_path,
    render_manifest_path: renderJob.render_manifest_path,
    captions_path: captions.captionsPath,
    word_timestamps_path: captions.timestampsPath,
    rendered_duration_s: durationS,
    copied_support_files: copiedSupportFiles,
    appended_word_count: variantCanonical.extension.appended_word_count,
    repaired_word_count: variantCanonical.extension.repaired_word_count,
    audio_status: audioJob.status || null,
    audio_provider: audioJob.provider || null,
    render_status: renderJob.status || null,
    platform_manifest_backup_path: platformUpdate.backupPath,
    platform_variant_scorecard_path: scorecardPath,
    base_render_mutated: false,
  };
}

function jobsForTiktokCreatorRewards(workOrder = {}, { limit = 0, storyIds = [] } = {}) {
  const requested = new Set(asArray(storyIds).map(cleanText).filter(Boolean));
  let jobs = asArray(workOrder.jobs).filter((job) =>
    cleanText(job.status) === "needs_tiktok_creator_rewards_variant" ||
      (
        cleanText(job.platform) === "tiktok" &&
        /creator_rewards/i.test(cleanText(job.publish_gate))
      ),
  );
  if (requested.size) jobs = jobs.filter((job) => requested.has(cleanText(job.story_id)));
  if (Number(limit) > 0) jobs = jobs.slice(0, Number(limit));
  return jobs;
}

async function materializeTiktokCreatorRewardsVariants({
  workOrder = {},
  workspaceRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  limit = 0,
  storyIds = [],
  inspectOnly = false,
  provider = "local",
  alignmentMode = "whisper",
  generateTtsForStory,
  renderProof,
} = {}) {
  const jobs = jobsForTiktokCreatorRewards(workOrder, { limit, storyIds });
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await materializeTiktokCreatorRewardsJob(job, {
        workspaceRoot,
        generatedAt,
        inspectOnly,
        provider,
        alignmentMode,
        generateTtsForStory,
        renderProof,
      }));
    } catch (error) {
      const failed = {
        story_id: cleanText(job.story_id),
        title: cleanText(job.title),
        status: "failed",
        error: error.message,
      };
      if (error.audio_job) failed.audio_job = error.audio_job;
      results.push(failed);
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "TIKTOK_CREATOR_REWARDS_VARIANT_MATERIALIZER",
    source_work_order_generated_at: workOrder.generated_at || null,
    summary: {
      candidate_count: jobs.length,
      materialized_count: results.filter((job) => job.status === "materialized").length,
      blocked_count: results.filter((job) => job.status === "blocked").length,
      failed_count: results.filter((job) => job.status === "failed").length,
      inspect_only_count: results.filter((job) => job.status === "inspect_only_pending_tiktok_creator_rewards_variant").length,
    },
    jobs: results,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: results.some((job) => job.audio_provider === "elevenlabs") ? false : true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      base_render_mutation_allowed: false,
      renderer_invoked: results.some((job) => cleanText(job.render_status)),
      external_tts_provider_used: results.some((job) => job.audio_provider === "elevenlabs") ? "elevenlabs" : null,
    },
  };
}

function renderTiktokCreatorRewardsVariantMarkdown(report = {}) {
  const lines = [];
  lines.push("# TikTok Creator-Rewards Variant Materializer");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Materialized: ${report.summary?.materialized_count || 0}`);
  lines.push(`Blocked: ${report.summary?.blocked_count || 0}`);
  lines.push(`Failed: ${report.summary?.failed_count || 0}`);
  lines.push("");
  lines.push("Safety: writes separate TikTok long-variant packages only. Base short renders are not mutated. No publishing, database, token or OAuth change was triggered.");
  if (asArray(report.jobs).length) {
    lines.push("");
    lines.push("## Jobs");
    for (const job of asArray(report.jobs).slice(0, 60)) {
      const detail = job.error
        ? `; error: ${job.error}`
        : job.blockers?.length
          ? `; blockers: ${job.blockers.join(", ")}`
          : job.rendered_duration_s
            ? `; ${job.rendered_duration_s}s`
            : "";
      lines.push(`- ${job.story_id}: ${job.status}${detail}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function writeTiktokCreatorRewardsVariantReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeTiktokCreatorRewardsVariantReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "tiktok_creator_rewards_variant_materialization_report.json");
  const markdownPath = path.join(outDir, "tiktok_creator_rewards_variant_materialization_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderTiktokCreatorRewardsVariantMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  materializeTiktokCreatorRewardsVariants,
  renderTiktokCreatorRewardsVariantMarkdown,
  writeTiktokCreatorRewardsVariantReport,
  jobsForTiktokCreatorRewards,
  variantStoryIdFor,
  _testables: {
    timestampWords,
  },
};
