"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { inferHeadlineGameCandidates } = require("./game-title-inference");
const { buildSourceBoundFallbackScript } = require("./source-bound-script-writer");
const { EXACT_CTA, runScriptCoherenceQa } = require("./script-coherence-qa");
const {
  buildGoalRenderInputWorkOrder,
  writeGoalRenderInputWorkOrder,
} = require("./goal-render-input-workorder");

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
    story.narration_script,
    story.full_script,
    story.tts_script,
  ].map(cleanText).filter(Boolean);
  const knownGameRe =
    /\b(?:Halo:\s*Campaign Evolved|Halo Campaign Evolved|GTA\s*6|GTA\s*5|Grand Theft Auto VI|Grand Theft Auto V|Forza Horizon 6|EA SPORTS FC 26|The Adventures of Elliot|Dave the Diver|Granblue Fantasy|Garfield|Free Play Days|Nintendo Switch 2)\b/i;
  for (const field of fields) {
    const known = field.match(knownGameRe);
    if (!known) continue;
    return known[0]
      .replace(/^GTA\s*VI$/i, "GTA 6")
      .replace(/^Grand Theft Auto VI$/i, "GTA 6")
      .replace(/^Grand Theft Auto V$/i, "GTA 5")
      .replace(/^GTA\s*5$/i, "GTA 5")
      .replace(/^GTA\s*6$/i, "GTA 6");
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
  if (/\b(?:free play days|free to play|free access|free weekend|free trial|trial from|subscription trial|premium is free|after sunday|renewal|cancel)\b/i.test(evidence)) {
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

function chooseCanonicalScript(story = {}) {
  const provided = cleanText(story.narration_script || story.full_script || story.tts_script);
  const providedQa = provided ? scriptQa(story, provided) : null;
  const weakFailures = provided ? weakPublicCopyFailures(story, provided) : [];
  if (provided && providedQa?.result === "pass" && weakFailures.length === 0) {
    return {
      script: provided,
      source: cleanText(story.script_source) || "provided_fresh_story_script",
      qa: providedQa,
      repaired: false,
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

function localPromotionRenderInputBlockers(candidate = {}) {
  const sourceBlockers = asArray(candidate.blockers).filter((blocker) =>
    /^source_age_|^primary_source_/i.test(cleanText(blocker)),
  );
  return [
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
}

function buildLocalPromotionRenderInputWorkOrder({
  packages = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const queue = asArray(packages).map((storyPackage) => ({
    story_id: cleanText(storyPackage.story_id || storyPackage.id),
    title: cleanText(storyPackage.title || storyPackage.public_title),
    artifact_dir: storyPackage.artifact_dir || null,
    status: "needs_media_house_render_proof",
    render_input_status: "blocked",
    render_input_blockers: localPromotionRenderInputBlockers(storyPackage),
    render_input_evidence: {
      local_promotion_only: true,
      canonical_subject: cleanText(storyPackage.canonical_subject),
      primary_source: cleanText(storyPackage.primary_source),
      primary_source_url: cleanText(storyPackage.primary_source_url),
      source_published_at: cleanText(storyPackage.source_published_at),
      trailer_reference_count: motionReferences(storyPackage).length,
      package_status: cleanText(storyPackage.status),
      package_verdict: cleanText(storyPackage.verdict),
    },
    target_render_manifest: {
      renderer: "visual_v4_production",
      output: "visual_v4_render.mp4",
      local_promotion_only: true,
    },
  }));
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

async function writeFreshGreenBufferLocalPromotionArtifacts(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeFreshGreenBufferLocalPromotionArtifacts requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportJson = path.join(outDir, "fresh_green_buffer_local_promotion_report.json");
  const reportMd = path.join(outDir, "fresh_green_buffer_local_promotion_report.md");
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
    await fs.writeJson(path.join(packageDir, "render_readiness_work_order.json"), buildRenderReadinessWorkOrder(story, report.generated_at), { spaces: 2 });
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
  buildRenderReadinessWorkOrder,
  buildSourceManifest,
  motionReferences,
  renderMarkdown,
  writeFreshGreenBufferLocalPromotionArtifacts,
};
