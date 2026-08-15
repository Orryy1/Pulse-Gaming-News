"use strict";

function required(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function expectedVersion(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) {
    throw new Error("control_switch_expected_version_required");
  }
  return result;
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("control_switch_time_invalid");
  return date.toISOString();
}

function bind(db) {
  const getStmt = db.prepare("SELECT * FROM control_switches WHERE name = ?");
  const insertStmt = db.prepare(`
    INSERT INTO control_switches
      (name, state, version, updated_at, actor_id, reason, authority_decision_id)
    VALUES (@name, @state, 1, @now, @actorId, @reason, @authorityDecisionId)
    RETURNING *
  `);
  const updateStmt = db.prepare(`
    UPDATE control_switches
    SET state = @state,
        version = version + 1,
        updated_at = @now,
        actor_id = @actorId,
        reason = @reason,
        authority_decision_id = @authorityDecisionId
    WHERE name = @name AND version = @expectedVersion
    RETURNING *
  `);
  const eventStmt = db.prepare(`
    INSERT INTO control_switch_events
      (name, from_state, to_state, version, actor_id, reason,
       authority_decision_id, created_at)
    VALUES (@name, @fromState, @toState, @version, @actorId, @reason,
            @authorityDecisionId, @now)
  `);

  function get(name) {
    const normalised = String(name || "").trim();
    return normalised ? getStmt.get(normalised) || null : null;
  }

  function transition({
    name,
    toState,
    actorId,
    reason,
    expectedVersion: version,
    authorityDecisionId = null,
    now = new Date(),
  }) {
    const normalisedName = required(name, "control_switch_name_required");
    const normalisedActor = required(actorId, "control_switch_actor_required");
    const normalisedReason = required(reason, "control_switch_reason_required");
    const normalisedVersion = expectedVersion(version);
    const authority = authorityDecisionId === null
      ? null
      : required(authorityDecisionId, "authority_decision_required");
    if (toState === "CLEAR" && !authority) {
      throw new Error("authority_decision_required");
    }
    const nowIso = iso(now);
    const transaction = db.transaction(() => {
      const current = getStmt.get(normalisedName) || null;
      if (!current) {
        if (normalisedVersion !== 0) throw new Error("stale_control_version");
        const inserted = insertStmt.get({
          name: normalisedName,
          state: toState,
          now: nowIso,
          actorId: normalisedActor,
          reason: normalisedReason,
          authorityDecisionId: authority,
        });
        eventStmt.run({
          name: normalisedName,
          fromState: null,
          toState,
          version: inserted.version,
          actorId: normalisedActor,
          reason: normalisedReason,
          authorityDecisionId: authority,
          now: nowIso,
        });
        return { changed: true, row: inserted };
      }
      if (current.version !== normalisedVersion) {
        throw new Error("stale_control_version");
      }
      if (current.state === toState) {
        return { changed: false, row: current };
      }
      const updated = updateStmt.get({
        name: normalisedName,
        state: toState,
        now: nowIso,
        actorId: normalisedActor,
        reason: normalisedReason,
        authorityDecisionId: authority,
        expectedVersion: normalisedVersion,
      });
      if (!updated) throw new Error("stale_control_version");
      eventStmt.run({
        name: normalisedName,
        fromState: current.state,
        toState,
        version: updated.version,
        actorId: normalisedActor,
        reason: normalisedReason,
        authorityDecisionId: authority,
        now: nowIso,
      });
      return { changed: true, row: updated };
    });
    return transaction.immediate();
  }

  return {
    get,
    assertClear({ name = "external_mutations" } = {}) {
      const row = get(name);
      if (!row) {
        return {
          clear: false,
          state: "ENGAGED",
          version: 0,
          reason: "missing_control_switch",
        };
      }
      return {
        clear: row.state === "CLEAR",
        state: row.state,
        version: row.version,
        reason: row.reason,
        authority_decision_id: row.authority_decision_id,
      };
    },
    engage(input) {
      return transition({ ...input, toState: "ENGAGED" });
    },
    clear(input) {
      return transition({ ...input, toState: "CLEAR" });
    },
  };
}

module.exports = { bind, iso };
