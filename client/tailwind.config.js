/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        arena: {
          navy: '#0B1B3B',
          'navy-deep': '#050D22',
          gold: '#FFB81C',
          red: '#E53935',
          blue: '#1E6BE5',
          yellow: '#FBC02D',
          green: '#43A047',
          surface: 'rgba(11,27,59,0.92)',
          text: '#F4F7FF',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'spin-slow': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
        'pulse-glow': {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(255,184,28,0.35)' },
          '50%': { boxShadow: '0 0 0 14px rgba(255,184,28,0)' },
        },
      },
      animation: {
        'spin-slow': 'spin-slow 8s linear infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};