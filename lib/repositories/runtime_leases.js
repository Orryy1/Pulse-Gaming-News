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
      (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
    VALUES (@name, @ownerId, @now, @now, @expiresAt, @metadata)
  `);
  const replace = db.prepare(`
    UPDATE runtime_leases
    SET owner_id = @ownerId,
        acquired_at = @now,
        heartbeat_at = @now,
        expires_at = @expiresAt,
        metadata = @metadata
    WHERE name = @name
  `);
  const heartbeat = db.prepare(`
    UPDATE runtime_leases
    SET heartbeat_at = @now,
        expires_at = @expiresAt
    WHERE name = @name
      AND owner_id = @ownerId
      AND expires_at > @now
  `);
  const release = db.prepare(`
    DELETE FROM runtime_leases
    WHERE name = ? AND owner_id = ?
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
      if (
        current.owner_id === normalisedOwner ||
        String(current.expires_at) <= nowIso
      ) {
        replace.run(values);
        return { acquired: true, ...get.get(normalisedName) };
      }
      return {
        acquired: false,
        current_owner_id: current.owner_id,
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
      now = new Date(),
      leaseMs = 15 * 60 * 1000,
    }) {
      const normalisedName = requiredText(name);
      const normalisedOwner = requiredText(ownerId);
      const nowIso = iso(now);
      const expiresAt = iso(
        new Date(new Date(nowIso).getTime() + positiveDuration(leaseMs)),
      );
      return (
        heartbeat.run({
          name: normalisedName,
          ownerId: normalisedOwner,
          now: nowIso,
          expiresAt,
        }).changes > 0
      );
    },
    release(name, ownerId) {
      const normalisedName = String(name || "").trim();
      const normalisedOwner = String(ownerId || "").trim();
      if (!normalisedName || !normalisedOwner) return false;
      return release.run(normalisedName, normalisedOwner).changes > 0;
    },
    get(name) {
      const normalisedName = String(name || "").trim();
      if (!normalisedName) return null;
      return get.get(normalisedName) || null;
    },
  };
}

module.exports = { bind, iso };
