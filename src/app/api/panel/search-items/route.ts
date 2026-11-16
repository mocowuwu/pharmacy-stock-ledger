import { NextResponse, type NextRequest } from "next/server";
import { panelItemSearch } from "@/lib/dal/panel";
import { AuthenticationError, PermissionError } from "@/lib/dal/session";

/**
 * The panel form's item picker. A route handler is as exposed as a page, so the
 * permission is checked in the DAL call and not assumed from the screen.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") ?? "";
  const limit = Number(searchParams.get("limit") ?? "10");

  try {
    return NextResponse.json({ items: await panelItemSearch(query, limit) });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (error instanceof PermissionError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    console.error(error);
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
}
