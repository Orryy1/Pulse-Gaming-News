import React from "react";
import { Composition, Still } from "remotion";
import { Short } from "./Short.tsx";
import { FPS, WIDTH, HEIGHT, SAMPLE_PROPS, type ShortProps } from "./props.ts";
import { Avatar, Banner, Thumb, SAMPLE_THUMB } from "./Brand.tsx";
import { Long, SAMPLE_LONG_PROPS, type LongProps } from "./Long.tsx";
import { LONG_FPS, LONG_WIDTH, LONG_HEIGHT } from "./longplan.ts";
import { Engage, SAMPLE_ENGAGE } from "./Engage.tsx";
import { Cutdown, SAMPLE_CUTDOWN, type CutdownProps } from "./Cutdown.tsx";
import { Lab, SAMPLE_LAB, type LabProps } from "./Lab.tsx";
import { ConceptAvatar, ConceptBanner, BroadcastCover } from "./BrandConcepts.tsx";
import { TextureBackground, type BackgroundKind } from "./components/Backgrounds.tsx";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="PulseLab"
      component={Lab}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_LAB.durationSeconds * FPS)}
      defaultProps={SAMPLE_LAB}
      calculateMetadata={({ props }: { props: LabProps }) => ({
        durationInFrames: Math.ceil(props.durationSeconds * FPS),
      })}
    />
    <Composition
      id="PulseShort"
      component={Short}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_PROPS.durationSeconds * FPS)}
      defaultProps={SAMPLE_PROPS}
      calculateMetadata={({ props }: { props: ShortProps }) => ({
        durationInFrames: Math.max(
          FPS * 5,
          Math.ceil(props.durationSeconds * FPS),
        ),
      })}
    />
    <Composition
      id="PulseLong"
      component={Long}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_LONG_PROPS.durationSeconds * LONG_FPS)}
      defaultProps={SAMPLE_LONG_PROPS}
      calculateMetadata={({ props }: { props: LongProps }) => ({
        durationInFrames: Math.max(
          LONG_FPS * 10,
          Math.ceil(props.durationSeconds * LONG_FPS),
        ),
      })}
    />
    <Composition
      id="PulseCutdown"
      component={Cutdown}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={Math.ceil(SAMPLE_CUTDOWN.durationSeconds * FPS)}
      defaultProps={SAMPLE_CUTDOWN}
      calculateMetadata={({ props }: { props: CutdownProps }) => ({
        durationInFrames: Math.max(FPS * 5, Math.ceil(props.durationSeconds * FPS)),
      })}
    />
    {/* The explainer backgrounds on their own, for previews (src/render/components/Backgrounds.tsx). */}
    <Composition
      id="PulseBackground"
      component={TextureBackground as React.FC<{ kind: BackgroundKind; variant?: number }>}
      fps={LONG_FPS}
      width={LONG_WIDTH}
      height={LONG_HEIGHT}
      durationInFrames={LONG_FPS * 6}
      defaultProps={{ kind: "crumpled" as BackgroundKind, variant: 0 }}
    />
    {/* Channel brand stills: rendered by `npm run brand` into factory/brand/. */}
    <Still id="PulseBanner" component={Banner} width={2560} height={1440} />
    <Still id="PulseAvatar" component={Avatar} width={800} height={800} />
    <Still
      id="PulseThumb"
      component={Thumb}
      width={1280}
      height={720}
      defaultProps={SAMPLE_THUMB}
    />
    {/* Redesign directions for the owner to choose from (src/render/BrandConcepts.tsx). */}
    <Still id="FacebookCover" component={BroadcastCover} width={1640} height={624} defaultProps={{ width: 1640, height: 624, contentWidth: 1180 }} />
    <Still id="XHeader" component={BroadcastCover} width={1500} height={500} defaultProps={{ width: 1500, height: 500, contentWidth: 1000, offsetX: 140 }} />
    <Still id="ConceptAvatar" component={ConceptAvatar} width={800} height={800} defaultProps={{ concept: "signal" as const }} />
    <Still id="ConceptBanner" component={ConceptBanner} width={2560} height={1440} defaultProps={{ concept: "signal" as const }} />
    <Still id="PulseEngage" component={Engage} width={1080} height={1350} defaultProps={SAMPLE_ENGAGE} />
  </>
);
