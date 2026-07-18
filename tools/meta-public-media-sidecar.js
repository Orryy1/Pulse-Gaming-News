#!/usr/bin/env node
"use strict";

const { parseArgs } = require("node:util");

const {
  createMetaPublicMediaServer,
} = require("../lib/meta-public-media-sidecar");

const { values } = parseArgs({
  options: {
    "story-id": { type: "string" },
    video: { type: "string" },
    sha256: { type: "string" },
    port: { type: "string", default: "3002" },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Meta media sidecar port must be between 1024 and 65535");
}

const server = createMetaPublicMediaServer({
  storyId: values["story-id"],
  videoPath: values.video,
  expectedSha256: values.sha256,
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({
      status: "ready",
      host: "127.0.0.1",
      port,
      story_id: values["story-id"],
      sha256: values.sha256,
    })}\n`,
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
