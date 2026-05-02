# Platform, Voice and Flash Lane Report - 2026-05-02

## What changed

- TikTok dispatch now treats the official inbox/draft route as the safest near-term lane.
- TikTok inbox uploads now have a status-fetch helper and the inbox command plan can record `SEND_TO_USER_INBOX` style results without public posting.
- TikTok dispatch now voice-gates existing final MP4s before recommending them. Old renders without approved voice metadata are marked `voice_review_required`, not `ready`.
- Facebook Reels eligibility now reflects the live Graph proof. Visible Page videos/Reels classify as `eligible_for_normal_publish`.
- Social platform operations now shows Facebook Reels as working when the Graph proof is present, while keeping the strict verifier and Facebook Card fallback.
- Final MP4 voice audit was added as a read-only command: `npm run voice:final-audit`.
- Flash Lane visual QA now blocks rating slates, repeated age-rating/title slates, prescan-rejected white-text cards, dead dark frames and washed low-detail frames.
- `scripts/prewarm-infer.ps1` was repaired to plain ASCII so PowerShell can parse it reliably.

## Current operator outputs

- TikTok dispatch: `test/output/tiktok_dispatch_manifest.md`
- TikTok dispatch queue: `test/output/tiktok_dispatch_queue.json`
- TikTok inbox dry-run plan: `test/output/tiktok_inbox_upload_plan.md`
- Facebook Reels eligibility: `test/output/facebook_reels_eligibility.md`
- Social platform operations: `test/output/social_platform_operations.md`
- Final voice audit: `test/output/final_voice_audit.md`
- Approved voice fixture: `test/output/approved_voice_path_v1.md`

## TikTok status

- TikTok OAuth is now connected locally.
- The official inbox route is the primary safe route.
- Public API direct posting remains externally blocked until TikTok approval allows it.
- The inbox lane is not public auto-posting. It sends to TikTok inbox/drafts and still requires manual review in TikTok.
- Dispatch no longer treats ancient or unverified final renders as ready. `1s4denn` is now reported as `voice_review_required`.

## Facebook Reels status

- Read-only Graph proof currently shows visible Page video/Reel surfaces.
- Latest report: videos=1, reels=1, posts=6.
- The local system now classifies Facebook Reels as working when enabled and verified by Graph evidence.
- The normal publisher still keeps strict published-Reel verification and Facebook Card fallback.

## Voice status

- Final voice audit scanned `D:\pulse-data\media\output\final`.
- Result: pass=0, review=26, reject=0, skip=26.
- The 26 full MP4s are review-only because approved voice metadata is missing.
- Teasers are skipped and are not full TikTok-ready shorts.
- Local VoxCPM server was started and prewarmed the Pulse voice successfully in about 42 seconds.
- Local TTS smoke generation then timed out after 600 seconds. The server was stopped to avoid leaving GPU/CPU occupied.
- Current judgement: local TTS is not production-safe yet. The voice can load, but synthesis hangs or runs far too slowly.

## Flash Lane status

- Rating slates like PEGI/ESRB/17+/18+ are now blockers even if they appear after the old 22s trailer-start window.
- Repeated rating slates are now explicitly blocked.
- Prescan-rejected frames, including white text on dark title cards, dead dark frames and washed low-detail frames, now block Flash Lane render plans.
- This directly targets the poor frames seen in the Studio V2 proof.

## Validation

- `node --test tests/services/tiktok-recovery.test.js tests/services/tiktok-exports.test.js tests/services/facebook-reels-eligibility.test.js tests/services/enterprise-ops.test.js tests/services/flash-lane-visual-director.test.js tests/services/final-voice-audit.test.js` passed.
- `npm test` passed: 1847 tests.
- `npm run build` passed.
- `npm run tiktok:dispatch` passed and wrote updated dispatch outputs.
- `npm run tiktok:inbox-upload -- --mp4 test\output\tiktok_inbox_capability_test.mp4 --title "Pulse Gaming TikTok inbox capability test" --dry-run` passed.
- `npm run facebook:reels:eligibility` passed.
- `npm run ops:social-platforms` passed.
- `npm run voice:final-audit` passed.
- `npm run studio:v2:approved-voice -- --fixture` passed.
- `npm run tts:smoke` failed after local generation timeout. This is a real local TTS blocker, not a missing server or missing voice.

## Safety

- No Railway env vars changed.
- No production DB mutation.
- No OAuth triggered by code changes.
- No public social posting.
- No Studio V2 production switch.
- No hard publish gates enabled.
- No browser automation added.

## Recommended next build

Debug local VoxCPM synthesis hang before using local TTS for Pulse. The next focused task should add a tiny direct Python synthesis probe around `VoxCPMEngine.synth`, capture timing around generate, denoiser and time-stretch, then decide whether VoxCPM, Chatterbox or another local TTS engine is the practical route.
