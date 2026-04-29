# Hermes Sandbox Audit

Date: 2026-04-29
Branch: `codex/hermes-sandbox-quality-routing`
Mode: sandbox, local only

## Safety boundary

This audit was performed without production credentials. No Railway, Cloudflare, OAuth, social posting, production DB writes, environment variable edits or browser-cookie automation were used.

## Project structure

- `run.js`, `server.js`, `publisher.js`: main pipeline entry points, API server and publish orchestration.
- `lib/`: scoring, queue handlers, repositories, media paths, creative QA, Studio render support and operational helpers.
- `channels/`: channel-specific branding, sources, prompts and voice settings.
- `upload_youtube.js`, `upload_tiktok.js`, `upload_instagram.js`, `upload_facebook.js`, `upload_twitter.js`: platform adapters.
- `tools/`: local render, operations, diagnostics, intelligence, Studio, TikTok dispatch and creative tooling.
- `tests/`: Node test runner suites for platform uploaders, queue/scheduler logic, scoring, render QA, analytics and creative tooling.
- `src/`: React/Vite dashboard.
- `test/output/`: local reports, renders and diagnostics. Treat as artefact output, not source of production truth.
- `output/`: generated media in local runs. Production should prefer `MEDIA_ROOT`/`/data/media`.

## Test and build commands

- Targeted tests: `node --test tests/services/<name>.test.js`
- Full test suite: `npm test`
- Dashboard build: `npm run build`
- Studio QA: `npm run studio:v2:qa`, `npm run studio:v2:gauntlet`
- Operational local checks: `npm run ops:system:doctor`, `npm run ops:queue:inspect`, `npm run ops:media:verify`

Railway health scripts exist, including `npm run ops:railway:health`, but were not run in sandbox mode because production inspection was not authorised for this pass.

## Current risks

- Instagram Reel `IN_PROGRESS` timeouts can mean Graph accepted the container but processing outlasted the local poll window. Immediate fallback upload risks duplicate containers.
- Instagram Story can fail independently of Facebook Card even when both use the same local `story_image_path`, because IG requires a public fetch URL and separate Graph media container.
- Facebook Reel is intentionally gated off locally by `FACEBOOK_REELS_ENABLED !== "true"` after prior evidence showed Page-side Reels ineligibility.
- Entertainment-only stories can be high scoring if they come from trusted feeds and have search demand. A Pulse Gaming topicality hard gate is required before render/upload.
- Studio V2 canonical remains the protected render lane. Simple fallback/still-image renders must be exposed in summaries and not mistaken for premium output.
- Local untracked generated assets are present. They should not be deleted or committed without explicit review.

## Safe local improvement opportunities

- Strengthen scoring with Pulse Gaming topicality gates and tests.
- Add typed Instagram pending-processing classification plus delayed-verifier planning.
- Improve Discord summary detail for fallback failures and pending states.
- Generate local reports explaining platform fallback state and render regression risks.
- Add thumbnail and media-inventory QA fixtures without touching production.
- Add read-only diagnostic tools that can later be run by an operator with credentials.

## Files that must not be touched without approval

- `.env`, `.env.*`, `tokens/`, OAuth credential files and any secret-bearing local files.
- Railway, Cloudflare, scheduler and deployment configuration files when the requested task is sandbox-only.
- Production database files or migration scripts that mutate live state.
- Social uploader code paths that would trigger posting during tests or scripts.
- Existing untracked branding/media artefacts unless the task explicitly asks to curate them.
- `main` branch history, deployment settings and live environment variables.

## Sandbox conclusion

The repo has the right building blocks for a serious automated media system, but the current incident class is real: platform fallbacks need more explicit pending/failure states and Pulse Gaming needs a hard brand topicality gate so entertainment-only stories cannot proceed to render or publish.
