import { NextResponse } from "next/server";
import { getApiKeySecretForPublicStatus } from "@/lib/db/repos/apiKeysRepo.js";
import { isPublicKeyUnlocked } from "@/lib/auth/publicPin.js";
import { getPublicKeyGate } from "@/lib/publicKeySummary.js";

export async function GET(_request, { params }) {
  const { id } = await params;
  const gate = await getPublicKeyGate(id);
  if (!gate.shared || !gate.pinRequired || !(await isPublicKeyUnlocked(id))) {
    return NextResponse.json({ error: "Not available" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const key = await getApiKeySecretForPublicStatus(id);
  if (!key) return NextResponse.json({ error: "Not available" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ key }, { headers: { "Cache-Control": "no-store" } });
}
