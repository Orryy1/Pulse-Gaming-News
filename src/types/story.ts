export interface Story {
  id: string;
  title: string;
  url: string;
  score: number;
  flair: 'Verified' | 'Highly Likely' | 'Rumour';
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
  image_url?: string;
  video_url?: string;
  audio_path?: string;
  image_path?: string;
  exported_path?: string;
  schedule_time?: string;
  publish_error?: string;
  publish_status?: 'idle' | 'publishing' | 'published' | 'failed';
  youtube_post_id?: string;
  tiktok_post_id?: string;
  youtube_views?: number;
  tiktok_views?: number;
  content_pillar?: string;
  affiliate_url?: string;
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
