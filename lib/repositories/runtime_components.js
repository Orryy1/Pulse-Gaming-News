"use strict";

function required(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function positiveInteger(value, code) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(code);
  return result;
}

function expectedVersion(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new Error("runtime_component_expected_version_required");
  }
  return result;
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("runtime_component_time_invalid");
  return date.toISOString();
}

function identity(input) {
  const commitSha = required(input.commitSha, "runtime_component_commit_required").toLowerCase();
  const configurationSha256 = required(
    input.configurationSha256,
    "runtime_component_configuration_required",
  ).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error("runtime_component_commit_invalid");
  if (!/^[a-f0-9]{64}$/.test(configurationSha256)) {
    throw new Error("runtime_component_configuration_invalid");
  }
  return { commitSha, configurationSha256 };
}

function leaseExpiry(now, leaseMs) {
  const duration = Number(leaseMs);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("runtime_component_lease_invalid");
  }
  return iso(new Date(new Date(now).getTime() + duration));
}

function bind(db) {
  const getStmt = db.prepare(
    "SELECT * FROM runtime_components WHERE component_id = ?",
  );
  const getInstanceStmt = db.prepare(
    "SELECT * FROM runtime_components WHERE instance_key = ?",
  );
  const insertStmt = db.prepare(`
    INSERT INTO runtime_components
      (component_id, instance_key, component_type, role, commit_sha,
       configuration_sha256, process_id, process_started_at, state,
       registered_at, heartbeat_at, expires_at, stopped_at,
       metadata_json, version)
    VALUES (@componentId, @instanceKey, @componentType, @role, @commitSha,
            @configurationSha256, @processId, @processStartedAt, @state,
            @now, @now, @expiresAt, NULL, @metadataJson, 1)
    RETURNING *
  `);
  const updateStmt = db.prepare(`
    UPDATE runtime_components
    SET component_type = @componentType,
        role = @role,
        commit_sha = @commitSha,
        configuration_sha256 = @configurationSha256,
        process_id = @processId,
        process_started_at = @processStartedAt,
        state = @state,
        registered_at = CASE WHEN @replaceIdentity = 1 THEN @now ELSE registered_at END,
        heartbeat_at = @now,
        expires_at = @expiresAt,
        stopped_at = @stoppedAt,
        metadata_json = @metadataJson,
        version = version + 1
    WHERE component_id = @componentId
      AND instance_key = @instanceKey
      AND version = @expectedVersion
    RETURNING *
  `);
  const eventStmt = db.prepare(`
    INSERT INTO runtime_component_events
      (component_id, version, from_state, to_state, event_type,
       evidence_json, created_at)
    VALUES (@componentId, @version, @fromState, @toState,
            @eventType, @evidenceJson, @now)
  `);
  const listFreshStmt = db.prepare(`
    SELECT * FROM runtime_components
    WHERE state <> 'STOPPED'
      AND expires_at > @now
      AND (@componentType IS NULL OR component_type = @componentType)
      AND (@role IS NULL OR role = @role)
    ORDER BY component_type, role, instance_key
  `);

  function writeEvent(current, row, eventType, now, evidence = null) {
    eventStmt.run({
      componentId: row.component_id,
      version: row.version,
      fromState: current?.state || null,
      toState: row.state,
      eventType,
      evidenceJson: evidence ? JSON.stringify(evidence) : null,
      now,
    });
  }

  function common(input, now) {
    const ids = identity(input);
    return {
      componentId: required(input.componentId, "runtime_component_id_required"),
      instanceKey: required(input.instanceKey, "runtime_component_instance_key_required"),
      componentType: required(input.componentType, "runtime_component_type_required"),
      role: required(input.role, "runtime_component_role_required"),
      ...ids,
      processId: positiveInteger(input.processId, "runtime_component_process_id_invalid"),
      processStartedAt: iso(input.processStartedAt),
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      now,
    };
  }

  const registerTransaction = db.transaction((input) => {
    const now = iso(input.now);
    const values = common(input, now);
    const current = getStmt.get(values.componentId) || null;
    const byInstance = getInstanceStmt.get(values.instanceKey) || null;
    if (byInstance && byInstance.component_id !== values.componentId) {
      throw new Error("runtime_component_instance_key_conflict");
    }
    const expiresAt = leaseExpiry(now, input.leaseMs || 60000);
    const state = input.state || "STARTING";
    if (!current) {
      const row = insertStmt.get({
        ...values,
        state,
        expiresAt,
      });
      writeEvent(null, row, "REGISTERED", now, input.metadata || null);
      return row;
    }
    const sameProcess =
      current.process_id === values.processId
      && current.process_started_at === values.processStartedAt
      && current.commit_sha === values.commitSha
      && current.configuration_sha256 === values.configurationSha256
      && current.component_type === values.componentType
      && current.role === values.role;
    if (
      current.state !== "STOPPED"
      && current.expires_at > now
      && !sameProcess
    ) {
      throw new Error("runtime_component_active_identity_conflict");
    }
    if (sameProcess && current.state !== "STOPPED" && current.expires_at > now) {
      return current;
    }
    const row = updateStmt.get({
      ...values,
      state,
      expiresAt,
      stoppedAt: null,
      replaceIdentity: 1,
      expectedVersion: current.version,
    });
    if (!row) throw new Error("stale_control_version");
    writeEvent(current, row, "RE_REGISTERED", now, input.metadata || null);
    return row;
  });

  const heartbeatTransaction = db.transaction((input) => {
    const now = iso(input.now);
    const values = common(input, now);
    const current = getStmt.get(values.componentId) || null;
    if (!current || current.instance_key !== values.instanceKey) {
      throw new Error("runtime_component_not_registered");
    }
    if (current.version !== expectedVersion(input.expectedVersion)) {
      throw new Error("stale_control_version");
    }
    if (
      current.commit_sha !== values.commitSha
      || current.configuration_sha256 !== values.configurationSha256
      || current.process_id !== values.processId
      || current.process_started_at !== values.processStartedAt
    ) {
      throw new Error("runtime_component_identity_mismatch");
    }
    if (current.state === "STOPPED") {
      throw new Error("runtime_component_stopped");
    }
    const row = updateStmt.get({
      ...values,
      metadataJson:
        input.metadata === undefined ? current.metadata_json : values.metadataJson,
      state: input.state || "READY",
      expiresAt: leaseExpiry(now, input.leaseMs || 60000),
      stoppedAt: null,
      replaceIdentity: 0,
      expectedVersion: current.version,
    });
    if (!row) throw new Error("stale_control_version");
    writeEvent(current, row, "HEARTBEAT", now, input.metadata || null);
    return row;
  });

  const stopTransaction = db.transaction((input) => {
    const componentId = required(input.componentId, "runtime_component_id_required");
    const current = getStmt.get(componentId) || null;
    if (!current) throw new Error("runtime_component_not_registered");
    if (current.version !== expectedVersion(input.expectedVersion)) {
      throw new Error("stale_control_version");
    }
    const now = iso(input.now);
    const row = updateStmt.get({
      componentId,
      instanceKey: current.instance_key,
      componentType: current.component_type,
      role: current.role,
      commitSha: current.commit_sha,
      configurationSha256: current.configuration_sha256,
      processId: current.process_id,
      processStartedAt: current.process_started_at,
      state: "STOPPED",
      now,
      expiresAt: now,
      stoppedAt: now,
      metadataJson: input.metadata
        ? JSON.stringify(input.metadata)
        : current.metadata_json,
      replaceIdentity: 0,
      expectedVersion: current.version,
    });
    if (!row) throw new Error("stale_control_version");
    writeEvent(current, row, "STOPPED", now, input.metadata || null);
    return row;
  });

  return {
    get(componentId) {
      const normalised = String(componentId || "").trim();
      return normalised ? getStmt.get(normalised) || null : null;
    },
    register(input) {
      return registerTransaction.immediate(input);
    },
    heartbeat(input) {
      return heartbeatTransaction.immediate(input);
    },
    markStopped(input) {
      return stopTransaction.immediate(input);
    },
    listFresh({ now = new Date(), componentType = null, role = null } = {}) {
      return listFreshStmt.all({
        now: iso(now),
        componentType: componentType ? String(componentType).trim() : null,
        role: role ? String(role).trim() : null,
      });
    },
  };
}

module.exports = { bind, iso };
