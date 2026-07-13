# TikTok Studio Handoff

## Purpose

Pulse Gaming keeps TikTok automatic publishing deferred when the Content Posting API permission, app audit or account scopes are unavailable. The supported fallback is a governed operator handoff to TikTok Studio on the web or in the mobile app.

This route does not bypass TikTok controls. It prepares the same source-safe video, captions, copy, disclosures and evidence used by the guarded pipeline, then leaves the final upload or schedule action to the operator.

## Generate the current handoff

```powershell
npm run tiktok:manual-handoff -- --api-status permission_unavailable --json
```

The command writes:

- `output/tiktok-manual-handoff/tiktok_manual_handoff.json`
- `output/tiktok-manual-handoff/tiktok_manual_handoff.md`
- `output/tiktok-manual-handoff/tiktok_manual_caption.txt`
- `output/tiktok-manual-handoff/tiktok_manual_completion_receipt.json`
- `output/tiktok-manual-handoff/tiktok_creator_rewards_manual_work_order.json`

Every ready item contains the governed media paths, caption, hashtags, disclosure state, SHA-256 fingerprints and an upload checklist. It never changes OAuth, tokens, platform settings or production database rows.

## Creator Rewards variants

TikTok's Creator Rewards programme requires qualifying videos to be original, high quality and longer than one minute. A short pack at or below 60 seconds is therefore not counted as Creator Rewards-ready.

Generate separate 61-75 second variants locally:

```powershell
npm run ops:goal-tiktok-creator-rewards-variant -- `
  --work-order output/tiktok-manual-handoff/tiktok_creator_rewards_manual_work_order.json `
  --out-dir output/tiktok-manual-handoff `
  --provider local `
  --alignment whisper `
  --json
```

The base YouTube, Instagram and Facebook short is not mutated. A TikTok variant only becomes ready after fresh narration, strict word alignment, captions, render and variant evidence pass.

## Operator boundary

1. Open TikTok Studio or the TikTok mobile app.
2. Upload the exact governed video and cover listed in the handoff.
3. Paste the supplied copy without changing factual claims.
4. Apply the listed AI and commercial-content disclosures.
5. Run TikTok's sound copyright check and preview the full post.
6. Schedule or publish the post.
7. Record the resulting post ID and public URL in the completion receipt.

Browser scripting, credential scraping and unofficial upload endpoints are not accepted fallbacks. TikTok stays visible as `deferred_operator_handoff` until the supported API path is independently GREEN.
