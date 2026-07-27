# Pulse Gaming Platform Matrix

> **Authority boundary:** The policy column is canonical repository intent. Credentials, eligibility, API health and live posting state are **UNKNOWN / UNVERIFIED**.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Stabilisation platform policy, automation boundaries and evidence needed for enablement |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `PLATFORM_STATUS.md and SOCIAL_PLATFORM_OPERATIONS_2026_05_02_REPORT.md for current policy; those reports remain historical` |
| superseded_by | `none` |
| authoritative | `true` |

If expired, treat this matrix as **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Stabilisation policy

| Platform | Visible in product | Automation policy | Phase | Live state |
|---|---:|---|---|---|
| YouTube | yes | human review only | primary | `UNKNOWN / UNVERIFIED` |
| Instagram | yes | disabled | post-experiment pilot | `UNKNOWN / UNVERIFIED` |
| Facebook | yes | disabled | controlled proof only | `UNKNOWN / UNVERIFIED` |
| TikTok | yes | manual only | post-stabilisation | `UNKNOWN / UNVERIFIED` |
| X | yes | disabled | frozen | `UNKNOWN / UNVERIFIED` |
| Threads | yes | disabled | frozen | `UNKNOWN / UNVERIFIED` |
| Pinterest | yes | disabled | frozen | `UNKNOWN / UNVERIFIED` |

This table comes from the committed operating contract. It does not inspect `.env`, token files, account dashboards, platform APIs or public posts.

Adjacent surfaces remain deliberately narrow:

| Surface | Stabilisation policy |
|---|---|
| Blog | maintenance only |
| Long-form YouTube | one later four-to-eight-minute pilot based on a proven Short topic |
| Discord | announcements and feedback only; no autonomous engagement economy |

## Commercial scope

Pulse is currently a pre-monetisation editorial experiment, not a validated revenue engine. Shorts are treated primarily as reach and format-learning inventory. Revenue projections and software valuations are planning scenarios, not guarantees or release evidence.

| Commercial surface | Stabilisation policy |
|---|---|
| Shorts advertising | monitor eligibility and audience evidence; do not design cadence around hypothetical revenue |
| Affiliate links | frozen outside existing legally required maintenance; no new system or automatic critical-path injection |
| Sponsorships | no outreach or integration until a repeatable audience and advertiser-safe editorial product are evidenced |
| Long-form revenue | one later four- to eight-minute pilot based on a proven Short topic |
| Managed newsroom service | separate future product decision after stable operation, customer isolation, contracts, support and a verified case study |
| Sale or licensing | no readiness or valuation claim without clean ownership, licence provenance, transferability and operating evidence |

A future case study should record output volume, operator time saved, direct cost per video, publication reliability, audience outcomes and the exact evidence period. Commercial expansion must not enter the Pulse v1 publication critical path.

## YouTube

YouTube is the only primary stabilisation lane. Automatic dispatch remains subject to:

- valid `LIVE_GUARDED` runtime contract
- human approval of the exact final candidate
- control-tower `GREEN`
- healthy kill switch
- current source/runtime parity
- durable queue, SQLite and primary-instance ownership
- complete rights, renderer, QA and idempotency evidence
- platform object creation and confirmation recorded separately

A Shorts thumbnail/card may be generated for brand use, but actual YouTube thumbnail behaviour and account capabilities must be verified against the current platform before relying on it.

## Instagram and Facebook

Repository adapters and historical connection evidence may exist, but automation is disabled by policy. Any future pilot must separately prove:

- current business/page/account linkage
- current access token and permissions without exposing secrets
- media container creation, processing and publication confirmation
- public permalink or equivalent confirmation
- idempotent retry behaviour
- platform-specific aspect, duration and disclosure requirements

Processing completion alone must not be labelled public success.

## TikTok

TikTok is manual-only during stabilisation. Before any future controlled API pilot, establish current Content Posting API approval, scopes, creator/account eligibility, audit requirements and public confirmation behaviour. Do not infer capability from client credentials.

## X, Threads and Pinterest

These lanes are frozen. Presence in a dashboard or older report does not authorise posting, scheduled threads, replies or autonomous engagement.

## Capability versus state

Use these terms consistently:

| Term | Meaning |
|---|---|
| adapter present | source code contains a platform implementation |
| configured | required non-secret configuration appears present |
| authenticated | a current, read-only platform call proves identity and scope |
| eligible | the account and app can perform the exact action |
| object created | remote API returned a stable object identifier |
| confirmed | the platform reports the intended final state |
| published | the object is publicly accessible as intended |

Never collapse those stages into “connected” or “working”.

## Enablement gate

Enable one platform at a time after the 12-video controlled evidence phase. Each lane needs:

1. explicit operator scope and success criteria
2. current terms and API documentation review
3. read-only identity and permission proof
4. local dry-run package
5. controlled private or draft proof where supported
6. idempotency and post-create reconciliation proof
7. one explicitly approved public canary
8. analytics ingestion and incident rollback procedure

No such live proof was gathered in this documentation pass.
