import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exists, isWindows, run, updateEnv } from "./lib.mjs";

/**
 * Reaching the pharmacy from somewhere that is not the same building.
 *
 * The counter and the machine are not always in the same place. Where they are
 * not, the till needs a route in, and the two obvious ones are both wrong: a
 * port forwarded on the clinic router puts a pharmacy's dispensing records on
 * the public internet, and a plain LAN does not reach another building at all.
 *
 * Tailscale is neither. The tailnet is WireGuard between devices that have been
 * explicitly added to it, and `tailscale serve` terminates a real HTTPS
 * certificate in front of the app. Turned on, this deployment is *more* private
 * than the LAN one it replaces:
 *
 *   - the app binds to loopback, so nothing on the clinic network can reach it;
 *   - the firewall rule stops mattering, because there is nothing to reach;
 *   - `COOKIE_SECURE` goes back to true, because there is genuinely HTTPS.
 *
 * What it costs is honest and belongs in DEPLOY.md rather than buried here:
 * every till needs Tailscale signed in, and the counter now depends on the
 * clinic's internet as well as its own. A pharmacy in one building with the
 * machine in the same building should not use this.
 */

const DOWNLOAD = "https://tailscale.com/download/windows";

/** Where Tailscale puts its command line, per platform, before trying PATH. */
const CANDIDATES = {
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
  darwin: [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
  ],
  linux: ["/usr/bin/tailscale", "/usr/local/bin/tailscale"],
};

async function findTailscale() {
  for (const candidate of CANDIDATES[process.platform] ?? []) {
    if (await exists(candidate)) return candidate;
  }
  // Last resort: on PATH under its plain name.
  try {
    await run(isWindows ? "where" : "which", ["tailscale"]);
    return "tailscale";
  } catch {
    return null;
  }
}

/**
 * What Tailscale is currently doing, as three distinguishable answers.
 *
 * They need three different sentences: one names a download, one asks the
 * operator to sign in, and one is ready to go. Collapsing them into "Tailscale
 * is not working" is how somebody spends an afternoon reinstalling software
 * that was only logged out.
 */
export async function tailscaleState() {
  const binary = await findTailscale();
  if (!binary) return { state: "missing" };

  let status;
  try {
    status = JSON.parse(await run(binary, ["status", "--json"]));
  } catch {
    return { state: "missing", binary };
  }

  if (status.BackendState !== "Running") {
    return { state: "signed-out", binary, backend: status.BackendState };
  }

  // DNSName arrives fully qualified, with the trailing dot a DNS name properly
  // has and a URL properly does not.
  const name = (status.Self?.DNSName ?? "").replace(/\.$/u, "");
  const ip = (status.Self?.TailscaleIPs ?? []).find((address) => address.includes("."));

  return { state: "running", binary, name, ip };
}

/* ------------------------------------------------------------------- on */

/**
 * Puts the pharmacy on the tailnet and takes it off the clinic network.
 *
 * Returns rather than exits, because the panel calls this too -- see the note
 * on `ui.fail` in windows.mjs. Every refusal carries the one thing that fixes
 * it.
 */
export async function enableRemote(paths, config) {
  const tailscale = await tailscaleState();

  // Every refusal carries a `code` as well as English prose. The terminal
  // prints the prose; the control panel is in Indonesian and looks the code up
  // in its own strings. Same split as everything else here -- the thing that
  // knows what happened does not also decide what language to say it in.
  if (tailscale.state === "missing") {
    return {
      ok: false,
      code: "tailscale-missing",
      reason: "Tailscale is not installed on this machine.",
      remedy: `Install it from ${DOWNLOAD}, sign in, and run this again.`,
    };
  }

  if (tailscale.state === "signed-out") {
    return {
      ok: false,
      code: "tailscale-signed-out",
      // Never attempted here. Signing in is an account credential and it is the
      // owner's, not this program's, and it opens a browser to do it.
      reason: `Tailscale is installed but not signed in (${tailscale.backend}).`,
      remedy: "Open Tailscale, sign in, and run this again.",
    };
  }

  const target = `http://127.0.0.1:${config.appPort}`;
  let https = true;

  try {
    await run(tailscale.binary, ["serve", "--bg", "--https=443", target]);
  } catch (error) {
    // HTTPS certificates are a per-tailnet switch in the admin console, off by
    // default on some plans. Without it `serve --https` cannot get a
    // certificate and fails. That is not fatal: the tailnet is WireGuard
    // already, so plain HTTP across it is encrypted end to end -- it is the
    // cookie that has to be told, and the URL that gets uglier.
    if (!/cert|certificate|HTTPS|https/u.test(error.output ?? error.message ?? "")) {
      return {
        ok: false,
        code: "tailscale-serve-failed",
        reason: `Tailscale could not serve the pharmacy: ${error.message}`,
        remedy: "Check `tailscale status` and try again.",
      };
    }
    https = false;
  }

  const address = https
    ? `https://${tailscale.name}`
    : `http://${tailscale.ip}:${config.appPort}`;

  // Loopback only. With Tailscale in front there is no reason for the clinic
  // network to see this at all, and every reason for it not to.
  const updated = { ...config, remote: true, bind: "127.0.0.1", remoteAddress: address };
  await writeFile(paths.config, JSON.stringify(updated, null, 2), { mode: 0o600 });
  await updateEnv(join(paths.app, ".env.local"), { COOKIE_SECURE: String(https) });

  return {
    ok: true,
    https,
    address,
    config: updated,
    note: https
      ? undefined
      : "HTTPS certificates are not enabled for this tailnet, so this is plain\n" +
        "HTTP over the tailnet -- still encrypted between devices, but the\n" +
        "address is an IP rather than a name. Enable HTTPS Certificates in the\n" +
        "Tailscale admin console and run this again for the nicer one.",
  };
}

/* ------------------------------------------------------------------ off */

export async function disableRemote(paths, config) {
  const tailscale = await tailscaleState();
  if (tailscale.state === "running") {
    await run(tailscale.binary, ["serve", "--https=443", "off"]).catch(() => {});
  }

  const updated = { ...config, remote: false, bind: "0.0.0.0" };
  delete updated.remoteAddress;
  await writeFile(paths.config, JSON.stringify(updated, null, 2), { mode: 0o600 });
  await updateEnv(join(paths.app, ".env.local"), { COOKIE_SECURE: "false" });

  return { ok: true, config: updated };
}
