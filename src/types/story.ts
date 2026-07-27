export interface Story {
  id: string;
  title: string;
  url: string;
  score: number;
  flair: string;
  subreddit: string;
  top_comment: string;
  hook: string;
  body: string;
  loop: string;
  full_script: string;
  word_count: number;
  suggested_thumbnail_text: string;
  pinned_comment: string;
  timestamp: string;
  approved: boolean;
  auto_approved?: boolean;
  num_comments?: number;
  image_url?: string;
  video_url?: string;
  audio_path?: string;
  image_path?: string;
  exported_path?: string;
  schedule_time?: string;
  publish_error?: string;
  publish_status?: 'idle' | 'publishing' | 'published' | 'failed';
  youtube_post_id?: string;
  youtube_url?: string;
  tiktok_post_id?: string;
  tiktok_status?: string;
  instagram_media_id?: string;
  youtube_views?: number;
  tiktok_views?: number;
  content_pillar?: string;
  affiliate_url?: string;
  source_type?: 'reddit' | 'rss';
  breaking_score?: number;
  article_image?: string;
  company_name?: string;
  downloaded_images?: Array<{ path: string; type: string }>;
}

export type CardStatus =
  | 'pending'
  | 'generating-image'
  | 'generating-video'
  | 'approved'
  | 'error';

export interface AssetProgress {
  storyId: string;
  type: 'image' | 'video';
  progress: number;
  stage: string;
}

export interface StoryCardState {
  status: CardStatus;
  story: Story;
  imageProgress: number;
  videoProgress: number;
  progressStage: string;
  error?: string;
}

export interface AutonomousStatus {
  operatingMode: 'LOCAL_PROOF' | 'HUMAN_REVIEW' | 'LIVE_GUARDED';
  autoPublish: boolean;
  legacyAutoPublishArmed: boolean;
  humanReviewRequired: boolean;
  schedulerActive: boolean;
  hunterActive: boolean;
  lastHuntRun: string;
  nextHuntRun: string | null;
  schedule: {
    profile: string;
    hunts: string[];
    publish: string[];
    maximum: string;
    minimumGap: string;
    catchUp: boolean;
    humanReviewRequired: boolean;
    strategy: string;
  };
  platforms: {
    youtube: { configured: boolean; automation: string };
    tiktok: { configured: boolean; automation: string };
    instagram: { configured: boolean; automation: string };
    facebook: { configured: boolean; automation: string };
    x: { configured: boolean; automation: string };
  };
}

export interface PlatformStatus {
  youtube: { authenticated: boolean; configured: boolean };
  tiktok: { authenticated: boolean; configured: boolean };
  instagram: { authenticated: boolean; configured: boolean };
}
