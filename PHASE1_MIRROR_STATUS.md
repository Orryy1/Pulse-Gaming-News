# Phase 1 Mirror Status

Generated: 2026-05-01 11:31 BST

## Verdict

GREEN for Phase 1 local mirror setup, OAuth re-auth and local-primary cutover. AMBER for publish-readiness advisories that are not cutover blockers.

## Safety checks

Hard local `.env` flags were verified before server start:

- `DEPLOYMENT_MODE`: OK
- `PULSE_PRIMARY_INSTANCE`: OK
- `AUTO_PUBLISH`: OK
- `USE_JOB_QUEUE`: OK

Railway environment variables were changed only during the approved cutover. Railway service was not stopped or paused. No publish, produce, upload retry or production DB mutation was run.

## Local mirror

- Local server: running on `http://localhost:3001`
- Local PID: `62776`
- Local health: OK
- `/api/health` deployment mode: `local`
- `/api/health` primary: `true`
- `/api/health` autonomous mode: `true`
- `/api/health` scheduler active: `true`

Startup log confirms current local primary ownership:

- `scheduler registered 32 schedules`
- `jobs-runner ... starting`
- `Discord bot started`
- `bootstrap-queue up: scheduler=true runner=true`
- `canonical scheduler up via bootstrap-queue`

## Railway

- Public Railway health: OK
- Railway deployment mode: `railway`
- Railway primary: `false`
- Railway scheduler active: `false`
- Railway autonomous mode: `false`
- Railway env switches now set: `PULSE_PRIMARY_INSTANCE=false`, `AUTO_PUBLISH=false`, `USE_JOB_QUEUE=false`
- Railway deployed standby safety code from clean staging deployment `f250669d-c022-43d1-86a3-5151a8beb6bd`.
- Railway remains available as a web/standby service but no longer owns scheduling, queue running, Discord bot or publishing.

## Data and tokens

- Railway SSH key registration completed for the local public key.
- Railway SQLite snapshot copied via a read-only `better-sqlite3` backup from `/data/pulse.db`.
- Local SQLite path: `D:/pulse-data/pulse.db`
- Local DB size: `10297344` bytes
- Local story count: `134`
- Railway persistent token folder copied from `/data/tokens`.
- Local token folder: `D:/pulse-data/tokens`
- Local token files: `1`
- `PULSE_TOKEN_DIR=D:/pulse-data/tokens` is configured so future Facebook/Instagram re-auth writes token files to the persistent local data folder.
- `TIKTOK_REDIRECT_URI` now points at the local public callback.
- Existing local DB/WAL/token state was backed up under `D:/pulse-data/phase1-backups/`.

## OAuth local URL update

- TikTok developer dashboard now includes `https://pulse.orryy.com/auth/tiktok/callback`.
- Meta/Facebook developer dashboard now includes both Railway and local callback URLs.
- Meta/Facebook app domain, privacy, terms and data deletion URLs now point at `pulse.orryy.com`.
- Local `.env` contains `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` without printing the secret.
- Local Facebook OAuth start endpoint was checked: 302 to Facebook, local redirect URI, state present and required scopes present.
- Facebook OAuth re-auth completed through `pulse.orryy.com` with operator approval in browser.
- New Facebook and Instagram token files were written to `D:/pulse-data/tokens`.

## Readiness

`npm run ops:publish-readiness` ran locally against the copied DB and `.env`.

Result: AMBER

Key advisories:

- `queue_health`: unknown / module unavailable
- `render_metadata`: amber
- `tiktok_external_block`: amber
- `facebook_reel_eligibility`: amber
- `recent_failed_candidates`: amber
- `docs_drift`: amber

Important green checks:

- `Stories in DB: 134`
- `railway_deploy`: green
- `media_inventory`: green
- `topicality_gate`: green
- `visual_count_gate`: green
- `thumbnail_safety`: green
- `recent_publish`: green
- `security_blockers`: green

## Cost evidence

The restored Railway invoice and receipt in `C:/Users/MORR/Downloads` were inspected locally:

- Invoice `ZFWE4ORR-0002`: total `$86.38`, applied balance `$5.00`, amount due `$81.38 USD`
- Receipt `2490-8054`: amount paid `$81.38` on 30 April 2026

## Code fixes made during setup

- `server.js` now reports `schedulerActive=false` when `bootstrap-queue` returns observation-only state.
- `server.js` now skips Discord startup notifications and the Discord bot on non-primary mirrors.
- `tools/publish-readiness.js` now loads `.env` for local operator runs.
- Migration files `011` through `013` were restored to their originally applied blobs so the copied Railway DB passes immutable migration checks.
- Bootstrap tests now use isolated temp SQLite DBs instead of the repo-local DB.
- Regression tests were added for scheduler reporting, publish-readiness `.env` loading and non-primary Discord startup safety.
- Facebook/Instagram token-path resolution now honours `PULSE_TOKEN_DIR`, with focused regression coverage.

## Verification

- `node --test tests/services/token-paths.test.js tests/services/public-url-deployment-switch.test.js`: PASS, `6/6`
- `npm test`: PASS, `1418/1418` from earlier Phase 1 verification
- `/api/platforms/status`: YouTube authenticated, TikTok authenticated/token OK, Instagram authenticated
- `npm run build`: PASS
- `npm audit --json`: PASS, `0` vulnerabilities
- `git diff --check`: PASS, CRLF warnings only
- Local `/api/health`: OK, mode `local`, primary `false`, scheduler inactive
- Railway `/api/health`: OK, mode `railway`, primary `true`, scheduler active

## Next action

Phase 1 mirror setup, Facebook/Instagram local re-auth and the primary cutover are complete. Railway is standby. The next cost-saving decision is whether to pause Railway after watching local operation through at least one scheduled window.
