"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");
const fs = require("fs-extra");

const { buildViralScriptIntelligence } = require("./viral-script-intelligence");
const { buildStudioGovernanceReport } = require("./studio-governance-engine");
const { buildStudioEnterpriseOSPack } = require("./studio-enterprise-os");
const { buildFootageEmpirePlan } = require("./studio/v4/footage-empire");
const { buildVisualV4DirectorPlan } = require("./studio/v4/director-brain");
const { PRIMARY_PULSE_CTA } = require("./pulse-cta");
const {
  isGeneratedMotionAsset,
  isRealMediaAsset,
} = require("./visual-evidence-classifier");

const ACCEPTANCE_ARTEFACTS = [
  "canonical_story_manifest.json",
  "script_scorecard.json",
  "footage_inventory.json",
  "rights_ledger.json",
  "director_beat_map.json",
  "render_manifest.json",
  "visual_v4_render.mp4",
  "audio_manifest.json",
  "sfx_manifest.json",
  "sfx_source_plan.json",
  "captions.srt",
  "platform_publish_manifest.json",
  "x_publish_pack.json",
  "instagram_publish_pack.json",
  "affiliate_link_manifest.json",
  "landing_page_manifest.json",
  "platform_policy_report.json",
  "benchmark_report.json",
  "coherence_report.json",
  "publish_verdict.json",
  "analytics_ingest_plan.json",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function objectHasKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function sourceNameFromStory(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  return cleanText(
    primary.name ||
      primary.label ||
      story.primary_source_name ||
      story.source_name ||
      story.source_label ||
      story.source_card_label ||
      story.thumbnail_source_label ||
      story.subreddit ||
      (typeof story.primary_source === "string" ? story.primary_source : ""),
  );
}

function sourceUrlFromStory(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  return cleanText(primary.url || story.primary_source_url || story.source_url || story.article_url || story.url);
}

function sourcePublishedAtFromStory(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  return cleanText(
    primary.published_at ||
      primary.publishedAt ||
      story.source_published_at ||
      story.published_at ||
      story.timestamp,
  );
}

function ageHoursFromIso(value, generatedAt) {
  const publishedMs = Date.parse(value || "");
  const generatedMs = Date.parse(generatedAt || "");
  if (!Number.isFinite(publishedMs) || !Number.isFinite(generatedMs)) return null;
  return Number(Math.max(0, (generatedMs - publishedMs) / 36e5).toFixed(2));
}

function uniqueClaims(values = []) {
  return values.filter((claim, index, arr) => arr.indexOf(claim) === index);
}

function buildFallbackSourceManifest(story = {}, generatedAt) {
  const name = sourceNameFromStory(story);
  const url = sourceUrlFromStory(story);
  const publishedAt = sourcePublishedAtFromStory(story);
  const ageHours = ageHoursFromIso(publishedAt, generatedAt);
  const fresh = ageHours !== null && ageHours <= 168;
  const coherent = Boolean(name && url);
  return {
    schema_version: 1,
    story_id: story.id || story.story_id || null,
    generated_at: generatedAt,
    primary_source: {
      name: name || null,
      url: url || null,
      type: cleanText(story.source_type || "official_or_major_source"),
      published_at: publishedAt || null,
      age_hours: ageHours,
    },
    source_age_policy_hours: 168,
    freshness_gate: fresh ? "pass" : "blocked",
    coherence_gate: coherent ? "pass" : "blocked",
    fallback_from_story_manifest: true,
    blockers: [
      ...(fresh ? [] : ["source_age_missing_or_over_7_days"]),
      ...(coherent ? [] : ["primary_source_name_or_url_missing"]),
    ],
  };
}

function buildFallbackClaimInventory(story = {}) {
  return {
    schema_version: 1,
    story_id: story.id || story.story_id || null,
    confirmed: uniqueClaims([
      ...asArray(story.claim_inventory?.confirmed),
      ...asArray(story.confirmed_claims),
    ]),
    unconfirmed: uniqueClaims([
      ...asArray(story.claim_inventory?.unconfirmed),
      ...asArray(story.unconfirmed_claims),
    ]),
    prohibited: uniqueClaims([
      ...asArray(story.claim_inventory?.prohibited),
      ...asArray(story.prohibited_claims),
    ]),
    fallback_from_story_manifest: true,
    public_copy_guardrails: [
      "viewer_facing_only",
      "no_internal_qa_language",
      "no_weak_fallback_narration",
      "approved_cta_only",
    ],
  };
}

function normaliseSignatureText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceFamilyFor(asset = {}, index = 0) {
  return (
    cleanText(asset.source_family) ||
    cleanText(asset.trusted_footage_source_id) ||
    cleanText(asset.source_id) ||
    cleanText(asset.id) ||
    `source_family_${index + 1}`
  );
}

function buildTrustedFootageReport(story = {}) {
  const clips = asArray(story.video_clips).length
    ? asArray(story.video_clips)
    : asArray(story.motion_clips);
  return {
    story_candidates: clips
      .filter((clip) => !isGeneratedMotionAsset(clip) && isRealMediaAsset(clip))
      .map((clip, index) => ({
        story_id: story.id || null,
        entity: story.canonical_subject || story.canonical_game || story.title || null,
        source_id: cleanText(clip.id || clip.asset_id || `clip_${index + 1}`),
        display_name: cleanText(clip.source_family || clip.source_type || "trusted source"),
        source_tier: /licensed/i.test(clip.rights_risk_class || "") ? "licensed_creator" : "official",
        source_family: sourceFamilyFor(clip, index),
        reference_url: cleanText(clip.source_url || clip.url || clip.path),
        source_url_kind: "web_page",
        segment_validation_eligible: false,
        autonomous_motion_candidate: true,
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: cleanText(clip.rights_risk_class) || "official_reference_only",
      })),
  };
}

function buildLocalMotionClips(story = {}) {
  const seen = new Set();
  return [
    ...asArray(story.video_clips),
    ...asArray(story.visual_v4_local_motion_clips),
  ]
    .filter((clip) => !isGeneratedMotionAsset(clip) && isRealMediaAsset(clip))
    .filter((clip) => {
      const key = [
        cleanText(clip.id || clip.asset_id),
        cleanText(clip.path || clip.local_path),
        cleanText(clip.source_url || clip.url),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((clip, index) => ({
      ...clip,
      id: cleanText(clip.id || clip.asset_id || `local_clip_${index + 1}`),
      source_family: sourceFamilyFor(clip, index),
      path: cleanText(clip.path || clip.local_path || `output/video/${story.id || "story"}_${index + 1}.mp4`),
      durationS: Number(clip.durationS || clip.duration_s || clip.duration || 2.4),
      validated: clip.validated !== false,
      type: "motion_clip",
    }));
}

function buildLocalTimeline(story = {}) {
  const script = cleanText(story.full_script || story.tts_script);
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
  return {
    duration_s: Math.max(35, Math.min(60, sentences.length * 6)),
    beats: sentences.slice(0, 8).map((sentence, index) => ({
      id: `beat_${index + 1}`,
      type: index === 0 ? "hook" : /\b\d|steam|score|price|\$/i.test(sentence) ? "metric" : "context",
      start: Number((index * 4.8).toFixed(2)),
      end: Number((index * 4.8 + 3.4).toFixed(2)),
      text: sentence,
    })),
  };
}

function buildAudioManifest({ story, soundPlan }) {
  const existing = objectHasKeys(story.audio_manifest) ? story.audio_manifest : {};
  return {
    ...existing,
    schema_version: 1,
    story_id: story.id || null,
    narration_audio_path: existing.narration_audio_path || story.audio_path || null,
    music_bed: existing.music_bed || "local_editorial_energy_bed",
    sfx_cue_count: existing.sfx_cue_count ?? soundPlan.sfx?.cue_count ?? 0,
    loudness_target: {
      ...(existing.loudness_target || {}),
      platform: "short_form_social",
      peak_db:
        existing.loudness_target?.peak_db ??
        soundPlan.sfx?.mastering?.target_peak_db ??
        -1.5,
      narration_priority: true,
    },
    mix_rules: existing.mix_rules || soundPlan.sfx?.mastering || {},
    safety: {
      ...(soundPlan.safety || {}),
      ...(existing.safety || {}),
    },
  };
}

function buildVisualQualityReport({ story, directorPlan, benchmark }) {
  return {
    schema_version: 1,
    story_id: story.id || null,
    result: benchmark.result || "unknown",
    scores: benchmark.scores || {},
    frame_rules: {
      first_frame_subject: story.canonical_subject || story.canonical_game || null,
      first_frame_text: story.suggested_thumbnail_text || null,
      source_locks_readable: directorPlan.visual_obligations?.source_locks_must_be_readable === true,
      no_empty_rectangles: directorPlan.visual_obligations?.forbid_empty_rectangles === true,
      no_text_on_text: directorPlan.visual_obligations?.forbid_text_on_text === true,
    },
    failures: benchmark.failures || [],
  };
}

function buildForensicQaReport({ scriptScorecard, footageInventory, directorPlan, benchmark, governanceReport }) {
  return {
    schema_version: 1,
    story_id: governanceReport.story_id || null,
    verdict:
      governanceReport.publish_control_tower?.verdict === "GREEN" &&
      !asArray(scriptScorecard.blockers).length
        ? "reviewable_proof"
        : "blocked_or_rewrite_required",
    checks: {
      public_output: governanceReport.public_output_coherence_gate?.result || "unknown",
      rights: governanceReport.rights_ledger?.verdict || "unknown",
      script: scriptScorecard.verdict || "unknown",
      footage: footageInventory.readiness?.status || "unknown",
      director: directorPlan.readiness?.status || "unknown",
      benchmark: benchmark.result || "unknown",
    },
    blockers: [
      ...asArray(governanceReport.rejection_reasons?.reason_codes),
      ...asArray(scriptScorecard.blockers),
      ...asArray(footageInventory.readiness?.blockers),
      ...asArray(directorPlan.readiness?.blockers),
      ...asArray(benchmark.failures),
    ],
  };
}

function buildSimpleCaptionSrt(script = "", durationS = 12) {
  const sentences = cleanText(script).split(/(?<=[.!?])\s+/).filter(Boolean);
  const lines = sentences.length ? sentences.slice(0, 10) : ["Pulse Gaming proof render."];
  const segment = Math.max(1.2, durationS / lines.length);
  return `${lines.map((line, index) => {
    const start = index * segment;
    const end = Math.min(durationS, start + segment);
    return [
      String(index + 1),
      `${formatSrtTime(start)} --> ${formatSrtTime(end)}`,
      line,
    ].join("\n");
  }).join("\n\n")}\n`;
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function ffmpegDrawtextEscape(value) {
  return cleanText(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function compactRenderText(value = "", fallback = "") {
  const text = cleanText(value || fallback).replace(/[^a-zA-Z0-9 $+&._-]+/g, "");
  return text.split(/\s+/).slice(0, 7).join(" ").toUpperCase();
}

const PLATFORM_NATIVE_ORDER = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "threads",
  "pinterest",
];

const PLATFORM_NATIVE_REQUIREMENTS = {
  youtube_shorts: [
    "title",
    "description",
    "hashtags",
    "cover_frame",
    "captions",
    "profile_or_landing_page_cta",
  ],
  tiktok: [
    "conversational_hook",
    "caption",
    "hashtags",
    "disclosure_flag",
    "commercial_content_setting_recommendation",
    "product_link_eligibility",
  ],
  instagram_reels: [
    "cover_frame",
    "caption",
    "carousel_companion.required",
    "story_poll_idea",
    "bio_link_cta",
  ],
  facebook_reels: [
    "page_caption",
    "link_routing_strategy",
    "duration_seconds",
    "explanatory_framing",
  ],
  x: [
    "hot_take_post",
    "source_safe_post",
    "thread_posts",
    "poll_candidate",
    "landing_page_link",
  ],
  threads: [
    "discussion_post",
    "duplicate_x_wording_allowed",
    "landing_page_link",
    "tone",
  ],
  pinterest: [
    "pin_title",
    "pin_description",
    "disclosure",
    "landing_page_link",
    "evergreen_only",
  ],
};

function slugify(value = "") {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "pulse-gaming-story";
}

function weakCanonicalSubject(value = "") {
  const text = cleanText(value);
  if (!text) return true;
  return (
    /^(?:this game|this story|gaming news|source-backed update|if you haven'?t reserved)\b/i.test(text) ||
    /\bdevelopment team included group\b/i.test(text)
  );
}

function inferSubjectFromHeadline(value = "") {
  const text = cleanText(value).replace(/(?:&#8217;|&rsquo;|’)/g, "'");
  if (!text) return "";
  const reserved = text.match(/^If\s+You\s+Haven'?t\s+Reserved\s+(?:A|An|The)?\s*(.+?)\s+Yet\b/i);
  if (reserved?.[1]) return cleanText(reserved[1]);
  const possessive = text.match(/^(.{2,60}?)['’]s\s+(?:development|developer|team|director|creator|composer|writer|producer)\b/i);
  if (possessive?.[1]) return cleanText(possessive[1]);
  const howMatch = text.match(/^How\s+([A-Z][A-Za-z0-9:+.-]+(?:\s+[A-Z][A-Za-z0-9:+.-]+){0,3})\s+(?:Paved|Made|Changed|Built|Created|Inspired|Turned|Became|Gets|Got|Has|Is|Was|Helped)\b/);
  if (howMatch?.[1]) return cleanText(howMatch[1]);
  return "";
}

function repairCanonicalSubject(rawSubject = "", story = {}, canonical = {}) {
  const subject = cleanText(rawSubject);
  if (!weakCanonicalSubject(subject)) return subject;
  const inferred = [
    canonical.canonical_title,
    canonical.title,
    canonical.selected_title,
    story.public_title,
    story.suggested_title,
    story.title,
  ]
    .map(inferSubjectFromHeadline)
    .find((candidate) => candidate && !weakCanonicalSubject(candidate));
  return inferred || subject;
}

function storySubject(story = {}, canonical = {}) {
  const subject = cleanText(
    canonical.canonical_subject ||
      canonical.canonical_game ||
      story.canonical_subject ||
      story.canonical_game ||
      story.public_title ||
      story.title,
  );
  return repairCanonicalSubject(subject, story, canonical);
}

function storyTitle(story = {}, canonical = {}) {
  return cleanText(
    canonical.selected_title ||
      canonical.canonical_title ||
      canonical.title ||
      story.public_title ||
      story.suggested_title ||
      story.title ||
      storySubject(story, canonical),
  );
}

function storyAngle(story = {}, canonical = {}) {
  return cleanText(canonical.canonical_angle || story.canonical_angle || story.angle || "");
}

const INTERNAL_ANGLE_RE = /\b(?:source_locked_update|source locked update)\b/i;
const LABEL_ANGLE_RE = /^(?:confirmed drop|source breakdown|rumou?r watch|news|review|source-backed update)$/i;
const HEADLINE_DANGLE_RE = /\b(?:a|an|the|of|for|to|into|with|without|has|have|had|is|are|was|were|make|makes|made|turns|turned|gets|get|got|feel|why|you|your|their|our)$/i;
const ARTICLE_BOILERPLATE_RE =
  /\b(?:appeared first on|advertisement|read our|read more|see at amazon|see on steam|we had the chance|at a recent press event)\b|https?:\/\/|&#\d+;|&nbsp;|\[&#\d+;\]/i;
const PLATFORM_HARD_DETAIL_RE =
  /\b(?:[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|demo|demos|storage|ssd|pc port|pc specs?|free access|free trial|free weekend|price|subscription|game pass|review score|release date|launch date|delay(?:ed)?|gameplay|early access|wait[- ]?list|pre[- ]?order|reservation|hollywood|movie|film|steam ceiling|spike|demand|momentum|safer seas|jump[- ]?scares?)\b/i;
const INTERNAL_REVIEW_PUBLIC_COPY_RE =
  /\b(?:real source detail,\s*but not enough practical consequence for a strong pulse short yet|needs one concrete player-facing detail|more than a feed item)\b/i;
const SHORT_FEED_QUALITY_PLATFORMS = new Set([
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSubjectPrefix(value = "", subject = "") {
  let text = cleanText(value).replace(/[.!?]+$/g, "");
  const subjectText = cleanText(subject);
  if (subjectText) {
    text = text.replace(new RegExp(`^${escapeRegExp(subjectText)}(?:['’]s)?\\s*[:,-]?\\s*`, "i"), "");
  }
  return cleanText(text);
}

function sentenceCaseFragment(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function usefulPublicAngle(value = "") {
  const text = cleanText(value).replace(/[.!?]+$/g, "");
  if (!text || INTERNAL_ANGLE_RE.test(text) || LABEL_ANGLE_RE.test(text) || ARTICLE_BOILERPLATE_RE.test(text)) return "";
  return text;
}

function publicAngleFor({ story = {}, canonical = {}, subject = "", title = "", firstLine = "" } = {}) {
  const explicitAngle = storyAngle(story, canonical);
  if (usefulPublicAngle(explicitAngle)) return explicitAngle;

  const candidates = [
    canonical.description,
    firstLine,
    title,
    canonical.confirmed_claims?.[0],
    story.claim,
  ];
  for (const candidate of candidates) {
    let fragment = stripSubjectPrefix(candidate, subject)
      .replace(/\bsource:\s*.+$/i, "")
      .replace(/\bsources and related links\b.*$/i, "")
      .trim();
    if (!usefulPublicAngle(fragment)) continue;
    const words = fragment.split(/\s+/).filter(Boolean);
    if (words.length >= 4 && words.length <= 18) return sentenceCaseFragment(fragment);
  }

  return "the update changes what players should check next";
}

function stripSourceAdmin(value = "") {
  return cleanText(value)
    .replace(/\b(?:confirmed drop|source-backed update)\b\.?/gi, "")
    .replace(/\bsource:\s*[^.]+\.?/gi, "")
    .replace(/\bsources and related links:\s*\S+\.?/gi, "")
    .replace(/\bfull source list is on the story page\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value = "") {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function stripArticleBoilerplate(value = "") {
  let text = cleanText(value)
    .replace(/\[?&#\d+;\]?/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const postMatch = text.match(/\bthe post\s+(.+?)\s+appeared first on\b/i);
  if (postMatch?.[1]) text = postMatch[1];
  return cleanText(text
    .replace(/\bappeared first on\s+[^.]+\.?/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\badvertisement\b.*$/i, "")
    .replace(/\bread our\b.*$/i, "")
    .replace(/\bread more\b.*$/i, "")
    .replace(/\bsee on steam\b.*$/i, "")
    .replace(/\bsee at amazon\b.*$/i, ""));
}

function sentenceCount(value = "") {
  return cleanText(value).split(/(?<=[.!?])\s+/).filter(Boolean).length;
}

function sourceSafeSocialBodyTooPlain(value = "") {
  const text = stripArticleBoilerplate(value);
  if (!text) return true;
  if (ARTICLE_BOILERPLATE_RE.test(value)) return true;
  if (wordCount(text) > 45) return true;
  if (wordCount(text) < 18) return true;
  if (
    sentenceCount(text) <= 1 &&
    /\b(?:requirements?|lists?|announced|revealed|gets?|got|coming|reported|confirmed|scores?)\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

function attentionBodyFromEvidence({ subject = "", angle = "", title = "", description = "", firstLine = "" } = {}) {
  const cleanAngle = stripArticleBoilerplate(angle).replace(/[.!?]+$/g, "");
  const cleanTitle = stripArticleBoilerplate(title).replace(/[.!?]+$/g, "");
  const cleanDescription = stripArticleBoilerplate(description).replace(/[.!?]+$/g, "");
  const evidenceText = cleanText([cleanTitle, cleanAngle, cleanDescription, firstLine].join(" "));
  const gb = evidenceText.match(/\b(\d{2,4})\s*GB\b/i);
  if (gb) {
    return `${subject} is asking players for ${gb[1]} GB before the campaign even starts. That turns storage into part of the launch pitch.`;
  }
  if (/\b(?:demo|demos|next fest|playable)\b/i.test(evidenceText)) {
    return `${subject} has one proof point players can judge immediately: the demo. It can win wishlists fast or expose the problem before launch.`;
  }
  if (/\b(?:paid early access|early[- ]access|steam demand|steam peak|steam spike|concurrent steam players?|premium week)\b/i.test(evidenceText)) {
    return `${subject} turned paid early access into a Steam demand test. The spike proves attention, but the real story is whether the cheaper launch wave holds.`;
  }
  if (/\b(?:ea play|game pass|ps plus|subscription)\b/i.test(evidenceText)) {
    return `${subject} just moved into a subscription, which changes the pitch from full-price risk to worth trying tonight.`;
  }
  if (/\b(?:free play days|free access|free weekend|try for free|free trial)\b/i.test(evidenceText)) {
    return `${subject} has a free-access risk tonight. Free only helps if players can tell fast whether one of these games is worth keeping installed.`;
  }
  if (/\bsafer seas\b/i.test(evidenceText)) {
    return `${subject} is testing safer seas as the entry-point tradeoff. It could make the game easier to try, but the risk is splitting what players expect from danger.`;
  }
  if (/\bjump[- ]?scares?\b/i.test(evidenceText)) {
    return `${subject} is selling horror without leaning on jump scares. The risk is simple: if the atmosphere does not work, the whole trailer loses its scare.`;
  }
  if (/\b(?:pc releases?|pc launch|multiplatform|business strategy|first-party|fully exclusive|single-player games)\b/i.test(evidenceText)) {
    return `${subject} has a PC port trust problem now. The document does not kill every port, but it changes what players should expect at launch.`;
  }
  const waitYear = evidenceText.match(/\b(20\d{2})\b/);
  if (/\b(?:wait until next year|reservation|reserved|queue|orders?|fulfilled|delivery window)\b/i.test(evidenceText)) {
    return `${subject} has a ${waitYear?.[1] || "new"} wait-list problem. Demand is the headline, but the real question is whether players still care by delivery day.`;
  }
  if (/\b(?:hollywood|movie|film|elden ring|a24)\b/i.test(evidenceText)) {
    return `${subject} has a Hollywood trust problem now. The story only matters if game fans can see why that studio legacy changes what reaches the screen.`;
  }
  if (/\b(?:retro|throwback|old-school|exploration|combat|discovery|square enix)\b/i.test(evidenceText)) {
    return `${subject} has a retro trust problem to solve. The style grabs attention, but players will judge whether combat, exploration and discovery still feel modern.`;
  }
  if (/\b(?:diana|android|character|child-like|companion|hugh|development team)\b/i.test(evidenceText)) {
    return `${subject} has a character trust problem now. The behind-the-scenes detail only matters if it makes players care about the story on screen.`;
  }
  if (/\bsurvival\b/i.test(evidenceText) && /\b(?:ps5|playstation|console)\b/i.test(evidenceText)) {
    return `${subject} is getting a real player test on PS5. The risk is whether the loop still works once console players judge it fast.`;
  }
  if (/\b(?:expansion|dlc|update|season|battle pass)\b/i.test(evidenceText)) {
    return `${subject} has a player-return problem to solve. More content only matters if it gives people a real reason to come back now.`;
  }
  if (/\b(?:delay|delayed|moved|avoids?|crowded)\b/i.test(evidenceText)) {
    return `${subject} just moved because the release calendar is getting crowded. That makes the timing as important as the game itself.`;
  }
  if (/\b(?:score|metacritic|review)\b/i.test(evidenceText)) {
    return `${subject} has a review momentum test now. The score gets attention, but the real question is whether players turn that number into hype.`;
  }
  if (/\b(?:deal|discount|sale|price|subscription|game pass|ps plus)\b/i.test(evidenceText)) {
    return `${subject} is not just another deal post. The price only matters if the timing makes it worth acting on.`;
  }
  const fallback = stripSubjectPrefix(
    cleanAngle || cleanTitle || cleanDescription || "what this changes for players next",
    subject,
  ).replace(/[.!?]+$/g, "");
  if (
    !fallback ||
    INTERNAL_ANGLE_RE.test(fallback) ||
    normaliseSignatureText(fallback) === normaliseSignatureText(subject) ||
    normaliseSignatureText(fallback) === normaliseSignatureText(cleanTitle)
  ) {
    return `${subject} needs one concrete player-facing detail before the hype makes sense. The next proof has to be footage, timing, price, platform access or a feature people can judge.`;
  }
  if (/^(?:is|are|has|have|needs?|gets?|got|just|will|can|could|should|makes?|turns?|moves?|takes?)\b/i.test(fallback)) {
    return `${subject} ${sentenceCaseFragment(fallback)}.`;
  }
  return `${subject} has a player-facing question now: ${fallback}.`;
}

function platformConsequenceLanguage(value = "") {
  return /\b(?:problem|risk|catch|warning|changed|broke|broken|revealed|confirmed|finally|pushback|why|before|after|ceiling|impact|cost|deal|launch|date|proof|payoff|trust|pressure|fight|bloat|dangerous|delete|wins?|timing|more than|handmade|leaked?|tactics?|xcom|exposes?|spike|peak|demand|bet)\b/i.test(
    cleanText(value),
  );
}

function platformAudiencePullLanguage(value = "") {
  const text = cleanText(value);
  if (!text) return false;
  const hasSpecificity =
    /\b(?:\d+|[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|one|only|first|last|free|paid|delay(?:ed)?|leak(?:ed)?|launch|ending|before|after|price|trial|demo|early[- ]access|steam peak|steam spike|steam demand)\b/i.test(text);
  const hasCuriosity =
    /\b(?:why|how|what|secret|hidden|real|catch|risk|problem|fight|pressure|warning|trust|ceiling|broke|turns?|changed|into|test|timing|more than|handmade|xcom|tactics?|exposes?|spike|peak|demand|bet)\b/i.test(text);
  return platformConsequenceLanguage(text) && (hasSpecificity || hasCuriosity);
}

function weakPlatformTitle(value = "", subject = "") {
  const title = cleanText(value);
  if (!title) return true;
  if (/^(?:if you haven'?t|this game|this story|gaming news update|source-backed update)\b/i.test(title)) return true;
  if (/^why\s+.+\s+could\s+split\s+players\b/i.test(title) && !PLATFORM_HARD_DETAIL_RE.test(title)) return true;
  if (/\bjust\s+changed\s+the\s+watchlist\b/i.test(title)) return true;
  if (/\bjust\s+changed\s+(?:its|the|a)?\s*[\w\s-]{0,40}\bsignal\b/i.test(title)) return true;
  if (/\bhas (?:a|an|one|the) [a-z0-9' -]{0,44}(?:player trust test|trust test|risk|problem|test)\b/i.test(title) && !PLATFORM_HARD_DETAIL_RE.test(title)) {
    return true;
  }
  if (/\b(?:scores?\s+\d+\s+on|everything we know|gets?\s+(?:a\s+)?(?:new|huge|big)\s+(?:update|trailer|date|score)|new trailer|review score|announced for)\b/i.test(title)) {
    return true;
  }
  if (cleanText(subject) && normaliseSignatureText(title) === normaliseSignatureText(subject)) return true;
  return !platformAudiencePullLanguage(title);
}

function attentionPlatformTitle({ subject = "", title = "", angle = "", description = "", firstLine = "" } = {}) {
  if (!weakPlatformTitle(title, subject)) return cleanText(title);
  const evidenceText = cleanText([title, angle, description, firstLine].join(" "));
  const gb = evidenceText.match(/\b(\d{2,4})\s*GB\b/i);
  if (gb) return `${subject} Has A ${gb[1]}GB Problem`;
  if (/\b(?:ea play|game pass|ps plus|subscription)\b/i.test(evidenceText)) {
    return `${subject} Has A Low-Risk Trial`;
  }
  if (/\b(?:free play days|free access|free weekend|try for free|free trial)\b/i.test(evidenceText)) {
    return `${subject} Has A Free-Access Risk`;
  }
  if (/\bsafer seas\b/i.test(evidenceText)) {
    return `${subject} Has A Safer Seas Risk`;
  }
  if (/\bjump[- ]?scares?\b/i.test(evidenceText)) {
    return `${subject} Has A Jump-Scare Risk`;
  }
  if (/\b(?:pc releases?|pc launch|multiplatform|business strategy|first-party|fully exclusive|single-player games)\b/i.test(evidenceText)) {
    return `${subject} Has A PC Port Trust Problem`;
  }
  const waitYear = evidenceText.match(/\b(20\d{2})\b/);
  if (/\b(?:wait until next year|reservation|reserved|queue|orders?|fulfilled|delivery window)\b/i.test(evidenceText)) {
    return `${subject} Has A ${waitYear?.[1] || "New"} Wait Problem`;
  }
  if (/\b(?:hollywood|movie|film|elden ring|a24)\b/i.test(evidenceText)) {
    return `${subject} Has A Hollywood Trust Problem`;
  }
  if (/\b(?:demo|demos|next fest|playable)\b/i.test(evidenceText)) {
    if (/\bnext fest\b/i.test(evidenceText)) return `${subject} Turns Demos Into A Fight`;
    return `${subject} Demo Is The Real Proof`;
  }
  if (/\b(?:retro|throwback|old-school|exploration|combat|discovery|square enix)\b/i.test(evidenceText)) {
    return `${subject} Has A Retro Trust Problem`;
  }
  if (/\b(?:more of an mmo|coexist as different experiences|different experiences|mmo than the first game)\b/i.test(evidenceText)) {
    return `${subject} Has An MMO Identity Fight`;
  }
  if (/\b(?:in-game millionaires|exploiting a system|exploiting system|loot hunt|grind for 100 hours|economy)\b/i.test(evidenceText)) {
    return `${subject} Has A Loot Economy Problem`;
  }
  if (/\b(?:genai|ai team\s*mates?|ai teammates?|team mates now|intelligent decision-making|bots for the military)\b/i.test(evidenceText)) {
    return `${subject} Has An AI Teammate Risk`;
  }
  if (/\b(?:diana|android|character|child-like|companion|hugh|development team)\b/i.test(evidenceText)) {
    return `${subject} Has A Character Trust Problem`;
  }
  if (/\bsurvival\b/i.test(evidenceText) && /\b(?:ps5|playstation|console)\b/i.test(evidenceText)) {
    return `${subject} Has A PS5 Survival Risk`;
  }
  if (/\b(?:deal|discount|sale|price|reserved?|reservation|preorder|pre-order)\b/i.test(evidenceText)) {
    return `${subject} Has A Price Timing Risk`;
  }
  if (/\b(?:expansion|dlc|update|season|battle pass)\b/i.test(evidenceText)) {
    return `${subject} Has A Player-Return Problem`;
  }
  if (/\b(?:delay|delayed|moved|avoids?|crowded)\b/i.test(evidenceText)) {
    return `${subject} Just Dodged A Release-Date Fight`;
  }
  if (/\b(?:score|metacritic|review)\b/i.test(evidenceText)) {
    return `${subject} Has A Review Momentum Problem`;
  }
  return `Why ${subject} Could Split Players`;
}

function platformAttentionDescription({ canonical = {}, subject = "", angle = "", sourceLine = "", title = "", firstLine = "" } = {}) {
  const description = stripSourceAdmin(canonical.description || "");
  const evidenceText = cleanText([description, angle, title, firstLine].join(" "));
  const forceAttentionBody =
    /\b(?:pc releases?|pc launch|multiplatform|business strategy|first-party|fully exclusive|single-player games)\b/i.test(
      evidenceText,
    );
  const body = !forceAttentionBody && usefulPublicAngle(description) && !sourceSafeSocialBodyTooPlain(description) && platformAudiencePullLanguage(description)
    ? description
    : attentionBodyFromEvidence({ subject, angle, title, description, firstLine });
  return cleanText(`${body.replace(/[.!?]+$/g, "")}. ${sourceLine}`);
}

function headlineTokens(value = "") {
  return cleanText(value)
    .replace(/[:]/g, " ")
    .replace(/[^a-zA-Z0-9+-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function compactSubjectHeadline(subject = "") {
  const tokens = headlineTokens(subject);
  const lower = tokens.map((token) => token.toLowerCase());
  if (lower.includes("gears") && lower.some((token) => token === "day" || token === "e-day" || token === "eday")) {
    return "GEARS E-DAY";
  }
  if (lower.includes("steam") && lower.includes("next") && lower.includes("fest")) return "STEAM NEXT FEST";
  if (lower.includes("steam") && lower.includes("controller")) return "STEAM CONTROLLER";
  if (lower.includes("steam") && lower.includes("deck")) return "STEAM DECK";
  if (lower.includes("steam")) return "STEAM";
  if (lower.includes("playstation") || lower.includes("ps5")) return "PS5";
  if (lower.includes("xbox")) return "XBOX";
  return tokens
    .filter((token) => !/^(?:of|the|a|an|if|you|haven'?t|havent|reserved?|yet)$/i.test(token))
    .slice(0, 3)
    .join(" ")
    .toUpperCase();
}

function weakCoverHeadline(value = "", subject = "") {
  const text = cleanText(value);
  if (!text) return true;
  const tokens = headlineTokens(text);
  if (tokens.length > 6) return true;
  if (/^(?:why|how|what|when|where)\b/i.test(text) && tokens.length > 4) return true;
  if (/\bcould\s+split\s+players\b/i.test(text)) return true;
  if (/^(?:if you haven'?t|this game|this story)\b/i.test(text)) return true;
  if (/\b(?:story test|just got a new signal|now has a real question|new reason to watch|changed the watchlist)\b/i.test(text)) return true;
  if (
    /\b(?:trust test|demo test|source lock|story guide|gameplay check|review score|update check)\b/i.test(text) &&
    !PLATFORM_HARD_DETAIL_RE.test(text)
  ) return true;
  if (/\b(?:player\s+)?trust\s+(?:test|problem)|player test\b/i.test(text) && !PLATFORM_HARD_DETAIL_RE.test(text)) {
    return true;
  }
  if (cleanText(subject) && normaliseSignatureText(text) === normaliseSignatureText(subject)) return true;
  if (HEADLINE_DANGLE_RE.test(text)) return true;
  return tokens.length <= 3 && !/\b(?:risk|test|fight|trust|bloat|danger|pressure|problem|wins?|demo|spike|demand|momentum|ceiling)\b/i.test(text);
}

function attentionCoverHeadline({ canonical = {}, story = {}, subject = "", title = "", angle = "", firstLine = "" } = {}) {
  const subjectHead = compactSubjectHeadline(subject);
  const evidenceText = cleanText([
    title,
    angle,
    canonical.description,
    firstLine,
  ].join(" "));
  const gb = evidenceText.match(/\b(\d{2,4})\s*GB\b/i);
  if (gb) return `${subjectHead} ${gb[1]}GB TEST`;
  if (/\b(?:ea play|game pass|ps plus|subscription)\b/i.test(evidenceText)) return `${subjectHead} TRIAL TEST`;
  if (/\b(?:free play days|free access|free weekend|try for free|free trial)\b/i.test(evidenceText)) return `${subjectHead} FREE RISK`;
  if (/\bsafer seas\b/i.test(evidenceText)) return "SAFER SEAS RISK";
  if (/\bjump[- ]?scares?\b/i.test(evidenceText)) return `${subjectHead} JUMP SCARE RISK`;
  if (/\b(?:pc releases?|pc launch|multiplatform|business strategy|first-party|fully exclusive|single-player games)\b/i.test(evidenceText)) {
    const pcSubjectHead = /\bplaystation\b/i.test(subject) ? "PLAYSTATION PC" : `${subjectHead} PC`;
    return `${pcSubjectHead} TRUST`;
  }
  if (/\b(?:paid early access|early[- ]access|steam demand|steam peak|steam spike|concurrent steam players?|premium week)\b/i.test(evidenceText)) {
    return `${subjectHead} STEAM SPIKE`;
  }
  if (/\b(?:wait until next year|reservation|reserved|queue|orders?|fulfilled|delivery window)\b/i.test(evidenceText)) return `${subjectHead} WAIT PROBLEM`;
  if (/\b(?:hollywood|movie|film|elden ring|a24)\b/i.test(evidenceText)) return `${subjectHead} TRUST PROBLEM`;
  if (/\b(?:retro|throwback|old-school|exploration|combat|discovery|square enix)\b/i.test(evidenceText)) return `${subjectHead} TRUST PROBLEM`;
  if (/\b(?:more of an mmo|coexist as different experiences|different experiences|mmo than the first game)\b/i.test(evidenceText)) return `${subjectHead} MMO IDENTITY`;
  if (/\b(?:in-game millionaires|exploiting a system|exploiting system|loot hunt|grind for 100 hours|economy)\b/i.test(evidenceText)) return `${subjectHead} LOOT ECONOMY`;
  if (/\b(?:genai|ai team\s*mates?|ai teammates?|team mates now|intelligent decision-making|bots for the military)\b/i.test(evidenceText)) return `${subjectHead} AI TEAMMATE`;
  if (/\b(?:diana|android|character|child-like|companion|hugh|development team)\b/i.test(evidenceText)) return `${subjectHead} TRUST PROBLEM`;
  if (/\bsurvival\b/i.test(evidenceText) && /\b(?:ps5|playstation|console)\b/i.test(evidenceText)) return "PS5 SURVIVAL RISK";
  if (/\bdemos?\b/i.test(evidenceText) && /\btrust\b/i.test(evidenceText)) {
    return subjectHead === "STEAM NEXT FEST" ? "STEAM DEMO FIGHT" : `${subjectHead} DEMO FIGHT`;
  }
  if (/\bdemos?\b/i.test(evidenceText)) return `${subjectHead} DEMO RISK`;
  if (/\btrust\b/i.test(evidenceText)) return `${subjectHead} TRUST PROBLEM`;
  if (/\b(?:deal|discount|sale|price|reserved?|reservation|preorder|pre-order)\b/i.test(evidenceText)) return `${subjectHead} PRICE RISK`;
  if (/\b(?:expansion|dlc|update|season|battle pass)\b/i.test(evidenceText)) return `${subjectHead} RETURN RISK`;
  if (/\b(?:score|metacritic|review)\b/i.test(evidenceText)) return `${subjectHead} MOMENTUM RISK`;
  if (/\bdangerous?\b/i.test(evidenceText)) return `${subjectHead} FEELS DANGEROUS`;
  if (/\bbloat\b/i.test(evidenceText)) return `${subjectHead} OR BLOAT`;
  for (const candidate of [canonical.thumbnail_headline, story.suggested_thumbnail_text, title]) {
    const text = cleanText(candidate)
      .split(/\s+/)
      .slice(0, 8)
      .join(" ")
      .toUpperCase();
    if (!weakCoverHeadline(text, subject)) return text;
  }
  return `${subjectHead} PLAYER TEST`;
}

function canonicalAttentionCopy(canonical = {}, story = {}) {
  const subject = storySubject(story, canonical);
  const rawTitle = storyTitle(story, canonical);
  const firstLine = storyFirstLine(story, canonical);
  const angle = publicAngleFor({ story, canonical, subject, title: rawTitle, firstLine });
  const title = attentionPlatformTitle({
    subject,
    title: rawTitle,
    angle,
    description: canonical.description,
    firstLine,
  });
  const headline = attentionCoverHeadline({ canonical, story, subject, title, angle, firstLine });
  return {
    ...canonical,
    canonical_subject: subject,
    canonical_game: weakCanonicalSubject(canonical.canonical_game) ? subject : canonical.canonical_game || subject,
    selected_title: title,
    canonical_title: title,
    title,
    public_title: title,
    thumbnail_headline: headline,
    thumbnail_text: headline,
    suggested_thumbnail_text: headline,
    first_frame_text: cleanText(canonical.first_frame_text) || headline,
  };
}

function storySourceName(story = {}, canonical = {}) {
  const source = canonical.primary_source || story.primary_source || story.source_name;
  if (source && typeof source === "object") return cleanText(source.name || source.label || source.url);
  return cleanText(source || story.source_card_label || story.thumbnail_source_label || "source");
}

function storyFirstLine(story = {}, canonical = {}) {
  return cleanText(
    canonical.first_spoken_line ||
      story.hook ||
      cleanText(story.full_script || story.tts_script).split(/(?<=[.!?])\s+/)[0] ||
      storyTitle(story, canonical),
  );
}

function storyDisclosure(affiliateManifest = {}) {
  const required = affiliateManifest.disclosure_required === true ||
    Boolean(affiliateManifest.primary_link);
  return {
    required,
    type: required ? "affiliate" : "none",
    caption: required ? "Affiliate links may earn us a commission." : "No commercial link attached.",
  };
}

function landingRouteFor(story = {}, canonical = {}, landingPage = {}) {
  const slug = cleanText(
    landingPage.landing_page_slug ||
      landingPage.slug ||
      story.landing_page_slug ||
      `${storySubject(story, canonical)} ${story.id || ""}`,
  );
  return `/p/${slugify(slug)}`;
}

function buildHashtags(story = {}, canonical = {}) {
  const subject = storySubject(story, canonical).toLowerCase();
  const tags = ["#GamingNews", "#PulseGaming"];
  if (/\bxbox|forza|game pass\b/i.test(subject)) tags.push("#Xbox");
  if (/\bplaystation|ps5\b/i.test(subject)) tags.push("#PlayStation");
  if (/\bnintendo|switch\b/i.test(subject)) tags.push("#Nintendo");
  if (/\bsteam|pc\b/i.test(subject)) tags.push("#PCGaming");
  return [...new Set(tags)];
}

function mergePlatformOutput(base = {}, additions = {}) {
  return {
    ...base,
    ...additions,
    duration_seconds: additions.duration_seconds || base.duration_seconds,
    strategic_duration_seconds: base.duration_seconds || additions.duration_seconds,
  };
}

function buildPlatformNativePublishPacks({
  story = {},
  canonical = {},
  platformOutputs = {},
  affiliateManifest = {},
  landingPage = {},
} = {}) {
  const subject = storySubject(story, canonical);
  const rawTitle = storyTitle(story, canonical);
  const firstLine = storyFirstLine(story, canonical);
  const angle = publicAngleFor({ story, canonical, subject, title: rawTitle, firstLine });
  const title = attentionPlatformTitle({
    subject,
    title: rawTitle,
    angle,
    description: canonical.description,
    firstLine,
  });
  const sourceName = storySourceName(story, canonical);
  const landingPageLink = landingRouteFor(story, canonical, landingPage);
  const disclosure = storyDisclosure(affiliateManifest);
  const headline = attentionCoverHeadline({ canonical, story, subject, title, angle, firstLine });
  const hashtags = buildHashtags(story, canonical);
  const shortAngle = angle || "the latest story behind the headline";
  const sourceLine = `Source: ${sourceName}.`;
  const attentionDescription = platformAttentionDescription({
    canonical,
    subject,
    angle: shortAngle,
    sourceLine,
    title,
    firstLine,
  });
  const formatFamily = platformStoryFormatFamily({ subject, title, angle: shortAngle, affiliateManifest });
  const outputs = {
    youtube_shorts: mergePlatformOutput(platformOutputs.youtube_shorts, {
      platform: "youtube_shorts",
      native_role: "searchable_short",
      title,
      description: attentionDescription,
      hashtags,
      cover_frame: {
        headline,
        subject,
        source_label: sourceName,
      },
      captions: {
        file: "captions.srt",
        clean_manual_captions_required: true,
      },
      cta: `${PRIMARY_PULSE_CTA}.`,
      disclosure_status: disclosure,
      profile_or_landing_page_cta: `Story sources and related links: ${landingPageLink}`,
      link_strategy: "profile_link_or_related_video_for_shorts",
      cta_style: "identity_follow",
    }),
    tiktok: mergePlatformOutput(platformOutputs.tiktok, {
      platform: "tiktok",
      native_role: "conversation_first_short",
      conversational_hook: firstLine,
      caption: attentionDescription,
      hashtags: [...hashtags, "#GamingTok"],
      disclosure_flag: disclosure.required ? "commercial_content_disclosure_required" : "not_required",
      commercial_content_setting_recommendation: disclosure.required
        ? "required_for_affiliate_or_brand_promotion"
        : "not_required_unless_brand_or_product_promoted",
      product_link_eligibility: affiliateManifest.primary_link ? "review_required" : "not_used",
      link_strategy: "bio_or_product_link_when_enabled",
      cta_style: "source_context",
    }),
    instagram_reels: mergePlatformOutput(platformOutputs.instagram_reels, {
      platform: "instagram_reels",
      native_role: "cover_first_reel_plus_carousel",
      cover_frame: {
        headline,
        text_word_limit: 7,
        source_label: sourceName,
      },
      caption: attentionDescription,
      carousel_companion: {
        required: true,
        cards: ["cover", "source", "player impact", "related links"],
      },
      story_poll_idea: `Does ${subject} change your watchlist?`,
      bio_link_cta: `Story page in bio: ${landingPageLink}`,
      disclosure_status: disclosure,
      cta_style: "bio_link",
    }),
    facebook_reels: mergePlatformOutput(platformOutputs.facebook_reels, {
      platform: "facebook_reels",
      native_role: "context_first_reel",
      explanatory_framing: `${subject} matters because ${shortAngle}.`,
      page_caption: `${attentionDescription} More context: ${landingPageLink}`,
      link_routing_strategy: "page_caption_or_comment_link",
      disclosure_status: disclosure,
      cta_style: "context_link",
    }),
    x: mergePlatformOutput(platformOutputs.x, {
      platform: "x",
      native_role: "headline_source_post",
      hot_take_post: `${subject} is the part of this story everyone will argue about: ${shortAngle}.`,
      source_safe_post: `${title}\n\n${sourceLine} Full source list: ${landingPageLink}`,
      concise_news_post: `${subject}: ${shortAngle}.`,
      thread_posts: [
        title,
        `${sourceLine} The confirmed angle is ${shortAngle}.`,
        "Watch whether this changes price, access, trust or timing.",
        `Sources and related links: ${landingPageLink}`,
      ],
      poll_candidate: `Is ${subject} a buy-now story or a wait-for-reviews story?`,
      landing_page_link: landingPageLink,
      cta_style: "source_first_link",
    }),
    threads: {
      platform: "threads",
      native_role: "soft_discussion_post",
      discussion_post: `${subject} is worth watching for the player impact, not just the headline. ${sourceLine}`,
      duplicate_x_wording_allowed: false,
      tone: "discussion-led and source-safe",
      landing_page_link: landingPageLink,
      disclosure_status: disclosure,
      cta_style: "soft_discussion",
    },
    pinterest: {
      platform: "pinterest",
      native_role: "evergreen_pin_only",
      pin_title: `${subject} story guide`,
      pin_description: `${subject}: ${shortAngle}. Sources, related links and safer buying routes are on the story page.`,
      evergreen_only: true,
      disclosure: disclosure.caption,
      affiliate_disclosure_required: disclosure.required,
      landing_page_required: true,
      landing_page_link: landingPageLink,
      cta_style: "evergreen_story_page",
    },
  };
  const platformNativeEvidence = buildPlatformNativeEvidence(outputs, { formatFamily });
  return { outputs, platformNativeEvidence };
}

function valueAtPath(object = {}, pathExpression = "") {
  return pathExpression.split(".").reduce((current, key) => {
    if (current == null) return undefined;
    return current[key];
  }, object);
}

function hasEvidenceValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "boolean") return true;
  return cleanText(value).length > 0;
}

function copyFingerprintForPlatform(platform, pack = {}) {
  const copyFields = {
    youtube_shorts: ["title", "description", "profile_or_landing_page_cta"],
    tiktok: ["conversational_hook", "caption"],
    instagram_reels: ["caption", "story_poll_idea"],
    facebook_reels: ["page_caption", "explanatory_framing"],
    x: ["hot_take_post", "source_safe_post"],
    threads: ["discussion_post"],
    pinterest: ["pin_title", "pin_description"],
  };
  return asArray(copyFields[platform])
    .map((field) => cleanText(valueAtPath(pack, field)))
    .join(" ")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\/p\/[a-z0-9-]+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectBlindDuplicatePairs(outputs = {}) {
  const fingerprints = new Map();
  const duplicates = [];
  for (const platform of PLATFORM_NATIVE_ORDER) {
    const fingerprint = copyFingerprintForPlatform(platform, outputs[platform]);
    if (!fingerprint) continue;
    const previous = fingerprints.get(fingerprint);
    if (previous) {
      duplicates.push({
        platforms: [previous, platform],
        reason: "exact_public_copy_fingerprint_match",
      });
    } else {
      fingerprints.set(fingerprint, platform);
    }
  }
  return duplicates;
}

function platformStoryFormatFamily({ subject = "", title = "", angle = "", affiliateManifest = {} } = {}) {
  const text = cleanText([subject, title, angle].join(" ")).toLowerCase();
  if (/\b(?:controller|headset|keyboard|mouse|monitor|hardware|accessory|steam deck)\b/.test(text)) {
    if (/\b(?:deal|price|sale|discount|drops? to|bundle)\b/.test(text)) return "hardware_deal_watch";
    if (/\b(?:date|release|launch|leak|leaked|reportedly|may have)\b/.test(text)) return "hardware_release_watch";
    return "hardware_accessory_watch";
  }
  if (/\b(?:xcom|tactic|tactical|strategy comparison|more than)\b/.test(text)) {
    return "tactics_comparison";
  }
  if (/\b(?:ai[-\s]?look|handmade|hand made|crafted|art direction|production process)\b/.test(text)) {
    return "creative_process";
  }
  if (/\b(?:devs? are making|developer.*making|studio.*working|next game|new project)\b/.test(text)) {
    return "studio_project_watch";
  }
  if (/\b(?:eras?|timeline|generations?|five eras|history)\b/.test(text)) {
    return "timeline_showcase";
  }
  if (/\b(?:gameplay|hands[-\s]?on|preview|trailer|demo|shown|shows)\b/.test(text)) {
    return "gameplay_showcase";
  }
  if (/\b(?:leak|leaked|reportedly|rumou?r|claimed|may have)\b/.test(text)) {
    return /\b(?:date|release|launch)\b/.test(text) ? "release_date_watch" : "leak_watch";
  }
  if (/\b(?:drops? to|deal|discount|price|sale|bundle|subscription|game pass)\b/.test(text)) {
    return "game_price_watch";
  }
  if (/\b(?:metacritic|opencritic|review|score|rated)\b/.test(text)) return "review_score";
  if (/\b(?:playstation|ps5|xbox|switch|steam)\b/.test(text)) return "platform_access";
  if (/\b(?:jobs?|layoff|composer|studio|developer|publisher|business)\b/.test(text)) return "industry_business";
  if (affiliateManifest.primary_link || asArray(affiliateManifest.fallback_links).length) return "commercial_context";
  return "source_brief";
}

function buildPlatformFormatSignature(outputs = {}, { formatFamily = "source_brief" } = {}) {
  const instagramCards = asArray(outputs.instagram_reels?.carousel_companion?.cards).join(">");
  const xThreadCount = asArray(outputs.x?.thread_posts).length;
  const roles = PLATFORM_NATIVE_ORDER
    .map((platform) => `${platform}:${cleanText(outputs[platform]?.native_role)}`)
    .join("|");
  return normaliseSignatureText(`${formatFamily}|ig:${instagramCards}|x_thread:${xThreadCount}|${roles}`);
}

function platformNativeQualityFailures(outputs = {}) {
  const failures = [];
  for (const platform of PLATFORM_NATIVE_ORDER) {
    if (!SHORT_FEED_QUALITY_PLATFORMS.has(platform)) continue;
    const pack = outputs[platform] || {};
    const subject = cleanText(pack.cover_frame?.subject || pack.subject || pack.pin_title || "");
    const title = cleanText(pack.title || pack.pin_title || pack.conversational_hook || "");
    const coverHeadline = cleanText(pack.cover_frame?.headline || pack.thumbnail_headline || "");
    const publicCopy = cleanText([
      pack.description,
      pack.caption,
      pack.page_caption,
      pack.explanatory_framing,
      pack.hot_take_post,
      pack.source_safe_post,
      pack.concise_news_post,
      pack.discussion_post,
      pack.pin_description,
    ].filter(Boolean).join(" "));
    const qualityBody = platform === "facebook_reels"
      ? cleanText((pack.page_caption || pack.explanatory_framing || "").replace(/\s*More context:\s*\S+\s*$/i, ""))
      : publicCopy;

    if (title && weakPlatformTitle(title, subject)) {
      failures.push({ platform, reason: "weak_platform_title" });
    }
    if (coverHeadline && weakCoverHeadline(coverHeadline, subject)) {
      failures.push({ platform, reason: "weak_cover_headline" });
    }
    if (INTERNAL_REVIEW_PUBLIC_COPY_RE.test(publicCopy)) {
      failures.push({ platform, reason: "internal_review_language_in_public_copy" });
    }
    if (sourceSafeSocialBodyTooPlain(qualityBody)) {
      failures.push({ platform, reason: "plain_platform_description" });
    }
  }
  return failures;
}

function buildPlatformNativeEvidence(outputs = {}, options = {}) {
  const platforms = PLATFORM_NATIVE_ORDER.map((platform) => {
    const pack = outputs[platform] || {};
    const requiredFields = PLATFORM_NATIVE_REQUIREMENTS[platform] || [];
    const missingFields = requiredFields.filter((field) => !hasEvidenceValue(valueAtPath(pack, field)));
    return {
      platform,
      status: missingFields.length ? "fail" : "pass",
      native_role: pack.native_role || null,
      duration_strategy: pack.duration_strategy || pack.pacing || null,
      cta_style: pack.cta_style || null,
      link_strategy: pack.link_strategy || pack.link_routing_strategy || null,
      required_fields: requiredFields,
      missing_fields: missingFields,
      copy_fingerprint: copyFingerprintForPlatform(platform, pack),
    };
  });
  const blindDuplicatePairs = detectBlindDuplicatePairs(outputs);
  const qualityFailures = platformNativeQualityFailures(outputs);
  const failures = [
    ...platforms
      .filter((item) => item.status !== "pass")
      .map((item) => ({
        platform: item.platform,
        reason: "missing_native_fields",
        missing_fields: item.missing_fields,
      })),
    ...blindDuplicatePairs.map((item) => ({
      platform: item.platforms.join("+"),
      reason: item.reason,
    })),
    ...qualityFailures,
  ];
  return {
    schema_version: 1,
    verdict: failures.length ? "fail" : "pass",
    format_signature: buildPlatformFormatSignature(outputs, options),
    format_family: options.formatFamily || "source_brief",
    platforms,
    blind_duplicate_pairs: blindDuplicatePairs,
    failures,
    rule: "Each platform pack must carry its own role, copy shape, CTA and link strategy.",
  };
}

function buildLandingPageManifest({
  story = {},
  canonical = {},
  enterpriseLandingPage = {},
  affiliateManifest = {},
} = {}) {
  const route =
    affiliateManifest.landing_page_route ||
    enterpriseLandingPage.landing_page_route ||
    enterpriseLandingPage.route ||
    landingRouteFor(story, canonical, enterpriseLandingPage);
  const slug =
    affiliateManifest.landing_page_slug ||
    enterpriseLandingPage.landing_page_slug ||
    enterpriseLandingPage.slug ||
    route.replace(/^\/p\//, "");

  return {
    ...enterpriseLandingPage,
    schema_version: enterpriseLandingPage.schema_version || 1,
    story_id: story.id || affiliateManifest.story_id || null,
    landing_page_slug: slug,
    landing_page_route: route,
    link_pack: {
      primary_link: affiliateManifest.primary_link || null,
      fallback_links: asArray(affiliateManifest.fallback_links),
      source_links: asArray(affiliateManifest.source_links),
      affiliate_tracking_map: affiliateManifest.affiliate_tracking_map || null,
    },
    disclosure_block: {
      required: Boolean(affiliateManifest.disclosure_required),
      copy: affiliateManifest.disclosure_copy || null,
      source_first: true,
    },
    tracking_utm: affiliateManifest.tracking_utm || null,
    attribution_manifest: affiliateManifest.landing_page_attribution || null,
    revenue_tracking: affiliateManifest.revenue_attribution || null,
    safety: {
      ...(enterpriseLandingPage.safety || {}),
      story_page_before_offer: true,
      no_direct_social_posting: true,
    },
  };
}

async function writeLocalProofMp4(filePath, pack = {}) {
  await fs.ensureDir(path.dirname(filePath));
  const subject = compactRenderText(
    pack.canonical_story_manifest?.canonical_subject || pack.story_id,
    "PULSE GAMING",
  );
  const headline = compactRenderText(
    pack.canonical_story_manifest?.thumbnail_headline ||
      pack.canonical_story_manifest?.selected_title ||
      pack.story_id,
    "SOURCE-BACKED STORY",
  );
  const source = compactRenderText(
    pack.canonical_story_manifest?.primary_source?.name ||
      pack.source_manifest?.primary_source?.name ||
      "VERIFIED SOURCE",
    "VERIFIED SOURCE",
  );
  const fontOpt = "fontfile='C\\:/Windows/Fonts/arial.ttf'";
  const filter = [
    "scale=1080:1920",
    "format=yuv420p",
    "noise=alls=5:allf=t",
    "drawbox=x=0:y=0:w=iw:h=260:color=black@0.55:t=fill",
    "drawbox=x=60:y=690:w=960:h=250:color=0xFF6B1A@0.90:t=fill",
    `drawtext=${fontOpt}:text='${ffmpegDrawtextEscape(subject)}':fontcolor=0xFF6B1A:fontsize=52:x=64:y=72`,
    `drawtext=${fontOpt}:text='${ffmpegDrawtextEscape(source)}':fontcolor=white:fontsize=34:x=64:y=148`,
    `drawtext=${fontOpt}:text='${ffmpegDrawtextEscape(headline)}':fontcolor=black:fontsize=64:x=(w-tw)/2:y=770`,
    `drawtext=${fontOpt}:text='PULSE GAMING':fontcolor=white@0.72:fontsize=34:x=w-tw-58:y=h-112`,
  ].join(",");
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x101114:size=1080x1920:rate=30:duration=2.4",
    "-vf",
    filter,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-movflags",
    "+faststart",
    filePath,
  ]);
  return filePath;
}

function buildAcceptanceEntry({
  story,
  scriptScorecard,
  footageInventory,
  directorBeatMap,
  benchmarkReport,
  governanceReport,
  platformNativeEvidence,
} = {}) {
  const blockers = [];
  if (governanceReport.publish_control_tower?.verdict !== "GREEN") {
    blockers.push(`governance:${governanceReport.publish_control_tower?.verdict || "unknown"}`);
  }
  if (scriptScorecard.verdict === "rewrite_required" || asArray(scriptScorecard.blockers).length) {
    blockers.push(`script:${scriptScorecard.verdict || "blocked"}`);
  }
  if (footageInventory.readiness?.status !== "v4_motion_ready") {
    blockers.push(`footage:${footageInventory.readiness?.status || "unknown"}`);
  }
  if (directorBeatMap.readiness?.status !== "director_ready") {
    blockers.push(`director:${directorBeatMap.readiness?.status || "unknown"}`);
  }
  if (!["pass"].includes(benchmarkReport.result)) {
    blockers.push(`benchmark:${benchmarkReport.result || "unknown"}`);
  }
  blockers.push(...platformNativeBlockers(platformNativeEvidence));
  return {
    story_id: story.id || null,
    verdict: blockers.length ? "RED" : "GREEN",
    blockers: [...new Set(blockers)],
    artefacts: ACCEPTANCE_ARTEFACTS,
  };
}

function blockerToken(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function platformNativeBlockers(platformNativeEvidence = {}) {
  if (!platformNativeEvidence || typeof platformNativeEvidence !== "object") return [];
  const failures = asArray(platformNativeEvidence.failures)
    .map((failure) => {
      const platform = blockerToken(failure.platform || "unknown_platform");
      const reason = blockerToken(failure.reason || "native_pack_failed");
      return platform && reason ? `platform_native:${platform}:${reason}` : "";
    })
    .filter(Boolean);
  if (failures.length) return [...new Set(failures)];
  if (cleanText(platformNativeEvidence.verdict).toLowerCase() === "fail") {
    return ["platform_native:fail"];
  }
  return [];
}

function audioQualityBlockers(audioManifest = {}) {
  const blockers = [];
  const approvedVoicePath =
    audioManifest.approved_voice_path ||
    audioManifest.approvedVoicePath ||
    audioManifest.voice_path ||
    audioManifest.voicePath ||
    audioManifest.narration?.approved_voice_path ||
    audioManifest.narration?.approvedVoicePath ||
    {};
  const narration = audioManifest.narration || {};
  const generation = audioManifest.generation || narration.generation || {};
  const tempoStretch =
    audioManifest.tempo_stretch ||
    audioManifest.tempoStretch ||
    generation.tempo_stretch ||
    generation.tempoStretch ||
    {};

  blockers.push(
    ...asArray(audioManifest.blockers),
    ...asArray(audioManifest.audio_blockers),
    ...asArray(audioManifest.quality_blockers),
    ...asArray(narration.blockers),
    ...asArray(approvedVoicePath.blockers),
  );

  const voiceVerdict = cleanText(approvedVoicePath.verdict || approvedVoicePath.status).toLowerCase();
  if (
    voiceVerdict &&
    /(?:rejected|red|fail|failed|blocked)/.test(voiceVerdict) &&
    !asArray(approvedVoicePath.blockers).length
  ) {
    blockers.push("approved_voice_path_not_approved");
  }
  if (tempoStretch.applied === true) blockers.push("local_tts_tempo_stretch_applied");

  const rate =
    Number(generation.rate) ||
    Number(generation.speaking_rate) ||
    Number(narration.meta?.voiceSettings?.speaking_rate) ||
    Number(audioManifest.meta?.voiceSettings?.speaking_rate);
  if (Number.isFinite(rate) && rate > 0 && Math.abs(rate - 1) > 0.001) {
    blockers.push("local_tts_non_native_rate_applied");
  }

  return [...new Set(blockers.map(cleanText).filter(Boolean))];
}

function buildPackagePublishVerdict({
  publishControlTower = {},
  scriptScorecard = {},
  audioManifest = {},
  footageInventory = {},
  directorBeatMap = {},
  benchmarkReport = {},
  platformNativeEvidence = {},
} = {}) {
  const base = publishControlTower && typeof publishControlTower === "object"
    ? { ...publishControlTower }
    : {};
  const reasonCodes = asArray(base.reason_codes);
  const warnings = asArray(base.warnings);
  const scriptVerdict = cleanText(scriptScorecard.verdict || scriptScorecard.status).toLowerCase();
  const scriptBlockers = asArray(scriptScorecard.blockers);
  const viralScore = Number(scriptScorecard.viral_score ?? scriptScorecard.score ?? scriptScorecard.total);
  const blockers = [];

  if (scriptVerdict && !["viral_ready", "pass", "green"].includes(scriptVerdict)) {
    blockers.push(`script_scorecard:script_verdict_${scriptVerdict}`);
  }
  for (const blocker of scriptBlockers) {
    blockers.push(`script_scorecard:${cleanText(blocker)}`);
  }
  if (Number.isFinite(viralScore) && viralScore < 75) {
    blockers.push("script_scorecard:script_score_below_threshold");
  }
  for (const blocker of audioQualityBlockers(audioManifest)) {
    blockers.push(`audio:${blocker}`);
  }
  if (footageInventory.readiness?.status !== "v4_motion_ready") {
    blockers.push(`footage:${footageInventory.readiness?.status || "unknown"}`);
  }
  if (directorBeatMap.readiness?.status !== "director_ready") {
    blockers.push(`director:${directorBeatMap.readiness?.status || "unknown"}`);
  }
  if (!["pass"].includes(benchmarkReport.result)) {
    blockers.push(`benchmark:${benchmarkReport.result || "unknown"}`);
  }
  blockers.push(...platformNativeBlockers(platformNativeEvidence));

  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  if (!uniqueBlockers.length) {
    return {
      ...base,
      verdict: base.verdict || "GREEN",
      can_auto_publish: base.can_auto_publish !== false,
      reason_codes: reasonCodes,
      warnings,
    };
  }

  return {
    ...base,
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: [...new Set([...reasonCodes, ...uniqueBlockers])],
    warnings: [...new Set([...warnings, "package_quality_blocks_publish"])],
    package_quality_gate: {
      verdict: scriptScorecard.verdict || null,
      viral_score: Number.isFinite(viralScore) ? viralScore : null,
      blockers: uniqueBlockers,
    },
  };
}

function buildGoalProofPackage({
  story = {},
  rightsLedger = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const scriptScorecard = buildViralScriptIntelligence({
    story,
    script: story.full_script || story.tts_script || "",
  });
  const footageInventory = buildFootageEmpirePlan({
    story,
    trustedFootageReport: buildTrustedFootageReport(story),
    localMotionClips: buildLocalMotionClips(story),
    generatedAt,
  });
  const directorBeatMap = buildVisualV4DirectorPlan({
    story,
    footagePlan: footageInventory,
    localTimeline: buildLocalTimeline(story),
    sfxAssetInventory: story.sfx_asset_inventory || story.sfx_assets || [],
    sfxRightsLedger: story.sfx_rights_ledger || rightsLedger,
    generatedAt,
  });
  const soundPlan = directorBeatMap.sound_transition_plan || {};
  const governanceReport = buildStudioGovernanceReport({
    story,
    rightsLedger,
    generatedAt,
  });
  const enterprisePack = buildStudioEnterpriseOSPack({
    generatedAt,
    stories: [story],
    governanceSummary: governanceReport.publish_manifest,
  });
  const benchmarkReport = directorBeatMap.media_house_benchmark || {};
  const platformOutputs = enterprisePack.multi_platform_format_engine.outputs || {};
  const affiliateManifest = story.affiliate_link_manifest || {};
  const sourceManifest = objectHasKeys(governanceReport.source_manifest)
    ? governanceReport.source_manifest
    : buildFallbackSourceManifest(story, generatedAt);
  const claimInventory = objectHasKeys(governanceReport.claim_inventory)
    ? governanceReport.claim_inventory
    : buildFallbackClaimInventory(story);
  const canonicalStoryManifest = canonicalAttentionCopy(governanceReport.canonical_story_manifest, story);
  const landingPageManifest = buildLandingPageManifest({
    story,
    canonical: canonicalStoryManifest,
    enterpriseLandingPage: enterprisePack.landing_page_link_hub || {},
    affiliateManifest,
  });
  const platformNativePacks = buildPlatformNativePublishPacks({
    story,
    canonical: canonicalStoryManifest,
    platformOutputs,
    affiliateManifest,
    landingPage: landingPageManifest,
  });
  const audioManifest = buildAudioManifest({ story, soundPlan });
  const publishVerdict = buildPackagePublishVerdict({
    publishControlTower: governanceReport.publish_control_tower,
    scriptScorecard,
    audioManifest,
    footageInventory,
    directorBeatMap,
    benchmarkReport,
    platformNativeEvidence: platformNativePacks.platformNativeEvidence,
  });

  const pack = {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: story.id || null,
    script_scorecard: scriptScorecard,
    footage_inventory: footageInventory,
    director_beat_map: directorBeatMap,
    audio_manifest: audioManifest,
    sfx_manifest: soundPlan.sfx || {},
    sfx_source_plan: soundPlan.sfx?.source_plan || {},
    visual_quality_report: buildVisualQualityReport({
      story,
      directorPlan: directorBeatMap,
      benchmark: benchmarkReport,
    }),
    forensic_qa_report: buildForensicQaReport({
      scriptScorecard,
      footageInventory,
      directorPlan: directorBeatMap,
      benchmark: benchmarkReport,
      governanceReport,
    }),
    benchmark_report: benchmarkReport,
    canonical_story_manifest: canonicalStoryManifest,
    source_manifest: sourceManifest,
    claim_inventory: claimInventory,
    rights_ledger: governanceReport.rights_ledger,
    coherence_report: governanceReport.public_output_coherence_gate,
    platform_policy_report: governanceReport.platform_policy_engine,
    publish_verdict: publishVerdict,
    render_manifest: {
      schema_version: 1,
      story_id: story.id || null,
      renderer: "visual_v4_local_proof",
      output: "visual_v4_render.mp4",
      visual_tier: "local_proof_motion_graphic",
      final_publish_render: false,
      director_beat_map: "director_beat_map.json",
      render_basis: "local proof render generated from governed story manifest",
      no_publish_triggered: true,
    },
    affiliate_link_manifest: affiliateManifest,
    landing_page_manifest: landingPageManifest,
    analytics_ingest_plan: {
      schema_version: 1,
      story_id: story.id || null,
      required_metrics: [
        "views",
        "average_view_duration",
        "first_3_second_drop_off",
        "stayed_to_watch",
        "swipe_away",
        "follows_or_subscribers_gained",
        "affiliate_clicks",
        "landing_page_visits",
      ],
      dry_run_only: true,
    },
    youtube_publish_pack: platformNativePacks.outputs.youtube_shorts,
    tiktok_publish_pack: platformNativePacks.outputs.tiktok,
    instagram_publish_pack: platformNativePacks.outputs.instagram_reels,
    facebook_publish_pack: platformNativePacks.outputs.facebook_reels,
    x_publish_pack: platformNativePacks.outputs.x,
    threads_publish_pack: platformNativePacks.outputs.threads,
    pinterest_publish_pack: platformNativePacks.outputs.pinterest,
    carousel_manifest: {
      platform: "instagram",
      story_id: story.id || null,
      cards: ["cover", "source", "impact", "related_links"],
    },
    image_card_manifest: {
      story_id: story.id || null,
      platforms: ["x", "instagram", "facebook"],
      headline: story.suggested_thumbnail_text || story.public_title || story.title || null,
    },
    thread_manifest: {
      platform: "x",
      story_id: story.id || null,
      posts: ["hot_take", "source_safe_post", "concise_news_post", "landing_page_post"],
    },
    finance_crypto_risk_report: governanceReport.finance_crypto_firewall,
    uniqueness_report: governanceReport.anti_spam_uniqueness_gate,
    retention_report: {
      schema_version: 1,
      story_id: story.id || null,
      recommendations: scriptScorecard.rewrite_recommendations || [],
      future_render_rules: [
        "keep canonical subject in first frame",
        "keep thumbnail text under mobile limits",
        "route motion deficits to Footage Empire before publish",
      ],
    },
    experiment_manifest: enterprisePack.experimentation_engine,
    platform_publish_manifest: {
      schema_version: 1,
      story_id: story.id || null,
      operating_mode: "LOCAL_PROOF",
      publish_status: publishVerdict.verdict || "RED",
      outputs: platformNativePacks.outputs,
      landing_page_attribution: landingPageManifest.attribution_manifest,
      platform_mirroring_detection:
        enterprisePack.multi_platform_format_engine.platform_mirroring_detection,
      platform_native_evidence: platformNativePacks.platformNativeEvidence,
      no_publish_triggered: true,
    },
    platform_variant_scorecard: {
      ...enterprisePack.multi_platform_format_engine,
      outputs: platformNativePacks.outputs,
      platform_native_evidence: platformNativePacks.platformNativeEvidence,
    },
    safety: {
      local_only: true,
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
      tokens_or_oauth_changed: false,
    },
  };
  pack.acceptance_entry = buildAcceptanceEntry({
    story,
    scriptScorecard,
    footageInventory,
    directorBeatMap,
    benchmarkReport,
    governanceReport,
    platformNativeEvidence: platformNativePacks.platformNativeEvidence,
  });
  return pack;
}

async function writeJson(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, value, { spaces: 2 });
  return filePath;
}

async function writeGoalProofPackageArtifacts(pack = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalProofPackageArtifacts requires outputDir");
  const outDir = path.resolve(outputDir);
  const mapping = {
    canonical_story_manifest: "canonical_story_manifest.json",
    source_manifest: "source_manifest.json",
    claim_inventory: "claim_inventory.json",
    script_scorecard: "script_scorecard.json",
    footage_inventory: "footage_inventory.json",
    rights_ledger: "rights_ledger.json",
    director_beat_map: "director_beat_map.json",
    render_manifest: "render_manifest.json",
    audio_manifest: "audio_manifest.json",
    sfx_manifest: "sfx_manifest.json",
    sfx_source_plan: "sfx_source_plan.json",
    visual_quality_report: "visual_quality_report.json",
    forensic_qa_report: "forensic_qa_report.json",
    benchmark_report: "benchmark_report.json",
    coherence_report: "coherence_report.json",
    platform_policy_report: "platform_policy_report.json",
    affiliate_link_manifest: "affiliate_link_manifest.json",
    landing_page_manifest: "landing_page_manifest.json",
    publish_verdict: "publish_verdict.json",
    analytics_ingest_plan: "analytics_ingest_plan.json",
    youtube_publish_pack: "youtube_publish_pack.json",
    tiktok_publish_pack: "tiktok_publish_pack.json",
    instagram_publish_pack: "instagram_publish_pack.json",
    facebook_publish_pack: "facebook_publish_pack.json",
    x_publish_pack: "x_publish_pack.json",
    threads_publish_pack: "threads_publish_pack.json",
    pinterest_publish_pack: "pinterest_publish_pack.json",
    carousel_manifest: "carousel_manifest.json",
    image_card_manifest: "image_card_manifest.json",
    thread_manifest: "thread_manifest.json",
    finance_crypto_risk_report: "finance_crypto_risk_report.json",
    uniqueness_report: "uniqueness_report.json",
    retention_report: "retention_report.json",
    experiment_manifest: "experiment_manifest.json",
    platform_publish_manifest: "platform_publish_manifest.json",
    platform_variant_scorecard: "platform_variant_scorecard.json",
    acceptance_entry: "goal_package_summary.json",
  };
  const written = {};
  for (const [key, basename] of Object.entries(mapping)) {
    written[key] = await writeJson(path.join(outDir, basename), pack[key] || {});
  }
  written.captions = await fs.writeFile(
    path.join(outDir, "captions.srt"),
    buildSimpleCaptionSrt(
      pack.canonical_story_manifest?.narration_script ||
        pack.canonical_story_manifest?.first_spoken_line ||
        "",
    ),
    "utf8",
  ).then(() => path.join(outDir, "captions.srt"));
  written.visual_v4_render = await writeLocalProofMp4(path.join(outDir, "visual_v4_render.mp4"), pack);
  return written;
}

module.exports = {
  ACCEPTANCE_ARTEFACTS,
  buildPlatformNativePublishPacks,
  buildGoalProofPackage,
  writeGoalProofPackageArtifacts,
};
