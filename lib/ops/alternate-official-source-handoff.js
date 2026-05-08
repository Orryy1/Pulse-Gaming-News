"use strict";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items) {
  return [...new Set(array(items).map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalise(value) {
  return String(value || "").trim().toLowerCase();
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of array(items)) {
    const key = keyFn(item);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function timestampMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function buildInputFreshness({ motionGapReport = {}, referenceReport = {} } = {}) {
  const motionGapGeneratedAt = motionGapReport.generated_at || null;
  const referenceGeneratedAt = referenceReport.generated_at || null;
  const motionGapMs = timestampMs(motionGapGeneratedAt);
  const referenceMs = timestampMs(referenceGeneratedAt);
  const warnings = [];

  if (motionGapMs && referenceMs && referenceMs < motionGapMs) {
    warnings.push({
      code: "reference_report_older_than_motion_gap",
      severity: "warning",
      message:
        "Official trailer references are older than the motion-gap report; rerun media:resolve-trailers before trusting remaining/excluded reference counts.",
      recommended_command:
        "npm run media:resolve-trailers -- --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5",
    });
  }

  return {
    motion_gap_report_generated_at: motionGapGeneratedAt,
    reference_report_generated_at: referenceGeneratedAt,
    reference_counts_provisional: warnings.some(
      (warning) => warning.code === "reference_report_older_than_motion_gap",
    ),
    warnings,
  };
}

function indexReferencePlans(referenceReport = {}) {
  const map = new Map();
  for (const plan of array(referenceReport.plans)) {
    if (!plan.story_id) continue;
    map.set(plan.story_id, plan);
  }
  return map;
}

function entityMatches(row = {}, entity) {
  const wanted = normalise(entity);
  return normalise(row.entity) === wanted || normalise(row.store_matched_query) === wanted;
}

function referencesForEntity(plan = {}, entity) {
  return array(plan.references).filter((reference) => entityMatches(reference, entity));
}

function excludedReferencesForEntity(plan = {}, entity) {
  return array(plan.excluded_references).filter((reference) => entityMatches(reference, entity));
}

function plannedSearchesForEntity(plan = {}, entity) {
  const searches = array(plan.planned_searches).filter((search) => entityMatches(search, entity));
  if (searches.length) return searches;
  if (!entity) return [];
  return [
    `${entity} official trailer`,
    `${entity} gameplay trailer`,
    `${entity} official gameplay`,
    `${entity} platform storefront trailer`,
  ].map((query) => ({
    query,
    entity,
    accepted_sources: ["Steam", "IGDB", "official publisher channel", "platform storefront"],
    will_download: false,
    generated_fallback: true,
  }));
}

function verifiedTargetsForEntity(plan = {}, entity) {
  return array(plan.verified_store_targets).filter((target) => entityMatches(target, entity));
}

function topRejectionReason(entityStatus = {}) {
  if (entityStatus.top_rejection_reason) return entityStatus.top_rejection_reason;
  return (
    Object.entries(entityStatus.rejection_reasons || {}).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ||
    null
  );
}

function sourceFamilyRows(entityStatus = {}) {
  return array(entityStatus.source_families).map((family) => ({
    provider: family.provider || "unknown",
    store_app_id: family.store_app_id || null,
    store_app_title: family.store_app_title || null,
    movie_id: family.movie_id || null,
    reference_title: family.reference_title || null,
    source_url: family.source_url || null,
    attempted_segments: Number(family.attempted_segments || 0),
    rejected_segments: Number(family.rejected_segments || 0),
    validated_segments: Number(family.validated_segments || 0),
    top_rejection_reason: family.top_rejection_reason || null,
  }));
}

function recommendedSourceTypes({ hasExhaustedSteam = false, hasVerifiedStoreTarget = false } = {}) {
  const types = [
    {
      source_type: "official_publisher_or_developer_trailer_page",
      priority: 1,
      use: "reference_only_first",
      reason: "Best provenance when Steam/IGDB has no usable window or only rating/logo/title cards.",
    },
    {
      source_type: "platform_storefront_video_reference",
      priority: 2,
      use: "reference_only_first",
      reason: hasExhaustedSteam
        ? "Use a non-exhausted storefront family because the current Steam movie family has failed local validation."
        : "Storefront video is an official reference path and can later feed local frame/segment validation.",
    },
    {
      source_type: "igdb_video_reference",
      priority: 3,
      use: "reference_only_first",
      reason: "Useful as a second official index when storefront trailers are missing or exhausted.",
    },
    {
      source_type: "official_youtube_channel_url",
      priority: 4,
      use: "reference_only_no_download_by_default",
      reason: "Accept only official publisher/developer/platform channels; do not ingest reuploads.",
    },
    {
      source_type: "official_press_kit_stills",
      priority: 5,
      use: "still_downgrade_path",
      reason: "If no usable motion exists, official stills can support a shorter standard/card lane but not premium motion.",
    },
  ];

  if (!hasVerifiedStoreTarget) {
    types.unshift({
      source_type: "verify_exact_store_or_official_game_page_first",
      priority: 0,
      use: "metadata_check",
      reason: "Do not source motion until the exact game/franchise target is verified.",
    });
  }
  return types;
}

function unsafeSourceTypes() {
  return [
    "random YouTube reuploads",
    "TikTok/Reels/Shorts reposts",
    "browser-cookie scraping",
    "unofficial gameplay compilations",
    "stock people or generic gaming footage",
    "rating-card/title-card windows already rejected by local validation",
    "localised or non-English trailer references for Flash Lane footage",
    "references with baked-in subtitles or caption overlays",
  ];
}

function manualSourceIntake({ entity, storyId, hasExhaustedSteam = false, verifiedTargets = [] } = {}) {
  return {
    mode: "operator_supplied_reference_only",
    default_downloads_allowed: false,
    apply_local_required_before_any_media_extraction: true,
    required_fields: [
      "entity",
      "official_source_url",
      "source_owner",
      "source_type",
      "source_family",
      "source_title",
      "evidence_of_officialness",
      "entity_match_notes",
      "operator_notes",
    ],
    accepted_source_types: [
      "official publisher/developer trailer page",
      "official game website media/trailer page",
      "Steam or platform storefront video page",
      "IGDB video reference pointing at an official source",
      "official publisher/developer/platform YouTube URL as reference only",
    ],
    acceptance_checks: [
      `The source must be for ${entity}, not only the publisher or a loosely related franchise.`,
      "The URL owner must be official: publisher, developer, platform storefront or verified official channel.",
      "The source must not be a fan reupload, compilation, social repost, reaction video or generic gaming footage.",
      "The source title and metadata must not indicate a localised/non-English trailer for Flash Lane footage.",
      "The source must not have baked-in subtitles or caption overlays unless manually approved for non-visual reference use only.",
      "The first usable window must not be dominated by rating boards, black frames, logos or title cards.",
      "The source must add a new source family when existing families are exhausted.",
      "Provenance must be recorded before any local frame or segment validation.",
      "Downloads remain disabled until a later apply-local validation command is run.",
    ],
    rejection_checks: [
      "wrong_entity",
      "publisher_context_only",
      "unofficial_reupload",
      "social_repost",
      "rating_or_logo_only_window",
      "localised_non_english_reference",
      "embedded_subtitle_reference",
      "duplicate_exhausted_source_family",
      "no_provenance",
    ],
    priority_note: hasExhaustedSteam
      ? "Current Steam/source-family validation is exhausted; prefer a different official source family."
      : "Prefer source diversity over rescanning the same family.",
    verified_store_targets: array(verifiedTargets),
    safe_next_commands: [
      `npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id ${storyId}`,
      `npm run media:resolve-trailers -- --story-id ${storyId} --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`,
      `npm run media:validate-trailer-segments -- --story-id ${storyId} --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`,
      `npm run studio:v2:motion-gap -- --story ${storyId}`,
    ],
  };
}

function mdCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function safeIdPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "source";
}

function buildSourceIntakeTemplate(rows = []) {
  return array(rows).map((row) => ({
    story_id: row.story_id,
    entity: row.entity,
    official_source_url: "",
    source_owner: "",
    source_type: "official_publisher_or_developer_trailer_page",
    source_family: `${safeIdPart(row.story_id)}_${safeIdPart(row.entity)}_alternate_official_source`,
    source_title: `${row.entity} official gameplay or trailer reference`,
    evidence_of_officialness: "",
    entity_match_notes: `Must clearly match ${row.entity} and not only the publisher, channel or a loosely related franchise.`,
    operator_notes: [
      `Generated from alternate-source blocker: ${row.blocker}`,
      "Reference-only by default. Do not set downloads_allowed=true.",
      "Prefer official publisher/developer/platform pages or verified official channels.",
      `Suggested searches: ${array(row.planned_searches)
        .slice(0, 4)
        .map((search) => search.query || search.search_query || search.entity)
        .filter(Boolean)
        .join(" | ")}`,
    ]
      .filter(Boolean)
      .join(" "),
    downloads_allowed: false,
  }));
}

function entityHandoffRows(gap = {}, referencePlan = {}) {
  const strategy = gap.motion_gap?.acquisition_strategy || {};
  const entityStatuses = strategy.entity_statuses || {};
  const motionEntities = array(strategy.alternate_source_entities);
  const referenceEntities = array(referencePlan.alternate_reference_required_entities);
  const entities = unique([...motionEntities, ...referenceEntities]);

  return entities.map((entity) => {
    const entityStatus = entityStatuses[entity] || {};
    const excluded = excludedReferencesForEntity(referencePlan, entity);
    const remaining = referencesForEntity(referencePlan, entity);
    const searches = plannedSearchesForEntity(referencePlan, entity);
    const verifiedTargets = verifiedTargetsForEntity(referencePlan, entity);
    const families = sourceFamilyRows(entityStatus);
    const providerFrequency = countBy(families, (family) => family.provider);
    const hasExhaustedSteam =
      excluded.some((reference) => normalise(reference.provider) === "steam") ||
      families.some((family) => normalise(family.provider) === "steam" && Number(family.rejected_segments || 0) > 0);

    let blocker = "alternate_official_source_required";
    if (motionEntities.includes(entity) && referenceEntities.includes(entity)) {
      blocker = "resolved_references_exhausted_and_entity_still_missing_from_validated_motion";
    } else if (motionEntities.includes(entity)) {
      blocker = "local_segment_validation_exhausted_current_motion_sources";
    } else if (referenceEntities.includes(entity)) {
      blocker = "resolved_references_exhausted_before_segment_plan";
    }

    const motionStatus =
      blocker === "resolved_references_exhausted_before_segment_plan" ||
      blocker === "resolved_references_exhausted_and_entity_still_missing_from_validated_motion"
        ? "current_references_exhausted_needs_new_official_source_before_sampling"
        : entityStatus.status || "unknown";

    return {
      story_id: gap.story_id,
      title: gap.title,
      entity,
      blocker,
      motion_status: motionStatus,
      motion_recommendation: entityStatus.recommendation || "find_alternate_official_source_family",
      attempted_segments: Number(entityStatus.attempted_segments || 0),
      validated_segments: Number(entityStatus.validated_segments || 0),
      rejected_segments: Number(entityStatus.rejected_segments || 0),
      source_family_count: Number(entityStatus.source_family_count || families.length || 0),
      provider_frequency: providerFrequency,
      top_rejection_reason: topRejectionReason(entityStatus),
      source_families: families,
      excluded_reference_count: excluded.length,
      remaining_reference_count: remaining.length,
      planned_search_count: searches.length,
      planned_searches: searches,
      verified_store_targets: verifiedTargets,
      recommended_source_types: recommendedSourceTypes({
        hasExhaustedSteam,
        hasVerifiedStoreTarget: verifiedTargets.length > 0,
      }),
      manual_source_intake: manualSourceIntake({
        entity,
        storyId: gap.story_id,
        hasExhaustedSteam,
        verifiedTargets,
      }),
      unsafe_source_types: unsafeSourceTypes(),
      next_actions: [
        `Find a non-exhausted official source for ${entity}.`,
        "Record provenance before any local frame or segment work.",
        `Validate operator intake: npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id ${gap.story_id}`,
        `Rerun: npm run media:resolve-trailers -- --story-id ${gap.story_id} --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`,
        `If a new official reference exists, rerun: npm run media:validate-trailer-segments -- --story-id ${gap.story_id} --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`,
        `Then rerun: npm run studio:v2:motion-gap -- --story ${gap.story_id}`,
      ],
    };
  });
}

function buildAlternateOfficialSourceHandoffReport({ motionGapReport = {}, referenceReport = {}, storyId = null } = {}) {
  const plansByStory = indexReferencePlans(referenceReport);
  const inputFreshness = buildInputFreshness({ motionGapReport, referenceReport });
  const rows = [];
  for (const gap of array(motionGapReport.gaps)) {
    if (storyId && gap.story_id !== storyId) continue;
    const referencePlan = plansByStory.get(gap.story_id) || {};
    rows.push(...entityHandoffRows(gap, referencePlan));
  }

  const storyCount = unique(rows.map((row) => row.story_id)).length;
  const entityFrequency = countBy(rows, (row) => row.entity);
  const topRejectionFrequency = countBy(rows, (row) => row.top_rejection_reason);
  const sourceIntakeTemplate = buildSourceIntakeTemplate(rows);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    story_filter: storyId || null,
    summary: {
      stories_needing_alternate_sources: storyCount,
      entities_needing_alternate_sources: rows.length,
      top_priority_story_id: rows[0]?.story_id || null,
      entity_frequency: entityFrequency,
      top_rejection_frequency: topRejectionFrequency,
      source_intake_template_entries: sourceIntakeTemplate.length,
    },
    input_freshness: inputFreshness,
    rows,
    source_intake_template: {
      execution_mode: "operator_fill_before_validation",
      downloads_allowed: false,
      suggested_output_path: "test/output/official_source_intake_template.json",
      validation_command: storyId
        ? `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id ${storyId}`
        : "npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json",
      entries: sourceIntakeTemplate,
    },
    allowed_source_policy: {
      default_mode: "report_only",
      downloads_allowed: false,
      apply_local_required_for_any_future_frame_or_segment_work: true,
      allowed_reference_types: [
        "Steam official movie metadata",
        "IGDB official video references",
        "official publisher/developer press pages",
        "official publisher/developer/platform YouTube URLs as references only",
        "platform storefront pages",
      ],
      forbidden_reference_types: unsafeSourceTypes(),
    },
    safety: {
      local_only: true,
      report_only: true,
      downloads_media: false,
      renders_video: false,
      calls_tts: false,
      posts_to_platforms: false,
      mutates_production_db: false,
      mutates_railway: false,
      mutates_oauth: false,
      changes_render_defaults: false,
    },
  };
}

function renderAlternateOfficialSourceHandoffMarkdown(report = {}) {
  const lines = [
    "# Alternate Official Source Handoff",
    "",
    "This report is local-only and report-only. It turns exhausted Flash Lane motion sources into exact alternate-source work.",
    "",
    "## Summary",
    "",
    `- Stories needing alternate sources: ${report.summary?.stories_needing_alternate_sources || 0}`,
    `- Entities needing alternate sources: ${report.summary?.entities_needing_alternate_sources || 0}`,
    `- Top priority story: ${report.summary?.top_priority_story_id || "none"}`,
    `- Source-intake template entries: ${report.summary?.source_intake_template_entries || 0}`,
    "- Downloads started: no",
    "- Production touched: no",
    "",
    "## Input Freshness",
    "",
    `- Motion gap report: ${report.input_freshness?.motion_gap_report_generated_at || "unknown"}`,
    `- Reference report: ${report.input_freshness?.reference_report_generated_at || "unknown"}`,
    "",
  ];

  if (array(report.input_freshness?.warnings).length) {
    lines.push("Warnings:");
    for (const warning of report.input_freshness.warnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
      if (warning.recommended_command) lines.push(`  Recommended: \`${warning.recommended_command}\``);
    }
    lines.push("");
  }

  lines.push("## Allowed Source Policy", "");

  for (const item of array(report.allowed_source_policy?.allowed_reference_types)) {
    lines.push(`- Allowed: ${item}`);
  }
  for (const item of array(report.allowed_source_policy?.forbidden_reference_types)) {
    lines.push(`- Forbidden: ${item}`);
  }

  lines.push("", "## Entity Handoff", "");
  if (!array(report.rows).length) {
    lines.push("No alternate official source work is currently queued.");
  } else {
    const countsSuffix = report.input_freshness?.reference_counts_provisional ? " (provisional)" : "";
    lines.push(
      `| Story | Entity | Blocker | Attempts | Validated | Rejected | Source families | Top rejection | Remaining refs${countsSuffix} | Excluded refs${countsSuffix} |`,
    );
    lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |");
    for (const row of report.rows) {
      lines.push(
        `| ${mdCell(row.story_id)} | ${mdCell(row.entity)} | ${mdCell(row.blocker)} | ${row.attempted_segments} | ${row.validated_segments} | ${row.rejected_segments} | ${row.source_family_count} | ${mdCell(row.top_rejection_reason || "none")} | ${row.remaining_reference_count} | ${row.excluded_reference_count} |`,
      );
    }
  }

  for (const row of array(report.rows)) {
    lines.push(
      "",
      `## ${row.story_id} - ${row.entity}`,
      "",
      `- Title: ${row.title}`,
      `- Blocker: ${row.blocker}`,
      `- Motion status: ${row.motion_status}`,
      `- Motion recommendation: ${row.motion_recommendation}`,
      `- Top rejection: ${row.top_rejection_reason || "none"}`,
      `- Planned searches: ${row.planned_search_count}`,
      "",
      "### Recommended Source Types",
      "",
    );
    for (const item of row.recommended_source_types) {
      lines.push(`- P${item.priority}: ${item.source_type} (${item.use}) - ${item.reason}`);
    }
    if (row.source_families.length) {
      lines.push("", "### Exhausted / Attempted Source Families", "");
      lines.push("| Provider | App | Movie/source | Attempts | Rejected | Top rejection |");
      lines.push("| --- | --- | --- | ---: | ---: | --- |");
      for (const family of row.source_families.slice(0, 12)) {
        const sourceLabel =
          family.reference_title ||
          family.movie_id ||
          (family.source_url ? String(family.source_url).replace(/^https?:\/\//i, "").slice(0, 72) : "unknown");
        lines.push(
          `| ${mdCell(family.provider || "unknown")} | ${mdCell(
            family.store_app_title || family.store_app_id || "unknown",
          )} | ${mdCell(sourceLabel)} | ${family.attempted_segments} | ${family.rejected_segments} | ${mdCell(
            family.top_rejection_reason || "none",
          )} |`,
        );
      }
    }
    if (row.planned_searches.length) {
      lines.push("", "### Planned Searches", "");
      for (const search of row.planned_searches) {
        lines.push(`- ${search.query || search.search_query || search.entity || JSON.stringify(search)}`);
      }
    }
    if (row.manual_source_intake) {
      lines.push(
        "",
        "### Manual Official Source Intake",
        "",
        `- Mode: ${row.manual_source_intake.mode}`,
        `- Downloads allowed by default: ${row.manual_source_intake.default_downloads_allowed ? "yes" : "no"}`,
        `- Priority: ${row.manual_source_intake.priority_note}`,
        "",
        "Required fields:",
      );
      for (const field of row.manual_source_intake.required_fields) lines.push(`- ${field}`);
      lines.push("", "Acceptance checks:");
      for (const check of row.manual_source_intake.acceptance_checks) lines.push(`- ${check}`);
      lines.push("", "Reject if:");
      for (const check of row.manual_source_intake.rejection_checks) lines.push(`- ${check}`);
    }
    lines.push("", "### Next Safe Actions", "");
    for (const action of row.next_actions) lines.push(`- ${action}`);
  }

  if (array(report.source_intake_template?.entries).length) {
    lines.push("", "## Source Intake Template", "");
    lines.push(`- Suggested output: ${report.source_intake_template.suggested_output_path}`);
    lines.push(`- Validation command: \`${report.source_intake_template.validation_command}\``);
    lines.push("- URLs are intentionally blank until an official source is supplied.");
    lines.push("");
    lines.push("| Story | Entity | Source type | Source family |");
    lines.push("| --- | --- | --- | --- |");
    for (const entry of report.source_intake_template.entries) {
      lines.push(
        `| ${mdCell(entry.story_id)} | ${mdCell(entry.entity)} | ${mdCell(entry.source_type)} | ${mdCell(
          entry.source_family,
        )} |`,
      );
    }
  }

  lines.push(
    "",
    "## Safety",
    "",
    "- No Railway, OAuth, DB, scheduler, production renderer or posting behaviour changed.",
    "- This report does not download trailer clips, scrape browsers, scrape social platforms or render video.",
    "- Any future media extraction must stay under `test/output` unless explicitly approved later.",
  );
  return lines.join("\n").trimEnd() + "\n";
}

module.exports = {
  buildAlternateOfficialSourceHandoffReport,
  renderAlternateOfficialSourceHandoffMarkdown,
  buildSourceIntakeTemplate,
};
