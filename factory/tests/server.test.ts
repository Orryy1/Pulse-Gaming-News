import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";
import { createEpisode, getEpisode, transition } from "../src/episodes.ts";
import { clusterItems } from "../src/discovery/cluster.ts";
import { signToken } from "../src/lib/crypto.ts";
import type { Services } from "../src/pipeline.ts";
import { testDb, tmpDir, testConfig, item } from "./helpers.ts";

test("approve links need a valid token, show a confirmation on GET and act only on POST", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir());
  const cluster = clusterItems([item("Starfield second expansion delayed to early 2027", "Xbox Wire", "official")])[0]!;
  await createEpisode(db, "ep1", cluster);
  await transition(db, "ep1", "selected", "awaiting_approval", {});
  const services = { db, cfg, notify: async () => undefined } as unknown as Services;
  // Ticks triggered by approval run against these minimal fakes; make them no-ops.
  (services as any).discover = async () => [];
  const server = http.createServer((req, res) => void createApp(db, cfg, services, {})(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/episodes/ep1/approve?t=nope`)).status, 403);
    const t = signToken("approve:ep1", cfg.appSecret, 600);
    const get = await fetch(`${base}/episodes/ep1/approve?t=${t}`);
    assert.equal(get.status, 200);
    assert.match(await get.text(), /Approve and publish/);
    assert.equal((await getEpisode(db, "ep1"))!.status, "awaiting_approval", "GET never acts");
    const rejectToken = signToken("reject:ep1", cfg.appSecret, 600);
    const wrong = await fetch(`${base}/episodes/ep1/approve?t=${t}`, { method: "POST", body: new URLSearchParams({ t: rejectToken }) });
    assert.equal(wrong.status, 403, "a reject token cannot approve");
    const post = await fetch(`${base}/episodes/ep1/approve?t=${t}`, { method: "POST", body: new URLSearchParams({ t }) });
    assert.equal(post.status, 200);
    const ep = (await getEpisode(db, "ep1"))!;
    assert.equal(ep.status, "approved");
    assert.equal(ep.approved_by, "human");
    const again = await fetch(`${base}/episodes/ep1/approve?t=${t}`, { method: "POST", body: new URLSearchParams({ t }) });
    assert.equal(again.status, 409);
    assert.equal((await fetch(`${base}/oauth/start`)).status, 403);
  } finally {
    server.close();
  }
});
