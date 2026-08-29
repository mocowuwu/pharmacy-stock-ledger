/**
 * Sends the morning digest for yesterday.
 *
 * A plain Node process, like the alert job, so it runs the same on a mini PC in
 * the clinic as on a VPS. Run it after the alert job, since it reports on the
 * alert list the job has just reconciled:
 *
 *   0 1 * * *  cd /srv/pharmacy && npm run alerts
 *   0 7 * * *  cd /srv/pharmacy && npm run digest
 *
 * With no mail server configured it writes the email to `.data/digest/` instead
 * of sending, and prints the path. That is the intended way to look at it
 * before switching sending on.
 *
 *   npm run digest              yesterday, honouring the enabled setting
 *   npm run digest -- --force   send even while the setting is off
 *   npm run digest -- --on 2026-08-29
 */
import "./env";
import { getDbHandle } from "../src/db/client";
import { runDigestJob } from "../src/lib/digest/job";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const { db, close } = await getDbHandle();

  const result = await runDigestJob(db, {
    on: argument("on"),
    force: process.argv.includes("--force"),
  });

  if (!result.ran) {
    const explanation = {
      disabled: "The daily digest is switched off in Settings.",
      no_recipient: "No recipient address is set in Settings.",
      already_sent: "Already sent for that day.",
    }[result.reason];
    console.log(explanation);
    await close();
    return;
  }

  console.log(`digest for  : ${result.on}`);
  console.log(`content     : ${result.quiet ? "nothing needing attention" : "has items"}`);

  if (result.delivery.delivered) {
    console.log(`delivered   : ${result.delivery.messageId}`);
  } else {
    console.log(`not sent    : no mail server configured`);
    console.log(`preview     : ${result.delivery.previewPath}`);
    console.log(`              open it in a browser to see what would arrive`);
  }

  await close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
