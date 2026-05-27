"use strict";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pushUnique(target, value) {
  const cleaned = clean(value);
  if (cleaned && !target.includes(cleaned)) target.push(cleaned);
}

function pushCommand(target, value) {
  if (!value) return;
  if (typeof value === "string") {
    const command = clean(value);
    if (command && !target.some((item) => item.command === command)) {
      target.push({ step: "run_safe_local_command", command });
    }
    return;
  }
  const command = clean(value.command);
  if (!command) return;
  const step = clean(value.step) || "run_safe_local_command";
  if (!target.some((item) => item.command === command && item.step === step)) {
    target.push({ step, command });
  }
}

function mergeSafety(left = {}, right = {}) {
  const truthy = (value) => value !== false;
  return {
    no_publish_triggered: truthy(left.no_publish_triggered) && truthy(right.no_publish_triggered),
    no_network_uploads: truthy(left.no_network_uploads) && truthy(right.no_network_uploads),
    no_db_mutation:
      truthy(left.no_db_mutation) &&
      truthy(left.production_db_mutated === false || left.production_db_mutated === undefined) &&
      truthy(right.no_db_mutation) &&
      truthy(right.production_db_mutated === false || right.production_db_mutated === undefined),
    no_oauth_or_token_change:
      truthy(left.no_oauth_or_token_change) &&
      truthy(left.oauth_triggered === false || left.oauth_triggered === undefined) &&
      truthy(right.no_oauth_or_token_change) &&
      truthy(right.oauth_triggered === false || right.oauth_triggered === undefined),
    no_gate_weakened: truthy(left.no_gate_weakened) && truthy(right.no_gate_weakened),
  };
}

function createStory(storyId) {
  return {
    story_id: storyId,
    title: "",
    primary_story_entity: "",
    hold_status: "unclassified_goal04_hold",
    blocking_lanes: [],
    repair_lanes: [],
    blockers: [],
    required_human_inputs: [],
    required_approvals: [],
    expected_outputs: [],
    safe_next_commands: [],
    source_evidence: [],
    operator_approval_required: false,
    db_mutation_required: false,
    counts_towards_motion_readiness: false,
    ready_for_final_render: false,
  };
}

function storyFor(map, storyId, title = "") {
  const id = clean(storyId);
  if (!id) return null;
  if (!map.has(id)) map.set(id, createStory(id));
  const story = map.get(id);
  const cleanedTitle = clean(title);
  if (cleanedTitle && !story.title) story.title = cleanedTitle;
  return story;
}

function addLane(story, lane) {
  pushUnique(story.blocking_lanes, lane);
}

function addWorkOrderJobs(stories, reports, lane) {
  for (const report of asArray(reports)) {
    for (const job of asArray(report.jobs)) {
      const story = storyFor(stories, job.story_id, job.title);
      if (!story) continue;
      addLane(story, lane);
      pushUnique(story.repair_lanes, job.repair_lane);
      pushUnique(story.blockers, job.blocker_type);
      pushUnique(story.blockers, job.repair_lane);
      pushUnique(story.required_human_inputs, job.exact_missing_input);
      for (const output of asArray(job.expected_output)) pushUnique(story.expected_outputs, output);
      pushCommand(story.safe_next_commands, job.recommended_command);
      pushCommand(story.safe_next_commands, job.post_repair_validation_command);
      story.operator_approval_required =
        story.operator_approval_required || job.operator_approval_required === true;
      story.db_mutation_required = story.db_mutation_required || job.db_mutation_required === true;
      story.source_evidence.push({
        lane,
        mode: clean(report.mode || report.execution_mode),
        generated_at: clean(report.generated_at),
      });
    }
  }
}

function addSourceFamilyReports(stories, reports) {
  for (const report of asArray(reports)) {
    for (const row of asArray(report.rows)) {
      const story = storyFor(stories, row.story_id, row.title);
      if (!story) continue;
      addLane(story, "source_family_acquisition");
      if (clean(row.primary_story_entity)) story.primary_story_entity = clean(row.primary_story_entity);
      for (const blocker of asArray(row.blockers)) pushUnique(story.blockers, blocker);
      for (const blocker of asArray(row.source_search_blockers)) pushUnique(story.blockers, blocker);
      for (const command of asArray(row.safe_next_commands)) pushCommand(story.safe_next_commands, command);

      const governedPlan = row.governed_visual_plan || null;
      if (governedPlan) {
        pushUnique(story.repair_lanes, governedPlan.plan_type);
        if (governedPlan.operator_approval_required === true) {
          story.operator_approval_required = true;
          pushUnique(
            story.required_human_inputs,
            `Operator approval for governed visual plan: ${clean(governedPlan.plan_type)}`,
          );
        }
        for (const approval of asArray(governedPlan.required_approvals)) {
          pushUnique(story.required_approvals, approval);
        }
        for (const artefact of asArray(governedPlan.required_artefacts)) {
          pushUnique(story.expected_outputs, artefact);
        }
        pushUnique(story.required_human_inputs, governedPlan.next_step);
      }

      const sourceSearchBlockers = asArray(row.source_search_blockers);
      if (
        sourceSearchBlockers.includes("generic_primary_entity") ||
        sourceSearchBlockers.includes("generic_gerund_primary_entity")
      ) {
        story.operator_approval_required = true;
        pushUnique(
          story.required_human_inputs,
          "Canonical entity or reference plan needed before source-family acquisition can search official media.",
        );
      }
      if (sourceSearchBlockers.includes("corporate_transaction_requires_owned_explainer_visual_plan")) {
        story.operator_approval_required = true;
        pushUnique(
          story.required_human_inputs,
          "Operator-approved corporate source, rights basis and owned explainer plan required.",
        );
      }
      if (row.real_visual_media_required_after_owned_explainer_failed === true) {
        story.operator_approval_required = true;
        pushUnique(
          story.blockers,
          "real_visual_media_required_after_owned_explainer_failed_benchmark",
        );
        pushUnique(
          story.repair_lanes,
          "real_visual_media_or_human_review_required_after_owned_explainer_failed_benchmark",
        );
        pushUnique(
          story.required_human_inputs,
          "An alternate official, licensed or operator-approved motion source, or explicit human rejection, is required because the owned/generated explainer deck already failed benchmark.",
        );
        pushUnique(
          story.expected_outputs,
          "operator-supplied rights-backed motion source or human-review rejection decision",
        );
      }

      story.source_family_candidate_count = Math.max(
        story.source_family_candidate_count || 0,
        asArray(row.source_family_candidates).length,
      );
      story.official_search_action_count = Math.max(
        story.official_search_action_count || 0,
        asArray(row.official_search_actions).length,
      );
      story.source_evidence.push({
        lane: "source_family_acquisition",
        mode: clean(report.execution_mode || report.mode),
        generated_at: clean(report.generated_at),
      });
    }
  }
}

function addSourceDeficitReports(stories, reports) {
  for (const report of asArray(reports)) {
    for (const row of asArray(report.rows)) {
      const story = storyFor(stories, row.story_id, row.title);
      if (!story) continue;
      addLane(story, "real_motion_source_deficit");
      for (const blocker of asArray(row.blockers)) pushUnique(story.blockers, blocker);
      pushUnique(story.blockers, row.render_decision);
      for (const command of asArray(row.safe_next_commands)) pushCommand(story.safe_next_commands, command);

      for (const acquisition of asArray(row.required_acquisitions)) {
        pushUnique(story.repair_lanes, acquisition.action);
        if (clean(acquisition.segment_validation_status) === "validation_failed") {
          story.operator_approval_required = true;
          pushUnique(story.blockers, "segment_validation_failed");
          pushUnique(story.blockers, acquisition.segment_validation_rejection_reason);
          pushUnique(
            story.required_human_inputs,
            "An alternate official or operator-approved motion source is required because current direct media failed segment validation.",
          );
        }
        if (/operator|licen[cs]e/i.test(clean(acquisition.action))) {
          story.operator_approval_required = true;
          pushUnique(
            story.required_human_inputs,
            "Operator-supplied or licensed direct media source required before motion clips can count.",
          );
        }
      }

      if (clean(row.render_decision) === "hold_v4_source_acquisition_required") {
        pushUnique(
          story.required_human_inputs,
          "Visual V4 source acquisition must be resolved before final render readiness can be claimed.",
        );
      }
      story.missing_motion_families = Math.max(
        story.missing_motion_families || 0,
        Number(row.missing_motion_families || 0),
      );
      story.missing_motion_clips = Math.max(
        story.missing_motion_clips || 0,
        Number(row.missing_motion_clips || 0),
      );
      story.source_evidence.push({
        lane: "real_motion_source_deficit",
        mode: clean(report.execution_mode || report.mode),
        generated_at: clean(report.generated_at),
      });
    }
  }
}

function classifyStory(story) {
  if (
    story.blockers.includes("segment_validation_failed") ||
    story.blockers.includes("real_visual_media_required_after_owned_explainer_failed_benchmark") ||
    story.required_human_inputs.some((input) =>
      /alternate official(?:, licensed)? or operator-approved motion source/i.test(input) ||
      /alternate official, licensed or operator-approved motion source/i.test(input)
    )
  ) {
    return "human_held_alternate_motion_source_required";
  }
  if (story.operator_approval_required || story.required_human_inputs.length) {
    return "human_held_source_intake_required";
  }
  if (story.safe_next_commands.length) return "auto_repairable_source_work_required";
  return "dead_end_source_blocker";
}

function finaliseStory(story) {
  const next = {
    ...story,
    title: story.title || "(title unavailable)",
    hold_status: classifyStory(story),
    blocking_lanes: story.blocking_lanes.sort(),
    blockers: story.blockers.filter(Boolean).sort(),
    required_human_inputs: story.required_human_inputs.filter(Boolean),
    safe_next_commands: story.safe_next_commands,
    counts_towards_motion_readiness: false,
    ready_for_final_render: false,
  };
  return next;
}

function buildGoal04HumanHeldSourceConsolidation({
  generatedAt = new Date().toISOString(),
  ownedSourceSafetyWorkOrders = [],
  publicSourceAttributionWorkOrders = [],
  sourceFamilyReports = [],
  sourceDeficitReports = [],
} = {}) {
  const stories = new Map();
  let safety = {
    no_publish_triggered: true,
    no_network_uploads: true,
    no_db_mutation: true,
    no_oauth_or_token_change: true,
    no_gate_weakened: true,
  };
  const allReports = [
    ...asArray(ownedSourceSafetyWorkOrders),
    ...asArray(publicSourceAttributionWorkOrders),
    ...asArray(sourceFamilyReports),
    ...asArray(sourceDeficitReports),
  ];
  for (const report of allReports) safety = mergeSafety(safety, report.safety || {});

  addWorkOrderJobs(stories, ownedSourceSafetyWorkOrders, "owned_motion_source_safety");
  addWorkOrderJobs(stories, publicSourceAttributionWorkOrders, "public_copy_source_attribution");
  addSourceFamilyReports(stories, sourceFamilyReports);
  addSourceDeficitReports(stories, sourceDeficitReports);

  const finalStories = Array.from(stories.values())
    .map(finaliseStory)
    .sort((a, b) => a.story_id.localeCompare(b.story_id));
  const humanHeld = finalStories.filter((story) => story.hold_status.startsWith("human_held"));
  const autoRepairable = finalStories.filter(
    (story) => story.hold_status === "auto_repairable_source_work_required",
  );
  const deadEnd = finalStories.filter((story) => story.hold_status === "dead_end_source_blocker");
  const readyForGoal05 = finalStories.length === 0;

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GOAL04_HUMAN_HELD_SOURCE_CONSOLIDATION",
    goal: "04_owned_motion_materialiser",
    summary: {
      story_count: finalStories.length,
      human_held_story_count: humanHeld.length,
      auto_repairable_story_count: autoRepairable.length,
      dead_end_story_count: deadEnd.length,
      ready_for_goal05: readyForGoal05,
      goal_verdict: readyForGoal05 ? "PASS" : "PARTIAL",
    },
    safe_to_advance: readyForGoal05,
    stories: finalStories,
    safety,
    next_required_gate: readyForGoal05
      ? "05_narration_transcript_word_timestamps"
      : "04_owned_motion_materialiser / operator-source intake queue review for human-held Goal 04 blockers",
    completion_note: readyForGoal05
      ? "No Goal 04 source holds were found by this consolidation pass."
      : "No story in this report is render-ready or publishable until its source, rights and motion blockers are resolved.",
  };
}

function renderGoal04HumanHeldSourceConsolidationMarkdown(report = {}) {
  const lines = [
    "# Goal 04 Human-Held Source Consolidation",
    "",
    `Generated: ${clean(report.generated_at)}`,
    `Verdict: ${clean(report.summary?.goal_verdict)}`,
    `Safe to advance: ${report.safe_to_advance === true ? "yes" : "no"}`,
    "",
    "## Human-held source queue",
    "",
    `- Stories: ${report.summary?.story_count ?? 0}`,
    `- Human-held: ${report.summary?.human_held_story_count ?? 0}`,
    `- Auto-repairable: ${report.summary?.auto_repairable_story_count ?? 0}`,
    `- Dead-end blockers: ${report.summary?.dead_end_story_count ?? 0}`,
    `- Ready for Goal 05: ${report.summary?.ready_for_goal05 === true ? "yes" : "no"}`,
    "",
    "No story in this report is render-ready or publishable until the listed blockers are resolved.",
    "",
    "## Stories",
    "",
  ];

  for (const story of asArray(report.stories)) {
    lines.push(`### ${story.story_id} - ${story.title}`);
    lines.push(`- Hold status: ${story.hold_status}`);
    lines.push(`- Lanes: ${asArray(story.blocking_lanes).join(", ") || "none"}`);
    lines.push(`- Operator approval required: ${story.operator_approval_required ? "yes" : "no"}`);
    lines.push(`- DB mutation required: ${story.db_mutation_required ? "yes" : "no"}`);
    lines.push(`- Counts toward motion readiness: ${story.counts_towards_motion_readiness ? "yes" : "no"}`);
    if (asArray(story.blockers).length) {
      lines.push(`- Blockers: ${story.blockers.join(", ")}`);
    }
    if (asArray(story.required_human_inputs).length) {
      lines.push("- Required human inputs:");
      for (const input of story.required_human_inputs) lines.push(`  - ${input}`);
    }
    if (asArray(story.safe_next_commands).length) {
      lines.push("- Safe next commands:");
      for (const command of story.safe_next_commands.slice(0, 4)) {
        lines.push(`  - ${command.step}: \`${command.command}\``);
      }
    }
    lines.push("");
  }

  lines.push("## Safety");
  lines.push("");
  lines.push(`- No publish triggered: ${report.safety?.no_publish_triggered === false ? "no" : "yes"}`);
  lines.push(`- No network uploads: ${report.safety?.no_network_uploads === false ? "no" : "yes"}`);
  lines.push(`- No DB mutation: ${report.safety?.no_db_mutation === false ? "no" : "yes"}`);
  lines.push(
    `- No OAuth or token change: ${report.safety?.no_oauth_or_token_change === false ? "no" : "yes"}`,
  );
  lines.push(`- No gate weakened: ${report.safety?.no_gate_weakened === false ? "no" : "yes"}`);
  lines.push("");
  lines.push(`Next gate: ${clean(report.next_required_gate)}`);
  lines.push("");

  return `${lines.join("\n")}`;
}

module.exports = {
  buildGoal04HumanHeldSourceConsolidation,
  renderGoal04HumanHeldSourceConsolidationMarkdown,
};
