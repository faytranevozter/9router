import { NextResponse } from "next/server";
import { requireUser, resolveTokenExpiry } from "../../_shared";
import { getUserTokens, createUserToken } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/users/me/tokens — own tokens
export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  try {
    const tokens = await getUserTokens(user.id);
    return NextResponse.json({ tokens });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/users/me/tokens — create own token
export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const { expiresAt, error: expiryError } = resolveTokenExpiry(body);
    if (expiryError) return NextResponse.json({ error: expiryError }, { status: 400 });

    const token = await createUserToken(user.id, { name, expiresAt });
    return NextResponse.json({ token }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
