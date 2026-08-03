import { NextResponse } from "next/server";
import { adminOnly, resolveTokenExpiry } from "../../../_shared";
import { getUserById, getUserTokenById, updateUserToken, deleteUserToken } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// PUT /api/users/[id]/tokens/[tokenId] — extend / rename / toggle a user's token (admin only)
export async function PUT(request, { params }) {
  const { error } = await adminOnly(request);
  if (error) return error;
  try {
    const { id, tokenId } = await params;
    const user = await getUserById(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const token = await getUserTokenById(tokenId);
    if (!token || token.userId !== id) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
    const body = await request.json();
    const data = {};
    if (body.name !== undefined) data.name = String(body.name).trim().slice(0, 100);
    if (body.isActive !== undefined) data.isActive = body.isActive === true;
    if (body.expiresAt !== undefined || body.expiresInDays !== undefined) {
      const { expiresAt, error: expiryError } = resolveTokenExpiry(body);
      if (expiryError) return NextResponse.json({ error: expiryError }, { status: 400 });
      data.expiresAt = expiresAt;
    }
    const updated = await updateUserToken(token.id, data);
    return NextResponse.json({ token: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/users/[id]/tokens/[tokenId] — revoke a user's token (admin only)
export async function DELETE(request, { params }) {
  const { error } = await adminOnly(request);
  if (error) return error;
  try {
    const { id, tokenId } = await params;
    const user = await getUserById(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const token = await getUserTokenById(tokenId);
    if (!token || token.userId !== id) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
    await deleteUserToken(token.id);
    return NextResponse.json({ message: "Token deleted" });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
