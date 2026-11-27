// Supabase Edge Function: admin-users
// Lets an admin create, update (email / password) and remove staff accounts.
// Runs on Supabase with the service role key, which never reaches the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ROLES = ["admin", "manager", "cashier"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 1. Who is calling?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller?.user) return json({ error: "Not signed in" }, 401);

  // 2. Are they an admin?
  const { data: roleRow } = await admin
    .from("user_roles").select("role").eq("user_id", caller.user.id).maybeSingle();
  if (roleRow?.role !== "admin") return json({ error: "Only admins can manage users" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const action = body.action;

  try {
    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const fullName = String(body.fullName ?? "").trim();
      const role = String(body.role ?? "cashier");
      if (!email || !fullName) return json({ error: "Name and email are required" }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      if (!ROLES.includes(role)) return json({ error: "Invalid role" }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (error) return json({ error: error.message }, 400);

      // The signup trigger already made the profile, cashier role and store assignment.
      const userId = data.user.id;
      await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id" });
      await admin.from("profiles").update({ full_name: fullName }).eq("user_id", userId);
      return json({ ok: true, userId });
    }

    if (action === "update") {
      const userId = String(body.userId ?? "");
      if (!userId) return json({ error: "Missing user" }, 400);
      const changes: { email?: string; password?: string; email_confirm?: boolean } = {};
      if (body.email) { changes.email = String(body.email).trim().toLowerCase(); changes.email_confirm = true; }
      if (body.password) {
        if (String(body.password).length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
        changes.password = String(body.password);
      }
      if (!changes.email && !changes.password) return json({ ok: true });
      const { error } = await admin.auth.admin.updateUserById(userId, changes);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      const userId = String(body.userId ?? "");
      if (!userId) return json({ error: "Missing user" }, 400);
      if (userId === caller.user.id) return json({ error: "You can't remove your own account" }, 400);

      const { error } = await admin.auth.admin.deleteUser(userId);
      if (!error) return json({ ok: true, result: "deleted" });

      // Users with past sales or expenses can't be fully deleted (records point to them),
      // so block their login instead and keep the history.
      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      if (banError) return json({ error: banError.message }, 400);
      return json({ ok: true, result: "deactivated" });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
