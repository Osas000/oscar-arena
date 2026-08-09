// OSCAR ARENA root — routes Player vs Host mode with hash routing.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { usePlayer } from './store/usePlayer.js';
import { useHost } from './store/useHost.js';
import Landing from './screens/Landing.jsx';
import PlayerJoin from './screens/PlayerJoin.jsx';
import PlayerGame from './screens/PlayerGame.jsx';
import HostLogin from './screens/HostLogin.jsx';
import HostDashboard from './screens/HostDashboard.jsx';
import QuizBuilder from './screens/QuizBuilder.jsx';
import HostLive from './screens/HostLive.jsx';

function parseRoute() {
  const parts = (window.location.hash || '#/').replace(/^#\//, '').split('/').filter(Boolean);
  return { mode: parts[0] || 'landing', sub: parts[1] || '', param: parts[2] || '' };
}

export const go = (hash) => { window.location.hash = hash; };

export default function App() {
  const [route, setRoute] = useState(parseRoute());
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const player = usePlayer();
  const host = useHost();

  // Auto-connect the player socket once we're in player mode (join screen).
  useEffect(() => {
    if (route.mode === 'player' && !player.socket) player.connect();
  }, [route.mode]);

  // Auto-resume a live host session after a page refresh (network cut /
  // airplane-mode scenario): re-attach to the SAME session instead of making
  // the user re-enter the PIN while the host-lost auto-end is ticking.
  useEffect(() => {
    if (route.mode === 'host') host.tryAutoResume?.();
  }, [route.mode]);

  const screen = (() => {
    // ------------------------------- PLAYER -------------------------------
    if (route.mode === 'player') {
      // After a page refresh we hold a resume context but not yet a playerId:
      // route straight to the game screen which shows "Connecting…" and silently
      // re-attaches our identity. Only show the join form when we truly have no
      // session to resume.
      const resuming = player.resumeToken && !player.playerId && (player.sessionId || player.pin);
      if (player.playerId || resuming) {
        return <PlayerGame onLeave={() => { player.reset(); go('/'); }} onHome={() => { player.reset(); go('/'); }} />;
      }
      if (player.phase === 'left') {
        // Leaving the arena: reset() flips to 'left' — show a clean goodbye
        // instead of flashing the PIN form for the frame before the router
        // lands on the homepage.
        return (
          <div className="flex min-h-screen flex-col items-center justify-center text-center px-6">
            <div className="mb-4 text-5xl">👋</div>
            <h2 className="text-2xl font-bold text-white">See you at the next game!</h2>
            <button onClick={() => { player.reset(); go('/'); }} className="mt-8 rounded-xl bg-arena-gold px-8 py-3 font-bold text-arena-navy hover:brightness-110">
              Back to Home
            </button>
          </div>
        );
      }
      return <PlayerJoin onBack={() => go('/')} />;
    }

    // -------------------------------- HOST --------------------------------
    if (route.mode === 'host') {
      // Restoring from a live session (refresh / airplane-mode recovery): show
      // the silent reconnect screen until auth + live session are back — never
      // flash the PIN form or a stale dashboard mid-restore.
      if (host.restoring && !host.live) {
        return (
          <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.6, ease: 'linear' }} className="mb-6 text-5xl">🧭</motion.div>
            <h2 className="text-xl font-bold text-white">Reconnecting to your session…</h2>
            <p className="mt-2 text-sm text-white/50">Hold on, we're getting you back in.</p>
          </div>
        );
      }
      if (!host.authed) return <HostLogin onBack={() => go('/')} />;

      if (route.sub === 'builder') {
        return (
          <QuizBuilder
            quizId={route.param}
            onBack={() => go('/host')}
            onHost={(id) => { host.hostGame(id).then(() => go('/host/live')).catch(() => go('/host')); }}
          />
        );
      }

      if (host.live && host.phase !== 'idle') {
        return <HostLive onExit={() => { host.end().then(() => { host.destroy(); go('/host'); }); }} />;
      }

      return (
        <HostDashboard
          onOpenBuilder={(id) => go(`/host/builder/${id}`)}
          onHost={(id) => { host.hostGame(id).then(() => go('/host/live')).catch((e) => console.error(e)); }}
        />
      );
    }

    // ------------------------------ LANDING -------------------------------
    return <Landing />;
  })();

  return (
    <>
      {/* Arena ambience: drifting nebula + rising sparkles, behind all screens */}
      <div className="arena-ambience" aria-hidden="true">
        {SPARKS.map((sp) => (
          <span
            key={sp.id}
            className="arena-spark"
            style={{
              left: `${sp.x}%`,
              width: sp.s,
              height: sp.s,
              animationDuration: `${sp.d}s`,
              animationDelay: `${sp.delay}s`,
            }}
          />
        ))}
      </div>
      <div className="relative z-10">{screen}</div>
    </>
  );
}

const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  id: i,
  x: (i * 137.5) % 100,
  s: 2 + ((i * 7) % 4),
  d: 9 + ((i * 3) % 8),
  delay: (i * 1.7) % 12,
}));