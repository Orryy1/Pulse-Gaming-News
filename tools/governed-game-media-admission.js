#!/usr/bin/env node
"use strict";

const {
  GovernedGameMediaAdmissionError,
  validateGovernedGameMediaAdmission,
} = require("../lib/services/governed-game-media-admission");

function parseArgs(argv) {
  const values = {
    destinations: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      values.help = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`missing_value:${token}`);
    }
    index += 1;
    if (token === "--manifest") values.manifestPath = next;
    else if (token === "--sha256") values.manifestSha256 = next;
    else if (token === "--story") values.storyId = next;
    else if (token === "--boundary") values.validationBoundaryAt = next;
    else if (token === "--destination") {
      values.destinations.push(next);
    } else {
      throw new Error(`unknown_argument:${token}`);
    }
  }
  return values;
}

function help() {
  return [
    "Governed game-media admission (read-only)",
    "",
    "Usage:",
    "  node tools/governed-game-media-admission.js \\",
    "    --manifest <game-media-admission.json> \\",
    "    --sha256 <manifest-sha256> \\",
    "    --story <story-id> \\",
    "    --boundary <ISO-8601> \\",
    "    --destination YOUTUBE_SHORTS",
    "",
    "This command validates existing local evidence only. It does not acquire",
    "media, write the database, mutate OAuth or create platform objects.",
  ].join("\n");
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    output({
      verdict: "HOLD",
      blockers: [error.message],
    });
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  const missing = [
    ["manifest", args.manifestPath],
    ["sha256", args.manifestSha256],
    ["story", args.storyId],
    ["boundary", args.validationBoundaryAt],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => `required_argument_missing:${name}`);
  if (!args.destinations.length) {
    missing.push("required_argument_missing:destination");
  }
  if (missing.length) {
    output({
      verdict: "HOLD",
      blockers: missing,
    });
    process.exitCode = 2;
    return;
  }
  try {
    const admission = validateGovernedGameMediaAdmission({
      manifestPath: args.manifestPath,
      expectedManifestSha256: args.manifestSha256,
      expectedStoryId: args.storyId,
      requiredDestinations: args.destinations,
      validationBoundaryAt: args.validationBoundaryAt,
    });
    output({
      verdict: "GREEN",
      policy: admission.policy,
      story_id: admission.story_id,
      manifest_sha256: admission.manifest_sha256,
      required_destinations: admission.required_destinations,
      required_attributions: admission.required_attributions,
      assets: admission.assets.map((asset) => ({
        asset_id: asset.asset_id,
        game: asset.game,
        media_type: asset.media_type,
        media_kind: asset.media_kind,
        editorial_role: asset.editorial_role,
        rights_basis: asset.rights_basis,
        permission_review_status:
          asset.permission.review_status,
        operator_risk_decision:
          asset.permission.risk_decision,
        source_url: asset.source.page_url || null,
        direct_media_url: asset.source.direct_media_url || null,
        transformation: asset.transformation,
        binding: asset.binding,
      })),
      publish_authorised: false,
      safety: {
        acquisition_performed: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        platform_objects_created: false,
        live_publish_attempted: false,
        network_used: false,
      },
    });
  } catch (error) {
    if (!(error instanceof GovernedGameMediaAdmissionError)) {
      throw error;
    }
    output({
      verdict: "HOLD",
      policy: "GOVERNED_GAME_MEDIA_V1",
      story_id: args.storyId,
      blockers: error.codes,
      publish_authorised: false,
      safety: {
        acquisition_performed: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        platform_objects_created: false,
        live_publish_attempted: false,
        network_used: false,
      },
    });
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  help,
  main,
  parseArgs,
};
