"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const uploaderPath = path.resolve(__dirname, "..", "..", "upload_youtube.js");
const publisherPath = path.resolve(__dirname, "..", "..", "publisher.js");
const uploaderSource = fs.readFileSync(uploaderPath, "utf8");
const publisherSource = fs.readFileSync(publisherPath, "utf8");
const {
  buildYoutubeShortRequestBody,
  insertYoutubeVideoOnce,
  resolveContainsSyntheticMedia,
  uploadAll,
  uploadLongform,
  uploadShort,
} = require("../../upload_youtube");

test("YouTube create mutation is attempted exactly once when its response is ambiguous", async () => {
  let attempts = 0;
  const responseLost = new Error("response lost after request body sent");
  const youtube = {
    videos: {
      async insert() {
        attempts += 1;
        throw responseLost;
      },
    },
  };

  await assert.rejects(
    insertYoutubeVideoOnce(youtube, { requestBody: {} }),
    (error) => error === responseLost,
  );
  assert.equal(attempts, 1);
});

test("governed YouTube request carries the reviewed altered-content decision", () => {
  const disclosed = {
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is present.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  };
  const notDisclosed = {
    synthetic_media_disclosure: {
      contains_synthetic_media: false,
      decision: "NO_DISCLOSURE_REQUIRED",
      rationale: "The final edit contains no realistic altered content.",
      disclosure_text: null,
      youtube_field_value: false,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  };

  assert.equal(resolveContainsSyntheticMedia(disclosed), true);
  assert.equal(resolveContainsSyntheticMedia(notDisclosed), false);
  assert.equal(
    buildYoutubeShortRequestBody(disclosed, {
      title: "Reviewed title",
      description: "Reviewed description",
      tags: ["Pulse Gaming News"],
      categoryId: "20",
    }).status.containsSyntheticMedia,
    true,
  );
  assert.throws(
    () => resolveContainsSyntheticMedia({}),
    /youtube_synthetic_disclosure_decision_required/,
  );
  assert.throws(
    () =>
      resolveContainsSyntheticMedia({
        synthetic_media_disclosure: {
          ...disclosed.synthetic_media_disclosure,
          youtube_field_value: false,
        },
      }),
    /youtube_synthetic_disclosure_field_mismatch/,
  );
});

test("YouTube adapter refuses direct Short and legacy batch mutation paths", async () => {
  await assert.rejects(
    uploadShort({ id: "story-1", title: "Direct call" }),
    /governed_youtube_dispatch_required/,
  );
  await assert.rejects(
    uploadAll(),
    /legacy_youtube_batch_publish_disabled_use_governed_queue/,
  );
});

test("long-form YouTube mutation is frozen by the default stabilisation profile", async (t) => {
  const previous = process.env.PULSE_SCHEDULER_PROFILE;
  delete process.env.PULSE_SCHEDULER_PROFILE;
  t.after(() => {
    if (previous === undefined) delete process.env.PULSE_SCHEDULER_PROFILE;
    else process.env.PULSE_SCHEDULER_PROFILE = previous;
  });

  await assert.rejects(
    uploadLongform({}),
    /stabilisation_longform_upload_disabled/,
  );
});

test("publisher is the governed Short caller and the adapter has no generic mutation retry", () => {
  assert.doesNotMatch(uploaderSource, /\bwithRetry\b/);
  assert.match(
    publisherSource,
    /uploadShort\(uploadStory,\s*\{\s*governedDispatch:\s*true,\s*markCreateAttemptStarted,\s*\}\)/,
  );
  assert.match(
    publisherSource,
    /synthetic_media_disclosure:\s*scheduled\.publicationEvidence\.synthetic_media_disclosure/,
  );
  assert.match(
    uploaderSource,
    /async function uploadShort\(\s*story,\s*\{\s*governedDispatch\s*=\s*false,\s*markCreateAttemptStarted\s*=\s*null,\s*\}\s*=\s*\{\},?\s*\)/,
  );
  assert.match(
    uploaderSource,
    /markCreateAttemptStarted\(\);\s*const response = await insertYoutubeVideoOnce/,
  );
});
