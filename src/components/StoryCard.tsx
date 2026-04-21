import { useState } from "react";
import {
  Image,
  Video,
  CheckCircle,
  ArrowUpRight,
  MessageSquare,
  RotateCcw,
  AlertTriangle,
  ClipboardCopy,
  Download,
  Youtube,
  Music2,
  Instagram,
  Zap,
  Rss,
} from "lucide-react";
import type { Story, CardStatus } from "../types/story";
import FlairBadge from "./FlairBadge";
import CollapsibleSection from "./CollapsibleSection";
import Spinner from "./Spinner";
import ProgressBar from "./ProgressBar";
import ScheduleToggle from "./ScheduleToggle";
import PerformanceRow from "./PerformanceRow";

interface StoryCardProps {
  story: Story;
  status: CardStatus;
  imageProgress: number;
  videoProgress: number;
  progressStage: string;
  error?: string;
  isRefreshingStats?: boolean;
  onApprove: (id: string) => void;
  onGenerateImage: (id: string) => void;
  onGenerateVideo: (id: string) => void;
  onScheduleChange: (id: string, time: string | null) => void;
  onRetryPublish: (id: string) => void;
  onDownloadVideo: (id: string) => void;
  onRefreshStats: (id: string) => void;
}

function formatScore(score: number): string {
  if (score >= 1000) return `${(score / 1000).toFixed(1)}k`;
  return String(score);
}

const KNOWN_GAMES = [
  "GTA 6",
  "GTA VI",
  "Elden Ring",
  "Call of Duty",
  "Halo",
  "Zelda",
  "Mario",
  "Pokemon",
  "Cyberpunk",
  "Starfield",
  "Diablo",
  "Overwatch",
  "Fortnite",
  "Minecraft",
  "Baldurs Gate",
  "Final Fantasy",
  "God of War",
  "Spider-Man",
  "Horizon",
  "Fable",
  "Elder Scrolls",
  "Fallout",
  "Red Dead",
  "Assassins Creed",
  "Mass Effect",
  "Dragon Age",
  "Xbox",
  "PlayStation",
  "Nintendo",
  "Switch",
  "Steam Deck",
  "CS2",
  "Counter-Strike",
  "Valorant",
  "Apex Legends",
  "Destiny",
];

function extractGameName(title: string): string {
  for (const game of KNOWN_GAMES) {
    if (title.toLowerCase().includes(game.toLowerCase())) {
      return game.replace(/[\s'-]/g, "");
    }
  }
  const words = title.split(/\s+/).slice(0, 2);
  return words.join("").replace(/[^a-zA-Z0-9]/g, "");
}

function buildMetadataBlock(story: Story): string {
  const gameName = extractGameName(story.title);
  const hashtag = `#${gameName}`;
  const truncatedTitle =
    story.title.length > 80 ? story.title.slice(0, 77) + "..." : story.title;

  return `TITLE:
${story.title}

DESCRIPTION:
${story.full_script}

----
${story.pinned_comment}

----
All leaks sourced from r/GamingLeaksAndRumours. Verified sources only.

#GamingNews #GamingLeaks #GamingShorts #Shorts ${hashtag}

---
TAGS (paste into YouTube tags field):
gaming news, gaming leaks, gaming shorts, verified leaks, gaming 2026, ${gameName.toLowerCase()}

---
TIKTOK CAPTION:
${truncatedTitle} #GamingNews #GamingLeaks #GamingShorts ${hashtag} #Shorts`;
}

export default function StoryCard({
  story,
  status,
  imageProgress,
  videoProgress,
  progressStage,
  error,
  isRefreshingStats,
  onApprove,
  onGenerateImage,
  onGenerateVideo,
  onScheduleChange,
  onRetryPublish,
  onDownloadVideo,
  onRefreshStats,
}: StoryCardProps) {
  const [copied, setCopied] = useState(false);
  const isApproved = status === "approved";
  const isGeneratingImage = status === "generating-image";
  const isGeneratingVideo = status === "generating-video";
  const isBusy = isGeneratingImage || isGeneratingVideo;
  const hasError = status === "error" || story.publish_status === "failed";
  const isPublishing = story.publish_status === "publishing";

  const handleCopyMetadata = () => {
    navigator.clipboard.writeText(buildMetadataBlock(story));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border transition-all duration-300 ${
        isApproved
          ? "border-orange-500/20 bg-[#1a2420]"
          : hasError
            ? "border-red-500/20 bg-[#2a1f1f]"
            : "border-white/[0.06] bg-[#252b3b] hover:border-white/[0.12] hover:shadow-lg hover:shadow-black/20"
      }`}
    >
      {isApproved && !hasError && (
        <div className="absolute right-[-35px] top-[20px] z-10 rotate-45 bg-orange-500 px-10 py-1 text-[10px] font-black tracking-[0.15em] text-white shadow-lg">
          {story.auto_approved ? "AUTO" : "APPROVED"}
        </div>
      )}

      <div className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlairBadge flair={story.flair} />
            <span className="text-xs font-medium text-white/30">
              {story.subreddit}
            </span>
            {story.source_type === "rss" && (
              <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-blue-400/60">
                <Rss size={8} /> RSS
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-white/25">
            {story.breaking_score != null && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-400/60">
                <Zap size={8} /> {story.breaking_score}
              </span>
            )}
            <div className="flex items-center gap-1">
              <ArrowUpRight size={12} />
              <span className="font-mono font-semibold">
                {formatScore(story.score)}
              </span>
            </div>
          </div>
        </div>

        <h3 className="mb-2 text-[15px] font-bold leading-snug text-white/90">
          {story.title}
        </h3>

        {story.top_comment && (
          <div className="mb-1 flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
            <MessageSquare
              size={12}
              className="mt-0.5 shrink-0 text-white/20"
            />
            <p className="text-xs leading-relaxed text-white/35 line-clamp-2">
              {story.top_comment}
            </p>
          </div>
        )}

        {(imageProgress > 0 || isGeneratingImage) && (
          <ProgressBar
            progress={imageProgress}
            stage={progressStage}
            type="image"
          />
        )}
        {(videoProgress > 0 || isGeneratingVideo) && (
          <ProgressBar
            progress={videoProgress}
            stage={progressStage}
            type="video"
          />
        )}

        {story.image_url && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-orange-400/60">
            <Image size={10} />
            <span>Thumbnail generated</span>
          </div>
        )}
        {story.video_url && (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-orange-400/60">
            <Video size={10} />
            <span>B-roll generated</span>
          </div>
        )}

        {isApproved && (story.youtube_post_id || story.tiktok_post_id) && (
          <PerformanceRow
            youtubeViews={story.youtube_views}
            tiktokViews={story.tiktok_views}
            hasYoutubeId={!!story.youtube_post_id}
            hasTiktokId={!!story.tiktok_post_id}
            isRefreshing={!!isRefreshingStats}
            onRefresh={() => onRefreshStats(story.id)}
          />
        )}

        {/* Multi-platform publish status */}
        {isApproved &&
          (story.youtube_post_id ||
            story.tiktok_post_id ||
            story.instagram_media_id) && (
            <div className="mt-2 flex items-center gap-2">
              {story.youtube_post_id && (
                <a
                  href={
                    story.youtube_url ||
                    `https://youtube.com/shorts/${story.youtube_post_id}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] font-semibold text-red-400/80 hover:bg-red-500/20 transition-colors"
                >
                  <Youtube size={10} /> YT
                </a>
              )}
              {story.tiktok_post_id && (
                <span className="flex items-center gap-1 rounded-full bg-pink-500/10 px-2 py-0.5 text-[9px] font-semibold text-pink-400/80">
                  <Music2 size={10} /> TikTok
                </span>
              )}
              {story.instagram_media_id && (
                <span className="flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[9px] font-semibold text-purple-400/80">
                  <Instagram size={10} /> Reel
                </span>
              )}
            </div>
          )}
      </div>

      <CollapsibleSection title="VIEW SCRIPT">
        <div className="space-y-3">
          {(() => {
            // Task 11 (2026-04-21): review queue used to render
            // three empty panels when a story had only full_script
            // and no hook/body/loop sections (e.g. scripts written
            // in legacy mode or aborted mid-extraction). Fall back
            // gracefully so operators can still read what Claude
            // produced, and warn loudly when there's NO script at
            // all — approving a no-script story will hard-fail at
            // content-qa before publish, which is the worst time
            // to discover it.
            const hasHookBodyLoop = Boolean(
              (story.hook && story.hook.trim().length > 0) ||
              (story.body && story.body.trim().length > 0) ||
              (story.loop && story.loop.trim().length > 0),
            );
            const hasFullScript = Boolean(
              story.full_script && story.full_script.trim().length > 0,
            );
            if (hasHookBodyLoop) {
              return (
                <>
                  <ScriptBlock label="HOOK" text={story.hook || ""} accent />
                  <ScriptBlock label="BODY" text={story.body || ""} />
                  <ScriptBlock label="LOOP" text={story.loop || ""} accent />
                </>
              );
            }
            if (hasFullScript) {
              return (
                <div>
                  <p className="mb-1 text-[10px] font-bold tracking-wider text-white/25">
                    FULL SCRIPT (hook/body/loop sections not split)
                  </p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/60">
                    {story.full_script}
                  </p>
                </div>
              );
            }
            return (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3">
                <p className="mb-1 flex items-center gap-2 text-[11px] font-bold tracking-wider text-red-400">
                  <AlertTriangle size={12} /> NO SCRIPT GENERATED
                </p>
                <p className="text-xs leading-relaxed text-red-300/80">
                  This story has no hook, body, loop, or full_script. Approving
                  will hard-fail at content-qa before publish. Re-run processor
                  before approving.
                </p>
              </div>
            );
          })()}

          <div className="flex items-center gap-2">
            <span className="rounded-md bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/40">
              {story.word_count || 0} words
            </span>
          </div>

          {story.suggested_thumbnail_text && (
            <div className="rounded-lg border border-[#FF6B1A]/15 bg-[#FF6B1A]/5 px-3 py-2.5">
              <p className="mb-1 text-[10px] font-bold tracking-wider text-[#FF6B1A]/50">
                SUGGESTED THUMBNAIL
              </p>
              <p className="text-sm font-bold text-[#FF6B1A]/80">
                {story.suggested_thumbnail_text}
              </p>
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="PINNED COMMENT">
        <div className="rounded-lg bg-white/[0.03] px-3 py-2.5">
          <p className="text-xs leading-relaxed text-white/50">
            {story.pinned_comment}
          </p>
        </div>
      </CollapsibleSection>

      {hasError && (error || story.publish_error) && (
        <div className="border-t border-red-500/10 px-4 py-3 sm:px-5">
          <div className="flex items-start gap-2 rounded-lg bg-red-500/5 px-3 py-2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-red-400" />
            <p className="text-[11px] leading-relaxed text-red-400/80">
              {error || story.publish_error}
            </p>
          </div>
        </div>
      )}

      <div className="border-t border-white/5 p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between">
          <ScheduleToggle
            scheduleTime={story.schedule_time}
            onChange={(time) => onScheduleChange(story.id, time)}
            disabled={isApproved || isBusy}
          />
          {isPublishing && (
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-400">
              <Spinner /> PUBLISHING
            </span>
          )}
          {story.publish_status === "published" && (
            <span className="text-[10px] font-semibold text-orange-400">
              PUBLISHED
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleCopyMetadata}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-3 text-[11px] font-semibold tracking-wider transition-all active:scale-[0.97] sm:py-2.5 ${
              copied
                ? "border-orange-500/20 bg-orange-500/10 text-orange-400"
                : "border-white/[0.06] bg-white/[0.04] text-white/50 hover:border-white/10 hover:bg-white/[0.07] hover:text-white/70"
            }`}
          >
            <ClipboardCopy size={14} />
            <span className="hidden sm:inline">
              {copied ? "COPIED!" : "COPY META"}
            </span>
          </button>

          <button
            onClick={() => onGenerateImage(story.id)}
            disabled={isApproved || isBusy}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-3 text-[11px] font-semibold tracking-wider text-white/50 transition-all active:scale-[0.97] hover:border-white/10 hover:bg-white/[0.07] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-30 sm:py-2.5"
          >
            {isGeneratingImage ? <Spinner /> : <Image size={14} />}
            {isGeneratingImage ? "GENERATING..." : "GEN IMAGE"}
          </button>

          <button
            onClick={() => onGenerateVideo(story.id)}
            disabled={isApproved || isBusy}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-3 text-[11px] font-semibold tracking-wider text-white/50 transition-all active:scale-[0.97] hover:border-white/10 hover:bg-white/[0.07] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-30 sm:py-2.5"
          >
            {isGeneratingVideo ? <Spinner /> : <Video size={14} />}
            {isGeneratingVideo ? "GENERATING..." : "GEN VIDEO"}
          </button>

          {hasError ? (
            <button
              onClick={() => onRetryPublish(story.id)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-3 text-[11px] font-bold tracking-wider text-red-400 transition-all active:scale-[0.97] hover:bg-red-500/20 sm:py-2.5"
            >
              <RotateCcw size={14} />
              RETRY
            </button>
          ) : (
            (() => {
              // Task 11 (2026-04-21): disable Approve when the
              // story has no script at all. Approving would land
              // in content-qa's script_missing hard-fail at
              // publish time, burning an entire window on a story
              // that can't possibly go up.
              const hasAnyScript = Boolean(
                (story.hook && story.hook.trim()) ||
                (story.body && story.body.trim()) ||
                (story.loop && story.loop.trim()) ||
                (story.full_script && story.full_script.trim()),
              );
              const disabledForNoScript = !hasAnyScript && !isApproved;
              return (
                <button
                  onClick={() => onApprove(story.id)}
                  disabled={isApproved || isBusy || disabledForNoScript}
                  title={
                    disabledForNoScript
                      ? "No script generated — re-run processor before approving"
                      : undefined
                  }
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-3 text-[11px] font-bold tracking-wider transition-all active:scale-[0.97] sm:py-2.5 ${
                    isApproved
                      ? "border border-orange-500/20 bg-orange-500/10 text-orange-400"
                      : disabledForNoScript
                        ? "border border-red-500/20 bg-red-500/5 text-red-400/50"
                        : "border border-[#FF6B1A]/20 bg-[#FF6B1A]/10 text-[#FF6B1A] hover:bg-[#FF6B1A]/20 hover:shadow-[0_0_15px_rgba(57,255,20,0.1)] disabled:cursor-not-allowed disabled:opacity-30"
                  }`}
                >
                  <CheckCircle size={14} />
                  {isApproved
                    ? "APPROVED"
                    : disabledForNoScript
                      ? "NO SCRIPT"
                      : "APPROVE"}
                </button>
              );
            })()
          )}
        </div>

        {isApproved && story.exported_path && (
          <button
            onClick={() => onDownloadVideo(story.id)}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-500/20 bg-slate-600/30 px-3 py-2.5 text-[11px] font-bold tracking-wider text-white transition-all active:scale-[0.98] hover:bg-slate-600/50"
          >
            <Download size={14} />
            DOWNLOAD VIDEO
          </button>
        )}
      </div>
    </div>
  );
}

function ScriptBlock({
  label,
  text,
  accent = false,
}: {
  label: string;
  text: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p
        className={`mb-1 text-[10px] font-bold tracking-wider ${
          accent ? "text-[#FF6B1A]/40" : "text-white/25"
        }`}
      >
        {label}
      </p>
      <p className="text-xs leading-relaxed text-white/60">{text}</p>
    </div>
  );
}
