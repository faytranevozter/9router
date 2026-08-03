import { NextResponse } from "next/server";
import { requireUser } from "../../_shared";
import { getUserTokens } from "@/lib/localDb";
import { getUserUsage } from "@/lib/usageDb.js";

export const dynamic = "force-dynamic";

// GET /api/users/me/usage?period=30d — the current user's own token usage.
// Aggregated from usageHistory across all of the user's tokens.
export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  try {
    const period = new URL(request.url).searchParams.get("period") || "30d";
    const tokens = await getUserTokens(user.id);
    const usage = await getUserUsage(tokens.map((t) => t.key), period);
    return NextResponse.json({ usage });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
