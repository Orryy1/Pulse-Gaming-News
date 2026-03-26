interface FlairBadgeProps {
  flair: string;
}

const FLAIR_CONFIG: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  Verified: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    dot: 'bg-emerald-400',
  },
  'Highly Likely': {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
    dot: 'bg-amber-400',
  },
  Rumour: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/20',
    dot: 'bg-orange-400',
  },
};

export default function FlairBadge({ flair }: FlairBadgeProps) {
  const config = FLAIR_CONFIG[flair] ?? FLAIR_CONFIG['Rumour'];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${config.bg} ${config.text} ${config.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {flair.toUpperCase()}
    </span>
  );
}
