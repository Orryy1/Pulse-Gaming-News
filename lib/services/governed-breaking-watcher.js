"use strict";

const {
  enqueueBreakingEvent,
} = require("./breaking-event-ingress");

function startGovernedBreakingWatcher({
  startWatching,
  stopWatching,
  jobs,
  nowProvider = () => new Date(),
  channelId = "pulse-gaming",
  log = console.log,
} = {}) {
  if (typeof startWatching !== "function") {
    throw new Error("breaking_watcher_starter_required");
  }
  if (typeof stopWatching !== "function") {
    throw new Error("breaking_watcher_stopper_required");
  }
  if (!jobs || typeof jobs.enqueue !== "function") {
    throw new Error("breaking_watcher_jobs_repository_required");
  }
  const emitter = startWatching();
  if (!emitter || typeof emitter.on !== "function") {
    throw new Error("breaking_watcher_emitter_required");
  }

  let active = true;
  const pending = new Set();
  const onBreaking = (story) => {
    if (!active) return;
    const task = Promise.resolve()
      .then(() =>
        enqueueBreakingEvent({
          story,
          jobs,
          channelId,
          now: nowProvider(),
        }),
      )
      .then((result) => {
        log(
          `[breaking-watcher] story=${result.envelope.story.id || "unresolved"} queued=${result.queued} verdict=${result.envelope.verdict}`,
        );
        return result;
      })
      .catch((error) => {
        log(
          `[breaking-watcher] ingress failed: ${error?.message || error}`,
        );
        return null;
      })
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  emitter.on("breaking", onBreaking);
  log("[breaking-watcher] governed continuous discovery active");

  return {
    get active() {
      return active;
    },
    emitter,
    async flush() {
      await Promise.all([...pending]);
    },
    stop() {
      if (!active) return;
      active = false;
      if (typeof emitter.removeListener === "function") {
        emitter.removeListener("breaking", onBreaking);
      }
      stopWatching();
      log("[breaking-watcher] governed continuous discovery stopped");
    },
  };
}

module.exports = {
  startGovernedBreakingWatcher,
};
