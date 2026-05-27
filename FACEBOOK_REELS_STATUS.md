# Facebook Reels Status

Generated: 2026-05-07 03:35 BST

## Verdict

`eligible_for_normal_publish`

Facebook Reels is no longer showing as a pure page-gated route in the read-only Graph inspection. The Page now has visible Graph video/Reel evidence.

## Evidence

- `/videos`: `1`
- `/video_reels`: `1`
- `/posts`: `6`
- Page published: `true`
- Page can post: `true`
- Token valid: `true`
- Required `publish_video` scope: present
- Local `FACEBOOK_REELS_ENABLED`: `true`

## Recommendation

Keep Facebook Reels enabled in the normal publisher, but keep the strict verifier and Facebook Card fallback. Do not remove the fallback yet; the API can still fail per upload if Meta processing rejects a file.

## Safety

- Read-only Graph inspection only.
- No Facebook post was made.
- No token value was printed.
- No Railway env var was changed.
- No production DB row was mutated.

## Next Check

After the next normal publish attempt, confirm Discord shows `FB Reel ✅` instead of `FB Reel ⏸ page_not_eligible`. If it fails, use the Reel verifier error as the next root-cause signal rather than assuming Page eligibility is still blocked.
