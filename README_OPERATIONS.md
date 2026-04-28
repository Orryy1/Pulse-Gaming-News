# Pulse Operations

## Daily Health Check

Run these locally:

```bash
npm run ops:system:doctor
npm run ops:media:verify
npm run ops:platform:status
npm run ops:db:backup-dry-run
npm run studio:v2:dossier
```

Optional when local SQLite is enabled:

```bash
USE_SQLITE=true npm run ops:queue:inspect
```

Read `test/output/system_doctor.md` first. It should tell an operator in under two minutes whether production health is reachable, the deployed commit is visible and local tooling is available.

## Safe Local Commands

- `npm test`
- `npm run build`
- `npm audit --json`
- `npm run performance:digest`
- `npm run comments:digest`
- `npm run tiktok:dispatch`
- `npm run tiktok:diagnose403`
- `npm run media:inventory`

## Commands Requiring Explicit Approval

- Any deploy command
- Any merge to `main`
- Any OAuth command
- Any production publish or produce job
- Any Railway variable or volume mutation
- Any cleanup against live media
- Any YouTube comment reply, like, heart or moderation action

## How To Know What Is Live

Compare:

- Public health deployed commit
- Local `git rev-parse HEAD`
- `test/output/system_doctor.md`
- Railway dashboard if read-only access is available

Production currently reports deployed commit `36bdbf0`. Local work on `codex/pulse-enterprise-hardening` is not live.

## Before Any Promotion

Run:

```bash
npm test
npm run build
npm audit --json
npm run ops:system:doctor
npm run ops:media:verify
npm run ops:platform:status
npm run studio:v2:dossier
```

Then review `STUDIO_CANONICAL_PROTECTION.md` and `EXPERIMENT_PROMOTION_RULES.md`.

