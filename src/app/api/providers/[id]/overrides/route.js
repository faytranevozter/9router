import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { PROVIDERS } from "open-sse/config/providers.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { normalizeHeaderOverrides } from "open-sse/utils/headerOverrides.js";

export const dynamic = "force-dynamic";

/**
 * Validate + normalize an override payload. Returns { override } or { error }.
 * An override with no headers is normalized to null (= delete).
 * Validation lives in open-sse/utils/headerOverrides.js so the dashboard
 * editor enforces the same rules before the request reaches this gate.
 */
function normalizeOverride(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Invalid request body" };
  }
  const { headers: clean, error } = normalizeHeaderOverrides(body.headers);
  if (error) return { error };
  return { override: Object.keys(clean).length ? { headers: clean } : null };
}

async function readOverrides() {
  const settings = await getSettings();
  return settings.providerOverrides || {};
}

/**
 * GET /api/providers/[id]/overrides — user override for this provider
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    // URL may use an alias (gcli, cc…) — key everything by canonical registry id
    const canonical = resolveProviderAlias(id);
    const override = (await readOverrides())[canonical] || {};
    // Built-in headers come straight from the registry transport — single source of
    // truth, so the UI pre-fills exactly what this provider sends upstream.
    return NextResponse.json({
      headers: override.headers || {},
      builtinHeaders: PROVIDERS[canonical]?.headers || {},
    });
  } catch (error) {
    console.log("Error getting provider overrides:", error);
    return NextResponse.json({ error: "Failed to get overrides" }, { status: 500 });
  }
}

/**
 * PUT /api/providers/[id]/overrides — body: { headers: {name: value} }
 * Empty payload clears the override.
 */
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const canonical = resolveProviderAlias(id);
    const body = await request.json().catch(() => ({}));
    const { override, error } = normalizeOverride(body);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
    const current = await readOverrides();
    const next = { ...current };
    if (override) next[canonical] = override;
    else delete next[canonical];
    await updateSettings({ providerOverrides: next });
    // Return the normalized state (and registry defaults) so the editor can
    // adopt exactly what was saved instead of its own draft.
    return NextResponse.json({
      headers: override?.headers || {},
      builtinHeaders: PROVIDERS[canonical]?.headers || {},
    });
  } catch (error) {
    console.log("Error saving provider overrides:", error);
    return NextResponse.json({ error: "Failed to save overrides" }, { status: 500 });
  }
}
