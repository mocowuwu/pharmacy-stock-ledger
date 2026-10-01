import { searchItems } from "@/lib/dal/panel-search";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  const limit = Number(searchParams.get("limit") || "10");

  try {
    const results = await searchItems(q, limit);
    return NextResponse.json({ items: results });
  } catch (error) {
    return NextResponse.json({ error: "Gagal mencari barang" }, { status: 500 });
  }
}