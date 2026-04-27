"use strict";

const KEYWORDS = {
  official: ["official", "trailer", "revealed", "confirmed", "proof"],
  timing: ["years", "date", "2019", "2039", "release", "launch", "window"],
  grim: ["grim", "dark", "bleak", "survival", "tunnel", "silence"],
  source: ["source", "reddit", "r/games", "report", "post"],
  quote: ["fans", "comment", "quote", "people", "players"],
  unknown: ["unknown", "unsaid", "no date", "platforms"],
};

function normalise(text) {
  return String(text || "").toLowerCase();
}

function classifyPhrase(text) {
  const lower = normalise(text);
  const tags = [];
  for (const [tag, words] of Object.entries(KEYWORDS)) {
    if (words.some((word) => lower.includes(word))) tags.push(tag);
  }
  if (!tags.length) tags.push("general");
  return tags;
}

function splitPhrases(script = "") {
  return String(script || "")
    .split(/(?<=[.!?])\s+|;\s+|,\s+(?=and|but|while|because)/i)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      index,
      text,
      tags: classifyPhrase(text),
      wordCount: text.split(/\s+/).filter(Boolean).length,
    }));
}

function assetMatchesTag(asset, tag) {
  const roles = asset.roles || [];
  const name = normalise(asset.file || asset.path);
  if (tag === "official") return roles.includes("proof") || roles.includes("motion") || name.includes("trailer");
  if (tag === "timing") return roles.includes("context") || name.includes("article") || name.includes("trailerframe");
  if (tag === "grim") return roles.includes("motion") || name.includes("metro") || name.includes("tunnel");
  if (tag === "source") return roles.includes("proof") || name.includes("trailerframe");
  if (tag === "quote") return roles.includes("context") || roles.includes("freeze");
  if (tag === "unknown") return roles.includes("context") || roles.includes("end-lock");
  return true;
}

function chooseAssetForPhrase(phrase, assets = [], used = new Set()) {
  const scored = assets
    .filter((asset) => !asset.rejectReasons?.length)
    .map((asset) => {
      const tagBonus = phrase.tags.some((tag) => assetMatchesTag(asset, tag)) ? 18 : 0;
      const reusePenalty = used.has(asset.id) ? 25 : 0;
      const motionBonus = phrase.tags.includes("grim") && asset.kind === "trailer-clip" ? 8 : 0;
      return { asset, score: asset.score + tagBonus + motionBonus - reusePenalty };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.asset || null;
}

function alignScriptToShots({ script = "", vault = {} } = {}) {
  const phrases = splitPhrases(script);
  const assets = vault.assets || [];
  const used = new Set();
  const alignments = phrases.map((phrase) => {
    const asset = chooseAssetForPhrase(phrase, assets, used);
    if (asset) used.add(asset.id);
    return {
      phraseIndex: phrase.index,
      text: phrase.text,
      tags: phrase.tags,
      wordCount: phrase.wordCount,
      assetId: asset?.id || null,
      assetFile: asset?.file || null,
      assetKind: asset?.kind || null,
      matchStrength: asset ? Math.min(100, asset.score + phrase.tags.length * 4) : 0,
      reason: asset
        ? `Matched ${phrase.tags.join(", ")} phrase to ${asset.kind} asset.`
        : "No suitable asset available.",
    };
  });
  return {
    phraseCount: phrases.length,
    alignedCount: alignments.filter((a) => a.assetId).length,
    alignments,
    coverage:
      phrases.length === 0
        ? 0
        : Number((alignments.filter((a) => a.assetId).length / phrases.length).toFixed(2)),
  };
}

module.exports = {
  alignScriptToShots,
  assetMatchesTag,
  chooseAssetForPhrase,
  classifyPhrase,
  splitPhrases,
};
