// The PulseGfx composition: one graphic style over a picture (or a texture), for previews while designing.
// Beside the packs it previews, by name, the house looks Long.tsx draws itself ("House/Card", the delay
// stamp, the versus looks, the timeline, reviews, milestone, people, quote and headline cards), a motif's
// own styles ("Motif/gta/PanelList") and the chapter breathers ("Break/mask", "Break/motif:gta"), so a
// fault the graphics check found in a documentary can be reproduced by style name (data/smoke/gfx.mts).
import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { COLOUR } from "../../brand.ts";
import { ALL_STYLES } from "./index.ts";
import type { GfxProps } from "./types.ts";
import {
  HeadlineMoment,
  MomentGraphicCard,
  QuoteMoment,
  TimelineMoment,
} from "../LongMoments.tsx";
import {
  AchievementMoment,
  DelayMoment,
  PeopleMoment,
  ReviewsMoment,
  SpanMoment,
  VersusMoment,
  WipeCompare,
} from "../DocGraphics.tsx";
import { MapMoment } from "../MapMoment.tsx";
import { ALL_MOTIFS } from "../motifs/index.ts";
import {
  MaskInterlude,
  SlateInterlude,
  TornInterlude,
  VhsInterlude,
} from "../Interludes.tsx";
import { displayText } from "../../timeline.ts";

export type GfxPreviewProps = GfxProps & {
  style: string;
  picture?: string;
  durationSeconds: number;
};

type HouseProps = GfxProps & { picture?: string };
const sides = (p: HouseProps) => ({
  heading: displayText(p.g.primary),
  left: {
    src: p.picture ?? p.src ?? "",
    label: displayText(p.g.items[0] ?? ""),
  },
  right: {
    src: p.src ?? p.picture ?? "",
    label: displayText(p.g.items[1] ?? ""),
  },
});

/** The house looks by preview name; the versus looks take the two pictures for their sides. */
const HOUSE: Record<string, React.FC<HouseProps>> = {
  "House/Card": ({ g, len }) => <MomentGraphicCard g={g} len={len} />,
  "House/Delay": ({ g, len, bg, variant }) => (
    <DelayMoment g={g} len={len} bg={bg} variant={variant} />
  ),
  "House/Versus": (p) => <VersusMoment len={p.len} {...sides(p)} />,
  "House/Wipe": (p) => <WipeCompare len={p.len} {...sides(p)} />,
  "House/Timeline": ({ g, len }) => <TimelineMoment g={g} len={len} />,
  "House/Reviews": ({ g, len, bg, variant }) => (
    <ReviewsMoment g={g} len={len} bg={bg} variant={variant} />
  ),
  "House/Span": ({ g, len, bg, variant }) => (
    <SpanMoment g={g} len={len} bg={bg} variant={variant} />
  ),
  "House/Milestone": ({ g, len }) => <AchievementMoment g={g} len={len} />,
  "House/People": ({ g, len, bg, variant, photos }) => (
    <PeopleMoment g={g} len={len} bg={bg} variant={variant} photos={photos} />
  ),
  "House/Quote": ({ g, len, bg, variant }) => (
    <QuoteMoment g={g} len={len} bg={bg} variant={variant} />
  ),
  "House/Headline": ({ g, len, bg, variant, src }) => (
    <HeadlineMoment g={g} len={len} bg={bg} variant={variant} src={src} />
  ),
  "House/Map": (p) => <MapMoment {...p} />,
};

/** A breather look: the title from primary, the game from secondary, the year from items[0]. */
const breather = (name: string, p: HouseProps) => {
  const props = {
    number: 4,
    title: p.g.primary,
    game: p.g.secondary,
    year: p.g.items[0],
    frames: p.len,
    variant: p.variant,
    picture: p.picture,
  };
  if (name === "mask") return <MaskInterlude {...props} />;
  if (name === "slate") return <SlateInterlude {...props} />;
  if (name === "vhs") return <VhsInterlude {...props} />;
  if (name === "torn") return <TornInterlude {...props} />;
  if (name.startsWith("motif:")) {
    const m = ALL_MOTIFS.find((x) => x.id === name.slice(6));
    return m?.card
      ? React.createElement(m.card, {
          heading: p.g.primary,
          kicker: "CHAPTER 4",
          game: p.g.secondary,
          year: p.g.items[0],
          pictures: [p.picture, p.src].filter((x): x is string => Boolean(x)),
          frames: p.len,
          variant: p.variant,
        })
      : null;
  }
  return null;
};

export const GfxPreview: React.FC<GfxPreviewProps> = ({
  style,
  picture,
  ...props
}) => {
  const s = ALL_STYLES[style];
  const house = HOUSE[style];
  const motif = style.startsWith("Motif/")
    ? ALL_MOTIFS.find((m) => m.id === style.split("/")[1])?.styles?.[
        style.split("/")[2] ?? ""
      ]
    : undefined;
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      {picture ? (
        <Img
          src={picture}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
      {s ? (
        <s.component {...props} />
      ) : motif ? (
        <motif.component {...props} />
      ) : house ? (
        React.createElement(house, { ...props, picture })
      ) : style.startsWith("Break/") ? (
        breather(style.slice(6), { ...props, picture })
      ) : null}
    </AbsoluteFill>
  );
};

export const SAMPLE_GFX: GfxPreviewProps = {
  style: "",
  durationSeconds: 6,
  len: 180,
  g: { kind: "none", primary: "", secondary: "", items: [] },
};
