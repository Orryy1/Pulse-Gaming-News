"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { inferHeadlineGameCandidates } = require("./game-title-inference");
const { buildSourceBoundFallbackScript } = require("./source-bound-script-writer");
const { EXACT_CTA, runScriptCoherenceQa } = require("./script-coherence-qa");
const { countSpokenWords } = require("./services/short-runtime-planner");
const mediaPaths = require("./media-paths");
const {
  buildGoalRenderInputWorkOrder,
  writeGoalRenderInputWorkOrder,
} = require("./goal-render-input-workorder");
const {
  applyGamingPronunciation,
  TTS_PRONUNCIATION_PROFILE_VERSION,
} = require("./tts-pronunciation");
const { mediaSourceUrlKindFields } = require("./media-source-url-kind");
const { currentRenderPolicyManifest } = require("./studio/v4/render-policy");
const REPO_ROOT = path.resolve(__dirname, "..");

const FRESH_SHORTS_SCRIPT_RUNTIME_PROFILE = Object.freeze({
  provider: "fresh_green_buffer_short",
  secondsPerWord: 0.45,
  minWords: 115,
  maxWords: 165,
  aimMin: 130,
  aimMax: 150,
});

const LOCAL_REAL_MOTION_CLIP_FLOOR = 8;
const LOCAL_REAL_MOTION_FAMILY_FLOOR = 5;
const LOCAL_FINAL_RENDER_OUTPUT_BLOCKERS = new Set([
  "final_mp4_missing",
  "caption_file_missing",
  "render_manifest_missing",
]);
const LOCAL_PERSISTENT_MEDIA_ROOT = "D:/pulse-data/media";
const PRESERVABLE_PACKAGE_EVIDENCE_FILES = Object.freeze([
  "audio_manifest.json",
  "audio_segment_loudness_report.json",
  "benchmark_report.json",
  "coherence_report.json",
  "director_beat_map.json",
  "forensic_qa_report.json",
  "caption_manifest.json",
  "captions.srt",
  "materialised_motion_clips.json",
  "owned_motion_manifest.json",
  "distinct_motion_family_report.json",
  "footage_inventory.json",
  "render_manifest.json",
  "sfx_manifest.json",
  "sfx_source_plan.json",
  "script_scorecard.json",
  "visual_quality_report.json",
  "visual_v4_render.mp4",
  "visual_v4_render_story.json",
  "rights_ledger.json",
]);
const PRESERVABLE_PACKAGE_EVIDENCE_DIRS = Object.freeze(["audio", "sfx"]);
const SCRIPT_INDEPENDENT_MOTION_EVIDENCE_FILES = new Set([
  "materialised_motion_clips.json",
  "owned_motion_manifest.json",
  "distinct_motion_family_report.json",
  "footage_inventory.json",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseGtaViDisplayText(value = "") {
  return cleanText(value)
    .replace(/\bG\.?\s*T\.?\s*A\.?\s*(?:6|six|V\s*I|VI)\b/gi, "GTA VI")
    .replace(/\bGrand\s+Theft\s+Auto\s+(?:6|six|V\s*I|VI)\b/gi, "GTA VI")
    .replace(/\bGTA VI(['’]s)\b/gi, "GTA VI$1");
}

function storyId(story = {}, index = 0) {
  return cleanText(story.id || story.story_id || story.storyId || `fresh_story_${index + 1}`);
}

function sourceName(story = {}) {
  const primarySourceName =
    typeof story.primary_source === "string"
      ? story.primary_source
      : story.primary_source?.name;
  return cleanText(primarySourceName || story.primary_source_name || story.source_name || story.subreddit);
}

function sourceUrl(story = {}) {
  return cleanText(story.primary_source?.url || story.primary_source_url || story.url);
}

function ageHours(sourcePublishedAt, now = new Date()) {
  const parsed = Date.parse(sourcePublishedAt || "");
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Number(((now.getTime() - parsed) / 36e5).toFixed(2)));
}

function firstSentence(value = "") {
  return normaliseVersionNumberSpacing(value).split(/(?<=[.!?])\s+/).filter(Boolean)[0] || "";
}

function normaliseVersionNumberSpacing(value = "") {
  return cleanText(value).replace(/\b([vV]?)(\d+)\.\s+(\d+)\b/g, (_match, prefix, major, minor) => {
    const versionPrefix = prefix ? prefix.toLowerCase() : "";
    return `${versionPrefix}${major}.${minor}`;
  });
}

function stripWeakTrailerLabels(value = "") {
  return normaliseGtaViDisplayText(value)
    .replace(/\bOfficial\s+Trailer\b/gi, "")
    .replace(/\bOfficial\s+Gameplay\s+Trailer\b/gi, "")
    .replace(/\bOfficial\s+Gameplay\b/gi, "")
    .replace(/\bOfficial\b/gi, "")
    .replace(/\b(?:Source[-\s]?Backed Update|Player Impact|Demo Test)\b/gi, "")
    .replace(/\s+Needs\s+PS5\s+Pro\s+Motion\s+Proof\b/i, " Has A PS5 Pro Upgrade Test")
    .replace(/\bMotion\s+Proof\b/gi, "Upgrade Test")
    .replace(/\s+Just\s+Dodged\s+A\s+Release[-\s]?Date\s+Fight\b/i, "")
    .replace(/\s+Trailer\s+Player\s+Impact\b/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([:;,.!?])/g, "$1")
    .replace(/[-:,;\s]+$/g, "")
    .trim();
}

function subjectFromSourceUrl(value = "") {
  const text = cleanText(value).toLowerCase();
  if (!text) return "";
  if (/\bwreck-runners\b/.test(text)) return "Wreck Runners";
  if (/\belderscrollsonline\.com\b/.test(text) || /\belder-scrolls-online\b/.test(text)) {
    return "The Elder Scrolls Online";
  }
  if (/\bzaxoid\b/.test(text)) return "Zaxoid";
  if (/\bhearthstone\b/.test(text)) return "Hearthstone";
  if (/\bbuckshot-roulette\b/.test(text)) return "Buckshot Roulette";
  if (/\bthe-blood-of-dawnwalker\b/.test(text)) return "The Blood of Dawnwalker";
  if (/\balbion-online\b/.test(text)) return "Albion Online";
  return "";
}

function publicTitleIsWeak(value = "") {
  const text = cleanText(value);
  if (!text) return true;
  return (
    /\b(?:Official\s+Trailer|Official\s+Gameplay|Source[-\s]?Backed Update|Source[-\s]?Proof\s+Risk|Player Impact|Demo Test|Motion\s+Proof)\b/i.test(text) ||
    /^Season\s+One(?:'s)?\s+Update\b/i.test(text)
  );
}

function rebuiltSubjectTitle(subject = "", story = {}) {
  const cleanSubject = cleanText(subject || story.canonical_subject || story.canonical_game);
  if (!cleanSubject) return "";
  const evidence = [
    story.title,
    story.selected_title,
    story.narration_script,
    story.full_script,
    ...asArray(story.confirmed_claims),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  if (/\b(?:playtest|insider)\b/i.test(evidence)) return `${cleanSubject} Has A Playtest Trust Test`;
  if (/\b(?:season|update|live|battle pass|dlc)\b/i.test(evidence)) return `${cleanSubject} Has A Return Test`;
  if (/\b(?:game pass|free play|free weekend|trial)\b/i.test(evidence)) return `${cleanSubject} Has A Low-Risk Trial`;
  return `${cleanSubject} Has A Player Trust Test`;
}

function choosePublicTitle({ selectedTitle = "", repairedTitle = "", story = {}, subject = "" } = {}) {
  const selected = stripWeakTrailerLabels(selectedTitle);
  const repaired = stripWeakTrailerLabels(repairedTitle);
  if (selected && !publicTitleIsWeak(selectedTitle)) return selected;
  if (repaired && !publicTitleIsWeak(repairedTitle)) return repaired;
  const rebuilt = rebuiltSubjectTitle(subject, story);
  if (rebuilt) return rebuilt;
  if (selected) return selected;
  if (repaired) return repaired;
  const fallback = stripWeakTrailerLabels(story.title || subject);
  return fallback || cleanText(subject || story.title);
}

function cleanScriptRepairTitle(story = {}) {
  const selected = stripWeakTrailerLabels(story.selected_title || "");
  const title = stripWeakTrailerLabels(story.title || "");
  const subject = compactCanonicalSubject(story);
  if (selected) return selected;
  if (title) return title;
  return subject || cleanText(story.title);
}

function compactCanonicalSubject(story = {}) {
  const knownGameRe =
    /\b(?:Arknights:\s*Endfield|DOOM:\s*The Dark Ages|DOOM\s+The Dark Ages|Dune:\s*Awakening|Dune\s+Awakening|Marvel\s+Rivals|Palworld|Halo:\s*Campaign Evolved|Halo Campaign Evolved|Call of Duty:\s*Black Ops|Black Ops(?:\s+Classics|\s+1\s+and\s+2)?|Onimusha:\s*Way of the Sword|Onimusha\s+Way of the Sword|Diablo\s*(?:IV|4)|Dead by Daylight(?:\s*:\s*The Life Road)?|The Elder Scrolls Online|Elder Scrolls Online|Wreck Runners|Zaxoid|Hearthstone|Buckshot Roulette|The Blood of Dawnwalker|Albion Online|League of Legends|Invincible VS|GUILTY\s+GEAR\s*[-:]?\s*STRIVE|Ocarina of Time|Ocarina's|Cyberpunk 2077|Lords of the Fallen\s*2|GTA\s*6|GTA\s*5|Grand Theft Auto VI|Grand Theft Auto V|Forza Horizon 6|EA SPORTS FC 26|The Adventures of Elliot|Dave the Diver|Granblue Fantasy|Garfield|Free Play Days|Nintendo Switch 2)\b/i;
  const normaliseKnownGame = (value = "") => {
    const known = cleanText(value).match(knownGameRe);
    if (!known) return "";
    return known[0]
      .replace(/^Black Ops(?:\s+Classics|\s+1\s+and\s+2)?$/i, "Call of Duty: Black Ops")
      .replace(/^DOOM\s+The\s+Dark\s+Ages$/i, "DOOM: The Dark Ages")
      .replace(/^Doom:\s*The\s+Dark\s+Ages$/i, "DOOM: The Dark Ages")
      .replace(/^Dune\s+Awakening$/i, "Dune: Awakening")
      .replace(/^Onimusha\s+Way of the Sword$/i, "Onimusha: Way of the Sword")
      .replace(/^Diablo\s*4$/i, "Diablo IV")
      .replace(/^Dead\s+By\s+Daylight$/i, "Dead by Daylight")
      .replace(/^Dead\s+By\s+Daylight\s*:\s*The\s+Life\s+Road$/i, "Dead by Daylight: The Life Road")
      .replace(/^Dead by Daylight:\s*The Life Road$/i, "Dead by Daylight")
      .replace(/^GUILTY\s+GEAR\s*[-:]?\s*STRIVE$/i, "GUILTY GEAR -STRIVE-")
      .replace(/^Ocarina's$/i, "Ocarina of Time")
      .replace(/^GTA\s*(?:6|VI)$/i, "GTA VI")
      .replace(/^Grand Theft Auto VI$/i, "GTA VI")
      .replace(/^Grand Theft Auto V$/i, "GTA 5")
      .replace(/^Elder Scrolls Online$/i, "The Elder Scrolls Online")
      .replace(/^Lords Of The Fallen\s*2$/i, "Lords of the Fallen 2")
      .replace(/^GTA\s*5$/i, "GTA 5")
      .replace(/^GTA\s*6$/i, "GTA VI");
  };
  const explicitFields = [story.canonical_subject, story.canonical_game].map(cleanText).filter(Boolean);
  const explicitKnownGame = explicitFields
    .filter((value) => value.split(/\s+/).length <= 8)
    .map(normaliseKnownGame)
    .find(Boolean);
  if (explicitKnownGame) return explicitKnownGame;
  const sourceBoundKnownGame = [
    sourceUrl(story),
    story.primary_source_url,
    story.url,
    story.source_url,
    story.source_title,
    story.article_title,
    story.selected_title,
    story.title,
  ]
    .map(normaliseKnownGame)
    .find(Boolean);
  if (sourceBoundKnownGame) return sourceBoundKnownGame;
  const explicitSubject = explicitFields.find(
    (value) =>
      value.split(/\s+/).length <= 6 &&
      !/^(?:this\s+(?:story|gaming story)|rumou?r|gaming story|game story|story|news|update|season\s+one|xbox|playstation|nintendo|steam|microsoft|sony)$/i.test(value) &&
      !/\b(?:official|trailer|source[-\s]?proof|player impact|demo test|motion proof|runway|problem|pressure|test|catch|debt|gamble|detour|price|risk|shows?|gets?|why|here's|how|just|faces?)\b/i.test(value),
  );
  if (explicitSubject) return explicitSubject;

  const fields = [
    sourceUrl(story),
    story.primary_source_url,
    story.url,
    story.source_url,
    story.source_title,
    story.article_title,
    ...asArray(story.confirmed_claims),
    story.selected_title,
    firstSentence(story.narration_script || story.full_script || story.tts_script),
    firstSentence(story.full_script || story.tts_script || story.narration_script),
    firstSentence(story.tts_script || story.narration_script || story.full_script),
    story.short_title,
    story.title,
    story.narration_script,
    story.full_script,
    story.tts_script,
  ].map(cleanText).filter(Boolean);
  for (const field of fields) {
    const fromUrl = subjectFromSourceUrl(field);
    if (fromUrl) return fromUrl;
    const known = normaliseKnownGame(field);
    if (!known) continue;
    return known;
  }
  const headlineFields = fields.slice(0, 8);
  const platformStoryText = headlineFields.join(" ");
  if (
    /\bXbox(?:'s)?\b/i.test(platformStoryText) &&
    /\b(?:strategy|brand|insider|hardware|platform|console business|game pass|exclusivity)\b/i.test(platformStoryText)
  ) {
    return "Xbox";
  }
  for (const field of fields) {
    const inferred = inferHeadlineGameCandidates(field);
    if (inferred.length) return inferred[0];
  }
  return fields.find((field) => field.split(/\s+/).length <= 6) || fields[0] || "";
}

function buildPublicDescription(story = {}) {
  const existing = cleanText(story.description || story.public_description || story.upload_description);
  if (existing && (attentionLedDescription(existing) || explicitSourceLabelledDescription(story, existing))) {
    return existing;
  }
  const attention = buildAttentionLedDescription(story);
  if (attention) return attention;
  if (existing) return existing;
  const claim = asArray(story.confirmed_claims).map(cleanText).find(Boolean);
  const source = sourceName(story);
  const subject = compactCanonicalSubject(story) || cleanText(story.title);
  if (claim) return `${claim} Source: ${source || "official source"}.`;
  const lead = firstSentence(story.narration_script || story.full_script || story.tts_script);
  if (lead && source) return `${lead} Source: ${source}.`;
  if (subject && source) return `${subject} update, sourced from ${source}.`;
  return lead || subject;
}

function explicitSourceLabelledDescription(story = {}, value = "") {
  const text = cleanText(value);
  const subject = compactCanonicalSubject(story) || cleanText(story.canonical_subject || story.canonical_game);
  if (!text || !subject || text.split(/\s+/).length < 18) return false;
  if (!text.toLowerCase().includes(subject.toLowerCase())) return false;
  if (!/\bSources?:\s*[^.]+\.?$/i.test(text)) return false;
  return !/\b(?:source[-\s]?backed update|player impact|motion proof|headline is interesting|useful question|internal qa|fallback narration)\b/i.test(text);
}

function attentionLedDescription(value = "") {
  const text = cleanText(value);
  if (!text) return false;
  if (/^(?:[^.]{0,40}\s+says|source:|confirmed by|via)\b/i.test(text)) return false;
  return /\b(?:risk|test|problem|trust|pressure|payoff|why|matters|changes|worth|before launch|reason to)\b/i.test(text);
}

function sourceLineFor(story = {}) {
  const source = sourceName(story);
  return source ? `Source: ${source}.` : "";
}

function buildAttentionLedDescription(story = {}) {
  const subject = compactCanonicalSubject(story) || cleanText(story.title);
  if (!subject) return "";
  const sourceLine = sourceLineFor(story);
  const evidence = [
    story.title,
    story.selected_title,
    story.thumbnail_headline,
    story.suggested_thumbnail_text,
    story.narration_script,
    story.full_script,
    ...asArray(story.confirmed_claims),
  ].map(cleanText).filter(Boolean).join(" ");
  let body = "";
  if (
    /\bLords of the Fallen\s*2\b/i.test(evidence) &&
    /\b(?:delay|delayed|dodg(?:e|es|ing)|avoid(?:s|ed|ing)?)\b/i.test(evidence) &&
    /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(evidence)
  ) {
    body = `${subject} has a release-calendar pressure test now. Dodging GTA 6 buys breathing room, but the extra time only matters if players can see stronger combat, cleaner performance or sharper bosses before launch.`;
  } else if (/\b(?:free play days|free to play|free access|free weekend|free trial|trial from|subscription trial|premium is free|after sunday|renewal|cancel)\b/i.test(evidence)) {
    body = `${subject} has a free-access value test now. The offer only matters if players find something worth installing before the window closes.`;
  } else if (/\b(?:custom seas|private sandbox|sandbox|creative tools|set the rules|rule controls|control of|time of day|weapon loadouts)\b/i.test(evidence)) {
    body = `${subject} has a player-control test now. The sandbox pitch only matters if custom rules create better stories than normal matchmaking.`;
  } else if (/\b(?:horror|little nightmares|reanimal|tarsier|metroidvania|top-down|twin-stick)\b/i.test(evidence)) {
    body = `${subject} has a horror trust test now. The legacy earns attention, but players need to see whether the camera, combat and exploration create real tension.`;
  } else if (/\b(?:playable demo|demo|hands-on|preview)\b/i.test(evidence)) {
    body = `${subject} has a public demo test now. The playable slice matters because it can win trust or expose the problem before launch.`;
  } else if (/\b(?:in the jungle|dlc|expansion|content pack|up to \d+\s*hours|new wildlife|new ingredients|new zone|new region)\b/i.test(evidence)) {
    body = `${subject} has an expansion trust test now. The DLC sounds big, but players need to know whether the new zone feels worth returning for.`;
  } else if (/\b(?:co-op|multiplayer|matchmaking|cross-play|crossplay)\b/i.test(evidence)) {
    body = `${subject} has a co-op pressure test now. The pitch only works if friends can jump in fast and still find enough depth to stay.`;
  } else if (/\b(?:fighting game|street fighter|ranked|rushdown|zoner|meter|footsies|frame data|combo|knife feints|eskrima|pressure)\b/i.test(evidence)) {
    const namedFighter = evidence.match(/\b(?:Yasmine|Yasmin|Mai|Elena|Sagat|Viper|Akuma|Luke|Ryu|Ken|Chun[-\s]?Li|Cammy|Juri|Kimberly)\b/i)?.[0];
    const fighterPhrase = namedFighter ? ` made ${namedFighter} look like` : " created";
    body = `${subject}'s new gameplay just${fighterPhrase} a ranked-mode combat problem. That matters because rushdown players may get a new bully while zoner mains spend meter just to breathe.`;
  } else if (/\b(?:npc|population|world reacts|living world|spouse|employees?)\b/i.test(evidence)) {
    body = `${subject} has a living-world risk now. The promise sounds huge, but players will judge whether the world reacts or only looks busy.`;
  } else if (/\bage\s+of\s+empires\s+mobile\b/i.test(`${subject} ${evidence}`) && /\bpc\s+edition\b/i.test(evidence)) {
    body = `${subject} turns PC Edition into the real test. Mouse and keyboard players will judge whether it feels like strategy on PC, or a mobile economy stretched onto a bigger screen.`;
  } else if (/\b(?:pc releases?|pc launch|pc edition|multiplatform|business strategy|first-party|fully exclusive|single-player games)\b/i.test(evidence)) {
    body = `${subject} has a PC port trust problem now. The document does not kill every port, but it changes what players should expect at launch.`;
  } else if (/\b(?:ps\s*plus|playstation\s+plus)\b/i.test(`${subject} ${evidence}`) && /\b(?:leaving|library|july|catalog(?:ue)?)\b/i.test(evidence)) {
    body = `${subject} has a backlog deadline now. The useful part is not another library update; it is which games players should finish, download or drop before access disappears.`;
  } else if (/\b(?:free upgrade|free access|free play|subscription|game catalog|game pass|ps plus)\b/i.test(evidence)) {
    body = `${subject} has a low-risk trial moment now. The offer matters because it changes whether players try it tonight or keep scrolling.`;
  } else if (/\b(?:release date|launches?|comes to|available|wishlist)\b/i.test(evidence)) {
    body = `${subject} has a release-window trust test now. The date is useful because it turns vague interest into a real decision for players.`;
  } else if (/\b(?:free\s+)?battle pass\b/i.test(evidence)) {
    body = `${subject} is using a free battle pass as a comeback test. That matters because lapsed players get a low-friction reason to reinstall, but only if the update adds enough fights to make the return stick.`;
  } else if (/\bdoom\b/i.test(`${subject} ${evidence}`) && /\bchain\s+spear\b/i.test(evidence)) {
    body = `${subject} is turning Chain Spear movement into the player risk: faster fights, cleaner arenas and no unreadable effects spam.`;
  } else if (/\b(?:update|season|dlc|battle pass|patch)\b/i.test(evidence)) {
    body = `${subject} is asking players to reinstall, not just notice an update. The useful test is whether the new content changes the first hour enough to make coming back feel urgent.`;
  } else {
    body = `${subject} has a player-trust test now. The headline is interesting, but the useful question is what it changes for players next.`;
  }
  return cleanText(`${body} ${sourceLine}`);
}

function sourceMaterialForScriptRepair(story = {}) {
  return [
    story.source_title,
    story.article_title,
    story.title,
    ...asArray(story.confirmed_claims),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function scriptQa(story = {}, script = "") {
  return runScriptCoherenceQa(
    {
      ...story,
      cta: EXACT_CTA,
      full_script: script,
    },
    {
      requireCtaField: true,
      requireFullScriptCta: true,
    },
  );
}

function weakPublicCopyFailures(story = {}, script = "") {
  const text = [
    story.selected_title,
    story.public_title,
    story.upload_title,
    story.title,
    script,
  ].map(cleanText).filter(Boolean).join(" ");
  const failures = [];
  if (/\bDemo Test\b/i.test(text)) failures.push("weak_public_copy_pattern:demo_test_title");
  if (/\bhands[-\s]?on demo beat\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:hands_on_demo_beat");
  }
  if (/\bsource[-\s]?backed update\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:source_backed_update");
  }
  if (/\bmotion\s+proof\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:motion_proof_public_title");
  }
  if (/\b(?:Official\s+Trailer|Official\s+Gameplay|Official\s+Gameplay\s+Trailer)\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:trailer_label_leaked");
  }
  if (/\bthis story finally has something (?:specific|concrete) to judge\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:generic_judge_language");
  }
  if (/\bsomething sharper to argue about\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:argument_scaffold_leaked");
  }
  if (/\bpart players can actually judge\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:generic_judge_language");
  }
  if (/\breal test is motion, not screenshots\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:motion_not_screenshots_scaffold");
  }
  if (/\bhas one detail worth checking before it becomes background noise\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:generic_background_noise_hook");
  }
  if (/\bnot every update deserves a spotlight\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:generic_update_spotlight");
  }
  if (/\bUse this as a watch signal, not a verdict\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:generic_watch_signal");
  }
  return failures;
}

function scriptRuntimeFailures(script = "") {
  const failures = [];
  const wordCount = countSpokenWords(script);
  if (wordCount < FRESH_SHORTS_SCRIPT_RUNTIME_PROFILE.minWords) {
    failures.push(`script_runtime:too_short:${wordCount}`);
  }
  if (wordCount > FRESH_SHORTS_SCRIPT_RUNTIME_PROFILE.maxWords) {
    failures.push(`script_runtime:overlong:${wordCount}`);
  }
  return failures;
}

function lightlyRepairProvidedScript(script = "", failures = []) {
  const failureIds = asArray(failures).map(cleanText);
  if (!failureIds.some((failure) => /^script_coherence:repeated_near_phrase:/i.test(failure))) {
    return "";
  }
  let repaired = cleanText(script);
  repaired = repaired.replace(
    /\bwhat should be preserved and what should be modernised\b/gi,
    "the line between preservation and modernisation",
  );
  repaired = repaired.replace(
    /\bwhat should be preserved and what should be modernized\b/gi,
    "the line between preservation and modernization",
  );
  repaired = repaired.replace(
    /\band removed cop(?:y|ies) should be treated as cautious evidence\b/gi,
    "and the pulled listing should be treated as cautious evidence",
  );
  return repaired !== cleanText(script) ? repaired : "";
}

function extensionSentencesForStory(story = {}) {
  const subject = compactCanonicalSubject(story) || cleanText(story.title) || "this story";
  const source = sourceName(story) || "the source";
  const evidence = [
    story.title,
    story.selected_title,
    story.source_title,
    story.article_title,
    ...asArray(story.confirmed_claims),
  ].map(cleanText).join(" ");
  if (/\b(?:Ocarina of Time|hidden description|Switch\s*2)\b/i.test(evidence)) {
    return [
      "That matters because hidden platform copy only becomes loud when it disappears.",
      "The useful read is not to call the remake confirmed, but to separate a removed clue from a finished announcement.",
      "Players should watch the next Nintendo wording, store-page language and footage before treating the promise as locked.",
    ];
  }
  if (/\b(?:Halo:? Campaign Evolved|Xbox account|gamertag|PS5|PlayStation)\b/i.test(evidence)) {
    return [
      "That matters because a remake can look exciting and still lose goodwill if the access rules feel clumsy.",
      "For PlayStation players, the practical question is simple: what account do you need, what works offline and what does co-op require?",
      "The next proof is whether the setup feels invisible or becomes the first friction point before the campaign even starts.",
    ];
  }
  return [
    `${source} gives ${subject} a concrete player-facing detail, not just another feed headline.`,
    "The useful question is what changes now: access, timing, trust, performance or whether players should wait for clearer proof.",
    "That keeps the short focused on the decision players can actually make instead of stretching the source beyond what it says.",
  ];
}

function extendScriptToRuntime(script = "", story = {}) {
  let extended = cleanText(script);
  const cta = EXACT_CTA.replace(/[.!\s]+$/, "");
  extended = extended.replace(new RegExp(`\\s*${cta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?\\s*$`, "i"), "").trim();
  const pads = extensionSentencesForStory(story);
  let index = 0;
  while (
    countSpokenWords(`${extended} ${EXACT_CTA}`) < FRESH_SHORTS_SCRIPT_RUNTIME_PROFILE.minWords &&
    index < pads.length
  ) {
    extended = cleanText(`${extended} ${pads[index]}`);
    index += 1;
  }
  const withCta = cleanText(`${extended} ${EXACT_CTA}`);
  return countSpokenWords(withCta) >= FRESH_SHORTS_SCRIPT_RUNTIME_PROFILE.minWords
    ? withCta
    : "";
}

function safeTtsScriptForPublicScript(script = "") {
  return applyGamingPronunciation(cleanText(script))
    .replace(/\bGame\s*Spot\b/gi, "GameSpot")
    .replace(/\s+/g, " ")
    .trim();
}

function exactCtaSentence() {
  const cta = cleanText(EXACT_CTA);
  return /[.!?]$/.test(cta) ? cta : `${cta}.`;
}

function buildSpecificPromotionScript(story = {}) {
  const evidence = [
    story.title,
    story.selected_title,
    story.source_title,
    story.article_title,
    story.description,
    ...asArray(story.confirmed_claims),
  ].map(cleanText).filter(Boolean).join(" ");
  const source = sourceName(story) || "the source";
  const subject = compactCanonicalSubject(story) || cleanText(story.canonical_subject || story.title);
  const cta = exactCtaSentence();
  if (/\bdoom\b/i.test(`${subject} ${evidence}`) && /\bchain\s+spear|revelations\b/i.test(evidence)) {
    return cleanText([
      "DOOM: The Dark Ages just turned the Chain Spear from a cool weapon into the whole argument.",
      `${source} says Revelations is available now, and the player test is speed: faster arena movement, aerial pressure and whether the new tool makes heavy combat feel sharper.`,
      "That matters because DOOM only works when chaos still reads cleanly.",
      "If the Chain Spear lets players cross gaps, punish demons and keep the screen readable, this DLC fixes the one complaint people had about Dark Ages feeling weighty.",
      "If it becomes effects spam, the fantasy gets louder but worse to play.",
      "Watch the movement, not the finisher.",
      "That is where the update either earns the reinstall or loses it.",
      cta,
    ].join(" "));
  }
  if (/\bmarvel\s+rivals\b/i.test(`${subject} ${evidence}`) && /\bjubilee\b/i.test(evidence)) {
    return cleanText([
      "Marvel Rivals just made Jubilee look like more than a nostalgia pick.",
      `${source} shows her gameplay, and the real question is whether she changes team fights or just adds another bright projectile kit.`,
      "That matters because Rivals is already crowded with effects, dives and panic ults.",
      "A good Jubilee kit needs readable pressure: clear bursts, smart mobility and a reason to pick her over safer damage heroes.",
      "If she creates space without blinding the match, she could become a real ranked problem.",
      "If not, players will call it style over control within a day.",
      cta,
    ].join(" "));
  }
  if (/\bguilty\s+gear\b/i.test(`${subject} ${evidence}`) && /\brobo[-\s]?ky\b/i.test(evidence)) {
    return cleanText([
      "GUILTY GEAR -STRIVE- just made Robo-Ky the roster test again.",
      `${source} is carrying the new trailer, and the useful question is not whether the robot is funny.`,
      "It is whether Robo-Ky adds a real matchup problem or only brings back a cult favourite for nostalgia.",
      "That matters because fighting-game players forgive weird characters when the kit has purpose: pressure, resource tricks and matchups that change how people train.",
      "If Robo-Ky has that, mains get a reason to learn the chaos.",
      "If not, the trailer becomes a meme before the character becomes a threat.",
      "Watch the meter, not the punchline.",
      "That is what separates a comeback pick from a novelty slot.",
      cta,
    ].join(" "));
  }
  if (/\bpalworld\b/i.test(`${subject} ${evidence}`) && /\b(?:1\.0|game pass|full launch)\b/i.test(evidence)) {
    return cleanText([
      "Palworld 1.0 is not just a launch date; it is a second-chance test.",
      `${source} puts the full release inside the latest Game Pass wave, which means curious players can try the finished version without buying in again.`,
      "That matters because Palworld already had the viral moment.",
      "Now it has to prove the survival loop is cleaner, fairer and deeper than the launch-week chaos people remember.",
      "If 1.0 feels polished, Game Pass turns old hype into a fresh install.",
      "If it still feels messy, the comeback story ends before it starts.",
      cta,
    ].join(" "));
  }
  if (/\b(?:bethesda|zenimax|xbox)\b/i.test(`${subject} ${evidence}`) && /\b(?:layoffs|union|studio|trust)\b/i.test(evidence)) {
    return cleanText([
      "Bethesda's Xbox story just stopped being abstract strategy talk.",
      `${source} reports Bethesda Game Studios and ZeniMax were hit hard by Xbox layoffs, and that changes how players read every future RPG promise.`,
      "The issue is not just jobs, as serious as that is.",
      "It is trust: fewer people, disrupted teams and bigger expectations landing on the same studios that are meant to carry Xbox's identity.",
      "If Xbox wants players to believe in the next Starfield, Fallout or Elder Scrolls beat, it needs proof the teams are stable enough to deliver.",
      "Without that, every trailer carries a question mark.",
      cta,
    ].join(" "));
  }
  if (/\bdune:\s*awakening|dune awakening\b/i.test(`${subject} ${evidence}`)) {
    return cleanText([
      "Dune: Awakening coming to PS5 is a survival pitch with one brutal question.",
      `${source} says the game arrives on PlayStation 5 on September 22, but the real test is whether Arrakis feels dangerous after the trailer ends.`,
      "That matters because Dune cannot just be sand, menus and crafting timers.",
      "Players need pressure from thirst, spice, rival factions and the world itself, without turning every session into homework.",
      "If the console version keeps that tension readable and fast, it could be the rare survival game that breaks out.",
      "If not, the licence does more work than the game.",
      cta,
    ].join(" "));
  }
  if (/\bassassin'?s creed black flag resynced\b/i.test(`${subject} ${evidence}`)) {
    return cleanText([
      "Assassin's Creed Black Flag Resynced has a PS5 Pro trust test now.",
      `${source} says the upgrade details are coming through, but the real question is whether the pirate loop feels sharper in motion.`,
      "That matters because Black Flag nostalgia is already doing half the marketing.",
      "Players do not need another pretty ocean shot; they need boarding, stealth, sailing and combat to feel faster, cleaner and less like an old game wearing new lighting.",
      "If the upgrade makes the chase and ship fights snap, this becomes an easy replay.",
      "If it only polishes screenshots, the remake argument gets ugly fast.",
      "That is the gap players will notice in the first ten minutes.",
      cta,
    ].join(" "));
  }
  return "";
}

function chooseCanonicalScript(story = {}) {
  const provided = cleanText(story.narration_script || story.full_script || story.tts_script);
  const providedQa = provided ? scriptQa(story, provided) : null;
  const weakFailures = provided ? weakPublicCopyFailures(story, provided) : [];
  const runtimeFailures = provided ? scriptRuntimeFailures(provided) : [];
  if (
    provided &&
    providedQa?.result === "pass" &&
    weakFailures.length === 0 &&
    runtimeFailures.length === 0
  ) {
    return {
      script: provided,
      source: cleanText(story.script_source) || "provided_fresh_story_script",
      qa: providedQa,
      repaired: false,
    };
  }
  const lightlyRepaired = provided ? lightlyRepairProvidedScript(provided, providedQa?.failures) : "";
  const lightlyRepairedQa = lightlyRepaired ? scriptQa(story, lightlyRepaired) : null;
  const lightlyRepairedRuntimeFailures = lightlyRepaired ? scriptRuntimeFailures(lightlyRepaired) : [];
  if (
    lightlyRepaired &&
    lightlyRepairedQa?.result === "pass" &&
    weakFailures.length === 0 &&
    lightlyRepairedRuntimeFailures.length === 0
  ) {
    return {
      script: lightlyRepaired,
      source: cleanText(story.script_source) || "provided_fresh_story_script_lightly_repaired",
      qa: lightlyRepairedQa,
      repaired: true,
      repair_reason: providedQa?.failures?.[0] || "provided_script_repeated_phrase",
    };
  }
  if (
    lightlyRepaired &&
    lightlyRepairedQa?.result === "pass" &&
    weakFailures.length === 0 &&
    lightlyRepairedRuntimeFailures.some((failure) => /^script_runtime:too_short:/i.test(failure))
  ) {
    const extended = extendScriptToRuntime(lightlyRepaired, story);
    const extendedQa = extended ? scriptQa(story, extended) : null;
    const extendedRuntimeFailures = extended ? scriptRuntimeFailures(extended) : [];
    if (extended && extendedQa?.result === "pass" && extendedRuntimeFailures.length === 0) {
      return {
        script: extended,
        source: cleanText(story.script_source) || "provided_fresh_story_script_lightly_repaired",
        qa: extendedQa,
        repaired: true,
        repair_reason: providedQa?.failures?.[0] || lightlyRepairedRuntimeFailures[0],
      };
    }
  }
  if (
    provided &&
    providedQa?.result === "pass" &&
    weakFailures.length === 0 &&
    runtimeFailures.some((failure) => /^script_runtime:too_short:/i.test(failure))
  ) {
    const extended = extendScriptToRuntime(provided, story);
    const extendedQa = extended ? scriptQa(story, extended) : null;
    const extendedRuntimeFailures = extended ? scriptRuntimeFailures(extended) : [];
    if (extended && extendedQa?.result === "pass" && extendedRuntimeFailures.length === 0) {
      return {
        script: extended,
        source: cleanText(story.script_source) || "provided_fresh_story_script_extended",
        qa: extendedQa,
        repaired: true,
        repair_reason: runtimeFailures[0],
      };
    }
  }

  const specific = buildSpecificPromotionScript(story);
  const specificQa = specific ? scriptQa(story, specific) : null;
  const specificWeakStory = {
    ...story,
    title: compactCanonicalSubject(story) || cleanText(story.title),
    selected_title: "",
    public_title: "",
    upload_title: "",
  };
  const specificWeakFailures = specific ? weakPublicCopyFailures(specificWeakStory, specific) : [];
  const specificRuntimeFailures = specific ? scriptRuntimeFailures(specific) : [];
  if (
    specific &&
    specificQa?.result === "pass" &&
    specificWeakFailures.length === 0 &&
    specificRuntimeFailures.length === 0
  ) {
    return {
      script: specific,
      source: "specific_motion_scorecard_script",
      qa: specificQa,
      repaired: true,
      repair_reason: weakFailures[0] || runtimeFailures[0] || providedQa?.failures?.[0] || "motion_scorecard_script_generated",
    };
  }
  if (
    specific &&
    specificQa?.result === "pass" &&
    specificWeakFailures.length === 0 &&
    specificRuntimeFailures.some((failure) => /^script_runtime:too_short:/i.test(failure))
  ) {
    const extended = extendScriptToRuntime(specific, story);
    const extendedQa = extended ? scriptQa(story, extended) : null;
    const extendedRuntimeFailures = extended ? scriptRuntimeFailures(extended) : [];
    if (extended && extendedQa?.result === "pass" && extendedRuntimeFailures.length === 0) {
      return {
        script: extended,
        source: "specific_motion_scorecard_script",
        qa: extendedQa,
        repaired: true,
        repair_reason: weakFailures[0] || runtimeFailures[0] || specificRuntimeFailures[0],
      };
    }
  }

  const rebuilt = buildSourceBoundFallbackScript(
    {
      ...story,
      title: cleanScriptRepairTitle(story),
      selected_title: cleanScriptRepairTitle(story),
      article_url: sourceUrl(story),
      source_url: sourceUrl(story),
      url: sourceUrl(story),
      narration_script: "",
      full_script: "",
      tts_script: "",
    },
    {
      sourceName: sourceName(story),
      sourceMaterial: sourceMaterialForScriptRepair(story),
      runtimeProfile: FRESH_SHORTS_SCRIPT_RUNTIME_PROFILE,
    },
  );
  const rebuiltScript = cleanText(rebuilt?.full_script);
  const rebuiltQa = rebuiltScript ? scriptQa(story, rebuiltScript) : null;
  const rebuiltWeakStory = {
    ...story,
    selected_title: cleanText(rebuilt?.suggested_title) || story.selected_title,
    public_title: cleanText(rebuilt?.suggested_title) || story.public_title,
    upload_title: cleanText(rebuilt?.suggested_title) || story.upload_title,
    thumbnail_headline: cleanText(rebuilt?.suggested_thumbnail_text) || story.thumbnail_headline,
    suggested_thumbnail_text: cleanText(rebuilt?.suggested_thumbnail_text) || story.suggested_thumbnail_text,
  };
  const rebuiltWeakFailures = rebuiltScript ? weakPublicCopyFailures(rebuiltWeakStory, rebuiltScript) : [];
  const rebuiltRuntimeFailures = rebuiltScript ? scriptRuntimeFailures(rebuiltScript) : [];
  if (
    rebuiltScript &&
    rebuiltQa?.result === "pass" &&
    rebuiltWeakFailures.length === 0 &&
    rebuiltRuntimeFailures.length === 0
  ) {
    return {
      script: rebuiltScript,
      source: rebuilt.script_source || "source_bound_repair",
      qa: rebuiltQa,
      repaired: Boolean(provided),
      repair_reason:
        weakFailures[0] ||
        runtimeFailures[0] ||
        lightlyRepairedRuntimeFailures[0] ||
        providedQa?.failures?.[0] ||
        "provided_script_missing_or_failed_coherence",
      repaired_title: cleanText(rebuilt.suggested_title),
      repaired_thumbnail_text: cleanText(rebuilt.suggested_thumbnail_text),
    };
  }
  if (
    rebuiltScript &&
    rebuiltQa?.result === "pass" &&
    rebuiltWeakFailures.length === 0 &&
    rebuiltRuntimeFailures.some((failure) => /^script_runtime:too_short:/i.test(failure))
  ) {
    const extended = extendScriptToRuntime(rebuiltScript, story);
    const extendedQa = extended ? scriptQa(story, extended) : null;
    const extendedRuntimeFailures = extended ? scriptRuntimeFailures(extended) : [];
    if (extended && extendedQa?.result === "pass" && extendedRuntimeFailures.length === 0) {
      return {
        script: extended,
        source: rebuilt.script_source || "source_bound_repair",
        qa: extendedQa,
        repaired: true,
        repair_reason:
          weakFailures[0] ||
          runtimeFailures[0] ||
          rebuiltRuntimeFailures[0] ||
          providedQa?.failures?.[0] ||
          "source_bound_repair_extended",
        repaired_title: cleanText(rebuilt.suggested_title),
        repaired_thumbnail_text: cleanText(rebuilt.suggested_thumbnail_text),
      };
    }
  }

  return {
    script: provided,
    source: cleanText(story.script_source) || "provided_fresh_story_script",
    qa: providedQa || rebuiltQa || { result: "fail", failures: ["script_coherence:script_missing"] },
    repaired: false,
  };
}

function buildCanonicalStoryManifest(story = {}, generatedAt = new Date().toISOString()) {
  const id = storyId(story);
  const scriptChoice = chooseCanonicalScript(story);
  const script = normaliseVersionNumberSpacing(normaliseGtaViDisplayText(scriptChoice.script));
  const subject = normaliseGtaViDisplayText(compactCanonicalSubject(story) || cleanText(story.title));
  const selectedTitle = choosePublicTitle({
    selectedTitle: story.selected_title || story.title,
    repairedTitle: scriptChoice.repaired_title,
    story,
    subject,
  });
  const thumbnailHeadline = normaliseGtaViDisplayText(
    story.thumbnail_headline ||
      story.suggested_thumbnail_text ||
      scriptChoice.repaired_thumbnail_text ||
      story.title,
  );
  const description = normaliseGtaViDisplayText(buildPublicDescription(story));
  const firstLine = normaliseGtaViDisplayText(firstSentence(script));
  return {
    schema_version: 1,
    story_id: id,
    id,
    canonical_subject: subject,
    canonical_game: subject,
    selected_title: selectedTitle,
    public_title: selectedTitle,
    upload_title: selectedTitle,
    short_title: cleanText(story.short_title || story.title),
    thumbnail_headline: thumbnailHeadline,
    suggested_thumbnail_text: thumbnailHeadline,
    first_spoken_line: firstLine,
    hook: firstLine,
    description,
    public_description: description,
    pinned_comment: sourceName(story) ? `Source: ${sourceName(story)}.` : "",
    narration_script: script,
    full_script: script,
    tts_script: safeTtsScriptForPublicScript(script),
    script_source: scriptChoice.source,
    script_coherence_result: scriptChoice.qa?.result || "unknown",
    script_coherence_failures: asArray(scriptChoice.qa?.failures),
    ...(scriptChoice.repaired
      ? {
          public_copy_repaired_at: generatedAt,
          public_copy_repair_reason: scriptChoice.repair_reason,
        }
      : {}),
    primary_source: sourceName(story),
    primary_source_url: sourceUrl(story),
    source_published_at: cleanText(story.source_published_at || story.timestamp),
    source_confidence_score: Number(story.source_confidence_score || 0),
    claim_inventory: {
      confirmed: asArray(story.confirmed_claims),
      unconfirmed: asArray(story.unconfirmed_claims),
      prohibited: asArray(story.prohibited_claims),
    },
    trailer_references: motionReferences(story),
    official_motion_references: motionReferences(story),
    official_source_pages: officialSourcePageReferences(story),
    approved_direct_media_url: cleanText(
      story.approved_direct_media_url || story.direct_media_url_if_available || story.direct_media_url,
    ),
    confirmed_claims: asArray(story.confirmed_claims),
    unconfirmed_claims: asArray(story.unconfirmed_claims),
    generated_at: generatedAt,
    publish_status: "LOCAL_PROMOTION_ONLY",
    public_copy: {
      title: selectedTitle,
      thumbnail_headline: thumbnailHeadline,
      first_spoken_line: firstLine,
      description,
    },
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      disabled_platforms_enabled: false,
    },
  };
}

function buildSourceManifest(story = {}, now = new Date()) {
  const publishedAt = cleanText(story.source_published_at || story.timestamp);
  const hours = ageHours(publishedAt, now);
  const fresh = hours === null ? false : hours <= 168;
  const directMediaCandidates = directMediaReferences(story).map((reference) => ({
    direct_media_url: reference.url,
    direct_media_url_if_available: reference.url,
    label: reference.label,
    source_title: reference.label,
    source_family: reference.source_family,
    source_type: reference.source_type,
    rights_basis: reference.rights_basis,
  }));
  const officialSourcePages = officialSourcePageReferences(story).map((reference) => ({
    url: reference.url,
    source_url: reference.url,
    official_source_url: reference.url,
    label: reference.label,
    source_title: reference.label,
    source_family: reference.source_family,
    source_type: reference.source_type,
    rights_basis: reference.rights_basis,
  }));
  return {
    schema_version: 1,
    story_id: storyId(story),
    primary_source: {
      name: sourceName(story),
      url: sourceUrl(story),
      type: cleanText(story.primary_source?.type || story.source_type || "official_or_major_source"),
      published_at: publishedAt || null,
      age_hours: hours,
      direct_media_url_if_available: directMediaCandidates[0]?.direct_media_url || null,
      direct_media_candidates: directMediaCandidates,
      official_source_pages: officialSourcePages,
    },
    direct_media_url_if_available: directMediaCandidates[0]?.direct_media_url || null,
    approved_direct_media_url: directMediaCandidates[0]?.direct_media_url || null,
    direct_media_candidates: directMediaCandidates,
    official_source_pages: officialSourcePages,
    source_age_policy_hours: 168,
    freshness_gate: fresh ? "pass" : "blocked",
    coherence_gate: sourceName(story) && sourceUrl(story) ? "pass" : "blocked",
    reference_only: true,
    direct_media_validated: false,
    blockers: [
      ...(fresh ? [] : ["source_age_missing_or_over_7_days"]),
      ...(sourceName(story) && sourceUrl(story) ? [] : ["primary_source_name_or_url_missing"]),
    ],
  };
}

function buildClaimInventory(story = {}) {
  return {
    schema_version: 1,
    story_id: storyId(story),
    confirmed: asArray(story.confirmed_claims),
    unconfirmed: asArray(story.unconfirmed_claims),
    prohibited: asArray(story.prohibited_claims),
    public_copy_guardrails: [
      "viewer_facing_only",
      "no_internal_qa_language",
      "no_weak_fallback_narration",
      "approved_cta_only",
    ],
  };
}

function normaliseDirectMediaReference(candidate = {}, index = 0) {
  const row = candidate && typeof candidate === "object" ? candidate : { direct_media_url: candidate };
  const url = cleanText(
    row.direct_media_url ||
      row.direct_media_url_if_available ||
      row.approved_direct_media_url ||
      row.url ||
      row.href ||
      row.source_url ||
      row.video_url ||
      row.trailer_url,
  );
  if (!/\.(?:mp4|mov|m4v|webm|m3u8|mpd)(?:[?#]|$)/i.test(url)) return null;
  return {
    label: cleanText(row.label || row.title || row.source_title || row.name || `official direct media ${index + 1}`),
    url,
    source_family: cleanText(row.source_family || row.family || row.media_identity || `official_direct_media_${index + 1}`),
    source_type: cleanText(row.source_type || row.type || "official_direct_media"),
    rights_basis: cleanText(row.rights_basis || "official_direct_media_reference_for_motion_acquisition"),
  };
}

function normaliseOfficialSourcePageReference(candidate = {}, index = 0) {
  const row = candidate && typeof candidate === "object" ? candidate : { source_url: candidate };
  const url = cleanText(
    row.official_source_url ||
      row.source_url ||
      row.reference_url ||
      row.page_url ||
      row.store_url ||
      row.approved_direct_media_url ||
      row.direct_media_url_if_available ||
      row.direct_media_url ||
      row.url ||
      row.href,
  );
  if (!/^https?:\/\//i.test(url)) return null;
  if (/\.(?:mp4|mov|m4v|webm|m3u8|mpd)(?:[?#]|$)/i.test(url)) return null;
  if (
    !/(?:store\.steampowered\.com|news\.xbox\.com|xbox\.com|playstation\.com|nintendo\.com|rockstargames\.com|bethesda\.net|ea\.com|ubisoft\.com|capcom-games\.com|sega\.com|square-enix-games\.com|konami\.com|epicgames\.com)/i.test(
      url,
    )
  ) {
    return null;
  }
  return {
    label: cleanText(row.label || row.title || row.source_title || row.name || `official source page ${index + 1}`),
    url,
    source_owner: cleanText(row.source_owner || row.source_name || row.owner || row.name),
    source_family: cleanText(row.source_family || row.family || row.media_identity || `official_source_page_${index + 1}`),
    source_type: cleanText(row.source_type || row.type || "official_source_page"),
    rights_basis: cleanText(row.rights_basis || "official_source_page_for_motion_discovery"),
  };
}

function officialSourcePageReferences(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  const rows = [
    ...asArray(story.official_source_pages),
    ...asArray(story.storefront_sources),
    ...asArray(story.source_pages),
    ...asArray(primary.official_source_pages),
    ...asArray(primary.storefront_sources),
    ...asArray(primary.source_pages),
    story.approved_direct_media_url,
    story.direct_media_url,
    story.direct_media_url_if_available,
    story.store_url,
    story.storefront_url,
    primary.approved_direct_media_url,
    primary.direct_media_url,
    primary.direct_media_url_if_available,
    primary.store_url,
    primary.storefront_url,
  ];
  const seen = new Set();
  return rows
    .map(normaliseOfficialSourcePageReference)
    .filter(Boolean)
    .filter((reference) => {
      const key = reference.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function directMediaReferences(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  const rows = [
    ...asArray(story.direct_media_candidates),
    ...asArray(story.media_candidates),
    ...asArray(story.official_media_candidates),
    ...asArray(primary.direct_media_candidates),
    ...asArray(primary.media_candidates),
    ...asArray(primary.official_media_candidates),
    story.approved_direct_media_url,
    story.direct_media_url,
    story.direct_media_url_if_available,
    story.video_url,
    story.trailer_url,
    primary.approved_direct_media_url,
    primary.direct_media_url,
    primary.direct_media_url_if_available,
    primary.video_url,
    primary.trailer_url,
  ];
  const seen = new Set();
  return rows
    .map(normaliseDirectMediaReference)
    .filter(Boolean)
    .filter((reference) => {
      const key = reference.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function motionReferences(story = {}) {
  return [
    ...asArray(story.trailer_references),
    ...asArray(story.official_motion_references),
    ...asArray(story.motion_references),
    ...directMediaReferences(story),
    ...asArray(story.trailer_urls).map((url, index) => ({
      label: `official trailer ${index + 1}`,
      url,
      source_type: "official_trailer",
    })),
  ].map((reference, index) => {
    if (typeof reference === "string") {
      return {
        label: `official trailer ${index + 1}`,
        url: cleanText(reference),
        source_type: "official_trailer",
      };
    }
    return {
      label: cleanText(reference.label || reference.title || `official trailer ${index + 1}`),
      url: cleanText(reference.url || reference.source_url || reference.href),
      source_family: cleanText(reference.source_family || reference.family || ""),
      source_type: cleanText(reference.source_type || reference.type || "official_trailer"),
      rights_basis: cleanText(reference.rights_basis || "official_reference_for_motion_acquisition"),
    };
  }).filter((reference) => reference.url);
}

function buildLocalPromotionSegmentReferenceReport(report = {}) {
  const generatedAt = cleanText(report.generated_at || report.generatedAt) || new Date().toISOString();
  const plans = asArray(report.candidates).map((candidate) => {
    const story = candidate.original_story || candidate;
    const id = cleanText(candidate.story_id || storyId(story));
    const references = motionReferences(story).map((reference, index) => {
      const sourceUrl = cleanText(reference.url || reference.source_url);
      const urlKind = mediaSourceUrlKindFields(sourceUrl);
      return {
        story_id: id,
        reference_id: `${id}_official_motion_reference_${index + 1}`,
        label: cleanText(reference.label || `official motion reference ${index + 1}`),
        source_url: sourceUrl,
        source_url_kind: urlKind.source_url_kind,
        segment_validation_eligible: urlKind.segment_validation_eligible === true,
        segment_validation_ineligible_reason: urlKind.segment_validation_ineligible_reason,
        source_family: cleanText(reference.source_family || reference.family || `official_motion_${index + 1}`),
        source_type: cleanText(reference.source_type || reference.type || "official_motion_reference"),
        rights_basis: cleanText(reference.rights_basis || "official_reference_for_motion_acquisition"),
        downloads_allowed: false,
        allowed_render_use: "reference_only_by_default",
        local_promotion_only: true,
      };
    });
    return {
      story_id: id,
      title: cleanText(candidate.title || story.title),
      references,
      segment_validation_eligible_count: references.filter((reference) => reference.segment_validation_eligible).length,
    };
  });
  const totalReferences = plans.reduce((sum, plan) => sum + plan.references.length, 0);
  const eligibleReferences = plans.reduce(
    (sum, plan) => sum + plan.references.filter((reference) => reference.segment_validation_eligible).length,
    0,
  );
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROMOTION_OFFICIAL_MOTION_REFERENCE_REPORT",
    summary: {
      stories: plans.length,
      total_references: totalReferences,
      segment_validation_eligible_references: eligibleReferences,
      downloads_allowed: false,
    },
    plans,
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      downloads_allowed: false,
    },
  };
}

function buildRenderReadinessWorkOrder(story = {}, generatedAt = new Date().toISOString()) {
  const id = storyId(story);
  const references = motionReferences(story);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: id,
    title: cleanText(story.title),
    mode: "LOCAL_ONLY_RENDER_PROMOTION_WORK_ORDER",
    current_state: "fresh_source_draft_validated_reference_only",
    official_motion_references: references,
    required_lanes: [
      {
        lane: "audio_timestamps",
        command: `npm run ops:goal-audio-timestamps -- --story-id ${id} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --json`,
        requirement: "fresh local narration audio and Whisper word timestamps",
      },
      {
        lane: "official_direct_motion",
        command: `npm run ops:v4-source-family-acquisition -- --story-id ${id} --story-packages output/overnight-fresh-green-buffer/local_promotion_story_packages.json --output-json output/overnight-fresh-green-buffer/${id}_source_family_acquisition.json --json`,
        requirement: "official/direct motion references with validated clip windows or an explicit operator-held blocker",
      },
      {
        lane: "visual_v4_final_render",
        command: `npm run ops:goal-production-render -- --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --story-id ${id} --json`,
        requirement: "Visual V4 final render with freeze/black/choppy QA pass",
      },
      {
        lane: "scheduler_bridge_promotion",
        command: "npm run ops:next-publish-candidates -- --json",
        requirement: "scheduler preflight sees this story and returns preflight_qa pass",
      },
      {
        lane: "strict_dry_run",
        command: "npm run ops:goal-dry-run-publish -- --json",
        requirement: "enabled-platform dry-run actions appear without hard blockers",
      },
    ],
    safety: {
      no_publish_triggered: true,
      no_production_db_mutation: true,
      no_oauth_or_token_change: true,
      no_disabled_platform_enablement: true,
      no_gate_weakening: true,
    },
  };
}

function buildInitialRightsLedger(story = {}, generatedAt = new Date().toISOString()) {
  const references = motionReferences(story);
  const primaryUrl = sourceUrl(story);
  return {
    schema_version: 1,
    story_id: storyId(story),
    generated_at: generatedAt,
    verdict: "fail",
    failures: ["rights:no_rights_record"],
    direct_media_validated: false,
    records: [],
    rights_ledger: [],
    assets: [],
    matched_assets: [],
    reference_only_sources: [
      ...(primaryUrl
        ? [{
            name: sourceName(story) || "primary source",
            url: primaryUrl,
            type: cleanText(story.primary_source?.type || story.source_type || "official_or_major_source"),
            usage: "reference_only_editorial_source",
          }]
        : []),
      ...references.map((reference) => ({
        name: cleanText(reference.label || reference.source_family || "official motion reference"),
        url: cleanText(reference.url),
        type: cleanText(reference.source_type || "official_trailer"),
        usage: "reference_only_motion_acquisition_source",
      })),
    ],
    official_motion_references: references,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      not_publishable: true,
    },
  };
}

function buildInitialFootageInventory(story = {}, generatedAt = new Date().toISOString()) {
  const references = motionReferences(story);
  const primaryUrl = sourceUrl(story);
  return {
    schema_version: 1,
    story_id: storyId(story),
    generated_at: generatedAt,
    readiness: {
      status: "v4_motion_blocked",
      blockers: [
        "actual_motion_clip_minimum_not_met",
        "distinct_motion_families_minimum_not_met",
        "no_trusted_footage_references_for_story",
      ],
      warnings: [],
    },
    motion_budget: {
      required_motion_scenes: 5,
      required_distinct_families: 4,
      available_motion_clips: 0,
      available_distinct_families: 0,
    },
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
      trusted_local_source_families: [],
      direct_video_motion_asset_count: 0,
      direct_video_motion_family_count: 0,
    },
    direct_media_validated: false,
    reference_only_sources: [
      ...(primaryUrl
        ? [{
            name: sourceName(story) || "primary source",
            url: primaryUrl,
            type: cleanText(story.primary_source?.type || story.source_type || "official_or_major_source"),
          }]
        : []),
      ...references.map((reference) => ({
        name: cleanText(reference.label || reference.source_family || "official motion reference"),
        url: cleanText(reference.url),
        type: cleanText(reference.source_type || "official_trailer"),
      })),
    ],
    official_motion_references: references,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      not_publishable: true,
    },
  };
}

function buildCandidateEntry(story = {}, { generatedAt, now } = {}) {
  const source = buildSourceManifest(story, now);
  const blockingLanes = [
    "audio_timestamps",
    "official_direct_motion",
    "visual_v4_final_render",
    "scheduler_bridge_promotion",
    "strict_dry_run",
  ];
  return {
    story_id: storyId(story),
    title: cleanText(story.title),
    canonical_subject: compactCanonicalSubject(story) || cleanText(story.title),
    primary_source: source.primary_source,
    freshness_gate: source.freshness_gate,
    source_coherence_gate: source.coherence_gate,
    local_package_status: source.blockers.length ? "blocked_source_reference" : "ready_for_local_render_promotion",
    scheduler_green: false,
    counted_as_green: false,
    blocking_lanes: source.blockers.length ? ["source", ...blockingLanes] : blockingLanes,
    blockers: [
      ...source.blockers,
      "not_persisted_to_scheduler_candidate_store",
      "missing_fresh_audio_and_word_timestamps",
      "missing_validated_official_direct_motion",
      "missing_visual_v4_final_render",
      "missing_strict_dry_run_pass",
    ],
    package_dir: `packages/${storyId(story)}`,
    files: [
      "canonical_story_manifest.json",
      "source_manifest.json",
      "claim_inventory.json",
      "rights_ledger.json",
      "footage_inventory.json",
      "render_readiness_work_order.json",
    ],
    original_story: story,
    generated_at: generatedAt,
  };
}

function localPromotionProofBlockers(candidate = {}) {
  const sourceBlockers = asArray(candidate.blockers).filter((blocker) =>
    /^source_age_|^primary_source_/i.test(cleanText(blocker)),
  );
  return [
    ...sourceBlockers,
    "not_scheduler_green",
    "missing_fresh_audio_and_word_timestamps",
    "missing_validated_official_direct_motion",
    "missing_visual_v4_final_render",
    "missing_media_house_quality_gate_pass",
    "missing_scheduler_preflight_pass",
    "missing_strict_dry_run_pass",
  ];
}

function isInsideRepo(value) {
  const raw = cleanText(value);
  if (!raw) return false;
  const relative = path.relative(REPO_ROOT, path.resolve(raw));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolvePackageEvidencePath(value, { allowPersistentFallback = false } = {}) {
  const raw = cleanText(value);
  if (!raw) return null;
  if (path.isAbsolute(raw)) return raw;
  const candidates = [
    mediaPaths.resolveExistingSync(raw),
    allowPersistentFallback ? path.resolve(LOCAL_PERSISTENT_MEDIA_ROOT, raw) : null,
    path.resolve(raw),
  ].filter(Boolean);
  const seen = new Set();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
  for (const candidate of unique) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return unique[0] || null;
}

function fileExists(value, options = {}) {
  const resolved = resolvePackageEvidencePath(value, options);
  if (!resolved) return false;
  try {
    return fs.existsSync(resolved);
  } catch {
    return false;
  }
}

function fileSizeBytes(value, options = {}) {
  const resolved = resolvePackageEvidencePath(value, options);
  if (!resolved) return 0;
  try {
    const stat = fs.statSync(resolved);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function readJsonFileSync(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readJsonSync(filePath) : {};
  } catch {
    return {};
  }
}

function requiresGtaPronunciationProfile(...values) {
  const text = cleanText(values.filter(Boolean).join(" "));
  return /\b(?:G\.?\s*T\.?\s*A\.?\s*(?:V\s*I|VI|6|six|V|5|five)|Grand\s+Theft\s+Auto\s*(?:V\s*I|VI|6|six|V|5|five)|next\s+Grand\s+Theft\s+Auto|s(?:i|y|igh)?[-\s]*six)\b/i.test(text);
}

function resolveArtifactEvidencePath(artifactDir, value, fallbackFileName) {
  const raw = cleanText(value);
  if (raw) {
    if (path.isAbsolute(raw)) return raw;
    const artifactRelative = path.resolve(artifactDir, raw);
    if (fs.existsSync(artifactRelative)) return artifactRelative;
    return resolvePackageEvidencePath(raw, { allowPersistentFallback: isInsideRepo(artifactDir) }) || artifactRelative;
  }
  return path.join(artifactDir, fallbackFileName);
}

function readPackageAudioEvidence(candidate = {}) {
  const artifactDir = cleanText(candidate.artifact_dir);
  if (!artifactDir) {
    return { audioReady: false, timestampsReady: false, manifestReady: false };
  }
  const manifestPath = path.join(artifactDir, "audio_manifest.json");
  let manifest = {};
  try {
    manifest = fs.existsSync(manifestPath) ? fs.readJsonSync(manifestPath) : {};
  } catch {
    manifest = {};
  }
  const audioPath =
    manifest.resolved_narration_audio_path ||
    manifest.narration_audio_path ||
    manifest.final_narration_audio_path ||
    manifest.audio_path ||
    `output/audio/${storyId(candidate)}.mp3`;
  const timestampsPath =
    manifest.resolved_word_timestamps_path ||
    manifest.word_timestamps_path ||
    manifest.word_timestamp_path ||
    manifest.timestamps_path ||
    `output/audio/${storyId(candidate)}_timestamps.json`;
  const evidenceOptions = { allowPersistentFallback: isInsideRepo(artifactDir) };
  const audioReady = fileExists(audioPath, evidenceOptions);
  const timestampsReady = fileExists(timestampsPath, evidenceOptions);
  const resolvedTimestampsPath = timestampsReady ? resolvePackageEvidencePath(timestampsPath, evidenceOptions) : "";
  const timestampPayload = resolvedTimestampsPath ? readJsonFileSync(resolvedTimestampsPath) : {};
  const timestampMeta = timestampPayload.meta || {};
  const pronunciationProfileVersion = cleanText(
    timestampMeta.ttsPronunciationProfileVersion ||
      timestampPayload.ttsPronunciationProfileVersion ||
      manifest.ttsPronunciationProfileVersion,
  );
  const pronunciationProfileSensitive = requiresGtaPronunciationProfile(
    candidate.title,
    candidate.public_title,
    candidate.selected_title,
    candidate.canonical_subject,
    candidate.canonical_game,
    candidate.full_script,
    candidate.narration_script,
    candidate.tts_script,
    candidate.spoken_narration_script,
    timestampMeta.text,
    timestampMeta.transcript,
    timestampMeta.spoken_text,
    timestampMeta.display_text,
  );
  const pronunciationProfileCurrent =
    !pronunciationProfileSensitive ||
    pronunciationProfileVersion === TTS_PRONUNCIATION_PROFILE_VERSION;
  return {
    audioReady,
    timestampsReady,
    manifestReady: audioReady && timestampsReady,
    audioPath: audioReady ? resolvePackageEvidencePath(audioPath, evidenceOptions) : "",
    timestampsPath: resolvedTimestampsPath,
    pronunciationProfileSensitive,
    pronunciationProfileVersion,
    expectedPronunciationProfileVersion: pronunciationProfileSensitive
      ? TTS_PRONUNCIATION_PROFILE_VERSION
      : "",
    pronunciationProfileCurrent,
    pronunciationProfileStale: timestampsReady && !pronunciationProfileCurrent,
  };
}

function readPackageFinalRenderEvidence(candidate = {}) {
  const artifactDir = cleanText(candidate.artifact_dir);
  if (!artifactDir) {
    return {
      finalRenderReady: false,
      captionFileReady: false,
      renderManifestReady: false,
      finalRenderPath: "",
      captionPath: "",
      renderManifestPath: "",
      captionManifestPath: "",
    };
  }
  const renderManifestPath = path.join(artifactDir, "render_manifest.json");
  const captionManifestPath = path.join(artifactDir, "caption_manifest.json");
  const renderManifest = readJsonFileSync(renderManifestPath);
  const captionManifest = readJsonFileSync(captionManifestPath);
  const finalRenderPath = resolveArtifactEvidencePath(
    artifactDir,
    renderManifest.resolved_output_path || renderManifest.output_path || renderManifest.final_mp4_path || renderManifest.output,
    "visual_v4_render.mp4",
  );
  const captionPath = resolveArtifactEvidencePath(
    artifactDir,
    captionManifest.resolved_caption_srt_path || captionManifest.caption_srt_path || captionManifest.captions_path,
    "captions.srt",
  );
  const finalRenderSizeBytes = fileSizeBytes(finalRenderPath);
  const captionSizeBytes = fileSizeBytes(captionPath);
  const finalRenderReady = finalRenderSizeBytes > 1000;
  const renderManifestBlockers = asArray(renderManifest.post_render_forensic_blockers)
    .map(cleanText)
    .filter(Boolean);
  const renderManifestReady =
    fs.existsSync(renderManifestPath) &&
    finalRenderReady &&
    cleanText(renderManifest.renderer) === "visual_v4_production" &&
    renderManifest.final_publish_render === true &&
    cleanText(renderManifest.quality_gate_status) === "post_render_forensics_passed" &&
    cleanText(renderManifest.post_render_forensic_result).toLowerCase() === "pass" &&
    renderManifestBlockers.length === 0;
  const captionManifestBlockers = asArray(captionManifest.blockers).map(cleanText).filter(Boolean);
  const captionStatus = cleanText(captionManifest.status).toLowerCase();
  const captionFileReady = captionSizeBytes > 0;
  const captionManifestReady =
    fs.existsSync(captionManifestPath) &&
    captionFileReady &&
    ["ready", "pass", "passed", "materialized", "materialised"].includes(captionStatus) &&
    captionManifestBlockers.length === 0 &&
    captionManifest.checks?.caption_file_present !== false &&
    captionManifest.checks?.captions_well_formed !== false;
  return {
    finalRenderReady,
    captionFileReady: captionFileReady && captionManifestReady,
    renderManifestReady,
    finalRenderPath: finalRenderReady ? finalRenderPath : "",
    captionPath: captionFileReady && captionManifestReady ? captionPath : "",
    renderManifestPath: renderManifestReady ? renderManifestPath : "",
    captionManifestPath: captionManifestReady ? captionManifestPath : "",
    finalRenderSizeBytes,
    captionSizeBytes,
  };
}

function uniqueMotionClips(clips = []) {
  const seen = new Set();
  const unique = [];
  for (const clip of asArray(clips)) {
    const key = cleanText(
      clip.path ||
      clip.resolved_path ||
      clip.output_path ||
      clip.id ||
      [clip.source_family, clip.start_s, clip.end_s].filter(Boolean).join(":"),
    );
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(clip);
  }
  return unique;
}

function motionFamilyKey(clip = {}) {
  return cleanText(
    clip.source_family ||
      clip.sourceFamily ||
      clip.motion_family ||
      clip.visual_family ||
      clip.family_id ||
      clip.family,
  );
}

function isOwnedExplainerMotionClip(clip = {}) {
  const evidence = [
    clip.media_kind,
    clip.mediaKind,
    clip.source_type,
    clip.sourceType,
    clip.source_kind,
    clip.rights_risk_class,
    clip.rights_basis,
    clip.licence_basis,
    clip.asset_class,
  ].map(cleanText).join(" ").toLowerCase();
  return (
    clip.counts_towards_motion_readiness === true &&
    /\b(?:owned_explainer_motion|internally_generated_motion_graphic|owned_generated_motion|owned_generated_editorial_motion_graphic)\b/.test(evidence)
  );
}

function validatedV4DirectMotionReady(manifest = {}, { clipCount = 0, directVideoClipCount = 0 } = {}) {
  const readiness = manifest.readiness && typeof manifest.readiness === "object" ? manifest.readiness : {};
  const budget = manifest.motion_budget && typeof manifest.motion_budget === "object" ? manifest.motion_budget : {};
  const requiredScenes = Math.max(1, Number(budget.required_motion_scenes) || 5);
  const readinessStatus = cleanText(readiness.status).toLowerCase();
  const source = cleanText(manifest.source).toLowerCase();
  return (
    manifest.status !== "blocked" &&
    readinessStatus === "v4_motion_ready" &&
    asArray(readiness.blockers).length === 0 &&
    /validated_real_motion_materializer|footage_empire|v4_motion/i.test(source) &&
    clipCount >= requiredScenes &&
    directVideoClipCount >= requiredScenes
  );
}

function isValidatedOfficialDirectMotionClip(clip = {}) {
  const mediaKind = cleanText(clip.media_kind || clip.mediaKind || clip.asset_kind || clip.kind).toLowerCase();
  const provenance = clip.provenance && typeof clip.provenance === "object" ? clip.provenance : {};
  const evidence = [
    clip.source_type,
    clip.sourceType,
    clip.rights_basis,
    clip.licence_basis,
    provenance.source,
    provenance.validation_reason,
  ].map(cleanText).join(" ").toLowerCase();
  return (
    mediaKind === "direct_video" &&
    clip.counts_towards_motion_readiness !== false &&
    /\b(?:steam_movie|official|storefront|trailer)\b/.test(evidence) &&
    /\b(?:official_direct_media|official_trailer_segment_validation|official_storefront|samples_passed)\b/.test(evidence) &&
    (provenance.segment_validated === true || /\b(?:validated|samples_passed)\b/.test(evidence))
  );
}

function validatedOfficialDirectClipReady(manifest = {}, clips = []) {
  const budget = manifest.motion_budget && typeof manifest.motion_budget === "object" ? manifest.motion_budget : {};
  const requiredScenes = Math.max(1, Number(budget.required_motion_scenes) || 5);
  const validated = asArray(clips).filter(isValidatedOfficialDirectMotionClip);
  const distinctWindowFamilies = new Set(validated.map(motionFamilyKey).filter(Boolean));
  return (
    manifest.status !== "blocked" &&
    validated.length >= requiredScenes &&
    distinctWindowFamilies.size >= requiredScenes
  );
}

function readPackageMotionEvidence(candidate = {}) {
  const artifactDir = cleanText(candidate.artifact_dir);
  if (!artifactDir) {
    return {
      motionReady: false,
      clipCount: 0,
      familyCount: 0,
      directVideoClipCount: 0,
      directVideoFamilyCount: 0,
      ownedExplainerClipCount: 0,
      ownedExplainerFamilyCount: 0,
      selectedMotionKind: "",
    };
  }
  const motionPath = path.join(artifactDir, "materialised_motion_clips.json");
  let manifest = {};
  try {
    manifest = fs.existsSync(motionPath) ? fs.readJsonSync(motionPath) : {};
  } catch {
    manifest = {};
  }
  const clips = uniqueMotionClips([
    ...asArray(manifest.clips),
    ...asArray(manifest.materialised_clips),
  ]);
  const clipCount = Math.max(
    Number(manifest.clip_count) || 0,
    Number(manifest.materialised_motion_clip_count) || 0,
    clips.length,
  );
  const clipFamilies = new Set(
    clips
      .map(motionFamilyKey)
      .filter(Boolean),
  );
  const directVideoClips = clips.filter((clip) =>
    cleanText(clip.media_kind || clip.mediaKind || clip.asset_kind || clip.kind).toLowerCase() === "direct_video",
  );
  const directVideoFamilies = new Set(
    directVideoClips
      .map(motionFamilyKey)
      .filter(Boolean),
  );
  const ownedExplainerClips = clips.filter(isOwnedExplainerMotionClip);
  const ownedExplainerFamilies = new Set(
    ownedExplainerClips
      .map(motionFamilyKey)
      .filter(Boolean),
  );
  const manifestFamilyCount =
    Number(manifest.distinct_motion_family_count) ||
    Number(manifest.materialised_motion_family_count) ||
    0;
  const familyCount = manifestFamilyCount || clipFamilies.size;
  const directVideoClipCount = Math.max(
    Number(manifest.direct_video_motion_asset_count) || 0,
    Number(manifest.direct_video_motion_clip_count) || 0,
    directVideoClips.length,
  );
  const manifestDirectVideoFamilyCount = Number(manifest.direct_video_motion_family_count) || 0;
  const directVideoFamilyCount = manifestDirectVideoFamilyCount || directVideoFamilies.size;
  const ownedExplainerClipCount = Math.max(
    Number(manifest.owned_explainer_motion_asset_count) || 0,
    Number(manifest.owned_explainer_motion_clip_count) || 0,
    ownedExplainerClips.length,
  );
  const ownedExplainerFamilyCount =
    Number(manifest.owned_explainer_motion_family_count) || ownedExplainerFamilies.size;
  const validatedV4DirectReady =
    fileExists(motionPath) &&
    (validatedV4DirectMotionReady(manifest, { clipCount, directVideoClipCount }) ||
      validatedOfficialDirectClipReady(manifest, directVideoClips));
  const directVideoReady =
    fileExists(motionPath) &&
    clipCount >= LOCAL_REAL_MOTION_CLIP_FLOOR &&
    familyCount >= LOCAL_REAL_MOTION_FAMILY_FLOOR &&
    directVideoClipCount >= LOCAL_REAL_MOTION_CLIP_FLOOR &&
    directVideoFamilyCount >= LOCAL_REAL_MOTION_FAMILY_FLOOR;
  const ownedExplainerReady =
    fileExists(motionPath) &&
    manifest.status !== "blocked" &&
    (manifest.owned_explainer_visual_plan === true || ownedExplainerClipCount > 0) &&
    clipCount >= LOCAL_REAL_MOTION_CLIP_FLOOR &&
    familyCount >= LOCAL_REAL_MOTION_FAMILY_FLOOR &&
    ownedExplainerClipCount >= LOCAL_REAL_MOTION_CLIP_FLOOR &&
    ownedExplainerFamilyCount >= LOCAL_REAL_MOTION_FAMILY_FLOOR;
  const motionReady = directVideoReady || validatedV4DirectReady || ownedExplainerReady;
  return {
    motionReady,
    clipCount,
    familyCount,
    directVideoClipCount,
    directVideoFamilyCount,
    ownedExplainerClipCount,
    ownedExplainerFamilyCount,
    selectedMotionKind: directVideoReady || validatedV4DirectReady
      ? "direct_video"
      : ownedExplainerReady
        ? "owned_explainer_motion"
        : "",
    validatedV4DirectReady,
    motionPath,
  };
}

function localPromotionReadyForFinalRender(blockers = []) {
  const remaining = asArray(blockers).map(cleanText).filter(Boolean);
  return (
    remaining.length > 0 &&
    remaining.every((blocker) => LOCAL_FINAL_RENDER_OUTPUT_BLOCKERS.has(blocker))
  );
}

function localPromotionRenderInputBlockers(candidate = {}) {
  const sourceBlockers = asArray(candidate.blockers).filter((blocker) =>
    /^source_age_|^primary_source_/i.test(cleanText(blocker)),
  );
  const audioEvidence = readPackageAudioEvidence(candidate);
  const motionEvidence = readPackageMotionEvidence(candidate);
  const finalRenderEvidence = readPackageFinalRenderEvidence(candidate);
  const blockers = [
    ...sourceBlockers,
    ...(audioEvidence.pronunciationProfileStale
      ? [
          "final_narration_audio_stale_after_pronunciation_repair",
          "word_timestamps_stale_after_pronunciation_repair",
        ]
      : []),
    "final_narration_audio_missing",
    "word_timestamps_missing",
    "materialised_motion_clips_missing",
    "materialised_motion_families_insufficient",
    "real_visual_motion_clips_missing",
    "real_visual_motion_families_insufficient",
    "final_mp4_missing",
    "caption_file_missing",
    "render_manifest_missing",
    "audio_manifest_missing",
  ];
  return blockers.filter((blocker) => {
    if (blocker === "final_narration_audio_missing") return !audioEvidence.audioReady;
    if (blocker === "word_timestamps_missing") return !audioEvidence.timestampsReady;
    if (blocker === "audio_manifest_missing") return !audioEvidence.manifestReady;
    if (blocker === "materialised_motion_clips_missing") return !motionEvidence.motionReady;
    if (blocker === "materialised_motion_families_insufficient") return !motionEvidence.motionReady;
    if (blocker === "real_visual_motion_clips_missing") return !motionEvidence.motionReady;
    if (blocker === "real_visual_motion_families_insufficient") return !motionEvidence.motionReady;
    if (blocker === "final_mp4_missing") return !finalRenderEvidence.finalRenderReady;
    if (blocker === "caption_file_missing") return !finalRenderEvidence.captionFileReady;
    if (blocker === "render_manifest_missing") return !finalRenderEvidence.renderManifestReady;
    return true;
  });
}

function localPromotionRenderInputStatus(blockers = [], finalRenderEvidence = {}) {
  if (!asArray(blockers).length && finalRenderEvidence.finalRenderReady && finalRenderEvidence.captionFileReady && finalRenderEvidence.renderManifestReady) {
    return "ready_for_scheduler_preflight";
  }
  return localPromotionReadyForFinalRender(blockers)
    ? "ready_for_final_render_job"
    : "blocked";
}

function buildLocalPromotionRenderInputWorkOrder({
  packages = [],
  generatedAt = new Date().toISOString(),
  storyPackagesPath = "",
  outputDir = "",
  renderInputWorkOrderPath = "",
  productionCutoverPlanPath = "",
  segmentReportPath = "",
  realMotionOutDir = "",
  realMotionArtifactRoot = "",
} = {}) {
  const queue = asArray(packages).map((storyPackage) => {
    const renderInputBlockers = localPromotionRenderInputBlockers(storyPackage);
    const finalRenderEvidence = readPackageFinalRenderEvidence(storyPackage);
    const packageArtifactRoot = storyPackage.artifact_dir ? path.dirname(storyPackage.artifact_dir) : "";
    const repairCommandContext = {
      story_packages_path: storyPackagesPath || "",
      out_dir: outputDir || "",
      render_input_work_order_path: renderInputWorkOrderPath || "",
      production_cutover_plan_path: productionCutoverPlanPath || "",
      segment_report_path: segmentReportPath || "",
      real_motion_out_dir: realMotionOutDir || "",
      real_motion_artifact_root: realMotionArtifactRoot || packageArtifactRoot || "",
    };
    return ({
      ...(() => {
      const audioEvidence = readPackageAudioEvidence(storyPackage);
      const motionEvidence = readPackageMotionEvidence(storyPackage);
      return {
        render_input_evidence: {
          local_promotion_only: true,
          repair_command_context: repairCommandContext,
          canonical_subject: cleanText(storyPackage.canonical_subject),
          primary_source: cleanText(storyPackage.primary_source),
          primary_source_url: cleanText(storyPackage.primary_source_url),
          source_published_at: cleanText(storyPackage.source_published_at),
          trailer_reference_count: motionReferences(storyPackage).length,
          package_status: cleanText(storyPackage.status),
          package_verdict: cleanText(storyPackage.verdict),
          narration_audio_path: audioEvidence.audioPath,
          word_timestamps_path: audioEvidence.timestampsPath,
          word_timestamp_source: audioEvidence.timestampsReady
            ? "local_whisper_word_alignment"
            : "",
          voice_pronunciation_profile_sensitive: audioEvidence.pronunciationProfileSensitive,
          voice_pronunciation_profile_version: audioEvidence.pronunciationProfileVersion,
          expected_voice_pronunciation_profile_version: audioEvidence.expectedPronunciationProfileVersion,
          voice_pronunciation_profile_current: audioEvidence.pronunciationProfileCurrent,
          voice_pronunciation_profile_stale: audioEvidence.pronunciationProfileStale,
          materialised_motion_clip_count: motionEvidence.clipCount,
          distinct_motion_family_count: motionEvidence.familyCount,
          real_visual_motion_clip_count: motionEvidence.directVideoClipCount,
          real_visual_motion_family_count: motionEvidence.directVideoFamilyCount,
          owned_explainer_motion_clip_count: motionEvidence.ownedExplainerClipCount,
          owned_explainer_motion_family_count: motionEvidence.ownedExplainerFamilyCount,
          selected_render_input_motion_kind: motionEvidence.selectedMotionKind,
          selected_render_input_motion_ready: motionEvidence.motionReady,
          materialised_motion_clip_paths: motionEvidence.motionReady
            ? [motionEvidence.motionPath].filter(Boolean)
            : [],
          final_render_ready: finalRenderEvidence.finalRenderReady,
          final_render_path: finalRenderEvidence.finalRenderPath,
          final_render_size_bytes: finalRenderEvidence.finalRenderSizeBytes,
          caption_file_ready: finalRenderEvidence.captionFileReady,
          caption_file_path: finalRenderEvidence.captionPath,
          caption_file_size_bytes: finalRenderEvidence.captionSizeBytes,
          render_manifest_ready: finalRenderEvidence.renderManifestReady,
          render_manifest_path: finalRenderEvidence.renderManifestPath,
          caption_manifest_path: finalRenderEvidence.captionManifestPath,
        },
      };
      })(),
    story_id: cleanText(storyPackage.story_id || storyPackage.id),
    title: cleanText(storyPackage.title || storyPackage.public_title),
    artifact_dir: storyPackage.artifact_dir || null,
    repair_command_context: repairCommandContext,
    status: "needs_media_house_render_proof",
    render_input_status: localPromotionRenderInputStatus(renderInputBlockers, finalRenderEvidence),
    render_input_blockers: renderInputBlockers,
    target_render_manifest: {
      ...currentRenderPolicyManifest(),
      renderer: "visual_v4_production",
      output: "visual_v4_render.mp4",
      local_promotion_only: true,
    },
    });
  });
  return buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      schema_version: 1,
      generated_at: generatedAt,
      mode: "LOCAL_PROMOTION_RENDER_INPUT_CUTOVER",
      queue,
      blocked: [],
    },
    generatedAt,
  });
}

function buildFreshGreenBufferLocalPromotionReport({
  stories = [],
  generatedAt = new Date().toISOString(),
  now = new Date(generatedAt),
} = {}) {
  const rows = asArray(stories);
  const candidates = rows.map((story, index) =>
    buildCandidateEntry({ ...story, id: storyId(story, index) }, { generatedAt, now }),
  );
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_ONLY_FRESH_GREEN_BUFFER_PROMOTION",
    verdict: candidates.length >= 5 ? "local_promotion_ready_partial" : "local_promotion_under_target",
    summary: {
      story_count: rows.length,
      local_package_count: candidates.length,
      scheduler_green_count: 0,
      strict_dry_run_ready_action_count: 0,
      production_db_mutation_required: false,
      minimum_target: 5,
      stretch_target: 10,
    },
    candidates,
    next_action:
      "Run the listed local render promotion lanes, then strict dry-run. Do not count these as GREEN until scheduler preflight and strict dry-run pass.",
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

function renderMarkdown(report = {}) {
  const lines = [];
  lines.push("# Fresh GREEN Buffer Local Promotion");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "unknown"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Draft stories: ${report.summary?.story_count || 0}`);
  lines.push(`- Local packages: ${report.summary?.local_package_count || 0}`);
  lines.push(`- Scheduler GREEN: ${report.summary?.scheduler_green_count || 0}`);
  lines.push(`- Strict dry-run ready actions: ${report.summary?.strict_dry_run_ready_action_count || 0}`);
  lines.push(`- Production DB mutation required by this report: ${report.summary?.production_db_mutation_required === true ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Candidates");
  for (const candidate of asArray(report.candidates)) {
    lines.push("");
    lines.push(`### ${candidate.story_id}`);
    lines.push(`- Title: ${candidate.title}`);
    lines.push(`- Source: ${candidate.primary_source?.name || "unknown"}`);
    lines.push(`- Freshness: ${candidate.freshness_gate}`);
    lines.push(`- Local package: ${candidate.local_package_status}`);
    lines.push(`- Blocking lanes: ${asArray(candidate.blocking_lanes).join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- No publish was triggered.");
  lines.push("- No production DB mutation was performed.");
  lines.push("- No OAuth, token, billing or platform setting was changed.");
  lines.push("- Disabled platforms remain deferred.");
  return `${lines.join("\n")}\n`;
}

function canonicalMotionReferenceSignature(canonical = {}) {
  return asArray([
    ...asArray(canonical.trailer_references),
    ...asArray(canonical.official_motion_references),
  ])
    .map((reference) => cleanText(reference.source_family || reference.url || reference.label))
    .filter(Boolean)
    .sort();
}

function canonicalEvidenceSignature(canonical = {}) {
  return JSON.stringify({
    story_id: cleanText(canonical.story_id || canonical.id),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game),
    script: cleanText(canonical.full_script || canonical.tts_script || canonical.narration_script),
    primary_source_url: cleanText(canonical.primary_source_url),
    source_published_at: cleanText(canonical.source_published_at),
    motion_references: canonicalMotionReferenceSignature(canonical),
  });
}

function canonicalMotionEvidenceSignature(canonical = {}) {
  return JSON.stringify({
    story_id: cleanText(canonical.story_id || canonical.id),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game),
    primary_source_url: cleanText(canonical.primary_source_url),
    source_published_at: cleanText(canonical.source_published_at),
    motion_references: canonicalMotionReferenceSignature(canonical),
  });
}

async function readPreservablePackageEvidence(packageDir) {
  const canonicalPath = path.join(packageDir, "canonical_story_manifest.json");
  if (!(await fs.pathExists(canonicalPath))) return null;
  let canonical = {};
  try {
    canonical = await fs.readJson(canonicalPath);
  } catch {
    return null;
  }
  const files = {};
  for (const fileName of PRESERVABLE_PACKAGE_EVIDENCE_FILES) {
    const filePath = path.join(packageDir, fileName);
    if (!(await fs.pathExists(filePath))) continue;
    files[fileName] = await fs.readFile(filePath);
  }
  for (const directoryName of PRESERVABLE_PACKAGE_EVIDENCE_DIRS) {
    const directoryPath = path.join(packageDir, directoryName);
    if (!(await fs.pathExists(directoryPath))) continue;
    const nestedFiles = await fs.readdir(directoryPath, { recursive: true, withFileTypes: true });
    for (const entry of nestedFiles) {
      if (!entry.isFile()) continue;
      const parentPath = cleanText(entry.parentPath || entry.path);
      const filePath = path.join(parentPath || directoryPath, entry.name);
      const relativePath = path.relative(packageDir, filePath);
      if (!relativePath || relativePath.startsWith("..")) continue;
      files[relativePath] = await fs.readFile(filePath);
    }
  }
  if (!Object.keys(files).length) return null;
  return {
    signature: canonicalEvidenceSignature(canonical),
    motion_signature: canonicalMotionEvidenceSignature(canonical),
    files,
  };
}

async function snapshotCurrentPackageEvidence(outDir, report = {}) {
  const packagesDir = path.join(outDir, "packages");
  if (!(await fs.pathExists(packagesDir))) return new Map();
  const snapshots = new Map();
  for (const candidate of asArray(report.candidates)) {
    const id = cleanText(candidate.story_id);
    if (!id || !candidate.package_dir) continue;
    const packageDir = path.join(outDir, candidate.package_dir);
    const evidence = await readPreservablePackageEvidence(packageDir);
    if (evidence) snapshots.set(id, evidence);
  }
  return snapshots;
}

async function restoreMatchingPackageEvidence(packageDir, snapshot, canonical = {}) {
  if (!snapshot) return false;
  const exactMatch = snapshot.signature === canonicalEvidenceSignature(canonical);
  const motionMatch =
    snapshot.motion_signature === canonicalMotionEvidenceSignature(canonical);
  if (!exactMatch && !motionMatch) return false;
  for (const [fileName, content] of Object.entries(snapshot.files || {})) {
    if (!exactMatch && !SCRIPT_INDEPENDENT_MOTION_EVIDENCE_FILES.has(fileName)) continue;
    const targetPath = path.join(packageDir, fileName);
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content);
  }
  return true;
}

async function writeFreshGreenBufferLocalPromotionArtifacts(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeFreshGreenBufferLocalPromotionArtifacts requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportJson = path.join(outDir, "fresh_green_buffer_local_promotion_report.json");
  const reportMd = path.join(outDir, "fresh_green_buffer_local_promotion_report.md");
  const preservedPackageEvidence = await snapshotCurrentPackageEvidence(outDir, report);
  await fs.remove(path.join(outDir, "packages"));
  await fs.writeJson(reportJson, report, { spaces: 2 });
  await fs.writeFile(reportMd, renderMarkdown(report), "utf8");

  const manifest = [];
  for (const candidate of asArray(report.candidates)) {
    const original = candidate.original_story || {};
    const packageDir = path.join(outDir, candidate.package_dir);
    await fs.ensureDir(packageDir);
    const story = original.id ? original : candidate;
    const canonical = buildCanonicalStoryManifest(story, report.generated_at);
    await fs.writeJson(path.join(packageDir, "canonical_story_manifest.json"), canonical, { spaces: 2 });
    await fs.writeJson(path.join(packageDir, "source_manifest.json"), buildSourceManifest(story, new Date(report.generated_at)), { spaces: 2 });
    await fs.writeJson(path.join(packageDir, "claim_inventory.json"), buildClaimInventory(story), { spaces: 2 });
    await fs.writeJson(path.join(packageDir, "rights_ledger.json"), buildInitialRightsLedger(story, report.generated_at), { spaces: 2 });
    await fs.writeJson(path.join(packageDir, "footage_inventory.json"), buildInitialFootageInventory(story, report.generated_at), { spaces: 2 });
    await fs.writeJson(path.join(packageDir, "render_readiness_work_order.json"), buildRenderReadinessWorkOrder(story, report.generated_at), { spaces: 2 });
    await restoreMatchingPackageEvidence(packageDir, preservedPackageEvidence.get(candidate.story_id), canonical);
    manifest.push({
      story_id: candidate.story_id,
      id: candidate.story_id,
      title: canonical.selected_title,
      public_title: canonical.public_title,
      upload_title: canonical.upload_title,
      description: canonical.description,
      public_description: canonical.public_description,
      full_script: canonical.full_script,
      tts_script: canonical.tts_script,
      canonical_subject: canonical.canonical_subject,
      canonical_game: canonical.canonical_game,
      primary_source: canonical.primary_source,
      primary_source_url: canonical.primary_source_url,
      source_published_at: canonical.source_published_at,
      trailer_references: canonical.trailer_references || [],
      official_motion_references: canonical.official_motion_references || [],
      verdict: "local_proof_pending",
      status: "needs_media_house_render_proof",
      publishable: false,
      scheduler_green: false,
      counted_as_green: false,
      blockers: localPromotionProofBlockers(candidate),
      artifact_dir: packageDir,
      local_promotion_only: true,
      no_publish_triggered: true,
    });
  }
  const storyPackages = path.join(outDir, "local_promotion_story_packages.json");
  await fs.writeJson(storyPackages, manifest, { spaces: 2 });
  const segmentReferenceReport = path.join(outDir, "official_trailer_references_v1.json");
  await fs.writeJson(segmentReferenceReport, buildLocalPromotionSegmentReferenceReport(report), { spaces: 2 });
  const renderInputWorkOrder = buildLocalPromotionRenderInputWorkOrder({
    packages: manifest,
    generatedAt: report.generated_at,
    storyPackagesPath: storyPackages,
    outputDir: outDir,
    renderInputWorkOrderPath: path.join(outDir, "render_input_work_order.json"),
    productionCutoverPlanPath: path.join(outDir, "production_render_cutover_plan.json"),
    realMotionArtifactRoot: outDir,
  });
  const renderInputWritten = await writeGoalRenderInputWorkOrder(renderInputWorkOrder, {
    outputDir: outDir,
  });
  return {
    reportJson,
    reportMd,
    storyPackages,
    segmentReferenceReport,
    renderInputWorkOrder: renderInputWritten.jsonPath,
    renderInputWorkOrderMarkdown: renderInputWritten.markdownPath,
    repairBacklog: renderInputWritten.repairBacklogPath,
    autoRepairPlan: renderInputWritten.autoRepairPlanPath,
    postRepairValidationPlan: renderInputWritten.postRepairValidationPlanPath,
  };
}

module.exports = {
  buildLocalPromotionRenderInputWorkOrder,
  buildCanonicalStoryManifest,
  buildClaimInventory,
  buildFreshGreenBufferLocalPromotionReport,
  buildLocalPromotionSegmentReferenceReport,
  buildInitialFootageInventory,
  buildInitialRightsLedger,
  buildRenderReadinessWorkOrder,
  buildSourceManifest,
  directMediaReferences,
  motionReferences,
  renderMarkdown,
  writeFreshGreenBufferLocalPromotionArtifacts,
};
