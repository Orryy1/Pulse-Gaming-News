"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PINNED_YTDLP_RELEASE,
  applyPinnedYtDlpUpgrade,
  buildPinnedYtDlpUpgradePlan,
  downloadPinnedYtDlpAsset,
} = require("../../lib/pinned-ytdlp-upgrade");
const {
  main,
  parseArgs,
} = require("../../tools/pinned-ytdlp-upgrade");

const GENERATED_AT = "2026-07-15T09:00:00.000Z";

async function makeFixtureBinary(contents = "old yt-dlp fixture") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-pinned-ytdlp-"));
  const binaryPath = path.join(root, "yt-dlp.exe");
  await fs.writeFile(binaryPath, contents);
  return { root, binaryPath };
}

test("default verification produces a read-only pinned upgrade plan", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const before = await fs.readdir(fixture.root);

  const report = await buildPinnedYtDlpUpgradePlan({
    binaryPath: fixture.binaryPath,
    generatedAt: GENERATED_AT,
    execFileSync(binary, args) {
      assert.equal(binary, fixture.binaryPath);
      assert.deepEqual(args, ["--version"]);
      return "2026.03.17\n";
    },
  });

  const expectedCurrentSha256 = crypto
    .createHash("sha256")
    .update("old yt-dlp fixture")
    .digest("hex");

  assert.equal(report.schema_version, 1);
  assert.equal(report.mode, "PLAN_VERIFY");
  assert.equal(report.read_only, true);
  assert.equal(report.mutation_performed, false);
  assert.equal(report.verdict, "RED");
  assert.deepEqual(report.blockers, ["yt_dlp_upgrade_required"]);
  assert.equal(report.current.detected_version, "2026.03.17");
  assert.equal(report.current.sha256, expectedCurrentSha256);
  assert.equal(report.target.version, "2026.06.09");
  assert.equal(
    report.target.asset_url,
    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/yt-dlp.exe",
  );
  assert.equal(
    report.target.sha256,
    "3a48cb955d55c8821b60ccbdbbc6f61bc958f2f3d3b7ad5eaf3d83a543293a27",
  );
  assert.deepEqual(await fs.readdir(fixture.root), before);
  assert.equal(PINNED_YTDLP_RELEASE.minimum_version, "2026.06.09");
});

test("apply fails closed without separate operator confirmation", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedYtDlpUpgradePlan({
    binaryPath: fixture.binaryPath,
    generatedAt: GENERATED_AT,
    execFileSync: () => "2026.03.17\n",
  });
  let downloads = 0;

  const evidence = await applyPinnedYtDlpUpgrade(plan, {
    operatorConfirmed: false,
    download: async () => {
      downloads += 1;
    },
  });

  assert.equal(evidence.mode, "APPLY");
  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "BLOCKED");
  assert.equal(evidence.apply.operator_confirmed, false);
  assert.equal(evidence.mutation_performed, false);
  assert.deepEqual(evidence.blockers, ["operator_confirmation_required"]);
  assert.equal(downloads, 0);
  assert.equal(await fs.readFile(fixture.binaryPath, "utf8"), "old yt-dlp fixture");
  assert.deepEqual(await fs.readdir(fixture.root), ["yt-dlp.exe"]);
});

test("confirmed apply rejects a downloaded asset with the wrong SHA-256", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedYtDlpUpgradePlan({
    binaryPath: fixture.binaryPath,
    generatedAt: GENERATED_AT,
    execFileSync: () => "2026.03.17\n",
  });
  const downloads = [];

  const evidence = await applyPinnedYtDlpUpgrade(plan, {
    operatorConfirmed: true,
    async download({ url, destination }) {
      downloads.push({ url, destination });
      await fs.writeFile(destination, "tampered download");
    },
  });

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].url, PINNED_YTDLP_RELEASE.asset_url);
  assert.equal(path.dirname(path.dirname(downloads[0].destination)), fixture.root);
  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "FAILED");
  assert.equal(evidence.apply.checksum_verified, false);
  assert.equal(evidence.apply.version_verified, false);
  assert.equal(evidence.apply.backup_path, null);
  assert.equal(evidence.apply.replacement_atomic, false);
  assert.deepEqual(evidence.blockers, ["downloaded_asset_checksum_mismatch"]);
  assert.equal(evidence.mutation_performed, false);
  assert.equal(await fs.readFile(fixture.binaryPath, "utf8"), "old yt-dlp fixture");
  assert.deepEqual(await fs.readdir(fixture.root), ["yt-dlp.exe"]);
});

test("confirmed apply probes the temporary executable before replacement", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedYtDlpUpgradePlan({
    binaryPath: fixture.binaryPath,
    generatedAt: GENERATED_AT,
    execFileSync: () => "2026.03.17\n",
  });
  const probes = [];

  const evidence = await applyPinnedYtDlpUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "fixture with injected official checksum");
    },
    hashFile: async () => PINNED_YTDLP_RELEASE.sha256,
    execFileSync(binary, args) {
      probes.push({ binary, args });
      return "2026.06.08\n";
    },
  });

  assert.equal(probes.length, 1);
  assert.equal(path.basename(probes[0].binary), "yt-dlp.exe");
  assert.notEqual(probes[0].binary, fixture.binaryPath);
  assert.deepEqual(probes[0].args, ["--version"]);
  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.checksum_verified, true);
  assert.equal(evidence.apply.probed_version, "2026.06.08");
  assert.equal(evidence.apply.version_verified, false);
  assert.equal(evidence.apply.backup_path, null);
  assert.deepEqual(evidence.blockers, ["downloaded_asset_version_mismatch"]);
  assert.equal(await fs.readFile(fixture.binaryPath, "utf8"), "old yt-dlp fixture");
  assert.deepEqual(await fs.readdir(fixture.root), ["yt-dlp.exe"]);
});

test("confirmed apply preserves a verified backup and atomically installs the pinned release", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedYtDlpUpgradePlan({
    binaryPath: fixture.binaryPath,
    generatedAt: GENERATED_AT,
    execFileSync: () => "2026.03.17\n",
  });
  const oldSha256 = plan.current.sha256;
  const probes = [];

  const evidence = await applyPinnedYtDlpUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "official pinned fixture");
    },
    async hashFile(filePath) {
      const contents = await fs.readFile(filePath, "utf8");
      if (contents === "official pinned fixture") {
        return PINNED_YTDLP_RELEASE.sha256;
      }
      return crypto.createHash("sha256").update(contents).digest("hex");
    },
    execFileSync(binary, args) {
      probes.push({ binary, args });
      return `${PINNED_YTDLP_RELEASE.version}\n`;
    },
  });

  assert.equal(evidence.verdict, "GREEN");
  assert.deepEqual(evidence.blockers, []);
  assert.equal(evidence.mutation_performed, true);
  assert.equal(evidence.apply.status, "APPLIED");
  assert.equal(evidence.apply.checksum_verified, true);
  assert.equal(evidence.apply.version_verified, true);
  assert.equal(evidence.apply.backup_verified, true);
  assert.equal(evidence.apply.backup_sha256, oldSha256);
  assert.equal(evidence.apply.replacement_atomic, true);
  assert.equal(evidence.apply.post_replace_verified, true);
  assert.equal(evidence.apply.post_replace_sha256, PINNED_YTDLP_RELEASE.sha256);
  assert.equal(evidence.apply.post_replace_version, PINNED_YTDLP_RELEASE.version);
  assert.equal(path.dirname(evidence.apply.backup_path), fixture.root);
  assert.equal(
    await fs.readFile(evidence.apply.backup_path, "utf8"),
    "old yt-dlp fixture",
  );
  assert.equal(
    await fs.readFile(fixture.binaryPath, "utf8"),
    "official pinned fixture",
  );
  assert.equal(probes.length, 2);
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    path.basename(evidence.apply.backup_path),
    "yt-dlp.exe",
  ].sort());
});

test("CLI defaults to plan/verify and writes machine-readable evidence", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const outDir = path.join(fixture.root, "evidence");
  const stdout = [];
  let downloads = 0;

  const result = await main([
    "--binary",
    fixture.binaryPath,
    "--out-dir",
    outDir,
    "--generated-at",
    GENERATED_AT,
    "--json",
  ], {
    execFileSync: () => "2026.03.17\n",
    download: async () => {
      downloads += 1;
    },
    stdout: { write: (value) => stdout.push(value) },
  });

  const evidencePath = path.join(outDir, "pinned_ytdlp_upgrade_evidence.json");
  const written = JSON.parse(await fs.readFile(evidencePath, "utf8"));
  assert.equal(result.args.apply, false);
  assert.equal(result.args.operatorConfirmed, false);
  assert.equal(result.report.mode, "PLAN_VERIFY");
  assert.equal(result.exitCode, 2);
  assert.equal(written.mode, "PLAN_VERIFY");
  assert.equal(written.read_only, true);
  assert.equal(downloads, 0);
  assert.equal(JSON.parse(stdout.join("")).mode, "PLAN_VERIFY");
  assert.equal(await fs.readFile(fixture.binaryPath, "utf8"), "old yt-dlp fixture");
});

test("CLI parses apply and operator confirmation as independent flags", () => {
  const applyOnly = parseArgs(["--apply"]);
  const confirmedOnly = parseArgs(["--operator-confirmed"]);

  assert.equal(applyOnly.apply, true);
  assert.equal(applyOnly.operatorConfirmed, false);
  assert.equal(confirmedOnly.apply, false);
  assert.equal(confirmedOnly.operatorConfirmed, true);
});

test("downloader rejects every URL except the exact pinned official asset", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const destination = path.join(fixture.root, "download.exe");
  let requests = 0;

  await assert.rejects(
    downloadPinnedYtDlpAsset({
      url: "https://example.com/yt-dlp.exe",
      destination,
      fetchImpl: async () => {
        requests += 1;
      },
    }),
    /asset_url_not_pinned/,
  );

  assert.equal(requests, 0);
  assert.equal(await fs.stat(destination).then(() => true, () => false), false);
});

test("downloader streams the pinned GitHub release asset without exposing redirect credentials", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const destination = path.join(fixture.root, "download", "yt-dlp.exe");
  await fs.mkdir(path.dirname(destination));
  const payload = Buffer.from("official release bytes");

  const result = await downloadPinnedYtDlpAsset({
    url: PINNED_YTDLP_RELEASE.asset_url,
    destination,
    async fetchImpl(url, options) {
      assert.equal(url, PINNED_YTDLP_RELEASE.asset_url);
      assert.equal(options.redirect, "follow");
      assert.equal(options.headers.Authorization, undefined);
      return {
        ok: true,
        status: 200,
        url: "https://release-assets.githubusercontent.com/github-production-release-asset/asset?token=do-not-record",
        headers: {
          get(name) {
            return name.toLowerCase() === "content-length"
              ? String(payload.length)
              : null;
          },
        },
        body: (async function* body() {
          yield payload.subarray(0, 8);
          yield payload.subarray(8);
        })(),
      };
    },
  });

  assert.equal(await fs.readFile(destination, "utf8"), payload.toString("utf8"));
  assert.equal(result.bytes_written, payload.length);
  assert.equal(result.final_host, "release-assets.githubusercontent.com");
  assert.doesNotMatch(JSON.stringify(result), /do-not-record/);
});

test("post-replacement verification failure rolls back and preserves the backup", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedYtDlpUpgradePlan({
    binaryPath: fixture.binaryPath,
    generatedAt: GENERATED_AT,
    execFileSync: () => "2026.03.17\n",
  });
  let probeCount = 0;

  const evidence = await applyPinnedYtDlpUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "official pinned fixture");
    },
    async hashFile(filePath) {
      const contents = await fs.readFile(filePath, "utf8");
      if (contents === "official pinned fixture") {
        return PINNED_YTDLP_RELEASE.sha256;
      }
      return crypto.createHash("sha256").update(contents).digest("hex");
    },
    execFileSync() {
      probeCount += 1;
      return probeCount === 1
        ? `${PINNED_YTDLP_RELEASE.version}\n`
        : "2026.06.08\n";
    },
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "ROLLED_BACK");
  assert.equal(evidence.apply.post_replace_verified, false);
  assert.equal(evidence.apply.rollback_performed, true);
  assert.equal(evidence.apply.rollback_verified, true);
  assert.equal(evidence.apply.backup_verified, true);
  assert.deepEqual(evidence.blockers, [
    "post_replace_verification_failed_rolled_back",
  ]);
  assert.equal(await fs.readFile(fixture.binaryPath, "utf8"), "old yt-dlp fixture");
  assert.equal(
    await fs.readFile(evidence.apply.backup_path, "utf8"),
    "old yt-dlp fixture",
  );
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    path.basename(evidence.apply.backup_path),
    "yt-dlp.exe",
  ].sort());
});

test("CLI emits sanitised RED evidence when a confirmed download fails", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const outDir = path.join(fixture.root, "evidence");
  const stdout = [];

  const result = await main([
    "--binary",
    fixture.binaryPath,
    "--out-dir",
    outDir,
    "--generated-at",
    GENERATED_AT,
    "--apply",
    "--operator-confirmed",
    "--json",
  ], {
    execFileSync: () => "2026.03.17\n",
    download: async () => {
      throw new Error("request failed token=do-not-record");
    },
    stdout: { write: (value) => stdout.push(value) },
  });

  const evidence = JSON.parse(
    await fs.readFile(
      path.join(outDir, "pinned_ytdlp_upgrade_evidence.json"),
      "utf8",
    ),
  );
  assert.equal(result.exitCode, 2);
  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "FAILED");
  assert.deepEqual(evidence.blockers, ["download_failed"]);
  assert.doesNotMatch(JSON.stringify(evidence), /do-not-record/);
  assert.doesNotMatch(stdout.join(""), /do-not-record/);
  assert.equal(await fs.readFile(fixture.binaryPath, "utf8"), "old yt-dlp fixture");
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    "evidence",
    "yt-dlp.exe",
  ]);
});

test("apply refuses to overwrite an existing deterministic backup", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedYtDlpUpgradePlan({
    binaryPath: fixture.binaryPath,
    generatedAt: GENERATED_AT,
    execFileSync: () => "2026.03.17\n",
  });
  const backupPath = `${fixture.binaryPath}.backup-20260715090000000`;
  await fs.writeFile(backupPath, "pre-existing operator backup");

  const evidence = await applyPinnedYtDlpUpgrade(plan, {
    operatorConfirmed: true,
    async download({ destination }) {
      await fs.writeFile(destination, "official pinned fixture");
    },
    async hashFile(filePath) {
      const contents = await fs.readFile(filePath, "utf8");
      if (contents === "official pinned fixture") {
        return PINNED_YTDLP_RELEASE.sha256;
      }
      return crypto.createHash("sha256").update(contents).digest("hex");
    },
    execFileSync: () => `${PINNED_YTDLP_RELEASE.version}\n`,
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "FAILED");
  assert.deepEqual(evidence.blockers, ["backup_path_already_exists"]);
  assert.equal(evidence.apply.backup_path, backupPath);
  assert.equal(evidence.apply.replacement_atomic, false);
  assert.equal(await fs.readFile(fixture.binaryPath, "utf8"), "old yt-dlp fixture");
  assert.equal(await fs.readFile(backupPath, "utf8"), "pre-existing operator backup");
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    path.basename(backupPath),
    "yt-dlp.exe",
  ].sort());
});

test("atomic rename failure leaves the original binary and verified backup intact", async (t) => {
  const fixture = await makeFixtureBinary();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedYtDlpUpgradePlan({
    binaryPath: fixture.binaryPath,
    generatedAt: GENERATED_AT,
    execFileSync: () => "2026.03.17\n",
  });
  const fsWithLockedTarget = {
    ...fs,
    async rename() {
      const error = new Error("target is locked");
      error.code = "EPERM";
      throw error;
    },
  };

  const evidence = await applyPinnedYtDlpUpgrade(plan, {
    operatorConfirmed: true,
    fsPromises: fsWithLockedTarget,
    async download({ destination }) {
      await fs.writeFile(destination, "official pinned fixture");
    },
    async hashFile(filePath) {
      const contents = await fs.readFile(filePath, "utf8");
      if (contents === "official pinned fixture") {
        return PINNED_YTDLP_RELEASE.sha256;
      }
      return crypto.createHash("sha256").update(contents).digest("hex");
    },
    execFileSync: () => `${PINNED_YTDLP_RELEASE.version}\n`,
  });

  assert.equal(evidence.verdict, "RED");
  assert.equal(evidence.apply.status, "FAILED");
  assert.equal(evidence.apply.failure_code, "EPERM");
  assert.equal(evidence.apply.backup_verified, true);
  assert.equal(evidence.apply.replacement_atomic, false);
  assert.deepEqual(evidence.blockers, ["atomic_replace_failed"]);
  assert.equal(await fs.readFile(fixture.binaryPath, "utf8"), "old yt-dlp fixture");
  assert.equal(
    await fs.readFile(evidence.apply.backup_path, "utf8"),
    "old yt-dlp fixture",
  );
  assert.deepEqual((await fs.readdir(fixture.root)).sort(), [
    path.basename(evidence.apply.backup_path),
    "yt-dlp.exe",
  ].sort());
});

test("plan fails closed on symbolic-link binary targets before hashing or probing", async () => {
  let hashes = 0;
  let probes = 0;
  const report = await buildPinnedYtDlpUpgradePlan({
    binaryPath: "C:/toolchain/yt-dlp.exe",
    generatedAt: GENERATED_AT,
    fsPromises: {
      async lstat() {
        return {
          isFile: () => true,
          isSymbolicLink: () => true,
        };
      },
    },
    hashFile: async () => {
      hashes += 1;
      return PINNED_YTDLP_RELEASE.sha256;
    },
    execFileSync: () => {
      probes += 1;
      return `${PINNED_YTDLP_RELEASE.version}\n`;
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.current.symbolic_link, true);
  assert.deepEqual(report.blockers, [
    "yt_dlp_symbolic_link_target_not_allowed",
  ]);
  assert.equal(hashes, 0);
  assert.equal(probes, 0);
});

test("plan converts binary inspection errors into sanitised RED evidence", async () => {
  let probes = 0;
  const report = await buildPinnedYtDlpUpgradePlan({
    binaryPath: "C:/restricted/yt-dlp.exe",
    generatedAt: GENERATED_AT,
    fsPromises: {
      async lstat() {
        const error = new Error("C:/restricted/yt-dlp.exe access denied");
        error.code = "EACCES";
        throw error;
      },
    },
    execFileSync: () => {
      probes += 1;
      return `${PINNED_YTDLP_RELEASE.version}\n`;
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.current.inspection_error, "EACCES");
  assert.deepEqual(report.blockers, ["yt_dlp_binary_inspection_failed"]);
  assert.doesNotMatch(JSON.stringify(report), /access denied/i);
  assert.equal(probes, 0);
});

test("plan does not execute a binary when its SHA-256 cannot be read", async () => {
  let probes = 0;
  const report = await buildPinnedYtDlpUpgradePlan({
    binaryPath: "C:/restricted/yt-dlp.exe",
    generatedAt: GENERATED_AT,
    fsPromises: {
      async lstat() {
        return {
          isFile: () => true,
          isSymbolicLink: () => false,
        };
      },
    },
    hashFile: async () => {
      const error = new Error("secret-bearing filesystem detail");
      error.code = "EACCES";
      throw error;
    },
    execFileSync: () => {
      probes += 1;
      return `${PINNED_YTDLP_RELEASE.version}\n`;
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.current.hash_error, "EACCES");
  assert.deepEqual(report.blockers, ["yt_dlp_binary_hash_failed"]);
  assert.doesNotMatch(JSON.stringify(report), /secret-bearing/);
  assert.equal(probes, 0);
});

test("exact pinned version and checksum are GREEN and never reinstalled", async (t) => {
  const fixture = await makeFixtureBinary("official pinned fixture");
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const plan = await buildPinnedYtDlpUpgradePlan({
    binaryPath: fixture.binaryPath,
    generatedAt: GENERATED_AT,
    hashFile: async () => PINNED_YTDLP_RELEASE.sha256,
    execFileSync: () => `${PINNED_YTDLP_RELEASE.version}\n`,
  });
  let downloads = 0;

  const evidence = await applyPinnedYtDlpUpgrade(plan, {
    operatorConfirmed: true,
    download: async () => {
      downloads += 1;
    },
  });

  assert.equal(plan.verdict, "GREEN");
  assert.equal(plan.current.matches_pinned_release, true);
  assert.equal(plan.plan.action, "NO_CHANGE");
  assert.equal(evidence.verdict, "GREEN");
  assert.equal(evidence.apply.status, "SKIPPED_ALREADY_COMPLIANT");
  assert.equal(evidence.mutation_performed, false);
  assert.equal(downloads, 0);
  assert.deepEqual(await fs.readdir(fixture.root), ["yt-dlp.exe"]);
});
