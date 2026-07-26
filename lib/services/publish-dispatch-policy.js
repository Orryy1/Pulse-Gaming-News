"use strict";

const {
  resolveOperatingContract,
} = require("../stabilisation/operating-contract");

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function buildPublishDispatchPolicy({
  dispatchSource = "unspecified",
  env = process.env,
  allowManualOverride = false,
} = {}) {
  const autoPublish = truthy(env.AUTO_PUBLISH);
  const operatingContract = resolveOperatingContract({ env });
  const blockers = [];
  const advisory = [];

  if (!autoPublish && !allowManualOverride) {
    blockers.push("auto_publish_disabled");
  }
  if (dispatchSource === "unspecified") {
    advisory.push("publish dispatch source is unspecified");
  }
  if (!operatingContract.valid) {
    blockers.push(...operatingContract.blockers);
  }
  if (!operatingContract.live_mutation_allowed) {
    blockers.push("live_guarded_mode_required");
  }
  if (
    String(env.PULSE_CONTROL_TOWER_VERDICT || "").trim().toUpperCase() !==
    "GREEN"
  ) {
    blockers.push("control_tower_not_green");
  }
  if (!truthy(env.PULSE_KILL_SWITCH_HEALTHY)) {
    blockers.push("kill_switch_not_healthy");
  }

  return {
    dispatchSource,
    verdict: blockers.length ? "red" : advisory.length ? "amber" : "green",
    blocked: blockers.length > 0,
    autoPublish,
    allowManualOverride,
    operatingContract,
    blockers: [...new Set(blockers)],
    advisory,
  };
}

module.exports = {
  buildPublishDispatchPolicy,
  truthy,
};
