import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { YouTubeClient, SessionGone } from "../src/youtube/upload.ts";
import { FatalError } from "../src/lib/util.ts";
import { tmpDir } from "./helpers.ts";

type Call = { url: string; method: string; headers: Record<string, string>; bodyLength: number };

function fakeFetch(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    const body = init.body as Buffer | string | undefined;
    const c: Call = { url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, bodyLength: body ? (typeof body === "string" ? body.length : body.length) : 0 };
    calls.push(c);
    return handler(c);
  };
  return { fn, calls };
}

async function videoFile(bytes = 1000): Promise<string> {
  const f = path.join(await tmpDir(), "v.mp4");
  await fs.writeFile(f, Buffer.alloc(bytes, 1));
  return f;
}

test("resumes from the byte the server already has", async () => {
  const file = await videoFile(1000);
  const { fn, calls } = fakeFetch((c) => {
    if (c.headers["content-range"] === "bytes */1000") return new Response(null, { status: 308, headers: { range: "bytes=0-399" } });
    return new Response(JSON.stringify({ id: "abc" }), { status: 200 });
  });
  const yt = new YouTubeClient(async () => "tok", fn);
  assert.equal(await yt.uploadToSession("https://up/s1", file), "abc");
  const put = calls[1]!;
  assert.equal(put.headers["content-range"], "bytes 400-999/1000");
  assert.equal(put.bodyLength, 600);
});

test("a finished session returns the id without re-sending bytes", async () => {
  const file = await videoFile();
  const { fn, calls } = fakeFetch(() => new Response(JSON.stringify({ id: "done" }), { status: 200 }));
  const yt = new YouTubeClient(async () => "tok", fn);
  assert.equal(await yt.uploadToSession("https://up/s1", file), "done");
  assert.equal(calls.length, 1);
});

test("expired sessions and hard API errors are distinguished", async () => {
  const file = await videoFile();
  const gone = new YouTubeClient(async () => "tok", fakeFetch(() => new Response(null, { status: 404 })).fn);
  await assert.rejects(gone.uploadToSession("https://up/s", file), SessionGone);
  const quota = new YouTubeClient(
    async () => "tok",
    fakeFetch(() => new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 })).fn,
  );
  await assert.rejects(quota.createSession({}, 10), (e: unknown) => e instanceof FatalError && /quotaExceeded/.test((e as Error).message));
});

test("finds a previous upload by its marker tag", async () => {
  const { fn } = fakeFetch((c) => {
    if (c.url.includes("/channels")) return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] });
    if (c.url.includes("/playlistItems")) return Response.json({ items: [{ contentDetails: { videoId: "a" } }, { contentDetails: { videoId: "b" } }] });
    return Response.json({ items: [{ id: "a", snippet: { tags: ["x"] } }, { id: "b", snippet: { tags: ["pulserefep1"] } }] });
  });
  const yt = new YouTubeClient(async () => "tok", fn);
  assert.equal(await yt.findByMarker("pulserefep1"), "b");
  assert.equal(await yt.findByMarker("pulserefep2"), undefined);
});
