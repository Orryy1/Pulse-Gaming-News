# Thumbnail Safety Audit

Generated: 2026-04-29

## Current Media Sources

`downloaded_images` are produced by `images_download.js` and then consumed by the legacy image compositor, Instagram Story card generator, Studio v2 thumbnail builder and content QA.

Current acquisition order:

- article `og:image` as `article_hero`
- Steam game art from stored `game_images`
- Steam direct-search fallback key art, hero art, capsule art and screenshots
- inline article images scraped from `<meta>`, `<img>` and `srcset`
- Reddit thumbnail URL as `reddit_thumb`
- company logo as `company_logo`
- Pexels portrait stock fallback when enabled
- Unsplash portrait stock fallback
- Bing image search fallback
- Steam/IGDB/YouTube trailer clips into `video_clips`

## Why Random People Can Appear

The risky sources are article inline images, author/profile imagery, Reddit/social thumbnails, Pexels/Unsplash/Bing fallbacks and article hero images from pages that use an author headshot, interview portrait or social avatar as their primary image. YouTube may also auto-select any visible frame from the Short if no custom thumbnail is set or if the custom thumbnail upload fails.

## Current Protection

`lib/thumbnail-safety.js` rejects or penalises:

- unknown human/portrait hints
- article author, byline, staff, profile, avatar, headshot and gravatar hints
- generic stock people
- low-value tracking/ad/icon imagery
- social/reddit/avatar-style candidates when hints are visible in metadata or URL

It prefers:

- official game key art
- Steam/official/publisher/trailer assets
- screenshots
- trailer frames
- platform logos and store UI

Entity-matched human images are allowed only when an explicit person field such as `personName` matches the story title, script or known entities. Generic image `name` metadata is not treated as a person identity.

## This Pass

- Manual `node run.js produce` now runs the same Studio v2 thumbnail builder used by the queued production produce path.
- YouTube custom thumbnail selection now prefers `thumbnail_candidate_path` before legacy Story/image cards when `hf_thumbnail_path` is unavailable.
- Article/Bing scraping now skips author/profile/headshot/avatar-style URLs before download.
- Visual QA resolves `thumbnail_candidate_path` through `lib/media-paths` so local and `MEDIA_ROOT` paths are checked consistently.
- Tests pin the stricter entity exemption and thumbnail candidate ordering.

## Promotion Notes

Safe to promote when tests and build pass. This does not alter posting cadence, OAuth, scheduler state, live environment variables or platform credentials. The only live behaviour change is safer thumbnail selection and reduced chance of author/profile images entering render inventory.

