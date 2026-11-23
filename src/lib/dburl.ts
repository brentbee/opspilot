/**
 * Resolves the Postgres connection string. Accepts DATABASE_URL, or the
 * POSTGRES_URL that Vercel's Supabase integration sets automatically.
 *
 * The integration's URL carries driver-specific query params (e.g. `supa=`,
 * `pgbouncer=`) that postgres.js would forward to the server as runtime
 * settings, which Postgres rejects. Only keep params postgres.js understands.
 */
const KEEP = new Set(["sslmode", "connect_timeout", "application_name", "options"]);

export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.DATABASE_URL || env.POSTGRES_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (!KEEP.has(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return raw;
  }
}
