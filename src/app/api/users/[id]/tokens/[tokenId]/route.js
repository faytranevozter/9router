import { NextResponse } from "next/server";
import { adminOnly, requireUser, resolveTokenExpiry } from "../../../_shared";
import { getUserById, getUserTokenById, updateUserToken, deleteUserToken } from "@/lib/localDb";

export const dynamic = "force-dynamic";

function canManageToken(user, targetUserId, tokenUserId) {
  if (user.role === "admin") return true;
  if (user.id === targetUserId && user.id === tokenUserId) return true;
  return false;
}

// PUT /api/users/[id]/tokens/[tokenId] — extend / rename / toggle a user's token (admin or self)
export async function PUT(request, { params }) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;
  try {
    const { id, tokenId } = await params;
    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const token = await getUserTokenById(tokenId);
    if (!token || token.userId !== id) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
    if (!canManageToken(user, id, token.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

// DELETE /api/users/[id]/tokens/[tokenId] — revoke a user's token (admin or self)
export async function DELETE(request, { params }) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;
  try {
    const { id, tokenId } = await params;
    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const token = await getUserTokenById(tokenId);
    if (!token || token.userId !== id) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
    if (!canManageToken(user, id, token.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await deleteUserToken(token.id);
    return NextResponse.json({ message: "Token deleted" });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}