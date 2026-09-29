/**
 * Closes Supabase's automatic web API over the pharmacy's tables.
 *
 * Supabase publishes every table in `public` over HTTP to anyone holding the
 * project's anon key -- which Supabase treats as public -- unless row-level
 * security is on. The app never uses that API: it connects as the table
 * owner, which RLS does not restrict. So RLS goes on with no policies, and the
 * API sees nothing. Runs on every hosted-demo build, so a table added by a
 * later migration is covered the day it arrives.
 *
 *   npm run db:lock-data-api
 */
import "./env";
import { Pool } from "pg";
import { databaseUrl } from "../src/db/client";

async function main() {
  if (process.env.MIGRATE_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.MIGRATE_DATABASE_URL;
  }
  const url = databaseUrl();
  if (!url) throw new Error("No DATABASE_URL, POSTGRES_URL or MIGRATE_DATABASE_URL set.");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ name: string }>(`
      select quote_ident(c.relname) as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    `);
    for (const { name } of rows) {
      await pool.query(`alter table public.${name} enable row level security`);
    }
    console.log(`Row-level security switched on for ${rows.length} table(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
