interface StatusBarProps {
  totalStories: number;
  approvedCount: number;
}

export default function StatusBar({ totalStories, approvedCount }: StatusBarProps) {
  const pendingCount = totalStories - approvedCount;
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/40">{today}</p>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[#39FF14]/10 px-3 py-1 text-xs font-semibold text-[#39FF14]">
            {pendingCount} {pendingCount === 1 ? 'story' : 'stories'} pending review
          </span>
          {approvedCount > 0 && (
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-white/40">
              {approvedCount} approved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
