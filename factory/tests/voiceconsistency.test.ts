import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import {
  refusedFields,
  requestBody,
  synthesise,
} from "../src/voice/elevenlabs.ts";
import {
  chunkTakes,
  contextFor,
  seedFor,
  supportsStitching,
  synthesiseElevenLabsLong,
  LONG_TAKE_CHARS,
} from "../src/voice/elevenlabsLong.ts";
import {
  analyseVoice,
  closer,
  outliers,
  spread,
  type TakeMeasure,
} from "../src/voice/takecheck.ts";
import { episodeIdOf } from "../src/voice/index.ts";
import { FFMPEG } from "../src/lib/bin.ts";
import { tmpDir } from "./helpers.ts";

const sentence = (i: number) =>
  `Sentence number ${i} tells the story of a studio that shipped its game on time.`;

test("long scripts split at paragraph ends first, every take under the cap", () => {
  const para = (p: number) =>
    Array.from({ length: 10 }, (_, i) => sentence(p * 10 + i)).join(" "); // about 800 characters
  const text = Array.from({ length: 6 }, (_, p) => para(p)).join("\n\n");
  const takes = chunkTakes(text, 2000);
  assert.ok(takes.length >= 3 && takes.length <= 4, `${takes.length} takes`);
  assert.ok(takes.every((t) => t.length <= 2000));
  // Every seam is a paragraph end: each take holds whole paragraphs.
  for (const t of takes)
    assert.equal(
      t.split("\n\n").filter((p) => p.split(/(?<=\.) /).length !== 10).length,
      0,
      "whole paragraphs only",
    );
  assert.equal(takes.join("\n\n"), text, "nothing lost or reordered");
});

test("without paragraphs, takes end at sentence ends and come out of similar size", () => {
  const text = Array.from({ length: 200 }, (_, i) => sentence(i)).join(" "); // about 16,000 characters
  const takes = chunkTakes(text);
  assert.ok(takes.every((t) => t.length <= LONG_TAKE_CHARS));
  assert.ok(
    takes.every((t) => /\.$/.test(t)),
    "each take ends on a full stop",
  );
  assert.ok(
    takes.length <= Math.ceil(text.length / LONG_TAKE_CHARS) + 1,
    `${takes.length} takes`,
  );
  const sizes = takes.map((t) => t.length);
  assert.ok(
    Math.min(...sizes) > 0.6 * Math.max(...sizes),
    `balanced: ${sizes.join(",")}`,
  );
  assert.equal(takes.join(" "), text);
  assert.deepEqual(chunkTakes("Short one."), ["Short one."]);
});

test("each take's context is the neighbours' text, trimmed at a word", () => {
  const takes = ["alpha beta gamma delta", "middle take", "omega psi chi phi"];
  assert.deepEqual(contextFor(takes, 0), {
    previousText: undefined,
    nextText: "middle take",
  });
  assert.deepEqual(contextFor(takes, 1, 12), {
    previousText: "gamma delta",
    nextText: "omega psi",
  });
  assert.equal(seedFor("same text"), seedFor("same text"));
  assert.notEqual(seedFor("same text"), seedFor("other text"));
  assert.ok(seedFor("x") >= 0 && seedFor("x") <= 4294967295);
  assert.equal(supportsStitching("eleven_v3"), false);
  assert.equal(supportsStitching("eleven_multilingual_v2"), true);
});

test("the request body carries the context and seed, minus refused fields", () => {
  const ctx = {
    previousText: "Before.",
    nextText: "After.",
    previousRequestIds: ["a", "b", "c", "d"],
    seed: 42,
  };
  const body = requestBody("Now.", { modelId: "eleven_v3", context: ctx });
  assert.equal(body.previous_text, "Before.");
  assert.equal(body.next_text, "After.");
  assert.deepEqual(
    body.previous_request_ids,
    ["b", "c", "d"],
    "at most three, the latest",
  );
  assert.equal(body.seed, 42);
  assert.equal(body.next_request_ids, undefined);
  assert.equal(
    (body.voice_settings as { stability: number }).stability,
    1.0,
    "the owner's settings are untouched",
  );
  const without = requestBody("Now.", {
    modelId: "eleven_v3",
    context: ctx,
    unsupported: new Set(["seed", "previous_text"]),
  });
  assert.equal(without.seed, undefined);
  assert.equal(without.previous_text, undefined);
  assert.equal(without.next_text, "After.");
  assert.equal(
    requestBody("Now.", { modelId: "eleven_v3" }).seed,
    undefined,
    "a Short sends no context",
  );
  assert.deepEqual(
    refusedFields(422, "Field next_text is not supported for this model", [
      "text",
      "next_text",
      "seed",
    ]),
    ["next_text"],
  );
  assert.deepEqual(
    refusedFields(400, "bad request", ["text", "next_text", "seed"]),
    ["next_text", "seed"],
  );
  assert.deepEqual(refusedFields(400, "bad request", ["text", "model_id"]), []);
  assert.deepEqual(refusedFields(500, "next_text", ["next_text"]), []);
  // eleven_v3's real answer of 31 Oct 2026, to a first take that only carried next_text: both are refused at once.
  assert.deepEqual(
    refusedFields(
      400,
      `{"detail":{"type":"validation_error","code":"unsupported_model","message":"Providing previous_text or next_text is not yet supported with the 'eleven_v3' model."}}`,
      ["text", "next_text", "seed"],
    ),
    ["previous_text", "next_text"],
  );
});

/** Mono sawtooth samples at `hz` for `seconds`. */
function saw(hz: number, seconds: number, rate = 16_000): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++)
    out[i] = 0.5 * (2 * ((i * hz) / rate - Math.floor((i * hz) / rate)) - 1);
  return out;
}

test("the analyser reads a 120 Hz and a 128 Hz sawtooth about 6.7% apart", () => {
  const a = analyseVoice(saw(120, 2));
  const b = analyseVoice(saw(128, 2));
  assert.ok(Math.abs(a.pitchHz - 120) < 1, `120 read as ${a.pitchHz}`);
  assert.ok(Math.abs(b.pitchHz - 128) < 1, `128 read as ${b.pitchHz}`);
  const apart = (b.pitchHz / a.pitchHz - 1) * 100;
  assert.ok(Math.abs(apart - 6.67) < 0.5, `${apart.toFixed(2)}% apart`);
  assert.ok(a.voicedFrames > 40);
  assert.ok(a.highShare > 0 && a.highShare < 0.2);
  // Hiss is far brighter than a buzz: the centroid and the high band both say so.
  let s = 1;
  const noise = Float32Array.from(
    { length: 32_000 },
    () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5,
  );
  const n = analyseVoice(noise);
  assert.ok(
    n.centroidHz > 2 * a.centroidHz,
    `noise ${n.centroidHz} vs saw ${a.centroidHz}`,
  );
  assert.ok(n.highShare > 2 * a.highShare);
  // Silence has no voice to measure.
  assert.equal(analyseVoice(new Float32Array(32_000)).voicedFrames, 0);
});

const m = (
  pitchHz: number,
  centroidHz = 1000,
  highShare = 0.03,
): TakeMeasure => ({ pitchHz, centroidHz, highShare, voicedFrames: 300 });

test("a take 5% off in pitch or 10% off in centroid is picked, worst first, at most three", () => {
  assert.deepEqual(outliers([m(120), m(121), m(119), m(120)]), []);
  assert.deepEqual(
    outliers([m(120), m(128), m(119), m(120)]),
    [1],
    "6.7% high in pitch",
  );
  assert.deepEqual(
    outliers([m(120), m(120, 1150), m(120), m(120)]),
    [1],
    "15% bright",
  );
  assert.deepEqual(
    outliers([m(120), m(125.5), m(120), m(120)]),
    [],
    "4.6% high is inside the limit",
  );
  const many = [
    m(120),
    m(130),
    m(140),
    m(110),
    m(95),
    m(120),
    m(120),
    m(120),
    m(120),
  ];
  assert.deepEqual(outliers(many), [4, 2, 3], "three worst only");
  assert.deepEqual(
    outliers([m(120), m(140)]),
    [],
    "two takes have no meaningful median",
  );
  const norm = { pitchHz: 120, centroidHz: 1000, highShare: 0.03 };
  assert.equal(closer(m(128), m(121), norm), "revoice");
  assert.equal(closer(m(128), m(135), norm), "original");
  assert.equal(closer(m(128), { ...m(0), voicedFrames: 0 }, norm), "original");
  assert.deepEqual(spread([m(114), m(120), m(126)]), {
    pitchPct: 10,
    centroidPct: 0,
    highPct: 0,
  });
});

test("episode ids come from the narration's path", () => {
  const data = path.join("C:", "factory", "data");
  assert.equal(
    episodeIdOf(data, path.join(data, "episodes", "ep_1", "voice.mp3")),
    "ep_1",
  );
  assert.equal(
    episodeIdOf(data, path.join(data, "smoke", "voice.mp3")),
    undefined,
  );
  assert.equal(
    episodeIdOf(data, path.join(data, "episodes", "voice.mp3")),
    undefined,
  );
});

/**
 * A stand-in for the ElevenLabs with-timestamps endpoint: a two-second sawtooth per request, at the pitch
 * `pitchFor` picks, with character timings and a request-id header. `refuse` makes it answer 422 to bodies
 * carrying that field.
 */
async function fakeElevenLabs(
  dir: string,
  opts: {
    pitchFor?: (body: Record<string, unknown>, n: number) => number;
    refuse?: string;
  } = {},
) {
  const bodies: Record<string, unknown>[] = [];
  let made = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw) as Record<string, unknown>;
    bodies.push(body);
    if (opts.refuse && opts.refuse in body)
      return res.writeHead(422, { "content-type": "application/json" }).end(
        JSON.stringify({
          detail: {
            message: `${opts.refuse} is not supported with this model`,
          },
        }),
      );
    made++;
    const hz = opts.pitchFor?.(body, made) ?? 120;
    const f = path.join(dir, `fake_${made}.mp3`);
    execFileSync(FFMPEG, [
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `aevalsrc=0.5*(2*(t*${hz}-floor(t*${hz}))-1):s=44100:d=2`,
      "-ac",
      "1",
      f,
    ]);
    const chars = [...String(body.text)];
    const per = 1.9 / chars.length;
    res
      .writeHead(200, {
        "content-type": "application/json",
        "request-id": `req_${made}`,
      })
      .end(
        JSON.stringify({
          audio_base64: (await fs.readFile(f)).toString("base64"),
          alignment: {
            characters: chars,
            character_start_times_seconds: chars.map((_, i) => i * per),
            character_end_times_seconds: chars.map((_, i) => (i + 1) * per),
          },
        }),
      );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    bodies,
    close: () => server.close(),
  };
}

test("a refused continuity field is dropped, retried once and remembered for the run", async () => {
  const dir = await tmpDir();
  const srv = await fakeElevenLabs(dir, { refuse: "next_text" });
  try {
    const unsupported = new Set<string>();
    const opts = {
      apiKey: "k",
      voiceId: "v",
      modelId: "eleven_v3",
      baseUrl: srv.url,
      unsupported,
      context: { previousText: "Before.", nextText: "After.", seed: 7 },
    };
    const n = await synthesise("Hello there.", path.join(dir, "a.mp3"), opts);
    assert.equal(n.requestId, "req_1");
    assert.equal(srv.bodies.length, 2, "one refusal, one retry");
    assert.equal(srv.bodies[0]!.next_text, "After.");
    assert.equal(srv.bodies[1]!.next_text, undefined);
    assert.equal(
      srv.bodies[1]!.previous_text,
      "Before.",
      "the other fields stay",
    );
    assert.equal(srv.bodies[1]!.seed, 7);
    assert.ok(unsupported.has("next_text"));
    await synthesise("Again.", path.join(dir, "b.mp3"), opts);
    assert.equal(srv.bodies.length, 3, "remembered: no second refusal");
    assert.equal(srv.bodies[2]!.next_text, undefined);
  } finally {
    srv.close();
  }
});

const longText = () =>
  Array.from({ length: 120 }, (_, i) => sentence(i)).join(" "); // about 9,700 characters: four takes

test("long narration sends each take its neighbours' text and one seed; a stray take is re-voiced and the closer kept", async () => {
  const dir = await tmpDir();
  const text = longText();
  const takes = chunkTakes(text);
  assert.ok(takes.length >= 4);
  const base = seedFor(`v|${text}`);
  // The second take comes out a semitone high with the narration's seed; with any other seed it is in tune.
  const srv = await fakeElevenLabs(dir, {
    pitchFor: (b) => (b.text === takes[1] && b.seed === base ? 128 : 120),
  });
  const events: Array<{ kind: string; detail: Record<string, unknown> }> = [];
  try {
    const out = path.join(dir, "voice.mp3");
    const n = await synthesiseElevenLabsLong(text, out, {
      apiKey: "k",
      voiceId: "v",
      modelId: "eleven_v3",
      baseUrl: srv.url,
      takeCheck: true,
      onEvent: (kind, detail) => void events.push({ kind, detail }),
    });
    assert.equal(
      srv.bodies.length,
      takes.length + 1,
      "every take once, plus one re-voice",
    );
    for (const [i, b] of srv.bodies.slice(0, takes.length).entries()) {
      assert.equal(b.text, takes[i]);
      assert.equal(b.seed, base, "one seed for the whole narration");
      assert.equal(b.previous_text, contextFor(takes, i).previousText);
      assert.equal(b.next_text, contextFor(takes, i).nextText);
      assert.equal(
        b.previous_request_ids,
        undefined,
        "no request stitching on eleven_v3",
      );
    }
    const re = srv.bodies.at(-1)!;
    assert.equal(re.text, takes[1]);
    assert.notEqual(re.seed, base, "the re-voice samples afresh");
    assert.equal(
      re.previous_text,
      contextFor(takes, 1).previousText,
      "same context",
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, "voice_consistency");
    const d = events[0]!.detail as {
      revoiced: Array<{ take: number; kept: string }>;
      spread_before: { pitchPct: number };
      spread_after: { pitchPct: number };
    };
    assert.deepEqual(
      d.revoiced.map((r) => [r.take, r.kept]),
      [[1, "revoice"]],
    );
    assert.ok(
      d.spread_before.pitchPct > 5 && d.spread_after.pitchPct < 1,
      `${d.spread_before.pitchPct}% -> ${d.spread_after.pitchPct}%`,
    );
    const kept = analyseVoice(
      (() => {
        const raw = execFileSync(FFMPEG, [
          "-v",
          "error",
          "-i",
          path.join(dir, "takes", "take_001.mp3"),
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "s16le",
          "-",
        ]);
        return new Int16Array(
          raw.buffer,
          raw.byteOffset,
          Math.floor(raw.byteLength / 2),
        );
      })(),
    );
    assert.ok(
      Math.abs(kept.pitchHz - 120) < 2,
      "the in-tune re-voice replaced take 1",
    );
    await assert.rejects(
      fs.stat(path.join(dir, "takes", "take_001_revoice.mp3")),
    );
    assert.equal(n.words.length, text.split(/\s+/).length);
    for (let i = 1; i < n.words.length; i++)
      assert.ok(
        n.words[i]!.start >= n.words[i - 1]!.start,
        "timings stay monotonic",
      );
  } finally {
    srv.close();
  }
});

test("other models get the earlier takes' request ids; the check can be turned off and respects the budget", async () => {
  const dir = await tmpDir();
  const text = longText();
  const takes = chunkTakes(text);
  const srv = await fakeElevenLabs(dir, {
    pitchFor: (b) => (b.text === takes[2] ? 135 : 120),
  });
  const events: string[] = [];
  try {
    await synthesiseElevenLabsLong(text, path.join(dir, "a.mp3"), {
      apiKey: "k",
      voiceId: "v",
      modelId: "eleven_multilingual_v2",
      baseUrl: srv.url,
      takeCheck: false,
    });
    assert.equal(
      srv.bodies.length,
      takes.length,
      "VOICE_TAKE_CHECK off: no re-voice",
    );
    assert.equal(srv.bodies[0]!.previous_request_ids, undefined);
    assert.deepEqual(srv.bodies[1]!.previous_request_ids, ["req_1"]);
    assert.deepEqual(srv.bodies[3]!.previous_request_ids, [
      "req_1",
      "req_2",
      "req_3",
    ]);
    srv.bodies.length = 0;
    await synthesiseElevenLabsLong(text, path.join(dir, "b.mp3"), {
      apiKey: "k",
      voiceId: "v",
      modelId: "eleven_multilingual_v2",
      baseUrl: srv.url,
      takeCheck: true,
      revoiceChars: 10,
      onEvent: (kind) => void events.push(kind),
    });
    assert.equal(
      srv.bodies.length,
      takes.length,
      "no characters to spare: no re-voice",
    );
    assert.deepEqual(events, ["voice_consistency"]);
  } finally {
    srv.close();
  }
});
