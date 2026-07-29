"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  STALE_REPORT_BANNER,
  assessReportAuthority,
  createReportMetadata,
  decorateMarkdownReport,
  validateReportMetadata,
} = require("../../lib/stabilisation/report-governance");

const SOURCE_SHA = "85b95b822aaffdadb9f103a1646c0084a19e5790";
const RUNTIME_SHA = "ec2ba4d98d3ee55f8c8999952cde5b378168e0c1";

test("authoritative report metadata remains usable only before its expiry", () => {
  const metadata = createReportMetadata({
    generatedAt: "2026-07-26T20:30:00.000Z",
    sourceCommitSha: SOURCE_SHA,
    runtimeCommitSha: RUNTIME_SHA,
    environment: "production-observation",
    scope: "runtime provenance",
    expiresAt: "2026-07-27T20:30:00.000Z",
    authoritative: true,
  });

  assert.deepEqual(validateReportMetadata(metadata).errors, []);
  assert.deepEqual(
    assessReportAuthority(metadata, {
      at: "2026-07-26T21:00:00.000Z",
    }),
    {
      authoritative: true,
      stale: false,
      reasons: [],
      banner: null,
    },
  );

  assert.deepEqual(
    assessReportAuthority(metadata, {
      at: "2026-07-28T00:00:00.000Z",
    }),
    {
      authoritative: false,
      stale: true,
      reasons: ["expired"],
      banner: STALE_REPORT_BANNER,
    },
  );
});

test("missing provenance or a superseding report prevents authority", () => {
  const invalid = {
    generated_at: "2026-07-26T20:30:00.000Z",
    source_commit_sha: null,
    runtime_commit_sha: null,
    environment: "unknown",
    scope: "",
    expires_at: "not-a-date",
    supersedes: [],
    superseded_by: ["docs/stabilisation/newer.json"],
    authoritative: true,
  };

  const validation = validateReportMetadata(invalid);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /source_commit_sha/);
  assert.match(validation.errors.join("\n"), /runtime_commit_sha/);
  assert.match(validation.errors.join("\n"), /scope/);
  assert.match(validation.errors.join("\n"), /expires_at/);

  const authority = assessReportAuthority(invalid, {
    at: "2026-07-26T21:00:00.000Z",
  });
  assert.equal(authority.authoritative, false);
  assert.equal(authority.stale, true);
  assert.ok(authority.reasons.includes("invalid_metadata"));
  assert.ok(authority.reasons.includes("superseded"));
  assert.equal(authority.banner, STALE_REPORT_BANNER);
});

test("a current proposal is non-authoritative without being labelled stale history", () => {
  const metadata = createReportMetadata({
    generatedAt: "2026-07-26T20:30:00.000Z",
    sourceCommitSha: SOURCE_SHA,
    runtimeCommitSha: RUNTIME_SHA,
    environment: "local-read-only",
    scope: "proposed release plan",
    expiresAt: "2026-08-02T20:30:00.000Z",
    authoritative: false,
  });

  assert.deepEqual(
    assessReportAuthority(metadata, {
      at: "2026-07-26T21:00:00.000Z",
    }),
    {
      authoritative: false,
      stale: false,
      reasons: ["declared_non_authoritative"],
      banner: null,
    },
  );
});

test("markdown reports expose complete provenance and the exact stale warning", () => {
  const metadata = createReportMetadata({
    generatedAt: "2026-07-25T00:00:00.000Z",
    sourceCommitSha: SOURCE_SHA,
    runtimeCommitSha: RUNTIME_SHA,
    environment: "local-read-only",
    scope: "forensic report",
    expiresAt: "2026-07-26T00:00:00.000Z",
    supersedes: ["docs/archive/2026-07/old-report.json"],
    authoritative: true,
  });

  const markdown = decorateMarkdownReport({
    title: "Forensic Report",
    metadata,
    body: "Observed facts only.",
    at: "2026-07-27T00:00:00.000Z",
  });

  assert.match(markdown, /^# Forensic Report/m);
  assert.match(markdown, new RegExp(STALE_REPORT_BANNER));
  for (const key of [
    "generated_at",
    "source_commit_sha",
    "runtime_commit_sha",
    "environment",
    "scope",
    "expires_at",
    "supersedes",
    "superseded_by",
    "authoritative",
  ]) {
    assert.match(markdown, new RegExp(`\\| ${key} \\|`));
  }
});
