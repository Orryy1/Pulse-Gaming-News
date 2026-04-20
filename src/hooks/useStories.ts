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

  const sortedStories = [...stories].sort((a, b) => {
    if (a.status === "approved" && b.status !== "approved") return 1;
    if (a.status !== "approved" && b.status === "approved") return -1;
    return 0;
  });

  const approvedCount = stories.filter((s) => s.status === "approved").length;

  return {
    stories: sortedStories,
    isLoading,
    error,
    approvedCount,
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
