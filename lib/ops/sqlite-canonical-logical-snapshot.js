"use strict";

const crypto = require("node:crypto");

const {
  canonicalSha256,
} = require("../services/governed-autonomous-production-request-builder");
const {
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../stabilisation/live-runtime-transition-lease");

const SNAPSHOT_SCHEMA_VERSION = "pulse-sqlite-canonical-logical-snapshot-v1";
const STABLE_PRAGMAS = Object.freeze([
  "application_id",
  "auto_vacuum",
  "encoding",
  "page_size",
  "schema_version",
  "user_version",
]);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function prepareCanonicalRead(db, sql) {
  const statement = db.prepare(sql);
  if (!statement || typeof statement.safeIntegers !== "function") {
    throw new Error("sqlite_canonical_snapshot_safe_integer_read_required");
  }
  return statement.safeIntegers(true);
}

function canonicalSqliteValue(value) {
  if (Buffer.isBuffer(value)) {
    return { type: "blob", base64: value.toString("base64") };
  }
  if (value === null) return { type: "null" };
  if (typeof value === "bigint") {
    return { type: "integer", decimal: value.toString(10) };
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { type: "real", value: "nan" };
    if (value === Number.POSITIVE_INFINITY) {
      return { type: "real", value: "positive_infinity" };
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return { type: "real", value: "negative_infinity" };
    }
    return {
      type: "real",
      value: Object.is(value, -0) ? "negative_zero" : value.toString(),
    };
  }
  if (typeof value === "string") return { type: "text", value };
  return { type: typeof value, value: String(value) };
}

function canonicalProjectedSqliteValue(sqliteType, value, textHex) {
  if (sqliteType === "text") {
    if (typeof textHex !== "string" || !/^(?:[0-9A-F]{2})*$/.test(textHex)) {
      throw new Error("sqlite_canonical_snapshot_text_hex_invalid");
    }
    return { type: "text", hex: textHex };
  }
  return canonicalSqliteValue(value);
}

function firstValue(row) {
  return Object.values(row || {})[0];
}

function canonicalSqliteStructuralSnapshot(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("sqlite_canonical_snapshot_database_required");
  }
  const pragmas = Object.fromEntries(
    STABLE_PRAGMAS.map((name) => [
      name,
      canonicalSqliteValue(
        firstValue(prepareCanonicalRead(db, `PRAGMA ${name}`).get()),
      ),
    ]),
  );
  const objects = prepareCanonicalRead(
    db,
    `SELECT type, name, tbl_name, sql
       FROM sqlite_master
      WHERE type IN ('table', 'index', 'view', 'trigger')
      ORDER BY type ASC, name ASC, tbl_name ASC`,
  )
    .all()
    .map((object) => ({
      type: object.type,
      name: object.name,
      table_name: object.tbl_name,
      sql: object.sql || null,
    }));
  return Object.freeze({
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    pragmas,
    objects,
  });
}

function canonicalSqliteStructuralDigest(snapshotOrDatabase) {
  const snapshot =
    snapshotOrDatabase && typeof snapshotOrDatabase.prepare === "function"
      ? canonicalSqliteStructuralSnapshot(snapshotOrDatabase)
      : snapshotOrDatabase;
  return canonicalSha256(snapshot);
}

function frame(hash, value) {
  const bytes = Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  );
  hash.update(Buffer.from(`${bytes.length}:`, "ascii"));
  hash.update(bytes);
}

function tableSelection(tableName, columns, exclusions) {
  const where = [];
  const parameters = [];
  if (tableName === "runtime_leases" && columns.includes("name")) {
    where.push(
      `(${quoteIdentifier("name")} IS NULL OR ${quoteIdentifier("name")} <> ?)`,
    );
    parameters.push(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
  }
  if (
    Number.isInteger(exclusions?.standby_job_id) &&
    tableName === "jobs" &&
    columns.includes("id")
  ) {
    where.push(`${quoteIdentifier("id")} <> ?`);
    parameters.push(exclusions.standby_job_id);
  }
  if (
    exclusions?.audit_idempotency_key &&
    tableName === "operator_audit_log" &&
    columns.includes("idempotency_key")
  ) {
    where.push(
      `(${quoteIdentifier("idempotency_key")} IS NULL OR ${quoteIdentifier("idempotency_key")} <> ?)`,
    );
    parameters.push(exclusions.audit_idempotency_key);
  }
  if (
    exclusions?.operator_audit_sequence === true &&
    tableName === "sqlite_sequence" &&
    columns.includes("name")
  ) {
    where.push(
      `(${quoteIdentifier("name")} IS NULL OR ${quoteIdentifier("name")} <> 'operator_audit_log')`,
    );
  }
  return { where, parameters };
}

function canonicalSqliteSnapshotDigest(
  db,
  { excludeOperationRows = null } = {},
) {
  const structural = canonicalSqliteStructuralSnapshot(db);
  const hash = crypto.createHash("sha256");
  frame(hash, SNAPSHOT_SCHEMA_VERSION);
  frame(hash, structural);
  const tables = structural.objects
    .filter((object) => object.type === "table")
    .map((object) => object.name);
  for (const tableName of tables) {
    const columns = prepareCanonicalRead(
      db,
      `PRAGMA table_info(${quoteIdentifier(tableName)})`,
    )
      .all()
      .map((column) => column.name);
    const selection = tableSelection(tableName, columns, excludeOperationRows);
    const columnReads = columns.map((column, index) => {
      const identifier = quoteIdentifier(column);
      const typeAlias = `__pulse_type_${index}`;
      const valueAlias = `__pulse_value_${index}`;
      const textHexAlias = `__pulse_text_hex_${index}`;
      const orderAlias = `__pulse_order_${index}`;
      return {
        typeAlias,
        valueAlias,
        textHexAlias,
        orderAlias,
        projection: [
          `typeof(${identifier}) AS ${quoteIdentifier(typeAlias)}`,
          `CASE WHEN typeof(${identifier}) = 'text' THEN NULL ELSE ${identifier} END AS ${quoteIdentifier(valueAlias)}`,
          `CASE WHEN typeof(${identifier}) = 'text' THEN hex(CAST(${identifier} AS BLOB)) ELSE NULL END AS ${quoteIdentifier(textHexAlias)}`,
          `CASE WHEN typeof(${identifier}) = 'text' THEN hex(CAST(${identifier} AS BLOB)) ELSE quote(${identifier}) END AS ${quoteIdentifier(orderAlias)}`,
        ],
      };
    });
    const projection = columnReads
      .flatMap((column) => column.projection)
      .join(", ");
    const order = columns
      .flatMap((column) => [
        `typeof(${quoteIdentifier(column)}) COLLATE BINARY`,
        `CASE WHEN typeof(${quoteIdentifier(column)}) = 'text' THEN hex(CAST(${quoteIdentifier(column)} AS BLOB)) ELSE quote(${quoteIdentifier(column)}) END COLLATE BINARY`,
      ])
      .join(", ");
    let sql = `SELECT ${projection} FROM ${quoteIdentifier(tableName)}`;
    if (selection.where.length)
      sql += ` WHERE ${selection.where.join(" AND ")}`;
    if (order) sql += ` ORDER BY ${order}`;
    frame(hash, { table_name: tableName, columns });
    let count = 0;
    let pendingOrderKey = null;
    let pendingRows = [];
    const flushPendingRows = () => {
      pendingRows.sort((left, right) =>
        Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
      );
      for (const encodedRow of pendingRows) frame(hash, encodedRow);
      pendingRows = [];
    };
    for (const row of prepareCanonicalRead(db, sql).iterate(
      ...selection.parameters,
    )) {
      const canonicalRow = columnReads.map((column) =>
        canonicalProjectedSqliteValue(
          row[column.typeAlias],
          row[column.valueAlias],
          row[column.textHexAlias],
        ),
      );
      const orderKey = JSON.stringify(
        columnReads.flatMap((column) => [
          row[column.typeAlias],
          row[column.orderAlias],
        ]),
      );
      if (pendingOrderKey !== null && orderKey !== pendingOrderKey) {
        flushPendingRows();
      }
      pendingOrderKey = orderKey;
      pendingRows.push(JSON.stringify(canonicalRow));
      count += 1;
    }
    flushPendingRows();
    frame(hash, { row_count: count });
  }
  return hash.digest("hex");
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  STABLE_PRAGMAS,
  canonicalSqliteSnapshotDigest,
  canonicalSqliteStructuralDigest,
  canonicalSqliteStructuralSnapshot,
};
