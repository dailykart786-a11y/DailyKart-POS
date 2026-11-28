import type { Database } from "../supabase/types";

type Row = Record<string, any>;
type AuthEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED";
type AuthCallback = (event: AuthEvent, session: any) => void;

const DB_NAME = "dailykart-local";
const DB_VERSION = 1;
const SESSION_KEY = "dailykart-local-session";
const TABLES = [
  "customers",
  "expenses",
  "locations",
  "payment_settings",
  "products",
  "profiles",
  "sale_items",
  "sales",
  "security_audit_log",
  "suppliers",
  "user_location_assignments",
  "user_roles",
  "auth_users",
];

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const table of TABLES) {
        if (!db.objectStoreNames.contains(table)) db.createObjectStore(table, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local database"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local database request failed"));
  });
}

async function readRows(table: string): Promise<Row[]> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(table, "readonly");
    return await requestResult(tx.objectStore(table).getAll());
  } finally {
    db.close();
  }
}

async function writeRows(table: string, rows: Row[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(table, "readwrite");
      const store = tx.objectStore(table);
      for (const row of rows) store.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save local data"));
      tx.onabort = () => reject(tx.error ?? new Error("Local database write was aborted"));
    });
  } finally {
    db.close();
  }
}

async function removeRows(table: string, rows: Row[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(table, "readwrite");
      const store = tx.objectStore(table);
      for (const row of rows) store.delete(row.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not remove local data"));
    });
  } finally {
    db.close();
  }
}

async function ensureDefaultLocation() {
  const locations = await readRows("locations");
  if (locations.length) return locations[0].id;
  const location = { id: "local-default-location", name: "Main Store", address: null, created_at: now() };
  await writeRows("locations", [location]);
  return location.id;
}

function splitSelection(selection: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selection.length; i++) {
    if (selection[i] === "(") depth++;
    if (selection[i] === ")") depth--;
    if (selection[i] === "," && depth === 0) {
      result.push(selection.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = selection.slice(start).trim();
  if (tail) result.push(tail);
  return result;
}

function relationRows(table: string, row: Row, relation: string, all: Record<string, Row[]>): Row[] {
  const relations: Record<string, Record<string, [string, string]>> = {
    sales: { customers: ["customers", "customer_id"], sale_items: ["sale_items", "id"] },
    sale_items: { products: ["products", "product_id"], sales: ["sales", "sale_id"] },
    customers: { sales: ["sales", "id"] },
  };
  const descriptor = relations[table]?.[relation];
  if (!descriptor) return [];
  const [relatedTable, foreignKey] = descriptor;
  if (table === "sales" && relation === "customers") {
    return (all[relatedTable] ?? []).filter((item) => item.id === row[foreignKey]);
  }
  if (table === "sales" && relation === "sale_items") {
    return (all[relatedTable] ?? []).filter((item) => item.sale_id === row.id);
  }
  if (table === "sale_items" && relation === "products") {
    return (all[relatedTable] ?? []).filter((item) => item.id === row[foreignKey]);
  }
  if (table === "sale_items" && relation === "sales") {
    return (all[relatedTable] ?? []).filter((item) => item.id === row[foreignKey]);
  }
  if (table === "customers" && relation === "sales") {
    return (all[relatedTable] ?? []).filter((item) => item.customer_id === row.id);
  }
  return [];
}

function projectRow(table: string, row: Row, selection: string, all: Record<string, Row[]>): Row {
  const projected: Row = {};
  for (const item of splitSelection(selection.replace(/\s+/g, " "))) {
    if (item === "*" || item === "") {
      Object.assign(projected, row);
      continue;
    }
    const match = item.match(/^([\w]+)\s*\((.*)\)$/);
    if (match) {
      const [, relation, columns] = match;
      const related = relationRows(table, row, relation, all).map((relatedRow) => projectRow(relation, relatedRow, columns, all));
      const isMany = (table === "sales" && relation === "sale_items") || (table === "customers" && relation === "sales");
      projected[relation] = isMany ? related : related[0] ?? null;
      continue;
    }
    const [source, alias] = item.split(":").map((part) => part.trim());
    projected[alias || source] = row[source];
  }
  return projected;
}

function valueAt(row: Row, key: string, table: string, all: Record<string, Row[]>): any {
  if (!key.includes(".")) return row[key];
  const [relation, ...rest] = key.split(".");
  const related = relationRows(table, row, relation, all)[0];
  return related ? valueAt(related, rest.join("."), relation, all) : undefined;
}

function defaultsFor(table: string, input: Row): Row {
  const row = { ...input };
  if (!row.id) row.id = uuid();
  if (table === "locations") row.created_at ??= now();
  if (["customers", "expenses", "products", "profiles", "sales"].includes(table)) row.created_at ??= now();
  if (table === "payment_settings") row.updated_at ??= now();
  if (["customers", "products", "expenses", "sales", "suppliers"].includes(table)) row.location_id ??= "local-default-location";
  if (table === "customers") row.loyalty_points ??= 0;
  if (table === "products") {
    row.stock_quantity ??= 0;
    row.min_stock_level ??= 0;
    row.is_active ??= true;
    row.category ??= "Uncategorized";
  }
  if (table === "sales") {
    row.status ??= "completed";
    row.discount_amount ??= 0;
    row.tax_amount ??= 0;
  }
  return row;
}

class LocalQuery implements PromiseLike<any> {
  private operation: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private selection = "*";
  private payload: Row | Row[] | null = null;
  private filters: Array<{ key: string; op: string; value: any }> = [];
  private orders: Array<{ key: string; ascending: boolean }> = [];
  private maxRows: number | null = null;
  private oneMode: "single" | "maybeSingle" | null = null;
  private returning = false;
  private countExact = false;
  private lowStockOnly = false;

  constructor(private table: string) {}
  select(selection = "*", options?: { count?: string }) { this.selection = selection; this.returning = true; this.countExact = options?.count === "exact"; return this; }
  insert(payload: Row | Row[]) { this.operation = "insert"; this.payload = payload; return this; }
  upsert(payload: Row | Row[]) { this.operation = "upsert"; this.payload = payload; return this; }
  update(payload: Row) { this.operation = "update"; this.payload = payload; return this; }
  delete() { this.operation = "delete"; return this; }
  eq(key: string, value: any) { this.filters.push({ key, op: "eq", value }); return this; }
  neq(key: string, value: any) { this.filters.push({ key, op: "neq", value }); return this; }
  gte(key: string, value: any) { this.filters.push({ key, op: "gte", value }); return this; }
  lte(key: string, value: any) { this.filters.push({ key, op: "lte", value }); return this; }
  gt(key: string, value: any) { this.filters.push({ key, op: "gt", value }); return this; }
  lt(key: string, value: any) { this.filters.push({ key, op: "lt", value }); return this; }
  limit(count: number) { this.maxRows = count; return this; }
  order(key: string, options?: { ascending?: boolean }) { this.orders.push({ key, ascending: options?.ascending ?? true }); return this; }
  single() { this.oneMode = "single"; return this; }
  maybeSingle() { this.oneMode = "maybeSingle"; return this; }
  executeLowStock() { this.lowStockOnly = true; return this; }

  then<TResult1 = any, TResult2 = never>(onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: Row, all: Record<string, Row[]>) {
    return this.filters.every(({ key, op, value }) => {
      const actual = valueAt(row, key, this.table, all);
      if (op === "eq") return actual === value;
      if (op === "neq") return actual !== value;
      if (op === "gte") return actual >= value;
      if (op === "lte") return actual <= value;
      if (op === "gt") return actual > value;
      if (op === "lt") return actual < value;
      return false;
    });
  }

  private async execute(): Promise<any> {
    try {
      if (!TABLES.includes(this.table)) throw new Error(`Unknown local table: ${this.table}`);
      await ensureDefaultLocation();
      const all: Record<string, Row[]> = {};
      await Promise.all(TABLES.filter((table) => table !== "auth_users").map(async (table) => { all[table] = await readRows(table); }));
      let rows = all[this.table] ?? [];
      const selected = rows.filter((row) => this.matches(row, all) && (!this.lowStockOnly || Number(row.stock_quantity ?? 0) <= Number(row.min_stock_level ?? 0)));
      let changed: Row[] = [];
      if (this.operation === "insert" || this.operation === "upsert") {
        const records = (Array.isArray(this.payload) ? this.payload : [this.payload]).filter(Boolean).map((row) => defaultsFor(this.table, row as Row));
        if (this.operation === "upsert") {
          const existing = new Map(rows.map((row) => [row.id, row]));
          changed = records.map((row) => ({ ...(existing.get(row.id) ?? {}), ...row }));
        } else changed = records;
        await writeRows(this.table, changed);
        rows = this.operation === "upsert" ? rows.filter((row) => !changed.some((item) => item.id === row.id)).concat(changed) : rows.concat(changed);
      } else if (this.operation === "update") {
        changed = selected.map((row) => ({ ...row, ...(this.payload as Row) }));
        await writeRows(this.table, changed);
        rows = rows.map((row) => changed.find((item) => item.id === row.id) ?? row);
      } else if (this.operation === "delete") {
        changed = selected;
        await removeRows(this.table, changed);
        rows = rows.filter((row) => !selected.some((item) => item.id === row.id));
      }

      let resultRows = (this.operation === "select" ? selected : changed).map((row) => projectRow(this.table, row, this.selection, all));
      for (const order of [...this.orders].reverse()) resultRows.sort((a, b) => {
        const av = valueAt(a, order.key, this.table, all);
        const bv = valueAt(b, order.key, this.table, all);
        const cmp = av == null && bv == null ? 0 : av == null ? -1 : bv == null ? 1 : av < bv ? -1 : av > bv ? 1 : 0;
        return order.ascending ? cmp : -cmp;
      });
      const count = resultRows.length;
      if (this.maxRows !== null) resultRows = resultRows.slice(0, this.maxRows);

      let data: any = resultRows;
      if (this.oneMode) {
        if (resultRows.length > 1 || (this.oneMode === "single" && resultRows.length === 0)) {
          return { data: null, error: { message: "Expected one local row", code: "PGRST116" }, count: this.countExact ? count : null };
        }
        data = resultRows[0] ?? null;
      } else if (!this.returning && this.operation !== "select") data = null;
      return { data, error: null, count: this.countExact ? count : null };
    } catch (error: any) {
      return { data: null, error: { message: error?.message ?? "Local database request failed", code: "LOCAL_DB_ERROR" }, count: null };
    }
  }
}

const userShape = (record: Row) => ({
  id: record.id,
  email: record.email,
  app_metadata: {},
  user_metadata: record.user_metadata ?? {},
  aud: "authenticated",
  created_at: record.created_at,
  confirmed_at: record.created_at,
});

async function hashPassword(password: string, salt: string) {
  const encoder = new TextEncoder();
  if (globalThis.crypto?.subtle) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256);
    return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Secure password hashing is unavailable in this browser.");
}

class LocalAuth {
  private listeners = new Set<AuthCallback>();
  private currentSession: any = null;

  private async findCurrentUser() {
    const userId = localStorage.getItem(SESSION_KEY);
    if (!userId) return null;
    return (await readRows("auth_users")).find((user) => user.id === userId) ?? null;
  }

  private async makeSession(record: Row | null) {
    if (!record) return null;
    return { access_token: `local-${record.id}`, token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: `local-refresh-${record.id}`, user: userShape(record) };
  }

  private emit(event: AuthEvent, session: any) {
    this.currentSession = session;
    for (const listener of this.listeners) listener(event, session);
  }

  onAuthStateChange(callback: AuthCallback) {
    this.listeners.add(callback);
    this.findCurrentUser().then((record) => this.makeSession(record)).then((session) => callback("INITIAL_SESSION", session));
    return { data: { subscription: { unsubscribe: () => this.listeners.delete(callback) } } };
  }

  async getSession() {
    const record = await this.findCurrentUser();
    const session = await this.makeSession(record);
    this.currentSession = session;
    return { data: { session }, error: null };
  }

  async signUp({ email, password, options }: any) {
    try {
      const normalizedEmail = String(email).trim().toLowerCase();
      const users = await readRows("auth_users");
      if (users.some((user) => user.email.toLowerCase() === normalizedEmail)) return { data: { user: null, session: null }, error: { message: "An account with this email already exists" } };
      const role = users.length === 0 ? "admin" : "cashier";
      const id = uuid();
      const salt = uuid();
      const record = { id, email: normalizedEmail, password_hash: await hashPassword(password, salt), password_salt: salt, user_metadata: options?.data ?? {}, created_at: now() };
      await writeRows("auth_users", [record]);
      const locationId = await ensureDefaultLocation();
      await writeRows("profiles", [{ id, user_id: id, full_name: record.user_metadata.full_name ?? "", role, created_at: record.created_at }]);
      await writeRows("user_roles", [{ id, user_id: id, role }]);
      await writeRows("user_location_assignments", [{ id, user_id: id, location_id: locationId }]);
      localStorage.setItem(SESSION_KEY, id);
      const session = await this.makeSession(record);
      this.emit("SIGNED_IN", session);
      return { data: { user: userShape(record), session }, error: null };
    } catch (error: any) {
      return { data: { user: null, session: null }, error: { message: error?.message ?? "Could not create local account" } };
    }
  }

  async signInWithPassword({ email, password }: any) {
    try {
      const normalizedEmail = String(email).trim().toLowerCase();
      const record = (await readRows("auth_users")).find((user) => user.email.toLowerCase() === normalizedEmail);
      if (!record || (await hashPassword(password, record.password_salt)) !== record.password_hash) {
        return { data: { user: null, session: null }, error: { message: "Invalid email or password" } };
      }
      localStorage.setItem(SESSION_KEY, record.id);
      const session = await this.makeSession(record);
      this.emit("SIGNED_IN", session);
      return { data: { user: userShape(record), session }, error: null };
    } catch (error: any) {
      return { data: { user: null, session: null }, error: { message: error?.message ?? "Could not sign in locally" } };
    }
  }

  async signOut() {
    localStorage.removeItem(SESSION_KEY);
    this.emit("SIGNED_OUT", null);
    return { error: null };
  }

  admin = {
    createUser: async (input: any) => {
      try {
        const current = await this.findCurrentUser();
        const role = (await readRows("user_roles")).find((item) => item.user_id === current?.id)?.role;
        if (role !== "admin") throw new Error("Only a local admin can create user accounts");
        const normalizedEmail = String(input.email).trim().toLowerCase();
        const users = await readRows("auth_users");
        if (users.some((user) => user.email.toLowerCase() === normalizedEmail)) throw new Error("An account with this email already exists");
        const id = uuid();
        const salt = uuid();
        const record = { id, email: normalizedEmail, password_hash: await hashPassword(input.password, salt), password_salt: salt, user_metadata: input.user_metadata ?? {}, created_at: now() };
        await writeRows("auth_users", [record]);
        const locationId = await ensureDefaultLocation();
        await writeRows("profiles", [{ id, user_id: id, full_name: record.user_metadata.full_name ?? "", role: "cashier", created_at: record.created_at }]);
        await writeRows("user_location_assignments", [{ id, user_id: id, location_id: locationId }]);
        return { data: { user: userShape(record) }, error: null };
      } catch (error: any) {
        return { data: { user: null }, error: { message: error?.message ?? "Could not create user" } };
      }
    },
    updateUserById: async (id: string, updates: any) => {
      try {
        const record = (await readRows("auth_users")).find((user) => user.id === id);
        if (!record) throw new Error("User not found");
        if (updates.email) record.email = String(updates.email).trim().toLowerCase();
        if (updates.user_metadata) record.user_metadata = { ...record.user_metadata, ...updates.user_metadata };
        if (updates.password) {
          record.password_salt = uuid();
          record.password_hash = await hashPassword(updates.password, record.password_salt);
        }
        await writeRows("auth_users", [record]);
        return { data: { user: userShape(record) }, error: null };
      } catch (error: any) {
        return { data: { user: null }, error: { message: error?.message ?? "Could not update user" } };
      }
    },
    deleteUser: async (id: string) => {
      try {
        await removeRows("auth_users", [{ id }]);
        return { data: { user: { id } }, error: null };
      } catch (error: any) {
        return { data: { user: null }, error: { message: error?.message ?? "Could not delete user" } };
      }
    },
  };
}

const auth = new LocalAuth();
const channel = () => ({ on: () => channel(), subscribe: () => channel(), unsubscribe: async () => "ok" });

const localClient = {
  auth,
  from: (table: string) => new LocalQuery(table),
  channel,
  removeChannel: async () => "ok",
  rpc: (name: string) => {
    const query = new LocalQuery("products");
    if (name === "get_low_stock_products") return query.select("*").executeLowStock();
    return Promise.resolve({ data: null, error: { message: `Unsupported local database function: ${name}` } });
  },
};

export const localDatabaseClient = localClient as any as import("@supabase/supabase-js").SupabaseClient<Database>;
export const LOCAL_DB_NAME = DB_NAME;
