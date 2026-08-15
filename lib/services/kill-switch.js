"use strict";

function required(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function forced(value) {
  return value === true || /^(?:1|true|yes|on|engaged)$/i.test(String(value || "").trim());
}

function buildKillSwitchService({
  repo,
  name = "external_mutations",
  forcedEngaged = false,
  now = () => new Date(),
} = {}) {
  if (!repo || typeof repo.assertClear !== "function") {
    throw new Error("durable_kill_switch_repository_required");
  }
  const switchName = required(name, "kill_switch_name_required");
  const isForced = () => forced(typeof forcedEngaged === "function" ? forcedEngaged() : forcedEngaged);

  function status() {
    const durable = repo.assertClear({ name: switchName });
    if (isForced()) {
      return {
        ...durable,
        clear: false,
        state: "ENGAGED",
        reason: "forced_engaged",
        forced_engaged: true,
      };
    }
    return { ...durable, forced_engaged: false };
  }

  return {
    name: switchName,
    status,
    assertExternalMutationAllowed({ expectedVersion = null } = {}) {
      const current = status();
      if (!current.clear) {
        const error = new Error("kill_switch_engaged");
        error.code = "kill_switch_engaged";
        error.kill_switch = current;
        throw error;
      }
      if (
        expectedVersion !== null
        && Number(expectedVersion) !== Number(current.version)
      ) {
        const error = new Error("kill_switch_version_changed");
        error.code = "kill_switch_version_changed";
        error.expected_version = Number(expectedVersion);
        error.current_version = Number(current.version);
        throw error;
      }
      return current;
    },
    engage({ actorId, reason, expectedVersion, authorityDecisionId = null } = {}) {
      const current = repo.engage({
        name: switchName,
        actorId: required(actorId, "kill_switch_actor_required"),
        reason: required(reason, "kill_switch_reason_required"),
        expectedVersion,
        authorityDecisionId,
        now: now(),
      });
      return current;
    },
    clear({ actorId, reason, expectedVersion, authorityDecisionId } = {}) {
      if (isForced()) throw new Error("kill_switch_forced_engaged");
      return repo.clear({
        name: switchName,
        actorId: required(actorId, "kill_switch_actor_required"),
        reason: required(reason, "kill_switch_reason_required"),
        expectedVersion,
        authorityDecisionId: required(
          authorityDecisionId,
          "authority_decision_required",
        ),
        now: now(),
      });
    },
  };
}

module.exports = { buildKillSwitchService, forced };
