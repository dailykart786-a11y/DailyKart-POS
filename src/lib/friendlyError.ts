// Turns a database, network or code error into words a shop worker can act
// on. Never shows SQL, table names or stack traces.

export interface FriendlyError {
  title: string;
  description: string;
  /** Matches an error page code where one fits (401, 403, 408, 429, 5xx). */
  code?: number;
  /** True when trying the same thing again may work. */
  retry: boolean;
}

export function friendlyError(error: unknown, action = "That didn't work"): FriendlyError {
  const e: any = error || {};
  const msg = String(e.message || e.error_description || e || "").toLowerCase();
  const code = String(e.code || "");
  const status = Number(e.status || e.statusCode || 0);

  if ((typeof navigator !== "undefined" && navigator.onLine === false) || /failed to fetch|networkerror|network request failed|load failed/.test(msg)) {
    return { title: "No internet connection", description: `${action}. Check the internet and try again.`, retry: true };
  }
  if (status === 401 || /jwt expired|invalid jwt|not authenticated|refresh token/.test(msg) || code === "PGRST301") {
    return { title: "Your sign-in has expired", description: "Please sign in again. Nothing you saved is lost.", code: 401, retry: false };
  }
  if (status === 403 || code === "42501" || /permission denied|row-level security|not allowed/.test(msg)) {
    return { title: "You don't have permission for this", description: "Ask the owner to give your role access.", code: 403, retry: false };
  }
  if (code === "23505" || /duplicate key|already exists/.test(msg)) {
    return { title: "This already exists", description: "A record with the same name, code or number is already saved.", retry: false };
  }
  if (code === "23503") {
    return { title: "This is still in use", description: "Other records depend on it, so it can't be changed or removed.", retry: false };
  }
  if (code === "23514" || code === "22P02" || code === "23502") {
    return { title: "Some details aren't valid", description: "Check the highlighted fields and try again.", retry: false };
  }
  if (code === "P0001" && e.message) {
    // Messages our own database functions raise on purpose (e.g. "Not enough stock") are written for people
    return { title: action, description: String(e.message).slice(0, 200), retry: false };
  }
  if (status === 408 || code === "57014" || /timeout|timed out/.test(msg)) {
    return { title: "This took too long", description: "The server didn't answer in time. Try again in a moment.", code: 408, retry: true };
  }
  if (status === 429 || /too many requests|rate limit/.test(msg)) {
    return { title: "Too many tries", description: "Wait a minute, then try again.", code: 429, retry: true };
  }
  if (status >= 500) {
    return { title: "The server had a problem", description: "Try again in a moment. If it keeps happening, tell the owner.", code: status, retry: true };
  }
  return { title: action, description: "Something went wrong. Try again, and tell the owner if it keeps happening.", retry: true };
}
