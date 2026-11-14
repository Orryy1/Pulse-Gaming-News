// The hand check (proof, 14 Nov 2026): frames a person looked at, with what was really on screen, scored against
// what the reader said. Pure. A field is scored only on frames where it applies (stars only on live-play frames,
// a banner only where the person wrote one down or wrote that there was none), so a long menu cannot pad a score.

import type { RawTelemetry } from "./telemetry.ts";

export interface HandLabel {
  t: number;
  state: "hud" | "menu" | "black" | "other";
  /** The wanted level shown (live-play frames). */
  stars?: number;
  /** Words of a banner or centre message on screen, "" when there is none; left out when not checked. */
  banner?: string;
  /** The area name printed bottom right, "" when none; left out when not checked. */
  area?: string;
  /** The person's verdict on the radar beside the stitched map at the reader's pose. */
  position?: "right" | "wrong" | "n/a";
  note?: string;
}

export interface FieldScore {
  checked: number;
  right: number;
  accuracy: number | null;
  misses: Array<{ t: number; truth: string; read: string }>;
}

export interface HandCheck {
  frames: number;
  fields: Record<
    "state" | "stars" | "banner" | "area" | "position",
    FieldScore
  >;
  /** Every scored decision over every field. */
  overall: { checked: number; right: number; accuracy: number | null };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function textsNear(
  raw: RawTelemetry,
  t: number,
  regions: string[],
  before = 1.6,
  after = 0.6,
): string {
  const out: string[] = [];
  for (const s of raw.samples)
    if (s.t >= t - before && s.t <= t + after)
      for (const r of regions) out.push(...(s.texts?.[r] ?? []));
  return out.join(" ");
}

/** Whether the read words carry the label's words (pure): every word of three letters or more, in any order. */
export function textMatches(truth: string, read: string): boolean {
  const want = norm(truth)
    .split(" ")
    .filter((w) => w.length >= 3 || /\d/.test(w));
  const got = new Set(norm(read).split(" "));
  if (!want.length) return !norm(read);
  return want.every((w) => got.has(w));
}

export function scoreHandCheck(
  raw: RawTelemetry,
  labels: HandLabel[],
): HandCheck {
  const field = (): FieldScore => ({
    checked: 0,
    right: 0,
    accuracy: null,
    misses: [],
  });
  const f = {
    state: field(),
    stars: field(),
    banner: field(),
    area: field(),
    position: field(),
  };
  const mark = (
    k: keyof typeof f,
    ok: boolean,
    t: number,
    truth: string,
    read: string,
  ) => {
    f[k].checked++;
    if (ok) f[k].right++;
    else f[k].misses.push({ t, truth, read });
  };
  for (const l of labels) {
    const s = raw.samples.reduce((a, b) =>
      Math.abs(b.t - l.t) < Math.abs(a.t - l.t) ? b : a,
    );
    mark("state", s.state === l.state, l.t, l.state, s.state);
    if (l.state === "hud" && s.state === "hud" && l.stars !== undefined)
      mark(
        "stars",
        (s.stars ?? 0) === l.stars,
        l.t,
        String(l.stars),
        String(s.stars ?? 0),
      );
    if (l.banner !== undefined) {
      const read = textsNear(raw, l.t, ["banner", "centre"]);
      mark(
        "banner",
        l.banner ? textMatches(l.banner, read) : !read.trim(),
        l.t,
        l.banner || "(none)",
        read || "(none)",
      );
    }
    if (l.area !== undefined) {
      const read = textsNear(raw, l.t, ["area"]);
      mark(
        "area",
        l.area ? textMatches(l.area, read) : !/[A-Za-z]{3,}/.test(read),
        l.t,
        l.area || "(none)",
        read || "(none)",
      );
    }
    if (l.position && l.position !== "n/a")
      mark("position", l.position === "right", l.t, "right", l.position);
  }
  let checked = 0;
  let right = 0;
  for (const k of Object.keys(f) as Array<keyof typeof f>) {
    const x = f[k];
    x.accuracy = x.checked
      ? Math.round((x.right / x.checked) * 1000) / 1000
      : null;
    checked += x.checked;
    right += x.right;
  }
  return {
    frames: labels.length,
    fields: f,
    overall: {
      checked,
      right,
      accuracy: checked ? Math.round((right / checked) * 1000) / 1000 : null,
    },
  };
}
