// Makes any Postgres ready for Troupe's migrations. The migrations carry RLS
// policies written for Supabase (`authenticated` role, auth.uid()); on plain
// Postgres this creates stand-ins, and on Supabase it leaves the real ones
// alone. Safe to run on every start.
export const SUPABASE_SHIM_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;
CREATE SCHEMA IF NOT EXISTS auth;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE $fn$CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'select nullif(current_setting(''request.jwt.claims'', true)::json->>''sub'', '''')::uuid'$fn$;
  END IF;
END
$$;
`;

// One process migrates at a time; others wait for the lock, then find
// nothing left to do.
export const MIGRATION_LOCK = 846_727;

export async function prepareDatabase(db: { exec: (sql: string) => Promise<unknown>; migrate: () => Promise<void> }) {
  await db.exec(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
  try {
    await db.exec(SUPABASE_SHIM_SQL);
    await db.migrate();
  } finally {
    await db.exec(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`);
  }
}
