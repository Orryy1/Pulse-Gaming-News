# Thumbnail Safety Audit

Local-only audit for the random-face Shorts thumbnail problem.

## Current source chain

- `hunter.js` stores article `og:image`, Reddit thumbnail URLs and Steam/media hints on the story.
- `images_download.js` downloads article hero images first, then Steam/store assets, article inline images, Reddit thumbnails, company logos and optional stock/search fallbacks.
- `images.js` builds the legacy 1080x1920 composite from the first available hero image and stores `downloaded_images` for render assembly.
- `images_story.js` builds Instagram Story fallback images from `downloaded_images`.
- `lib/studio/v2/hf-thumbnail-builder.js` builds the YouTube custom thumbnail and `upload_youtube.js` uploads `hf_thumbnail_path` first, then legacy story/image paths.

## Why random people could appear

- Article `og:image` had priority above game/store artwork. If a publisher supplied an author/profile/social portrait as the hero image, it could become the thumbnail subject.
- Inline article scraping skipped obvious `avatar`, `icon` and `logo` URLs but did not classify author/profile/byline/headshot images after download.
- Pexels, Unsplash and Bing fallbacks could add generic stock people to `downloaded_images`.
- HyperFrames thumbnail selection trusted cached article/trailer paths directly and did not run a relevance gate.
- YouTube upload used the first existing thumbnail path without a pre-upload safety check.

## Local fix

- `lib/thumbnail-safety.js` classifies image candidates by source, type, URL/path tokens and story relevance.
- Unknown human portraits, author/profile images, avatars and generic stock people are rejected for thumbnail use.
- Human images are allowed only when the candidate carries a person name that is present in the story title/script or known entities.
- Game key art, Steam/store assets, trailer frames, screenshots, platform UI and logos outrank people and generic article imagery.
- `images_download.js` now removes hard-rejected images before `downloaded_images` reaches render assembly.
- `images.js`, `images_story.js` and the HyperFrames thumbnail builder now prefer thumbnail-safe subjects.
- `lib/thumbnail-candidate.js` creates a clean 1080x1920 `thumbnail_candidate.png` style frame for each story when the thumbnail batch runs.
- `upload_youtube.js` runs thumbnail QA before calling `youtube.thumbnails.set` and skips unsafe custom thumbnails.

## Limits

This does not identify people. It only detects likely human/profile/stock image types and checks whether supplied metadata matches the story. Pixel-level face detection is intentionally out of scope.

