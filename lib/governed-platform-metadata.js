"use strict";

const TEXT_FIELDS = [
  "description",
  "caption",
  "page_caption",
  "cover_headline",
  "landing_page_slug",
];

const GOVERNED_FIELDS = [
  "disclosure_requirements",
  "disclosure_requirements_resolved",
  "disclosures",
  "disclosure_status",
  "commercial_promotion",
  "affiliate_links_allowed",
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function governedPlatformMetadata(action = {}) {
  const metadata = {};
  for (const field of TEXT_FIELDS) {
    if (
      Object.prototype.hasOwnProperty.call(action, field) &&
      typeof action[field] !== "undefined"
    ) {
      metadata[field] = clean(action[field]);
    }
  }
  for (const field of GOVERNED_FIELDS) {
    if (
      Object.prototype.hasOwnProperty.call(action, field) &&
      typeof action[field] !== "undefined"
    ) {
      metadata[field] = action[field];
    }
  }
  return metadata;
}

module.exports = {
  governedPlatformMetadata,
};
