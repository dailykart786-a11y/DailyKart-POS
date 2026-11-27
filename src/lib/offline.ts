// Offline billing: bills made while the internet is down are kept on this
// device and sent to the database when the connection comes back.
//
// Everything here is wrapped in try/catch: a full or blocked browser
// storage must never stop the till from working online.
import { supabase } from "@/integrations/supabase/client";

export interface QueuedSale {
  client_ref: string;
  sold_at: string;
  cashier_id: string;
  items: { product_id: string; quantity: number; discount: number }[];
  /** What the bill showed, for the pending list */
  lines: { name: string; quantity: number }[];
  customer_id: string | null;
  payment_method: string;
  payments: Record<string, number> | null;
  location_id: string | null;
  expected_total: number;
  /** The connection dropped while saving: the bill may already be in the database */
  uncertain: boolean;
  attempts: number;
  last_error?: string | null;
}

const QUEUE_KEY = "dailykart-offline-sales-v1";
export const QUEUE_EVENT = "dailykart-offline-queue";

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const readQueue = (): QueuedSale[] => {
  const q = read<QueuedSale[]>(QUEUE_KEY, []);
  return Array.isArray(q) ? q : [];
};
const saveQueue = (q: QueuedSale[]) => {
  const ok = write(QUEUE_KEY, q);
  try { window.dispatchEvent(new Event(QUEUE_EVENT)); } catch { /* ignore */ }
  return ok;
};

/** Returns false if the device could not store the bill. */
export const addToQueue = (sale: QueuedSale): boolean => saveQueue([...readQueue(), sale]);
export const removeFromQueue = (ref: string) => saveQueue(readQueue().filter((s) => s.client_ref !== ref));
const patchQueued = (ref: string, patch: Partial<QueuedSale>) =>
  saveQueue(readQueue().map((s) => (s.client_ref === ref ? { ...s, ...patch } : s)));

export const newClientRef = (): string => {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  // RFC 4122 v4 from Math.random as a last resort
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export const offlineBillNumber = (ref: string) => `OFFLINE-${ref.slice(0, 8).toUpperCase()}`;

export const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** True when an error means "could not reach the server", not "the server said no". */
export const isNetworkError = (err: any): boolean => {
  if (!err) return false;
  if (isOffline()) return true;
  if (err.code && String(err.code).length > 0) return false; // the database answered
  const msg = String(err.message || err.details || err || "");
  return err instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg);
};

// ---------------------------------------------------------------------------
// Saved copies of lists, so the till can still search products offline
// ---------------------------------------------------------------------------
export const cacheSet = (name: string, userId: string, value: unknown) => write(`dailykart-cache-${name}-${userId}`, value);
export const cacheGet = <T,>(name: string, userId: string): T | null => read<T | null>(`dailykart-cache-${name}-${userId}`, null);

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
export type SyncResult = { synced: number; failed: number; left: number; needsDbUpdate: boolean };
let running: Promise<SyncResult> | null = null;

const sendOne = async (s: QueuedSale) => {
  const res = await supabase.rpc("sync_offline_sale" as any, {
    p_client_ref: s.client_ref,
    p_items: s.items,
    p_sold_at: s.sold_at,
    p_customer_id: s.customer_id,
    p_payment_method: s.payment_method,
    p_payments: s.payments,
    p_location_id: s.location_id,
    p_expected_total: s.expected_total,
    p_uncertain: s.uncertain,
  } as any);
  if (!res.error || res.error.code !== "PGRST202") return { ...res, missing: false };

  // Database not updated yet. A bill that never reached the server can be
  // saved the normal way; one that may have reached it waits, so it is
  // never saved twice.
  if (s.uncertain) return { data: null, error: res.error, missing: true };
  const base: Record<string, any> = { p_items: s.items, p_customer_id: s.customer_id };
  if (s.location_id) base.p_location_id = s.location_id;
  const r2 = s.payment_method === "split" && s.payments
    ? await supabase.rpc("create_sale_split" as any, { ...base, p_payments: s.payments } as any)
    : await supabase.rpc("create_sale", { ...base, p_payment_method: s.payment_method } as any);
  return { ...r2, missing: false };
};

/** Sends this cashier's waiting bills. Bills of another login stay until they sign in. */
export function syncOfflineSales(userId: string): Promise<SyncResult> {
  if (running) return running;
  running = (async () => {
    let synced = 0, failed = 0, needsDbUpdate = false;
    for (const s of readQueue()) {
      if (isOffline()) break;
      if (s.cashier_id !== userId) continue;
      let res: any;
      try {
        res = await sendOne(s);
      } catch (e) {
        res = { error: e };
      }
      if (!res.error) {
        removeFromQueue(s.client_ref);
        synced++;
        continue;
      }
      if (isNetworkError(res.error)) break; // still offline, try later
      if (res.missing) {
        needsDbUpdate = true;
        patchQueued(s.client_ref, { last_error: "Waiting for the database update (dailykart-updates.sql)" });
        continue;
      }
      failed++;
      patchQueued(s.client_ref, { attempts: (s.attempts || 0) + 1, last_error: res.error.message || "Could not save" });
    }
    return { synced, failed, left: readQueue().length, needsDbUpdate };
  })().finally(() => { running = null; });
  return running;
}
