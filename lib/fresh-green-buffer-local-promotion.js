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

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storyId(story = {}, index = 0) {
  return cleanText(story.id || story.story_id || story.storyId || `fresh_story_${index + 1}`);
}

function sourceName(story = {}) {
  return cleanText(story.primary_source?.name || story.primary_source_name || story.source_name || story.subreddit);
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
  return cleanText(value).split(/(?<=[.!?])\s+/).filter(Boolean)[0] || "";
}

function compactCanonicalSubject(story = {}) {
  const fields = [
    story.selected_title,
    firstSentence(story.narration_script || story.full_script || story.tts_script),
    firstSentence(story.full_script || story.tts_script || story.narration_script),
    firstSentence(story.tts_script || story.narration_script || story.full_script),
    story.canonical_game,
    story.canonical_subject,
    story.short_title,
    story.title,
    story.source_title,
    story.article_title,
    ...asArray(story.confirmed_claims),
    story.narration_script,
    story.full_script,
    story.tts_script,
  ].map(cleanText).filter(Boolean);
  const knownGameRe =
    /\b(?:Halo:\s*Campaign Evolved|Halo Campaign Evolved|Call of Duty:\s*Black Ops|Black Ops(?:\s+Classics|\s+1\s+and\s+2)?|Ocarina of Time|Ocarina's|Cyberpunk 2077|Lords of the Fallen\s*2|GTA\s*6|GTA\s*5|Grand Theft Auto VI|Grand Theft Auto V|Forza Horizon 6|EA SPORTS FC 26|The Adventures of Elliot|Dave the Diver|Granblue Fantasy|Garfield|Free Play Days|Nintendo Switch 2)\b/i;
  for (const field of fields) {
    const known = field.match(knownGameRe);
    if (!known) continue;
    return known[0]
      .replace(/^Black Ops(?:\s+Classics|\s+1\s+and\s+2)?$/i, "Call of Duty: Black Ops")
      .replace(/^Ocarina's$/i, "Ocarina of Time")
      .replace(/^GTA\s*VI$/i, "GTA 6")
      .replace(/^Grand Theft Auto VI$/i, "GTA 6")
      .replace(/^Grand Theft Auto V$/i, "GTA 5")
      .replace(/^Lords Of The Fallen\s*2$/i, "Lords of the Fallen 2")
      .replace(/^GTA\s*5$/i, "GTA 5")
      .replace(/^GTA\s*6$/i, "GTA 6");
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
  if (existing && attentionLedDescription(existing)) return existing;
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
  } else if (/\b(?:free upgrade|free access|free play|subscription|game catalog|game pass|ps plus)\b/i.test(evidence)) {
    body = `${subject} has a low-risk trial moment now. The offer matters because it changes whether players try it tonight or keep scrolling.`;
  } else if (/\b(?:release date|launches?|comes to|available|wishlist)\b/i.test(evidence)) {
    body = `${subject} has a release-window trust test now. The date is useful because it turns vague interest into a real decision for players.`;
  } else if (/\b(?:update|season|dlc|battle pass|patch)\b/i.test(evidence)) {
    body = `${subject} has a player-return problem to solve. More content only matters if it gives people a real reason to come back now.`;
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
  if (/\bthis story finally has something (?:specific|concrete) to judge\b/i.test(text)) {
    failures.push("weak_public_copy_pattern:generic_judge_language");
  }
  return failures;
}

function scriptRuntimeFailures(script = "") {
  const failures = [];
  const wordCount = countSpokenWords(script);
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

  const rebuilt = buildSourceBoundFallbackScript(
    {
      ...story,
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
  if (rebuiltScript && rebuiltQa?.result === "pass") {
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
  const script = scriptChoice.script;
  const subject = compactCanonicalSubject(story) || cleanText(story.title);
  const selectedTitle = cleanText(scriptChoice.repaired_title || story.selected_title || story.title);
  const thumbnailHeadline = cleanText(
    story.thumbnail_headline ||
      story.suggested_thumbnail_text ||
      scriptChoice.repaired_thumbnail_text ||
      story.title,
  );
  const description = buildPublicDescription(story);
  const firstLine = firstSentence(script);
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
    tts_script: script,
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
  return {
    schema_version: 1,
    story_id: storyId(story),
    primary_source: {
      name: sourceName(story),
      url: sourceUrl(story),
      type: cleanText(story.primary_source?.type || story.source_type || "official_or_major_source"),
      published_at: publishedAt || null,
      age_hours: hours,
    },
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

function motionReferences(story = {}) {
  return [
    ...asArray(story.trailer_references),
    ...asArray(story.official_motion_references),
    ...asArray(story.motion_references),
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
  return {
    audioReady,
    timestampsReady,
    manifestReady: audioReady && timestampsReady,
    audioPath: audioReady ? resolvePackageEvidencePath(audioPath, evidenceOptions) : "",
    timestampsPath: timestampsReady ? resolvePackageEvidencePath(timestampsPath, evidenceOptions) : "",
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
} = {}) {
  const queue = asArray(packages).map((storyPackage) => {
    const renderInputBlockers = localPromotionRenderInputBlockers(storyPackage);
    const finalRenderEvidence = readPackageFinalRenderEvidence(storyPackage);
    return ({
      ...(() => {
      const audioEvidence = readPackageAudioEvidence(storyPackage);
      const motionEvidence = readPackageMotionEvidence(storyPackage);
      return {
        render_input_evidence: {
          local_promotion_only: true,
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
    status: "needs_media_house_render_proof",
    render_input_status: localPromotionRenderInputStatus(renderInputBlockers, finalRenderEvidence),
    render_input_blockers: renderInputBlockers,
    target_render_manifest: {
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
  if (!Object.keys(files).length) return null;
  return {
    signature: canonicalEvidenceSignature(canonical),
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
  if (!snapshot || snapshot.signature !== canonicalEvidenceSignature(canonical)) return false;
  for (const [fileName, content] of Object.entries(snapshot.files || {})) {
    await fs.writeFile(path.join(packageDir, fileName), content);
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
  const renderInputWorkOrder = buildLocalPromotionRenderInputWorkOrder({
    packages: manifest,
    generatedAt: report.generated_at,
  });
  const renderInputWritten = await writeGoalRenderInputWorkOrder(renderInputWorkOrder, {
    outputDir: outDir,
  });
  return {
    reportJson,
    reportMd,
    storyPackages,
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
  buildInitialFootageInventory,
  buildInitialRightsLedger,
  buildRenderReadinessWorkOrder,
  buildSourceManifest,
  motionReferences,
  renderMarkdown,
  writeFreshGreenBufferLocalPromotionArtifacts,
};
