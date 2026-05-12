"use strict";

const {
  CONTROL_KEYS,
  parseEnvEntries,
  redactEnvValue,
  summariseEnv,
} = require("./local-cutover-plan");

const LIVE_SWITCH_KEYS = new Set([
  "DEPLOYMENT_MODE",
  "PULSE_PRIMARY_INSTANCE",
  "USE_JOB_QUEUE",
  "AUTO_PUBLISH",
]);

const MIRROR_SAFE_VALUES = {
  DEPLOYMENT_MODE: "local",
  PULSE_PRIMARY_INSTANCE: "false",
  USE_JOB_QUEUE: "false",
  AUTO_PUBLISH: "false",
};

function groupEntries(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push(entry);
  }
  return byKey;
}

function isSecretLikeKey(key) {
  return /(SECRET|TOKEN|KEY|PASSWORD|WEBHOOK|COOKIE|AUTH|CREDENTIAL)/i.test(
    String(key || ""),
  );
}

function buildDuplicateAction(key, entries) {
  const effective = entries[entries.length - 1];
  const stale = entries.slice(0, -1);
  const controlKey = CONTROL_KEYS.has(key);
  const liveSwitch = LIVE_SWITCH_KEYS.has(key);
  const secretLike = isSecretLikeKey(key);
  const expectedMirrorValue = MIRROR_SAFE_VALUES[key] || null;
  const effectiveValue = String(effective?.value || "");
  const mirrorSafe =
    expectedMirrorValue == null ||
    effectiveValue.toLowerCase() === expectedMirrorValue.toLowerCase();

  let action = "manual_review";
  if (controlKey) action = "comment_or_remove_stale_occurrences";
  if (secretLike && !controlKey) action = "manual_secret_review_only";

  return {
    key,
    control_key: controlKey,
    live_switch: liveSwitch,
    secret_like: secretLike,
    occurrence_count: entries.length,
    lines: entries.map((entry) => entry.line),
    stale_lines: stale.map((entry) => entry.line),
    keep_line: effective.line,
    effective_value: redactEnvValue(key, effective.value),
    expected_mirror_value: expectedMirrorValue,
    mirror_safe: mirrorSafe,
    action,
    operator_note: controlKey
      ? `Keep line ${effective.line} as the effective value and comment/remove stale line(s) ${stale
          .map((entry) => entry.line)
          .join(", ")}.`
      : "Review duplicate manually. Values are redacted in this report.",
  };
}

function buildLocalEnvCleanupPlan({ envText = "" } = {}) {
  const entries = parseEnvEntries(envText);
  const summary = summariseEnv(envText);
  const byKey = groupEntries(entries);
  const duplicateActions = [];

  for (const [key, keyEntries] of byKey.entries()) {
    if (keyEntries.length <= 1) continue;
    duplicateActions.push(buildDuplicateAction(key, keyEntries));
  }

  duplicateActions.sort((a, b) => a.key.localeCompare(b.key));

  const duplicateControlKeys = duplicateActions
    .filter((item) => item.control_key)
    .map((item) => item.key);
  const unsafeMirrorSwitches = duplicateActions
    .filter((item) => item.live_switch && !item.mirror_safe)
    .map((item) => item.key);
  const secretDuplicates = duplicateActions
    .filter((item) => item.secret_like && !item.control_key)
    .map((item) => item.key);

  const blockers = [];
  const warnings = [];
  const nextSteps = [];

  if (duplicateControlKeys.length) {
    blockers.push(
      `duplicate local control switches: ${duplicateControlKeys.join(", ")}`,
    );
  }
  if (unsafeMirrorSwitches.length) {
    blockers.push(
      `effective mirror safety value is not safe for: ${unsafeMirrorSwitches.join(", ")}`,
    );
  }
  if (secretDuplicates.length) {
    warnings.push(
      `duplicate secret-like keys require manual review: ${secretDuplicates.join(", ")}`,
    );
  }

  nextSteps.push(
    "Do not edit secret values from this report; values are intentionally redacted.",
  );
  nextSteps.push(
    "For duplicate local control switches, keep only the final effective line and comment/remove older duplicate lines.",
  );
  nextSteps.push(
    "Keep local mirror-safe values until public health and Cloudflare tunnel checks are green.",
  );
  nextSteps.push(
    "Only after local posting readiness is green should primary, queue and auto-publish be flipped in a controlled cutover.",
  );

  const verdict = blockers.length ? "red" : warnings.length ? "amber" : "green";
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    verdict,
    safety:
      "read-only; does not edit .env, print secrets, start jobs, post, mutate tokens, touch Railway or change Cloudflare",
    summary: {
      env_entry_count: entries.length,
      duplicate_key_count: duplicateActions.length,
      duplicate_control_keys: duplicateControlKeys,
      duplicate_secret_like_keys: secretDuplicates,
    },
    effective_control: summary.effective_control,
    duplicate_actions: duplicateActions,
    blockers,
    warnings,
    next_steps: nextSteps,
  };
}

function formatLocalEnvCleanupPlanMarkdown(plan) {
  const lines = [];
  lines.push("# Local Env Cleanup Plan");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at}`);
  lines.push(`Verdict: ${String(plan.verdict || "unknown").toUpperCase()}`);
  lines.push(`Safety: ${plan.safety}`);
  lines.push("");
  lines.push("## Effective Control Values");
  const control = plan.effective_control || {};
  if (!Object.keys(control).length) {
    lines.push("- none found");
  } else {
    for (const [key, value] of Object.entries(control)) {
      lines.push(`- ${key}: ${value || "(empty)"}`);
    }
  }
  lines.push("");
  lines.push("## Duplicate Actions");
  if (!plan.duplicate_actions?.length) {
    lines.push("- none");
  } else {
    for (const item of plan.duplicate_actions) {
      lines.push(
        `- ${item.key}: keep line ${item.keep_line}; stale line(s) ${item.stale_lines.join(", ") || "none"}; action=${item.action}; effective=${item.effective_value || "(empty)"}`,
      );
      if (item.expected_mirror_value != null) {
        lines.push(
          `  mirror safe: ${item.mirror_safe ? "yes" : "no"}; expected while mirrored=${item.expected_mirror_value}`,
        );
      }
    }
  }
  if (plan.blockers?.length) {
    lines.push("");
    lines.push("## Blockers");
    for (const blocker of plan.blockers) lines.push(`- ${blocker}`);
  }
  if (plan.warnings?.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("## Next Steps");
  for (const step of plan.next_steps || []) lines.push(`- ${step}`);
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildLocalEnvCleanupPlan,
  formatLocalEnvCleanupPlanMarkdown,
  isSecretLikeKey,
};
