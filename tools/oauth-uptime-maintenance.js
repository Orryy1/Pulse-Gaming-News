#!/usr/bin/env node
"use strict";

const axios = require("axios");
const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true, quiet: true });

const {
  runOAuthUptimeMaintenance,
} = require("../lib/platforms/oauth-uptime-runner");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "oauth-uptime");

function configured(value) {
  return typeof value === "string" && value.trim().length >= 8;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    refresh: argv.includes("--refresh"),
    json: argv.includes("--json"),
    outDir: DEFAULT_OUT,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir" && argv[i + 1]) args.outDir = argv[++i];
    else if (argv[i].startsWith("--out-dir=")) {
      args.outDir = argv[i].slice("--out-dir=".length);
    }
  }
  return args;
}

async function readJsonMaybe(filePath) {
  try {
    return await fs.readJson(filePath);
  } catch {
    return {};
  }
}

function buildPlatformAdapters() {
  const youtube = require("../upload_youtube");
  const tiktok = require("../upload_tiktok");
  const instagram = require("../upload_instagram");
  const facebook = require("../upload_facebook");
  const twitter = require("../upload_twitter");

  return {
    youtube: {
      inspect: () => youtube.inspectAuthStatus(),
      refresh: () => youtube.forceRefreshAuth(),
    },
    tiktok: {
      async inspect() {
        const status = await tiktok.inspectTokenStatus();
        const raw = await readJsonMaybe(tiktok.resolveTokenPath());
        return {
          enabled:
            status.refresh_available === true ||
            configured(process.env.TIKTOK_CLIENT_KEY),
          access_expires_at: status.expires_at,
          refresh_expires_at: Number(raw.refresh_expires_at) || null,
          refresh_available: status.refresh_available === true,
        };
      },
      refresh: () => tiktok.forceRefreshStoredToken(),
    },
    instagram: {
      async inspect() {
        const tokenPath = instagram.resolveTokenPath();
        const raw = await readJsonMaybe(tokenPath);
        const envToken = configured(process.env.INSTAGRAM_ACCESS_TOKEN);
        const hasStoredToken = configured(raw.access_token);
        const isPageCredential =
          hasStoredToken &&
          Number(raw.expires_at) === 0 &&
          configured(raw.instagram_business_account_id);
        return {
          enabled:
            hasStoredToken ||
            envToken ||
            configured(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID),
          access_expires_at: Number(raw.expires_at) || null,
          refresh_available: !isPageCredential && (hasStoredToken || envToken),
          credential_kind: isPageCredential ? "page_access_token" : null,
        };
      },
      async refresh() {
        await instagram.seedTokenFromEnv();
        const raw = await readJsonMaybe(instagram.resolveTokenPath());
        const token = raw.access_token || process.env.INSTAGRAM_ACCESS_TOKEN;
        if (!configured(token)) throw new Error("instagram_refresh_token_missing");
        return instagram.refreshToken(token);
      },
      async validate() {
        const raw = await readJsonMaybe(instagram.resolveTokenPath());
        const token = raw.access_token || process.env.INSTAGRAM_ACCESS_TOKEN;
        const accountId =
          raw.instagram_business_account_id ||
          process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
        if (!configured(token) || !configured(accountId)) {
          throw new Error("instagram_page_credential_missing");
        }
        await axios.get(`https://graph.facebook.com/v21.0/${accountId}`, {
          params: {
            fields: "id,username",
            access_token: token,
          },
          timeout: 15000,
        });
        return { ok: true };
      },
    },
    facebook: {
      async inspect() {
        return {
          enabled:
            configured(process.env.FACEBOOK_PAGE_TOKEN) &&
            configured(process.env.FACEBOOK_PAGE_ID),
          credential_kind: "page_access_token",
        };
      },
      async validate() {
        const token = await facebook.getAccessToken();
        const pageId = process.env.FACEBOOK_PAGE_ID;
        await axios.get(`https://graph.facebook.com/v21.0/${pageId}`, {
          params: { fields: "id", access_token: token },
          timeout: 15000,
        });
        return { ok: true };
      },
    },
    x: {
      async inspect() {
        return {
          enabled:
            configured(process.env.TWITTER_API_KEY) &&
            configured(process.env.TWITTER_API_SECRET) &&
            configured(process.env.TWITTER_ACCESS_TOKEN) &&
            configured(process.env.TWITTER_ACCESS_SECRET),
          credential_kind: "oauth1_access_token",
        };
      },
      async validate() {
        const url = "https://api.twitter.com/2/users/me";
        const authorization = twitter.generateOAuthHeader("GET", url);
        await axios.get(url, {
          headers: { Authorization: authorization },
          timeout: 15000,
        });
        return { ok: true };
      },
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await runOAuthUptimeMaintenance({
    outDir: path.resolve(ROOT, args.outDir),
    platformAdapters: buildPlatformAdapters(),
    allowTokenMutation: args.refresh,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } else {
    console.log(`[oauth-uptime] verdict=${result.report.verdict}`);
    console.log(
      `[oauth-uptime] human_reauth=${result.report.requires_human_reauth}`,
    );
    console.log(
      `[oauth-uptime] report=${path.relative(ROOT, result.artefacts.jsonPath)}`,
    );
  }
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[oauth-uptime] FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPlatformAdapters,
  main,
  parseArgs,
};
