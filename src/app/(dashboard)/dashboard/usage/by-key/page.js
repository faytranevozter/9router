"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import ByKeyUsage from "./components/ByKeyUsage";

// /dashboard/usage/by-key — per-API-key usage for a selectable period, live.
// Suspense boundary because the client component reads useSearchParams (deep
// links: ?key=<id>&period=…).
export default function ApiKeyUsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ByKeyUsage />
    </Suspense>
  );
}
