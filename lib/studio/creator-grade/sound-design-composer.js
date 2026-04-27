"use strict";

function planSoundDesign({ timeline = {}, heroMoments = [] } = {}) {
  const cues = [];
  const beats = timeline.beats || [];
  const addCue = (cue) => {
    if (!cue) return;
    cues.push({
      loudness: "subtle",
      ...cue,
    });
  };

  const hook = beats.find((b) => b.type === "hook");
  addCue({
    id: "sfx_opener_hit",
    atS: hook?.startS || 0,
    kind: "opener-hit",
    reason: "Cold open should feel intentional immediately.",
  });

  const proof = beats.find((b) => b.type === "proof");
  if (proof?.cardAllowance) {
    addCue({
      id: "sfx_source_tick",
      atS: proof.startS,
      kind: "source-confirmation",
      reason: "Only if source-card proof lands on this beat.",
    });
  }

  const quote = beats.find((b) => b.type === "quote");
  if (quote?.cardAllowance) {
    addCue({
      id: "sfx_quote_impact",
      atS: quote.startS,
      kind: "quote-impact",
      reason: "One punctuation point for viewer-sentiment quote.",
    });
  }

  const end = beats.find((b) => b.type === "end_lock");
  addCue({
    id: "sfx_end_lock",
    atS: Math.max(0, (end?.startS || timeline.runtimeS || 54) - 0.1),
    kind: "end-lock",
    reason: "Controlled final brand lock, not a repeated whoosh.",
  });

  for (const moment of heroMoments) {
    if (moment.type === "context_reframe") {
      addCue({
        id: `sfx_${moment.id}`,
        atS: moment.targetTimestampS,
        kind: "context-glint",
        reason: "Optional reframe accent, disabled if recurrence detector warns.",
      });
    }
  }

  return rejectRecurringSound({ cues });
}

function rejectRecurringSound({ cues = [] } = {}) {
  const byKind = new Map();
  for (const cue of cues) {
    const list = byKind.get(cue.kind) || [];
    list.push(cue.atS);
    byKind.set(cue.kind, list);
  }
  const warnings = [];
  for (const [kind, times] of byKind.entries()) {
    if (times.length > 2) {
      warnings.push({
        code: "repeated_sfx_kind",
        message: `${kind} appears ${times.length} times.`,
      });
    }
    const intervals = times.slice(1).map((time, i) => Number((time - times[i]).toFixed(2)));
    if (intervals.length >= 2 && Math.max(...intervals) - Math.min(...intervals) < 0.5) {
      warnings.push({
        code: "periodic_sfx_spacing",
        message: `${kind} cues are near-periodic: ${intervals.join(", ")}s.`,
      });
    }
  }
  return {
    cues,
    cueCount: cues.length,
    warnings,
    verdict: warnings.some((w) => w.code === "repeated_sfx_kind" || w.code === "periodic_sfx_spacing")
      ? "review"
      : "pass",
  };
}

module.exports = {
  planSoundDesign,
  rejectRecurringSound,
};
