import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ui } from "./lib.mjs";

/**
 * A double-clickable icon for the control panel, on the Desktop and in
 * `~/Applications`.
 *
 * The Windows installer gets a `.lnk`; macOS has no equivalent single-file
 * shortcut that Finder will run without a terminal window flashing up, so
 * this writes the smallest thing that qualifies as an app bundle -- a
 * directory with an `Info.plist` and one executable shell script. No Xcode,
 * no signing, nothing added to package.json: the same constraint the panel
 * itself is built under.
 *
 * `~/Applications` rather than `/Applications`, for the same reason the
 * install itself lives under the operator's home directory -- nothing here
 * should need an administrator password. Finder creates `~/Applications` on
 * first use if it does not already exist, and treats it as a normal
 * Applications folder.
 *
 * Failing to create it is not failing to install. The panel is still there
 * as `pharmacy-panel`; the app is a convenience and is reported as one.
 */
const APP_NAME = "Panel Kontrol Apotek.app";

async function writeAppBundle(directory, target, workingDirectory) {
  const bundle = join(directory, APP_NAME);
  const contents = join(bundle, "Contents");
  const macos = join(contents, "MacOS");
  await mkdir(macos, { recursive: true });

  await writeFile(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Panel Kontrol Apotek</string>
  <key>CFBundleExecutable</key><string>panel</string>
  <key>CFBundleIdentifier</key><string>id.apotek.pharmacy.panel</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSBackgroundOnly</key><false/>
</dict>
</plist>
`,
    "utf8",
  );

  const launcher = join(macos, "panel");
  await writeFile(
    launcher,
    [
      "#!/bin/sh",
      "# Opens the pharmacy control panel. Written by the installer.",
      `cd ${JSON.stringify(workingDirectory)} || exit 1`,
      `exec ${JSON.stringify(target)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(launcher, 0o755);
}

export async function installPanelShortcut(paths, target) {
  const locations = [join(homedir(), "Desktop"), join(homedir(), "Applications")];

  let placed = 0;
  for (const directory of locations) {
    try {
      await writeAppBundle(directory, target, paths.root);
      placed += 1;
    } catch {
      // Best effort per location -- a missing Desktop folder should not cost
      // the Applications copy, or the other way round.
    }
  }

  if (placed > 0) {
    ui.detail("an app was added to the Desktop and ~/Applications");
    return true;
  }
  ui.warn("could not create the app icon; open pharmacy-panel instead");
  return false;
}
