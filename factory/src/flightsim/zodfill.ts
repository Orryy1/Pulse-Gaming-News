// A plain, valid answer to any structured model call the flight simulator has no recorded fixture for (src/flightsim):
// built from the zod schema itself, then checked against it. Undefined when no valid answer can be built, so the
// simulator says which call needs a fixture rather than inventing something that would not parse.

import type { z } from "zod";

interface Def {
  type: string;
  shape?: Record<string, z.ZodType> | (() => Record<string, z.ZodType>);
  element?: z.ZodType;
  innerType?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
  options?: z.ZodType[];
  entries?: Record<string, string | number>;
  values?: unknown[];
  defaultValue?: unknown;
  valueType?: z.ZodType;
  items?: z.ZodType[];
  checks?: Array<{
    _zod?: {
      def?: {
        check?: string;
        minimum?: number;
        value?: number;
        format?: string;
      };
    };
  }>;
  getter?: () => z.ZodType;
}

function defOf(s: z.ZodType): Def {
  return (s as unknown as { _zod: { def: Def } })._zod.def;
}

function minOf(d: Def, kind: "min_length" | "greater_than"): number {
  let n = 0;
  for (const c of d.checks ?? []) {
    const cd = c._zod?.def;
    if (
      cd?.check === kind ||
      (kind === "min_length" && cd?.check === "length_equals")
    )
      n = Math.max(n, Number(cd.minimum ?? cd.value ?? 0));
  }
  return n;
}

function build(s: z.ZodType, depth: number): unknown {
  if (depth > 12) return undefined;
  const d = defOf(s);
  switch (d.type) {
    case "string": {
      const fmt = (d.checks ?? [])
        .map((c) => c._zod?.def?.format)
        .find(Boolean);
      if (fmt === "url") return "https://sim.example/x";
      if (fmt === "email") return "sim@example.com";
      if (fmt === "datetime") return "2026-11-14T12:00:00Z";
      const n = Math.max(minOf(d, "min_length"), 12);
      return (
        "simulated answer text "
          .repeat(Math.ceil(n / 22))
          .slice(0, Math.max(n, 12))
          .trim() || "simulated"
      );
    }
    case "number":
    case "int":
      return Math.max(1, minOf(d, "greater_than"));
    case "boolean":
      return false;
    case "null":
      return null;
    case "undefined":
    case "void":
      return undefined;
    case "any":
    case "unknown":
      return "";
    case "literal":
      return d.values?.[0];
    case "enum":
      return Object.values(d.entries ?? {})[0];
    case "optional":
      return undefined;
    case "nullable":
      return null;
    case "default":
    case "prefault":
      return typeof d.defaultValue === "function"
        ? (d.defaultValue as () => unknown)()
        : d.defaultValue;
    case "catch":
    case "readonly":
    case "nonoptional":
      return build(d.innerType!, depth + 1);
    case "pipe":
      return build(d.in!, depth + 1);
    case "lazy":
      return d.getter ? build(d.getter(), depth + 1) : undefined;
    case "array": {
      const n = minOf(d, "min_length");
      return Array.from({ length: n }, () => build(d.element!, depth + 1));
    }
    case "tuple":
      return (d.items ?? []).map((i) => build(i, depth + 1));
    case "record":
      return {};
    case "union":
      for (const o of d.options ?? []) {
        const v = build(o, depth + 1);
        if (o.safeParse(v).success) return v;
      }
      return undefined;
    case "object": {
      const shape = typeof d.shape === "function" ? d.shape() : (d.shape ?? {});
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape)) {
        const x = build(v, depth + 1);
        if (x !== undefined) out[k] = x;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** A value the schema accepts, or undefined when one cannot be made. */
export function minimalOf(schema: z.ZodType): unknown {
  try {
    const v = build(schema, 0);
    const r = schema.safeParse(v);
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}
