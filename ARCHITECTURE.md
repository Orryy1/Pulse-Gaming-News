# Pulse Gaming Architecture

> **Authority boundary:** Canonical source architecture at the recorded commit. A partial read-only runtime snapshot exists, but exact deployment equality and single-owner topology are not established.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Canonical component, data-flow, lifecycle and ownership boundaries |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `PULSE_SYSTEM_MAP.md and STUDIO_V2_ARCHITECTURE.md for current architectural guidance; historical files remain available` |
| superseded_by | `none` |
| authoritative | `true` |

If expired, mark this document **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS** until refreshed.

## System boundary

Pulse Gaming has six logical planes:

1. **Discovery and editorial** — source ingestion, verification, scoring, scripting and human editorial decisions.
2. **Media production** — narration, cleared asset acquisition, motion composition, audio mastering and final render.
3. **Governance** — operating-mode checks, rights evidence, renderer evidence, human approval, idempotency and lifecycle transitions.
4. **Scheduling and execution** — durable schedules, queued jobs, workers, leases and cadence limits.
5. **Platform projection** — guarded platform adapters, confirmation, reconciliation and analytics collection.
6. **Operator control** — Express API, React dashboard, diagnostics, evidence reports and incident controls.

```text
verified sources
      |
      v
story record -> editorial decision -> script -> cleared assets
      |                                      |
      +----------------------+---------------+
                             v
                governed renderer manifest
                             |
                             v
                  QA + human approval
                             |
                             v
        durable schedule -> idempotent dispatch -> platform
                             |                       |
                             +---- reconciliation ---+
                                                     |
                                                     v
                                               analytics evidence
```

## Committed component map

| Component | Source location | Contract |
|---|---|---|
| HTTP and dashboard process | `server.js` | Serves APIs and UI, validates runtime configuration and bootstraps scheduler/runner according to configuration |
| Operator runner | `run.js` | Provides hunt, approve, produce, publish, full and schedule modes; the existence of a mode is not live authority |
| Durable scheduler | `lib/scheduler.js` | Loads enabled SQLite schedules, enforces a stabilisation profile, acquires a scheduler lease and enqueues idempotent jobs |
| Queue bootstrap | `lib/bootstrap-queue.js` | Starts scheduler and worker roles only when SQLite and primary-instance rules permit |
| Production orchestration | `publisher.js`, `processor.js` | Builds governed publication inputs and dispatches only through admission controls |
| Publication governance | `lib/services/publication-admission.js`, `lib/stabilisation/publication-lifecycle.js` | Fails closed on evidence, approval, operating mode, timing and identity |
| Renderer governance | `lib/stabilisation/render-manifest.js`, `lib/stabilisation/renderer-governance.js` | Hash-binds technical and editorial render evidence; the experimental renderer cannot publish |
| Rights and disclosure | `lib/services/publication-evidence-gates.js` | Requires per-item provenance, rights decisions, evidence hashes and an explicit synthetic-media decision |
| Persistence | `lib/repositories/`, `db/migrations/` | SQLite repositories and versioned schema with durable publication records |
| Studio | `lib/studio/`, `tools/studio-*` | HyperFrames and FFmpeg composition, render workbenches and QA tooling |
| Dashboard | `src/`, `public/` | Operator visibility and authenticated controls |

## Publication lifecycle

The committed lifecycle is:

```text
DISCOVERED
VERIFIED
EDITORIALLY_APPROVED
SCRIPT_READY
ASSETS_CLEARED
RENDERED
QA_PASSED
HUMAN_APPROVED
SCHEDULED
DISPATCH_STARTED
PLATFORM_OBJECT_CREATED
PLATFORM_CONFIRMED
PUBLISHED
ANALYTICS_PENDING
ANALYTICS_COLLECTED
```

Exception states are:

```text
DISPATCH_FAILED_BEFORE_CREATE
PLATFORM_CREATED_CONFIRMATION_FAILED
PLATFORM_CREATED_METADATA_FAILED
PUBLISHED_QA_INCIDENT
RECONCILIATION_REQUIRED
RETRACTED
```

Post-create uncertainty must go to reconciliation. It must not be treated as a safe retry.

## Renderer boundary

The committed standard renderer is `studio-v21`; `hyperframes-next` is experimental and never publishable. A valid standard-renderer manifest binds story and channel identity, output SHA-256, 1080×1920 geometry, 9:16 aspect, H.264 video, AAC 48 kHz audio, ffprobe and platform QA, opening timing, meaningful motion, exact-subject evidence, filler count and scene-level rights acceptance.

`LOCAL_PROOF` can demonstrate a renderer pass but cannot confer publication authority.

## Persistence boundary

SQLite is the durable production design when `USE_SQLITE=true`. Durable scheduling additionally requires `USE_JOB_QUEUE=true`. Legacy JSON and in-process cron paths remain present for local compatibility but are not a second production authority. The actual production flags, database path, migration level and scheduler owner were not inspected.

## Deployment descriptors

The repository contains:

- `railway.json`, which declares Nixpacks, `npm install && npm run build`, `node server.js` and `/api/health`
- `Dockerfile`, which builds a Node 22 image with FFmpeg, yt-dlp and browser libraries
- `Procfile`, which declares `web: node server.js`
- `package.json`, whose `start` script ensures FFmpeg then runs `server.js`

The public health endpoint identified a Railway deployment during the Phase 0 read-only snapshot. Which repository descriptor built that deployment is still **UNKNOWN / UNVERIFIED**. Deployment must identify one build authority before release.

## Observed runtime divergence

At approximately 07:31Z on 2026-07-27:

| Surface | Read-only observation |
|---|---|
| release worktree | interim commit `6aa1f5b80cac78fc6edfdf5d1c738714d5d55d62` |
| main checkout | branch `codex/epidemic-sound-full-integration`, commit `5dc164dc3469a4bc642fa6ca9498cc296f559198`, 80 dirty entries |
| local `:3001` health | commit `ec2ba4d98d3ee55f8c8999952cde5b378168e0c1`, scheduler and autonomous mode active, queue/strict dispatch |
| public Railway health | commit `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`, scheduler and autonomous mode inactive, queue/strict dispatch |

These observations prove divergence, not full ownership. See the Phase 0 runtime and scheduler reports.

## Architectural invariants

- One authoritative source commit, runtime commit, database and scheduler owner per environment.
- No live mutation outside an explicitly valid `LIVE_GUARDED` contract.
- Only a hash-bound, exact-subject, rights-cleared standard render may enter admission.
- Human approval, control-tower `GREEN` and a healthy kill switch are independent gates.
- Platform object creation and local success are separate facts.
- Idempotency is required before remote creation.
- Every material state transition and operator decision must be durable and auditable.
- Analytics is evidence, not an excuse to invent universal performance benchmarks.

## Source boundary

The final source commit includes the editorial contract, governed renderer cutover, brand surfaces, controlled analytics and retention-evidence migration `022`. The canonical documents remain uncommitted in this documentation hand-off and do not alter runtime state. Source presence proves neither deployment nor a populated production database. See [CURRENT_STATUS.md](CURRENT_STATUS.md) and the Phase 0 reports for the explicit evidence boundary.

## Decision records and history

New architecture decisions should be written under `docs/adr/` with status, context, decision and consequences. Historical diagrams and audits remain linked from [README.md](README.md) but do not override this document.
