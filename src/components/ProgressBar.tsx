interface ProgressBarProps {
  progress: number;
  stage: string;
  type: 'image' | 'video';
}

export default function ProgressBar({ progress, stage, type }: ProgressBarProps) {
  const isError = progress < 0;
  const isComplete = progress >= 100;
  const displayProgress = isError ? 100 : Math.max(0, Math.min(progress, 100));

  const label = type === 'image' ? 'IMAGE' : 'VIDEO';

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-bold tracking-wider text-white/30">{label}</span>
        <span
          className={`font-medium ${
            isError ? 'text-red-400' : isComplete ? 'text-[#39FF14]' : 'text-white/40'
          }`}
        >
          {isError ? stage : isComplete ? 'Complete' : stage}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            isError
              ? 'bg-red-500'
              : isComplete
                ? 'bg-[#39FF14]'
                : 'bg-[#39FF14]/60'
          }`}
          style={{ width: `${displayProgress}%` }}
        />
      </div>
    </div>
  );
}
