"use strict";

const RETRIABLE_GRAPH_CODES = new Set([1, 2, 4, 17, 32, 613]);

function cleanText(value, maxLength = 500) {
  const text = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseFacebookGraphError(error, { stage = "request" } = {}) {
  const graphError = error?.response?.data?.error || {};
  return {
    platform: "facebook",
    stage: cleanText(stage, 80) || "request",
    http_status: numberOrNull(error?.response?.status),
    type: cleanText(graphError.type, 120) || null,
    code: numberOrNull(graphError.code),
    subcode: numberOrNull(graphError.error_subcode),
    transient:
      typeof graphError.is_transient === "boolean"
        ? graphError.is_transient
        : null,
    message:
      cleanText(graphError.message || error?.message || "Facebook request failed") ||
      "Facebook request failed",
    user_title: cleanText(graphError.error_user_title, 200) || null,
    user_message: cleanText(graphError.error_user_msg, 500) || null,
    trace_id: cleanText(graphError.fbtrace_id, 160) || null,
  };
}

function facebookGraphErrorIsRetriable(details = {}) {
  if (details.transient === true) return true;
  if (details.http_status === 408 || details.http_status === 429) return true;
  if (Number(details.http_status) >= 500) return true;
  if (RETRIABLE_GRAPH_CODES.has(Number(details.code))) return true;
  if (
    Number(details.http_status) >= 400 &&
    Number(details.http_status) < 500
  ) {
    return false;
  }
  return true;
}

function buildFacebookGraphError(error, options = {}) {
  if (error?.name === "FacebookGraphApiError" && error?.graph) return error;

  const details = normaliseFacebookGraphError(error, options);
  const fields = [
    details.http_status ? `HTTP ${details.http_status}` : null,
    details.code !== null ? `code=${details.code}` : null,
    details.subcode !== null ? `subcode=${details.subcode}` : null,
    details.type ? `type=${details.type}` : null,
    details.transient !== null ? `transient=${details.transient}` : null,
    details.user_title ? `user_title=${details.user_title}` : null,
    details.user_message ? `user_message=${details.user_message}` : null,
    `message=${details.message}`,
    details.trace_id ? `trace=${details.trace_id}` : null,
  ].filter(Boolean);

  const wrapped = new Error(
    `Facebook Graph ${details.stage} failed: ${fields.join(" ")}`,
    { cause: error },
  );
  wrapped.name = "FacebookGraphApiError";
  wrapped.code = "facebook_graph_api_error";
  wrapped.platform = "facebook";
  wrapped.stage = details.stage;
  wrapped.httpStatus = details.http_status;
  wrapped.graphCode = details.code;
  wrapped.graphSubcode = details.subcode;
  wrapped.graph = details;
  wrapped.networkAttempted = true;
  wrapped.retriable = facebookGraphErrorIsRetriable(details);
  wrapped.nonRetriable = !wrapped.retriable;
  return wrapped;
}

async function withFacebookGraphStage(stage, request) {
  try {
    return await request();
  } catch (error) {
    throw buildFacebookGraphError(error, { stage });
  }
}

module.exports = {
  buildFacebookGraphError,
  facebookGraphErrorIsRetriable,
  normaliseFacebookGraphError,
  withFacebookGraphStage,
};
