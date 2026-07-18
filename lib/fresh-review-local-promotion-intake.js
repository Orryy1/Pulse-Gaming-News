"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { sourceNameFromUrl } = require("./source-bound-script-writer");
const {
  buildFreshReviewScriptRepairPlan,
  fetchFreshReviewScriptRepairRows,
} = require("./ops/fresh-review-script-repair");
const {
  parseArgs: parseReprocessArgs,
  reprocessCandidate,
} = require("../tools/reprocess-script-failures");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueClean(values = [], limit = 4) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function storyId(value = {}) {
  return cleanText(value.story_id || value.id);
}

function sourceUrl(value = {}) {
  return cleanText(
    value.primary_source_url ||
      value.article_url ||
      value.source_url ||
      value.url ||
      value.primary_source?.url,
  );
}

function isGenericSourceName(value) {
  return /^(?:source_manifest|canonical_story_manifest|manifest|unknown|rss|major_media_source)$/i.test(cleanText(value));
}

function sourceDisplayNameFromParts(parts = [], url = "") {
  const urlName = cleanText(sourceNameFromUrl(url));
  for (const part of parts) {
    const text = cleanText(part);
    if (!text || isGenericSourceName(text)) continue;
    if (urlName && text.toLowerCase() !== urlName.toLowerCase()) return urlName;
    return text;
  }
  return urlName;
}

function sourceName(value = {}) {
  const url = sourceUrl(value);
  return sourceDisplayNameFromParts(
    [
    value.primary_source?.name ||
      value.primary_source ||
      value.source_name ||
      value.source ||
      value.feed,
      value.primary_source?.type,
    ],
    url,
  );
}

function sourceType(value = {}) {
  return cleanText(value.primary_source?.type || value.source_type || "major_media_source");
}

function sourcePublishedAt(value = {}) {
  return cleanText(
    value.source_published_at ||
      value.published_at ||
      value.created_at ||
      value.timestamp ||
      value.scored_at,
  );
}

const GTA_VI_OFFICIAL_DIRECT_MEDIA_CANDIDATES = Object.freeze([
  {
    direct_media_url:
      "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
    label: "Official Cover Art Animation",
    source_family: "rockstar_gta_vi_cover_art_animation",
    source_type: "official_game_website_media_page",
    duration_s: 36,
    downloads_allowed: false,
  },
  {
    direct_media_url:
      "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
    label: "Grand Theft Auto VI Trailer 2",
    source_family: "rockstar_gta_vi_trailer_2",
    source_type: "official_game_website_media_page",
    downloads_allowed: false,
  },
  {
    direct_media_url:
      "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_1/GTAVI_Trailer_1.mp4",
    label: "Grand Theft Auto VI Trailer 1",
    source_family: "rockstar_gta_vi_trailer_1",
    source_type: "official_game_website_media_page",
    downloads_allowed: false,
  },
  {
    direct_media_url: "https://www.rockstargames.com/VI/_next/static/media/2160.06.kcaed--eoc.mp4",
    label: "Grand Theft Auto VI Official Site Motion",
    source_family: "rockstar_gta_vi_site_motion_lucia_neon",
    source_type: "official_game_website_media_page",
    duration_s: 11,
    downloads_allowed: false,
  },
]);

function isGtaViDraft(value = {}) {
  const evidence = [
    value.title,
    value.selected_title,
    value.source_title,
    value.article_title,
    value.original_source_title,
    value.canonical_subject,
    value.canonical_game,
    value.description,
    value.full_script,
    value.tts_script,
    value.narration_script,
    ...asArray(value.confirmed_claims),
  ].map(cleanText).filter(Boolean).join(" ");
  return /\b(?:GTA\s*(?:6|VI)|Grand Theft Auto VI)\b/i.test(evidence);
}

function knownCanonicalIdentity(value = {}) {
  const evidence = [
    value.title,
    value.selected_title,
    value.suggested_title,
    value.source_title,
    value.article_title,
    value.original_source_title,
    value.canonical_subject,
    value.canonical_game,
    value.description,
    value.full_script,
    value.tts_script,
    value.narration_script,
    ...asArray(value.confirmed_claims),
  ].map(cleanText).filter(Boolean).join(" ");
  if (/\b(?:MARVEL\s+T(?:o|ō|ō)kon|Fighting\s+Souls)\b/i.test(evidence)) return "MARVEL Tokon: Fighting Souls";
  if (/\bMARVEL['\u2019]?s\s+Wolverine\b/i.test(evidence)) return "Marvel's Wolverine";
  if (/\bLords\s+of\s+the\s+Fallen\s*2\b/i.test(evidence)) return "Lords of the Fallen 2";
  if (/\b(?:GTA\s*(?:6|VI)|Grand Theft Auto VI)\b/i.test(evidence)) return "Grand Theft Auto VI";
  if (/\bCall\s+of\s+Duty:\s*Black\s+Ops\b/i.test(evidence) || /\bBlack\s+Ops\s+1\s+and\s+2\b/i.test(evidence)) {
    return "Call of Duty: Black Ops";
  }
  if (
    /\bXbox\b/i.test(evidence) &&
    /\b(?:exclusive\s+label|exclusivity|console\s+dashboard|dashboard\s+badge|Xbox\s+exclusive)\b/i.test(evidence)
  ) {
    return "Xbox";
  }
  return "";
}

function normaliseKnownCanonicalIdentity(draft = {}) {
  const identity = knownCanonicalIdentity(draft);
  if (!identity) return draft;
  return {
    ...draft,
    canonical_subject: identity,
    canonical_game: identity,
  };
}

function mergeDirectMediaCandidates(existing = [], additions = []) {
  const seen = new Set();
  const merged = [];
  for (const candidate of [...asArray(existing), ...asArray(additions)]) {
    const url = cleanText(
      candidate?.direct_media_url ||
        candidate?.direct_media_url_if_available ||
        candidate?.url ||
        candidate?.href ||
        candidate?.video_url,
    );
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      ...candidate,
      direct_media_url: url,
      direct_media_url_if_available: url,
    });
  }
  return merged;
}

function mediaCandidatesFromDirectMedia(candidates = []) {
  return asArray(candidates).map((candidate) => ({
    url: cleanText(candidate.direct_media_url || candidate.direct_media_url_if_available),
    title: cleanText(candidate.label || candidate.source_title || candidate.title),
    source_family: cleanText(candidate.source_family),
    source_type: cleanText(candidate.source_type || "official_direct_media"),
  })).filter((candidate) => candidate.url);
}

function enrichKnownOfficialDirectMedia(draft = {}) {
  const normalised = normaliseKnownCanonicalIdentity(draft);
  const canonical = cleanText(`${normalised.canonical_subject} ${normalised.canonical_game}`);
  if (!/\b(?:GTA\s*(?:6|VI)|Grand Theft Auto VI)\b/i.test(canonical)) return normalised;
  if (!isGtaViDraft(normalised)) return normalised;
  const directMediaCandidates = mergeDirectMediaCandidates(
    normalised.direct_media_candidates,
    GTA_VI_OFFICIAL_DIRECT_MEDIA_CANDIDATES,
  );
  return {
    ...normalised,
    direct_media_candidates: directMediaCandidates,
    media_candidates: mergeDirectMediaCandidates(
      normalised.media_candidates,
      mediaCandidatesFromDirectMedia(directMediaCandidates),
    ),
  };
}

function isMarvelTokonRosterDraft(value = {}) {
  const evidence = [
    value.title,
    value.selected_title,
    value.source_title,
    value.article_title,
    value.original_source_title,
    value.canonical_subject,
    value.canonical_game,
    value.description,
    value.full_script,
    value.tts_script,
    value.narration_script,
    ...asArray(value.confirmed_claims),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  return (
    /\bMARVEL\s+T(?:o|ō|ō)kon\b/i.test(evidence) &&
    /\b(?:Blade|Loki|Deadpool|roster|Fighting\s+Souls)\b/i.test(evidence)
  );
}

function repairKnownDraftCopy(draft = {}) {
  const normalised = enrichKnownOfficialDirectMedia(draft);
  if (!isMarvelTokonRosterDraft(normalised)) return normalised;
  const script = [
    "MARVEL Tokon Fighting Souls just gave fighting-game fans three reasons to argue before launch.",
    "GameSpot shows Blade, Loki and Deadpool in new gameplay for Arc System Works' 4v4 tag fighter, and the roster reveal is really a team-building test.",
    "Blade has to bring pressure.",
    "Loki has to bend reads.",
    "Deadpool has to create chaos without turning every match into visual noise.",
    "That matters on PlayStation 5 and PC because tag fighters rise or die on what the assists do after the trailer ends.",
    "That is why this reveal matters more in motion than as another roster poster.",
    "If these clips show real combo paths, players will be testing team plans before release.",
    "If they only show expensive super moves, the hype becomes famous skins with health bars.",
    "Watch the assists, not just the faces: this reveal either makes the whole game look deeper, or exposes the exact thing it still has to prove.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");
  return {
    ...normalised,
    title: "MARVEL Tokon Just Started A Roster Fight",
    selected_title: "MARVEL Tokon Just Started A Roster Fight",
    short_title: "MARVEL Tokon Just Started A Roster Fight",
    canonical_subject: "MARVEL Tokon: Fighting Souls",
    canonical_game: "MARVEL Tokon: Fighting Souls",
    thumbnail_headline: "TOKON ROSTER FIGHT",
    suggested_thumbnail_text: "TOKON ROSTER FIGHT",
    narration_script: script,
    full_script: script,
    tts_script: script,
    hook: firstSentence(script),
    body: script,
    description:
      "MARVEL Tokon Fighting Souls just gave fighting-game fans Blade, Loki and Deadpool footage to argue over, because this 4v4 roster reveal only lands if the assists look deeper than famous skins. Source: GameSpot.",
  };
}

function firstSentence(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return cleanText(match ? match[1] : text);
}

function thumbnailHeadline(value = {}) {
  return cleanText(
    value.suggested_thumbnail_text ||
      value.thumbnail_headline ||
      value.thumbnail_text ||
      value.short_title ||
      value.suggested_title ||
      value.title,
  )
    .replace(/[^\w\s:'-]/g, "")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ")
    .toUpperCase();
}

function thumbnailHeadlineForDraft(row = {}, title = "") {
  const headline = thumbnailHeadline(row);
  const titleText = cleanText(title);
  if (/^GTA\b/i.test(headline) && titleText && !/^(?:GTA|Grand Theft Auto)\b/i.test(titleText)) {
    return thumbnailHeadline({ title: titleText });
  }
  return headline;
}

function confirmedClaims(value = {}) {
  const claims = [
    ...asArray(value.confirmed_claims),
    value.source_title,
    value.article_title,
    value.description,
    value.summary,
  ]
    .map(cleanText)
    .filter(Boolean);
  if (claims.length) return Array.from(new Set(claims)).slice(0, 4);

  const source = sourceName(value);
  const title = cleanText(value.title || value.suggested_title);
  return title ? [`${source || "The source"} reports ${title}.`] : [];
}

function qualityFailuresForDraft(draft = {}) {
  const title = cleanText(draft.selected_title || draft.title);
  const script = cleanText(draft.full_script || draft.tts_script || draft.narration_script);
  const subject = cleanText(draft.canonical_subject || draft.canonical_game);
  const sourceEvidence = [
    draft.source_title,
    draft.article_title,
    draft.original_source_title,
    title,
    subject,
    ...asArray(draft.confirmed_claims),
    draft.description,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  const sourceOnlyEvidence = [
    draft.source_title,
    draft.article_title,
    draft.original_source_title,
    draft.description,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  const failures = [];
  if (!title || !script) failures.push("local_intake:title_or_script_missing");
  if (/\bplayer impact\b/i.test(title)) failures.push("local_intake:generic_player_impact_title");
  if (
    /\bnow has one concrete player question\b/i.test(script) ||
    /\bjust got an update that changes the player decision\b/i.test(script) ||
    /\bhas one detail worth checking before it becomes background noise\b/i.test(script) ||
    /\b(?:Needs|Needs One|Has One)\s+Real\s+Proof\s+Point\b/i.test(title) ||
    /\bnew .{0,80} detail around access,\s*timing,\s*performance or expectations\b/i.test(script) ||
    /\bwhether it changes timing,\s*access,\s*price,\s*performance or actual footage\b/i.test(script) ||
    /\bUse this as a watch signal,\s*not a verdict\b/i.test(script) ||
    /\bThe first check is whether this changes what people install,\s*buy,\s*wishlist or ignore\b/i.test(script) ||
    /\bA stronger follow-up should show the change plainly instead of explaining around it\b/i.test(script) ||
    /\b(?:the point is what this changes before players spend money,\s*storage or time|decision pressure this adds today|without pretending every missing detail is solved)\b/i.test(script)
  ) {
    failures.push("local_intake:generic_player_question_script");
  }
  if (/\bfresh .{0,80} update with a detail that could change timing, access or expectations\b/i.test(script)) {
    failures.push("local_intake:generic_update_scaffold_script");
  }
  if (
    /\b(?:the next thing to watch is whether the official follow-up gives players a clear date, platform detail or gameplay proof|that is where a small update either becomes (?:a real player decision|useful)|a sharper follow-up should answer the player question directly)\b/i.test(script)
  ) {
    failures.push("local_intake:generic_follow_up_scaffold_script");
  }
  if (
    /\bfor viewers,\s*the immediate value is knowing whether this affects\b/i.test(script) ||
    /\bthe story does not need fake drama;\s*it needs the player consequence to land clearly\b/i.test(script) ||
    /\bif later footage,\s*pricing or timing changes the picture,\s*that becomes a new story\b/i.test(script)
  ) {
    failures.push("local_intake:generic_value_scaffold_script");
  }
  const horrorStory =
    /\b(?:horror|survival[-\s]?horror|resident evil|silent hill|hellraiser|pinhead|alien isolation|paranormal activity|little nightmares|reanimal|end of abyss|ghost at dawn|alan wake|dying light)\b/i.test(sourceEvidence);
  if (
    !horrorStory &&
    /\b(?:horror reveal|licensed horror game|horror fans|jump[-\s]?scares?|survival[-\s]?horror|puzzle box|labyrinth tension)\b/i.test(script)
  ) {
    failures.push("local_intake:semantic_contamination_horror_angle");
  }
  if (/\b(?:best deals today|today'?s top deals|airpods|gift cards?)\b/i.test(`${title} ${script}`)) {
    failures.push("local_intake:commerce_deals_roundup_not_editorial_story");
  }
  const sourceIsGtaTrailerTiming =
    /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(sourceOnlyEvidence) &&
    /\b(?:trailer\s*3|don'?t expect|do not expect|precedent|this week|trailer cadence)\b/i.test(sourceOnlyEvidence) &&
    !/\b(?:pre[-\s]?order|edition|ultimate edition|standard edition|price|pricing|store page|cover art|key art)\b/i.test(sourceOnlyEvidence);
  const publicText = `${title} ${script}`;
  const publicIntroducesGtaPreorderOrArt =
    /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(publicText) &&
    /\b(?:pre[-\s]?order|store page|cover art|key art|edition|pricing|price)\b/i.test(publicText);
  if (sourceIsGtaTrailerTiming && publicIntroducesGtaPreorderOrArt) {
    failures.push("local_intake:source_script_mismatch_gta_preorder_vs_trailer_timing");
  }
  const sourceIsOblivionPhysicalPreorder =
    /\b(?:Elder\s+Scrolls|Oblivion\s+Remastered|Oblivion)\b/i.test(sourceOnlyEvidence) &&
    /\b(?:physical|cartridge|pre[-\s]?order|where\s+you\s+can\s+preorder|Switch\s*2)\b/i.test(sourceOnlyEvidence);
  const publicDriftsToRockstarDateConfidence =
    /\b(?:Rockstar|GTA\s*(?:6|VI)|Grand Theft Auto VI|date confidence|release date .*trust check|release timing has been reiterated)\b/i.test(publicText) &&
    !/\b(?:Elder\s+Scrolls|Oblivion\s+Remastered|Oblivion)\b/i.test(publicText);
  if (sourceIsOblivionPhysicalPreorder && publicDriftsToRockstarDateConfidence) {
    failures.push("local_intake:source_script_mismatch_oblivion_preorder_vs_rockstar_date");
  }
  const sourceIsGtaContextOnly =
    /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(sourceOnlyEvidence) &&
    /\b(?:launching\s+in\s+GTA\s*6['’]?s\s+shadow|GTA\s*6['’]?s\s+shadow|doesn'?t\s+care\s+about\s+launching|different\s+game|another\s+game)\b/i.test(sourceOnlyEvidence) &&
    !/\b(?:pre[-\s]?order|edition|ultimate edition|standard edition|price|pricing|store page|cover art|key art|release timing has been reiterated|trailer\s*\d+|gameplay trailer)\b/i.test(sourceOnlyEvidence);
  const publicMakesGtaTheLeadStory =
    /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(publicText) &&
    /\b(?:date|release timing|pre[-\s]?order|store page|cover art|key art|edition|pricing|price|trailer|gameplay|Rockstar['’]?s next official beat)\b/i.test(publicText);
  if (sourceIsGtaContextOnly && publicMakesGtaTheLeadStory) {
    failures.push("local_intake:source_script_mismatch_gta_context_only");
  }
  if (subject.split(/\s+/).length > 8 && !/\b(?:Ocarina of Time|Cyberpunk 2077|Black Ops|Hellraiser|Xbox)\b/i.test(subject)) {
    failures.push("local_intake:canonical_subject_too_broad");
  }
  return failures;
}

function storyDraftFromReprocessedRow(row = {}, original = {}) {
  const id = storyId(row) || storyId(original);
  const url = sourceUrl(row) || sourceUrl(original);
  const source = sourceName(row) || sourceName(original);
  const script = cleanText(row.full_script || row.tts_script || row.narration_script);
  const title = cleanText(row.suggested_title || row.public_title || row.title || original.title);
  const thumbnail = thumbnailHeadlineForDraft(row, title);
  const originalSourceTitle = cleanText(original.source_title || original.article_title || original.title);
  const repairedSourceTitle = cleanText(row.source_title || row.article_title);
  const claims = uniqueClean([
    ...confirmedClaims(original),
    ...confirmedClaims(row),
  ]);
  return repairKnownDraftCopy({
    id,
    title,
    selected_title: cleanText(row.suggested_title || row.selected_title || title),
    source_title: repairedSourceTitle || originalSourceTitle,
    article_title: cleanText(row.article_title || original.article_title || originalSourceTitle),
    original_source_title: originalSourceTitle,
    canonical_subject: cleanText(row.canonical_subject || row.canonical_game || row.short_title || title),
    canonical_game: cleanText(row.canonical_game || row.canonical_subject || row.short_title || title),
    primary_source: {
      name: source,
      url,
      type: sourceType(row) || sourceType(original),
    },
    primary_source_url: url,
    source_url: url,
    article_url: url,
    url,
    source_name: source,
    source_type: sourceType(row) || sourceType(original),
    source_published_at: sourcePublishedAt(row) || sourcePublishedAt(original),
    source_confidence_score: Number(row.source_confidence_score || original.source_confidence_score || 90),
    confirmed_claims: claims.length ? claims : confirmedClaims(row).length ? confirmedClaims(row) : confirmedClaims(original),
    unconfirmed_claims: asArray(row.unconfirmed_claims || original.unconfirmed_claims),
    prohibited_claims: asArray(row.prohibited_claims || original.prohibited_claims),
    thumbnail_headline: thumbnail,
    suggested_thumbnail_text: thumbnail,
    narration_script: script,
    full_script: script,
    tts_script: script,
    hook: firstSentence(script),
    body: script,
    description: cleanText(row.description || original.description || firstSentence(script)),
    pinned_comment: source ? `Source: ${source}.` : "",
    script_generation_status: cleanText(row.script_generation_status),
    local_promotion_intake_only: true,
  });
}

function selectedRowsFromPlan(rows = [], plan = {}) {
  const selectedIds = new Set(
    asArray(plan.source_bound_rewrite_work_orders).map((item) => cleanText(item.story_id)).filter(Boolean),
  );
  return asArray(rows).filter((row) => selectedIds.has(storyId(row)));
}

function directMediaCandidatesFromScorecard(scorecard = {}) {
  const fromExplicit = asArray(scorecard.direct_media_candidates);
  if (fromExplicit.length) return mergeDirectMediaCandidates([], fromExplicit);
  const clips = asArray(scorecard.motion_capacity?.clips || scorecard.motion_clips);
  return mergeDirectMediaCandidates(
    [],
    clips.map((clip) => ({
      direct_media_url: cleanText(clip.source_url || clip.url || clip.path),
      label: cleanText(clip.label || clip.title || clip.source_title || clip.source_family || clip.id),
      source_family: cleanText(clip.source_family || clip.motion_family || clip.family),
      source_type: cleanText(clip.source_type || clip.media_kind || "official_direct_motion"),
    })),
  );
}

function motionScorecardIsPromotable(scorecard = {}, { maxAgeHours = 7 * 24 } = {}) {
  const motion = scorecard.motion_capacity || {};
  const reasons = asArray(scorecard.repeat_or_stale_risk_reasons).map((reason) => cleanText(reason).toLowerCase());
  const allowedReasons = new Set(["not_scheduler_candidate", "publish_ready_false"]);
  const disallowed = reasons.filter((reason) => reason && !allowedReasons.has(reason));
  const age = Number(scorecard.age_hours ?? scorecard.source_age_hours);
  return (
    cleanText(scorecard.story_id || scorecard.id) &&
    cleanText(scorecard.title) &&
    cleanText(scorecard.source_url || scorecard.primary_source?.url) &&
    cleanText(scorecard.source_published_at || scorecard.primary_source?.published_at) &&
    scorecard.source === "motion_capacity_report" &&
    scorecard.source_safe === true &&
    ["fresh", "expiring_within_24h"].includes(cleanText(scorecard.source_age_state)) &&
    Number.isFinite(age) &&
    age <= Number(maxAgeHours || 7 * 24) &&
    motion.motion_ready === true &&
    motion.operator_required !== true &&
    disallowed.length === 0
  );
}

function storyDraftFromMotionScorecard(scorecard = {}) {
  const id = cleanText(scorecard.story_id || scorecard.id);
  const url = cleanText(scorecard.source_url || scorecard.primary_source?.url);
  const source = sourceDisplayNameFromParts(
    [
      scorecard.source_name,
      scorecard.primary_source?.name,
      scorecard.source_manifest?.primary_source?.name,
      scorecard.source_manifest?.source_name,
      scorecard.source_manifest?.source,
      scorecard.primary_source?.type,
      scorecard.source_manifest?.primary_source?.type,
    ],
    url,
  );
  const publishedAt = cleanText(scorecard.source_published_at || scorecard.primary_source?.published_at);
  const title = cleanText(scorecard.selected_title || scorecard.title);
  const canonical = cleanText(scorecard.canonical_subject || scorecard.canonical_game || title);
  const claims = uniqueClean([
    ...asArray(scorecard.confirmed_claims),
    scorecard.source_title,
    scorecard.article_title,
    scorecard.description,
    title ? `${source} reports ${title}.` : "",
  ]);
  return repairKnownDraftCopy({
    id,
    title,
    selected_title: title,
    source_title: cleanText(scorecard.source_title || scorecard.article_title || title),
    article_title: cleanText(scorecard.article_title || scorecard.source_title || title),
    original_source_title: cleanText(scorecard.source_title || scorecard.article_title || title),
    canonical_subject: canonical,
    canonical_game: cleanText(scorecard.canonical_game || canonical),
    primary_source: {
      name: source,
      url,
      type: cleanText(scorecard.primary_source?.type || scorecard.source_type || "rss"),
      published_at: publishedAt,
    },
    primary_source_url: url,
    source_url: url,
    article_url: url,
    url,
    source_name: source,
    source_type: cleanText(scorecard.primary_source?.type || scorecard.source_type || "rss"),
    source_published_at: publishedAt,
    source_confidence_score: Number(scorecard.source_confidence_score || 90),
    confirmed_claims: claims,
    thumbnail_headline: thumbnailHeadlineForDraft(scorecard, title),
    suggested_thumbnail_text: thumbnailHeadlineForDraft(scorecard, title),
    direct_media_candidates: directMediaCandidatesFromScorecard(scorecard),
    media_candidates: mediaCandidatesFromDirectMedia(directMediaCandidatesFromScorecard(scorecard)),
    narration_script: "",
    full_script: "",
    tts_script: "",
    hook: "",
    body: "",
    description: cleanText(scorecard.description || claims[0] || title),
    pinned_comment: source ? `Source: ${source}.` : "",
    script_source: "motion_capacity_source_hydrated",
    local_promotion_intake_only: true,
    motion_capacity_intake_only: true,
  });
}

function dedupeMotionScorecards(scorecards = []) {
  const seen = new Set();
  const output = [];
  for (const scorecard of asArray(scorecards)) {
    const sourceUrlKey = cleanText([
      scorecard.canonical_subject || scorecard.canonical_game || scorecard.title,
      scorecard.source_url || scorecard.primary_source?.url,
    ].join(" | ")).toLowerCase();
    const topicKey = cleanText(scorecard.canonical_subject || scorecard.canonical_game || scorecard.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(?:the|a|an|has|have|gets|got|just|new|huge|with|and|to|for|of|is|are)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const keys = [sourceUrlKey, topicKey ? `topic:${topicKey}` : ""].filter(Boolean);
    const urlKey = cleanText(scorecard.source_url || scorecard.primary_source?.url).toLowerCase();
    if (urlKey) keys.push(`url:${urlKey}`);
    if (!keys.length || keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    output.push(scorecard);
  }
  return output;
}

async function buildFreshReviewLocalPromotionIntake({
  rows = null,
  plan = null,
  motionScorecards = null,
  limit = 6,
  maxAgeHours = 7 * 24,
  minScore = 65,
  now = new Date(),
  reprocessCandidateImpl = reprocessCandidate,
} = {}) {
  const selectedAt = now instanceof Date ? now : new Date(now);
  const sourceRows = rows || fetchFreshReviewScriptRepairRows({
    now: selectedAt,
    maxAgeHours,
    limit: Math.max(40, Number(limit || 6) * 10),
  });
  const repairPlan = plan || buildFreshReviewScriptRepairPlan({
    rows: sourceRows,
    now: selectedAt,
    maxAgeHours,
    minScore,
    limit,
  });
  const selected = selectedRowsFromPlan(sourceRows, repairPlan);
  const reprocessArgs = parseReprocessArgs(["--source-bound-only", "--dry-run"]);
  const drafts = [];
  const repairResults = [];
  for (const row of selected) {
    const results = await reprocessCandidateImpl(row, reprocessArgs);
    const first = asArray(results)[0] || {};
    repairResults.push({
      story_id: storyId(row),
      title: cleanText(row.title),
      script_generation_status: cleanText(first.script_generation_status),
      output_story_ready: cleanText(first.script_generation_status) === "script_ready",
      script_review_reason: cleanText(first.script_review_reason),
    });
    if (cleanText(first.script_generation_status) !== "script_ready") continue;
    const draft = storyDraftFromReprocessedRow(first, row);
    const qualityFailures = qualityFailuresForDraft(draft);
    if (qualityFailures.length > 0) {
      repairResults[repairResults.length - 1].output_story_ready = false;
      repairResults[repairResults.length - 1].quality_failures = qualityFailures;
      continue;
    }
    drafts.push(draft);
  }
  const selectedMotionScorecards = drafts.length > 0
    ? []
    : dedupeMotionScorecards(motionScorecards)
        .filter((scorecard) => motionScorecardIsPromotable(scorecard, { maxAgeHours }))
        .slice(0, Number(limit || 6));
  for (const scorecard of selectedMotionScorecards) {
    const draft = storyDraftFromMotionScorecard(scorecard);
    drafts.push(draft);
    repairResults.push({
      story_id: draft.id,
      title: draft.title,
      source: "motion_capacity_scorecard",
      script_generation_status: "ready_for_source_bound_local_promotion",
      output_story_ready: true,
      script_review_reason: "motion_ready_source_scorecard_promoted_for_local_script_generation",
    });
  }
  return {
    schema_version: 1,
    mode: "FRESH_REVIEW_LOCAL_PROMOTION_INTAKE",
    generated_at: selectedAt.toISOString(),
    summary: {
      rows_seen: asArray(sourceRows).length,
      motion_scorecards_seen: asArray(motionScorecards).length,
      motion_scorecard_promotion_count: selectedMotionScorecards.length,
      repair_plan_selected_count: repairPlan.summary?.selected_count || 0,
      local_promotion_story_count: drafts.length,
      production_db_mutation_required: false,
    },
    fresh_source_intake_stories: drafts,
    repair_results: repairResults,
    next_action:
      drafts.length > 0
        ? "run_fresh_green_buffer_local_promotion_then_render_audio_and_preflight"
        : "refresh_source_backed_story_supply_before_local_promotion",
    safety: {
      no_publish_triggered: true,
      no_network_uploads_started: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_platform_setting_change: true,
      disabled_platforms_enabled: false,
      gates_weakened: false,
    },
  };
}

async function writeFreshReviewLocalPromotionIntake(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeFreshReviewLocalPromotionIntake requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "fresh_review_local_promotion_intake_report.json");
  const storiesPath = path.join(outDir, "fresh_source_intake_stories.json");
  await Promise.all([
    fs.writeJson(reportPath, report, { spaces: 2 }),
    fs.writeJson(storiesPath, report.fresh_source_intake_stories || [], { spaces: 2 }),
  ]);
  return { reportPath, storiesPath };
}

module.exports = {
  buildFreshReviewLocalPromotionIntake,
  enrichKnownOfficialDirectMedia,
  qualityFailuresForDraft,
  storyDraftFromReprocessedRow,
  writeFreshReviewLocalPromotionIntake,
};
