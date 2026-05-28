"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  EPIDEMIC_PROVIDER,
  REQUIRED_MUSIC_ROLES,
  REQUIRED_SFX_ROLES,
} = require("./epidemic-sound-intake");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalisePath(value) {
  return cleanText(value).replace(/\\/g, "/");
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(cleanText).filter(Boolean)));
}

function normaliseChannelIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return unique(values.flatMap((item) => String(item || "").split(",")));
}

function relativeRoot(workspaceRoot, root) {
  const rel = normalisePath(path.relative(workspaceRoot, root || ""));
  return rel && !rel.startsWith("..") ? rel : normalisePath(root);
}

function assetExists(asset = {}) {
  const filePath = asset.path || "";
  return Boolean(filePath && fs.existsSync(filePath));
}

function musicByRole(report = {}) {
  const map = new Map();
  for (const asset of asArray(report.music_inventory)) {
    if (!map.has(asset.role)) map.set(asset.role, asset);
  }
  return map;
}

function rightsByAssetId(report = {}) {
  const map = new Map();
  for (const record of asArray(report.rights_ledger?.records)) {
    if (record.asset_id) map.set(record.asset_id, record);
  }
  return map;
}

function plannedChannels(report = {}, channelIds = []) {
  const requestedChannelIds = normaliseChannelIds(channelIds);
  const channels = asArray(report.download_plan?.channels);
  const planned = channels.length ? channels : unique(asArray(report.audio_pack_candidates).map((pack) => pack.channel_id)).map((channelId) => ({
    channel_id: channelId,
    name: `${channelId} Epidemic Sound`,
  }));
  if (!requestedChannelIds.length) return planned;
  const requested = new Set(requestedChannelIds);
  return planned.filter((channel) => requested.has(channel.channel_id));
}

function buildChannelPack({ channel, musicAssets, rootPath }) {
  return {
    id: `${channel.channel_id}-epidemic-v1`,
    channel_id: channel.channel_id,
    name: channel.name || `${channel.channel_id} Epidemic Sound`,
    root_path: rootPath,
    license: EPIDEMIC_PROVIDER.licence_basis,
    _note: "Generated from a PASS Epidemic Sound intake report. Keep safelist evidence with the proof package before publishing.",
    assets: REQUIRED_MUSIC_ROLES.map((role) => {
      const asset = musicAssets.get(role);
      return {
        role,
        filename: asset.filename,
        duration_ms: asset.duration_ms || null,
        loudness_lufs: asset.loudness_lufs || null,
        license: asset.licence_basis,
        provider_id: asset.provider_id,
        asset_id: asset.asset_id,
        safelist_evidence: asset.safelist_evidence,
        notes: `${asset.provider_name || EPIDEMIC_PROVIDER.provider_name} ${role}`,
      };
    }),
  };
}

function buildSfxRuntimeManifest(report = {}, blockers = []) {
  const sourcePlan = report.sfx_source_plan || {};
  const selectedAssets = asArray(sourcePlan.selected_assets);
  const rightsRecords = asArray(report.rights_ledger?.records).filter((record) => record.asset_type === "sfx");
  return {
    schema_version: 1,
    provider_id: EPIDEMIC_PROVIDER.provider_id,
    provider_name: EPIDEMIC_PROVIDER.provider_name,
    readiness: {
      status: blockers.length ? "blocked" : "ready",
      blockers: blockers.filter((blocker) => String(blocker).startsWith("sfx_source:")),
    },
    required_roles: [...REQUIRED_SFX_ROLES],
    covered_roles: asArray(sourcePlan.covered_roles),
    selected_assets: selectedAssets,
    rights_records: rightsRecords,
    source_plan: sourcePlan,
    safety: {
      local_only: true,
      no_downloads_started: true,
      no_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function collectBlockers(report = {}, { workspaceRoot = process.cwd(), channelIds = [] } = {}) {
  const blockers = [];
  const add = (value) => {
    const text = cleanText(value);
    if (text && !blockers.includes(text)) blockers.push(text);
  };

  for (const blocker of asArray(report.readiness?.blockers)) add(blocker);
  if (report.readiness?.status !== "pass") add("epidemic:intake_not_pass");
  if (!report.summary?.safelist_evidence_present) add("epidemic:safelist_evidence_missing");

  const musicAssets = musicByRole(report);
  const rights = rightsByAssetId(report);
  for (const role of REQUIRED_MUSIC_ROLES) {
    const asset = musicAssets.get(role);
    if (!asset) {
      add(`epidemic:missing_music_role:${role}`);
      continue;
    }
    if (!assetExists(asset)) add(`epidemic:music_file_missing:${role}`);
    if (!rights.has(asset.asset_id)) add(`epidemic:music_rights_missing:${role}`);
  }

  const sfxReadiness = report.sfx_source_plan?.readiness;
  if (sfxReadiness?.status !== "pass") add("epidemic:sfx_source_plan_not_pass");
  for (const blocker of asArray(sfxReadiness?.blockers)) add(blocker);
  for (const role of REQUIRED_SFX_ROLES) {
    if (!asArray(report.sfx_source_plan?.covered_roles).includes(role)) {
      add(`sfx_source:missing_role:${role}`);
    }
  }

  if (!plannedChannels(report, channelIds).length) add("epidemic:no_channels_planned");
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) add("epidemic:workspace_root_missing");

  return blockers;
}

function buildEpidemicSoundImplementationPlan({
  workspaceRoot = process.cwd(),
  report = {},
  generatedAt = new Date().toISOString(),
  channelIds = [],
} = {}) {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const requestedChannelIds = normaliseChannelIds(channelIds);
  const rootPath = relativeRoot(resolvedWorkspace, report.root || path.join(resolvedWorkspace, "audio", "epidemic"));
  const blockers = collectBlockers(report, { workspaceRoot: resolvedWorkspace, channelIds: requestedChannelIds });
  const warnings = unique([
    ...asArray(report.readiness?.warnings),
    "epidemic:do_not_use_after_subscription_ends_without_separate_licence",
  ]);
  const ready = blockers.length === 0;
  const musicAssets = musicByRole(report);
  const channels = plannedChannels(report, requestedChannelIds);
  const channelPacks = ready
    ? channels.map((channel) => buildChannelPack({ channel, musicAssets, rootPath }))
    : [];
  const channelPackWrites = ready
    ? channelPacks.map((pack) => ({
      channel_id: pack.channel_id,
      pack_id: pack.id,
      path: normalisePath(path.join(resolvedWorkspace, "channels", pack.channel_id, "audio", "pack.json")),
      action: "write_channel_pack_config",
      backup_path: normalisePath(path.join(resolvedWorkspace, "channels", pack.channel_id, "audio", "pack.json.pre-epidemic-backup")),
    }))
    : [];

  const sfxRuntimeManifest = buildSfxRuntimeManifest(report, blockers);
  const rightsRecords = asArray(report.rights_ledger?.records);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "epidemic_sound_implementation_plan",
    provider: EPIDEMIC_PROVIDER,
    root_path: rootPath,
    channel_filter: {
      requested_channel_ids: requestedChannelIds,
      planned_channel_ids: channels.map((channel) => channel.channel_id),
      apply_requires_explicit_scope: true,
    },
    readiness: {
      status: ready ? "ready" : "blocked",
      blockers,
      warnings,
    },
    summary: {
      channel_packs_planned: channelPacks.length,
      channel_packs_written: 0,
      music_roles_covered: REQUIRED_MUSIC_ROLES.filter((role) => musicAssets.has(role)).length,
      sfx_roles_covered: asArray(report.sfx_source_plan?.covered_roles).length,
      rights_records: rightsRecords.length,
    },
    channel_packs: channelPacks,
    sfx_runtime_manifest: sfxRuntimeManifest,
    apply_plan: {
      requested: false,
      channel_pack_writes: channelPackWrites,
      db_mutation: false,
      publishing: false,
    },
    safety: {
      local_only: true,
      no_downloads_started: true,
      no_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_or_token_read: true,
      no_audio_binary_commit_required: true,
    },
  };
}

async function writeChannelPack(pack, write) {
  const targetPath = write.path;
  const backupPath = write.backup_path;
  await fs.ensureDir(path.dirname(targetPath));
  if (await fs.pathExists(targetPath)) {
    if (!(await fs.pathExists(backupPath))) {
      await fs.copy(targetPath, backupPath, { overwrite: false, errorOnExist: false });
    }
  }
  await fs.writeJson(targetPath, pack, { spaces: 2 });
  return targetPath;
}

function renderImplementationMarkdown(plan = {}) {
  const lines = [];
  lines.push("# Epidemic Sound Implementation Report");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at || "(unknown)"}`);
  lines.push(`Readiness: ${plan.readiness?.status || "unknown"}`);
  lines.push("");
  if (plan.readiness?.blockers?.length) {
    lines.push("## Blockers");
    for (const blocker of plan.readiness.blockers) lines.push(`- ${blocker}`);
    lines.push("");
  }
  if (plan.readiness?.warnings?.length) {
    lines.push("## Warnings");
    for (const warning of plan.readiness.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  lines.push("## Summary");
  lines.push(`- Channel packs planned: ${Number(plan.summary?.channel_packs_planned || 0)}`);
  lines.push(`- Channel packs written: ${Number(plan.summary?.channel_packs_written || 0)}`);
  lines.push(`- Channel scope: ${asArray(plan.channel_filter?.planned_channel_ids).join(", ") || "(none)"}`);
  lines.push(`- Music roles covered: ${Number(plan.summary?.music_roles_covered || 0)}`);
  lines.push(`- SFX roles covered: ${Number(plan.summary?.sfx_roles_covered || 0)}`);
  lines.push(`- Rights records: ${Number(plan.summary?.rights_records || 0)}`);
  lines.push("");
  if (plan.apply_plan?.channel_pack_writes?.length) {
    lines.push("## Channel Pack Writes");
    for (const item of plan.apply_plan.channel_pack_writes) {
      lines.push(`- ${item.channel_id}: ${item.path}`);
    }
    lines.push("");
  }
  lines.push("## Safety");
  if (plan.safety?.no_downloads_started) lines.push("- No downloads were started.");
  if (plan.safety?.no_posting) lines.push("- No publishing APIs were called.");
  if (plan.safety?.no_db_mutation) lines.push("- No database rows were mutated.");
  if (plan.safety?.no_oauth_or_token_change) lines.push("- No OAuth or token settings were changed.");
  if (plan.safety?.no_secret_or_token_read) lines.push("- No secrets or token files were read.");
  return `${lines.join("\n").trimEnd()}\n`;
}

async function writeImplementationOutputs(plan, { outputDir } = {}) {
  const outDir = path.resolve(outputDir || path.join("output", "epidemic-implementation"));
  await fs.ensureDir(outDir);
  const outputs = {
    reportPath: path.join(outDir, "epidemic_sound_implementation_report.json"),
    channelPacksPath: path.join(outDir, "epidemic_channel_packs.json"),
    sfxRuntimeManifestPath: path.join(outDir, "epidemic_sfx_runtime_manifest.json"),
    blockersPath: path.join(outDir, "blocked_epidemic_implementation_reasons.json"),
    markdownPath: path.join(outDir, "epidemic_sound_implementation_report.md"),
  };
  await fs.writeJson(outputs.reportPath, plan, { spaces: 2 });
  await fs.writeJson(outputs.channelPacksPath, plan.channel_packs || [], { spaces: 2 });
  await fs.writeJson(outputs.sfxRuntimeManifestPath, plan.sfx_runtime_manifest || {}, { spaces: 2 });
  await fs.writeJson(outputs.blockersPath, plan.readiness?.blockers || [], { spaces: 2 });
  await fs.writeFile(outputs.markdownPath, renderImplementationMarkdown(plan));
  return outputs;
}

async function executeEpidemicSoundImplementation({
  workspaceRoot = process.cwd(),
  report = {},
  outputDir = path.join("output", "epidemic-implementation"),
  generatedAt = new Date().toISOString(),
  apply = false,
  channelIds = [],
} = {}) {
  const requestedChannelIds = normaliseChannelIds(channelIds);
  const plan = buildEpidemicSoundImplementationPlan({
    workspaceRoot,
    report,
    generatedAt,
    channelIds: requestedChannelIds,
  });
  plan.apply_plan.requested = Boolean(apply);
  if (apply && !requestedChannelIds.length) {
    if (!plan.readiness.blockers.includes("epidemic:channel_scope_required_for_apply")) {
      plan.readiness.blockers.push("epidemic:channel_scope_required_for_apply");
    }
    plan.readiness.status = "blocked";
  }
  if (apply && plan.readiness.status === "ready") {
    const writes = [];
    for (const pack of plan.channel_packs) {
      const write = plan.apply_plan.channel_pack_writes.find((item) => item.pack_id === pack.id);
      writes.push(await writeChannelPack(pack, write));
    }
    plan.summary.channel_packs_written = writes.length;
    plan.readiness.status = "applied";
    plan.apply_plan.written_paths = writes.map(normalisePath);
  }
  const outputs = await writeImplementationOutputs(plan, { outputDir });
  return { plan, outputs };
}

module.exports = {
  buildEpidemicSoundImplementationPlan,
  collectBlockers,
  executeEpidemicSoundImplementation,
  normaliseChannelIds,
  renderImplementationMarkdown,
};
