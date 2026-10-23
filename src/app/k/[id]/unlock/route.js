import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { grantPublicPinCookie, verifyPublicPin } from "@/lib/auth/publicPin.js";
import { checkLock, recordFail, recordSuccess } from "@/lib/auth/publicPinLimiter.js";

export async function POST(request, { params }) {
  const pathname = new URL(request.url).pathname;
  if (!/^\/k\/[^/]+\/unlock$/.test(pathname)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;") || !contentType.toLowerCase().includes("boundary=")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await params;
  const lock = checkLock(request, id);
  if (lock.locked) return NextResponse.json({ error: `Too many attempts. Try again in ${lock.retryAfter} seconds.` }, { status: 429, headers: { "Retry-After": String(lock.retryAfter), "Cache-Control": "no-store" } });
  const db = await getAdapter();
  const row = db.get("SELECT publicShare, publicPinHash FROM apiKeys WHERE id = ?", [id]);
  const form = await request.formData();
  const pin = form.get("pin");
  if (!row || !(row.publicShare === 1 || row.publicShare === true) || !row.publicPinHash || typeof pin !== "string" || !(await verifyPublicPin(pin, row.publicPinHash))) {
    recordFail(request, id);
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  recordSuccess(request, id);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const cookieStore = { set: (name, value, options) => response.cookies.set(name, value, options) };
  try {
    await grantPublicPinCookie(cookieStore, request, id, row.publicPinHash);
  } catch {
    return NextResponse.json({ error: "Unable to unlock status page" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  return response;
}
