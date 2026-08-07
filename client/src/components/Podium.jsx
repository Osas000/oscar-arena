// Podium renderer — top3[0] is ALWAYS the highest scorer. Layout draws the
// winner as the tall gold block in the center; the medal, height and gradient
// are tied to the player's actual rank (array index), never to the flex slot.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { confettiBurst } from '../lib/confetti.js';

function CountUp({ value }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const dur = 1200;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(Math.round(value * (p < 1 ? 1 - Math.pow(1 - p, 3) : 1)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="font-mono font-black">{n.toLocaleString()}</span>;
}

const RANK = [
  { medal: '🥇', label: 'CHAMPION', tall: 'h-48', grad: 'from-arena-gold to-arena-yellow', text: 'bg-arena-gold/20 ring-arena-gold', slot: 'center' },
  { medal: '🥈', label: 'RUNNER-UP', tall: 'h-32', grad: 'from-slate-300 to-slate-500', text: 'bg-white/5', slot: 'left' },
  { medal: '🥉', label: 'THIRD', tall: 'h-24', grad: 'from-amber-700 to-amber-900', text: 'bg-white/5', slot: 'right' },
];

export default function Podium({ top3, myPlayerId, onAction, actionLabel, actionClassName }) {
  const [burst, setBurst] = useState(false);
  // Fire confetti once the winner tile lands.
  useEffect(() => {
    if (!burst && top3?.length) {
      const t = setTimeout(() => { confettiBurst(document.body, { count: 140 }); setBurst(true); }, 900);
      return () => clearTimeout(t);
    }
  }, [top3, burst]);

  const ranked = top3.map((r, i) => ({ ...r, rank: i + 1, ...RANK[i] }));
  // Center first so the winner is the tall gold tile in the middle.
  const order = ranked.length >= 3 ? [ranked[1], ranked[0], ranked[2]] : ranked;

  return (
    <div className="flex flex-col items-center">
      <h2 className="relative z-10 mb-8 text-5xl font-black tracking-wide text-arena-gold drop-shadow-[0_0_25px_rgba(255,184,28,0.5)]">🏆 PODIUM</h2>
      <div className="flex items-end gap-4">
        {order.map((r) => {
          const isWinner = r.rank === 1;
          const isMine = r.playerId === myPlayerId;
          return (
            <motion.div
              key={r.playerId}
              className={`flex flex-col items-center ${r.slot === 'center' ? '-translate-y-0' : ''}`}
              initial={{ y: 200, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.35 + r.rank * 0.28, type: 'spring', stiffness: 170, damping: 14 }}
            >
              {/* Winner crown */}
              <motion.div
                className="mb-1 text-4xl"
                initial={{ y: -40, opacity: 0, rotate: -15 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                transition={{ delay: 1.1, type: 'spring', stiffness: 160 }}
              >
                {isWinner ? '👑' : <span className="text-white/20">{r.medal}</span>}
              </motion.div>
              <div className="mb-2 text-4xl">{isWinner ? r.medal : <span className="opacity-40">{r.medal}</span>}</div>
              <motion.div
                animate={isWinner ? { scale: [1, 1.04, 1] } : {}}
                transition={isWinner ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : {}}
                className={`flex ${r.tall} w-32 items-start justify-center rounded-t-2xl bg-gradient-to-b ${r.grad} p-3 text-center text-lg font-black text-white shadow-xl ${isWinner ? 'shadow-[0_0_40px_rgba(255,184,28,0.55)]' : ''}`}
              >
                <span className={`line-clamp-2 break-words ${r.slot === 'center' ? 'text-xl' : ''}`}>{r.nickname}</span>
              </motion.div>
              <div className={`mt-3 rounded-full px-3 py-0.5 ring-1 ${isWinner ? 'text-arena-gold' : 'text-white/70'} ${r.text}`}>
                #{r.rank}
              </div>
              <div className="mt-1 text-2xl">
                <CountUp value={r.total} />
              </div>
              {isMine && <div className={`mt-1 text-xs font-bold ${isWinner ? 'text-arena-gold' : 'text-white/60'}`}>YOU</div>}
            </motion.div>
          );
        })}
      </div>
      {myPlayerId && (
        <p className="mt-8 text-lg font-bold text-white/90">
          {top3.some((r) => r.playerId === myPlayerId)
            ? 'You made the podium! 🎉'
            : 'Thanks for playing!'}
        </p>
      )}
      {onAction && (
        <motion.button whileTap={{ scale: 0.95 }} onClick={onAction} className={`mt-8 rounded-2xl px-10 py-3 text-lg font-bold ${actionClassName || 'bg-white/10 text-white hover:bg-white/20'}`}>
          {actionLabel}
        </motion.button>
      )}
    </div>
  );
}