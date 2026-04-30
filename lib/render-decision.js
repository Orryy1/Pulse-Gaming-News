"use strict";

/**
 * lib/render-decision.js — orchestrator that gathers contract inputs
 * and produces a single decision per story.
 *
 * Wraps three pure modules:
 *   - lib/render-contract.evaluateRenderContract
 *   - lib/topicality-gate.evaluatePulseGamingTopicality
 *   - lib/text-hygiene.classifyTextHygiene
 *
 * Plus, when SQLite is available:
 *   - lib/repositories/media_provenance.listForStory (provenance rows)
 *
 * Used by:
 *   - publisher.js (gate decision before publish)
 *   - tools/render-contract-report.js (operator audit)
 *   - lib/job-handlers.js renderPublishSummary (Discord exposure)
 *
 * Defensive: every dependency is optional. When a module fails to
 * load, we fall back to a contract evaluation without that input
 * (the contract gracefully treats `undefined` as "not stamped").
 */

function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

/**
 * Run a full decision pass for one story.
 *
 * @param {object} story
 * @param {object} [opts]
 *   - env, repos, deps for testability
 *
 * @returns {{
 *   verdict: contract verdict object,
 *   gate: { allowed: boolean, reason?: string },
 *   inputs: { topicality?, hygiene?, provenance_count? },
 * }}
 */
async function decideForStory(story, opts = {}) {
  const env = opts.env || process.env;
  const repos = opts.repos !== undefined ? opts.repos : null;
  const contract = opts.renderContract || safeRequire("./render-contract");
  if (!contract) {
    // No contract module = catastrophic boot. Default to reject so
    // we never publish without explicit verdict.
    return {
      verdict: {
        class: "reject",
        reasons: ["render_contract_module_missing"],
        missing: [],
        sources_used: [],
        contract_version: 0,
      },
      gate: { allowed: false, reason: "no_contract_module" },
      inputs: {},
    };
  }

  const topicalityMod =
    opts.topicalityModule || safeRequire("./topicality-gate");
  const textHygieneMod =
    opts.textHygieneModule || safeRequire("./text-hygiene");

  // Topicality verdict
  let topicalityResult;
  if (
    topicalityMod &&
    typeof topicalityMod.evaluatePulseGamingTopicality === "function"
  ) {
    try {
      topicalityResult = topicalityMod.evaluatePulseGamingTopicality(story, {
        channelId: story?.channel_id || "pulse-gaming",
      });
    } catch {
      topicalityResult = { decision: "review", reasons: ["evaluation_error"] };
    }
  }

  // Title text hygiene
  let textHygiene;
  if (
    textHygieneMod &&
    typeof textHygieneMod.classifyTextHygiene === "function" &&
    story?.title
  ) {
    try {
      textHygiene = textHygieneMod.classifyTextHygiene(story.title);
    } catch {
      textHygiene = undefined;
    }
  }

  // Provenance rows for premium-source check (best-effort)
  let provenanceRows = opts.provenanceRows;
  if (provenanceRows === undefined) {
    let activeRepos = repos;
    if (!activeRepos) {
      try {
        activeRepos = require("./repositories").getRepos();
      } catch {
        activeRepos = null;
      }
    }
    if (activeRepos && activeRepos.mediaProvenance && story?.id) {
      try {
        provenanceRows = activeRepos.mediaProvenance.listForStory(story.id);
      } catch {
        provenanceRows = [];
      }
    } else {
      provenanceRows = [];
    }
  }

  const verdict = contract.evaluateRenderContract(story, {
    topicalityResult,
    textHygiene,
    provenanceRows,
  });

  const gate = contract.decideContractGate(verdict, env);

  return {
    verdict,
    gate,
    inputs: {
      topicality: topicalityResult,
      hygiene: textHygiene && {
        severity: textHygiene.severity,
        issues: textHygiene.issues,
      },
      provenance_count: Array.isArray(provenanceRows)
        ? provenanceRows.length
        : 0,
    },
  };
}

/**
 * Bulk evaluate every story in the supplied list. Used by the
 * operator report tool. Returns an array of { story_id, title,
 * verdict, gate } in input order.
 */
async function decideForStories(stories, opts = {}) {
  const out = [];
  for (const story of stories || []) {
    if (!story) continue;
    const decision = await decideForStory(story, opts);
    out.push({
      story_id: story.id,
      title: (story.title || "").slice(0, 120),
      verdict: decision.verdict,
      gate: decision.gate,
      inputs: decision.inputs,
    });
  }
  return out;
}

/**
 * Aggregate a list of per-story decisions into a summary suitable for
 * the operator report.
 */
function summariseDecisions(decisions) {
  const summary = {
    total: decisions.length,
    by_class: { premium: 0, standard: 0, fallback: 0, reject: 0 },
    blocked: 0,
    allowed: 0,
    blocked_reasons: {},
  };
  for (const d of decisions) {
    if (!d || !d.verdict) continue;
    const cls = d.verdict.class;
    summary.by_class[cls] = (summary.by_class[cls] || 0) + 1;
    if (d.gate && d.gate.allowed === false) {
      summary.blocked++;
      const r = d.gate.reason || "unknown";
      summary.blocked_reasons[r] = (summary.blocked_reasons[r] || 0) + 1;
    } else {
      summary.allowed++;
    }
  }
  return summary;
}

module.exports = {
  decideForStory,
  decideForStories,
  summariseDecisions,
};
