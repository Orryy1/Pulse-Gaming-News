/**
 * idempotency_keys repository.
 *
 * Usage pattern:
 *   const r = idem.begin(key, 'upload_youtube');
 *   if (r.status === 'ok') return r.result;           // already done
 *   if (r.status === 'in_flight') throw new Error(..); // racing attempt
 *   try {
 *     const result = await doTheThing();
 *     idem.commit(key, result);
 *     return result;
 *   } catch (err) {
 *     idem.abort(key, err);
 *     throw err;
 *   }
 */

function bind(db) {
  const tryInsert = db.prepare(`
    INSERT INTO idempotency_keys (key, scope, status)
    VALUES (?, ?, 'in_flight')
    ON CONFLICT(key) DO NOTHING
    RETURNING *
  `);
  const getOne = db.prepare(`SELECT * FROM idempotency_keys WHERE key = ?`);
  const complete = db.prepare(`
    UPDATE idempotency_keys
    SET status = 'ok', result = ?, completed_at = datetime('now')
    WHERE key = ?
  `);
  const abort = db.prepare(`
    UPDATE idempotency_keys
    SET status = 'error', error_message = ?, completed_at = datetime('now')
    WHERE key = ?
  `);

  return {
    /**
     * Attempt to claim a key. Returns:
     *   { status: 'claimed' }             — caller should do the work
     *   { status: 'ok', result }          — previous attempt already succeeded
     *   { status: 'in_flight' }           — another caller is working
     *   { status: 'error', error }        — previous attempt failed; caller can retry by passing force=true
     */
    begin(key, scope, { force = false } = {}) {
      const existing = getOne.get(key);
      if (existing) {
        if (existing.status === "ok") {
          let result = existing.result;
          try {
            result = JSON.parse(result);
          } catch {
            /* keep string */
          }
          return { status: "ok", result };
        }
        if (existing.status === "in_flight") return { status: "in_flight" };
        if (existing.status === "error" && !force) {
          return { status: "error", error: existing.error_message };
        }
        // force retry: reset
        db.prepare(
          `UPDATE idempotency_keys
           SET status = 'in_flight', error_message = NULL, completed_at = NULL
           WHERE key = ?`,
        ).run(key);
        return { status: "claimed" };
      }
      tryInsert.run(key, scope);
      return { status: "claimed" };
    },
    commit(key, result) {
      const serialised =
        typeof result === "string" ? result : JSON.stringify(result || null);
      complete.run(serialised, key);
    },
    abort(key, error) {
      abort.run(
        (error && error.message) ||
          (typeof error === "string" ? error : "error"),
        key,
      );
    },
    get(key) {
      return getOne.get(key);
    },
  };
}

module.exports = { bind };
