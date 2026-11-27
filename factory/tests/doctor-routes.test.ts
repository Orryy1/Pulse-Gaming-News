import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedPublicRoutes,
  checkPublicUrl,
  PUBLIC_EPISODE_ROUTES,
} from "../src/doctor.ts";
import { approvalLinks } from "../src/pipeline.ts";
import type { Config } from "../src/config.ts";

test("the public link check covers every per-episode link the factory hands out", () => {
  const links = approvalLinks(
    { publicUrl: "https://example.test", appSecret: "s" } as Config,
    "ep_x",
  );
  const routes = new Set(
    Object.values(links).map((u) => new URL(u).pathname.split("/").pop()!),
  );
  for (const r of routes)
    assert.ok((PUBLIC_EPISODE_ROUTES as readonly string[]).includes(r), r);
});

test("a route the factory answers (403 on a wrong token) passes; a tunnel 404 is named", () => {
  const all403 = Object.fromEntries(PUBLIC_EPISODE_ROUTES.map((r) => [r, 403]));
  assert.deepEqual(blockedPublicRoutes(all403), []);
  // 25-26 Nov 2026: the tunnel's episodes rule let video.mp4 through but not social.mp4 or cover.jpg.
  assert.deepEqual(
    blockedPublicRoutes({ ...all403, "social.mp4": 404, "cover.jpg": 404 }),
    ["social.mp4", "cover.jpg"],
  );
  assert.deepEqual(blockedPublicRoutes({}), [...PUBLIC_EPISODE_ROUTES]);
});

const answer = (status: number) => new Response("x", { status });

test("checkPublicUrl names the blocked route and keeps the others when one times out", async () => {
  const ok = await checkPublicUrl(
    { publicUrl: "https://example.test" },
    async () => answer(403),
  );
  assert.equal(ok?.ok, true);
  const blocked = await checkPublicUrl(
    { publicUrl: "https://example.test" },
    async (url) => {
      if (url.includes("/social.mp4")) return answer(404);
      if (url.includes("/cover.jpg")) throw new Error("timeout");
      return answer(403);
    },
  );
  assert.equal(blocked?.ok, false);
  assert.match(blocked!.detail, /social\.mp4 \(HTTP 404\)/);
  assert.match(blocked!.detail, /cover\.jpg \(no answer\)/);
  assert.doesNotMatch(blocked!.detail, /approve/);
  const down = await checkPublicUrl(
    { publicUrl: "https://example.test" },
    async () => {
      throw new Error("timeout");
    },
  );
  assert.match(down!.detail, /unreachable/);
  assert.equal(
    await checkPublicUrl({ publicUrl: "http://127.0.0.1:8080" }, async () =>
      answer(403),
    ),
    undefined,
  );
});
