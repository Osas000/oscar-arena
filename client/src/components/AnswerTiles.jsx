// Kahoot-style answer tiles: vivid colors + geometric shapes + framer-motion.
// Props:
//   options: [{ id, text }]
//   myChoice: number|null  (the index the current player picked)
//   revealChoice: number|null (correct choice index once revealed; null while answering)
//   myResult: { correct, ... }|null
//   disabled: bool
//   onPick: (choiceIdx) => void
import { motion } from 'framer-motion';

const TILES = [
  { color: '#E53935', label: '◆' }, // red   - diamond
  { color: '#1E6BE5', label: '▲' }, // blue  - triangle
  { color: '#43A047', label: '■' }, // green - square
  { color: '#FBC02D', label: '●' }, // yellow- circle
  { color: '#8E44AD', label: '⬠' }, // purple- pentagon
  { color: '#E67E22', label: '⬢' }, // orange- hexagon
];

export default function AnswerTiles({
  options,
  myChoice = null,
  revealChoice = null,
  myResult = null,
  disabled = false,
  onPick,
}) {
  const revealed = revealChoice != null;

  return (
    <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:gap-4">
      {options.map((opt, i) => {
        const t = TILES[i] || { color: '#7f8c8d', label: '?' };
        const isMyPick = myChoice === opt.id;
        const isRight = revealed && opt.id === revealChoice;
        const iWasWrong = isMyPick && myResult && !myResult.correct;
        const iWasRight = isMyPick && myResult && myResult.correct;

        let cls = '';
        let extra = null;
        let pickedPulse = null;
        if (revealed) {
          if (isRight) {
            cls = 'z-10 ring-4 ring-white scale-110 glow-correct';
            extra = <span className="text-3xl">✓</span>;
          } else if (iWasWrong) {
            cls = 'opacity-90 ring-4 ring-white/70 grayscale-[30%]';
            extra = <span className="text-3xl">✗</span>;
          } else {
            cls = 'opacity-35';
          }
        } else if (isMyPick) {
          // Locked in: QUIET state. No bright ring / pulse / glow — anything
          // eye-catching on the player's own pick reads as a verdict ("it shows
          // I'm right") and leaks a hint while others are still answering.
          // A subtle outline is enough to show the tap landed.
          cls = 'z-10 ring-2 ring-white/40';
        }

        return (
          <motion.button
            key={opt.id}
            whileHover={!disabled && !revealed ? { scale: 1.05, rotate: [0, isMyPick ? 0 : -0.6, 0.6, 0] } : undefined}
            whileTap={!disabled && !revealed ? { scale: 0.9 } : undefined}
            initial={{ opacity: 0, y: 18 }}
            animate={isMyPick && !revealed ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, type: 'spring', stiffness: 300, damping: 18 }}
            onClick={() => !disabled && !revealed && onPick?.(opt.id)}
            className={`relative flex min-h-24 flex-col items-center justify-center rounded-2xl text-white shadow-xl transition-all sm:min-h-28 ${cls} ${revealed ? '' : 'cursor-pointer hover:brightness-110 active:brightness-90'}`}
            style={{ background: `radial-gradient(circle at 30% 20%, ${t.color}, ${t.color}DD)` }}
            aria-label={opt.text}
          >
            {pickedPulse}
            <span className="absolute left-2.5 top-2 text-2xl opacity-70">{t.label}</span>
            <span className="flex max-w-[84%] items-center gap-2 text-center text-base font-bold leading-snug drop-shadow sm:text-lg">
              {extra}
              <span className="break-words whitespace-normal">{opt.text}</span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}