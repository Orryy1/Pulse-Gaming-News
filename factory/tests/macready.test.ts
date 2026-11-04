// The move to the Mac mini (1 Nov 2026 audit): machine-specific defaults, the Windows-only steps that now
// skip or have a Mac twin, the free-space rule for the Mac's 256 GB SSD, and the kit's deploy scripts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultBackupDir,
  defaultCodexPython,
  defaultCodexRunnerDir,
  defaultTunnelConfig,
  isWindowsPath,
  orchClientUrl,
  relocatedFile,
  usablePath,
} from "../src/platform.ts";
import { loadOrch, NoOrchestrator } from "../src/lib/orch.ts";
import { canStartLocally } from "../src/voice/local.ts";
import { ocrCommand, parseOcrOutput } from "../src/assets/ocr.ts";
import { codexRunnerPresent } from "../src/editorial/codex.ts";
import { comfyReachable } from "../src/assets/illustrate.ts";
import { pickBinary } from "../src/lib/bin.ts";
import { visionIsLocal } from "../src/assets/localvision.ts";
import {
  planSpacePrune,
  pruneForSpace,
  folderBytes,
} from "../src/retention.ts";

const MAC_HOME = "/Users/MORR";

test("Windows paths are recognised, and dropped only off Windows", () => {
  assert.equal(isWindowsPath("C:\\Users\\MORR\\start.bat"), true);
  assert.equal(isWindowsPath("D:/pulse-data/tokens/tiktok.json"), true);
  assert.equal(isWindowsPath("/opt/homebrew/bin/yt-dlp"), false);
  assert.equal(isWindowsPath("yt-dlp"), false);
  assert.equal(usablePath("D:/tools/yt-dlp.exe", "darwin"), "");
  assert.equal(
    usablePath("D:/tools/yt-dlp.exe", "win32"),
    "D:/tools/yt-dlp.exe",
  );
  assert.equal(
    usablePath("/opt/homebrew/bin/yt-dlp", "darwin"),
    "/opt/homebrew/bin/yt-dlp",
  );
});

test("a PC token path means the same file in data/tokens on the Mac", () => {
  assert.equal(
    relocatedFile(
      "D:/pulse-data/tokens/tiktok.json",
      "darwin",
      "/Users/MORR/PulseFactory/factory/data/tokens",
    ),
    "/Users/MORR/PulseFactory/factory/data/tokens/tiktok.json",
  );
  assert.equal(
    relocatedFile(
      "D:\\pulse-data\\tokens\\tiktok.json",
      "darwin",
      "/x/tokens/",
    ),
    "/x/tokens/tiktok.json",
  );
  assert.equal(
    relocatedFile("D:/pulse-data/tokens/tiktok.json", "win32", "/x"),
    "D:/pulse-data/tokens/tiktok.json",
  );
  assert.equal(relocatedFile("", "darwin", "/x"), "");
});

test("backups and the tunnel file default to the Mac's own folders off Windows, never a relative G:/ path", () => {
  assert.equal(
    defaultBackupDir("win32", "C:\\Users\\MORR"),
    "G:/My Drive/Pulse backups",
  );
  assert.equal(
    defaultBackupDir("darwin", MAC_HOME),
    "/Users/MORR/PulseFactory/backups",
  );
  assert.equal(
    defaultTunnelConfig("win32", "C:\\Users\\MORR"),
    "D:/pulse-data/cloudflared-pulse.yml",
  );
  assert.equal(
    defaultTunnelConfig("darwin", MAC_HOME),
    "/Users/MORR/PulseFactory/cloudflared-pulse.yml",
  );
  assert.ok(path.isAbsolute(defaultBackupDir("darwin", MAC_HOME)));
});

test("the PC orchestrator's client is only looked for on Windows, unless ORCH_CLIENT says where", async () => {
  assert.equal(
    orchClientUrl("win32", {}),
    "file:///C:/Claude/orchestrator/orch.mjs",
  );
  assert.equal(orchClientUrl("darwin", {}), undefined);
  assert.equal(
    orchClientUrl("darwin", { ORCH_CLIENT: "file:///x/orch.mjs" }),
    "file:///x/orch.mjs",
  );
  await assert.rejects(
    () => loadOrch("darwin", {}),
    (e) => e instanceof NoOrchestrator,
  );
});

test("Codex runs through python3 on the Mac, and only where its helper is installed", () => {
  assert.equal(defaultCodexPython("win32"), "python");
  assert.equal(defaultCodexPython("darwin"), "python3");
  assert.equal(
    defaultCodexRunnerDir("win32", "C:\\Users\\MORR"),
    "C:\\Claude\\orchestrator",
  );
  assert.equal(
    defaultCodexRunnerDir("darwin", MAC_HOME),
    "/Users/MORR/PulseFactory/factory/mac/codex",
  );
  const seen: string[] = [];
  assert.equal(
    codexRunnerPresent(
      "/Users/MORR/PulseFactory/codex",
      (p) => (seen.push(p), false),
    ),
    false,
  );
  assert.equal(
    seen[0],
    path.join("/Users/MORR/PulseFactory/codex", "codex_runner.py"),
  );
  assert.equal(
    codexRunnerPresent("C:\\Claude\\orchestrator", () => true),
    true,
  );
  assert.equal(
    codexRunnerPresent("", () => true),
    false,
  );
});

test("the Liam start script is only run on Windows; on the Mac a down server is an error, not a cmd.exe spawn", () => {
  assert.equal(canStartLocally("C:\\VoxCPM\\start.bat", "win32"), true);
  assert.equal(canStartLocally("C:\\VoxCPM\\start.bat", "darwin"), false);
  assert.equal(canStartLocally("", "win32"), false);
  assert.equal(canStartLocally(undefined, "darwin"), false);
});

test("picture text is read by Windows OCR on the PC and Apple Vision on the Mac", () => {
  const win = ocrCommand("win32", "/tmp/list.json");
  assert.equal(win?.cmd, "powershell.exe");
  assert.ok(
    win?.args.includes("-ListFile") && win.args.at(-1) === "/tmp/list.json",
  );
  const mac = ocrCommand(
    "darwin",
    "/tmp/list.json",
    "/Users/MORR/PulseFactory/ocr/bin/python",
  );
  assert.equal(mac?.cmd, "/Users/MORR/PulseFactory/ocr/bin/python");
  assert.equal(mac?.args[0], "-I");
  assert.match(mac?.args[1] ?? "", /macocr\.py$/);
  assert.equal(mac?.args[2], "/tmp/list.json");
  assert.ok(fs.existsSync(mac!.args[1]!));
  assert.equal(ocrCommand("linux", "/tmp/list.json"), undefined);
  // The Mac reader's JSON (no BOM, no control characters, a one-word list as a list) parses the same way.
  const pages = parseOcrOutput(
    '{"results":[{"file":"/a.jpg","width":1920,"height":1080,"words":[{"text":"Vinewood","x":10,"y":20,"w":100,"h":30}]},{"file":"/b.jpg","width":0,"height":0,"words":[],"error":"cannot open image"}]}',
  );
  assert.equal(pages.get("/a.jpg")?.words[0]?.text, "Vinewood");
  assert.equal(pages.get("/b.jpg")?.words.length, 0);
});

test("a ComfyUI server that does not answer skips the sketches instead of failing each one", async () => {
  const asked: string[] = [];
  assert.equal(
    await comfyReachable(
      "http://pc:8188/",
      10,
      async (u) => (asked.push(u), { ok: true }),
    ),
    true,
  );
  assert.equal(asked[0], "http://pc:8188/system_stats");
  assert.equal(
    await comfyReachable("http://pc:8188", 10, async () => ({ ok: false })),
    false,
  );
  assert.equal(
    await comfyReachable("http://pc:8188", 10, async () => {
      throw new Error("ECONNREFUSED");
    }),
    false,
  );
});

const GB = 1e9;
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");

test("free space is brought back by deleting finished media oldest first, never the newest days", () => {
  const c = [
    { id: "new", finishedAt: NOW - 1 * DAY, bytes: 5 * GB },
    { id: "old", finishedAt: NOW - 10 * DAY, bytes: 3 * GB },
    { id: "older", finishedAt: NOW - 12 * DAY, bytes: 2 * GB },
    { id: "mid", finishedAt: NOW - 5 * DAY, bytes: 4 * GB },
  ];
  const o = { minFreeGb: 40, floorDays: 2, now: NOW };
  // Enough free: nothing goes.
  assert.deepEqual(planSpacePrune(c, 45 * GB, o), []);
  // 36 GB free, 4 wanted: the oldest (2 GB) then the next (3 GB).
  assert.deepEqual(
    planSpacePrune(c, 36 * GB, o).map((x) => x.id),
    ["older", "old"],
  );
  // Very low: everything old enough goes, the one-day-old episode stays.
  assert.deepEqual(
    planSpacePrune(c, 10 * GB, o).map((x) => x.id),
    ["older", "old", "mid"],
  );
  // The rule switched off.
  assert.deepEqual(planSpacePrune(c, 1 * GB, { ...o, minFreeGb: 0 }), []);
});

test("the free-space rule deletes only finished episodes' folders, logs it and tells Discord", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-ret-"));
  try {
    for (const id of ["ep_a", "ep_b", "ep_c"]) {
      fs.mkdirSync(path.join(root, id, "assets"), { recursive: true });
      fs.writeFileSync(
        path.join(root, id, "assets", "v.bin"),
        Buffer.alloc(1000),
      );
    }
    assert.equal(await folderBytes(path.join(root, "ep_a")), 1000);
    const events: unknown[] = [];
    const notes: string[] = [];
    let sql = "";
    const db = {
      async query(q: string, params?: unknown[]) {
        if (q.includes("INSERT INTO events")) {
          events.push(params);
          return [];
        }
        sql = q;
        // ep_c is still in production: the query never returns it.
        return [
          { id: "ep_a", updated_at: new Date(NOW - 20 * DAY).toISOString() },
          { id: "ep_b", updated_at: new Date(NOW - 1 * DAY).toISOString() },
        ];
      },
    };
    const done = await pruneForSpace(
      {
        db: db as never,
        cfg: { dataDir: root, mediaMinFreeGb: 40, mediaFloorDays: 2 },
        now: () => new Date(NOW),
        notify: async (m) => void notes.push(m.content),
      },
      (id) => path.join(root, id),
      async () => 10 * GB,
    );
    assert.match(sql, /status IN \('published','rejected','failed'\)/);
    assert.deepEqual(done, ["ep_a"]);
    assert.equal(fs.existsSync(path.join(root, "ep_a")), false);
    assert.equal(fs.existsSync(path.join(root, "ep_b")), true);
    assert.equal(fs.existsSync(path.join(root, "ep_c")), true);
    assert.equal(events.length, 1);
    assert.match(
      notes[0] ?? "",
      /deleted the media files of 1 finished episode early/,
    );
    // Plenty free: nothing is even listed.
    sql = "";
    assert.deepEqual(
      await pruneForSpace(
        {
          db: db as never,
          cfg: { dataDir: root, mediaMinFreeGb: 40, mediaFloorDays: 2 },
          now: () => new Date(NOW),
          notify: async () => undefined,
        },
        (id) => path.join(root, id),
        async () => 100 * GB,
      ),
      [],
    );
    assert.equal(sql, "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const mac = (f: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "..", "mac", f), "utf8");

test("a deploy or a rollback on the Mac keeps the Epidemic beds, which are not in git", () => {
  for (const [file, n] of [
    ["post-receive", 2],
    ["run.sh", 1],
  ] as const) {
    const lines = mac(file)
      .split("\n")
      .filter((l) => /rsync -a --delete/.test(l));
    assert.equal(lines.length, n, file);
    for (const l of lines)
      assert.match(l, /--exclude \/public\/music\/es/, `${file}: ${l}`);
  }
});

test("the cutover drops the PC-only settings, points backups and tokens at the Mac and copies the spend ledger", () => {
  const m = mac("migrate.sh");
  const strip = m.match(/grep -vE '\^\(([^)]+)\)='/)?.[1]?.split("|") ?? [];
  for (const k of [
    "LOCAL_TTS_START",
    "PULSE_TTS_DIR",
    "TIKTOK_TOKEN_PATH",
    "BACKUP_DIR",
    "CODEX_PYTHON",
    "YTDLP_PATH",
  ])
    assert.ok(strip.includes(k), k);
  assert.match(m, /BACKUP_DIR=%s\/PulseFactory\/backups/);
  assert.match(
    m,
    /TIKTOK_TOKEN_PATH=%s\/PulseFactory\/factory\/data\/tokens\//,
  );
  assert.match(m, /ls -d tokens tiktok-session\.json usage abtests/);
  assert.match(m, /pip install -q --upgrade pip pyobjc-framework-Vision/);
  assert.match(m, /parallax\/bin\/pip install/);
});

test("ffmpeg and ffprobe on a Mac are Homebrew's, never the bundled Intel ffprobe macOS refuses", () => {
  const brew = (p: string) => p.startsWith("/opt/homebrew/bin/");
  const none = () => false;
  assert.equal(
    pickBinary(
      "ffprobe",
      "darwin",
      undefined,
      brew,
      "/x/ffprobe-static/bin/darwin/arm64/ffprobe",
    ),
    "/opt/homebrew/bin/ffprobe",
  );
  assert.equal(
    pickBinary("ffmpeg", "darwin", "/custom/ffmpeg", brew, "/x/ffmpeg"),
    "/custom/ffmpeg",
  );
  assert.equal(
    pickBinary("ffprobe", "darwin", undefined, none, "/x/ffprobe"),
    "/x/ffprobe",
  );
  assert.equal(
    pickBinary("ffprobe", "win32", undefined, brew, "C:/x/ffprobe.exe"),
    "C:/x/ffprobe.exe",
  );
  assert.equal(
    pickBinary("ffmpeg", "linux", undefined, none, undefined),
    "ffmpeg",
  );
});

test("a render unloads the vision model only when it is this machine's, never the PC's over the LAN", () => {
  assert.equal(visionIsLocal("http://127.0.0.1:11434"), true);
  assert.equal(visionIsLocal("http://localhost:11434"), true);
  assert.equal(visionIsLocal("http://DESKTOP-D3EI9PV.local:11434"), false);
  assert.equal(visionIsLocal("http://192.168.0.93:11434"), false);
  assert.equal(visionIsLocal("not a url"), false);
});

test("Chrome rasterises on the GPU unless told otherwise, on the Mac too (the crash's cause is fixed)", async () => {
  const { gpuRasterOff } = await import("../src/render/render.ts");
  assert.equal(gpuRasterOff({}), false);
  assert.equal(gpuRasterOff({ REMOTION_GPU_RASTER: "true" }), false);
  assert.equal(gpuRasterOff({ REMOTION_GPU_RASTER: "false" }), true);
  assert.equal(gpuRasterOff({ REMOTION_GPU_RASTER: "FALSE" }), true);
});
