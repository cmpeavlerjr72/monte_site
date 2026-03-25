const SUPABASE_URL = 'https://abssljpscfsvohbumcxy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFic3NsanBzY2Zzdm9oYnVtY3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzODE0MDYsImV4cCI6MjA4OTk1NzQwNn0.9HVsHLR03fNcidMoFmI0gN5qWc_9pQeSHAbJhKBW_nM';

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

export async function cbQuery(table: string, params: Record<string, string> = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
