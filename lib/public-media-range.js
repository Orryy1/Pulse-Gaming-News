"use strict";

const fs = require("node:fs/promises");

function unsatisfiable(size) {
  return {
    statusCode: 416,
    contentLength: 0,
    contentRange: `bytes */${size}`,
    stream: false,
    start: null,
    end: null,
  };
}

function buildPublicMediaRangePlan({
  method = "GET",
  rangeHeader = null,
  size,
} = {}) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new TypeError("public media size must be a non-negative safe integer");
  }

  const isHead = String(method || "GET").toUpperCase() === "HEAD";
  const rawRange = String(rangeHeader || "").trim();
  if (!rawRange) {
    return {
      statusCode: 200,
      contentLength: size,
      contentRange: null,
      stream: !isHead && size > 0,
      start: 0,
      end: Math.max(0, size - 1),
    };
  }

  if (size === 0 || rawRange.includes(",")) return unsatisfiable(size);
  const match = rawRange.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return unsatisfiable(size);

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return unsatisfiable(size);
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= size ||
      end < start
    ) {
      return unsatisfiable(size);
    }
    end = Math.min(end, size - 1);
  }

  return {
    statusCode: 206,
    contentLength: end - start + 1,
    contentRange: `bytes ${start}-${end}/${size}`,
    stream: !isHead,
    start,
    end,
  };
}

async function readPublicMediaBody(filePath, delivery) {
  if (!delivery || !delivery.stream) return Buffer.alloc(0);
  if (
    !Number.isSafeInteger(delivery.contentLength) ||
    delivery.contentLength < 0 ||
    !Number.isSafeInteger(delivery.start) ||
    delivery.start < 0
  ) {
    throw new TypeError("public media delivery plan is invalid");
  }

  const body = Buffer.allocUnsafe(delivery.contentLength);
  const handle = await fs.open(filePath, "r");
  try {
    let offset = 0;
    while (offset < body.length) {
      const { bytesRead } = await handle.read(
        body,
        offset,
        body.length - offset,
        delivery.start + offset,
      );
      if (bytesRead === 0) {
        throw new Error(
          `public media ended after ${offset} of ${body.length} bytes`,
        );
      }
      offset += bytesRead;
    }
    return body;
  } finally {
    await handle.close();
  }
}

module.exports = {
  buildPublicMediaRangePlan,
  readPublicMediaBody,
};
