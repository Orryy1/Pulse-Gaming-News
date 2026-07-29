"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  RUNTIME_CAPABILITIES_SCHEMA,
} = require("./multi-lane-activation-evidence-collector");

const RUNTIME_DEPENDENCIES = Object.freeze([
  "produceNarration",
  "materializeAlignment",
  "renderLongform",
  "materializeVariants",
  "runDecodedQa",
  "materializeDerivatives",
]);

const RUNTIME_SAFETY_FLAGS = Object.freeze([
  "implicit_network_enabled",
  "implicit_process_spawn_enabled",
  "upload_authority",
  "oauth_mutation_authority",
  "database_mutation_authority",
]);

const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "generated_at",
  "ready",
  "blockers",
  "dependencies",
  "safety",
]);

const SECRET_SHAPED_KEY =
  /(?:^|_)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|credential|private[_-]?key|authorization|bearer)(?:_|$)/i;

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function safeBlocker(value) {
  const blocker = typeof value === "string" ? value.trim() : "";
  return /^[a-z0-9][a-z0-9_:.-]{0,255}$/i.test(blocker)
    ? blocker
    : "runtime_capability_probe_blocker_redacted";
}

function probeWeeklyLongformRuntimeCapabilities({
  env = process.env,
  generatedAt = new Date().toISOString(),
  buildRuntimeStack = null,
} = {}) {
  if (!Number.isFinite(Date.parse(generatedAt || ""))) {
    throw new Error("weekly_longform_runtime_capability_time_invalid");
  }
  const build =
    buildRuntimeStack ||
    require("./weekly-longform-runtime-factory")
      .buildWeeklyLongformRuntimeStack;
  const stack = build({ env });
  const runtime = stack?.runtime_capabilities || {};
  const rendererReady = stack?.renderer_capabilities?.ready === true;

  const dependencies = Object.fromEntries(
    RUNTIME_DEPENDENCIES.map((dependency) => {
      let available =
        runtime?.dependencies?.[dependency]?.available === true;
      if (dependency === "renderLongform") {
        available = available && rendererReady;
      }
      return [dependency, { available }];
    }),
  );
  const safetyValid = RUNTIME_SAFETY_FLAGS.every(
    (flag) => runtime?.safety?.[flag] === false,
  );
  const blockers = unique([
    ...(Array.isArray(stack?.capabilities?.blockers)
      ? stack.capabilities.blockers.map(safeBlocker)
      : []),
    ...RUNTIME_DEPENDENCIES.filter(
      (dependency) => !dependencies[dependency].available,
    ).map(
      (dependency) =>
        `weekly_longform_runtime_dependency_unavailable:${dependency}`,
    ),
    ...RUNTIME_SAFETY_FLAGS.filter(
      (flag) => runtime?.safety?.[flag] !== false,
    ).map(
      (flag) => `weekly_longform_runtime_safety_flag_invalid:${flag}`,
    ),
  ]);
  const ready =
    stack?.capabilities?.ready === true &&
    Object.values(dependencies).every(
      (dependency) => dependency.available === true,
    ) &&
    safetyValid &&
    blockers.length === 0;

  return {
    schema_version: RUNTIME_CAPABILITIES_SCHEMA,
    generated_at: new Date(generatedAt).toISOString(),
    ready,
    blockers,
    dependencies,
    safety: Object.fromEntries(
      RUNTIME_SAFETY_FLAGS.map((flag) => [flag, false]),
    ),
  };
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const observed = Object.keys(value).sort();
  const required = [...expected].sort();
  return (
    observed.length === required.length &&
    observed.every((key, index) => key === required[index])
  );
}

function findSecretShapedKeys(value, prefix = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      findSecretShapedKeys(child, `${prefix}[${index}]`, found),
    );
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${prefix}.${key}`;
    if (SECRET_SHAPED_KEY.test(key)) found.push(childPath);
    findSecretShapedKeys(child, childPath, found);
  }
  return found;
}

function assertRuntimeCapabilityDocument(document) {
  const blockers = [];
  if (!exactKeys(document, TOP_LEVEL_KEYS)) {
    blockers.push("runtime_capability_document_shape_invalid");
  }
  if (document?.schema_version !== RUNTIME_CAPABILITIES_SCHEMA) {
    blockers.push("runtime_capability_document_schema_invalid");
  }
  if (!Number.isFinite(Date.parse(document?.generated_at || ""))) {
    blockers.push("runtime_capability_document_time_invalid");
  }
  if (typeof document?.ready !== "boolean") {
    blockers.push("runtime_capability_document_ready_invalid");
  }
  if (
    !Array.isArray(document?.blockers) ||
    document.blockers.some(
      (blocker) =>
        typeof blocker !== "string" ||
        !/^[a-z0-9][a-z0-9_:.-]{0,255}$/i.test(blocker),
    )
  ) {
    blockers.push("runtime_capability_document_blockers_invalid");
  }
  if (!exactKeys(document?.dependencies, RUNTIME_DEPENDENCIES)) {
    blockers.push("runtime_capability_document_dependencies_invalid");
  } else {
    for (const dependency of RUNTIME_DEPENDENCIES) {
      const value = document.dependencies[dependency];
      if (
        !exactKeys(value, ["available"]) ||
        typeof value.available !== "boolean"
      ) {
        blockers.push(
          `runtime_capability_document_dependency_invalid:${dependency}`,
        );
      }
    }
  }
  if (!exactKeys(document?.safety, RUNTIME_SAFETY_FLAGS)) {
    blockers.push("runtime_capability_document_safety_invalid");
  } else {
    for (const flag of RUNTIME_SAFETY_FLAGS) {
      if (document.safety[flag] !== false) {
        blockers.push(
          `runtime_capability_document_safety_flag_invalid:${flag}`,
        );
      }
    }
  }
  const secretKeys = findSecretShapedKeys(document);
  blockers.push(
    ...secretKeys.map(
      (key) => `runtime_capability_secret_shaped_key_forbidden:${key}`,
    ),
  );
  if (blockers.length) {
    throw new Error(
      `weekly_longform_runtime_capability_document_invalid:${unique(
        blockers,
      ).join(",")}`,
    );
  }
  return document;
}

function renderWeeklyLongformRuntimeCapabilitiesJson(document) {
  assertRuntimeCapabilityDocument(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

function renderWeeklyLongformRuntimeCapabilitiesMarkdown(document) {
  assertRuntimeCapabilityDocument(document);
  return [
    "# Pulse Gaming Weekly Longform Runtime Capabilities",
    "",
    `Generated: ${document.generated_at}`,
    `Verdict: ${document.ready ? "READY" : "BLOCKED"}`,
    "",
    "## Dependencies",
    "",
    "| Dependency | Available |",
    "| --- | --- |",
    ...RUNTIME_DEPENDENCIES.map(
      (dependency) =>
        `| ${dependency} | ${
          document.dependencies[dependency].available ? "Yes" : "No"
        } |`,
    ),
    "",
    "## Blockers",
    "",
    ...(document.blockers.length
      ? document.blockers.map((blocker) => `- ${blocker}`)
      : ["- None"]),
    "",
    "## Safety",
    "",
    ...RUNTIME_SAFETY_FLAGS.map(
      (flag) => `- ${flag}: ${document.safety[flag] ? "true" : "false"}`,
    ),
    "",
    "This local probe performs no platform publication, database mutation or OAuth action. Credential values and hashes are never included.",
    "",
  ].join("\n");
}

function safeOutputDirectory(outputDirectory) {
  const input =
    typeof outputDirectory === "string" ? outputDirectory.trim() : "";
  if (!input) {
    throw new Error(
      "weekly_longform_runtime_capability_output_directory_required",
    );
  }
  const resolved = path.resolve(input);
  const parts = resolved
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
  if (
    parts.includes("tokens") ||
    parts.some(
      (part) => part === ".env" || part.startsWith(".env."),
    )
  ) {
    throw new Error(
      "weekly_longform_runtime_capability_secret_path_forbidden",
    );
  }
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(
        "weekly_longform_runtime_capability_output_directory_invalid",
      );
    }
  }
  return resolved;
}

function preflightImmutable(filePath, bytes) {
  if (!fs.existsSync(filePath)) return { write: true };
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      `weekly_longform_runtime_capability_immutable_conflict:${path.basename(
        filePath,
      )}`,
    );
  }
  const existing = fs.readFileSync(filePath);
  if (!existing.equals(bytes)) {
    throw new Error(
      `weekly_longform_runtime_capability_immutable_conflict:${path.basename(
        filePath,
      )}`,
    );
  }
  return { write: false };
}

function persistWeeklyLongformRuntimeCapabilities({
  document,
  outputDirectory,
} = {}) {
  const resolvedDirectory = safeOutputDirectory(outputDirectory);
  const jsonPath = path.join(
    resolvedDirectory,
    "weekly-longform-runtime-capabilities.json",
  );
  const markdownPath = path.join(
    resolvedDirectory,
    "weekly-longform-runtime-capabilities.md",
  );
  const jsonBytes = Buffer.from(
    renderWeeklyLongformRuntimeCapabilitiesJson(document),
    "utf8",
  );
  const markdownBytes = Buffer.from(
    renderWeeklyLongformRuntimeCapabilitiesMarkdown(document),
    "utf8",
  );
  const jsonPlan = preflightImmutable(jsonPath, jsonBytes);
  const markdownPlan = preflightImmutable(markdownPath, markdownBytes);

  fs.mkdirSync(resolvedDirectory, { recursive: true });
  if (jsonPlan.write) fs.writeFileSync(jsonPath, jsonBytes, { flag: "wx" });
  if (markdownPlan.write) {
    fs.writeFileSync(markdownPath, markdownBytes, { flag: "wx" });
  }
  return {
    json_path: jsonPath,
    markdown_path: markdownPath,
    json_written: jsonPlan.write,
    markdown_written: markdownPlan.write,
  };
}

module.exports = {
  RUNTIME_CAPABILITIES_SCHEMA,
  RUNTIME_DEPENDENCIES,
  RUNTIME_SAFETY_FLAGS,
  assertRuntimeCapabilityDocument,
  persistWeeklyLongformRuntimeCapabilities,
  probeWeeklyLongformRuntimeCapabilities,
  renderWeeklyLongformRuntimeCapabilitiesJson,
  renderWeeklyLongformRuntimeCapabilitiesMarkdown,
};
