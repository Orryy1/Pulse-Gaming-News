import { useState, useCallback, useEffect, useRef } from "react";
import type { Story, CardStatus, AssetProgress } from "../types/story";
import {
  fetchStories,
  approveStory,
  generateImage,
  generateVideo,
  setSchedule,
  retryPublish,
  connectProgressStream,
  downloadVideo,
  fetchPostStats,
  updateStoryStats,
} from "../api/news";

interface StoryState {
  story: Story;
  status: CardStatus;
  imageProgress: number;
  videoProgress: number;
  progressStage: string;
  error?: string;
}

function initState(story: Story): StoryState {
  return {
    story,
    status: story.approved ? "approved" : "pending",
    imageProgress: 0,
    videoProgress: 0,
    progressStage: "",
  };
}

export function useStories() {
  const [stories, setStories] = useState<StoryState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const loadStories = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchStories();
      setStories(data.map(initState));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stories");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  useEffect(() => {
    const handleProgress = (data: AssetProgress) => {
      setStories((prev) =>
        prev.map((s) => {
          if (s.story.id !== data.storyId) return s;

          const isError = data.progress < 0;
          const isComplete = data.progress >= 100;

          if (data.type === "image") {
            return {
              ...s,
              imageProgress: data.progress,
              progressStage: data.stage,
              status: isError
                ? "error"
                : isComplete
                  ? s.status === "generating-image"
                    ? "pending"
                    : s.status
                  : s.status,
              error: isError ? data.stage : s.error,
            };
          } else {
            return {
              ...s,
              videoProgress: data.progress,
              progressStage: data.stage,
              status: isError
                ? "error"
                : isComplete
                  ? s.status === "generating-video"
                    ? "pending"
                    : s.status
                  : s.status,
              error: isError ? data.stage : s.error,
            };
          }
        }),
      );

      if (data.progress >= 100) {
        setTimeout(() => loadStories(), 500);
      }
    };

    eventSourceRef.current = connectProgressStream(handleProgress);

    return () => {
      eventSourceRef.current?.close();
    };
  }, [loadStories]);

  const updateStatus = (id: string, status: CardStatus) => {
    setStories((prev) =>
      prev.map((s) =>
        s.story.id === id ? { ...s, status, error: undefined } : s,
      ),
    );
  };

  const handleApprove = async (id: string) => {
    const storyState = stories.find((s) => s.story.id === id);
    const scheduleTime = storyState?.story.schedule_time;

    updateStatus(id, "approved");
    try {
      await approveStory(id, scheduleTime);
      setTimeout(() => loadStories(), 2000);
    } catch {
      updateStatus(id, "pending");
    }
  };

  const handleGenerateImage = async (id: string) => {
    setStories((prev) =>
      prev.map((s) =>
        s.story.id === id
          ? {
              ...s,
              status: "generating-image" as CardStatus,
              imageProgress: 5,
              progressStage: "Queuing...",
              error: undefined,
            }
          : s,
      ),
    );
    try {
      await generateImage(id);
    } catch {
      setStories((prev) =>
        prev.map((s) =>
          s.story.id === id
            ? {
                ...s,
                status: "error",
                error: "Failed to start image generation",
              }
            : s,
        ),
      );
    }
  };

  const handleGenerateVideo = async (id: string) => {
    setStories((prev) =>
      prev.map((s) =>
        s.story.id === id
          ? {
              ...s,
              status: "generating-video" as CardStatus,
              videoProgress: 5,
              progressStage: "Queuing...",
              error: undefined,
            }
          : s,
      ),
    );
    try {
      await generateVideo(id);
    } catch {
      setStories((prev) =>
        prev.map((s) =>
          s.story.id === id
            ? {
                ...s,
                status: "error",
                error: "Failed to start video generation",
              }
            : s,
        ),
      );
    }
  };

  const handleScheduleChange = async (id: string, time: string | null) => {
    setStories((prev) =>
      prev.map((s) =>
        s.story.id === id
          ? { ...s, story: { ...s.story, schedule_time: time || undefined } }
          : s,
      ),
    );
    try {
      await setSchedule(id, time);
    } catch {
      loadStories();
    }
  };

  const handleRetryPublish = async (id: string) => {
    setStories((prev) =>
      prev.map((s) =>
        s.story.id === id
          ? {
              ...s,
              status: "approved",
              error: undefined,
              story: {
                ...s.story,
                publish_status: "publishing",
                publish_error: undefined,
              },
            }
          : s,
      ),
    );
    try {
      await retryPublish(id);
      setTimeout(() => loadStories(), 3000);
    } catch {
      loadStories();
    }
  };

  const [refreshingStatsId, setRefreshingStatsId] = useState<string | null>(
    null,
  );

  const handleDownloadVideo = (id: string) => {
    // downloadVideo is now async (fetch+blob with Bearer — drafts
    // require auth). Fire-and-forget; the fn surfaces its own
    // operator-friendly messages on 401 / network errors via thrown
    // Error, so we just log unhandled rejections rather than dropping
    // them silently.
    downloadVideo(id).catch((err) => {
      console.error("[pulse] download failed:", err);
    });
  };

  const handleRefreshStats = async (id: string) => {
    const storyState = stories.find((s) => s.story.id === id);
    if (!storyState) return;

    setRefreshingStatsId(id);
    try {
      const { story } = storyState;
      let ytViews = story.youtube_views || 0;
      let tkViews = story.tiktok_views || 0;

      if (story.youtube_post_id) {
        const yt = await fetchPostStats(story.youtube_post_id, "youtube");
        ytViews = yt.views;
      }
      if (story.tiktok_post_id) {
        const tk = await fetchPostStats(story.tiktok_post_id, "tiktok");
        tkViews = tk.views;
      }

      await updateStoryStats(id, {
        youtube_views: ytViews,
        tiktok_views: tkViews,
      });

      setStories((prev) =>
        prev.map((s) =>
          s.story.id === id
            ? {
                ...s,
                story: {
                  ...s.story,
                  youtube_views: ytViews,
                  tiktok_views: tkViews,
                },
              }
            : s,
        ),
      );
    } catch {
      // silently fail
    } finally {
      setRefreshingStatsId(null);
    }
  };

  // 2026-04-23 dashboard truthfulness pass.
  //
  // Before this filter, every row in /api/news/full rendered as a
  // card — including rows that the operator can't usefully act on
  // from the review queue:
  //
  //   - publish_status="failed" (QA-blocked, the scoring/produce
  //     stage must intervene, not the human)
  //   - publish_status="published" (already fully shipped)
  //   - classification in ("[DEFER]", "[REJECT]") (scoring
  //     engine said no — an operator override path exists but
  //     it's not the normal approval flow)
  //
  // Partial-retry rows (publish_status="partial") still render so
  // the operator can track retry progress, but they're sorted
  // AFTER pending-approval items and the APPROVE button is
  // correctly disabled on them because story.approved is true.
  //
  // The filter is additive; we preserve the existing behaviour
  // for every status that was previously rendered as actionable.
  const HIDDEN_PUBLISH_STATUSES = new Set(["failed", "published"]);
  const HIDDEN_CLASSIFICATIONS = new Set(["[DEFER]", "[REJECT]"]);
  const visible = stories.filter((s) => {
    const ps = s.story.publish_status || "";
    if (HIDDEN_PUBLISH_STATUSES.has(ps)) return false;
    const cls = (s.story as { classification?: string }).classification || "";
    if (HIDDEN_CLASSIFICATIONS.has(cls)) return false;
    return true;
  });

  const sortedStories = [...visible].sort((a, b) => {
    // Pending-approval items (still actionable) first, so the
    // operator's first scroll lands on stories they can approve.
    // Partial-retry and already-approved rows bucket underneath.
    if (a.status === "approved" && b.status !== "approved") return 1;
    if (a.status !== "approved" && b.status === "approved") return -1;
    // Within each bucket, sort by created_at DESC so newest is
    // on top (matches DB order but is stable under frontend
    // manipulation).
    const aT = a.story.timestamp || "";
    const bT = b.story.timestamp || "";
    return bT.localeCompare(aT);
  });

  const approvedCount = visible.filter((s) => s.status === "approved").length;
  const hiddenCount = stories.length - visible.length;

  return {
    stories: sortedStories,
    isLoading,
    error,
    approvedCount,
    hiddenCount,
    refreshingStatsId,
    refresh: loadStories,
    handleApprove,
    handleGenerateImage,
    handleGenerateVideo,
    handleScheduleChange,
    handleRetryPublish,
    handleDownloadVideo,
    handleRefreshStats,
  };
}
