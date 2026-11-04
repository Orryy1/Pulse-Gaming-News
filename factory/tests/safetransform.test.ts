// A scale at exactly 0 under a rounded, shadowed box aborts Chrome's GPU process on the Mac (src/render/safetransform.ts).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MIN_SCALE, safeScale } from "../src/render/safetransform.ts";

test("safeScale moves zero and NaN off the singular value and leaves the rest alone", () => {
  assert.equal(safeScale(0), MIN_SCALE);
  assert.equal(safeScale(-0), MIN_SCALE);
  assert.equal(safeScale(Number.NaN), MIN_SCALE);
  assert.equal(safeScale(Number.POSITIVE_INFINITY), MIN_SCALE);
  assert.equal(safeScale(-MIN_SCALE / 2), -MIN_SCALE);
  for (const v of [1, 0.5, 0.001, -0.25, 1.9]) assert.equal(safeScale(v), v);
});

test("under a tenth of a pixel across a 4K width, so it draws nothing a viewer can see", () => {
  assert.ok(3840 * MIN_SCALE < 0.1);
});

const walk = (d: string): string[] =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(d, e.name))
        : e.name.endsWith(".tsx")
          ? [path.join(d, e.name)]
          : [],
    );

/** Scales set from a bare variable: one axis anywhere, or either kind on a rounded, shadowed box's own style. */
export function riskyScales(source: string): number[] {
  const lines = source.split("\n");
  const out: number[] = [];
  lines.forEach((line, i) => {
    const m = /(?<![a-zA-Z])scale([XY]?)\(\$\{[A-Za-z_][\w.]*\}\)/.exec(line);
    if (!m) return;
    let a = i;
    while (a > 0 && i - a < 25 && !/style=\{\{/.test(lines[a]!)) a--;
    let b = i;
    while (b < lines.length - 1 && b - i < 25 && !/^\s*\}\}/.test(lines[b]!)) b++;
    const style = lines.slice(a, b + 1).join("\n");
    if (m[1] || (/borderRadius/.test(style) && /boxShadow/.test(style)))
      out.push(i + 1);
  });
  return out;
}

test("the scan catches the shape that crashed and passes the sanitised one", () => {
  const bad =
    'style={{\n  borderRadius: 999,\n  transform: `rotate(-1.2deg) scaleX(${under})`,\n  boxShadow: "0 0 1px red",\n}}';
  assert.deepEqual(riskyScales(bad), [3]);
  assert.deepEqual(riskyScales(bad.replace("${under}", "${safeScale(under)}")), []);
});

test("no composition scales a rounded, shadowed box from a raw value", () => {
  const root = path.join(import.meta.dirname, "..", "src", "render");
  const found = walk(root).flatMap((f) =>
    riskyScales(fs.readFileSync(f, "utf8")).map(
      (n) => `${path.relative(root, f)}:${n}`,
    ),
  );
  assert.deepEqual(found, []);
});
