# Pulse Gaming Media and Rights

> **Authority boundary:** Canonical media-evidence and rights policy. It is not legal advice and does not declare any unreviewed asset cleared.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Media provenance, rights basis, transformation, audio, disclosure and renderer admission |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `THUMBNAIL_SAFETY_AUDIT.md, docs/thumbnail-safety-audit.md and historical media reports for current policy; those files remain evidence history` |
| superseded_by | `none` |
| authoritative | `true` |

If expired, mark this document **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Core rule

Every media item included in a final publication needs an explicit, evidence-backed decision. Attribution is useful when required but attribution alone is not permission.

The system must fail closed when identity, provenance, rights basis, evidence or final inclusion is ambiguous.

## Approved production stack

The committed stabilisation contract retains:

- ElevenLabs for approved narration
- Epidemic Sound for appropriately licensed music, ambience and sound effects
- HyperFrames for authored visual composition
- FFmpeg for media processing and final assembly

HeyGen, Kokoro and MusicGen remain disabled. A named service does not prove a current licence, token or entitlement. Operators must verify subscription and usage rights outside source control.

## Per-item rights ledger

The committed rights gate requires a canonical, hash-bound ledger with:

- ledger version and overall decision
- stable `item_id`
- source URL
- asset SHA-256
- final-inclusion decision
- rights decision
- rights basis
- evidence reference and evidence SHA-256
- attribution decision
- attribution text when required

Included items require `CLEARED` and one accepted basis:

- `OWNED`
- `LICENSED`
- `PERMISSION_GRANTED`
- `PUBLIC_DOMAIN`
- `PLATFORM_AUTHORISED`
- `TRANSFORMATIVE_EDITORIAL_USE`

`ATTRIBUTION`, `CREDIT` or equivalent attribution-only labels are not accepted rights bases.

Excluded items must be marked `EXCLUDED` or `BLOCKED`, not silently omitted from the evidence.

## Transformation assessment

A separate originality and transformation decision must record:

- `STRONG` or `ADEQUATE` verdict
- specific rationale
- evidence reference
- evidence SHA-256

A `WEAK` verdict blocks publication. Transformation should be assessed from the final work: original reporting structure, commentary, sequencing, overlays, framing, duration, selection and audience value. A claim that similar channels use the same footage is not evidence.

Copyright exceptions and contractual platform rules vary by jurisdiction and context. Credit, brevity and transformation may be relevant factors but none creates automatic universal permission. Escalate uncertain material to human review or replace it.

## Asset acquisition policy

Preferred order:

1. owned or commissioned material
2. explicitly licensed libraries and subscription assets within current terms
3. first-party press kits or platform-authorised assets with retained terms
4. public-domain material with verified status
5. narrowly selected transformative editorial material with documented reasoning

Avoid downloading or republishing arbitrary social clips, watermarked creator work or material whose source cannot be established.

For every remote fetch:

- retain the canonical source URL and acquisition time
- verify the exact subject
- hash the downloaded bytes
- reject unsafe URL schemes and unexpected content types
- preserve licence or permission evidence separately

## Audio

- Narration must use the approved voice path and final reviewed script.
- Epidemic Sound tracks and effects must be used within the account’s current licence and platform coverage.
- ElevenLabs-generated sound effects still require an explicit synthetic-media and platform-policy decision.
- BBC Sound Effects and other archives must be evaluated against their exact current usage terms. An archive being searchable or downloadable does not mean unrestricted commercial reuse.
- Game footage may be muted but muting does not change the footage rights decision.
- Record track, effect, source, licence basis and final mix inclusion.

## Synthetic-media disclosure

The committed gate requires an operator to decide:

- whether synthetic media is present
- `DISCLOSE` or `NO_DISCLOSURE_REQUIRED`
- the rationale
- the relevant platform field value
- review timestamp
- disclosure text when disclosing
- policy basis when synthetic media is present but disclosure is judged unnecessary

The platform field must match the decision. A missing or contradictory decision blocks admission.

## Renderer evidence

The standard render manifest binds:

- story and channel identity
- renderer ID, role and version
- HyperFrames and FFmpeg usage
- final media SHA-256 and technical properties
- platform-video QA result
- first-frame, hook, consequence and proof timing
- motion and exact-subject counts
- unrelated-filler count
- scene-level rights acceptance

The experimental renderer cannot publish. `LOCAL_PROOF` evidence is never publication authority.

## Required pre-publication evidence

Publication admission requires all of these to agree:

- source evidence hash
- rights-ledger hash and cleared items
- originality/transformation evidence
- synthetic-media decision
- renderer-manifest hash
- final-media hash
- QA-report hash
- exact story and channel identity
- final human approval

If the final render, script or included asset changes, regenerate and re-review the affected evidence. Never carry approval across a material change.

## Incident handling

If a rights issue is reported:

1. trip the kill switch or stop further dispatch.
2. preserve the claim, asset hash, source and publication IDs.
3. do not delete evidence.
4. assess whether the platform object should be made private or retracted under explicit operator authority.
5. append the incident and reconciliation state.
6. replace or remove the asset only through a reviewed new version.

Follow [INCIDENT_RUNBOOK.md](INCIDENT_RUNBOOK.md).
