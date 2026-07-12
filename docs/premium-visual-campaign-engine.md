# Premium Visual Campaign Engine

Pulse Gaming uses one governed visual campaign per story, then renders native derivatives for each surface. A campaign is not a single image resized everywhere.

## Outputs

- YouTube thumbnail: 1280x720
- YouTube Shorts cover: 1080x1920
- Instagram Reels cover: 1080x1920
- Instagram Story: 1080x1920
- Facebook Reels cover: 1080x1920
- Discord card: 1200x630
- Threads card: 1080x1350, package-only while deferred
- Pinterest pin: 1000x1500, package-only while deferred
- Instagram Story motion project: six-second seek-safe HyperFrames composition

Each output has an explicit safe zone. The story subject, governed cover headline, source label and content identity are shared, while composition dimensions and text placement remain platform-native.

## Visual language

- Official, rights-safe game imagery is full bleed.
- The game remains the visual subject. Pulse branding is a compact signal rail and lockup.
- Breaking, reveal, review, rumour, deal, release and update stories have distinct two-colour identities.
- Source attribution is compact and subordinate to the headline.
- Story cards use a story-specific question rather than a generic `WATCH NOW` button.
- Rounded CTA pills, inset hero cards, legacy slogans and generic placeholder art are prohibited.

## Quality gate

The engine blocks campaigns when:

- a safe hero image is missing
- the headline does not overlap the canonical subject
- the headline is not mobile-readable
- the platform matrix or safe-zone contract is incomplete
- an explicit premium campaign report is non-green
- the visual fingerprint repeats a recent campaign

Automatic hero selection samples official direct-motion clips, scores exposure, entropy and sharpness and records every candidate in the proof artefact. HyperFrames motion must pass runtime, layout, motion and WCAG contrast checks before render.

## Commands

Generate static proof:

```powershell
npm run ops:premium-visual-campaign -- --artifact-dir <governed-story-package>
```

Generate and validate the animated Story:

```powershell
npm run ops:premium-visual-campaign -- --artifact-dir <governed-story-package> --render-motion
```

The command is local proof only. It does not upload, mutate the database or change platform credentials.

## Production wiring

`images_story.js` materialises the campaign before guarded Story handoff. It preserves the legacy `story_image_path` contract for Instagram/Facebook Story upload and points `hf_thumbnail_path` at the premium YouTube thumbnail so the older thumbnail builder cannot overwrite it. The guarded handoff carries premium campaign evidence without granting publish permission.

The first-frame engine treats a present non-green premium campaign as a blocker. It does not infer that a missing optional campaign artefact is green.
