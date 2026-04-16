/**
 * lib/audio-identity.js — Phase 9 per-channel audio identity resolver.
 *
 * Every channel owns a pack of stems (intro sting, outro, bed, flair
 * stings). Migration 008 added audio_packs + audio_pack_assets; this
 * module is the code-side glue that:
 *
 *   1. Seeds packs from channels/<name>/audio/pack.json (or a sensible
 *      default if the config is missing).
 *   2. Resolves a channel+role+flair triple to an absolute file path.
 *   3. Falls back gracefully — if a channel has no dedicated pack, we
 *      return the default pulse-v1 assets so older videos still render.
 *
 * API:
 *
 *   const id = require('./lib/audio-identity');
 *   const intro = id.resolve({ channelId: 'stacked', role: 'intro' });
 *   // intro -> { pack_id, role, abs_path, filename, duration_ms, ... }
 *
 *   await id.syncPacks();         // walks channels/ + reconciles DB rows
 *
 * Role conventions (keep stable — consumers key off these strings):
 *
 *   intro             cold-open sting the channel always leads with
 *   outro             4-6s closing tag
 *   bed_primary       looping bed for default videos
 *   bed_breaking      faster / more urgent bed for breaking news
 *   sting_verified    plays on flair=Verified story opener
 *   sting_rumour      plays on flair=Rumour story opener
 *   sting_breaking    plays on flair=Breaking / high breaking_score
 *   transition        between-story whoosh for shorts
 *   bumper            mid-roll bumper for longform roundups
 */

const path = require("path");
const fs = require("fs");

const CHANNELS_DIR = path.join(__dirname, "..", "channels");
const AUDIO_ROOT = path.join(__dirname, "..", "audio");

// Fallback pack that points at the repo-level audio/ stems shipping with
// the current Pulse Gaming build. Any channel that hasn't registered its
// own pack inherits these so renders never fail on a missing role.
const FALLBACK_PACK = {
  id: "pulse-v1",
  channel_id: "pulse-gaming",
  name: "Pulse Gaming v1",
  root_path: "audio",
  license: "owned",
  bpm: 120,
  key_signature: "Am",
  assets: [
    { role: "bed_primary", filename: "Main Background Loop 1.wav" },
    { role: "bed_breaking", filename: "Main Background Loop 3.wav" },
    { role: "sting_breaking", filename: "Breaking News Sting 1.wav" },
    { role: "sting_verified", filename: "Breaking News Sting 2.wav" },
    { role: "sting_rumour", filename: "Breaking News Sting 3.wav" },
  ],
};

/**
 * Walk channels/ looking for an `audio/pack.json` in each channel's
 * directory. That file is the declarative source of truth for a
 * channel's pack — syncPacks() reads it and upserts the DB rows.
 *
 * Schema (optional fields default sensibly):
 *   {
 *     "id": "stacked-v1",
 *     "name": "Stacked v1",
 *     "root_path": "channels/stacked/audio",
 *     "bpm": 110,
 *     "key_signature": "Cm",
 *     "license": "owned",
 *     "assets": [
 *       { "role": "intro", "filename": "intro_4s.wav" },
 *       ...
 *     ]
 *   }
 */
function discoverPackConfigs() {
  if (!fs.existsSync(CHANNELS_DIR)) return [];
  const found = [];
  for (const entry of fs.readdirSync(CHANNELS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const channelId = entry.name;
    const packFile = path.join(CHANNELS_DIR, channelId, "audio", "pack.json");
    if (!fs.existsSync(packFile)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(packFile, "utf8"));
      json.channel_id = json.channel_id || channelId;
      json.root_path =
        json.root_path || path.join("channels", channelId, "audio");
      found.push(json);
    } catch (err) {
      console.warn(
        `[audio-identity] failed to parse ${packFile}: ${err.message}`,
      );
    }
  }
  return found;
}

/**
 * Reconcile pack configs -> DB. Idempotent; re-running just refreshes
 * metadata and asset rows. The fallback pack is always ensured so
 * resolve() can rely on it even if no config files exist yet.
 */
function syncPacks({ repos, log = console } = {}) {
  if (!repos) repos = require("./repositories").getRepos();

  const configs = [FALLBACK_PACK, ...discoverPackConfigs()];
  for (const cfg of configs) {
    // Ensure channels row exists so the FK holds.
    repos.db
      .prepare(
        `INSERT OR IGNORE INTO channels (id, name, niche)
         VALUES (?, ?, COALESCE(?, 'gaming'))`,
      )
      .run(cfg.channel_id, cfg.name || cfg.channel_id, cfg.niche || null);

    repos.audioPacks.upsertPack(cfg);
    if (Array.isArray(cfg.assets)) {
      for (const asset of cfg.assets) {
        repos.audioPacks.upsertAsset(cfg.id, asset);
      }
    }
    log.log(
      `[audio-identity] synced pack ${cfg.id} (${cfg.channel_id}) with ${
        (cfg.assets || []).length
      } asset(s)`,
    );
  }
  return configs.map((c) => c.id);
}

function pickPackForChannel(repos, channelId) {
  const packs = repos.audioPacks.listByChannel(channelId);
  if (packs.length) return packs[0];
  return repos.audioPacks.getPack(FALLBACK_PACK.id);
}

function absolutiseRoot(rootPath) {
  if (!rootPath) return AUDIO_ROOT;
  if (path.isAbsolute(rootPath)) return rootPath;
  return path.join(__dirname, "..", rootPath);
}

/**
 * Role resolution order for flair-dependent stings:
 *
 *   flair=Verified  -> sting_verified -> sting_breaking -> intro
 *   flair=Rumour    -> sting_rumour   -> intro
 *   flair=Breaking  -> sting_breaking -> sting_verified -> intro
 *   flair=News      -> intro
 *   role=bed        -> bed_breaking (if breaking) else bed_primary
 *
 * The resolver returns the first role that has an asset row in the
 * chosen pack. If nothing matches, we fall back to the default pack
 * and try again. If still nothing, return null — callers should skip
 * the stem rather than fail the render.
 */
function roleCandidates({ role, flair, breaking }) {
  if (role === "sting") {
    const f = (flair || "").toLowerCase();
    if (f === "verified") return ["sting_verified", "sting_breaking", "intro"];
    if (f === "rumour" || f === "rumor") return ["sting_rumour", "intro"];
    if (f === "news") return ["intro"];
    if (breaking) return ["sting_breaking", "sting_verified", "intro"];
    return ["sting_breaking", "sting_verified", "sting_rumour", "intro"];
  }
  if (role === "bed") {
    return breaking
      ? ["bed_breaking", "bed_primary"]
      : ["bed_primary", "bed_breaking"];
  }
  return [role];
}

/**
 * Main entry point. Returns the resolved asset row with an `abs_path`
 * property set to the on-disk file, or null if nothing matched.
 */
function resolve({
  repos,
  channelId = process.env.CHANNEL || "pulse-gaming",
  role,
  flair = null,
  breaking = false,
} = {}) {
  if (!role) throw new Error("[audio-identity] role required");
  if (!repos) repos = require("./repositories").getRepos();

  const pack = pickPackForChannel(repos, channelId);
  if (!pack) return null;

  const tryInPack = (packRow) => {
    for (const r of roleCandidates({ role, flair, breaking })) {
      const asset = repos.audioPacks.getAsset(packRow.id, r);
      if (!asset) continue;
      const abs = path.join(absolutiseRoot(packRow.root_path), asset.filename);
      if (!fs.existsSync(abs)) continue;
      return {
        ...asset,
        pack_id: packRow.id,
        abs_path: abs,
        channel_id: packRow.channel_id,
      };
    }
    return null;
  };

  const found = tryInPack(pack);
  if (found) return found;

  // Fallback to the default pack. Record the event so the observability
  // layer can surface it on the dashboard / Discord — a non-default
  // channel falling back to pulse-v1 means its pack is missing a role.
  if (pack.id !== FALLBACK_PACK.id) {
    const fallback = repos.audioPacks.getPack(FALLBACK_PACK.id);
    if (fallback) {
      const viaFallback = tryInPack(fallback);
      if (viaFallback) {
        try {
          const { recordIdentityFallback } = require("./observability");
          recordIdentityFallback({
            channelId,
            requestedPack: pack.id,
            fallbackPack: fallback.id,
            role,
            flair,
            breaking,
          });
        } catch {
          /* observability is best-effort */
        }
        return viaFallback;
      }
    }
  }
  return null;
}

/**
 * Return the full pack layout for a channel, hydrated with absolute
 * file paths. Useful for the dashboard and for the longform assembler
 * which wants to pre-warm every stem it might use.
 */
function describeChannelPack({
  repos,
  channelId = process.env.CHANNEL || "pulse-gaming",
} = {}) {
  if (!repos) repos = require("./repositories").getRepos();
  const pack = pickPackForChannel(repos, channelId);
  if (!pack) return null;
  const assets = repos.audioPacks.listAssets(pack.id).map((a) => ({
    ...a,
    abs_path: path.join(absolutiseRoot(pack.root_path), a.filename),
    exists: fs.existsSync(
      path.join(absolutiseRoot(pack.root_path), a.filename),
    ),
  }));
  return { ...pack, assets };
}

module.exports = {
  syncPacks,
  resolve,
  describeChannelPack,
  pickPackForChannel,
  discoverPackConfigs,
  FALLBACK_PACK,
};
