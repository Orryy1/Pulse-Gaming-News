# TikTok Automation Routes

Generated: 2026-04-28

Mode: research and local dispatch design only. No TikTok login, OAuth, posting, credential use, browser-cookie automation or production mutation was performed.

## Executive Decision

VA posting is the last resort, not the operating plan.

Correct route order for Pulse Gaming:

1. Official TikTok API approval route
2. Third-party scheduler with true auto-publish
3. Semi-automated phone approval workflow
4. Browser/RPA automation of TikTok Studio
5. VA poster

## Current Blocker

The existing official API path is blocked because the TikTok app was rejected or constrained as a personal-use style app. Local diagnosis still points to TikTok's unaudited-client restriction as the practical blocker for public posting.

TikTok's own Content Posting API documentation says Direct Post requires the `video.publish` scope, creator authorization and app approval. It also says unaudited clients are restricted to private viewing mode. The Direct Post reference lists `unaudited_client_can_only_post_to_private_accounts` and says that publish attempts are blocked when calling the video init endpoint.

Conclusion: do not keep burning engineering time on the same official API framing. Reapply later as a brand/business media publishing workflow for Pulse Gaming.

## Route 1: Official API Reapplication

Ranking: long-term best, not fastest.

Use case framing should be:

- Pulse Gaming is a media publishing tool for original Pulse Gaming videos.
- The app has a public landing page, privacy policy and terms page.
- The workflow has screenshots and a demo video.
- It publishes original news videos from Pulse's dashboard/export workflow.
- It does not scrape private user data.
- It does not automate fake engagement.
- It does not auto-like, auto-comment or auto-follow.

Pros:

- Cleanest compliance route.
- Direct control from Pulse code.
- Best long-term fit if approved.

Cons:

- Reapproval takes time.
- Public posting remains blocked until audit passes.
- The previous personal-use framing is a poor fit.

Next safe step:

- Build a proper Pulse Gaming landing page and app-review evidence pack before reapplying.

## Route 2: Third-Party Scheduler With True Auto-Publish

Ranking: best immediate non-VA investigation.

The scheduler must answer yes to:

- Auto-publishes TikTok without mobile confirmation.
- Supports Personal accounts or confirms the required account type.
- Does not obviously compromise Creator Rewards eligibility.
- Supports videos over 60 seconds.
- Accepts captions and hashtags.
- Can be fed by API, Zapier, Make, webhook, email upload or watched folder.
- Can publish same-day breaking-news content.

### Provider Shortlist

| Provider | Evidence | Fit for Pulse | Risks |
| --- | --- | --- | --- |
| Metricool | Help docs say TikTok videos can be automatically published from Metricool for personal and business accounts. Zapier exposes Metricool `Schedule Post` with TikTok, media, thumbnail and auto-publish fields. | Strong first test. Best near-term route if Zapier/Metricool can receive Pulse dispatch payloads. | TikTok API line-break limits. Music/effects limits. Need live trial. |
| Later | Help docs say TikTok posts can be auto-published or push-notification published, with cover-frame selection for auto-publish. | Good UI-first candidate. Needs API/webhook check. | Android cover support limits. Automation ingress may be weaker than Metricool/Publer/Ayrshare. |
| Buffer | Buffer docs describe automatic publishing and notification publishing, regular TikTok account support for most users, 3s-10m videos, custom thumbnail frame and 5 hashtag limit. | Good simple scheduler candidate. | No native trending audio in auto-publish. Best-time automation appears manual. Need API/feed ingress check. |
| Publer | Help docs say Personal and Business TikTok accounts can connect. Publer API docs say it can publish or schedule TikTok videos, cover selection, privacy and engagement options. | Strong technical candidate because an API exists. | Must confirm plan/API access, Personal account behaviour and same-day latency. |
| SocialPilot | Help docs describe Direct Publishing or Mobile Reminder, 3s-10m MP4/MOV, thumbnail selection and privacy settings. | Solid candidate if manual dashboard is acceptable. | Need confirm API/webhook ingress and Personal account behaviour. |
| Ayrshare | API docs expose `/post`, TikTok publishing, scheduling and idempotency keys. | Strong developer/API candidate if cost is acceptable. | Need confirm Personal account, Creator Rewards implications and TikTok public-post path. |
| Vista Social | Docs describe TikTok auto-posting and reminder notifications. | Good fallback scheduler candidate. | Need confirm external API/webhook path and Personal account support. |
| Nuelink | Public docs describe TikTok support, personal/business account support where API allows and automation from RSS/blog sources. API appears early-access. | Interesting later candidate for blog/RSS-driven repurposing. | API maturity and exact TikTok direct-publish behaviour need proof. |

### Scheduler Trial Criteria

Run a non-production trial before picking one:

1. Connect a test/non-critical TikTok account.
2. Upload a Pulse dispatch MP4 and cover.
3. Schedule a 60s+ private or low-risk video.
4. Confirm no mobile confirmation is required.
5. Confirm caption and hashtags survive.
6. Confirm cover behaviour.
7. Confirm post URL retrieval.
8. Confirm account type remains Personal if Creator Rewards matters.
9. Confirm duplicate/idempotency behaviour.
10. Confirm same-day posting latency.

## Route 3: Semi-Automated Phone Approval

Ranking: safest immediate fallback.

This is not ideal but it is practical if the operator can use a phone briefly at work.

Pulse now emits:

- TikTok-ready MP4 path
- Cover path
- Caption
- Hashtags
- Urgency score
- Recommended publish time
- 60s+ eligibility
- Scheduler-ready JSON
- Phone workflow JSON
- Discord-ready notification text

Command:

```bash
npm run tiktok:dispatch
```

Outputs:

- `test/output/tiktok_dispatch_manifest.json`
- `test/output/tiktok_dispatch_manifest.md`
- `test/output/tiktok_dispatch_queue.json`
- `test/output/tiktok_dispatch_discord_sample.txt`

Phone workflow:

1. Receive Discord notification.
2. Download/open the MP4.
3. Copy caption and hashtags.
4. Upload through TikTok app.
5. Set cover.
6. Publish after source/title review.
7. Mark the dispatch item complete manually.

## Route 4: Browser/RPA TikTok Studio

Ranking: controlled experiment only, behind the scheduler and phone routes.

Allowed staged test plan:

1. Open TikTok Studio on a non-critical/test account.
2. Detect upload form.
3. Fill form and stop before publish.
4. Upload private/draft/test post.
5. Publish a low-risk test post.
6. Only then consider live use.

Stop if any of these appear:

- captcha friction
- 2FA friction
- UI instability
- account warnings
- cookie/session fragility
- inability to stop before publish

This should not use live Pulse credentials until separately approved.

## Route 5: VA Poster

Ranking: last resort.

Use only if:

- Official API is blocked.
- Schedulers fail or cannot preserve Creator Rewards/account requirements.
- Phone workflow is too disruptive.
- Browser/RPA is too risky or unreliable.

Rules if used:

- No repo access.
- No secrets.
- No production dashboard access.
- Only dispatch pack access.
- Manual checklist required.
- Post-log required after every upload.

## Creator Rewards Notes

TikTok's Creator Rewards announcement says the programme rewards high-quality original content over one minute and focuses on originality, play duration, search value and audience engagement. It also says eligibility includes a personal account in good standing where available.

Operational implication:

- Keep TikTok dispatch checking 60s+ eligibility.
- Do not switch the account type casually.
- Do not add copied/trending material that weakens originality.
- Confirm any scheduler does not require converting away from the account type needed for Creator Rewards.

## Recommendation

Immediate:

1. Keep official API route paused until Pulse has a proper business/media app-review package.
2. Trial Metricool, Publer and Ayrshare first because they look strongest for automation ingress.
3. Keep Buffer, Later, SocialPilot and Vista Social as UI-first scheduler candidates.
4. Use phone semi-approval from dispatch packs while scheduler tests run.
5. Keep Browser/RPA test-account-only.
6. Keep VA as last resort.

## Sources Checked

- TikTok Content Posting API getting started: https://developers.tiktok.com/doc/content-posting-api-get-started/
- TikTok Direct Post reference: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- TikTok Creator Rewards announcement: https://newsroom.tiktok.com/introducing-the-new-creator-rewards-program/?lang=en
- Metricool TikTok posting: https://help.metricool.com/en/article/schedule-and-post-on-tiktok-pl1qpr/
- Metricool Zapier integration: https://zapier.com/apps/metricool/integrations/webhook
- Later TikTok scheduling: https://help.later.com/hc/en-us/articles/360053594793-Schedule-Publish-TikTok-Posts
- Buffer TikTok help: https://support.buffer.com/article/559-using-tiktok-with-buffer
- Buffer TikTok product page: https://buffer.com/tiktok
- Publer TikTok account help: https://publer.com/help/en/article/managing-tiktok-accounts-in-publer-1gloujj/
- Publer TikTok API docs: https://publer.com/docs/posting/create-posts/content-types/platform-specific-formats/tiktok-video-and-multi-photo-posts
- SocialPilot TikTok direct publishing: https://help.socialpilot.co/article/842-does-socialpilot-provide-tiktok-direct-publishing-in-the-new-create-post
- Ayrshare Post API: https://www.ayrshare.com/docs/apis/post/overview
- Vista Social TikTok publishing: https://support.vistasocial.com/hc/en-us/articles/4419165964827-TikTok-Publishing-with-Vista-Social
- Nuelink FAQ/API: https://nuelink.com/faqs and https://nuelink.com/social-media-api

