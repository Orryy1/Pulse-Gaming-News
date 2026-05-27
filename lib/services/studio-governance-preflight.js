"use strict";

const {
  buildStudioGovernanceReport,
} = require("../studio-governance-engine");

class StudioGovernancePreflightError extends Error {
  constructor(report = {}) {
    const reasonCodes = report.rejection_reasons?.reason_codes || ["studio_governance_failed"];
    super(`studio_governance_blocked:${reasonCodes.join(",")}`);
    this.name = "StudioGovernancePreflightError";
    this.code = "studio_governance_blocked";
    this.failures = reasonCodes;
    this.warnings = report.rejection_reasons?.warnings || [];
    this.report = report;
  }
}

async function runStudioGovernancePreflight(story = {}, options = {}) {
  const report = buildStudioGovernanceReport({
    story,
    rightsLedger: options.rightsLedger,
    commercialManifest: options.commercialManifest,
    recentVideos: options.recentVideos || options.recentStories || [],
    recentStories: options.recentStories || [],
    platforms: options.platforms,
    generatedAt: options.generatedAt || new Date().toISOString(),
    captionFileExists: options.captionFileExists,
    captionPath: options.captionPath,
  });

  return {
    result:
      report.publish_manifest.publish_status === "GREEN"
        ? "pass"
        : report.publish_manifest.publish_status === "AMBER"
          ? "warn"
          : "fail",
    failures: report.rejection_reasons.reason_codes || [],
    warnings: report.rejection_reasons.warnings || [],
    publish_status: report.publish_manifest.publish_status,
    report,
  };
}

async function assertStudioGovernancePreflight(story = {}, options = {}) {
  const gate = await runStudioGovernancePreflight(story, options);
  if (gate.result !== "pass") {
    throw new StudioGovernancePreflightError(gate.report);
  }
  return gate.report;
}

module.exports = {
  StudioGovernancePreflightError,
  assertStudioGovernancePreflight,
  runStudioGovernancePreflight,
};
