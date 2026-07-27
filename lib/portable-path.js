"use strict";

const path = require("node:path");

function resolvePortablePath(root, value) {
  const candidate = String(value || "");
  if (path.isAbsolute(candidate)) return path.normalize(candidate);
  if (path.win32.isAbsolute(candidate)) return path.win32.normalize(candidate);

  const base = String(root || "");
  if (path.win32.isAbsolute(base) && !path.isAbsolute(base)) {
    return path.win32.resolve(base, candidate);
  }
  return path.resolve(base, candidate);
}

module.exports = {
  resolvePortablePath,
};
