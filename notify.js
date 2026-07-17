const dotenv = require('dotenv');

dotenv.config({ override: true });

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseRetryAfterMs(response, responseBody) {
  const headerValue = response.headers?.get?.("retry-after");
  const bodyValue = responseBody?.retry_after;
  const seconds = Number.parseFloat(headerValue ?? bodyValue);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  if (headerValue) {
    const retryAt = Date.parse(headerValue);
    if (Number.isFinite(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }
  }

  return 1000;
}

async function sendDiscord(message, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleep =
    options.sleep ||
    ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const maxAttempts = clampInteger(options.maxAttempts, 3, 1, 5);
  const maxRetryDelayMs = clampInteger(
    options.maxRetryDelayMs,
    5000,
    0,
    30000,
  );
  const url = env.DISCORD_WEBHOOK_URL;

  if (!url || url === "placeholder") {
    return {
      attempted: false,
      status: "skipped",
      attempts: 0,
      http: null,
      error: {
        code: "webhook_not_configured",
        message: "Discord webhook is not configured.",
      },
      message_id: null,
    };
  }

  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          content: String(message || "").substring(0, 2000),
        }),
      });
      let responseBody = null;
      const contentType = response.headers?.get?.("content-type") || "";

      if (contentType.includes("application/json")) {
        try {
          responseBody = await response.json();
        } catch {
          responseBody = null;
        }
      }

      if (response.ok) {
        return {
          attempted: true,
          status: "delivered",
          attempts,
          http: {
            status: response.status,
            ok: true,
          },
          error: null,
          message_id:
            typeof responseBody?.id === "string" ? responseBody.id : null,
        };
      }

      if (response.status === 429 && attempts < maxAttempts) {
        const retryDelayMs = parseRetryAfterMs(response, responseBody);

        if (retryDelayMs > maxRetryDelayMs) {
          return {
            attempted: true,
            status: "failed",
            attempts,
            http: {
              status: response.status,
              ok: false,
            },
            error: {
              code: "discord_retry_after_exceeds_limit",
              message:
                "Discord requested a Retry-After delay beyond the configured limit.",
            },
            message_id: null,
          };
        }

        await sleep(retryDelayMs);
        continue;
      }

      return {
        attempted: true,
        status: "failed",
        attempts,
        http: {
          status: response.status,
          ok: false,
        },
        error: {
          code:
            response.status === 429
              ? "discord_rate_limit_exhausted"
              : "discord_http_error",
          message: `Discord webhook returned HTTP ${response.status}.`,
        },
        message_id: null,
      };
    } catch (err) {
      return {
        attempted: true,
        status: "failed",
        attempts,
        http: null,
        error: {
          code: "discord_delivery_error",
          message: "Discord webhook delivery failed.",
        },
        message_id: null,
      };
    }
  }
}

module.exports = sendDiscord;
