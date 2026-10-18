import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { buildPublicKeySummary } from "@/lib/publicKeySummary";
import StatusPill from "./components/StatusPill";
import QuotaCard from "./components/QuotaCard";
import ProjectionCard from "./components/ProjectionCard";
import EndpointCard from "./components/EndpointCard";
import ModelsCard from "./components/ModelsCard";
import UsageCard from "./components/UsageCard";
import LocalDateTime from "./components/LocalDateTime";

// Public per-key status page. The link carries the key's id only — never the
// key — and the page reads nothing from the request except the origin used in
// the curl example.
//
// Server component on purpose: no public JSON endpoint exists, so the readable
// surface is exactly this one rendered page.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "API key status",
  // The link is a bearer capability: it must never be indexed or followed.
  robots: { index: false, follow: false },
};

// Browser-facing origin for the curl example: NEXT_PUBLIC_BASE_URL when set
// (the deployment knows its own public origin), else the Host header.
async function requestOrigin() {
  const configured = typeof process.env.NEXT_PUBLIC_BASE_URL === "string"
    ? process.env.NEXT_PUBLIC_BASE_URL.trim().replace(/\/+$/, "")
    : "";
  if (configured) return configured;
  const headerList = await headers();
  const host = headerList.get("host");
  if (!host) return undefined;
  const proto = headerList.get("x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

function ExpiryLine({ expiresAt, expiresInDays }) {
  if (expiresAt == null) {
    return <span>Never expires</span>;
  }
  const relative = expiresInDays == null ? "expired" : `in ${expiresInDays} ${expiresInDays === 1 ? "day" : "days"}`;
  return (
    <span>
      Expires <LocalDateTime iso={expiresAt} fallback={expiresAt.slice(0, 16).replace("T", " ")} /> ({relative})
    </span>
  );
}

export default async function PublicKeyStatusPage({ params }) {
  const { id } = await params;
  const result = await buildPublicKeySummary(id, { origin: await requestOrigin() });
  // Unknown id and sharing-off are the same answer: calling notFound() here
  // renders ./not-found.js, so the page cannot be used to probe which ids exist.
  if (!result.found) notFound();

  const { key, quota, projection, models, endpoint, usage } = result.summary;
  const created = key.createdAt;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-text-main">{key.name || "API key"}</h1>
          <StatusPill status={key.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          <span className="text-[11px]">
            <ExpiryLine expiresAt={key.expiresAt} expiresInDays={key.expiresInDays} />
          </span>
          {created && (
            <span className="text-[11px]">
              Created <LocalDateTime iso={created} fallback={created.slice(0, 10)} />
            </span>
          )}
        </div>
        {!key.usable && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {key.status === "paused"
              ? "This key is paused. Requests made with it are rejected until it is resumed."
              : key.status === "expired"
              ? "This key has expired. Requests made with it are rejected."
              : "This key has used its whole token quota. Requests made with it return 429."}
          </p>
        )}
      </header>

      <QuotaCard quota={quota} />
      <ProjectionCard projection={projection} />
      <EndpointCard endpoint={endpoint} />
      <ModelsCard models={models} />
      <UsageCard usage={usage} />

      <footer className="pt-2 text-center text-[11px] text-text-muted">
        Read-only status page. The API key itself is never shown here, and this link can be revoked at any time.
      </footer>
    </main>
  );
}
