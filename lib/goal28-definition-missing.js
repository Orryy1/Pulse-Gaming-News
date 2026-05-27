"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "28_goal_definition_missing";
const GOAL_NUMBER = 28;
const EXPECTED_TOTAL_GOALS = 42;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function passLike(value) {
  return ["pass", "passed", "ready", "green", "ok", "clear"].includes(normaliseStatus(value));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

async function readTextIfPresent(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return "";
  return fs.readFile(filePath, "utf8");
}

function extractGoalSection(docText = "", goalNumber = GOAL_NUMBER) {
  const lines = String(docText || "").split(/\r?\n/);
  const headingPattern = new RegExp(`^###\\s+${goalNumber}\\.\\s+(.+?)\\s*$`);
  const nextHeadingPattern = /^###\s+\d+\.\s+/;
  let start = -1;
  let title = "";
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(headingPattern);
    if (match) {
      start = index;
      title = cleanText(match[1]);
      break;
    }
  }
  if (start === -1) {
    return {
      found: false,
      title: "",
      section_text: "",
      outputs: [],
      acceptance_criteria_found: false,
    };
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (nextHeadingPattern.test(lines[index])) {
      end = index;
      break;
    }
  }
  const sectionText = lines.slice(start, end).join("\n").trim();
  const outputLine = sectionText.match(/^Outputs:\s*(.+)$/im);
  const outputs = outputLine
    ? [...outputLine[1].matchAll(/`([^`]+)`/g)].map((match) => cleanText(match[1])).filter(Boolean)
    : [];
  return {
    found: true,
    title,
    section_text: sectionText,
    outputs,
    acceptance_criteria_found: /\bAcceptance\b/i.test(sectionText),
  };
}

function directBlockersFor(goalDefinition = {}) {
  const blockers = [];
  if (!goalDefinition.found) blockers.push("campaign:goal28_definition_missing");
  if (!asArray(goalDefinition.outputs).length) blockers.push("campaign:goal28_outputs_missing");
  if (!goalDefinition.acceptance_criteria_found) blockers.push("campaign:goal28_acceptance_criteria_missing");
  return blockers;
}

function upstreamBlockers(upstreamGoal27Report = {}) {
  if (!upstreamGoal27Report || typeof upstreamGoal27Report !== "object") {
    return ["upstream:goal27_goal_definition_missing_missing"];
  }
  const verdict = upstreamGoal27Report.verdict || upstreamGoal27Report.status;
  if (passLike(verdict)) return [];
  return ["upstream:goal27_goal_definition_missing_blocked"];
}

function blockerCounts(blockers = []) {
  return blockers.reduce((counts, blocker) => {
    counts[blocker] = (counts[blocker] || 0) + 1;
    return counts;
  }, {});
}

function buildContractGapReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at,
    mode: "LOCAL_PROOF",
    expected_total_goals: EXPECTED_TOTAL_GOALS,
    goal_number: GOAL_NUMBER,
    campaign_doc_path: report.campaign_doc_path,
    definition_found: Boolean(report.goal_definition?.found),
    title: report.goal_definition?.title || null,
    outputs: asArray(report.goal_definition?.outputs),
    acceptance_criteria_found: Boolean(report.goal_definition?.acceptance_criteria_found),
    blockers: asArray(report.direct_blockers),
    required_operator_action:
      asArray(report.direct_blockers).length > 0
        ? "Add the Goal 28 contract to docs/codex-main-goal.md, including heading, scope, outputs and acceptance criteria."
        : "No definition gap detected for Goal 28.",
    safety: {
      local_proof_only: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

async function buildGoal28DefinitionMissing({
  campaignDocPath = path.join(process.cwd(), "docs", "codex-main-goal.md"),
  storyPackages = [],
  upstreamGoal27Report = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const docText = await readTextIfPresent(path.resolve(campaignDocPath));
  const goalDefinition = extractGoalSection(docText, GOAL_NUMBER);
  const directBlockers = directBlockersFor(goalDefinition);
  const upstream = upstreamBlockers(upstreamGoal27Report);
  const blockers = unique([...directBlockers, ...upstream]);
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict: blockers.length ? "BLOCKED" : "PASS",
    direct_definition_verdict: directBlockers.length ? "BLOCKED" : "PASS",
    campaign_doc_path: campaignDocPath,
    expected_total_goals: EXPECTED_TOTAL_GOALS,
    summary: {
      story_count: asArray(storyPackages).length,
      goal_number: GOAL_NUMBER,
      expected_total_goals: EXPECTED_TOTAL_GOALS,
      definition_found: Boolean(goalDefinition.found),
      output_count: asArray(goalDefinition.outputs).length,
      acceptance_criteria_found: Boolean(goalDefinition.acceptance_criteria_found),
      direct_blocker_count: directBlockers.length,
      upstream_blocker_count: upstream.length,
      publish_now_count: 0,
    },
    goal_definition: goalDefinition,
    blockers,
    direct_blockers: directBlockers,
    upstream_blockers: upstream,
    blocker_counts: blockerCounts(blockers),
    operator_request: {
      required: directBlockers.length > 0,
      missing_contract_parts: directBlockers,
      requested_update:
        "Define Goal 28 in docs/codex-main-goal.md before implementation continues, including the goal heading, scope, outputs and acceptance criteria.",
      next_safe_action:
        "After the contract is added, rerun this gate before implementing any Goal 28 production behaviour.",
    },
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_external_posting: true,
      no_platform_mutation: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
  report.contract_gap_report = buildContractGapReport(report);
  return report;
}

function renderGoal28DefinitionMissingMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 28 - Definition Missing Gate");
  lines.push("");
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct definition verdict: ${report.direct_definition_verdict || "UNKNOWN"}`);
  lines.push(`Mode: ${report.mode || "LOCAL_PROOF"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Campaign doc: ${report.campaign_doc_path || "not provided"}`);
  lines.push(`- Goal number: ${report.summary?.goal_number ?? GOAL_NUMBER}`);
  lines.push(`- Expected total goals: ${report.summary?.expected_total_goals ?? EXPECTED_TOTAL_GOALS}`);
  lines.push(`- Goal definition found: ${report.summary?.definition_found ? "yes" : "no"}`);
  lines.push(`- Outputs found: ${report.summary?.output_count ?? 0}`);
  lines.push(`- Acceptance criteria found: ${report.summary?.acceptance_criteria_found ? "yes" : "no"}`);
  lines.push(`- Stories checked for carry-forward context: ${report.summary?.story_count ?? 0}`);
  lines.push(`- Publish-now actions: ${report.summary?.publish_now_count ?? 0}`);
  lines.push("");
  lines.push("## Blockers");
  for (const blocker of asArray(report.blockers)) lines.push(`- ${blocker}`);
  if (!asArray(report.blockers).length) lines.push("- None.");
  lines.push("");
  lines.push("## Operator Request");
  lines.push(report.operator_request?.requested_update || "No operator update requested.");
  lines.push("");
  lines.push("## Safety");
  lines.push("- LOCAL_PROOF only.");
  lines.push("- No live publishing, external posting, production DB mutation, platform mutation or OAuth/token mutation occurred.");
  return `${lines.join("\n")}\n`;
}

function renderOperatorRequest(report = {}) {
  const lines = [];
  lines.push("# Goal 28 Operator Request");
  lines.push("");
  lines.push("Goal 28 cannot be implemented from the current campaign docs.");
  lines.push("");
  lines.push("## Required Update");
  lines.push("- Add `### 28. <Goal Title>` to `docs/codex-main-goal.md`.");
  lines.push("- Define the goal scope.");
  lines.push("- List required outputs.");
  lines.push("- Add acceptance criteria or an equivalent completion contract.");
  lines.push("");
  lines.push("## Current Blockers");
  for (const blocker of asArray(report.direct_blockers)) lines.push(`- ${blocker}`);
  if (!asArray(report.direct_blockers).length) lines.push("- None.");
  lines.push("");
  lines.push("## Safety");
  lines.push("This request is a LOCAL_PROOF planning artefact. It does not publish, post externally, mutate production rows or change OAuth/token state.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal28DefinitionMissing(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal28DefinitionMissing requires outputDir");
  await fs.ensureDir(outputDir);
  const paths = {
    readinessJson: path.join(outputDir, "goal28_readiness_report.json"),
    readinessMarkdown: path.join(outputDir, "goal28_readiness_report.md"),
    contractGapReport: path.join(outputDir, "goal28_contract_gap_report.json"),
    operatorRequest: path.join(outputDir, "goal28_operator_request.md"),
  };
  await fs.writeJson(paths.readinessJson, report, { spaces: 2 });
  await fs.outputFile(paths.readinessMarkdown, renderGoal28DefinitionMissingMarkdown(report));
  await fs.writeJson(paths.contractGapReport, report.contract_gap_report || buildContractGapReport(report), { spaces: 2 });
  await fs.outputFile(paths.operatorRequest, renderOperatorRequest(report));
  return paths;
}

module.exports = {
  GOAL_ID,
  GOAL_NUMBER,
  EXPECTED_TOTAL_GOALS,
  buildGoal28DefinitionMissing,
  extractGoalSection,
  renderGoal28DefinitionMissingMarkdown,
  writeGoal28DefinitionMissing,
};
