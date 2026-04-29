export function getSupabaseEnv() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return { supabaseUrl, anonKey };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}
