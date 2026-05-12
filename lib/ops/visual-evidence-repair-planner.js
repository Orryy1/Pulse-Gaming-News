"use strict";

const { storyReferenceReportRelativePath } = require("../official-trailer-reference-report-files");

function array(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mdCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function command(purpose, commandText, safety = "report_or_local_only") {
  return {
    purpose,
    command: commandText,
    safety,
  };
}

function storyFlag(row, blocker) {
  return array(row.blocking_dimensions).includes(blocker) || array(row.blockers).includes(blocker);
}

function unique(items) {
  return [...new Set(array(items).map((item) => String(item || "").trim()).filter(Boolean))];
}

function action(type, priority, reason, { entities = [], commands = [], blockers = [] } = {}) {
  return {
    action_type: type,
    priority,
    reason,
    entities: unique(entities),
    blockers: unique(blockers),
    commands,
  };
}

function priorityWeight(priority) {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  if (priority === "P2") return 2;
  return 3;
}

function ranked(actions) {
  return array(actions)
    .map((item, index) => ({ ...item, original_index: index }))
    .sort((a, b) => {
      const priority = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (priority) return priority;
      return a.original_index - b.original_index;
    })
    .map(({ original_index, ...item }, index) => ({ rank: index + 1, ...item }));
}

function indexByStory(items = []) {
  const map = new Map();
  for (const item of array(items)) {
    if (item?.story_id) map.set(item.story_id, item);
  }
  return map;
}

function proofCandidateToRepairRow(candidate = {}) {
  return {
    story_id: candidate.story_id,
    title: candidate.title,
    stage: "proof_candidate_media_repair",
    candidate_verdict: candidate.verdict || "unknown",
    proof_readiness_recommendation: candidate.proof_readiness?.final_recommendation || null,
    blockers: array(candidate.blockers),
    blocking_dimensions: array(candidate.blockers),
    audio: candidate.audio || {},
    visuals: candidate.visuals || {},
    recommended_command: candidate.recommended_command || null,
    source_report: "studio_v2_proof_candidates",
  };
}

function currentStateRepairRow(row = {}) {
  return {
    ...row,
    blockers: unique([...array(row.blockers), ...array(row.blocking_dimensions)]),
    source_report: row.source_report || "flash_lane_current_state",
  };
}

function mergeRows(base = {}, extra = {}) {
  return {
    ...base,
    ...extra,
    audio: { ...(base.audio || {}), ...(extra.audio || {}) },
    visuals: { ...(base.visuals || {}), ...(extra.visuals || {}) },
    blockers: unique([...array(base.blockers), ...array(extra.blockers)]),
    blocking_dimensions: unique([...array(base.blocking_dimensions), ...array(extra.blocking_dimensions)]),
  };
}

function mediaRepairCandidate(row = {}) {
  const visuals = row.visuals || {};
  return (
    row.stage === "needs_visual_evidence_repair" ||
    row.stage === "needs_alternate_official_motion_source" ||
    row.stage === "needs_motion_window_validation" ||
    row.stage === "proof_candidate_media_repair" ||
    visuals.visual_evidence_gate_ready === false ||
    storyFlag(row, "visual_evidence") ||
    storyFlag(row, "validated_motion") ||
    storyFlag(row, "alternate_official_source") ||
    storyFlag(row, "flash_proof_requires_motion_backbone") ||
    storyFlag(row, "flash_proof_requires_three_validated_clip_refs") ||
    storyFlag(row, "flash_proof_requires_three_validated_clip_sources") ||
    storyFlag(row, "flash_proof_requires_footage_backbone_dominance") ||
    storyFlag(row, "footage_backbone_clip_dominance_too_low") ||
    storyFlag(row, "flash_proof_requires_four_exact_subject_assets") ||
    storyFlag(row, "flash_proof_blocks_wrong_story_exact_assets") ||
    row.candidate_verdict === "ready_flash_proof" ||
    numberValue(visuals.wrong_story_exact_asset_count) > 0 ||
    numberValue(visuals.cover_dominated_exact_asset_count) > 0
  );
}

function buildGameplayStillCommand(storyId, mode = "dry-run") {
  const apply = mode === "apply-local" ? "--apply-local" : "--dry-run";
  return [
    "npm run media:enrich-stills --",
    `--story ${storyId}`,
    apply,
    "--prefer-gameplay-stills",
    "--require-verified-store",
    "--max-store-search-entities 5",
    "--max-store-assets-per-entity 3",
    "--max-downloads-per-story 12",
  ].join(" ");
}

function classifyRepair(row = {}) {
  const visuals = row.visuals || {};
  const wrongStory = numberValue(visuals.wrong_story_exact_asset_count);
  const coverCount = numberValue(visuals.cover_dominated_exact_asset_count);
  const unverified = numberValue(visuals.unverified_store_exact_asset_count);
  const missingMotion = unique([...array(visuals.missing_motion_entities), ...array(visuals.missing_validated_clip_entities)]);
  const blockers = unique([...array(row.blocking_dimensions), ...array(row.blockers)]);

  if (wrongStory > 0 || blockers.includes("flash_proof_blocks_wrong_story_exact_assets")) {
    return {
      repair_class: "wrong_story_exact_assets",
      priority: "P0",
      action: "rerun_entity_filtered_gameplay_still_search",
      reason: "Exact-subject count includes assets for the wrong story/entity.",
    };
  }
  if (coverCount > 0) {
    return {
      repair_class: "cover_dominated_exact_assets",
      priority: "P0",
      action: "replace_covers_with_gameplay_stills",
      reason: "Exact-subject count is inflated by covers, capsules or key art.",
    };
  }
  if (unverified > 0) {
    return {
      repair_class: "unverified_store_assets",
      priority: "P0",
      action: "rerun_verified_store_gameplay_still_search",
      reason: "Store assets need verified app-title or slug provenance before counting.",
    };
  }
  if (blockers.includes("flash_proof_requires_four_exact_subject_assets")) {
    return {
      repair_class: "exact_subject_gameplay_still_gap",
      priority: "P0",
      action: "acquire_exact_subject_gameplay_stills",
      reason: "The proof deck needs more exact-subject gameplay stills before proof rendering.",
    };
  }
  if (missingMotion.length > 0 || blockers.includes("validated_motion")) {
    return {
      repair_class: "motion_evidence_gap",
      priority: "P1",
      action: "repair_motion_or_downgrade",
      reason: "Visual stills are not the only blocker; validated motion/entity coverage is still thin.",
    };
  }
  if (
    blockers.includes("flash_proof_requires_motion_backbone") ||
    blockers.includes("flash_proof_requires_three_validated_clip_refs") ||
    blockers.includes("flash_proof_requires_three_validated_clip_sources") ||
    blockers.includes("flash_proof_requires_footage_backbone_dominance") ||
    blockers.includes("footage_backbone_clip_dominance_too_low")
  ) {
    return {
      repair_class: "motion_evidence_gap",
      priority: "P1",
      action: "repair_motion_or_downgrade",
      reason: "Validated motion windows are still below the Flash Lane proof threshold.",
    };
  }
  return {
    repair_class: "no_visual_repair_needed",
    priority: "P2",
    action: "monitor",
    reason: "No visual evidence repair blocker is currently visible.",
  };
}

function motionGapFor(row = {}, motionGapByStory = new Map()) {
  return motionGapByStory.get(row.story_id) || {};
}

function alternateSourceEntities(row = {}, motionGap = {}) {
  return unique([
    ...array(row.acquisition?.alternate_source_entities),
    ...array(motionGap.motion_gap?.acquisition_strategy?.alternate_source_entities),
  ]);
}

function sourceFamiliesExhausted(motionGap = {}) {
  const statuses = Object.values(motionGap.motion_gap?.acquisition_strategy?.entity_statuses || {});
  return statuses.some((status) => {
    const attempted = numberValue(status.attempted_segments);
    const rejected = numberValue(status.rejected_segments);
    return status.status === "alternate_source_required" || attempted >= 8 || rejected >= 5;
  });
}

function validatedMotionReady(row = {}, motionGap = {}) {
  const visuals = row.visuals || {};
  const validatedRefs = numberValue(motionGap.motion_gap?.validated_clip_ref_count ?? visuals.validated_clip_ref_count);
  const validatedSources = numberValue(
    motionGap.motion_gap?.validated_clip_source_count ?? visuals.validated_clip_source_count,
  );
  const storyEntities = unique([
    ...array(visuals.story_target_entities),
    ...array(visuals.story_entities),
    ...array(motionGap.motion_gap?.story_entities),
  ]);
  const validatedEntities = unique([
    ...array(visuals.validated_clip_entities),
    ...array(visuals.validated_entities),
    ...array(motionGap.motion_gap?.validated_entities),
  ]);
  const entityCoverageReady =
    storyEntities.length === 0 || storyEntities.every((entity) => validatedEntities.includes(entity));
  return validatedRefs >= 3 && validatedSources >= 3 && entityCoverageReady;
}

function buildRankedActions(row = {}, repair = {}, motionGap = {}) {
  const storyId = row.story_id;
  const visuals = row.visuals || {};
  const blockers = unique([...array(row.blockers), ...array(row.blocking_dimensions)]);
  const entities = unique([
    ...array(visuals.story_target_entities),
    ...array(visuals.story_entities),
    ...array(visuals.exact_subject_groups),
    ...array(motionGap.motion_gap?.story_entities),
  ]);
  const actions = [];
  const gameplayCommands = storyId
    ? [
        command("gameplay_still_dry_run", buildGameplayStillCommand(storyId, "dry-run"), "dry_run_only"),
        command(
          "gameplay_still_apply_local",
          buildGameplayStillCommand(storyId, "apply-local"),
          "apply_local_under_test_output_only",
        ),
      ]
    : [];

  if (repair.repair_class === "wrong_story_exact_assets") {
    actions.push(
      action("reject_wrong_story_deck", "P0", "Do not use the current deck because exact assets include wrong-story entities.", {
        entities: array(visuals.wrong_story_exact_asset_groups),
        blockers,
      }),
    );
    actions.push(
      action("exact_subject_gameplay_still_repair", "P0", "Rebuild the exact-subject still deck with entity-filtered gameplay stills.", {
        entities,
        commands: gameplayCommands,
        blockers,
      }),
    );
  } else if (
    repair.repair_class === "cover_dominated_exact_assets" ||
    repair.repair_class === "unverified_store_assets" ||
    repair.repair_class === "exact_subject_gameplay_still_gap"
  ) {
    if (repair.repair_class === "cover_dominated_exact_assets") {
      actions.push(
        action("cover_dominated_deck_repair", "P0", "Replace covers, capsules and key art with gameplay stills.", {
          entities,
          commands: gameplayCommands,
          blockers,
        }),
      );
    }
    actions.push(
      action("exact_subject_gameplay_still_repair", "P0", repair.reason, {
        entities,
        commands: gameplayCommands,
        blockers,
      }),
    );
  }

  const alternateEntities = alternateSourceEntities(row, motionGap);
  if (alternateEntities.length) {
    actions.push(
      action(
        "official_source_intake_needed",
        "P0",
        "Current source families are exhausted; operator must supply a non-exhausted official reference first.",
        {
          entities: alternateEntities,
          commands: storyId
            ? [
                command(
                  "validate_operator_official_source_intake",
                  `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id ${storyId}`,
                  "report_only_reference_validation",
                ),
                command(
                  "resolve_alternate_official_trailer_refs",
                  `npm run media:resolve-trailers -- --story-id ${storyId} --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`,
                  "network_metadata_lookup_report_only",
                ),
              ]
            : [],
          blockers,
        },
      ),
    );
  }
  if (alternateEntities.length || sourceFamiliesExhausted(motionGap)) {
    actions.push(
      action("exhausted_bad_windows", "P0", "Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family.", {
        entities: alternateEntities,
        blockers,
      }),
    );
  }

  const missingRefs = numberValue(
    motionGap.motion_gap?.missing_validated_clip_refs ?? Math.max(0, 3 - numberValue(visuals.validated_clip_ref_count)),
  );
  const missingSources = numberValue(
    motionGap.motion_gap?.missing_validated_clip_sources ??
      Math.max(0, 3 - numberValue(visuals.validated_clip_source_count)),
  );
  const needsMotion =
    missingRefs > 0 ||
    missingSources > 0 ||
    blockers.includes("flash_proof_requires_motion_backbone") ||
    blockers.includes("flash_proof_requires_three_validated_clip_refs") ||
    blockers.includes("flash_proof_requires_three_validated_clip_sources") ||
    blockers.includes("flash_proof_requires_footage_backbone_dominance") ||
    blockers.includes("footage_backbone_clip_dominance_too_low");
  if (needsMotion) {
    const storyReferenceReport = storyId ? storyReferenceReportRelativePath(storyId) : null;
    actions.push(
      action("validated_clip_windows_needed", alternateEntities.length ? "P1" : "P0", "Validated gameplay clip windows are below the Flash Lane threshold.", {
        entities,
        commands:
          storyId && storyReferenceReport
            ? [
                command(
                  alternateEntities.length ? "validate_gameplay_windows_after_intake" : "validate_gameplay_windows",
                  `npm run media:validate-trailer-segments -- --story-id ${storyId} --apply-local --deep-scan --reference-report ${storyReferenceReport} --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`,
                  "apply_local_under_test_output_only",
                ),
              ]
            : [],
        blockers,
      }),
    );
  }

  return ranked(actions);
}

function primaryActionType(actions = []) {
  const types = array(actions).map((item) => item.action_type);
  if (types.includes("wrong_story_deck_rejection")) return "wrong_story_deck_rejection";
  if (types.includes("reject_wrong_story_deck")) return "wrong_story_deck_rejection";
  if (types.includes("official_source_intake_needed")) return "official_source_intake_needed";
  if (types.includes("cover_dominated_deck_repair")) return "cover_dominated_deck_repair";
  if (types.includes("exact_subject_gameplay_still_repair")) return "exact_subject_gameplay_still_repair";
  if (types.includes("validated_clip_windows_needed")) return "validated_clip_windows_needed";
  return "monitor";
}

function buildRepairCommands(row = {}, repair = {}) {
  const storyId = row.story_id;
  if (!storyId) return [];
  const storyReferenceReport = storyReferenceReportRelativePath(storyId);
  const commands = [];

  if (
    repair.repair_class === "cover_dominated_exact_assets" ||
    repair.repair_class === "wrong_story_exact_assets" ||
    repair.repair_class === "unverified_store_assets" ||
    repair.repair_class === "exact_subject_gameplay_still_gap"
  ) {
    commands.push(command("gameplay_still_dry_run", buildGameplayStillCommand(storyId, "dry-run"), "dry_run_only"));
    commands.push(
      command(
        "gameplay_still_apply_local",
        buildGameplayStillCommand(storyId, "apply-local"),
        "apply_local_under_test_output_only",
      ),
    );
  }

  if (repair.repair_class === "unverified_store_assets") {
    commands.unshift(
      command(
        "verify_store_metadata",
        `npm run media:enrich-stills -- --story ${storyId} --dry-run --verified-store-metadata --require-verified-store`,
        "dry_run_only",
      ),
    );
  }

  if (storyFlag(row, "validated_motion") || array(row.visuals?.missing_motion_entities).length > 0) {
    commands.push(
      command(
        "resolve_official_motion_refs",
        `npm run media:resolve-trailers -- --story-id ${storyId} --no-latest-report`,
        "report_only",
      ),
    );
    commands.push(
      command(
        "validate_gameplay_windows",
        `npm run media:validate-trailer-segments -- --story-id ${storyId} --apply-local --deep-scan --reference-report ${storyReferenceReport} --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`,
        "apply_local_under_test_output_only",
      ),
    );
  }

  commands.push(
    command("rebuild_proof_candidates", `npm run studio:v2:proof-candidates -- --story ${storyId}`, "report_only"),
  );
  commands.push(command("recheck_flash_state", `npm run studio:v2:flash-state -- --story ${storyId}`, "report_only"));

  return commands;
}

function buildVisualEvidenceRepairPlan({
  currentStateReport = {},
  proofCandidateReport = {},
  motionGapReport = {},
  limit = 20,
} = {}) {
  const byStory = new Map();
  for (const row of array(currentStateReport.rows).map(currentStateRepairRow)) {
    if (!row.story_id) continue;
    byStory.set(row.story_id, mergeRows(byStory.get(row.story_id), row));
  }
  for (const row of array(proofCandidateReport.candidates).map(proofCandidateToRepairRow)) {
    if (!row.story_id) continue;
    byStory.set(row.story_id, mergeRows(byStory.get(row.story_id), row));
  }
  const rows = [...byStory.values()].slice(0, Math.max(1, Number(limit) || 20));
  const motionGapByStory = indexByStory(motionGapReport.gaps);
  const repairRows = rows
    .filter(mediaRepairCandidate)
    .map((row) => {
      const repair = classifyRepair(row);
      const motionGap = motionGapFor(row, motionGapByStory);
      const actions = buildRankedActions(row, repair, motionGap);
      const motionReady = validatedMotionReady(row, motionGap);
      const renderRecommendation =
        row.candidate_verdict === "ready_flash_proof" && motionReady && !actions.length
          ? "ready_for_local_flash_proof"
          : "do_not_render_yet";
      const commands = uniqueCommands([...buildRepairCommands(row, repair), ...actions.flatMap((item) => array(item.commands))]);
      return {
        story_id: row.story_id,
        title: row.title,
        stage: row.stage,
        source_report: row.source_report,
        priority: repair.priority,
        repair_class: repair.repair_class,
        action: repair.action,
        primary_action_type: primaryActionType(actions),
        ranked_actions: actions,
        reason: repair.reason,
        render_recommendation: renderRecommendation,
        validated_motion_ready: motionReady,
        audio_ready: row.audio?.ready === true,
        visual_evidence_gate_ready: row.visuals?.visual_evidence_gate_ready !== false,
        exact_subject_count: numberValue(row.visuals?.exact_subject_count),
        cover_dominated_exact_asset_count: numberValue(row.visuals?.cover_dominated_exact_asset_count),
        cover_dominated_exact_asset_share: numberValue(row.visuals?.cover_dominated_exact_asset_share),
        wrong_story_exact_asset_count: numberValue(row.visuals?.wrong_story_exact_asset_count),
        wrong_story_exact_asset_groups: array(row.visuals?.wrong_story_exact_asset_groups),
        unverified_store_exact_asset_count: numberValue(row.visuals?.unverified_store_exact_asset_count),
        missing_motion_entities: unique([
          ...array(row.visuals?.missing_motion_entities),
          ...array(row.visuals?.missing_validated_clip_entities),
          ...array(motionGap.motion_gap?.missing_validated_entities),
        ]),
        alternate_source_entities: alternateSourceEntities(row, motionGap),
        commands,
      };
    });
  const actionRows = repairRows.flatMap((row) => array(row.ranked_actions));

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: "read_only_repair_plan",
    safety: {
      does_not_download: true,
      does_not_render: true,
      does_not_call_tts: true,
      does_not_post: true,
      does_not_mutate_db: true,
      does_not_touch_railway: true,
      commands_are_operator_candidates_only: true,
    },
    summary: {
      rows_considered: rows.length,
      repair_candidates: repairRows.length,
      cover_dominated: repairRows.filter((row) => row.repair_class === "cover_dominated_exact_assets").length,
      wrong_story: repairRows.filter((row) => row.repair_class === "wrong_story_exact_assets").length,
      unverified_store: repairRows.filter((row) => row.repair_class === "unverified_store_assets").length,
      exact_subject_gameplay_still_repair: actionRows.filter(
        (row) => row.action_type === "exact_subject_gameplay_still_repair",
      ).length,
      official_source_intake_needed: actionRows.filter((row) => row.action_type === "official_source_intake_needed")
        .length,
      validated_clip_windows_needed: actionRows.filter((row) => row.action_type === "validated_clip_windows_needed")
        .length,
      wrong_story_rejections: actionRows.filter((row) => row.action_type === "reject_wrong_story_deck").length,
      exhausted_bad_windows: actionRows.filter((row) => row.action_type === "exhausted_bad_windows").length,
      render_ready_blocked_without_validated_motion: repairRows.filter(
        (row) => row.render_recommendation !== "ready_for_local_flash_proof" && row.validated_motion_ready === false,
      ).length,
      motion_evidence_gap: repairRows.filter((row) => row.repair_class === "motion_evidence_gap").length,
    },
    rows: repairRows.sort((a, b) => {
      const priority = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (priority) return priority;
      return String(a.story_id || "").localeCompare(String(b.story_id || ""));
    }),
  };
}

function uniqueCommands(commands = []) {
  const seen = new Set();
  const out = [];
  for (const item of array(commands)) {
    const key = `${item.purpose}|${item.command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function renderVisualEvidenceRepairMarkdown(report = {}) {
  const lines = [];
  lines.push("# Studio V2 Media Repair Action Planner");
  lines.push("");
  lines.push("Visual Evidence Repair Plan compatibility report.");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "pending"}`);
  lines.push(`Mode: ${report.mode || "read_only_repair_plan"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Rows considered: ${report.summary?.rows_considered || 0}`);
  lines.push(`- Repair candidates: ${report.summary?.repair_candidates || 0}`);
  lines.push(`- Cover dominated: ${report.summary?.cover_dominated || 0}`);
  lines.push(`- Wrong-story assets: ${report.summary?.wrong_story || 0}`);
  lines.push(`- Unverified store assets: ${report.summary?.unverified_store || 0}`);
  lines.push(`- Motion evidence gap: ${report.summary?.motion_evidence_gap || 0}`);
  lines.push(`- Exact-subject gameplay-still repairs: ${report.summary?.exact_subject_gameplay_still_repair || 0}`);
  lines.push(`- Official source intake needed: ${report.summary?.official_source_intake_needed || 0}`);
  lines.push(`- Validated clip windows needed: ${report.summary?.validated_clip_windows_needed || 0}`);
  lines.push(`- Wrong-story deck rejections: ${report.summary?.wrong_story_rejections || 0}`);
  lines.push(`- Exhausted bad windows: ${report.summary?.exhausted_bad_windows || 0}`);
  lines.push(
    `- Render-ready claims blocked without validated motion: ${
      report.summary?.render_ready_blocked_without_validated_motion || 0
    }`,
  );
  lines.push("");
  lines.push("## Repair Queue");
  lines.push("");
  lines.push("| Story | Primary action | Repair | Motion ready | Exact | Cover share | Alternate source | Next command |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | --- | --- |");

  for (const row of array(report.rows)) {
    lines.push(
      `| ${mdCell(`${row.story_id}: ${row.title}`)} | ${mdCell(row.primary_action_type || row.action)} | ${mdCell(row.repair_class)} | ${
        row.validated_motion_ready ? "yes" : "no"
      } | ${row.exact_subject_count || 0} | ${row.cover_dominated_exact_asset_share || 0} | ${mdCell(
        row.alternate_source_entities?.join(", ") || "none",
      )} | ${mdCell(row.commands[0]?.command || "none")} |`,
    );
  }
  if (!array(report.rows).length) {
    lines.push("| none | no visual repair candidates | no_visual_repair_needed | no | 0 | 0 | none | none |");
  }

  lines.push("");
  lines.push("## Command Details");
  for (const row of array(report.rows)) {
    lines.push("");
    lines.push(`### ${row.story_id}`);
    lines.push("");
    lines.push(`Reason: ${row.reason}`);
    lines.push(`Render recommendation: ${row.render_recommendation || "do_not_render_yet"}`);
    lines.push(`Validated motion ready: ${row.validated_motion_ready ? "yes" : "no"}`);
    if (array(row.ranked_actions).length) {
      lines.push("");
      lines.push("Ranked actions:");
      for (const item of array(row.ranked_actions)) {
        lines.push(
          `- ${item.rank}. ${item.action_type} (${item.priority}): ${item.reason}${
            array(item.entities).length ? ` Entities: ${item.entities.join(", ")}` : ""
          }`,
        );
      }
    }
    lines.push("");
    lines.push("Commands:");
    for (const item of array(row.commands)) {
      lines.push(`- ${item.purpose}: \`${item.command}\` (${item.safety})`);
    }
  }

  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- This planner is read-only and writes reports only.");
  lines.push("- Suggested apply-local commands are not executed by this planner.");
  lines.push("- No Railway, OAuth, production DB, scheduler, renderer, TTS, upload or social posting behaviour is changed.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildVisualEvidenceRepairPlan,
  renderVisualEvidenceRepairMarkdown,
  classifyRepair,
};
