// A long-form graphic on a Short (31 Oct 2026). The long-form packs (../../packs), the photo treatments
// (../../PhotoShot.tsx), kinetic type, drawn scenes and documents are drawn for a 1920x1080 frame and build over
// two to three seconds, which is a documentary's pace, not a Short's: a Short's card has about 2.5 s and must
// read inside half a second. So the graphic is joined part-way through its build (`join` frames in, where the
// device is already up and its key content is landing), cropped to the part of the frame that matters
// (`crop`, in the 1920x1080 frame's pixels) and scaled into an area of the Short (by default VFULL, the hero
// and shelf bands): a rounded window over the blurred footage, or with `feather` a soft-edged band. It fades in
// over five frames and leaves the way every vertical card leaves (../kit.ts exitOf). Where the crop cuts away
// a pack's own ILLUSTRATION tag, the window carries one, so a drawn card never passes as a real screenshot.
import React from "react";
import { interpolate, Sequence, useCurrentFrame } from "remotion";
import { BODY } from "../../fonts.ts";
import type { GfxProps } from "../../packs/types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { clamp, exitOf, exitStyle, shadow } from "../kit.ts";
import { VFULL } from "../types.ts";

export type Rect = { x: number; y: number; w: number; h: number };
export type Area = { left: number; top: number; width: number; height: number };

/** Where the window sits in its area and how much the 1920x1080 frame is scaled: the crop fitted, centred. */
export function windowOf(
  crop: Rect,
  area: Area = VFULL,
): { scale: number; left: number; top: number; w: number; h: number } {
  const scale = Math.min(area.width / crop.w, area.height / crop.h);
  const w = Math.round(crop.w * scale);
  const h = Math.round(crop.h * scale);
  return {
    scale,
    w,
    h,
    left: area.left + Math.round((area.width - w) / 2),
    top: area.top + Math.round((area.height - h) / 2),
  };
}

/** Frames the long-form component is told it lasts: the join, the Short's window and a margin, so its own fade-out never shows. */
export const packLen = (join: number, len: number) => join + len + 8;

/** The tag every drawn card carries. */
export const IllustrationTag: React.FC = () => (
  <div
    style={{
      position: "absolute",
      right: 18,
      bottom: 16,
      padding: "5px 12px",
      borderRadius: 6,
      background: "rgba(11,11,14,0.72)",
      color: "rgba(245,245,242,0.88)",
      fontFamily: BODY,
      fontWeight: 800,
      fontSize: 20,
      letterSpacing: 3,
    }}
  >
    ILLUSTRATION
  </div>
);

/**
 * A 1920x1080 long-form frame shown in a window of the Short, `join` frames into its build. Positioned in the
 * Short's own 1080x1920 coordinates (place it in an AbsoluteFill).
 */
export const StageWindow: React.FC<{
  crop: Rect;
  area?: Area;
  join: number;
  len: number;
  /** Soft top and bottom edges instead of a rounded card (a photo band over its own blurred copy). */
  feather?: boolean;
  tag?: boolean;
  /** Keep the window still: no lift on entry, no exit move (a photo shot holds the frame for its whole shot). */
  still?: boolean;
  children: React.ReactNode;
}> = ({
  crop,
  area = VFULL,
  join,
  len,
  feather = false,
  tag = false,
  still = false,
  children,
}) => {
  const frame = useCurrentFrame();
  const win = windowOf(crop, area);
  const fadeIn = still ? 1 : interpolate(frame, [0, 5], [0, 1], clamp);
  const out = still ? 1 : exitOf(frame, len);
  const lift = still ? 1 : interpolate(frame, [0, 8], [0.965, 1], clamp);
  const ex = exitStyle(out);
  const mask = feather
    ? "linear-gradient(180deg, transparent 0%, #000 7%, #000 93%, transparent 100%)"
    : undefined;
  return (
    <div
      style={{
        position: "absolute",
        left: win.left,
        top: win.top,
        width: win.w,
        height: win.h,
        overflow: "hidden",
        borderRadius: feather ? 0 : 26,
        boxShadow: feather ? undefined : shadow(0.8),
        outline: feather ? undefined : "2px solid rgba(255,255,255,0.08)",
        opacity: fadeIn * ex.opacity,
        transform: still ? undefined : `${ex.transform} scale(${lift})`,
        background: feather ? undefined : "#0b0b0e",
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -crop.x * win.scale,
          top: -crop.y * win.scale,
          width: 1920,
          height: 1080,
          transform: `scale(${win.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <Sequence from={-join} layout="none">
          {children}
        </Sequence>
      </div>
      {tag ? <IllustrationTag /> : null}
    </div>
  );
};

/** A long-form pack graphic as a Short's card. */
export const PackCard: React.FC<{
  pack: React.FC<GfxProps>;
  g: MomentGraphic;
  join: number;
  crop: Rect;
  len: number;
  variant?: number;
  src?: string;
  year?: number;
  /** Draw the window's own ILLUSTRATION tag (the crop cuts the pack's away). */
  tag?: boolean;
}> = ({
  pack: Pack,
  g,
  join,
  crop,
  len,
  variant = 0,
  src,
  year,
  tag = true,
}) => (
  <StageWindow crop={crop} join={join} len={len} tag={tag}>
    <Pack
      g={g}
      len={packLen(join, len)}
      variant={variant}
      src={src}
      year={year}
    />
  </StageWindow>
);
