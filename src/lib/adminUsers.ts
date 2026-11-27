import { supabase } from "@/integrations/supabase/client";

type AdminUsersRequest =
  | { action: "create"; email: string; password: string; fullName: string; role: string }
  | { action: "update"; userId: string; email?: string; password?: string }
  | { action: "delete"; userId: string };

export interface AdminUsersResult {
  ok?: boolean;
  userId?: string;
  result?: "deleted" | "deactivated";
  error?: string;
}

// Calls the admin-users Edge Function, which holds the service key on Supabase.
export async function callAdminUsers(body: AdminUsersRequest): Promise<AdminUsersResult> {
  const { data, error } = await supabase.functions.invoke<AdminUsersResult>("admin-users", { body });
  if (error) {
    // Try to surface the function's own error message
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const parsed = await ctx.json();
        if (parsed?.error) message = parsed.error;
      }
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data ?? {};
}
