import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/dal/session";
import { APP_VERSION, findApk } from "@/lib/app-download";

/**
 * The Android app, for anyone signed in. A route handler is as exposed as a
 * page, so it checks the session itself rather than trusting the page that
 * links here.
 */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const apk = await findApk();
  if (!apk.ok) redirect(`/settings/app?error=${apk.reason}`);

  const body = Readable.toWeb(createReadStream(apk.path)) as ReadableStream;
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(apk.size),
      "Content-Disposition": `attachment; filename="apotek-${APP_VERSION}.apk"`,
      "Cache-Control": "no-store",
    },
  });
}
