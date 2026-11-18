import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPlatformWords,
  pausesEveryLane,
  platformAlert,
  unquoted,
} from "../src/faultclass.ts";

// The words of the real failures (the Mac's alert ledger) and the one the flight simulator found first.
const NOV14 =
  "fact-check still failing after a rewrite: Fact-check: \"GameSpot's review called the gameplay very repetitive.\" - The supplied GameSpot article concerns Interplay's distribution dispute, not a review. The review attribution and exact quotation are unsupported.";
const NOV6 =
  'explainer part "Why It Happened" refused: The writer reported missing evidence: Attributed reporting explaining the latest shutdown\'s cause.';
const FORBIDDEN_WEST =
  'writer\'s notes in the narration (after writing): beat 0: "I cannot verify the Horizon Forbidden West sales figure from the supplied text."';

test("one video's content never pauses every lane, at any step", () => {
  for (const msg of [NOV14, NOV6, FORBIDDEN_WEST])
    for (const status of ["selected", "scripted", "uploading"])
      assert.equal(
        pausesEveryLane(msg, status, "news"),
        false,
        `${status}: ${msg.slice(0, 40)}`,
      );
  // Words inside a quotation are the video's, not the platform's.
  assert.equal(
    isPlatformWords('stopped: "the API key leak story was forbidden"'),
    false,
  );
  assert.equal(isPlatformWords("the quotation is unsupported"), false);
  assert.equal(
    pausesEveryLane(
      'videos.insert (session): HTTP 400 invalidTitle {"error":{}}',
      "uploading",
      "news",
    ),
    false,
  );
});

test("a platform refusing the factory still pauses, and the twin never pauses the main channel", () => {
  assert.equal(
    pausesEveryLane(
      "YouTube refresh token is invalid (invalid_grant): reconnect via /oauth/start",
      "selected",
      "news",
    ),
    true,
  );
  assert.equal(
    pausesEveryLane(
      'videos.insert (session): HTTP 403 quotaExceeded {"error":{}}',
      "uploading",
      "news",
    ),
    true,
  );
  assert.equal(
    pausesEveryLane("401 invalid x-api-key", "selected", "news"),
    true,
  );
  assert.equal(
    pausesEveryLane(
      "YouTube refresh token is invalid (invalid_grant)",
      "uploading",
      "twin",
    ),
    false,
  );
  assert.equal(unquoted('a "b c" d'), 'a "" d');
});

test("the pause alert names the service at fault and only asks for a reconnect when it is the login", () => {
  assert.match(
    platformAlert(
      "YouTube refresh token is invalid (invalid_grant)",
      "uploading",
      12,
    ),
    /YouTube refused the factory's login.*Reconnect YouTube/,
  );
  const quota = platformAlert(
    'videos.insert (session): HTTP 403 quotaExceeded {"error":{}}',
    "uploading",
    12,
  );
  assert.match(quota, /resets by itself/);
  assert.doesNotMatch(quota, /Reconnect/);
  const key = platformAlert("401 invalid x-api-key", "scripted", 12);
  assert.match(key, /model's API key/);
  assert.doesNotMatch(key, /Reconnect YouTube/);
});
