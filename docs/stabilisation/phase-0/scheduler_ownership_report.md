# Phase 0 Scheduler Ownership Report

> **RED — OWNERSHIP NOT ESTABLISHED.** The local health endpoint reports scheduling/autonomy active, one Pulse task is live-publishing-capable and three other Pulse tasks can create content/local state or mutate tokens. Lease ownership remains unverified.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Static scheduler architecture plus bounded read-only runtime and Windows task observations, cadence policy and ownership gaps |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `docs/production-cadence.md for current source-policy status; that file remains historical guidance` |
| superseded_by | `none` |
| authoritative | `false` |

After expiry, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Ownership result

| Fact | Result |
|---|---|
| Canonical scheduler module | `lib/scheduler.js` |
| Canonical bootstrap | `lib/bootstrap-queue.js` |
| Intended production model | SQLite schedules, queued jobs, jobs runner and durable scheduler lease |
| Local scheduler process/PID | local listener PID `34536`; health reports `schedulerActive=true`, but lease ownership is unverified |
| Public scheduler process/PID | public Railway health reports `schedulerActive=false`; process PID not exposed |
| Local process start time | `2026-07-26 19:59:11` as reported by host; timezone not independently verified |
| Current scheduler lease owner | `UNKNOWN / UNVERIFIED` |
| Current lease expiry/heartbeat | `UNKNOWN / UNVERIFIED` |
| Active scheduler profile | `UNKNOWN / UNVERIFIED` |
| Active schedule rows | `UNKNOWN / UNVERIFIED` |
| Windows Scheduled Tasks | four Pulse-named tasks observed and classified below |
| Provider cron or replica count | public scheduler inactive; replica and provider-cron inventory not inspected |

## Observed Windows tasks

| Task | Observed schedule/state | Scheduler relevance |
|---|---|---|
| `Orryy-PulseGaming` | daily 06:00, ready, last result success | produces research/brief/3–5 drafts; no direct publishing observed |
| `PulseGaming-GrowthAutopilot` | approximately every 30 minutes, ready, last result success | reads database/reports and writes local artefacts; no external publishing observed |
| `PulseGaming-LiveWatchdog-Supervisor` | boot trigger, running, last result `267009` | live-publishing-capable; enforces primary runtime, workers/tunnel, `AUTO_PUBLISH=true` and queue mode |
| `PulseGaming-OAuthUptime` | approximately every six hours, ready, last result success | may refresh platform tokens; not a scheduler owner by itself but mutates publishing prerequisites |

No task was stopped, changed or triggered. Task/process human ownership and the scheduler lease remain unverified.

## Intended stabilisation profile

The committed profile name is `stabilisation_30d`. Static source selects:

| Lane | UTC schedule |
|---|---|
| hunt | 06:00, 10:00, 14:00, 17:00 and 22:00 |
| produce | 08:00 and 18:00 |
| guarded YouTube publish | 09:00 and 19:00 |
| analytics | 08:00 and 20:00 |
| database backup | 04:00 |
| stale-job reaper | every minute |
| render-health digest | 09:30 |

Cadence policy is a maximum of two publish windows per rolling 24 hours, a minimum four-hour gap and no catch-up.

This is source policy. Database schedule rows can be stale, overridden or owned by an unexpected process, so the table is not evidence that production follows it.

## Source ownership controls

- `server.js` and `run.js schedule` both can bootstrap scheduler and runner.
- `PULSE_PRIMARY_INSTANCE=false` makes queue bootstrap observation-only.
- production dispatch mode is intended to require the durable queue and refuse legacy fallback.
- scheduler startup attempts to acquire a durable lease and stops tasks when the lease is lost.
- jobs use idempotency templates to avoid duplicate enqueue on restart.
- `schedules` rows determine actual registered cron expressions after bootstrap.

## Residual complexity

Quarantined legacy in-process cron registries remain in both `server.js` and `run.js`. They are intended for explicit local development only when queue mode is disabled. Their presence means a static code inventory alone cannot prove one runtime owner.

Other possible dispatch owners were not fully inspected:

- another Node process on the same machine
- another provider replica or service
- child processes and complete Task Scheduler history
- GitHub workflow dispatch
- external automation service
- manual operator script
- platform-native scheduled content

## Required read-only proof

Capture one time-correlated evidence bundle:

1. all publishing-capable process commands, PIDs, parents and start times
2. provider services, replicas and deployment IDs
3. effective mode, queue, SQLite and primary flags with secrets redacted
4. scheduler lease owner, acquired time, heartbeat and expiry
5. enabled schedule rows and their update times
6. queued/running publish jobs and attempts
7. Windows tasks and external automation inventory
8. next two intended publish windows and cadence counters

Compare the lease owner to the actual process and deployment.

## Acceptance criteria

Scheduler ownership is established only when:

- exactly one intended scheduler holds the lease
- every other capable process is observation-only or absent
- the active profile equals `stabilisation_30d`
- active database rows match the approved profile
- no unexpected publish job exists
- idempotency and cadence counters are current
- evidence identifies commit, PID and start time

## Decision

Single scheduler ownership is not established. The observed local active scheduler and publishing-capable watchdog make the current status **RED / MULTIPLE-OWNER RISK**.
