// Remembers the browser's "install this app" offer so a button can show it later.
// Chrome and Edge on Android and desktop send the offer. iPhone Safari does not,
// so there the button shows the Share → Add to Home Screen steps instead.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let offer: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });

export function startInstallWatch() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    offer = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => { offer = null; notify(); });
}

export const onInstallChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function isInstalled() {
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  } catch { return false; }
}

export function isIos() {
  const ua = navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

export const canPrompt = () => !!offer;

/** Shows the browser's install box. Returns true when the user said yes. */
export async function promptInstall() {
  if (!offer) return false;
  const e = offer;
  offer = null;
  notify();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice?.outcome === "accepted";
  } catch {
    return false;
  }
}
