// Letters cut from a picture paint it as a CSS background, which the renderer does not wait for: a frame
// taken before it loads shows the letters' faint edge on black (the Vice City remake, 29 Oct 2026, had
// three such cards read as 13 s of black). Loading the same picture through <Img> holds each frame until
// it is in, and a solid amber layer beneath it keeps the letters readable if it never arrives.
import React from "react";
import { Img } from "remotion";
import { COLOUR } from "../../brand.ts";

export const Preload: React.FC<{ src?: string }> = ({ src }) =>
  src ? (
    <Img
      src={src}
      onError={() => undefined}
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
      }}
    />
  ) : null;

/** The picture, then amber under it, for letters clipped to their background. */
export const maskLayers = (src: string): string =>
  `url(${src}), linear-gradient(${COLOUR.amber}, ${COLOUR.amber})`;
