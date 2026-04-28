# Pulse Enterprise Readiness Recheck

Generated: 2026-04-28

Branch: `codex/pulse-enterprise-hardening`

## Safety

No deploy, merge, OAuth flow, platform post, production produce/publish job, Railway mutation, env mutation or production DB mutation was performed.

Read-only production inspection was limited to public health/Railway health tooling.

## Validation Run

- `npm test`: pass, 904/904.
- `npm run build`: pass.
- `npm audit --json`: pass, 0 vulnerabilities.
- `npm run quality:test`: pass, 3/3 render pairs succeeded.
- `npm run ops:railway:health`: review, 0 hard fails, 1 warning.
- `npm run ops:system:doctor`: review, Railway CLI unavailable locally.
- `npm run ops:queue:inspect`: skip, local `USE_SQLITE` not enabled.
- `npm run ops:media:verify`: pass, 0 issues.
- `npm run ops:db:backup-dry-run`: pass, no mutation.
- `npm run ops:platform:status`: pass, 10 local stories inspected.
- `npm run media:inventory`: pass, 1 `short_only`, 9 `blog_only`.
- `npm run tiktok:dispatch`: pass, dispatch manifest, queue and Discord sample written.
- `npm run tiktok:diagnose403`: pass, official TikTok blocker remains unaudited-app/public-posting.
- `npm run performance:digest`: pass, fixture/local-report digest only.
- `npm run comments:digest`: pass, draft-only reply queue.
- `npm run format:release-radar`: pass, blocked on insufficient verified candidates.
- `npm run studio:v2:gauntlet`: fail, canonical remains best but historical candidates fail.
- `npm run studio:v2:channel-readiness`: warn, 0/3 current channel renders release-ready.
- `npm run studio:v2:dossier`: warn/fail mix, canonical still protected.

## Fix Applied During Recheck

`ops:railway:health` previously treated production/local commit mismatch as a hard failure by default. That is wrong for read-only inspection on an experimental branch. It now only enforces local-commit parity when:

- `RAILWAY_EXPECTED_COMMIT` is set, or
- `RAILWAY_HEALTH_EXPECT_LOCAL_COMMIT=true` is set.

Default read-only mode now reports production health without falsely failing because the local branch is intentionally ahead.

## Hard Truth

Pulse is not enterprise-grade yet.

It is much more observable and safer to operate locally, but these blockers remain:

- Studio V2 channel variants are not release-ready.
- The Studio gauntlet still contains historical failures.
- Local queue inspection does not prove live production queue rows in this pass.
- TikTok official public posting remains externally blocked.
- Performance Intelligence and Comment Copilot are not connected to real read-only YouTube data here.
- Media inventory is too thin for premium renders on most current stories.
- There are unrelated untracked local assets and scratch files that must not be blindly staged.

## Best Next Move

Do not broaden render effects. Build the media inventory acquisition loop for official trailer clips, store assets and source diversity, then use the inventory gate to decide whether a story deserves premium video, short-only treatment, briefing inclusion, blog-only treatment or rejection.

