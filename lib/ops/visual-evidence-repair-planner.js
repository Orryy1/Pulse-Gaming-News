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
  return array(row.blocking_dimensions).includes(blocker);
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
  const missingMotion = array(visuals.missing_motion_entities);
  const blockers = array(row.blocking_dimensions);

  if (wrongStory > 0) {
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
  if (missingMotion.length > 0 || blockers.includes("validated_motion")) {
    return {
      repair_class: "motion_evidence_gap",
      priority: "P1",
      action: "repair_motion_or_downgrade",
      reason: "Visual stills are not the only blocker; validated motion/entity coverage is still thin.",
    };
  }
  return {
    repair_class: "no_visual_repair_needed",
    priority: "P2",
    action: "monitor",
    reason: "No visual evidence repair blocker is currently visible.",
  };
}

function buildRepairCommands(row = {}, repair = {}) {
  const storyId = row.story_id;
  if (!storyId) return [];
  const storyReferenceReport = storyReferenceReportRelativePath(storyId);
  const commands = [];

  if (
    repair.repair_class === "cover_dominated_exact_assets" ||
    repair.repair_class === "wrong_story_exact_assets" ||
    repair.repair_class === "unverified_store_assets"
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

function buildVisualEvidenceRepairPlan({ currentStateReport = {}, limit = 20 } = {}) {
  const rows = array(currentStateReport.rows).slice(0, Math.max(1, Number(limit) || 20));
  const repairRows = rows
    .filter(
      (row) =>
        row.stage === "needs_visual_evidence_repair" ||
        row.visuals?.visual_evidence_gate_ready === false ||
        storyFlag(row, "visual_evidence"),
    )
    .map((row) => {
      const repair = classifyRepair(row);
      return {
        story_id: row.story_id,
        title: row.title,
        stage: row.stage,
        priority: repair.priority,
        repair_class: repair.repair_class,
        action: repair.action,
        reason: repair.reason,
        audio_ready: row.audio?.ready === true,
        visual_evidence_gate_ready: row.visuals?.visual_evidence_gate_ready !== false,
        exact_subject_count: numberValue(row.visuals?.exact_subject_count),
        cover_dominated_exact_asset_count: numberValue(row.visuals?.cover_dominated_exact_asset_count),
        cover_dominated_exact_asset_share: numberValue(row.visuals?.cover_dominated_exact_asset_share),
        wrong_story_exact_asset_count: numberValue(row.visuals?.wrong_story_exact_asset_count),
        wrong_story_exact_asset_groups: array(row.visuals?.wrong_story_exact_asset_groups),
        unverified_store_exact_asset_count: numberValue(row.visuals?.unverified_store_exact_asset_count),
        missing_motion_entities: array(row.visuals?.missing_motion_entities),
        commands: buildRepairCommands(row, repair),
      };
    });

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
      motion_evidence_gap: repairRows.filter((row) => row.repair_class === "motion_evidence_gap").length,
    },
    rows: repairRows,
  };
}

function renderVisualEvidenceRepairMarkdown(report = {}) {
  const lines = [];
  lines.push("# Visual Evidence Repair Plan");
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
  lines.push("");
  lines.push("## Repair Queue");
  lines.push("");
  lines.push("| Story | Repair | Exact | Cover share | Missing motion | Next command |");
  lines.push("| --- | --- | ---: | ---: | --- | --- |");

  for (const row of array(report.rows)) {
    lines.push(
      `| ${mdCell(`${row.story_id}: ${row.title}`)} | ${mdCell(row.repair_class)} | ${row.exact_subject_count || 0} | ${row.cover_dominated_exact_asset_share || 0} | ${mdCell(row.missing_motion_entities.join(", ") || "none")} | ${mdCell(row.commands[0]?.command || "none")} |`,
    );
  }
  if (!array(report.rows).length) {
    lines.push("| none | no visual repair candidates | 0 | 0 | none | none |");
  }

  lines.push("");
  lines.push("## Command Details");
  for (const row of array(report.rows)) {
    lines.push("");
    lines.push(`### ${row.story_id}`);
    lines.push("");
    lines.push(`Reason: ${row.reason}`);
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
