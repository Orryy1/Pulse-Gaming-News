/**
 * Repository registry.
 *
 * Each repository exposes a `bind(db)` factory that returns a cached
 * prepared-statement bundle for the passed better-sqlite3 instance. The
 * repositories themselves are plain CommonJS — they don't open their own
 * DB handle, so they can be reused across the main process, jobs worker,
 * and cloud API without racing on WAL writes.
 *
 * Consumer contract:
 *    const { getRepos } = require('./lib/repositories');
 *    const repos = getRepos();              // uses lib/db getDb()
 *    const job = repos.jobs.claim('worker-1', { kinds: ['hunt'] });
 *
 * When USE_SQLITE is not set, getRepos() returns a JSON-backed shim for
 * the small surface that the legacy code path actually reads. New code
 * (Phases 3-9) is SQLite-only.
 */

const { runMigrations } = require("../migrate");

const factories = {
  stories: require("./stories"),
  jobs: require("./jobs"),
  platformPosts: require("./platform_posts"),
  workers: require("./workers"),
  scoring: require("./scoring"),
  roundups: require("./roundups"),
  derivatives: require("./derivatives"),
  idempotency: require("./idempotency"),
  audioPacks: require("./audio_packs"),
  channels: require("./channels"),
  mediaProvenance: require("./media_provenance"),
};

let _cached = null;
let _migrationsRan = false;

function getRepos() {
  if (_cached) return _cached;

  const db = require("../db");
  if (!db.useSqlite()) {
    throw new Error(
      "[repositories] SQLite is disabled (USE_SQLITE != 'true'). " +
        "The repository layer only supports the SQLite backend. " +
        "Either set USE_SQLITE=true or fall back to the legacy JSON helpers on lib/db.js.",
    );
  }

  const handle = db.getDb();
  if (!_migrationsRan) {
    runMigrations(handle);
    _migrationsRan = true;
  }

  const bound = { db: handle };
  for (const [name, factory] of Object.entries(factories)) {
    bound[name] = factory.bind(handle);
  }
  _cached = bound;
  return _cached;
}

/**
 * Reset the cache. Tests and the migration runner use this to force a
 * re-bind after schema changes.
 */
function resetReposCache() {
  _cached = null;
  _migrationsRan = false;
}

module.exports = { getRepos, resetReposCache };
