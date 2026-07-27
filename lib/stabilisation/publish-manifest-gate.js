"use strict";

const {
  validateBrandEditorialPackage,
} = require("./brand-content-contract");
const {
  validateOriginalityAndDisclosure,
} = require("./originality-disclosure-contract");
const {
  validateMediaProductionManifest,
} = require("./media-production-contract");

function evaluateStabilisationPublishManifest(story = {}) {
  const editorial = validateBrandEditorialPackage(
    story.editorial_manifest || story,
  );
  const originality = validateOriginalityAndDisclosure(
    story.originality_disclosure_manifest || story,
  );
  const media = validateMediaProductionManifest(
    story.media_production_manifest || story,
  );
  const failures = [
    ...(editorial.blockers || []),
    ...(originality.blockers || []),
    ...(media.blockers || []),
  ];

  return {
    contract_version: "pulse-stabilisation-publish-manifest-v1",
    pass: failures.length === 0,
    failures: [...new Set(failures)],
    editorial,
    originality,
    media,
  };
}

module.exports = {
  evaluateStabilisationPublishManifest,
};
