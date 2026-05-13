# Pulse Gaming Security Hardening Audit - 2026-05-13

## Summary

This pass converted the "vibe coded app" checklist into concrete Pulse controls.
The changes are safe, local code hardening only: no Railway env changes, no OAuth,
no production DB mutation, no social posting and no renderer switch.

## Fixed In This Pass

1. **Public route rate limiting**
   - Added named rate limits for public API reads, media downloads and Railway webhook intake.
   - Covered:
     - `/api/news`
     - `/api/story-image/:id`
     - `/api/download/:id`
     - `/api/webhook/railway`

2. **Dashboard token persistence**
   - React dashboard token storage moved from persistent `localStorage` to `sessionStorage`.
   - Legacy `localStorage` dashboard tokens are removed on load/clear.
   - The inline legacy dashboard in `public/index.html` now follows the same rule.

3. **Input validation for mutating routes**
   - Added a shared bounded story-id validator.
   - Mutating story routes now reject invalid ids before touching local story state.
   - Stats updates now reject invalid negative/non-integer counters.
   - Schedule updates now validate date-shaped values before writing state.

4. **Railway webhook hardening**
   - Added an optional shared-secret guard with `RAILWAY_WEBHOOK_SECRET`.
   - Existing behaviour remains unchanged unless that env var is set.
   - If enabled, webhook calls must provide `x-pulse-webhook-secret` or a Bearer token.

5. **Dashboard crash recovery**
   - Added a React app-level error boundary.
   - A component render crash now shows a recovery screen instead of a blank dashboard.
   - Error logging is structural and intentionally does not include tokens or secrets.

## Existing Controls Confirmed

| Risk | Current Pulse State |
| --- | --- |
| Hardcoded frontend API keys | No frontend key/secret literals found in `src` or `public`. |
| No CORS policy | `server.js` has an explicit allow-list via `ALLOWED_ORIGINS` or known local/Railway origins. |
| No health check | `/api/health` exists and has tests for public metadata redaction. |
| No logging | Sentry is initialised and operational tooling writes structured diagnostics/reports. |
| No database indexing | SQLite migrations include indexes for stories, jobs, workers, posts, analytics, media provenance and scoring. |
| No backup strategy | Daily DB backup exists, plus `ops:db:backup-dry-run`. |
| Password reset links | Not applicable: Pulse has no public user-account/password-reset flow. |
| Stripe webhook verification | Not applicable in this repo path: no Stripe webhook handler is present. |
| Email in request handlers | Not applicable: no SMTP/nodemailer request path is present. |
| DB connection pooling | Not applicable to the current local SQLite/better-sqlite3 architecture. |
| Direct image uploads | No public user upload route was found; media acquisition is server-side pipeline work. |

## Still Needs Future Architecture Work

These are not ignored, but they are bigger changes than a safe hardening patch.

- **Pagination:** some internal/operator story reads still fetch whole local story lists. This is acceptable at the current scale but should become paginated before a public multi-user dashboard.
- **Role-based admin model:** Pulse is currently single-operator token auth, not multi-user RBAC. That is fine for now, but a public SaaS/control-room product would need users, roles, token expiry and audit trails.
- **Backend TypeScript:** the frontend is TypeScript, but much of the backend is CommonJS JavaScript. Conversion should be staged module-by-module with tests, not rushed.
- **Central env schema:** production already fails closed when `API_TOKEN` is missing. A fuller typed env schema would make platform setup safer, especially for local/Railway switching.
- **Webhook secret rollout:** `RAILWAY_WEBHOOK_SECRET` support is implemented, but setting it live is an environment change and should be queued separately.

## Validation

Focused regression command:

```text
node --test tests/services/dashboard-auth.test.js tests/services/legacy-dashboard.test.js tests/services/frontend-error-boundary.test.js tests/services/public-route-rate-limits.test.js tests/services/server-input-validation.test.js tests/services/ingrid-publish-fixes.test.js tests/services/artefact-routes.test.js
```

Result:

```text
77 tests passed
0 failed
```

## Files Changed

- `server.js`
- `src/api/auth.ts`
- `src/main.tsx`
- `src/App.tsx`
- `src/components/AppErrorBoundary.tsx`
- `public/index.html`
- `tests/services/dashboard-auth.test.js`
- `tests/services/legacy-dashboard.test.js`
- `tests/services/frontend-error-boundary.test.js`
- `tests/services/public-route-rate-limits.test.js`
- `tests/services/server-input-validation.test.js`
- `tests/services/ingrid-publish-fixes.test.js`

## Deployment Safety

This is safe to merge as code hardening. It does not:

- change posting behaviour;
- mutate production DB rows;
- alter Railway variables;
- trigger OAuth;
- change scheduler frequency;
- switch Studio V2 into production;
- enable any new hard content gate.

The only operator-facing change is that dashboard API tokens no longer survive a browser session. That is intentional.
