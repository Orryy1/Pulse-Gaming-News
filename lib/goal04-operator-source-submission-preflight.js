"use strict";

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === "object") return [value];
  return [];
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function rowsFromPayload(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function bool(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return ["true", "yes", "y", "1", "approved", "operator_approved"].includes(clean(value).toLowerCase());
}

function itemKey(storyId, intakeType) {
  return `${clean(storyId)}::${clean(intakeType)}`;
}

function sourceFamilySuggests(row = {}, suffix = "") {
  const family = clean(row.source_family).toLowerCase();
  return suffix && family.includes(suffix.toLowerCase());
}

function requiredQueueItems(operatorQueue = {}) {
  const items = [];
  for (const story of asArray(operatorQueue.stories)) {
    for (const item of asArray(story.intake_items)) {
      items.push({
        story_id: clean(story.story_id),
        title: clean(story.title),
        intake_type: clean(item.intake_type),
        template_kind: clean(item.template_kind),
        required_fields: asArray(item.required_fields).map(clean).filter(Boolean),
      });
    }
  }
  return items;
}

function missingOfficialFields(row = {}) {
  const fields = [
    "story_id",
    "entity",
    "source_type",
    "source_owner",
    "source_family",
    "official_source_url",
    "evidence_of_officialness",
    "entity_match_notes",
  ];
  const missing = fields.filter((field) => !clean(row[field]));
  if (bool(row.downloads_allowed)) missing.push("downloads_allowed_false");
  return missing;
}

function missingLicensedFields(row = {}) {
  const missing = ["story_id", "entity", "source_family", "source_owner", "official_source_url"].filter(
    (field) => !clean(row[field]),
  );
  if (!clean(row.approved_direct_media_url) && !clean(row.local_operator_file_path)) {
    missing.push("approved_direct_media_url_or_local_operator_file_path");
  }
  if (
    (clean(row.licence_evidence) || clean(row.permission_evidence) || clean(row.licence_scope)) &&
    !bool(row.autonomous_use_approved)
  ) {
    missing.push("autonomous_use_approved");
  }
  return missing;
}

function missingOperatorPlanFields(row = {}, requiredFields = []) {
  const fields = requiredFields.length
    ? requiredFields
    : [
        "operator_confirms_source_matches_story",
        "operator_confirms_rights_basis",
        "operator_confirms_direct_media_or_owned_plan_is_allowed",
      ];
  return fields.filter((field) => {
    if (/^operator_confirms/i.test(field)) return !bool(row[field]);
    return !clean(row[field]);
  });
}

function classifySubmission({ row = {}, templateKind, requiredItem = {} }) {
  let missing = [];
  if (templateKind === "official_source") missing = missingOfficialFields(row);
  else if (templateKind === "licensed_media") missing = missingLicensedFields(row);
  else missing = missingOperatorPlanFields(row, requiredItem.required_fields);
  return {
    status: missing.length ? "incomplete_submission" : "complete_submission_candidate",
    missing_fields: missing,
  };
}

function collectSubmissionRows(payloads = []) {
  return asArray(payloads).flatMap(rowsFromPayload);
}

function matchRowToRequiredItem(row = {}, requiredItems = [], templateKind) {
  const storyId = clean(row.story_id);
  if (!storyId) return null;
  const candidates = requiredItems.filter(
    (item) => item.story_id === storyId && item.template_kind === templateKind,
  );
  if (candidates.length <= 1) return candidates[0] || null;
  if (templateKind === "official_source") {
    return candidates.find((item) => sourceFamilySuggests(row, item.intake_type)) || candidates[0];
  }
  if (templateKind === "licensed_media") {
    return candidates.find((item) => sourceFamilySuggests(row, item.intake_type)) || candidates[0];
  }
  return candidates.find((item) => clean(row.intake_type) === item.intake_type) || candidates[0];
}

function submittedItems({ requiredItems, officialRows, licensedRows, operatorPlanRows }) {
  const items = [];
  function add(row, templateKind) {
    const requiredItem = matchRowToRequiredItem(row, requiredItems, templateKind);
    const storyId = clean(row.story_id);
    const intakeType = clean(row.intake_type) || requiredItem?.intake_type || templateKind;
    const classified = classifySubmission({ row, templateKind, requiredItem: requiredItem || {} });
    items.push({
      story_id: storyId,
      title: requiredItem?.title || "",
      intake_type: intakeType,
      template_kind: templateKind,
      status: classified.status,
      missing_fields: classified.missing_fields,
      matched_required_item: Boolean(requiredItem),
      source_family: clean(row.source_family),
      validation_ready: classified.status === "complete_submission_candidate" && Boolean(requiredItem),
    });
  }
  for (const row of officialRows) add(row, "official_source");
  for (const row of licensedRows) add(row, "licensed_media");
  for (const row of operatorPlanRows) add(row, "operator_plan");
  return items;
}

function missingRequiredItems(requiredItems = [], submitted = []) {
  const complete = new Set(
    submitted
      .filter((item) => item.validation_ready)
      .map((item) => itemKey(item.story_id, item.intake_type)),
  );
  return requiredItems
    .filter((item) => !complete.has(itemKey(item.story_id, item.intake_type)))
    .map((item) => ({
      story_id: item.story_id,
      title: item.title,
      intake_type: item.intake_type,
      template_kind: item.template_kind,
      status: "missing_complete_submission",
    }));
}

function safetyFromQueue(queueSafety = {}) {
  return {
    no_publish_triggered: queueSafety.no_publish_triggered !== false,
    no_network_uploads: queueSafety.no_network_uploads !== false,
    no_db_mutation: queueSafety.no_db_mutation !== false,
    no_oauth_or_token_change: queueSafety.no_oauth_or_token_change !== false,
    no_gate_weakened: queueSafety.no_gate_weakened !== false,
    report_only: true,
    local_only: true,
    validation_not_run: true,
  };
}

function buildGoal04OperatorSourceSubmissionPreflight({
  operatorQueue = {},
  officialSourceSubmissions = [],
  licensedMediaSubmissions = [],
  operatorPlanSubmissions = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const requiredItems = requiredQueueItems(operatorQueue);
  const officialRows = collectSubmissionRows(officialSourceSubmissions);
  const licensedRows = collectSubmissionRows(licensedMediaSubmissions);
  const operatorPlanRows = collectSubmissionRows(operatorPlanSubmissions);
  const submitted = submittedItems({
    requiredItems,
    officialRows,
    licensedRows,
    operatorPlanRows,
  });
  const complete = submitted.filter((item) => item.validation_ready);
  const incomplete = submitted.filter((item) => !item.validation_ready);
  const missing = missingRequiredItems(requiredItems, submitted);
  const validationAllowed = requiredItems.length > 0 && missing.length === 0 && incomplete.length === 0;
  const queuePlan = operatorQueue.post_operator_submission_validation_plan || {};

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GOAL04_OPERATOR_SOURCE_SUBMISSION_PREFLIGHT",
    goal: "04_owned_motion_materialiser",
    source_queue: {
      mode: clean(operatorQueue.mode),
      generated_at: clean(operatorQueue.generated_at),
    },
    summary: {
      required_queue_items: requiredItems.length,
      submitted_entries: submitted.length,
      complete_submission_items: complete.length,
      incomplete_submission_items: incomplete.length,
      missing_submission_items: missing.length,
      validation_allowed: validationAllowed,
      auto_continue_allowed: false,
      ready_for_goal05: false,
      goal_verdict: validationAllowed ? "PARTIAL" : "PARTIAL",
    },
    stop_condition: {
      status: validationAllowed ? "READY_FOR_OPERATOR_INTAKE_VALIDATION" : "WAITING_FOR_OPERATOR_SOURCE_INPUT",
      human_action_required: !validationAllowed,
      reason: validationAllowed
        ? "Operator submissions are complete enough to run the local validation plan."
        : "Operator source submissions are missing or incomplete. Intake validation remains blocked.",
    },
    required_items: requiredItems,
    submitted_items: submitted,
    missing_items: missing,
    post_operator_submission_validation_plan: {
      status: validationAllowed ? "ready_to_run_local_validation" : "blocked_until_submissions_complete",
      safe_to_run_after_operator_submission: validationAllowed,
      released_commands: validationAllowed ? asArray(queuePlan.commands) : [],
      blocked_commands: validationAllowed ? [] : asArray(queuePlan.commands),
    },
    safety: safetyFromQueue(operatorQueue.safety || {}),
    next_required_gate: validationAllowed
      ? "04_owned_motion_materialiser / validate operator-submitted source entries in LOCAL_PROOF"
      : "04_owned_motion_materialiser / waiting for operator-supplied source entries before intake validation",
  };
}

function renderGoal04OperatorSourceSubmissionPreflightMarkdown(report = {}) {
  const lines = [
    "# Goal 04 Operator Source Submission Preflight",
    "",
    `Generated: ${clean(report.generated_at)}`,
    `Verdict: ${clean(report.summary?.goal_verdict)}`,
    `Stop condition: ${clean(report.stop_condition?.status)}`,
    "",
    "No intake validation was run by this preflight. Validation commands remain blocked until every required operator submission is present and complete.",
    "",
    "## Summary",
    "",
    `- Required queue items: ${report.summary?.required_queue_items ?? 0}`,
    `- Submitted entries: ${report.summary?.submitted_entries ?? 0}`,
    `- Complete submission items: ${report.summary?.complete_submission_items ?? 0}`,
    `- Incomplete submission items: ${report.summary?.incomplete_submission_items ?? 0}`,
    `- Missing submission items: ${report.summary?.missing_submission_items ?? 0}`,
    `- Validation allowed: ${report.summary?.validation_allowed ? "yes" : "no"}`,
    "",
    "## Incomplete Submissions",
    "",
  ];
  for (const item of asArray(report.submitted_items).filter((entry) => entry.status !== "complete_submission_candidate")) {
    lines.push(`- ${item.story_id} ${item.intake_type}: missing ${asArray(item.missing_fields).join(", ") || "required match"}`);
  }
  if (!asArray(report.submitted_items).some((entry) => entry.status !== "complete_submission_candidate")) {
    lines.push("- None.");
  }
  lines.push("");
  lines.push("## Missing Items");
  lines.push("");
  for (const item of asArray(report.missing_items)) {
    lines.push(`- ${item.story_id} ${item.intake_type} (${item.template_kind})`);
  }
  if (!asArray(report.missing_items).length) lines.push("- None.");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push(`- No publish triggered: ${report.safety?.no_publish_triggered === false ? "no" : "yes"}`);
  lines.push(`- No network uploads: ${report.safety?.no_network_uploads === false ? "no" : "yes"}`);
  lines.push(`- No DB mutation: ${report.safety?.no_db_mutation === false ? "no" : "yes"}`);
  lines.push(`- No OAuth or token change: ${report.safety?.no_oauth_or_token_change === false ? "no" : "yes"}`);
  lines.push(`- Validation not run: ${report.safety?.validation_not_run === false ? "no" : "yes"}`);
  lines.push("");
  lines.push(`Next gate: ${clean(report.next_required_gate)}`);
  lines.push("");
  return lines.join("\n");
}

module.exports = {
  buildGoal04OperatorSourceSubmissionPreflight,
  renderGoal04OperatorSourceSubmissionPreflightMarkdown,
};
