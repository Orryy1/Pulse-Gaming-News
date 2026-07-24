"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

test("tiktok-inbox-upload loads dotenv before opening the DB", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "tiktok-inbox-upload.js"),
    "utf8",
  );
  const dotenvConfig = src.indexOf('dotenv.config({ override: true })');
  const dbRequire = src.indexOf('require("../lib/db")');

  assert.ok(dotenvConfig >= 0, "dotenv config call must exist");
  assert.ok(dbRequire >= 0, "db require must exist");
  assert.ok(
    dotenvConfig < dbRequire,
    "dotenv must load before lib/db so DATABASE_PATH / USE_SQLITE are honoured",
  );
});

test("tiktok-inbox-upload requires an operator confirmation flag before live inbox send", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "tiktok-inbox-upload.js"),
    "utf8",
  );

  assert.match(src, /--operator-confirmed/);
  assert.match(src, /tiktok_inbox_upload_requires_operator_confirmed_flag/);
  assert.match(src, /process\.env\.TIKTOK_ENABLED = "true"/);
  assert.match(src, /process\.env\.TIKTOK_AUTO_UPLOAD_ENABLED = "true"/);
});

test("tiktok-inbox-upload classifies pending-share TikTok 400 without retry advice", () => {
  const { classifyTikTokInboxUploadError } = require("../../tools/tiktok-inbox-upload");

  const classified = classifyTikTokInboxUploadError({
    message: "Request failed with status code 400",
    response: {
      status: 400,
      data: {
        error: {
          code: "spam_risk_too_many_pending_share",
          message: "spam_risk_too_many_pending_share",
          log_id: "log123",
        },
      },
    },
  });

  assert.equal(classified.reason, "tiktok_pending_share_limit");
  assert.equal(classified.http_status, 400);
  assert.equal(classified.raw_error_code, "spam_risk_too_many_pending_share");
  assert.match(classified.operator_action, /pending inbox\/draft share items/);
});

test("TikTok status-only checks never persist to the production story", () => {
  const {
    shouldPersistTikTokInboxResult,
  } = require("../../tools/tiktok-inbox-upload");

  assert.equal(
    shouldPersistTikTokInboxResult({
      args: { statusOnly: true },
      story: { id: "s1" },
      payload: { publish_id: "v_inbox_file~123" },
    }),
    false,
  );
  assert.equal(
    shouldPersistTikTokInboxResult({
      args: { statusOnly: false },
      story: { id: "s1" },
      payload: { publish_id: "v_inbox_file~123" },
    }),
    true,
  );
});

test("TikTok read-only status fetch passes the stored access token explicitly without exposing it", async () => {
  const {
    fetchTikTokInboxStatusReadOnly,
  } = require("../../tools/tiktok-inbox-upload");
  const dir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "pulse-tiktok-status-readonly-"),
  );
  const tokenPath = path.join(dir, "tiktok_token.json");
  await fsPromises.writeFile(
    tokenPath,
    JSON.stringify({
      access_token: "secret-access-token-value",
      refresh_token: "secret-refresh-token-value",
      expires_at: Date.now() + 3_600_000,
    }),
    "utf8",
  );

  let receivedOptions = null;
  const result = await fetchTikTokInboxStatusReadOnly("v_inbox_file~123", {
    tokenPath,
    fetchStatus: async (publishId, options) => {
      assert.equal(publishId, "v_inbox_file~123");
      receivedOptions = options;
      return {
        ok: true,
        status: "SEND_TO_USER_INBOX",
        publicly_available_post_id: [],
      };
    },
  });

  assert.equal(receivedOptions.accessToken, "secret-access-token-value");
  assert.equal(result.status, "SEND_TO_USER_INBOX");
  assert.doesNotMatch(JSON.stringify(result), /secret-access-token-value/);
});
