const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalEnvCleanupPlan,
  formatLocalEnvCleanupPlanMarkdown,
  isSecretLikeKey,
} = require("../../lib/ops/local-env-cleanup-plan");

test("local env cleanup plan reports duplicate control switches with keep and stale lines", () => {
  const plan = buildLocalEnvCleanupPlan({
    envText: [
      "DEPLOYMENT_MODE=local",
      "AUTO_PUBLISH=true",
      "USE_JOB_QUEUE=false",
      "AUTO_PUBLISH=false",
    ].join("\n"),
  });

  assert.equal(plan.verdict, "red");
  assert.deepEqual(plan.summary.duplicate_control_keys, ["AUTO_PUBLISH"]);
  assert.equal(plan.duplicate_actions[0].key, "AUTO_PUBLISH");
  assert.equal(plan.duplicate_actions[0].keep_line, 4);
  assert.deepEqual(plan.duplicate_actions[0].stale_lines, [2]);
  assert.equal(plan.duplicate_actions[0].mirror_safe, true);
});

test("local env cleanup plan redacts secret-like duplicate values", () => {
  const plan = buildLocalEnvCleanupPlan({
    envText: [
      "API_TOKEN=super-secret-token",
      "API_TOKEN=new-secret-token",
      "AUTO_PUBLISH=false",
    ].join("\n"),
  });

  const action = plan.duplicate_actions.find((item) => item.key === "API_TOKEN");
  assert.equal(action.secret_like, true);
  assert.equal(action.action, "manual_secret_review_only");
  assert.match(action.effective_value, /^\(set, len \d+\)$/);
  assert.doesNotMatch(JSON.stringify(plan), /super-secret-token|new-secret-token/);
});

test("local env cleanup markdown keeps instructions safe and non-mutating", () => {
  const plan = buildLocalEnvCleanupPlan({
    envText: "AUTO_PUBLISH=true\nAUTO_PUBLISH=false\n",
  });
  const markdown = formatLocalEnvCleanupPlanMarkdown(plan);

  assert.match(markdown, /Safety: read-only/);
  assert.match(markdown, /keep line 2; stale line\(s\) 1/);
  assert.match(markdown, /Do not edit secret values from this report/);
});

test("secret-like key detection covers platform credentials", () => {
  assert.equal(isSecretLikeKey("TIKTOK_CLIENT_SECRET"), true);
  assert.equal(isSecretLikeKey("PULSE_PUBLIC_URL"), false);
});
