"use strict";

function positive(value, code) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(code);
  return result;
}

function isThenable(value) {
  return Boolean(value && typeof value.then === "function");
}

function startLeaseHeartbeat({
  heartbeat,
  intervalMs,
  onLost,
  signal = null,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  log = console,
}) {
  if (typeof heartbeat !== "function") {
    throw new Error("lease_heartbeat_function_required");
  }
  const delay = positive(intervalMs, "lease_heartbeat_interval_invalid");
  const lostHandler = typeof onLost === "function" ? onLost : () => {};
  if (signal && typeof signal.addEventListener !== "function") {
    throw new Error("lease_heartbeat_signal_invalid");
  }

  let active = true;
  let stopped = false;
  let lostState = false;
  let timer = null;
  let inFlight = null;
  let abortListener = null;
  let resolveLost;
  const lost = new Promise((resolve) => {
    resolveLost = resolve;
  });

  function clearTimer() {
    if (!timer) return false;
    clearIntervalImpl(timer);
    timer = null;
    return true;
  }

  function detachSignal() {
    if (!signal || !abortListener) return;
    signal.removeEventListener?.("abort", abortListener);
    abortListener = null;
  }

  function reportLostHandlerError() {
    log.error?.("[lease] onLost handler failed");
  }

  function lose(reason) {
    if (lostState || stopped) return false;
    lostState = true;
    active = false;
    clearTimer();
    detachSignal();
    resolveLost(reason);
    try {
      const result = lostHandler(reason);
      if (isThenable(result)) {
        Promise.resolve(result).catch(reportLostHandlerError);
      }
    } catch {
      reportLostHandlerError();
    }
    return false;
  }

  function settleHeartbeat(result) {
    if (stopped) return false;
    return result === true ? true : lose("lease_heartbeat_rejected");
  }

  function heartbeatError() {
    log.error?.("[lease] heartbeat failed");
    return lose("lease_heartbeat_error");
  }

  function heartbeatNow() {
    if (!active) return false;
    if (inFlight) return inFlight;
    let result;
    try {
      result = heartbeat();
    } catch {
      return heartbeatError();
    }
    if (!isThenable(result)) return settleHeartbeat(result);
    inFlight = Promise.resolve(result)
      .then(settleHeartbeat, heartbeatError)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const handle = {
    get active() {
      return active;
    },
    get isLost() {
      return lostState;
    },
    lost,
    heartbeatNow,
    assertActive() {
      if (!active) throw new Error("lease_heartbeat_not_active");
      return true;
    },
    stop() {
      if (stopped) return false;
      stopped = true;
      active = false;
      clearTimer();
      detachSignal();
      return true;
    },
  };

  if (signal) {
    abortListener = () => lose("lease_heartbeat_aborted");
    if (signal.aborted) {
      lose("lease_heartbeat_aborted");
      return handle;
    }
    signal.addEventListener("abort", abortListener, { once: true });
  }

  timer = setIntervalImpl(() => {
    const result = heartbeatNow();
    if (isThenable(result)) result.catch(() => {});
    return result;
  }, delay);
  timer.unref?.();
  return handle;
}

module.exports = { startLeaseHeartbeat };
