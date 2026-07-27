"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const REQUIRED_SECTIONS = [
  { id: "repo_layout", label: "Repo layout", needle: "## Repo layout" },
  { id: "key_directories", label: "Key directories", needle: "## Key directories" },
  { id: "build_commands", label: "Build commands", needle: "## Build commands" },
  { id: "test_commands", label: "Test commands", needle: "## Test commands" },
  { id: "render_commands", label: "Render commands", needle: "## Render commands" },
  { id: "dry_run_publish_commands", label: "Dry-run publish commands", needle: "## Dry-run publish commands" },
  { id: "safety_modes", label: "Safety modes", needle: "## Safety modes" },
  { id: "banned_behaviours", label: "Banned behaviours", needle: "## Banned behaviours" },
  { id: "current_cutover_context", label: "Current production-cutover context", needle: "## Current production-cutover context" },
  { id: "definition_of_done", label: "Definition of done", needle: "## Definition of done" },
  { id: "focused_tests", label: "Focused tests", needle: "## Focused tests" },
  { id: "full_tests", label: "Full tests", needle: "## Full tests" },
  { id: "preflight", label: "Preflight", needle: "## Preflight" },
  { id: "render_health", label: "Render health", needle: "## Render health" },
  { id: "repair_backlog", label: "Repair backlog", needle: "## Repair backlog" },
  { id: "platform_packs", label: "Platform packs", needle: "## Platform packs" },
  { id: "production_law", label: "Pulse Gaming production law", needle: "## Pulse Gaming production law" },
];

const CRITICAL_RULES = [
  { id: "no_live_publish_default", text: "No live publishing by default." },
  { id: "no_oauth_token_mutation_default", text: "No OAuth/token mutation by default." },
  { id: "no_production_db_mutation_default", text: "No production DB mutation by default." },
  { id: "no_gate_weakening", text: "Do not weaken gates." },
  { id: "tdd_required", text: "TDD is required." },
  { id: "focused_tests_required", text: "Focused tests are required." },
  { id: "machine_readable_artefacts_required", text: "Machine-readable artefacts are required." },
  { id: "proof_reporting_required", text: "Proof reporting is required." },
  { id: "local_proof_default", text: "LOCAL_PROOF is the default mode." },
  { id: "dry_run_publish_default", text: "DRY_RUN_PUBLISH is the default publish mode." },
  { id: "rendered_not_publishable", text: "Rendered does not mean publishable." },
  { id: "dry_run_not_scheduler_ready", text: "Dry-run package does not mean scheduler-ready." },
  { id: "scheduler_not_platform_ready", text: "Scheduler-ready does not mean platform-ready." },
  { id: "platform_ready_not_auto_publish", text: "Platform-ready does not mean safe to auto-publish." },
  { id: "green_control_tower_required", text: "Only GREEN control tower verdict can publish." },
  { id: "placeholder_titles_incident", text: "Placeholder titles are production incidents." },
  { id: "internal_qa_language_incident", text: "Internal QA language in public narration is a production incident." },
  { id: "missing_inputs_block_publish", text: "Missing narration, timestamps, materialised motion or rights records blocks publishing." },
  { id: "artefacts_back_readiness", text: "All readiness claims must be backed by artefacts." },
];

function normalise(value) {
  return String(value || "").replace(/\r\n/g, "\n").toLowerCase();
}

function presentItems(content, items) {
  const normalised = normalise(content);
  return items.map((item) => ({
    ...item,
    present: normalised.includes(normalise(item.needle || item.text)),
  }));
}

async function buildAgentOperatingRulesReport({ rootDir = process.cwd(), generatedAt = new Date().toISOString() } = {}) {
  const agentsPath = path.join(rootDir, "AGENTS.md");
  const exists = await fs.pathExists(agentsPath);
  const content = exists ? await fs.readFile(agentsPath, "utf8") : "";
  const sections = presentItems(content, REQUIRED_SECTIONS);
  const criticalRules = presentItems(content, CRITICAL_RULES);
  const missingSections = sections.filter((section) => !section.present);
  const missingCriticalRules = criticalRules.filter((rule) => !rule.present);
  const rejectionReasons = [];

  if (!exists) rejectionReasons.push("agents_md_missing");
  if (missingSections.length > 0) rejectionReasons.push("required_operating_sections_missing");
  if (missingCriticalRules.length > 0) rejectionReasons.push("critical_safety_language_missing");

  return {
    goal_id: "goal_00_repo_operating_rules",
    generated_at: generatedAt,
    status: rejectionReasons.length === 0 ? "PASS" : "FAIL",
    agents_md: {
      path: agentsPath,
      exists,
    },
    summary: {
      required_sections: REQUIRED_SECTIONS.length,
      missing_required_sections: missingSections.length,
      critical_rules: CRITICAL_RULES.length,
      missing_critical_rules: missingCriticalRules.length,
    },
    safety: {
      live_publish_allowed_by_default: !criticalRules.find((rule) => rule.id === "no_live_publish_default")?.present,
      production_db_mutation_allowed_by_default: !criticalRules.find((rule) => rule.id === "no_production_db_mutation_default")?.present,
      oauth_token_mutation_allowed_by_default: !criticalRules.find((rule) => rule.id === "no_oauth_token_mutation_default")?.present,
      external_posting_allowed_by_default: !criticalRules.find((rule) => rule.id === "no_live_publish_default")?.present,
      gate_weakening_allowed: !criticalRules.find((rule) => rule.id === "no_gate_weakening")?.present,
    },
    sections,
    critical_rules: criticalRules,
    missing_sections: missingSections.map((section) => section.id),
    missing_critical_rules: missingCriticalRules.map((rule) => rule.id),
    rejection_reasons: rejectionReasons,
  };
}

function renderAgentOperatingRulesMarkdown(report) {
  const lines = [
    "# Goal 00 Agent Operating Rules",
    "",
    `Status: ${report.status}`,
    `Generated: ${report.generated_at}`,
    `AGENTS.md: ${report.agents_md.exists ? report.agents_md.path : "missing"}`,
    "",
    "## Summary",
    "",
    `- Required sections: ${report.summary.required_sections}`,
    `- Missing required sections: ${report.summary.missing_required_sections}`,
    `- Critical safety rules: ${report.summary.critical_rules}`,
    `- Missing critical safety rules: ${report.summary.missing_critical_rules}`,
    "",
    "## Safety defaults",
    "",
    `- Live publish allowed by default: ${report.safety.live_publish_allowed_by_default}`,
    `- Production DB mutation allowed by default: ${report.safety.production_db_mutation_allowed_by_default}`,
    `- OAuth/token mutation allowed by default: ${report.safety.oauth_token_mutation_allowed_by_default}`,
    `- External posting allowed by default: ${report.safety.external_posting_allowed_by_default}`,
    `- Gate weakening allowed: ${report.safety.gate_weakening_allowed}`,
  ];

  if (report.rejection_reasons.length > 0) {
    lines.push("", "## Rejection reasons", "");
    for (const reason of report.rejection_reasons) lines.push(`- ${reason}`);
  }

  if (report.missing_sections.length > 0) {
    lines.push("", "## Missing sections", "");
    for (const section of report.missing_sections) lines.push(`- ${section}`);
  }

  if (report.missing_critical_rules.length > 0) {
    lines.push("", "## Missing critical rules", "");
    for (const rule of report.missing_critical_rules) lines.push(`- ${rule}`);
  }

  return `${lines.join("\n")}\n`;
}

async function writeAgentOperatingRulesArtifacts(report, { outputDir = path.join(process.cwd(), "output", "goal-00") } = {}) {
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "agent_operating_rules_report.json");
  const markdownPath = path.join(outputDir, "agent_operating_rules_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderAgentOperatingRulesMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

module.exports = {
  REQUIRED_SECTIONS,
  CRITICAL_RULES,
  buildAgentOperatingRulesReport,
  renderAgentOperatingRulesMarkdown,
  writeAgentOperatingRulesArtifacts,
};
