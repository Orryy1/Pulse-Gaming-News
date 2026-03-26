import { useState, useEffect } from 'react';
import { RefreshCw, Radar, Rocket } from 'lucide-react';
import { fetchHunterStatus, triggerHunter } from '../api/news';

interface NavbarProps {
  onRefresh: () => void;
  isLoading: boolean;
  hasApproved: boolean;
  onPublish: () => void;
}

export default function Navbar({ onRefresh, isLoading, hasApproved, onPublish }: NavbarProps) {
  const [hunterActive, setHunterActive] = useState(false);
  const [hunterRunning, setHunterRunning] = useState(false);

  useEffect(() => {
    fetchHunterStatus()
      .then((s) => setHunterActive(s.active))
      .catch(() => {});
  }, []);

  const handleHunterRun = async () => {
    setHunterRunning(true);
    try {
      await triggerHunter();
      setTimeout(() => {
        onRefresh();
        setHunterRunning(false);
      }, 5000);
    } catch {
      setHunterRunning(false);
    }
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-white/5 bg-[#1E2330]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-[#39FF14] shadow-[0_0_8px_#39FF14]" />
          <h1 className="text-xs font-bold tracking-[0.2em] text-[#39FF14] sm:text-lg">
            PULSE GAMING <span className="text-white/30">//</span> COMMAND CENTRE
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleHunterRun}
            disabled={hunterRunning}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-semibold tracking-wider transition-all sm:text-xs ${
              hunterActive
                ? 'border-[#39FF14]/15 bg-[#39FF14]/5 text-[#39FF14]/70 hover:bg-[#39FF14]/10'
                : 'border-white/10 bg-white/5 text-white/40 hover:text-white/60'
            } disabled:cursor-not-allowed disabled:opacity-40`}
            title={hunterActive ? 'Hunter active -- click to run now' : 'Hunter inactive -- click to run manually'}
          >
            <Radar size={12} className={hunterRunning ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{hunterRunning ? 'SCANNING...' : 'HUNTER'}</span>
            {hunterActive && (
              <span className="h-1.5 w-1.5 rounded-full bg-[#39FF14] shadow-[0_0_4px_#39FF14]" />
            )}
          </button>

          <button
            onClick={onPublish}
            disabled={!hasApproved}
            className="flex items-center gap-1.5 rounded-lg border border-[#39FF14]/25 bg-[#39FF14]/10 px-3 py-2 text-[10px] font-bold tracking-wider text-[#39FF14] transition-all hover:bg-[#39FF14]/20 hover:shadow-[0_0_12px_rgba(57,255,20,0.15)] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-white/20 disabled:shadow-none sm:text-xs"
            title={hasApproved ? 'Publish all approved stories' : 'Approve at least one story first'}
          >
            <Rocket size={12} />
            <span className="hidden sm:inline">RUN PUBLISH</span>
            <span className="sm:hidden">PUBLISH</span>
          </button>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-semibold tracking-wider text-white/70 transition-all hover:border-[#39FF14]/30 hover:bg-[#39FF14]/10 hover:text-[#39FF14] disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:text-xs"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">REFRESH</span>
            <span className="sm:hidden">REFRESH</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
