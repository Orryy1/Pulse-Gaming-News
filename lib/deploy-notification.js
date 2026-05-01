"use strict";

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function shortCommit(env) {
  const sha = String(env.RAILWAY_GIT_COMMIT_SHA || "").trim();
  if (sha) return sha.slice(0, 7);
  return "dev";
}

function serviceName(env) {
  return String(env.RAILWAY_SERVICE_NAME || env.SERVICE_NAME || "Pulse Gaming").trim();
}

function deploymentMode(env) {
  return String(env.DEPLOYMENT_MODE || "local").trim() || "local";
}

function buildStartupDeployNotification({ env = process.env, primaryInstance = true } = {}) {
  if (!primaryInstance) {
    return {
      send: false,
      reason: "non_primary_mirror",
      message: "",
    };
  }

  const deployId = String(env.RAILWAY_DEPLOYMENT_ID || "").trim();
  if (deployId) {
    return {
      send: true,
      reason: "railway_deploy",
      message:
        `**Railway Deploy OK**\n` +
        `Service: ${serviceName(env)}\n` +
        `Commit: ${shortCommit(env)}\n` +
        `Deploy: ${deployId}`,
    };
  }

  if (!truthy(env.PULSE_LOCAL_DEPLOY_NOTIFY)) {
    return {
      send: false,
      reason: "local_deploy_notification_disabled",
      message: "",
    };
  }

  return {
    send: true,
    reason: "local_start",
    message:
      `**Local Pulse Mirror Started**\n` +
      `Service: ${serviceName(env)}\n` +
      `Mode: ${deploymentMode(env)}\n` +
      `Commit: ${shortCommit(env)}\n` +
      `Deploy: local`,
  };
}

module.exports = {
  buildStartupDeployNotification,
};
