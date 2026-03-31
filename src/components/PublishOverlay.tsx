import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle, AlertTriangle, X } from 'lucide-react';
import { fetchPublishStatus } from '../api/news';

interface PublishOverlayProps {
  onClose: () => void;
  onComplete: () => void;
}

export default function PublishOverlay({ onClose, onComplete }: PublishOverlayProps) {
  const [status, setStatus] = useState<'running' | 'complete' | 'error'>('running');
  const [message, setMessage] = useState('Factory running... this takes 3-4 minutes');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      try {
        const result = await fetchPublishStatus();
        setMessage(result.message || '');

        if (result.status === 'complete') {
          setStatus('complete');
          if (intervalRef.current) clearInterval(intervalRef.current);
          onComplete();
        } else if (result.status === 'error') {
          setStatus('error');
          setMessage(result.message || 'An unknown error occurred');
          if (intervalRef.current) clearInterval(intervalRef.current);
        } else if (result.status === 'idle') {
          setStatus('complete');
          setMessage('Publish cycle finished');
          if (intervalRef.current) clearInterval(intervalRef.current);
          onComplete();
        }
      } catch {
        // keep polling on fetch errors
      }
    }, 15000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [onComplete]);

  const isFinished = status === 'complete' || status === 'error';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-[#1E2330] p-8 shadow-2xl">
        {isFinished && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
          >
            <X size={18} />
          </button>
        )}

        <div className="flex flex-col items-center text-center">
          {status === 'running' && (
            <>
              <div className="mb-5 rounded-full bg-[#FF6B1A]/10 p-4">
                <Loader2 size={32} className="animate-spin text-[#FF6B1A]" />
              </div>
              <h2 className="mb-2 text-lg font-bold text-white/90">Publishing</h2>
              <p className="text-sm leading-relaxed text-white/40">{message}</p>
              <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-white/5">
                <div className="h-full animate-pulse rounded-full bg-[#FF6B1A]/40" style={{ width: '60%' }} />
              </div>
            </>
          )}

          {status === 'complete' && (
            <>
              <div className="mb-5 rounded-full bg-orange-500/10 p-4">
                <CheckCircle size={32} className="text-orange-400" />
              </div>
              <h2 className="mb-2 text-lg font-bold text-white/90">Videos Queued for Posting</h2>
              <p className="text-sm leading-relaxed text-white/40">{message}</p>
              <button
                onClick={onClose}
                className="mt-6 w-full rounded-lg bg-orange-500/10 px-4 py-3 text-sm font-semibold text-orange-400 transition-all hover:bg-orange-500/20"
              >
                DISMISS
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="mb-5 rounded-full bg-red-500/10 p-4">
                <AlertTriangle size={32} className="text-red-400" />
              </div>
              <h2 className="mb-2 text-lg font-bold text-white/90">Publish Failed</h2>
              <p className="text-sm leading-relaxed text-red-400/80">{message}</p>
              <button
                onClick={onClose}
                className="mt-6 w-full rounded-lg bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400 transition-all hover:bg-red-500/20"
              >
                DISMISS
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
