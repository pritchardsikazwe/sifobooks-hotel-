import { createClient } from "@supabase/supabase-js";

// Publishable/anon keys are designed for browser use; Row Level Security protects tenant data.
// Keep service-role keys on trusted servers only.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "https://fotnafyrjawypbsttplf.supabase.co";
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "sb_publishable_8wSNQwQj_qCYt5Fs07AsZg_fS704Apz";

export const supabaseReady = Boolean(url && key && !key.includes("replace_with_"));
export const supabase = supabaseReady
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error("Hotel app is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  return supabase;
}
