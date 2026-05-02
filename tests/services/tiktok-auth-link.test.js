"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveLocalAuthBaseUrl,
  fetchTikTokAuthRedirect,
  renderTikTokAuthLinkHtml,
} = require("../../lib/platforms/tiktok-auth-link");

test("resolveLocalAuthBaseUrl defaults to local server port", () => {
  assert.equal(resolveLocalAuthBaseUrl({}), "http://127.0.0.1:3001");
  assert.equal(resolveLocalAuthBaseUrl({ PORT: "4444" }), "http://127.0.0.1:4444");
});

test("resolveLocalAuthBaseUrl honours explicit override", () => {
  assert.equal(
    resolveLocalAuthBaseUrl({ TIKTOK_AUTH_SERVER_URL: "http://localhost:3001/" }),
    "http://localhost:3001",
  );
});

test("fetchTikTokAuthRedirect calls protected local initiator and returns Location", async () => {
  const calls = [];
  const requestOnce = async (url, opts) => {
      calls.push({ url, opts });
      return {
        status: 302,
        headers: {
          location:
            "https://www.tiktok.com/v2/auth/authorize/?client_key=abc&state=state",
        },
      };
  };

  const plan = await fetchTikTokAuthRedirect({
    env: { API_TOKEN: "secret", PORT: "3001" },
    requestOnce,
  });

  assert.equal(plan.authUrl, "https://www.tiktok.com/v2/auth/authorize/?client_key=abc&state=state");
  assert.equal(calls[0].url, "http://127.0.0.1:3001/auth/tiktok");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer secret");
});

test("fetchTikTokAuthRedirect rejects missing API token", async () => {
  await assert.rejects(
    () => fetchTikTokAuthRedirect({ env: {}, requestOnce() {} }),
    /API_TOKEN is required/,
  );
});

test("fetchTikTokAuthRedirect rejects unauthorized server response", async () => {
  await assert.rejects(
    () =>
      fetchTikTokAuthRedirect({
        env: { API_TOKEN: "bad" },
        requestOnce: async () => ({ status: 401, headers: {} }),
      }),
    /server rejected API_TOKEN/,
  );
});

test("renderTikTokAuthLinkHtml is operator-readable and contains no API token field", () => {
  const html = renderTikTokAuthLinkHtml({
    authUrl: "https://www.tiktok.com/v2/auth/authorize/?client_key=abc&state=state",
    expiresInMinutes: 10,
  });
  assert.match(html, /Open TikTok Authorisation/);
  assert.match(html, /client_key/);
  assert.doesNotMatch(html, /API_TOKEN|Bearer/);
});
