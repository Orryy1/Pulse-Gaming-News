// The Packaging Lab's model (pure): a ridge regression over standardised features, fitted first on the study corpus
// (thousands of other channels' gaming titles, each scored against its own channel's neighbouring uploads) and then
// on Pulse's own videos with the corpus weights as the prior, so a few dozen Pulse videos bend the model towards this
// channel without throwing away what the corpus taught. Small, inspectable and free to run: no network, no GPU.

export interface LinearModel {
  /** Feature names, in the order of mean, scale and weights. */
  names: string[];
  mean: number[];
  scale: number[];
  weights: number[];
  bias: number;
  /** Where it was fitted and how well it ranked held-out rows (pairwise accuracy, 0.5 is chance). */
  meta?: Record<string, unknown>;
}

export interface Sample {
  x: number[];
  y: number;
  /** Rows are compared only within a group (a channel, a format, a day); ungrouped rows all compare. */
  group?: string;
  weight?: number;
}

/** Solves A x = b by Gaussian elimination with partial pivoting (A is small and symmetric positive definite). */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const d = M[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / (row[i] || 1e-12));
}

/** Column means and spreads; a constant column gets scale 1 so it contributes nothing rather than dividing by zero. */
export function standardiser(X: number[][]): {
  mean: number[];
  scale: number[];
} {
  const d = X[0]?.length ?? 0;
  const mean = Array.from(
    { length: d },
    (_, j) => X.reduce((a, r) => a + r[j]!, 0) / (X.length || 1),
  );
  const scale = mean.map((m, j) => {
    const v = X.reduce((a, r) => a + (r[j]! - m) ** 2, 0) / (X.length || 1);
    return v > 1e-9 ? Math.sqrt(v) : 1;
  });
  return { mean, scale };
}

/**
 * Fits weights minimising sum w_i (y_i - b - x_i.w)^2 + lambda |w - prior|^2 on standardised features. With a
 * prior model, its mean and scale are kept so the two sets of weights mean the same thing.
 */
export function fitRidge(
  names: string[],
  samples: Sample[],
  lambda: number,
  prior?: LinearModel,
): LinearModel {
  const X = samples.map((s) => s.x);
  const { mean, scale } = prior ?? standardiser(X);
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]!) / scale[j]!));
  const d = names.length;
  const w0 = prior?.weights ?? new Array(d).fill(0);
  const sw = samples.map((s) => s.weight ?? 1);
  const W = sw.reduce((a, b) => a + b, 0) || 1;
  const ybar = samples.reduce((a, s, i) => a + sw[i]! * s.y, 0) / W;
  const zbar = Array.from(
    { length: d },
    (_, j) => Z.reduce((a, r, i) => a + sw[i]! * r[j]!, 0) / W,
  );
  const A = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => (i === j ? lambda : 0)),
  );
  const b = w0.map((w) => lambda * w);
  Z.forEach((r, n) => {
    const y = samples[n]!.y - ybar;
    for (let i = 0; i < d; i++) {
      const zi = r[i]! - zbar[i]!;
      b[i]! += sw[n]! * zi * y;
      for (let j = 0; j < d; j++) A[i]![j]! += sw[n]! * zi * (r[j]! - zbar[j]!);
    }
  });
  const weights = solve(A, b);
  const bias = ybar - weights.reduce((a, w, j) => a + w * zbar[j]!, 0);
  return {
    names: [...names],
    mean: [...mean],
    scale: [...scale],
    weights,
    bias,
  };
}

/** The model's score for one feature row (pure). */
export function predict(m: LinearModel, x: number[]): number {
  let s = m.bias;
  for (let j = 0; j < m.weights.length; j++)
    s += m.weights[j]! * (((x[j] ?? 0) - m.mean[j]!) / m.scale[j]!);
  return s;
}

/** The model's score for a named feature vector (pure); a missing feature counts as its mean. */
export function predictNamed(
  m: LinearModel,
  f: Record<string, number>,
): number {
  return predict(
    m,
    m.names.map((k, j) => (k in f ? f[k]! : m.mean[j]!)),
  );
}

/**
 * Pairwise accuracy: of every pair of rows in the same group with different outcomes, the share the scores order the
 * same way (ties in score count half). 0.5 is a coin; 1 is perfect. This is what picking among candidates needs.
 */
export function pairwiseAccuracy(
  rows: Array<{ score: number; y: number; group?: string }>,
): { accuracy: number; pairs: number } {
  const byGroup = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = r.group ?? "";
    byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
  }
  let good = 0;
  let pairs = 0;
  for (const list of byGroup.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.y === b.y) continue;
        pairs++;
        const ds = a.score - b.score;
        if (ds === 0) good += 0.5;
        else if (ds > 0 === a.y > b.y) good++;
      }
  return { accuracy: pairs ? good / pairs : 0.5, pairs };
}

/** Spearman rank correlation (pure); 0 when there are fewer than three rows. */
export function spearman(a: number[], b: number[]): number {
  if (a.length < 3) return 0;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length).fill(0);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const m = (ra.length - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - m) * (rb[i]! - m);
    da += (ra[i]! - m) ** 2;
    db += (rb[i]! - m) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** The features that move the score most, signed, for reports and the owner's log line. */
export function topWeights(
  m: LinearModel,
  n = 8,
): Array<{ name: string; weight: number }> {
  return m.names
    .map((name, j) => ({ name, weight: m.weights[j]! }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, n);
}
