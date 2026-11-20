// A simple 3D object explainer: a console, a controller, a disc or a handheld built from plain primitives (rounded
// boxes, cylinders, spheres), never a copy of a real product's design, turning slowly under a key light and an accent
// rim light (three.js through @remotion/three). Each item gets a label as the narrator reaches it, joined by a leader
// line to the part it names when the words name a part ("disc drive", "sticks", "screen"); a label that names no part
// (a frame-rate target, a price) points at the object as a whole, so the picture never claims more than the line.
import React, { useEffect, useMemo } from "react";
import { ThreeCanvas } from "@remotion/three";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COLOUR } from "../../brand.ts";
import { placeCallouts } from "./Anatomy.tsx";
import {
  Board,
  clamp,
  easeInOut,
  Label,
  land,
  progress,
  useClock,
} from "./kit.tsx";
import { labelWidth, plateWidth } from "./layout.ts";
import type { ExplainerProps, ObjectKind } from "./types.ts";

type V3 = [number, number, number];

/** Each object's nameable parts: the words that name it and the point (object space) a label points at. */
const PARTS: Record<ObjectKind, Array<{ words: RegExp; at: V3 }>> = {
  console: [
    { words: /\b(disc|disk|drive|slot|blu-?ray)\b/i, at: [0.0, -0.35, 0.3] },
    { words: /\b(light|led|power|strip)\b/i, at: [-0.34, 0.2, 0.3] },
    {
      words: /\b(vent|fan|cool|cooling|heat|airflow)\b/i,
      at: [0.52, 0.55, 0.0],
    },
    { words: /\b(stand|base)\b/i, at: [0.0, -1.18, 0.0] },
    { words: /\b(usb|port|ports)\b/i, at: [0.25, -0.75, 0.3] },
  ],
  controller: [
    {
      words: /\b(sticks?|thumbsticks?|analogue|analog)\b/i,
      at: [-0.42, 0.02, 0.32],
    },
    { words: /\b(buttons?|face)\b/i, at: [0.62, 0.12, 0.25] },
    { words: /\b(triggers?|shoulder|bumpers?)\b/i, at: [-0.7, 0.42, 0.0] },
    { words: /\b(d-?pad|direction)\b/i, at: [-0.68, 0.12, 0.25] },
    {
      words: /\b(grips?|handles?|haptic|rumble|vibration)\b/i,
      at: [0.85, -0.45, 0.0],
    },
  ],
  disc: [
    { words: /\b(data|surface|storage|gb|layers?)\b/i, at: [0.75, -0.2, 0.02] },
    { words: /\b(hole|centre|center|hub)\b/i, at: [0.0, 0.0, 0.03] },
    { words: /\b(label|print|art|cover)\b/i, at: [0.0, 0.62, 0.03] },
    { words: /\b(edge|rim)\b/i, at: [-1.2, 0.0, 0.0] },
  ],
  handheld: [
    { words: /\b(screen|display|oled|lcd)\b/i, at: [0.0, 0.0, 0.1] },
    { words: /\b(buttons?)\b/i, at: [1.0, -0.12, 0.1] },
    { words: /\b(sticks?|thumbsticks?)\b/i, at: [-1.0, 0.22, 0.1] },
    { words: /\b(grips?|handles?)\b/i, at: [1.15, -0.4, 0.0] },
    { words: /\b(battery|charge|charging)\b/i, at: [0.0, -0.45, -0.1] },
  ],
};

/** Where an item's label points: the part its words name, or undefined (the object as a whole). Pure. */
export function anchorFor(kind: ObjectKind, label: string): V3 | undefined {
  return PARTS[kind].find((p) => p.words.test(label))?.at;
}

const CAMERA: { fov: number; z: number } = { fov: 32, z: 5.4 };

/** The object's turn at a frame: it spins in from behind, then turns slowly through about 70 degrees. */
export function turnAt(
  frame: number,
  len: number,
  fps: number,
): { y: number; x: number; scale: number } {
  const enter = interpolate(frame, [0, 0.9 * fps], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const drift = interpolate(frame, [0, Math.max(1, len)], [-0.55, 0.65], clamp);
  return {
    y: drift - (1 - enter) * 2.6,
    x: 0.22 - (1 - enter) * 0.2,
    scale: 0.55 + 0.45 * enter,
  };
}

/** A point of the object on screen (px inside a w x h canvas), after the turn. Pure maths, the same camera the canvas uses. */
// One camera per canvas size, reused: the labels are projected every frame.
const cameras = new Map<string, THREE.PerspectiveCamera>();
function cameraFor(w: number, h: number): THREE.PerspectiveCamera {
  const key = `${w}x${h}`;
  let cam = cameras.get(key);
  if (!cam) {
    cam = new THREE.PerspectiveCamera(CAMERA.fov, w / h, 0.1, 100);
    cam.position.set(0, 0, CAMERA.z);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    cameras.set(key, cam);
  }
  return cam;
}

export function project(
  at: V3,
  turn: { y: number; x: number; scale: number },
  w: number,
  h: number,
): [number, number] {
  const cam = cameraFor(w, h);
  const v = new THREE.Vector3(...at)
    .multiplyScalar(turn.scale)
    .applyEuler(new THREE.Euler(turn.x, turn.y, 0, "XYZ"));
  v.project(cam);
  return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
}

export const Object3D: React.FC<ExplainerProps> = ({
  e,
  len,
  at,
  accent,
  backdrop,
}) => (
  <Board
    type="object3d"
    title={e.title}
    len={len}
    accent={accent}
    backdrop={backdrop}
  >
    {({ o, content }) => (
      <ObjectBody
        e={e}
        at={at}
        accent={accent}
        o={o}
        content={content}
        len={len}
      />
    )}
  </Board>
);

const ObjectBody: React.FC<{
  e: ExplainerProps["e"];
  at: number[];
  accent: string;
  len: number;
  o: "tall" | "wide";
  content: { left: number; top: number; width: number; height: number };
}> = ({ e, at, accent, o, content, len }) => {
  const { frame, fps } = useClock();
  const n = e.items.length;
  const kind = e.object ?? "console";
  const { active } = progress(frame, at);
  const tall = o === "tall";
  const turn = turnAt(frame, len, fps);
  const cw = content.width;
  const ch = content.height;
  const lw = labelWidth("object3d", o, n);
  const plateW = lw + 40;
  // Anchors: a named part, else spread round the object's outline so whole-object labels do not all meet at one point.
  const general: V3[] = [
    [0, 0.9, 0.2],
    [0, -0.7, 0.3],
    [0.4, 0.2, 0.3],
  ];
  const anchors = e.items.map(
    (it, i) => anchorFor(kind, it.label) ?? general[i % general.length]!,
  );
  const shown = anchors.map((a) => project(a, turn, cw, ch));
  const callouts = placeCallouts(
    shown.map(([x, y]) => ({ x: x / cw, y: y / ch })),
    ch,
    tall ? 160 : 150,
  );
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: content.left + cw / 2 - cw * 0.32,
          top: content.top + ch * 0.8,
          width: cw * 0.64,
          height: ch * 0.12,
          borderRadius: "50%",
          background: `radial-gradient(ellipse, ${accent}44 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0) 70%)`,
          filter: "blur(10px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: content.left,
          top: content.top,
          width: cw,
          height: ch,
        }}
      >
        <ThreeCanvas
          width={cw}
          height={ch}
          camera={{
            fov: CAMERA.fov,
            position: [0, 0, CAMERA.z],
            near: 0.1,
            far: 100,
          }}
          gl={{ antialias: true, alpha: true }}
        >
          <Scene kind={kind} accent={accent} len={len} />
        </ThreeCanvas>
      </div>
      <svg
        width={content.left * 2 + cw}
        height={content.top + ch + 40}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        {callouts.map((c) => {
          if (frame < at[c.i]!) return null;
          const [px0, py0] = shown[c.i]!;
          const px = content.left + px0;
          const py = content.top + py0;
          const ly = content.top + c.y;
          const lx =
            c.side === "left"
              ? content.left + plateWidth(e.items[c.i]!.label, "object3d", o, n)
              : content.left +
                cw -
                plateWidth(e.items[c.i]!.label, "object3d", o, n);
          const p = interpolate(frame, [at[c.i]!, at[c.i]! + 14], [0, 1], {
            ...clamp,
            easing: easeInOut,
          });
          const ex = lx + (c.side === "left" ? 40 : -40);
          const total = Math.hypot(ex - px, ly - py) + 40;
          const isActive = c.i === active;
          return (
            <g key={c.i}>
              <circle
                cx={px}
                cy={py}
                r={11}
                fill={isActive ? accent : COLOUR.paper}
                stroke={COLOUR.ink}
                strokeWidth={3}
              />
              <path
                d={`M${px},${py} L${ex},${ly} L${lx},${ly}`}
                fill="none"
                stroke={isActive ? accent : "rgba(245,245,242,0.8)"}
                strokeWidth={4}
                strokeDasharray={`${total * p} ${total}`}
              />
            </g>
          );
        })}
      </svg>
      {callouts.map((c) => {
        if (frame < at[c.i]! + 6) return null;
        const p = land(frame, fps, at[c.i]! + 6);
        const isActive = c.i === active;
        return (
          <div
            key={c.i}
            style={{
              position: "absolute",
              left:
                c.side === "left" ? content.left : content.left + cw - plateW,
              top: content.top + c.y - (tall ? 62 : 56),
              width: plateW,
              minHeight: tall ? 124 : 112,
              display: "flex",
              alignItems: "center",
              justifyContent: c.side === "left" ? "flex-start" : "flex-end",
              opacity: Math.min(1, p * 1.3),
              transform: `translateX(${(1 - p) * (c.side === "left" ? -30 : 30)}px)`,
            }}
          >
            <div
              style={{
                padding: "14px 20px",
                borderRadius: 18,
                background: "rgba(11,11,14,0.86)",
                boxShadow: isActive
                  ? `0 0 0 2px ${accent}, 0 12px 30px rgba(0,0,0,0.6)`
                  : "0 0 0 1px rgba(255,255,255,0.14), 0 12px 30px rgba(0,0,0,0.6)",
              }}
            >
              <Label
                text={e.items[c.i]!.label}
                type="object3d"
                o={o}
                n={n}
                align={c.side === "left" ? "left" : "right"}
                colour={COLOUR.paper}
              />
            </div>
          </div>
        );
      })}
    </>
  );
};

/** The lit, turning object. Built from primitives; every material is the house's ink, chrome and accent. */
const Scene: React.FC<{ kind: ObjectKind; accent: string; len: number }> = ({
  kind,
  accent,
  len,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const turn = turnAt(frame, len, fps);
  const glow = 0.75 + 0.25 * Math.sin(frame / 9);
  const mats = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({
        color: "#1B1C22",
        roughness: 0.42,
        metalness: 0.35,
      }),
      shell: new THREE.MeshStandardMaterial({
        color: "#E9E9EC",
        roughness: 0.35,
        metalness: 0.1,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: "#07070A",
        roughness: 0.6,
        metalness: 0.2,
      }),
      chrome: new THREE.MeshStandardMaterial({
        color: "#9BA0AA",
        roughness: 0.2,
        metalness: 0.9,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: accent,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 1.2,
        roughness: 0.3,
      }),
      disc: new THREE.MeshPhysicalMaterial({
        color: "#C8CCD6",
        roughness: 0.12,
        metalness: 1,
        iridescence: 1,
        iridescenceIOR: 1.6,
        clearcoat: 1,
      }),
      screen: new THREE.MeshStandardMaterial({
        color: "#0E1630",
        emissive: new THREE.Color("#1A2B5C"),
        emissiveIntensity: 0.8,
        roughness: 0.15,
      }),
    }),
    [accent],
  );
  // Freed when the shot ends or the accent changes, so a long render does not pile up GPU memory.
  useEffect(
    () => () => Object.values(mats).forEach((m) => m.dispose()),
    [mats],
  );
  mats.accent.emissiveIntensity = 1.1 * glow;
  // Built once: a fresh geometry every frame would leak GPU memory over a long shot.
  const geo = useMemo(() => {
    const rounded = (w: number, h: number, d: number, r: number) =>
      new RoundedBoxGeometry(w, h, d, 4, r);
    return {
      consoleBody: rounded(1.05, 2.3, 0.58, 0.12),
      consoleShell: rounded(1.12, 2.38, 0.42, 0.14),
      padBody: rounded(1.5, 0.75, 0.42, 0.18),
      padTrigger: rounded(0.4, 0.12, 0.25, 0.05),
      handheldBody: rounded(2.5, 1.1, 0.18, 0.08),
    };
  }, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 4, 6]} intensity={2.4} />
      <directionalLight position={[-4, 1, 2]} intensity={0.6} />
      <pointLight
        position={[-2.5, 2, -3]}
        intensity={40}
        color={accent}
        distance={14}
      />
      <pointLight
        position={[2.5, -1.5, -2.5]}
        intensity={18}
        color="#5A7BFF"
        distance={12}
      />
      <group rotation={[turn.x, turn.y, 0]} scale={turn.scale}>
        {kind === "console" ? (
          <>
            <mesh geometry={geo.consoleBody} material={mats.body} />
            <mesh
              geometry={geo.consoleShell}
              material={mats.shell}
              position={[0, 0, -0.1]}
            />
            <mesh position={[0, -0.35, 0.3]} material={mats.dark}>
              <boxGeometry args={[0.62, 0.035, 0.02]} />
            </mesh>
            <mesh position={[-0.34, 0.2, 0.3]} material={mats.accent}>
              <boxGeometry args={[0.03, 1.5, 0.02]} />
            </mesh>
            {[0, 1, 2, 3, 4].map((k) => (
              <mesh
                key={k}
                position={[0.535, 0.35 + k * 0.1, 0]}
                material={mats.dark}
              >
                <boxGeometry args={[0.02, 0.04, 0.3]} />
              </mesh>
            ))}
            <mesh position={[0, -1.22, 0]} material={mats.chrome}>
              <cylinderGeometry args={[0.45, 0.5, 0.06, 48]} />
            </mesh>
            <mesh position={[0.25, -0.75, 0.3]} material={mats.dark}>
              <boxGeometry args={[0.12, 0.05, 0.02]} />
            </mesh>
          </>
        ) : kind === "controller" ? (
          <>
            <mesh geometry={geo.padBody} material={mats.body} />
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 0.78, -0.32, 0]}
                rotation={[0, 0, s * 0.45]}
                material={mats.body}
              >
                <capsuleGeometry args={[0.26, 0.55, 8, 24]} />
              </mesh>
            ))}
            {[-1, 1].map((s) => (
              <group
                key={`st${s}`}
                position={[s * 0.36, -0.12 + (s < 0 ? 0.14 : 0), 0.24]}
              >
                <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.dark}>
                  <cylinderGeometry args={[0.13, 0.15, 0.12, 32]} />
                </mesh>
                <mesh position={[0, 0, 0.08]} material={mats.chrome}>
                  <sphereGeometry args={[0.1, 24, 16]} />
                </mesh>
              </group>
            ))}
            {[
              [0.62, 0.24],
              [0.62, 0.0],
              [0.5, 0.12],
              [0.74, 0.12],
            ].map(([x, y], k) => (
              <mesh
                key={`b${k}`}
                position={[x!, y!, 0.22]}
                material={k === 0 ? mats.accent : mats.shell}
              >
                <sphereGeometry args={[0.055, 20, 14]} />
              </mesh>
            ))}
            <mesh position={[-0.62, 0.12, 0.22]} material={mats.dark}>
              <boxGeometry args={[0.22, 0.07, 0.04]} />
            </mesh>
            <mesh position={[-0.62, 0.12, 0.22]} material={mats.dark}>
              <boxGeometry args={[0.07, 0.22, 0.04]} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh
                key={`t${s}`}
                position={[s * 0.55, 0.42, -0.05]}
                geometry={geo.padTrigger}
                material={mats.shell}
              />
            ))}
            <mesh position={[0, 0.2, 0.22]} material={mats.accent}>
              <boxGeometry args={[0.36, 0.025, 0.02]} />
            </mesh>
          </>
        ) : kind === "disc" ? (
          <group rotation={[Math.PI / 2, 0, 0]}>
            <mesh material={mats.disc}>
              <cylinderGeometry args={[1.2, 1.2, 0.03, 96]} />
            </mesh>
            <mesh
              position={[0, 0.017, 0]}
              material={mats.accent}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <ringGeometry args={[0.42, 0.5, 64]} />
            </mesh>
            <mesh material={mats.dark}>
              <cylinderGeometry args={[0.16, 0.16, 0.034, 48]} />
            </mesh>
            <mesh position={[0, 0.0, 0]} material={mats.chrome}>
              <cylinderGeometry args={[0.38, 0.38, 0.032, 64]} />
            </mesh>
          </group>
        ) : (
          <>
            <mesh geometry={geo.handheldBody} material={mats.body} />
            <mesh position={[0, 0, 0.095]} material={mats.screen}>
              <boxGeometry args={[1.5, 0.86, 0.01]} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[s * 1.15, -0.25, -0.05]}
                rotation={[0, 0, s * 0.2]}
                material={mats.body}
              >
                <capsuleGeometry args={[0.18, 0.4, 8, 20]} />
              </mesh>
            ))}
            <mesh position={[-1.0, 0.22, 0.12]} material={mats.chrome}>
              <sphereGeometry args={[0.09, 20, 14]} />
            </mesh>
            {[
              [1.0, -0.02],
              [1.0, -0.22],
              [0.9, -0.12],
              [1.1, -0.12],
            ].map(([x, y], k) => (
              <mesh
                key={k}
                position={[x!, y!, 0.1]}
                material={k === 0 ? mats.accent : mats.shell}
              >
                <sphereGeometry args={[0.04, 16, 12]} />
              </mesh>
            ))}
          </>
        )}
      </group>
    </>
  );
};
