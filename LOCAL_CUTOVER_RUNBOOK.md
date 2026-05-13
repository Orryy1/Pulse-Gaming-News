# Local Cutover Runbook

Generated: 2026-05-13

Purpose: resume posting from this PC without Railway owning scheduler, queue running or uploads. This is an operator runbook and status record. It does not contain secrets.

## Current Local Primary State

Post-cutover checks on 2026-05-13 showed:

- Local `http://localhost:3001/api/health`: `deployment.mode=local`, `deployment.primary=true`, `runtime.use_job_queue_explicit=true`, `runtime.auto_publish=true`, `schedulerActive=true`.
- Public `https://pulse.orryy.com/api/health`: same local primary response, so Cloudflare currently reaches this PC.
- Railway `https://marvelous-curiosity-production.up.railway.app/api/health`: `deployment.mode=railway`, `deployment.primary=false`, `runtime.use_job_queue_explicit=false`, `runtime.auto_publish=false`, `schedulerActive=false`.
- Local `.env` effective control flags: `DEPLOYMENT_MODE=local`, `PULSE_PRIMARY_INSTANCE=true`, `USE_SQLITE=true`, `USE_JOB_QUEUE=true`, `AUTO_PUBLISH=true`, `REQUIRE_APPROVED_VOICE_FOR_PUBLISH=true`, `TIKTOK_ENABLED=false`, `TIKTOK_AUTO_UPLOAD_ENABLED=false`, `LOCAL_PUBLIC_URL=https://pulse.orryy.com`, `SQLITE_DB_PATH=D:/pulse-data/pulse.db`, `MEDIA_ROOT` set and `PULSE_TOKEN_DIR` set.

This means Railway remains standby and this PC is now the active local publisher. TikTok is intentionally operator-disabled so YouTube, Instagram and Facebook can publish without TikTok keeping stories in partial retry loops.

## Safety Model

Exactly one instance may be primary. During this PC cutover:

- Railway must stay `PULSE_PRIMARY_INSTANCE=false`, `USE_JOB_QUEUE=false`, `AUTO_PUBLISH=false`.
- Local is the only instance allowed to move to `PULSE_PRIMARY_INSTANCE=true`.
- `AUTO_PUBLISH=true` is the live upload gate. Do not set it until platform readiness, queue status and content readiness are acceptable.
- `USE_JOB_QUEUE=true` is required for the canonical queue path. In the current production-like local process, `server.js` resolves dispatch mode to `queue`; `lib/bootstrap-queue.js` then starts both `lib/scheduler.js` and `lib/services/jobs-runner.js` only when `PULSE_PRIMARY_INSTANCE=true`.

## Pre-Cutover Checks

Run these before editing local `.env`:

```powershell
Invoke-RestMethod http://localhost:3001/api/health | Select-Object deployment,runtime,schedulerActive,autonomousMode
Invoke-RestMethod https://pulse.orryy.com/api/health | Select-Object deployment,runtime,schedulerActive,autonomousMode
Invoke-RestMethod https://marvelous-curiosity-production.up.railway.app/api/health | Select-Object deployment,runtime,schedulerActive,autonomousMode
npm run ops:platform-doctor
npm run ops:publish-readiness
npm run ops:queue:inspect
npm run ops:local-primary-readiness
```

Expected before cutover:

- Local and public health both report `mode=local`, `primary=false`, `auto_publish=false`, `schedulerActive=false`.
- Railway health reports `mode=railway`, `primary=false`, `auto_publish=false`, `schedulerActive=false`.
- Platform doctor has no red live-posting blockers for the platforms being enabled.
- Publish readiness is not red.
- Queue inspect has schedules present, no stale claims and no failed-job blocker that would immediately poison a publish window.
- Local primary readiness will remain red until the local primary flags are flipped; use its other checks to confirm public URL, DB, media root and duplicate env-key safety.

## Cutover Sequence

1. Confirm Railway has no active role.
   - Railway env must remain `PULSE_PRIMARY_INSTANCE=false`, `USE_JOB_QUEUE=false`, `AUTO_PUBLISH=false`.
   - Railway `/api/health` must report `deployment.primary=false`, `schedulerActive=false` and `autonomousMode=false`.

2. Confirm the local mirror is healthy through both URLs.
   - `http://localhost:3001/api/health` must be local and non-primary.
   - `https://pulse.orryy.com/api/health` must return the same local response.

3. Edit local `.env` in one controlled change:

```text
PULSE_PRIMARY_INSTANCE=true
USE_JOB_QUEUE=true
AUTO_PUBLISH=true
```

Keep:

```text
DEPLOYMENT_MODE=local
USE_SQLITE=true
LOCAL_PUBLIC_URL=https://pulse.orryy.com
SQLITE_DB_PATH=D:/pulse-data/pulse.db
MEDIA_ROOT=<persistent local media root>
PULSE_TOKEN_DIR=<persistent local token dir>
```

4. Restart the local server.
   - Required. `server.js`, `lib/deployment-mode.js`, `lib/dispatch-mode.js` and `lib/bootstrap-queue.js` read these env flags at process boot.
   - Starting the server is enough. The queue runner is not launched from a separate manual command when using `npm start` or `node server.js`.
   - Expected startup evidence: `scheduler registered ... schedules`, `[jobs-runner] server-... starting`, `[bootstrap-queue] up: scheduler=true runner=true` and `canonical scheduler up via bootstrap-queue`.

5. Re-run post-cutover checks immediately:

```powershell
Invoke-RestMethod http://localhost:3001/api/health | Select-Object deployment,runtime,schedulerActive,autonomousMode
Invoke-RestMethod https://pulse.orryy.com/api/health | Select-Object deployment,runtime,schedulerActive,autonomousMode
Invoke-RestMethod https://marvelous-curiosity-production.up.railway.app/api/health | Select-Object deployment,runtime,schedulerActive,autonomousMode
npm run ops:queue:inspect
npm run ops:platform-doctor
npm run ops:publish-readiness
```

Expected after cutover:

- Local and public health report `deployment.mode=local`, `deployment.primary=true`, `runtime.auto_publish=true`, `runtime.use_job_queue_explicit=true`, `autonomousMode=true` and `schedulerActive=true`.
- Railway still reports `deployment.mode=railway`, `deployment.primary=false`, `runtime.auto_publish=false`, `schedulerActive=false`.
- Queue inspect shows schedules registered and a live worker heartbeat after the local restart.
- Publish readiness remains non-red.

6. Watch the next scheduled queue window instead of manually posting.
   - Do not run `node run.js publish`, `/api/publish` or platform upload tools during the cutover validation window unless the operator separately approves a live post.
   - If a publish window fires, verify one story outcome in platform status and queue inspect before allowing the next window.

## TikTok Disabled Or Dispatch-Only

Current local behaviour: the publisher has an explicit operator-disable gate for TikTok.

Set either of these to disable automatic TikTok attempts:

```text
TIKTOK_ENABLED=false
TIKTOK_AUTO_UPLOAD_ENABLED=false
```

When disabled, `publisher.js` records TikTok as `operator_disabled` and counts YouTube, Instagram and Facebook as the required core completion set. This prevents good posts from retry-looping only because TikTok is blocked.

Safe options:

- For local automatic posting without TikTok, keep `AUTO_PUBLISH=true` and keep `TIKTOK_ENABLED=false` or `TIKTOK_AUTO_UPLOAD_ENABLED=false`.
- For TikTok dispatch-only, leave direct public TikTok approval flags unset, keep `USE_BUFFER_TIKTOK` unset/false and `TIKTOK_BROWSER_FALLBACK` unset/false, then use only operator-approved dispatch tooling such as `npm run tiktok:dispatch`, `npm run tiktok:fresh-pack` or `npm run tiktok:inbox-upload`. The inbox route is manual-completion and reports `public_auto_publish=false`.
- `TIKTOK_PRIVACY_LEVEL=SELF_ONLY` is a private diagnostic workaround, not a true disable switch. It still uploads to TikTok.

Do not remove the TikTok operator-disable flags until the official route is proven again by `npm run ops:platform-doctor` and a controlled dispatch or official API proof.

## Rollback

Fast local rollback:

```text
PULSE_PRIMARY_INSTANCE=false
AUTO_PUBLISH=false
USE_JOB_QUEUE=false
```

Then restart the local server and verify:

- Local/public health: `primary=false`, `auto_publish=false`, `schedulerActive=false`.
- Queue inspect: no active claimed/running jobs from the local worker after shutdown/restart settles.
- Railway health: still `primary=false` unless the operator intentionally restores Railway.

Restore Railway primary only if explicitly approved:

```text
Railway PULSE_PRIMARY_INSTANCE=true
Railway USE_JOB_QUEUE=true
Railway AUTO_PUBLISH=true
```

Then restart Railway and keep local as mirror. Never run both local and Railway with `primary=true`.

## Hard Stops

- Stop if public health does not resolve to `mode=local`.
- Stop if Railway reports `primary=true` or `schedulerActive=true`.
- Stop if queue inspect shows stale claims or terminal failed jobs that affect publish/produce.
- Stop if publish readiness is red.
- Stop if TikTok must be disabled but `AUTO_PUBLISH=true` is the only planned gate.
