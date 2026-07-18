"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildPublicMediaRangePlan,
  readPublicMediaBody,
} = require("../../lib/public-media-range");

test("public media HEAD returns metadata without opening a body stream", () => {
  assert.deepEqual(
    buildPublicMediaRangePlan({
      method: "HEAD",
      rangeHeader: null,
      size: 80_976_910,
    }),
    {
      statusCode: 200,
      contentLength: 80_976_910,
      contentRange: null,
      stream: false,
      start: 0,
      end: 80_976_909,
    },
  );
});

test("public media serves a bounded single byte range", () => {
  assert.deepEqual(
    buildPublicMediaRangePlan({
      method: "GET",
      rangeHeader: "bytes=0-1023",
      size: 80_976_910,
    }),
    {
      statusCode: 206,
      contentLength: 1024,
      contentRange: "bytes 0-1023/80976910",
      stream: true,
      start: 0,
      end: 1023,
    },
  );
});

test("public media supports open-ended and suffix byte ranges", () => {
  assert.deepEqual(
    buildPublicMediaRangePlan({
      method: "GET",
      rangeHeader: "bytes=80976000-",
      size: 80_976_910,
    }),
    {
      statusCode: 206,
      contentLength: 910,
      contentRange: "bytes 80976000-80976909/80976910",
      stream: true,
      start: 80_976_000,
      end: 80_976_909,
    },
  );
  assert.deepEqual(
    buildPublicMediaRangePlan({
      method: "GET",
      rangeHeader: "bytes=-1024",
      size: 80_976_910,
    }),
    {
      statusCode: 206,
      contentLength: 1024,
      contentRange: "bytes 80975886-80976909/80976910",
      stream: true,
      start: 80_975_886,
      end: 80_976_909,
    },
  );
});

test("public media rejects malformed or unsatisfiable ranges", () => {
  for (const rangeHeader of [
    "bytes=90000000-",
    "bytes=200-100",
    "items=0-10",
    "bytes=0-1,4-5",
  ]) {
    assert.deepEqual(
      buildPublicMediaRangePlan({
        method: "GET",
        rangeHeader,
        size: 80_976_910,
      }),
      {
        statusCode: 416,
        contentLength: 0,
        contentRange: "bytes */80976910",
        stream: false,
        start: null,
        end: null,
      },
      rangeHeader,
    );
  }
});

test("public media reads exactly the planned bytes without a long-lived file stream", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-public-media-"));
  const mediaPath = path.join(tempDir, "sample.mp4");
  fs.writeFileSync(mediaPath, Buffer.from("0123456789abcdef", "ascii"));

  try {
    const delivery = buildPublicMediaRangePlan({
      method: "GET",
      rangeHeader: "bytes=4-9",
      size: 16,
    });
    const body = await readPublicMediaBody(mediaPath, delivery);

    assert.equal(body.toString("ascii"), "456789");
    assert.equal(body.length, delivery.contentLength);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
