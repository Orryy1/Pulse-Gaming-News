/**
 * roundups + roundup_items repository.
 */

function bind(db) {
  const createRoundup = db.prepare(`
    INSERT INTO roundups (channel_id, week_start, week_end, status)
    VALUES (?, ?, ?, 'pending')
    ON CONFLICT(channel_id, week_start) DO UPDATE SET
      week_end = excluded.week_end,
      updated_at = datetime('now')
    RETURNING *
  `);
  const updateRoundup = db.prepare(`
    UPDATE roundups
    SET status = COALESCE(@status, status),
        title = COALESCE(@title, title),
        slug = COALESCE(@slug, slug),
        description = COALESCE(@description, description),
        thumbnail_prompt = COALESCE(@thumbnail_prompt, thumbnail_prompt),
        chapters = COALESCE(@chapters, chapters),
        script = COALESCE(@script, script),
        cold_open = COALESCE(@cold_open, cold_open),
        closing = COALESCE(@closing, closing),
        audio_path = COALESCE(@audio_path, audio_path),
        video_path = COALESCE(@video_path, video_path),
        youtube_video_id = COALESCE(@youtube_video_id, youtube_video_id),
        youtube_url = COALESCE(@youtube_url, youtube_url),
        published_at = CASE WHEN @status = 'published' AND published_at IS NULL
                            THEN datetime('now') ELSE published_at END,
        updated_at = datetime('now')
    WHERE id = @id
  `);
  const getRoundup = db.prepare(`SELECT * FROM roundups WHERE id = ?`);
  const getRoundupByWeek = db.prepare(`
    SELECT * FROM roundups WHERE channel_id = ? AND week_start = ?
  `);
  const addItem = db.prepare(`
    INSERT INTO roundup_items
      (roundup_id, story_id, slot, chapter_title, chapter_start_s, segment_script)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(roundup_id, slot) DO UPDATE SET
      story_id = excluded.story_id,
      chapter_title = excluded.chapter_title,
      chapter_start_s = excluded.chapter_start_s,
      segment_script = excluded.segment_script
  `);
  const listItems = db.prepare(`
    SELECT * FROM roundup_items
    WHERE roundup_id = ?
    ORDER BY slot
  `);

  function hydrate(row) {
    if (!row) return null;
    if (row.chapters) {
      try {
        row.chapters = JSON.parse(row.chapters);
      } catch {
        /* keep string */
      }
    }
    return row;
  }

  return {
    openWeek(channelId, weekStartIso, weekEndIso) {
      return hydrate(createRoundup.get(channelId, weekStartIso, weekEndIso));
    },
    update(id, patch) {
      const chapters = patch.chapters
        ? typeof patch.chapters === "string"
          ? patch.chapters
          : JSON.stringify(patch.chapters)
        : null;
      updateRoundup.run({
        id,
        status: patch.status || null,
        title: patch.title || null,
        slug: patch.slug || null,
        description: patch.description || null,
        thumbnail_prompt: patch.thumbnail_prompt || null,
        chapters,
        script: patch.script || null,
        cold_open: patch.cold_open || null,
        closing: patch.closing || null,
        audio_path: patch.audio_path || null,
        video_path: patch.video_path || null,
        youtube_video_id: patch.youtube_video_id || null,
        youtube_url: patch.youtube_url || null,
      });
      return hydrate(getRoundup.get(id));
    },
    get(id) {
      return hydrate(getRoundup.get(id));
    },
    getByWeek(channelId, weekStartIso) {
      return hydrate(getRoundupByWeek.get(channelId, weekStartIso));
    },
    addItem(roundupId, item) {
      addItem.run(
        roundupId,
        item.story_id,
        item.slot,
        item.chapter_title || null,
        item.chapter_start_s || null,
        item.segment_script || null,
      );
    },
    items(roundupId) {
      return listItems.all(roundupId);
    },
  };
}

module.exports = { bind };
