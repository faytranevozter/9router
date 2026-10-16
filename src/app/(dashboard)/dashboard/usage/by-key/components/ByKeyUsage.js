"use client";

// Dedicated usage page: one row per API key over a selectable period, live.
//
// Data: GET /api/usage/by-key?period=… (one grouped query, server-side).
// Realtime: ONE EventSource on the shared /api/usage/stream. The stream is used
// as a change *signal* (its payload always reports period="all" grouped by
// key|model), so on every tick we debounce a refetch of the period aggregate and
// read the live in-flight / recent fields straight from the payload:
//   - live fields  → activity strip + per-row in-flight count + drill-down tail
//   - refetch      → period-correct table totals (the stream can't provide them)
// Decision: the shared stream emits no SSE event names (both "update" and
// "pending" arrive as plain `data:` frames), so we cannot tell a cheap pending
// tick from a heavy update tick. We therefore treat EVERY message as a change
// signal: live fields update immediately, the period refetch is debounced so a
// burst of ticks collapses into one request. See the plan's section 4.
// Drill-down reuses the Endpoint page's KeyQuotaDetail panel with its default
// behaviour, plus the optional live tail + in-flight props added for this page.
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import PropTypes from "prop-types";
import { Card, SegmentedControl, CardSkeleton, Input, Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import KeyQuotaDetail from "@/app/(dashboard)/dashboard/endpoint/components/KeyQuotaDetail";
import KeyUsageTable from "./KeyUsageTable";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];
const VALID_PERIODS = new Set(PERIODS.map((p) => p.value));
const DEFAULT_PERIOD = "7d";

// Refresh cadence: every stream tick, debounced so bursts collapse into one request.
const REFETCH_DEBOUNCE_MS = 400;
// How long a row stays highlighted after its totals grew.
const FLASH_MS = 1200;
// Fallback only when EventSource is unavailable.
const POLL_MS = 10000;

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function sumActive(models) {
  if (!models) return 0;
  return Object.values(models).reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
}

function timeAgoLabel(ts) {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ISO timestamp → epoch ms, falling back to "now" for a missing/invalid value.
function isoMs(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

// 1 s ticker so "updated Xs ago" advances without re-rendering the page.
function UpdatedAgo({ ts }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{timeAgoLabel(ts)}</>;
}

UpdatedAgo.propTypes = { ts: PropTypes.number.isRequired };

function SummaryCard({ label, value, sub, tone }) {
  return (
    <Card className="flex min-w-0 flex-col gap-1 px-3 py-3 sm:px-4">
      <span className="text-text-muted text-xs uppercase font-semibold">{label}</span>
      <span className={cn("w-full truncate text-lg font-bold tabular-nums", tone || "text-text-main")} title={String(value)}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-text-muted">{sub}</span>}
    </Card>
  );
}

SummaryCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  sub: PropTypes.string,
  tone: PropTypes.string,
};

// Live activity strip: in-flight requests + the recent tail, straight from SSE.
function LiveActivity({ activeRequests, recentRequests, errorProvider }) {
  const recent = recentRequests.slice(0, 8);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
      <Card padding="sm" className="flex min-w-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-1 py-1.5 border-b border-border shrink-0">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">In flight</span>
          <span className="text-xs tabular-nums text-text-muted">{activeRequests.length}</span>
        </div>
        {activeRequests.length === 0 ? (
          <p className="flex-1 px-1 py-4 text-xs text-text-muted">No requests in flight.</p>
        ) : (
          <div className="flex flex-col overflow-y-auto max-h-40">
            {activeRequests.map((r, i) => (
              <div key={`${r.account}-${r.model}-${i}`} className="flex items-center gap-2 px-1 py-1.5 text-xs">
                <span className="relative flex size-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full size-2 bg-primary" />
                </span>
                <span className="font-mono text-text-main truncate" title={r.model}>{r.model}</span>
                <span className="text-text-muted truncate">· {r.provider}</span>
                <span className="ml-auto tabular-nums text-text-muted shrink-0">×{r.count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card padding="sm" className="flex min-w-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-1 py-1.5 border-b border-border shrink-0">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Recent requests</span>
          {errorProvider && <span className="text-[10px] text-red-500">error: {errorProvider}</span>}
        </div>
        {recent.length === 0 ? (
          <p className="flex-1 px-1 py-4 text-xs text-text-muted">No recent requests yet.</p>
        ) : (
          <div className="flex flex-col overflow-y-auto max-h-40">
            {recent.map((r, i) => {
              const ok = !r.status || r.status === "ok" || r.status === "success";
              return (
                <div key={`${r.timestamp}-${i}`} className="flex items-center gap-2 px-1 py-1.5 text-xs">
                  <span className={cn("block w-1.5 h-1.5 rounded-full shrink-0", ok ? "bg-green-500" : "bg-red-500")} />
                  <span className="font-mono text-text-main truncate max-w-[130px]" title={r.model}>{r.model || "unknown"}</span>
                  <span className="hidden truncate text-text-muted sm:inline">{r.apiKey ? r.apiKey.slice(0, 8) + "…" : "no key"}</span>
                  <span className="ml-auto whitespace-nowrap tabular-nums text-text-muted shrink-0">
                    <span className="text-primary">{fmt(r.promptTokens)}↑</span>{" "}
                    <span className="text-success">{fmt(r.completionTokens)}↓</span>
                  </span>
                  <span className="w-14 shrink-0 text-right text-[10px] whitespace-nowrap text-text-muted">
                    <UpdatedAgo ts={isoMs(r.timestamp)} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

LiveActivity.propTypes = {
  activeRequests: PropTypes.arrayOf(PropTypes.object).isRequired,
  recentRequests: PropTypes.arrayOf(PropTypes.object).isRequired,
  errorProvider: PropTypes.string,
};

export default function ByKeyUsage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialPeriod = (() => {
    const p = searchParams.get("period");
    return VALID_PERIODS.has(p) ? p : DEFAULT_PERIOD;
  })();

  const [period, setPeriod] = useState(initialPeriod);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);

  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState("requests");
  const [sortOrder, setSortOrder] = useState("desc");

  // Live (SSE) payload fields.
  const [live, setLive] = useState({ activeByKey: {}, recentRequests: [], activeRequests: [], errorProvider: "", ready: false });
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());

  const [flashKeys, setFlashKeys] = useState(() => new Set());

  const [selectedKey, setSelectedKey] = useState(null);
  const [detailNonce, setDetailNonce] = useState(0);

  const prevRowsRef = useRef(new Map());
  const pausedRef = useRef(false);
  const hiddenRef = useRef(false);
  const debounceRef = useRef(null);
  const fetchSeqRef = useRef(0);
  const flashTimersRef = useRef([]);
  const initialKeyHandled = useRef(false);
  const pauseMountedRef = useRef(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // ── Data fetch (period aggregate) ───────────────────────────────────────
  const load = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setFetching(true);
    try {
      const res = await fetch(`/api/usage/by-key?period=${period}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (seq !== fetchSeqRef.current) return; // a newer request superseded this one

      const prev = prevRowsRef.current;
      const next = new Map();
      const flashed = new Set();
      for (const r of json.keys || []) {
        const id = r.key || "local-no-key";
        next.set(id, r);
        const old = prev.get(id);
        // Flash rows whose period totals grew since the last fetch.
        if (old && (r.requests > old.requests || r.cost > old.cost)) flashed.add(id);
      }
      prevRowsRef.current = next;

      setRows(json.keys || []);
      setTotal(json.total || null);
      setError(null);
      setLastUpdated(Date.now());

      // Deep link (?key=<id>): resolved once, after the first load that has rows.
      // Done here (post-await) rather than in an effect so it isn't a synchronous
      // setState-in-effect.
      if (!initialKeyHandled.current) {
        initialKeyHandled.current = true;
        const keyParam = searchParams.get("key");
        const deepRow = keyParam ? (json.keys || []).find((r) => r.id === keyParam) : null;
        if (deepRow) setSelectedKey(deepRow);
      }

      if (flashed.size) {
        setFlashKeys((s) => new Set([...s, ...flashed]));
        const timer = setTimeout(() => {
          setFlashKeys((s) => {
            const copy = new Set(s);
            for (const k of flashed) copy.delete(k);
            return copy;
          });
        }, FLASH_MS);
        flashTimersRef.current.push(timer);
      }
    } catch (e) {
      if (seq === fetchSeqRef.current) setError(e.message || "Failed to load usage");
    } finally {
      if (seq === fetchSeqRef.current) {
        setFetching(false);
        setLoading(false);
      }
    }
  }, [period, searchParams]);

  // Keep a stable handle so stream/poll/visibility callbacks always use the
  // latest `load` (with the current period) without re-subscribing.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  // Initial load + reload on period change.
  useEffect(() => {
    loadRef.current();
  }, [period]);

  const scheduleRefetch = useCallback(() => {
    if (pausedRef.current || hiddenRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      loadRef.current();
    }, REFETCH_DEBOUNCE_MS);
  }, []);

  // ── SSE (shared /api/usage/stream) ──────────────────────────────────────
  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;
    const es = new EventSource("/api/usage/stream");
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      setConnected(true);
      setLive({
        // Full stats expose it top-level; pending ticks come from getActiveRequests().
        activeByKey: data.activeByKey || data.pending?.byApiKey || {},
        recentRequests: Array.isArray(data.recentRequests) ? data.recentRequests : [],
        activeRequests: Array.isArray(data.activeRequests) ? data.activeRequests : [],
        errorProvider: data.errorProvider || "",
        ready: true,
      });
      scheduleRefetch();
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [scheduleRefetch]);

  // Fallback polling when EventSource is unavailable.
  useEffect(() => {
    if (typeof EventSource !== "undefined") return undefined;
    const id = setInterval(() => {
      if (!pausedRef.current && !hiddenRef.current) loadRef.current();
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Pause refetching while the tab is hidden; catch up on return.
  useEffect(() => {
    const onVisibility = () => {
      hiddenRef.current = document.hidden;
      if (!document.hidden && !pausedRef.current) loadRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Resume from pause → refetch immediately (skip mount).
  useEffect(() => {
    if (!pauseMountedRef.current) { pauseMountedRef.current = true; return; }
    if (!paused) loadRef.current();
  }, [paused]);

  // Clear any pending flash timers / debounce on unmount.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    for (const t of flashTimersRef.current) clearTimeout(t);
  }, []);

  // ── Derived: filter + live merge + sort ─────────────────────────────────
  const displayRows = useMemo(() => {
    const base = rows || [];
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? base.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.keyMasked || "").toLowerCase().includes(q))
      : base;
    const withLive = filtered.map((r) => ({
      ...r,
      // Live counts win once the stream has spoken; before that, use the
      // server-computed snapshot from the initial fetch.
      active: live.ready ? (r.key ? sumActive(live.activeByKey[r.key]) : 0) : (r.active || 0),
    }));
    const dir = sortOrder === "asc" ? 1 : -1;
    return [...withLive].sort((a, b) => {
      let va = a[sortBy];
      let vb = b[sortBy];
      if (sortBy === "isActive") { va = a.isActive ? 1 : 0; vb = b.isActive ? 1 : 0; }
      if (typeof va === "string" || typeof vb === "string") {
        const sa = (va ?? "").toString().toLowerCase();
        const sb = (vb ?? "").toString().toLowerCase();
        return sa < sb ? -dir : sa > sb ? dir : 0;
      }
      return ((va || 0) - (vb || 0)) * dir;
    });
  }, [rows, filter, sortBy, sortOrder, live]);

  const summary = useMemo(() => {
    const list = rows || [];
    return {
      requests: total?.requests || 0,
      tokens: total?.totalTokens || 0,
      cost: total?.cost || 0,
      inUse: list.filter((r) => r.requests > 0).length,
      overQuota: list.filter((r) => r.exceeded).length,
    };
  }, [rows, total]);

  const selectedLive = useMemo(() => {
    if (!selectedKey?.key) return { requests: [], inFlight: 0 };
    const keyVal = selectedKey.key;
    return {
      requests: live.recentRequests.filter((r) => r.apiKey && r.apiKey.trim() === keyVal).slice(0, 20),
      inFlight: sumActive(live.activeByKey?.[keyVal]),
    };
  }, [selectedKey, live]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const toggleSort = (field) => {
    if (field === sortBy) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder(field === "name" || field === "keyMasked" ? "asc" : "desc");
    }
  };

  const syncUrl = (keyId) => {
    const params = new URLSearchParams(searchParams.toString());
    if (keyId) params.set("key", keyId);
    else params.delete("key");
    params.set("period", period);
    router.replace(`/dashboard/usage/by-key?${params.toString()}`, { scroll: false });
  };

  const openDetail = (row) => {
    if (!row?.id) return;
    setSelectedKey(row);
    syncUrl(row.id);
  };

  const closeDetail = () => {
    setSelectedKey(null);
    syncUrl(null);
  };

  const handleResetUsage = async () => {
    const row = selectedKey;
    if (!row?.id) return;
    try {
      const res = await fetch(`/api/keys/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usedTokens: 0 }),
      });
      if (!res.ok) return;
      await loadRef.current();
      setSelectedKey((prev) => (prev ? {
        ...prev,
        usedTokens: 0,
        percent: 0,
        remaining: prev.unlimited ? null : prev.tokenLimit,
        exceeded: false,
        warning: false,
      } : prev));
      // Remount the panel so it refetches its own quota view.
      setDetailNonce((n) => n + 1);
    } catch { /* keep the last good render */ }
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* Header: live indicator + pause + period selector (page title lives in Header) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs" data-i18n-skip="true">
            <span className="relative flex size-2">
              <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-60", connected && !paused ? "bg-green-500" : "bg-amber-500")} />
              <span className={cn("relative inline-flex rounded-full size-2", connected && !paused ? "bg-green-500" : "bg-amber-500")} />
            </span>
            <span className="text-text-muted">
              {paused ? "Paused" : connected ? "Live" : "Reconnecting…"} · <UpdatedAgo ts={lastUpdated} />
            </span>
          </span>
          {fetching && (
            <span className="material-symbols-outlined animate-spin text-[15px] text-text-muted">progress_activity</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            icon={paused ? "play_arrow" : "pause"}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
          <SegmentedControl options={PERIODS} value={period} onChange={setPeriod} size="sm" className="w-full sm:w-auto" />
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total requests" value={fmt(summary.requests)} />
        <SummaryCard label="Total tokens" value={fmt(summary.tokens)} tone="text-primary" />
        <SummaryCard label="Total cost" value={fmtCost(summary.cost)} tone="text-warning" sub="Estimated, not actual billing" />
        <SummaryCard
          label="Keys in use"
          value={`${summary.inUse} / ${(rows || []).length}`}
          sub={`${summary.overQuota} over quota`}
          tone={summary.overQuota > 0 ? "text-red-500" : "text-text-main"}
        />
      </div>

      {/* Live activity (in-flight + recent tail) */}
      <LiveActivity
        activeRequests={live.activeRequests}
        recentRequests={live.recentRequests}
        errorProvider={live.errorProvider}
      />

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or masked key…"
          icon="search"
          className="w-full sm:w-72"
        />
        {filter && (
          <Button size="sm" variant="ghost" onClick={() => setFilter("")}>Clear</Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-500">{error}</div>
      )}

      {loading ? (
        <CardSkeleton />
      ) : (
        <KeyUsageTable
          rows={displayRows}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onToggleSort={toggleSort}
          onView={openDetail}
          flashKeys={flashKeys}
        />
      )}

      {selectedKey && (
        <KeyQuotaDetail
          key={`${selectedKey.id}-${detailNonce}`}
          apiKey={selectedKey}
          onClose={closeDetail}
          onResetUsage={handleResetUsage}
          initialPeriod={period}
          liveRequests={selectedLive.requests}
          inFlight={selectedLive.inFlight}
        />
      )}
    </div>
  );
}
