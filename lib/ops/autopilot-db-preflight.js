"use strict";

function preflightAutopilotDatabase({
  databaseMode,
  requiredMigrations,
  openFixture,
  openProduction,
}) {
  if (!['fixture', 'production'].includes(databaseMode)) {
    throw new Error("database_mode_invalid");
  }
  if (!Array.isArray(requiredMigrations) || requiredMigrations.length < 1) {
    throw new Error("required_migrations_missing");
  }
  const open = databaseMode === "fixture" ? openFixture : openProduction;
  if (typeof open !== "function") throw new Error("database_opener_missing");
  const handle = open();
  const database = handle?.database || handle;
  const applied = new Set((handle?.appliedMigrations || []).map(String));
  const missing = requiredMigrations.map(String).filter((version) => !applied.has(version));
  return {
    result: missing.length ? "PENDING" : "GREEN",
    databaseMode,
    database,
    missingMigrations: missing,
    close: typeof handle?.close === "function" ? handle.close : () => {},
  };
}

module.exports = { preflightAutopilotDatabase };
