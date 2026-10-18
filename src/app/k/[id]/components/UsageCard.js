import PropTypes from "prop-types";
import { fmtTokens } from "@/shared/utils/formatTokens";

// Usage for the last 7 days: period totals, a daily bar chart, and by-model /
// by-provider tables. Deliberately no cost column — that is the operator's
// spend data, not the key holder's.
function Stat({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 px-3 py-2.5">
      <div className="mb-0.5 text-[11px] text-text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-text-main">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-text-muted">{sub}</div>}
    </div>
  );
}

Stat.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  sub: PropTypes.string,
};

function BreakdownTable({ title, rows, labelKey, empty }) {
  const total = rows.reduce((sum, row) => sum + (row.promptTokens || 0) + (row.completionTokens || 0), 0) || 1;
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-3 py-2">
        <span className="text-xs font-semibold text-text-main">{title}</span>
        <span className="text-[11px] text-text-muted">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="px-3 py-1.5 text-left font-medium">{labelKey}</th>
                <th className="px-2 py-1.5 text-right font-medium">Req</th>
                <th className="px-2 py-1.5 text-right font-medium">Prompt</th>
                <th className="px-2 py-1.5 text-right font-medium">Completion</th>
                <th className="w-24 px-3 py-1.5 text-left font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const tokens = (row.promptTokens || 0) + (row.completionTokens || 0);
                const pct = Math.round((tokens / total) * 100);
                return (
                  <tr key={row[labelKey]} className="border-b border-border/60 last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-text-main">{row[labelKey]}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{(row.requests || 0).toLocaleString("en-US")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{fmtTokens(row.promptTokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{fmtTokens(row.completionTokens)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 text-right text-[10px] tabular-nums text-text-muted">{pct}%</span>
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

export default function UsageCard({ usage }) {
  const { period, totals, daily, byModel, byProvider } = usage;
  const maxDaily = Math.max(...(daily || []).map((day) => day.tokens || 0), 1);

  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-surface p-4 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-main">
          <span className="material-symbols-outlined text-[18px] text-primary">bar_chart</span>
          Usage — last {period}
        </h2>
        <span className="text-[11px] text-text-muted">
          Lifetime quota counters above; these totals cover only this period.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat
          label="Total tokens"
          value={fmtTokens(totals.totalTokens)}
          sub={`${(totals.requests || 0).toLocaleString("en-US")} requests`}
        />
        <Stat label="Prompt" value={fmtTokens(totals.promptTokens)} sub="input tokens" />
        <Stat label="Completion" value={fmtTokens(totals.completionTokens)} sub="output tokens" />
        <Stat label="Cached" value={fmtTokens(totals.cachedTokens)} sub="reused input" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-3 py-2">
          <span className="text-xs font-semibold text-text-main">Daily usage</span>
          <span className="text-[11px] text-text-muted">{daily.length} day(s)</span>
        </div>
        {daily.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-text-muted">No usage recorded in this period.</p>
        ) : (
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {[...daily].reverse().map((day) => (
              <div key={day.date} className="flex items-center gap-3 border-b border-border/60 px-3 py-1.5 last:border-b-0">
                <span className="w-20 shrink-0 text-[11px] tabular-nums text-text-muted">{day.date}</span>
                <div className="h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.round(((day.tokens || 0) / maxDaily) * 100)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-[11px] font-medium tabular-nums text-text-main">
                  {fmtTokens(day.tokens)}
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-text-muted">
                  {day.requests} req
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <BreakdownTable title="By model" rows={byModel} labelKey="model" empty="No model usage in this period." />
      <BreakdownTable title="By provider" rows={byProvider} labelKey="provider" empty="No provider usage in this period." />
    </section>
  );
}

UsageCard.propTypes = {
  usage: PropTypes.shape({
    period: PropTypes.string.isRequired,
    totals: PropTypes.object.isRequired,
    daily: PropTypes.arrayOf(PropTypes.object).isRequired,
    byModel: PropTypes.arrayOf(PropTypes.object).isRequired,
    byProvider: PropTypes.arrayOf(PropTypes.object).isRequired,
  }).isRequired,
};
