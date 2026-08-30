import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DAILY_JOBS, job } from "./operations.mjs";

/**
 * The daily jobs, run by the supervisor rather than by a clock.
 *
 * `GO-LIVE.md` used to schedule these as cron lines at 01:00, 02:00 and 07:00.
 * That was written for a server. This machine is a clinic PC: it is switched on
 * in the morning and off at closing, so **nothing scheduled for one o'clock
 * will ever run**. On Windows it was worse than that -- there is no cron at
 * all, so they had never run once.
 *
 * The rule here is a gap, not a time: **run each job that has not run for
 * twenty hours**, checked shortly after startup and hourly after. One rule
 * covers both deployments without special-casing either:
 *
 *   - the clinic machine, off overnight, runs them when it is switched on,
 *     which is when the pharmacist wants yesterday backed up and today's
 *     alerts computed;
 *   - a VPS that never reboots runs them once a day from the hourly check.
 *
 * Twenty rather than twenty-four so an opening time that drifts earlier day to
 * day never skips one. Being a gap rather than a clock, it needs no timezone
 * and has no "did it run today" edge at midnight.
 */

/** Long enough that a day never runs twice, short enough that none is skipped. */
const GAP_MS = 20 * 60 * 60 * 1000;

const FIRST_CHECK_MS = 90 * 1000;
const EVERY_MS = 60 * 60 * 1000;

async function readState(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Runs whatever is due, in order, one at a time.
 *
 * Sequential on purpose: `backup` will start the database if it is down, and
 * two jobs racing to do that is a second postmaster over a live one.
 */
async function runDue(paths, config, log) {
  const file = join(paths.root, "jobs.json");
  const jobsLog = join(paths.logs, "jobs.log");
  const state = await readState(file);
  const now = Date.now();

  for (const name of DAILY_JOBS) {
    const last = Date.parse(state[name]?.at ?? "") || 0;
    if (now - last < GAP_MS) continue;

    const note = async (line) =>
      appendFile(jobsLog, `${new Date().toISOString()}  ${line}\n`, "utf8").catch(() => {});

    try {
      const result = await job(paths, config, name);
      state[name] = { at: new Date().toISOString(), ok: true };
      await note(`${name}: ok${result.file ? ` -> ${result.file}` : ""}`);
      log(`job ${name} ok`);
    } catch (error) {
      // Recorded as attempted, so a job that fails every time does not run in a
      // loop -- and *not* recorded as ok, so the panel cannot show a backup
      // that did not happen. A failure here must never stop the others: the
      // digest failing on mail settings nobody has filled in yet is not a
      // reason to skip tomorrow's backup.
      //
      // The summary goes in the state, the whole thing in the log. The state
      // file is read on every panel refresh and is meant to stay glanceable; a
      // Postgres stack trace embedded in it helps nobody and hides the two
      // fields that matter.
      const summary = (error.message ?? String(error)).split("\n")[0];
      state[name] = { at: new Date().toISOString(), ok: false, error: summary };
      await note(`${name}: FAILED -- ${summary}\n${error.message ?? error}`);
      log(`job ${name} failed: ${summary}`);
    }

    // Written after each job, not at the end. If the machine is switched off
    // mid-run -- which is exactly what this machine does -- the jobs that
    // finished must not run again tomorrow morning as though they had not.
    await writeFile(file, JSON.stringify(state, null, 2), "utf8").catch(() => {});
  }
}

/**
 * Starts the daily cycle. Returns the timer so the supervisor can stop it.
 *
 * The first check is delayed: the pharmacist switching the machine on wants the
 * till, not a `pg_dump`. Nothing here ever runs in front of the app.
 */
export function startDailyJobs(paths, config, log) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDue(paths, config, log);
    } catch (error) {
      log(`daily jobs failed: ${error.message}`);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, FIRST_CHECK_MS);
  return setInterval(tick, EVERY_MS);
}
