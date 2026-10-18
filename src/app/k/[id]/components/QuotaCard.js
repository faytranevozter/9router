import PropTypes from "prop-types";
import { fmtTokens } from "@/shared/utils/formatTokens";
import { cn } from "@/shared/utils/cn";

// Quota block: used / limit, progress bar, remaining tokens.
// Bar colour follows the same thresholds the dashboard key list uses
// (primary → amber above 80% → red once exceeded).
export default function QuotaCard({ quota }) {
  const { unlimited, usedTokens, tokenLimit, remaining, percent, exceeded, warning } = quota;
  const barColor = exceeded ? "bg-red-500" : percent > 80 ? "bg-amber-500" : "bg-primary";

  return (
    <section className="rounded-[14px] border border-border bg-surface p-4 shadow-[var(--shadow-soft)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-main">
          <span className="material-symbols-outlined text-[18px] text-primary">toll</span>
          Token quota
        </h2>
        {exceeded && (
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
            Exceeded — requests return 429
          </span>
        )}
        {!exceeded && warning && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            Near limit
          </span>
        )}
      </div>

      <div className="mb-1.5 flex items-end justify-between text-xs text-text-muted">
        <span>
          <strong className="text-base font-semibold tabular-nums text-text-main">{fmtTokens(usedTokens)}</strong>
          {unlimited ? (
            <span className="ml-1">tokens used (unlimited)</span>
          ) : (
            <span className="ml-1">/ {fmtTokens(tokenLimit)} tokens</span>
          )}
        </span>
        {!unlimited && (
          <span
            className={cn(
              "font-medium tabular-nums",
              exceeded ? "text-red-500" : percent > 80 ? "text-amber-500" : "text-text-main"
            )}
          >
            {percent.toFixed(1)}%
          </span>
        )}
      </div>

      {!unlimited && (
        <>
          <div className="h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
            <div
              className={cn("h-full rounded-full transition-all", barColor)}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-muted">
            <span>
              Remaining: <strong className="tabular-nums text-text-main">{fmtTokens(remaining)}</strong>
            </span>
            <span>Limit: {tokenLimit.toLocaleString("en-US")}</span>
          </div>
        </>
      )}
    </section>
  );
}

QuotaCard.propTypes = {
  quota: PropTypes.shape({
    unlimited: PropTypes.bool.isRequired,
    usedTokens: PropTypes.number.isRequired,
    tokenLimit: PropTypes.number.isRequired,
    remaining: PropTypes.number,
    percent: PropTypes.number.isRequired,
    exceeded: PropTypes.bool.isRequired,
    warning: PropTypes.bool.isRequired,
  }).isRequired,
};
