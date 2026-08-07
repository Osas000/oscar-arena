import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'icons/favicon-48.png'],
      manifest: {
        name: 'OSCAR ARENA — Royal Rangers Quiz',
        short_name: 'Oscar Arena',
        description: 'Royal Rangers live quiz arena. Who will rule the arena?',
        theme_color: '#0B1B3B',
        background_color: '#0B1B3B',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,ico}'],
        // The API + Socket.IO live on the same origin; don't cache dynamic data.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: true },
    }),
  ],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Rollup's default chunking splits safely. (Manual chunks of react +
    // framer-motion created a `motion -> vendor -> motion` cycle that broke
    // react-dom on load — avoid re-adding manualChunks.)
    chunkSizeWarningLimit: 600,
  },
});