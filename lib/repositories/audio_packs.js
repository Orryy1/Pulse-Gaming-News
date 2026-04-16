/**
 * audio_packs + audio_pack_assets repository.
 */

function bind(db) {
  const upsertPack = db.prepare(`
    INSERT INTO audio_packs
      (id, channel_id, name, root_path, bpm, key_signature, license, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      channel_id = excluded.channel_id,
      name = excluded.name,
      root_path = excluded.root_path,
      bpm = excluded.bpm,
      key_signature = excluded.key_signature,
      license = excluded.license,
      enabled = excluded.enabled
  `);
  const getPack = db.prepare(`SELECT * FROM audio_packs WHERE id = ?`);
  const listByChannel = db.prepare(`
    SELECT * FROM audio_packs WHERE channel_id = ? AND enabled = 1
    ORDER BY id
  `);
  const upsertAsset = db.prepare(`
    INSERT INTO audio_pack_assets
      (pack_id, role, filename, duration_ms, loudness_lufs, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(pack_id, role) DO UPDATE SET
      filename = excluded.filename,
      duration_ms = excluded.duration_ms,
      loudness_lufs = excluded.loudness_lufs,
      notes = excluded.notes
  `);
  const listAssets = db.prepare(`
    SELECT * FROM audio_pack_assets WHERE pack_id = ? ORDER BY role
  `);
  const getAsset = db.prepare(`
    SELECT * FROM audio_pack_assets WHERE pack_id = ? AND role = ?
  `);

  return {
    upsertPack(pack) {
      upsertPack.run(
        pack.id,
        pack.channel_id,
        pack.name || pack.id,
        pack.root_path,
        pack.bpm || null,
        pack.key_signature || null,
        pack.license || "owned",
        pack.enabled === false ? 0 : 1,
      );
    },
    getPack(id) {
      return getPack.get(id);
    },
    listByChannel(channelId) {
      return listByChannel.all(channelId);
    },
    upsertAsset(packId, asset) {
      upsertAsset.run(
        packId,
        asset.role,
        asset.filename,
        asset.duration_ms || null,
        asset.loudness_lufs || null,
        asset.notes || null,
      );
    },
    listAssets(packId) {
      return listAssets.all(packId);
    },
    getAsset(packId, role) {
      return getAsset.get(packId, role);
    },
  };
}

module.exports = { bind };
