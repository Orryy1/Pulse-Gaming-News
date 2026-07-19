"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  alignWordsWithLocalWhisper,
  normaliseWhisperWords,
  parseWhisperJson,
} = require("../../lib/local-whisper-word-aligner");

test("normaliseWhisperWords extracts word-level timings from Whisper segments", () => {
  const words = normaliseWhisperWords({
    segments: [
      {
        text: " Hades two lands",
        words: [
          { word: " Hades", start: 0.12, end: 0.36 },
          { word: " two", start: 0.38, end: 0.52 },
          { word: " lands", start: 0.56, end: 0.86 },
        ],
      },
    ],
  });

  assert.deepEqual(words, [
    { word: "Hades", start: 0.12, end: 0.36 },
    { word: "two", start: 0.38, end: 0.52 },
    { word: "lands", start: 0.56, end: 0.86 },
  ]);
});

test("normaliseWhisperWords distributes segment text when word details are absent", () => {
  const words = normaliseWhisperWords({
    segments: [
      {
        text: "Hades two",
        start: 1,
        end: 1.6,
      },
    ],
  });

  assert.deepEqual(words, [
    { word: "Hades", start: 1, end: 1.3 },
    { word: "two", start: 1.3, end: 1.6 },
  ]);
});

test("parseWhisperJson returns parsed JSON payloads", () => {
  assert.deepEqual(parseWhisperJson('{"text":"Hades two"}'), {
    text: "Hades two",
  });
});

test("alignWordsWithLocalWhisper passes configured Whisper device", async () => {
  const calls = [];
  const result = await alignWordsWithLocalWhisper({
    audioPath: "C:\\media\\granblue.mp3",
    scriptText: "Granblue Fantasy Relink just made its next update harder to ignore.",
    model: "tiny.en",
    device: "cpu",
    execFileImpl: async (python, args) => {
      calls.push({ python, args });
      return {
        stdout: JSON.stringify({
          model: "tiny.en",
          language: "en",
          text: "Granblue Fantasy Relink",
          segments: [
            {
              text: "Granblue Fantasy Relink",
              start: 0,
              end: 1.2,
              words: [
                { word: "Granblue", start: 0, end: 0.4 },
                { word: "Fantasy", start: 0.42, end: 0.78 },
                { word: "Relink", start: 0.8, end: 1.2 },
              ],
            },
          ],
        }),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const deviceIndex = calls[0].args.indexOf("--device");
  assert.notEqual(deviceIndex, -1);
  assert.equal(calls[0].args[deviceIndex + 1], "cpu");
  assert.equal(calls[0].args.includes("--prompt"), false);
});

test("alignWordsWithLocalWhisper routes a faster-whisper model spec through the VAD backend", async () => {
  const calls = [];
  const result = await alignWordsWithLocalWhisper({
    audioPath: "C:\\media\\black-flag.mp3",
    scriptText: "Black Flag Resynced sold three million copies.",
    model: "faster-whisper:base.en",
    device: "cpu",
    execFileImpl: async (python, args) => {
      calls.push({ python, args });
      return {
        stdout: JSON.stringify({
          model: "faster-whisper:base.en",
          backend: "faster-whisper",
          language: "en",
          text: "Black Flag Resynced sold three million copies.",
          segments: [{
            text: "Black Flag Resynced sold three million copies.",
            words: [
              { word: "Black", start: 0, end: 0.2 },
              { word: "Flag", start: 0.22, end: 0.4 },
              { word: "Resynced", start: 0.42, end: 0.8 },
            ],
          }],
        }),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, "faster-whisper:base.en");
  assert.equal(result.backend, "faster-whisper");
  assert.equal(calls.length, 1);
  const modelIndex = calls[0].args.indexOf("--model");
  const backendIndex = calls[0].args.indexOf("--backend");
  assert.equal(calls[0].args[modelIndex + 1], "base.en");
  assert.equal(calls[0].args[backendIndex + 1], "faster-whisper");
});

test("alignWordsWithLocalWhisper prefers a canonical recognition prompt over a TTS-only alias", async () => {
  const calls = [];
  const result = await alignWordsWithLocalWhisper({
    audioPath: "C:\\media\\black-flag.mp3",
    scriptText: "Black Flag reesynced has nine day one DLC packs.",
    promptText: "Black Flag Resynced has nine day-one DLC packs.",
    model: "tiny.en",
    device: "cpu",
    useScriptPrompt: true,
    execFileImpl: async (python, args) => {
      calls.push({ python, args });
      return {
        stdout: JSON.stringify({
          model: "tiny.en",
          language: "en",
          text: "Black Flag Resynced",
          segments: [{
            text: "Black Flag Resynced",
            words: [
              { word: "Black", start: 0, end: 0.2 },
              { word: "Flag", start: 0.2, end: 0.4 },
              { word: "Resynced", start: 0.4, end: 0.8 },
            ],
          }],
        }),
      };
    },
  });

  assert.equal(result.ok, true);
  const promptIndex = calls[0].args.indexOf("--prompt");
  assert.notEqual(promptIndex, -1);
  assert.equal(calls[0].args[promptIndex + 1], "Black Flag Resynced has nine day-one DLC packs.");
});

test("alignWordsWithLocalWhisper defaults Windows inference to CUDA when no override is set", async () => {
  const previous = process.env.LOCAL_WHISPER_DEVICE;
  delete process.env.LOCAL_WHISPER_DEVICE;
  const calls = [];
  try {
    const result = await alignWordsWithLocalWhisper({
      audioPath: "C:\\media\\black-flag.mp3",
      model: "small.en",
      execFileImpl: async (python, args) => {
        calls.push({ python, args });
        return {
          stdout: JSON.stringify({
            model: "small.en",
            language: "en",
            text: "Black Flag Resynced",
            segments: [{
              text: "Black Flag Resynced",
              words: [
                { word: "Black", start: 0, end: 0.2 },
                { word: "Flag", start: 0.2, end: 0.4 },
                { word: "Resynced", start: 0.4, end: 0.8 },
              ],
            }],
          }),
        };
      },
    });

    assert.equal(result.ok, true);
    const deviceIndex = calls[0].args.indexOf("--device");
    assert.notEqual(deviceIndex, -1);
    assert.equal(calls[0].args[deviceIndex + 1], "cuda");
  } finally {
    if (previous == null) delete process.env.LOCAL_WHISPER_DEVICE;
    else process.env.LOCAL_WHISPER_DEVICE = previous;
  }
});

test("alignWordsWithLocalWhisper supports a synchronous Windows batch fallback", async () => {
  let asyncCalled = false;
  let syncCalled = false;
  const result = await alignWordsWithLocalWhisper({
    audioPath: "C:\\media\\palworld.mp3",
    model: "tiny.en",
    device: "cpu",
    useSyncExec: true,
    execFileImpl: async () => {
      asyncCalled = true;
      throw new Error("async path must not run");
    },
    execFileSyncImpl: () => {
      syncCalled = true;
      return JSON.stringify({
        model: "tiny.en",
        language: "en",
        text: "Palworld launched",
        segments: [
          {
            text: "Palworld launched",
            words: [
              { word: "Palworld", start: 0, end: 0.5 },
              { word: "launched", start: 0.52, end: 1 },
            ],
          },
        ],
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(asyncCalled, false);
  assert.equal(syncCalled, true);
  assert.equal(result.words.length, 2);
});

test("alignWordsWithLocalWhisper recovers a complete output file when the Windows process exits noisily", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-whisper-output-file-"));
  const audioPath = path.join(root, "narration.mp3");
  await fs.outputFile(audioPath, Buffer.alloc(2048, 1));

  const result = await alignWordsWithLocalWhisper({
    audioPath,
    model: "small.en",
    execFileImpl: async (_python, args) => {
      const outputIndex = args.indexOf("--output");
      await fs.outputJson(args[outputIndex + 1], {
        model: "small.en",
        language: "en",
        text: "Black Flag Resynced",
        segments: [{
          text: "Black Flag Resynced",
          words: [
            { word: "Black", start: 0, end: 0.2 },
            { word: "Flag", start: 0.2, end: 0.4 },
            { word: "Resynced", start: 0.4, end: 0.8 },
          ],
        }],
      });
      const error = new Error("process exited after writing output");
      error.stderr = "100% complete";
      throw error;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, "small.en");
  assert.equal(result.words.length, 3);
  assert.equal((await fs.readdir(root)).some((name) => name.includes("whisper-align")), false);
});

test("alignWordsWithLocalWhisper keeps Windows Whisper attached while writing evidence to a sidecar", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-whisper-spawn-mode-"));
  const audioPath = path.join(root, "narration.mp3");
  await fs.outputFile(audioPath, Buffer.alloc(2048, 1));
  let spawnOptions = null;

  const result = await alignWordsWithLocalWhisper({
    audioPath,
    model: "small.en",
    spawnImpl: (_python, args, options) => {
      spawnOptions = options;
      const child = new EventEmitter();
      child.kill = () => {};
      const outputIndex = args.indexOf("--output");
      process.nextTick(async () => {
        await fs.outputJson(args[outputIndex + 1], {
          model: "small.en",
          language: "en",
          text: "Palworld launched",
          segments: [{
            text: "Palworld launched",
            words: [
              { word: "Palworld", start: 0, end: 0.5 },
              { word: "launched", start: 0.52, end: 1 },
            ],
          }],
        });
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(spawnOptions.stdio, ["ignore", "inherit", "inherit"]);
});

test("alignWordsWithLocalWhisper retries on CPU when the shared GPU process exits without evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-whisper-cpu-fallback-"));
  const audioPath = path.join(root, "narration.mp3");
  await fs.outputFile(audioPath, Buffer.alloc(2048, 1));
  const calls = [];

  const result = await alignWordsWithLocalWhisper({
    audioPath,
    model: "small.en",
    device: "cuda",
    spawnImpl: (_python, args) => {
      calls.push([...args]);
      const child = new EventEmitter();
      child.kill = () => {};
      const outputIndex = args.indexOf("--output");
      process.nextTick(async () => {
        if (calls.length === 1) {
          child.emit("close", 4294967295, null);
          return;
        }
        await fs.outputJson(args[outputIndex + 1], {
          model: "small.en",
          language: "en",
          text: "Palworld launched",
          segments: [{
            text: "Palworld launched",
            words: [
              { word: "Palworld", start: 0, end: 0.5 },
              { word: "launched", start: 0.52, end: 1 },
            ],
          }],
        });
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.fallback_device, "cpu");
  assert.equal(calls.length, 2);
  const deviceIndex = calls[1].indexOf("--device");
  assert.notEqual(deviceIndex, -1);
  assert.equal(calls[1][deviceIndex + 1], "cpu");
});

test("alignWordsWithLocalWhisper can isolate Windows Whisper behind PowerShell", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-whisper-windows-boundary-"));
  const audioPath = path.join(root, "narration.mp3");
  await fs.outputFile(audioPath, Buffer.alloc(2048, 1));
  let executable = "";
  let boundaryCommand = "";

  const result = await alignWordsWithLocalWhisper({
    audioPath,
    model: "small.en",
    device: "cpu",
    useWindowsPowerShellBoundary: true,
    spawnImpl: (command, args) => {
      executable = command;
      boundaryCommand = args.at(-1);
      const child = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => {
        try {
          const outputPath = boundaryCommand.match(/'--output'\s+'([^']+)'/)?.[1].replace(/''/g, "'");
          assert.ok(outputPath);
          fs.outputJsonSync(outputPath, {
            model: "small.en",
            language: "en",
            text: "Palworld launched",
            segments: [{
              text: "Palworld launched",
              words: [
                { word: "Palworld", start: 0, end: 0.5 },
                { word: "launched", start: 0.52, end: 1 },
              ],
            }],
          });
          child.emit("close", 0, null);
        } catch (error) {
          child.emit("error", error);
        }
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.match(executable, /powershell/i);
  assert.match(boundaryCommand, /local_whisper_word_align\.py/);
  assert.match(boundaryCommand, /'--device'\s+'cpu'/);
});

test("alignWordsWithLocalWhisper retries directly when the Windows PowerShell boundary fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-whisper-boundary-fallback-"));
  const audioPath = path.join(root, "narration.mp3");
  await fs.outputFile(audioPath, Buffer.alloc(2048, 1));
  const calls = [];

  const result = await alignWordsWithLocalWhisper({
    audioPath,
    model: "base.en",
    device: "cpu",
    useWindowsPowerShellBoundary: true,
    spawnImpl: (command, args) => {
      calls.push(command);
      const child = new EventEmitter();
      child.kill = () => {};
      process.nextTick(async () => {
        if (/powershell/i.test(command)) {
          child.emit("close", -1, null);
          return;
        }
        const outputIndex = args.indexOf("--output");
        await fs.outputJson(args[outputIndex + 1], {
          model: "base.en",
          language: "en",
          text: "Glen Umbra returns",
          segments: [{
            text: "Glen Umbra returns",
            words: [
              { word: "Glen", start: 0, end: 0.2 },
              { word: "Umbra", start: 0.2, end: 0.4 },
              { word: "returns", start: 0.42, end: 0.8 },
            ],
          }],
        });
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.windows_boundary_fallback, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /powershell/i);
  assert.doesNotMatch(calls[1], /powershell/i);
});
