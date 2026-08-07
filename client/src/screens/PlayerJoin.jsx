// Player entry: enter the 6-digit game PIN + nickname, tap to join.
import { useState } from 'react';
import { motion } from 'framer-motion';
import { usePlayer } from '../store/usePlayer.js';
import Logo from '../components/Logo.jsx';
import { playRegister } from '../lib/audio.js';

export default function PlayerJoin({ onBack }) {
  const { connect, joinGame, setPin, setNickname, error } = usePlayer();
  const [pin, setLocalPin] = useState('');
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (pin.length !== 6 || !nick.trim()) {
      setErr('Enter the 6-digit PIN and your name.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const socket = usePlayer.getState().socket || connect();
      setPin(pin);
      setNickname(nick.trim());
      // Forward any stored resume token for THIS pin so the server re-attaches
      // us instead of creating a duplicate and rejecting with NAME_TAKEN.
      // (PlayerId may be null after a refresh — the token is what matters.)
      const saved = usePlayer.getState();
      const resumeToken = saved.pin === pin ? saved.resumeToken : null;
      const ack = await joinGame(pin, resumeToken);
      if (!ack.ok) throw new Error(ack.error);
      playRegister();
    } catch (ex) {
      setErr(ex.message || 'Could not join. Check the PIN.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-6">
        <Logo size={84} />
      </motion.div>

      <div className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">OSCAR ARENA</h1>
        <p className="mt-1 text-arena-gold">Royal Rangers Live Quiz</p>
      </div>

      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-white/60">GAME PIN</label>
          <input
            value={pin}
            onChange={(e) => { setLocalPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }}
            inputMode="numeric"
            placeholder="000 000"
            className="w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 py-3 text-center font-mono text-3xl tracking-[0.3em] text-white outline-none focus:border-arena-gold"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-white/60">YOUR NICKNAME</label>
          <input
            value={nick}
            onChange={(e) => { setNick(e.target.value.slice(0, 24)); setErr(''); }}
            placeholder="e.g. RangerOne"
            className="w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 py-3 text-lg text-white outline-none focus:border-arena-gold"
          />
        </div>
        {(err || error) && <p className="text-sm font-medium text-arena-red">{err || error}</p>}

        <motion.button
          whileTap={{ scale: 0.97 }}
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-arena-gold py-3.5 text-lg font-extrabold text-arena-navy shadow-lg shadow-arena-gold/30 transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? 'Joining…' : 'Enter Arena'}
        </motion.button>
        <button onClick={onBack} className="w-full py-2 text-sm text-white/50 hover:text-white">
          ← Back
        </button>
      </form>
    </div>
  );
}