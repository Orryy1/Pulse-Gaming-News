#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");
const { google } = require("googleapis");

const MAIN_ROOT = path.resolve("C:/Users/MORR/gaming-studio/pulse-gaming");
const TOKEN_PATH = path.join(MAIN_ROOT, "tokens", "youtube_token.json");
const LEGACY_EVIDENCE_ROOT = path.resolve(
  "D:/pulse-evidence/system-trace-youtube-buffer-20260814",
);
const DISPLAY_PIPELINE_EVIDENCE_ROOT = path.resolve(
  "D:/pulse-evidence/system-trace-display-pipeline-oauth-20260820",
);
const REDIRECT_URI = "http://localhost";
const CALLBACK_TIMEOUT_MS = 30 * 60 * 1000;
const REQUIRED_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
]);

const { writeTokenJsonAtomic } = require(
  path.join(MAIN_ROOT, "lib", "platforms", "durable-token-store"),
);

function hasRequiredScopes(scopes) {
  const set = new Set(
    Array.isArray(scopes) ? scopes : String(scopes || "").split(/\s+/),
  );
  return REQUIRED_SCOPES.every((scope) => set.has(scope));
}

async function writeStatus(value) {
  await fs.writeFile(
    value.status_path,
    `${JSON.stringify(value.payload, null, 2)}\n`,
    "utf8",
  );
}

function resolveAttemptPaths(argv = []) {
  if (argv.length === 0) {
    return {
      attempt: 1,
      evidenceRoot: LEGACY_EVIDENCE_ROOT,
      urlPath: path.join(LEGACY_EVIDENCE_ROOT, "oauth-authorisation-url.txt"),
      statusPath: path.join(
        LEGACY_EVIDENCE_ROOT,
        "oauth-scope-upgrade-status.json",
      ),
      receiptPath: path.join(
        LEGACY_EVIDENCE_ROOT,
        "oauth-scope-upgrade-receipt.json",
      ),
    };
  }
  if (argv.length === 2 && argv[0] === "--attempt" && argv[1] === "2") {
    return {
      attempt: 2,
      evidenceRoot: LEGACY_EVIDENCE_ROOT,
      urlPath: path.join(
        LEGACY_EVIDENCE_ROOT,
        "oauth-authorisation-url-attempt-2.txt",
      ),
      statusPath: path.join(
        LEGACY_EVIDENCE_ROOT,
        "oauth-scope-upgrade-status-attempt-2.json",
      ),
      receiptPath: path.join(
        LEGACY_EVIDENCE_ROOT,
        "oauth-scope-upgrade-receipt.json",
      ),
    };
  }
  if (
    argv.length === 2 &&
    argv[0] === "--campaign" &&
    argv[1] === "display-pipeline"
  ) {
    return {
      attempt: "display-pipeline",
      evidenceRoot: DISPLAY_PIPELINE_EVIDENCE_ROOT,
      urlPath: path.join(
        DISPLAY_PIPELINE_EVIDENCE_ROOT,
        "oauth-authorisation-url.txt",
      ),
      statusPath: path.join(
        DISPLAY_PIPELINE_EVIDENCE_ROOT,
        "oauth-scope-upgrade-status.json",
      ),
      receiptPath: path.join(
        DISPLAY_PIPELINE_EVIDENCE_ROOT,
        "oauth-scope-upgrade-receipt.json",
      ),
    };
  }
  throw new Error(
    "usage: youtube-caption-scope-upgrade.js [--attempt 2 | --campaign display-pipeline]",
  );
}

async function main(argv = process.argv.slice(2)) {
  const attemptPaths = resolveAttemptPaths(argv);
  dotenv.config({ path: path.join(MAIN_ROOT, ".env"), override: false });
  if (await fs.pathExists(TOKEN_PATH))
    throw new Error("youtube_token_file_must_be_absent_before_scope_upgrade");
  if (
    (await fs.pathExists(attemptPaths.urlPath)) ||
    (await fs.pathExists(attemptPaths.statusPath)) ||
    (await fs.pathExists(attemptPaths.receiptPath))
  ) {
    throw new Error("youtube_scope_upgrade_single_use_outputs_already_exist");
  }
  await fs.ensureDir(attemptPaths.evidenceRoot);
  const clientId = String(process.env.YOUTUBE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.YOUTUBE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret)
    throw new Error("youtube_oauth_client_configuration_missing");

  const state = crypto.randomBytes(32).toString("hex");
  const oauth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [...REQUIRED_SCOPES],
    state,
  });
  await fs.writeFile(attemptPaths.urlPath, `${url}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await writeStatus({
    status_path: attemptPaths.statusPath,
    payload: {
      schema_version: 1,
      status: "LISTENING_FOR_GOOGLE_CALLBACK",
      attempt: attemptPaths.attempt,
      generated_at: new Date().toISOString(),
      redirect_uri: REDIRECT_URI,
      token_file_mutation_count: 0,
    },
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => fn(value));
    };
    const server = http.createServer(async (request, response) => {
      try {
        const incoming = new URL(request.url, REDIRECT_URI);
        if (incoming.pathname !== "/") {
          response.writeHead(404).end("Not found");
          return;
        }
        const code = incoming.searchParams.get("code");
        const returnedState = incoming.searchParams.get("state");
        const oauthError = incoming.searchParams.get("error");
        if (oauthError || !code || returnedState !== state) {
          response.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end(
            "Pulse Gaming authorisation was not completed. You can close this tab.",
          );
          throw new Error(
            oauthError
              ? `google_oauth_${oauthError}`
              : "google_oauth_callback_invalid",
          );
        }
        const { tokens } = await oauth.getToken(code);
        if (!tokens?.refresh_token)
          throw new Error("new_scoped_refresh_token_missing");
        oauth.setCredentials(tokens);
        const access = await oauth.getAccessToken();
        const tokenInfo = await oauth.getTokenInfo(access.token);
        if (!hasRequiredScopes(tokenInfo.scopes))
          throw new Error("required_youtube_caption_scope_not_granted");
        await writeTokenJsonAtomic(TOKEN_PATH, tokens);
        const tokenStat = await fs.lstat(TOKEN_PATH);
        const receipt = {
          schema_version: 1,
          receipt_type: "youtube_caption_scope_upgrade",
          generated_at: new Date().toISOString(),
          verdict: "GREEN",
          status: "REQUIRED_SCOPES_VERIFIED",
          granted_scopes: [...tokenInfo.scopes].sort(),
          required_scopes: [...REQUIRED_SCOPES].sort(),
          refresh_available: true,
          token_file: TOKEN_PATH,
          token_file_bytes: tokenStat.size,
          token_file_mutation_count: 1,
          secret_material_recorded_in_receipt: false,
        };
        await fs.writeFile(
          attemptPaths.receiptPath,
          `${JSON.stringify(receipt, null, 2)}\n`,
          {
            encoding: "utf8",
            flag: "wx",
          },
        );
        await writeStatus({
          status_path: attemptPaths.statusPath,
          payload: {
            schema_version: 1,
            status: "GREEN",
            attempt: attemptPaths.attempt,
            generated_at: receipt.generated_at,
            required_scopes_verified: true,
            token_file_mutation_count: 1,
            receipt_path: attemptPaths.receiptPath,
          },
        });
        response.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(
          "Pulse Gaming authorisation is complete. You can close this tab.",
        );
        finish(resolve);
      } catch (error) {
        await writeStatus({
          status_path: attemptPaths.statusPath,
          payload: {
            schema_version: 1,
            status: "RED",
            attempt: attemptPaths.attempt,
            generated_at: new Date().toISOString(),
            blocker: error.message,
            token_file_mutation_count: 0,
          },
        }).catch(() => {});
        finish(reject, error);
      }
    });
    const timer = setTimeout(() => {
      const error = new Error("google_oauth_callback_timeout");
      writeStatus({
        status_path: attemptPaths.statusPath,
        payload: {
          schema_version: 1,
          status: "RED",
          attempt: attemptPaths.attempt,
          generated_at: new Date().toISOString(),
          blocker: error.message,
          token_file_mutation_count: 0,
        },
      }).finally(() => finish(reject, error));
    }, CALLBACK_TIMEOUT_MS);
    server.on("error", (error) => finish(reject, error));
    server.listen(80);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[youtube-caption-scope-upgrade] BLOCKED: ${error.message}`);
    process.exitCode = 2;
  });
}

module.exports = {
  CALLBACK_TIMEOUT_MS,
  REQUIRED_SCOPES,
  hasRequiredScopes,
  main,
  resolveAttemptPaths,
};
