// The app's notifications, all with the same look. Built on the existing
// toast so older screens and new ones show up the same way.
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";
import { logError } from "@/lib/errorLog";

type Opts = { description?: string; key?: string };

// Same message within 3 seconds is shown once
const recent = new Map<string, number>();
function once(key: string) {
  const now = Date.now();
  const last = recent.get(key) || 0;
  recent.set(key, now);
  return now - last > 3000;
}

function show(variant: "success" | "warning" | "info" | "destructive" | "default", title: string, o: Opts = {}, duration?: number) {
  if (!once(o.key || `${variant}:${title}:${o.description || ""}`)) return;
  return toast({ title, description: o.description, variant, duration });
}

export const notify = {
  success: (title: string, o?: Opts) => show("success", title, o, 4000),
  info: (title: string, o?: Opts) => show("info", title, o, 5000),
  warning: (title: string, o?: Opts) => show("warning", title, o, 7000),
  /** Stays until closed: for things that did not get saved. */
  error: (title: string, o?: Opts) => show("destructive", title, o, Infinity),
  /** Logs the real error and shows a plain-words message. */
  fromError: (error: unknown, action?: string) => {
    logError(action || "Action failed", error);
    const f = friendlyError(error, action);
    return show("destructive", f.title, { description: f.description }, Infinity);
  },
};
