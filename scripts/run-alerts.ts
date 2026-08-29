/**
 * Recomputes the alert list and quarantines stock that has passed its expiry.
 *
 * Meant to run nightly. As a plain Node process rather than a platform cron
 * product, so it runs the same on a mini PC in the clinic as on a VPS:
 *
 *   0 1 * * *  cd /srv/pharmacy && npm run alerts
 */
import "./env";
import { getDbHandle } from "../src/db/client";
import { runAlertJob } from "../src/lib/alerts/job";

async function main() {
  const { db, close } = await getDbHandle();
  const started = Date.now();

  const result = await runAlertJob(db);

  console.log(`quarantined : ${result.quarantined} batch(es) past expiry`);
  console.log(`opened      : ${result.opened}`);
  console.log(`refreshed   : ${result.refreshed}`);
  console.log(`resolved    : ${result.resolved}`);
  console.log(`live alerts : ${result.total}`);
  console.log(`took        : ${Date.now() - started}ms`);

  await close();
}

main().catch((e) => { console.error(e); process.exit(1); });
