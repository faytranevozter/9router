import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUsers, getUserByUsername, createUser, getUserTokens } from "@/lib/localDb";
import { adminOnly, toPublicUser, validateUsername, validatePassword, sanitizeRestrictions } from "./_shared";

export const dynamic = "force-dynamic";

// GET /api/users — list users (admin only)
export async function GET(request) {
  const { error } = await adminOnly(request);
  if (error) return error;
  try {
    const users = await getUsers();
    const result = [];
    for (const u of users) {
      const tokens = await getUserTokens(u.id);
      result.push({
        ...toPublicUser(u),
        tokenCount: tokens.length,
        activeTokenCount: tokens.filter((t) => t.isActive).length,
      });
    }
    return NextResponse.json({ users: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/users — create a member user (admin only)
export async function POST(request) {
  const { error } = await adminOnly(request);
  if (error) return error;
  try {
    const body = await request.json();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");

    const usernameError = validateUsername(username);
    if (usernameError) return NextResponse.json({ error: usernameError }, { status: 400 });
    const passwordError = validatePassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    const existing = await getUserByUsername(username);
    if (existing) return NextResponse.json({ error: "Username already exists" }, { status: 409 });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const user = await createUser({
      username,
      passwordHash,
      role: "member",
      restrictions: sanitizeRestrictions(body.restrictions),
      isActive: body.isActive !== false,
    });

    return NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
