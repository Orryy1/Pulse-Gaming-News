const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const WORKBOOK_PATH = "C:\\Users\\MORR\\Downloads\\gold_standards_reference_library.xlsx";

test("gold standard library loads workbook sheets into production benchmark packs", () => {
  const {
    loadGoldStandardReferenceLibrary,
    REQUIRED_REFERENCE_PACKS,
  } = require("../../lib/gold-standard-reference-library");

  const library = loadGoldStandardReferenceLibrary({ workbookPath: WORKBOOK_PATH });

  assert.equal(library.summary.total_references, 50);
  assert.equal(library.references.length, 50);
  assert.equal(library.codex_rules.length, 12);
  assert.deepEqual(
    library.reference_packs.map((pack) => pack.pack),
    REQUIRED_REFERENCE_PACKS,
  );
  assert.equal(
    library.reference_packs.find((pack) => pack.pack === "Gaming News Core")
      .main_extraction_targets,
    "Angle-first script, gameplay footage density, score/stat cards, source-safe captions",
  );
  assert.match(
    library.summary.core_legal_rule,
    /reference-only unless a specific asset has verified reuse rights/i,
  );
  assert.ok(
    library.references.some(
      (reference) =>
        reference.source_channel === "IGN" &&
        reference.codex_features_to_extract.includes("Hook speed"),
    ),
  );
  for (const packName of [
    "Commercial and Affiliate Mechanics",
    "X Hot Take and Thread Mechanics",
    "Instagram Carousel Mechanics",
  ]) {
    const pack = library.reference_packs.find((candidate) => candidate.pack === packName);
    assert.ok(pack, `${packName} should be present`);
    assert.equal(pack.source, "derived_from_gold_standard_library");
    assert.match(pack.rights_usage_note, /reference-only/i);
  }
});

test("gold standard loader can use a caller-provided workbook path", () => {
  const { resolveGoldStandardWorkbookPath } = require("../../lib/gold-standard-reference-library");

  const resolved = resolveGoldStandardWorkbookPath({
    workbookPath: path.join("C:\\", "tmp", "custom.xlsx"),
  });

  assert.equal(resolved, path.join("C:\\", "tmp", "custom.xlsx"));
});
