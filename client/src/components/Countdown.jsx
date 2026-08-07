// Full-screen animated countdown shown to host + players right before Q1,
// driven by the authoritative server deadline so everyone stays in sync.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { tick } from '../lib/audio.js';

export default function Countdown({ deadline }) {
  const [n, setN] = useState(() => Math.max(1, Math.ceil((deadline - Date.now()) / 1000)));

  useEffect(() => {
    if (!deadline) return;
    setN(Math.max(1, Math.ceil((deadline - Date.now()) / 1000)));
    const id = setInterval(() => {
      const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setN(remain);
      if (remain > 0) tick();
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const display = n <= 0 ? 'GO!' : n;

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <p className="mb-4 text-xl font-bold uppercase tracking-[0.3em] text-arena-gold">Get Ready</p>
      <AnimatePresence mode="wait">
        <motion.div
          key={display}
          initial={{ scale: 2.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className={`font-black drop-shadow-[0_0_30px_rgba(255,184,28,0.6)] ${
            n <= 0 ? 'text-arena-green text-8xl' : 'text-arena-gold text-9xl'
          }`}
        >
          {display}
        </motion.div>
      </AnimatePresence>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-4 text-white/70">
        {n <= 0 ? 'Here we go!' : 'The first question is about to appear…'}
      </motion.p>
    </div>
  );
}