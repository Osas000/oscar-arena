// Host-side store: auth, quiz library, builder state, and the live host screen.
import { create } from 'zustand';
import { setAdminPin, api } from '../lib/api.js';
import { createSocket } from '../lib/socket.js';

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
  live: null,           // session summary { id, pin, status, players:[] }
  phase: 'idle',        // idle | lobby | countdown | question | reveal | scoreboard | podium | done
  question: null,
  countdownDeadline: null,
  reveal: null,
  answeredCount: 0,
  playerCount: 0,
  scoreboard: null,     // { top, full }
  podium: null,
  done: null,
  locked: false,
  players: [],
  error: null,

  // ----------------------------- auth -----------------------------
  login: async (pin) => {
    set({ authLoading: true, authError: null });
    try {
      setAdminPin(pin);
      const quizzes = await api.listQuizzes();
      set({ authed: true, quizzes, adminPin: pin, authLoading: false });
    } catch (e) {
      setAdminPin(null);
      set({ authLoading: false, authError: 'Wrong PIN. Try again.' });
    }
  },

  logout: () => {
    get().destroy();
    setAdminPin(null);
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

    socket.on('connect', () => set({ connected: true, error: null }));
    socket.on('disconnect', () => set({ connected: false }));
    socket.on('connect_error', (e) => set({ error: e.message }));

    socket.on('phase', (p) => { console.log('[PHASE-SET]', p.phase); set({ phase: p.phase }); });
    socket.on('countdown', (c) => set({ countdownDeadline: c.deadline, phase: 'countdown' }));
    socket.on('question', (q) => set({ question: q, answeredCount: 0, countdownDeadline: null, phase: 'question' }));
    socket.on('answer_received', (d) => set({ answeredCount: d.answeredCount, playerCount: d.playerCount, players: playersFrom(d) }));
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
  hostGame: async (quizId) => {
    const session = await api.createSession(quizId);
    const socket = get().ensureSocket();
    return new Promise((resolve, reject) => {
      socket.emit('host:join', { sessionId: session.id, adminPin: get().adminPin }, (res) => {
        if (!res.ok) return reject(new Error(res.error));
        // adopt full live state (handles host reconnect + fresh lobby)
        const s = res.live || res.state || {};
        set({
          live: res.session || session,
          phase: s.status || 'lobby',
          countdownDeadline: s.countdownDeadline || null,
          question: s.question || null,
          reveal: s.correctChoice !== undefined ? { correctChoice: s.correctChoice, distribution: s.distribution } : null,
          scoreboard: s.scoreboard || null,
          podium: s.podium || null,
          answeredCount: s.answeredCount || 0,
          playerCount: s.playerCount || 0,
          players: s.players || [],
          locked: s.locked || false,
          error: null,
        });
        resolve(res);
      });
    });
  },

  start: () => new Promise((resolve) => {
    const { socket, live } = get();
    if (!socket || !live) return resolve({ ok: false, error: 'No live session' });
    socket.emit('host:start', { sessionId: live.id }, (res) => {
      if (!res?.ok) set({ error: res?.error || 'Could not start' });
      resolve(res || { ok: false });
    });
  }),
  next: () => { const { socket, live } = get(); socket?.emit('host:next', { sessionId: live.id }); },
  end: () => { const { socket, live } = get(); socket?.emit('host:end', { sessionId: live.id }); },
  kick: (playerId) => { const { socket, live } = get(); socket?.emit('host:kick', { sessionId: live.id, playerId }); },
  setLocked: (locked) => { const { socket, live } = get(); socket?.emit('host:lock', { sessionId: live.id, locked }); },
  refreshPlayers: () => set((s) => ({ players: s.live?.players || s.players })),

  destroy: () => {
    const s = get().socket;
    if (s) s.disconnect();
    set({
      socket: null, connected: false, live: null, phase: 'idle', question: null,
      countdownDeadline: null, reveal: null, answeredCount: 0, playerCount: 0, scoreboard: null, podium: null,
      done: null, locked: false, players: [], error: null,
    });
  },
}));

function savingMeta(q) {
  return { ...q, questionCount: q.questions?.length ?? q.questionCount ?? 0 };
}
function playersFrom(d) {
  return d.players || [];
}