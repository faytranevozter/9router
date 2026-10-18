import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess";
import { validateKeyExpiration } from "@/shared/utils/keyExpiration";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, tokenLimit, access, expiresAt, publicShare } = body;
    const expiration = validateKeyExpiration(expiresAt === undefined ? null : expiresAt);
    if (!expiration.ok) return NextResponse.json({ error: expiration.error }, { status: 400 });

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let accessValue;
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      accessValue = checked.value;
    }

    // publicShare is a boolean toggle; reject anything else rather than coercing.
    if (publicShare !== undefined && typeof publicShare !== "boolean") {
      return NextResponse.json({ error: "publicShare must be a boolean" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, {
      tokenLimit,
      access: accessValue,
      expiresAt: expiration.value,
      publicShare: publicShare === true,
    });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      tokenLimit: apiKey.tokenLimit,
      usedTokens: apiKey.usedTokens,
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
      publicShare: apiKey.publicShare,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
