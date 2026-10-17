import React from "react";
import { Composition, Still } from "remotion";
import { Short } from "./Short.tsx";
import { FPS, WIDTH, HEIGHT, SAMPLE_PROPS, type ShortProps } from "./props.ts";
import { Avatar, Banner, Thumb, SAMPLE_THUMB } from "./Brand.tsx";

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
  </>
);
