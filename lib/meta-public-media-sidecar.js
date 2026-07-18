"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const {
  buildPublicMediaRangePlan,
  readPublicMediaBody,
} = require("./public-media-range");

function sha256FileSync(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fileVersion(stat) {
  return [
    stat.dev,
    stat.ino,
    stat.size,
    stat.mtimeMs,
    stat.ctimeMs,
    stat.birthtimeMs,
  ].join(":");
}

function createMetaPublicMediaServer({
  storyId,
  videoPath,
  expectedSha256,
} = {}) {
  const safeStoryId = String(storyId || "").trim();
  const absoluteVideoPath = path.resolve(String(videoPath || ""));
  const fingerprint = String(expectedSha256 || "").trim().toLowerCase();

  if (!/^[A-Za-z0-9_-]+$/.test(safeStoryId)) {
    throw new TypeError("Meta media sidecar requires a safe story ID");
  }
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new TypeError("Meta media sidecar requires a SHA-256 fingerprint");
  }
  if (!fs.existsSync(absoluteVideoPath)) {
    throw new Error("Meta media sidecar video does not exist");
  }
  if (sha256FileSync(absoluteVideoPath) !== fingerprint) {
    throw new Error("Meta media sidecar video fingerprint does not match");
  }

  const stat = fs.statSync(absoluteVideoPath);
  let verifiedFileVersion = fileVersion(stat);
  let driftedFileVersion = null;
  const expectedPath = `/api/download/${safeStoryId}.mp4`;

  function verifyCurrentMedia() {
    try {
      const currentStat = fs.statSync(absoluteVideoPath);
      const currentVersion = fileVersion(currentStat);
      if (currentVersion === verifiedFileVersion) {
        return { ok: true, stat: currentStat };
      }
      if (currentVersion === driftedFileVersion) {
        return { ok: false, stat: currentStat };
      }
      if (sha256FileSync(absoluteVideoPath) !== fingerprint) {
        driftedFileVersion = currentVersion;
        return { ok: false, stat: currentStat };
      }
      verifiedFileVersion = currentVersion;
      driftedFileVersion = null;
      return { ok: true, stat: currentStat };
    } catch {
      return { ok: false, stat: null };
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/health") {
        const integrity = verifyCurrentMedia();
        res.writeHead(integrity.ok ? 200 : 503, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        return res.end(
          JSON.stringify({
            status: integrity.ok ? "ok" : "red",
            story_id: safeStoryId,
            sha256: fingerprint,
            blocker: integrity.ok ? null : "media_fingerprint_drift",
          }),
        );
      }

      const exactRequest =
        (req.method === "GET" || req.method === "HEAD") &&
        requestUrl.pathname === expectedPath &&
        requestUrl.searchParams.get("platform") === "instagram_reels" &&
        requestUrl.searchParams.get("delivery") === "range-v1" &&
        requestUrl.searchParams.get("v") === fingerprint;
      if (!exactRequest) {
        res.writeHead(404, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        return res.end(JSON.stringify({ error: "not found" }));
      }

      const integrity = verifyCurrentMedia();
      if (!integrity.ok) {
        res.writeHead(409, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        return res.end(JSON.stringify({ error: "media fingerprint drift" }));
      }

      const delivery = buildPublicMediaRangePlan({
        method: req.method,
        rangeHeader: req.headers.range,
        size: integrity.stat.size,
      });
      const headers = {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Length": delivery.contentLength,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="pulse-gaming-${safeStoryId}.mp4"`,
        "X-Content-Type-Options": "nosniff",
      };
      if (delivery.contentRange) {
        headers["Content-Range"] = delivery.contentRange;
      }

      res.writeHead(delivery.statusCode, headers);
      if (!delivery.stream) return res.end();
      const body = await readPublicMediaBody(absoluteVideoPath, delivery);
      return res.end(body);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
      }
      return res.end(JSON.stringify({ error: "media delivery failed" }));
    }
  });

  server.keepAliveTimeout = 10_000;
  server.headersTimeout = 15_000;
  return server;
}

module.exports = {
  createMetaPublicMediaServer,
  sha256FileSync,
};
