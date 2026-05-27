"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const AUDIO_EXTENSIONS = /\.(wav|flac|mp3|aiff?|ogg|m4a)$/i;

const MUSIC_ROLE_FOLDERS = {
  bed_primary: "music/bed_primary",
  bed_breaking: "music/bed_breaking",
  sting_verified: "stings/sting_verified",
  sting_rumour: "stings/sting_rumour",
  sting_breaking: "stings/sting_breaking",
  stem: "stems",
};

const SFX_ROLES = ["impact", "transition", "ui_tick", "riser", "sub_hit", "glitch"];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalisePath(value) {
  return cleanText(value).replace(/\\/g, "/");
}

function uniqueByPath(files = []) {
  const seen = new Set();
  const result = [];
  for (const file of files) {
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }
  return result;
}

function scanAudioFiles(root, { maxDepth = 3 } = {}) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > maxDepth) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(fullPath).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (isDir) {
        stack.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (AUDIO_EXTENSIONS.test(entry.name)) files.push(fullPath);
    }
  }
  return uniqueByPath(files).sort((a, b) => normalisePath(a).localeCompare(normalisePath(b)));
}

function filterFilesBySince(files = [], sinceIso = "") {
  const since = Date.parse(cleanText(sinceIso));
  if (!Number.isFinite(since)) return files;
  return files.filter((file) => {
    try {
      return fs.statSync(file).mtimeMs >= since;
    } catch {
      return false;
    }
  });
}

function musicTargetForRole(role) {
  return MUSIC_ROLE_FOLDERS[role] || "";
}

function classifyDownloadedEpidemicFile(filePath, roleHint = "") {
  const hint = cleanText(roleHint).toLowerCase();
  if (hint && MUSIC_ROLE_FOLDERS[hint]) {
    return { role: hint, target_folder: MUSIC_ROLE_FOLDERS[hint], asset_type: "music", matched_by: "role_hint" };
  }
  if (hint && SFX_ROLES.includes(hint)) {
    return { role: hint, target_folder: "sfx", asset_type: "sfx", matched_by: "role_hint" };
  }

  const rawText = normalisePath(filePath).toLowerCase();
  for (const [role, targetFolder] of Object.entries(MUSIC_ROLE_FOLDERS)) {
    const dashRole = role.replace(/_/g, "-");
    if (rawText.includes(`epidemic_${role}_`) || rawText.includes(`epidemic-${dashRole}-`)) {
      return {
        role,
        target_folder: targetFolder,
        asset_type: "music",
        matched_by: "epidemic_filename_prefix",
      };
    }
  }
  for (const role of SFX_ROLES) {
    const dashRole = role.replace(/_/g, "-");
    if (rawText.includes(`epidemic_${role}_`) || rawText.includes(`epidemic-${dashRole}-`)) {
      return { role, target_folder: "sfx", asset_type: "sfx", matched_by: "epidemic_filename_prefix" };
    }
  }

  const text = rawText.replace(/[_-]+/g, " ");
  if (/\b(?:stem|stems|drums|bass|instrumental layer|melody)\b/.test(text)) {
    return { role: "stem", target_folder: "stems", asset_type: "music", matched_by: "filename_semantics" };
  }
  if (/\b(?:rumou?r|leak)\b/.test(text) && /\b(?:sting|stinger|hit|watch)\b/.test(text)) {
    return {
      role: "sting_rumour",
      target_folder: "stings/sting_rumour",
      asset_type: "music",
      matched_by: "filename_semantics",
    };
  }
  if (/\b(?:breaking|urgent|alert)\b/.test(text) && /\b(?:sting|stinger|hit|impact)\b/.test(text)) {
    return {
      role: "sting_breaking",
      target_folder: "stings/sting_breaking",
      asset_type: "music",
      matched_by: "filename_semantics",
    };
  }
  if (/\b(?:verified|source|lock|confirm|confirmed|official)\b/.test(text) && /\b(?:sting|stinger|hit)\b/.test(text)) {
    return {
      role: "sting_verified",
      target_folder: "stings/sting_verified",
      asset_type: "music",
      matched_by: "filename_semantics",
    };
  }
  if (/\b(?:breaking|urgent|alert|fast|high[-_ ]?energy)\b/.test(text) && /\b(?:bed|loop|music|underscore)\b/.test(text)) {
    return {
      role: "bed_breaking",
      target_folder: "music/bed_breaking",
      asset_type: "music",
      matched_by: "filename_semantics",
    };
  }
  if (/\b(?:main|primary|news|background)\b/.test(text) && /\b(?:bed|loop|music|underscore)\b/.test(text)) {
    return {
      role: "bed_primary",
      target_folder: "music/bed_primary",
      asset_type: "music",
      matched_by: "filename_semantics",
    };
  }
  if (/\b(?:glitch|static|digital|bitcrush|stutter)\b/.test(text)) {
    return { role: "glitch", target_folder: "sfx", asset_type: "sfx", matched_by: "filename_semantics" };
  }
  if (/\b(?:riser|rise|swell|build|tension)\b/.test(text)) {
    return { role: "riser", target_folder: "sfx", asset_type: "sfx", matched_by: "filename_semantics" };
  }
  if (/\b(?:whoosh|swoosh|swipe|transition|sweep)\b/.test(text)) {
    return { role: "transition", target_folder: "sfx", asset_type: "sfx", matched_by: "filename_semantics" };
  }
  if (/\b(?:ui|tick|click|beep|button|select)\b/.test(text)) {
    return { role: "ui_tick", target_folder: "sfx", asset_type: "sfx", matched_by: "filename_semantics" };
  }
  if (/\b(?:sub|boom|bass[-_ ]?drop|low[-_ ]?hit)\b/.test(text)) {
    return { role: "sub_hit", target_folder: "sfx", asset_type: "sfx", matched_by: "filename_semantics" };
  }
  if (/\b(?:impact|hit|slam|thud|punch|cinematic)\b/.test(text)) {
    return { role: "impact", target_folder: "sfx", asset_type: "sfx", matched_by: "filename_semantics" };
  }
  return { role: "", target_folder: "", asset_type: "", matched_by: "" };
}

function targetPathFor({ sourcePath, targetRoot, targetFolder }) {
  return path.join(targetRoot, targetFolder, path.basename(sourcePath));
}

function buildEpidemicDownloadIntakePlan({
  workspaceRoot = process.cwd(),
  sourceDir = path.join(process.env.USERPROFILE || process.env.HOME || workspaceRoot, "Downloads"),
  targetRoot = path.join(workspaceRoot, "audio", "epidemic"),
  generatedAt = new Date().toISOString(),
  roleHint = "",
  sinceIso = "",
  allowUnprefixed = false,
} = {}) {
  const resolvedSource = path.resolve(workspaceRoot, sourceDir);
  const resolvedTarget = path.resolve(workspaceRoot, targetRoot);
  const files = filterFilesBySince(scanAudioFiles(resolvedSource), sinceIso);
  const plannedCopies = [];
  const needsReview = [];

  for (const file of files) {
    const classification = classifyDownloadedEpidemicFile(file, roleHint);
    if (!classification.role || !classification.target_folder) {
      needsReview.push({
        source_path: file,
        reason: "epidemic_download_role_not_detected",
      });
      continue;
    }
    if (!allowUnprefixed && !roleHint && classification.matched_by !== "epidemic_filename_prefix") {
      needsReview.push({
        source_path: file,
        reason: "epidemic_download_prefix_required",
        detected_role: classification.role,
        matched_by: classification.matched_by,
      });
      continue;
    }
    plannedCopies.push({
      source_path: file,
      target_path: targetPathFor({
        sourcePath: file,
        targetRoot: resolvedTarget,
        targetFolder: classification.target_folder,
      }),
      role: classification.role,
      target_folder: classification.target_folder,
      asset_type: classification.asset_type,
      matched_by: classification.matched_by,
      action: "copy",
    });
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "dry_run",
    source_dir: resolvedSource,
    target_root: resolvedTarget,
    since_iso: cleanText(sinceIso) || null,
    prefix_required: !allowUnprefixed && !cleanText(roleHint),
    allow_unprefixed: Boolean(allowUnprefixed),
    summary: {
      candidate_files: files.length,
      planned_copies: plannedCopies.length,
      needs_review: needsReview.length,
      copied_files: 0,
    },
    planned_copies: plannedCopies,
    needs_review: needsReview,
    safety: {
      copy_only: true,
      no_source_deletion: true,
      no_downloads_started: true,
      no_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_or_token_read: true,
    },
  };
}

async function executeEpidemicDownloadIntake(options = {}) {
  const plan = buildEpidemicDownloadIntakePlan(options);
  const apply = Boolean(options.apply);
  let copied = 0;
  if (apply) {
    for (const item of plan.planned_copies) {
      await fs.ensureDir(path.dirname(item.target_path));
      await fs.copy(item.source_path, item.target_path, { overwrite: true, errorOnExist: false });
      copied += 1;
    }
  }
  return {
    ...plan,
    mode: apply ? "apply" : "dry_run",
    summary: {
      ...plan.summary,
      copied_files: copied,
    },
  };
}

module.exports = {
  buildEpidemicDownloadIntakePlan,
  classifyDownloadedEpidemicFile,
  executeEpidemicDownloadIntake,
  filterFilesBySince,
  musicTargetForRole,
  scanAudioFiles,
};
