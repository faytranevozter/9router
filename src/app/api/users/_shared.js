import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/dashboardSession";
import { getUserById, getUserTokens } from "@/lib/localDb";

/**
 * Public-safe user shape (never exposes passwordHash).
 */
export function toPublicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

/**
 * Load the authenticated dashboard user for this request.
 * @returns {Promise<object|null>}
 */
export async function currentUser(request) {
  return await getCurrentUser(request?.cookies || null);
}

/**
 * Require an authenticated admin. Returns { user } or { error: NextResponse }.
 */
export async function adminOnly(request) {
  const user = await currentUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

/**
 * Require an authenticated user. Returns { user } or { error: NextResponse }.
 */
export async function requireUser(request) {
  const user = await currentUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user };
}

/**
 * Build a user response object with its token list.
 */
export async function userWithTokens(user) {
  const tokens = await getUserTokens(user.id);
  return {
    ...toPublicUser(user),
    tokens: tokens.map((t) => ({ ...t })),
  };
}

export async function ensureTargetUser(id, request) {
  const { user, error } = await adminOnly(request);
  if (error) return { error };
  const target = await getUserById(id);
  if (!target) return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  return { user, target };
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{2,64}$/;

export function validateUsername(username) {
  if (typeof username !== "string" || !USERNAME_RE.test(username.trim())) {
    return "Username must be 2-64 chars (letters, digits, . _ -)";
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6) {
    return "Password must be at least 6 characters";
  }
  return null;
}

/**
 * Sanitize a restrictions object into a stable shape.
 */
export function sanitizeRestrictions(input) {
  const src = input && typeof input === "object" ? input : {};
  const models = Array.isArray(src.models)
    ? src.models.map((m) => String(m).trim()).filter(Boolean)
    : [];
  const providers = Array.isArray(src.providers)
    ? src.providers.map((p) => String(p).trim().toLowerCase()).filter(Boolean)
    : [];
  const rateLimitPerMinute = Number.isFinite(Number(src.rateLimitPerMinute)) && Number(src.rateLimitPerMinute) > 0
    ? Math.floor(Number(src.rateLimitPerMinute))
    : null;
  const quota = src.quota && typeof src.quota === "object" ? src.quota : {};
  const q = {
    monthlyRequests: Number.isFinite(Number(quota.monthlyRequests)) && Number(quota.monthlyRequests) > 0
      ? Math.floor(Number(quota.monthlyRequests))
      : null,
    monthlyTokens: Number.isFinite(Number(quota.monthlyTokens)) && Number(quota.monthlyTokens) > 0
      ? Math.floor(Number(quota.monthlyTokens))
      : null,
  };
  if (!q.monthlyRequests && !q.monthlyTokens) delete q.monthlyRequests;
  const out = {};
  if (models.length) out.models = models;
  if (providers.length) out.providers = providers;
  if (rateLimitPerMinute) out.rateLimitPerMinute = rateLimitPerMinute;
  if (q.monthlyRequests || q.monthlyTokens) out.quota = q;
  return out;
}

/**
 * Resolve a token expiry from request fields. Returns ISO string, null (never),
 * or an error string.
 */
export function resolveTokenExpiry(body) {
  if (body.expiresAt === null || body.expiresAt === undefined || body.expiresAt === "") {
    if (body.expiresInDays === null || body.expiresInDays === undefined) return { expiresAt: null };
  }
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    const days = Number(body.expiresInDays);
    if (!Number.isFinite(days) || days < 1) {
      return { error: "expiresInDays must be a positive number of days" };
    }
    return { expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() };
  }
  if (typeof body.expiresAt === "string") {
    const t = new Date(body.expiresAt).getTime();
    if (!Number.isFinite(t)) return { error: "expiresAt must be a valid date string" };
    return { expiresAt: new Date(t).toISOString() };
  }
  return { expiresAt: null };
}
