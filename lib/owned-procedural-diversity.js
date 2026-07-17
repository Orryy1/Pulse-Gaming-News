"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const OWNED_PROCEDURAL_DIVERSITY_VERSION =
  "pulse_owned_procedural_diversity_v1";
const DEFAULT_MINIMUM_GENERATOR_PROJECTS = 3;
const DEFAULT_SIMILARITY_THRESHOLD = 0.9;
const SHA256_RE = /^[a-f0-9]{64}$/;
const STABLE_ID_RE = /^[a-z0-9][a-z0-9._:/-]{1,127}$/i;
const PLACEHOLDER_RE =
  /(?:^|[\s._:/-])(?:placeholder|dummy|pending|tbd|todo|unknown|unspecified|missing|sample)(?:$|[\s._:/-])/i;
const STATIC_OR_STILL_RE =
  /\b(?:static|still|image|screenshot|poster|key[\s_-]?art)\b.*\b(?:loop|motion|animation|video)\b|\b(?:ken[\s_-]?burns|pan[\s_-]?(?:and[\s_-]?)?zoom|parallax[\s_-]?still|still[\s_-]?loop|static[\s_-]?(?:image|motion)|image[\s_-]?loop|screenshot[\s_-]?loop)\b/i;
const CARD_OR_TEMPLATE_ONLY_RE =
  /\b(?:card|template|text|readable)[\s_-]*(?:only|loop)\b|\b(?:card[\s_-]?only|template[\s_-]?only|readable[\s_-]?template|text[\s_-]?card[\s_-]?only)\b/i;

const PROJECT_ID_FIELDS = Object.freeze([
  "generator_project_id",
  "generatorProjectId",
  "project_id",
  "projectId",
]);
const MASTER_HASH_FIELDS = Object.freeze([
  "generator_master_sha256",
  "generatorMasterSha256",
  "master_sha256",
  "masterSha256",
]);
const VISUAL_FINGERPRINT_FIELDS = Object.freeze([
  "sampled_visual_fingerprint",
  "sampledVisualFingerprint",
  "visual_fingerprint",
  "visualFingerprint",
]);
const DESIGN_GRAMMAR_FIELDS = Object.freeze([
  "design_grammar_identity",
  "designGrammarIdentity",
  "design_grammar_id",
  "designGrammarId",
  "grammar_identity",
  "grammarIdentity",
]);
const OUTPUT_FIELDS = Object.freeze([
  "outputs",
  "materialised_outputs",
  "materialized_outputs",
  "materialised_clips",
  "materialized_clips",
  "clips",
]);
const DESCRIPTOR_FIELDS = Object.freeze([
  "source_type",
  "sourceType",
  "motion_type",
  "motionType",
  "media_kind",
  "mediaKind",
  "visual_type",
  "visualType",
  "generator_type",
  "generatorType",
  "asset_type",
  "assetType",
  "kind",
  "type",
]);
const NESTED_IDENTITY_FIELDS = Object.freeze([
  "generator_identity",
  "generatorIdentity",
  "source_identity",
  "sourceIdentity",
  "provenance",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => item != null) : [];
}

function cleanText(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normaliseText(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstDefined(values) {
  return values.find((value) => value !== undefined && value !== null);
}

function evidenceOwners(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) return [];
  const owners = [];
  const queue = [project];
  const visited = new Set();
  while (queue.length) {
    const owner = queue.shift();
    if (!owner || typeof owner !== "object" || Array.isArray(owner) || visited.has(owner)) {
      continue;
    }
    visited.add(owner);
    owners.push(owner);
    for (const field of NESTED_IDENTITY_FIELDS) {
      if (owner[field] && typeof owner[field] === "object") queue.push(owner[field]);
    }
  }
  return owners;
}

function fieldValues(project, fields) {
  const values = [];
  for (const owner of evidenceOwners(project)) {
    for (const field of fields) {
      const candidates = Array.isArray(owner[field]) ? owner[field] : [owner[field]];
      for (const candidate of candidates) {
        const value = cleanText(candidate);
        if (value) values.push(value);
      }
    }
  }
  return unique(values);
}

function firstFieldValue(project, fields) {
  return fieldValues(project, fields)[0] || "";
}

function normaliseSha256(value) {
  return cleanText(value).toLowerCase();
}

function normaliseProjectId(value) {
  return normaliseText(value);
}

function normalisePlatform(value) {
  const platform = normaliseText(value).replace(/[\s-]+/g, "_");
  if (platform === "twitter") return "x";
  if (/^youtube(?:_|$)/.test(platform)) return "youtube";
  if (/^tiktok(?:_|$)/.test(platform)) return "tiktok";
  if (/^instagram(?:_|$)/.test(platform)) return "instagram";
  if (/^facebook(?:_|$)/.test(platform)) return "facebook";
  if (/^threads(?:_|$)/.test(platform)) return "threads";
  if (/^pinterest(?:_|$)/.test(platform)) return "pinterest";
  return platform;
}

function isTruthy(value) {
  if (value === true || value === 1) return true;
  return /^(?:true|yes|1)$/i.test(cleanText(value));
}

function hasTruthyFlag(project, fields) {
  return evidenceOwners(project).some((owner) =>
    fields.some((field) => isTruthy(owner[field])),
  );
}

function descriptors(project) {
  return fieldValues(project, DESCRIPTOR_FIELDS);
}

function isPlaceholderProject(project, projectId) {
  if (
    hasTruthyFlag(project, [
      "placeholder",
      "is_placeholder",
      "isPlaceholder",
      "placeholder_project",
      "placeholderProject",
    ])
  ) {
    return true;
  }
  return [projectId, ...descriptors(project)].some((value) => PLACEHOLDER_RE.test(value));
}

function isStaticOrStillLoop(project) {
  if (
    hasTruthyFlag(project, [
      "static",
      "is_static",
      "isStatic",
      "still_loop",
      "stillLoop",
      "is_still_loop",
      "isStillLoop",
      "derived_from_still",
      "derivedFromStill",
    ])
  ) {
    return true;
  }
  return descriptors(project).some((value) =>
    STATIC_OR_STILL_RE.test(value.replace(/[_-]+/g, " ")),
  );
}

function isCardOrTemplateOnly(project) {
  if (
    hasTruthyFlag(project, [
      "card_only",
      "cardOnly",
      "template_only",
      "templateOnly",
      "readable_template_only",
      "readableTemplateOnly",
    ])
  ) {
    return true;
  }
  return descriptors(project).some((value) =>
    CARD_OR_TEMPLATE_ONLY_RE.test(value.replace(/[_-]+/g, " ")),
  );
}

function designGrammarIdentity(project) {
  const direct = firstFieldValue(project, DESIGN_GRAMMAR_FIELDS);
  if (direct) return direct;
  const grammar = project?.design_grammar || project?.designGrammar;
  if (!grammar || typeof grammar !== "object" || Array.isArray(grammar)) return "";
  return cleanText(
    grammar.identity || grammar.id || grammar.grammar_id || grammar.grammarId,
  );
}

function rightsEvidence(project) {
  const declaredRights = project?.rights || project?.rights_record || project?.rightsRecord;
  const rights =
    declaredRights && typeof declaredRights === "object" && !Array.isArray(declaredRights)
      ? declaredRights
      : {};
  const grant = cleanText(
    firstDefined([
      rights.rights_grant,
      rights.rightsGrant,
      rights.grant,
      rights.rights_basis,
      rights.rightsBasis,
      rights.licence_basis,
      rights.license_basis,
      rights.ownership,
      project?.rights_grant,
      project?.rightsGrant,
      project?.rights_basis,
      project?.rightsBasis,
      project?.licence_basis,
      project?.license_basis,
      project?.ownership,
    ]),
  );
  const ownedFlag = firstDefined([
    rights.owned,
    rights.wholly_owned,
    rights.whollyOwned,
    project?.owned,
    project?.wholly_owned,
    project?.whollyOwned,
  ]);
  const declaredPlatforms = firstDefined([
    rights.allowed_platforms,
    rights.allowedPlatforms,
    project?.allowed_platforms,
    project?.allowedPlatforms,
  ]);
  const platformRows = Array.isArray(declaredPlatforms)
    ? declaredPlatforms
    : cleanText(declaredPlatforms)
      ? [declaredPlatforms]
      : [];
  const platforms = unique(
    platformRows
      .map(normalisePlatform)
      .filter(Boolean),
  ).sort();
  const normalisedGrant = grant.replace(/[_-]+/g, " ");
  const grantExplicitlyOwned =
    /\b(?:wholly\s+)?owned\b/i.test(normalisedGrant) &&
    !/\b(?:not|non)\s+owned\b/i.test(normalisedGrant);
  const ownedFlagAllows =
    ownedFlag === undefined || ownedFlag === null || isTruthy(ownedFlag);

  return {
    rights_grant: grant || null,
    owned: grantExplicitlyOwned && ownedFlagAllows,
    owned_flag: ownedFlag === undefined ? null : isTruthy(ownedFlag),
    allowed_platforms: platforms,
  };
}

function projectOutputs(project) {
  for (const field of OUTPUT_FIELDS) {
    if (Array.isArray(project?.[field])) return project[field];
  }
  const singular = project?.output || project?.materialised_output || project?.materialized_output;
  return singular && typeof singular === "object" ? [singular] : [];
}

function outputPath(output) {
  if (typeof output === "string") return cleanText(output);
  return cleanText(
    output?.path ||
      output?.file_path ||
      output?.filePath ||
      output?.output_path ||
      output?.outputPath ||
      output?.local_path ||
      output?.localPath,
  );
}

function outputSha256(output) {
  if (!output || typeof output !== "object") return "";
  return normaliseSha256(
    output.sha256 ||
      output.asset_sha256 ||
      output.file_sha256 ||
      output.content_sha256 ||
      output.current_sha256,
  );
}

function outputSize(output) {
  if (!output || typeof output !== "object") return null;
  const raw = firstDefined([
    output.size_bytes,
    output.sizeBytes,
    output.file_size_bytes,
    output.fileSizeBytes,
    output.bytes,
    output.current_size_bytes,
  ]);
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function resolveFilePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  return path.isAbsolute(text)
    ? path.resolve(text)
    : path.resolve(workspaceRoot || process.cwd(), text);
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function inspectOutput(output, outputIndex, workspaceRoot) {
  const declaredPath = outputPath(output);
  const resolvedPath = resolveFilePath(workspaceRoot, declaredPath);
  const declaredSha256 = outputSha256(output);
  const declaredSizeBytes = outputSize(output);
  const reasons = [];
  let stat = null;
  let currentSha256 = null;

  if (!declaredPath) reasons.push("materialised_output_path_missing");
  if (!declaredSha256) reasons.push("materialised_output_sha256_missing");
  else if (!SHA256_RE.test(declaredSha256)) {
    reasons.push("materialised_output_sha256_invalid");
  }
  if (declaredSizeBytes === null) reasons.push("materialised_output_size_missing_or_invalid");

  if (resolvedPath) {
    try {
      stat = await fsPromises.stat(resolvedPath);
      if (!stat.isFile()) reasons.push("materialised_output_not_regular_file");
      else if (stat.size <= 0) reasons.push("materialised_output_file_empty");
      else currentSha256 = await sha256File(resolvedPath);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        reasons.push("materialised_output_file_missing");
      } else {
        reasons.push("materialised_output_file_unreadable");
      }
    }
  }

  if (stat?.isFile() && declaredSizeBytes !== null && stat.size !== declaredSizeBytes) {
    reasons.push("materialised_output_size_stale");
  }
  if (
    currentSha256 &&
    SHA256_RE.test(declaredSha256) &&
    currentSha256 !== declaredSha256
  ) {
    reasons.push("materialised_output_sha256_stale");
  }

  return {
    output_index: outputIndex,
    path: declaredPath || null,
    resolved_path: resolvedPath || null,
    declared_sha256: declaredSha256 || null,
    declared_size_bytes: declaredSizeBytes,
    current_sha256: currentSha256,
    current_size_bytes: stat?.isFile() ? stat.size : null,
    current: reasons.length === 0,
    reasons: unique(reasons),
  };
}

function inspectProjectRecord(project, inputIndex, requiredPlatforms) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    return {
      input_index: inputIndex,
      raw: project,
      project_id: "",
      master_sha256: "",
      visual_fingerprint: "",
      grammar_identity: "",
      rights: { rights_grant: null, owned: false, owned_flag: null, allowed_platforms: [] },
      outputs: [],
      reasons: ["generator_project_record_invalid"],
    };
  }

  const projectId = firstFieldValue(project, PROJECT_ID_FIELDS);
  const masterSha256 = normaliseSha256(firstFieldValue(project, MASTER_HASH_FIELDS));
  const visualFingerprint = normaliseSha256(
    firstFieldValue(project, VISUAL_FINGERPRINT_FIELDS),
  );
  const grammarIdentity = designGrammarIdentity(project);
  const rights = rightsEvidence(project);
  const reasons = [];

  if (!projectId) reasons.push("generator_project_id_missing");
  else if (!STABLE_ID_RE.test(projectId) || PLACEHOLDER_RE.test(projectId)) {
    reasons.push("generator_project_id_invalid_or_unstable");
  }
  if (!masterSha256) reasons.push("generator_master_sha256_missing");
  else if (!SHA256_RE.test(masterSha256)) reasons.push("generator_master_sha256_invalid");
  if (!visualFingerprint) reasons.push("sampled_visual_fingerprint_missing");
  else if (!SHA256_RE.test(visualFingerprint)) {
    reasons.push("sampled_visual_fingerprint_invalid");
  }
  if (!grammarIdentity || PLACEHOLDER_RE.test(grammarIdentity)) {
    reasons.push("design_grammar_identity_missing");
  }
  if (isPlaceholderProject(project, projectId)) {
    reasons.push("placeholder_generator_project_rejected");
  }
  if (isStaticOrStillLoop(project)) {
    reasons.push("static_or_still_loop_generator_project_rejected");
  }
  if (isCardOrTemplateOnly(project)) {
    reasons.push("card_or_readable_template_only_generator_project_rejected");
  }
  if (!rights.owned) reasons.push("owned_rights_grant_missing");
  if (!rights.allowed_platforms.length) reasons.push("allowed_platforms_missing");
  if (
    rights.allowed_platforms.length &&
    requiredPlatforms.some((platform) => !rights.allowed_platforms.includes(platform))
  ) {
    reasons.push("required_platform_rights_missing");
  }

  return {
    input_index: inputIndex,
    raw: project,
    project_id: projectId,
    master_sha256: masterSha256,
    visual_fingerprint: visualFingerprint,
    grammar_identity: grammarIdentity,
    rights,
    outputs: projectOutputs(project),
    reasons: unique(reasons),
  };
}

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index) {
    if (this.parent[index] !== index) this.parent[index] = this.find(this.parent[index]);
    return this.parent[index];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}

function exactIdentityGroups(rows) {
  const sets = new DisjointSet(rows.length);
  const ownerByIdentity = new Map();
  rows.forEach((row, rowIndex) => {
    const aliases = [
      row.project_id ? `project:${normaliseProjectId(row.project_id)}` : "",
      SHA256_RE.test(row.master_sha256) ? `master:${row.master_sha256}` : "",
      SHA256_RE.test(row.visual_fingerprint)
        ? `visual:${row.visual_fingerprint}`
        : "",
    ].filter(Boolean);
    for (const alias of aliases) {
      const owner = ownerByIdentity.get(alias);
      if (owner !== undefined) sets.union(rowIndex, owner);
      else ownerByIdentity.set(alias, rowIndex);
    }
  });

  const groups = new Map();
  rows.forEach((row, rowIndex) => {
    const root = sets.find(rowIndex);
    const group = groups.get(root) || [];
    group.push(row);
    groups.set(root, group);
  });
  return [...groups.values()]
    .map((group) => group.sort((left, right) => left.input_index - right.input_index))
    .sort((left, right) => left[0].input_index - right[0].input_index);
}

async function inspectGroup(rows, workspaceRoot) {
  const projectIds = unique(rows.map((row) => row.project_id).filter(Boolean));
  const masters = unique(
    rows.map((row) => row.master_sha256).filter((value) => SHA256_RE.test(value)),
  );
  const visuals = unique(
    rows.map((row) => row.visual_fingerprint).filter((value) => SHA256_RE.test(value)),
  );
  const grammars = unique(rows.map((row) => row.grammar_identity).filter(Boolean));
  const outputs = rows.flatMap((row) => row.outputs);
  const materialisedOutputs = await Promise.all(
    outputs.map((output, index) => inspectOutput(output, index, workspaceRoot)),
  );
  const reasons = unique([
    ...rows.flatMap((row) => row.reasons),
    ...(!outputs.length ? ["materialised_output_missing"] : []),
    ...materialisedOutputs.flatMap((output) => output.reasons),
  ]);
  const canonical = rows[0];
  const allowedPlatforms = unique(
    rows.flatMap((row) => row.rights.allowed_platforms),
  ).sort();

  return {
    input_indexes: rows.map((row) => row.input_index),
    generator_project_id: canonical.project_id || null,
    generator_project_id_aliases: projectIds,
    generator_master_sha256: canonical.master_sha256 || null,
    generator_master_sha256_aliases: masters,
    sampled_visual_fingerprint: canonical.visual_fingerprint || null,
    sampled_visual_fingerprint_aliases: visuals,
    design_grammar_identity: canonical.grammar_identity || null,
    design_grammar_identity_aliases: grammars,
    rights: {
      rights_grant: canonical.rights.rights_grant,
      owned: rows.every((row) => row.rights.owned),
      allowed_platforms: allowedPlatforms,
    },
    materialised_outputs: materialisedOutputs,
    reasons,
  };
}

function resolveInvocation(input, options) {
  if (Array.isArray(input)) {
    return {
      projects: input,
      inputValid: true,
      configuration: options && typeof options === "object" ? options : {},
    };
  }
  if (input == null) {
    return {
      projects: [],
      inputValid: true,
      configuration: options && typeof options === "object" ? options : {},
    };
  }
  if (typeof input !== "object") {
    return { projects: [], inputValid: false, configuration: {} };
  }

  const declaredProjects = firstDefined([
    input.projects,
    input.generator_projects,
    input.generatorProjects,
    input.sources,
    input.clips,
  ]);
  return {
    projects: Array.isArray(declaredProjects) ? declaredProjects : [],
    inputValid: declaredProjects === undefined || Array.isArray(declaredProjects),
    configuration: {
      ...input,
      ...(options && typeof options === "object" ? options : {}),
    },
  };
}

function resolveMinimum(configuration) {
  const candidate = firstDefined([
    configuration.minimum,
    configuration.minimum_required,
    configuration.minimumRequired,
    configuration.minimum_generator_projects,
    configuration.minimumGeneratorProjects,
    configuration.required_generator_project_count,
    configuration.requiredGeneratorProjectCount,
  ]);
  if (candidate === undefined) {
    return { value: DEFAULT_MINIMUM_GENERATOR_PROJECTS, valid: true };
  }
  const numeric = Number(candidate);
  return Number.isInteger(numeric) && numeric >= DEFAULT_MINIMUM_GENERATOR_PROJECTS
    ? { value: numeric, valid: true }
    : { value: DEFAULT_MINIMUM_GENERATOR_PROJECTS, valid: false };
}

function resolveSimilarityThreshold(configuration) {
  const candidate = firstDefined([
    configuration.similarityThreshold,
    configuration.similarity_threshold,
    configuration.near_identical_similarity_threshold,
  ]);
  if (candidate === undefined) {
    return { value: DEFAULT_SIMILARITY_THRESHOLD, valid: true };
  }
  const numeric = Number(candidate);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1
    ? { value: numeric, valid: true }
    : { value: DEFAULT_SIMILARITY_THRESHOLD, valid: false };
}

function resolveRequiredPlatforms(configuration) {
  const candidate = firstDefined([
    configuration.requiredPlatforms,
    configuration.required_platforms,
    configuration.targetPlatforms,
    configuration.target_platforms,
  ]);
  if (candidate === undefined) return { values: [], valid: true };
  if (!Array.isArray(candidate)) return { values: [], valid: false };
  const values = unique(candidate.map(normalisePlatform).filter(Boolean)).sort();
  const valid = candidate.every(
    (platform) =>
      (typeof platform === "string" || typeof platform === "number") &&
      Boolean(normalisePlatform(platform)),
  );
  return { values, valid };
}

function similarityRows(configuration, inspectedRows) {
  const topLevel = firstDefined([
    configuration.similarityEvidence,
    configuration.similarity_evidence,
    configuration.project_similarity_evidence,
  ]);
  const rows = Array.isArray(topLevel) ? [...topLevel] : [];
  for (const project of inspectedRows) {
    const local = firstDefined([
      project.raw?.similarityEvidence,
      project.raw?.similarity_evidence,
    ]);
    if (!Array.isArray(local)) continue;
    for (const evidence of local) {
      rows.push({
        ...evidence,
        left_generator_project_id:
          evidence?.left_generator_project_id ||
          evidence?.left_project_id ||
          project.project_id,
      });
    }
  }
  return rows;
}

function normaliseSimilarityEvidence(raw, evidenceIndex, threshold) {
  const projectIds = asArray(raw?.generator_project_ids || raw?.project_ids);
  const leftId = cleanText(
    raw?.left_generator_project_id ||
      raw?.leftGeneratorProjectId ||
      raw?.left_project_id ||
      raw?.project_a ||
      raw?.left ||
      projectIds[0],
  );
  const rightId = cleanText(
    raw?.right_generator_project_id ||
      raw?.rightGeneratorProjectId ||
      raw?.right_project_id ||
      raw?.project_b ||
      raw?.right ||
      projectIds[1],
  );
  const score = Number(
    firstDefined([
      raw?.similarity_score,
      raw?.similarityScore,
      raw?.similarity,
      raw?.score,
    ]),
  );
  const localThresholdRaw = firstDefined([
    raw?.threshold,
    raw?.similarity_threshold,
    raw?.similarityThreshold,
  ]);
  const localThreshold =
    localThresholdRaw === undefined ? threshold : Number(localThresholdRaw);
  const valid =
    Boolean(leftId && rightId) &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 1 &&
    Number.isFinite(localThreshold) &&
    localThreshold >= 0 &&
    localThreshold <= 1;

  return {
    evidence_index: evidenceIndex,
    evidence_id: cleanText(raw?.evidence_id || raw?.evidenceId) || null,
    left_generator_project_id: leftId || null,
    right_generator_project_id: rightId || null,
    similarity_score: Number.isFinite(score) ? score : null,
    threshold: Number.isFinite(localThreshold) ? localThreshold : threshold,
    breaches_threshold: valid && score >= localThreshold,
    valid,
  };
}

function projectAliases(project) {
  return unique(
    [
      project.generator_project_id,
      ...asArray(project.generator_project_id_aliases),
    ]
      .map(normaliseProjectId)
      .filter(Boolean),
  );
}

function applySimilarityEvidence(acceptedProjects, evidenceRows) {
  const projectByAlias = new Map();
  for (const project of acceptedProjects) {
    for (const alias of projectAliases(project)) projectByAlias.set(alias, project);
  }

  const rejected = [];
  const rejectedIndexes = new Set();
  const globalBlockers = [];
  const breachingEvidence = [];
  for (const evidence of evidenceRows) {
    if (!evidence.valid) {
      globalBlockers.push("similarity_evidence_invalid");
      continue;
    }
    const left = projectByAlias.get(normaliseProjectId(evidence.left_generator_project_id));
    const right = projectByAlias.get(normaliseProjectId(evidence.right_generator_project_id));
    if (!left || !right) {
      globalBlockers.push("similarity_evidence_project_unresolved");
      continue;
    }
    if (left === right || !evidence.breaches_threshold) continue;
    breachingEvidence.push(evidence);

    const leftIndex = Math.min(...left.input_indexes);
    const rightIndex = Math.min(...right.input_indexes);
    const victim = leftIndex <= rightIndex ? right : left;
    const retained = victim === right ? left : right;
    const victimIndex = Math.min(...victim.input_indexes);
    if (rejectedIndexes.has(victimIndex)) continue;
    rejectedIndexes.add(victimIndex);
    rejected.push({
      ...victim,
      input_index: victimIndex,
      reasons: ["near_identical_generator_projects_rejected"],
      near_identical_to_generator_project_id: retained.generator_project_id,
      similarity_evidence: evidence,
    });
  }

  return {
    acceptedProjects: acceptedProjects.filter(
      (project) => !rejectedIndexes.has(Math.min(...project.input_indexes)),
    ),
    rejectedProjects: rejected,
    blockers: unique(globalBlockers),
    breachingEvidence,
  };
}

async function evaluateOwnedProceduralDiversity(input = [], options = {}) {
  const invocation = resolveInvocation(input, options);
  const minimum = resolveMinimum(invocation.configuration);
  const similarityThreshold = resolveSimilarityThreshold(invocation.configuration);
  const requiredPlatforms = resolveRequiredPlatforms(invocation.configuration);
  const workspaceRoot = path.resolve(
    cleanText(
      invocation.configuration.workspaceRoot ||
        invocation.configuration.workspace_root ||
        process.cwd(),
    ),
  );
  const inspectedRows = invocation.projects.map((project, index) =>
    inspectProjectRecord(project, index, requiredPlatforms.values),
  );
  const groups = exactIdentityGroups(inspectedRows);
  const inspectedGroups = await Promise.all(
    groups.map((group) => inspectGroup(group, workspaceRoot)),
  );
  const initiallyAccepted = inspectedGroups.filter((group) => group.reasons.length === 0);
  const invalidGroups = inspectedGroups
    .filter((group) => group.reasons.length > 0)
    .map((group) => ({
      ...group,
      input_index: group.input_indexes[0],
      duplicate_of_input_index: null,
    }));

  const suppliedSimilarity = similarityRows(invocation.configuration, inspectedRows);
  const normalisedSimilarity = suppliedSimilarity.map((row, index) =>
    normaliseSimilarityEvidence(row, index, similarityThreshold.value),
  );
  const similarity = applySimilarityEvidence(initiallyAccepted, normalisedSimilarity);
  const acceptedProjects = similarity.acceptedProjects.sort(
    (left, right) => left.input_indexes[0] - right.input_indexes[0],
  );
  const rejectedProjects = [
    ...invalidGroups,
    ...similarity.rejectedProjects,
  ].sort(
    (left, right) =>
      (left.input_index ?? left.input_indexes?.[0] ?? 0) -
      (right.input_index ?? right.input_indexes?.[0] ?? 0),
  );
  const observed = acceptedProjects.length;
  const minimumMet = minimum.valid && observed >= minimum.value;
  const breachingPairs = similarity.breachingEvidence;

  const blockers = [];
  if (!invocation.inputValid) blockers.push("owned_procedural_input_invalid");
  if (!minimum.valid) blockers.push("owned_procedural_minimum_invalid");
  if (!similarityThreshold.valid) blockers.push("similarity_threshold_invalid");
  if (!requiredPlatforms.valid) blockers.push("required_platforms_invalid");
  for (const rejected of rejectedProjects) blockers.push(...rejected.reasons);
  blockers.push(...similarity.blockers);
  if (!minimumMet) {
    blockers.push("owned_procedural_generator_project_minimum_not_met");
  }
  const uniqueBlockers = unique(blockers);
  const strictPass = uniqueBlockers.length === 0;
  const verdict = strictPass ? "GREEN" : "RED";

  return {
    schema_version: 1,
    evaluator_version: OWNED_PROCEDURAL_DIVERSITY_VERSION,
    version: OWNED_PROCEDURAL_DIVERSITY_VERSION,
    authoritative: true,
    verdict,
    status: verdict,
    strict_pass: strictPass,
    minimum_met: minimumMet,
    minimum_required_generator_project_count: minimum.value,
    observed_distinct_generator_project_count: observed,
    input_project_count: invocation.projects.length,
    collapsed_input_count: Math.max(0, invocation.projects.length - inspectedGroups.length),
    collapsed_project_groups: inspectedGroups
      .filter((project) => project.input_indexes.length > 1)
      .map((project) => ({
        generator_project_id: project.generator_project_id,
        input_indexes: project.input_indexes,
      })),
    accepted_project_count: acceptedProjects.length,
    rejected_project_count: rejectedProjects.length,
    accepted_projects: acceptedProjects,
    rejected_projects: rejectedProjects,
    similarity_evidence: normalisedSimilarity,
    checks: {
      minimum_distinct_generator_projects: {
        status: minimumMet ? "GREEN" : "RED",
        required: minimum.value,
        observed,
        configuration_valid: minimum.valid,
      },
      project_integrity: {
        status: rejectedProjects.length ? "RED" : "GREEN",
        input_valid: invocation.inputValid,
        rejected_project_count: rejectedProjects.length,
      },
      material_distinctness: {
        status:
          breachingPairs.length || similarity.blockers.length ? "RED" : "GREEN",
        similarity_threshold: similarityThreshold.value,
        threshold_configuration_valid: similarityThreshold.valid,
        supplied_similarity_evidence_count: normalisedSimilarity.length,
        breaching_pair_count: breachingPairs.length,
      },
      platform_rights: {
        status:
          rejectedProjects.some((project) =>
            asArray(project.reasons).some((reason) =>
              [
                "owned_rights_grant_missing",
                "allowed_platforms_missing",
                "required_platform_rights_missing",
              ].includes(reason),
            ),
          )
            ? "RED"
            : "GREEN",
        required_platforms: requiredPlatforms.values,
        configuration_valid: requiredPlatforms.valid,
      },
    },
    blockers: uniqueBlockers,
  };
}

module.exports = {
  OWNED_PROCEDURAL_DIVERSITY_VERSION,
  DEFAULT_MINIMUM_GENERATOR_PROJECTS,
  DEFAULT_SIMILARITY_THRESHOLD,
  evaluateOwnedProceduralDiversity,
  assessOwnedProceduralDiversity: evaluateOwnedProceduralDiversity,
};
