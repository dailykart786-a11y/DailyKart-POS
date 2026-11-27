import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById("root")!).render(<App />);

// Lets the app open without internet (see public/sw.js). Only in the live
// build, so it never gets in the way while developing.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let disabled = false;
    try { disabled = localStorage.getItem('dailykart-no-offline') === '1'; } catch { /* ignore */ }
    if (disabled) {
      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => undefined);
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Offline mode not available', err));
  });
}
