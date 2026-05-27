"use strict";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return (
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "source"
  );
}

function pushUnique(target, value) {
  const text = clean(value);
  if (text && !target.includes(text)) target.push(text);
}

const OFFICIAL_SOURCE_TYPES = [
  "official_publisher_or_developer_trailer_page",
  "official_game_website_media_page",
  "platform_storefront_video_reference",
  "official_platform_product_page",
  "steam_storefront_video_reference",
  "igdb_video_reference",
  "official_youtube_channel_url",
  "official_social_media_video",
  "official_press_kit_stills",
];

const PROHIBITED_SOURCE_CLASSES = [
  "random YouTube reupload",
  "fan montage",
  "reaction video",
  "social media repost without rights basis",
  "raw Reddit image post",
  "article screenshot as dominant visual",
];

function storyJsonPath(storyId) {
  return `output/goal-proof/batch/${storyId}/canonical_story_manifest.json`;
}

function officialSourceTemplateEntry(story, intakeType) {
  const storyId = clean(story.story_id);
  const entity = clean(story.primary_story_entity) || clean(story.title);
  return {
    story_id: storyId,
    entity,
    source_family: `${storyId}_${slug(intakeType)}`,
    source_type: "",
    source_owner: "",
    official_source_url: "",
    direct_media_url_if_available: "",
    source_title: "",
    evidence_of_officialness: "",
    entity_match_notes: "",
    downloads_allowed: false,
    accepted_source_types: OFFICIAL_SOURCE_TYPES,
    prohibited_source_classes: PROHIBITED_SOURCE_CLASSES,
    acceptance_checks: [
      "Use a non-discovery source that supports the public claim.",
      "Do not use raw image posts, reaction videos, fan reuploads or generic social reposts.",
      "Leave downloads_allowed false; this intake validates references only.",
    ],
  };
}

function licensedMediaTemplateEntry(story, intakeType) {
  const storyId = clean(story.story_id);
  const entity = clean(story.primary_story_entity) || clean(story.title);
  return {
    story_id: storyId,
    entity,
    source_family: `${storyId}_${slug(intakeType)}`,
    source_type: "",
    source_owner: "",
    official_source_url: "",
    approved_direct_media_url: "",
    local_operator_file_path: "",
    licence_evidence: "",
    permission_evidence: "",
    licence_scope: "",
    licence_expires_at: "",
    autonomous_use_approved: false,
    approval_notes: "",
    acceptance_checks: [
      "Use official, licensed or operator-approved motion that matches the story subject.",
      "Direct media must be a segment-validatable video URL or a local video file in an allowed project media path.",
      "The source is not a random reupload, fan montage, reaction video or unrelated gameplay.",
      "Trusted creator material needs licence evidence, scope and explicit autonomous-use approval.",
    ],
  };
}

function intakeItem({ story, intakeType, reason, requiredFields, templateKind }) {
  const storyId = clean(story.story_id);
  const itemId = `${storyId}_${slug(intakeType)}`;
  const validationCommands = [];
  if (templateKind === "official_source") {
    validationCommands.push({
      step: "validate_official_source_entries",
      command: `node tools/official-source-intake.js --story-json "${storyJsonPath(storyId)}" --input "output/goal-04/operator-source-intake-queue/${storyId}_official_source_entries.json" --output-json "output/goal-04/operator-source-intake-queue/${storyId}_official_source_intake_report.json" --output-md "output/goal-04/operator-source-intake-queue/${storyId}_official_source_intake_report.md" --json`,
    });
  }
  if (templateKind === "licensed_media") {
    validationCommands.push(
      {
        step: "validate_operator_media_access",
        command: `npm run ops:v4-licensed-direct-media -- --story-id ${storyId}`,
      },
      {
        step: "validate_motion_segments",
        command: `npm run media:validate-trailer-segments -- --story-id ${storyId} --apply-local --deep-scan --include-frame-anchored-windows --candidate-windows-per-source 6 --max-segments 72`,
      },
    );
  }

  return {
    item_id: itemId,
    intake_type: intakeType,
    reason,
    required: true,
    required_fields: requiredFields,
    template_kind: templateKind,
    validation_commands: validationCommands,
    blocks_readiness_until_submitted: true,
  };
}

function storyNeedsCanonicalEntity(story) {
  const blockers = asArray(story.blockers);
  return blockers.includes("generic_primary_entity") || blockers.includes("generic_gerund_primary_entity");
}

function storyNeedsNonDiscoverySource(story) {
  const text = [
    story.hold_status,
    ...asArray(story.blockers),
    ...asArray(story.required_human_inputs),
    ...asArray(story.blocking_lanes),
  ].join(" ");
  return /non[-_ ]?discovery|non[-_ ]?image|source attribution|public_copy|owned_explainer/i.test(text);
}

function storyNeedsMotionSource(story) {
  const text = [
    story.hold_status,
    ...asArray(story.blockers),
    ...asArray(story.required_human_inputs),
    ...asArray(story.blocking_lanes),
  ].join(" ");
  return /alternate.*motion source|segment_validation_failed|real_motion_source_deficit|direct media|motion source/i.test(text);
}

function storyNeedsGovernedApproval(story) {
  const text = [
    ...asArray(story.repair_lanes),
    ...asArray(story.required_human_inputs),
    ...asArray(story.required_approvals),
  ].join(" ");
  return /governed|operator approval|owned explainer plan|rights basis|operator_confirms/i.test(text);
}

function buildStoryQueue(story) {
  const intakeItems = [];
  const rejectionGuards = [
    "raw_image_source_not_allowed",
    "source_attribution:image_only_source_not_allowed",
    "social_or_repost_source_forbidden",
    "downloads_requested",
    "entity_evidence_missing_or_wrong",
  ];

  if (storyNeedsCanonicalEntity(story)) {
    intakeItems.push(
      intakeItem({
        story,
        intakeType: "canonical_entity_or_reference_plan",
        reason:
          "The story entity is too generic for safe source-family acquisition. An operator must supply the canonical subject or a reference plan.",
        requiredFields: [
          "canonical_subject",
          "canonical_entity",
          "source_search_terms",
          "reference_plan_notes",
        ],
        templateKind: "operator_plan",
      }),
    );
  }

  if (storyNeedsNonDiscoverySource(story)) {
    intakeItems.push(
      intakeItem({
        story,
        intakeType: "non_discovery_primary_source",
        reason:
          "The story needs a non-discovery primary source, official source or reliable publication source before public copy or owned motion can count.",
        requiredFields: [
          "story_id",
          "entity",
          "source_type",
          "source_owner",
          "source_family",
          "official_source_url",
          "evidence_of_officialness",
          "entity_match_notes",
          "downloads_allowed_false",
        ],
        templateKind: "official_source",
      }),
    );
  }

  if (storyNeedsMotionSource(story)) {
    intakeItems.push(
      intakeItem({
        story,
        intakeType: "operator_approved_motion_source",
        reason:
          "The story needs an official, licensed or operator-approved motion source before real motion clips can count.",
        requiredFields: [
          "story_id",
          "entity",
          "source_family",
          "official_source_url",
          "approved_direct_media_url_or_local_operator_file_path",
          "source_owner",
          "licence_or_permission_evidence_if_not_official",
          "autonomous_use_approved",
        ],
        templateKind: "licensed_media",
      }),
    );
  }

  if (storyNeedsGovernedApproval(story)) {
    intakeItems.push(
      intakeItem({
        story,
        intakeType: "governed_visual_plan_approval",
        reason:
          "The operator must approve the source match, rights basis and visual plan before the story can count toward Visual V4 readiness.",
        requiredFields: [
          "operator_confirms_source_matches_story",
          "operator_confirms_rights_basis",
          "operator_confirms_direct_media_or_owned_plan_is_allowed",
        ],
        templateKind: "operator_plan",
      }),
    );
  }

  const officialTemplates = intakeItems
    .filter((item) => item.template_kind === "official_source")
    .map((item) => officialSourceTemplateEntry(story, item.intake_type));
  const mediaTemplates = intakeItems
    .filter((item) => item.template_kind === "licensed_media")
    .map((item) => licensedMediaTemplateEntry(story, item.intake_type));

  return {
    story_id: clean(story.story_id),
    title: clean(story.title),
    primary_story_entity: clean(story.primary_story_entity),
    hold_status: clean(story.hold_status),
    operator_approval_required: true,
    db_mutation_required: false,
    counts_towards_motion_readiness: false,
    ready_for_final_render: false,
    blockers: asArray(story.blockers).map(clean).filter(Boolean),
    blocking_lanes: asArray(story.blocking_lanes).map(clean).filter(Boolean),
    required_human_inputs: asArray(story.required_human_inputs).map(clean).filter(Boolean),
    rejection_guards: rejectionGuards,
    intake_items: intakeItems,
    official_source_template_entries: officialTemplates,
    licensed_media_template_entries: mediaTemplates,
  };
}

function buildValidationPlan(stories) {
  const commands = [];
  const add = (step, command) => {
    if (!commands.some((item) => item.step === step && item.command === command)) {
      commands.push({ step, command });
    }
  };
  for (const story of stories) {
    for (const item of story.intake_items) {
      for (const command of asArray(item.validation_commands)) add(command.step, command.command);
    }
    add(
      "rerun_source_family_acquisition",
      `npm run ops:v4-source-family-acquisition -- --story-id ${story.story_id}`,
    );
    add(
      "rerun_owned_motion",
      `npm run ops:goal-owned-motion -- --story-packages output/goal-contract/story-packages.json --story-id ${story.story_id} --out-dir output/goal-04 --json`,
    );
    add(
      "rerun_real_motion",
      `npm run ops:goal-real-motion -- --story-id ${story.story_id} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-04 --json`,
    );
  }
  return {
    safe_to_run_after_operator_submission: true,
    commands,
    must_not_run_before_operator_submission: [
      "production render materialisation",
      "strict dry-run publish",
      "scheduler promotion",
      "external platform upload",
    ],
  };
}

function mergeSafety(consolidationSafety = {}) {
  return {
    no_publish_triggered: consolidationSafety.no_publish_triggered !== false,
    no_network_uploads: consolidationSafety.no_network_uploads !== false,
    no_db_mutation: consolidationSafety.no_db_mutation !== false,
    no_oauth_or_token_change: consolidationSafety.no_oauth_or_token_change !== false,
    no_gate_weakened: consolidationSafety.no_gate_weakened !== false,
    report_only: true,
    local_only: true,
  };
}

function buildGoal04OperatorSourceIntakeQueue({
  consolidationReport = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const storyQueues = asArray(consolidationReport.stories)
    .filter((story) => String(story?.hold_status || "").startsWith("human_held"))
    .map(buildStoryQueue)
    .sort((a, b) => a.story_id.localeCompare(b.story_id));
  const officialEntries = storyQueues.flatMap((story) => story.official_source_template_entries);
  const licensedEntries = storyQueues.flatMap((story) => story.licensed_media_template_entries);
  const queueItemCount = storyQueues.reduce((sum, story) => sum + story.intake_items.length, 0);
  const validationPlan = buildValidationPlan(storyQueues);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GOAL04_OPERATOR_SOURCE_INTAKE_QUEUE",
    goal: "04_owned_motion_materialiser",
    source_report: {
      mode: clean(consolidationReport.mode),
      generated_at: clean(consolidationReport.generated_at),
    },
    summary: {
      story_count: storyQueues.length,
      queue_item_count: queueItemCount,
      official_source_template_entries: officialEntries.length,
      licensed_media_template_entries: licensedEntries.length,
      human_authorisation_required: storyQueues.length > 0,
      auto_continue_allowed: false,
      ready_for_goal05: false,
      goal_verdict: storyQueues.length > 0 ? "PARTIAL" : "PASS",
    },
    stop_condition: {
      status: storyQueues.length > 0 ? "WAITING_FOR_OPERATOR_SOURCE_INPUT" : "NO_OPERATOR_SOURCE_INPUT_REQUIRED",
      human_action_required: storyQueues.length > 0,
      reason: storyQueues.length > 0
        ? "Human source entries, rights evidence or visual-plan approval must be supplied before automated Goal 04 work can continue."
        : "No human-held source blockers were present in the consolidation report.",
    },
    stories: storyQueues,
    official_source_entries_template: {
      schema_version: 1,
      generated_at: generatedAt,
      entries: officialEntries,
    },
    licensed_direct_media_operator_intake_template: {
      schema_version: 1,
      generated_at: generatedAt,
      entries: licensedEntries,
    },
    operator_checklist: storyQueues.map((story) => ({
      story_id: story.story_id,
      title: story.title,
      required_items: story.intake_items.map((item) => item.intake_type),
      operator_must_confirm: [
        "source_matches_story",
        "rights_basis_is_known",
        "commercial_and_platform_use_allowed_or_reviewed",
        "no_raw_image_or_reupload_is_used_as_primary_motion_source",
      ],
    })),
    post_operator_submission_validation_plan: validationPlan,
    safety: mergeSafety(consolidationReport.safety || {}),
    next_required_gate: storyQueues.length > 0
      ? "04_owned_motion_materialiser / waiting for operator-supplied source entries before intake validation"
      : "05_narration_transcript_word_timestamps",
  };
}

function renderGoal04OperatorSourceIntakeQueueMarkdown(report = {}) {
  const lines = [
    "# Goal 04 Operator Source Intake Queue",
    "",
    `Generated: ${clean(report.generated_at)}`,
    `Verdict: ${clean(report.summary?.goal_verdict)}`,
    `Stop condition: ${clean(report.stop_condition?.status)}`,
    "",
    "Human source input is required before this goal can continue. No live publishing, uploads, production DB mutation or OAuth/token changes are part of this queue.",
    "",
    "## Summary",
    "",
    `- Stories: ${report.summary?.story_count ?? 0}`,
    `- Queue items: ${report.summary?.queue_item_count ?? 0}`,
    `- Official source template entries: ${report.summary?.official_source_template_entries ?? 0}`,
    `- Licensed media template entries: ${report.summary?.licensed_media_template_entries ?? 0}`,
    `- Auto-continue allowed: ${report.summary?.auto_continue_allowed ? "yes" : "no"}`,
    `- Ready for Goal 05: ${report.summary?.ready_for_goal05 ? "yes" : "no"}`,
    "",
    "## Queue",
    "",
  ];

  for (const story of asArray(report.stories)) {
    lines.push(`### ${story.story_id} - ${story.title}`);
    lines.push(`- Hold status: ${story.hold_status}`);
    lines.push(`- Items: ${story.intake_items.map((item) => item.intake_type).join(", ") || "none"}`);
    lines.push(`- Counts toward motion readiness: ${story.counts_towards_motion_readiness ? "yes" : "no"}`);
    lines.push(`- Ready for final render: ${story.ready_for_final_render ? "yes" : "no"}`);
    for (const item of story.intake_items) {
      lines.push(`  - ${item.intake_type}: ${item.reason}`);
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

  return lines.join("\n");
}

module.exports = {
  buildGoal04OperatorSourceIntakeQueue,
  renderGoal04OperatorSourceIntakeQueueMarkdown,
};
