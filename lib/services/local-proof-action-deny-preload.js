"use strict";

/**
 * This file is preloaded into every activation-stage node:test process.
 * The suites are an allowlisted local proof surface. Network clients,
 * persistent database engines and external publication/OAuth modules are
 * denied before the test modules load. Better SQLite is restricted to
 * ephemeral :memory: repository fixtures.
 */

const Module = require("node:module");
const dgram = require("node:dgram");
const dns = require("node:dns");
const http = require("node:http");
const http2 = require("node:http2");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");

const BLOCKED_PACKAGES = new Set([
  "sqlite3",
  "node:sqlite",
  "googleapis",
  "axios",
  "node-fetch",
  "undici",
]);

const BLOCKED_LOCAL_MODULE =
  /(?:^|[\\/])(?:db|publisher|upload_(?:youtube|tiktok|instagram|facebook|twitter|x)|oauth-state|auth-token|token-paths)(?:\.js)?$/i;

function deny(action) {
  return function localProofActionDenied() {
    const error = new Error(`LOCAL_PROOF_ACTION_FORBIDDEN:${action}`);
    error.code = "LOCAL_PROOF_ACTION_FORBIDDEN";
    throw error;
  };
}

const originalLoad = Module._load;
let localOnlyBetterSqlite = null;
Module._load = function guardedModuleLoad(request, parent, isMain) {
  const declared = String(request || "");
  if (declared === "better-sqlite3") {
    if (!localOnlyBetterSqlite) {
      const BetterSqlite = originalLoad.call(
        this,
        request,
        parent,
        isMain,
      );
      localOnlyBetterSqlite = function LocalProofMemoryDatabase(
        filename,
        options,
      ) {
        if (filename !== ":memory:") {
          deny("database:persistent_sqlite")();
        }
        return new BetterSqlite(filename, options);
      };
      Object.setPrototypeOf(localOnlyBetterSqlite, BetterSqlite);
      localOnlyBetterSqlite.prototype = BetterSqlite.prototype;
    }
    return localOnlyBetterSqlite;
  }
  if (
    BLOCKED_PACKAGES.has(declared) ||
    BLOCKED_LOCAL_MODULE.test(declared.replace(/\\/g, "/"))
  ) {
    throw deny(`module:${declared}`)();
  }
  return originalLoad.call(this, request, parent, isMain);
};

for (const [target, methods, label] of [
  [net, ["connect", "createConnection"], "network:net"],
  [tls, ["connect"], "network:tls"],
  [http, ["request", "get"], "network:http"],
  [https, ["request", "get"], "network:https"],
  [http2, ["connect"], "network:http2"],
  [dgram, ["createSocket"], "network:dgram"],
  [
    dns,
    [
      "lookup",
      "resolve",
      "resolve4",
      "resolve6",
      "resolveAny",
      "resolveCaa",
      "resolveCname",
      "resolveMx",
      "resolveNaptr",
      "resolveNs",
      "resolvePtr",
      "resolveSoa",
      "resolveSrv",
      "resolveTxt",
      "reverse",
    ],
    "network:dns",
  ],
]) {
  for (const method of methods) {
    if (typeof target[method] === "function") {
      target[method] = deny(`${label}:${method}`);
    }
  }
}

if (dns.promises) {
  for (const method of Object.keys(dns.promises)) {
    if (typeof dns.promises[method] === "function") {
      dns.promises[method] = deny(`network:dns.promises:${method}`);
    }
  }
}

if (typeof globalThis.fetch === "function") {
  globalThis.fetch = deny("network:fetch");
}
if (typeof globalThis.WebSocket === "function") {
  globalThis.WebSocket = class LocalProofWebSocketDenied {
    constructor() {
      deny("network:websocket")();
    }
  };
}

process.env.DEPLOYMENT_MODE = "local";
process.env.PULSE_OPERATING_MODE = "LOCAL_PROOF";
process.env.OPERATING_MODE = "LOCAL_PROOF";
process.env.AUTO_PUBLISH = "false";
process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "false";
process.env.PULSE_EMERGENCY_KILL_SWITCH = "true";
process.env.PULSE_KILL_SWITCH = "true";
process.env.USE_SQLITE = "false";
