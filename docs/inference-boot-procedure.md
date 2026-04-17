# Inference Boot & Stability Procedure

Scope: the local VoxCPM 2 inference service (`tts_server/`) and the Node-side client that feeds it (`lib/inference-client.js`). This doc pairs with the Phase F stability patch on `hardening/cutover`.

## What failed

Five GPU derivative jobs (ids 23, 26-29) got stuck between 2026-04-16 22:22 UTC and 22:33 UTC. Symptoms:

- Job 23 (`derivative_teaser_short`): `attempt_count=2` → `3`, all retries aborted with `This operation was aborted`. Ended orphaned: `status=running`, `claimed_by=server-DESKTOP-D3EI9PV-5388`, `lease_until=NULL`.
- Jobs 26-29 (`derivative_story_short`): retried 3x each, failed with `fetch failed`, exhausted `max_attempts=3`.
- Background services (uvicorn + Node server) died silently ~22:33 UTC and stayed dead for 8 hours.

## Why it failed

Three compounding root causes:

1. **Client timeout shorter than server cold-start.** `INFER_TIMEOUT_MS` defaulted to 180000 (3 min). A first `_get_engine('__default__')` load on VoxCPM 2 takes 2-5 minutes on a Windows box with cached HuggingFace weights, and considerably longer on a cold cache. Every `narrate_script` call on a fresh engine blew past 180s; the Node `AbortController` fired; the runner flagged the job failed with a generic `This operation was aborted` string.
2. **Reaper blind to null-lease orphans.** `lib/repositories/jobs.js::reapStaleClaims` had `AND lease_until IS NOT NULL` in its WHERE clause. Job 23 somehow lost its lease while still flagged `running`, so the reaper never touched it. The row stayed `running` forever, blocking retries and leaving a stale `claimed_by` pointing at a dead process.
3. **No prewarm path.** The only way to load the engine was through a real job. Every cold-start penalty was paid inside the runner's retry budget instead of outside it.

## What changed in the stability patch

### `lib/inference-client.js`

- `DEFAULT_TIMEOUT_MS` raised from 180_000 to 600_000 (cold-start-safe for VoxCPM 2 on cached weights).
- `INFER_WARM_TIMEOUT_MS` added (default 120_000) for post-prewarm callers.
- `InferTimeoutError` class — timeouts are now classified so the runner's log is explicit about "cold boot" vs "service returned 500".
- `prewarm(voiceId, ...)` helper — POSTs to `/v1/prewarm` outside the normal job path.
- Error messages now include `kind=`, `job=`, and `elapsed_ms=` inline.

### `lib/repositories/jobs.js`

- `reapStaleClaims` now reaps two classes of orphan:
  - Expired lease (original behaviour).
  - `lease_until IS NULL` AND `claimed_at` older than `JOBS_ORPHAN_GRACE_MIN` minutes (default 10). This is the fix for job 23's state.
- `listOrphanClaims()` added for non-destructive inspection during incident response.
- `DEFAULT_ORPHAN_GRACE_MIN` exported so ops scripts can override the window.

### `tts_server/server.py`

- `POST /v1/prewarm` endpoint accepts `{ voice_id }` and loads the engine, returning `{ voice_id, loaded_ms, engine_count, reused }`.
- `PREWARM_ON_BOOT=true` env toggle warms the default engine during uvicorn startup.
- `PREWARM_VOICE_ID` env picks which voice to warm (default `__default__`).
- `_get_engine` now logs `[engine] COLD_START` and `[engine] LOADED elapsed_ms=<N>` around every load.
- `/health` unchanged — it must stay fast (5s caller timeout).
- App version bumped to 1.2.0.

### `tts_server/infer_service.py`

- `run(kind, params, job_id)` wraps every handler with `[infer] TIMING phase=total elapsed_ms=<N>` logs.
- `narrate_script` emits per-segment `phase=synth` timings + a `phase=concat` roll-up.
- `compose_short` emits `phase=render` timing with the ffmpeg duration.

### `scripts/prewarm-infer.ps1`

PowerShell helper that health-probes, then POSTs to `/v1/prewarm`, then reports wall-clock elapsed. Used for manual prewarms during ops, and as the canonical documented prewarm recipe.

## Expected boot sequence

Production or local equivalent:

1. **Start uvicorn with prewarm on:**

   ```
   cd tts_server
   PREWARM_ON_BOOT=true .\venv\Scripts\uvicorn.exe server:app --host 127.0.0.1 --port 8765
   ```

   Watch for:
   - `[boot] pulse-gaming tts_server starting ts=... prewarm_on_boot=true`
   - `[boot] prewarming voice_id=__default__`
   - `[engine] COLD_START voice_id='__default__' ...`
   - `Running on device: cuda, dtype: bfloat16`
   - `[engine] LOADED voice_id=__default__ elapsed_ms=<N>` (expected 120000-300000)
   - `[boot] prewarm complete voice_id=__default__ elapsed_ms=<N> engine_count=1`
   - `INFO: Uvicorn running on http://127.0.0.1:8765`

2. **Verify health:**

   ```
   curl http://127.0.0.1:8765/health
   ```

   Expect `engine_count: 1` (or more) with no `loaded: false` for your target voice_id.

3. **Manual prewarm (skip if PREWARM_ON_BOOT already ran):**

   ```
   pwsh scripts/prewarm-infer.ps1 -VoiceId "__default__"
   ```

   First call: 2-5 min. Subsequent: `reused: true`, sub-second.

4. **Start Node server:**

   ```
   USE_SQLITE=true USE_JOB_QUEUE=true node server.js
   ```

   Watch for:
   - `[bootstrap-queue] up: scheduler=true runner=true worker=server-<host>-<pid>`
   - `[scheduler] registered <N> schedules`

5. **Confirm runner is claiming:**
   ```
   curl http://127.0.0.1:3001/api/queue/stats -H "Authorization: Bearer <API_TOKEN>"
   ```
   Inspect `jobs.by_status`.

## Voices.json gap (known)

`ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb` in `.env` is NOT mapped in `tts_server/voices.json`. Every narrate call for that voice ends up loading the `__default__` engine (env fallback). This means:

- Paying the cold-start cost twice if your prewarm warmed a different voice.
- Losing per-voice base_speed configuration.

**Fix path:** either add the mapping to `voices.json` with a `ref_voice_path` pointing at the right clone ref, or make `PREWARM_VOICE_ID` match `ELEVENLABS_VOICE_ID`. The second is cheaper but coupled to the env var.

## What remains risky

- **Safetensors-load deadlock (observed 2026-04-17 07:05 UTC).** After the eager-prewarm fix (commit `f76d1a5`), a clean uvicorn boot on the dev box (cached weights, GPU idle at launch) hung at `Loading model from safetensors:` with GPU util dropping from 100% → 0% and VRAM pinned at ~20.7 GB with zero log progress for 25+ minutes. No traceback, no error, no crash. Suspected deadlock inside VoxCPM's AudioVAE → safetensors loader path on Python 3.11 + torch weight-norm deprecation. Repro requires a cold process restart; second attempt often passes because the filesystem/OS pagecache is warm. **Mitigation before flipping PREWARM_ON_BOOT=true in prod:** wrap the engine load in a hard watchdog timer (e.g. 420s) that raises and logs `PREWARM_WATCHDOG_EXPIRED` so uvicorn at least moves to serving /health and the next PREWARM_ON_BOOT attempt has a chance to win. **Do not kill the hung uvicorn blindly during incident response** — capture a py-spy dump first (`py-spy dump --pid <pid>`) so we can diagnose the actual stall point.
- **Machine sleep.** Windows idle sleep will suspend uvicorn and the Node server. The Phase F work has a `lib/power-gate.js` module but UNVERIFIED whether it's wired into the worker. Track via Phase G tests.
- **Second-voice cold-start.** If a narrate call comes in for a voice other than the prewarmed one, we pay cold-start again on that call. Mitigation: warm every voice in `voices.json` at boot via a loop in the startup event, gated on a `PREWARM_ALL_VOICES` env flag (not yet implemented).
- **Cold HuggingFace cache.** A brand-new environment (new machine, CI runner, fresh Docker image) has no cached weights and the first prewarm can be 10+ minutes. Raise `-TimeoutSec` on the prewarm script and raise `INFER_TIMEOUT_MS` during the first boot, then drop back.
- **Silent process death.** The background uvicorn + Node processes died between 22:33 and 06:26 UTC on 2026-04-16 with nothing in the log. Likely machine sleep or parent shell closed. Phase G: add a heartbeat monitor that alerts when either process stops logging for >5 min.
- **attempt_count budget.** `max_attempts=3` is the default for new jobs. A single bad cold-boot burns the whole retry budget in 9 minutes. Consider raising the default to 5 for GPU kinds, or making the backoff floor long enough that 3 retries can't all happen inside a cold-boot window.

## Incident-response checklist

When the same failure class recurs:

1. `curl /health` — is uvicorn alive? If no, restart it with PREWARM_ON_BOOT=true.
2. `curl /api/queue/stats` — is the Node runner alive? If no, restart `node server.js`.
3. Check for orphans: `node -e "const r = require('./lib/repositories').getRepos(); console.log(r.jobs.listOrphanClaims())"` — prints what the next reap would reclaim.
4. Run the reap: `node -e "const r = require('./lib/repositories').getRepos(); console.log('reaped:', r.jobs.reapStaleClaims())"`.
5. Grep `tts_server/server.log` for `[engine] LOADED` lines to confirm which voices are resident.
6. If a specific job is stuck, look it up by id and confirm `attempt_count < max_attempts` before resetting `status='pending'`.

## Feature flags touched

| Flag                    | Default                 | Effect                                     |
| ----------------------- | ----------------------- | ------------------------------------------ |
| `INFER_TIMEOUT_MS`      | 600000                  | Cold-start-safe client timeout             |
| `INFER_WARM_TIMEOUT_MS` | 120000                  | Post-prewarm callers                       |
| `INFER_BASE_URL`        | `http://127.0.0.1:8765` | tts_server address                         |
| `JOBS_ORPHAN_GRACE_MIN` | 10                      | Reap null-lease claims older than this     |
| `PREWARM_ON_BOOT`       | `false`                 | Load default engine during uvicorn startup |
| `PREWARM_VOICE_ID`      | `__default__`           | Which voice the boot prewarm loads         |
