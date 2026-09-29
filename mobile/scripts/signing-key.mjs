/**
 * `npm run signing-key`: makes the pharmacy's app-signing key, once.
 *
 * Every release of the app must be signed with the same key -- Android
 * installs an update only over an app signed by the one before it, and the
 * way round that (uninstalling) deletes unsent offline sales. So the key is
 * made once, kept outside the repository, and handed to the release workflow
 * as repository secrets:
 *
 *   ~/.apotek-signing/apotek-release.jks   the key itself
 *   ~/.apotek-signing/signing.env          its passwords, for local release builds
 *
 * Back both up somewhere safe. A lost key cannot be recovered; every phone
 * would have to reinstall the app.
 *
 * `--upload` also stores the four secrets on GitHub with the `gh` CLI (you
 * must be signed in to it with access to the repository).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".apotek-signing");
const keystore = join(dir, "apotek-release.jks");
const envFile = join(dir, "signing.env");
const alias = "apotek";

function keytool() {
  const candidates = [
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, "bin", "keytool"),
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool",
    "keytool",
  ].filter(Boolean);
  return candidates.find((c) => c === "keytool" || existsSync(c));
}

mkdirSync(dir, { recursive: true, mode: 0o700 });

if (!existsSync(keystore)) {
  const password = randomBytes(24).toString("base64url");
  const result = spawnSync(
    keytool(),
    [
      "-genkeypair", "-v",
      "-keystore", keystore,
      "-alias", alias,
      "-keyalg", "RSA", "-keysize", "4096",
      "-validity", "10000",
      "-storepass", password,
      "-keypass", password,
      "-dname", "CN=Apotek, O=Pharmacy Stock Ledger, C=ID",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (result.status !== 0) {
    console.error("keytool failed. Install Android Studio, or set JAVA_HOME to a JDK.");
    process.exit(1);
  }
  writeFileSync(
    envFile,
    [
      `export APOTEK_KEYSTORE="${keystore}"`,
      `export APOTEK_KEYSTORE_PASSWORD="${password}"`,
      `export APOTEK_KEY_ALIAS="${alias}"`,
      `export APOTEK_KEY_PASSWORD="${password}"`,
      "",
    ].join("\n"),
  );
  chmodSync(keystore, 0o600);
  chmodSync(envFile, 0o600);
  console.log(`Made a new signing key: ${keystore}`);
} else {
  console.log(`Using the existing signing key: ${keystore}`);
}

const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .map((line) => /^export (\w+)="(.*)"$/u.exec(line))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const secrets = {
  APOTEK_KEYSTORE_BASE64: readFileSync(keystore).toString("base64"),
  APOTEK_KEYSTORE_PASSWORD: env.APOTEK_KEYSTORE_PASSWORD,
  APOTEK_KEY_ALIAS: env.APOTEK_KEY_ALIAS,
  APOTEK_KEY_PASSWORD: env.APOTEK_KEY_PASSWORD,
};

if (process.argv.includes("--upload")) {
  for (const [name, value] of Object.entries(secrets)) {
    const result = spawnSync("gh", ["secret", "set", name], { input: value, stdio: ["pipe", "inherit", "inherit"] });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log("Stored the four signing secrets on GitHub. The next release will carry the Android app.");
} else {
  console.log(`
Next:
  - Back up ${dir} somewhere safe (it cannot be recreated).
  - Store the secrets on GitHub so releases carry the app:
      npm run signing-key -- --upload
  - To build a signed APK on this machine:
      source ${envFile} && npm run apk`);
}
