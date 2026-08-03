import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireUser } from "../../_shared";
import { updateUser, getUserAuthById } from "@/lib/localDb";
import { validatePassword } from "../../_shared";

export const dynamic = "force-dynamic";

// POST /api/users/me/password — change own password (verify current)
export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (typeof currentPassword !== "string" || !currentPassword) {
      return NextResponse.json({ error: "Current password required" }, { status: 400 });
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    const auth = await getUserAuthById(user.id);
    const valid = auth ? await bcrypt.compare(currentPassword, auth.passwordHash) : false;
    if (!valid) {
      return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    const updated = await updateUser(user.id, { passwordHash });

    return NextResponse.json({ success: true, username: updated.username });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
