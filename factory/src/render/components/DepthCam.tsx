// The depth camera on screen (PARALLAX_DEEP; maths and plan in src/render/depthcam.ts). The still's 3D photo
// drawn as two WebGL surfaces, as DepthOrbit does (behind, the place with the subject painted out; in front, the
// picture itself, torn where its depth jumps), filmed on a gentle path with a cinema lens: depth of field from the
// picture's own mip levels, racked to the subject on the stressed word, and haze towards the picture's own average
// colour on the far depths. A warm light leak is laid over in CSS on the shots the plan picks. Drawn synchronously
// each frame, so renders repeat exactly; with no WebGL or a missing map it falls back to the flat still and a push.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Img,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { reliefZ } from "../orbit.ts";
import {
  DEPTH_CAM_TEAR,
  camLens,
  camMatrix,
  camOverscan,
  camPlane,
  camPose,
  camProgress,
  leakAt,
  type DepthCamPlan,
} from "../depthcam.ts";

/** Grid cells across the plane's width: about 8 px a cell at 1920. */
const CELLS_X = 240;
/** Haze at full strength: the share of the far wall's colour given over to the air in front of it. */
const HAZE = 0.2;
/** The blur at full strength, in mip levels (3 is an eighth of the size: a soft but readable background). */
const MAX_LOD = 3.2;

const VERT = `#version 300 es
precision highp float;
in vec2 aUv;
uniform mat4 uMvp;
uniform sampler2D uDepth;
uniform vec2 uSize;
uniform float uOffsetX;
uniform float uRelief;
out vec2 vUv;
out float vDepth;
void main() {
  float d = texture(uDepth, aUv).r;
  vUv = aUv;
  vDepth = d;
  vec3 p = vec3((aUv.x - 0.5) * uSize.x + uOffsetX, (0.5 - aUv.y) * uSize.y, d * uRelief);
  gl_Position = uMvp * vec4(p, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in float vDepth;
uniform sampler2D uColour;
uniform sampler2D uDepth;
uniform float uTear;
uniform float uFocus;
uniform float uStrength;
uniform float uHaze;
uniform vec2 uTexel;
out vec4 outColour;
void main() {
  float d = texture(uDepth, vUv).r;
  if (uTear > 0.0 && abs(d - vDepth) > uTear) discard;
  // Depth of field: further from the focus, a coarser mip level, sampled four ways round the point so the blur
  // is round rather than blocky. A band either side of the focus stays sharp.
  float lod = clamp((abs(vDepth - uFocus) - 0.06) * 9.0, 0.0, 1.0) * ${MAX_LOD.toFixed(1)} * uStrength;
  vec3 c;
  if (lod < 0.05) {
    c = texture(uColour, vUv).rgb;
  } else {
    vec2 o = uTexel * exp2(lod) * 0.6;
    c = (textureLod(uColour, vUv + vec2(o.x, o.y * 0.4), lod).rgb +
         textureLod(uColour, vUv + vec2(-o.x * 0.4, o.y), lod).rgb +
         textureLod(uColour, vUv + vec2(-o.x, -o.y * 0.4), lod).rgb +
         textureLod(uColour, vUv + vec2(o.x * 0.4, -o.y), lod).rgb) * 0.25;
  }
  // Air: the far depths lean towards a lifted copy of the picture's own average colour (its smallest mip).
  vec3 avg = textureLod(uColour, vec2(0.5), 14.0).rgb;
  vec3 air = mix(avg, vec3(0.86, 0.88, 0.92), 0.45);
  c = mix(c, air, uHaze * (1.0 - smoothstep(0.0, 0.5, vDepth)));
  // The stills' usual grade (contrast 1.03, saturation 1.05), so a shot matches the ones round it.
  c = (c - 0.5) * 1.03 + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.05);
  outColour = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

interface Surface {
  colour: WebGLTexture;
  depth: WebGLTexture;
  w: number;
  h: number;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`could not load ${src}`));
    im.src = src;
  });

function texture(
  gl: WebGL2RenderingContext,
  im: HTMLImageElement,
  mode: "mip" | "linear" | "nearest",
): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
  if (mode === "mip") {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  } else {
    const f = mode === "linear" ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function program(gl: WebGL2RenderingContext): WebGLProgram {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

function grid(aspect: number): {
  uv: Float32Array;
  index: Uint32Array;
  count: number;
} {
  const nx = CELLS_X;
  const ny = Math.max(8, Math.round(CELLS_X / Math.max(0.3, aspect)));
  const uv = new Float32Array((nx + 1) * (ny + 1) * 2);
  let k = 0;
  for (let y = 0; y <= ny; y++)
    for (let x = 0; x <= nx; x++) {
      uv[k++] = x / nx;
      uv[k++] = y / ny;
    }
  const index = new Uint32Array(nx * ny * 6);
  k = 0;
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const a = y * (nx + 1) + x;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      index.set([a, c, b, b, c, d], k);
      k += 6;
    }
  return { uv, index, count: index.length };
}

/** A warm light leak (CSS, screen blend): two soft blooms drifting across from one side, swelling on the word. */
export const LightLeak: React.FC<{ t: number; plan: DepthCamPlan }> = ({
  t,
  plan,
}) => {
  const a = leakAt(t, plan.emphasis) * 0.5;
  if (a < 0.01) return null;
  const x = plan.dir > 0 ? -10 + 50 * t : 110 - 50 * t;
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        opacity: a,
        background: `radial-gradient(38% 60% at ${x}% 28%, rgba(255,170,90,0.85) 0%, rgba(255,120,60,0.35) 40%, rgba(0,0,0,0) 72%), radial-gradient(26% 44% at ${x + 14 * plan.dir}% 70%, rgba(255,210,150,0.5) 0%, rgba(0,0,0,0) 70%)`,
        pointerEvents: "none",
      }}
    />
  );
};

export const DepthCam: React.FC<{
  src: string;
  mesh: { depth: string; far: string; farDepth: string; pivot: number };
  aspect: number;
  len: number;
  plan: DepthCamPlan;
  /** Where the subject stands across the picture (0-1): a tall frame crops round it. */
  focusX?: number;
}> = ({ src, mesh, aspect, len, plan, focusX = 0.5 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<{
    gl: WebGL2RenderingContext;
    prog: WebGLProgram;
    count: number;
    front: Surface;
    back: Surface;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [handle] = useState(() =>
    delayRender(`depth camera ${src}`, { timeoutInMilliseconds: 60_000 }),
  );
  const [ready, setReady] = useState(false);
  const released = useRef(false);
  const release = () => {
    if (released.current) return;
    released.current = true;
    continueRender(handle);
  };
  const frameAspect = width / height;
  const overscan = camOverscan(plan, aspect, frameAspect, mesh.pivot, focusX);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const gl = canvas.current?.getContext("webgl2", {
          antialias: true,
          preserveDrawingBuffer: true,
          premultipliedAlpha: false,
        });
        if (!gl) throw new Error("no WebGL2");
        const [im, dm, fm, fdm] = await Promise.all(
          [src, mesh.depth, mesh.far, mesh.farDepth].map(loadImage),
        );
        if (!live) {
          release();
          return;
        }
        const prog = program(gl);
        const g = grid(aspect);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const vb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bufferData(gl.ARRAY_BUFFER, g.uv, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, "aUv");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.index, gl.STATIC_DRAW);
        state.current = {
          gl,
          prog,
          count: g.count,
          front: {
            colour: texture(gl, im!, "mip"),
            depth: texture(gl, dm!, "nearest"),
            w: im!.naturalWidth,
            h: im!.naturalHeight,
          },
          back: {
            colour: texture(gl, fm!, "mip"),
            depth: texture(gl, fdm!, "linear"),
            w: fm!.naturalWidth,
            h: fm!.naturalHeight,
          },
        };
        if (live) setReady(true);
        else release();
      } catch (e) {
        if (live) {
          console.warn(
            `depth camera falls back to flat: ${(e as Error).message}`,
          );
          setFailed(true);
        }
        release();
      }
    })();
    return () => {
      live = false;
      // Free the GPU memory now rather than at garbage collection: a long video mounts many of these.
      const s = state.current;
      if (s) {
        for (const t of [s.front.colour, s.front.depth, s.back.colour, s.back.depth]) s.gl.deleteTexture(t);
        s.gl.deleteProgram(s.prog);
        s.gl.getExtension("WEBGL_lose_context")?.loseContext();
        state.current = null;
      }
      release();
    };
  }, [src, mesh.depth, mesh.far, mesh.farDepth, aspect, handle]);

  const t = Math.min(1, frame / Math.max(1, len));
  useLayoutEffect(() => {
    const s = state.current;
    if (!ready || !s) return;
    const { gl, prog } = s;
    const plane = camPlane(aspect, frameAspect, overscan, focusX);
    const mvp = camMatrix(
      camPose(plan, camProgress(t, plan.emphasis)),
      frameAspect,
      reliefZ(mesh.pivot),
    );
    const lens = camLens(plan, t, mesh.pivot);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.043, 0.043, 0.055, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniformMatrix4fv(u("uMvp"), false, mvp);
    gl.uniform2f(u("uSize"), plane.w, plane.h);
    gl.uniform1f(u("uOffsetX"), plane.offsetX);
    gl.uniform1f(u("uRelief"), reliefZ(1));
    gl.uniform1i(u("uColour"), 0);
    gl.uniform1i(u("uDepth"), 1);
    gl.uniform1f(u("uFocus"), lens.focus);
    gl.uniform1f(u("uStrength"), lens.strength);
    gl.uniform1f(u("uHaze"), HAZE * plan.haze);
    gl.enable(gl.DEPTH_TEST);
    const draw = (surface: Surface, tear: number) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, surface.colour);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, surface.depth);
      gl.uniform1f(u("uTear"), tear);
      gl.uniform2f(
        u("uTexel"),
        1 / Math.max(1, surface.w),
        1 / Math.max(1, surface.h),
      );
      gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_INT, 0);
    };
    draw(s.back, 0);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    draw(s.front, DEPTH_CAM_TEAR);
    gl.finish();
    release();
  }, [t, ready, frameAspect, aspect, overscan, focusX, plan, mesh.pivot]);

  if (failed)
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${focusX * 100}% 50%`,
            transform: `scale(${1.04 + 0.05 * t})`,
          }}
        />
      </AbsoluteFill>
    );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <canvas
        ref={canvas}
        width={width}
        height={height}
        style={{ width: "100%", height: "100%" }}
      />
      {plan.leak ? <LightLeak t={t} plan={plan} /> : null}
    </AbsoluteFill>
  );
};
