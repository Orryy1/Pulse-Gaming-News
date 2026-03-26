import { Clock } from 'lucide-react';

interface ScheduleToggleProps {
  scheduleTime: string | undefined;
  onChange: (time: string | null) => void;
  disabled: boolean;
}

export default function ScheduleToggle({ scheduleTime, onChange, disabled }: ScheduleToggleProps) {
  const isScheduled = !!scheduleTime;

  const handleToggle = () => {
    if (isScheduled) {
      onChange(null);
    } else {
      const today = new Date();
      today.setHours(18, 0, 0, 0);
      if (today.getTime() < Date.now()) {
        today.setDate(today.getDate() + 1);
      }
      onChange(today.toISOString());
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      const date = new Date(e.target.value);
      onChange(date.toISOString());
    }
  };

  const inputValue = scheduleTime
    ? new Date(scheduleTime).toISOString().slice(0, 16)
    : '';

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleToggle}
        disabled={disabled}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold tracking-wider transition-all ${
          isScheduled
            ? 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
            : 'border border-white/[0.06] bg-white/[0.03] text-white/30 hover:bg-white/[0.05] hover:text-white/50'
        } disabled:cursor-not-allowed disabled:opacity-30`}
      >
        <Clock size={10} />
        {isScheduled ? 'SCHEDULED' : 'SCHEDULE'}
      </button>
      {isScheduled && (
        <input
          type="datetime-local"
          value={inputValue}
          onChange={handleTimeChange}
          disabled={disabled}
          className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/50 outline-none focus:border-[#39FF14]/30 disabled:cursor-not-allowed disabled:opacity-30"
        />
      )}
    </div>
  );
}
