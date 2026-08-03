import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserById, updateUser, deleteUser, getAdminUser } from "@/lib/localDb";
import { adminOnly, toPublicUser, validateUsername, validatePassword, sanitizeRestrictions } from "../_shared";

export const dynamic = "force-dynamic";

async function notSelfLockout(target, admin, role) {
  if (target.id !== admin.id) return false;
  return role !== "admin";
}

// GET /api/users/[id] — get user (admin only)
export async function GET(request, { params }) {
  const { user, error } = await adminOnly(request);
  if (error) return error;
  try {
    const { id } = await params;
    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ user: toPublicUser(target) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT /api/users/[id] — update user (admin only)
export async function PUT(request, { params }) {
  const { user: admin, error } = await adminOnly(request);
  if (error) return error;
  try {
    const { id } = await params;
    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const body = await request.json();
    const data = {};

    if (body.username !== undefined) {
      const username = String(body.username).trim().toLowerCase();
      const usernameError = validateUsername(username);
      if (usernameError) return NextResponse.json({ error: usernameError }, { status: 400 });
      const { getUserByUsername } = await import("@/lib/localDb");
      const taken = target.username === username ? null : await getUserByUsername(username);
      if (taken) return NextResponse.json({ error: "Username already exists" }, { status: 409 });
      data.username = username;
    }

    if (body.password !== undefined && body.password !== "") {
      const passwordError = validatePassword(body.password);
      if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
      const salt = await bcrypt.genSalt(10);
      data.passwordHash = await bcrypt.hash(body.password, salt);
    }

    if (body.role !== undefined) {
      if (body.role !== "admin" && body.role !== "member") {
        return NextResponse.json({ error: "Role must be admin or member" }, { status: 400 });
      }
      if (await notSelfLockout(target, admin, body.role)) {
        return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
      }
      if (body.role !== "admin" && target.role === "admin") {
        const { getUsers } = await import("@/lib/localDb");
        const admins = (await getUsers()).filter((u) => u.role === "admin");
        if (admins.length <= 1) {
          return NextResponse.json({ error: "Cannot demote the last admin" }, { status: 400 });
        }
      }
      data.role = body.role;
    }

    if (body.isActive !== undefined) {
      if (body.isActive === false && target.id === admin.id) {
        return NextResponse.json({ error: "You cannot disable your own account" }, { status: 400 });
      }
      data.isActive = body.isActive === true;
    }

    if (body.restrictions !== undefined) {
      data.restrictions = sanitizeRestrictions(body.restrictions);
    }

    const updated = await updateUser(id, data);
    return NextResponse.json({ user: toPublicUser(updated) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/users/[id] — delete user + their tokens (admin only)
export async function DELETE(request, { params }) {
  const { user: admin, error } = await adminOnly(request);
  if (error) return error;
  try {
    const { id } = await params;
    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (target.id === admin.id) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
    }
    if (target.role === "admin") {
      const adminUser = await getAdminUser();
      if (adminUser && adminUser.id === target.id) {
        return NextResponse.json({ error: "Cannot delete the admin account" }, { status: 400 });
      }
    }

    await deleteUser(id);
    return NextResponse.json({ message: "User deleted" });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
