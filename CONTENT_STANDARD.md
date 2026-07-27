# Pulse Gaming Content Standard

> **Authority boundary:** Canonical editorial quality and safety contract. It does not approve a story, source, script or upload by itself.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Editorial verification, scripting, audience quality, experimentation and approval |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `channel prompt fragments and historical format reports for current editorial policy; implementation-specific historical files remain available` |
| superseded_by | `none` |
| authoritative | `true` |

If expired, treat this document as **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Editorial promise

Pulse Gaming delivers fast gaming news that is checked, explained and useful. Speed matters, but being first never excuses inventing facts, flattening uncertainty or publishing weak evidence as confirmation.

Every item must answer:

- What happened?
- Who is the primary or best available source?
- What is confirmed, reported or still uncertain?
- Why does it matter to a player?
- What is the strongest specific evidence?
- What should the viewer understand by the end?

## Public identity and viewer proposition

- Public display name: **Pulse Gaming News**.
- Short in-video identity: **PULSE**.
- Tagline: **Fast gaming news. Checked. Explained.**
- Viewer proposition: Pulse tells players what a gaming headline actually changes, with the source and proof shown on screen.
- Subscription proposition: subscribe for the player consequence, not another recap.

The outward-facing format system has three lanes:

| Lane | Viewer promise | Typical subject |
|---|---|---|
| What Changes for Players | the practical consequence in under 40 seconds when the story allows it | pricing, account rules, release dates, platforms and delistings |
| Trailer Truth Check | what the footage actually proves | reveals, remakes, demos and visual claims |
| Platform Pulse | who benefits, who loses and why it matters | Xbox, PlayStation, Nintendo, Steam and PC strategy |

Older internal labels may remain useful for classification. They must not create additional public franchises during stabilisation.

The governed avatar is wordless, black and amber, uses a strong asymmetric signal mark occupying roughly 70 to 80 per cent of the circle and is reviewed at 24px, 32px and 48px. The detailed wordmark belongs on banners and end frames, not inside the small avatar. Local avatar assets do not authorise a live channel-profile change.

## Source and claim rules

- Prefer primary announcements, filings, patch notes, first-party storefronts and attributable interviews.
- Major-outlet reporting may support a story but must not erase the outlet’s uncertainty.
- Reddit and social posts are discovery inputs, not automatic factual authority.
- Cross-check material claims against the linked source text.
- If sources conflict, expose the conflict or withhold the claim.
- Never invent a date, quotation, statistic, price, feature or causal explanation.
- Rumours and leaks must be labelled and hedged throughout, not just in metadata.
- A verified source can still make a wrong claim. Verification and truth are separate judgements.

## Classification

| Classification | Use |
|---|---|
| `CONFIRMED` | Supported by a first-party or otherwise authoritative public source |
| `BREAKING` | Time-sensitive confirmed reporting with immediate audience relevance |
| `RUMOUR` | Unconfirmed claim with a credible, attributable source and explicit uncertainty |
| `LEAK` | Unofficial material or information whose provenance and limitations are explained |
| `NEWS` | Factual update that does not require a stronger urgency label |

Do not promote a classification merely to increase urgency.

## Duration policy

Do not force every story into one fixed duration and do not pad a simple fact to meet a platform threshold.

| Story shape | Initial target runtime |
|---|---|
| Single fact with a clear consequence | 25–32 seconds |
| Standard news explanation | 32–42 seconds |
| Two-sided platform or business story | 40–50 seconds |
| Four-item list | 42–55 seconds |
| TikTok Creator Rewards derivative | Separate 60-second-plus version only when that later lane is explicitly enabled |

The selected format and target speaking rate determine the cleaned spoken-word budget. Runtime must be verified from final audio rather than estimated from raw script tokens.

## Script contract

The normal spoken structure is:

1. **Hook** — an accurate knowledge gap in the opening words.
2. **Source and credibility** — name the evidence early.
3. **Details** — concise facts in logical order.
4. **Midpoint pivot** — a story-specific new question, contradiction or consequence.
5. **Meaning** — explain what changes for the audience.
6. **Close** — a concise consequence, verdict or governed story-specific prompt.

Requirements:

- British English.
- No serial comma.
- No filler, fabricated urgency or generic greetings.
- No internal QA language, prompts, placeholders or implementation notes in public copy.
- Avoid stock phrases and repeated hook shapes.
- Vary sentence rhythm for natural narration.
- Keep titles specific, searchable and honest.
- Use advertiser-safe language without hiding material facts.
- Calls to action must be story-specific and optional, never automatic begging.
- During the controlled 12-video test, no more than one-third of videos may contain a CTA.
- Prefer a final consequence or concise verdict over a generic follow request.

## Visual and audio storytelling

- The first frame must identify the exact subject.
- Hook, consequence and proof must arrive early enough to sustain attention.
- Motion must be meaningful, not decorative filler.
- Platform-themed cards may support comprehension but must not imply affiliation.
- Narration remains intelligible over music, ambience and sound effects.
- Sound design should sharpen a beat, transition or reveal rather than compete with speech.
- Every included asset must satisfy [MEDIA_AND_RIGHTS.md](MEDIA_AND_RIGHTS.md).

Use this timing contract unless the exact story requires a stricter cut:

| Time | Requirement |
|---|---|
| 0.0–0.5 seconds | recognisable exact-subject footage or the named subject |
| 0.0–1.5 seconds | the player consequence |
| by 3 seconds | enough source or visual proof to justify continuing |
| before the midpoint | a second concrete fact or meaningful pivot |
| final quarter | payoff, consequence or verdict rather than repeated setup |

No opening logo animation may delay comprehension. A signal sting may run only when it does not obscure or postpone the hook.

## Conversation and subscription conversion

Do not manufacture engagement through generic questions, automated replies or an autonomous comment loop. One concise, story-specific pinned-comment prompt may be prepared and human-approved when it offers a legitimate one- or two-word choice. During stabilisation, its public posting remains manual unless a later explicit platform gate authorises the exact action.

## Human approval

Approval must be based on the final script, final render and exact publication metadata. A previous draft approval does not transfer automatically after a material change.

The operator must be able to verify:

- story and channel identity
- sources and material claims
- uncertainty labels
- final title and description
- rights and synthetic-media decisions
- renderer and QA evidence
- scheduled platform and time

## Performance learning

Do not invent universal YouTube benchmarks. Compare controlled candidates against Pulse Gaming’s own recent median. Complete the planned sample before changing a scoring model because of one result.

The controlled sample tests three editorial lanes, two hook types and two duration bands:

| Lane | Direct hook | Open-loop hook | Short runtime | Standard runtime |
|---|---|---|---|---|
| What Changes for Players | state the consequence immediately | reveal the affected player first, then the change | 25–32 seconds | 35–42 seconds |
| Trailer Truth Check | state what the footage proves | challenge the headline, then show proof | 28–35 seconds | 38–48 seconds |
| Platform Pulse | name the winner and loser immediately | present the corporate contradiction first | 30–36 seconds | 42–50 seconds |

Produce two topics for each of the six lane/hook combinations, one in each duration band, giving 12 controlled videos. Keep narrator, approved voice settings, Epidemic Sound standard, HyperFrames system, caption font, safe area, source-verification standard, audio loudness, maximum daily cadence and human review constant.

Review each upload at 24 hours, 48 hours and seven days. Do not change the scoring model until all 12 have completed the agreed observation windows.

Candidate promotion should use multiple dimensions such as:

- stayed-to-watch rate
- average percentage viewed
- three-second retention
- subscribers per 1,000 engaged views
- shares per 1,000 engaged views
- returning-viewer rate

No live analytics dataset or validated baseline was inspected during this documentation pass. Current analytics readiness is documented as **UNKNOWN / UNVERIFIED**.

## Implementation boundary

`lib/services/pulse-editorial-contract.js`, channel copy, public/operator brand surfaces and their focused tests are part of the recorded source commit. That proves a local source contract only. It does not prove deployment, a live channel-profile update, a completed controlled sample or improved audience performance.
