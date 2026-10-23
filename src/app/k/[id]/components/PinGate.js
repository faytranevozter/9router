"use client";

import { useState } from "react";

export default function PinGate({ id, name }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/k/${encodeURIComponent(id)}/unlock`, { method: "POST", body: new FormData(event.currentTarget) });
      const body = await response.json();
      if (response.ok && body.ok) window.location.reload();
      else setError(body.error || "Incorrect PIN");
    } catch { setError("Unable to check PIN. Try again."); }
    finally { setPending(false); }
  }
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center px-4 py-8">
      <form onSubmit={submit} className="w-full rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Locked</p>
        <h1 className="mb-2 text-xl font-semibold text-text-main">{name || "API key"}</h1>
        <p className="mb-5 text-sm text-text-muted">This status page requires a PIN. Ask whoever shared the link with you.</p>
        <label className="mb-2 block text-sm font-medium text-text-main" htmlFor="public-status-pin">PIN</label>
        <input id="public-status-pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]{6,12}" autoComplete="one-time-code" required className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-text-main" />
        {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
        <button disabled={pending} className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60">{pending ? "Checking…" : "Unlock status page"}</button>
      </form>
    </main>
  );
}
