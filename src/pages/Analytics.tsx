import { useState, useEffect } from 'react';
import { BarChart3, Eye, Flame, Calendar, Trophy } from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { apiGetAuthed } from '../api/http';

interface SummaryData {
  totalViews: number;
  avgVirality: number;
  videosThisWeek: number;
  bestTopic: string | null;
  bestDay: string | null;
}

interface OverviewResponse {
  totalVideos?: number;
  totalViews?: {
    youtube?: number;
    tiktok?: number;
    instagram?: number;
    combined?: number;
  };
  bestPerformer?: {
    title?: string;
  } | null;
  avgVirality?: number;
}

interface TopPerformer {
  id: string;
  title: string;
  youtube_views: number;
  tiktok_views: number;
  instagram_views: number;
  virality_score: number;
}

interface TopicBreakdown {
  flair: string;
  count: number;
  totalViews: number;
  avgVirality: number;
}

interface AnalyticsTopic {
  name: string;
  count: number;
  avgVirality: number;
}

interface TopicsResponse {
  flairs?: AnalyticsTopic[];
  keywords?: AnalyticsTopic[];
  pillars?: AnalyticsTopic[];
}

interface DailyTrend {
  date: string;
  avgViews: number;
  avgVirality: number;
  videos: number;
}

interface HistoryEntry {
  id?: string;
  title?: string;
  youtube_views?: number;
  tiktok_views?: number;
  instagram_views?: number;
  virality_score?: number;
  updated_at?: string;
  published_at?: string;
}

interface HistoryResponse {
  entries?: HistoryEntry[];
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function totalEntryViews(entry: HistoryEntry): number {
  return (
    (entry.youtube_views || 0) +
    (entry.tiktok_views || 0) +
    (entry.instagram_views || 0)
  );
}

function entryDate(entry: HistoryEntry): string | null {
  const raw = entry.updated_at || entry.published_at || '';
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildDailyTrends(entries: HistoryEntry[]): DailyTrend[] {
  const byDate = new Map<string, { views: number; virality: number; videos: number }>();
  for (const entry of entries) {
    const date = entryDate(entry);
    if (!date) continue;
    const bucket = byDate.get(date) || { views: 0, virality: 0, videos: 0 };
    bucket.views += totalEntryViews(entry);
    bucket.virality += entry.virality_score || 0;
    bucket.videos += 1;
    byDate.set(date, bucket);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, bucket]) => ({
      date,
      avgViews: Math.round(bucket.views / Math.max(1, bucket.videos)),
      avgVirality: Math.round((bucket.virality / Math.max(1, bucket.videos)) * 10) / 10,
      videos: bucket.videos,
    }));
}

function videosPublishedThisWeek(entries: HistoryEntry[]): number {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => {
    const raw = entry.updated_at || entry.published_at || '';
    if (!raw) return false;
    const time = new Date(raw).getTime();
    return !Number.isNaN(time) && time >= sevenDaysAgo;
  }).length;
}

export default function Analytics() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);
  const [topicBreakdown, setTopicBreakdown] = useState<TopicBreakdown[]>([]);
  const [dailyTrends, setDailyTrends] = useState<DailyTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      setError(null);
      try {
        const [overview, topics, history] = await Promise.all([
          apiGetAuthed<OverviewResponse>('/api/analytics/overview'),
          apiGetAuthed<TopicsResponse>('/api/analytics/topics'),
          apiGetAuthed<HistoryResponse>('/api/analytics/history?limit=50'),
        ]);
        const entries = Array.isArray(history.entries) ? history.entries : [];
        const flairs = Array.isArray(topics.flairs) ? topics.flairs : [];
        setSummary({
          totalViews: overview.totalViews?.combined || 0,
          avgVirality: overview.avgVirality || 0,
          videosThisWeek: videosPublishedThisWeek(entries),
          bestTopic: flairs[0]?.name || overview.bestPerformer?.title || null,
          bestDay: null,
        });
        setTopPerformers(
          [...entries]
            .sort((a, b) => (b.virality_score || 0) - (a.virality_score || 0))
            .slice(0, 10)
            .map((entry, index) => ({
              id: entry.id || `history-${index}`,
              title: entry.title || 'Untitled upload',
              youtube_views: entry.youtube_views || 0,
              tiktok_views: entry.tiktok_views || 0,
              instagram_views: entry.instagram_views || 0,
              virality_score: entry.virality_score || 0,
            })),
        );
        setTopicBreakdown(
          flairs.map((topic) => ({
            flair: topic.name,
            count: topic.count,
            totalViews: 0,
            avgVirality: topic.avgVirality,
          })),
        );
        setDailyTrends(buildDailyTrends(entries));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load analytics');
        setSummary({
          totalViews: 0,
          avgVirality: 0,
          videosThisWeek: 0,
          bestTopic: null,
          bestDay: null,
        });
        setTopPerformers([]);
        setTopicBreakdown([]);
        setDailyTrends([]);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B1A]/20 border-t-[#FF6B1A]" />
        <p className="text-sm text-white/30">Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
      {error && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          icon={<Eye size={16} />}
          label="Total Views"
          value={formatViews(summary?.totalViews ?? 0)}
        />
        <SummaryCard
          icon={<Flame size={16} />}
          label="Avg Virality"
          value={String(summary?.avgVirality ?? 0)}
        />
        <SummaryCard
          icon={<Calendar size={16} />}
          label="Videos This Week"
          value={String(summary?.videosThisWeek ?? 0)}
        />
        <SummaryCard
          icon={<Trophy size={16} />}
          label="Best Topic"
          value={summary?.bestTopic ?? '--'}
        />
      </div>

      {/* Top Performers Table */}
      <div className="mb-8 rounded-xl border border-white/[0.06] bg-[#252B3B] p-5">
        <h2 className="mb-4 flex items-center gap-2 text-xs font-bold tracking-[0.15em] text-white/50">
          <BarChart3 size={14} className="text-[#FF6B1A]" />
          TOP PERFORMERS (LAST 7 DAYS)
        </h2>
        {topPerformers.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/20">No published data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] font-bold tracking-wider text-white/30">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">TITLE</th>
                  <th className="py-2 pr-3 text-right">YT</th>
                  <th className="py-2 pr-3 text-right">TT</th>
                  <th className="py-2 pr-3 text-right">IG</th>
                  <th className="py-2 text-right">VIRALITY</th>
                </tr>
              </thead>
              <tbody>
                {topPerformers.map((p, i) => (
                  <tr key={p.id} className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]">
                    <td className="py-2.5 pr-3 text-xs font-bold text-[#FF6B1A]">{i + 1}</td>
                    <td className="max-w-[280px] truncate py-2.5 pr-3 text-xs text-white/60">
                      {p.title}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-xs text-white/40">
                      {formatViews(p.youtube_views || 0)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-xs text-white/40">
                      {formatViews(p.tiktok_views || 0)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-xs text-white/40">
                      {formatViews(p.instagram_views || 0)}
                    </td>
                    <td className="py-2.5 text-right">
                      <span className="inline-block rounded-full bg-[#FF6B1A]/10 px-2 py-0.5 text-[10px] font-bold text-[#FF6B1A]">
                        {p.virality_score}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Topic Breakdown Bar Chart */}
        <div className="rounded-xl border border-white/[0.06] bg-[#252B3B] p-5">
          <h2 className="mb-4 text-xs font-bold tracking-[0.15em] text-white/50">
            TOPIC BREAKDOWN
          </h2>
          {topicBreakdown.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/20">No topic data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topicBreakdown} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis
                  dataKey="flair"
                  tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1E2330',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.7)',
                  }}
                  formatter={(value: number, name: string) => [
                    name === 'avgVirality' ? value : formatViews(value),
                    name === 'avgVirality' ? 'Avg Virality' : 'Total Views',
                  ]}
                />
                <Bar dataKey="avgVirality" fill="#FF6B1A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Daily Trends Line Chart */}
        <div className="rounded-xl border border-white/[0.06] bg-[#252B3B] p-5">
          <h2 className="mb-4 text-xs font-bold tracking-[0.15em] text-white/50">
            DAILY VIEWS TREND (30 DAYS)
          </h2>
          {dailyTrends.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/20">No trend data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={dailyTrends} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                  tickLine={false}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1E2330',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.7)',
                  }}
                  formatter={(value: number, name: string) => [
                    name === 'avgVirality' ? value : formatViews(value),
                    name === 'avgVirality' ? 'Avg Virality' : 'Avg Views',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="avgViews"
                  stroke="#FF6B1A"
                  strokeWidth={2}
                  dot={{ fill: '#FF6B1A', r: 3 }}
                  activeDot={{ r: 5, fill: '#FF6B1A' }}
                />
                <Line
                  type="monotone"
                  dataKey="avgVirality"
                  stroke="#FF6B1A55"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#252B3B] p-4">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold tracking-wider text-white/30">
        <span className="text-[#FF6B1A]">{icon}</span>
        {label.toUpperCase()}
      </div>
      <p className="text-xl font-bold text-white/80">{value}</p>
    </div>
  );
}
