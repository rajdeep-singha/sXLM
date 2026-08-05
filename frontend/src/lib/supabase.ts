/**
 * Supabase client.
 *
 * Reads credentials from Vite env vars:
 *   VITE_SUPABASE_URL       — project URL   (https://xxxx.supabase.co)
 *   VITE_SUPABASE_ANON_KEY  — public anon key
 *
 * The client is only created when both are present, so the app still builds
 * and runs (Career form disabled) if the env is not configured yet.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;
