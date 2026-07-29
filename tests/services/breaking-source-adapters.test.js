"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createAnthropicBreakingClaimExtractor,
  createPinnedAddressLookup,
  createSafeHttpsFetchCapture,
  extractReadableBody,
  isPublicAddress,
} = require("../../lib/services/breaking-source-adapters");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("public-address policy rejects loopback, private, link-local and mapped-private targets", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.2.3",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946"), true);
});

test("pinned DNS lookup supports Node's single-address and all-address callback contracts", () => {
  const lookup = createPinnedAddressLookup({
    address: "93.184.216.34",
    family: 4,
  });

  let singleResult = null;
  lookup("news.xbox.com", {}, (error, address, family) => {
    assert.equal(error, null);
    singleResult = { address, family };
  });
  assert.deepEqual(singleResult, {
    address: "93.184.216.34",
    family: 4,
  });

  let allResult = null;
  lookup("news.xbox.com", { all: true }, (error, addresses) => {
    assert.equal(error, null);
    allResult = addresses;
  });
  assert.deepEqual(allResult, [
    {
      address: "93.184.216.34",
      family: 4,
    },
  ]);
});

test("safe HTTPS capture pins a vetted public address, forbids redirects and archives exact bytes by hash", async (t) => {
  const archiveRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-source-bytes-"),
  );
  t.after(() => fs.remove(archiveRoot));
  const bytes = Buffer.from("<article>Official body evidence.</article>");
  let transportInput = null;
  const capture = createSafeHttpsFetchCapture({
    archiveRoot,
    dnsLookup: async () => [
      { address: "93.184.216.34", family: 4 },
    ],
    async transport(input) {
      transportInput = input;
      return {
        status: 200,
        content_type: "text/html",
        bytes,
      };
    },
  });

  const result = await capture({
    url: "https://news.xbox.com/en-us/example?view=full",
    redirect: "manual",
    max_bytes: 1024,
  });

  assert.equal(transportInput.address, "93.184.216.34");
  assert.equal(transportInput.family, 4);
  assert.equal(transportInput.maxBytes, 1024);
  assert.equal(result.bytes_sha256, sha256(bytes));
  assert.equal(await fs.readFile(result.archive_path, "utf8"), bytes.toString());
});

test("safe HTTPS capture fails before transport when any DNS answer is non-public", async () => {
  let transportCalls = 0;
  const capture = createSafeHttpsFetchCapture({
    dnsLookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    async transport() {
      transportCalls += 1;
      return {};
    },
  });

  await assert.rejects(
    capture({
      url: "https://news.xbox.com/en-us/example",
      redirect: "manual",
      max_bytes: 1024,
    }),
    /dns_not_public/,
  );
  assert.equal(transportCalls, 0);
});

test("readable-body extraction removes head, headline, scripts and navigation", () => {
  const body = extractReadableBody(
    Buffer.from(`
      <html>
        <head><title>Do not trust this headline</title></head>
        <body>
          <nav>Navigation claim</nav>
          <main>
            <h1>Do not trust this headline</h1>
            <p>Microsoft confirmed the backwards compatibility update in the article body.</p>
            <script>inventedClaim()</script>
          </main>
        </body>
      </html>
    `),
    "text/html",
  );

  assert.doesNotMatch(body, /headline|Navigation|inventedClaim/);
  assert.match(body, /confirmed the backwards compatibility update/);
});

test("Anthropic extractor accepts only exact body quotes and carries a stable prior-claim dictionary across sources", async () => {
  const bodyOne =
    "Microsoft confirmed original Xbox games will join the backwards compatibility programme.";
  const bodyTwo =
    "A second outlet reports that original Xbox games will join the backwards compatibility programme.";
  const calls = [];
  const client = {
    messages: {
      async create(request) {
        const input = JSON.parse(request.messages[0].content);
        calls.push(input);
        const body = input.body_text;
        const exactText = body.includes("Microsoft confirmed")
          ? bodyOne
          : bodyTwo;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                claims: [
                  {
                    claim_key:
                      "microsoft.xbox.adds.original-backcompat-games",
                    text: exactText,
                  },
                  {
                    claim_key: "microsoft.xbox.invented",
                    text: "This sentence is not present in the body.",
                  },
                ],
              }),
            },
          ],
        };
      },
    },
  };
  const extract = createAnthropicBreakingClaimExtractor({
    client,
    model: "fixture-model",
  });

  const first = await extract({
    story: { id: "breaking-1", subject_ids: ["xbox"] },
    source: {
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      publisher: "Microsoft Gaming",
    },
    content_type: "text/plain",
    bytes: Buffer.from(bodyOne),
  });
  const second = await extract({
    story: { id: "breaking-1", subject_ids: ["xbox"] },
    source: {
      source_id: "ign",
      source_class: "TRUSTED_EDITORIAL",
      publisher: "IGN",
    },
    content_type: "text/plain",
    bytes: Buffer.from(bodyTwo),
  });

  assert.equal(first.claims.length, 1);
  assert.equal(first.claims[0].text, bodyOne);
  assert.equal(second.claims.length, 1);
  assert.equal(second.claims[0].text, bodyTwo);
  assert.deepEqual(calls[0].story_identity, {
    id: "breaking-1",
    subject_ids: ["xbox"],
  });
  assert.equal(Object.hasOwn(calls[0].story_identity, "title"), false);
  assert.equal(calls[0].prior_claim_dictionary.length, 0);
  assert.equal(calls[1].prior_claim_dictionary.length, 1);
  assert.equal(
    calls[1].prior_claim_dictionary[0].claim_key,
    "microsoft.xbox.adds.original-backcompat-games",
  );
});

test("local Ollama claim extraction requires the exact bounded claims response schema", async () => {
  const exactClaim =
    "Microsoft confirmed original Xbox games will join the backwards compatibility programme.";
  let request = null;
  const extract = createAnthropicBreakingClaimExtractor({
    client: {
      editorial_identity: {
        provider: "ollama",
        model: "qwen3.5:27b",
        adapter: "ollama.api.chat",
      },
      messages: {
        async create(input) {
          request = input;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  claims: [
                    {
                      claim_key:
                        "microsoft.xbox.adds.original-backcompat-games",
                      text: exactClaim,
                    },
                  ],
                }),
              },
            ],
          };
        },
      },
    },
    model: "qwen3.5:27b",
  });

  const result = await extract({
    story: { id: "structured-local", subject_ids: ["xbox"] },
    source: {
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      publisher: "Microsoft Gaming",
    },
    content_type: "text/plain",
    bytes: Buffer.from(exactClaim),
  });

  assert.equal(result.claims.length, 1);
  assert.deepEqual(
    request.editorial_response_json_schema.required,
    ["claims"],
  );
  assert.equal(
    request.editorial_response_json_schema.additionalProperties,
    false,
  );
  const claimsSchema =
    request.editorial_response_json_schema.properties.claims;
  assert.equal(claimsSchema.maxItems, 12);
  assert.deepEqual(claimsSchema.items.required, [
    "claim_key",
    "text",
  ]);
  assert.equal(claimsSchema.items.additionalProperties, false);
  assert.match(
    claimsSchema.items.properties.claim_key.pattern,
    /a-z0-9/,
  );
  assert.equal(
    claimsSchema.items.properties.text.minLength,
    20,
  );
});

test("local claim extraction bounds oversized bodies while retaining late subject evidence as an exact quote", async () => {
  const exactClaim =
    "Xbox confirmed the late official compatibility update will reach players this month.";
  const oversizedBody = [
    "Official article introduction with enough factual prose for governed extraction.",
    "General platform context without the named story subject. ".repeat(
      1_900,
    ),
    exactClaim,
    "Closing official article context.",
  ].join(" ");
  let requestBody = null;
  const extract = createAnthropicBreakingClaimExtractor({
    client: {
      editorial_identity: {
        provider: "ollama",
        model: "qwen3.5:27b",
        adapter: "ollama.api.chat",
      },
      messages: {
        async create(request) {
          requestBody = JSON.parse(request.messages[0].content);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  claims: [
                    {
                      claim_key:
                        "microsoft.xbox.confirms.compatibility-update",
                      text: exactClaim,
                    },
                  ],
                }),
              },
            ],
          };
        },
      },
    },
    model: "qwen3.5:27b",
  });

  const result = await extract({
    story: {
      id: "oversized-official-body",
      subject_ids: ["xbox"],
    },
    source: {
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      publisher: "Microsoft Gaming",
    },
    content_type: "text/plain",
    bytes: Buffer.from(oversizedBody),
  });

  assert.ok(oversizedBody.length > 100_000);
  assert.ok(requestBody.body_text.length <= 12_000);
  assert.ok(requestBody.body_text.includes(exactClaim));
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].text, exactClaim);
});

test("local claim extraction samples lead, middle and tail when legacy stories have no subject identifiers", async () => {
  const exactClaim =
    "The official update confirms achievement support will arrive for players later this year.";
  const oversizedBody = [
    "Official article introduction with enough readable factual context.",
    "General background without a governed subject identifier. ".repeat(
      1_500,
    ),
    exactClaim,
  ].join(" ");
  let requestBody = null;
  const extract = createAnthropicBreakingClaimExtractor({
    client: {
      editorial_identity: {
        provider: "ollama",
        model: "qwen3.5:27b",
        adapter: "ollama.api.chat",
      },
      messages: {
        async create(request) {
          requestBody = JSON.parse(request.messages[0].content);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  claims: [
                    {
                      claim_key:
                        "official.update.confirms.achievement-support",
                      text: exactClaim,
                    },
                  ],
                }),
              },
            ],
          };
        },
      },
    },
    model: "qwen3.5:27b",
  });

  const result = await extract({
    story: { id: "legacy-without-subject-ids" },
    source: {
      source_id: "official-source",
      source_class: "OFFICIAL_FIRST_PARTY",
      publisher: "Official Publisher",
    },
    content_type: "text/plain",
    bytes: Buffer.from(oversizedBody),
  });

  assert.ok(oversizedBody.length > 12_000);
  assert.ok(requestBody.body_text.length <= 12_000);
  assert.ok(requestBody.body_text.includes(exactClaim));
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].text, exactClaim);
});

test("compacted extraction never accepts a quote created across non-contiguous body windows", async () => {
  const oversizedBody = [
    "A".repeat(6_000),
    "general official context ".repeat(3_000),
    "Xbox confirmed a late official platform update for players.",
  ].join(" ");
  let artificialQuote = null;
  const extract = createAnthropicBreakingClaimExtractor({
    client: {
      editorial_identity: {
        provider: "ollama",
        model: "qwen3.5:27b",
        adapter: "ollama.api.chat",
      },
      messages: {
        async create(request) {
          const bodyText = JSON.parse(
            request.messages[0].content,
          ).body_text;
          const boundary = bodyText.indexOf("\n");
          artificialQuote =
            bodyText.slice(boundary - 24, boundary) +
            bodyText.slice(boundary, boundary + 25);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  claims: [
                    {
                      claim_key:
                        "microsoft.xbox.rejects.artificial-window-quote",
                      text: artificialQuote,
                    },
                  ],
                }),
              },
            ],
          };
        },
      },
    },
    model: "qwen3.5:27b",
  });

  const result = await extract({
    story: {
      id: "artificial-window-boundary",
      subject_ids: ["xbox"],
    },
    source: {
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      publisher: "Microsoft Gaming",
    },
    content_type: "text/plain",
    bytes: Buffer.from(oversizedBody),
  });

  assert.ok(artificialQuote.includes("\n"));
  assert.equal(oversizedBody.includes(artificialQuote), false);
  assert.deepEqual(result.claims, []);
});
