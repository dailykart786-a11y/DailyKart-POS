import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface StoreRow {
  id: string;
  name: string;
  address: string | null;
}

export const ALL_STORES = "all";

interface StoreContextValue {
  stores: StoreRow[];
  /** The store the user is assigned to (Default Store if none). */
  homeStoreId: string | null;
  /** Admins can pick a store or "all"; everyone else is fixed to their own store. */
  selectedStoreId: string;
  setSelectedStoreId: (id: string) => void;
  /** Store id to filter lists by, or null for all stores. */
  filterStoreId: string | null;
  /** Store new records and sales go to. */
  workingStoreId: string | null;
  isAdmin: boolean;
  /** Spread into inserts: puts an admin's new record in the selected store. */
  newRecordFields: { location_id?: string };
  reloadStores: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);
const STORAGE_KEY = "dailykart-selected-store";

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [homeStoreId, setHomeStoreId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selected, setSelected] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) || ALL_STORES; } catch { return ALL_STORES; }
  });

  const reloadStores = useCallback(async () => {
    if (!user) return;
    try {
      const [roleRes, assignRes, storesRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_location_assignments").select("location_id").eq("user_id", user.id).maybeSingle(),
        supabase.from("locations").select("*").order("created_at", { ascending: true }),
      ]);
      const rows = (storesRes.data || []) as Array<StoreRow & { is_default?: boolean }>;
      const list: StoreRow[] = rows.map(({ id, name, address }) => ({ id, name, address }));
      setStores(list);
      setIsAdmin(roleRes.data?.role === "admin");
      const mainStore = rows.find((s) => s.is_default) || rows.find((s) => s.name === "Default Store") || rows[0];
      const home = assignRes.data?.location_id || mainStore?.id || null;
      setHomeStoreId(home);
    } catch (e) {
      console.error("Failed to load stores", e);
    }
  }, [user]);

  useEffect(() => {
    if (user) reloadStores();
    else { setStores([]); setHomeStoreId(null); setIsAdmin(false); }
  }, [user, reloadStores]);

  // Lists may have failed to load while offline: load them again when back
  useEffect(() => {
    const onOnline = () => { reloadStores(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [reloadStores]);

  const setSelectedStoreId = (id: string) => {
    setSelected(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }
  };

  const value = useMemo<StoreContextValue>(() => {
    // A remembered store that no longer exists falls back to "all"
    const validSelected = selected === ALL_STORES || stores.some((s) => s.id === selected) ? selected : ALL_STORES;
    const adminPick = isAdmin && validSelected !== ALL_STORES ? validSelected : null;
    return {
      stores,
      homeStoreId,
      selectedStoreId: isAdmin ? validSelected : homeStoreId || ALL_STORES,
      setSelectedStoreId,
      // Non-admins are already limited to their store by the database
      filterStoreId: adminPick,
      workingStoreId: adminPick || homeStoreId,
      isAdmin,
      newRecordFields: isAdmin && (adminPick || homeStoreId) ? { location_id: (adminPick || homeStoreId)! } : {},
      reloadStores,
    };
  }, [stores, homeStoreId, selected, isAdmin, reloadStores]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    // Safe default if a component renders outside the provider
    return {
      stores: [], homeStoreId: null, selectedStoreId: ALL_STORES, setSelectedStoreId: () => {},
      filterStoreId: null, workingStoreId: null, isAdmin: false, newRecordFields: {}, reloadStores: async () => {},
    };
  }
  return ctx;
}

/** Adds a store filter to a Supabase query when one store is selected. */
export function inStore<Q>(query: Q, storeId: string | null): Q {
  return storeId ? (query as any).eq("location_id", storeId) : query;
}
