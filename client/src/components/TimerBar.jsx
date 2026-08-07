// Server-authoritative countdown: derives remaining time from the server's
// `deadline` timestamp, so a bad phone clock can't skew the game.
import { useEffect, useRef, useState } from 'react';

export default function TimerBar({ deadline, totalMs, onExpire }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));
  const fired = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.max(0, deadline - Date.now());
      setRemaining(r);
      if (r <= 0 && !fired.current) {
        fired.current = true;
        onExpire?.();
      }
    }, 100);
    return () => clearInterval(id);
  }, [deadline]);

  const frac = totalMs > 0 ? Math.min(remaining / totalMs, 1) : 0;
  const secs = Math.ceil(remaining / 1000);
  const danger = frac < 0.25;

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-1 flex items-center justify-between text-sm font-semibold">
        <span className={danger ? 'text-arena-red' : 'text-arena-gold'}>
          {secs > 0 ? `${secs}s` : 'Time!'}
        </span>
        <span className="text-white/50">{Math.round(frac * 100)}%</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-100 ease-linear ${danger ? 'bg-arena-red' : 'bg-arena-gold'}`}
          style={{ width: `${frac * 100}%` }}
        />
      </div>
    </div>
  );
}