# Platform Fallback Diagnosis

Date: 2026-04-29
Mode: sandbox, repo-only diagnosis

## Scope

This report diagnoses the Facebook/Instagram fallback incident from local code paths only. No live Graph API calls, Railway reads, retries, OAuth flows or production mutations were performed.

## Instagram Story

### Local path

- `publisher.js` attempts Instagram Story only when `story.story_image_path` exists.
- It calls `upload_instagram.js::uploadStoryImage(story)`.
- The same `story.story_image_path` is also used by Facebook Story/Card through `upload_facebook.js::uploadStoryImage(story)`.
- Instagram does not upload the local file binary for Story. It creates a Graph media container with `image_url=${RAILWAY_PUBLIC_URL}/api/story-image/${story.id}.png`.
- Facebook uploads the local image binary to the Page first, then creates a Facebook Story from the returned `photo_id`.

### Why Facebook Card can work while Instagram Story does not

The assets start from the same local card path, but the platform mechanics differ:

- Facebook Card/Story can read the local image and upload it as binary.
- Instagram Story must fetch a public URL from the running app.
- If the public URL is missing, blocked, not image-like, too slow or rejected by Graph, Instagram can fail even when Facebook succeeds.

### Local change

Instagram Story pending processing now uses the same typed `pending_processing_timeout` classification as Reels. Publisher summaries preserve the container/creation id, status and `verify_later=true` hint instead of collapsing it to a generic failure.

## Instagram Reel `IN_PROGRESS`

### Local path

- Binary Reel path polls `/{container_id}` up to 60 attempts at 10 seconds each.
- URL fallback path also polls up to 60 attempts at 10 seconds each.
- Story path polls up to 30 attempts at 5 seconds each.
- Graph status fields requested remain `status_code,status`; previous evidence showed Graph rejects `error_code,error_subcode,error_message` as requested container fields. Detailed Graph error payloads are still logged from failed exception responses.

### Diagnosis

`status_code=IN_PROGRESS` after the local polling window means the container may still be processing. It should not be treated the same as a hard Graph error and should not immediately start a second upload attempt.

### Local change

- `upload_instagram.js` now throws `InstagramPendingProcessingTimeoutError` with:
  - `code=pending_processing_timeout`
  - `containerId`
  - `creationId`
  - attempts and poll interval
  - last status summary
  - `verify_later=true`
- `publisher.js` now detects this and marks the platform outcome as `accepted_processing`.
- Immediate URL fallback is skipped for pending-processing timeouts to avoid duplicate containers.

### Recommended production follow-up

Add a read-only delayed verifier job that checks the stored container/creation id later and updates the platform status if Graph flips to `FINISHED` or `ERROR`. Do not auto-retry the upload unless the delayed verifier confirms the original container failed.

## Facebook Reel

### Local path

- `publisher.js` treats `FACEBOOK_REELS_ENABLED !== "true"` as `page_not_eligible`.
- `upload_facebook.js::interpretReelStatusSnapshot` does not treat `publishing_phase.status=complete` alone as public success.
- A true Facebook Reel success requires either explicit `publish=published` or `published=true` with a non-empty `permalink_url`.

### Diagnosis

The current local behaviour matches the latest known incident: Facebook Reel is a Page eligibility route, not a code success route. Facebook Card/Story remains the active fallback route and is reported separately from FB Reel.

## Discord and operator visibility

Local publish summaries now render:

- `IG Reel` with pending processing as `accepted_processing`.
- `IG Story` fallback pending/failure with the short reason inline.
- `FB Reel page_not_eligible` as a deliberate pause, not a code failure.
- `FB Card` separately from `FB Reel`.

## Remaining unknowns

Sandbox mode cannot confirm whether the specific live Instagram Story upload was attempted or what exact live Graph payload returned. That needs read-only production logs or a stored job result. The local code now preserves enough structured detail for the next run to be actionable.
