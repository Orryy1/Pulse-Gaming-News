"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  RUNTIME_CAPABILITIES_SCHEMA,
  assertRuntimeCapabilityDocument,
  persistWeeklyLongformRuntimeCapabilities,
  probeWeeklyLongformRuntimeCapabilities,
} = require("../../lib/services/weekly-longform-runtime-capability-probe");

test("probe emits only the collector runtime-capability contract", () => {
  const generatedAt = "2026-07-28T12:00:00.000Z";
  const document = probeWeeklyLongformRuntimeCapabilities({
    env: {
      ELEVENLABS_API_KEY: "must-never-appear",
      ELEVENLABS_VOICE_ID: "must-never-appear",
    },
    generatedAt,
    buildRuntimeStack() {
      return {
        capabilities: {
          ready: true,
          blockers: [],
          private_path: "C:/secret/runtime",
        },
        runtime_capabilities: {
          ready: true,
          blockers: [],
          api_key: "must-never-appear",
          dependencies: Object.fromEntries(
            [
              "produceNarration",
              "materializeAlignment",
              "renderLongform",
              "materializeVariants",
              "runDecodedQa",
              "materializeDerivatives",
            ].map((dependency) => [
              dependency,
              {
                available: true,
                resolution: "must-not-be-exported",
              },
            ]),
          ),
          safety: {
            implicit_network_enabled: false,
            implicit_process_spawn_enabled: false,
            upload_authority: false,
            oauth_mutation_authority: false,
            database_mutation_authority: false,
          },
        },
        renderer_capabilities: {
          ready: true,
          sha256: "a".repeat(64),
        },
      };
    },
  });

  assert.deepEqual(document, {
    schema_version: RUNTIME_CAPABILITIES_SCHEMA,
    generated_at: generatedAt,
    ready: true,
    blockers: [],
    dependencies: {
      produceNarration: { available: true },
      materializeAlignment: { available: true },
      renderLongform: { available: true },
      materializeVariants: { available: true },
      runDecodedQa: { available: true },
      materializeDerivatives: { available: true },
    },
    safety: {
      implicit_network_enabled: false,
      implicit_process_spawn_enabled: false,
      upload_authority: false,
      oauth_mutation_authority: false,
      database_mutation_authority: false,
    },
  });
  assert.doesNotMatch(JSON.stringify(document), /must-never-appear|sha256/i);
});

test("probe cannot declare READY when the renderer or full runtime stack is blocked", () => {
  const document = probeWeeklyLongformRuntimeCapabilities({
    generatedAt: "2026-07-28T12:00:00.000Z",
    buildRuntimeStack() {
      return {
        capabilities: {
          ready: false,
          blockers: ["hyperframes_cli_unavailable"],
        },
        runtime_capabilities: {
          ready: true,
          blockers: [],
          dependencies: Object.fromEntries(
            [
              "produceNarration",
              "materializeAlignment",
              "renderLongform",
              "materializeVariants",
              "runDecodedQa",
              "materializeDerivatives",
            ].map((dependency) => [
              dependency,
              { available: true },
            ]),
          ),
          safety: {
            implicit_network_enabled: false,
            implicit_process_spawn_enabled: false,
            upload_authority: false,
            oauth_mutation_authority: false,
            database_mutation_authority: false,
          },
        },
        renderer_capabilities: {
          ready: false,
          blockers: ["hyperframes_cli_unavailable"],
        },
      };
    },
  });

  assert.equal(document.ready, false);
  assert.equal(document.dependencies.renderLongform.available, false);
  assert.deepEqual(document.blockers, [
    "hyperframes_cli_unavailable",
    "weekly_longform_runtime_dependency_unavailable:renderLongform",
  ]);
});

test("capability artefacts are immutable and contain no source secrets", (t) => {
  const outputDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-longform-capability-"),
  );
  t.after(() =>
    fs.rmSync(outputDirectory, { recursive: true, force: true }),
  );
  const document = probeWeeklyLongformRuntimeCapabilities({
    env: {
      ELEVENLABS_API_KEY: "must-never-be-written",
      ELEVENLABS_VOICE_ID: "must-never-be-written",
    },
    generatedAt: "2026-07-28T12:00:00.000Z",
    buildRuntimeStack() {
      return {
        capabilities: {
          ready: false,
          blockers: ["elevenlabs_api_key_unavailable"],
        },
        runtime_capabilities: {
          dependencies: {},
          safety: {
            implicit_network_enabled: false,
            implicit_process_spawn_enabled: false,
            upload_authority: false,
            oauth_mutation_authority: false,
            database_mutation_authority: false,
          },
        },
        renderer_capabilities: { ready: true },
      };
    },
  });

  const first = persistWeeklyLongformRuntimeCapabilities({
    document,
    outputDirectory,
  });
  const second = persistWeeklyLongformRuntimeCapabilities({
    document,
    outputDirectory,
  });
  const json = fs.readFileSync(first.json_path, "utf8");
  const markdown = fs.readFileSync(first.markdown_path, "utf8");

  assert.equal(first.json_written, true);
  assert.equal(first.markdown_written, true);
  assert.equal(second.json_written, false);
  assert.equal(second.markdown_written, false);
  assert.deepEqual(JSON.parse(json), document);
  assert.doesNotMatch(
    `${json}\n${markdown}`,
    /must-never-be-written|refresh_token\s*[:=]/i,
  );
  assert.throws(
    () =>
      persistWeeklyLongformRuntimeCapabilities({
        document: {
          ...document,
          generated_at: "2026-07-28T12:01:00.000Z",
        },
        outputDirectory,
      }),
    /weekly_longform_runtime_capability_immutable_conflict/,
  );
});

test("closed capability contract rejects secret-shaped or extra keys", () => {
  const safe = probeWeeklyLongformRuntimeCapabilities({
    generatedAt: "2026-07-28T12:00:00.000Z",
    buildRuntimeStack() {
      return {
        capabilities: { ready: false, blockers: [] },
        runtime_capabilities: {
          dependencies: {},
          safety: {
            implicit_network_enabled: false,
            implicit_process_spawn_enabled: false,
            upload_authority: false,
            oauth_mutation_authority: false,
            database_mutation_authority: false,
          },
        },
        renderer_capabilities: { ready: false },
      };
    },
  });

  assert.throws(
    () =>
      assertRuntimeCapabilityDocument({
        ...safe,
        api_key: "forbidden",
      }),
    /runtime_capability_secret_shaped_key_forbidden:\$\.api_key/,
  );
  assert.throws(
    () =>
      assertRuntimeCapabilityDocument({
        ...safe,
        dependencies: {
          ...safe.dependencies,
          produceNarration: {
            available: false,
            resolution: "not allowlisted",
          },
        },
      }),
    /runtime_capability_document_dependency_invalid:produceNarration/,
  );
});
