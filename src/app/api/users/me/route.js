import { NextResponse } from "next/server";
import { requireUser, userWithTokens } from "../_shared";

export const dynamic = "force-dynamic";

// GET /api/users/me — current user profile + own tokens
export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  try {
    return NextResponse.json({ user: await userWithTokens(user) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
