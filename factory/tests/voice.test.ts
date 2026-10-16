import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { chunkText, synthesiseLocal } from "../src/voice/local.ts";
import { narrate, providerOrder } from "../src/voice/index.ts";
import { probe } from "../src/qa/media.ts";
import { FFMPEG } from "../src/lib/bin.ts";
import { tmpDir, testConfig } from "./helpers.ts";

test("chunks narration at sentence boundaries under the take limit", () => {
  const text = "One two three four five. Six seven eight nine ten eleven. Twelve thirteen fourteen.";
  assert.deepEqual(chunkText(text, 8), ["One two three four five.", "Six seven eight nine ten eleven.", "Twelve thirteen fourteen."]);
  assert.deepEqual(chunkText(text, 40), [text]);
  const long = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ") + ".";
  assert.ok(chunkText(long, 20).every((c) => c.split(" ").length <= 20));
});

/** A stand-in for tts_server: 0.25s of tone per word, with character timings. */
async function fakeVoiceServer(dir: string, flaw: { stallFirst?: boolean; padSeconds?: number } = {}) {
  const requests: Array<{ voice: string; text: string; rate: number }> = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") return res.writeHead(200).end("{}");
    if (req.method !== "POST") return res.writeHead(405).end(); // FastAPI answers GET on a POST route with 405
    const voice = decodeURIComponent(req.url!.split("/")[3]!);
    let body = "";
    for await (const c of req) body += c;
    const { text, voice_settings } = JSON.parse(body);
    requests.push({ voice, text, rate: voice_settings.speaking_rate });
    const words = text.split(/\s+/);
    const dur = words.length * 0.25;
    const f = path.join(dir, `fake_${requests.length}.mp3`);
    // A flawed first take: 2.6s of dead air in the middle (engine stall), and/or audio
    // running on past the text (padSeconds), the way a cold VoxCPM sometimes behaves.
    const stall = flaw.stallFirst && requests.length === 1;
    const total = dur + (stall ? 2.6 : 0) + (flaw.padSeconds ?? 0);
    const filters = stall ? `,volume=enable='between(t,1,3.6)':volume=0` : "";
    execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=f=220:d=${total}`, "-af", `anull${filters}`, "-ar", "44100", "-ac", "1", f]);
    const chars = [...text];
    const per = (stall ? dur + 2.6 : dur) / chars.length; // the aligner spans the stall but never the padding
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        audio_base64: (await fs.readFile(f)).toString("base64"),
        alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * per), character_end_times_seconds: chars.map((_, i) => (i + 1) * per) },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, close: () => server.close() };
}

test("stitches local takes with word timings offset onto one timeline", async () => {
  const dir = await tmpDir();
  const srv = await fakeVoiceServer(dir);
  try {
    const sentence = "Pulse checks every story before it ships today.";
    const text = Array(6).fill(sentence).join(" "); // 48 words -> two takes
    const out = path.join(dir, "voice.mp3");
    const n = await synthesiseLocal(text, out, { baseUrl: srv.url, voiceId: "TX3LPaxmHKxFdv7VOQHJ", speakingRate: 0.95, maxWordsPerTake: 36 });
    assert.equal(srv.requests.length, 2);
    assert.ok(srv.requests.every((r) => r.voice === "TX3LPaxmHKxFdv7VOQHJ" && r.rate === 0.95));
    assert.equal(n.words.length, 48);
    for (let i = 1; i < n.words.length; i++) assert.ok(n.words[i]!.start >= n.words[i - 1]!.start, "timings are monotonic");
    const firstOfTake2 = n.words[srv.requests[0]!.text.split(/\s+/).length]!;
    assert.ok(firstOfTake2.start >= srv.requests[0]!.text.split(/\s+/).length * 0.25, "second take is offset past the first");
    const real = (await probe(out)).durationSeconds;
    assert.ok(Math.abs(real - n.durationSeconds) < 0.4, `stitched ${real}s vs reported ${n.durationSeconds}s`);
  } finally {
    srv.close();
  }
});

test("narrate uses the local voice, polishes it, and reports a missing server clearly", async () => {
  const dir = await tmpDir();
  const srv = await fakeVoiceServer(dir);
  try {
    const cfg = testConfig(dir, { voiceProvider: "local", localTtsUrl: srv.url });
    const n = await narrate(cfg, "Starfield's second expansion has slipped to early next year.", path.join(dir, "v.mp3"));
    assert.equal(n.words.length, 9);
  } finally {
    srv.close();
  }
  const down = testConfig(dir, { voiceProvider: "local", localTtsUrl: "http://127.0.0.1:9" });
  await assert.rejects(narrate(down, "Hello there.", path.join(dir, "x.mp3")), /no narrator available.*not running/);
});

test("re-synthesises a stalled take and trims audio that runs past the script", async () => {
  const dir = await tmpDir();
  const srv = await fakeVoiceServer(dir, { stallFirst: true, padSeconds: 4 });
  try {
    const text = "One two three four five six seven eight.";
    const n = await synthesiseLocal(text, path.join(dir, "n.mp3"), { baseUrl: srv.url, voiceId: "TX3LPaxmHKxFdv7VOQHJ", speakingRate: 1 });
    assert.equal(srv.requests.length, 2, "the stalled first take is synthesised again");
    const real = (await probe(path.join(dir, "n.mp3"))).durationSeconds;
    assert.ok(real < 8 * 0.25 + 0.6, `padding past the last aligned word was cut (got ${real}s)`);
    assert.ok(Math.abs(real - n.durationSeconds) < 0.4, `stitched ${real}s vs reported ${n.durationSeconds}s`);
  } finally {
    srv.close();
  }
});

test("provider order follows VOICE_PROVIDER and elevenlabs-first falls back to the local voice", async () => {
  assert.deepEqual(providerOrder("local"), ["local"]);
  assert.deepEqual(providerOrder("elevenlabs"), ["elevenlabs"]);
  assert.deepEqual(providerOrder("auto"), ["local", "elevenlabs"]);
  assert.deepEqual(providerOrder("elevenlabs-first"), ["elevenlabs", "local"]);
  const dir = await tmpDir();
  const srv = await fakeVoiceServer(dir);
  try {
    // No ElevenLabs key: the preferred narrator is skipped and the local clone speaks.
    const cfg = testConfig(dir, { voiceProvider: "elevenlabs-first", elevenLabsApiKey: "", localTtsUrl: srv.url });
    const n = await narrate(cfg, "Short test line.", path.join(dir, "p.mp3"));
    assert.ok(n.durationSeconds > 0.5);
    assert.equal(srv.requests.length, 1);
  } finally {
    srv.close();
  }
});
