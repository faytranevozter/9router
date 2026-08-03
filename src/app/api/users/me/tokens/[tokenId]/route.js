import { NextResponse } from "next/server";
import { requireUser, resolveTokenExpiry } from "../../../_shared";
import { getUserTokenById, updateUserToken, deleteUserToken } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// Ensure the token belongs to the current user.
async function ownToken(request, tokenId) {
  const { user, error } = await requireUser(request);
  if (error) return { error };
  const token = await getUserTokenById(tokenId);
  if (!token || token.userId !== user.id) {
    return { error: NextResponse.json({ error: "Token not found" }, { status: 404 }) };
  }
  return { user, token };
}

// PUT /api/users/me/tokens/[tokenId] — rename / extend / toggle own token
export async function PUT(request, { params }) {
  const { tokenId } = await params;
  const { token, error } = await ownToken(request, tokenId);
  if (error) return error;
  try {
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

// DELETE /api/users/me/tokens/[tokenId] — revoke own token
export async function DELETE(request, { params }) {
  const { tokenId } = await params;
  const { token, error } = await ownToken(request, tokenId);
  if (error) return error;
  try {
    await deleteUserToken(token.id);
    return NextResponse.json({ message: "Token deleted" });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
