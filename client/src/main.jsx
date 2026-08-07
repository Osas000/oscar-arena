import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App.jsx';

// PWA update strategy: registerType is 'autoUpdate' (skipWaiting + clientsClaim
// in the generated SW). The first load after a deploy still receives the OLD
// SW-controlled page; when the new SW takes control we force ONE reload so the
// user immediately gets the latest bundle instead of stale cached code.
registerSW({ immediate: true });
let refreshing = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);