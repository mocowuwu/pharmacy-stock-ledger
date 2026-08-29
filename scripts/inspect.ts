import "./env";
import { sql } from "drizzle-orm";
import { getDbHandle } from "../src/db/client";

async function main() {
  const { db, close } = await getDbHandle();

  const checks = await db.execute(sql`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace
    order by conname`);
  console.log("CHECK CONSTRAINTS:");
  for (const r of checks.rows as Array<{ conname: string; def: string }>) {
    console.log(`  ${r.conname}\n      ${r.def}`);
  }

  const partial = await db.execute(sql`
    select indexname, indexdef from pg_indexes
    where schemaname='public' and indexdef like '%WHERE%' order by indexname`);
  console.log("\nPARTIAL INDEXES:");
  for (const r of partial.rows as Array<{ indexname: string; indexdef: string }>) {
    console.log(`  ${r.indexname}\n      ${r.indexdef}`);
  }

  const enums = await db.execute(sql`
    select t.typname, count(*) as n from pg_type t
    join pg_enum e on e.enumtypid = t.oid group by t.typname order by t.typname`);
  console.log(
    "\nENUMS: " +
      (enums.rows as Array<{ typname: string; n: string }>)
        .map((r) => `${r.typname}(${r.n})`)
        .join(", "),
  );

  await close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
