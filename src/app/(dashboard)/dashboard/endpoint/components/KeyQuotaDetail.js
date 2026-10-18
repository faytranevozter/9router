"use client";

// Detailed per-key token quota view for the Endpoint page.
// Opens from the key row: shows the quota (used / limit), a progress bar, and
// the key's usage broken down by day, model, provider and endpoint for a
// selectable period, plus a reset-usage action.
import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "60d", label: "60d" },
  { value: "all", label: "All" },
];

export const fmtTokens = (n) => {
  const num = Number(n) || 0;
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
};

const fmtCost = (n) => `$${(Number(n) || 0).toFixed(4)}`;

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

// Relative "Xs ago" — the parent re-renders on each SSE tick, so this stays fresh
// without its own interval.
const relTime = (iso) => {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${Math.max(0, diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// One breakdown table (by model / provider / endpoint).
function BreakdownTable({ title, rows, labelKey, empty }) {
  const total = rows.reduce((s, r) => s + (r.promptTokens || 0) + (r.completionTokens || 0), 0) || 1;
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-2 bg-surface-2/60 border-b border-border flex items-center justify-between">
        <span className="text-xs font-semibold text-text-main">{title}</span>
        <span className="text-[11px] text-text-muted">{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-text-muted text-center">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs">
            <thead>
              <tr className="text-text-muted border-b border-border">
                <th className="text-left font-medium px-3 py-1.5">{labelKey}</th>
                <th className="text-right font-medium px-2 py-1.5">Req</th>
                <th className="text-right font-medium px-2 py-1.5">Prompt</th>
                <th className="text-right font-medium px-2 py-1.5">Completion</th>
                <th className="text-right font-medium px-2 py-1.5">Cost</th>
                <th className="text-left font-medium px-3 py-1.5 w-24">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
                const pct = Math.round((tokens / total) * 100);
                return (
                  <tr key={r[labelKey]} className="border-b border-border/60 last:border-b-0">
                    <td className="px-3 py-1.5 font-mono text-[11px] text-text-main whitespace-nowrap">{r[labelKey]}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{(r.requests || 0).toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{fmtTokens(r.promptTokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{fmtTokens(r.completionTokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{fmtCost(r.cost)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 rounded-full bg-black/5 dark:bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-text-muted tabular-nums w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

BreakdownTable.propTypes = {
  title: PropTypes.string.isRequired,
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  labelKey: PropTypes.string.isRequired,
  empty: PropTypes.string.isRequired,
};

function Stat({ icon, label, value, sub, tone }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-text-muted mb-0.5">
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        {label}
      </div>
      <div className={cn("text-lg font-semibold tabular-nums", tone || "text-text-main")}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

Stat.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  sub: PropTypes.string,
  tone: PropTypes.string,
};

export default function KeyQuotaDetail({ apiKey, onClose, onResetUsage, initialPeriod = "all", liveRequests = null, inFlight = 0 }) {
  const [period, setPeriod] = useState(initialPeriod);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const keyId = apiKey?.id;

  const fetchData = useCallback(async () => {
    if (!keyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${keyId}/usage?period=${period}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e.message || "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }, [keyId, period]);

  useEffect(() => {
    // Defer the initial fetch out of the effect body: fetchData sets loading
    // synchronously before awaiting, which trips React's cascading-render rule.
    const timer = setTimeout(fetchData, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  // Hooks run unconditionally above; the panel only renders with a key selected.
  if (!apiKey) return null;

  const quota = data?.quota;
  const totals = data?.totals;
  const unlimited = quota?.unlimited ?? (apiKey.tokenLimit || 0) === 0;
  const used = quota?.usedTokens ?? apiKey.usedTokens ?? 0;
  const limit = quota?.tokenLimit ?? apiKey.tokenLimit ?? 0;
  const percent = quota?.percent ?? (unlimited ? 0 : Math.min(100, (used / limit) * 100));
  const exceeded = quota?.exceeded ?? (!unlimited && used >= limit);
  // Guard the live tail at the display boundary as well as at the page caller,
  // so a future caller can't accidentally show another API key's requests.
  const keyLiveRequests = liveRequests?.filter((request) =>
    request.apiKey && apiKey?.key && request.apiKey.trim() === apiKey.key.trim()
  ) || [];

  const barColor = exceeded
    ? "bg-red-500"
    : percent > 80
    ? "bg-amber-500"
    : "bg-primary";

  return (
    <Modal
      isOpen
      title={`Token Quota — ${apiKey.name || ""}`}
      onClose={onClose}
      size="full"
      footer={<Button onClick={onClose} variant="ghost" fullWidth>Close</Button>}
    >
      {/* Modal owns the viewport-sized scroll area. Avoid a second max-height
          scroller here: nested scrolling clipped the live panel and made the
          breakdown tables appear cut off in the quota detail view. */}
      <div className="flex flex-col gap-4 pr-0.5">
        {/* Quota summary */}
        <div className="rounded-xl border border-border p-3.5">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">toll</span>
              <span className="text-sm font-semibold text-text-main">Quota</span>
              {exceeded && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-medium">
                  Exceeded — requests return 429
                </span>
              )}
              {!exceeded && quota?.warning && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                  Near limit
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onResetUsage?.()}
              className="text-[11px] text-primary hover:underline font-medium cursor-pointer disabled:opacity-40"
              disabled={used <= 0}
            >
              Reset usage
            </button>
          </div>

          <div className="flex items-end justify-between text-xs text-text-muted mb-1.5">
            <span>
              <strong className="text-text-main font-semibold text-base tabular-nums">{fmtTokens(used)}</strong>
              {unlimited ? (
                <span className="ml-1">tokens used (unlimited)</span>
              ) : (
                <span className="ml-1">/ {fmtTokens(limit)} tokens</span>
              )}
            </span>
            {!unlimited && (
              <span className={cn("font-medium tabular-nums", exceeded ? "text-red-500" : percent > 80 ? "text-amber-500" : "text-text-main")}>
                {percent.toFixed(1)}%
              </span>
            )}
          </div>
          {!unlimited && (
            <div className="w-full h-2 rounded-full bg-black/5 dark:bg-white/5 overflow-hidden">
              <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
          )}
          {!unlimited && (
            <div className="flex items-center justify-between text-[11px] text-text-muted mt-1.5">
              <span>Remaining: <strong className="text-text-main tabular-nums">{fmtTokens(quota?.remaining ?? Math.max(0, limit - used))}</strong></span>
              <span>Limit: {limit.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Period selector */}
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "shrink-0 rounded-lg border px-2 py-1 text-xs font-medium transition-all cursor-pointer sm:px-2.5",
                  period === p.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-text-muted hover:text-text-main hover:bg-surface-2"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border p-0 text-text-muted hover:text-primary hover:border-primary/40 transition-all cursor-pointer sm:size-10"
            title="Refresh"
            aria-label="Refresh usage"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
          </button>
        </div>

        {/* Live activity — fed by the parent's SSE stream (in-flight + recent tail) */}
        {(inFlight > 0 || keyLiveRequests.length > 0) && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-surface-2/60 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-text-main flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
                  <span className="relative inline-flex rounded-full size-2 bg-green-500" />
                </span>
                Live activity
              </span>
              {inFlight > 0 && (
                <span className="text-[11px] font-medium text-primary tabular-nums">
                  {inFlight} in flight
                </span>
              )}
            </div>
            {!keyLiveRequests.length ? (
              <p className="px-3 py-3 text-xs text-text-muted text-center">Waiting for the first completed request…</p>
            ) : (
              <div className="flex flex-col">
                {keyLiveRequests.map((r, i) => {
                  const ok = !r.status || r.status === "ok" || r.status === "success";
                  return (
                    <div key={`${r.timestamp}-${i}`} className="flex items-center gap-3 px-3 py-1.5 border-b border-border/60 last:border-b-0 text-[11px]">
                      <span className={`block w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-green-500" : "bg-red-500"}`} />
                      <span className="font-mono text-text-main truncate flex-1 min-w-0" title={r.model}>{r.model || "unknown"}</span>
                      <span className="text-primary tabular-nums shrink-0">{fmtTokens(r.promptTokens)}↑</span>
                      <span className="text-success tabular-nums shrink-0">{fmtTokens(r.completionTokens)}↓</span>
                      <span className="text-text-muted tabular-nums shrink-0 w-16 text-right">{relTime(r.timestamp)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-sm text-text-muted">
            <span className="material-symbols-outlined animate-spin text-[22px] block mb-1">progress_activity</span>
            Loading usage…
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-red-500">{error}</div>
        ) : (
          <>
            {/* Totals for the selected period */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Stat icon="data_usage" label="Total tokens" value={fmtTokens(totals?.totalTokens)} sub={`${(totals?.requests || 0).toLocaleString()} requests`} />
              <Stat icon="arrow_upward" label="Prompt" value={fmtTokens(totals?.promptTokens)} sub="input tokens" />
              <Stat icon="arrow_downward" label="Completion" value={fmtTokens(totals?.completionTokens)} sub="output tokens" />
              <Stat icon="payments" label="Cost" value={fmtCost(totals?.cost)} sub={totals?.cachedTokens ? `${fmtTokens(totals.cachedTokens)} cached` : "estimated"} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
              <span>Created {fmtDate(data?.key?.createdAt)}</span>
              <span>First used {fmtDate(totals?.firstUsed)}</span>
              <span>Last used {fmtDate(totals?.lastUsed)}</span>
            </div>

            {/* Daily breakdown */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2 bg-surface-2/60 border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold text-text-main">Daily usage</span>
                <span className="text-[11px] text-text-muted">{data?.daily?.length || 0} day(s)</span>
              </div>
              {!data?.daily?.length ? (
                <p className="px-3 py-4 text-xs text-text-muted text-center">No usage recorded in this period.</p>
              ) : (
                <div className="flex flex-col max-h-56 overflow-y-auto">
                  {[...data.daily].reverse().map((d) => {
                    const maxTokens = Math.max(...data.daily.map((x) => x.tokens), 1);
                    const w = Math.round((d.tokens / maxTokens) * 100);
                    return (
                      <div key={d.date} className="flex items-center gap-3 px-3 py-1.5 border-b border-border/60 last:border-b-0">
                        <span className="text-[11px] text-text-muted w-20 shrink-0 tabular-nums">{d.date}</span>
                        <div className="flex-1 h-2 rounded-full bg-black/5 dark:bg-white/5 overflow-hidden min-w-8">
                          <div className="h-full rounded-full bg-primary/70" style={{ width: `${w}%` }} />
                        </div>
                        <span className="text-[11px] text-text-main font-medium tabular-nums w-16 text-right shrink-0">{fmtTokens(d.tokens)}</span>
                        <span className="text-[11px] text-text-muted tabular-nums w-14 text-right shrink-0">{d.requests} req</span>
                        <span className="text-[11px] text-text-muted tabular-nums w-16 text-right shrink-0">{fmtCost(d.cost)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Breakdowns */}
            <BreakdownTable title="By model" rows={data?.byModel || []} labelKey="model" empty="No model usage in this period." />
            <BreakdownTable title="By provider" rows={data?.byProvider || []} labelKey="provider" empty="No provider usage in this period." />
            <BreakdownTable title="By endpoint" rows={data?.byEndpoint || []} labelKey="endpoint" empty="No endpoint usage in this period." />
          </>
        )}
      </div>

    </Modal>
  );
}

KeyQuotaDetail.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    tokenLimit: PropTypes.number,
    usedTokens: PropTypes.number,
  }),
  onClose: PropTypes.func.isRequired,
  onResetUsage: PropTypes.func,
  // Period the panel opens on (deep links pass the page period; default "all").
  initialPeriod: PropTypes.string,
  // Live tail for this key (raw recent requests) + current in-flight count,
  // both optional: when absent the panel behaves as before.
  liveRequests: PropTypes.arrayOf(PropTypes.object),
  inFlight: PropTypes.number,
};
