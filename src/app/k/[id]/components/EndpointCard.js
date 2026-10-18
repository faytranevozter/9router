import PropTypes from "prop-types";
import CopyButton from "./CopyButton";

// Base URL + a copy-ready curl example.
// The snippet uses a literal <your-api-key> placeholder: the real key, and even
// its masked form, never appear in this page's HTML.
export default function EndpointCard({ endpoint }) {
  const { baseUrl, chatPath, exampleModel } = endpoint;
  const url = `${baseUrl}${chatPath}`;
  const model = exampleModel || "<your-model>";
  const curl = [
    `curl ${url} \\`,
    `  -H "Authorization: Bearer <your-api-key>" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`,
  ].join("\n");

  return (
    <section className="rounded-[14px] border border-border bg-surface p-4 shadow-[var(--shadow-soft)]">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-main">
        <span className="material-symbols-outlined text-[18px] text-primary">terminal</span>
        Endpoint
      </h2>

      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-muted">Base URL</span>
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-surface-2/40 px-2 py-1 font-mono text-xs text-text-main">
          {baseUrl}
        </code>
        <CopyButton text={baseUrl} label="Copy" title="Copy base URL" />
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-3 py-1.5">
          <span className="text-[11px] font-semibold text-text-main">Chat completions</span>
          <CopyButton text={curl} label="Copy curl" title="Copy curl example" />
        </div>
        <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed text-text-main">{curl}</pre>
      </div>

      <p className="mt-2 text-[11px] text-text-muted">
        Replace <code className="rounded bg-surface-2 px-1 font-mono">&lt;your-api-key&gt;</code> with the key you were
        given. It is not shown here, by design.
      </p>
    </section>
  );
}

EndpointCard.propTypes = {
  endpoint: PropTypes.shape({
    baseUrl: PropTypes.string.isRequired,
    chatPath: PropTypes.string.isRequired,
    exampleModel: PropTypes.string,
  }).isRequired,
};
