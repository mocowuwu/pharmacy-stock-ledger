/**
 * Starts the development database and the Next.js dev server together, so
 * `npm run dev` is one command and there is exactly one owner of the data
 * directory.
 *
 * If a database is already listening -- because `npm run db:serve` is running
 * in another terminal -- this reuses it rather than failing on a bound port.
 * Point DATABASE_URL at a real Postgres server to skip the embedded one.
 */
import { spawn } from "node:child_process";
import { connect } from "node:net";
import "./env";
import { DEV_DB_PORT, DEV_DB_URL, startDevDatabase } from "./db-server";

function isListening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.setTimeout(500);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

async function main() {
  const external = process.env.DATABASE_URL;
  const usesDevPort = !external || external.includes(`:${DEV_DB_PORT}/`);

  let stop: (() => Promise<void>) | null = null;
  let url = external ?? DEV_DB_URL;

  if (usesDevPort) {
    if (await isListening(DEV_DB_PORT)) {
      console.log(`Reusing the database already listening on port ${DEV_DB_PORT}.`);
    } else {
      ({ stop } = await startDevDatabase());
      console.log(`Development database listening on ${DEV_DB_URL}`);
    }
    url = DEV_DB_URL;
  } else {
    console.log("Using DATABASE_URL from the environment.");
  }

  const child = spawn("npx", ["next", "dev"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      // PGlite serves one connection; see the note in src/db/client.ts.
      ...(stop || usesDevPort ? { DATABASE_MAX_CONNECTIONS: "1" } : {}),
    },
  });

  const shutdown = async () => {
    child.kill("SIGTERM");
    if (stop) await stop();
    process.exit(0);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, shutdown);
  child.on("exit", (code) => {
    void (stop ? stop() : Promise.resolve()).then(() => process.exit(code ?? 0));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
