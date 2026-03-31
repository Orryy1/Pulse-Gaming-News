import { useState, useEffect } from 'react';
import { RefreshCw, Radar, Rocket, Zap, Youtube, Music2, Instagram } from 'lucide-react';
import { fetchHunterStatus, triggerHunter, fetchAutonomousStatus, fetchPlatformStatus, triggerAutonomousCycle } from '../api/news';
import type { AutonomousStatus, PlatformStatus } from '../types/story';

interface NavbarProps {
  onRefresh: () => void;
  isLoading: boolean;
  hasApproved: boolean;
  onPublish: () => void;
}

export default function Navbar({ onRefresh, isLoading, hasApproved, onPublish }: NavbarProps) {
  const [hunterActive, setHunterActive] = useState(false);
  const [hunterRunning, setHunterRunning] = useState(false);
  const [autoStatus, setAutoStatus] = useState<AutonomousStatus | null>(null);
  const [platforms, setPlatforms] = useState<PlatformStatus | null>(null);
  const [cycleRunning, setCycleRunning] = useState(false);

  useEffect(() => {
    fetchHunterStatus()
      .then((s) => setHunterActive(s.active))
      .catch(() => {});
    fetchAutonomousStatus()
      .then(setAutoStatus)
      .catch(() => {});
    fetchPlatformStatus()
      .then(setPlatforms)
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

  const handleAutonomousCycle = async () => {
    setCycleRunning(true);
    try {
      await triggerAutonomousCycle();
      setTimeout(() => {
        onRefresh();
        setCycleRunning(false);
      }, 10000);
    } catch {
      setCycleRunning(false);
    }
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-white/5 bg-[#1E2330]/95 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="h-3 w-3 rounded-full bg-[#FF6B1A] shadow-[0_0_8px_#FF6B1A]" />
              {autoStatus?.autoPublish && (
                <div className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#FF6B1A] animate-ping" />
              )}
            </div>
            <div>
              <h1 className="text-xs font-bold tracking-[0.2em] text-[#FF6B1A] sm:text-lg">
                PULSE GAMING <span className="text-white/30">//</span> COMMAND CENTRE
              </h1>
              {autoStatus?.autoPublish && (
                <p className="text-[9px] font-semibold tracking-wider text-[#FF6B1A]/40">AUTONOMOUS MODE ACTIVE</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Platform status indicators */}
            {platforms && (
              <div className="mr-2 hidden items-center gap-1.5 sm:flex">
                <PlatformDot
                  icon={<Youtube size={10} />}
                  active={platforms.youtube.authenticated}
                  label="YouTube"
                />
                <PlatformDot
                  icon={<Music2 size={10} />}
                  active={platforms.tiktok.authenticated}
                  label="TikTok"
                />
                <PlatformDot
                  icon={<Instagram size={10} />}
                  active={platforms.instagram.authenticated}
                  label="Instagram"
                />
              </div>
            )}

            {/* Full autonomous cycle button */}
            <button
              onClick={handleAutonomousCycle}
              disabled={cycleRunning}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] font-semibold tracking-wider text-amber-400 transition-all hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40 sm:text-xs"
              title="Run full autonomous cycle: hunt + approve + produce + publish"
            >
              <Zap size={12} className={cycleRunning ? 'animate-pulse' : ''} />
              <span className="hidden sm:inline">{cycleRunning ? 'RUNNING...' : 'AUTO CYCLE'}</span>
            </button>

            <button
              onClick={handleHunterRun}
              disabled={hunterRunning}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-semibold tracking-wider transition-all sm:text-xs ${
                hunterActive
                  ? 'border-[#FF6B1A]/15 bg-[#FF6B1A]/5 text-[#FF6B1A]/70 hover:bg-[#FF6B1A]/10'
                  : 'border-white/10 bg-white/5 text-white/40 hover:text-white/60'
              } disabled:cursor-not-allowed disabled:opacity-40`}
              title={hunterActive ? 'Hunter active -- click to run now' : 'Hunter inactive -- click to run manually'}
            >
              <Radar size={12} className={hunterRunning ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{hunterRunning ? 'SCANNING...' : 'HUNTER'}</span>
              {hunterActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-[#FF6B1A] shadow-[0_0_4px_#FF6B1A]" />
              )}
            </button>

            <button
              onClick={onPublish}
              disabled={!hasApproved}
              className="flex items-center gap-1.5 rounded-lg border border-[#FF6B1A]/25 bg-[#FF6B1A]/10 px-3 py-2 text-[10px] font-bold tracking-wider text-[#FF6B1A] transition-all hover:bg-[#FF6B1A]/20 hover:shadow-[0_0_12px_rgba(57,255,20,0.15)] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-white/20 disabled:shadow-none sm:text-xs"
              title={hasApproved ? 'Publish all approved stories' : 'Approve at least one story first'}
            >
              <Rocket size={12} />
              <span className="hidden sm:inline">PRODUCE</span>
              <span className="sm:hidden">GO</span>
            </button>

            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-semibold tracking-wider text-white/70 transition-all hover:border-[#FF6B1A]/30 hover:bg-[#FF6B1A]/10 hover:text-[#FF6B1A] disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:text-xs"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">REFRESH</span>
            </button>
          </div>
        </div>

        {/* Schedule bar */}
        {autoStatus && (
          <div className="flex items-center gap-3 border-t border-white/[0.03] py-1.5 text-[9px] font-medium tracking-wider text-white/20">
            <span>HUNTS: {autoStatus.schedule.hunts.join(' / ')}</span>
            <span className="text-white/10">|</span>
            <span>PRODUCE: {autoStatus.schedule.produce}</span>
            <span className="text-white/10">|</span>
            <span>PUBLISH: {autoStatus.schedule.publish}</span>
          </div>
        )}
      </div>
    </nav>
  );
}

function PlatformDot({ icon, active, label }: { icon: React.ReactNode; active: boolean; label: string }) {
  return (
    <div
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ${
        active
          ? 'bg-orange-500/10 text-orange-400/70'
          : 'bg-white/[0.03] text-white/20'
      }`}
      title={`${label}: ${active ? 'Connected' : 'Not connected'}`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-orange-400' : 'bg-white/10'}`} />
    </div>
  );
}
