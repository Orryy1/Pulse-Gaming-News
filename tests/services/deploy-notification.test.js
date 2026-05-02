"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStartupDeployNotification,
} = require("../../lib/deploy-notification");

test("startup deploy notification is skipped for non-primary mirrors", () => {
  const result = buildStartupDeployNotification({
    env: {
      RAILWAY_DEPLOYMENT_ID: "abc",
      RAILWAY_GIT_COMMIT_SHA: "1234567890abcdef",
    },
    primaryInstance: false,
  });

  assert.equal(result.send, false);
  assert.equal(result.reason, "non_primary_mirror");
});

test("startup deploy notification preserves real Railway Deploy OK wording", () => {
  const result = buildStartupDeployNotification({
    env: {
      RAILWAY_DEPLOYMENT_ID: "466e48bf-6936-470a-9f9c-31c57b810b69",
      RAILWAY_GIT_COMMIT_SHA: "b01f8581234567890",
      RAILWAY_SERVICE_NAME: "Pulse Gaming",
    },
    primaryInstance: true,
  });

  assert.equal(result.send, true);
  assert.equal(result.reason, "railway_deploy");
  assert.match(result.message, /\*\*Railway Deploy OK\*\*/);
  assert.match(result.message, /Commit: b01f858/);
  assert.match(result.message, /Deploy: 466e48bf-6936-470a-9f9c-31c57b810b69/);
});

test("startup deploy notification skips local/dev starts by default", () => {
  const result = buildStartupDeployNotification({
    env: {
      DEPLOYMENT_MODE: "local",
    },
    primaryInstance: true,
  });

  assert.equal(result.send, false);
  assert.equal(result.reason, "local_deploy_notification_disabled");
  assert.equal(result.message, "");
});

test("startup deploy notification can label local starts without pretending they are Railway deploys", () => {
  const result = buildStartupDeployNotification({
    env: {
      DEPLOYMENT_MODE: "local",
      PULSE_LOCAL_DEPLOY_NOTIFY: "true",
      RAILWAY_GIT_COMMIT_SHA: "b01f8581234567890",
    },
    primaryInstance: true,
  });

  assert.equal(result.send, true);
  assert.equal(result.reason, "local_start");
  assert.match(result.message, /\*\*Local Pulse Mirror Started\*\*/);
  assert.doesNotMatch(result.message, /Railway Deploy OK/);
  assert.match(result.message, /Mode: local/);
  assert.match(result.message, /Commit: b01f858/);
});
