// Host login gate — the admin PIN unlocks the builder + hosting.
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useHost } from '../store/useHost.js';
import Logo from '../components/Logo.jsx';

export default function HostLogin({ onBack }) {
  const { login, authLoading, authError } = useHost();
  const [pin, setPin] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (pin.length >= 4) login(pin);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-6">
        <Logo size={84} />
      </motion.div>
      <h1 className="mb-1 text-3xl font-extrabold text-white">Host Console</h1>
      <p className="mb-8 text-arena-gold">Royal Rangers Quiz Control</p>

      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-white/60">ADMIN PIN</label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            inputMode="numeric"
            type="password"
            placeholder="••••••"
            className="w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 py-3 text-center font-mono text-3xl tracking-[0.3em] text-white outline-none focus:border-arena-gold"
          />
        </div>
        {authError && <p className="text-sm font-medium text-arena-red">{authError}</p>}
        <motion.button
          whileTap={{ scale: 0.97 }}
          type="submit"
          disabled={authLoading || pin.length < 4}
          className="w-full rounded-xl bg-arena-gold py-3.5 text-lg font-extrabold text-arena-navy shadow-lg shadow-arena-gold/30 hover:brightness-110 disabled:opacity-60"
        >
          {authLoading ? 'Checking…' : 'Unlock'}
        </motion.button>
        <button onClick={onBack} className="w-full py-2 text-sm text-white/50 hover:text-white">← Back</button>
      </form>
    </div>
  );
}