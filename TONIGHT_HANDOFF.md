# Tonight Handoff

Date: 2026-05-08

## Branch

- Branch: `codex/readiness-qa-failure-window`
- Current base commit before this slice: `3a0dbe1c`
- Latest pushed slice: local proof readiness reports now require accepted Liam voice evidence, safe TikTok diagnostics and clearer Studio V2 motion gates.
- Current working slice: longform confidence gates, voice shootout safety modes, affiliate disclosure/audit gates and expanded monetisation readiness tracking.
- Deployed: no
- Railway/env/Cloudflare/OAuth/production DB/social posting: untouched
- Production renderer and production voice defaults: unchanged

## What Local Checks Now Enforce

- Local Liam TTS is green with the accepted `pulse-sleepy-liam-20260502` reference.
- The old low/demonic local fallback path is blocked.
- Local MP3s now need real pitch, spoken outro and pace evidence before they can be treated as Studio V2 voice-ready.
- Studio V2 proof selection now fails safely instead of pretending weak motion is good enough.
- One-story trailer-reference runs no longer overwrite the canonical batch report unless explicitly requested.
- Official source intake now validates operator-supplied motion references before the resolver can count them.
- Local motion validation now rejects the weak Oblivion trailer windows and records The Division/Tales as one usable clip each, not Flash-ready material.
- TikTok OAuth shape is valid, but local token state is honestly reported as expired/refreshable.
- TikTok dispatch now verifies MP4 and cover file existence, not just DB path strings.
- Facebook Reels eligibility previously looked unblocked and should be watched on the next normal publish.
- Platform readiness doctor now reports TikTok, Facebook Reels and Instagram Reels without OAuth, token mutation, uploads or posts.
- Instagram `2207076` is now operator-visible as rerender/codec QA work, not a same-MP4 retry or URL fallback.
- Learning, comment digest, longform and monetisation tooling are report-only and safe.
- Longform dossier selection now enforces per-format confidence rules, so rumours cannot silently enter Weekly Roundup or Monthly Release Radar segment lists.
- Voice shootout no longer claims samples are reviewable until audio files exist; blocked/pending rows stay in the private map.
- Affiliate links now require a story-specific audit before being written to public story output, and approved public affiliate surfaces carry the Amazon Associate disclosure.
- Monetisation readiness now separates expanded YPP early access from full YPP ad-revenue eligibility and tracks fuller TikTok Creator Rewards prerequisites.

## Current Verdicts

- Local TTS: `GREEN`
- Studio V2 live pilot: `RED_BLOCKED`
- Flash Lane: no ready local proof yet
- Motion acquisition: closest story needs alternate official BioShock and Red Dead sources plus another usable GTA window; any new source must pass `media:intake-official-sources` first
- TikTok: `AMBER`, local token needs refresh/sync and clean MP4 pack
- Platform doctor: `AMBER`, current blockers are TikTok local token sync, TikTok creative-ready MP4 and Instagram rerender after `2207076`
- Analytics learning: `AMBER`, public counters only until YouTube analytics scope is granted
- Longform: local-only, insufficient Weekly Roundup segments after stricter confidence filtering
- Monetisation: pre-monetisation, expanded YPP blocker is currently the 500-subscriber threshold; affiliate safety is branch-only and not deployed

## Validation

- Focused modified-area tests: pass (`141/141` for voice, Studio V2, longform, affiliate and monetisation coverage)
- Full `npm test`: pass (`2283/2283`)
- `npm run build`: pass

## Reports To Read

- `OVERNIGHT_STATUS_SNAPSHOT.md`
- `LOCAL_TTS_OVERNIGHT_REPORT.md`
- `STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md`
- `FLASH_LANE_CURRENT_STATE_REPORT.md`
- `MOTION_ACQUISITION_OVERNIGHT_REPORT.md`
- `ALTERNATE_OFFICIAL_SOURCE_HANDOFF.md`
- `test/output/official_source_intake_report.md`
- `TIKTOK_OVERNIGHT_AUTOMATION_REPORT.md`
- `PLATFORM_READINESS_DOCTOR.md`
- `VOICE_SHOOTOUT_OVERNIGHT_REPORT.md`
- `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md`
- `MONETISATION_OVERNIGHT_REPORT.md`
- `MORNING_APPROVAL_QUEUE.md`

## Best Local Proofs

- Local Liam proof: `D:\pulse-data\media\output\audio\__local_tts_smoke_sleepy_liam_latest.mp3`
- Voice-ready story proof: `D:\pulse-data\media\test\output\local-media-repair\audio\rss_8ea7f2689732f31a_liam.mp3`

## Biggest Remaining Blocker

The voice problem is mostly solved locally. The video quality problem is now the main blocker: Pulse still needs validated gameplay/motion coverage before Studio V2 can look like a high-energy gaming TikTok lane instead of a still-image/card lane.

## Recommended Next Work

1. Find non-exhausted official BioShock, Red Dead and Marathon motion sources, record them in `test/input/official_sources.json`, then validate with `npm run media:intake-official-sources`.
2. Generate a new local Studio V2 proof only after the motion gate is green.
3. Refresh or sync the local TikTok token with Martin present, then test official inbox/draft upload only with a clean pack.
4. Approve YouTube analytics read-only re-auth so the learning loop can use retention and traffic-source data.
5. Review and approve the affiliate-disclosure/audit branch if you want the safer public monetisation copy deployed.
