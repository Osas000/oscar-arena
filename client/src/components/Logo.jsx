// OSCAR ARENA brand mark — the official Royal Rangers logo, exactly as
// provided (transparent background), no tile/box around it.
export default function Logo({ size = 64, className = '' }) {
  return (
    <img
      src="/rangers-logo.png"
      alt="Royal Rangers"
      width={size}
      height={size}
      className={`object-contain ${className}`}
      style={{ width: size, height: size, filter: 'drop-shadow(0 4px 14px rgba(0,0,0,0.35))' }}
    />
  );
}