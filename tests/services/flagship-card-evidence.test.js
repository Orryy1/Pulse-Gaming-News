"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  validateAndCopyFlagshipCardEvidence,
} = require("../../lib/flagship-card-evidence");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function makeCard(root, kind, generationId, durationSeconds) {
  const filePath = path.join(root, "source", "flagship", "cards", `${kind}.mp4`);
  const bytes = Buffer.from(`decoded-${kind}-${generationId}`);
  await fs.outputFile(filePath, bytes);
  return {
    card_kind: kind,
    path: filePath,
    sha256: sha256(bytes),
    size_bytes: bytes.length,
    duration_seconds: durationSeconds,
    generation_id: generationId,
  };
}

test("copies only generation-bound decoded cards and returns current file evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-card-evidence-"));
  t.after(() => fs.remove(root));
  const generationId = "flagship-generation-20260720T020000Z";
  const sourceArtifactDir = path.join(root, "source");
  const targetArtifactDir = path.join(root, "target");
  const cards = [
    await makeCard(root, "source", generationId, 2.4),
    await makeCard(root, "context", generationId, 2.6),
  ];

  const report = await validateAndCopyFlagshipCardEvidence({
    artifactDir: sourceArtifactDir,
    cardManifest: {
      schema_version: 1,
      story_id: "story-flagship-cards",
      generation_id: generationId,
      cards,
    },
    currentGenerationId: generationId,
    expectedCardKinds: ["source", "context"],
    approvedRoots: [sourceArtifactDir],
    targetArtifactDir,
    generatedAt: "2026-07-20T02:01:00.000Z",
    probeVideo: async (filePath) => ({
      decodable: true,
      duration_seconds: cards.find((card) => card.path === filePath).duration_seconds,
      video: {
        codec: "h264",
        width: 1080,
        height: 1920,
      },
    }),
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.status, "copied");
  assert.equal(report.generation_id, generationId);
  assert.equal(report.summary.expected_card_count, 2);
  assert.equal(report.summary.validated_card_count, 2);
  assert.equal(report.summary.copied_card_count, 2);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.safety.publish_authorised, false);

  for (const [index, card] of report.cards.entries()) {
    assert.equal(card.card_kind, cards[index].card_kind);
    assert.equal(card.sha256, cards[index].sha256);
    assert.equal(card.size_bytes, cards[index].size_bytes);
    assert.equal(card.duration_seconds, cards[index].duration_seconds);
    assert.equal(card.generation_bound, true);
    assert.equal(card.video_codec, "h264");
    assert.equal(await fs.pathExists(card.target_path), true);
    assert.equal(sha256(await fs.readFile(card.target_path)), cards[index].sha256);
    assert.equal(
      path.dirname(card.target_path),
      path.join(targetArtifactDir, "flagship", "cards"),
    );
  }
});

test("fails closed before copying when an expected card is missing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-card-missing-"));
  t.after(() => fs.remove(root));
  const generationId = "flagship-generation-current";
  const sourceArtifactDir = path.join(root, "source");
  const targetArtifactDir = path.join(root, "target");
  const sourceCard = await makeCard(root, "source", generationId, 2.4);

  await assert.rejects(
    () => validateAndCopyFlagshipCardEvidence({
      artifactDir: sourceArtifactDir,
      cardPaths: [sourceCard],
      currentGenerationId: generationId,
      expectedCardKinds: ["source", "context"],
      targetArtifactDir,
      probeVideo: async () => ({
        decodable: true,
        duration_seconds: 2.4,
        video: { codec: "h264", width: 1080, height: 1920 },
      }),
    }),
    (error) => {
      assert.equal(error.code, "flagship_card_evidence_invalid");
      assert.equal(error.report.verdict, "RED");
      assert.ok(error.report.blockers.includes("expected_card_missing:context"));
      assert.ok(error.report.blockers.includes("card_count_mismatch"));
      return true;
    },
  );
  assert.equal(await fs.pathExists(targetArtifactDir), false);
});

test("rejects a card that is not bound to the current generation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-card-stale-"));
  t.after(() => fs.remove(root));
  const sourceArtifactDir = path.join(root, "source");
  const targetArtifactDir = path.join(root, "target");
  const staleCard = await makeCard(root, "source", "generation-old", 2.4);

  await assert.rejects(
    () => validateAndCopyFlagshipCardEvidence({
      artifactDir: sourceArtifactDir,
      cardPaths: [staleCard],
      currentGenerationId: "generation-current",
      expectedCardKinds: ["source"],
      targetArtifactDir,
      probeVideo: async () => ({
        decodable: true,
        duration_seconds: 2.4,
        video: { codec: "h264", width: 1080, height: 1920 },
      }),
    }),
    (error) => {
      assert.ok(error.report.blockers.includes("card_generation_stale:source"));
      return true;
    },
  );
  assert.equal(await fs.pathExists(targetArtifactDir), false);
});

test("rejects card paths outside the approved real roots", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-card-escape-"));
  t.after(() => fs.remove(root));
  const generationId = "generation-current";
  const sourceArtifactDir = path.join(root, "source");
  const targetArtifactDir = path.join(root, "target");
  const escapedPath = path.join(root, "outside", "source.mp4");
  const bytes = Buffer.from("outside-card");
  await fs.ensureDir(sourceArtifactDir);
  await fs.outputFile(escapedPath, bytes);

  await assert.rejects(
    () => validateAndCopyFlagshipCardEvidence({
      artifactDir: sourceArtifactDir,
      cardPaths: [{
        card_kind: "source",
        path: escapedPath,
        sha256: sha256(bytes),
        size_bytes: bytes.length,
        duration_seconds: 2.4,
        generation_id: generationId,
      }],
      currentGenerationId: generationId,
      expectedCardKinds: ["source"],
      targetArtifactDir,
      probeVideo: async () => ({
        decodable: true,
        duration_seconds: 2.4,
        video: { codec: "h264", width: 1080, height: 1920 },
      }),
    }),
    (error) => {
      assert.ok(error.report.blockers.includes("card_path_outside_approved_roots:source"));
      return true;
    },
  );
  assert.equal(await fs.pathExists(targetArtifactDir), false);
});

test("rejects stale SHA-256, size and duration declarations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-card-stale-proof-"));
  t.after(() => fs.remove(root));
  const generationId = "generation-current";
  const sourceArtifactDir = path.join(root, "source");
  const baseCard = await makeCard(root, "source", generationId, 2.4);
  const cases = [
    {
      name: "sha256",
      card: { ...baseCard, sha256: "f".repeat(64) },
      blocker: "card_sha256_mismatch:source",
    },
    {
      name: "size",
      card: { ...baseCard, size_bytes: baseCard.size_bytes + 1 },
      blocker: "card_size_mismatch:source",
    },
    {
      name: "duration",
      card: { ...baseCard, duration_seconds: 3.2 },
      blocker: "card_duration_mismatch:source",
    },
  ];

  for (const scenario of cases) {
    const targetArtifactDir = path.join(root, `target-${scenario.name}`);
    await assert.rejects(
      () => validateAndCopyFlagshipCardEvidence({
        artifactDir: sourceArtifactDir,
        cardPaths: [scenario.card],
        currentGenerationId: generationId,
        expectedCardKinds: ["source"],
        targetArtifactDir,
        probeVideo: async () => ({
          decodable: true,
          duration_seconds: 2.4,
          video: { codec: "h264", width: 1080, height: 1920 },
        }),
      }),
      (error) => {
        assert.ok(error.report.blockers.includes(scenario.blocker));
        return true;
      },
    );
    assert.equal(await fs.pathExists(targetArtifactDir), false);
  }
});

test("rejects unreadable probes and decodable files without a video stream", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-card-probe-"));
  t.after(() => fs.remove(root));
  const generationId = "generation-current";
  const sourceArtifactDir = path.join(root, "source");
  const card = await makeCard(root, "source", generationId, 2.4);
  const cases = [
    {
      name: "unreadable",
      probeVideo: async () => {
        throw new Error("ffprobe failed");
      },
      blocker: "card_probe_failed:source",
    },
    {
      name: "audio-only",
      probeVideo: async () => ({
        decodable: true,
        duration_seconds: 2.4,
        video: null,
      }),
      blocker: "card_video_stream_missing:source",
    },
  ];

  for (const scenario of cases) {
    const targetArtifactDir = path.join(root, `target-${scenario.name}`);
    await assert.rejects(
      () => validateAndCopyFlagshipCardEvidence({
        artifactDir: sourceArtifactDir,
        cardPaths: [card],
        currentGenerationId: generationId,
        expectedCardKinds: ["source"],
        targetArtifactDir,
        probeVideo: scenario.probeVideo,
      }),
      (error) => {
        assert.ok(error.report.blockers.includes(scenario.blocker));
        return true;
      },
    );
    assert.equal(await fs.pathExists(targetArtifactDir), false);
  }
});

test("rejects duplicate card paths and bytes presented as different cards", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-card-duplicate-"));
  t.after(() => fs.remove(root));
  const generationId = "generation-current";
  const sourceArtifactDir = path.join(root, "source");
  const targetArtifactDir = path.join(root, "target");
  const sourceCard = await makeCard(root, "source", generationId, 2.4);
  const duplicate = {
    ...sourceCard,
    card_kind: "context",
  };

  await assert.rejects(
    () => validateAndCopyFlagshipCardEvidence({
      artifactDir: sourceArtifactDir,
      cardPaths: [sourceCard, duplicate],
      currentGenerationId: generationId,
      expectedCardKinds: ["source", "context"],
      targetArtifactDir,
      probeVideo: async () => ({
        decodable: true,
        duration_seconds: 2.4,
        video: { codec: "h264", width: 1080, height: 1920 },
      }),
    }),
    (error) => {
      assert.ok(error.report.blockers.includes("duplicate_card_path:context"));
      assert.ok(error.report.blockers.includes("duplicate_card_sha256:context"));
      assert.ok(error.report.blockers.includes("duplicate_card_basename:context"));
      return true;
    },
  );
  assert.equal(await fs.pathExists(targetArtifactDir), false);
});

test("reads an approved manifest path but copies no stale sidecar manifests", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-card-manifest-"));
  t.after(() => fs.remove(root));
  const generationId = "generation-current";
  const sourceArtifactDir = path.join(root, "source");
  const targetArtifactDir = path.join(root, "target");
  const card = await makeCard(root, "source", generationId, 2.4);
  const sidecarPath = card.path.replace(/\.mp4$/i, ".shell.json");
  const manifestPath = path.join(sourceArtifactDir, "flagship_card_evidence.json");
  await fs.writeJson(sidecarPath, {
    generation_id: "generation-old",
    stale: true,
  });
  await fs.writeJson(manifestPath, {
    schema_version: 1,
    story_id: "story-manifest-input",
    generation_id: generationId,
    cards: [{
      ...card,
      path: path.relative(sourceArtifactDir, card.path),
    }],
  });

  const report = await validateAndCopyFlagshipCardEvidence({
    artifactDir: sourceArtifactDir,
    cardManifest: manifestPath,
    currentGenerationId: generationId,
    expectedCardKinds: ["source"],
    targetArtifactDir,
    probeVideo: async () => ({
      decodable: true,
      duration_seconds: 2.4,
      video: { codec: "h264", width: 1080, height: 1920 },
    }),
  });

  assert.equal(report.story_id, "story-manifest-input");
  assert.equal(report.source_manifest_path, await fs.realpath(manifestPath));
  const copiedNames = (await fs.readdir(
    path.join(targetArtifactDir, "flagship", "cards"),
  )).sort();
  assert.deepEqual(copiedNames, ["source.mp4"]);
  assert.equal(copiedNames.some((name) => name.endsWith(".json")), false);
});

test("rejects a declared card whose media file is missing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-card-file-missing-"));
  t.after(() => fs.remove(root));
  const generationId = "generation-current";
  const sourceArtifactDir = path.join(root, "source");
  const targetArtifactDir = path.join(root, "target");
  await fs.ensureDir(sourceArtifactDir);

  await assert.rejects(
    () => validateAndCopyFlagshipCardEvidence({
      artifactDir: sourceArtifactDir,
      cardPaths: [{
        card_kind: "source",
        path: "flagship/cards/source.mp4",
        sha256: "a".repeat(64),
        size_bytes: 1024,
        duration_seconds: 2.4,
        generation_id: generationId,
      }],
      currentGenerationId: generationId,
      expectedCardKinds: ["source"],
      targetArtifactDir,
      probeVideo: async () => {
        throw new Error("probe must not run");
      },
    }),
    (error) => {
      assert.ok(error.report.blockers.includes("card_missing_or_unreadable:source"));
      return true;
    },
  );
  assert.equal(await fs.pathExists(targetArtifactDir), false);
});
