// Host-side store: auth, quiz library, builder state, and the live host screen.
import { create } from 'zustand';
import { setAdminPin, api } from '../lib/api.js';
import { createSocket } from '../lib/socket.js';

export const HOST_RESUME_KEY = 'oscar_arena_host_resume';

function saveResume(data) {
  try { localStorage.setItem(HOST_RESUME_KEY, JSON.stringify(data)); } catch { /* private mode */ }
}
function loadResume() {
  try {
    const raw = localStorage.getItem(HOST_RESUME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearResume() {
  try { localStorage.removeItem(HOST_RESUME_KEY); } catch { /* ignore */ }
}

export const useHost = create((set, get) => ({
  // --- auth ---
  authed: false,
  authError: null,
  authLoading: false,
  adminPin: '',
  pinSaved: false,       // true after a successful change (show confirmation)

  // --- library ---
  quizzes: [],
  quizzesLoading: false,

  // --- live session ---
  socket: null,
  connected: false,
  // Eager from the first paint: if we ever stored a live session or PIN on
  // this device, a refresh lands on the 'Reconnecting…' screen instead of
  // flashing HostLogin while tryAutoResume does its async work. Falls back
  // to the login page the moment the restore settles.
  restoring: !!(loadResume()?.sessionId || loadResume()?.adminPin),
  live: null,           // session summary { id, pin, status, players:[] }
  phase: 'idle',        // idle | lobby | countdown | question | reveal | scoreboard | podium | done
  question: null,
  countdownDeadline: null,
  countdownDuration: 5, // seconds, from the server countdown payload (clamp source)
  serverOffset: 0,
  // Which host action is currently in-flight (start|next|finish|end|kick:<id>|lock).
  // While non-null, re-entry is ignored and buttons show a pending state — this
  // is what kills the "I have to click 2-3 times before it responds" reports
  // (double-fires, lost fire-and-forget emits during a reconnect, and the
  // double-Start countdown reset).
  pending: null,
  reveal: null,
  answeredCount: 0,
  playerCount: 0,
  scoreboard: null,     // { top, full }
  podium: null,
  done: null,
  locked: false,
  players: [],
  error: null,
  // The quiz currently being hosted (drives "Hosting…" on the dashboard row).
  hostingQuizId: null,
  hostError: null,

  // ----------------------------- auth -----------------------------
  login: async (pin) => {
    set({ authLoading: true, authError: null });
    try {
      setAdminPin(pin);
      const quizzes = await api.listQuizzes();
      // Remember the PIN on this device so a page refresh can silently
      // resume (and re-attach to a live session) instead of forcing a
      // re-typed PIN every time the network blips.
      saveResume({ ...(loadResume() || {}), adminPin: pin });
      set({ authed: true, quizzes, adminPin: pin, authLoading: false });
      // A refresh cleared our live context but the session may still be
      // running — silently re-attach so the game is not orphaned.
      get().tryAutoResume?.();
    } catch (e) {
      setAdminPin(null);
      set({ authLoading: false, authError: 'Wrong PIN. Try again.' });
    }
  },

  logout: () => {
    get().destroy();
    setAdminPin(null);
    clearResume();
    set({ authed: false, quizzes: [], adminPin: '', authError: null, pinSaved: false });
  },

  // Change the admin PIN (current PIN required; installs the new one + updates
  // the locally-stored pin so all subsequent API calls use it).
  changePin: async (currentPin, newPin) => {
    await api.changePin(currentPin, newPin);   // throws on wrong PIN / bad format
    setAdminPin(newPin);
    set({ adminPin: newPin, pinSaved: true });
  },

  loadQuizzes: async () => {
    set({ quizzesLoading: true });
    const quizzes = await api.listQuizzes();
    set({ quizzes, quizzesLoading: false });
  },

  createQuiz: async (title) => {
    const q = await api.createQuiz(title);
    set((s) => ({ quizzes: [q, ...s.quizzes] }));
    return q;
  },

  deleteQuiz: async (id) => {
    await api.deleteQuiz(id);
    set((s) => ({ quizzes: s.quizzes.filter((q) => q.id !== id) }));
  },

  saveQuiz: async (quiz) => {
    const saved = await api.saveQuiz(quiz);
    set((s) => ({ quizzes: s.quizzes.map((q) => (q.id === saved.id ? savingMeta(saved) : q)) }));
    return saved;
  },

  // ----------------------------- host socket -----------------------------
  // Create the host socket once; wire all live events.
  ensureSocket: () => {
    if (get().socket) return get().socket;
    const socket = createSocket();
    set({ socket });
    socket.onAny((evt, payload) => console.log('[HOST-EVT]', evt, JSON.stringify(payload)?.slice(0, 120)));

    socket.on('connect', () => {
      set({ connected: true, reconnecting: false, error: null });
      // Socket.IO reconnects transparently after a network blip — the server
      // sees a fresh socket.id, so re-attach our host identity to the live
      // session (also cancels the server's host-lost auto-end timer).
      const { live } = get();
      const sessionId = live?.id || loadResume()?.sessionId;
      if (sessionId) {
        socket.emit('host:join', { sessionId, adminPin: get().adminPin }, (res) => {
          if (res?.ok) {
            // Refresh-resume: the page reloaded in the middle of a live game
            // (reported: refresh → admin page → PIN → “it ended the session”).
            // Re-attaching here resurrects the SAME session on the SAME
            // quiz — no new session, no data loss, no auto-end.
            if (!live) get().resumeLive(sessionId, res);
          } else {
            set({ error: res?.error || 'Reconnect failed' });
          }
        });
      }
    });
    socket.on('disconnect', () => set({ connected: false, reconnecting: true }));
    // Transient blips (airplane mode, hotspot drops) auto-retry — never show
    // a scary "websocket error" line for something that heals itself.
    socket.on('connect_error', () => set({ reconnecting: true }));

    socket.on('phase', (p) => {
      // 'done' arrives with its payload via the 'done' event right after.
      // Setting phase alone here would render an empty scene and can race
      // AnimatePresence (mode="wait") — the done block never mounts.
      if (p.phase === 'done') return;
      console.log('[PHASE-SET]', p.phase);
      set({ phase: p.phase });
    });
    socket.on('countdown', (c) => set({
      countdownDeadline: c.deadline,
      countdownDuration: c.duration || 5,
      serverOffset: c.serverTime - Date.now(),
      phase: 'countdown',
    }));
    socket.on('question', (q) => set({
      question: q, answeredCount: 0, countdownDeadline: null, serverOffset: q.serverTime - Date.now(), phase: 'question',
      // CRITICAL: never carry the PREVIOUS round's reveal into the new
      // question. A stale {correctChoice} here made the host/projector paint
      // a ✅ over the CURRENT question's tiles while players were still
      // answering ("is that tick showing the answer?" report).
      reveal: null, scoreboard: null, podium: null, done: null,
    }));
    socket.on('answer_received', (() => {
      // HOST-SCREEN SCALE FIX: with N players the server emits ONE
      // answer_received per answer — N re-renders per question would jank a
      // 2000-player event. Batch to ~8 commits/sec (Kahoot-style): the count
      // still lands, the projector stays smooth.
      let buf = null;
      let timer = null;
      return (d) => {
        buf = d;
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          if (buf) { set({ answeredCount: buf.answeredCount, playerCount: buf.playerCount, players: playersFrom(buf) }); buf = null; }
        }, 120);
      };
    })());
    socket.on('player_joined', (d) => {
      set((s) => ({ playerCount: s.playerCount + 1, players: [...s.players.filter((p) => p.id !== d.player.id), d.player] }));
    });
    socket.on('player_kicked', ({ playerId }) => {
      set((s) => ({ players: s.players.filter((p) => p.id !== playerId), playerCount: Math.max(0, s.playerCount - 1) }));
    });
    socket.on('reveal', (d) => set({ reveal: d, phase: 'reveal' }));
    socket.on('scoreboard', (d) => set((s) => ({
      scoreboard: {
        top: d.top || [],
        // Host receives BOTH the player variant ({top}) and host variant
        // ({top, full}) because it sits in both rooms. Preserve the full
        // ranking when the player variant overwrites first.
        full: Array.isArray(d.full) ? d.full : (s.scoreboard?.full || []),
      },
      phase: 'scoreboard',
    })));
    socket.on('podium', (d) => set({ podium: d, phase: 'podium' }));
    socket.on('done', (d) => set({ done: d, phase: 'done' }));
    socket.on('lobby_locked', (d) => set({ locked: d.locked }));
    socket.on('player_count', (d) => set({ playerCount: d.count }));
    return socket;
  },

  // Begin hosting a chosen quiz: create session + attach host socket.
  // Single-flight + feedback: `hostingQuizId` drives instant "Hosting…" UI,
  // and repeated clicks while pending are ignored (they used to silently
  // create MULTIPLE sessions / double-fire). The ROUTER reacts to store state
  // (live+phase), so a late ack can never yank the user off another screen
  // ("I clicked Host, clicked Edit, and the game hosted behind my back").
  hostGame: async (quizId) => {
    if (get().hostingQuizId) return null; // one host operation at a time
    set({ hostingQuizId: quizId, hostError: null });
    try {
      const session = await api.createSession(quizId);
      const socket = get().ensureSocket();
      const res = await new Promise((resolve, reject) => {
        socket.emit('host:join', { sessionId: session.id, adminPin: get().adminPin }, (r) => {
          if (!r?.ok) return reject(new Error(r?.error || 'Could not attach to session'));
          resolve(r);
        });
      });
      // Remember the live session across refreshes (keyed with the PIN we
      // already hold) so a reload re-attaches instead of killing the game.
      saveResume({ sessionId: session.id, adminPin: get().adminPin });
      get().adoptHostState(res);
      set({ hostingQuizId: null });
      return res;
    } catch (e) {
      set({ hostingQuizId: null, hostError: e.message || 'Could not host this quiz' });
      throw e;
    }
  },

  // Adopt full live state (fresh lobby or reconnect restore).
  adoptHostState: (res) => {
    const s = res.live || res.state || {};
    set({
      live: res.session,
      phase: s.status || 'lobby',
      countdownDeadline: s.countdownDeadline || null,
      countdownDuration: s.countdownDuration || 5,
      // CRITICAL for countdown accuracy on refresh/resume: recalibrate the
      // clock offset from the snapshot's FRESH serverTime. Without this the
      // countdown rendered on the raw device clock — a laptop whose clock
      // runs behind the server showed "6,5,4…" instead of "5,4,3…".
      serverOffset: s.serverTime ? s.serverTime - Date.now() : get().serverOffset,
      question: s.question || null,
      reveal: s.correctChoice !== undefined ? { correctChoice: s.correctChoice, distribution: s.distribution } : null,
      scoreboard: s.scoreboard || null,
      podium: s.podium || null,
      done: s.done || null,
      answeredCount: s.answeredCount || 0,
      playerCount: s.playerCount || 0,
      players: s.players || [],
      locked: s.locked || false,
      error: null,
    });
  },

  // A page refresh wipes the in-memory store; if we started a session earlier
  // (sessionId + PIN persisted), silently re-attach to it — the live host is
  // restored, host-lost auto-end cancelled. Returns true when resumed.
  resumeLive: async (sessionId, res) => {
    if (!sessionId) return false;
    const socket = get().socket || get().ensureSocket();
    return new Promise((resolve) => {
      const done = (r) => {
        if (r?.ok) {
          get().adoptHostState(r);
          saveResume({ sessionId, adminPin: get().adminPin });
          resolve(true);
        } else {
          clearResume();
          set({ error: r?.error || 'Session ended' });
          resolve(false);
        }
      };
      if (res) return done(res);
      socket.emit('host:join', { sessionId, adminPin: get().adminPin }, done);
    });
  },

  // Try to resume a previously-live session (page refresh / network drop).
  // Restores the stored PIN + auth silently, then re-attaches the live
  // session so a refresh lands straight back in the game — no re-typed PIN,
  // no host-lost auto-end.
  tryAutoResume: async () => {
    if (get().live) return;
    const stored = loadResume();
    if (!stored) return;
    if (!stored.sessionId && !stored.adminPin) return;
    // Hold the 'Reconnecting…' screen from the first paint until auth AND the
    // live session are restored — prevents the login→dashboard→game flash.
    set({ restoring: true });
    if (stored.adminPin) setAdminPin(stored.adminPin);
    if (!get().authed) {
      try {
        const quizzes = await api.listQuizzes();
        set({ authed: true, quizzes, adminPin: stored.adminPin || get().adminPin, authLoading: false });
      } catch {
        clearResume();
        setAdminPin(null);
        set({ authed: false, authError: null, restoring: false });
        return;
      }
    }
    if (stored.sessionId) await get().resumeLive(stored.sessionId);
    set({ restoring: false });
  },

  // Every host control is ack-gated + single-flight:
  //  - the UI always gets an answer (ok or error) — no more "clicked, nothing
  //    happened, click again" from emits lost in a reconnecting socket;
  //  - while `pending` is set, repeated clicks are ignored — no double-fire.
  // An 8s ack-timeout safety net clears a stuck pending so the host is never
  // locked out (e.g. the socket died mid-flight).
  run: (action, send, rollback) => {
    const { socket, pending } = get();
    if (!socket || !socket.connected) {
      set({ error: 'Disconnected — reconnecting…' });
      return Promise.resolve({ ok: false, error: 'Disconnected' });
    }
    if (pending) return Promise.resolve({ ok: false, error: 'Busy', busy: pending });
    set({ pending: action, error: null });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (get().pending === action) set({ pending: null });
        resolve({ ok: false, error: 'Timed out' });
      }, 8000);
      send((res) => {
        clearTimeout(timer);
        if (res?.ok) {
          set({ pending: null });
        } else {
          set({ pending: null, error: res?.error || 'Action failed — try again' });
          rollback?.();
        }
        resolve(res || { ok: false });
      });
    });
  },

  start: () => get().run('start', (cb) => {
    const { socket, live } = get();
    socket?.emit('host:start', { sessionId: live.id }, cb);
  }),
  next: () => get().run('next', (cb) => {
    const { socket, live } = get();
    socket?.emit('host:next', { sessionId: live.id }, cb);
  }),
  // Natural podium -> show final results. NOT an end: keeps doneReason=null so
  // players see the champion + FULL RESULTS, never the aborted-game wording.
  finish: () => get().run('finish', (cb) => {
    const { socket, live } = get();
    socket?.emit('host:finish', { sessionId: live.id }, cb);
  }),
  // End must be ack'd: the UI navigates away immediately after, and if we
  // fired-and-forgot then reloaded, the emit could race the socket teardown —
  // that was the "end section takes 3-4 reloads" symptom.
  end: () => get().run('end', (cb) => {
    const { socket, live } = get();
    socket?.emit('host:end', { sessionId: live.id }, (res) => {
      if (res?.ok) {
        // Session deliberately ended — stop auto-resuming it on refresh,
        // but keep the PIN so the host isn't forced to retype it.
        saveResume({ adminPin: get().adminPin });
      }
      cb(res);
    });
  }),
  kick: (playerId) => get().run(`kick:${playerId}`, (cb) => {
    const { socket, live } = get();
    socket?.emit('host:kick', { sessionId: live.id, playerId }, cb);
  }),
  // Optimistic toggle: flips instantly; the server's lobby_locked echo agrees,
  // and a failed ack rolls it back.
  setLocked: (locked) => get().run('lock', (cb) => {
    const { socket, live } = get();
    socket?.emit('host:lock', { sessionId: live.id, locked }, cb);
  }, () => set({ locked: !locked })),
  refreshPlayers: () => set((s) => ({ players: s.live?.players || s.players })),

  destroy: () => {
    const s = get().socket;
    if (s) s.disconnect();
    set({
      socket: null, connected: false, restoring: false, reconnecting: false, live: null, phase: 'idle', question: null,
      countdownDeadline: null, countdownDuration: 5, serverOffset: 0, pending: null, reveal: null, answeredCount: 0, playerCount: 0, scoreboard: null, podium: null,
      done: null, locked: false, players: [], error: null, hostingQuizId: null, hostError: null,
    });
  },
}));

function savingMeta(q) {
  return { ...q, questionCount: q.questions?.length ?? q.questionCount ?? 0 };
}
function playersFrom(d) {
  return d.players || [];
}