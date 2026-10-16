import React from "react";
import { Composition } from "remotion";
import { Short } from "./Short.tsx";
import { FPS, WIDTH, HEIGHT, SAMPLE_PROPS, type ShortProps } from "./props.ts";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="PulseShort"
    component={Short}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    durationInFrames={Math.ceil(SAMPLE_PROPS.durationSeconds * FPS)}
    defaultProps={SAMPLE_PROPS}
    calculateMetadata={({ props }: { props: ShortProps }) => ({
      durationInFrames: Math.max(FPS * 5, Math.ceil(props.durationSeconds * FPS)),
    })}
  />
);
