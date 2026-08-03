import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";
import { getAdminUser, getUserById, ensureAdminUser, updateUser } from "@/lib/db/repos/usersRepo.js";

const DEFAULT_PASSWORD = "123456";

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  if (await isCanonicalAdminPassword(password)) return true;
  // Fallback: an admin user's stored hash (kept in sync with canonical).
  try {
    const admin = await getAdminUser();
    if (admin?.passwordHash) return bcrypt.compare(password, admin.passwordHash);
  } catch { /* ignore */ }
  return false;
}

/**
 * Canonical admin password check: settings.password (bcrypt hash) takes
 * precedence, else the INITIAL_PASSWORD / default. This mirrors the legacy
 * single-password login so existing installs keep working unchanged.
 */
export async function isCanonicalAdminPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}

/**
 * Ensure an admin user exists and its stored hash matches the canonical
 * dashboard password. Used by login to bootstrap/keep the admin in sync.
 * @returns {Promise<object>} admin user row
 */
export async function syncAdminUser() {
  const settings = await getSettings();
  const canonicalHash = settings?.password || await bcrypt.hash(process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD, 10);
  const admin = await ensureAdminUser(canonicalHash, "admin");
  if (admin.passwordHash !== canonicalHash) {
    await updateUser(admin.id, { passwordHash: canonicalHash });
    return { ...admin, passwordHash: canonicalHash };
  }
  return admin;
}

/**
 * Load the currently authenticated dashboard user from the request cookie.
 * @param {import("next/headers").ReadonlyRequestCookies} [cookieStore] - the
 *   request cookie store; when omitted, reads from the request context.
 * @returns {Promise<object|null>} user row or null (no/invalid session,
 *   unknown user, or deactivated user)
 */
export async function getCurrentUser(cookieStore = null) {
  let token;
  if (cookieStore) {
    token = cookieStore.get?.("auth_token")?.value;
  } else {
    try {
      const { cookies } = await import("next/headers");
      token = (await cookies()).get("auth_token")?.value;
    } catch { return null; }
  }
  const session = await getDashboardAuthSession(token);
  if (!session?.userId) return null;
  const user = await getUserById(session.userId);
  if (!user || user.isActive === false) return null;
  return user;
}
