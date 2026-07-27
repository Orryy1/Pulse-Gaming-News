"use strict";

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_lease_time");
  return date.toISOString();
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
      const nowIso = iso(now);
      const expiresAt = iso(
        new Date(new Date(nowIso).getTime() + Math.max(1, Number(leaseMs))),
      );
      const values = {
        name,
        ownerId,
        now: nowIso,
        expiresAt,
        metadata: metadata ? JSON.stringify(metadata) : null,
      };
      const current = get.get(name);
      if (!current) {
        insert.run(values);
        return { acquired: true, ...get.get(name) };
      }
      if (
        current.owner_id === ownerId ||
        String(current.expires_at) <= nowIso
      ) {
        replace.run(values);
        return { acquired: true, ...get.get(name) };
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
      if (!name || !ownerId) throw new Error("lease_name_and_owner_required");
      return acquireTransaction({ name, ownerId, now, leaseMs, metadata });
    },
    heartbeat({
      name,
      ownerId,
      now = new Date(),
      leaseMs = 15 * 60 * 1000,
    }) {
      const nowIso = iso(now);
      const expiresAt = iso(
        new Date(new Date(nowIso).getTime() + Math.max(1, Number(leaseMs))),
      );
      return (
        heartbeat.run({ name, ownerId, now: nowIso, expiresAt }).changes > 0
      );
    },
    release(name, ownerId) {
      return release.run(name, ownerId).changes > 0;
    },
    get(name) {
      return get.get(name) || null;
    },
  };
}

module.exports = { bind, iso };
