"use client";

import { useState } from "react";

export default function RevealApiKey({ id }) {
  const [secret, setSecret] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function toggleReveal() {
    if (revealed) {
      setRevealed(false);
      setSecret("");
      return;
    }
    setError("");
    const response = await fetch(`/k/${encodeURIComponent(id)}/secret`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.key !== "string") {
      setError(body.error || "Could not reveal API key.");
      return;
    }
    setSecret(body.key);
    setRevealed(true);
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard access is unavailable. Select and copy the key instead.");
    }
  }

  return (
    <section className="rounded-[14px] border border-border bg-surface p-4 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-main">API key</h2>
          <p className="mt-1 text-[11px] text-text-muted">Keep this private. Anyone with the key can make requests.</p>
        </div>
        <button type="button" onClick={toggleReveal} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-main hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <span className="material-symbols-outlined text-[16px]">{revealed ? "visibility_off" : "visibility"}</span>
          {revealed ? "Hide key" : "Reveal key"}
        </button>
      </div>
      {revealed && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <code className="min-w-0 flex-1 select-all break-all font-mono text-xs text-text-main">{secret}</code>
          <button type="button" onClick={copySecret} aria-label="Copy API key" className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-3 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="material-symbols-outlined text-[17px]">{copied ? "check" : "content_copy"}</span>
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
