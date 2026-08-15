"use strict";

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_lease_time");
  return date.toISOString();
}

function requiredText(value) {
  const result = String(value || "").trim();
  if (!result) throw new Error("lease_name_and_owner_required");
  return result;
}

function requiredToken(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new Error("lease_fencing_token_required");
  }
  return result;
}

function positiveDuration(value) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) {
    throw new Error("positive_lease_duration_required");
  }
  return result;
}

function bind(db) {
  const get = db.prepare("SELECT * FROM runtime_leases WHERE name = ?");
  const insert = db.prepare(`
    INSERT INTO runtime_leases
      (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata,
       fencing_token)
    VALUES (@name, @ownerId, @now, @now, @expiresAt, @metadata, 1)
  `);
  const renewSameOwner = db.prepare(`
    UPDATE runtime_leases
    SET heartbeat_at = @now,
        expires_at = @expiresAt,
        metadata = @metadata
    WHERE name = @name
      AND owner_id = @ownerId
      AND fencing_token = @fencingToken
      AND expires_at > @now
  `);
  const replaceOwner = db.prepare(`
    UPDATE runtime_leases
    SET owner_id = @ownerId,
        acquired_at = @now,
        heartbeat_at = @now,
        expires_at = @expiresAt,
        metadata = @metadata,
        fencing_token = fencing_token + 1
    WHERE name = @name
      AND expires_at <= @now
  `);
  const heartbeat = db.prepare(`
    UPDATE runtime_leases
    SET heartbeat_at = @now,
        expires_at = @expiresAt
    WHERE name = @name
      AND owner_id = @ownerId
      AND fencing_token = @fencingToken
      AND expires_at > @now
  `);
  const release = db.prepare(`
    DELETE FROM runtime_leases
    WHERE name = @name
      AND owner_id = @ownerId
      AND fencing_token = @fencingToken
  `);

  const acquireTransaction = db.transaction(
    ({ name, ownerId, now, leaseMs, metadata }) => {
      const normalisedName = requiredText(name);
      const normalisedOwner = requiredText(ownerId);
      const nowIso = iso(now);
      const expiresAt = iso(
        new Date(new Date(nowIso).getTime() + positiveDuration(leaseMs)),
      );
      const values = {
        name: normalisedName,
        ownerId: normalisedOwner,
        now: nowIso,
        expiresAt,
        metadata: metadata ? JSON.stringify(metadata) : null,
      };
      const current = get.get(normalisedName);
      if (!current) {
        insert.run(values);
        return { acquired: true, ...get.get(normalisedName) };
      }
      if (current.owner_id === normalisedOwner && current.expires_at > nowIso) {
        const fencingToken = requiredToken(current.fencing_token);
        renewSameOwner.run({ ...values, fencingToken });
        return { acquired: true, ...get.get(normalisedName) };
      }
      if (current.expires_at <= nowIso) {
        const changed = replaceOwner.run(values).changes;
        if (changed !== 1) throw new Error("stale_lease_acquire");
        return { acquired: true, ...get.get(normalisedName) };
      }
      return {
        acquired: false,
        current_owner_id: current.owner_id,
        fencing_token: current.fencing_token,
        expires_at: current.expires_at,
      };
    },
  );

  return {
    acquire({
      name,
      ownerId,
      now = new Date(),
      leaseMs = 15 * 60 * 1000,
      metadata = null,
    }) {
      return acquireTransaction.immediate({
        name,
        ownerId,
        now,
        leaseMs,
        metadata,
      });
    },
    heartbeat({
      name,
      ownerId,
      fencingToken,
      now = new Date(),
      leaseMs = 15 * 60 * 1000,
    }) {
      const normalisedName = requiredText(name);
      const normalisedOwner = requiredText(ownerId);
      const token = requiredToken(fencingToken);
      const nowIso = iso(now);
      const expiresAt = iso(
        new Date(new Date(nowIso).getTime() + positiveDuration(leaseMs)),
      );
      return heartbeat.run({
        name: normalisedName,
        ownerId: normalisedOwner,
        fencingToken: token,
        now: nowIso,
        expiresAt,
      }).changes > 0;
    },
    release(name, ownerId, fencingToken) {
      const normalisedName = String(name || "").trim();
      const normalisedOwner = String(ownerId || "").trim();
      if (!normalisedName || !normalisedOwner) return false;
      const token = requiredToken(fencingToken);
      return release.run({
        name: normalisedName,
        ownerId: normalisedOwner,
        fencingToken: token,
      }).changes > 0;
    },
    get(name) {
      const normalisedName = String(name || "").trim();
      if (!normalisedName) return null;
      return get.get(normalisedName) || null;
    },
  };
}

module.exports = { bind, iso, requiredToken };
