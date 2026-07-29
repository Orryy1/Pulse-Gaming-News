"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  discoverBreakingCorroborators,
} = require("../../lib/services/breaking-corroborator-discovery");
const {
  BREAKING_SOURCE_POLICY,
} = require("../../lib/services/breaking-source-policy");

const NOW = "2026-07-28T12:00:00.000Z";

test("discovers a hash-bound unverified candidate from an allowlisted independent outlet", async () => {
  let request = null;
  const result = await discoverBreakingCorroborators({
    story: {
      id: "original-xbox-backcompat",
      title:
        "Original Xbox games could join backwards compatibility",
      subject_ids: ["xbox"],
      url: "https://www.reddit.com/r/GamingLeaksAndRumours/comments/fixture",
    },
    sourcePolicy: BREAKING_SOURCE_POLICY,
    now: NOW,
    searchIndex: {
      identity: {
        id: "fixture-news-index",
        version: "1.0.0",
      },
      async search(input) {
        request = input;
        return {
          results: [
            {
              url: "https://www.ign.com/articles/original-xbox-backcompat",
              source_id: "ign",
              title: "Original Xbox classics may be returning",
              snippet:
                "A search-engine summary that has not been body-verified.",
            },
          ],
        };
      },
    },
  });

  assert.equal(
    request.schema_version,
    "pulse-breaking-corroborator-search-request-v1",
  );
  assert.match(request.query_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.query_sha256, request.query_sha256);
  assert.deepEqual(result.candidate_urls, [
    "https://www.ign.com/articles/original-xbox-backcompat",
  ]);
  assert.equal(result.candidates[0].source_id, "ign");
  assert.equal(
    result.candidates[0].verification_status,
    "UNVERIFIED_CANDIDATE",
  );
  assert.match(
    result.candidates[0].provenance_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    Object.hasOwn(result.candidates[0], "title"),
    false,
  );
  assert.equal(
    Object.hasOwn(result.candidates[0], "snippet"),
    false,
  );
  assert.equal(result.verified_for_planning, false);
  assert.equal(result.publish_authority, false);
  assert.equal(result.database_mutation_authority, false);
  assert.equal(result.oauth_authority, false);
});

test("excludes the discovery outlet and keeps at most one candidate per independent source", async () => {
  const result = await discoverBreakingCorroborators({
    story: {
      id: "ign-origin",
      title: "Xbox announces a fixture update",
      subject_ids: ["xbox"],
      url: "https://www.ign.com/articles/original-report",
    },
    sourcePolicy: BREAKING_SOURCE_POLICY,
    now: NOW,
    searchIndex: {
      identity: {
        id: "fixture-news-index",
        version: "1.0.0",
      },
      async search() {
        return {
          results: [
            {
              url: "https://www.ign.com/articles/original-report",
              source_id: "ign",
            },
            {
              url: "https://uk.ign.com/articles/repeated-report",
              source_id: "ign",
            },
            {
              url: "https://www.eurogamer.net/independent-report",
              source_id: "eurogamer",
            },
            {
              url: "https://www.eurogamer.net/repeated-report",
              source_id: "eurogamer",
            },
          ],
        };
      },
    },
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.source_id),
    ["eurogamer"],
  );
  assert.deepEqual(
    result.rejections.map((rejection) => rejection.reason),
    [
      "origin_source_not_independent",
      "origin_source_not_independent",
      "duplicate_source_not_independent",
    ],
  );
  assert.equal(
    result.rejections.every(
      (rejection) => !Object.hasOwn(rejection, "url"),
    ),
    true,
  );
});

test("rejects SSRF-shaped, unknown and source-spoofed search results", async () => {
  const result = await discoverBreakingCorroborators({
    story: {
      id: "unsafe-index-results",
      title: "Xbox fixture announcement",
      subject_ids: ["xbox"],
    },
    sourcePolicy: BREAKING_SOURCE_POLICY,
    now: NOW,
    searchIndex: {
      identity: {
        id: "fixture-news-index",
        version: "1.0.0",
      },
      async search() {
        return {
          results: [
            { url: "http://www.ign.com/articles/not-https" },
            { url: "https://localhost/internal" },
            { url: "https://127.0.0.1/internal" },
            {
              url: "https://user:password@www.ign.com/articles/secret",
            },
            { url: "https://www.ign.com:444/articles/wrong-port" },
            { url: "https://ign.com.attacker.example/copied" },
            { url: "https://unknown-gaming.example/report" },
            {
              url: "https://www.ign.com/articles/spoofed-source-id",
              source_id: "eurogamer",
            },
          ],
        };
      },
    },
  });

  assert.deepEqual(result.candidate_urls, []);
  assert.deepEqual(
    result.rejections.map((rejection) => rejection.reason),
    [
      "candidate_url_https_required",
      "candidate_url_public_hostname_required",
      "candidate_url_public_hostname_required",
      "candidate_url_credentials_forbidden",
      "candidate_url_nonstandard_port_forbidden",
      "candidate_source_not_allowlisted",
      "candidate_source_not_allowlisted",
      "candidate_claimed_source_id_mismatch",
    ],
  );
  assert.equal(
    result.rejections.every(
      (rejection) =>
        !Object.values(rejection).some((value) =>
          String(value).includes("attacker.example"),
        ),
    ),
    true,
  );
});

test("bounds both the index request and the returned corroborator set", async () => {
  const sourcePolicy = {
    official_first_party: [],
    trusted_editorial: Array.from({ length: 10 }, (_value, index) => ({
      source_id: `outlet-${index + 1}`,
      outlet: `Outlet ${index + 1}`,
      hosts: [`outlet-${index + 1}.example.com`],
    })),
  };
  let requestedLimit = null;
  const result = await discoverBreakingCorroborators({
    story: {
      id: "bounded-results",
      title: "Bounded fixture announcement",
      subject_ids: ["xbox"],
    },
    sourcePolicy,
    now: NOW,
    maxCandidates: 3,
    maxSearchResults: 5,
    searchIndex: {
      identity: {
        id: "fixture-news-index",
        version: "1.0.0",
      },
      async search(request) {
        requestedLimit = request.limit;
        return {
          results: Array.from({ length: 10 }, (_value, index) => ({
            url: `https://outlet-${index + 1}.example.com/report`,
            source_id: `outlet-${index + 1}`,
          })),
        };
      },
    },
  });

  assert.equal(requestedLimit, 5);
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(
    result.rejections.map((rejection) => rejection.reason),
    ["candidate_limit_reached", "candidate_limit_reached"],
  );
  assert.equal(result.search_result_count, 5);
  assert.equal(result.search_response_truncated, true);
});

test("binds the story query and bounded index metadata into reproducible provenance hashes", async () => {
  const capture = async ({ title, snippet }) =>
    discoverBreakingCorroborators({
      story: {
        id: "hash-bound-discovery",
        title,
        subject_ids: ["xbox"],
      },
      sourcePolicy: BREAKING_SOURCE_POLICY,
      now: NOW,
      searchIndex: {
        identity: {
          id: "fixture-news-index",
          version: "1.0.0",
        },
        async search() {
          return {
            results: [
              {
                url: "https://www.eurogamer.net/hash-bound-report",
                source_id: "eurogamer",
                title: "Indexed title",
                snippet,
              },
            ],
          };
        },
      },
    });

  const first = await capture({
    title: "Xbox hash-bound fixture",
    snippet: "Unverified index summary version one",
  });
  const repeated = await capture({
    title: "Xbox hash-bound fixture",
    snippet: "Unverified index summary version one",
  });
  const changedIndexMetadata = await capture({
    title: "Xbox hash-bound fixture",
    snippet: "Unverified index summary version two",
  });
  const changedQuery = await capture({
    title: "Xbox different discovered proposition",
    snippet: "Unverified index summary version one",
  });

  assert.equal(first.query_sha256, repeated.query_sha256);
  assert.equal(
    first.search_response_sha256,
    repeated.search_response_sha256,
  );
  assert.equal(
    first.candidates[0].provenance_sha256,
    repeated.candidates[0].provenance_sha256,
  );
  assert.equal(first.discovery_sha256, repeated.discovery_sha256);
  assert.equal(
    first.query_sha256,
    changedIndexMetadata.query_sha256,
  );
  assert.notEqual(
    first.search_response_sha256,
    changedIndexMetadata.search_response_sha256,
  );
  assert.notEqual(
    first.candidates[0].provenance_sha256,
    changedIndexMetadata.candidates[0].provenance_sha256,
  );
  assert.notEqual(
    first.query_sha256,
    changedQuery.query_sha256,
  );
  assert.match(first.search_response_sha256, /^[a-f0-9]{64}$/);
});

test("never promotes index titles, snippets or claimed flags into confirmation", async () => {
  const result = await discoverBreakingCorroborators({
    story: {
      id: "sensational-index-metadata",
      title: "Xbox fixture rumour",
      subject_ids: ["xbox"],
    },
    sourcePolicy: BREAKING_SOURCE_POLICY,
    now: NOW,
    searchIndex: {
      identity: {
        id: "fixture-news-index",
        version: "1.0.0",
      },
      async search() {
        return {
          verification_status: "CONFIRMED",
          results: [
            {
              url: "https://www.ign.com/articles/metadata-only",
              source_id: "ign",
              title: "CONFIRMED: every Xbox game arrives tomorrow",
              snippet:
                "This untrusted index summary claims official confirmation.",
              verified: true,
              confirmation_status: "CONFIRMED",
              body_evidence: "fabricated index field",
            },
          ],
        };
      },
    },
  });

  assert.equal(result.confirmation_authority, false);
  assert.equal(result.verified_for_planning, false);
  assert.equal(
    result.candidates[0].confirmation_authority,
    false,
  );
  assert.equal(
    result.candidates[0].body_evidence_captured,
    false,
  );
  assert.equal(
    Object.hasOwn(result.candidates[0], "body_evidence"),
    false,
  );
  assert.equal(
    result.safety.titles_and_snippets_are_not_confirmation,
    true,
  );
});

test("requires an explicitly injected index adapter and valid discovery identity before any search", async () => {
  await assert.rejects(
    discoverBreakingCorroborators({
      story: {
        id: "no-implicit-network",
        title: "No implicit search client",
        subject_ids: ["xbox"],
      },
      sourcePolicy: BREAKING_SOURCE_POLICY,
      now: NOW,
    }),
    /search_adapter_required/,
  );

  let searchCalls = 0;
  await assert.rejects(
    discoverBreakingCorroborators({
      story: {
        title: "Missing durable story identity",
        subject_ids: ["xbox"],
      },
      sourcePolicy: BREAKING_SOURCE_POLICY,
      now: NOW,
      searchIndex: {
        identity: {
          id: "fixture-news-index",
          version: "1.0.0",
        },
        async search() {
          searchCalls += 1;
          return { results: [] };
        },
      },
    }),
    /story_identity_required/,
  );
  assert.equal(searchCalls, 0);
});
