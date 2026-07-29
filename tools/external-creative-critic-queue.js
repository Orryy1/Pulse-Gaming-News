#!/usr/bin/env node
"use strict";

const {
  defaultAllowedRoots,
  enqueueExternalCreativeCriticRequest,
  getExternalCreativeCriticQueueStatus,
  ingestExternalCreativeCriticResponse,
  readExternalCreativeCriticQueueJsonInput,
  stageExternalCreativeCriticResponse,
  sweepExternalCreativeCriticQueue,
} = require("../lib/services/external-creative-critic-queue");

const COMMAND_FIELDS = Object.freeze({
  enqueue: new Set([
    "queue-root",
    "state-root",
    "input",
    "lane-id",
    "candidate-revision-sha256",
    "timeout-seconds",
    "now",
  ]),
  status: new Set(["queue-root", "state-root", "request-id"]),
  ingest: new Set([
    "queue-root",
    "state-root",
    "request-id",
    "response",
    "now",
  ]),
  stage: new Set([
    "queue-root",
    "state-root",
    "request-id",
    "response",
    "broker-receipt",
  ]),
  sweep: new Set(["queue-root", "state-root", "now"]),
});

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!Object.hasOwn(COMMAND_FIELDS, command)) {
    throw new Error("critic_queue_command_required");
  }
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected_argument:${argument}`);
    }
    const name = argument.slice(2);
    if (!COMMAND_FIELDS[command].has(name)) {
      throw new Error(`unknown_argument:${argument}`);
    }
    if (Object.hasOwn(values, name)) {
      throw new Error(`duplicate_argument:${argument}`);
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`argument_value_required:${argument}`);
    }
    values[name] = value;
    index += 1;
  }
  if (!values["queue-root"]) {
    throw new Error("critic_queue_root_required");
  }
  const required = {
    enqueue: ["input", "lane-id", "candidate-revision-sha256"],
    status: ["request-id"],
    ingest: ["request-id", "response"],
    stage: ["request-id", "response"],
    sweep: [],
  }[command];
  for (const name of required) {
    if (!values[name]) {
      throw new Error(`critic_queue_argument_required:${name}`);
    }
  }
  return { command, values };
}

function timeoutMilliseconds(value) {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error("critic_queue_timeout_seconds_invalid");
  }
  return seconds * 1000;
}

async function run(argv = process.argv.slice(2)) {
  const { command, values } = parseArgs(argv);
  const queueRoot = values["queue-root"];
  const allowedRoots = values["state-root"]
    ? [...defaultAllowedRoots(), values["state-root"]]
    : undefined;
  if (command === "enqueue") {
    const input = await readExternalCreativeCriticQueueJsonInput({
      filePath: values.input,
      allowedRoots,
    });
    return enqueueExternalCreativeCriticRequest({
      queueRoot,
      input,
      laneId: values["lane-id"],
      candidateRevisionSha256:
        values["candidate-revision-sha256"],
      ...(values.now ? { now: values.now } : {}),
      ...(values["timeout-seconds"]
        ? {
            timeoutMs: timeoutMilliseconds(
              values["timeout-seconds"],
            ),
          }
        : {}),
      allowedRoots,
    });
  }
  if (command === "status") {
    return getExternalCreativeCriticQueueStatus({
      queueRoot,
      requestId: values["request-id"],
      allowedRoots,
    });
  }
  if (command === "ingest") {
    return ingestExternalCreativeCriticResponse({
      queueRoot,
      requestId: values["request-id"],
      responsePath: values.response,
      ...(values.now ? { now: values.now } : {}),
      allowedRoots,
    });
  }
  if (command === "stage") {
    return stageExternalCreativeCriticResponse({
      queueRoot,
      requestId: values["request-id"],
      responsePath: values.response,
      brokerReceiptPath: values["broker-receipt"],
      allowedRoots,
    });
  }
  return sweepExternalCreativeCriticQueue({
    queueRoot,
    ...(values.now ? { now: values.now } : {}),
    allowedRoots,
  });
}

if (require.main === module) {
  run()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `[external-creative-critic-queue] ${error.message}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  run,
};
