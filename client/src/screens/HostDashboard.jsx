// Host dashboard: quiz library + create + edit + host actions.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useHost } from '../store/useHost.js';
import Logo from '../components/Logo.jsx';

export default function HostDashboard({ onOpenBuilder, onHost }) {
  const { quizzes, loadQuizzes, createQuiz, deleteQuiz, logout, quizzesLoading, changePin, pinSaved, hostingQuizId, hostError } = useHost();
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinErr, setPinErr] = useState('');

  useEffect(() => { loadQuizzes().catch(() => {}); }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const q = await createQuiz(newTitle.trim());
      setNewTitle('');
      onOpenBuilder(q.id);
    } finally { setCreating(false); }
  };

  const savePin = async (e) => {
    e.preventDefault();
    setPinErr('');
    if (!/^\d{4,8}$/.test(newPin)) { setPinErr('New PIN must be 4–8 digits.'); return; }
    if (newPin !== confirmPin) { setPinErr('New PIN and confirmation do not match.'); return; }
    setPinBusy(true);
    try {
      await changePin(currentPin, newPin);
      setShowPinModal(false);
      setCurrentPin(''); setNewPin(''); setConfirmPin('');
    } catch (err) {
      setPinErr(err.message || 'Could not change PIN.');
    } finally { setPinBusy(false); }
  };

  const remove = async (id) => {
    setDeletingId(id);
    try { await deleteQuiz(id); } finally { setDeletingId(null); }
  };

  return (
    <div className="min-h-screen px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <Logo size={44} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold text-white">Quiz Library</h1>
            <p className="text-xs text-white/50">Host console</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowPinModal(true)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/20 sm:text-sm">🔒 Change PIN</button>
          <button onClick={logout} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/20 sm:text-sm">Sign out</button>
        </div>
      </header>

      {hostError && (
        <div className="mb-4 rounded-xl bg-arena-red/15 px-4 py-3 text-sm font-semibold text-arena-red ring-1 ring-arena-red/40">
          ⚠ Could not host: {hostError}
        </div>
      )}

      {pinSaved && (
        <div className="mb-4 rounded-xl bg-arena-green/15 px-4 py-3 text-sm font-semibold text-arena-green ring-1 ring-arena-green/40">
          ✔ Admin PIN changed successfully.
        </div>
      )}

      {/* create */}
      <form onSubmit={create} className="mb-6 flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New quiz title…"
          className="min-w-0 flex-1 rounded-xl border-2 border-white/15 bg-white/5 px-4 py-2.5 text-white outline-none focus:border-arena-gold"
        />
        <motion.button whileTap={{ scale: creating ? 1 : 0.96 }} disabled={creating || !newTitle.trim()} className="rounded-xl bg-arena-gold px-5 py-2.5 font-bold text-arena-navy hover:brightness-110 disabled:opacity-50">
          {creating ? <><span className="arena-spinner" />Creating…</> : '+ Create'}
        </motion.button>
      </form>

      {quizzesLoading && <p className="text-white/50">Loading…</p>}

      {!quizzesLoading && quizzes.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-white/15 p-10 text-center text-white/50">
          No quizzes yet. Create your first one above.
        </div>
      )}

      <div className="space-y-3">
        {quizzes.map((q, i) => (
          <motion.div key={q.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/5 p-4 sm:gap-3">
            <div className="min-w-0 flex-1 basis-40">
              <div className="truncate font-bold text-white">{q.title}</div>
              <div className="text-xs text-white/50">{q.questionCount} question{q.questionCount === 1 ? '' : 's'}</div>
            </div>
            <button onClick={() => onOpenBuilder(q.id)} disabled={hostingQuizId !== null}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/20 disabled:opacity-40">
              Edit
            </button>
            <motion.button whileTap={{ scale: hostingQuizId === q.id ? 1 : 0.96 }} disabled={hostingQuizId !== null}
              onClick={() => onHost(q.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold text-arena-navy ${hostingQuizId === q.id ? 'bg-arena-gold' : 'bg-arena-gold hover:brightness-110'} disabled:opacity-60`}>
              {hostingQuizId === q.id ? <><span className="arena-spinner" />Hosting…</> : 'Host ▶'}
            </motion.button>
            <button onClick={() => remove(q.id)} disabled={deletingId !== null || hostingQuizId !== null}
              className="rounded-lg bg-arena-red/20 px-2.5 py-1.5 text-sm text-arena-red hover:bg-arena-red/40 disabled:opacity-40" title="Delete quiz">
              {deletingId === q.id ? <span className="arena-spinner" /> : '✕'}
            </button>
          </motion.div>
        ))}
      </div>

      {/* ---------- Change Admin PIN modal ---------- */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => setShowPinModal(false)}>
          <motion.form
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={savePin}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-arena-navy p-6 shadow-2xl"
          >
            <h2 className="mb-4 text-xl font-extrabold text-white">Change Admin PIN</h2>
            <p className="mb-4 text-sm text-white/60">Enter your current PIN and choose a new one (4–8 digits). This protects the host console from the default.</p>

            <label className="mb-1 block text-sm font-medium text-white/60">CURRENT PIN</label>
            <input value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 8))} type="password" inputMode="numeric" placeholder="••••••"
              className="mb-3 w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 py-2.5 text-center font-mono text-2xl tracking-widest text-white outline-none focus:border-arena-gold" />

            <label className="mb-1 block text-sm font-medium text-white/60">NEW PIN</label>
            <input value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))} type="password" inputMode="numeric" placeholder="••••••"
              className="mb-3 w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 py-2.5 text-center font-mono text-2xl tracking-widest text-white outline-none focus:border-arena-gold" />

            <label className="mb-1 block text-sm font-medium text-white/60">CONFIRM NEW PIN</label>
            <input value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))} type="password" inputMode="numeric" placeholder="••••••"
              className="mb-4 w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 py-2.5 text-center font-mono text-2xl tracking-widest text-white outline-none focus:border-arena-gold" />

            {pinErr && <p className="mb-3 text-sm font-medium text-arena-red">{pinErr}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={() => setShowPinModal(false)} className="flex-1 rounded-xl bg-white/10 py-2.5 font-bold text-white/70 hover:bg-white/20">
                Cancel
              </button>
              <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={pinBusy}
                className="flex-1 rounded-xl bg-arena-gold py-2.5 font-extrabold text-arena-navy hover:brightness-110 disabled:opacity-60">
                {pinBusy ? 'Saving…' : 'Save'}
              </motion.button>
            </div>
          </motion.form>
        </div>
      )}
    </div>
  );
}