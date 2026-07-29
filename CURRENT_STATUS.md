# Pulse Gaming Current Status

> **CUTOVER GREEN THROUGH FINAL REVIEW; LIVE CANARY PENDING.** The previous runtime is contained, production is migrated and reconciled, the exact candidate is human-approved and the stopped replacement checkout matches the green source commit. Scheduler admission, YouTube dispatch and public confirmation have not yet occurred.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T19:08:30.000Z` |
| source_commit_sha | `bc371fb258ecc6312189338e995d1b1270323a0a` |
| runtime_commit_sha | `bc371fb258ecc6312189338e995d1b1270323a0a` |
| environment | `Production SQLite cutover plus a stopped, clean local runtime checkout; authorised database mutations and exact CI evidence are named below` |
| scope | `Pulse v1 cutover status at the committed code boundary; no deployment or publication claim` |
| expires_at | `2026-08-03T19:08:30.000Z` |
| supersedes | `CURRENT_STATUS.md at a2de969d7d6c61e6ccd0a651a219e988d75289e2 and ad hoc status claims for current release decisions` |
| superseded_by | `none` |
| authoritative | `true` |

After `expires_at`, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS** and refresh from the actual target environment.

> **Release attestation:** source/runtime candidate `bc371fb258ecc6312189338e995d1b1270323a0a` passed push run `30296131560` and pull-request run `30296137033`. This documentation-only attestation records the stopped pre-canary state and is not itself deployed code or publication authority.

## Executive status

| Area | Status | Evidence boundary |
|---|---|---|
| Release source | exact candidate green | code/runtime boundary `bc371fb258ecc6312189338e995d1b1270323a0a`; push run `30296131560` and pull-request run `30296137033` succeeded |
| Local legacy runtime | contained | no listener on port `3001`; the old publisher/watchdog process family was stopped |
| Legacy Windows publisher task | disabled | `PulseGaming-LiveWatchdog-Supervisor` is disabled |
| Legacy token-maintenance task | disabled | `PulseGaming-OAuthUptime` is disabled |
| Public custom domain | fail-closed | `https://pulse.orryy.com/api/health` returned HTTP `502`; there is no healthy local origin behind the tunnel |
| Railway | observation-only and divergent | deployment `16d8879f-c4ed-4aef-b16c-a5e06aceed43`, commit `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`, scheduler and autonomous mode inactive; it is not the approved release runtime |
| Production SQLite integrity | cut over and verified | `D:\pulse-data\pulse.db`; migration `023`, `quick_check=ok`, `integrity_check=ok` and zero foreign-key violations |
| Latest verified online backup | complete | post-publication-review backup `D:\pulse-data\backups\pulse_2026-07-27T19-03-39-000Z.db`, SHA-256 `d6fb565c591dc2a68bcfe4d06fdaa22545d9924e460c04b855dc7a0bfcc70bdc`, restore rehearsal passed |
| Restore rehearsal | complete | restored copy and evidence under `D:\pulse-data\restore-rehearsals\pulse_2026-07-27T09-20-24-950Z.restore.db*`; the initial restored hash matched the backup and integrity checks passed |
| Migration rehearsal | complete on restored copy only | migrations `021`, `022` and `023` reached `023` on the rehearsal database with required tables, derivation column, audit idempotency column and index present; integrity checks passed |
| Production migrations | applied | production records migrations `001` through `023`; post-apply checkpoint, backup, restore and integrity evidence passed |
| Publish preflight commands | implemented and exercised read-only | `ops:next-publish-candidates`, `ops:platform-doctor` and `ops:goal-dry-run-publish` exist; evidence is under `D:\pulse-data\cutover-proof\preflight-before-migration` |
| Wider operator command contract | resolved fail-closed, production capability unavailable | all 13 formerly missing names now resolve to a tested inspection-only `LOCAL_PROOF` bridge; each reports `HOLD`, performs no materialisation or repair and grants no publication authority |
| Governed local candidate path | approved through final review | story `official_d86953ca92ca`, script SHA-256 `4f2d9c084d91433d09272a8be718f8d15992224cc3906a8af53747ba7e6a3dcc` and v8 media SHA-256 `d26fb7fa9e55b0059cf028aea777c6a4c713bfaa81847d9125015b2519a9504a` are durably bound; admission and upload remain pending |
| Next-candidate preflight | `HOLD` | scheduler not ready, one owner not proven and candidate render, rights, QA, disclosure and human-review evidence incomplete |
| Platform doctor | policy check `PASS`, publication `NO` | all seven platform rows remained visible, no platform was publishable and no credential value was read; this is not authentication or readiness proof |
| Strict dry-run publish | `HOLD` | package not ready, scheduler not ready, no uploader entered and no external object created |
| Production dependency audit | `HOLD`, risk reduced | exact-lock production findings reduced from 36 to 22: critical `2 → 0`, high `10 → 2`, moderate `23 → 20` and low `1 → 0`; the remaining Hyperframes and Sentry/OpenTelemetry major-version constraints are documented in `docs/dependency-audit.md` |
| Exact two-window reconciler | applied | 140 unsafe jobs quarantined, 31 old schedules disabled and only `publish_morning` at `09:00 UTC` plus `publish_primary` at `19:00 UTC` installed |
| Guarded outside-cadence one-shot | implemented, not exercised | standard cadence remains the default; one exact active authority ID, its matching confirmation and the explicit one-shot boolean are all required in addition to every normal gate, with immutable schedule and audit binding |
| Governed local runtime | exact stopped checkout prepared | credential-bearing checkout is clean and detached at `bc371fb258ecc6312189338e995d1b1270323a0a`; protected local credential files were hash-verified unchanged; safe `HUMAN_REVIEW` rearm remains pending |
| YouTube analytics baseline | `HOLD` | the read-only audit mapped five unique published video IDs to five story rows, but live `yt-analytics.readonly` scope is missing or unrecorded, publish timezone is unresolved and no YouTube Analytics API sample was collected |
| PR 68 | closed as superseded | PR 69 contained all observed PR 68 ancestry and paths: zero unique commits and zero paths absent; closure was not a merge or readiness decision |
| PR 69 | open draft and archived | forensic branch `archive/pr69-forensic-2026-07-27` preserves SHA `cfe609ae1b53b2a13ac1af1ae97ae4a0abb4ac48`; the draft remains open and is not the release candidate |
| Current release CI | green for exact candidate | push run `30296131560` and pull-request run `30296137033` completed successfully |
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

1. admit the exact approved candidate into one immutable outside-cadence YouTube window
2. take a fresh verified backup after admission, then perform one guarded dispatch with no retry after platform-contact ambiguity
3. require `PUBLISHED_CONFIRMED` and independently verify the public YouTube object and exact identity
4. close the armed shell, rearm only the safe `HUMAN_REVIEW` supervisor and prove one healthy owner without enabling secondary platforms
5. keep the 13-command generic bridge inspection-only until specialist repair implementations are separately reviewed
6. complete the governed 12-video sample and the 30-day and 90-day evidence gates without inventing future outcomes

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
