// Player game surface: everything after joining, driven by server events.
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayer } from '../store/usePlayer.js';
import AnswerTiles from '../components/AnswerTiles.jsx';
import TimerBar from '../components/TimerBar.jsx';
import Countdown from '../components/Countdown.jsx';
import Podium from '../components/Podium.jsx';
import Logo from '../components/Logo.jsx';
import { tick } from '../lib/audio.js';

// Deterministic avatar so players recognise their own tile.
const AVATARS = ['🦊', '🚀', '🦉', '🐉', '🐯', '🦄', '🦅', '⭐', '⚡', '🐳', '🦈', '🦩', '🐺', '🦖'];
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function PlayerGame({ onLeave }) {
  const s = usePlayer();
  const { phase, question, myChoice, myResult, total, correctCount } = s;
  const answered = myChoice != null;

  // Audible tick for the final 5 seconds of a live question.
  const deadline = question?.deadline || 0;
  useEffect(() => {
    if (phase !== 'question' || answered || !deadline) return;
    const id = setInterval(() => {
      const remain = Math.ceil((deadline - (Date.now() + s.serverOffset)) / 1000);
      if (remain <= 5 && remain > 0) tick();
    }, 1000);
    return () => clearInterval(id);
  }, [phase, answered, deadline, s.serverOffset]);

  // Hard fairness gate: the ✓/✗/highlight/dim may only appear once the
  // SERVER-adjusted clock has reached the question deadline. A phone whose
  // clock is behind the server would otherwise display the reveal (which the
  // server broadcasts right after the deadline) while its own timer still
  // shows seconds remaining — the exact 'hint before the timer finished'
  // behaviour players complained about. Until then, keep the waiting state.
  const serverNow = Date.now() + s.serverOffset;
  const revealReady = !deadline || serverNow >= deadline;
  // Belt-and-braces: the reveal may only paint for the question the result
  // actually belongs to. A stale result from a previous round (e.g. restored
  // by a reconnect snapshot) must never draw a ✓ over the current question.
  const sameRound = !myResult?.questionIndex || !question || myResult.questionIndex === question.index;
  const canReveal = revealReady && sameRound;

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-6">
      {/* header */}
      <header className="mb-4 flex w-full max-w-2xl items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo size={40} />
          <span className="hidden text-sm font-semibold text-white/60 sm:inline">{s.nickname}</span>
        </div>
        <div className="flex items-center gap-3 text-right">
          <motion.span animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 2 }} className="text-2xl">
            {AVATARS[hashStr(s.playerId || 'me') % AVATARS.length]}
          </motion.span>
          <div>
            <div className="text-xs text-white/50">Score</div>
            <div className="font-mono text-2xl font-bold text-arena-gold">{total.toLocaleString()}</div>
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {/* ---------------- LOBBY (waiting for host) ---------------- */}
        {phase === 'lobby' && (
          <motion.div key="lobby" className="flex flex-1 flex-col items-center justify-center text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
              className="mb-6 text-5xl"
            >🧭</motion.div>
            <h2 className="text-2xl font-bold text-white">Waiting for the host to start…</h2>
            <p className="mt-2 text-white/60">Get ready, {s.nickname}!</p>
          </motion.div>
        )}

        {/* ---------------- COUNTDOWN (start of game) ---------------- */}
        {phase === 'countdown' && (
          <motion.div key="countdown" className="flex flex-1 flex-col items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Countdown deadline={s.countdownDeadline} serverOffset={s.serverOffset} />
          </motion.div>
        )}

        {/* ---------------- QUESTION / ANSWER ---------------- */}
        {(phase === 'question' || (phase === 'reveal' && !myResult) || (phase === 'reveal' && myResult && !canReveal)) && question && (
          <motion.div key="q" className="flex w-full flex-1 flex-col items-center" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -24 }}>
            <div className="mb-2 text-sm font-semibold text-white/50">
              Question {question.index + 1} of {question.total}
            </div>
            <h1 className="mb-4 max-w-full break-words text-center text-2xl font-extrabold text-white sm:text-3xl">{question.prompt}</h1>

            {!answered && phase === 'question' ? (
              <>
                <div className="mb-6 w-full"><TimerBar deadline={question.deadline} totalMs={question.timeLimit * 1000} serverOffset={s.serverOffset} /></div>
                <AnswerTiles options={question.options} onPick={(c) => s.answer(c)} myChoice={myChoice} />
              </>
            ) : (
              <motion.div className="flex flex-col items-center py-16" initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
                <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} className="mb-4 text-6xl">⏳</motion.div>
                <p className="text-xl font-bold text-white">{myResult ? 'Checking…' : 'Answer locked in!'}</p>
                <p className="mt-1 text-white/60">Waiting for everyone else…</p>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ---------------- REVEAL (my result) ---------------- */}
        {phase === 'reveal' && myResult && canReveal && question && (
          <motion.div
            key="reveal"
            className={`flex w-full flex-1 flex-col items-center ${myResult.correct ? '' : 'game-over'}`}
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
          >
            <div className="mb-2 text-sm font-semibold text-white/50">Reveal</div>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16 }}
              className={`pop-victory mb-4 flex h-28 w-28 items-center justify-center rounded-full text-6xl font-black shadow-2xl ${myResult.correct ? 'bg-arena-green text-white' : 'bg-arena-red text-white'}`}
            >
              {myResult.correct ? '✓' : '✗'}
            </motion.div>
            <h2 className={`text-3xl font-extrabold ${myResult.correct ? 'text-arena-green' : 'text-arena-red'}`}>
              {myResult.correct ? 'Correct!' : 'Not quite'}
            </h2>
            {myResult.correct && (
              <p className="mt-1 text-lg font-bold text-arena-gold">+{myResult.points.toLocaleString()} pts{myResult.streak > 1 ? ` · ${myResult.streak} streak!` : ''}</p>
            )}
            <div className="mt-8 w-full">
              <AnswerTiles
                options={question.options}
                revealChoice={myResult.correctChoice}
                myChoice={myChoice}
                myResult={myResult}
                disabled
              />
            </div>
            <div className="mt-6 flex items-center gap-8">
              <div className="text-center">
                <div className="text-xs text-white/50">Total</div>
                <div className="font-mono text-2xl font-bold text-arena-gold">{total.toLocaleString()}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-white/50">Correct</div>
                <div className="font-mono text-2xl font-bold text-white">{correctCount}</div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ---------------- SCOREBOARD ---------------- */}
        {phase === 'scoreboard' && (
          <motion.div key="sb" className="flex w-full flex-1 flex-col items-center" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <h2 className="mb-6 text-3xl font-extrabold text-white">Leaderboard</h2>
            <div className="w-full max-w-md space-y-2">
              {s.scoreboardTop.map((r, i) => (
                <motion.div
                  key={r.playerId}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
                    r.playerId === s.playerId ? 'bg-arena-gold/20 ring-2 ring-arena-gold' : 'bg-white/5'
                  }`}
                >
                  <span className="w-6 text-center text-2xl">{i === 0 ? '🏆' : AVATARS[hashStr(r.playerId) % AVATARS.length]}</span>
                  <span className={`w-8 text-center font-mono text-xl font-black ${i === 0 ? 'text-arena-gold' : 'text-white/50'}`}>{i + 1}</span>
                  <span className="flex-1 truncate font-semibold text-white">
                    {r.nickname}{r.playerId === s.playerId && <span className="ml-2 text-arena-gold">(you)</span>}
                  </span>
                  <span className="font-mono font-bold text-arena-gold">{r.total.toLocaleString()}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ---------------- PODIUM ---------------- */}
        {phase === 'podium' && s.podium && (
          <motion.div key="podium" className="flex flex-1 flex-col items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Podium top3={s.podium.top3} myPlayerId={s.playerId} />
          </motion.div>
        )}

        {/* ---------------- DONE ---------------- */}
        {phase === 'done' && (
          <motion.div key="done" className="flex flex-1 flex-col items-center justify-center text-center px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="mb-4 text-6xl">{s.kicked ? '🚫' : s.done?.reason === 'host' ? '🔚' : '🏁'}</div>
            <h2 className="text-3xl font-black text-white">
              {s.kicked ? 'You were removed' : s.done?.reason === 'host' ? 'Session Ended' : 'Game Over'}
            </h2>
            {s.done?.reason === 'host' && (
              <p className="mt-2 text-white/70">The host ended this session. Thanks for playing, {s.nickname}!</p>
            )}
            {/* Host-ended / removed sessions are NOT a conclusion: no rank, no
                champion crown, no results listing. The game was abandoned, so
                the player gets a clean 'try again' — never 'You are the
                CHAMPION' (that only belongs to a naturally finished game). */}
            {!s.kicked && s.done?.reason !== 'host' && s.done?.results && (
              <div className="mt-4">
                <p className="text-white/70">Final score: <span className="font-mono text-2xl font-black text-arena-gold">{total.toLocaleString()}</span></p>
                {/* Your rank out of everyone — computed from the full results list */}
                {(() => {
                  const idx = s.done.results.findIndex((r) => r.playerId === s.playerId);
                  if (idx >= 0) {
                    const rank = idx + 1;
                    const totalPlayers = s.done.results.length;
                    const msg = rank === 1 ? '🥇 You are the CHAMPION!'
                      : rank === 2 ? '🥈 You came 2nd!'
                      : rank === 3 ? '🥉 You came 3rd!'
                      : `You came #${rank} of ${totalPlayers}`;
                    return (
                      <motion.p initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, delay: 0.2 }}
                        className="mt-2 text-2xl font-black text-arena-gold drop-shadow">
                        {msg}
                      </motion.p>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
            <button onClick={onLeave} className="mt-8 rounded-xl bg-arena-gold px-8 py-3 font-bold text-arena-navy hover:brightness-110">
              {s.kicked ? 'Back to start' : s.done?.reason === 'host' ? 'Try again' : 'Back to start'}
            </button>
          </motion.div>
        )}

        {phase === 'join' && (
          <motion.div key="join" className="flex flex-1 items-center justify-center">
            <p className="text-white/60">Connecting…</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}