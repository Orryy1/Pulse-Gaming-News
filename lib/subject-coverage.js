"use strict";

const { normaliseText } = require("./text-hygiene");

function array(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(items) {
  return [...new Set(array(items).map((item) => normaliseText(item).trim()).filter(Boolean))];
}

function coverageKey(value) {
  return normaliseText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&amp;/gi, "and")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function labelCoversGroup(label, group) {
  const labelKey = coverageKey(label);
  const groupKey = coverageKey(group);
  if (!labelKey || !groupKey) return false;
  return labelKey === groupKey || ` ${labelKey} `.includes(` ${groupKey} `);
}

function labelsCoverGroup(labels = [], group) {
  return array(labels).some((label) => labelCoversGroup(label, group));
}

function coverageForGroups(groups = [], labels = []) {
  const uniqueGroups = uniqueStrings(groups);
  const uniqueLabels = uniqueStrings(labels);
  const coveredGroups = uniqueGroups.filter((group) => labelsCoverGroup(uniqueLabels, group));
  const missingGroups = uniqueGroups.filter((group) => !labelsCoverGroup(uniqueLabels, group));
  return {
    labels: uniqueLabels,
    coveredGroups,
    missingGroups,
  };
}

function assetCoverageLabels(asset = {}) {
  return uniqueStrings([
    asset.exact_subject_group,
    asset.entity,
    asset.game,
    asset.game_title,
    asset.app_title,
    asset.store_app_title,
    asset.steam_app_title,
    asset.igdb_title,
    asset.store_matched_query,
    asset.steam_matched_query,
    asset.matched_query,
    asset.provenance?.store_app_title,
    asset.provenance?.storeAppTitle,
    asset.provenance?.store_matched_query,
    asset.provenance?.matched_query,
  ]);
}

function segmentCoverageLabels(segment = {}) {
  return uniqueStrings([
    segment.entity,
    segment.exact_subject_group,
    segment.store_app_title,
    segment.storeAppTitle,
    segment.game_title,
    segment.gameTitle,
    segment.app_title,
    segment.appTitle,
    segment.store_matched_query,
    segment.storeMatchedQuery,
    segment.reference_title,
    segment.referenceTitle,
    segment.movie_name,
    segment.movieName,
    segment.title,
    segment.provenance?.store_app_title,
    segment.provenance?.storeAppTitle,
    segment.provenance?.store_matched_query,
    segment.provenance?.matched_query,
    segment.provenance?.reference_title,
    segment.provenance?.referenceTitle,
  ]);
}

function frameCoverageLabels(frame = {}) {
  return uniqueStrings([
    frame.entity,
    frame.exact_subject_group,
    frame.store_app_title,
    frame.storeAppTitle,
    frame.game_title,
    frame.gameTitle,
    frame.app_title,
    frame.appTitle,
    frame.store_matched_query,
    frame.storeMatchedQuery,
    frame.reference_title,
    frame.referenceTitle,
    frame.movie_name,
    frame.movieName,
    frame.title,
    frame.provenance?.store_app_title,
    frame.provenance?.storeAppTitle,
    frame.provenance?.store_matched_query,
    frame.provenance?.matched_query,
    frame.provenance?.reference_title,
    frame.provenance?.referenceTitle,
  ]);
}

module.exports = {
  assetCoverageLabels,
  coverageForGroups,
  coverageKey,
  frameCoverageLabels,
  labelCoversGroup,
  labelsCoverGroup,
  segmentCoverageLabels,
};
