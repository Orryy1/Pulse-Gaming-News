"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PINNED_FFMPEG_BUILD,
  applyPinnedFfmpegUpgrade,
  buildPinnedFfmpegUpgradePlan,
  downloadPinnedFfmpegArchive,
  extractPinnedFfmpegArchive,
  validatePinnedSourcePolicy,
} = require("../../lib/pinned-ffmpeg-upgrade");
const {
  EVIDENCE_FILENAME,
  SUMMARY_FILENAME,
  main: runPinnedFfmpegCli,
  parseArgs,
} = require("../../tools/pinned-ffmpeg-upgrade");

const GENERATED_AT = "2026-07-15T10:00:00.000Z";

test("pinned FFmpeg upgrade has a canonical operator command", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(__dirname, "..", "..", "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ops:pinned-ffmpeg-upgrade"],
    "node tools/pinned-ffmpeg-upgrade.js",
  );
});

async function makeFixturePair({
  ffmpegContents = "old ffmpeg fixture",
  ffprobeContents = "old ffprobe fixture",
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-pinned-ffmpeg-"));
  const ffmpegPath = path.join(root, "ffmpeg.exe");
  const ffprobePath = path.join(root, "ffprobe.exe");
  await Promise.all([
    fs.writeFile(ffmpegPath, ffmpegContents),
    fs.writeFile(ffprobePath, ffprobeContents),
  ]);
  return { root, ffmpegPath, ffprobePath };
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function materialisePinnedStagedPair(destinationDirectory, contents = {}) {
  const ffmpegPath = path.join(destinationDirectory, "ffmpeg.exe");
  const ffprobePath = path.join(destinationDirectory, "ffprobe.exe");
  await Promise.all([
    fs.writeFile(
      ffmpegPath,
      contents.ffmpeg || "official pinned ffmpeg fixture",
    ),
    fs.writeFile(
      ffprobePath,
      contents.ffprobe || "official pinned ffprobe fixture",
    ),
  ]);
  return {
    format: "zip",
    archive_root: PINNED_FFMPEG_BUILD.archive_root,
    entries_checked: 12,
    total_uncompressed_bytes: 300_000_000,
    binaries: {
      ffmpeg: {
        archive_path: PINNED_FFMPEG_BUILD.binaries.ffmpeg.archive_path,
        extracted_path: ffmpegPath,
        size_bytes: PINNED_FFMPEG_BUILD.binaries.ffmpeg.size_bytes,
      },
      ffprobe: {
        archive_path: PINNED_FFMPEG_BUILD.binaries.ffprobe.archive_path,
        extracted_path: ffprobePath,
        size_bytes: PINNED_FFMPEG_BUILD.binaries.ffprobe.size_bytes,
      },
    },
  };
}

async function hashPinnedFixture(filePath) {
  if (filePath.endsWith(".zip")) return PINNED_FFMPEG_BUILD.archive_sha256;
  const contents = await fs.readFile(filePath, "utf8");
  if (contents === "official pinned ffmpeg fixture") {
    return PINNED_FFMPEG_BUILD.binaries.ffmpeg.sha256;
  }
  if (contents === "official pinned ffprobe fixture") {
    return PINNED_FFMPEG_BUILD.binaries.ffprobe.sha256;
  }
  return digest(contents);
}

function probePinnedFixture(binaryPath) {
  const component = path.basename(binaryPath, ".exe").toLowerCase();
  return `${component} version ${PINNED_FFMPEG_BUILD.provider_version}\n`;
}

test("CLI defaults to read-only pair verification and writes proof artefacts", async (t) => {
  const fixture = await makeFixturePair();
  const specialBin = path.join(fixture.root, "FFmpeg Tool's Bin");
  const ffmpegPath = path.join(specialBin, "ffmpeg.exe");
  const ffprobePath = path.join(specialBin, "ffprobe.exe");
  const outDir = path.join(fixture.root, "proof output");
  await fs.mkdir(specialBin);
  await Promise.all([
    fs.rename(fixture.ffmpegPath, ffmpegPath),
    fs.rename(fixture.ffprobePath, ffprobePath),
  ]);
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  let stdout = "";

  const result = await runPinnedFfmpegCli(
    [
      "--ffmpeg",
      ffmpegPath,
      "--ffprobe",
      ffprobePath,
      "--out-dir",
      outDir,
      "--generated-at",
      GENERATED_AT,
      "--json",
    ],
    {
      platform: "win32",
      execFileSync(binary) {
        return `${path.basename(binary, ".exe")} version 8.0.1\n`;
      },
      stdout: { write(value) { stdout += value; } },
    },
  );

  assert.equal(parseArgs([]).apply, false);
  assert.equal(result.report.mode, "PLAN_VERIFY");
  assert.equal(result.report.read_only, true);
  assert.equal(result.report.mutation_performed, false);
  assert.equal(result.report.current.ffmpeg.binary_path, ffmpegPath);
  assert.equal(result.report.current.ffprobe.binary_path, ffprobePath);
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(stdout).mode, "PLAN_VERIFY");
  assert.equal(
    JSON.parse(await fs.readFile(path.join(outDir, EVIDENCE_FILENAME), "utf8"))
      .mutation_performed,
    false,
  );
  assert.match(
    await fs.readFile(path.join(outDir, SUMMARY_FILENAME), "utf8"),
    /Mode: PLAN_VERIFY/,
  );
  assert.deepEqual((await fs.readdir(specialBin)).sort(), [
    "ffmpeg.exe",
    "ffprobe.exe",
  ]);
});

test("default verification produces a read-only pinned FFmpeg pair plan", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const before = (await fs.readdir(fixture.root)).sort();
  const probes = [];

  const report = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary, args) {
      probes.push({ binary, args });
      const name = path.basename(binary, ".exe");
      return `${name} version 8.0.1-full_build-www.gyan.dev\n`;
    },
  });

  assert.equal(report.schema_version, 1);
  assert.equal(report.mode, "PLAN_VERIFY");
  assert.equal(report.read_only, true);
  assert.equal(report.mutation_performed, false);
  assert.equal(report.verdict, "RED");
  assert.equal(report.production_safe, false);
  assert.deepEqual(report.blockers, [
    "ffmpeg_upgrade_required",
    "ffprobe_upgrade_required",
  ]);
  assert.equal(report.current.ffmpeg.detected_version, "8.0.1");
  assert.equal(report.current.ffmpeg.sha256, digest("old ffmpeg fixture"));
  assert.equal(report.current.ffprobe.detected_version, "8.0.1");
  assert.equal(report.current.ffprobe.sha256, digest("old ffprobe fixture"));
  assert.equal(report.current.same_directory, true);
  assert.equal(report.current.pair_matches_pinned_build, false);
  assert.equal(report.target.version, "8.1.2");
  assert.equal(report.target.build_variant, "essentials_build");
  assert.equal(
    report.target.archive_url,
    "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip",
  );
  assert.equal(
    report.target.archive_sha256,
    "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec",
  );
  assert.equal(
    report.target.binaries.ffmpeg.sha256,
    "1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e",
  );
  assert.equal(
    report.target.binaries.ffprobe.sha256,
    "b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07",
  );
  assert.deepEqual(report.plan.apply_flags, ["--apply", "--operator-confirmed"]);
  assert.equal(report.plan.requires_apply, true);
  assert.deepEqual(probes, [
    { binary: fixture.ffmpegPath, args: ["-version"] },
    { binary: fixture.ffprobePath, args: ["-version"] },
  ]);
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), before);
  assert.equal(PINNED_FFMPEG_BUILD.provider, "gyan.dev");
});

test("plan rejects Windows pair paths that are not the canonical executable names", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const encoderPath = path.join(fixture.root, "encoder.exe");
  const analyserPath = path.join(fixture.root, "analyser.exe");
  await Promise.all([
    fs.rename(fixture.ffmpegPath, encoderPath),
    fs.rename(fixture.ffprobePath, analyserPath),
  ]);

  const report = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: encoderPath,
    ffprobePath: analyserPath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.current.canonical_names, false);
  assert.deepEqual(report.blockers.slice(0, 2), [
    "ffmpeg_path_must_end_with_ffmpeg_exe",
    "ffprobe_path_must_end_with_ffprobe_exe",
  ]);
});

test("pinned source policy binds the build to FFmpeg guidance and exact Gyan HTTPS origins", () => {
  const verified = validatePinnedSourcePolicy(PINNED_FFMPEG_BUILD);
  const lookalikeHost = validatePinnedSourcePolicy({
    ...PINNED_FFMPEG_BUILD,
    archive_url:
      "https://www.gyan.dev.example/ffmpeg-8.1.2-essentials_build.zip",
  });

  assert.deepEqual(verified, { ok: true, error: null });
  assert.deepEqual(lookalikeHost, {
    ok: false,
    error: "archive_source_not_allowed",
  });
  assert.equal(
    PINNED_FFMPEG_BUILD.upstream_guidance_url,
    "https://ffmpeg.org/download.html",
  );
  assert.equal(
    PINNED_FFMPEG_BUILD.checksum_url,
    `${PINNED_FFMPEG_BUILD.archive_url}.sha256`,
  );
});

test("plan rejects ffmpeg and ffprobe paths that alias the same physical file", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await fs.rm(fixture.ffprobePath);
  await fs.link(fixture.ffmpegPath, fixture.ffprobePath);

  const report = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });

  assert.equal(report.current.distinct_paths, true);
  assert.equal(report.current.distinct_files, false);
  assert.ok(report.blockers.includes("ffmpeg_pair_must_be_distinct_files"));
});

test("apply fails closed before download without separate operator confirmation", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  let downloads = 0;
  let extractions = 0;

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: false,
    download: async () => {
      downloads += 1;
    },
    extractArchive: async () => {
      extractions += 1;
    },
  });

  assert.equal(evidence.mode, "APPLY");
  assert.equal(evidence.read_only, false);
  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "BLOCKED");
  assert.equal(evidence.apply.requested, true);
  assert.equal(evidence.apply.operator_confirmed, false);
  assert.equal(evidence.mutation_performed, false);
  assert.deepEqual(evidence.blockers, ["operator_confirmation_required"]);
  assert.equal(downloads, 0);
  assert.equal(extractions, 0);
  assert.equal(
    await fs.readFile(fixture.ffmpegPath, "utf8"),
    "old ffmpeg fixture",
  );
  assert.equal(
    await fs.readFile(fixture.ffprobePath, "utf8"),
    "old ffprobe fixture",
  );
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    "ffmpeg.exe",
    "ffprobe.exe",
  ]);
});

test("apply rejects a Windows plan when the actual runtime is not Windows", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  let downloads = 0;

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    platform: "linux",
    download: async () => {
      downloads += 1;
    },
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "BLOCKED");
  assert.deepEqual(evidence.blockers, ["windows_runtime_required"]);
  assert.equal(evidence.mutation_performed, false);
  assert.equal(downloads, 0);
});

test("apply rejects a plan whose action was changed after verification", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  const changedPlan = {
    ...plan,
    plan: { ...plan.plan, action: "NO_CHANGE", requires_apply: false },
  };
  let downloads = 0;

  const evidence = await applyPinnedFfmpegUpgrade(changedPlan, {
    operatorConfirmed: true,
    download: async () => {
      downloads += 1;
    },
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "BLOCKED");
  assert.deepEqual(evidence.blockers, ["apply_plan_not_trusted"]);
  assert.equal(evidence.mutation_performed, false);
  assert.equal(downloads, 0);
});

test("downloader rejects every URL except the exact pinned Gyan archive", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const destination = path.join(fixture.root, "candidate.zip");
  let requests = 0;

  await assert.rejects(
    downloadPinnedFfmpegArchive({
      url: "https://example.com/ffmpeg.zip",
      destination,
      fetchImpl: async () => {
        requests += 1;
      },
    }),
    /archive_url_not_pinned/,
  );

  assert.equal(requests, 0);
  await assert.rejects(fs.stat(destination), { code: "ENOENT" });
});

test("downloader streams only the pinned HTTPS Gyan response without credentials", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const destination = path.join(fixture.root, "candidate.zip");
  const payload = Buffer.from("bounded archive fixture");

  const result = await downloadPinnedFfmpegArchive({
    url: PINNED_FFMPEG_BUILD.archive_url,
    destination,
    async fetchImpl(url, options) {
      assert.equal(url, PINNED_FFMPEG_BUILD.archive_url);
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, undefined);
      assert.match(options.headers["User-Agent"], /pinned-ffmpeg-upgrade/);
      return {
        ok: true,
        status: 200,
        url: PINNED_FFMPEG_BUILD.archive_url,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-length"
              ? String(payload.length)
              : null;
          },
        },
        body: (async function* body() {
          yield payload.subarray(0, 5);
          yield payload.subarray(5);
        })(),
      };
    },
  });

  assert.deepEqual(await fs.readFile(destination), payload);
  assert.equal(result.bytes_written, payload.length);
  assert.equal(result.source_host, "www.gyan.dev");
  assert.equal(result.final_host, "www.gyan.dev");
  assert.equal(result.size_limit_bytes, 128 * 1024 * 1024);
  assert.doesNotMatch(JSON.stringify(result), /[?&](?:token|sig|key)=/i);
});

test("downloader rejects a different final URL before consuming its body", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const destination = path.join(fixture.root, "candidate.zip");
  let bodyConsumed = false;

  await assert.rejects(
    downloadPinnedFfmpegArchive({
      url: PINNED_FFMPEG_BUILD.archive_url,
      destination,
      async fetchImpl() {
        return {
          ok: true,
          status: 200,
          redirected: true,
          url: "https://www.gyan.dev/ffmpeg/builds/packages/other.zip",
          headers: { get: () => "1" },
          body: (async function* responseBody() {
            bodyConsumed = true;
            yield Buffer.from("x");
          })(),
        };
      },
    }),
    /download_final_url_not_pinned/,
  );

  assert.equal(bodyConsumed, false);
  await assert.rejects(fs.stat(destination), { code: "ENOENT" });
});

test("confirmed apply rejects a wrong archive checksum before extraction or backup", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  let extractions = 0;

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    async download({ url, destination }) {
      assert.equal(url, PINNED_FFMPEG_BUILD.archive_url);
      assert.equal(path.dirname(path.dirname(destination)), fixture.root);
      await fs.writeFile(destination, "tampered archive");
      return { bytes_written: 16, final_host: "www.gyan.dev" };
    },
    extractArchive: async () => {
      extractions += 1;
    },
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "FAILED");
  assert.equal(evidence.apply.checksum_verified, false);
  assert.equal(evidence.apply.archive_contents_verified, false);
  assert.equal(evidence.apply.backup_paths, null);
  assert.equal(evidence.mutation_performed, false);
  assert.deepEqual(evidence.blockers, ["downloaded_archive_checksum_mismatch"]);
  assert.equal(evidence.safety.downloads_performed, 1);
  assert.equal(evidence.safety.archives_extracted, 0);
  assert.equal(extractions, 0);
  assert.equal(
    await fs.readFile(fixture.ffmpegPath, "utf8"),
    "old ffmpeg fixture",
  );
  assert.equal(
    await fs.readFile(fixture.ffprobePath, "utf8"),
    "old ffprobe fixture",
  );
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    "ffmpeg.exe",
    "ffprobe.exe",
  ]);
});

test("confirmed apply rejects an invalid archive manifest before executing contents", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  let probes = 0;
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      probes += 1;
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "fixture archive");
    },
    async hashFile(filePath) {
      if (filePath.endsWith(".zip")) return PINNED_FFMPEG_BUILD.archive_sha256;
      return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
    },
    async extractArchive({ destinationDirectory }) {
      return {
        format: "zip",
        archive_root: PINNED_FFMPEG_BUILD.archive_root,
        entries_checked: 12,
        total_uncompressed_bytes: 300_000_000,
        binaries: {
          ffmpeg: {
            archive_path: "../ffmpeg.exe",
            extracted_path: path.join(destinationDirectory, "ffmpeg.exe"),
            size_bytes: PINNED_FFMPEG_BUILD.binaries.ffmpeg.size_bytes,
          },
          ffprobe: {
            archive_path: PINNED_FFMPEG_BUILD.binaries.ffprobe.archive_path,
            extracted_path: path.join(destinationDirectory, "ffprobe.exe"),
            size_bytes: PINNED_FFMPEG_BUILD.binaries.ffprobe.size_bytes,
          },
        },
      };
    },
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "FAILED");
  assert.equal(evidence.apply.checksum_verified, true);
  assert.equal(evidence.apply.archive_contents_verified, false);
  assert.equal(evidence.apply.failure_code, "archive_entry_path_mismatch");
  assert.equal(evidence.apply.backup_paths, null);
  assert.deepEqual(evidence.blockers, ["archive_contents_invalid"]);
  assert.equal(evidence.safety.archives_extracted, 1);
  assert.equal(probes, 2);
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    "ffmpeg.exe",
    "ffprobe.exe",
  ]);
});

test("confirmed apply rejects a staged pair checksum mismatch before backup", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  let stagedProbes = 0;

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "fixture archive");
    },
    async extractArchive({ destinationDirectory }) {
      const ffmpegPath = path.join(destinationDirectory, "ffmpeg.exe");
      const ffprobePath = path.join(destinationDirectory, "ffprobe.exe");
      await Promise.all([
        fs.writeFile(ffmpegPath, "official ffmpeg fixture"),
        fs.writeFile(ffprobePath, "tampered ffprobe fixture"),
      ]);
      return {
        format: "zip",
        archive_root: PINNED_FFMPEG_BUILD.archive_root,
        entries_checked: 12,
        total_uncompressed_bytes: 300_000_000,
        binaries: {
          ffmpeg: {
            archive_path: PINNED_FFMPEG_BUILD.binaries.ffmpeg.archive_path,
            extracted_path: ffmpegPath,
            size_bytes: PINNED_FFMPEG_BUILD.binaries.ffmpeg.size_bytes,
          },
          ffprobe: {
            archive_path: PINNED_FFMPEG_BUILD.binaries.ffprobe.archive_path,
            extracted_path: ffprobePath,
            size_bytes: PINNED_FFMPEG_BUILD.binaries.ffprobe.size_bytes,
          },
        },
      };
    },
    async hashFile(filePath) {
      if (filePath.endsWith(".zip")) {
        return PINNED_FFMPEG_BUILD.archive_sha256;
      }
      if (path.dirname(filePath).endsWith("staged")) {
        return path.basename(filePath).toLowerCase() === "ffmpeg.exe"
          ? PINNED_FFMPEG_BUILD.binaries.ffmpeg.sha256
          : digest("tampered ffprobe fixture");
      }
      return digest(await fs.readFile(filePath));
    },
    execFileSync() {
      stagedProbes += 1;
      return `${PINNED_FFMPEG_BUILD.provider_version}\n`;
    },
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "FAILED");
  assert.equal(evidence.apply.archive_contents_verified, true);
  assert.equal(evidence.apply.binary_checksums_verified, false);
  assert.equal(evidence.apply.version_verified, false);
  assert.equal(evidence.apply.backup_paths, null);
  assert.deepEqual(evidence.blockers, ["staged_ffprobe_checksum_mismatch"]);
  assert.equal(evidence.mutation_performed, false);
  assert.equal(stagedProbes, 0);
  assert.equal(
    await fs.readFile(fixture.ffmpegPath, "utf8"),
    "old ffmpeg fixture",
  );
  assert.equal(
    await fs.readFile(fixture.ffprobePath, "utf8"),
    "old ffprobe fixture",
  );
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    "ffmpeg.exe",
    "ffprobe.exe",
  ]);
});

test("confirmed apply preserves verified backups and installs the pinned pair", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  const syncedBackups = [];
  const fsWithBackupSyncTracking = Object.assign(Object.create(fs), {
    async open(filePath, flags, mode) {
      if (path.basename(filePath).startsWith(".ffmpeg-backup-")) {
        syncedBackups.push({ filePath, flags });
      }
      return fs.open(filePath, flags, mode);
    },
  });

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "fixture archive");
    },
    extractArchive: ({ destinationDirectory }) =>
      materialisePinnedStagedPair(destinationDirectory),
    hashFile: hashPinnedFixture,
    execFileSync: probePinnedFixture,
    fsPromises: fsWithBackupSyncTracking,
  });

  assert.equal(evidence.verdict, "GREEN");
  assert.equal(evidence.apply.status, "APPLIED");
  assert.equal(evidence.apply.binary_checksums_verified, true);
  assert.equal(evidence.apply.version_verified, true);
  assert.equal(evidence.apply.backups_verified, true);
  assert.equal(evidence.apply.replacement_atomic, false);
  assert.equal(evidence.apply.per_file_atomic_renames, true);
  assert.equal(evidence.apply.pair_atomic, false);
  assert.equal(evidence.apply.pair_transaction_completed, true);
  assert.equal(evidence.apply.post_replace_verified, true);
  assert.equal(evidence.mutation_performed, true);
  assert.equal(evidence.safety.replacements_performed, 2);
  assert.deepEqual(
    syncedBackups.map(({ filePath, flags }) => ({
      name: path.basename(filePath),
      flags,
    })),
    [
      {
        name: path.basename(evidence.apply.backup_paths.ffmpeg),
        flags: "r+",
      },
      {
        name: path.basename(evidence.apply.backup_paths.ffprobe),
        flags: "r+",
      },
    ],
  );
  assert.equal(
    await fs.readFile(fixture.ffmpegPath, "utf8"),
    "official pinned ffmpeg fixture",
  );
  assert.equal(
    await fs.readFile(fixture.ffprobePath, "utf8"),
    "official pinned ffprobe fixture",
  );
  assert.equal(
    await fs.readFile(evidence.apply.backup_paths.ffmpeg, "utf8"),
    "old ffmpeg fixture",
  );
  assert.equal(
    await fs.readFile(evidence.apply.backup_paths.ffprobe, "utf8"),
    "old ffprobe fixture",
  );
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    path.basename(evidence.apply.backup_paths.ffmpeg),
    path.basename(evidence.apply.backup_paths.ffprobe),
    "ffmpeg.exe",
    "ffprobe.exe",
  ].sort());
});

test("target changes during backup abort before either replacement rename", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  let backupCopies = 0;
  let renames = 0;
  const fsWithTargetRace = Object.assign(Object.create(fs), {
    async copyFile(source, destination, flags) {
      await fs.copyFile(source, destination, flags);
      if (path.basename(destination).startsWith(".ffmpeg-backup-")) {
        backupCopies += 1;
        if (backupCopies === 2) {
          await fs.writeFile(fixture.ffmpegPath, "external target change");
        }
      }
    },
    async rename(source, destination) {
      renames += 1;
      return fs.rename(source, destination);
    },
  });

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    fsPromises: fsWithTargetRace,
    async download({ destination }) {
      await fs.writeFile(destination, "fixture archive");
    },
    extractArchive: ({ destinationDirectory }) =>
      materialisePinnedStagedPair(destinationDirectory),
    hashFile: hashPinnedFixture,
    execFileSync: probePinnedFixture,
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "FAILED");
  assert.deepEqual(evidence.blockers, [
    "target_pair_changed_before_replace",
  ]);
  assert.equal(evidence.mutation_performed, false);
  assert.equal(evidence.apply.backups_verified, true);
  assert.equal(evidence.safety.replacements_performed, 0);
  assert.equal(renames, 0);
  assert.equal(
    await fs.readFile(fixture.ffmpegPath, "utf8"),
    "external target change",
  );
  assert.equal(
    await fs.readFile(fixture.ffprobePath, "utf8"),
    "old ffprobe fixture",
  );
});

test("staged pair changes during backup abort before either replacement rename", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  let backupCopies = 0;
  let stagedFfprobePath = null;
  let renames = 0;
  const fsWithStageRace = Object.assign(Object.create(fs), {
    async copyFile(source, destination, flags) {
      await fs.copyFile(source, destination, flags);
      if (path.basename(destination).startsWith(".ffmpeg-backup-")) {
        backupCopies += 1;
        if (backupCopies === 2) {
          await fs.writeFile(stagedFfprobePath, "staged file changed");
        }
      }
    },
    async rename(source, destination) {
      renames += 1;
      return fs.rename(source, destination);
    },
  });

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    fsPromises: fsWithStageRace,
    async download({ destination }) {
      await fs.writeFile(destination, "fixture archive");
    },
    async extractArchive({ destinationDirectory }) {
      stagedFfprobePath = path.join(destinationDirectory, "ffprobe.exe");
      return materialisePinnedStagedPair(destinationDirectory);
    },
    hashFile: hashPinnedFixture,
    execFileSync: probePinnedFixture,
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "FAILED");
  assert.deepEqual(evidence.blockers, [
    "staged_pair_changed_before_replace",
  ]);
  assert.equal(evidence.mutation_performed, false);
  assert.equal(evidence.apply.backups_verified, true);
  assert.equal(evidence.safety.replacements_performed, 0);
  assert.equal(renames, 0);
  assert.equal(
    await fs.readFile(fixture.ffmpegPath, "utf8"),
    "old ffmpeg fixture",
  );
  assert.equal(
    await fs.readFile(fixture.ffprobePath, "utf8"),
    "old ffprobe fixture",
  );
});

test("first atomic rename failure verifies the untouched original pair", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  const fsWithRenameFailure = Object.assign(Object.create(fs), {
    async rename(source, destination) {
      if (destination === fixture.ffmpegPath) {
        const error = new Error("fixture atomic rename failure");
        error.code = "EEXIST";
        throw error;
      }
      return fs.rename(source, destination);
    },
  });

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "fixture archive");
    },
    extractArchive: ({ destinationDirectory }) =>
      materialisePinnedStagedPair(destinationDirectory),
    hashFile: hashPinnedFixture,
    execFileSync: probePinnedFixture,
    fsPromises: fsWithRenameFailure,
  });

  assert.equal(evidence.apply.status, "FAILED");
  assert.deepEqual(evidence.blockers, [
    "pair_replacement_failed_before_mutation",
  ]);
  assert.equal(evidence.mutation_performed, false);
  assert.equal(evidence.apply.rollback_performed, false);
  assert.equal(evidence.apply.rollback_verified, true);
  assert.equal(evidence.apply.pair_transaction_completed, false);
  assert.equal(evidence.safety.replacements_performed, 0);
  assert.equal(await fs.readFile(fixture.ffmpegPath, "utf8"), "old ffmpeg fixture");
  assert.equal(await fs.readFile(fixture.ffprobePath, "utf8"), "old ffprobe fixture");
});

test("second pair rename failure restores the original pair from verified backups", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });
  let targetRenames = 0;
  const fsWithSecondRenameFailure = Object.assign(Object.create(fs), {
    async rename(source, destination) {
      if (
        destination === fixture.ffmpegPath ||
        destination === fixture.ffprobePath
      ) {
        targetRenames += 1;
        if (targetRenames === 2) {
          const error = new Error("fixture second rename failure");
          error.code = "EACCES";
          throw error;
        }
      }
      return fs.rename(source, destination);
    },
  });

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "fixture archive");
    },
    extractArchive: ({ destinationDirectory }) =>
      materialisePinnedStagedPair(destinationDirectory),
    hashFile: hashPinnedFixture,
    execFileSync: probePinnedFixture,
    fsPromises: fsWithSecondRenameFailure,
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "ROLLED_BACK");
  assert.deepEqual(evidence.blockers, [
    "pair_replacement_failed_rolled_back",
  ]);
  assert.equal(evidence.apply.rollback_performed, true);
  assert.equal(evidence.apply.rollback_verified, true);
  assert.equal(evidence.apply.pair_transaction_completed, false);
  assert.equal(evidence.mutation_performed, true);
  assert.equal(evidence.safety.replacements_performed, 1);
  assert.equal(evidence.safety.rollbacks_performed, 1);
  assert.equal(await fs.readFile(fixture.ffmpegPath, "utf8"), "old ffmpeg fixture");
  assert.equal(await fs.readFile(fixture.ffprobePath, "utf8"), "old ffprobe fixture");
  assert.equal(
    await fs.readFile(evidence.apply.backup_paths.ffmpeg, "utf8"),
    "old ffmpeg fixture",
  );
  assert.equal(
    await fs.readFile(evidence.apply.backup_paths.ffprobe, "utf8"),
    "old ffprobe fixture",
  );
});

test("post-install pair verification failure restores both original binaries", async (t) => {
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath: fixture.ffmpegPath,
    ffprobePath: fixture.ffprobePath,
    generatedAt: GENERATED_AT,
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
  });

  const evidence = await applyPinnedFfmpegUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "fixture archive");
    },
    extractArchive: ({ destinationDirectory }) =>
      materialisePinnedStagedPair(destinationDirectory),
    hashFile: hashPinnedFixture,
    execFileSync(binaryPath) {
      const component = path.basename(binaryPath, ".exe").toLowerCase();
      if (
        path.dirname(binaryPath) === fixture.root &&
        component === "ffprobe"
      ) {
        return "ffprobe version 0.0.0-untrusted\n";
      }
      return `${component} version ${PINNED_FFMPEG_BUILD.provider_version}\n`;
    },
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "ROLLED_BACK");
  assert.deepEqual(evidence.blockers, [
    "post_replace_verification_failed_rolled_back",
  ]);
  assert.equal(evidence.apply.post_replace_verified, false);
  assert.equal(evidence.apply.rollback_performed, true);
  assert.equal(evidence.apply.rollback_verified, true);
  assert.equal(evidence.apply.pair_transaction_completed, false);
  assert.equal(evidence.safety.replacements_performed, 2);
  assert.equal(evidence.safety.rollbacks_performed, 2);
  assert.equal(await fs.readFile(fixture.ffmpegPath, "utf8"), "old ffmpeg fixture");
  assert.equal(await fs.readFile(fixture.ffprobePath, "utf8"), "old ffprobe fixture");
});

test("CLI defaults to read-only pair verification and writes JSON evidence atomically", async (t) => {
  const { main } = require("../../tools/pinned-ffmpeg-upgrade");
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const outDir = path.join(fixture.root, "evidence with spaces");
  const stdout = [];
  let downloads = 0;

  const result = await main([
    "--ffmpeg",
    fixture.ffmpegPath,
    "--ffprobe",
    fixture.ffprobePath,
    "--out-dir",
    outDir,
    "--generated-at",
    GENERATED_AT,
    "--json",
  ], {
    platform: "win32",
    execFileSync(binary) {
      return `${path.basename(binary, ".exe")} version 8.0.1\n`;
    },
    download: async () => {
      downloads += 1;
    },
    stdout: { write: (value) => stdout.push(value) },
  });

  const evidencePath = path.join(
    outDir,
    "pinned_ffmpeg_upgrade_evidence.json",
  );
  const written = JSON.parse(await fs.readFile(evidencePath, "utf8"));
  assert.equal(result.args.apply, false);
  assert.equal(result.args.operatorConfirmed, false);
  assert.equal(result.report.mode, "PLAN_VERIFY");
  assert.equal(result.report.read_only, true);
  assert.equal(result.exitCode, 2);
  assert.equal(written.mode, "PLAN_VERIFY");
  assert.equal(downloads, 0);
  assert.equal(JSON.parse(stdout.join("")).mode, "PLAN_VERIFY");
  assert.deepEqual((await fs.readdir(outDir)).sort(), [
    "pinned_ffmpeg_upgrade_evidence.json",
    "pinned_ffmpeg_upgrade_summary.md",
  ]);
  assert.equal(
    await fs.readFile(fixture.ffmpegPath, "utf8"),
    "old ffmpeg fixture",
  );
  assert.equal(
    await fs.readFile(fixture.ffprobePath, "utf8"),
    "old ffprobe fixture",
  );
});

test("CLI parses apply and operator confirmation as independent flags", () => {
  const { parseArgs } = require("../../tools/pinned-ffmpeg-upgrade");
  const applyOnly = parseArgs(["--apply"]);
  const confirmedOnly = parseArgs(["--operator-confirmed"]);

  assert.equal(applyOnly.apply, true);
  assert.equal(applyOnly.operatorConfirmed, false);
  assert.equal(confirmedOnly.apply, false);
  assert.equal(confirmedOnly.operatorConfirmed, true);
});

test("Windows ZIP extractor rejects traversal entries before writing binaries", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only extractor");
    return;
  }
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const sourceBin = path.join(fixture.root, "malicious source");
  const archivePath = path.join(fixture.root, "malicious traversal.zip");
  const destinationDirectory = path.join(fixture.root, "must stay empty");
  const ffmpegBytes = Buffer.alloc(32, 0x46);
  const ffprobeBytes = Buffer.alloc(48, 0x50);
  await fs.mkdir(sourceBin);
  await Promise.all([
    fs.writeFile(path.join(sourceBin, "ffmpeg.exe"), ffmpegBytes),
    fs.writeFile(path.join(sourceBin, "ffprobe.exe"), ffprobeBytes),
  ]);
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  execFileSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $output=[IO.File]::Open(${quote(archivePath)},[IO.FileMode]::CreateNew); $zip=[IO.Compression.ZipArchive]::new($output,[IO.Compression.ZipArchiveMode]::Create); try { $files=@{'fixture-build/bin/ffmpeg.exe'=${quote(path.join(sourceBin, "ffmpeg.exe"))};'fixture-build/bin/ffprobe.exe'=${quote(path.join(sourceBin, "ffprobe.exe"))}}; foreach($name in $files.Keys){$entry=$zip.CreateEntry($name);$input=[IO.File]::OpenRead($files[$name]);$target=$entry.Open();try{$input.CopyTo($target)}finally{$target.Dispose();$input.Dispose()}}; [void]$zip.CreateEntry('fixture-build/../escape.txt') } finally { $zip.Dispose(); $output.Dispose() }`,
    ],
    { windowsHide: true },
  );

  await assert.rejects(
    extractPinnedFfmpegArchive({
      archivePath,
      destinationDirectory,
      expectedBuild: {
        archive_root: "fixture-build",
        binaries: {
          ffmpeg: {
            name: "ffmpeg.exe",
            archive_path: "fixture-build/bin/ffmpeg.exe",
            size_bytes: ffmpegBytes.length,
          },
          ffprobe: {
            name: "ffprobe.exe",
            archive_path: "fixture-build/bin/ffprobe.exe",
            size_bytes: ffprobeBytes.length,
          },
        },
      },
    }),
    /archive_entry_path_invalid/,
  );
  await assert.rejects(fs.stat(path.join(fixture.root, "escape.txt")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(destinationDirectory), { code: "ENOENT" });
});

test("Windows ZIP extractor validates the archive before extracting only the pinned pair", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only extractor");
    return;
  }
  const fixture = await makeFixturePair();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const sourceRoot = path.join(fixture.root, "fixture-build");
  const sourceBin = path.join(sourceRoot, "bin");
  const archivePath = path.join(fixture.root, "fixture build's archive.zip");
  const destinationDirectory = path.join(
    fixture.root,
    "extracted pair's directory",
  );
  const ffmpegBytes = Buffer.alloc(1024, 0x46);
  const ffprobeBytes = Buffer.alloc(1536, 0x50);
  await fs.mkdir(sourceBin, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(sourceBin, "ffmpeg.exe"), ffmpegBytes),
    fs.writeFile(path.join(sourceBin, "ffprobe.exe"), ffprobeBytes),
    fs.writeFile(path.join(sourceBin, "ffplay.exe"), "must not be extracted"),
  ]);
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  execFileSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $output=[IO.File]::Open(${quote(archivePath)},[IO.FileMode]::CreateNew); $zip=[IO.Compression.ZipArchive]::new($output,[IO.Compression.ZipArchiveMode]::Create); try { [void]$zip.CreateEntry('fixture-build/'); [void]$zip.CreateEntry('fixture-build/bin/'); $files=@{'fixture-build/bin/ffmpeg.exe'=${quote(path.join(sourceBin, "ffmpeg.exe"))};'fixture-build/bin/ffprobe.exe'=${quote(path.join(sourceBin, "ffprobe.exe"))};'fixture-build/bin/ffplay.exe'=${quote(path.join(sourceBin, "ffplay.exe"))}}; foreach($name in $files.Keys){$entry=$zip.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal);$input=[IO.File]::OpenRead($files[$name]);$target=$entry.Open();try{$input.CopyTo($target)}finally{$target.Dispose();$input.Dispose()}} } finally { $zip.Dispose(); $output.Dispose() }`,
    ],
    { windowsHide: true },
  );

  const expectedBuild = {
    archive_root: "fixture-build",
    binaries: {
      ffmpeg: {
        name: "ffmpeg.exe",
        archive_path: "fixture-build/bin/ffmpeg.exe",
        size_bytes: ffmpegBytes.length,
      },
      ffprobe: {
        name: "ffprobe.exe",
        archive_path: "fixture-build/bin/ffprobe.exe",
        size_bytes: ffprobeBytes.length,
      },
    },
  };
  const manifest = await extractPinnedFfmpegArchive({
    archivePath,
    destinationDirectory,
    expectedBuild,
  });

  assert.equal(manifest.format, "zip");
  assert.equal(manifest.archive_root, "fixture-build");
  assert.ok(manifest.entries_checked >= 4);
  assert.equal(
    manifest.binaries.ffmpeg.archive_path,
    expectedBuild.binaries.ffmpeg.archive_path,
  );
  assert.equal(
    manifest.binaries.ffprobe.archive_path,
    expectedBuild.binaries.ffprobe.archive_path,
  );
  assert.deepEqual(
    await fs.readFile(path.join(destinationDirectory, "ffmpeg.exe")),
    ffmpegBytes,
  );
  assert.deepEqual(
    await fs.readFile(path.join(destinationDirectory, "ffprobe.exe")),
    ffprobeBytes,
  );
  await assert.rejects(
    fs.stat(path.join(destinationDirectory, "ffplay.exe")),
    { code: "ENOENT" },
  );
});
