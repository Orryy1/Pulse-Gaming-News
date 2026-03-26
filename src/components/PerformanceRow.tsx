import { useState } from 'react';
import { BarChart3, Youtube, RefreshCw } from 'lucide-react';
import Spinner from './Spinner';

interface PerformanceRowProps {
  youtubeViews?: number;
  tiktokViews?: number;
  hasYoutubeId: boolean;
  hasTiktokId: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function PerformanceRow({
  youtubeViews = 0,
  tiktokViews = 0,
  hasYoutubeId,
  hasTiktokId,
  isRefreshing,
  onRefresh,
}: PerformanceRowProps) {
  const [hovered, setHovered] = useState<'youtube' | 'tiktok' | null>(null);
  const total = youtubeViews + tiktokViews;
  const ytPct = total > 0 ? (youtubeViews / total) * 100 : 50;
  const tkPct = total > 0 ? (tiktokViews / total) * 100 : 50;
  const leader = youtubeViews >= tiktokViews ? 'YouTube' : 'TikTok';

  if (!hasYoutubeId && !hasTiktokId) return null;

  return (
    <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-white/30">
          <BarChart3 size={10} />
          PERFORMANCE
        </div>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold tracking-wider text-white/40 transition-all hover:bg-white/[0.08] hover:text-white/60 disabled:opacity-30"
        >
          {isRefreshing ? <Spinner /> : <RefreshCw size={9} />}
          REFRESH STATS
        </button>
      </div>

      <div className="flex items-center gap-3">
        {hasYoutubeId && (
          <div
            className="flex items-center gap-1.5"
            onMouseEnter={() => setHovered('youtube')}
            onMouseLeave={() => setHovered(null)}
          >
            <Youtube size={12} className="text-red-500/70" />
            <span className={`text-xs font-semibold transition-colors ${hovered === 'youtube' ? 'text-white/70' : 'text-white/40'}`}>
              {formatViews(youtubeViews)}
            </span>
          </div>
        )}

        {hasTiktokId && (
          <div
            className="flex items-center gap-1.5"
            onMouseEnter={() => setHovered('tiktok')}
            onMouseLeave={() => setHovered(null)}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 text-cyan-400/70">
              <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.18 8.18 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z" />
            </svg>
            <span className={`text-xs font-semibold transition-colors ${hovered === 'tiktok' ? 'text-white/70' : 'text-white/40'}`}>
              {formatViews(tiktokViews)}
            </span>
          </div>
        )}
      </div>

      {hasYoutubeId && hasTiktokId && total > 0 && (
        <div className="mt-2">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="rounded-l-full bg-red-500/50 transition-all duration-500"
              style={{ width: `${ytPct}%` }}
            />
            <div
              className="rounded-r-full bg-cyan-400/50 transition-all duration-500"
              style={{ width: `${tkPct}%` }}
            />
          </div>
          <p className="mt-1 text-[9px] font-semibold tracking-wider text-white/20">
            {leader} leading
          </p>
        </div>
      )}
    </div>
  );
}
