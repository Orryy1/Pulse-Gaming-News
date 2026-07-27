# Phase 0 Runtime Provenance Report

> **RED — PROVENANCE MISMATCH.** Time-bounded read-only evidence found different source/runtime positions and more than one automation surface. It does not establish one authoritative runtime owner.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Time-bounded repository, local runtime, public runtime and automation provenance |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `docs/stabilisation/release-slices/01-config-env-runtime-provenance/runtime_provenance_report.md for this source snapshot; the older report remains historical local proof` |
| superseded_by | `none` |
| authoritative | `false` |

After expiry, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Result

| Surface | Read-only observation | Verification boundary |
|---|---|---|
| final release source | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` — `test: align publish summary with canonical brand` | exact local HEAD at final report generation |
| release source during runtime snapshot | `release/pulse-v1` at interim `6aa1f5b80cac78fc6edfdf5d1c738714d5d55d62` | observed locally at approximately 07:31Z |
| separate main checkout | `codex/epidemic-sound-full-integration` at `5dc164dc3469a4bc642fa6ca9498cc296f559198`, 80 dirty entries | observed locally at approximately 07:31Z |
| local listener | PID `34536`, start `2026-07-26 19:59:11` as reported by host, listening on `:3001` | process and health observed; start-time timezone and human owner not independently verified |
| local health | commit `ec2ba4d98d3ee55f8c8999952cde5b378168e0c1`, `schedulerActive=true`, `autonomousMode=true`, dispatch queue/strict | observed read-only |
| public Railway health | commit `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`, deployment `16d8879f-c4ed-4aef-b16c-a5e06aceed43`, `schedulerActive=false`, `autonomousMode=false`, dispatch queue/strict | observed at `2026-07-27T07:31:51Z` |
| public storage indicator | persistent SQLite false / ephemeral | health observation; database contents not inspected |

The release source, separate checkout, local runtime and public runtime do not match. This is a hard release blocker.

## Automation observations

| Task | Observed action and state | Classification |
|---|---|---|
| `Orryy-PulseGaming` | daily 06:00; runs `C:\Claude\orryy-expansion\agents\run_daily.py pulse_gaming`; ready, last result success | research, daily brief and 3–5 script drafts; no direct publishing observed |
| `PulseGaming-GrowthAutopilot` | approximately every 30 minutes; runs `tools/growth-autopilot.js`; ready, last result success | reads database/reports and writes local artefacts; no external publishing observed |
| `PulseGaming-LiveWatchdog-Supervisor` | boot trigger; runs `tools/local-live-watchdog.ps1`; running, last result `267009` | live-publishing-capable; enforces local primary runtime, publish-critical/content workers and tunnel, with `AUTO_PUBLISH=true` and queue mode |
| `PulseGaming-OAuthUptime` | approximately every six hours; runs `tools/oauth-uptime-maintenance.js --refresh`; ready, last result success | token-mutating; `allowTokenMutation=true` and may refresh platform tokens |

The task names, actions and observed states do not establish the human owner, scheduler lease or complete child-process tree. The Sleepy task observed alongside them was outside Pulse Gaming scope.

No task or process was stopped, changed or triggered during this evidence pass.

## Repository evidence

Read-only local commands established source branch, commit, title and dirty state. The final source title and dirty scope are recorded from the final HEAD during report validation.

The repository contains:

| Descriptor | Repository statement | Observed runtime fact |
|---|---|---|
| `railway.json` | Nixpacks build, `node server.js`, `/api/health` | public Railway health exists; actual build descriptor unknown |
| `Dockerfile` | Node 22 image, FFmpeg/yt-dlp/browser dependencies, `node server.js` | use by public service unknown |
| `Procfile` | `web: node server.js` | use by public service unknown |
| `package.json` | `start` ensures FFmpeg then runs `server.js` | local process command not fully verified |
| GitHub Actions | Node 24 release-gate workflow | current run and branch protection unknown |

The public endpoint confirms a Railway deployment exists, but it does not identify which build descriptor produced it. The competing descriptors and Node-version difference remain unresolved.

## Historical evidence handling

The earlier slice report under `docs/stabilisation/release-slices/01-config-env-runtime-provenance/` records local proof at a different source commit. It explicitly does not prove production and was not promoted to current runtime evidence.

No old generated report or pull-request text was treated as runtime evidence.

## Evidence still required

1. authenticated provider project, service and environment identity beyond the health payload
2. public image/build digest and build descriptor
3. full local process command, parent, child tree and intended role
4. scheduler lease owner and runner roles
5. effective non-secret configuration reports
6. production database and volume identity plus integrity
7. an approved reconciliation that leaves one runtime and one scheduler owner
8. an approved deployment that makes source and public runtime equal

Secrets must be redacted or represented only by presence and a non-reversible hash.

## Decision

Runtime parity was assessed and failed. Status is **RED** for provenance mismatch and multiple-owner risk. Production must not be called `GREEN`, current or aligned.
