import { HINDI } from "./hindi";

export type Lang = "en" | "hi";
const EVENT = "dk-language";

export function getLang(): Lang {
  try {
    const s = JSON.parse(localStorage.getItem("user-settings") || "{}");
    return s.language === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

/** Save the language and switch the screen right away. */
export function setLang(lang: Lang) {
  try {
    const s = JSON.parse(localStorage.getItem("user-settings") || "{}");
    localStorage.setItem("user-settings", JSON.stringify({ ...s, language: lang }));
  } catch { /* keep the screen working even if storage is blocked */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: lang }));
}

export function onLangChange(fn: (l: Lang) => void) {
  const h = (e: Event) => fn(((e as CustomEvent).detail as Lang) || getLang());
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

const TAIL = /[\s:*₹-]+$/;

/** Hindi for one piece of screen text, or null when there is none. Keeps spaces and a trailing ":", "*" or "₹". */
export function toHindi(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 300 || !/[A-Za-z]/.test(t)) return null;
  const lead = text.slice(0, text.indexOf(t[0]));
  const trail = text.slice(text.lastIndexOf(t[t.length - 1]) + 1);
  let hit = HINDI[t];
  let suffix = "";
  if (!hit) {
    const m = t.match(TAIL);
    if (m) {
      const base = t.slice(0, t.length - m[0].length);
      if (HINDI[base]) { hit = HINDI[base]; suffix = m[0]; }
    }
  }
  return hit ? lead + hit + suffix + trail : null;
}
