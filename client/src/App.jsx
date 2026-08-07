// OSCAR ARENA root — routes Player vs Host mode with hash routing.
import { useEffect, useState } from 'react';
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

  const screen = (() => {
    // ------------------------------- PLAYER -------------------------------
    if (route.mode === 'player') {
      // After a page refresh we hold a resume context but not yet a playerId:
      // route straight to the game screen which shows "Connecting…" and silently
      // re-attaches our identity. Only show the join form when we truly have no
      // session to resume.
      const resuming = player.resumeToken && !player.playerId && (player.sessionId || player.pin);
      return (player.playerId || resuming)
        ? <PlayerGame onLeave={() => { player.reset(); go('/'); }} />
        : <PlayerJoin onBack={() => go('/')} />;
    }

    // -------------------------------- HOST --------------------------------
    if (route.mode === 'host') {
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
        return <HostLive onExit={() => { host.destroy(); go('/host'); }} />;
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