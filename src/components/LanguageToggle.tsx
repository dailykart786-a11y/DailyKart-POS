import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getLang, onLangChange, setLang, type Lang } from "@/lib/language";

/** One tap between English and Hindi screens. */
export function LanguageToggle() {
  const [lang, setL] = useState<Lang>(getLang());
  useEffect(() => onLangChange(setL), []);
  return (
    <Button variant="ghost" size="sm" data-no-translate className="px-2 text-sm"
      aria-label={lang === "hi" ? "Switch to English" : "हिंदी में देखें"}
      onClick={() => setLang(lang === "hi" ? "en" : "hi")}>
      {lang === "hi" ? "English" : "हिंदी"}
    </Button>
  );
}
