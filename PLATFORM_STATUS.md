# Platform Status

Generated from local reports on 2026-05-01.

## YouTube

Status: proven core path.

Local platform report shows one recent story with a YouTube Shorts URL:

- Story: `1s4denn`
- Video: `iRWg2GWVdfY`
- URL: `https://youtube.com/shorts/iRWg2GWVdfY`

## Facebook Reel

Status: disabled/page-gated until Meta exposes a visible public Reel signal.

Required success interpretation:

- Graph processing completion alone is not enough.
- Treat success as proven only when the API returns a published/permalink signal or a read-only page-content probe sees a visible Reel/video.

Current operational route: keep Facebook Card as the active fallback and report Facebook Reel as skipped/ineligible rather than failed code.

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

