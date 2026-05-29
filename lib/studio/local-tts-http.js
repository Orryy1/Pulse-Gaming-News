"use strict";

const http = require("node:http");
const https = require("node:https");

const LOCAL_TTS_HTTP_AGENT = new http.Agent({
  keepAlive: false,
  maxSockets: 1,
});

const LOCAL_TTS_HTTPS_AGENT = new https.Agent({
  keepAlive: false,
  maxSockets: 1,
});

function withoutConnectionHeader(headers = {}) {
  const cleaned = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === "connection") continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function withLocalTtsSocketIsolation(requestConfig = {}) {
  return {
    ...requestConfig,
    headers: {
      ...withoutConnectionHeader(requestConfig.headers || {}),
      Connection: "close",
    },
    httpAgent: LOCAL_TTS_HTTP_AGENT,
    httpsAgent: LOCAL_TTS_HTTPS_AGENT,
  };
}

module.exports = {
  withLocalTtsSocketIsolation,
};
