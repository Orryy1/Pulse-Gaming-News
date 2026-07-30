"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  attachGovernedAutonomousScriptRepairContext,
  createGovernedAutonomousScriptRepairContext,
  readGovernedAutonomousScriptRepairContext,
  renderGovernedAutonomousScriptRepairEvidence,
} = require("../../lib/services/governed-autonomous-script-repair-context");
const {
  assessGovernedAutonomousBreakingScriptClaimSupport,
} = require("../../lib/services/governed-autonomous-breaking-candidate-contract-compiler");

const SILENT_HILL_CLAIMS = Object.freeze([
  Object.freeze({
    claim_key: "playstation.silent_hill_townfall.launches",
    text:
      "Silent Hill: Townfall launches on September 24 on PlayStation 5.",
  }),
  Object.freeze({
    claim_key: "screen_burn.develops.townfall",
    text:
      "The developers at Screen Burn visited and photographed real coastal towns in Scotland",
  }),
]);

test("keeps the exact Silent Hill claim context transient and renders it as the sole factual basis for a governed repair", () => {
  const context = createGovernedAutonomousScriptRepairContext({
    story_id: "rss_859a44c4ba983cbb",
    inventory_file_sha256: "a".repeat(64),
    source_evidence_sha256: "b".repeat(64),
    confirmed_claims: SILENT_HILL_CLAIMS,
  });
  const candidate = {
    id: "rss_859a44c4ba983cbb",
    title: "Silent Hill: Townfall hands-on report",
    full_script:
      "Silent Hill: Townfall adds first-person combat and makes sneaking vital.",
  };

  attachGovernedAutonomousScriptRepairContext(candidate, context);

  assert.deepEqual(
    readGovernedAutonomousScriptRepairContext(candidate),
    context,
  );
  assert.equal(
    Object.keys(candidate).some((field) =>
      field.includes("repair_context"),
    ),
    false,
  );
  assert.doesNotMatch(JSON.stringify(candidate), /confirmed_claims/);

  const evidence =
    renderGovernedAutonomousScriptRepairEvidence(candidate);
  assert.match(evidence, /SOLE FACTUAL BASIS/);
  for (const claim of SILENT_HILL_CLAIMS) {
    assert.match(evidence, new RegExp(claim.claim_key.replace(/\./g, "\\.")));
    assert.ok(evidence.includes(claim.text));
  }
  assert.doesNotMatch(evidence, /\bcombat\b/i);
  assert.doesNotMatch(evidence, /\bsneaking\b/i);
});

test("refuses an ambiguous repair context instead of truncating or merging exact claims", () => {
  assert.throws(
    () =>
      createGovernedAutonomousScriptRepairContext({
        story_id: "rss_duplicate_claim",
        inventory_file_sha256: "a".repeat(64),
        source_evidence_sha256: "b".repeat(64),
        confirmed_claims: [
          {
            claim_key: "duplicate.claim",
            text: "First exact statement.",
          },
          {
            claim_key: "duplicate.claim",
            text: "Second exact statement.",
          },
        ],
      }),
    /governed_autonomous_script_repair_claims_invalid/,
  );
});

test("the exact Silent Hill replacement reaches compiler claim-binding GREEN while combat and sneaking prose stays HOLD", () => {
  const unsupported =
    assessGovernedAutonomousBreakingScriptClaimSupport({
      script:
        "Silent Hill: Townfall forces first-person combat with limited melee weapons. PlayStation Blog confirms sneaking is now vital.",
      confirmed_claims: SILENT_HILL_CLAIMS,
    });
  const supported =
    assessGovernedAutonomousBreakingScriptClaimSupport({
      script:
        "Silent Hill: Townfall launches on PlayStation 5 on 24 September. Developers at Screen Burn visited and photographed real coastal towns across Scotland while making the game. PlayStation 5 gets Silent Hill: Townfall on 24 September, and Screen Burn visited and photographed real coastal towns across Scotland.",
      confirmed_claims: SILENT_HILL_CLAIMS,
    });

  assert.equal(unsupported.verdict, "HOLD");
  assert.ok(
    unsupported.blockers.some((blocker) =>
      /script_clause_\d+_unsupported/.test(blocker),
    ),
  );
  assert.equal(supported.verdict, "GREEN");
  assert.deepEqual(
    supported.script_claim_bindings.map(
      (binding) => binding.clause,
    ),
    [
      "Silent Hill: Townfall launches on PlayStation 5 on 24 September.",
      "Developers at Screen Burn visited and photographed real coastal towns across Scotland while making the game.",
      "PlayStation 5 gets Silent Hill: Townfall on 24 September, and Screen Burn visited and photographed real coastal towns across Scotland.",
    ],
  );
});
