// One place where the app records errors. Keeps the last few on this device
// (Settings can show them to support) and writes them to the browser console.
// Nothing here is shown to the person as-is: use friendlyError() for that.

export interface LoggedError {
  at: string;
  where: string;
  message: string;
  path: string;
}

const KEY = "dailykart-error-log";
const MAX = 30;

export function logError(where: string, error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : (() => {
    try { return JSON.stringify(error); } catch { return String(error); }
  })();
  console.error(`[DailyKart] ${where}:`, error);
  try {
    const list: LoggedError[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    list.unshift({ at: new Date().toISOString(), where, message: message.slice(0, 500), path: window.location.pathname });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* storage blocked */ }
}

export function readErrorLog(): LoggedError[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

let installed = false;
/** Records crashes that happen outside React (failed promises, script errors). */
export function installGlobalErrorLogging() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("unhandledrejection", (e) => logError("Unhandled promise", e.reason));
  window.addEventListener("error", (e) => logError("Script error", e.error || e.message));
}

/** True when a page's code file could not be downloaded (new version deployed, or offline). */
export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i.test(msg);
}
