# Platform Status

Generated from local reports on 2026-04-28.

## YouTube

Status: proven core path.

Local platform report shows one recent story with a YouTube Shorts URL:

- Story: `1s4denn`
- Video: `iRWg2GWVdfY`
- URL: `https://youtube.com/shorts/iRWg2GWVdfY`

## Facebook Reel

Status: needs live proof after success-condition fix.

Required success interpretation:

- `video_status=ready`
- `publishing_phase.status=complete`

Tests cover this path. A real platform cycle is still required before calling it fully proven.

## Facebook Card

Status: fallback path exists.

Rule: the fallback must not hide Reel failures. Discord/operator reporting should keep Reel outcome visible.

## Instagram Reel

Status: degraded but improved for diagnosis.

Polling should request and preserve:

- `status_code`
- `status`
- `error_code`
- `error_subcode`
- `error_message`

## Instagram Story

Status: fallback has worked previously.

Next improvement is richer safe error logging.

## TikTok

Status: official public posting externally blocked.

Current local diagnosis:

- Likely blocker: unaudited TikTok app/public posting restriction.
- Scope bug likelihood: low based on local auth URL.
- URL ownership likelihood: low because FILE_UPLOAD is active.
- Token status: unknown in this read-only pass.

Operational fallback: `npm run tiktok:dispatch`.

## X/Twitter

Status: intentionally disabled unless API billing and explicit approval are in place.

