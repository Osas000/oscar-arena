// OSCAR ARENA brand mark — the OSCAR wordmark with the peaked "A" (brief §2).
// Reused treatment from the main Oscar app's OscarBrand component.
export default function Logo({ size = 64, className = '' }) {
  const wordSize = size * 0.7;
  return (
    <div
      className={`inline-flex flex-col items-center ${className}`}
      style={{ gap: size * 0.05 }}
    >
      {/* OSCAR wordmark with peaked A */}
      <span
        style={{
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          fontWeight: 800,
          fontSize: wordSize,
          letterSpacing: '0.24em',
          color: '#ffffff',
          lineHeight: 1,
          position: 'relative',
        }}
      >
        OSC<span style={{ position: 'relative', display: 'inline-block' }}>A
          <svg
            width={wordSize * 0.62}
            height={wordSize * 0.30}
            viewBox="0 0 20 10"
            style={{ position: 'absolute', left: '8%', bottom: '18%', pointerEvents: 'none' }}
            aria-hidden="true"
          >
            <path d="M1 9 L10 0 L19 9" stroke="#ffdc51" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>R
      </span>
      <span
        style={{
          fontSize: size * 0.12,
          letterSpacing: '0.36em',
          color: '#ffdc51',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        ARENA
      </span>
    </div>
  );
}
