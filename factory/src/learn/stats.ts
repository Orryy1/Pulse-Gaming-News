// Small, seeded statistics for the learning core: rank correlations with bootstrap intervals, Kendall's tau for drift,
// normal draws for Thompson sampling. Seeded so the same data always gives the same report.

/** mulberry32: a small seeded generator in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from a string (FNV-1a). */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A standard normal draw (Box-Muller). */
export function normal(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/** Average ranks (ties share their mean rank). */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]![1]] = r;
    i = j + 1;
  }
  return out;
}

export function pearson(xs: number[], ys: number[]): number | undefined {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return undefined;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return undefined;
  return sxy / Math.sqrt(sxx * syy);
}

/** Spearman's rank correlation; undefined when either side has no spread. */
export const spearman = (xs: number[], ys: number[]): number | undefined =>
  pearson(ranks(xs), ranks(ys));

/** Kendall's tau-b (ties handled), for comparing two rankings of the same items. */
export function kendall(xs: number[], ys: number[]): number | undefined {
  const n = xs.length;
  if (n < 3) return undefined;
  let c = 0;
  let d = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = Math.sign(xs[i]! - xs[j]!);
      const b = Math.sign(ys[i]! - ys[j]!);
      if (a === 0 && b === 0) continue;
      if (a === 0) tx++;
      else if (b === 0) ty++;
      else if (a === b) c++;
      else d++;
    }
  const den = Math.sqrt((c + d + tx) * (c + d + ty));
  return den ? (c - d) / den : undefined;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** A bootstrap interval for Spearman's rho over paired data (resampling pairs). */
export function spearmanCi(
  xs: number[],
  ys: number[],
  o: { draws?: number; level?: number; seed?: number } = {},
): { rho?: number; lo?: number; hi?: number } {
  const rho = spearman(xs, ys);
  if (rho === undefined) return {};
  const draws = o.draws ?? 1000;
  const level = o.level ?? 0.9;
  const r = rng(o.seed ?? 11);
  const n = xs.length;
  const got: number[] = [];
  for (let d = 0; d < draws; d++) {
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = Math.floor(r() * n);
      a.push(xs[k]!);
      b.push(ys[k]!);
    }
    const s = spearman(a, b);
    if (s !== undefined) got.push(s);
  }
  if (got.length < draws / 2) return { rho };
  got.sort((p, q) => p - q);
  return {
    rho,
    lo: quantile(got, (1 - level) / 2),
    hi: quantile(got, 1 - (1 - level) / 2),
  };
}

/** P(mean of b > mean of a) by bootstrap; 0.5 with no data. */
export function bootstrapProb(
  a: number[],
  b: number[],
  draws = 2000,
  seed = 7,
): number {
  if (!a.length || !b.length) return 0.5;
  const r = rng(seed);
  const draw = (xs: number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(r() * xs.length)]!;
    return s / xs.length;
  };
  let wins = 0;
  for (let d = 0; d < draws; d++) if (draw(b) > draw(a)) wins++;
  return wins / draws;
}
