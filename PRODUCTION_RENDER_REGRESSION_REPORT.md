# Production Render Regression Report

Date: 2026-04-29
Mode: sandbox, local diagnosis

## Observed issue

Some live outputs still appear closer to simple still-image videos than the premium Studio V2 clip-first lane. Thumbnail safety has improved, but weak outputs can still pass if upstream topic quality, visual inventory or render-path checks are too permissive.

## Local findings

- `publisher.js::produce()` still runs the legacy image/video assembly path before the Studio thumbnail batch and format recommendation hooks.
- Studio V2 remains available through explicit local scripts, including `studio:v2:qa`, `studio:v2:gauntlet` and related tools.
- Format/media-inventory recommendations are currently warn-only in `publisher.js::logFormatRecommendationsForApprovedStories()`.
- The decision engine now blocks only `reject_visuals` media-inventory class from auto-approval. `blog_only` remains warn-only to avoid silencing the channel.
- Topicality was previously not a hard stop, which let an off-brand entertainment item reach the production path.

## Local changes in this pass

- Added a Pulse Gaming topicality hard gate in scoring.
- Added tests for off-brand entertainment rejection and gaming-topic acceptance.
- Improved Instagram pending/fallback outcome classification so platform routing failures are easier to diagnose.

## Remaining render-quality risk

The render system can still produce a valid MP4 that is strategically weak:

- thin visual inventory can still render as a fallback/simple video;
- `blog_only` items are not hard-blocked yet;
- Studio V2 canonical is protected in experiments, but production publish summaries still need to surface when a non-Studio fallback render was used;
- weak thumbnail or source-mix cases need visible downgrade/reject reporting before upload.

## Recommended next local step

Promote render-path observability before changing the render default:

1. Add a publish/debug field such as `render_lane=studio_v2|legacy|fallback_simple`.
2. Add `render_quality_class=premium|standard|fallback|reject`.
3. Surface both fields in Discord/job summaries.
4. Gate uploads when a story expected Studio V2 but only has fallback/simple render output.
5. Keep Studio V2 canonical as default only after a real side-by-side metric check passes.

## Promotion note

Do not replace canonical render from this report alone. The local fixes reduce off-brand and platform-state ambiguity, but they do not prove a stronger visual render. Canonical Studio V2 remains the protected premium baseline.
