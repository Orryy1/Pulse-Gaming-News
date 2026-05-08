# Tonight Handoff

Date: 2026-05-08

## Branch

- Branch: `codex/readiness-qa-failure-window`
- Current base commit before this slice: `f51f8895`
- Latest pushed slice: local Liam voice shootout sample generation under `test/output`.
- Current working slice: Studio V2/Flash Lane wrong-story exact asset zero tolerance.
- Deployed: no
- Railway/env/Cloudflare/OAuth/production DB/social posting: untouched
- Production renderer and production voice defaults: unchanged

## What Local Checks Now Enforce

- Local Liam TTS is green with the accepted `pulse-sleepy-liam-20260502` reference.
- The old low/demonic local fallback path is blocked.
- Local MP3s now need real pitch, spoken outro and pace evidence before they can be treated as Studio V2 voice-ready.
- Studio V2 proof selection now fails safely instead of pretending weak motion is good enough.
- Flash Lane proof selection now blocks any wrong-story exact asset immediately, even if it is only one item in an otherwise large deck.
- The GTA/Take-Two proof is now routed to visual-evidence repair because unrelated exact assets are still contaminating the deck.
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
- Voice shootout can now generate explicit local Liam benchmark samples under `test/output/voice-shootout/audio` without calling external APIs, spending credits or switching production voice.
- Affiliate links now require a story-specific audit before being written to public story output, and approved public affiliate surfaces carry the Amazon Associate disclosure.
- Monetisation readiness now separates expanded YPP early access from full YPP ad-revenue eligibility and tracks fuller TikTok Creator Rewards prerequisites.
- Monetisation reports now show where each major metric came from: fixture, file, env override, local SQLite or missing default.
- Local monetisation mode currently sees 23 YouTube public uploads in the last 90 days and 10,768 local YouTube views, but subscriber, TikTok, blog and newsletter counts still need explicit operator/analytics sources.

## Current Verdicts

- Local TTS: `GREEN`
- Studio V2 live pilot: `RED_BLOCKED`
- Flash Lane: no ready local proof yet
- Motion acquisition: closest story needs alternate official BioShock and Red Dead sources plus another usable GTA window; any new source must pass `media:intake-official-sources` first
- TikTok: `AMBER`, local token needs refresh/sync and clean MP4 pack
- Platform doctor: `AMBER`, current blockers are TikTok local token sync, TikTok creative-ready MP4 and Instagram rerender after `2207076`
- Analytics learning: `AMBER`, public counters only until YouTube analytics scope is granted
- Longform: local-only, insufficient Weekly Roundup segments after stricter confidence filtering
- Monetisation: pre-monetisation, expanded YPP blocker is currently the 500-subscriber threshold; affiliate safety and local state provenance are branch-only and not deployed
- Voice shootout: `AMBER_READY_FOR_LOCAL_BENCHMARKS`, with 2 local Liam samples generated for blind review

## Validation

- Latest focused voice tests: pass (`36/36`)
- Latest dry-run: `npm run voice:shootout -- --out-dir test/output/voice-shootout --no-root --generate-local-liam --dry-run --limit 2`
- Latest local apply: `npm run voice:shootout -- --out-dir test/output/voice-shootout --no-root --generate-local-liam --apply-local --limit 2` generated 2 local Liam benchmark MP3s
- Latest Studio V2 focused tests: pass (`38/38`)
- Full `npm test`: pass (`2294/2294`)
- `npm run build`: pass
- `git diff --check`: pass with CRLF warnings only

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
- Voice shootout samples: `test/output/voice-shootout/audio/voice_shootout_prices_voxcpm2_1.mp3` and `test/output/voice-shootout/audio/voice_shootout_game_titles_voxcpm2_1.mp3`

## Biggest Remaining Blocker

The voice problem is mostly solved locally. The video quality problem is now the main blocker: Pulse still needs exact, uncontaminated subject decks plus validated gameplay/motion coverage before Studio V2 can look like a high-energy gaming TikTok lane instead of a still-image/card lane.

## Recommended Next Work

1. Rerun exact-subject acquisition for `rss_5b3abe925b27a199` with the story entity filter before any further Studio V2 proof render.
2. Find non-exhausted official BioShock, Red Dead and Marathon motion sources, record them in `test/input/official_sources.json`, then validate with `npm run media:intake-official-sources`.
3. Generate a new local Studio V2 proof only after the visual evidence and motion gates are green.
4. Refresh or sync the local TikTok token with Martin present, then test official inbox/draft upload only with a clean pack.
5. Approve YouTube analytics read-only re-auth so the learning loop can use retention and traffic-source data.
