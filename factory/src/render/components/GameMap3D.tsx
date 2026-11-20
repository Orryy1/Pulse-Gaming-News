// MAP_PINS: the game's own map in 3D (three.js inside Remotion). The official or in-game map lies on a slab, the
// camera starts on the whole map from high above and flies down to the place, tilting so the map reads as ground;
// a pin drops with a light beam and a soft shadow and its name comes up beside it. Two or three places get a route
// arcing between them. The pins come from the graphic (src/assets/gamemaps.ts): a place the table does not know
// never reaches here. The look is the real-world map's (src/render/components/MapMoment.tsx): heading top left,
// labels on dark plates with an accent edge, credit in the corner; the accent follows GAME_LOOK when it is on.
// SHORT_MAP_PINS (src/render/shortupgrades.ts): the same map in a Short's tall frame (GameMap3DShort), the camera's dive
// quicker so the pin lands on the place's word, the heading and labels inside the Shorts safe area.

import React, { useEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GfxProps } from "./packs/types.ts";
import { useStage } from "./DocGraphics.tsx";
import { BODY, DISPLAY } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { displayText } from "../timeline.ts";
import { useLook, withAlpha } from "../gamelook.ts";
import {
  FLY_TO,
  closeShot,
  cameraPosition,
  drawableGameMap,
  pinWorld,
  planeSize,
  project,
  shotAt,
  wideShot,
  type MapShot,
  type Vec3,
} from "../gamemap.ts";
import { SAFE_EDGE } from "./packs/fit.ts";
import { shortMapFrame } from "../shortupgrades.ts";
import { SAFE } from "../layout.ts";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const PIN_H = 0.62;

/**
 * The map picture as a texture; the frame waits for it. A picture that will not load draws no map at all (the
 * component draws nothing until the texture is there), never a blank one, and never stops the whole render.
 */
function useMapTexture(src: string, crop?: [number, number, number, number]): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [handle] = useState(() =>
    delayRender(`game map ${src}`, { timeoutInMilliseconds: 120_000 }),
  );
  useEffect(() => {
    let live = true;
    let done = false;
    const release = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    if (!src) {
      release();
      return;
    }
    new THREE.TextureLoader().load(
      src,
      (t) => {
        if (!live) return;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.generateMipmaps = true;
        // Only the map part of a picture that carries a game's own menu around it.
        if (crop) {
          t.repeat.set(crop[2] - crop[0], crop[3] - crop[1]);
          t.offset.set(crop[0], 1 - crop[3]);
        }
        t.minFilter = THREE.LinearMipmapLinearFilter;
        setTex(t);
        release();
      },
      undefined,
      () => {
        console.warn(`game map ${src} did not load: no map drawn`);
        release();
      },
    );
    return () => {
      live = false;
      // Unmounted before the picture arrived: never leave the frame waiting.
      release();
    };
  }, [src, handle]);
  return tex;
}

/** A soft round shadow, drawn once. */
function useShadowTexture(): THREE.Texture | null {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(0,0,0,0.75)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
}

const Camera: React.FC<{ shot: MapShot }> = ({ shot }) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const pos = cameraPosition(shot);
  camera.fov = shot.fov;
  camera.near = 0.05;
  camera.far = 200;
  camera.position.set(pos[0], pos[1], pos[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(shot.target[0], shot.target[1], shot.target[2]);
  camera.updateProjectionMatrix();
  return null;
};

const Pin: React.FC<{
  at: Vec3;
  drop: number;
  pulse: number;
  accent: string;
  shadow: THREE.Texture | null;
  scale: number;
}> = ({ at, drop, pulse, accent, shadow, scale }) => {
  const lift = (1 - drop) * 2.4;
  return (
    <group position={[at[0], 0, at[2]]} scale={scale}>
      {shadow ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.004, 0]}
          scale={0.55 + lift * 0.25}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={shadow}
            transparent
            opacity={Math.min(1, drop * 1.2) * 0.8}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {/* The ground pulse. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.006, 0]}
        scale={0.15 + pulse * 0.7}
      >
        <ringGeometry args={[0.8, 1, 48]} />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={(1 - pulse) * 0.75 * drop}
          depthWrite={false}
        />
      </mesh>
      {/* The light beam: a tall soft cone of the accent colour. */}
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.035, 0.11, 3.2, 24, 1, true]} />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={0.16 * drop}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <group position={[0, lift, 0]}>
        <mesh position={[0, PIN_H / 2, 0]}>
          <cylinderGeometry args={[0.014, 0.03, PIN_H, 16]} />
          <meshStandardMaterial
            color="#f5f5f2"
            metalness={0.3}
            roughness={0.4}
          />
        </mesh>
        <mesh position={[0, PIN_H, 0]}>
          <sphereGeometry args={[0.1, 32, 24]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={0.45}
            roughness={0.35}
          />
        </mesh>
      </group>
    </group>
  );
};

/** The route between two places: a tube arcing above the map, drawn on over `p` (0-1). */
const Route: React.FC<{ a: Vec3; b: Vec3; p: number; colour: string; radius: number }> = ({
  a,
  b,
  p,
  colour,
  radius,
}) => {
  const geo = useMemo(() => {
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(a[0], 0.02, a[2]),
      new THREE.Vector3(
        (a[0] + b[0]) / 2,
        Math.max(0.3, d * 0.28),
        (a[2] + b[2]) / 2,
      ),
      new THREE.Vector3(b[0], 0.02, b[2]),
    );
    return new THREE.TubeGeometry(curve, 96, radius, 8, false);
  }, [a, b, radius]);
  useEffect(() => () => geo.dispose(), [geo]);
  const count = geo.index ? geo.index.count : 0;
  // Whole segments only (6 indices a quad, 8 quads a ring).
  const per = 6 * 8;
  geo.setDrawRange(0, Math.floor((count / per) * p) * per);
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial color={colour} transparent opacity={0.95} />
    </mesh>
  );
};

export const GameMap3D: React.FC<GfxProps> = ({ g, len }) => <GameMapView g={g} len={len} />;

/** SHORT_MAP_PINS: the map in a Short, for its whole span (`len`), at the Short's pace and in its safe area. */
export const GameMap3DShort: React.FC<{ g: GfxProps["g"]; len: number }> = ({ g, len }) => (
  <GameMapView g={g} len={len} short />
);

/** Roughly how wide a label's plate is (bold capitals about 0.64 em, plus its padding and edge). */
const labelWidth = (name: string, size: number) => Math.round(name.length * size * 0.64 + 44);

const GameMapView: React.FC<{ g: GfxProps["g"]; len: number; short?: boolean }> = ({ g, len, short = false }) => {
  const look = useLook();
  const { width: W, height: H } = useVideoConfig();
  const stage = useStage(len, short ? len : 240);
  const { fps, showFor, dim, visible } = stage;
  // A Short's camera dives quicker; everything timed to the dive follows it.
  const frame = short ? shortMapFrame(stage.frame) : stage.frame;
  const m = g.gameMap;
  const ok = drawableGameMap(g) && !!m?.src;
  const tex = useMapTexture(ok ? m!.src! : "", m?.crop);
  const shadow = useShadowTexture();
  const pins = useMemo(
    () => (m ? m.pins.map((p) => pinWorld(p, m.width, m.height)) : []),
    [m],
  );
  if (!ok || !visible || !m || !tex) return null;
  const { w, h } = planeSize(m.width, m.height);
  const wide = wideShot(m.width, m.height, W / H);
  const close = closeShot(pins, m.height, W / H, H);
  const shot = shotAt(frame, wide, close, short ? shortMapFrame(showFor) : showFor);
  // The pin keeps its size on screen when the closing shot sits further out (a small map, or places far apart).
  const pinScale = Math.max(1, close.distance / 5);
  const accent = look.accent;
  const heading = displayText(g.primary);
  // A Short's labels, placed in pin order, each pushed below one it would overlap.
  const shortLabels: Array<{ left: number; top: number; w: number }> = [];
  return (
    <AbsoluteFill style={{ opacity: dim, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 50% 40%, ${withAlpha("#16233a", 1)} 0%, #0a121f 55%, #05080e 100%)`,
        }}
      />
      {/* Mounted once the map has loaded: the canvas draws a frame only when Remotion advances it. */}
      {tex ? (
      <ThreeCanvas
        width={W}
        height={H}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        style={{ position: "absolute", inset: 0 }}
      >
        <Camera shot={shot} />
        <ambientLight intensity={1.15} />
        <directionalLight position={[-6, 12, 4]} intensity={1.3} />
        {/* The slab: the map's paper with a little thickness, on a dark base. */}
        <mesh position={[0, -0.09, 0]}>
          <boxGeometry args={[w * 1.01, 0.18, h * 1.01]} />
          <meshStandardMaterial color="#0d1626" roughness={0.9} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial map={tex} roughness={0.85} metalness={0} />
        </mesh>
        {pins.slice(1).map((b, i) => (
          <Route
            key={i}
            a={pins[i]!}
            b={b}
            colour="#ffffff"
            // Thick enough to read from the closing shot's distance.
            radius={0.007 * close.distance}
            p={interpolate(
              frame,
              [FLY_TO + 16 + i * 20, FLY_TO + 46 + i * 20],
              [0, 1],
              { ...clamp, easing: (x) => 1 - (1 - x) ** 2 },
            )}
          />
        ))}
        {pins.map((p, i) => {
          const at = FLY_TO - 10 + i * 12;
          const drop =
            frame < at
              ? 0
              : spring({ frame: frame - at, fps, config: SPRING.POP });
          const pulse = frame < at ? 0 : ((frame - at) % 45) / 45;
          return frame < at ? null : (
            <Pin
              key={i}
              at={p}
              drop={Math.min(1, drop)}
              pulse={pulse}
              accent={accent}
              shadow={shadow}
              scale={pinScale}
            />
          );
        })}
      </ThreeCanvas>
      ) : null}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(90% 80% at 50% 50%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.5) 100%)",
        }}
      />
      {/* Labels: the page's own type, placed where each pin's head is on screen. */}
      {m.pins.map((pin, i) => {
        const at = FLY_TO - 10 + i * 12 + 6;
        if (frame < at) return null;
        const head = project([pins[i]![0], (PIN_H + 0.12) * pinScale, pins[i]![2]], shot, W, H);
        const label = spring({ frame: frame - at, fps, config: SPRING.ENTER });
        if (short) {
          // Under its pin's foot, centred on it, inside the Shorts safe area (clear of the header, the right-hand rail
          // and the captions); big enough to read on a phone.
          const size = pin.name.length > 18 ? 38 : 46;
          const w = labelWidth(pin.name, size);
          const left = Math.max(SAFE.left, Math.min(SAFE.railRight - w, head.x - w / 2));
          const foot = project(pins[i]!, shot, W, H);
          // Below the heading plate (to about y 600) and above the captions.
          let top = Math.max(610, Math.min(1090, foot.y + 30));
          for (const o of shortLabels)
            if (left < o.left + o.w && o.left < left + w && Math.abs(top - o.top) < 80) top = o.top + 84;
          // Never into the caption band (from 1180): a label pushed that far goes above the one it met instead.
          if (top > 1090) top = Math.max(600, top - 168);
          shortLabels.push({ left, top, w });
          return (
            <div
              key={pin.name}
              style={{
                position: "absolute",
                left,
                top,
                padding: "12px 22px 12px 18px",
                background: withAlpha(look.ink, 0.88),
                borderLeft: `7px solid ${accent}`,
                borderRadius: 8,
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: size,
                letterSpacing: 2,
                color: look.paper,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
                opacity: label,
                transform: `translateY(${(1 - label) * 18}px)`,
              }}
            >
              {pin.name}
            </div>
          );
        }
        const right =
          head.x < 1300 &&
          !(m.pins.length > 1 && i === 0 && project(pins[1]!, shot, W, H).x < head.x);
        const x = Math.max(
          SAFE_EDGE + 20,
          Math.min(W - SAFE_EDGE - 20, head.x),
        );
        const y = Math.max(SAFE_EDGE + 30, Math.min(H - 190, head.y));
        return (
          <div
            key={pin.name}
            style={{
              position: "absolute",
              top: y - 30,
              ...(right ? { left: x + 34 } : { right: W - x + 34 }),
              padding: "10px 20px 10px 18px",
              background: withAlpha(look.ink, 0.86),
              borderLeft: right ? `6px solid ${accent}` : undefined,
              borderRight: right ? undefined : `6px solid ${accent}`,
              borderRadius: 6,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 34,
              letterSpacing: 2,
              color: look.paper,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
              opacity: label,
              transform: `translateX(${(1 - label) * (right ? -24 : 24)}px)`,
            }}
          >
            {pin.name}
          </div>
        );
      })}
      {heading ? (
        <div
          style={{
            position: "absolute",
            // A Short's heading sits in the hero band, below the Shorts header and the brand row.
            left: short ? SAFE.left : 80,
            top: short ? 380 : 96,
            maxWidth: short ? SAFE.railRight - SAFE.left : 900,
            // A plate: the map under it is busy with its own printed names.
            padding: "22px 30px 24px",
            background: withAlpha(look.ink, 0.84),
            borderRadius: 10,
            boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
            opacity: interpolate(frame, [10, 24], [0, 1], clamp),
            transform: `translateY(${interpolate(frame, [10, 24], [16, 0], clamp)}px)`,
          }}
        >
          <div
            style={{
              width: 90,
              height: 7,
              background: accent,
              marginBottom: 18,
            }}
          />
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: heading.length > 28 ? 60 : short ? 84 : 76,
              lineHeight: 1.02,
              color: look.paper,
              textTransform: "uppercase",
              textShadow: "0 8px 30px rgba(0,0,0,0.8)",
            }}
          >
            {heading}
          </div>
          {g.secondary ? (
            <div
              style={{
                marginTop: 12,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 28,
                letterSpacing: 1,
                color: withAlpha(look.paper, 0.78),
                textShadow: "0 4px 18px rgba(0,0,0,0.85)",
              }}
            >
              {displayText(g.secondary)}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          // Inside the corners GAME_LOOK may draw; in a Short above the captions, clear of the bottom UI.
          ...(short ? { left: SAFE.left, top: 1124 } : { right: 170, bottom: 30 }),
          padding: "5px 12px",
          borderRadius: 4,
          background: withAlpha(look.ink, 0.78),
          fontFamily: BODY,
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: 1.5,
          color: "rgba(245,245,242,0.82)",
          zIndex: 2,
        }}
      >
        {m.credit}
      </div>
    </AbsoluteFill>
  );
};
