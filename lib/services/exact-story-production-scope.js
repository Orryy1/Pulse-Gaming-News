"use strict";

function normaliseExactStoryIds(storyIds) {
  return [
    ...new Set(
      (Array.isArray(storyIds) ? storyIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ].sort();
}

function filterStoriesToExactScope(stories, { storyIds } = {}) {
  const ids = new Set(normaliseExactStoryIds(storyIds));
  if (ids.size === 0) return [];
  return (Array.isArray(stories) ? stories : []).filter((story) =>
    ids.has(String(story?.id || "").trim()),
  );
}

function requireOneExactStory({ storyIds } = {}) {
  const ids = normaliseExactStoryIds(storyIds);
  if (ids.length !== 1) {
    throw new Error("exactly_one_story_id_required");
  }
  return ids[0];
}

module.exports = {
  filterStoriesToExactScope,
  normaliseExactStoryIds,
  requireOneExactStory,
};
