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

import { pauseCuts, shiftWords } from "../src/voice/pauses.ts";

test("a mid-sentence stall is cut to a beat; sentence pauses are only shortened", () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end });
  const words = [w("Pulse", 0, 0.4), w("is", 0.44, 0.55), w("ranking", 0.64, 0.97), w("eight", 1.09, 1.39), w("Call", 2.63, 2.89), w("campaigns,", 3.3, 4.04), w("story.", 8.74, 9.25), w("Multiplayer,", 10.16, 10.9)];
  const cuts = pauseCuts(words);
  assert.equal(cuts.length, 3); // after "eight" (1.24 s), after "campaigns," (4.7 s), after "story." (0.91 s)
  const shifted = shiftWords(words, cuts);
  assert.ok(Math.abs(shifted[4]!.start - shifted[3]!.end - 0.12) < 0.01);
  assert.ok(Math.abs(shifted[7]!.start - shifted[6]!.end - 0.6) < 0.01);
  assert.equal(shifted[0]!.start, 0);
});

test("a bare Roman numeral standing in for a game is sent back; one after its series is fine", async () => {
  const { voiceProblems } = await import("../src/editorial/voice.ts");
  assert.ok(voiceProblems("The original drew the map, but III let you stand inside it.").some((p) => /"III" stands alone/.test(p)));
  assert.ok(voiceProblems("V let you swap between three leads.").some((p) => /"V" stands alone/.test(p)));
  assert.deepEqual(voiceProblems("GTA V let you swap. Grand Theft Auto IV is darker. Chapter II: the rise."), []);
});

import { resetElevenLabsCreditsCache } from "../src/voice/index.ts";

test("a restart during an ElevenLabs balance blip: the reading kept on disk lets the narrator speak (ELEVENLABS_BALANCE_STALE_HOURS)", async () => {
  const dir = await tmpDir();
  const srv = await fakeVoiceServer(dir);
  const realFetch = globalThis.fetch;
  // The subscription check never answers (18 Nov); voicing itself works.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/v1/user/subscription")) throw new Error("This operation was aborted");
    return realFetch(url.replace("https://api.elevenlabs.io", srv.url), init);
  }) as typeof fetch;
  try {
    const line = "Starfield's second expansion has slipped to early next year.";
    const base = { voiceProvider: "elevenlabs-first" as const, elevenLabsApiKey: "k", localTtsUrl: "http://127.0.0.1:9" };
    // Setting at 0: the old behaviour, no balance means no narrator.
    resetElevenLabsCreditsCache();
    await assert.rejects(
      narrate(testConfig(dir, { ...base, elevenLabsBalanceStaleHours: 0 }), line, path.join(dir, "a.mp3")),
      /balance unknown/,
    );
    // Setting on, with a reading from 3 hours ago on disk: ElevenLabs speaks, and the spend comes off the file.
    resetElevenLabsCreditsCache();
    const file = path.join(dir, "elevenlabs_balance.json");
    const at = Date.now() - 3 * 60 * 60 * 1000;
    await fs.writeFile(file, JSON.stringify({ left: 619_268, at }));
    const events: string[] = [];
    const n = await narrate(
      testConfig(dir, { ...base, elevenLabsBalanceStaleHours: 24 }),
      line,
      path.join(dir, "b.mp3"),
      undefined,
      { onEvent: (kind) => void events.push(kind) },
    );
    assert.equal(n.voice.provider, "elevenlabs");
    assert.equal(srv.requests.length, 1);
    assert.deepEqual(events, ["elevenlabs_balance_stale"]);
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { left: 619_268 - line.length, at });
    // A reading too small for the job and the reserve still refuses: never into overage.
    resetElevenLabsCreditsCache();
    await fs.writeFile(file, JSON.stringify({ left: 12_000, at }));
    await assert.rejects(
      narrate(testConfig(dir, { ...base, elevenLabsBalanceStaleHours: 24 }), line, path.join(dir, "c.mp3")),
      /characters left this month/,
    );
    assert.equal(srv.requests.length, 1);
  } finally {
    globalThis.fetch = realFetch;
    srv.close();
  }
});

test("a long script voiced on a disk balance gets no re-voices, and its upper-bound spend comes off the file", async () => {
  const dir = await tmpDir();
  const srv = await fakeVoiceServer(dir);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/v1/user/subscription")) throw new Error("This operation was aborted");
    return realFetch(url.replace("https://api.elevenlabs.io", srv.url), init);
  }) as typeof fetch;
  try {
    resetElevenLabsCreditsCache();
    const file = path.join(dir, "elevenlabs_balance.json");
    const at = Date.now() - 60 * 60 * 1000;
    await fs.writeFile(file, JSON.stringify({ left: 619_268, at }));
    const sentence = "Pulse checks every story before it ships, and this line runs long on purpose.";
    const text = Array(50).fill(sentence).join(" ");
    const { LONG_TEXT_CHARS } = await import("../src/voice/elevenlabsLong.ts");
    assert.ok(text.length > LONG_TEXT_CHARS);
    const cfg = testConfig(dir, {
      voiceProvider: "elevenlabs-first",
      elevenLabsApiKey: "k",
      localTtsUrl: "http://127.0.0.1:9",
      elevenLabsBalanceStaleHours: 12,
      voiceTakeCheck: true,
    });
    const n = await narrate(cfg, text, path.join(dir, "long.mp3"));
    assert.equal(n.voice.provider, "elevenlabs");
    const takes = srv.requests.length;
    assert.ok(takes >= 2, `spoken in takes (${takes})`);
    // Every request is a first take: the joined takes are exactly the script, so nothing was voiced twice.
    assert.equal(srv.requests.map((r) => r.text).join(" ").length, text.length);
    // A disk balance allows no re-voices, so only the script's own characters come off.
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { left: 619_268 - text.length, at });
  } finally {
    globalThis.fetch = realFetch;
    srv.close();
  }
});
