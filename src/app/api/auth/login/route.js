import { NextResponse } from "next/server";
import { getSettings, getUserAuthByUsername, getAdminUser } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie, isCanonicalAdminPassword, syncAdminUser } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";

const RESET_HINT = "Forgot password? Reset to default via 9Router CLI → Settings → Reset Password to Default.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const { username, password } = await request.json();
    if (typeof password !== "string" || !password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
      return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
    }

    const fail = (message, status = 401, extra = {}) => {
      const { remainingBeforeLock } = recordFail(ip);
      const postLock = checkLock(ip);
      if (postLock.locked) {
        return NextResponse.json(
          { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
          { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
        );
      }
      return NextResponse.json(
        { error: `${message}. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock, ...extra },
        { status, headers: NO_STORE_HEADERS }
      );
    };

    // ─── Named user login (multi-user) ───────────────────────────────────────
    if (typeof username === "string" && username.trim()) {
      const trimmed = username.trim();
      const user = await getUserAuthByUsername(trimmed);
      if (!user) {
        // Fresh install: no users exist yet. The canonical dashboard password
        // (settings.password / INITIAL_PASSWORD) bootstraps the admin account
        // even on the first named login.
        if (
          trimmed.toLowerCase() === "admin" &&
          !(await getAdminUser()) &&
          await isCanonicalAdminPassword(password)
        ) {
          const admin = await syncAdminUser();
          recordSuccess(ip);
          const cookieStore = await cookies();
          await setDashboardAuthCookie(cookieStore, request, { userId: admin.id, role: "admin", username: admin.username });
          return NextResponse.json({ success: true, user: { username: admin.username, role: "admin" } }, { headers: NO_STORE_HEADERS });
        }
        return fail("Invalid username or password");
      }
      if (user.isActive === false) return fail("Account is disabled");

      let isValid = false;
      if (user.role === "admin") {
        // Admin may sign in with the canonical dashboard password too.
        isValid = await isCanonicalAdminPassword(password) || await bcrypt.compare(password, user.passwordHash);
        if (isValid) {
          const admin = await syncAdminUser();
          recordSuccess(ip);
          const cookieStore = await cookies();
          await setDashboardAuthCookie(cookieStore, request, { userId: admin.id, role: "admin", username: admin.username });
          return NextResponse.json({ success: true, user: { username: admin.username, role: "admin" } }, { headers: NO_STORE_HEADERS });
        }
      } else {
        isValid = await bcrypt.compare(password, user.passwordHash);
      }

      if (isValid) {
        recordSuccess(ip);
        const cookieStore = await cookies();
        await setDashboardAuthCookie(cookieStore, request, { userId: user.id, role: user.role, username: user.username });
        return NextResponse.json({ success: true, user: { username: user.username, role: user.role } }, { headers: NO_STORE_HEADERS });
      }
      return fail("Invalid username or password");
    }

    // ─── Legacy admin login (no username) ────────────────────────────────────
    const isValid = await isCanonicalAdminPassword(password);

    if (isValid) {
      recordSuccess(ip);
      const cookieStore = await cookies();
      const admin = await syncAdminUser();
      await setDashboardAuthCookie(cookieStore, request, { userId: admin.id, role: "admin", username: admin.username });

      // Default password still in use on a remote client → force a password
      // change before the dashboard is exposed remotely (keeps local UX intact).
      const mustChangePassword =
        !settings.password && !process.env.INITIAL_PASSWORD && !isLocalRequest(request);

      return NextResponse.json({ success: true, user: { username: admin.username, role: "admin" }, mustChangePassword }, { headers: NO_STORE_HEADERS });
    }

    return fail("Invalid password");
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
