"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  createPublishRunwayGenerationStore,
} = require("./publish-runway-generation-store");

const TIME_ZONE = "Europe/London";
const DEFAULT_PHASE_TOLERANCE_MS = 5 * 60 * 1000;
const RESULT_SCHEMA = "pulse_publish_runway_lock_controller_result_v1";
const PHASE_OFFSETS_MS = Object.freeze({
  "T-180": 180 * 60 * 1000,
  "T-90": 90 * 60 * 1000,
  T0: 0,
});

class PublishRunwayLockControllerError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "PublishRunwayLockControllerError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new PublishRunwayLockControllerError(code, message, details);
}

function validDate(value, field = "at") {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    fail("INVALID_PHASE_TIMESTAMP", `${field} must be a valid UTC timestamp`, {
      field,
    });
  }
  return date;
}

function normalisePhase(value) {
  const phase = String(value ?? "").trim().toUpperCase();
  if (!Object.hasOwn(PHASE_OFFSETS_MS, phase)) {
    fail("INVALID_RUNWAY_PHASE", "phase must be T-180, T-90 or T0", {
      phase,
    });
  }
  return phase;
}

function normalisePublishHours(values) {
  if (!Array.isArray(values) || values.length === 0) {
    fail(
      "INVALID_PUBLISH_HOURS",
      "at least one configured UTC publish hour is required",
    );
  }
  const hours = values.map((value) => {
    const text = String(value).trim();
    const match = /^(\d{1,2})(?::00)?$/.exec(text);
    const hour = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      fail(
        "INVALID_PUBLISH_HOURS",
        "UTC publish hours must be integers from 0 through 23",
        { publish_hour: value },
      );
    }
    return hour;
  });
  return [...new Set(hours)].sort((left, right) => left - right);
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function localParts(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function localTimestamp(date) {
  const parts = localParts(date);
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMinutes = Math.round((localAsUtc - date.getTime()) / 60000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(
    absoluteOffset % 60,
  )}`;
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`,
    identity: `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}-${sign === "+" ? "plus" : "minus"}${pad(
      Math.floor(absoluteOffset / 60),
    )}${pad(absoluteOffset % 60)}`,
  };
}

function utcIdentity(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".000", "");
}

function scheduledCandidates(target, publishHoursUtc) {
  const candidates = [];
  for (const dayDelta of [-1, 0, 1]) {
    const day = new Date(target.getTime());
    day.setUTCDate(day.getUTCDate() + dayDelta);
    for (const hour of publishHoursUtc) {
      candidates.push(
        new Date(
          Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            hour,
          ),
        ),
      );
    }
  }
  return candidates.sort((left, right) => {
    const distance =
      Math.abs(left.getTime() - target.getTime()) -
      Math.abs(right.getTime() - target.getTime());
    return distance || left.getTime() - right.getTime();
  });
}

function resolvePublishWindow({
  at,
  phase,
  publishHoursUtc,
  publish_hours_utc,
  phaseToleranceMs = DEFAULT_PHASE_TOLERANCE_MS,
  phase_tolerance_ms,
} = {}) {
  const evaluatedAt = validDate(at);
  const expectedPhase = normalisePhase(phase);
  const hours = normalisePublishHours(publishHoursUtc || publish_hours_utc);
  const tolerance = Number(
    phase_tolerance_ms === undefined ? phaseToleranceMs : phase_tolerance_ms,
  );
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    fail(
      "INVALID_PHASE_TOLERANCE",
      "phase tolerance must be a non-negative number of milliseconds",
    );
  }
  const target = new Date(
    evaluatedAt.getTime() + PHASE_OFFSETS_MS[expectedPhase],
  );
  const scheduledAt = scheduledCandidates(target, hours)[0];
  const phaseDriftMs = Math.abs(scheduledAt.getTime() - target.getTime());
  if (phaseDriftMs > tolerance) {
    fail(
      "PHASE_TIME_MISMATCH",
      "timestamp does not match a configured publish-window phase",
      {
        phase: expectedPhase,
        evaluated_at: evaluatedAt.toISOString(),
        nearest_scheduled_at: scheduledAt.toISOString(),
        phase_drift_ms: phaseDriftMs,
      },
    );
  }

  const local = localTimestamp(scheduledAt);
  return {
    time_zone: TIME_ZONE,
    phase: expectedPhase,
    evaluated_at: evaluatedAt.toISOString(),
    scheduled_at: scheduledAt.toISOString(),
    local_scheduled_at: local.iso,
    window_id: `publish-europe-london-local-${local.identity}-utc-${utcIdentity(
      scheduledAt,
    )}`,
    phase_drift_ms: phaseDriftMs,
  };
}

function controllerResult({
  verdict,
  phase,
  window = null,
  reasonCodes = [],
  error = null,
  generation = null,
  lock = null,
  idempotent = false,
  canPublish = false,
}) {
  return {
    schema: RESULT_SCHEMA,
    schema_version: 1,
    verdict,
    phase,
    can_publish: canPublish,
    external_publish_attempted: false,
    mutated_database: false,
    mutated_oauth: false,
    idempotent,
    window,
    generation,
    lock,
    reason_codes: reasonCodes,
    error,
  };
}

function errorResult(phase, window, error) {
  const code = String(error?.code || "RUNWAY_CONTROLLER_ERROR");
  return controllerResult({
    verdict: "RED",
    phase,
    window,
    reasonCodes: [code],
    error: {
      code,
      message: String(error?.message || error),
    },
  });
}

function assertGenerationInRunway(generation, window, toleranceMs) {
  const scheduledAtMs = Date.parse(window.scheduled_at);
  const generatedAtMs = Date.parse(generation.generated_at);
  const committedAtMs = Date.parse(generation.committed_at);
  const earliestMs =
    scheduledAtMs - PHASE_OFFSETS_MS["T-180"] - toleranceMs;
  const latestMs =
    scheduledAtMs - PHASE_OFFSETS_MS["T-90"] + toleranceMs;
  if (
    !Number.isFinite(generatedAtMs) ||
    !Number.isFinite(committedAtMs) ||
    generatedAtMs < earliestMs ||
    generatedAtMs > latestMs ||
    committedAtMs > latestMs
  ) {
    fail(
      "GENERATION_OUTSIDE_RUNWAY_INTERVAL",
      "generation was not created and committed inside the T-180 to T-90 runway interval",
      {
        generation_id: generation.generation_id,
        generated_at: generation.generated_at,
        committed_at: generation.committed_at,
        earliest_allowed_at: new Date(earliestMs).toISOString(),
        latest_allowed_at: new Date(latestMs).toISOString(),
      },
    );
  }
}

async function assertDeclaredCandidateEvidence(generation) {
  const manifestFiles = Array.isArray(generation.manifest?.files)
    ? generation.manifest.files
    : [];
  const candidateEntry = manifestFiles.find(
    (entry) =>
      path.posix.basename(String(entry?.path || "")).toLowerCase() ===
      "candidate-evidence.json",
  );
  if (!candidateEntry) return;

  let evidence;
  try {
    evidence = await fs.readJson(
      path.join(
        generation.generation_path,
        ...String(candidateEntry.path).split("/"),
      ),
    );
  } catch {
    fail(
      "GENERATION_CANDIDATE_EVIDENCE_INVALID",
      "declared candidate evidence is not valid JSON",
      { generation_id: generation.generation_id },
    );
  }
  const candidateLists = [
    evidence?.candidates,
    evidence?.ready_candidates,
    evidence?.selected_candidates,
    evidence?.runway?.candidates,
  ].filter(Array.isArray);
  if (candidateLists.length === 0) {
    fail(
      "GENERATION_CANDIDATE_EVIDENCE_INVALID",
      "declared candidate evidence contains no candidate collection",
      { generation_id: generation.generation_id },
    );
  }
  if (!candidateLists.some((candidates) => candidates.length > 0)) {
    fail(
      "NO_CANDIDATE_IN_GENERATION",
      "generation declares no candidate for the publish window",
      { generation_id: generation.generation_id },
    );
  }
}

class PublishRunwayLockController {
  constructor(options = {}) {
    this.publishHoursUtc = normalisePublishHours(
      options.publishHoursUtc || options.publish_hours_utc,
    );
    this.phaseToleranceMs =
      options.phase_tolerance_ms === undefined
        ? options.phaseToleranceMs ?? DEFAULT_PHASE_TOLERANCE_MS
        : options.phase_tolerance_ms;
    this.store =
      options.store ||
      createPublishRunwayGenerationStore({
        rootDir:
          options.rootDir ||
          options.root_dir ||
          options.storeRoot ||
          options.store_root,
        now: options.now,
      });
  }

  window(at, phase) {
    return resolvePublishWindow({
      at,
      phase,
      publishHoursUtc: this.publishHoursUtc,
      phaseToleranceMs: this.phaseToleranceMs,
    });
  }

  async generateAtT180({
    at,
    generationId,
    generation_id,
    files,
    documents,
    artifacts,
  } = {}) {
    let window = null;
    try {
      window = this.window(at, "T-180");
      const staged = await this.store.stageGeneration({
        generationId: generationId || generation_id,
        windowId: window.window_id,
        generatedAt: window.evaluated_at,
        files: files || documents || artifacts,
      });
      const generation = await this.store.commitGeneration(staged, {
        committedAt: window.evaluated_at,
      });
      return controllerResult({
        verdict: "GREEN",
        phase: "T-180",
        window,
        generation,
      });
    } catch (error) {
      return errorResult("T-180", window, error);
    }
  }

  async inspectAtT90({ at } = {}) {
    let window = null;
    try {
      window = this.window(at, "T-90");
      let lock = null;
      try {
        lock = await this.store.readT90Lock(window.window_id);
      } catch (error) {
        if (error?.code !== "T90_GENERATION_LOCK_MISSING") throw error;
      }
      if (lock) {
        const generation = await this.store.verifyGeneration({
          generationId: lock.generation_id,
          expectedWindowId: window.window_id,
          expectedManifestSha256: lock.manifest_sha256,
        });
        assertGenerationInRunway(
          generation,
          window,
          Number(this.phaseToleranceMs),
        );
        await assertDeclaredCandidateEvidence(generation);
        return controllerResult({
          verdict: "GREEN",
          phase: "T-90",
          window,
          generation,
          lock,
          idempotent: true,
        });
      }

      const generation = await this.store.selectNewestValidGeneration({
        windowId: window.window_id,
      });
      if (!generation) {
        fail(
          "NO_VALID_GENERATION_FOR_WINDOW",
          "no valid generation exists for the publish window",
          { window_id: window.window_id },
        );
      }
      assertGenerationInRunway(
        generation,
        window,
        Number(this.phaseToleranceMs),
      );
      await assertDeclaredCandidateEvidence(generation);
      return controllerResult({
        verdict: "AMBER",
        phase: "T-90",
        window,
        generation,
        reasonCodes: ["T90_LOCK_PENDING"],
        idempotent: true,
      });
    } catch (error) {
      return errorResult("T-90", window, error);
    }
  }

  async lockAtT90({
    at,
    generationId,
    generation_id,
  } = {}) {
    let window = null;
    try {
      window = this.window(at, "T-90");
      const requestedGenerationId = generationId || generation_id;
      let existingLock = null;
      try {
        existingLock = await this.store.readT90Lock(window.window_id);
      } catch (error) {
        if (error?.code !== "T90_GENERATION_LOCK_MISSING") throw error;
      }
      if (existingLock) {
        if (
          requestedGenerationId &&
          requestedGenerationId !== existingLock.generation_id
        ) {
          fail(
            "T90_GENERATION_LOCK_CONFLICT",
            "publish window is already pinned to another generation",
            {
              requested_generation_id: requestedGenerationId,
              locked_generation_id: existingLock.generation_id,
            },
          );
        }
        const generation = await this.store.verifyGeneration({
          generationId: existingLock.generation_id,
          expectedWindowId: window.window_id,
          expectedManifestSha256: existingLock.manifest_sha256,
        });
        assertGenerationInRunway(
          generation,
          window,
          Number(this.phaseToleranceMs),
        );
        await assertDeclaredCandidateEvidence(generation);
        return controllerResult({
          verdict: "GREEN",
          phase: "T-90",
          window,
          generation,
          lock: existingLock,
          idempotent: true,
        });
      }
      const candidate = requestedGenerationId
        ? await this.store.verifyGeneration({
            generationId: requestedGenerationId,
            expectedWindowId: window.window_id,
          })
        : await this.store.selectNewestValidGeneration({
            windowId: window.window_id,
          });
      if (!candidate) {
        fail(
          "NO_VALID_GENERATION_FOR_WINDOW",
          "no valid generation can be locked for the publish window",
          { window_id: window.window_id },
        );
      }
      assertGenerationInRunway(
        candidate,
        window,
        Number(this.phaseToleranceMs),
      );
      await assertDeclaredCandidateEvidence(candidate);
      const lock = await this.store.lockGenerationAtT90({
        windowId: window.window_id,
        generationId: candidate.generation_id,
        lockedAt: window.evaluated_at,
      });
      const generation = await this.store.verifyGeneration({
        generationId: lock.generation_id,
        expectedWindowId: window.window_id,
        expectedManifestSha256: lock.manifest_sha256,
      });
      return controllerResult({
        verdict: "GREEN",
        phase: "T-90",
        window,
        generation,
        lock,
      });
    } catch (error) {
      return errorResult("T-90", window, error);
    }
  }

  async resolveAtT0({ at } = {}) {
    let window = null;
    try {
      window = this.window(at, "T0");
      const generation = await this.store.resolveGenerationAtT0({
        windowId: window.window_id,
      });
      await assertDeclaredCandidateEvidence(generation);
      return controllerResult({
        verdict: "GREEN",
        phase: "T0",
        window,
        generation,
        lock: generation.t90_lock,
        idempotent: true,
      });
    } catch (error) {
      return errorResult("T0", window, error);
    }
  }
}

function createPublishRunwayLockController(options) {
  return new PublishRunwayLockController(options);
}

module.exports = {
  DEFAULT_PHASE_TOLERANCE_MS,
  PHASE_OFFSETS_MS,
  PublishRunwayLockController,
  PublishRunwayLockControllerError,
  RESULT_SCHEMA,
  TIME_ZONE,
  createPublishRunwayLockController,
  resolvePublishWindow,
};
