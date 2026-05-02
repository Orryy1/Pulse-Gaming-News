# Pulse Gaming Deep Forensic Audit

Date: 2026-04-29
Mode: sandbox / read-only production posture
Branch observed: `codex/hermes-sandbox-quality-routing`

This audit inspected the local repository, existing reports, build/test health and local-only diagnostics. No deployment, merge, OAuth flow, production database write, Railway mutation, social posting, env mutation or credential request was performed.

## Executive Verdict

Pulse Gaming is no longer a toy prototype. It has a real autonomous content pipeline, platform uploaders, scheduler, health tooling, Studio V2 research, media inventory scoring, thumbnail safety, analytics skeletons, comment intelligence and monetisation planning.

It is not enterprise-grade yet.

The main issue is not lack of ambition or lack of code. The issue is that multiple strong systems exist in parallel without one strict production contract deciding what may be hunted, rendered, uploaded, promoted or reported as successful.

The highest-impact blockers are:

1. Media inventory is still the creative bottleneck. The latest inventory report classed 9 of 10 stories as `blog_only` and only 1 as `short_only`.
2. Production rendering still appears to use the legacy `assemble.js` path, while the premium Studio V2 work remains mostly experimental and local.
3. Quality gates are partly warn-only. Thin visuals, simple still-image outputs and weak story assets can still progress unless env gates are enabled.
4. Aggregate `npm test` is not healthy because one test hangs, which prevents reliable overnight automation.
5. Platform docs drift from code reality, especially Facebook Reels and Instagram status logging.
6. Some non-gaming or weakly gaming stories still exist in the local story store and need re-score/quarantine, even though newer topicality gates are present.
7. Analytics, comments and monetisation reports are useful skeletons but are mostly fixture/local mode rather than real read-only viewer data.
8. Secret handling has one important logging risk in the Facebook OAuth callback that should be fixed before any future OAuth use.

If the goal is a "million-pound creator studio" feel, the next bottleneck is source material and editorial rejection discipline, not more visual effects.

## Safety Record

Actions performed:

- Read local repo state and reports.
- Ran local build, targeted tests and local ops diagnostics.
- Ran existing read-only system health tooling.
- Generated this local audit report.

Actions not performed:

- No deploy.
- No merge.
- No Railway variable mutation.
- No production database mutation.
- No OAuth flow.
- No social posting.
- No manual publish/produce job.
- No credential request.
- No browser-cookie automation.

## Validation Evidence

Commands run:

```text
git status --short --branch
git log --oneline --decorate -12
npm run build
npm audit --json
npm run ops:system:doctor
npm run ops:media:verify
npm run ops:platform:status
npm run ops:db:backup-dry-run
npm run ops:queue:inspect
npm run studio:v2:dossier
npm run media:inventory
npm run creative:release-radar
npm run intelligence:learning
npm run intelligence:comments
npm run intelligence:monetisation
npm run tiktok:dispatch
node --test --test-reporter=spec tests\services\facebook-reel-verify.test.js
node --test --test-reporter=spec tests\services\instagram-reel-polling.test.js
node --test --test-reporter=spec tests\services\pulse-topicality-gate.test.js
```

Results:

- `npm run build`: pass.
- `npm audit --json`: pass, zero reported vulnerabilities.
- Targeted Facebook Reel tests: 13 passing.
- Targeted Instagram Reel polling tests: 8 passing.
- Targeted topicality gate tests: 7 passing.
- `ops:system:doctor`: pass. Reported deployed commit `8af1517`, scheduler active and production health OK.
- `ops:media:verify`: pass. Checked 10 stories, 8 paths, zero local media issues.
- `ops:platform:status`: pass with warnings. Facebook Reel disabled/page gate, TikTok externally blocked, YouTube enabled, Instagram Reel enabled.
- `ops:db:backup-dry-run`: pass. Local DB exists and backup plan is valid.
- `ops:queue:inspect`: skipped because SQLite queue mode was not enabled locally.
- `studio:v2:dossier`: completed, but release readiness was 0/3 and current channel status was warn.
- `media:inventory`: completed. 10 stories analysed, 9 `blog_only`, 1 `short_only`.
- `creative:release-radar`: completed in fixture mode.
- `intelligence:learning`: completed in fixture/local mode.
- `intelligence:comments`: completed in fixture/local mode.
- `intelligence:monetisation`: completed in fixture/local mode.
- `tiktok:dispatch`: completed and produced dispatch artefacts.

Aggregate test status:

- `npm test` timed out.
- A per-file capped scan found 109 test files passing and 1 timeout: `tests\services\overnight-workshop.test.js`.
- The hanging test must be fixed before trusting all-day or overnight autonomous work.

## Current Artefacts Reviewed

Key generated reports inspected:

- `test/output/system_doctor.md`
- `test/output/system_doctor.json`
- `test/output/platform_status.md`
- `test/output/platform_status.json`
- `test/output/media_inventory_report.md`
- `test/output/media_inventory_report.json`
- `test/output/studio_v2_qa_dossier.md`
- `test/output/studio_v2_gauntlet.md`
- `test/output/learning-digest/digest-2026-04-29.md`
- `test/output/comment-digest/comments-2026-04-29.md`
- `test/output/monetisation/monetisation-2026-04-29.md`
- `test/output/tiktok_dispatch_manifest.md`

Important conclusion from these artefacts:

The system has many useful diagnostics, but the diagnostics are not yet one unified release gate. Operators can see useful truth after running several tools, but production still needs one simple "safe to publish / not safe to publish / why" report.

## System Maturity Scorecard

| Area | Score | Verdict |
| --- | ---: | --- |
| Scheduler and production heartbeat | 7/10 | Real system, good diagnostics, but schedule sprawl and env-gated jobs need tighter governance |
| Platform uploaders | 6/10 | YouTube strong, Instagram observable but flaky, Facebook Reels externally gated, TikTok externally blocked |
| Render quality | 6/10 | Studio V2 research is strong, production lane still not premium by default |
| Media acquisition | 5/10 | Many sources exist, but latest inventory proves most stories lack premium visual material |
| Thumbnail safety | 6/10 | Good heuristics, needs actual no-identity face/person detection and frame-level QA |
| Topicality and brand safety | 7/10 | New hard gate exists, existing queue still needs quarantine/re-score |
| Analytics intelligence | 4/10 | Good schema and digest design, mostly fixture/local data |
| Comment intelligence | 5/10 | Good draft-only safety, taxonomy duplicated across modules |
| Monetisation architecture | 4/10 | Roadmap exists, real business telemetry not yet connected |
| Security posture | 6/10 | Good env hygiene, but OAuth logging risk must be fixed |
| Test/build reliability | 6/10 | Build and targeted tests pass, aggregate test suite hangs |
| Documentation | 5/10 | Lots of docs, several are stale against current code and platform findings |
| Operator usability | 6/10 | Many commands exist, but no single executive operator console yet |

## Project Structure Findings

Main runtime:

- `run.js`: command entrypoint for hunt, approve, produce, publish and schedule modes.
- `server.js`: Express API, dashboard backend and autonomous endpoints.
- `publisher.js`: production orchestration for approve, produce and publish.
- `lib/scheduler.js`: cron schedule and job enqueueing.
- `lib/bootstrap-queue.js`: queue bootstrap.
- `lib/services/jobs-runner.js`: queued job execution.

Rendering and media:

- `assemble.js`: current production ffmpeg render path.
- `images_download.js`: article, Steam, IGDB, article inline, Reddit, stock and b-roll acquisition.
- `images.js`: branded card image generation.
- `images_story.js`: story/social card image generation.
- `lib/studio/`: Studio V2/V2.1 research systems.
- `lib/creative/`: media inventory, thumbnail safety, release radar and format tooling.

Platforms:

- `upload_youtube.js`
- `upload_facebook.js`
- `upload_instagram.js`
- `upload_tiktok.js`
- `upload_twitter.js`

Intelligence:

- `lib/intelligence/`
- `lib/performance/`
- `lib/comments/`
- `db/migrations/017_intelligence_layer.sql`
- `db/migrations/018_live_performance_model.sql`

Operations:

- `tools/ops/`
- `tools/render-health.js`
- `tools/tiktok-build-dispatch.js`
- `tools/creative/`
- `tools/studio-*`

Dashboard:

- `src/`
- `dist/`
- `server.js` API endpoints.

## Branch And Release Hygiene

Observed:

- Current branch is `codex/hermes-sandbox-quality-routing`.
- `origin/main` appears to point at commit `8af1517`.
- The local branch also points at `8af1517`.
- Local `main` history was not assumed safe.
- Worktree has uncommitted modified files and many untracked artefacts from other active work.

Risk:

Claude Code is also working in this repo. Concurrent commits and untracked artefacts can easily cause mistaken promotion, lost work or false confidence.

Improvements:

1. Adopt one rule: every agent writes to a named branch and never directly to `main` unless explicitly performing a reviewed promotion.
2. Add a `tools/ops/branch-safety.js` command that reports:
   - current branch
   - upstream branch
   - divergence from origin/main
   - uncommitted tracked files
   - untracked files under risky directories
   - whether deployment should be blocked
3. Add a `npm run ops:promotion:preflight` script combining branch safety, tests, build, docs freshness and deploy target verification.
4. Keep `test/output` artefacts untracked unless they are small reports required for review.

## Production Operations Findings

Good:

- `ops:system:doctor` provides a useful status report.
- Health tooling detected deployed commit and scheduler active state.
- `ops:media:verify` and `ops:platform:status` are useful.
- DB backup dry run exists and passed locally.
- Production health reported OK during the read-only check.

Gaps:

- There are many separate ops commands, but no single "operator cockpit" report that merges queue, platform, render, media, analytics and scheduler status.
- Queue inspect skipped locally because SQLite queue mode was not enabled.
- Some newly added overnight/live analyst schedules are env-gated, but the aggregate test hang makes them unsafe to enable.
- Schedule sprawl is becoming a governance issue.

Improvements:

1. Build `npm run ops:daily:control-room`.
   - Inputs: system doctor, platform status, media verify, queue inspect, render-health, latest publish summary and recent logs.
   - Outputs: one JSON and one Markdown file with a final verdict.
2. Add an "operator under 2 minutes" rule:
   - Green: publish safe.
   - Amber: publish possible but watch listed risks.
   - Red: do not publish.
3. Add schedule registry validation:
   - every schedule has owner, env gate, expected frequency, mutation risk and runbook link.
4. Add a daily "what is live" report to prevent docs/code drift.

## Scheduler And Queue Findings

Good:

- Queue mode and schedule planning are explicit.
- Jobs are separated into handlers.
- Many risky tasks are env-gated.
- Discord reporting exists.

Risks:

- `lib/intelligence/overnight-workshop.js` has a timeout wrapper around `publisher.produce()`, but the underlying production work is not cancelled when the timeout fires. This can report a timeout while work continues in the background.
- New long-running background jobs should not be enabled until the hanging test is fixed.
- Failed job visibility is better than early versions but should become operator-first, not log-first.

Improvements:

1. Fix `tests\services\overnight-workshop.test.js`.
2. Make long produce operations single-flight:
   - lock file or DB lock
   - clear state transitions
   - no overlapping produce/publish
3. Replace fake cancellation via `Promise.race` with:
   - child-process worker that can be killed safely, or
   - no timeout claim until work actually stops.
4. Add queue state categories:
   - waiting
   - running
   - stale_running
   - failed_retryable
   - failed_terminal
   - skipped_by_gate
5. Include skipped-by-quality reasons in Discord and status reports.

## Platform Publishing Findings

### YouTube

Status:

- Core proven path.
- Upload metadata and thumbnail support are present.
- OAuth scopes include YouTube analytics readonly in `upload_youtube.js`.

Risks:

- `lib/intelligence/analytics-client.js` had stale analytics-scope wording, which created confusion before this maintenance pass.
- Public stats endpoint in `server.js` can query arbitrary YouTube IDs and may waste quota unless cached or protected.

Improvements:

1. Update analytics client docs/comments to match actual scopes.
2. Cache or protect `/api/stats/:postId`.
3. Add uploaded video ID persistence checks into `ops:platform:status`.
4. Add a YouTube upload post-check:
   - video ID exists
   - title set
   - thumbnail candidate generated
   - visibility expected
   - Discord summary includes exact output.

### Facebook Reel

Status:

- Current code no longer trusts `publishing_phase.status=complete` alone.
- Tests assert the old processing-complete combination is not public success.
- Facebook Reel appears disabled/page gated.

Important:

Older instructions treated Graph processing completion as success. Current empirical finding says that was a false positive because Meta showed zero videos/reels on the Page. The current code is stricter and safer.

Docs drift:

- Some docs still say ready/complete should be success or live proof is pending.

Improvements:

1. Update all docs to current truth:
   - success requires visible published/permalink evidence, not only complete.
   - disabled/page_not_eligible is not a code failure.
2. Add weekly read-only eligibility probe output, but do not mutate env.
3. Keep Facebook Card fallback clearly labelled as the active Facebook route.

### Facebook Card

Status:

- Working fallback route according to platform status and prior observations.

Risk:

- It can mask Reel failure if reporting is not explicit.

Improvements:

1. Discord summary should show:
   - Facebook Reel: skipped_page_not_eligible
   - Facebook Card: posted/succeeded/failed
2. Do not present Facebook as fully successful if only the card path worked.

### Instagram Reel

Status:

- Code preserves `status_code`, `status` and Graph error details where Graph returns them.
- Code documents that Graph rejects `error_code,error_subcode,error_message` as requested container fields.
- Timeout classification exists: `pending_processing_timeout`.
- Tests pass.

Risks:

- `IN_PROGRESS` can later complete after local timeout.
- If the verifier is not scheduled/enabled, operators may see a false final failure.
- Story fallback and Reel fallback should have separate structured reports.

Improvements:

1. Keep delayed verifier default-off unless safely configured.
2. Add a local pending-processing ledger:
   - container ID
   - creation ID
   - first seen
   - last checked
   - final status
3. Show `pending_processing_timeout` as pending, not generic fail.
4. Add a Discord message: "No retry started. Delayed verifier required."

### Instagram Story

Status:

- Needs exact live failure reason when it does not appear.

Improvements:

1. Ensure IG Story uses a known valid story-card asset, not the Reel MP4.
2. Store and report:
   - asset path
   - media type
   - container ID
   - creation ID
   - error payload
   - Graph response IDs
3. Add parity check with Facebook Card asset:
   - same source image or separate generated image
   - size
   - MIME
   - public URL reachability if URL path

### TikTok

Status:

- TikTok official API remains externally blocked by app review / Direct Post approval.
- Current code uses `FILE_UPLOAD` and has scope/privacy handling.
- Dispatch mode exists and generated local artefacts.

Improvements:

1. Stop treating TikTok as a code-only issue.
2. Use TikTok Live Dispatch as the operational bridge:
   - MP4
   - caption
   - hashtags
   - cover
   - urgency score
   - recommended post time
   - phone-friendly instructions
   - future scheduler payload
3. Research and test true third-party scheduler auto-publish separately.
4. Reapply to TikTok API later with business/media-tool framing.
5. Keep VA as last resort.

### X / Twitter

Status:

- Intentionally disabled.

Recommendation:

- Leave disabled until core YouTube, Instagram and TikTok workflows are stable.

## Platform Documentation Drift

The code and the docs disagree in several places.

High-risk examples:

- Facebook Reel success condition.
- Railway/deployed commit references in operations docs.
- Local branch names in operations docs.
- TikTok current route status.
- Analytics scope notes.

Fix:

Create `npm run docs:platform-consistency` to scan known docs for stale phrases:

- old Facebook Reel processing-complete success language
- old commit IDs
- obsolete branch names
- stale live-proof wording after a definitive finding exists
- stale analytics-scope wording after scope support exists

## Source, Topicality And Brand Safety Findings

Good:

- A Pulse topicality hard gate exists.
- Tests cover:
  - House of the Dragon Season 3 reject
  - Nintendo Switch 2 games accept
  - MindsEye update/price cut accept
  - Xbox Game Pass price accept
  - Elden Ring movie casting review/reject
  - Marvel/Netflix/TV reject

Risks:

- Existing local story stores still contain off-brand or weakly relevant items.
- Some reports include clearly questionable items:
  - James Bond theme song coverage
  - CPU animation novelty
  - congressional parent policy item
- These may be in local status only, but the system should actively quarantine them.

Improvements:

1. Add `npm run content:reclassify-existing`.
   - Re-run topicality and visual inventory over current story store.
   - Mark off-brand stories as `rejected_topicality`.
   - Do not mutate production DB without approval.
2. Add a separate lane for future entertainment expansion:
   - `entertainment_review`
   - never auto-publish on Pulse Gaming.
3. Add topic-source confidence:
   - gaming primary source
   - mainstream gaming outlet
   - entertainment outlet covering game adaptation
   - general entertainment source
4. Hard rule:
   - Pulse Gaming can cover a TV/film story only when the game or game company is the primary subject, not when a celebrity or show is the primary subject.

## Media Acquisition Findings

Good:

- Article `og:image`.
- Steam store images.
- Steam appdetails movie/trailer extraction.
- IGDB cover/screenshots.
- Article inline images.
- Reddit thumbnails.
- Company logos.
- Optional YouTube b-roll fallback.
- SSRF-safe URL handling.

Risks:

- Many stories still have no useful media.
- Stock fallbacks remain present and can weaken brand perception.
- B-roll source/lawfulness risk varies by origin.
- Asset provenance is not yet first-class enough for a premium operation.
- Two media inventory systems exist:
  - `lib/media-inventory.js`
  - `lib/creative/media-inventory-scorer.js`

Improvements:

1. Make asset provenance mandatory:
   - source URL
   - source type
   - detected content type
   - licence/risk class
   - story relevance score
   - thumbnail safety verdict
   - reason accepted/rejected
2. Consolidate to one canonical media inventory scorer.
3. Add perceptual hash dedupe across stills and extracted frames.
4. Add official-first acquisition priority:
   - official trailer
   - publisher press kit
   - Steam/IGDB screenshots
   - official store art
   - article hero
   - article inline
   - logo/platform UI
   - stock only for non-premium card backgrounds, not story evidence.
5. Add `visual_inventory_class` as a hard production input:
   - premium_video
   - standard_video
   - short_only
   - blog_only
   - reject_visuals
6. Stop forcing 60 second premium videos from weak inventories.

## Thumbnail Safety Findings

Good:

- `lib/thumbnail-safety.js` rejects likely author/profile/avatar/headshot/portrait images unless the person is named/relevant.
- It penalises stock people.
- It prefers game/platform art.
- Thumbnail candidate generation exists.

Risks:

- Current detection is heuristic and metadata-based. It does not actually inspect pixels for faces or people.
- YouTube Shorts may select any frame, not only `thumbnail_candidate.png`, so unsafe frames inside the video still matter.
- Weak imagery can still become thumbnail-selected if it appears in the first or most salient frames.

Improvements:

1. Add local no-identity person/face detection.
   - Detect presence/type only.
   - Do not identify people.
   - Use OpenCV, MediaPipe or a lightweight local model.
2. Run detection over:
   - downloaded images
   - generated thumbnail candidate
   - first 5 seconds of rendered video
   - contact sheet candidate frames.
3. Add hard fail:
   - unknown human face in thumbnail candidate
   - unknown human face in first-second frame
   - article author/profile/avatar asset selected
4. Add YouTube Shorts frame strategy:
   - make first frame, 1s frame and central high-salience frames all thumbnail-safe.
   - avoid putting random human images anywhere early.
5. Store `thumbnail_safety.json` per story.

## Render System Findings

Current state:

- Studio V2 canonical remains the best proven premium sample.
- Studio V2 local research has strong architecture and useful gates.
- Production `produce()` still appears to use `assemble.js`, not Studio V2, for normal scheduled production.
- Latest Studio V2 dossier was not release-ready.

Strengths:

- ffmpeg backbone is appropriate.
- HyperFrames has won card lane locally.
- QA dossier and gauntlet exist.
- Studio canonical protection exists conceptually.

Risks:

- Studio V2 and production lane mismatch creates false confidence.
- The system can produce "simple still image" videos if media inventory is thin.
- `images.js` introduces subtle random visual variation, which may hurt deterministic QA and brand consistency.
- Reports show `blog_only` for most stories, so the render lane is often starved before it starts.

Improvements:

1. Define one production render contract:
   - what renderer is used
   - what quality gates are hard
   - what lane was used
   - what failed and why.
2. Make `render_lane` visible in every Discord summary.
3. If Studio V2 expected but legacy fallback used, mark amber or fail before publish.
4. Enable hard block for thin visuals after an acquisition retry:
   - no direct upload of weak still-only render unless manually approved.
5. Keep canonical Studio V2 as reference, not automatically replaced by V2.1.
6. Continue HyperFrames for cards, not full-video migration.
7. Add "first-frame thumbnail-safe" and "outro present" as hard gates for Shorts.

## Studio V2 Findings

Evidence:

- `test/output/studio_v2_gauntlet.md` keeps canonical as a strong known-good candidate.
- `test/output/studio_v2_qa_dossier.md` reported current channel warn and 0/3 release-ready.
- Some current multi-channel renders have true-peak or readiness warnings.

Recommendations:

1. Treat Studio V2 canonical as a research gold sample.
2. Do not promote V2.1 or authored probes unless they beat canonical on:
   - gauntlet
   - forensic QA
   - source diversity
   - beat awareness
   - subtitle QA
   - no audio recurrence
   - human visual review.
3. Add a "render candidate promotion packet":
   - MP4
   - contact sheet
   - gauntlet JSON
   - forensic JSON
   - subtitle status
   - thumbnail safety report
   - side-by-side comparison.
4. If media inventory is thin, do not try to make hero moments compensate.

## Script And Editorial Findings

Good:

- Script validation exists.
- British English requirements exist.
- Hook/body/loop contract exists.
- Some AI-tell checks exist.

Risks:

- Weak source material can still produce generic scripts.
- Mojibake and HTML entities appear in reports, which can leak into public-facing output if not normalised.
- Some output still contains awkward encoded punctuation.

Improvements:

1. Add a text hygiene gate:
   - decode HTML entities
   - repair mojibake where possible
   - reject broken encoded text in title/script/captions.
2. Add "source confidence language" validator:
   - rumours require "reportedly" style language.
   - confirmed stories do not over-hedge.
3. Add editorial density scoring:
   - no filler phrases
   - no generic "fans are excited" without evidence
   - no repeated sentence structures.
4. Add a separate "off-brand entertainment tone" detector.

## Audio Findings

Good:

- Production voice issue has been solved outside this audit.
- TTS uses ElevenLabs.
- Studio V2 audio analysis exists.
- Audio recurrence issue was identified in previous experiments.

Risks:

- Multi-channel Studio reports include true-peak warnings.
- The render path can include weird recurring sound effects if SFX is not tightly governed.
- Background music and SFX need deterministic recurrence checks.

Improvements:

1. Add an audio QA report to every render:
   - integrated loudness
   - true peak
   - speech/music ducking
   - repeated SFX fingerprint
   - dropout detection
2. Keep SFX sparse and semantically tied to edit beats.
3. Add a "no recurring novelty sound" gate.
4. Do not judge creative render quality until production voice path and audio mix match production.

## Analytics Intelligence Findings

Good:

- Analytics schema and digest pipeline exist.
- Fixture/local learning digest works.
- Real read-only mode is gated by env.
- Snapshot concepts are sensible.

Risks:

- Current digest appears fixture/local, not real YouTube Analytics data.
- Scopes/comments in code are stale in places.
- It should not auto-change scoring yet.

Improvements:

1. Wire read-only YouTube Analytics in a deliberately operator-approved mode.
2. Store snapshots at:
   - 1h
   - 3h
   - 24h
   - 72h
   - 7d
   - 28d
3. Join video features to render metadata:
   - render lane
   - media inventory class
   - clip ratio
   - thumbnail safety verdict
   - source type
   - topic type
   - hook type.
4. Add confidence labels:
   - tiny sample
   - weak signal
   - emerging signal
   - reliable signal.
5. Keep learning recommendation-only until sample sizes are meaningful.

## Comment Intelligence Findings

Good:

- Draft-only comment copilot exists.
- No real replies are sent by current design.
- Comment digest and reply queue can be produced locally.

Risks:

- Duplicate taxonomy exists across `lib/comments` and `lib/intelligence`.
- Categories differ slightly, which will make analytics messy.
- Draft replies must stay conservative.

Improvements:

1. Consolidate to one comment taxonomy:
   - hype_positive
   - simple_support
   - correction
   - disagreement
   - useful_criticism
   - topic_suggestion
   - question
   - joke_meme
   - hostile_but_useful
   - abuse_spam
   - low_value_noise
2. Consolidate decision outcomes:
   - draft_reply_candidate
   - needs_review
   - no_reply_needed
   - moderation_review
   - ignore
3. Add "viewer signal" extraction:
   - confusion
   - requested platform
   - requested franchise
   - correction
   - price sensitivity
   - feature demand
4. Never auto-send until a separate moderation policy and audit log exists.

## Monetisation Findings

Good:

- Monetisation roadmap and tracker exist.
- YPP, Shorts, affiliate, sponsorship and newsletter concepts are present.

Risks:

- Current monetisation reports are not fully real-data-backed.
- Product/affiliate links need stricter policy and disclosure.
- The channel should not optimise for revenue before retention and trust.

Improvements:

1. Build a real monetisation dashboard from:
   - YouTube subscribers
   - YouTube watch hours
   - Shorts views
   - affiliate clicks
   - newsletter subscribers
   - blog traffic
   - sponsor leads.
2. Add disclosure templates for affiliate links.
3. Add brand safety categories for advertiser-friendly content.
4. Build long-form formats only when media inventory and fact-checking support them.

## Format Architecture Findings

Good:

- Monthly Release Radar prototype exists and generates rich artefacts.
- Format-led strategy is correct.

Risks:

- Current release radar output is fixture-based.
- "Top 10 new games next month" is high-risk without verified release dates.
- The fact-check gate must be stronger before public use.

Improvements:

1. Build real source candidate ingestion from verified release calendars:
   - platform stores
   - publisher pages
   - official trailers
   - Steam upcoming releases
   - console stores
   - reputable gaming outlets.
2. Every candidate needs:
   - release date
   - platforms
   - source URL
   - confidence
   - region caveat
   - visual inventory class.
3. Output all uncertain candidates as "manual review", not public fact.
4. Build evergreen format templates:
   - Daily Shorts
   - Daily Briefing
   - Weekly Roundup
   - Monthly Release Radar
   - Before You Download
   - Trailer Breakdown
   - Rumour Radar
   - Blog-only / reject.

## Dashboard And Operator UX Findings

Good:

- Dashboard app exists.
- API endpoints exist for news, status and publishing.
- Platform status and story lists are visible.

Risks:

- Operator cannot yet see one final publish readiness verdict per story.
- Production vs local vs experimental lane can be unclear.
- Buttons can trigger publish paths if auth is available.

Improvements:

1. Add story readiness badge:
   - topicality
   - visual inventory
   - thumbnail safety
   - render lane
   - content QA
   - platform readiness.
2. Add "why blocked" panel.
3. Add "this will post publicly" confirmation before publish endpoints.
4. Add platform route state:
   - YouTube active
   - TikTok dispatch only
   - Instagram Reel pending/failing
   - Instagram Story active/failing
   - Facebook Card active
   - Facebook Reel disabled/page gate.
5. Add a render contact sheet preview before approval.

## Security And Secret Handling Findings

Good:

- `.gitignore` excludes `.env`, tokens, output and data.
- Tracked env files are examples only.
- Token values were not printed during this audit.
- Platform error formatters generally avoid raw tokens.

P0 risk:

- `server.js` Facebook OAuth callback constructs env update strings containing `FACEBOOK_PAGE_TOKEN` and `INSTAGRAM_ACCESS_TOKEN`, then logs them to server output.

Why this matters:

- Production logs can retain secrets.
- Even if OAuth is not used tonight, this should be fixed before any future OAuth flow.

Required fix:

- Never log token values.
- Log only:
  - token present
  - token fingerprint prefix/suffix
  - expiry if safe
  - exact variable names that need updating.
- Provide a secure operator instruction path outside logs.

Additional hardening:

1. Protect or cache public stats endpoint.
2. Add rate limiting to mutation endpoints.
3. Add audit logs for approval and publish actions.
4. Keep OAuth endpoints disabled unless explicitly needed.

## Data And Database Findings

Good:

- SQLite migrations exist.
- Backup dry-run exists.
- Intelligence tables exist.

Risks:

- `lib/performance/schema.sql` overlaps with migrations.
- Local status warned that SQLite DB path may be ephemeral in production if not mapped to volume.
- Existing story rows may need reclassification after new topicality/visual gates.

Improvements:

1. Make DB path check a hard production health signal.
2. Add schema drift checker:
   - migrations applied
   - expected tables exist
   - indexes exist
   - DB path is persistent in production.
3. Build read-only quarantine report for existing rows:
   - off-brand
   - no visuals
   - stale media paths
   - platform IDs without media.
4. Do not mutate production rows without explicit approval.

## Encoding And Text Hygiene Findings

Observed:

- Reports contain mojibake such as `â€”`, `Â·`, `PokÃ©mon`, `â‰¥` and HTML entities like `&amp;`.

Impact:

- Public titles, captions, descriptions or reports with broken encoding make the system look amateur.

Improvements:

1. Add a text normalisation module:
   - decode HTML entities
   - normalise Unicode
   - detect likely mojibake
   - reject public-facing text with broken encoding.
2. Add tests with:
   - Pokemon/Pokémon
   - em dash / en dash handling
   - ampersands
   - curly quotes.
3. Add a public-output text QA gate before rendering/upload.

## Testing Findings

Good:

- Broad test coverage exists.
- Targeted platform and topicality tests pass.
- 109 test files passed in per-file scan.
- Build passes.

Critical gap:

- Aggregate `npm test` currently times out.
- Timeout isolated to `tests\services\overnight-workshop.test.js`.

Likely root causes to investigate:

- Test opens real repo/db handles in one env-enabled path.
- `runOvernightProduceSweep` timeout does not cancel underlying `publisher.produce()`.
- Asynchronous work may continue after test returns.

Required fixes:

1. Make `overnight-workshop` tests fully dependency-injected.
2. Ensure every DB handle closes.
3. Ensure timed-out work cannot continue in background during tests.
4. Add `--test-timeout` at script level only after the root issue is fixed.
5. Keep full `npm test` as a promotion gate.

## Documentation Findings

Good:

- Extensive docs exist.
- Runbooks, roadmaps and system maps are valuable.

Risks:

- Some docs are stale against code and platform findings.
- Stale docs can cause unsafe operational decisions.

Examples:

- `README_OPERATIONS.md` references older commit/branch state.
- `DEPLOYMENT_RUNBOOK.md` still contains old Facebook Reel success assumptions.
- `PULSE_ENTERPRISE_ROADMAP.md` contains now-outdated live-proof language.
- `PLATFORM_STATUS.md` needs alignment with current Facebook/Instagram/TikTok truth.

Improvements:

1. Add doc freshness metadata to major runbooks:
   - last verified date
   - verified commit
   - owner
   - command used to verify.
2. Generate platform status docs from live/local diagnostic JSON where possible.
3. Add `docs:doctor` script that flags stale known phrases.

## Files That Must Not Be Touched Without Approval

Do not edit or mutate these without explicit operator approval:

- `.env`
- `tokens/`
- production Railway variables
- production Railway volumes
- production SQLite database rows
- OAuth credential files
- social platform credentials
- deploy configuration that changes production behaviour
- cron/scheduler production env settings
- manual publish scripts in a way that triggers posting
- generated production media on mounted volumes

High-caution code paths:

- `publisher.js`
- `run.js`
- `server.js`
- `lib/scheduler.js`
- `lib/services/jobs-runner.js`
- `upload_youtube.js`
- `upload_facebook.js`
- `upload_instagram.js`
- `upload_tiktok.js`
- `assemble.js`
- `lib/media-paths.js`

## P0 Roadmap

Do these before the next confident deploy.

1. Fix aggregate test hang.
   - Target: `tests\services\overnight-workshop.test.js`
   - Outcome: full `npm test` completes.
2. Fix Facebook OAuth secret logging in `server.js`.
   - Outcome: no token values ever appear in logs.
3. Update stale platform docs.
   - Outcome: docs match current code and empirical findings.
4. Make media inventory fail-closed after acquisition retry.
   - Outcome: weak visual stories do not become weak videos by default.
5. Add a reclassification/quarantine report for existing stories.
   - Outcome: off-brand and zero-inventory items are visible before publish.
6. Add one operator control-room report.
   - Outcome: a single command gives publish readiness in under 2 minutes.

## P1 Roadmap

Do soon.

1. Consolidate media inventory scoring systems.
2. Consolidate comment classifier taxonomy.
3. Add no-identity face/person detection for thumbnail and early-frame QA.
4. Protect or cache `/api/stats/:postId`.
5. Add delayed Instagram verifier ledger.
6. Make `render_lane` and `visual_inventory_class` visible in every Discord publish summary.
7. Add text encoding/mojibake QA gate.
8. Add source provenance ledger for every downloaded media asset.
9. Connect read-only YouTube Analytics snapshots when safe.
10. Add dashboard readiness badges.

## P2 Roadmap

Do after P0/P1 stabilise.

1. Promote a Studio V2 production lane only when it beats legacy production on real stories and passes all gates.
2. Build official trailer/press-kit acquisition more deeply.
3. Build true monthly release radar from verified real sources.
4. Build blog/newsletter publishing pipeline as review-only first.
5. Build TikTok scheduler route integrations after external research.
6. Add sponsor/media-kit generation from real analytics.
7. Add automated A/B idea generation without automatic publish.

## P3 / Later

1. Multi-channel expansion beyond Pulse Gaming.
2. Browser/RPA TikTok posting experiments on a test account only.
3. Fully autonomous learning weight changes.
4. Auto-comment replies.
5. New platform expansion.

## Do Not Do

- Do not chase TikTok API code rewrites until app approval changes.
- Do not treat Facebook Reel `complete` status as proof of public publishing.
- Do not enable overnight/live analyst schedules while full tests hang.
- Do not promote Studio V2.1 because it is more complex.
- Do not use stock people or generic portraits to fill weak videos.
- Do not publish off-brand entertainment stories on Pulse Gaming.
- Do not optimise for viral claims before retention and viewer evidence.
- Do not add more SFX or visual tricks until media inventory and render gates are strict.
- Do not auto-send comment replies.
- Do not auto-change scoring weights from early analytics.

## Target Architecture For A Premium Media Operation

The future system should look like this:

```text
Source intake
  -> topicality gate
  -> source credibility gate
  -> media inventory scorer
  -> format router
  -> editorial script contract
  -> render lane selector
  -> thumbnail safety and frame QA
  -> platform readiness gate
  -> publish queue
  -> post-publish verifier
  -> analytics/comment ingestion
  -> learning digest
  -> experiment planner
```

Every arrow should be observable, deterministic and explainable.

No story should reach upload just because it exists. It should reach upload because it is topical, sourced, visually supportable, renderable, safe, platform-ready and expected to teach the system something useful.

## What Would Make Pulse Feel Expensive

1. Stop publishing weak inputs.
2. Use fewer but stronger stories.
3. Build every Short around official clips, screenshots or game UI whenever possible.
4. Make first-frame and thumbnail-selected frames look intentional.
5. Keep captions clean and legible.
6. Use branded cards sparingly and only when editorially justified.
7. Remove stock filler and random people.
8. Build repeatable formats, not one-off random news items.
9. Let analytics decide format direction slowly, not impulsively.
10. Make every platform status honest, even when the answer is "blocked".

## Commercial Direction

Best monetisation path:

1. Stabilise YouTube Shorts and increase retention.
2. Use Shorts to discover winning franchises/topics.
3. Convert winners into Weekly Roundup, Trailer Breakdown and Monthly Release Radar.
4. Build blog/newsletter assets from the same research.
5. Add affiliate links only where naturally useful.
6. Build sponsor/media kit after repeatable real analytics.
7. Expand channels only after Pulse Gaming has a reliable operating model.

The system should become a media flywheel, not a pile of automations.

## Final Judgement

Pulse Gaming is healthier than a normal side-project and has the right bones for an automated media operation. It is not yet enterprise-grade because the gates are not strict enough, the premium render is not the production default, the test suite does not complete, docs drift from code and most current stories do not have enough visual material for premium video.

The biggest remaining bottleneck is media inventory, followed by production promotion discipline.

Before any serious deploy:

1. Make full tests complete.
2. Fix secret logging.
3. Update platform docs.
4. Quarantine off-brand and weak-visual stories.
5. Ensure the next publish summary tells the truth about every platform route.

The highest-leverage next build is a unified publish-readiness control-room report that combines topicality, media inventory, render lane, thumbnail safety, platform status, tests and production health into one verdict.
