// Full-screen animated countdown shown to host + players right before Q1,
// driven by the authoritative server deadline so everyone stays in sync.
// `serverOffset` cancels device clock skew (see TimerBar): every phone shows
// the same 5-4-3-2-1 regardless of its own clock.
//
// Hard rules that kill the "starts at 6 / shows nothing / jumps to 3" reports:
//  1. The displayed value is CLAMPED to [0, duration]. Skew, jitter or a
//     stale offset can make `deadline - now` miscalculate — clamping means
//     the number can never exceed the real countdown (the old "6" bug).
//  2. Without an authoritative deadline the screen shows a stable
//     "Get Ready…" state — never NaN, never a blank/glitched digit (the old
//     between-phase-event flash on phones).
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { tick } from '../lib/audio.js';

export default function Countdown({ deadline, serverOffset = 0, duration = 5 }) {
  const now = () => Date.now() + serverOffset;
  const total = Math.max(1, Math.round(Number(duration) || 5));

  // null => no authoritative deadline yet (show stable placeholder, no digit)
  const compute = () => {
    if (!deadline || !Number.isFinite(deadline)) return null;
    const seconds = Math.ceil((deadline - now()) / 1000);
    // Hard clamp: never above the real countdown, never below 0.
    return Math.min(total, Math.max(0, seconds));
  };

  const [n, setN] = useState(compute);
  const [last, setLast] = useState(compute);

  useEffect(() => {
    const fresh = compute();
    setN(fresh);
    setLast(fresh);
    if (fresh === null) return; // wait for the authoritative deadline
    // 250ms tick so a late-arriving event converges fast; the INTEGERS still
    // only change on second boundaries (ceil), so the count stays honest.
    const id = setInterval(() => {
      const v = compute();
      setN(v);
      setLast((prev) => {
        if (v !== null && v > 0 && v !== prev) tick();
        return v === null ? prev : v;
      });
    }, 250);
    return () => clearInterval(id);
  }, [deadline, serverOffset, total]);

  const noDeadline = n === null || !Number.isFinite(n);
  const display = noDeadline ? null : n <= 0 ? 'GO!' : n;

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <p className="mb-4 text-xl font-bold uppercase tracking-[0.3em] text-arena-gold">
        {noDeadline ? 'Get Ready' : 'Get Ready'}
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