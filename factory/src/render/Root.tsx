import React from "react";
import { Composition, Still } from "remotion";
import { Short } from "./Short.tsx";
import { FPS, WIDTH, HEIGHT, SAMPLE_PROPS, type ShortProps } from "./props.ts";
import { Avatar, Banner, Thumb, SAMPLE_THUMB } from "./Brand.tsx";
import { Long, SAMPLE_LONG_PROPS, type LongProps } from "./Long.tsx";
import { LONG_FPS, LONG_WIDTH, LONG_HEIGHT } from "./longplan.ts";
import { Engage, SAMPLE_ENGAGE } from "./Engage.tsx";
import { Cutdown, SAMPLE_CUTDOWN, type CutdownProps } from "./Cutdown.tsx";

export const RemotionRoot: React.FC = () => (
  <>
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
    <Still id="PulseEngage" component={Engage} width={1080} height={1350} defaultProps={SAMPLE_ENGAGE} />
  </>
);
