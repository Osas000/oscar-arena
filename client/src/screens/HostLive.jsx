// Host live screen — the projector view: lobby w/ PIN, live question,
// answer counts, reveal distribution, scoreboard, podium, done/results.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHost } from '../store/useHost.js';
import Logo from '../components/Logo.jsx';
import TimerBar from '../components/TimerBar.jsx';
import Countdown from '../components/Countdown.jsx';
import Podium from '../components/Podium.jsx';
import { confettiBurst } from '../lib/confetti.js';
import { playCorrect } from '../lib/audio.js';

const TILE_COLORS = ['#E53935', '#1E6BE5', '#43A047', '#FBC02D', '#8E44AD', '#E67E22'];
// Avatar glyphs used for the animated "players have joined" lobby tiles.
const AVATARS = ['🦊', '🚀', '🦉', '🐉', '🐯', '🦄', '🦅', '⭐', '⚡', '🐳', '🦈', '🦩', '🐺', '🦖'];

export default function HostLive({ onExit }) {
  const h = useHost();
  const { live, phase, question, reveal, answeredCount, playerCount, scoreboard, podium, done, players, locked, countdownDeadline, countdownDuration, serverOffset, error, pending } = h;
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (phase === 'podium') confettiBurst(document.body);
    if (phase === 'done') confettiBurst(document.body, { count: 240 });
  }, [phase]);

  useEffect(() => {
    const toggle = () => setFull((f) => !f);
    window.addEventListener('dblclick', toggle);
    return () => window.removeEventListener('dblclick', toggle);
  }, []);

  // Deterministic avatar per player id so the lobby tiles feel alive (Kahoot-style).
  const avatarFor = (id) => AVATARS[Math.floor(hashStr(id) % AVATARS.length)];
  const canStart = playerCount > 0;

  // Lobby footer shows join code. Show players as chips.
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-br from-arena-navy-deep via-arena-navy to-arena-navy">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, #FFB81C 0, transparent 40%), radial-gradient(circle at 80% 70%, #1E6BE5 0, transparent 40%)' }} />

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Logo size={40} />
          <span className="truncate text-base font-extrabold text-white sm:text-lg">{live?.quizTitle || 'OSCAR ARENA'}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {live && <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-xs font-bold text-white/80 sm:text-sm">PIN {live.pin}</span>}
          <button onClick={onExit} className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-arena-red/40 hover:text-white sm:px-3 sm:text-sm">End session</button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {/* ------------------------------ LOBBY ------------------------------ */}
        {phase === 'lobby' && live && (
          <motion.div key="lobby" className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-6 text-center sm:px-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="mb-2 text-xs font-semibold tracking-[0.3em] text-arena-gold sm:text-sm">JOIN AT</div>
            <div className="mb-4 w-full break-all px-2 font-mono text-lg font-black text-white sm:text-2xl lg:text-4xl">{window.location.host || 'this screen'}</div>
            <div className="mb-6 w-full max-w-md rounded-3xl bg-white/5 px-4 py-4 ring-4 ring-arena-gold/40 shadow-2xl sm:px-10 sm:py-6">
              <div className="mb-1 text-xs font-semibold text-white/50 sm:text-sm">GAME PIN</div>
              <div className="font-mono text-5xl font-black tracking-[0.1em] text-arena-gold sm:text-7xl lg:text-8xl">{live.pin}</div>
            </div>
            <div className="flex items-center gap-3 text-white/60">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-arena-green" />
              <span className="text-xl font-bold text-white">{playerCount}</span> joined
              {locked && <span className="rounded-full bg-arena-red/20 px-2 py-0.5 text-xs text-arena-red">lobby locked</span>}
            </div>
            {/* Animated "players arriving" tiles (Kahoot-style energy). */}
            <div className="mt-6 flex max-w-3xl flex-wrap justify-center gap-3">
              <AnimatePresence>
                {players.slice(-24).map((p) => (
                  <motion.div
                    key={p.id}
                    initial={{ scale: 0, y: 40, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                    className="flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-1.5 ring-1 ring-white/10"
                  >
                    <motion.span
                      animate={{ y: [0, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
                      className="text-2xl"
                    >{avatarFor(p.id)}</motion.span>
                    <span className="text-sm font-semibold text-white">{p.nickname}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <motion.button whileTap={{ scale: canStart && pending !== 'start' ? 0.96 : 1 }}
              onClick={() => { if (canStart && !pending) h.start(); }}
              disabled={!canStart || pending === 'start'}
              className={`mt-10 rounded-2xl px-12 py-4 text-2xl font-black transition-all ${
                canStart && pending !== 'start'
                  ? 'bg-arena-gold text-arena-navy shadow-2xl shadow-arena-gold/30 hover:brightness-110'
                  : 'cursor-not-allowed bg-white/10 text-white/40'
              }`}
            >
              {pending === 'start' ? 'STARTING…' : canStart ? 'START ▶' : 'Waiting for players…'}
            </motion.button>
            {!canStart && <p className="mt-2 text-sm text-white/40">At least one player must join before you can start.</p>}
            {canStart && error && <p className="mt-2 text-sm text-arena-red">{error}</p>}
          </motion.div>
        )}

        {/* ------------------------------ COUNTDOWN ------------------------------ */}
        {phase === 'countdown' && countdownDeadline && (
          <motion.div key="countdown" className="relative z-10 flex flex-1 flex-col items-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Countdown deadline={countdownDeadline} serverOffset={serverOffset} duration={countdownDuration} />
          </motion.div>
        )}

        {/* ---------------------------- QUESTION ---------------------------- */}
        {(phase === 'question' || phase === 'reveal') && question && (
          <motion.div key="q" className="relative z-10 flex flex-1 flex-col items-center px-3 sm:px-6"
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="mb-1 text-xs font-semibold text-white/50 sm:text-sm">
              Question {question.index + 1} of {question.total}
            </div>
            <h1 className="mb-4 max-w-4xl break-words text-center text-xl font-extrabold text-white sm:mb-6 sm:text-3xl lg:text-5xl">{question.prompt}</h1>

            {phase === 'question' && (
              <div className="mb-6 w-full max-w-3xl sm:mb-8">
                <TimerBar deadline={question.deadline} totalMs={question.timeLimit * 1000} serverOffset={serverOffset} />
              </div>
            )}

            {/* Answer grid with counts */}
            <div className="grid w-full max-w-4xl grid-cols-2 gap-2 sm:gap-4">
              {question.options.map((opt, i) => {
                // REVEAL ONLY: counts/✅ may only render in the reveal phase.
                // While the question is live the grid stays 100% blank — no
                // stale distribution, no correct-choice tick, no hint.
                const isReveal = phase === 'reveal';
                const count = isReveal ? (reveal?.distribution?.[i] || 0) : 0;
                const correct = isReveal && reveal && i === reveal.correctChoice;
                return (
                  <motion.div key={opt.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.07 }}
                    className={`relative flex min-h-20 items-center justify-center rounded-2xl p-2 text-center font-bold text-white shadow-xl transition-all sm:min-h-28 sm:p-4 ${correct ? 'ring-8 ring-white scale-[1.02]' : ''} ${phase === 'reveal' && !correct ? 'opacity-40' : ''}`}
                    style={{ background: TILE_COLORS[i] || '#555' }}>
                    <span className="line-clamp-3 text-sm drop-shadow sm:text-xl lg:text-3xl">{opt.text}</span>
                    {phase === 'reveal' && (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}
                        className="absolute -right-1.5 -top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-black text-arena-navy shadow-lg sm:-right-2 sm:-top-2 sm:h-12 sm:w-12 sm:text-xl">
                        {count}
                      </motion.span>
                    )}
                    {correct && <span className="absolute left-2 top-2 text-xl sm:left-3 sm:top-3 sm:text-3xl">✅</span>}
                  </motion.div>
                );
              })}
            </div>

            {/* answered counter */}
            <div className="mt-6 flex w-full flex-wrap items-center justify-center gap-2 sm:mt-8 sm:gap-3">
              <div className="h-3 w-32 overflow-hidden rounded-full bg-white/10 sm:w-56">
                <motion.div animate={{ width: `${question.total && phase === 'question' ? (answeredCount / playerCount) * 100 : 0}%` }} className="h-full bg-arena-gold" />
              </div>
              <span className="font-mono text-base font-bold text-white sm:text-lg">{answeredCount}/{playerCount}</span>
              {phase === 'reveal' && (
                <motion.button whileTap={{ scale: pending === 'next' ? 1 : 0.95 }} onClick={() => h.next()}
                  disabled={pending === 'next'}
                  className={`ml-auto rounded-xl px-5 py-2 text-base font-black sm:ml-4 sm:px-6 sm:py-2.5 sm:text-lg ${
                    pending === 'next' ? 'bg-white/10 text-white/50' : 'bg-arena-gold text-arena-navy hover:brightness-110'
                  }`}>
                  {pending === 'next' ? '…' : 'Next ▶'}
                </motion.button>
              )}
            </div>
          </motion.div>
        )}

        {/* --------------------------- SCOREBOARD --------------------------- */}
        {phase === 'scoreboard' && scoreboard && (
          <motion.div key="sb" className="relative z-10 flex flex-1 flex-col items-center justify-center px-3 sm:px-6"
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <h2 className="mb-6 text-2xl font-black text-arena-gold sm:mb-8 sm:text-4xl">LEADERBOARD</h2>
            <div className="w-full max-w-lg space-y-2 sm:space-y-3">
              {scoreboard.full.slice(0, 10).map((r, i) => {
                const maxScore = Math.max(1, ...scoreboard.full.map((x) => x.total));
                return (
                  <motion.div key={r.playerId} initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                    className={`relative flex items-center gap-3 overflow-hidden rounded-2xl px-4 py-2.5 sm:gap-4 sm:px-5 sm:py-3 ${
                      i === 0 ? 'bg-arena-gold/20 ring-2 ring-arena-gold shadow-lg shadow-arena-gold/20' : 'bg-white/5'
                    }`}>
                    {/* animated score-fill bar behind each row */}
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-arena-gold/15 to-transparent"
                      initial={{ width: 0 }}
                      animate={{ width: `${(r.total / maxScore) * 100}%` }}
                      transition={{ delay: 0.3 + i * 0.1, type: 'spring', stiffness: 60, damping: 20 }}
                    />
                    <motion.span className={`relative text-xl sm:text-2xl`} animate={i === 0 ? { scale: [1, 1.15, 1] } : {}} transition={{ repeat: i === 0 ? Infinity : 0, duration: 1.4 }}>
                      {i === 0 ? '🏆' : avatarFor(r.playerId)}
                    </motion.span>
                    <span className={`relative w-6 font-mono text-lg font-black sm:w-8 sm:text-2xl ${i === 0 ? 'text-arena-gold' : 'text-white/50'}`}>{i + 1}</span>
                    <span className="relative min-w-0 flex-1 truncate text-base font-bold text-white sm:text-xl">{r.nickname}</span>
                    <motion.span
                      className="relative font-mono text-base font-black text-arena-gold sm:text-xl"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.5 + i * 0.1, type: 'spring', stiffness: 300 }}
                    >
                      {r.total.toLocaleString()}
                    </motion.span>
                  </motion.div>
                );
              })}
            </div>
            <motion.button whileTap={{ scale: pending === 'next' ? 1 : 0.95 }} onClick={() => h.next()}
              disabled={pending === 'next'}
              className={`mt-8 rounded-2xl px-8 py-3 text-lg font-black sm:mt-10 sm:px-12 sm:py-3.5 sm:text-xl ${
                pending === 'next' ? 'bg-white/10 text-white/50' : 'bg-arena-gold text-arena-navy hover:brightness-110'
              }`}>
              {pending === 'next' ? '…' : 'Next Question ▶'}
            </motion.button>
          </motion.div>
        )}

        {/* ----------------------------- PODIUM ----------------------------- */}
        {phase === 'podium' && podium && (
          <motion.div key="podium" className="relative z-10 flex flex-1 flex-col items-center justify-center px-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Podium
              top3={podium.top3}
              myPlayerId={null}
              onAction={() => h.finish()}
              actionLabel="Finish & Show Results"
              actionClassName="bg-white/10 text-white hover:bg-white/20"
            />
          </motion.div>
        )}

        {/* ------------------------------ DONE ------------------------------ */}
        {phase === 'done' && done && (
          <motion.div key="done" className="relative z-10 flex flex-1 flex-col items-center justify-center px-3 sm:px-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h2 className="mb-6 text-3xl font-black text-white sm:mb-8 sm:text-5xl">FULL RESULTS</h2>
            <div className="w-full max-w-lg space-y-2">
              {done.results.map((r, i) => (
                <div key={r.playerId} className={`flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 sm:gap-4 sm:px-4 ${i === 0 ? 'bg-arena-gold/20 ring-1 ring-arena-gold' : 'bg-white/5'}`}>
                  <span className={`w-7 shrink-0 font-mono text-base font-black text-arena-gold sm:w-8 sm:text-lg`}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-white">{r.nickname}</span>
                  <span className="shrink-0 text-xs text-white/50 sm:text-sm">{r.correct}✓</span>
                  <span className="shrink-0 font-mono font-black text-arena-gold">{r.total.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <button onClick={onExit} className="mt-8 rounded-2xl bg-arena-gold px-8 py-3 text-base font-black text-arena-navy hover:brightness-110 sm:mt-10 sm:px-10 sm:text-lg">
              Back to Dashboard
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Simple 32-bit string hash so avatars are stable per player id.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}