# Pulse Gaming News: brand system

One idea: a fast, credible gaming newsroom you can trust at a glance. Everything below is encoded in `src/render/brand.ts`, `layout.ts` and `motion.ts`; the Shorts, the banner, the avatar and the thumbnails all read from the same tokens, so nothing here is a suggestion the code can drift from.

## Voice

- Brisk, confident, lightly opinionated. Short declarative sentences. British English, no serial comma.
- Every Short carries a "Pulse take": context, a comparison or a clearly framed opinion. Never a bare headline.
- Rumours are always labelled and never auto-published. Advertiser-friendly language everywhere.
- The channel speaks as "Pulse". No personal details about the operator.

## Mark and lockup

- Wordmark: "PULSE." in Anton with an amber full stop. The full stop is the brand's heartbeat: it is the one amber element that is present in every frame.
- Mark: `public/logo.png` (1024 px, transparent). Shown at 64 px in the Shorts brand bar, 560 px on the avatar.
- Lockup spacing: gap 0.28 of the type size; corner radius of the mark 0.3 of its width.

## Colour

| Token     | Hex                   | Rule                                                                                |
| --------- | --------------------- | ----------------------------------------------------------------------------------- |
| ink       | `#0B0B0E`             | plates and panels                                                                   |
| paper     | `#F5F5F2`             | primary text                                                                        |
| muted     | `#B4B4BC`             | labels (4.5:1 on ink)                                                               |
| amber     | `#FF6B1A`             | identity; dominant coloured area                                                    |
| alert     | `#FF3B3B`             | delays, rumours, negative deltas                                                    |
| verify    | `#38BDF8`             | LIVE, VERIFIED and live-data highlights only, never more than 10 % of coloured area |
| up / down | `#22C55E` / `#FF3B3B` | deltas and score bands                                                              |
| gold      | `#FFC21A`             | price stories                                                                       |
| violet    | `#8B5CF6`             | industry stories                                                                    |
| sky       | `#38BDF8`             | update stories                                                                      |

One accent per Short, chosen by story type; rumours force alert. Review scores use the band colour (80+ green, 60-79 amber, below 60 red). No neon, no gradients as colour, no glow except the 24 px halo on a landed accent element.

## Type

Anton for glanced text, Inter for read text. Tabular numerals on every number. At most three sizes visible at once; never two display sizes together.

| Role        | Face      | px (1080x1920)               |
| ----------- | --------- | ---------------------------- |
| Display XL  | Anton     | 196                          |
| Headline    | Anton     | 132 (112 over six words)     |
| Card title  | Anton     | 100                          |
| Caption     | Inter 900 | 80                           |
| Chart value | Anton     | 60                           |
| Label       | Inter 800 | 32, uppercase, tracking 2 px |
| Micro       | Inter 600 | 26 (nothing smaller)         |

## Layout (Shorts, 1080x1920)

Nothing essential above y 150 (status bar, Shorts header) or below y 1620 (channel row, carousel); nothing right of x 920 once the right-hand rail begins at y 1000.

| Band    | y         | Holds                                        |
| ------- | --------- | -------------------------------------------- |
| brand   | 150-300   | lockup, story chip, source lower-third       |
| wire    | 300-352   | progress rail                                |
| hero    | 360-900   | headline, primary card, framed footage panel |
| shelf   | 900-1180  | exactly one evidence device per beat         |
| caption | 1180-1460 | caption block centred on y 1320              |
| soft    | 1460-1620 | footage, scrim, footage credit tag           |

## Motion

- Three springs: ENTER (damping 14, stiffness 160, mass 0.7), POP (15, 260, 0.5), SNAP (20, 400, 0.4).
- Rule then content: a 4 px accent rule draws over 12 frames and the content it introduces follows 4 frames behind. Every card, lower-third and chart enters this way.
- Exits over the last 8 frames (24 px slide plus fade). Minimum hold 45 frames.
- Cut punch: the incoming shot settles from 1.03 to 1.00 over 5 frames. One ambient move per shot.
- Accent flash: 3 frames at 0.18, only at the hook end and the take start.
- Frame 0 is the thumbnail: the headline, brand bar and source row are fully rendered at frame 0, and the last 30 frames return to it so the loop is seamless.

## Sound

Owned beds (four Suno generations, `public/music.rights.json`) ducked under the voice with a 2-frame attack and 9-frame release. Owned SFX (`public/sfx/rights.json`): a brand sting at frame 0 and the last 12 frames, at most four content cues per Short. Master at -16 LUFS.

## Do and do not

- Do open on the fact. Do show one device on the shelf. Do credit footage on screen and in the description.
- Do not use whooshes on every cut, full-screen end cards, subscribe mimicry, flashing captions, light leaks, chromatic aberration or stock imagery.
