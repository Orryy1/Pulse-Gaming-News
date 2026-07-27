"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ATTRIBUTION_TEXT,
  CANONICAL_LICENCE_URL,
  EDITORIAL_PURPOSE,
  LICENCE_EFFECTIVE_DATE,
  MANIFEST_SCHEMA,
  PUBLISHER,
} = require("../../lib/services/governed-source-media");

const SOURCE_URL =
  "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947";
const STORY_ID = "official_ff567afb1a07";
const SCRIPT =
  "Delta Force just widened cheater compensation to cover thirty-day bans. Previously, victims qualified only after a ten-year ban. The official update says in-game mail should arrive within three business days of confirmation. But if a squadmate extracted and returned your gear, you cannot claim twice.";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

function relativeFrom(filePath, targetPath) {
  return path.relative(path.dirname(filePath), targetPath);
}

function createGovernedHybridStoryIntakeFixture({
  mutateAssetManifest,
  mutateSourceMediaManifest,
} = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-hybrid-intake-"),
  );
  const sourceEvidencePath = path.join(root, "source-evidence.json");
  const storyIntakePath = path.join(root, "story-intake.json");
  const sourceMediaPath = path.join(
    root,
    "source-media",
    "source-media-manifest.json",
  );
  const rightsReviewPath = path.join(
    root,
    "source-media",
    "evidence",
    "rights-review.json",
  );
  const sourceImagePath = path.join(
    root,
    "source-media",
    "assets",
    "official-image.png",
  );
  const combinedManifestPath = path.join(
    root,
    "combined",
    "combined-owned-motion-manifest.json",
  );
  const backbonePath = path.join(
    root,
    "combined",
    "owned-backbone.mp4",
  );
  const hybridPath = path.join(root, "combined", "hybrid.mp4");

  fs.mkdirSync(path.dirname(sourceImagePath), { recursive: true });
  fs.mkdirSync(path.dirname(combinedManifestPath), { recursive: true });
  fs.writeFileSync(sourceImagePath, ONE_PIXEL_PNG);
  fs.writeFileSync(backbonePath, "owned-backbone");
  fs.writeFileSync(hybridPath, "governed-hybrid");

  const rightsReviewSha256 = writeJson(rightsReviewPath, {
    schema_version: "pulse-governed-rights-review-evidence-v1",
    story_id: STORY_ID,
    review_status: "ACCEPTED",
    rights_basis: "LICENSED",
    publisher: PUBLISHER,
    licence_evidence_url: CANONICAL_LICENCE_URL,
    licence_effective_date: LICENCE_EFFECTIVE_DATE,
    reviewed_by: "pulse-editorial-rights-review",
    reviewed_at: "2026-07-27T11:59:00.000Z",
    scope:
      "Official FINAL FANTASY XIV image used in a narrated and materially edited news report.",
    findings: {
      covered_materials: ["art", "video", "screenshots", "images"],
      permitted_destination:
        "YouTube and comparable social-network partner programmes",
      copyright_notice: ATTRIBUTION_TEXT,
      copyright_notice_delivery: ["ON_SCREEN", "DESCRIPTION"],
      third_party_music_used: false,
      source_audio_used: false,
      raw_asset_redistribution: false,
      removal_request_must_be_honoured: true,
    },
  });

  const sourceMediaManifest = {
    schema_version: MANIFEST_SCHEMA,
    story_id: STORY_ID,
    generated_at: "2026-07-27T12:00:00.000Z",
    composition_duration_seconds: 28,
    rights_review: {
      path: relativeFrom(sourceMediaPath, rightsReviewPath),
      sha256: rightsReviewSha256,
      review_status: "ACCEPTED",
    },
    components: [
      {
        component_id: "official-image-01",
        media_type: "IMAGE",
        asset: {
          path: relativeFrom(sourceMediaPath, sourceImagePath),
          sha256: sha256(ONE_PIXEL_PNG),
          width: 1,
          height: 1,
        },
        source: {
          page_url: "https://eu.finalfantasyxiv.com/evercold/media/",
          direct_media_url:
            "https://lds-img.finalfantasyxiv.com/promo/h/i/official-image.png",
          publisher: PUBLISHER,
        },
        rights_basis: "LICENSED",
        licence_evidence_url: CANONICAL_LICENCE_URL,
        review_status: "ACCEPTED",
        attribution: {
          required: true,
          text: ATTRIBUTION_TEXT,
          delivery: ["ON_SCREEN", "DESCRIPTION"],
        },
        editorial: {
          purpose: EDITORIAL_PURPOSE,
          third_party_music_used: false,
          source_audio_disposition: "NOT_APPLICABLE",
          usage_seconds: [0, 3.6],
          treatment:
            "portrait crop, depth push and a materially edited proof card",
        },
      },
    ],
  };
  if (mutateSourceMediaManifest) {
    mutateSourceMediaManifest(sourceMediaManifest);
  }
  const sourceMediaSha256 = writeJson(
    sourceMediaPath,
    sourceMediaManifest,
  );

  const claims = [
    "Thirty-day bans now qualify victims for compensation.",
    "Compensation mail should arrive within three business days.",
  ];
  const sourceEvidenceSha256 = writeJson(sourceEvidencePath, {
    schema_version: "pulse-source-evidence-v1",
    source_url: SOURCE_URL,
    source_type: "official",
    published_at: "2026-07-27T09:15:34.000Z",
    claims,
    official_media: {
      media_page_url: "https://eu.finalfantasyxiv.com/evercold/media/",
      licence_url: CANONICAL_LICENCE_URL,
      licence_effective_date: LICENCE_EFFECTIVE_DATE,
      rights_basis: "LICENSED",
      publisher: PUBLISHER,
      required_copyright_notice: ATTRIBUTION_TEXT,
      source_media_manifest_path: relativeFrom(
        sourceEvidencePath,
        sourceMediaPath,
      ),
    },
  });

  writeJson(storyIntakePath, {
    schema_version: "pulse-governed-story-intake-v1",
    source_url: SOURCE_URL,
    source_type: "official",
    source_evidence_path: relativeFrom(
      storyIntakePath,
      sourceEvidencePath,
    ),
    source_evidence_sha256: sourceEvidenceSha256,
    published_at: "2026-07-27T09:15:34.000Z",
    claims,
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
    },
    story: {
      id: STORY_ID,
      title: "Delta Force widens cheater compensation",
      hook: "Delta Force just widened cheater compensation.",
      full_script: SCRIPT,
      script_sha256: sha256(SCRIPT),
      visual_brief: {
        format: "hybrid-official-media-and-owned-motion",
        source_media_policy: "LICENSED_OFFICIAL_FFXIV",
        source_media_manifest_path: relativeFrom(
          storyIntakePath,
          sourceMediaPath,
        ),
        attribution: {
          required: true,
          text: ATTRIBUTION_TEXT,
          delivery: ["ON_SCREEN", "DESCRIPTION"],
        },
      },
    },
  });

  const sourceMediaBinding = {
    path: relativeFrom(combinedManifestPath, sourceMediaPath),
    sha256: sourceMediaSha256,
  };
  const combinedManifest = {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: STORY_ID,
    assets: [
      {
        path: relativeFrom(combinedManifestPath, backbonePath),
        sha256: sha256(fs.readFileSync(backbonePath)),
        media_type: "video",
        role: "owned_motion_backbone",
        ownership: "owned",
        rights_basis: "OWNED",
        attribution_required: false,
      },
      {
        path: relativeFrom(combinedManifestPath, hybridPath),
        sha256: sha256(fs.readFileSync(hybridPath)),
        media_type: "video",
        role: "hyperframes_intermediate",
        ownership: "mixed",
        generator_identity: "hyperframes@0.7.76",
        rights_basis: "LICENSED",
        attribution_required: true,
        provenance: {
          source: "hyperframes_material_stage",
          third_party_media_used: true,
          source_backbone: {
            path: relativeFrom(combinedManifestPath, backbonePath),
            sha256: sha256(fs.readFileSync(backbonePath)),
          },
          source_media_manifest: sourceMediaBinding,
          source_media_components: [
            {
              component_id: "official-image-01",
              media_type: "IMAGE",
              path: relativeFrom(combinedManifestPath, sourceImagePath),
              sha256: sha256(ONE_PIXEL_PNG),
            },
          ],
        },
      },
    ],
    combination: {
      third_party_media_used: true,
      source_media_policy: "LICENSED_OFFICIAL_FFXIV",
      source_media_manifest: sourceMediaBinding,
    },
  };
  if (mutateAssetManifest) mutateAssetManifest(combinedManifest);
  const assetManifestSha256 = writeJson(
    combinedManifestPath,
    combinedManifest,
  );

  return {
    assetManifestPath: combinedManifestPath,
    assetManifestSha256,
    root,
    sourceMediaPath,
    sourceMediaSha256,
    storyId: STORY_ID,
    storyIntakePath,
  };
}

module.exports = {
  SCRIPT,
  SOURCE_URL,
  STORY_ID,
  createGovernedHybridStoryIntakeFixture,
  sha256,
  writeJson,
};
