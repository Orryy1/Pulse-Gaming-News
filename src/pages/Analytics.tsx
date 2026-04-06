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

const API_BASE = import.meta.env.VITE_API_URL || '';

interface SummaryData {
  totalViews: number;
  avgVirality: number;
  videosThisWeek: number;
  bestTopic: string | null;
  bestDay: string | null;
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

interface DailyTrend {
  date: string;
  avgViews: number;
  avgVirality: number;
  videos: number;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function Analytics() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);
  const [topicBreakdown, setTopicBreakdown] = useState<TopicBreakdown[]>([]);
  const [dailyTrends, setDailyTrends] = useState<DailyTrend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      try {
        const [sumRes, topRes, topicRes, trendRes] = await Promise.all([
          fetch(`${API_BASE}/api/analytics/summary`),
          fetch(`${API_BASE}/api/analytics/top-performers`),
          fetch(`${API_BASE}/api/analytics/topic-breakdown`),
          fetch(`${API_BASE}/api/analytics/daily-trends`),
        ]);
        setSummary(await sumRes.json());
        setTopPerformers(await topRes.json());
        setTopicBreakdown(await topicRes.json());
        setDailyTrends(await trendRes.json());
      } catch (err) {
        console.error('Failed to fetch analytics', err);
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
