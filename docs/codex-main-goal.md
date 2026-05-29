# Pulse Gaming main /goal

Date adopted: 2026-05-21

This is the main operating goal for Codex work in this repo. Treat it as the product contract for Pulse Gaming unless the user explicitly replaces it.

## North star

Build Pulse Gaming into an enterprise-grade autonomous media operating system.

This is not a toy AI video generator, a CapCut-style automation stack or a generic Shorts factory. The system must become a governed, high-quality, commercially intelligent, multi-platform creator studio. It should produce world-class gaming news first, then expand carefully into tech, AI, finance and crypto.

The output should feel like it came from an elite modern creator studio or digital-first media house. The first question for every render is:

> Would this survive comparison against the best gaming, tech and social-first media accounts in the first 1-3 seconds?

If not, reject it before publishing.

## Non-negotiables

- No fake readiness.
- No vague "done" claims.
- No generic AI output.
- No placeholder titles.
- No ungoverned publishing.
- No asset usage without a rights record.
- No affiliate link without disclosure.
- No finance or crypto content without compliance gates.
- No blind platform mirroring when platform-native variants are required.
- No auto-publishing unless the final verdict is GREEN.

## Required production workflow

Every story should move through this governed path:

```text
story discovery
-> source verification
-> canonical story manifest
-> story scoring
-> angle selection
-> script generation
-> script rejection or approval
-> footage sourcing and scoring
-> rights ledger validation
-> director beat map
-> visual package generation
-> SFX and music planning
-> voice/narration generation
-> platform-native render variants
-> forensic QA
-> public-output coherence QA
-> policy and disclosure checks
-> affiliate intelligence
-> platform publish packs
-> publish control tower
-> analytics ingest
-> retention diagnosis
-> future rule updates
```

No video should publish unless the system can prove:

- what the story is
- which sources support it
- which assets were used
- what rights basis exists
- what platform rules apply
- which disclosures are required
- which affiliate links are attached
- which benchmark pack judged it
- which quality gates passed
- which system version produced it

## Current priority

Build for Pulse Gaming first.

The first operational target is a best-in-class autonomous gaming-news channel producing platform-native content for:

- YouTube Shorts
- TikTok
- Instagram Reels
- Facebook Reels
- X
- Threads
- Pinterest where suitable
- story landing pages

Tech, AI, finance and crypto expansion must be architected now but kept behind gates. Finance and crypto require a separate compliance firewall and must not reuse the gaming pipeline casually.

## Quality bar

Reject content that feels generic, slow, templated, over-cautious, visually flat, text-heavy, weakly titled, badly sourced, commercially spammy, obviously AI-generated, repetitive or under-produced against elite social-first references.

Optimise for:

- first-frame clarity
- first-second tension
- named subject in the opening
- large mobile-readable text
- real motion density
- strong shot rhythm
- punchy transitions
- audible SFX
- clean source locks
- title, thumbnail and script alignment
- no internal QA language in public scripts
- no stale wording
- no lazy CTAs
- no overlong caveat sections
- no weak "here is what happened" openings

## Build principles

- Use TDD for behaviour changes.
- Write failing tests first for major modules.
- Add integration tests, manifest outputs, rejection reasons, fixtures and observability.
- Prefer hardening existing modules over duplicating systems.
- Keep large changes reviewable.
- Make every subsystem produce machine-readable outputs.
- Every failure must explain why it failed.
- Every pass must include evidence.
- Avoid fake "readiness" flags.

## Core systems to build or harden

### 1. Canonical Story Manifest

Every public output must be driven by one locked story manifest.

Required behaviour:
- represent canonical subject, game, company, people, angle, sources, source confidence, claims, allowed wording, title candidates, selected title, thumbnail headline, first spoken line, narration, description, pinned comment, platform CTAs, affiliate pack, rights manifest and publish status
- hard fail generic titles, "This gaming story", missing canonical subject, title/thumbnail/script/description mismatch, source-card mismatch, internal QA language, caveat-heavy scripts, weak source confidence and stale temporal wording

Banned public phrases include:
- "source-backed update"
- "not a blank check"
- "invent extra details"
- "named source confirms"
- "wait-and-see column"
- "Reddit reaction into evidence"
- "this gaming story"
- "the useful caveat is"
- "the safest public version is"

### 2. Public Output Coherence Gate

Compare title, thumbnail, opening line, script, captions, source labels, description, pinned comment, affiliate CTA and landing page headline. Hard fail if they do not clearly describe the same story.

Outputs: `coherence_report.json`, `rejection_reasons.json`, `corrected_recommendations.json`.

### 3. Story Selection Intelligence

Score stories for freshness, audience fit, named-entity strength, visual availability, source confidence, tension, player usefulness, affiliate potential, platform interest, uniqueness, retention potential, rights risk and policy risk.

Outputs: `story_scorecard.json`, `produce_or_reject` verdict, `story_angle_recommendations.json`.

### 4. Viral Script Engine

Scripts must be angle-first, not generic summaries. Require a consequence-first or otherwise sharp hook, named subject early, clear tension, source-safe claim, player impact, proof beat, payoff and tight CTA.

Hard fail slow hooks, AI-sounding prose, source-process narration, missing angle, high caveat ratio, missing player impact, missing subject in the first 3 seconds and generic endings.

Outputs: `script_scorecard.json`, `script_rewrite_reasons.json`, `selected_script.json`.

### 5. Footage Empire

Build a trusted-source asset system for official trailers, platform channels, press kits, game store media, permitted screenshots, generated graphics, licensed assets and manually approved sources.

Each asset needs rights, risk, visual usefulness, motion density, duplicate, relevance, quality, crop-zone and recommended-window data.

Outputs: `footage_inventory.json`, `rights_ledger.json`, `clip_scorecard.json`, `motion_readiness_report.json`.

### 6. Rights Ledger

Every video clip, screenshot, music bed, SFX, font, graphic, generated image, voice asset, overlay, logo and source screenshot needs a rights record.

Hard fail unknown rights, unclear commercial/platform use, high risk, unverified source and copied competitor assets.

Outputs: `rights_ledger.json`, `rights_risk_report.json`, `asset_rejection_reasons.json`.

### 7. Director Brain

Plan the edit before rendering. Produce a beat-by-beat timeline for hook slam, proof beat, motion clip, stat card, contradiction, platform context, player impact, chart/card moment, commercial-safe CTA and identity CTA.

Hard fail no visual change in the first 1.5 seconds, weak first 3 seconds, too many card-only beats, caption/overlay conflicts, tiny source locks, unaligned SFX, generic endings and unsuitable duration.

Outputs: `director_beat_map.json`, `timeline_plan.json`, `retention_intent_map.json`.

### 8. Visual V4 / Creator Studio Renderer

Output must feel designed, not assembled. Support kinetic lower thirds, animated source locks, Steam/stat cards, comparison bars, bold captions, full-frame motion, branded wipes, speed ramps, proof cards, split-screen proof moments, quote cards, platform-native cover frames, carousel cards and X image cards.

Hard fail weak motion density, unclear first frame, poor text hierarchy, tiny captions, dense overlays, illegible source locks, repeated rhythm and template-looking output.

Outputs: `visual_render_manifest.json`, `frame_quality_report.json`, `mobile_readability_report.json`, `visual_repetition_report.json`.

### 9. Sound Design Engine

Plan and mix music, whooshes, risers, impacts, UI ticks, chart hits, transition accents, CTA stings, sidechain ducking and loudness.

Hard fail inaudible SFX, clipping, buried voice, overpowering music, silence gaps, repeated SFX patterns and unsafe loudness.

Outputs: `audio_plan.json`, `sfx_manifest.json`, `loudness_report.json`, `audio_quality_scorecard.json`.

### 10. Gold Standard Forensics Engine

Use the 50-channel reference library as non-infringing production grammar, not as a footage or template source.

Extract pattern data: title structure, hook type, first-frame structure, first 3-second pacing, shot length, motion density, transition rhythm, overlay density, caption style, source-card style, SFX timing, music energy, CTA placement, commercial integration and platform behaviour.

Benchmark packs:
- Gaming News Core
- Official Publisher Motion
- Social-First News
- Explainer and Data Graphics
- Pacing and Retention Impact
- Premium Visual Texture
- Commercial and Affiliate Mechanics
- X Hot Take and Thread Mechanics
- Instagram Carousel Mechanics

Outputs: `reference_pack_scorecard.json`, `benchmark_comparison_report.json`, `pulse_render_benchmark_report.json`, `benchmark_rejection_reasons.json`.

### 11. Retention Intelligence Loop

Ingest views, impressions, average view duration, retention curves, first 3-second drop-off, stayed-to-watch, swipe-away, replays, likes, comments, shares, saves, follows, clicks, landing visits and revenue.

Diagnose weak hooks, title, first frame, pacing, topic, visual density, CTA, source clarity, platform mismatch and repeated structure.

Outputs: `retention_report.json`, `learning_rules.json`, `future_render_recommendations.json`, `experiment_results.json`.

### 12. Experimentation Engine

Create controlled variants for hooks, titles, thumbnails, CTAs, duration and platform outputs. Track winners without uncontrolled random variation.

Outputs: `experiment_manifest.json`, `variant_scorecard.json`, `winner_report.json`, `rule_update_recommendations.json`.

### 13. Multi-Platform Publisher Engine

Do not blindly mirror. Generate platform-native packages for YouTube Shorts, TikTok, Instagram Reels, Facebook Reels, X, Threads and Pinterest.

Hard fail blind duplicates, missing disclosure, generic titles, unrelated affiliate links, policy risk, anti-spam risk, missing tracking and missing landing-page routes where required.

Outputs: `platform_publish_manifest.json`, `platform_variant_scorecard.json`, `scheduled_posts.json`, `platform_risk_report.json`, `analytics_ingest_plan.json`.

### 14. Social Derivatives Engine

Generate X posts/threads/polls/cards, Instagram carousels/quote cards/stat cards/story prompts, Threads posts and image-card assets. Avoid crude engagement bait and risky automated replies.

Outputs: `x_publish_pack.json`, `instagram_publish_pack.json`, `threads_publish_pack.json`, `image_card_manifest.json`, `carousel_manifest.json`, `engagement_risk_report.json`.

### 15. Affiliate Intelligence Engine

Attach story-relevant commercial paths without making the content feel cheap. Score relevance, audience fit, merchant trust, commission, conversion likelihood, availability, geography, platform suitability, compliance risk and repetition risk.

Hard fail unrelated links, missing disclosure, risky merchants, dead links, unavailable products, finance/crypto affiliate leakage and hard-sell CTAs.

Outputs: `affiliate_link_manifest.json`, `commercial_opportunity_score.json`, `disclosure_manifest.json`, `affiliate_tracking_map.json`, `revenue_attribution.json`.

### 16. Landing Page Engine

Create story landing pages with source lists, summary, embed, affiliate links, disclosure, related stories/products, newsletter capture, UTM tracking, UK/US geo-routing, expired link handling and compliance notes.

Outputs: `landing_page_manifest.json`, `link_pack.json`, `disclosure_block.json`, `revenue_tracking.json`.

### 17. Platform Policy Engine

Check YouTube reused-content risk, paid promotion disclosure, altered/synthetic disclosure, Shorts link limitations, TikTok commercial/AI disclosure, Meta branded content, X automation/spam, affiliate disclosure, finance/crypto risk, misinformation, spam and repetitive content.

Outputs: `platform_policy_report.json`, `disclosure_requirements.json`, `publish_blockers.json`.

### 18. Finance and Crypto Firewall

Hard block buy/sell/hold calls, guaranteed returns, "this will pump", leverage promotion, exchange referral pushes without approval, token shilling, certainty-based price predictions, misleading profit thumbnails, undisclosed incentives, personalised investment advice and unsafe affiliate routing.

Allowed safer formats include news summaries, source-backed explainers, regulatory updates, market context, risk education and non-advisory analysis.

Outputs: `finance_crypto_risk_report.json`, `approved_wording.json`, `blocked_claims.json`, `compliance_required_actions.json`.

### 19. Autonomy Control Tower

Every output receives one final verdict:

- GREEN: safe to auto-publish
- AMBER: usable but needs human approval
- RED: blocked

Control tower inputs include canonical story manifest, script scorecard, footage inventory, rights ledger, director plan, render QA, benchmark report, policy report, affiliate disclosure report, platform pack, analytics risk and anti-spam report.

Outputs: `publish_verdict.json`, `risk_report.json`, `rejection_reasons.json`, `approval_requirements.json`.

### 20. Anti-Spam and Uniqueness Engine

Check repeated title structures, thumbnails, first lines, CTAs, footage, layouts, transitions, SFX, affiliate offers, post structures, X threads and Instagram carousel formats.

Outputs: `uniqueness_report.json`, `repetition_risk_score.json`, `variation_recommendations.json`.

### 21. Observability Dashboard

Track discovered stories, rejected stories, videos rendered, blocked videos, publish status, render time, failures, cost, quality scores, hook scores, benchmark scores, policy risk, rights risk, affiliate risk, source confidence, platform performance, retention, views, followers, comments, shares, clicks, revenue, profit and recurring failure reasons.

Outputs: dashboard model, reporting endpoints/files, daily studio report, weekly performance report, blocked-content report and revenue report.

### 22. Versioned Prompt and Model Registry

Every published output must record git commit, renderer version, script prompt version, director version, policy ruleset, benchmark pack version, voice model, audio model, visual model, affiliate ruleset, platform pack version and publishing mode.

Outputs: `production_audit_log.json`, `model_prompt_registry.json`, `video_lineage_manifest.json`.

### 23. Security, Secrets and Deployment Safety

Require no hard-coded tokens, no secrets in logs, scoped OAuth, token rotation plan, environment separation, least privilege, local/dev/prod modes, dry-run publishing, queue approval, emergency kill switch, retry logging, audit trail, rollback path and safe API handling.

Outputs: `security_report.json`, `secrets_scan_report.json`, `deployment_safety_report.json`.

### 24. Corrections, Retractions and Takedowns

Detect changed, debunked or unsafe sources. Flag affected videos and recommend description updates, pinned comment corrections, unlist/delete/escalate status, landing page changes, affiliate disablement and correction logs.

Outputs: `correction_queue.json`, `affected_content_report.json`, `correction_plan.json`, `takedown_response_log.json`.

### 25. Sponsor Readiness Pack

Generate media kit, audience summary, best-performing videos, average views, retention stats, platform reach, vertical breakdown, brand safety report, sponsor-safe examples, pricing recommendations, disclosure plan and sponsorship formats.

Outputs: `sponsor_media_kit.json`, `sponsor_pitch_pack.md`, `brand_safety_report.json`.

### 26. Creator Studio Brand System

Define logo usage, motion identity, typography, colour system, source-card style, lower thirds, thumbnail style, caption rules, CTA rules, recurring segment names, banned phrases, editorial tone and platform-specific voice.

Ownable formats:
- The Game Behind the Headline
- Steam Spike Check
- Delisting Watch
- Worth Your Wishlist?
- Platform War Pulse
- Patch Notes That Matter
- Trailer Truth Check
- The 60-Second Gaming Brief

Outputs: `brand_system_manifest.json`, `visual_style_guide.md`, `editorial_style_guide.md`, `recurring_format_registry.json`.

### 27. Daily Cadence Engine

Create a daily planning gate that turns governed, scheduler-visible candidates into a publish schedule without forcing weak content to fill a quota. Normal mode may plan 3-8 strong gaming-news Shorts/Reels per day, 1-3 richer explainers where warranted, X/Threads/card derivatives for major stories, selected Instagram carousel posts, breaking-news fast posts when urgency is high and weekly recap or evergreen affiliate formats where they fit.

The cadence engine must reject volume for volume's sake. It should require minimum story score, source confidence, visual readiness, script score, benchmark score, complete platform packs, no duplicate event, no disabled platform counted as delivered, no thin or fallback render, no generic public copy and no RED verdict.

Outputs: `daily_content_plan.json`, `publish_schedule.json`, `cadence_quality_report.json`.

Acceptance: the cadence report must separate ready, skipped, blocked and human-review stories; preserve upstream skipped rows; count only enabled platform actions as deliverable; keep all live posting disabled in LOCAL_PROOF or DRY_RUN_PUBLISH; and explain why the plan does or does not meet the daily target.

### 28. Event and Source Deduplication

Detect when several feeds, Reddit posts or articles describe the same event. Merge them into one stronger story, split them only when the angle is genuinely different, update an existing story when the facts have moved and reject repeat candidates that would trip platform duplicate checks.

Outputs: `deduplication_report.json`, `merge_plan.json`, `angle_split_plan.json`, `rejected_duplicate_stories.json`.

Acceptance: duplicate candidates must not reach render or publish planning unless the report records a clear angle split, source cluster, canonical subject and claim difference.

### 29. Breaking News Fast Lane

Create a separate fast lane for urgent stories. It can produce source-safe X/Threads/card posts, Instagram/Facebook story cards and a short source-card video before the full V4 render is ready, but it must use stricter source confidence and a correction watch.

Outputs: `breaking_news_manifest.json`, `fast_publish_pack.json`, `follow_up_v4_plan.json`, `correction_watch.json`.

Acceptance: no fast-lane output may present Reddit-only or anonymous claims as fact, add affiliate CTAs before facts settle, skip correction planning or bypass platform policy checks.

### 30. Narration, Voice and Word Timestamps

Make final narration a hard production input. Every candidate must have final voice audio, clean transcript, word timestamps, caption chunks, loudness checks, fallback voice evidence and pronunciation rules for difficult game names.

Outputs: `narration_manifest.json`, `word_timestamps.json`, `caption_manifest.json`, `voice_quality_report.json`, `tts_doctor_report.json`.

Acceptance: missing audio, missing timestamps, transcript drift, malformed captions, clipped voice, buried voice or unsafe local TTS state blocks publishing.

### 31. Owned and Generated Motion Materialiser

Turn abstract visual plans into real owned/generated motion assets: kinetic title cards, source cards, quote cards, stat cards, chart slams, branded wipes, social cards, carousel slides and X image cards.

Outputs: `owned_motion_manifest.json`, `materialised_motion_clips.json`, `distinct_motion_family_report.json`, `render_input_work_order.json`.

Acceptance: a final render cannot pass if materialised motion is missing, too static, visually duplicated, unmatched to the story, article dominated or missing a rights record.

### 32. Render Health and Queue Observability

Report live database health separately from governed V4 bridge readiness. The digest must distinguish live DB stamped renders, unstamped legacy rows, final V4 bridge candidates, final production renders, missing MP4s, missing timestamps, missing motion, missing rights records and platform-disabled actions.

Outputs: `render_health_report.json`, `bridge_health_report.json`, `live_db_health_report.json`, `production_cutover_digest.json`, `discord_digest_payload.json`.

Acceptance: bridge artefacts must not be mixed into live DB percentages, and no report may call a candidate ready unless scheduler preflight agrees.

### 33. Repair Backlog Orchestration

Route blockers into repair lanes for missing MP4s, final narration, word timestamps, materialised motion, distinct motion families, thin visuals, risky article context, script timeouts, local LLM fallback, stale QA, platform re-encode, duplicate merge, source mismatch, captions and rights records.

Outputs: `repair_backlog.json`, `auto_repair_plan.json`, `render_input_work_order.json`, `repair_results.json`.

Acceptance: each work order must name story ID, blocker type, repair lane, missing input, command, expected artefact, DB mutation status, operator approval status and post-repair validation command.

### 34. Production Cutover Bridge

Expose governed V4 packages to the scheduler without pretending they are live DB rows. Bridge candidates must include final MP4 evidence, narration, timestamps, captions, rights, motion materialisation, platform packs, source manifest, control tower verdict, benchmark score and bridge/live state.

Outputs: `scheduler_bridge_candidates.json`, `production_render_cutover_plan.json`, `strict_dry_run_publish_plan.json`, `bridge_preflight_report.json`.

Acceptance: bridge candidates cannot bypass scheduler preflight, count as published, lose rights visibility or claim readiness from package files alone.

### 35. Platform Upload Reliability

Validate platform packages before scale. Check enabled state, credentials without leaking secrets, media format, duration, aspect ratio, codec, file size, captions, descriptions, disclosures, retry policy and repair lane for each platform.

Outputs: `platform_upload_preflight_report.json`, `platform_failure_repair_plan.json`, `platform_status_matrix.json`.

Acceptance: disabled platforms must stay visible but cannot count as deliverable, and Instagram/Meta, TikTok, X, YouTube and Facebook failures must produce classified repair actions.

### 36. Platform Enablement and Operator Control

Keep TikTok, X, Threads, Pinterest and any future platform behind explicit operator enablement. The system may inspect readiness, generate work orders and dry-run actions, but it must not mutate OAuth state or post externally from LOCAL_PROOF.

Outputs: `platform_enablement_work_order.json`, `operator_enablement_checklist.json`, `platform_guardrail_report.json`.

Acceptance: no platform may move from disabled to deliverable without recorded operator action, credential/scope evidence, kill-switch status and control-tower GREEN or human-approved AMBER state.

### 37. Human Review Queue and Approval Workflow

Queue GREEN and AMBER candidates for operator review with the title, thumbnail, first frame, script, source list, platform packs, risk reasons and suggested fixes. RED candidates stay blocked.

Outputs: `human_review_queue.json`, `approval_requirements.json`, `review_packet_manifest.json`, `operator_decision_log.json`.

Acceptance: HUMAN_REVIEW cannot publish by itself, AMBER requires a recorded operator decision and RED cannot be approved without a new passing artefact set.

### 38. Local Proof Test Video Review Lane

Generate local-only test renders for operator review without changing production rows or posting. The lane must show the exact current renderer, narration, captions, cards, SFX and quality reports.

Outputs: `local_test_video_manifest.json`, `test_render_review_pack.json`, `operator_feedback_log.json`, `test_render_qa_report.json`.

Acceptance: local proof renders must be labelled as non-publish artefacts and cannot be counted as final production renders unless they later pass the full cutover bridge.

### 39. Analytics Fallback and Rule Update Engine

When the local LLM or analytics model fails, the system must still produce deterministic fallback diagnosis, separate technical failure from lack of insight and persist future rules for story selection, hooks, pacing, duration, platform variants and affiliate CTAs.

Outputs: `analytics_fallback_report.json`, `learning_rules.json`, `future_render_recommendations.json`, `rule_update_recommendations.json`.

Acceptance: analytics failures may not produce "no actionable recommendation" without an explicit technical-failure reason and deterministic fallback recommendations.

### 40. Production Incident Response

Treat catastrophic uploads, placeholder copy, source mismatch, bad audio, broken captions, weak first frame, wrong platform package or unsafe public claims as incidents. Produce a correction, takedown or rollback plan before the next live action.

Outputs: `incident_report.json`, `incident_blockers.json`, `rollback_plan.json`, `post_incident_rule_update.json`.

Acceptance: incidents must block autopublish until the new rule is test-backed, the affected content is logged and the control tower returns a defensible status.

### 41. Thirty-Story Acceptance Proof

Prove the system across at least 30 distinct gaming stories. Each story needs the canonical manifest, source/claim data, script, footage, rights, motion, director plan, narration, timestamps, captions, V4 render, platform packs, policy, benchmark, coherence, platform preflight, verdict, analytics plan and correction path.

Outputs: `thirty_story_acceptance_matrix.json`, `acceptance_gap_report.json`, `acceptance_evidence_index.json`.

Acceptance: at least 30 stories must be preflighted, at least 10 must be clean GREEN in strict dry-run and there must be zero false-green publish actions.

### 42. Final Production Readiness Decision

Produce the final readiness decision for the autonomous studio. The decision must combine scheduler preflight, render QA, rights QA, policy QA, benchmark QA, platform upload QA, security, kill switch, human-review history, analytics and rollback readiness.

Outputs: `final_production_readiness_report.json`, `go_live_decision.json`, `remaining_blockers.json`, `next_operating_mode_plan.json`.

Acceptance: the system is not production-ready unless it can schedule high-quality Pulse Gaming videos at regular intervals with strict guardrails, platform-native packs, proof artefacts, breaking-news fast lane, correction path and no unreviewed live publishing.

## Acceptance criteria

The system is not complete until it can produce a governed, publish-ready package for at least 30 different gaming stories.

Each story must include:

- canonical story manifest
- script scorecard
- footage inventory
- rights ledger
- director beat map
- Visual V4 render
- audio/SFX manifest
- captions
- platform-native variants
- X pack
- Instagram carousel pack
- affiliate manifest where relevant
- landing page manifest where relevant
- policy report
- benchmark report
- public-output coherence report
- final publish verdict
- analytics ingest plan

Minimum quality gates:

- no generic titles
- no title/script/thumbnail mismatch
- no missing source labels
- no missing rights records
- no missing disclosures
- no weak first frame
- no internal QA language in public narration
- no unreadable mobile text
- no repeated visual structure across recent uploads
- no output below benchmark threshold
- no finance/crypto content without compliance firewall
- no auto-publishing unless GREEN

Performance should improve from the current baseline: higher stayed-to-watch, lower swipe-away, stronger first 3-second retention, higher subscriber conversion, better platform-specific variant results, growing affiliate click-through, lower render failure rate and fewer manual corrections.

## Required deliverables

Core artefacts:
- `canonical_story_manifest.json`
- `story_scorecard.json`
- `source_manifest.json`
- `claim_inventory.json`
- `script_scorecard.json`
- `footage_inventory.json`
- `rights_ledger.json`
- `director_beat_map.json`
- `render_manifest.json`
- `audio_manifest.json`
- `sfx_manifest.json`
- `visual_quality_report.json`
- `forensic_qa_report.json`
- `benchmark_report.json`
- `coherence_report.json`
- `platform_policy_report.json`
- `affiliate_link_manifest.json`
- `landing_page_manifest.json`
- `publish_verdict.json`
- `analytics_ingest_plan.json`
- `audit_log.json`

Social artefacts:
- `youtube_publish_pack.json`
- `tiktok_publish_pack.json`
- `instagram_publish_pack.json`
- `facebook_publish_pack.json`
- `x_publish_pack.json`
- `threads_publish_pack.json`
- `pinterest_publish_pack.json`
- `carousel_manifest.json`
- `image_card_manifest.json`
- `thread_manifest.json`

Operations artefacts:
- `observability_report.json`
- `security_report.json`
- `secrets_scan_report.json`
- `correction_queue.json`
- `sponsor_media_kit.json`
- `brand_system_manifest.json`
- `prompt_model_registry.json`
- `video_lineage_manifest.json`

## Testing requirements

Add and run tests for:

- generic title rejection
- "This gaming story" rejection
- internal QA language rejection
- source mismatch rejection
- thumbnail/title/script mismatch rejection
- missing canonical subject rejection
- missing rights record rejection
- affiliate disclosure rejection
- finance/crypto unsafe wording rejection
- weak first-frame rejection
- unreadable mobile text rejection
- excessive caveat ratio rejection
- repeated visual pattern rejection
- repeated CTA rejection
- platform mirroring detection
- GREEN/AMBER/RED control tower verdicts
- platform-native publish pack generation
- X thread generation
- Instagram carousel generation
- landing page generation
- analytics rule update generation
- correction workflow
- secrets scan
- dry-run publishing mode

Run unit tests, integration tests, render tests where available, forensic QA, caption QA, audio QA, visual QA, policy QA, rights QA, benchmark QA and coherence QA.

No "done" claim without test results and generated proof artefacts.

## Operating modes

LOCAL_PROOF:
- render locally
- no publish
- no OAuth mutation
- no DB mutation unless explicitly allowed
- no external posting
- safe for tests

DRY_RUN_PUBLISH:
- generate all publish packs
- validate platform readiness
- do not publish
- output exact planned actions

HUMAN_REVIEW:
- queue AMBER items for approval
- show risk reasons
- show suggested fixes

AUTO_PUBLISH:
- only GREEN items
- full audit trail
- kill switch enabled
- rollback workflow available

## Final standard

The system must be able to answer these questions for any proposed output:

1. Is the story worth making?
2. Is the source strong enough?
3. Is the angle sharp enough?
4. Is the first frame good enough?
5. Is the title strong enough?
6. Is the script human-quality?
7. Is the footage relevant and rights-safe?
8. Is the edit visually premium?
9. Is the audio professionally mixed?
10. Is it platform-native?
11. Is it commercially useful without being spammy?
12. Is disclosure handled?
13. Is it safe to publish?
14. What will we learn from it?

If any answer is weak, reject or route to human review.

The objective is not to maximise video count. The objective is to build a governed autonomous media studio that produces fewer bad videos, more excellent videos and improves through analytics.

Build sequentially. Prefer robust production architecture over flashy but fragile modules. Do not stop at a renderer. Build the full operating system.
