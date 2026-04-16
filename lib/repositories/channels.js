/**
 * channels repository.
 *
 * The canonical channel config still lives in `channels/*.js` as static
 * code (audience-intent, classification functions, system prompt). This
 * repo only stores the *operational* overrides: cadence, enabled flag,
 * audio pack pointer. Think of the JS config as the constructor, the DB
 * row as mutable state.
 */

function bind(db) {
  const upsert = db.prepare(`
    INSERT INTO channels
      (id, name, niche, tagline, palette_hex, voice_id, voice_alias,
       audio_pack_id, publish_cadence, sla_minutes, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      niche = excluded.niche,
      tagline = excluded.tagline,
      palette_hex = excluded.palette_hex,
      voice_id = excluded.voice_id,
      voice_alias = excluded.voice_alias,
      audio_pack_id = excluded.audio_pack_id,
      publish_cadence = excluded.publish_cadence,
      sla_minutes = excluded.sla_minutes,
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `);
  const getOne = db.prepare(`SELECT * FROM channels WHERE id = ?`);
  const listAll = db.prepare(`SELECT * FROM channels ORDER BY id`);
  const listEnabled = db.prepare(
    `SELECT * FROM channels WHERE enabled = 1 ORDER BY id`,
  );

  function hydrate(row) {
    if (!row) return null;
    if (row.publish_cadence) {
      try {
        row.publish_cadence = JSON.parse(row.publish_cadence);
      } catch {
        /* leave as string on parse error */
      }
    }
    row.enabled = !!row.enabled;
    return row;
  }

  return {
    upsert(channel) {
      const cadence = channel.publish_cadence
        ? typeof channel.publish_cadence === "string"
          ? channel.publish_cadence
          : JSON.stringify(channel.publish_cadence)
        : null;
      upsert.run(
        channel.id,
        channel.name || channel.id,
        channel.niche || null,
        channel.tagline || null,
        channel.palette_hex || null,
        channel.voice_id || null,
        channel.voice_alias || null,
        channel.audio_pack_id || null,
        cadence,
        channel.sla_minutes || 1440,
        channel.enabled === false ? 0 : 1,
      );
    },
    get(id) {
      return hydrate(getOne.get(id));
    },
    list() {
      return listAll.all().map(hydrate);
    },
    listEnabled() {
      return listEnabled.all().map(hydrate);
    },
  };
}

module.exports = { bind };
