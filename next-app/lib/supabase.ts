import { createClient, SupabaseClient } from "@supabase/supabase-js";

// The Supabase publishable key is designed for browser use. Row access is enforced by RLS.
const SUPABASE_URL = "https://njzhtxrmrqhuxhytxaay.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_HY1y3VDURIKAP7izixmtuQ_b-ezXoiA";

let client: SupabaseClient | null = null;
export function getSupabase() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
