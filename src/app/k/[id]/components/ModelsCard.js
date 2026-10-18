import PropTypes from "prop-types";
import { fmtTokens } from "@/shared/utils/formatTokens";

// The models THIS key may call — the same allow-list filter /v1/models applies.
export default function ModelsCard({ models }) {
  return (
    <section className="rounded-[14px] border border-border bg-surface shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-main">
          <span className="material-symbols-outlined text-[18px] text-primary">deployed_code</span>
          Available models
        </h2>
        <span className="text-[11px] text-text-muted">
          {models.length} {models.length === 1 ? "model" : "models"}
        </span>
      </div>

      {models.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-text-muted">No models are available to this key.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="px-4 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-left font-medium">Owner</th>
                <th className="px-3 py-2 text-right font-medium">Context</th>
                <th className="px-3 py-2 text-right font-medium">Max output</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id} className="border-b border-border/60 last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-1.5 font-mono text-[11px] text-text-main">{model.id}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-muted">{model.owned_by || "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">
                    {Number.isFinite(model.context_length) ? fmtTokens(model.context_length) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">
                    {Number.isFinite(model.max_completion_tokens) ? fmtTokens(model.max_completion_tokens) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

ModelsCard.propTypes = {
  models: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      owned_by: PropTypes.string,
      context_length: PropTypes.number,
      max_completion_tokens: PropTypes.number,
    })
  ).isRequired,
};
