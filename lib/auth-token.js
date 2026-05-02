"use strict";

const crypto = require("node:crypto");

function extractBearerToken(header) {
  if (typeof header !== "string") return "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

function tokenMatches(candidate, secret) {
  if (typeof candidate !== "string" || typeof secret !== "string") {
    return false;
  }
  if (!candidate || !secret) return false;
  const candidateBuf = Buffer.from(candidate, "utf8");
  const secretBuf = Buffer.from(secret, "utf8");
  if (candidateBuf.length !== secretBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, secretBuf);
}

module.exports = { extractBearerToken, tokenMatches };
