/**
 * `npm run apk`: web bundle -> Capacitor sync -> Gradle -> one APK file.
 *
 * With APOTEK_KEYSTORE (and its passwords) in the environment it builds the
 * signed release APK the website hands out -- `release/apotek-android.apk`,
 * the name the release workflow attaches and the server fetches. Without it,
 * a debug build for trying things out: installable by hand, but not an
 * update to a release-signed app, which is signed with a different key.
 *
 * Gradle 8 cannot run on the newest JDKs (a class-file version error with no
 * mention of Java in it), so this picks a JDK 17-21 on its own: JAVA_HOME if
 * it is one, else Android Studio's bundled runtime, else any installed one.
 * The Android SDK is found the same way and written to local.properties.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const android = join(root, "android");
// Versioned with the pharmacy release it ships in.
const { version } = JSON.parse(readFileSync(join(root, "..", "package.json"), "utf8"));
const signed = Boolean(process.env.APOTEK_KEYSTORE);

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: platform() === "win32", ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function versionOf(home) {
  const r = spawnSync(join(home, "bin", "java"), ["-version"], { encoding: "utf8" });
  const m = /version "(\d+)/u.exec(`${r.stderr}${r.stdout}`);
  return m ? Number(m[1]) : null;
}

function findJdk() {
  const candidates = [
    process.env.JAVA_HOME,
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    join(homedir(), "Library/Java/JavaVirtualMachines"),
    "/Library/Java/JavaVirtualMachines",
  ].filter(Boolean);
  const homes = [];
  for (const c of candidates) {
    if (existsSync(join(c, "bin", "java"))) homes.push(c);
    else if (existsSync(c)) {
      for (const d of readdirSync(c)) {
        const h = join(c, d, "Contents", "Home");
        if (existsSync(join(h, "bin", "java"))) homes.push(h);
      }
    }
  }
  return homes.find((h) => {
    const v = versionOf(h);
    return v !== null && v >= 17 && v <= 21;
  });
}

function findSdk() {
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk"), join(homedir(), "Android/Sdk")]
    .filter(Boolean)
    .find((p) => existsSync(join(p, "platforms")));
}

const jdk = findJdk();
if (!jdk) {
  console.error("No JDK 17-21 found. Install Android Studio, or set JAVA_HOME to a JDK 17-21.");
  process.exit(1);
}
const sdk = findSdk();
if (!sdk) {
  console.error("No Android SDK found. Install Android Studio, or set ANDROID_HOME.");
  process.exit(1);
}
writeFileSync(join(android, "local.properties"), `sdk.dir=${sdk.replaceAll("\\", "\\\\")}\n`);

run("npm", ["run", "build"]);
run("npx", ["cap", "sync", "android"]);
const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk };
run(platform() === "win32" ? "gradlew.bat" : "./gradlew", [signed ? "assembleRelease" : "assembleDebug", "--console=plain"], {
  cwd: android,
  env,
});

const apk = join(android, signed ? "app/build/outputs/apk/release/app-release.apk" : "app/build/outputs/apk/debug/app-debug.apk");
mkdirSync(join(root, "release"), { recursive: true });
const out = join(root, "release", signed ? "apotek-android.apk" : `apotek-${version}-debug.apk`);
copyFileSync(apk, out);
console.log(`\nAPK${signed ? " (signed release)" : " (debug)"}: ${out}`);
