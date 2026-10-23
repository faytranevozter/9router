import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getAdapter } from "@/lib/db/driver.js";
import { getJwtSecretMaterial, shouldUseSecureCookie } from "./dashboardSession.js";

const MAX_AGE = 30 * 24 * 60 * 60;
const cookieName = (keyId) => `k_pin_${Buffer.from(keyId).toString("base64url")}`;
const signingKey = (hash) => createHmac("sha256", getJwtSecretMaterial()).update(`public-pin:${hash}`).digest();
export async function hashPublicPin(pin) { return bcrypt.hash(pin, await bcrypt.genSalt(10)); }
export async function verifyPublicPin(pin, hash) { return typeof hash === "string" && bcrypt.compare(pin, hash); }
export async function grantPublicPinCookie(cookieStore, request, keyId, pinHash) {
  const token = await new SignJWT({ kid: keyId, scope: "public-key-pin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(signingKey(pinHash));
  cookieStore.set(cookieName(keyId), token, { httpOnly: true, sameSite: "lax", secure: shouldUseSecureCookie(request), path: `/k/${keyId}`, maxAge: MAX_AGE });
}
export async function isPublicKeyUnlocked(keyId) {
  const db = await getAdapter();
  const row = db.get("SELECT publicPinHash FROM apiKeys WHERE id = ?", [keyId]);
  if (!row?.publicPinHash) return true;
  const token = (await cookies()).get(cookieName(keyId))?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingKey(row.publicPinHash));
    return payload.kid === keyId && payload.scope === "public-key-pin";
  } catch { return false; }
}
