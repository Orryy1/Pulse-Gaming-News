"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const COMMANDS = Object.freeze({
  "bridge-live-rights-repair": {
    purpose: "Inspect inputs for a governed live-rights repair plan.",
    required_inputs: ["daily_news.json"],
    unavailable_reason:
      "The production database repair implementation was not ported into this reviewed release slice.",
  },
  "bridge-preflight-stamp-repair": {
    purpose: "Inspect inputs for a governed preflight-stamp repair plan.",
    required_inputs: ["daily_news.json"],
    unavailable_reason:
      "The production database repair implementation was not ported into this reviewed release slice.",
  },
  "goal-audio-materialize": {
    purpose: "Inspect the audio and timestamp materialisation workbench.",
    required_inputs: [
      "output/goal-contract/audio_timestamp_workbench.json",
    ],
    unavailable_reason:
      "The audio materialiser and its provider dependency graph were not ported into this reviewed release slice.",
  },
  "goal-audio-timestamps": {
    purpose: "Inspect inputs for the narration and word-timestamp workbench.",
    required_inputs: [
      "output/goal-contract/render_input_work_order.json",
    ],
    unavailable_reason:
      "The specialist audio timestamp workbench was not ported into this reviewed release slice.",
  },
  "goal-owned-motion": {
    purpose: "Inspect inputs for governed owned-motion materialisation.",
    required_inputs: [
      "output/goal-contract/render_input_work_order.json",
    ],
    unavailable_reason:
      "The owned-motion materialiser and its renderer graph were not ported into this reviewed release slice.",
  },
  "goal-platform-duration-contract": {
    purpose: "Inspect inputs for platform-duration contract evidence.",
    required_inputs: [
      "output/goal-contract/story-packages.json",
      "output/goal-contract/dry_run_publish_plan.json",
    ],
    unavailable_reason:
      "The specialist duration-contract repair implementation was not ported into this reviewed release slice.",
  },
  "goal-platform-native-repair": {
    purpose: "Inspect inputs for a platform-native pack repair plan.",
    required_inputs: ["output/goal-contract/story-packages.json"],
    unavailable_reason:
      "The platform-native pack repair implementation was not ported into this reviewed release slice.",
  },
  "goal-platform-variants": {
    purpose: "Inspect inputs for governed local platform variants.",
    required_inputs: ["output/goal-contract/story-packages.json"],
    unavailable_reason:
      "The platform variant materialiser was not ported into this reviewed release slice.",
  },
  "goal-production-render": {
    purpose: "Inspect the governed production-render work order.",
    required_inputs: [
      "output/goal-contract/render_input_work_order.json",
    ],
    unavailable_reason:
      "The production materialiser was not ported into this reviewed release slice.",
  },
  "goal-render-inputs": {
    purpose: "Inspect inputs for the governed render-input work order.",
    required_inputs: [
      "output/goal-contract/production_render_cutover_plan.json",
      "output/goal-contract/dry_run_publish_plan.json",
    ],
    unavailable_reason:
      "The specialist render-input work-order implementation was not ported into this reviewed release slice.",
  },
  "pipeline-backlog": {
    purpose: "Inspect local story evidence for pipeline backlog analysis.",
    required_inputs: ["daily_news.json"],
    unavailable_reason:
      "The reviewed release bridge does not open the configured production database by default.",
  },
  "v4-motion-pack": {
    purpose: "Inspect governed story evidence for a Visual V4 motion pack.",
    required_inputs: [
      "output/goal-contract/production_cutover_story_packages.json",
    ],
    unavailable_reason:
      "The Visual V4 motion-pack builder and its media graph were not ported into this reviewed release slice.",
  },
  "v4-source-family-acquisition": {
    purpose: "Inspect Visual V4 motion-pack source-family evidence.",
    required_inputs: [
      "output/studio-v4/motion-packs/visual_v4_motion_packs.json",
    ],
    unavailable_reason:
      "The Visual V4 source-family acquisition implementation was not ported into this reviewed release slice.",
  },
});

const RECORD_ARRAY_KEYS = [
  "jobs",
  "candidates",
  "story_packages",
  "packages",
  "stories",
  "rows",
  "items",
  "entries",
  "actions",
  "plans",
  "clips",
  "reports",
];

function summariseJson(body) {
  try {
    const value = JSON.parse(body.toString("utf8"));
    const topLevelType = Array.isArray(value)
      ? "array"
      : value === null
        ? "null"
        : typeof value;
    const topLevelKeys =
      value && !Array.isArray(value) && typeof value === "object"
        ? Object.keys(value).sort().slice(0, 50)
        : [];
    let recordCount = Array.isArray(value) ? value.length : 0;
    if (!Array.isArray(value) && value && typeof value === "object") {
      const recordKey = RECORD_ARRAY_KEYS.find((key) =>
        Array.isArray(value[key]),
      );
      if (recordKey) recordCount = value[recordKey].length;
    }
    return {
      valid: true,
      top_level_type: topLevelType,
      top_level_keys: topLevelKeys,
      record_count: recordCount,
    };
  } catch {
    return {
      valid: false,
      top_level_type: null,
      top_level_keys: [],
      record_count: 0,
    };
  }
}

function inspectInput(stateRoot, relativePath) {
  const absolutePath = path.resolve(stateRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      path: relativePath,
      exists: false,
      size_bytes: 0,
      sha256: null,
    };
  }
  const body = fs.readFileSync(absolutePath);
  return {
    path: relativePath,
    exists: true,
    size_bytes: body.length,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
    json: relativePath.toLowerCase().endsWith(".json")
      ? summariseJson(body)
      : null,
  };
}

function buildOperatorCommandReport({
  command,
  stateRoot,
  generatedAt = new Date().toISOString(),
} = {}) {
  const definition = COMMANDS[command];
  if (!definition) throw new Error(`Unsupported operator command: ${command}`);

  const inputs = definition.required_inputs.map((relativePath) =>
    inspectInput(stateRoot, relativePath),
  );
  const blockers = [
    definition.unavailable_reason,
    ...inputs
      .filter((input) => !input.exists)
      .map((input) => `Required local input is missing: ${input.path}`),
  ];

  return {
    schema_version: "pulse-operator-command-contract-v1",
    generated_at: generatedAt,
    command,
    purpose: definition.purpose,
    execution_mode: "LOCAL_PROOF",
    execution_status: "COMPLETE",
    readiness: "HOLD",
    publish_authorised: false,
    capability: {
      mode: "INSPECT_ONLY",
      production_implementation_available: false,
      materialisation_performed: false,
    },
    inputs,
    blockers,
    safety: {
      external_calls: [],
      production_database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
      live_publish_attempted: false,
    },
  };
}

function renderOperatorCommandMarkdown(report = {}) {
  const lines = [
    `# ${report.command || "Operator Command"}`,
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Execution mode: ${report.execution_mode || "unknown"}`,
    `Execution status: ${report.execution_status || "unknown"}`,
    `Readiness: ${report.readiness || "HOLD"}`,
    "",
    "## Capability",
    "",
    `- ${report.purpose || "Local proof inspection."}`,
    "- No materialisation was performed.",
    "- This report is not publication authority.",
    "",
    "## Inputs",
    "",
  ];
  if (!report.inputs?.length) lines.push("- none");
  for (const input of report.inputs || []) {
    lines.push(`- ${input.path}: ${input.exists ? "present" : "missing"}`);
  }
  lines.push("", "## Blockers", "");
  if (!report.blockers?.length) lines.push("- none");
  for (const blocker of report.blockers || []) lines.push(`- ${blocker}`);
  lines.push(
    "",
    "## Safety",
    "",
    "- No external calls",
    "- No production database mutation",
    "- No OAuth or token mutation",
    "- No platform objects created",
    "- No live publish attempted",
    "",
  );
  return lines.join("\n");
}

function writeOperatorCommandReport(report, { outDir } = {}) {
  const resolvedOutDir = path.resolve(outDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const jsonPath = path.join(resolvedOutDir, `${report.command}.json`);
  const markdownPath = path.join(resolvedOutDir, `${report.command}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    markdownPath,
    renderOperatorCommandMarkdown(report),
    "utf8",
  );
  return { jsonPath, markdownPath };
}

module.exports = {
  COMMANDS,
  RECORD_ARRAY_KEYS,
  buildOperatorCommandReport,
  renderOperatorCommandMarkdown,
  summariseJson,
  writeOperatorCommandReport,
};
