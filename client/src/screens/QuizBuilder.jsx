// Quiz builder: create/edit quiz questions and answer options.
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useHost } from '../store/useHost.js';
import { api } from '../lib/api.js';
import Logo from '../components/Logo.jsx';

const DEFAULT_TIME = 30;

function freshOptions() {
  return [
    { id: crypto.randomUUID(), text: '', correct: true },
    { id: crypto.randomUUID(), text: '', correct: false },
  ];
}
const freshQuestion = () => ({
  id: crypto.randomUUID(), type: 'mc', prompt: '', time_limit: DEFAULT_TIME, points: 1000, options: freshOptions(),
});

export default function QuizBuilder({ quizId, onBack, onHost }) {
  const { saveQuiz } = useHost();
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const q = await api.getQuiz(quizId);
        setTitle(q.title || '');
        setQuestions((q.questions || []).map(normalize));
      } catch { setError('Failed to load quiz'); }
      finally { setLoading(false); }
    })();
  }, [quizId]);

  const update = (qi, patch) => setQuestions((qs) => qs.map((q, i) => (i === qi ? { ...q, ...patch } : q)));
  const updateOption = (qi, oi, patch) => setQuestions((qs) => qs.map((q, i) => i !== qi ? q : ({
    ...q, options: q.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)),
  })));
  const setCorrect = (qi, oi) => setQuestions((qs) => qs.map((q, i) => i !== qi ? q : ({
    ...q, options: q.options.map((o, j) => ({ ...o, correct: j === oi })),
  })));
  const removeQuestion = (qi) => setQuestions((qs) => qs.filter((_, i) => i !== qi));
  const addOption = (qi) => update(qi, { options: [...questions[qi].options, { id: crypto.randomUUID(), text: '', correct: false }] });
  const removeOption = (qi, oi) => update(qi, { options: questions[qi].options.filter((_, j) => j !== oi) });

  const valid = () =>
    title.trim() && questions.length > 0 && questions.every((q) =>
      q.prompt.trim() && Number(q.time_limit) > 0 && q.options.length >= 2 &&
      q.options.every((o) => o.text.trim()) && q.options.some((o) => o.correct)
    );

  const save = async () => {
    if (!valid()) {
      setError('Every question needs a prompt, ≥2 options with text, one correct answer, and a time limit. The quiz needs a title.');
      return;
    }
    setSaving(true); setError('');
    try {
      const cleaned = questions.map((q) => ({
        type: 'mc',
        prompt: q.prompt.trim(),
        time_limit: Number(q.time_limit) || 30,
        points: Number(q.points) || 1000,
        options: q.options.map((o) => ({ text: o.text.trim(), correct: !!o.correct })),
      }));
      const saved = await saveQuiz({ id: quizId, title: title.trim(), questions: cleaned });
      onHost(saved.id);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Logo size={40} />
          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Quiz title"
              className="w-full bg-transparent text-lg font-extrabold text-white outline-none placeholder:text-white/40"
            />
            <p className="text-xs text-white/50">{questions.length} question{questions.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={onBack} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/20">Back</button>
          <motion.button whileTap={{ scale: 0.95 }} onClick={save} disabled={saving}
            className="rounded-lg bg-arena-gold px-4 py-1.5 text-sm font-bold text-arena-navy hover:brightness-110 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save & Host'}
          </motion.button>
        </div>
      </header>

      {error && <p className="mb-4 rounded-xl bg-arena-red/15 px-4 py-2 text-sm text-arena-red">{error}</p>}
      {loading && <p className="text-white/50">Loading quiz…</p>}

      <div className="space-y-5">
        {questions.map((q, qi) => (
          <motion.div key={q.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white/5 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold text-arena-gold">QUESTION {qi + 1}</span>
              <div className="flex gap-1">
                <button onClick={removeQuestion} title="Remove question" className="rounded px-2 py-0.5 text-white/50 hover:bg-arena-red/30 hover:text-arena-red">✕</button>
              </div>
            </div>
            <textarea
              value={q.prompt}
              onChange={(e) => update(qi, { prompt: e.target.value })}
              placeholder="Type the question here…"
              rows={2}
              className="mb-3 w-full resize-none rounded-xl border-2 border-white/10 bg-white/5 px-3 py-2 font-semibold text-white outline-none focus:border-arena-gold"
            />
            <div className="mb-3 flex items-center gap-3 text-sm">
              <label className="text-white/50">Time
                <input
                  type="number" min={3} max={120}
                  value={q.time_limit}
                  onChange={(e) => update(qi, { time_limit: Number(e.target.value) })}
                  className="ml-2 w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-white outline-none focus:border-arena-gold"
                />s
              </label>
              <label className="text-white/50">Points
                <input
                  type="number" min={100} step={100} max={10000}
                  value={q.points}
                  onChange={(e) => update(qi, { points: Number(e.target.value) })}
                  className="ml-2 w-20 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-white outline-none focus:border-arena-gold"
                />
              </label>
            </div>
            <div className="space-y-2">
              {q.options.map((o, oi) => (
                <label key={o.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2 ${o.correct ? 'border-arena-green bg-arena-green/10' : 'border-white/10 bg-white/5'}`}>
                  <input type="radio" name={`correct-${qi}`} checked={!!o.correct}
                    onChange={() => setCorrect(qi, oi)} className="accent-arena-green" title="Mark correct" />
                  <input
                    value={o.text}
                    onChange={(e) => updateOption(qi, oi, { text: e.target.value })}
                    placeholder="Answer option…"
                    className="flex-1 bg-transparent text-white outline-none placeholder:text-white/30"
                  />
                  {q.options.length > 2 && (
                    <button type="button" onClick={() => removeOption(qi, oi)} className="text-white/40 hover:text-arena-red">✕</button>
                  )}
                </label>
              ))}
            </div>
            {q.options.length < 6 && (
              <button onClick={() => addOption(qi)} className="mt-2 text-sm font-medium text-arena-gold hover:underline">
                + Add option
              </button>
            )}
          </motion.div>
        ))}
      </div>

      <button onClick={() => setQuestions((qs) => [...qs, freshQuestion()])}
        className="mt-6 w-full rounded-2xl border-2 border-dashed border-white/20 py-4 font-bold text-white/70 hover:border-arena-gold hover:text-arena-gold">
        + Add question
      </button>
    </div>
  );
}

function normalize(q) {
  return {
    id: crypto.randomUUID(),
    type: q.type || 'mc',
    prompt: q.prompt || '',
    time_limit: q.time_limit ?? DEFAULT_TIME,
    points: q.points ?? 1000,
    options: (q.options || []).map((o) => ({ id: crypto.randomUUID(), text: o.text || '', correct: !!o.correct })),
  };
}