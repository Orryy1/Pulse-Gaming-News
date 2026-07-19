#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  readPublishedPlatformEvidence,
  readStoryPackages,
} = require("./goal-dry-run-publish");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PLATFORMS = Object.freeze([
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
]);

function cleanList(value) {
  return [
    ...new Set(
      String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: ROOT,
    storyPackagesPath: "",
    dbPath: "",
    platforms: [...DEFAULT_PLATFORMS],
    outPath: path.join("output", "goal-contract", "publication_evidence_snapshot.json"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = argv[++index] || args.root;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || "";
    else if (arg === "--db") args.dbPath = argv[++index] || "";
    else if (arg === "--platforms") args.platforms = cleanList(argv[++index]);
    else if (arg === "--out") args.outPath = argv[++index] || args.outPath;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help && !args.storyPackagesPath) {
    throw new Error("--story-packages is required");
  }
  if (!args.help && !args.dbPath) {
    throw new Error("--db is required");
  }
  if (!args.help && !args.platforms.length) {
    throw new Error("--platforms requires at least one platform");
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/publication-evidence-snapshot.js --story-packages <path> --db <path> [options]",
    "",
    "Creates a local publication-evidence snapshot from SQLite opened in read-only mode.",
    "It does not load credentials, publish, call a network service or mutate SQLite.",
    "",
    "Options:",
    "  --root <dir>",
    "  --story-packages <path>",
    "  --db <path>",
    "  --platforms <csv>  Default: youtube_shorts,instagram_reels,facebook_reels",
    "  --out <path>",
    "  --generated-at <iso>",
    "  --json",
  ].join("\n");
}

function storyIdsFromPackages(storyPackages = []) {
  return [
    ...new Set(
      storyPackages
        .map((story) => String(story?.story_id || story?.id || "").trim())
        .filter(Boolean),
    ),
  ];
}

function filterEvidenceIndex(index = {}, allowedPlatforms = new Set()) {
  return Object.fromEntries(
    Object.entries(index || {}).map(([identity, entry]) => {
      const rows = (Array.isArray(entry?.rows) ? entry.rows : [])
        .filter((row) => allowedPlatforms.has(String(row?.platform || "").trim()));
      return [identity, {
        ...entry,
        already_published_platforms: [
          ...new Set(
            (Array.isArray(entry?.already_published_platforms)
              ? entry.already_published_platforms
              : [])
              .map((platform) => String(platform || "").trim())
              .filter((platform) => allowedPlatforms.has(platform)),
          ),
        ],
        rows,
      }];
    }),
  );
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { help: true };
  }
  const root = path.resolve(args.root);
  const dbPath = path.resolve(root, args.dbPath);
  if (!(await fs.pathExists(dbPath))) {
    throw new Error(`SQLite database not found: ${dbPath}`);
  }
  const storyPackages = await readStoryPackages(root, args.storyPackagesPath);
  const storyIds = storyIdsFromPackages(storyPackages);
  if (!storyIds.length) {
    throw new Error("story package file contains no story identities");
  }
  const evidence = await readPublishedPlatformEvidence(
    root,
    storyPackages,
    null,
    { dbPath },
  );
  if (!evidence) {
    throw new Error("read-only SQLite publication evidence unavailable");
  }
  const allowedPlatforms = new Set(args.platforms);
  const byStoryId = filterEvidenceIndex(evidence.by_story_id, allowedPlatforms);
  for (const storyId of storyIds) {
    if (!byStoryId[storyId]) {
      byStoryId[storyId] = {
        story_id: storyId,
        already_published_platforms: [],
        rows: [],
      };
    }
  }
  const generatedAt = args.generatedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("--generated-at must be an ISO timestamp");
  }
  const snapshot = {
    schema_version: 1,
    generated_at: generatedAt,
    source: "read_only_local_sqlite_publication_evidence_snapshot",
    scope: {
      story_ids: storyIds,
      platforms: args.platforms,
    },
    by_story_id: byStoryId,
    by_source_url_hash: filterEvidenceIndex(
      evidence.by_source_url_hash,
      allowedPlatforms,
    ),
    by_topic_key: filterEvidenceIndex(evidence.by_topic_key, allowedPlatforms),
    safety: {
      mode: "READ_ONLY_LOCAL_PROOF",
      sqlite_read_only: true,
      production_db_mutation: false,
      publish_triggered: false,
      network_write_attempted: false,
      oauth_or_token_change: false,
      credential_read: false,
    },
  };
  const outPath = path.resolve(root, args.outPath);
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeJson(outPath, snapshot, { spaces: 2 });
  if (args.json) stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  else {
    stdout.write(
      `Publication evidence snapshot: ${storyIds.length} stories, ${args.platforms.length} platforms\n`,
    );
    stdout.write(`Output: ${outPath}\n`);
    stdout.write("Safety: SQLite read-only; no publish, network write or credential access.\n");
  }
  return { snapshot, outPath };
}

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`[publication-evidence-snapshot] ${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_PLATFORMS,
  main,
  parseArgs,
};
