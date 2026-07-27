# Pulse Gaming Current Status

> **NOT PRODUCTION GREEN.** The previous local publishing runtime is contained and the release line now has fail-closed cutover tools, but no governed replacement runtime is installed, no current release is serving the public domain and no publication candidate is authorised.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T10:27:10.000Z` |
| source_commit_sha | `a2de969d7d6c61e6ccd0a651a219e988d75289e2` |
| runtime_commit_sha | `NONE - old local origin contained; Railway observation-only runtime remains at 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only Windows task, local port, production SQLite, public endpoint, Railway and GitHub observations; authorised containment and backup actions are named below` |
| scope | `Pulse v1 cutover status at the committed code boundary; no deployment or publication claim` |
| expires_at | `2026-08-03T10:27:10.000Z` |
| supersedes | `CURRENT_STATUS.md at ed2745dd2cbeeb179ab54d47b8d380304baaf9e5 and ad hoc status claims for current release decisions` |
| superseded_by | `none` |
| authoritative | `true` |

After `expires_at`, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS** and refresh from the actual target environment.

> **Restamp required:** `source_commit_sha`, `generated_at` and `expires_at` above still attest the previous committed snapshot. The governed local-candidate changes described below are working-branch source evidence only until this document is restamped to the exact final commit and that commit's CI result.

## Executive status

| Area | Status | Evidence boundary |
|---|---|---|
| Release source | committed | branch `release/pulse-v1`, code boundary `a2de969d7d6c61e6ccd0a651a219e988d75289e2` |
| Local legacy runtime | contained | no listener on port `3001`; the old publisher/watchdog process family was stopped |
| Legacy Windows publisher task | disabled | `PulseGaming-LiveWatchdog-Supervisor` is disabled |
| Legacy token-maintenance task | disabled | `PulseGaming-OAuthUptime` is disabled |
| Public custom domain | fail-closed | `https://pulse.orryy.com/api/health` returned HTTP `502`; there is no healthy local origin behind the tunnel |
| Railway | observation-only and divergent | deployment `16d8879f-c4ed-4aef-b16c-a5e06aceed43`, commit `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`, scheduler and autonomous mode inactive; it is not the approved release runtime |
| Production SQLite integrity | inspected read-only | `D:\pulse-data\pulse.db`; `quick_check=ok`, `integrity_check=ok`, zero foreign-key violations and latest applied migration `020` |
| Verified online backup | complete | `D:\pulse-data\backups\pulse_2026-07-27T09-20-24-950Z.db`, 232,570,880 bytes, SHA-256 `086f765148e4a74765a05b4beb2a55f4605a5aac7dd2a9ca6a742782a8dfaf41` |
| Restore rehearsal | complete | restored copy and evidence under `D:\pulse-data\restore-rehearsals\pulse_2026-07-27T09-20-24-950Z.restore.db*`; the initial restored hash matched the backup and integrity checks passed |
| Migration rehearsal | complete on restored copy only | migrations `021`, `022` and `023` reached `023` on the rehearsal database with required tables, derivation column, audit idempotency column and index present; integrity checks passed |
| Production migrations | pending | production remains at `020`; migrations `021` through `023` have not been applied to `D:\pulse-data\pulse.db` |
| Publish preflight commands | implemented and exercised read-only | `ops:next-publish-candidates`, `ops:platform-doctor` and `ops:goal-dry-run-publish` exist; evidence is under `D:\pulse-data\cutover-proof\preflight-before-migration` |
| Wider operator command contract | resolved fail-closed, production capability unavailable | all 13 formerly missing names now resolve to a tested inspection-only `LOCAL_PROOF` bridge; each reports `HOLD`, performs no materialisation or repair and grants no publication authority |
| Governed local candidate path | implemented in the working release line, candidate still `HOLD` | exact official story intake, owned motion, governed narration evidence, HyperFrames material, final local composite, publication evidence/review and one-window YouTube controls have dedicated entry points; this does not prove final hashes, human approval, scheduler admission, deployment or publication |
| Next-candidate preflight | `HOLD` | scheduler not ready, one owner not proven and candidate render, rights, QA, disclosure and human-review evidence incomplete |
| Platform doctor | policy check `PASS`, publication `NO` | all seven platform rows remained visible, no platform was publishable and no credential value was read; this is not authentication or readiness proof |
| Strict dry-run publish | `HOLD` | package not ready, scheduler not ready, no uploader entered and no external object created |
| Production dependency audit | `HOLD`, risk reduced | exact-lock production findings reduced from 36 to 22: critical `2 → 0`, high `10 → 2`, moderate `23 → 20` and low `1 → 0`; the remaining Hyperframes and Sentry/OpenTelemetry major-version constraints are documented in `docs/dependency-audit.md` |
| Exact two-window reconciler | implemented, not applied | `tools/stabilisation-cutover-reconcile.js` plans YouTube-only `publish_morning` at `09:00 UTC` and `publish_primary` at `19:00 UTC`, quarantines unsafe debt and is dry-run by default |
| Guarded outside-cadence one-shot | implemented, not exercised | standard cadence remains the default; one exact active authority ID, its matching confirmation and the explicit one-shot boolean are all required in addition to every normal gate, with immutable schedule and audit binding |
| Governed Windows supervisor | implemented, not installed | `ops:windows-local-runtime` enforces a clean exact commit, `HUMAN_REVIEW`, YouTube-only policy, kill switches tripped and both publish arms off; `PulseGaming-Stabilisation-Runtime` does not exist |
| YouTube analytics baseline | `HOLD` | the read-only audit mapped five unique published video IDs to five story rows, but live `yt-analytics.readonly` scope is missing or unrecorded, publish timezone is unresolved and no YouTube Analytics API sample was collected |
| PR 68 | closed as superseded | PR 69 contained all observed PR 68 ancestry and paths: zero unique commits and zero paths absent; closure was not a merge or readiness decision |
| PR 69 | open draft and archived | forensic branch `archive/pr69-forensic-2026-07-27` preserves SHA `cfe609ae1b53b2a13ac1af1ae97ae4a0abb4ac48`; the draft remains open and is not the release candidate |
| Current release CI and branch protection | not established by this snapshot | no `GREEN` claim |
| Live upload | none performed by this cutover | no public upload or multi-platform post claim |
| Controlled evidence programme | not started | the governed 12-video sample and 30-day and 90-day evidence gates remain future, time-bound work |

## What the committed release establishes

- `LOCAL_PROOF`, `DRY_RUN_PUBLISH`, `HUMAN_REVIEW` and `LIVE_GUARDED` boundaries fail closed.
- YouTube is the only primary human-reviewed stabilisation lane. Instagram, Facebook, TikTok, X, Threads and Pinterest remain disabled, frozen or manual.
- The three documented preflight commands now resolve to tested tools and generate machine-readable JSON plus readable Markdown.
- The 13 formerly missing render, platform-pack and repair command names now resolve to a tested `LOCAL_PROOF` bridge. It inspects named local inputs, reports `HOLD` and refuses apply, publish, live and OAuth/token flags; the production implementations are still unavailable.
- A separate governed local-candidate lane binds official intake, owned motion, narration, final composition, publication evidence, review and guarded YouTube window controls. Local Evercold materials exist, but no final media hash or human-review decision is authorised by this status snapshot.
- The cutover reconciler is read-only by default and requires an exact database, source/runtime commit parity, verified backup evidence, explicit `HUMAN_REVIEW` authority and matching confirmation before it can mutate state.
- The Windows supervisor refuses dirty or mismatched source, pending or mismatched migrations, foreign port ownership and unsafe runtime configuration.
- Migrations `001` through `023` are tracked. Migration `020` preserves its deployed checksum and migration `023` carries the later governance hardening.
- The renderer, rights, originality, disclosure, QA and human-review gates remain mandatory for every candidate.
- A release-gate workflow exists in `.github/workflows/pulse-release.yml`.

These are source and local-proof facts. They do not prove that production has deployed or exercised the release.

## Operator command bridge boundary

The three publication preflight commands are implemented. These 13 wider `AGENTS.md` command names also now have matching npm scripts and a shared, tested entry point:

- `ops:bridge-live-rights-repair`
- `ops:bridge-preflight-stamp-repair`
- `ops:goal-audio-materialize`
- `ops:goal-audio-timestamps`
- `ops:goal-owned-motion`
- `ops:goal-platform-duration-contract`
- `ops:goal-platform-native-repair`
- `ops:goal-platform-variants`
- `ops:goal-production-render`
- `ops:goal-render-inputs`
- `ops:pipeline-backlog`
- `ops:v4-motion-pack`
- `ops:v4-source-family-acquisition`

The bridge is deliberately inspection-only. It writes JSON and Markdown evidence, returns readiness `HOLD`, performs no materialisation or repair and makes no external call, production database mutation, OAuth/token mutation or publication attempt. The specialist production materialisers, media graphs and database-repair implementations were not ported into this reviewed release slice. Do not interpret command resolution or `execution_status: COMPLETE` as capability, candidate readiness or publication authority.

The governed local-candidate commands are not implementations of those 13 generic repair aliases. They are a narrow, hash-bound path for one exact candidate and remain subject to final artefact verification, exact human review, production preflight, admission and dispatch controls.

## Remaining cutover blockers

1. keep the 13-command generic bridge inspection-only; its specialist repair capabilities remain unavailable and must be implemented and reviewed before any operator relies on those repair aliases
2. obtain current CI evidence for the exact release candidate and establish the required GitHub release check
3. apply migrations `021` through `023` to the named production database only under an approved change window, then repeat integrity and application checks
4. generate the reconciler's required cutover backup-evidence record, run its dry-run plan and apply only after every blocker is clear
5. create a dedicated clean runtime checkout at the exact approved commit
6. install and start the governed Windows supervisor, then prove exact commit health, one scheduler owner and one healthy primary lease
7. keep the public custom domain fail-closed until that exact runtime passes health and ownership verification
8. reauthorise YouTube with the required read-only Analytics scope, resolve publication timezone provenance and collect a five-video API sample without changing platform objects
9. finish and independently verify the current governed Evercold candidate's final MP4, rights ledger, transformation evidence, QA, disclosure and exact human approval, then bind every hash to the release commit
10. confirm the first approved YouTube canary end to end before expanding cadence
11. complete the governed 12-video sample and the 30-day and 90-day evidence gates without inventing future outcomes
12. remove, replace or separately review the residual Hyperframes dependency risk and validate the Sentry 10 major upgrade before treating the production dependency audit as green

## Release posture

- Do not restart the legacy watchdog, publisher or token-maintenance tasks.
- Do not treat the Railway observation runtime as the release target.
- Do not apply production migrations or queue reconciliation from a dirty or unreviewed checkout.
- Do not install the replacement supervisor until the production schema equals the exact source migration set.
- Do not interpret `platform-doctor` policy `PASS` as platform authentication or publish authority.
- Do not publish a held candidate or use a dry-run package as permission.
- Keep the kill switch tripped and secondary-platform automation off through stabilisation.

## Evidence and operator references

- [Governed Windows local runtime cutover](docs/stabilisation/windows-local-runtime-cutover.md)
- [Deployment runbook](DEPLOYMENT_RUNBOOK.md)
- [Operating modes](OPERATING_MODES.md)
- [Platform matrix](PLATFORM_MATRIX.md)
- [Incident runbook](INCIDENT_RUNBOOK.md)

The files under `docs/stabilisation/phase-0/` and `docs/stabilisation/release-slices/` remain valuable forensic and design evidence, but their old timestamps and source boundaries are historical. They do not override this canonical snapshot.
