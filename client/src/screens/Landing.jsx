// Landing — brand entry: choose Player (join a game) or Host (run a quiz).
import { motion } from 'framer-motion';
import Logo from '../components/Logo.jsx';
import { go } from '../App.jsx';

export default function Landing() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 opacity-10"
        style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, #FFB81C 0, transparent 45%), radial-gradient(circle at 70% 80%, #1E6BE5 0, transparent 45%)' }} />

      <motion.div initial={{ scale: 0.7, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 160, damping: 14 }} className="mb-6">
        <Logo size={110} />
      </motion.div>

      <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="px-2 text-center text-4xl font-black tracking-tight text-white sm:text-6xl">
        OSCAR <span className="text-arena-gold">ARENA</span>
      </motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        className="mt-2 text-center text-lg font-semibold text-arena-gold/90">
        Royal Rangers Live Quiz
      </motion.p>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
        className="mt-1 text-center text-sm text-white/50">
        Who will rule the arena?
      </motion.p>

      <div className="mt-10 w-full max-w-sm space-y-4">
        <motion.button whileTap={{ scale: 0.97 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          onClick={() => go('/player')}
          className="w-full rounded-2xl bg-arena-gold py-4 text-xl font-black text-arena-navy shadow-2xl shadow-arena-gold/30 hover:brightness-110">
          ▶ PLAY
        </motion.button>
        <motion.button whileTap={{ scale: 0.97 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
          onClick={() => go('/host')}
          className="w-full rounded-2xl bg-white/10 py-4 text-xl font-bold text-white ring-2 ring-white/20 hover:bg-white/20">
          🎛 HOST A QUIZ
        </motion.button>
      </div>

      <p className="absolute bottom-2 px-4 text-center text-xs leading-relaxed text-white/30 safe-bottom sm:bottom-6">
        Free for Royal Rangers · works on any phone · designed for offline-ish networks
      </p>
    </div>
  );
}