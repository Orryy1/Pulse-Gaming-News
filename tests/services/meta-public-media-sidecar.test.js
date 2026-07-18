"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {
  createMetaPublicMediaServer,
} = require("../../lib/meta-public-media-sidecar");

test("Meta media sidecar has a canonical local operator command", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ops:meta-media-sidecar"],
    "node tools/meta-public-media-sidecar.js",
  );
});

function request({ port, method = "GET", requestPath, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: requestPath,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("Meta media sidecar serves only the exact fingerprinted MP4 with byte ranges", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-meta-sidecar-"));
  const videoPath = path.join(tempDir, "video.mp4");
  const bytes = Buffer.from("0123456789abcdef", "ascii");
  fs.writeFileSync(videoPath, bytes);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const storyId = "story-one";
  const server = createMetaPublicMediaServer({
    storyId,
    videoPath,
    expectedSha256: sha256,
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const exactPath =
    `/api/download/${storyId}.mp4` +
    `?platform=instagram_reels&delivery=range-v1&v=${sha256}`;

  try {
    const head = await request({ port, method: "HEAD", requestPath: exactPath });
    assert.equal(head.statusCode, 200);
    assert.equal(Number(head.headers["content-length"]), bytes.length);
    assert.equal(head.body.length, 0);

    const range = await request({
      port,
      requestPath: exactPath,
      headers: { range: "bytes=4-9" },
    });
    assert.equal(range.statusCode, 206);
    assert.equal(range.headers["content-range"], "bytes 4-9/16");
    assert.equal(range.body.toString("ascii"), "456789");

    const mismatch = await request({
      port,
      requestPath: exactPath.replace(sha256, "0".repeat(64)),
    });
    assert.equal(mismatch.statusCode, 404);

    fs.writeFileSync(videoPath, Buffer.from("fedcba9876543210", "ascii"));
    const drifted = await request({ port, requestPath: exactPath });
    assert.equal(drifted.statusCode, 409);
    assert.match(drifted.body.toString("utf8"), /fingerprint drift/i);

    const unhealthy = await request({ port, requestPath: "/health" });
    assert.equal(unhealthy.statusCode, 503);
    assert.equal(JSON.parse(unhealthy.body.toString("utf8")).status, "red");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
