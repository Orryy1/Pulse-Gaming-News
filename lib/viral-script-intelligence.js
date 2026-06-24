"use strict";

const { lintScript, countWords } = require("./services/script-lint");
const { runScriptCoherenceQa, EXACT_CTA } = require("./script-coherence-qa");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseForCompare(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9$,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceNameVariants(value = "") {
  const raw = cleanText(value);
  if (!raw) return [];
  const camelSpaced = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return [
    ...new Set(
      [raw, camelSpaced, raw.replace(/\s+/g, "")]
        .map(normaliseForCompare)
        .filter(Boolean),
    ),
  ];
}

function sourceNameAppearsInScript(sourceName = "", script = "") {
  const scriptKey = normaliseForCompare(script);
  if (!sourceName || !scriptKey) return false;
  const compactScriptKey = scriptKey.replace(/\s+/g, "");
  return sourceNameVariants(sourceName).some((variant) => {
    const compactVariant = variant.replace(/\s+/g, "");
    return scriptKey.includes(variant) || (compactVariant && compactScriptKey.includes(compactVariant));
  });
}

function sentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function firstSentence(text) {
  return sentences(text)[0] || cleanText(text);
}

function numericClaims(text) {
  return [
    ...new Set(
      cleanText(text).match(/(?:\b\d{1,3}(?:,\d{3})+\b|\$\d+(?:\.\d+)?\b)/g) || [],
    ),
  ];
}

function badNumericSpellouts(text) {
  return [
    ...new Set(
      cleanText(text)
        .toUpperCase()
        .match(/\b\d+(?:\.\d+)?\s+DOLLARS\b/g) || [],
    ),
  ];
}

function ctaCount(text) {
  const normalised = normaliseForCompare(text);
  const cta = normaliseForCompare(EXACT_CTA);
  if (!normalised || !cta) return 0;
  let count = 0;
  let index = normalised.indexOf(cta);
  while (index !== -1) {
    count += 1;
    index = normalised.indexOf(cta, index + cta.length);
  }
  return count;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function repeatsHeadlineHook(story = {}, script = "") {
  const title = normaliseForCompare(story.title);
  const hook = normaliseForCompare(firstSentence(script));
  return Boolean(title && hook && (hook === title || hook.startsWith(title)));
}

function genericOpening(script = "") {
  return /^(?:so|today|hey|hi|welcome|in this)\b/i.test(cleanText(script));
}

function boringRecap(script = "") {
  return /\b(?:source-backed update|so the clean read is this|clean read|broader launch data|the useful detail is the review-score framing|final verdict needs broader launch data)\b/i.test(
    script,
  );
}

function instructionLikeBuyerAdvice(script = "") {
  return /\b(?:the player angle is simple|check the price,\s*access or platform details|before you decide what to play next|before you spend,\s*check the live price|buy,\s*download,\s*wait or skip)\b/i.test(
    script,
  );
}

function formulaicNotJustHook(script = "") {
  return /\b(?:is|was|are|were)\s+not\s+just\b/i.test(firstSentence(script));
}

function producerScaffoldLanguage(script = "") {
  return /\b(?:here(?: is|'?s) what matters(?: now)?|the catch is what matters|the useful part is simple|the player-facing part is|the player impact is|the hook here is|the signal is|for players,\s*the takeaway is simple|for players,\s*the point is simple|the payoff is knowing|(?:for fans|fans|viewers)\s+(?:to|can|will)?\s*(?:argue|debate)\s+about|something to argue about)\b/i.test(
    script,
  );
}

function persuasiveAuthorityTropes(script = "") {
  return /\b(?:the real question is|at its core|what really matters is|what actually matters is|the deeper issue is|the heart of the matter is|fundamentally,\s+this is|this is about the future of)\b/i.test(
    script,
  );
}

function sourceNeutralCatchTemplate(script = "") {
  return /\b(?:the catch is whether (?:players get a concrete next step,?\s+or just another vague update|that score still means as much once the wider player base arrives|this changes timing,\s*access,\s*trust or what players should pay attention to next|that platform clue turns into timing,\s*access or hardware players can actually verify)|the catch is what this changes for [^.?!]{0,90} after the headline fades|the pressure is whether this changes the version people were actually about to pick up)\b/i.test(
    script,
  );
}

function repeatedCatchPivot(script = "") {
  const matches = cleanText(script).match(/\b(?:but\s+)?the catch is\b/gi) || [];
  return matches.length > 1;
}

function sourceTitleRecitation(story = {}, script = "") {
  const sourceName = cleanText(story.source_name);
  if (!sourceName) return false;
  const sourcePrefix = new RegExp(
    `^${escapeRegExp(sourceName)}\\s+(?:reports?|reported|says?|said|published|lists?)\\s+`,
    "i",
  );
  return sentences(script).some((sentence) => {
    if (!sourcePrefix.test(sentence)) return false;
    const reported = cleanText(sentence.replace(sourcePrefix, "").replace(/[.!?]$/, ""));
    if (!reported) return false;
    const reportedKey = normaliseForCompare(reported);
    const titleKey = normaliseForCompare(story.title);
    const repeatsTitle =
      titleKey && reportedKey && (reportedKey.includes(titleKey) || titleKey.includes(reportedKey));
    const selfCitesSource = new RegExp(`\\(${escapeRegExp(sourceName)}\\s*:`, "i").test(reported);
    return Boolean(repeatsTitle || selfCitesSource);
  });
}

function genericFallbackWatchlistLanguage(script = "") {
  return /\b(?:picked up a player-facing detail worth watching|the important bit is whether|the gap to watch now|only matters here if|fills another news slot|just got a new signal|just got a new reason to watch|changed the watchlist|worth watching again|reason to exist beyond repeating the feed|stronger short keeps)\b/i.test(
    script,
  );
}

function reviewHoldFallbackLanguage(script = "") {
  return /\b(?:should stay in review|needs review before|does not yet have a must-watch player consequence|not ready for a Pulse short)\b/i.test(
    script,
  );
}

function htmlEntityInPublicScript(script = "") {
  return /&(?:amp|quot|apos|lt|gt|#\d+|#x[a-f0-9]+);/i.test(cleanText(script));
}

function vagueSourceAttribution(story = {}, script = "") {
  const sourceName = cleanText(story.source_name);
  return /\b(?:youtube|reddit|twitter|x|tiktok)\s+(?:says|reports|reported|claims|claimed)\b/i.test(script) ||
    /^(?:youtube|reddit|twitter|x|tiktok)$/i.test(sourceName);
}

function ungroundedSpeculativeAttribution(script = "") {
  return /\b(?:sources suggest|sources say|sources claim|rumou?rs? suggest|early chatter suggests|people are saying)\b/i.test(
    script,
  );
}

function genericTitleTemplate(story = {}) {
  return /\b(?:just got a new signal|just changed the watchlist|now has a real question|just got a new reason to watch|is worth watching again|reviews just sent a signal|just dropped a new clue|deal has one catch)\b/i.test(
    story.title || "",
  );
}

function genericCouldSplitTitleTemplate(story = {}) {
  return /\bwhy\s+[^.?!]{2,80}\s+could\s+split\s+players\b/i.test(
    story.title || story.public_title || story.selected_title || story.canonical_title || "",
  );
}

function genericPlayerTestTemplate(script = "") {
  return /\b(?:has one clear detail players can check before the hype gets ahead of it|the player test is simple|does this change what people install,\s*wishlist,\s*finish or ignore|if it changes that decision,\s*the story earns attention|if it does not,\s*it is background noise)\b/i.test(
    script,
  );
}

function titleFragmentSubjectLanguage(script = "") {
  const first = firstSentence(script);
  return (
    /^(?:how|why|what|while|pay attention to|everything we know|today'?s top deals)\b/i.test(first) ||
    /\b(?:game|games|demo|story|update|trailer|article|guide)\s+(?:where|that|which|about)\b/i.test(first)
  );
}

function genericSimplePivot(script = "") {
  return /\b(?:the catch is simple|the debate is simple|the real question is simple|the player question is simple)\b/i.test(
    script,
  );
}

function hasConcreteUpdateProof(script = "") {
  return /\b(?:adds?|adding|added|introduces?|introduced|includes?|included|brings?|brought|changes?|changed|reworks?|reworked|expands?|expanded|launches?|launched|lists?|listed|shows?|showed|played|hands[- ]on|demo|trailer|gameplay)\b.{0,90}\b(?:system|mode|map|mission|quest|boss|enemy|enemies|weapon|class|biome|zone|area|difficulty|co[- ]op|multiplayer|campaign|demo|trial|date|release|score|price|discount|platform|console|steam|game pass|playstation|xbox|switch|heat|weather|survival|combat|crafting|build|patch|update)\b/i.test(
    script,
  ) || /\b(?:apply|applied|install|installed|download)\b.{0,90}\b(?:patch|update|hotfix)\b.{0,120}\b(?:save data|progress|progress loss|save wipe|losing save|lost save)\b/i.test(script);
}

function vagueUpdateWithoutConcreteProof(script = "") {
  const text = cleanText(script);
  const vagueUpdate = /\b(?:another|new|major|big|final|last)\s+(?:early access\s+)?(?:update|patch|test|chance)\b/i.test(text) ||
    /\b(?:update|patch|test)\s+(?:coming|arriving|landing|due)\s+(?:later this month|soon|before launch|before full launch)\b/i.test(text);
  return vagueUpdate && !hasConcreteUpdateProof(text);
}

function abstractTitleTestHook(script = "") {
  const hook = firstSentence(script);
  return /\b(?:debate|remake debate|story)\b.{0,80}\b(?:real\s+)?(?:stress test|test)\b/i.test(hook) ||
    /\bfinally has a real stress test\b/i.test(hook);
}

function hasDebateTrigger(script = "") {
  return /\b(?:debate|argument|argue|split|trade[- ]off|whether|or are you|or does|or just|smart|mistake|fight|problem|trust problem|quiet way|risk|danger|tension|difference between|caught between|worth|should|who actually|who gets|who you|does this|is this|if)\b/i.test(
    script,
  );
}

function hasRelatableStakes(script = "") {
  return /\b(?:players?|fans?|viewers?|people|buyers?|new buyers?|owners?|subscribers?|lapsed players?|fence-sitters?|normal buyers?|anyone who skipped|normal PCs?|Windows|PCs?|cheaters?|platform|store|steam|game pass|playstation|xbox|nintendo|publisher|studio|Riot|Niantic|Valve|GameStop)\b.{0,140}\b(?:act|arrive|buy|bought|come back|decide|download|feel|get|hold|jump back|know|look twice|pick up|play|prove|reinstall|take|try|remember|wait|pay|paid|trust|own|skip|return|choose|judge|care|argue|watch|wishlist|wishlists|access|retention|ownership|support|price|release timing|messaging|win|lose|split|abandoning|damage|brick|touches|line|anti-cheat|hardware|bypass)\b/i.test(
    script,
  ) || /\b(?:players?|fans?)\b.{0,140}\b(?:believe|spot|read|predict|hide|survive|escape|panic)\b/i.test(script) ||
    /\b(?:save data|progress loss|losing save|lost save|save wipe|progress)\b.{0,140}\b(?:time|garage|tune|rare unlock|unlock|safe|wipe|lost|reset|risk)\b/i.test(script);
}

function gameplayProofStory(story = {}, script = "") {
  const firstBeats = sentences(script).slice(0, 2).join(" ");
  return /\b(?:gameplay|hands[- ]on|played|preview|demo|gameplay trailer|reveal trailer|remake|remaster|reboot|mission|level|combat|co[- ]op|campaign)\b/i.test(
    `${story.title || ""} ${firstBeats}`,
  );
}

function hasEarlyConcreteSourceDetail(script = "") {
  const early = sentences(script).slice(0, 4).join(" ");
  return /\b(?:scorpion|banshees?|marines?|covenant|forerunner|corridors?|sandbox|combat|gunfights?|camera|vehicles?|co[- ]op|enemy|enemies|weapons?|snow level|level|boss|builds?|map|mode|arena|movement|investigat(?:e|ion)|fights?|fighting|dodges?|melee|tank support|mission flow|controller feel|prologue|xenomorph|stealth|creature|horror pressure|moving too early|route|demo|Nintendo Direct|Summer Game Fest|most[- ]watched|most[- ]viewed|hidden description|faithful update|N64|Switch 2|store copy)\b/i.test(
    early,
  );
}

function missingEarlyConcreteSourceDetail(story = {}, script = "") {
  return gameplayProofStory(story, script) && !hasEarlyConcreteSourceDetail(script);
}

function finalContentSentence(script = "") {
  const withoutCta = cleanText(script).replace(
    new RegExp(`${escapeRegExp(EXACT_CTA)}\\.?\\s*$`, "i"),
    "",
  );
  const allSentences = sentences(withoutCta);
  return allSentences[allSentences.length - 1] || "";
}

function hasStorySpecificPayoff(script = "") {
  const sentence = finalContentSentence(script);
  if (!sentence) return false;
  if (
    /\b(?:check the current listing|check while the listing holds|what changed and what still needs proof|that becomes the follow-up|payoff is knowing|useful deal to check|real pickup point while the listing holds)\b/i.test(
      sentence,
    )
  ) {
    return false;
  }
  return /\b(?:if|unless|that means|this becomes|starts looking|ends up|the real test|decides whether|judge whether|turns|shifts|stops being|moving on|what makes|has to|needs to|proves|only helps|will show|has a universe|cleanest|warning|handoff|trap|fight|win|loss|risk|danger|tension|cannot carry|can reshape|blur together|feels less safe|rare unlock|garage|save wipe)\b/i.test(
    sentence,
  );
}

function softPayoffLanguage(script = "") {
  const sentence = finalContentSentence(script);
  if (!sentence) return false;
  return /\b(?:launch day has a foundation|has a foundation|starts by asking players to trust it again|trust it again|reason to care|something to watch|worth paying attention to|one to watch)\b/i.test(
    sentence,
  );
}

function malformedSourceAttribution(script = "") {
  return /\b(?:I|me|my)\s+reports\b/i.test(script) ||
    /(?:^|[.!?]\s+)[A-Z]\s+reports\b/.test(cleanText(script));
}

function duplicatedSourceAttribution(story = {}, script = "") {
  const sourceName = cleanText(story.source_name);
  if (!sourceName || sourceName.length < 2) return false;
  const source = escapeRegExp(sourceName);
  const re = new RegExp(
    `^${source}\\b(?:\\s+(?:reports?|reported|says?|said|shows?|showed|lists?|listed|reveals?|revealed|announces?|announced)|'s\\s+(?:trailer|post|listing|store|showcase))\\b`,
    "i",
  );
  return sentences(script).filter((sentence) => re.test(sentence)).length > 1;
}

function scoreHook({ story, script }) {
  let score = 100;
  const hook = firstSentence(script);
  const words = countWords(hook);
  if (repeatsHeadlineHook(story, script)) score -= 58;
  if (genericOpening(script)) score -= 35;
  if (formulaicNotJustHook(script)) score -= 45;
  if (words > 16) score -= 15;
  if (!/\b(?:needed|warning|catch|trade[- ]off|paid|headline|problem|mistake|win|panic|risk|wild|signal|verdict|argument|free access|real story|gameplay|leak(?:ed)?|date|deal|drop(?:ped)?|review|score|handmade|job market|brutal|fake|pitch|console|release|hardware|demand|launch|more than|xcom|anti-cheat|vanguard|waiting room|subscription|reinstall|ownership|lapsed|friction|kernel)\b/i.test(hook)) {
    score -= 18;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreCuriosity({ story = {}, script = "" } = {}) {
  let score = 35;
  const text = cleanText(script);
  if (/\b(?:catch|twist|kicker|trade[- ]off|risk|but|however|except|paid-access|paid access)\b/i.test(text)) {
    score += 30;
  }
  if (/\b(?:not full demand|before the standard launch|why|what matters|what this changes|if the wider launch)\b/i.test(text)) {
    score += 22;
  }
  if (/\b(?:only the opening beat|one high score can hide|steady spread|uncomfortable bit|where .* wins might not be|hype (?:either )?turns into trust|paywall confusion|final verdict|launch story)\b/i.test(text)) {
    score += 28;
  }
  if (/\b(?:if steam is where|if microsoft leans|different launch story|distribution story|game pass messaging)\b/i.test(text)) {
    score += 12;
  }
  if (/\b(?:free access|free go fest|raid timing|who gets access|paywall flex|comeback test|fair shot|paywall confusion)\b/i.test(text)) {
    score += 24;
  }
  if (/\b(?:subscription access|subscription libraries|waiting room|worth jumping back|waiting for GTA 6|reinstall|back catalogue|warm-up act|lapsed players|access, not ownership|not ownership)\b/i.test(text)) {
    score += 24;
  }
  if (/\b(?:save data|progress loss|save wipe|losing save|lost save|rare unlocks?|garage|tunes?)\b/i.test(text)) {
    score += 24;
  }
  if (/\b(?:cannot brick a PC|DMA cheat hardware|kernel-level anti-cheat|cheat devices versus normal PCs|hardware used to bypass anti-cheat|what Vanguard touches|PC damage)\b/i.test(text)) {
    score += 24;
  }
  if (hasDebateTrigger(text)) score += 18;
  if (hasRelatableStakes(text)) score += 14;
  if (hasStorySpecificPayoff(text)) score += 18;
  if (!hasDebateTrigger(text)) score -= 14;
  if (!hasStorySpecificPayoff(text)) score -= 18;
  if (producerScaffoldLanguage(text)) score -= 35;
  if (genericFallbackWatchlistLanguage(text)) score -= 45;
  if (reviewHoldFallbackLanguage(text)) score -= 55;
  if (htmlEntityInPublicScript(text)) score -= 35;
  if (vagueSourceAttribution(story, text)) score -= 28;
  if (ungroundedSpeculativeAttribution(text)) score -= 45;
  if (genericTitleTemplate(story)) score -= 20;
  if (genericCouldSplitTitleTemplate(story)) score -= 30;
  if (genericPlayerTestTemplate(text)) score -= 55;
  if (titleFragmentSubjectLanguage(text)) score -= 35;
  if (genericSimplePivot(text)) score -= 28;
  if (persuasiveAuthorityTropes(text)) score -= 32;
  if (sourceNeutralCatchTemplate(text)) score -= 46;
  if (repeatedCatchPivot(text)) score -= 26;
  if (sourceTitleRecitation(story, text)) score -= 34;
  if (abstractTitleTestHook(text)) score -= 25;
  if (vagueUpdateWithoutConcreteProof(text)) score -= 35;
  if (softPayoffLanguage(text)) score -= 24;
  if (boringRecap(text)) score -= 40;
  if (instructionLikeBuyerAdvice(text)) score -= 35;
  if (genericOpening(text)) score -= 12;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreInsight({ story, script }) {
  let score = 30;
  const claims = numericClaims(script);
  if (claims.length >= 2) score += 25;
  if (claims.length >= 3) score += 10;
  if (/\b(?:means|because|if|so|that makes|that gives|useful|takeaway)\b/i.test(script)) {
    score += 16;
  }
  if (/\b(?:early access|Premium Edition|standard launch|paid-access|paid access)\b/i.test(script)) {
    score += 16;
  }
  if (/\b(?:real gameplay|gameplay|combat|world|hands-on|trailer footage|shown|showed|revealed)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:players can|players now|judge|feels?|worth playing|player impact|what players can actually)\b/i.test(script)) {
    score += 10;
  }
  if (/\b(?:review score|reviews?|outlets?|one high score|steady spread|fence-sitters|final verdict|launch conversation|chart noise)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:deal|discount|dropped to|lists? .{0,40}\$|pickup point|listing holds|seller details|value)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:save data|progress loss|save wipe|losing save|lost save|garage|tunes?|rare unlocks?|patch stops the wipe)\b/i.test(script)) {
    score += 16;
  }
  if (/\b(?:job market|composer|resumes?|interview|talent squeeze|games people still recognise)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:mass effect|permadeath|turn-based tactics|crew pressure|grid battle)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:handmade|ai-looking|ai generated|stage was actually|intentional)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:leaked builds?|rough footage|official build|shape expectations|spreading before launch)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:release date|arcade racing|track identity|first lap|show speed)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:\$250 million bonus|bonus fight|business fight|payout fight|launch story)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:controller feel|console race|pad timing|instant dodges|playstation and xbox)\b/i.test(script)) {
    score += 14;
  }
  if (/\b(?:steam launch|xbox-on-steam|different launch story|game pass messaging|distribution story|store where .* wins)\b/i.test(script)) {
    score += 16;
  }
  if (/\b(?:go fest|free access|raid timing|niantic|paywall|free players|lapsed players|fair shot)\b/i.test(script)) {
    score += 18;
  }
  if (/\b(?:subscription access|subscription service|subscription libraries|lapsed players|access, not ownership|reinstall|GTA 6 waiting room|warm-up act|old back catalogue)\b/i.test(script)) {
    score += 20;
  }
  if (/\b(?:Vanguard|anti-cheat|DMA cheat hardware|kernel-level|cheat devices|normal PCs|cannot brick a PC|PC damage|hardware used to bypass anti-cheat)\b/i.test(script)) {
    score += 28;
  }
  if (hasDebateTrigger(script)) score += 12;
  if (hasRelatableStakes(script)) score += 12;
  if (hasStorySpecificPayoff(script)) score += 14;
  if (hasEarlyConcreteSourceDetail(script)) score += 10;
  const sourceName = cleanText(story.source_name);
  if (sourceNameAppearsInScript(sourceName, script)) {
    score += 8;
  }
  if (producerScaffoldLanguage(script)) score -= 25;
  if (genericFallbackWatchlistLanguage(script)) score -= 35;
  if (reviewHoldFallbackLanguage(script)) score -= 45;
  if (htmlEntityInPublicScript(script)) score -= 25;
  if (vagueSourceAttribution(story, script)) score -= 18;
  if (ungroundedSpeculativeAttribution(script)) score -= 35;
  if (genericTitleTemplate(story)) score -= 16;
  if (genericCouldSplitTitleTemplate(story)) score -= 24;
  if (genericPlayerTestTemplate(script)) score -= 48;
  if (titleFragmentSubjectLanguage(script)) score -= 24;
  if (vagueUpdateWithoutConcreteProof(script)) score -= 30;
  if (persuasiveAuthorityTropes(script)) score -= 34;
  if (sourceNeutralCatchTemplate(script)) score -= 38;
  if (repeatedCatchPivot(script)) score -= 22;
  if (sourceTitleRecitation(story, script)) score -= 28;
  if (softPayoffLanguage(script)) score -= 20;
  if (!hasRelatableStakes(script)) score -= 12;
  if (!hasStorySpecificPayoff(script)) score -= 14;
  if (boringRecap(script)) score -= 25;
  if (instructionLikeBuyerAdvice(script)) score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreSourceSafety({ story, script, coherence }) {
  let score = 86;
  const sourceName = cleanText(story.source_name);
  if (sourceName && !sourceNameAppearsInScript(sourceName, script)) score -= 18;
  if (/\baccording to sources\b|\bverified insider\b|\bredditor says\b/i.test(script)) {
    score -= 38;
  }
  if (vagueSourceAttribution(story, script)) score -= 28;
  if (ungroundedSpeculativeAttribution(script)) score -= 44;
  if (htmlEntityInPublicScript(script)) score -= 18;
  if (asArray(coherence.failures).length) score -= 35;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreRetentionPacing(script = "") {
  const allSentences = sentences(script);
  let score = 75;
  const hookWords = countWords(allSentences[0] || "");
  const firstTwo = allSentences.slice(0, 2).join(" ");
  if (hookWords > 16) score -= 16;
  if (/\b\d{1,3}(?:,\d{3})+|\$\d+/.test(firstTwo)) score += 11;
  if (allSentences.length >= 5) score += 7;
  if (ctaCount(script) !== 1) score -= 16;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function weightedScore(scores) {
  return Math.round(
    scores.hook_strength * 0.24 +
      scores.curiosity_gap * 0.19 +
      scores.insight_density * 0.22 +
      scores.source_safety * 0.18 +
      scores.retention_pacing * 0.17,
  );
}

function buildBlockers({ story, script, lint, coherence }) {
  const blockers = [];
  if (repeatsHeadlineHook(story, script)) blockers.push("weak_hook_repeats_headline");
  if (genericOpening(script)) blockers.push("generic_opener");
  const exactCtaCount = ctaCount(script);
  if (exactCtaCount === 0) blockers.push("missing_exact_cta");
  else if (exactCtaCount > 1) blockers.push("duplicated_cta");
  if (boringRecap(script)) blockers.push("boring_recap_language");
  if (instructionLikeBuyerAdvice(script)) blockers.push("instruction_like_buyer_advice");
  if (formulaicNotJustHook(script)) blockers.push("formulaic_not_just_hook");
  if (producerScaffoldLanguage(script)) blockers.push("producer_scaffold_language");
  if (genericFallbackWatchlistLanguage(script)) blockers.push("generic_fallback_watchlist_language");
  if (reviewHoldFallbackLanguage(script)) blockers.push("review_hold_fallback_language");
  if (htmlEntityInPublicScript(script)) blockers.push("html_entity_in_public_script");
  if (vagueSourceAttribution(story, script)) blockers.push("vague_source_attribution");
  if (ungroundedSpeculativeAttribution(script)) blockers.push("ungrounded_speculative_attribution");
  if (genericTitleTemplate(story)) blockers.push("generic_title_template");
  if (genericCouldSplitTitleTemplate(story)) blockers.push("generic_could_split_title_template");
  if (genericPlayerTestTemplate(script)) blockers.push("generic_player_test_template");
  if (titleFragmentSubjectLanguage(script)) blockers.push("title_fragment_subject_language");
  if (genericSimplePivot(script)) blockers.push("generic_catch_is_simple");
  if (persuasiveAuthorityTropes(script)) blockers.push("persuasive_authority_trope");
  if (sourceNeutralCatchTemplate(script)) blockers.push("source_neutral_catch_template");
  if (repeatedCatchPivot(script)) blockers.push("repeated_catch_pivot");
  if (sourceTitleRecitation(story, script)) blockers.push("source_title_recitation");
  if (abstractTitleTestHook(script)) blockers.push("abstract_title_test_hook");
  if (vagueUpdateWithoutConcreteProof(script)) blockers.push("vague_update_without_concrete_proof");
  if (missingEarlyConcreteSourceDetail(story, script)) blockers.push("missing_early_concrete_source_detail");
  if (!hasDebateTrigger(script)) blockers.push("missing_debate_trigger");
  if (!hasRelatableStakes(script)) blockers.push("missing_relatable_stakes");
  if (!hasStorySpecificPayoff(script)) blockers.push("missing_story_specific_payoff");
  if (softPayoffLanguage(script)) blockers.push("soft_payoff_language");
  if (badNumericSpellouts(script).length) blockers.push("bad_numeric_spellout");
  if (malformedSourceAttribution(script)) blockers.push("malformed_source_attribution");
  if (duplicatedSourceAttribution(story, script)) blockers.push("duplicated_source_attribution");
  for (const failure of asArray(lint.failures)) {
    if (/boring_source_bound_recap/.test(failure) && !blockers.includes("boring_recap_language")) {
      blockers.push("boring_recap_language");
    }
    if (/generic_opener/.test(failure) && !blockers.includes("generic_opener")) {
      blockers.push("generic_opener");
    }
    if (/repeated_phrase/.test(failure) && !blockers.includes("repeated_phrase")) {
      blockers.push("repeated_phrase");
    }
    if (/generic_reveal_catch_template/.test(failure) && !blockers.includes("generic_reveal_catch_template")) {
      blockers.push("generic_reveal_catch_template");
    }
  }
  for (const failure of asArray(coherence.failures)) {
    if (/repeated_sentence/.test(failure) && !blockers.includes("repeated_sentence")) {
      blockers.push("repeated_sentence");
    }
    if (/repeated_numeric_claim/.test(failure) && !blockers.includes("repeated_numeric_claim")) {
      blockers.push("repeated_numeric_claim");
    }
    if (
      /(?:vague_filler:internal_audience_scaffold|vague_filler:internal_tracking_language|vague_filler:public_narration_meta_language|vague_filler:producer_scaffold_language|generic_uncertainty_boilerplate|internal_pulse_framing|abstract_signal_language)/.test(failure) &&
      !blockers.includes("internal_audience_scaffold")
    ) {
      blockers.push("internal_audience_scaffold");
    }
    if (
      /vague_filler:producer_scaffold_language/.test(failure) &&
      !blockers.includes("producer_scaffold_language")
    ) {
      blockers.push("producer_scaffold_language");
    }
  }
  return blockers;
}

function storyLooksLikeForzaSteam(story = {}, script = "") {
  return /\bforza horizon 6\b/i.test(`${story.title || ""} ${script}`) &&
    /\b(?:steam|steamdb|concurrent)\b/i.test(`${story.title || ""} ${script}`);
}

function buildRecommendations({ story, script, blockers }) {
  const recommendations = [];
  const directives = [];
  const forzaSteam = storyLooksLikeForzaSteam(story, script);

  if (blockers.includes("weak_hook_repeats_headline") || blockers.includes("generic_opener")) {
    recommendations.push(
      "Open on the paid-access contradiction, not the headline repeat.",
    );
    directives.push(
      "Open on a sharp contradiction: critics loved it, but the Steam spike came from people paying early.",
    );
  }

  if (forzaSteam) {
    recommendations.push(
      "Make the Steam number useful: frame it as paid early demand, not proof of total launch demand.",
    );
    directives.push(
      "Keep 178,009 as digits and make it the first concrete number the viewer sees.",
    );
    directives.push(
      "If the source supports it, keep $120 as '$120', not '120 dollars'.",
    );
  }

  if (blockers.includes("boring_recap_language")) {
    recommendations.push(
      "Replace recap phrasing with a take: why the number matters and what could make it misleading.",
    );
    directives.push(
      "Remove recap lines like 'source-backed update', 'clean read' and 'broader launch data'.",
    );
  }

  if (blockers.includes("instruction_like_buyer_advice")) {
    recommendations.push(
      "Replace buyer checklist narration with the story consequence, the proof beat and why players should care now.",
    );
    directives.push(
      "Do not say 'the player angle is simple' or tell viewers to check price/access/platform details as the main payoff.",
    );
  }

  if (blockers.includes("formulaic_not_just_hook")) {
    recommendations.push(
      "Open with the specific consequence, leak, date, price, score or playable change instead of a 'not just' setup.",
    );
    directives.push(
      "Replace the first line with a named-subject consequence hook that can stand alone in the first second.",
    );
  }

  if (blockers.includes("producer_scaffold_language") || blockers.includes("internal_audience_scaffold")) {
    recommendations.push(
      "Remove producer-note phrasing and make the line sound like a viewer-facing consequence.",
    );
    directives.push(
      "Do not narrate labels for the hook, signal, angle or audience reaction; write the actual consequence instead.",
    );
  }

  if (blockers.includes("generic_fallback_watchlist_language")) {
    recommendations.push(
      "Replace generic fallback phrasing with a source-specific player consequence, or keep the story held for review.",
    );
    directives.push(
      "Do not use stock lines like 'player-facing detail worth watching', 'important bit is whether' or 'gap to watch now'.",
    );
  }

  if (blockers.includes("generic_player_test_template")) {
    recommendations.push(
      "Replace stock player-test narration with the specific mechanic, date, footage beat, price, platform consequence or fan argument from the source.",
    );
    directives.push(
      "Do not publish fallback lines about what players install, wishlist, finish or ignore; name the exact choice this story changes.",
    );
  }

  if (blockers.includes("generic_could_split_title_template")) {
    recommendations.push(
      "Replace 'Why X could split players' with a named consequence title tied to the actual source fact.",
    );
    directives.push(
      "Do not use 'Could Split Players' as a public title template; use the story's concrete risk, proof, date, score, price or gameplay hook.",
    );
  }

  if (blockers.includes("review_hold_fallback_language")) {
    recommendations.push(
      "Do not publish review-hold fallback copy; rewrite from source facts or keep the candidate blocked.",
    );
    directives.push(
      "Review-hold language is allowed only as a blocker signal, never as final narration.",
    );
  }

  if (blockers.includes("html_entity_in_public_script")) {
    recommendations.push(
      "Decode HTML entities before script scoring; public narration must say plain words, not feed markup.",
    );
    directives.push(
      "Replace entities such as '&amp;' and '&#8217;' with normal readable punctuation before TTS.",
    );
  }

  if (blockers.includes("vague_source_attribution")) {
    recommendations.push(
      "Replace platform/source placeholders with the actual publisher, outlet, studio or official channel.",
    );
    directives.push(
      "Do not say 'YouTube says' or 'Reddit says'; name the official channel, outlet or keep the story held.",
    );
  }

  if (blockers.includes("ungrounded_speculative_attribution")) {
    recommendations.push(
      "Remove 'sources suggest' phrasing unless the story is explicitly labelled and packaged as a rumour lane.",
    );
    directives.push(
      "Do not publish speculative source phrasing as fact; either cite a named outlet or hold the story.",
    );
  }

  if (blockers.includes("generic_title_template")) {
    recommendations.push(
      "Replace generated title templates with a specific subject, action and consequence.",
    );
    directives.push(
      "Do not use titles ending 'Just Got A New Signal', 'Changed The Watchlist' or 'New Reason To Watch'.",
    );
  }

  if (blockers.includes("title_fragment_subject_language")) {
    recommendations.push(
      "Replace article-description fragments with the actual game, studio, platform or named subject before narration.",
    );
    directives.push(
      "Do not open a script with feed fragments like 'game where...' or 'everything we know about...'. Find the named subject or hold it.",
    );
  }

  if (blockers.includes("generic_catch_is_simple")) {
    recommendations.push(
      "Replace stock pivot lines like 'The catch is simple' with the actual contradiction or player split.",
    );
    directives.push(
      "Do not use 'The catch is simple' or 'The debate is simple'; write the concrete tension directly.",
    );
  }

  if (blockers.includes("persuasive_authority_trope")) {
    recommendations.push(
      "Replace fake authority framing with a concrete consequence, proof beat or player split.",
    );
    directives.push(
      "Do not use 'the real question is', 'at its core' or 'what really matters'; state the specific player consequence directly.",
    );
  }

  if (blockers.includes("source_neutral_catch_template")) {
    recommendations.push(
      "Replace catch-all template language with the one fact that only this story can say.",
    );
    directives.push(
      "Do not say 'concrete next step', 'vague update' or generic timing/access/trust pivots unless the exact source fact immediately proves it.",
    );
  }

  if (blockers.includes("repeated_catch_pivot")) {
    recommendations.push(
      "Use one tension pivot at most, then move into proof and payoff instead of repeating 'the catch is'.",
    );
    directives.push(
      "Do not use 'the catch is' more than once in a script.",
    );
  }

  if (blockers.includes("source_title_recitation")) {
    recommendations.push(
      "Paraphrase the source evidence into a spoken fact; do not read the article headline or parenthetical score label aloud.",
    );
    directives.push(
      "Replace raw lines like '<Outlet> reports <headline>' with the actual reported fact in natural narration.",
    );
  }

  if (blockers.includes("abstract_title_test_hook")) {
    recommendations.push(
      "Open on the named playable thing or player consequence instead of an abstract 'test' setup.",
    );
    directives.push(
      "The hook must name the concrete mission, feature, price, date, footage or platform consequence in plain language.",
    );
  }

  if (blockers.includes("missing_early_concrete_source_detail")) {
    recommendations.push(
      "Move concrete source details before release dates and platform logistics.",
    );
    directives.push(
      "Before date/platform lists, include one tangible gameplay or source detail: combat, vehicles, co-op, mission structure, camera feel, enemies, level design or hands-on change.",
    );
  }

  if (blockers.includes("vague_update_without_concrete_proof")) {
    recommendations.push(
      "Replace vague update wording with the specific player-visible change from the source.",
    );
    directives.push(
      "Do not say 'major update', 'last chance' or 'coming later this month' unless the script also names the exact feature, mode, date, mechanic, platform change or playable proof.",
    );
  }

  if (blockers.includes("missing_debate_trigger")) {
    recommendations.push(
      "Add a real tension point: who benefits, who loses, what trade-off matters or what players will argue about after watching.",
    );
    directives.push(
      "Include one source-safe debate beat built around a trade-off, risk, split audience or platform consequence.",
    );
  }

  if (blockers.includes("missing_relatable_stakes")) {
    recommendations.push(
      "Name the player, fan, buyer, subscriber, platform or studio consequence instead of leaving the update abstract.",
    );
    directives.push(
      "Make the middle answer how this changes a player choice: buy, wait, reinstall, trust, skip or argue.",
    );
  }

  if (blockers.includes("missing_story_specific_payoff")) {
    recommendations.push(
      "End with a story-specific payoff before the CTA, not a generic watchlist or listing reminder.",
    );
    directives.push(
      "The final non-CTA sentence must land a clear consequence beginning from the actual source facts.",
    );
  }

  if (blockers.includes("soft_payoff_language")) {
    recommendations.push(
      "Replace soft payoff wording with a concrete consequence viewers can argue about.",
    );
    directives.push(
      "The final non-CTA sentence should land a sharp consequence, for example a trust problem, player split, launch risk, buying decision or platform consequence.",
    );
  }

  if (blockers.includes("duplicated_cta") || ctaCount(script) !== 1) {
    recommendations.push("Use the Pulse CTA once, only at the end.");
    directives.push("CTA once: 'Follow Pulse Gaming so you never miss a beat.'");
  }

  if (!recommendations.length) {
    recommendations.push(
      "Keep the current angle: source first, number early, caveat before the payoff.",
    );
  }

  return {
    rewrite_recommendations: [...new Set(recommendations)],
    prompt_directives: [...new Set(directives)],
  };
}

function buildViralScriptIntelligence({ story = {}, script = "" } = {}) {
  const cleanScript = cleanText(script);
  const lint = lintScript(cleanScript, { minWords: 35, maxWords: 240 });
  const coherence = runScriptCoherenceQa(
    {
      ...story,
      hook: firstSentence(cleanScript),
      full_script: cleanScript,
      cta: EXACT_CTA,
    },
    { requireCtaField: true, requireFullScriptCta: false },
  );
  const scores = {
    hook_strength: scoreHook({ story, script: cleanScript }),
    curiosity_gap: scoreCuriosity({ story, script: cleanScript }),
    insight_density: scoreInsight({ story, script: cleanScript }),
    source_safety: scoreSourceSafety({ story, script: cleanScript, coherence }),
    retention_pacing: scoreRetentionPacing(cleanScript),
  };
  const blockers = buildBlockers({ story, script: cleanScript, lint, coherence });
  const viralScore = weightedScore(scores);
  const recommendationPack = buildRecommendations({
    story,
    script: cleanScript,
    blockers,
  });

  return {
    schema_version: 1,
    execution_mode: "viral_script_intelligence_v1",
    story_id: story.id || null,
    verdict:
      blockers.length || viralScore < 75
        ? "rewrite_required"
        : viralScore >= 85
          ? "viral_ready"
          : "tighten_before_tts",
    viral_score: viralScore,
    scores,
    blockers,
    warnings: [...asArray(lint.warnings), ...asArray(coherence.warnings)],
    fact_lock: {
      numeric_claims: numericClaims(cleanScript),
      bad_numeric_spellouts: badNumericSpellouts(cleanScript),
      source_name: story.source_name || null,
    },
    cta: {
      exact: EXACT_CTA,
      count: ctaCount(cleanScript),
    },
    ...recommendationPack,
    safety: {
      local_only: true,
      analysis_only: true,
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
    },
  };
}

module.exports = {
  buildViralScriptIntelligence,
};
