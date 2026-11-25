// Contact-sheet helpers for the GPU picture proofs.

/**
 * An ffmpeg filter that stacks n inputs side by side ("h") or one above another ("v") (pure), each run through `pre`
 * (a filter chain such as "scale=480:270") and converted to RGB first: the bundled ffmpeg 6.1.1 crashed (exit
 * 0xC0000374, heap corruption) stacking six JPEGs of mixed pixel formats on 20 Nov 2026, and converting each input
 * first stopped it.
 */
export function stack(n: number, dir: "h" | "v", pre = ""): string {
  const each = (k: number) => `[${k}]${pre}${pre ? "," : ""}format=rgb24`;
  if (n === 1) return each(0);
  const inputs = Array.from({ length: n }, (_, k) => `${each(k)}[s${k}]`).join(
    ";",
  );
  const labels = Array.from({ length: n }, (_, k) => `[s${k}]`).join("");
  return `${inputs};${labels}${dir}stack=${n}`;
}
