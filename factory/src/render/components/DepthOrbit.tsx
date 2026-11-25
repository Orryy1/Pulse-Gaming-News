// The 3D photo on screen (maths and rules in src/render/orbit.ts): a still drawn as a real surface with WebGL,
// filmed by a camera that swings slowly round its subject. Two surfaces: behind, the picture with the subject
// painted out on its own depth; in front, the picture itself, cut wherever its depth jumps inside a triangle so
// the subject's edge tears cleanly away instead of smearing across the gap. Plain WebGL (no Three.js: the
// factory's packages stay as they are), drawn synchronously each frame, so renders repeat exactly. If WebGL or
// a map is missing the shot falls back to the flat picture with a gentle push.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Img,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  ORBIT_TEAR,
  orbitMatrix,
  orbitPose,
  planeSize,
  reliefZ,
} from "../orbit.ts";

/** Grid cells across the plane's width: about 8 px a cell at 1920. */
const CELLS_X = 240;

const VERT = `#version 300 es
precision highp float;
in vec2 aUv;
uniform mat4 uMvp;
uniform sampler2D uDepth;
uniform vec2 uSize;
uniform float uRelief;
out vec2 vUv;
out float vDepth;
void main() {
  float d = texture(uDepth, aUv).r;
  vUv = aUv;
  vDepth = d;
  vec3 p = vec3((aUv.x - 0.5) * uSize.x, (0.5 - aUv.y) * uSize.y, d * uRelief);
  gl_Position = uMvp * vec4(p, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in float vDepth;
uniform sampler2D uColour;
uniform sampler2D uDepth;
uniform float uTear;
out vec4 outColour;
void main() {
  // Inside a triangle stretched across a depth edge, the map's own depth here differs from the depth the
  // triangle was spread between: that is the gap, so nothing is drawn and the surface behind shows.
  if (uTear > 0.0 && abs(texture(uDepth, vUv).r - vDepth) > uTear) discard;
  vec3 c = texture(uColour, vUv).rgb;
  // The stills' usual grade (contrast 1.03, saturation 1.05), so a 3D photo matches the shots round it.
  c = (c - 0.5) * 1.03 + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.05);
  outColour = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

interface Surface {
  colour: WebGLTexture;
  depth: WebGLTexture;
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
  linear: boolean,
): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
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

/** The grid's texture coordinates and triangle indices (cells x cells*aspect). */
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

export const DepthOrbit: React.FC<{
  src: string;
  mesh: { depth: string; far: string; farDepth: string; pivot: number };
  aspect: number;
  len: number;
  dir?: 1 | -1;
}> = ({ src, mesh, aspect, len, dir = 1 }) => {
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
    delayRender(`3D photo ${src}`, { timeoutInMilliseconds: 60_000 }),
  );
  const [ready, setReady] = useState(false);
  const released = useRef(false);
  const release = () => {
    if (released.current) return;
    released.current = true;
    continueRender(handle);
  };

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
          // The depth maps are sampled exactly (NEAREST) so the cut lands on the map's own edge.
          front: {
            colour: texture(gl, im!, true),
            depth: texture(gl, dm!, false),
          },
          back: {
            colour: texture(gl, fm!, true),
            depth: texture(gl, fdm!, true),
          },
        };
        // The frame is released once it is drawn (below), never before: an empty canvas must not be captured.
        if (live) setReady(true);
        else release();
      } catch (e) {
        if (live) {
          console.warn(`3D photo falls back to flat: ${(e as Error).message}`);
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

  useLayoutEffect(() => {
    const s = state.current;
    if (!ready || !s) return;
    const { gl, prog } = s;
    const frameAspect = width / height;
    const size = planeSize(aspect, frameAspect, mesh.pivot);
    const p = Math.min(1, frame / Math.max(1, len));
    const mvp = orbitMatrix(
      orbitPose(p, dir),
      frameAspect,
      reliefZ(mesh.pivot),
    );
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.043, 0.043, 0.055, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uMvp"), false, mvp);
    gl.uniform2f(gl.getUniformLocation(prog, "uSize"), size.w, size.h);
    gl.uniform1f(gl.getUniformLocation(prog, "uRelief"), reliefZ(1));
    gl.uniform1i(gl.getUniformLocation(prog, "uColour"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uDepth"), 1);
    gl.enable(gl.DEPTH_TEST);
    const draw = (surface: Surface, tear: number) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, surface.colour);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, surface.depth);
      gl.uniform1f(gl.getUniformLocation(prog, "uTear"), tear);
      gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_INT, 0);
    };
    // The place behind first; then, on a fresh depth buffer, the picture itself over it wherever it holds.
    draw(s.back, 0);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    draw(s.front, ORBIT_TEAR);
    gl.finish();
    release();
  }, [frame, ready, width, height, aspect, len, dir, mesh.pivot]);

  if (failed)
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${1.04 + 0.05 * Math.min(1, frame / Math.max(1, len))})`,
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
    </AbsoluteFill>
  );
};
