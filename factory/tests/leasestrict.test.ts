// A GPU or PC turn counts only when the orchestrator granted it (26 Nov 2026): the PC's picture upscale started
// ComfyUI at about 13:16 without a grant and held the Explainer's p50 job for 57 minutes. The shared client fails open
// when its hold process exits before the TIMEOUT line is read, so a lease that resolves at or after its maxWait is
// taken as refused (src/lib/orch.ts leaseStrict) and every PC GPU or heavy lease in src goes through it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LeaseWaitRanOut, leaseStrict, type OrchClient } from "../src/lib/orch.ts";

/** A stand-in client: the lease resolves after `waitMs` on the fake clock, counting releases. */
function fake(waitMs: number) {
  let t = 1_000_000;
  const state = { released: 0, calls: [] as Array<{ cls: string; opts: Record<string, unknown> }> };
  const orch: OrchClient = {
    async lease(cls, opts) {
      state.calls.push({ cls, opts });
      t += waitMs;
      return () => {
        state.released++;
      };
    },
  };
  return { orch, state, now: () => t };
}

test("leaseStrict: a lease granted inside maxWait is handed back as it came", async () => {
  const f = fake(29 * 60_000);
  const release = await leaseStrict(f.orch, "gpu", { job: "x", maxWait: 30 }, f.now);
  assert.equal(f.state.released, 0);
  release();
  assert.equal(f.state.released, 1);
  assert.deepEqual(f.state.calls, [{ cls: "gpu", opts: { job: "x", maxWait: 30 } }]);
});

test("leaseStrict: a lease that resolves at or after maxWait is released and refused, so no GPU work starts", async () => {
  for (const waitMin of [30, 31, 57]) {
    const f = fake(waitMin * 60_000);
    let started = false;
    await assert.rejects(
      (async () => {
        await leaseStrict(f.orch, "gpu", { job: "Pulse picture upscale", maxWait: 30 }, f.now);
        started = true;
      })(),
      (err: unknown) =>
        err instanceof LeaseWaitRanOut &&
        /^orchestrator: no GPU turn \(wait ran out after 30 min\)/.test(err.message),
    );
    assert.equal(started, false, `${waitMin} min: the work never started`);
    assert.equal(f.state.released, 1, `${waitMin} min: whatever came back was released`);
  }
});

test("leaseStrict: a heavy lease names its class; a release that throws does not hide the refusal", async () => {
  const t = { now: 0 };
  const orch: OrchClient = {
    async lease() {
      t.now += 180 * 60_000;
      return () => {
        throw new Error("already gone");
      };
    },
  };
  await assert.rejects(leaseStrict(orch, "heavy", { maxWait: 180 }, () => t.now), /no heavy turn/);
});

test("leaseStrict: no maxWait (or a junk one) means no time limit to judge by", async () => {
  for (const opts of [{}, { maxWait: undefined }, { maxWait: null }, { maxWait: "lots" }, { maxWait: 0 }]) {
    const f = fake(5 * 3_600_000);
    await leaseStrict(f.orch, "gpu", opts as Record<string, unknown>, f.now);
    assert.equal(f.state.released, 0);
  }
});

test("leaseStrict: a refusal from the client itself passes through unchanged", async () => {
  const orch: OrchClient = {
    async lease() {
      throw new Error("orchestrator: still blocked after 30 min");
    },
  };
  await assert.rejects(leaseStrict(orch, "gpu", { maxWait: 30 }), /still blocked/);
});

test("every PC gpu or heavy lease in src goes through leaseStrict", () => {
  const root = path.join(import.meta.dirname, "..", "src");
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !p.endsWith(path.join("lib", "orch.ts"))) {
        const src = fs.readFileSync(p, "utf8");
        // orch.lease(...) on the client, any .lease("gpu"|"heavy", ...), or the client imported around src/lib/orch.ts.
        const rel = path.relative(root, p);
        if (/\borch\.lease\(|\.lease\(\s*["'](gpu|heavy)["']/.test(src)) bad.push(rel);
        if (/orch\.mjs["']/.test(src) && rel !== "platform.ts") bad.push(`${rel} (imports orch.mjs)`);
      }
    }
  };
  walk(root);
  assert.deepEqual(bad, [], "use leaseStrict(orch, cls, opts) from src/lib/orch.ts");
});

test("upscaleFiles: no GPU turn means no model run and the plain resize stays", async () => {
  const { upscaleFiles } = await import("../src/assets/upscale.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leasestrict-"));
  try {
    const src = path.join(dir, "a.png");
    fs.writeFileSync(src, "not really a picture");
    const r = await upscaleFiles({
      // A python that would fail loudly if it were ever run.
      python: path.join(dir, "no-such-python.exe"),
      modelDir: dir,
      model: "x",
      cacheDir: path.join(dir, "cache"),
      items: [{ kind: "image", src, dest: path.join(dir, "a_up.png"), height: 0, maxHeight: 2160 }],
      lease: async () => {
        throw new Error("orchestrator: no GPU turn (wait ran out after 60 min)");
      },
    });
    assert.equal(r.gpuSeconds, 0);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0]!.ok, false);
    assert.match(r.results[0]!.why ?? "", /^no GPU turn/);
    assert.deepEqual(fs.readdirSync(path.join(dir, "cache")), [], "no jobs file left behind");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
