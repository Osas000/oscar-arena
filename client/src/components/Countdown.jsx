// Full-screen animated countdown shown to host + players right before Q1,
// driven by the authoritative server deadline so everyone stays in sync.
//
// Sync strategy (kills the "starts at 6 / shows nothing / jumps to 3" reports):
//  - The SERVER owns the truth: it emits { deadline, serverTime, duration }.
//    `deadline` is the absolute server timestamp the countdown hits zero.
//  - Each client computes `serverNow = Date.now() + serverOffset` where
//    `serverOffset = serverTime_atEmit - clientTime_atReceive`. This cancels
//    both clock skew AND network latency in one shot.
//  - Remaining seconds = ceil((deadline - serverNow) / 1000), hard-clamped to
//    [0, duration]. The clamp is the final safety net: even if the offset is
//    slightly off, the displayed number NEVER exceeds the real countdown.
//  - We tick at 200ms (not 250) so late-arriving events converge within one
//    frame — no phone ever skips a number or shows a stale digit.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { tick } from '../lib/audio.js';

export default function Countdown({ deadline, serverOffset = 0, duration = 5 }) {
  const total = Math.max(1, Math.min(10, Math.round(Number(duration) / 1000) || 5));

  // Compute the displayed count from the authoritative server deadline.
  const compute = () => {
    if (!deadline || !Number.isFinite(deadline)) return null;
    const serverNow = Date.now() + serverOffset;
    const remaining = Math.ceil((deadline - serverNow) / 1000);
    // Hard clamp: can NEVER show above `total`, never below 0.
    return Math.min(total, Math.max(0, remaining));
  };

  const [n, setN] = useState(compute);
  const lastRef = useRef(compute());

  useEffect(() => {
    // Reset whenever a new countdown starts (new deadline).
    const fresh = compute();
    setN(fresh);
    lastRef.current = fresh;
    if (fresh === null) return;

    const id = setInterval(() => {
      const v = compute();
      setN(v);
      // Tick sound on each integer descent (5→4→3…), never on the same number twice.
      if (v !== null && v > 0 && v !== lastRef.current) tick();
      if (v !== null) lastRef.current = v;
    }, 200);
    return () => clearInterval(id);
  }, [deadline, serverOffset, total]);

  const noDeadline = n === null || !Number.isFinite(n);
  const display = noDeadline ? null : n <= 0 ? 'GO!' : n;

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <p className="mb-4 text-xl font-bold uppercase tracking-[0.3em] text-arena-gold">
        Get Ready
      </p>
      <AnimatePresence mode="wait">
        {display === null ? (
          <motion.div
            key="ready"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
            className="text-6xl font-black text-white/25 sm:text-7xl"
          >
            ★
          </motion.div>
        ) : (
          <motion.div
            key={display}
            initial={{ scale: 2.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className={`font-black drop-shadow-[0_0_30px_rgba(255,184,28,0.6)] ${
              display === 'GO!' ? 'text-arena-green text-8xl' : 'text-arena-gold text-9xl'
            }`}
          >
            {display}
          </motion.div>
        )}
      </AnimatePresence>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-4 text-white/70">
        {display === 'GO!' ? 'Here we go!' : 'The first question is about to appear…'}
      </motion.p>
    </div>
  );
}
