interface FlairBadgeProps {
  flair: string;
  classification?: string;
}

const CLASS_CONFIG: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  LEAK: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
    dot: 'bg-red-400',
  },
  BREAKING: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
    dot: 'bg-red-400',
  },
  RUMOR: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/20',
    dot: 'bg-orange-400',
  },
  CONFIRMED: {
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500/20',
    dot: 'bg-green-400',
  },
};

function getLabel(classification?: string, flair?: string): string {
  if (classification) {
    const c = classification.replace(/[\[\]]/g, '').toUpperCase();
    if (CLASS_CONFIG[c]) return c;
  }
  const f = (flair || '').toLowerCase();
  if (f.includes('verified') || f.includes('confirmed')) return 'CONFIRMED';
  if (f.includes('rumour') || f.includes('rumor')) return 'RUMOR';
  if (f.includes('highly likely')) return 'LEAK';
  return 'RUMOR';
}

export default function FlairBadge({ flair, classification }: FlairBadgeProps) {
  const label = getLabel(classification, flair);
  const config = CLASS_CONFIG[label] ?? CLASS_CONFIG['RUMOR'];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${config.bg} ${config.text} ${config.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {label}
    </span>
  );
}
