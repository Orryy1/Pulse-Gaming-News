"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const LEDGER_SCHEMA = "pulse-elevenlabs-credit-ledger-v1";
const LOCK_OWNER_SCHEMA =
  "pulse-elevenlabs-credit-ledger-lock-owner-v1";
const ENTRY_STATES = new Set([
  "reserved",
  "released",
  "provider_call_started",
  "provider_call_ambiguous",
  "provider_succeeded",
  "completed",
]);
const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 1000;
const DEFAULT_ORPHAN_LOCK_STALE_MS = 10 * 60 * 1000;
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const MAX_RESULT_BYTES = 128 * 1024 * 1024;

function ledgerError(code, details = {}) {
  const error = new Error(code);
  error.name = "ElevenLabsCreditLedgerError";
  error.code = code;
  error.details = details;
  return error;
}

function finiteInRange(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function defaultLedger(generatedAt) {
  return {
    schema_version: LEDGER_SCHEMA,
    revision: 0,
    created_at: generatedAt,
    updated_at: generatedAt,
    provider_observation: null,
    unobserved_committed_credits: 0,
    entries: {},
  };
}

function plainObject(input) {
  return (
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  );
}

function validateLedger(ledger) {
  if (
    !plainObject(ledger) ||
    ledger.schema_version !== LEDGER_SCHEMA ||
    !Number.isInteger(ledger.revision) ||
    ledger.revision < 0 ||
    !plainObject(ledger.entries) ||
    !Number.isFinite(Number(ledger.unobserved_committed_credits)) ||
    Number(ledger.unobserved_committed_credits) < 0
  ) {
    throw ledgerError("elevenlabs_credit_ledger_invalid");
  }
  for (const [keyHash, entry] of Object.entries(ledger.entries)) {
    if (
      !/^[a-f0-9]{64}$/.test(keyHash) ||
      !plainObject(entry) ||
      entry.key_hash !== keyHash ||
      !ENTRY_STATES.has(entry.state) ||
      !Number.isFinite(Number(entry.estimated_credits)) ||
      Number(entry.estimated_credits) < 0 ||
      !/^[a-f0-9]{64}$/.test(String(entry.input_fingerprint || ""))
    ) {
      throw ledgerError("elevenlabs_credit_ledger_invalid");
    }
    if (
      ["provider_succeeded", "completed"].includes(entry.state) &&
      (!plainObject(entry.provider_result) ||
        entry.provider_result.relative_path !==
          `provider-results/${keyHash}.json` ||
        !/^[a-f0-9]{64}$/.test(
          String(entry.provider_result.sha256 || ""),
        ) ||
        !Number.isInteger(entry.provider_result.byte_length) ||
        entry.provider_result.byte_length <= 0)
    ) {
      throw ledgerError("elevenlabs_credit_ledger_invalid");
    }
  }
  return ledger;
}

async function syncWrite(filePath, bytes, { exclusive = false } = {}) {
  const handle = await fs.open(
    filePath,
    exclusive ? "wx" : "w",
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomic(filePath, bytes) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.` +
    `${crypto.randomUUID()}.tmp`;
  try {
    await syncWrite(temporaryPath, bytes, { exclusive: true });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function createElevenLabsCreditLedger(options = {}) {
  const stateRoot = String(options.stateRoot || "").trim();
  if (!stateRoot || !path.isAbsolute(stateRoot)) {
    throw ledgerError(
      "elevenlabs_credit_state_root_required",
    );
  }
  const now = typeof options.now === "function" ? options.now : Date.now;
  const wallNow =
    typeof options.wallNow === "function"
      ? options.wallNow
      : Date.now;
  const sleep =
    typeof options.sleep === "function" ? options.sleep : delay;
  const hostname = String(options.hostname || os.hostname());
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid;
  const isProcessAlive =
    typeof options.isProcessAlive === "function"
      ? options.isProcessAlive
      : defaultProcessAlive;
  const lockTimeoutMs = finiteInRange(
    options.lockTimeoutMs,
    DEFAULT_LOCK_TIMEOUT_MS,
    100,
    120_000,
  );
  const lockStaleMs = finiteInRange(
    options.lockStaleMs,
    DEFAULT_LOCK_STALE_MS,
    100,
    24 * 60 * 60 * 1000,
  );
  const orphanLockStaleMs = finiteInRange(
    options.orphanLockStaleMs,
    DEFAULT_ORPHAN_LOCK_STALE_MS,
    lockStaleMs,
    24 * 60 * 60 * 1000,
  );
  const root = path.resolve(
    stateRoot,
    "elevenlabs-credit-governor",
  );
  const ledgerPath = path.join(root, "ledger.json");
  const lockPath = path.join(root, ".ledger.lock");
  const ownerPath = path.join(lockPath, "owner.json");
  const resultsRoot = path.join(root, "provider-results");

  function timeMs() {
    const candidate = Number(now());
    return Number.isFinite(candidate) ? candidate : Date.now();
  }

  function isoNow() {
    return new Date(timeMs()).toISOString();
  }

  async function readLockOwner() {
    try {
      const bytes = await fs.readFile(ownerPath);
      if (bytes.length > 16 * 1024) return null;
      const owner = JSON.parse(bytes.toString("utf8"));
      return owner?.schema_version === LOCK_OWNER_SCHEMA &&
        Number.isInteger(owner.pid) &&
        owner.pid > 0 &&
        typeof owner.hostname === "string" &&
        /^[a-f0-9-]{16,64}$/i.test(String(owner.token || ""))
        ? owner
        : null;
    } catch {
      return null;
    }
  }

  async function recoverStaleLock() {
    let stat;
    try {
      stat = await fs.stat(lockPath);
    } catch (error) {
      return error?.code === "ENOENT";
    }
    const ageMs = Math.max(0, wallNow() - stat.mtimeMs);
    const owner = await readLockOwner();
    let safeToRecover = false;
    if (!owner) {
      safeToRecover = ageMs >= orphanLockStaleMs;
    } else if (
      owner.hostname === hostname &&
      ageMs >= lockStaleMs &&
      !isProcessAlive(owner.pid)
    ) {
      safeToRecover = true;
    }
    if (!safeToRecover) return false;

    if (owner) {
      const latestOwner = await readLockOwner();
      if (!latestOwner || latestOwner.token !== owner.token) {
        return false;
      }
    }
    const stalePath =
      `${lockPath}.stale.${process.pid}.` +
      `${crypto.randomUUID()}`;
    try {
      await fs.rename(lockPath, stalePath);
      await fs.rm(stalePath, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) {
        return false;
      }
      throw error;
    }
  }

  async function acquireLock() {
    await fs.mkdir(root, { recursive: true });
    const deadline = wallNow() + lockTimeoutMs;
    while (wallNow() <= deadline) {
      const token = crypto.randomUUID();
      try {
        await fs.mkdir(lockPath);
        const owner = {
          schema_version: LOCK_OWNER_SCHEMA,
          token,
          pid,
          hostname,
          acquired_at: isoNow(),
        };
        try {
          await syncWrite(
            ownerPath,
            Buffer.from(
              `${JSON.stringify(owner, null, 2)}\n`,
              "utf8",
            ),
            { exclusive: true },
          );
        } catch (error) {
          await fs.rm(lockPath, { recursive: true, force: true });
          throw error;
        }
        return async function releaseLock() {
          const currentOwner = await readLockOwner();
          if (!currentOwner || currentOwner.token !== token) {
            throw ledgerError(
              "elevenlabs_credit_ledger_lock_ownership_lost",
            );
          }
          await fs.rm(lockPath, { recursive: true, force: true });
        };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      if (await recoverStaleLock()) continue;
      await sleep(15 + Math.floor(Math.random() * 20));
    }
    throw ledgerError("elevenlabs_credit_ledger_lock_timeout");
  }

  async function readLedger() {
    let bytes;
    try {
      bytes = await fs.readFile(ledgerPath);
    } catch (error) {
      if (error?.code === "ENOENT") return defaultLedger(isoNow());
      throw error;
    }
    if (bytes.length > MAX_LEDGER_BYTES) {
      throw ledgerError("elevenlabs_credit_ledger_invalid");
    }
    try {
      return validateLedger(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      if (error?.code) throw error;
      throw ledgerError("elevenlabs_credit_ledger_invalid");
    }
  }

  async function transaction(mutator) {
    if (typeof mutator !== "function") {
      throw ledgerError(
        "elevenlabs_credit_ledger_mutator_required",
      );
    }
    const releaseLock = await acquireLock();
    try {
      const ledger = await readLedger();
      const result = await mutator(ledger);
      validateLedger(ledger);
      ledger.revision += 1;
      ledger.updated_at = isoNow();
      const bytes = Buffer.from(
        `${JSON.stringify(ledger, null, 2)}\n`,
        "utf8",
      );
      if (bytes.length > MAX_LEDGER_BYTES) {
        throw ledgerError("elevenlabs_credit_ledger_too_large");
      }
      await writeAtomic(ledgerPath, bytes);
      return result;
    } finally {
      await releaseLock();
    }
  }

  async function writeProviderResult(keyHash, result) {
    if (!/^[a-f0-9]{64}$/.test(String(keyHash || ""))) {
      throw ledgerError(
        "elevenlabs_credit_result_key_invalid",
      );
    }
    if (!plainObject(result)) {
      throw ledgerError(
        "elevenlabs_provider_result_not_serialisable",
      );
    }
    let bytes;
    try {
      bytes = Buffer.from(
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8",
      );
    } catch {
      throw ledgerError(
        "elevenlabs_provider_result_not_serialisable",
      );
    }
    if (bytes.length <= 2 || bytes.length > MAX_RESULT_BYTES) {
      throw ledgerError(
        "elevenlabs_provider_result_size_invalid",
      );
    }
    const resultPath = path.join(resultsRoot, `${keyHash}.json`);
    const digest = sha256(bytes);
    await fs.mkdir(resultsRoot, { recursive: true });
    try {
      const existing = await fs.readFile(resultPath);
      if (sha256(existing) !== digest) {
        throw ledgerError(
          "elevenlabs_provider_result_conflict",
        );
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await writeAtomic(resultPath, bytes);
    }
    return {
      relative_path: path
        .relative(root, resultPath)
        .replace(/\\/g, "/"),
      sha256: digest,
      byte_length: bytes.length,
    };
  }

  async function readProviderResult(keyHash) {
    const resultPath = path.join(resultsRoot, `${keyHash}.json`);
    const bytes = await fs.readFile(resultPath);
    if (bytes.length <= 2 || bytes.length > MAX_RESULT_BYTES) {
      throw ledgerError(
        "elevenlabs_provider_result_size_invalid",
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw ledgerError(
        "elevenlabs_provider_result_invalid",
      );
    }
    if (!plainObject(parsed)) {
      throw ledgerError(
        "elevenlabs_provider_result_invalid",
      );
    }
    return {
      value: parsed,
      sha256: sha256(bytes),
      byte_length: bytes.length,
    };
  }

  return {
    paths: {
      root,
      ledger: ledgerPath,
    },
    transaction,
    writeProviderResult,
    readProviderResult,
  };
}

module.exports = {
  ENTRY_STATES,
  LEDGER_SCHEMA,
  createElevenLabsCreditLedger,
};
