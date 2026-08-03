import { NextResponse } from "next/server";
import { requireUser } from "../../_shared";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { filterModelsForUser } from "@/sse/services/userAccess.js";

export const dynamic = "force-dynamic";

// GET /api/users/me/models — models the current user is allowed to use.
// Scoped by the admin-set restrictions (model + provider allow-lists); an
// unrestricted member sees the full list.
export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  try {
    const models = await buildModelsList(["llm"], {});
    const restrictions = user.restrictions || {};
    const allowed = filterModelsForUser(models, restrictions);
    return NextResponse.json({
      models: allowed,
      scoped: !!(restrictions.models?.length || restrictions.providers?.length),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
