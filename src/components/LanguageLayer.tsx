import { useEffect } from "react";
import { getLang, onLangChange, toHindi, type Lang } from "@/lib/language";

/**
 * Shows the screens in Hindi by swapping known English text in place.
 * Only the words change: nothing is added or removed, so the app works the
 * same. Typed values, codes and anything marked data-no-translate stay as they are.
 */
const ATTRS = ["placeholder", "title", "aria-label"] as const;
const SKIP = "script,style,textarea,code,pre,[contenteditable],[data-no-translate]";

export function LanguageLayer() {
  useEffect(() => {
    const original = new WeakMap<Text, { en: string; hi: string }>();
    const originalAttr = new WeakMap<Element, Record<string, { en: string; hi: string }>>();
    let lang: Lang = getLang();
    let observer: MutationObserver | null = null;

    const skip = (el: Element | null) => !!el && !!el.closest(SKIP);

    const doText = (n: Text) => {
      const v = n.nodeValue || "";
      const seen = original.get(n);
      if (seen && v === seen.hi) return;
      if (skip(n.parentElement)) return;
      const hi = toHindi(v);
      if (hi && hi !== v) { original.set(n, { en: v, hi }); n.nodeValue = hi; }
    };
    const doAttrs = (el: Element) => {
      if (skip(el)) return;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const rec = originalAttr.get(el) || {};
        if (rec[a] && rec[a].hi === v) continue;
        const hi = toHindi(v);
        if (hi && hi !== v) { rec[a] = { en: v, hi }; originalAttr.set(el, rec); el.setAttribute(a, hi); }
      }
    };
    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      doAttrs(root as Element);
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) doText(n as Text); else doAttrs(n as Element);
      }
    };
    const restore = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) {
          const r = original.get(n as Text);
          if (r && n.nodeValue === r.hi) n.nodeValue = r.en;
        } else {
          const rec = originalAttr.get(n as Element);
          if (rec) for (const a of Object.keys(rec)) if ((n as Element).getAttribute(a) === rec[a].hi) (n as Element).setAttribute(a, rec[a].en);
        }
      }
    };
    const start = () => {
      document.documentElement.lang = "hi";
      try { walk(document.body); } catch { /* never break the screen */ }
      observer = new MutationObserver((list) => {
        try {
          for (const m of list) {
            if (m.type === "characterData") doText(m.target as Text);
            else if (m.type === "attributes") doAttrs(m.target as Element);
            else m.addedNodes.forEach(walk);
          }
        } catch { /* ignore */ }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    };
    const stop = () => {
      observer?.disconnect(); observer = null;
      document.documentElement.lang = "en";
      try { restore(); } catch { /* ignore */ }
    };

    if (lang === "hi") start();
    const off = onLangChange((l) => {
      if (l === lang) return;
      lang = l;
      if (l === "hi") start(); else stop();
    });
    return () => { off(); observer?.disconnect(); };
  }, []);
  return null;
}
