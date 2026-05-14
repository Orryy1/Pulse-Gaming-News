"use strict";

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function buildPublishDispatchPolicy({
  dispatchSource = "unspecified",
  env = process.env,
  allowManualOverride = false,
} = {}) {
  const autoPublish = truthy(env.AUTO_PUBLISH);
  const blockers = [];
  const advisory = [];

  if (!autoPublish && !allowManualOverride) {
    blockers.push("auto_publish_disabled");
  }
  if (dispatchSource === "unspecified") {
    advisory.push("publish dispatch source is unspecified");
  }

  return {
    dispatchSource,
    verdict: blockers.length ? "red" : advisory.length ? "amber" : "green",
    blocked: blockers.length > 0,
    autoPublish,
    allowManualOverride,
    blockers,
    advisory,
  };
}

module.exports = {
  buildPublishDispatchPolicy,
  truthy,
};
