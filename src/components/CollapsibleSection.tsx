import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export default function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-white/5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="text-xs font-semibold tracking-wider text-white/40">
          {title}
        </span>
        <ChevronDown
          size={14}
          className={`text-white/30 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      <div
        className={`grid transition-all duration-200 ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
