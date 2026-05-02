# Pulse Creator Studio OS v1 Report

Date: 2026-05-01

## 1. What Was Built

Built `Pulse Creator Studio OS v1`, a read-only control-room and production-packet layer.

New command:

```bash
npm run ops:creator-studio
```

Outputs:

- `test/output/creator_studio_control_room.json`
- `test/output/creator_studio_control_room.md`
- `test/output/creator-studio/<storyId>/story_dossier.json`
- `test/output/creator-studio/<storyId>/story_dossier.md`
- `test/output/creator-studio/<storyId>/source_pack.json`
- `test/output/creator-studio/<storyId>/fact_check_report.md`
- `test/output/creator-studio/<storyId>/media_inventory.json`
- `test/output/creator-studio/<storyId>/media_inventory.md`
- `test/output/creator-studio/<storyId>/shot_list.json`
- `test/output/creator-studio/<storyId>/visual_script.md`
- `test/output/creator-studio/<storyId>/render_manifest.json`
- `test/output/creator-studio/<storyId>/render_contract.md`
- `test/output/creator-studio/<storyId>/platform_route_plan.json`
- `test/output/creator-studio/<storyId>/publish_readiness.json`
- `test/output/creator-studio/<storyId>/publish_readiness.md`
- `test/output/creator-studio/<storyId>/learning_hook.json`

Also fixed the local TTS regression guard:

- stale slow Chatterbox local TTS cache is rejected
- red spoken WPM is now a hard Studio V2 reject
- the 111s / 74 WPM demonic voice path cannot silently pass as a usable render

## 2. Operating Model Change

The system now asks pre-production questions before a story becomes a video:

- Is this actually gaming?
- Is it sourced?
- Is the media strong enough?
- What format should it become?
- What shots should it use?
- Is the render plan safe?
- Which platforms should get it?
- What will analytics later learn from it?

This is reporting only. No live gate was enabled.

## 3. How To Run

Fixture demo:

```bash
npm run ops:creator-studio -- --fixture
```

Latest approved/local stories:

```bash
npm run ops:creator-studio -- --limit 5
```

Specific story:

```bash
npm run ops:creator-studio -- --story-id STORY_ID
```

All approved stories:

```bash
npm run ops:creator-studio -- --all-approved
```

## 4. Example Verdicts

Fixture mode:

- `demo_gta_xbox`: GREEN / publish / premium_short / premium_ready
- `demo_hotd_reject`: RED / reject / off-brand entertainment

Local DB sample (`--limit 5`):

- Overall: RED
- Counts: GREEN 0, AMBER 2, RED 3
- Main pattern: recent candidates are accepted as gaming but mostly thin visually, missing thumbnail candidates or blog/card-only routes

## 5. Warn-Only

Still warn/report only:

- Creator Studio OS publish-readiness verdicts
- media inventory thinness
- missing thumbnail candidates where a safe fallback may exist
- Studio V2 candidate routing
- TikTok dispatch eligibility
- platform degradation notes

## 6. Blocked

Still blocked or externally constrained:

- TikTok official public API posting remains blocked; dispatch pack is the safe route.
- Facebook Reels remain page-gated; card fallback remains the safe route.
- Studio V2 is not production default.
- Creator Studio OS is not a hard publish gate.
- No automatic comment reply, like, moderation or browser-cookie automation was added.

## 7. What Should Not Be Deployed Yet

Do not deploy any change that:

- switches Studio V2 into production
- enables hard visual blocks
- changes scheduler timing
- changes OAuth or platform token behaviour
- changes Railway variables
- changes publish/upload behaviour
- makes Creator Studio OS block live uploads without approval

This branch's Creator Studio OS code is safe as a reporting layer, but production enforcement needs a separate approval memo.

## 8. What Should Be Promoted Next

Promote this control layer into the operator dashboard after a few local runs, still as read-only.

Good next promotion:

- show Creator Studio OS verdict beside each story
- expose source pack, media inventory and shot list in the dashboard
- keep publish blocking off until Martin approves

## 9. Cost And Risk Notes

- No new paid API call is required for the control-room command.
- No Railway cost impact unless deployed.
- Local Chatterbox TTS now has a pace guard, reducing wasted render time on unusable slow voice outputs.
- The biggest current creative risk remains media scarcity: too many local DB stories are still thin visuals or missing thumbnail candidates.

Platform policy references used for routing:

- [TikTok Creator Rewards Program Terms](https://www.tiktok.com/legal/page/global/tiktok-creator-rewards-program-br/en): eligible videos require at least 1 minute.
- [YouTube Partner Program eligibility](https://support.google.com/youtube/answer/72851): 1,000 subscribers plus either 4,000 public watch hours or 10M valid Shorts views in 90 days; Shorts feed watch hours do not count towards the 4,000-hour route.

## 10. Next Five Build Recommendations

1. Asset Acquisition Pro: improve official clips, trailer frames, Steam/IGDB enrichment and thumbnail candidates.
2. Dashboard Integration: show dossier, media inventory, format route and readiness in the UI.
3. Studio V2 Promotion Packet: define when `studio_v2_candidate` can become production for selected stories.
4. Monthly Release Radar: first flagship longform format with strict source/date/platform checks.
5. Analytics Hookup: join published performance back to story type, format type, render lane and media inventory class.
