import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings, getUserById } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

export async function GET() {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";
    const oidcName = String(session?.oidcName || "").trim();
    const oidcEmail = String(session?.oidcEmail || "").trim();

    let role = null;
    let username = null;
    if (session?.userId) {
      const user = await getUserById(session.userId);
      if (user) {
        role = user.role;
        username = user.username;
      }
    }

    const displayName = oidcName || oidcEmail || username || (session?.oidc ? "OIDC user" : "Password user");
    const loginMethod = session?.oidc ? "OIDC" : "Password";

    return NextResponse.json({
      requireLogin,
      authMode,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      hasPassword: !!settings.password,
      displayName,
      loginMethod,
      role,
      username,
      oidcName: oidcName || null,
      oidcEmail: oidcEmail || null,
      oidcLogin: !!session?.oidc,
    });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      hasPassword: false,
      displayName: "Password user",
      loginMethod: "Password",
      role: null,
      username: null,
      oidcName: null,
      oidcEmail: null,
      oidcLogin: false,
    });
  }
}
