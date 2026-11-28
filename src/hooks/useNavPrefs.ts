// Sidebar preferences kept on this device: favourite pages, recently visited
// pages and which groups are folded. Stored per signed-in user. If storage is
// blocked (private mode) everything still works, it just isn't remembered.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

interface NavPrefs {
  favourites: string[];
  recent: string[];
  closedGroups: string[];
}

const EMPTY: NavPrefs = { favourites: [], recent: [], closedGroups: [] };
const EVENT = "dailykart-nav-prefs";
const MAX_RECENT = 5;

const keyFor = (userId?: string) => `dailykart-nav-${userId || "anon"}`;

function read(userId?: string): NavPrefs {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return EMPTY;
    const p = JSON.parse(raw);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { favourites: list(p.favourites), recent: list(p.recent).slice(0, MAX_RECENT), closedGroups: list(p.closedGroups) };
  } catch {
    return EMPTY;
  }
}

function write(userId: string | undefined, prefs: NavPrefs) {
  try { localStorage.setItem(keyFor(userId), JSON.stringify(prefs)); } catch { /* not remembered */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useNavPrefs() {
  const { user } = useAuth();
  const userId = user?.id;
  const [prefs, setPrefs] = useState<NavPrefs>(() => read(userId));

  useEffect(() => {
    const update = () => setPrefs(read(userId));
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [userId]);

  const change = useCallback((fn: (p: NavPrefs) => NavPrefs) => write(userId, fn(read(userId))), [userId]);

  const toggleFavourite = useCallback((url: string) => change((p) => ({
    ...p,
    favourites: p.favourites.includes(url) ? p.favourites.filter((u) => u !== url) : [...p.favourites, url],
  })), [change]);

  const addRecent = useCallback((url: string) => change((p) => (
    p.recent[0] === url ? p : { ...p, recent: [url, ...p.recent.filter((u) => u !== url)].slice(0, MAX_RECENT) }
  )), [change]);

  const toggleGroup = useCallback((id: string) => change((p) => ({
    ...p,
    closedGroups: p.closedGroups.includes(id) ? p.closedGroups.filter((g) => g !== id) : [...p.closedGroups, id],
  })), [change]);

  return { ...prefs, toggleFavourite, addRecent, toggleGroup };
}

const SIDEBAR_KEY = "dailykart-sidebar-open";

export function readSidebarOpen(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) !== "0"; } catch { return true; }
}

export function saveSidebarOpen(open: boolean) {
  try { localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0"); } catch { /* not remembered */ }
}
