"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  buildFailedBreakingSourceEvidencePacket,
  captureBreakingSourceEvidence,
  validateBreakingSourceEvidencePacket,
} = require("../../lib/services/breaking-source-evidence");

const NOW = "2026-07-28T12:00:00.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sourcePolicy() {
  return {
    official_first_party: [
      {
        source_id: "xbox-wire",
        owner: "Microsoft Gaming",
        hosts: ["news.xbox.com"],
        subject_ids: ["xbox"],
      },
    ],
    trusted_editorial: [
      {
        source_id: "ign",
        outlet: "IGN",
        hosts: ["ign.com"],
      },
      {
        source_id: "eurogamer",
        outlet: "Eurogamer",
        hosts: ["eurogamer.net"],
      },
    ],
  };
}

test("official first-party body evidence produces a byte-addressed confirmation packet", async () => {
  const claimText =
    "Microsoft will add original Xbox games to backwards compatibility.";
  const bytes = Buffer.from(
    `<article>${claimText}</article>`,
    "utf8",
  );
  const url =
    "https://news.xbox.com/en-us/2026/07/28/back-compat-update/";

  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "xbox-backcompat",
      title: "Original Xbox games are coming back",
      subject_ids: ["xbox"],
      source_candidates: [url],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async ({ redirect, max_bytes: maxBytes }) => {
      assert.equal(redirect, "manual");
      assert.ok(maxBytes >= bytes.length);
      return {
        status: 200,
        final_url: url,
        content_type: "text/html; charset=utf-8",
        bytes,
      };
    },
    extractClaims: async ({ story: extractionStory }) => {
      assert.deepEqual(extractionStory, {
        id: "xbox-backcompat",
        subject_ids: ["xbox"],
      });
      assert.equal(
        Object.hasOwn(extractionStory, "title"),
        false,
      );
      return {
        extractor: { id: "fixture-html", version: "1.0.0" },
        claims: [
          {
            claim_key: "xbox.original-backcompat.expansion",
            text: claimText,
            location: "body",
          },
        ],
      };
    },
  });

  assert.equal(packet.verdict, "OFFICIAL_CONFIRMED");
  assert.equal(packet.verification_status, "CONFIRMED");
  assert.equal(packet.confirmation_basis, "official_first_party");
  assert.equal(packet.verified_for_planning, true);
  assert.equal(packet.publish_authority, false);
  assert.equal(packet.primary_source_url, url);
  assert.equal(packet.sources.length, 1);
  assert.equal(
    packet.sources[0].source_class,
    "OFFICIAL_FIRST_PARTY",
  );
  assert.equal(packet.sources[0].bytes_sha256, sha256(bytes));
  assert.deepEqual(packet.sources[0].canonical_body, {
    algorithm: "pulse-readable-body-v1",
    sha256: sha256(claimText),
  });
  assert.equal(
    packet.sources[0].claims[0].claim_text_sha256,
    sha256(Buffer.from(claimText, "utf8")),
  );
  assert.match(packet.sources[0].claims[0].claim_sha256, /^[a-f0-9]{64}$/);
  assert.match(packet.sources[0].provenance_sha256, /^[a-f0-9]{64}$/);
  assert.match(packet.packet_sha256, /^[a-f0-9]{64}$/);
  assert.equal(packet.source_evidence_sha256, packet.packet_sha256);
  assert.equal(Object.isFrozen(packet), true);
  assert.equal(Object.isFrozen(packet.sources[0]), true);
  assert.equal(Object.isFrozen(packet.sources[0].claims[0]), true);
  assert.deepEqual(packet.planner_evidence, {
    evidence_packet_schema: "pulse-breaking-source-evidence-v1",
    verification_status: "CONFIRMED",
    confirmation_basis: "official_first_party",
    primary_source_url: url,
    source_evidence_sha256: packet.packet_sha256,
    verified_for_planning: true,
  });
});

test("urgent capture can stop after the first exact official confirmation", async () => {
  const officialUrl =
    "https://news.xbox.com/en-us/2026/07/28/official-update/";
  const editorialUrl =
    "https://www.ign.com/articles/editorial-follow-up";
  const claimText =
    "Microsoft confirmed the Xbox update in the official article body.";
  const fetched = [];

  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "urgent-official-confirmation",
      title: "Microsoft confirms the Xbox update",
      subject_ids: ["xbox"],
      source_candidates: [officialUrl, editorialUrl],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    stopAfterOfficialConfirmation: true,
    fetchCapture: async ({ url }) => {
      fetched.push(url);
      return {
        status: 200,
        final_url: url,
        content_type: "text/html",
        bytes: Buffer.from(`<article>${claimText}</article>`, "utf8"),
      };
    },
    extractClaims: async () => ({
      extractor: { id: "fixture-html", version: "1.0.0" },
      claims: [
        {
          claim_key: "microsoft.xbox.confirms.update",
          text: claimText,
          location: "body",
        },
      ],
    }),
  });

  assert.equal(packet.verdict, "OFFICIAL_CONFIRMED");
  assert.deepEqual(fetched, [officialUrl]);
  assert.equal(packet.sources.length, 1);
});

test("failed capture packets remain internally hash-valid and report only the real blocker", () => {
  const packet = buildFailedBreakingSourceEvidencePacket({
    storyId: "capture-deadline",
    now: NOW,
    blockers: [
      "breaking_source_evidence_capture_deadline_exceeded",
    ],
  });
  const validation =
    validateBreakingSourceEvidencePacket(packet);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.blockers, []);
  assert.equal(packet.verdict, "HOLD");
  assert.equal(packet.verification_status, "UNVERIFIED");
  assert.equal(packet.verified_for_planning, false);
  assert.deepEqual(packet.blockers, [
    "breaking_source_evidence_capture_deadline_exceeded",
  ]);
  assert.match(packet.packet_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    packet.source_evidence_sha256,
    packet.packet_sha256,
  );
});

test("an official-looking headline alone never becomes CONFIRMED", async () => {
  const headline =
    "Original Xbox games are definitely coming to backwards compatibility";
  const url = "https://news.xbox.com/en-us/headline-only/";

  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "headline-only",
      title: headline,
      subject_ids: ["xbox"],
      source_candidates: [url],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async () => ({
      status: 200,
      final_url: url,
      content_type: "text/html",
      bytes: Buffer.from(`<title>${headline}</title>`, "utf8"),
    }),
    extractClaims: async () => ({
      extractor: { id: "fixture-html", version: "1.0.0" },
      document_title: headline,
      claims: [
        {
          claim_key: "xbox.original-backcompat.expansion",
          text: headline,
          location: "headline",
        },
      ],
    }),
  });

  assert.equal(packet.verdict, "HOLD");
  assert.equal(packet.verification_status, "UNVERIFIED");
  assert.equal(packet.verified_for_planning, false);
  assert.deepEqual(packet.confirmed_claims, []);
  assert.ok(
    packet.sources[0].blockers.includes("source_body_claim_required"),
  );
});

test("two independent trusted editorial bodies can corroborate the same extracted claim", async () => {
  const urls = [
    "https://www.ign.com/articles/xbox-back-compat-expands",
    "https://www.eurogamer.net/xbox-back-compat-expands",
  ];
  const bodies = new Map([
    [
      urls[0],
      Buffer.from(
        "IGN independently reports the Xbox backwards compatibility expansion.",
        "utf8",
      ),
    ],
    [
      urls[1],
      Buffer.from(
        "Eurogamer independently reports the Xbox backwards compatibility expansion.",
        "utf8",
      ),
    ],
  ]);

  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "editorial-corroboration",
      title: "Xbox backwards compatibility could expand",
      subject_ids: ["xbox"],
      source_candidates: urls,
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async ({ url }) => ({
      status: 200,
      final_url: url,
      content_type: "text/html",
      bytes: bodies.get(url),
    }),
    extractClaims: async ({ source }) => ({
      extractor: { id: "fixture-html", version: "1.0.0" },
      claims: [
        {
          claim_key: "xbox.original-backcompat.expansion",
          text: `${source.publisher} independently reports the Xbox backwards compatibility expansion.`,
          location: "body",
        },
      ],
    }),
  });

  assert.equal(packet.verdict, "CORROBORATED");
  assert.equal(packet.verification_status, "CONFIRMED");
  assert.equal(
    packet.confirmation_basis,
    "trusted_editorial_corroboration",
  );
  assert.equal(packet.verified_for_planning, true);
  assert.equal(packet.confirmed_claims.length, 1);
  assert.equal(packet.confirmed_claims[0].support_count, 2);
  assert.deepEqual(
    packet.confirmed_claims[0].supporting_source_ids,
    ["eurogamer", "ign"],
  );
  assert.match(
    packet.confirmed_claims[0].corroboration_sha256,
    /^[a-f0-9]{64}$/,
  );
});

test("configured publisher prefixes are removed before exact editorial claim identity matching", async () => {
  const urls = [
    "https://www.ign.com/articles/xbox-back-compat-prefix",
    "https://www.eurogamer.net/xbox-back-compat-prefix",
  ];
  const exactText = new Map([
    [
      "ign",
      "IGN reports the Xbox backwards compatibility expansion from its captured article body.",
    ],
    [
      "eurogamer",
      "Eurogamer reports the Xbox backwards compatibility expansion from its captured article body.",
    ],
  ]);

  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "publisher-independent-claim-identity",
      title: "Xbox backwards compatibility could expand",
      subject_ids: ["xbox"],
      source_candidates: urls,
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async ({ url }) => {
      const sourceId = url.includes("ign.com") ? "ign" : "eurogamer";
      return {
        status: 200,
        final_url: url,
        content_type: "text/html",
        bytes: Buffer.from(exactText.get(sourceId), "utf8"),
      };
    },
    extractClaims: async ({ source }) => ({
      extractor: { id: "fixture-html", version: "1.0.0" },
      claims: [
        {
          claim_key: `${source.source_id}.xbox.original-backcompat.expansion`,
          text: exactText.get(source.source_id),
          location: "body",
        },
      ],
    }),
  });

  assert.equal(packet.verdict, "CORROBORATED");
  assert.equal(packet.confirmed_claims.length, 1);
  assert.equal(
    packet.confirmed_claims[0].claim_key,
    "xbox.original-backcompat.expansion",
  );
  assert.equal(
    packet.confirmed_claims[0].claim_identity,
    "xbox.original-backcompat.expansion",
  );
  assert.equal(
    packet.confirmed_claims[0].claim_identity_basis,
    "configured_publisher_prefix_removed_v1",
  );
  assert.deepEqual(
    packet.confirmed_claims[0].evidence.map(
      ({ source_id, claim_key, claim_identity_basis }) => ({
        source_id,
        claim_key,
        claim_identity_basis,
      }),
    ),
    [
      {
        source_id: "eurogamer",
        claim_key: "eurogamer.xbox.original-backcompat.expansion",
        claim_identity_basis: "configured_publisher_prefix_removed_v1",
      },
      {
        source_id: "ign",
        claim_key: "ign.xbox.original-backcompat.expansion",
        claim_identity_basis: "configured_publisher_prefix_removed_v1",
      },
    ],
  );
});

test("publisher-independent matching never strips unconfigured prefixes or merges different suffixes", async () => {
  const urls = [
    "https://www.ign.com/articles/xbox-back-compat-bounded-identity",
    "https://www.eurogamer.net/xbox-back-compat-bounded-identity",
  ];
  const captures = async (claimKeys) =>
    captureBreakingSourceEvidence({
      story: {
        id: "bounded-claim-identity",
        title: "Xbox backwards compatibility could expand",
        subject_ids: ["xbox"],
        source_candidates: urls,
      },
      sourcePolicy: sourcePolicy(),
      now: NOW,
      fetchCapture: async ({ url }) => ({
        status: 200,
        final_url: url,
        content_type: "text/html",
        bytes: Buffer.from(
          `${url.includes("ign.com") ? "IGN" : "Eurogamer"} reports the Xbox backwards compatibility expansion.`,
          "utf8",
        ),
      }),
      extractClaims: async ({ source }) => ({
        extractor: { id: "fixture-html", version: "1.0.0" },
        claims: [
          {
            claim_key: claimKeys[source.source_id],
            text: `${source.publisher} reports the Xbox backwards compatibility expansion.`,
            location: "body",
          },
        ],
      }),
    });

  const unconfiguredPrefixes = await captures({
    ign: "wire.xbox.original-backcompat.expansion",
    eurogamer: "blog.xbox.original-backcompat.expansion",
  });
  const differentExactSuffixes = await captures({
    ign: "ign.xbox.original-backcompat.expansion",
    eurogamer: "eurogamer.xbox.original-backcompat.achievement-support",
  });

  for (const packet of [unconfiguredPrefixes, differentExactSuffixes]) {
    assert.equal(packet.verdict, "HOLD");
    assert.equal(packet.verified_for_planning, false);
    assert.deepEqual(packet.confirmed_claims, []);
  }
});

test("bounded evidence capture stops after two independent editorial bodies corroborate the claim", async () => {
  const urls = [
    "https://www.ign.com/articles/xbox-back-compat-bounded",
    "https://www.eurogamer.net/xbox-back-compat-bounded",
    "https://www.gamespot.com/articles/xbox-back-compat-bounded",
  ];
  const policy = sourcePolicy();
  policy.trusted_editorial.push({
    source_id: "gamespot",
    outlet: "GameSpot",
    hosts: ["gamespot.com"],
  });
  let fetchCalls = 0;

  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "bounded-editorial-corroboration",
      title: "Xbox backwards compatibility could expand",
      subject_ids: ["xbox"],
      source_candidates: urls,
    },
    sourcePolicy: policy,
    now: NOW,
    stopAfterEvidenceConfirmation: true,
    fetchCapture: async ({ url }) => {
      fetchCalls += 1;
      const publisher = url.includes("ign.com") ? "IGN" : "Eurogamer";
      return {
        status: 200,
        final_url: url,
        content_type: "text/html",
        bytes: Buffer.from(
          `${publisher} independently reports the Xbox backwards compatibility expansion.`,
          "utf8",
        ),
      };
    },
    extractClaims: async ({ source }) => ({
      extractor: { id: "fixture-html", version: "1.0.0" },
      claims: [
        {
          claim_key: "xbox.original-backcompat.expansion",
          text: `${source.publisher} independently reports the Xbox backwards compatibility expansion.`,
          location: "body",
        },
      ],
    }),
  });

  assert.equal(packet.verdict, "CORROBORATED");
  assert.equal(packet.verified_for_planning, true);
  assert.equal(fetchCalls, 2);
  assert.equal(packet.sources.length, 2);
});

test("unsafe or non-HTTPS source URLs are rejected before injected fetch runs", async () => {
  let fetchCalls = 0;
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "unsafe-sources",
      title: "Unsafe source fixture",
      subject_ids: ["xbox"],
      source_candidates: [
        "http://news.xbox.com/not-https",
        "https://localhost/private",
        "https://127.0.0.1/private",
        "https://user:password@news.xbox.com/credentialed",
        "https://news.xbox.com:444/nonstandard-port",
      ],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async () => {
      fetchCalls += 1;
      throw new Error("must_not_fetch");
    },
    extractClaims: async () => {
      throw new Error("must_not_extract");
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(packet.verdict, "HOLD");
  assert.equal(packet.verification_status, "UNVERIFIED");
  assert.deepEqual(
    packet.sources.map((source) => source.blockers[0]),
    [
      "source_url_https_required",
      "source_url_public_hostname_required",
      "source_url_public_hostname_required",
      "source_url_credentials_forbidden",
      "source_url_nonstandard_port_forbidden",
    ],
  );
});

test("a discovered story URL is captured when no explicit evidence candidate list exists", async () => {
  const url = "https://news.xbox.com/en-us/discovered-story/";
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "discovered-story-url",
      title: "Discovered from the official feed",
      subject_ids: ["xbox"],
      url,
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async ({ url: requestedUrl }) => ({
      status: 200,
      final_url: requestedUrl,
      content_type: "text/html",
      bytes: Buffer.from("Official body announcement", "utf8"),
    }),
    extractClaims: async () => ({
      extractor: { id: "fixture-html", version: "1.0.0" },
      claims: [
        {
          claim_key: "xbox.discovered.official-announcement",
          text: "Official body announcement",
          location: "official_post_body",
        },
      ],
    }),
  });

  assert.equal(packet.verdict, "OFFICIAL_CONFIRMED");
  assert.equal(packet.primary_source_url, url);
});

test("confirmation evidence still fails closed when planner identity metadata is missing", async () => {
  const url = "https://news.xbox.com/en-us/missing-story-id/";
  const packet = await captureBreakingSourceEvidence({
    story: {
      title: "An official story without a durable ID",
      subject_ids: ["xbox"],
      source_candidates: [url],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async () => ({
      status: 200,
      final_url: url,
      content_type: "text/html",
      bytes: Buffer.from("Official body", "utf8"),
    }),
    extractClaims: async () => ({
      extractor: { id: "fixture-html", version: "1.0.0" },
      claims: [
        {
          claim_key: "xbox.missing-id.announcement",
          text: "Microsoft published an official announcement.",
          location: "body",
        },
      ],
    }),
  });

  assert.equal(packet.verdict, "HOLD");
  assert.equal(packet.verification_status, "UNVERIFIED");
  assert.equal(packet.verified_for_planning, false);
  assert.ok(packet.blockers.includes("story_id_required"));
});

test("two pages from one editorial outlet are not independent corroboration", async () => {
  const urls = [
    "https://www.ign.com/articles/report-page-one",
    "https://uk.ign.com/articles/report-page-two",
  ];
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "same-outlet-not-independent",
      title: "One outlet repeats a report",
      subject_ids: ["xbox"],
      source_candidates: urls,
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async ({ url }) => ({
      status: 200,
      final_url: url,
      content_type: "text/html",
      bytes: Buffer.from(`Body captured from ${url}`, "utf8"),
    }),
    extractClaims: async () => ({
      extractor: { id: "fixture-html", version: "1.0.0" },
      claims: [
        {
          claim_key: "xbox.same-outlet.repeated-claim",
          text: "IGN reports the same claim on another page.",
          location: "body",
        },
      ],
    }),
  });

  assert.equal(packet.verdict, "HOLD");
  assert.equal(packet.verification_status, "UNVERIFIED");
  assert.equal(packet.sources.length, 2);
  assert.deepEqual(
    new Set(packet.sources.map((source) => source.source_id)),
    new Set(["ign"]),
  );
});

test("packet, byte, claim and provenance hashes change only with their captured inputs", async () => {
  const url = "https://news.xbox.com/en-us/hash-evidence/";
  const capture = async ({ bytes, claimText }) =>
    captureBreakingSourceEvidence({
      story: {
        id: "hash-evidence",
        title: "Hash evidence fixture",
        subject_ids: ["xbox"],
        source_candidates: [url],
      },
      sourcePolicy: sourcePolicy(),
      now: NOW,
      fetchCapture: async () => ({
        status: 200,
        final_url: url,
        content_type: "text/html",
        bytes,
      }),
      extractClaims: async () => ({
        extractor: { id: "fixture-html", version: "1.0.0" },
        claims: [
          {
            claim_key: "xbox.hash-evidence.claim",
            text: claimText,
            location: "body",
          },
        ],
      }),
    });

  const first = await capture({
    bytes: Buffer.from(
      "captured bytes version one. Exact extracted claim version one. Exact extracted claim version two.",
      "utf8",
    ),
    claimText: "Exact extracted claim version one.",
  });
  const repeated = await capture({
    bytes: Buffer.from(
      "captured bytes version one. Exact extracted claim version one. Exact extracted claim version two.",
      "utf8",
    ),
    claimText: "Exact extracted claim version one.",
  });
  const changedBytes = await capture({
    bytes: Buffer.from(
      "captured bytes version two. Exact extracted claim version one. Exact extracted claim version two.",
      "utf8",
    ),
    claimText: "Exact extracted claim version one.",
  });
  const changedClaim = await capture({
    bytes: Buffer.from(
      "captured bytes version one. Exact extracted claim version one. Exact extracted claim version two.",
      "utf8",
    ),
    claimText: "Exact extracted claim version two.",
  });

  assert.equal(first.packet_sha256, repeated.packet_sha256);
  assert.notEqual(
    first.sources[0].bytes_sha256,
    changedBytes.sources[0].bytes_sha256,
  );
  assert.notEqual(
    first.sources[0].provenance_sha256,
    changedBytes.sources[0].provenance_sha256,
  );
  assert.notEqual(first.packet_sha256, changedBytes.packet_sha256);
  assert.equal(
    first.sources[0].claims[0].claim_sha256,
    changedBytes.sources[0].claims[0].claim_sha256,
  );
  assert.equal(
    first.sources[0].bytes_sha256,
    changedClaim.sources[0].bytes_sha256,
  );
  assert.notEqual(
    first.sources[0].claims[0].claim_sha256,
    changedClaim.sources[0].claims[0].claim_sha256,
  );
  assert.notEqual(first.packet_sha256, changedClaim.packet_sha256);
});

test("an unknown HTTPS editorial host is not trusted and is never fetched", async () => {
  let fetchCalls = 0;
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "unknown-editorial",
      title: "Unknown editorial report",
      subject_ids: ["xbox"],
      source_candidates: [
        "https://gaming-rumours.example.com/xbox-report",
      ],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async () => {
      fetchCalls += 1;
      throw new Error("must_not_fetch");
    },
    extractClaims: async () => {
      throw new Error("must_not_extract");
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(packet.verdict, "HOLD");
  assert.deepEqual(packet.sources[0].blockers, [
    "source_not_official_or_trusted_editorial",
  ]);
});

test("a fetch redirect cannot escape the classified source boundary", async () => {
  const requestedUrl =
    "https://news.xbox.com/en-us/redirect-fixture/";
  let extractionCalls = 0;
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "redirect-boundary",
      title: "Redirect boundary fixture",
      subject_ids: ["xbox"],
      source_candidates: [requestedUrl],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async () => ({
      status: 200,
      final_url: "https://untrusted.example.com/copied-article",
      content_type: "text/html",
      bytes: Buffer.from("untrusted redirect body", "utf8"),
    }),
    extractClaims: async () => {
      extractionCalls += 1;
      return { claims: [] };
    },
  });

  assert.equal(extractionCalls, 0);
  assert.equal(packet.verdict, "HOLD");
  assert.ok(
    packet.sources[0].blockers.includes(
      "source_redirect_policy_mismatch",
    ),
  );
});

test("malformed injected extraction output returns a HOLD packet instead of escaping the evidence boundary", async () => {
  const url = "https://news.xbox.com/en-us/malformed-extraction/";
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "malformed-extraction",
      title: "Malformed extraction fixture",
      subject_ids: ["xbox"],
      source_candidates: [url],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async () => ({
      status: 200,
      final_url: url,
      content_type: "text/html",
      bytes: Buffer.from("Official body", "utf8"),
    }),
    extractClaims: async () => ({
      extractor: { id: "broken-fixture", version: "1.0.0" },
      claims: { not: "an array" },
    }),
  });

  assert.equal(packet.verdict, "HOLD");
  assert.equal(packet.verification_status, "UNVERIFIED");
  assert.ok(
    packet.sources[0].blockers.includes(
      "source_claim_extraction_invalid",
    ),
  );
});

test("missing story and source policy inputs return a deterministic fail-closed packet", async () => {
  const packet = await captureBreakingSourceEvidence({
    story: null,
    sourcePolicy: null,
    now: NOW,
  });

  assert.equal(packet.verdict, "HOLD");
  assert.equal(packet.verification_status, "UNVERIFIED");
  assert.deepEqual(packet.sources, []);
  assert.deepEqual(packet.blockers, [
    "story_id_required",
    "story_title_required",
    "source_candidate_required",
    "official_or_corroborated_body_evidence_required",
  ]);
  assert.match(packet.packet_sha256, /^[a-f0-9]{64}$/);
});

test("an official domain only counts as first-party evidence for its configured story subject", async () => {
  let fetchCalls = 0;
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: "wrong-first-party-subject",
      title: "A PlayStation story cannot be confirmed by Xbox Wire",
      subject_ids: ["playstation"],
      source_candidates: [
        "https://news.xbox.com/en-us/unrelated-announcement/",
      ],
    },
    sourcePolicy: sourcePolicy(),
    now: NOW,
    fetchCapture: async () => {
      fetchCalls += 1;
      throw new Error("must_not_fetch");
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(packet.verdict, "HOLD");
  assert.deepEqual(packet.sources[0].blockers, [
    "source_not_official_or_trusted_editorial",
  ]);
});
