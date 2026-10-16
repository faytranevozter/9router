import { NextResponse } from "next/server";
import { getApiKeysUsage } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

// GET /api/usage/by-key?period=7d — per-API-key usage aggregate for the period.
// Mirrors /api/usage/stats; auto-protected by the deny-by-default dashboard guard.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    return NextResponse.json(await getApiKeysUsage(period));
  } catch (error) {
    console.error("[API] Failed to get API key usage:", error);
    return NextResponse.json({ error: "Failed to fetch API key usage" }, { status: 500 });
  }
}
