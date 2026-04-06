import { useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import Navbar from './components/Navbar';
import StatusBar from './components/StatusBar';
import StoryCard from './components/StoryCard';
import PublishOverlay from './components/PublishOverlay';
import Analytics from './pages/Analytics';
import { useStories } from './hooks/useStories';
import { triggerPublish } from './api/news';

type ActiveTab = 'stories' | 'analytics';

function App() {
  const {
    stories,
    isLoading,
    error,
    approvedCount,
    refreshingStatsId,
    refresh,
    handleApprove,
    handleGenerateImage,
    handleGenerateVideo,
    handleScheduleChange,
    handleRetryPublish,
    handleDownloadVideo,
    handleRefreshStats,
  } = useStories();

  const [showPublishOverlay, setShowPublishOverlay] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('stories');

  const handlePublish = useCallback(async () => {
    try {
      await triggerPublish();
      setShowPublishOverlay(true);
    } catch {
      // error handled by overlay
    }
  }, []);

  const handlePublishComplete = useCallback(() => {
    setTimeout(() => refresh(), 1000);
  }, [refresh]);

  return (
    <div className="min-h-screen bg-[#1E2330]">
      <Navbar
        onRefresh={refresh}
        isLoading={isLoading}
        hasApproved={approvedCount > 0}
        onPublish={handlePublish}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      {activeTab === 'stories' && (
        <StatusBar totalStories={stories.length} approvedCount={approvedCount} />
      )}

      {activeTab === 'analytics' ? (
        <main className="pt-4">
          <Analytics />
        </main>
      ) : (
        <main className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          {error && (
            <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
              <AlertTriangle size={16} className="text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {isLoading && stories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32">
              <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B1A]/20 border-t-[#FF6B1A]" />
              <p className="text-sm text-white/30">Loading stories...</p>
            </div>
          ) : stories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32">
              <p className="text-sm text-white/30">No stories found.</p>
              <p className="mt-2 text-xs text-white/20">Run: node run.js hunt</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {stories.map(({ story, status, imageProgress, videoProgress, progressStage, error: cardError }) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  status={status}
                  imageProgress={imageProgress}
                  videoProgress={videoProgress}
                  progressStage={progressStage}
                  error={cardError}
                  isRefreshingStats={refreshingStatsId === story.id}
                  onApprove={handleApprove}
                  onGenerateImage={handleGenerateImage}
                  onGenerateVideo={handleGenerateVideo}
                  onScheduleChange={handleScheduleChange}
                  onRetryPublish={handleRetryPublish}
                  onDownloadVideo={handleDownloadVideo}
                  onRefreshStats={handleRefreshStats}
                />
              ))}
            </div>
          )}
        </main>
      )}

      {showPublishOverlay && (
        <PublishOverlay
          onClose={() => setShowPublishOverlay(false)}
          onComplete={handlePublishComplete}
        />
      )}
    </div>
  );
}

export default App;
