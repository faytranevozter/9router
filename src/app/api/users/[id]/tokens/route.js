import { NextResponse } from "next/server";
import { adminOnly, resolveTokenExpiry } from "../../_shared";
import { getUserById, getUserTokens, createUserToken } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/users/[id]/tokens — list a user's tokens (admin only)
export async function GET(request, { params }) {
  const { error } = await adminOnly(request);
  if (error) return error;
  try {
    const { id } = await params;
    const user = await getUserById(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const tokens = await getUserTokens(id);
    return NextResponse.json({ tokens });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/users/[id]/tokens — issue a token for a user (admin only)
export async function POST(request, { params }) {
  const { error } = await adminOnly(request);
  if (error) return error;
  try {
    const { id } = await params;
    const user = await getUserById(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const { expiresAt, error: expiryError } = resolveTokenExpiry(body);
    if (expiryError) return NextResponse.json({ error: expiryError }, { status: 400 });

    const token = await createUserToken(id, { name, expiresAt });
    return NextResponse.json({ token }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
