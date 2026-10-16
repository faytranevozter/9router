"use client";

// Sortable per-API-key usage table for /dashboard/usage/by-key.
// Pure presentation: the parent owns fetching, sorting state, filtering and the
// live in-flight counts (already merged into each row as `active`).
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { cn } from "@/shared/utils/cn";
import { fmt, fmtTime } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import { fmtTokens } from "@/app/(dashboard)/dashboard/endpoint/components/KeyQuotaDetail";

const fmtCost = (n) => `$${(Number(n) || 0).toFixed(4)}`;

// Every column is sortable (the parent sorts by `field`).
export const KEY_USAGE_COLUMNS = [
  { field: "name", label: "Key" },
  { field: "keyMasked", label: "Key value" },
  { field: "isActive", label: "Status" },
  { field: "active", label: "Live", align: "right" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "promptTokens", label: "Prompt", align: "right" },
  { field: "completionTokens", label: "Completion", align: "right" },
  { field: "totalTokens", label: "Total tokens", align: "right" },
  { field: "cost", label: "Cost", align: "right" },
  { field: "percent", label: "Quota", align: "right" },
  { field: "lastUsed", label: "Last used", align: "right" },
];

function SortIcon({ field, sortBy, sortOrder }) {
  if (sortBy !== field) return <span className="ml-1 opacity-20">↕</span>;
  return <span className="ml-1">{sortOrder === "asc" ? "↑" : "↓"}</span>;
}

SortIcon.propTypes = {
  field: PropTypes.string.isRequired,
  sortBy: PropTypes.string.isRequired,
  sortOrder: PropTypes.string.isRequired,
};

function QuotaCell({ row }) {
  if (row.unlimited) {
    return <span className="text-xs text-text-muted">Unlimited</span>;
  }
  const percent = Math.min(100, row.percent || 0);
  const barColor = row.exceeded ? "bg-red-500" : percent > 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="flex items-center justify-end gap-2 min-w-[130px]">
      <div className="flex-1 h-1.5 rounded-full bg-black/5 dark:bg-white/5 overflow-hidden min-w-10">
        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${percent}%` }} />
      </div>
      <span
        className={cn("text-[11px] tabular-nums whitespace-nowrap", row.exceeded ? "text-red-500" : "text-text-muted")}
        title={`${fmtTokens(row.usedTokens)} / ${fmtTokens(row.tokenLimit)} tokens`}
      >
        {fmtTokens(row.usedTokens)}/{fmtTokens(row.tokenLimit)}
      </span>
      {row.exceeded && (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-medium">over</span>
      )}
    </div>
  );
}

QuotaCell.propTypes = { row: PropTypes.object.isRequired };

export default function KeyUsageTable({ rows, sortBy, sortOrder, onToggleSort, onView, flashKeys }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
            <tr>
              {KEY_USAGE_COLUMNS.map((col) => (
                <th
                  key={col.field}
                  onClick={() => onToggleSort(col.field)}
                  className={cn(
                    "px-3 py-3 cursor-pointer select-none whitespace-nowrap hover:bg-bg-subtle/50",
                    col.align === "right" && "text-right"
                  )}
                >
                  {col.label}
                  <SortIcon field={col.field} sortBy={sortBy} sortOrder={sortOrder} />
                </th>
              ))}
              <th className="px-3 py-3 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={KEY_USAGE_COLUMNS.length + 1} className="px-6 py-10 text-center text-text-muted">
                  No API keys match this view yet.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const rowId = row.key || "local-no-key";
              const active = row.active || 0;
              const flash = flashKeys.has(rowId);
              const clickable = !row.isLocal && !!row.id;
              // Flash wins over the steady in-flight tint (cn() does not dedupe).
              const rowBg = flash ? "bg-primary/15" : active > 0 ? "bg-primary/5" : "";
              return (
                <tr
                  key={rowId}
                  onClick={clickable ? () => onView(row) : undefined}
                  className={cn(
                    "transition-colors duration-500",
                    clickable && "cursor-pointer hover:bg-bg-subtle/40",
                    rowBg,
                    row.isActive === false && "opacity-60"
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {active > 0 && (
                        <span className="relative flex size-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                          <span className="relative inline-flex rounded-full size-2 bg-primary" />
                        </span>
                      )}
                      <span className="font-medium text-text-main truncate max-w-[180px]" title={row.name || ""}>
                        {row.name || "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <code className="font-mono text-[11px] text-text-muted">{row.keyMasked || "—"}</code>
                  </td>
                  <td className="px-3 py-2.5">
                    {row.isLocal ? (
                      <Badge variant="default" size="sm">No key</Badge>
                    ) : row.isActive === false ? (
                      <Badge variant="warning" size="sm">Paused</Badge>
                    ) : (
                      <Badge variant="success" size="sm">Active</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {active > 0 ? (
                      <Badge variant="primary" size="sm" dot>{active}</Badge>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{fmt(row.requests)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{fmtTokens(row.promptTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{fmtTokens(row.completionTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium text-text-main">{fmtTokens(row.totalTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{fmtCost(row.cost)}</td>
                  <td className="px-3 py-2.5 text-right"><QuotaCell row={row} /></td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-text-muted">{fmtTime(row.lastUsed)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={(e) => { e.stopPropagation(); if (clickable) onView(row); }}
                      title={clickable ? "View detailed usage" : "No key detail for this row"}
                      className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-[18px]">bar_chart</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

KeyUsageTable.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  sortBy: PropTypes.string.isRequired,
  sortOrder: PropTypes.string.isRequired,
  onToggleSort: PropTypes.func.isRequired,
  onView: PropTypes.func.isRequired,
  flashKeys: PropTypes.instanceOf(Set).isRequired,
};
