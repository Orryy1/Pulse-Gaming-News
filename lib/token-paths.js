"use strict";

const path = require("path");

const DEFAULT_TOKEN_DIR = path.join(__dirname, "..", "tokens");

function resolveTokenDir(env = process.env) {
  const override = (env.PULSE_TOKEN_DIR || env.TOKENS_DIR || "").trim();
  return override || DEFAULT_TOKEN_DIR;
}

function resolveTokenPath(specificEnvName, filename, env = process.env) {
  const specificOverride = (env[specificEnvName] || "").trim();
  if (specificOverride) return specificOverride;
  return path.join(resolveTokenDir(env), filename);
}

function resolveFacebookTokenPath(env = process.env) {
  return resolveTokenPath("FACEBOOK_TOKEN_PATH", "facebook_token.json", env);
}

function resolveInstagramTokenPath(env = process.env) {
  return resolveTokenPath(
    "INSTAGRAM_TOKEN_PATH",
    "instagram_token.json",
    env,
  );
}

module.exports = {
  DEFAULT_TOKEN_DIR,
  resolveTokenDir,
  resolveTokenPath,
  resolveFacebookTokenPath,
  resolveInstagramTokenPath,
};
