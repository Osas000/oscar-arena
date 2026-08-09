// Player-side store: join state, current phase, my score, socket wiring.
import { create } from 'zustand';
import { createSocket } from '../lib/socket.js';
import { playCorrect, playWrong, playRegister, playReveal, playPodium, initAudio } from '../lib/audio.js';
import { confettiBurst } from '../lib/confetti.js';

const RESUME_KEY = 'oscar_arena_resume';
// Persist the full resume context (token + session + pin) so a page refresh
// can silently re-connect the SAME player instead of forcing a fresh join.
const readResume = () => {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};
const writeResume = (ctx) => {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify(ctx)); } catch { /* ignore */ }
};
const clearResume = () => {
  try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
};

export const usePlayer = create((set, get) => ({
  // --- connection ---
  socket: null,
  connected: false,
  reconnecting: false,
  error: null,

  // --- identity ---
  phase: 'join',        // join | lobby | question | answered | reveal | scoreboard | podium | done
  pin: '',
  nickname: '',
  playerId: null,
  resumeToken: null,
  sessionId: null,
  // Hydrate resume context if we have ANY usable piece (token+session OR token+pin
  // from the older save format), so a refresh can always re-attach the player.
  ...(() => {
    const r = readResume();
    return (r.resumeToken && (r.sessionId || r.pin)) ? { resumeToken: r.resumeToken, sessionId: r.sessionId ?? null, pin: r.pin ?? '', nickname: r.nickname ?? '' } : {};
  })(),

  // --- game state ---
  quizTitle: '',
  countdownDeadline: null,
  // Server-offset in ms: serverTime - clientTime, captured when the server's
  // countdown/question payloads arrive. Every client-side countdown subtracts
  // it, so a phone whose clock is seconds behind the server shows the SAME
  // remaining time everyone else sees (root of the 'checkmark before timer
  // finished' and 'question timing differs' reports).
  serverOffset: 0,
  question: null,       // { index, total, type, prompt, timeLimit, deadline, options }
  myChoice: null,
  myResult: null,       // { correct, choice, correctChoice, points, streak, total }
  total: 0,
  correctCount: 0,
  playerCount: 0,
  answeredCount: 0,
  scoreboardTop: [],    // top 5 on scoreboard
  podium: null,         // { top3 }
  done: null,           // { results, ended?, reason? } — reason 'host' when the host ended the session

  // --- ui ---
  locked: false,
  kicked: false,

  setError: (error) => set({ error }),

  connect: () => {
    if (get().socket) return get().socket;
    const socket = createSocket();
    set({ socket });

    socket.on('connect', () => {
      set({ connected: true, reconnecting: false });
      // Reconnect: if we have a resume context, re-join silently to restore
      // the same identity + score (covers page refresh AND network drops).
      const { playerId, resumeToken, sessionId, pin } = get();
      if (resumeToken && (sessionId || pin) && !playerId) {
        get().joinGame(sessionId || pin, resumeToken).catch(() => {
          // Session likely ended while we were away — fall back to join screen.
          clearResume();
          set({ resumeToken: null, sessionId: null, pin: '', nickname: '', playerId: null, error: null, phase: 'join' });
        });
      } else if (playerId && resumeToken && sessionId) {
        get().joinGame(sessionId, resumeToken);
      }
    });
    socket.on('disconnect', () => set({ connected: false }));
    socket.io.on('reconnect_attempt', () => set({ reconnecting: true }));
    socket.io.on('reconnect', () => set({ reconnecting: false }));
    // Transient network blips (airplane mode, hotspot glitches) auto-retry —
    // surface them as a quiet 'reconnecting' flag, NOT as a scary error line
    // on the join screen. Only real join/answer failures set error.
    socket.on('connect_error', () => set({ reconnecting: true }));

    // --- server events ---
    socket.on('phase', (p) => {
      // 'done' is set atomically with its results via the 'done' event;
      // ignore the bare phase so the done screen doesn't flash empty.
      if (p.phase === 'done') return;
      set({ phase: p.phase });
      if (p.phase === 'scoreboard') playReveal();
      if (p.phase === 'podium') { playPodium(); confettiBurst(document.body); }
    });
    socket.on('countdown', (c) => set({
      countdownDeadline: c.deadline,
      serverOffset: c.serverTime - Date.now(),
      phase: 'countdown',
    }));
    socket.on('question', (q) => {
      set({
        question: q,
        serverOffset: q.serverTime - Date.now(),
        myChoice: null, myResult: null, countdownDeadline: null, phase: 'question',
      });
    });
    socket.on('your_result', (r) => {
      // Tag the result with the question it belongs to so a stale result from
      // a PREVIOUS round can never paint itself over a NEW question (the
      // '4th question showed ✓ too early' report: a reconnected player's
      // snapshot can carry an old myResult into the current round).
      set({ myResult: { ...r, questionIndex: get().question?.index ?? -1 }, total: r.total, phase: 'reveal' });
      if (r.correct) playCorrect(); else playWrong();
    });
    socket.on('scoreboard', (sb) => {
      set({ scoreboardTop: sb.top || [], phase: 'scoreboard' });
    });
    socket.on('podium', (p) => {
      set({ podium: p, phase: 'podium' });
      playPodium();
      confettiBurst(document.body);
    });
    socket.on('done', (d) => {
      // A host-ended session is NOT a celebration: no podium fanfare/confetti,
      // and the screen renders a professional 'session ended / try again'
      // page (no champion rank) because the game never concluded.
      set({ done: d, phase: 'done' });
      if (!d.ended && !d.reason) {
        playPodium();
        confettiBurst(document.body, { count: 220 });
      }
    });
    socket.on('kicked', () => {
      set({ kicked: true, phase: 'done', error: 'You were removed from the game' });
    });
    return socket;
  },

  // Join by PIN from the join screen (or resume with a token on reconnect).
  joinGame: (sessionIdOrPin, resumeToken = null) => {
    initAudio();
    const socket = get().socket;
    return new Promise((resolve, reject) => {
      const ack = (res) => {
        if (!res.ok) { set({ error: res.error }); return reject(new Error(res.error)); }
        const resume = { resumeToken: res.resumeToken, sessionId: res.session?.id || sessionIdOrPin, pin: sessionIdOrPin };
        writeResume(resume);
        set({
          playerId: res.playerId,
          resumeToken: res.resumeToken,
          nickname: res.nickname,
          quizTitle: res.session?.quizTitle || '',
          sessionId: res.session?.id,
          pin: sessionIdOrPin,
          playerCount: res.session?.playerCount || 0,
          connected: true,
          error: null,
        });
        // Rehydrate from snapshot (important on reconnect mid-question).
        if (res.state) applySnapshot(res.state);
        resolve(res);
      };
      if (sessionIdOrPin.length === 6 && /^\d{6}$/.test(sessionIdOrPin)) {
        socket.emit('player:join_pin', { pin: sessionIdOrPin, nickname: get().nickname || 'Ranger', resumeToken }, ack);
      } else {
        socket.emit('player:join', { sessionId: sessionIdOrPin, nickname: get().nickname || 'Ranger', resumeToken }, ack);
      }
    });
  },

  setPin: (pin) => set({ pin }),
  setNickname: (nickname) => set({ nickname }),

  // Submit an answer; optimistic-lock so double-taps are ignored.
  answer: (choice) => {
    const { socket, sessionId, playerId, myChoice } = get();
    if (!socket || myChoice !== null) return;
    set({ myChoice: choice });
    playRegister();
    socket.emit('player:answer', { sessionId, playerId, choice }, (res) => {
      if (!res || !res.ok) {
        // Revert so the player can retry if it was a transient issue.
        set({ myChoice: null, error: res ? res.reason : 'No response' });
      }
    });
  },

  reset: () => {
    clearResume();
    const s = get().socket;
    if (s) s.disconnect();
    set({
      socket: null, connected: false, error: null, reconnecting: false, phase: 'left', pin: '', nickname: '',
      playerId: null, resumeToken: null, question: null, myChoice: null, myResult: null,
      total: 0, correctCount: 0, playerCount: 0, answeredCount: 0, scoreboardTop: [], countdownDeadline: null,
      podium: null, done: null, kicked: false, sessionId: null,
    });
  },
}));

function applySnapshot(st) {
  const set = {};
  // Map question-status to question. If we already answered, myChoice is
  // restored below and PlayerGame shows the locked-in state; a raw
  // 'answered' phase has NO render block and would leave a refreshed player
  // staring at a blank screen mid-question.
  if (st.status === 'question') set.phase = 'question';
  else set.phase = st.status;
  if (st.status === 'reveal') {
    // Restore the reveal screen with our answer + correct choice.
    set.myResult = st.myAnswer ? { ...st.myAnswer, correctChoice: st.correctChoice, total: st.total, points: st.myAnswer.points, streak: st.myAnswer.streak, questionIndex: st.question?.index ?? -1 } : null;
    // If we hadn't answered this question yet (late reconnect during reveal),
    // show the reveal tiles disabled with the correct answer highlighted.
    set.correctChoice = st.correctChoice;
  }
  if (st.status === 'scoreboard') set.scoreboardTop = st.scoreboardTop || [];
  if (st.status === 'podium') set.podium = st.podium;
  if (st.status === 'done') set.done = st.done;

  usePlayer.setState({
    ...set,
    total: st.total,
    correctCount: st.correctCount,
    playerCount: st.playerCount,
    answeredCount: st.answeredCount,
    quizTitle: st.quizTitle,
    question: st.question,
    serverOffset: st.serverTime ? st.serverTime - Date.now() : 0,
    countdownDeadline: st.countdownDeadline ?? null,
    myResult: set.myResult ?? (st.myAnswer
      ? { ...st.myAnswer, total: st.total, questionIndex: st.question?.index ?? -1 }
      : null),
    myChoice: st.myAnswer ? st.myAnswer.choice : null,
  });
}